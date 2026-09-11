/**
 * 043 T112 / FR-014 / SC-010 — every quantity this feature DISPLAYS is digit-grouped, at every
 * magnitude and in the active locale's own separator.
 *
 * ══ WHAT THIS FILE ADDS, AND WHAT IT DELIBERATELY LEAVES ALONE ══
 *
 * FR-014 enumerates five surfaces. Three of them are rendered by a component and are already
 * asserted where a component can be rendered, so re-asserting them here would buy a second copy of
 * the same claim in a place that cannot see the markup:
 *
 *   - the find bar's `N of M` counter — `tests/unit/find-count-label.test.ts`, at four magnitudes
 *     and in three locales, over `findCountLabel` itself;
 *   - the panel's total match count — `tests/component/find-in-files-results.test.ts` ("shows the
 *     total, digit-grouped, once the scan completes") and `find-in-files-status.test.ts`;
 *   - a collapsed group's count — `find-in-files-results.test.ts` ("keeps a collapsed group
 *     present, showing its digit-grouped match count", at 1,234);
 *   - the skipped-file count — `find-in-files-status.test.ts`, at 1,500.
 *
 * What has NO assertion anywhere is the fifth — the file count in the irreversible-commit warning
 * — beyond a single magnitude read out of a rendered dialog
 * (`find-in-files-replace-commit.test.ts` asserts the dialog's text contains `1,234`). That is one
 * number in one locale, and the locale is the one thing a rendered dialog cannot vary: `Intl` reads
 * its default from the runtime, so the case that actually matters — a locale grouping with `.` —
 * is untestable at that tier. `commitReplace` takes a `locale` for exactly this reason, which is
 * the arrangement `statusReadouts` and `findCountLabel` already record for themselves.
 *
 * The commit OUTCOME notice's four figures are covered here too. They are not in FR-014's
 * enumeration — the requirement was written before FR-058's notice existed — but they are
 * quantities this feature displays, and constitution 4.5.0's rule is about the class, not the list.
 *
 * ══ THE LAST GROUP IS A GUARD, NOT A DUPLICATE ══
 *
 * "Grouped at every magnitude" is a claim about the call site, not about a value: a figure is
 * either put through `formatGrouped` or it is not, and no number chosen for a test can discover the
 * next figure somebody renders raw. So the final group reads the two rendering modules and asserts
 * that each displayed count is interpolated through the formatter and never bare — which is the
 * half that fails when a sixth quantity arrives.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from '@throng/core';
import type { ConfirmOptions } from '../../src/renderer/confirm-dialog.js';
import type { NoticeInput } from '../../src/renderer/common/notification.js';
import {
  commitReplace,
  type CommitReplaceRequest,
} from '../../src/renderer/find-in-files/commit-replace.js';

/** One match, in the shape `commitReplace` groups into targets. Only `relPath`/`from`/`to` matter. */
function row(relPath: string, from: number): ResultRow {
  return {
    relPath,
    line: 1,
    column: 1,
    from,
    to: from + 6,
    snippet: {
      before: '',
      matched: 'needle',
      after: '',
      truncatedStart: false,
      truncatedEnd: false,
    },
  };
}

const REQUEST: CommitReplaceRequest = {
  panelId: 'p1',
  projectRoot: 'D:/proj',
  term: 'needle',
  modes: { caseSensitive: false, wholeWord: false },
  replacement: 'thread',
  rows: [row('src/a.ts', 6)],
};

/**
 * Drive a commit as far as the irreversible-commit question and hand back what it asked (FR-057b).
 *
 * The confirmation is DECLINED, so nothing is written and no second invoke happens — the question
 * itself is the whole subject here.
 */
async function warningFor(unopenedFileCount: number, locale?: string): Promise<ConfirmOptions> {
  let asked: ConfirmOptions | undefined;
  await commitReplace(REQUEST, {
    confirm: async (options) => {
      asked = options;
      return false;
    },
    notify: () => {},
    // FR-082 — required since T205, and irrelevant to every claim in this file: nothing here reads a
    // notice's dwell. The shipped pair, so it says nothing this file does not mean.
    display: { mode: 'dismiss', timeoutMs: 5000 },
    invoke: async () => ({ committed: false, reason: 'needsConfirmation', unopenedFileCount }),
    locale,
  });
  if (!asked) throw new Error('the commit never asked the irreversible-write question');
  return asked;
}

/** Drive a commit to completion and hand back the ONE notice it raised (FR-058). */
async function noticeFor(
  inBuffer: number,
  onDisk: number,
  refused: number,
  // FR-086 — how many of the buffer files this commit SAVED. Defaults to none, which is what every
  // commit reported before FR-086 and what keeps the callers above measuring what they always did.
  saved = 0,
): Promise<NoticeInput> {
  const paths = (prefix: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix}/f${i}.ts`);
  const buffers = paths('buf', inBuffer);
  let raised: NoticeInput | undefined;
  await commitReplace(REQUEST, {
    confirm: async () => true,
    notify: (notice) => {
      raised = notice;
    },
    display: { mode: 'dismiss', timeoutMs: 5000 },
    invoke: async () => ({
      committed: true,
      outcome: {
        changedInBuffer: buffers,
        changedOnDisk: paths('disk', onDisk),
        refused: paths('gone', refused).map((relPath) => ({ relPath, reason: 'matchGone' })),
        failed: [],
        // A SUBSET of `changedInBuffer`, as the outcome requires — a saved file is still a file the
        // commit changed in its buffer, not a fifth kind.
        saved: buffers.slice(0, saved),
        // The notice counts FILES; which edits landed is the marking's business, not this test's.
        applied: [],
      },
    }),
  });
  if (!raised) throw new Error('the commit reported no outcome');
  return raised;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-057b — the file count in the irreversible-commit warning
 * ────────────────────────────────────────────────────────────────────────── */

describe('the irreversible-commit warning groups its file count (FR-014, FR-057b)', () => {
  it('groups at four figures and at seven', async () => {
    /*
     * The figure the user is deciding on. Ungrouped, `1234567 files will be changed on disk` is a
     * wall of digits read as an order of magnitude at best — and this is the one confirmation in
     * the feature whose whole purpose is that the number be READ before the button is pressed.
     */
    expect((await warningFor(1234, 'en-US')).message).toBe(
      '1,234 files will be changed on disk with no way to undo it inside throng.',
    );
    expect((await warningFor(1234567, 'en-US')).message).toBe(
      '1,234,567 files will be changed on disk with no way to undo it inside throng.',
    );
  });

  it('leaves small counts exactly as they were, and keeps the singular singular', async () => {
    // 4.5.0 removed 018's five-digit floor, so the rule is "grouped at every magnitude" — which for
    // a small number means unchanged. The plural is a separate decision from the grouping and must
    // not be disturbed by it: one file is one file, never "1 files".
    expect((await warningFor(1, 'en-US')).message).toBe(
      '1 file will be changed on disk with no way to undo it inside throng.',
    );
    expect((await warningFor(999, 'en-US')).message).toBe(
      '999 files will be changed on disk with no way to undo it inside throng.',
    );
  });

  it('uses the ACTIVE locale\u2019s separator, not a comma', async () => {
    // The whole reason `formatGrouped` takes a locale rather than a hand-rolled comma: a German
    // user reads `1.234.567`, and a call site writing its own comma would show them a number their
    // own locale renders differently everywhere else in the application.
    expect((await warningFor(1234567, 'de-DE')).message).toBe(
      '1.234.567 files will be changed on disk with no way to undo it inside throng.',
    );

    // French groups with a narrow no-break space. Compared against `Intl` itself rather than typed
    // out, because the character is invisible in a diff and easy to get wrong.
    const french = new Intl.NumberFormat('fr-FR', { useGrouping: true }).format(1234567);
    expect((await warningFor(1234567, 'fr-FR')).message).toBe(
      `${french} files will be changed on disk with no way to undo it inside throng.`,
    );
  });

  it('carries the count in the message, where the decision is made', async () => {
    // The warning line beside it states the CONDITION and names version control as the remedy; the
    // count belongs to the question itself. Asserted so a later rewording cannot move the figure
    // into the secondary line, where a user who reads only the question would not see it.
    const asked = await warningFor(4096, 'en-US');
    expect(asked.message).toContain('4,096');
    expect(asked.warningMessage ?? '').not.toContain('4,096');
    expect(asked.danger).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-058 — the four figures in the one outcome notice
 * ────────────────────────────────────────────────────────────────────────── */

describe('the commit outcome notice groups every figure it reports (FR-014, FR-058)', () => {
  it('groups the changed total, the denominator and both halves of the split', async () => {
    /*
     * `noticeFor` takes no locale — nothing in the running application passes one, so this asserts
     * the RUNTIME's grouping rather than a locale the test chose. Comparing against `Intl` directly
     * (not against `formatGrouped`) is what keeps that non-circular: it proves the module grouped,
     * not that it called the same function twice.
     */
    const grouped = (n: number): string =>
      new Intl.NumberFormat(undefined, { useGrouping: true }).format(n);
    const message = (await noticeFor(1234, 2345, 0)).message;

    expect(message).toBe(
      `${grouped(3579)} of ${grouped(3579)} files changed — ${grouped(2345)} on disk, ` +
        `${grouped(1234)} in open editors with unsaved changes.`,
    );
    // And the ungrouped forms are absent, which is the assertion a `toContain` would not make.
    for (const raw of ['3579', '2345', '1234']) expect(message).not.toContain(raw);
  });

  /*
   * FR-086 — A SAVED FILE COUNTS AS ON DISK, WHICH IS THE WHOLE REASON THE WORDING MOVED.
   *
   * Before FR-086 a commit saved nothing, so "N in open editors and not yet saved" was true of every
   * buffer file and the split could be drawn by which PATH wrote the file. It now saves the ones
   * that were clean, so that sentence became false in the commonest case — the notice would have
   * reported files as unsaved that the very same commit had just written to disk.
   *
   * The split is therefore by what the user must still DO. This is the case that tells the two
   * readings apart: with 1,000 buffer files of which 900 were saved, a by-path split still says
   * 1,000 are unsaved, and the honest one says 100.
   */
  it('counts a saved buffer file as on disk, not as still needing a save (FR-086)', async () => {
    const grouped = (n: number): string =>
      new Intl.NumberFormat(undefined, { useGrouping: true }).format(n);
    const message = (await noticeFor(1000, 2345, 0, 900)).message;

    expect(message).toBe(
      `${grouped(3345)} of ${grouped(3345)} files changed — ${grouped(3245)} on disk, ` +
        `${grouped(100)} in open editors with unsaved changes.`,
    );
    // The total is unmoved by the save: a saved file was already one of the files that changed.
    expect(message).toContain(`${grouped(3345)} of ${grouped(3345)}`);
  });

  it('says every buffer file still needs saving when none was saved (FR-086a)', async () => {
    // The other end, and the reason `saved` is a positive fact rather than `notSaved` inverted:
    // these files were already dirty, so no save was owed, nothing failed, and every one of them
    // still holds unsaved work.
    const grouped = (n: number): string =>
      new Intl.NumberFormat(undefined, { useGrouping: true }).format(n);
    const message = (await noticeFor(1000, 0, 0, 0)).message;

    expect(message).toBe(
      `${grouped(1000)} of ${grouped(1000)} files changed — 0 on disk, ` +
        `${grouped(1000)} in open editors with unsaved changes.`,
    );
  });

  it('groups the denominator when refusals make it differ from the numerator', async () => {
    // FR-053c's mixed state is the normal outcome rather than an anomaly, so the two figures are
    // genuinely different numbers and both have to be grouped.
    const grouped = (n: number): string =>
      new Intl.NumberFormat(undefined, { useGrouping: true }).format(n);
    const message = (await noticeFor(1000, 1000, 1500)).message;

    expect(message).toContain(`${grouped(2000)} of ${grouped(3500)} files changed`);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The guard: no displayed count reaches the DOM without the formatter
 * ────────────────────────────────────────────────────────────────────────── */

const SOURCE = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Every quantity the two rendering modules put on screen, and the expression each is rendered from.
 *
 * `line` and `column` are here because they are displayed counts too — the row's position readout
 * — even though FR-014 does not enumerate them. What is NOT here is the row's `title` attribute,
 * which composes `path:line:column` as a LOCATOR rather than a readout: 040 FR-028a forbids feeding
 * a grouped figure into Go To Line, so the one string a user might copy out stays ungrouped by
 * design.
 */
const DISPLAYED_COUNTS: { module: string; expression: string }[] = [
  { module: 'find-in-files-panel.tsx', expression: 'totalMatches' },
  { module: 'find-in-files-panel.tsx', expression: 'filesScanned' },
  { module: 'find-in-files-panel.tsx', expression: 'skipped' },
  { module: 'results-list.tsx', expression: 'group.matchCount' },
  { module: 'results-list.tsx', expression: 'row.line' },
  { module: 'results-list.tsx', expression: 'row.column' },
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('every displayed count goes through the one formatter (FR-014)', () => {
  for (const { module, expression } of DISPLAYED_COUNTS) {
    it(`${module} renders ${expression} through formatGrouped`, () => {
      const text = SOURCE(`../../src/renderer/find-in-files/${module}`);
      expect(
        new RegExp(`formatGrouped\\(\\s*${escape(expression)}\\s*[,)]`).test(text),
        `${expression} is displayed by ${module} and must be grouped (FR-014)`,
      ).toBe(true);
    });

    it(`${module} never interpolates ${expression} bare`, () => {
      /*
       * The half that catches a REGRESSION rather than an omission: a second, unformatted render of
       * the same figure beside the formatted one. `(?<!\$)` excludes a `${…}` inside a template
       * literal, which is how the row's locator title is composed and is deliberately raw.
       */
      const text = SOURCE(`../../src/renderer/find-in-files/${module}`);
      const bare = new RegExp(`(?<!\\$)\\{\\s*${escape(expression)}\\s*\\}`);
      expect(bare.test(text), `${module} renders ${expression} without grouping it`).toBe(false);
    });
  }
});
