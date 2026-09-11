/**
 * 043 T112a / FR-014's NEGATIVE half — a grouping character never reaches a stored value, a
 * persisted query, or anything crossing a process boundary.
 *
 * ══ WHY THIS IS A SEPARATE FILE FROM THE DISPLAY HALF ══
 *
 * `find-in-files-counts-grouped.test.ts` asserts that every figure on screen is grouped. Nothing in
 * it — and nothing any component test can render — can see the other direction, because the defect
 * is an ABSENCE: a separator that has leaked into a payload looks exactly like a payload until
 * somebody parses it. `1,234` reaching `Number.isInteger` is `false` and the edit is silently
 * dropped; `1.234` reaching a de-DE round trip is a thousand-fold error that still looks like a
 * number. Neither shows up on a screen.
 *
 * It follows `packages/core/tests/unit/grouping-view-only-040.test.ts`, which settled the same
 * requirement for 040's status readouts, and it borrows that file's central point: an absence
 * asserted only where it happens to be true is worth nothing, so the last group is a SWEEP over
 * production source rather than a check of the call sites somebody remembered.
 *
 * ══ WHAT IS DELIBERATELY NOT RE-ASSERTED ══
 *
 * That `parseGrouped` has exactly one production caller in the whole repository — 040's file owns
 * that exhaustive claim and is the right place for it. What is asserted here is the narrower 043
 * statement it does not make: that no module on THIS feature's transport or persistence path calls
 * either function.
 *
 * That `formatGrouped`/`parseGrouped` round-trip in every locale is `core/tests/unit/
 * number-format.test.ts` and 040's file. This one is about where the two ends are.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatGrouped, type FindInFilesPanelConfig, type ResultRow } from '@throng/core';
import {
  findInFilesConfigOf,
  findInFilesQueryFrom,
  type FindInFilesQuery,
} from '../../src/renderer/find-in-files/panel-config.js';
import {
  applyFileSearchUpdate,
  NO_FILE_SEARCH_RESULTS,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import { targetsFor } from '../../src/renderer/find-in-files/commit-replace.js';

/**
 * Large enough that every locale below actually groups it — some group four digits and some do not,
 * so a four-figure probe would prove nothing in half of them.
 */
const BIG = 1234567;

/**
 * The separators `Intl` actually uses, derived rather than typed.
 *
 * Comma, full stop, and the space family — `fr-FR`'s narrow no-break space is the one a careless
 * `split(',')` leaves intact and is invisible in a diff, so it is read out of `Intl` instead of
 * being written down.
 */
const SEPARATORS: string[] = [
  ...new Set(
    ['en-US', 'de-DE', 'fr-FR', 'en-IN', 'sv-SE', 'ru-RU'].map(
      (locale) =>
        new Intl.NumberFormat(locale, { useGrouping: true })
          .formatToParts(BIG)
          .find((p) => p.type === 'group')?.value ?? '',
    ),
  ),
].filter((s) => s.length > 0);

/** A string shaped like a grouped number: 1–3 digits, then one or more separated triples. */
const GROUPED_SHAPE = new RegExp(
  `^[+-]?\\d{1,3}(?:[${SEPARATORS.map((s) => `\\u{${s.codePointAt(0)?.toString(16)}}`).join('')}]\\d{3})+$`,
  'u',
);

/** Every string anywhere inside `value` that reads as a grouped number, with the path that holds it. */
function groupedStringsIn(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return GROUPED_SHAPE.test(value) ? [`${path} = ${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => groupedStringsIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => groupedStringsIn(v, `${path}.${k}`));
  }
  return [];
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The persisted query (FR-027a) — it holds no number at all
 * ────────────────────────────────────────────────────────────────────────── */

const QUERY: FindInFilesQuery = {
  term: 'needle',
  modes: { caseSensitive: true, wholeWord: false },
  scopeSubPath: 'src/renderer',
  replaceEnabled: true,
  replacement: 'thread',
};

describe('a persisted FindInFilesPanelConfig carries no grouped figure (FR-014, FR-027a)', () => {
  it('holds no number at all, which is what makes the separator unreachable', () => {
    /*
     * The strongest form the requirement can take here, and it is true by construction rather than
     * by care: the persisted query is a term, two flags, a sub-path, a disclosure flag and a
     * replacement. There is no quantity to group, so there is no call site that could group one.
     *
     * Asserted over the VALUES rather than by reading the type, because the type is erased at run
     * time and the defect this guards against is a number added to the write path later.
     */
    const config = findInFilesConfigOf(QUERY);
    const numeric = Object.entries(config).filter(([, v]) => typeof v === 'number');
    expect(
      numeric,
      'a quantity has been added to the persisted query — it must be written raw, and this ' +
        'assertion re-stated to say so (FR-014)',
    ).toEqual([]);
  });

  it('writes exactly the six fields FR-027a names, so a seventh has to be argued for', () => {
    // `updatePanelConfig` MERGES, so the write states every field always. The key set is therefore
    // a closed list, and pinning it is what makes the assertion above exhaustive rather than
    // incidental.
    expect(Object.keys(findInFilesConfigOf(QUERY)).sort()).toEqual([
      'caseSensitive',
      'replaceShown',
      'replacement',
      'scopeSubPath',
      'term',
      'wholeWord',
    ]);
  });

  it('contains no value shaped like a grouped number, even in its strings', () => {
    /*
     * The other way a separator could arrive: not as a formatted quantity but as a string field
     * that was rendered before it was stored. A search term legitimately CAN look like `1,234` —
     * the user typed it — so this probes the config built from a query whose strings do not, which
     * is what makes a hit here a leak rather than a false positive.
     */
    expect(groupedStringsIn(findInFilesConfigOf(QUERY))).toEqual([]);
  });

  it('round-trips through the restore path unchanged', () => {
    // The inverse pair, in one assertion: whatever is written is what comes back. A formatter on
    // either side would show up here as a value that no longer equals the one that went in.
    expect(findInFilesQueryFrom(findInFilesConfigOf(QUERY))).toEqual(QUERY);

    // And the `''` ↔ `null` mapping the module exists to perform survives it too.
    const cleared: FindInFilesQuery = { ...QUERY, scopeSubPath: '' };
    const written: FindInFilesPanelConfig = findInFilesConfigOf(cleared);
    expect(written.scopeSubPath).toBeNull();
    expect(findInFilesQueryFrom(written)).toEqual(cleared);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FileSearchUpdate — the payload main pushes across the process boundary
 * ────────────────────────────────────────────────────────────────────────── */

describe('a FileSearchUpdate carries raw numbers across the boundary (FR-014)', () => {
  it('folds the counts as numbers, at a magnitude every locale groups', () => {
    /*
     * `applyFileSearchUpdate` is the renderer's whole consumption of the channel — the fold every
     * batch goes through — so what it holds afterwards IS what the panel renders from. If a
     * separator had been applied at either end it would arrive here as a string, and the four
     * `typeof` assertions are the only place that is visible: `'1,234,567'` renders perfectly well.
     */
    const folded = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, {
      panelId: 'p1',
      generation: 1,
      status: 'complete',
      rows: [],
      totalMatches: BIG,
      filesScanned: BIG,
      skipped: BIG,
    });

    expect(typeof folded.totalMatches).toBe('number');
    expect(typeof folded.filesScanned).toBe('number');
    expect(typeof folded.skipped).toBe('number');
    expect(typeof folded.generation).toBe('number');
    expect(folded.totalMatches).toBe(BIG);
    expect(folded.filesScanned).toBe(BIG);
    expect(folded.skipped).toBe(BIG);
  });

  it('leaves every position on every row raw', () => {
    // A row's four numbers are the ones a commit later writes AT, so a grouped one is not merely
    // ugly — it is an offset. They cross the boundary in the same payload as the counts.
    const row: ResultRow = {
      relPath: 'src/big.ts',
      line: BIG,
      column: 4096,
      from: BIG,
      to: BIG + 6,
      snippet: {
        before: '',
        matched: 'needle',
        after: '',
        truncatedStart: false,
        truncatedEnd: false,
      },
    };
    const folded = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, {
      panelId: 'p1',
      generation: 1,
      status: 'complete',
      rows: [row],
      totalMatches: 1,
    });

    const held = folded.rows[0]!;
    for (const field of ['line', 'column', 'from', 'to'] as const) {
      expect(typeof held[field], `${field} crossed as ${typeof held[field]}`).toBe('number');
    }
    expect(groupedStringsIn(folded.rows)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * CommitRequest — the one payload in the feature that WRITES
 * ────────────────────────────────────────────────────────────────────────── */

describe('a CommitRequest carries raw offsets (FR-014, FR-049)', () => {
  const rows: ResultRow[] = [BIG, BIG + 100].map((from) => ({
    relPath: 'src/big.ts',
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
  }));

  it('builds every edit from integers, never from a rendered figure', () => {
    /*
     * `targetsFor` is the whole of "which matches did this granularity select", and its output IS
     * `CommitRequest.targets`. The stakes are higher than anywhere else in this file: main's parser
     * refuses an offset that is not an integer, so a grouped `from` does not corrupt a write — it
     * silently becomes NO write, and the user is told the replace succeeded for the file while one
     * of its matches was never attempted.
     */
    const targets = targetsFor(rows);
    expect(targets).toHaveLength(1);
    for (const edit of targets[0]!.edits) {
      expect(Number.isInteger(edit.from), `from was ${String(edit.from)}`).toBe(true);
      expect(Number.isInteger(edit.to), `to was ${String(edit.to)}`).toBe(true);
    }
    expect(targets[0]!.edits).toEqual([
      { from: BIG, to: BIG + 6 },
      { from: BIG + 100, to: BIG + 106 },
    ]);
  });

  it('holds nothing shaped like a grouped number anywhere in the payload', () => {
    // The whole commit payload, walked — including the strings, because `relPath` is the one field
    // a formatter could plausibly have been applied to on the way past.
    const payload = {
      panelId: 'p1',
      projectRoot: 'D:/proj',
      term: 'needle',
      modes: { caseSensitive: false, wholeWord: false },
      replacement: 'thread',
      targets: targetsFor(rows),
      confirmedIrreversible: true,
    };
    expect(groupedStringsIn(payload)).toEqual([]);
  });

  it('and the formatter really would have produced one, in every locale', () => {
    // The control for the three assertions above: they are only meaningful while `BIG` is a value
    // the formatter changes. If a future locale-neutral formatter left it alone, the absences above
    // would pass for the wrong reason, and this is what would fail instead.
    for (const locale of ['en-US', 'de-DE', 'fr-FR']) {
      const rendered = formatGrouped(BIG, locale);
      expect(rendered, `${locale} did not group ${BIG}`).not.toBe(String(BIG));
      expect(GROUPED_SHAPE.test(rendered), `${locale}: ${rendered}`).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The sweep — the formatter never appears on the transport or persistence path
 * ────────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx|cts)$/.test(entry)) {
        out.push({ file: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) {
    const src = join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

/** Repo-relative and forward-slashed, so a failure message names a path a reader can open. */
const relative = (file: string): string => file.slice(REPO_ROOT.length).replace(/\\/g, '/');

/** Files that CALL `name` — a call, not a mention: a comment or a re-export is not a caller. */
function callersOf(name: string): string[] {
  const call = new RegExp(`(?<![\\w.])${name}\\s*\\(`);
  return productionSources()
    .filter(({ file }) => !relative(file).endsWith('config/number-format.ts'))
    .filter(({ text }) => call.test(text))
    .map(({ file }) => relative(file));
}

describe('the formatter never runs on the transport or persistence path (FR-014)', () => {
  it('is called from no module in the UI main process', () => {
    /*
     * Main is the far side of the boundary: it produces every `FileSearchUpdate`, parses every
     * `CommitRequest`, and writes the files. Nothing there has a screen to render to, so a call to
     * a DISPLAY formatter from that side could only be a value on its way into a payload.
     *
     * Stated as a sweep over the whole of `src/main` rather than over the two file-search modules,
     * because the next producer of a quantity will be a module this test has never heard of.
     */
    const inMain = callersOf('formatGrouped').filter((f) =>
      f.startsWith('packages/ui/src/main/'),
    );
    expect(
      inMain,
      `${inMain.join(', ')} formats a number in the main process. Grouping is a view concern: ` +
        'a formatted figure there is one that has crossed, or is about to cross, a process boundary.',
    ).toEqual([]);
  });

  it('is called from no Find in Files module that persists or transports', () => {
    /*
     * The renderer half. Of this feature's nine modules, exactly two render — the panel and the
     * results list — plus `commit-replace.ts`, which formats into the confirmation's message and
     * the outcome notice's and into nothing else (its payload is built by `targetsFor`, asserted
     * above). Every other module here writes the layout blob, routes an open, or builds a menu, and
     * none of them has a figure to show.
     */
    const persisting = [
      'panel-config.ts',
      'find-in-files-store.ts',
      'open-find-in-files.ts',
      'result-open.ts',
      'last-active-find-in-files.ts',
      'content-menu.ts',
      'find-in-files-chrome.tsx',
    ];
    const callers = callersOf('formatGrouped');
    for (const module of persisting) {
      expect(
        callers.filter((f) => f.endsWith(`find-in-files/${module}`)),
        `${module} formats a quantity, and it neither renders one nor may store one`,
      ).toEqual([]);
    }
  });

  it('reads no displayed figure back — nothing on this path parses one', () => {
    /*
     * The inverse direction. `parseGrouped` turning a rendered string back into a number is legal
     * in exactly one place — the preferences numeric control, where the user typed it — and 040's
     * `grouping-view-only-040.test.ts` pins that exhaustively for the whole repository. What is
     * asserted here is only 043's part of it: no module of this feature, and nothing in main, reads
     * a figure back. A result count is not an input.
     */
    const callers = callersOf('parseGrouped');
    const offenders = callers.filter(
      (f) => f.startsWith('packages/ui/src/main/') || f.includes('/renderer/find-in-files/'),
    );
    expect(offenders, `${offenders.join(', ')} parses a displayed figure back`).toEqual([]);
  });
});
