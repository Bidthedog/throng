/**
 * 043 T093/T095/T098 — the three commit granularities, the irreversible-commit warning, and the
 * ONE notice (FR-049, FR-050, FR-057b, FR-057c, FR-057d, FR-058, FR-014).
 *
 * ══ WHAT THIS TIER OWNS AND WHAT IT DOES NOT ══
 *
 * The WRITE is `replace-commit.integration.test.ts`'s, against a real filesystem and a real document
 * authority. What lives here is everything between the user and that call: which matches each of the
 * three granularities selects, that the file count reaches the user digit-grouped before anything is
 * written, and that a finished commit produces one notice rather than one per array.
 *
 * The stubbed `commit` is the contract boundary, not a convenience: `throng:fileSearch:commit`
 * decides the confirmation (contract rule 2, because only main can compute the partition), so the
 * panel's whole job is to ask, obey, and re-ask once confirmed — which is exactly what a recorded
 * call log can prove and a real main process could only obscure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  PROJECT_ROOT,
  committedEverything,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let stub: FileSearchStub;

/** Two matches in one file, one in another — so "this match", "this file" and "all" all differ. */
const ROWS = [
  resultRow('src/a.ts', 1, 6),
  resultRow('src/a.ts', 4, 80),
  resultRow('src/b.ts', 2, 40),
];

/**
 * Everything asked for landed — and `applied` names WHICH edits, because that is what main answers
 * and what the panel's FR-051 marking is built from (#378).
 */
const ok = (payload: unknown): unknown => committedEverything(payload);

interface CommitCall {
  panelId: string;
  projectRoot: string;
  term: string;
  replacement: string;
  confirmedIrreversible: boolean;
  targets: { relPath: string; edits: { from: number; to: number }[] }[];
}

function callsTo(): CommitCall[] {
  return stub.commit.mock.calls.map((c) => c[0] as CommitCall);
}

beforeEach(() => {
  __resetFindInFilesState();
  stub = installFileSearchStub();
  stub.commit.mockImplementation(async (payload: unknown) => ok(payload));
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render, search, deliver rows, disclose replace and type a replacement. */
async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderFindInFilesPanel();
  await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
  stub.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', rows: ROWS, totalMatches: 3 });
  await user.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
  await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), 'thread');
  return user;
}

/** Right-click a row (which is what names the match and the file) and pick a menu item. */
async function commitVia(
  user: ReturnType<typeof userEvent.setup>,
  rowTestId: string,
  item: 'Replace All' | 'Replace in File' | 'Replace Match',
): Promise<void> {
  await user.pointer({ target: screen.getByTestId(rowTestId), keys: '[MouseRight]' });
  await user.click(screen.getByTestId(`menu-item-${item}`));
}

describe('T093 — the three granularities are distinct, deliberate actions (FR-049)', () => {
  it('Replace Match commits exactly the one match under the cursor', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace Match');

    expect(callsTo()).toHaveLength(1);
    expect(callsTo()[0]?.targets).toEqual([{ relPath: 'src/a.ts', edits: [{ from: 6, to: 12 }] }]);
  });

  it('Replace in File commits every match in that file and no other file', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace in File');

    expect(callsTo()[0]?.targets).toEqual([
      { relPath: 'src/a.ts', edits: [{ from: 6, to: 12 }, { from: 80, to: 86 }] },
    ]);
  });

  it('Replace All commits every listed match, in every file', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');

    expect(callsTo()[0]?.targets).toEqual([
      { relPath: 'src/a.ts', edits: [{ from: 6, to: 12 }, { from: 80, to: 86 }] },
      { relPath: 'src/b.ts', edits: [{ from: 40, to: 46 }] },
    ]);
  });

  it('carries the panel’s term, replacement and project root — never a guess (contract)', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/b.ts-40', 'Replace Match');

    const call = callsTo()[0];
    expect(call?.panelId).toBe(PANEL_ID);
    expect(call?.projectRoot).toBe(PROJECT_ROOT);
    expect(call?.term).toBe('needle');
    expect(call?.replacement).toBe('thread');
    // The renderer never asserts the answer to the confirmation question; main decides it.
    expect(call?.confirmedIrreversible).toBe(false);
  });

  it('the commit rows are drawn LIVE only while replace is disclosed (FR-046)', async () => {
    const user = userEvent.setup();
    renderFindInFilesPanel();
    await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
    stub.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', rows: ROWS, totalMatches: 3 });

    await user.pointer({ target: screen.getByTestId('fif-row-src/a.ts-6'), keys: '[MouseRight]' });
    // A menu row is a `li`, so `aria-disabled` is what carries the state — not the `disabled`
    // attribute, which only a form control has.
    expect(screen.getByTestId('menu-item-Replace All')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('menu-item-Replace All'));
    expect(stub.commit).not.toHaveBeenCalled();
  });
});

describe('T093 — FR-050: a skipped match stays a pending preview', () => {
  it('committing one match leaves the other two listed and unmarked', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace Match');

    expect(screen.getByTestId('fif-row-src/a.ts-6')).toHaveAttribute('data-committed', 'true');
    // Skipped, not gone: still listed, still a preview.
    expect(screen.getByTestId('fif-row-src/a.ts-80')).not.toHaveAttribute('data-committed');
    expect(screen.getByTestId('fif-row-src/b.ts-40')).not.toHaveAttribute('data-committed');
    /*
     * TWO previews, and that number is FR-083a rather than a weakening of FR-050.
     *
     * This read `toHaveLength(3)` when every row was a preview whatever its state — FR-047's word
     * "every", written before a row could be anything but pending. FR-083a withdraws it for exactly
     * one row: the one that has been committed now shows the new text plainly, because a proposal
     * that has happened is not a proposal. The two rows this test is actually about — the skipped
     * match on the same file, and the untouched one in another — are still previews, which is
     * FR-050 unchanged and is what the count now says.
     */
    expect(screen.getAllByTestId('fif-replacement')).toHaveLength(2);
    expect(screen.getByTestId('fif-row-src/a.ts-6').querySelector('[data-testid="fif-replacement"]'))
      .toBeNull();
  });

  it('stepping on, a second granularity commits the rest without re-committing the first', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace Match');
    await commitVia(user, 'fif-row-src/b.ts-40', 'Replace Match');

    expect(callsTo()).toHaveLength(2);
    expect(callsTo()[1]?.targets).toEqual([{ relPath: 'src/b.ts', edits: [{ from: 40, to: 46 }] }]);
  });
});

describe('T095 — the irreversible-commit warning (FR-057b, FR-057c, FR-057d, FR-014)', () => {
  const NEEDS = { committed: false, reason: 'needsConfirmation', unopenedFileCount: 1234 };

  it('states the file count DIGIT-GROUPED and writes nothing until confirmed (FR-057b, FR-014)', async () => {
    // Only the FIRST answer is overridden; the re-ask falls through to the committing default.
    stub.commit.mockResolvedValueOnce(NEEDS);
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('1,234');
    // One call so far — the ASK. Nothing has been written, and the panel has not re-asked.
    expect(callsTo()).toHaveLength(1);
    expect(callsTo()[0]?.confirmedIrreversible).toBe(false);
  });

  it('cancelling writes nothing at all', async () => {
    // Only the FIRST answer is overridden; the re-ask falls through to the committing default.
    stub.commit.mockResolvedValueOnce(NEEDS);
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');
    await user.click(await screen.findByTestId('confirm-cancel'));

    expect(callsTo()).toHaveLength(1);
    expect(screen.getByTestId('fif-row-src/a.ts-6')).not.toHaveAttribute('data-committed');
  });

  it('confirming re-asks ONCE, with the same targets and the confirmation carried', async () => {
    // Only the FIRST answer is overridden; the re-ask falls through to the committing default.
    stub.commit.mockResolvedValueOnce(NEEDS);
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');
    await user.click(await screen.findByTestId('confirm-accept'));

    expect(callsTo()).toHaveLength(2);
    expect(callsTo()[1]?.confirmedIrreversible).toBe(true);
    expect(callsTo()[1]?.targets).toEqual(callsTo()[0]?.targets);
  });

  it('no warning appears when main does not ask for one — every file open (FR-057d)', async () => {
    // FR-057d is decided in main, which simply commits. The panel's half of it is that it invents
    // no confirmation of its own.
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(callsTo()).toHaveLength(1);
  });

  it('with the preference off the commit proceeds unasked (FR-057c)', async () => {
    // Identical from here: `warnIrreversibleCommit: false` makes main skip the gate, so the panel
    // sees a committed result on the first call.
    const user = await ready();
    await commitVia(user, 'fif-row-src/b.ts-40', 'Replace All');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('the decision buttons carry TEXT labels, under the themeable-icon exception', async () => {
    // Only the FIRST answer is overridden; the re-ask falls through to the committing default.
    stub.commit.mockResolvedValueOnce(NEEDS);
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');

    expect((await screen.findByTestId('confirm-accept')).textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.getByTestId('confirm-cancel').textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

describe('T098 — the outcome is reported ONCE (FR-058)', () => {
  it('one notice carries the changed, the refused and the failed together', async () => {
    stub.commit.mockResolvedValue({
      committed: true,
      outcome: {
        changedInBuffer: ['src/a.ts'],
        changedOnDisk: ['src/b.ts'],
        refused: [{ relPath: 'src/c.ts', reason: 'matchGone' }],
        failed: [{ relPath: 'src/d.ts', reason: 'readOnly' }],
        // Named files rather than edits, so nothing is marked — this test is about the NOTICE.
        applied: [],
      },
    });
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');

    // ONE card. Four notices for one condition is spec 032's defect, and this is the guard.
    const notices = await screen.findAllByTestId('fif-commit-outcome');
    expect(notices).toHaveLength(1);
    const text = notices[0]?.textContent ?? '';
    for (const named of ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']) {
      expect(text).toContain(named);
    }
  });

  it('a wholly successful commit still says so, once', async () => {
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');
    expect(await screen.findAllByTestId('fif-commit-outcome')).toHaveLength(1);
  });

  it('a commit the user cancelled reports nothing — there is no outcome to report', async () => {
    stub.commit.mockResolvedValueOnce({
      committed: false,
      reason: 'needsConfirmation',
      unopenedFileCount: 2,
    });
    const user = await ready();
    await commitVia(user, 'fif-row-src/a.ts-6', 'Replace All');
    await user.click(await screen.findByTestId('confirm-cancel'));
    expect(screen.queryByTestId('fif-commit-outcome')).toBeNull();
  });
});
