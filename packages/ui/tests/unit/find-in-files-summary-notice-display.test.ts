/**
 * 043 T205 / FR-082 — the replace summary notice carries ITS OWN display, on every outcome.
 *
 * ══ THE REQUIREMENT, AND THE PART OF IT THAT IS EASY TO HALF-BUILD ══
 *
 * FR-082 is emphatic that these two settings govern **all three outcomes — success, warning and
 * error alike — and that for this one notice the global `notifications.*` settings are not consulted
 * at all.** That is the maintainer's decision with its cost recorded: a user whose global preference
 * is that errors stay until dismissed does not get that behaviour here.
 *
 * The half-built version passes a plausible-looking test: attach the override on the success path,
 * where a summary usually lands, and leave the error path resolving from `notifications.error`. So
 * every outcome is driven separately below, and the SEVERITY is asserted beside the display each
 * time — because the other way to get this wrong is to make the notice uniform, and the severity is
 * still computed per outcome. It decides the colour, the icon and the log level; only the display
 * resolution moves.
 *
 * The fourth case is the one that is not an outcome at all: the channel rejecting. It reports through
 * the same card, deliberately (`commit-replace.ts`: "The same card as a completed commit… one
 * condition, one surface"), so it is the same notice and takes the same override. A commit that could
 * not be carried out AT ALL is exactly the report a user must not silently lose.
 *
 * ══ WHY UNIT ══
 *
 * `commitReplace` takes `notify` as an argument precisely so a caller at this tier can read the
 * notice it raises. Nothing here needs a DOM: the claim is about which fields the raise carries.
 * Whether the provider then honours the field is `notice-display-override.test.ts`'s claim at the
 * component tier, and whether the panel reads the right settings keys is
 * `settings-inertness-043.test.ts`'s.
 *
 * ══ ANTI-VACUITY ══
 *
 * The display asserted is NOT the shipped default. `{ mode: 'timed', timeoutMs: 7000 }` matches no
 * `notifications.*` default and no `search.inFiles` default, so a notice that fell back to any global
 * — or to the shipped pair — fails rather than coincidentally passing.
 */
import { describe, expect, it } from 'vitest';
import type { ResultRow, SeverityNotificationSettings } from '@throng/core';
import type { NoticeInput } from '../../src/renderer/common/notification.js';
import {
  commitReplace,
  COMMIT_NOTICE_TEST_ID,
  type CommitReplaceRequest,
} from '../../src/renderer/find-in-files/commit-replace.js';

/** Deliberately equal to no default anywhere in the application — see ANTI-VACUITY above. */
const DISPLAY: SeverityNotificationSettings = { mode: 'timed', timeoutMs: 7000 };

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

interface Outcome {
  changedInBuffer?: string[];
  changedOnDisk?: string[];
  refused?: { relPath: string; reason: 'matchGone' }[];
  failed?: { relPath: string; reason: string }[];
}

/** Drive a commit to completion over `outcome`, and hand back the one notice it raised. */
async function noticeFor(outcome: Outcome): Promise<NoticeInput> {
  let raised: NoticeInput | undefined;
  await commitReplace(REQUEST, {
    confirm: async () => true,
    notify: (notice) => {
      raised = notice;
    },
    display: DISPLAY,
    invoke: async () => ({
      committed: true,
      outcome: {
        changedInBuffer: outcome.changedInBuffer ?? [],
        changedOnDisk: outcome.changedOnDisk ?? [],
        refused: outcome.refused ?? [],
        failed: outcome.failed ?? [],
        applied: [],
      },
    }),
  });
  if (!raised) throw new Error('the commit reported no outcome');
  return raised;
}

describe('the replace summary notice answers to its own display setting (FR-082)', () => {
  it('carries it on a SUCCESS — every file changed', async () => {
    const notice = await noticeFor({ changedOnDisk: ['a.ts', 'b.ts'] });

    expect(notice.severity, 'the severity is still computed per outcome').toBe('success');
    expect(notice.display).toEqual(DISPLAY);
  });

  it('carries it on a WARNING — a match had gone, so some files were refused', async () => {
    const notice = await noticeFor({
      changedOnDisk: ['a.ts'],
      refused: [{ relPath: 'b.ts', reason: 'matchGone' }],
    });

    expect(notice.severity).toBe('warning');
    expect(
      notice.display,
      'a partly-refused commit fell back to notifications.warning — FR-082 says this notice never consults it',
    ).toEqual(DISPLAY);
  });

  it('carries it on an ERROR — a file could not be written', async () => {
    const notice = await noticeFor({
      changedOnDisk: ['a.ts'],
      failed: [{ relPath: 'b.ts', reason: 'readOnly' }],
    });

    expect(notice.severity).toBe('error');
    expect(
      notice.display,
      'a failed commit fell back to notifications.error — the case FR-082 states the cost of by name',
    ).toEqual(DISPLAY);
  });

  it('carries it when the commit could not be carried out at all', async () => {
    // Not one of the three outcomes: the channel rejected, so there is no outcome to read. It reports
    // through the SAME card by design, so it is the same notice and takes the same display.
    let raised: NoticeInput | undefined;
    await commitReplace(REQUEST, {
      confirm: async () => true,
      notify: (notice) => {
        raised = notice;
      },
      display: DISPLAY,
      invoke: async () => {
        throw new Error('EPERM: operation not permitted');
      },
    });

    expect(raised?.severity).toBe('error');
    expect(raised?.testId, 'one condition, one surface').toBe(COMMIT_NOTICE_TEST_ID);
    expect(raised?.display).toEqual(DISPLAY);
  });
});
