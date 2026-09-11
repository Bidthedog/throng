/**
 * 043 review — a commit writes to the file the user NAMED, and a commit that fails says so.
 *
 * ══ 1. THE NARROW GRANULARITIES AIM AT THE ROW UNDER THE POINTER ══
 *
 * `Replace in File` and `Replace Match` (FR-049) are relative to the reading position, and a
 * right-click on a match row moves that position before the menu is built. Only a match row does:
 * a group HEADING, the toolbar, the scope field, the status line and the empty area under the last
 * row all bubble to the panel's own handler, which read the position UNCHANGED — so a menu opened
 * over `b.ts` could commit into `a.ts` because that is where the pointer had been some clicks ago.
 *
 * The label made it unrecoverable rather than merely wrong: `Replace in File` names no file, so
 * nothing on screen said which one the write was aimed at. Both halves are asserted here — the
 * position is cleared when the menu was not opened from a row, and the label names its target when
 * it was.
 *
 * The same staleness survived a RE-RUN: the position kept a row from the previous result set, so
 * `Replace Match` would send an offset from an abandoned search into a file whose text had moved.
 *
 * ══ 2. A FAILED COMMIT REPORTS SOMETHING ══
 *
 * `throng:fileSearch:commit` surfaces anything `ReplaceCommitService` throws as a REJECTED invoke,
 * and the call site is `void commitReplace(...)`. Unhandled, that is no notice, no dialog and no
 * visible change: the user chose Replace All and the panel did nothing. An unrecognised RESULT
 * shape fell through the `committed` check just as quietly.
 *
 * One condition, one notice (CLAUDE.md): the failure reuses the commit's own card rather than
 * raising a second surface beside the successful outcome's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  committedEverything,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let stub: FileSearchStub;

/** Two matches in one file and one in another, so the three granularities all differ. */
const ROWS = [
  resultRow('src/a.ts', 1, 6),
  resultRow('src/a.ts', 4, 80),
  resultRow('src/b.ts', 2, 40),
];

beforeEach(() => {
  __resetFindInFilesState();
  stub = installFileSearchStub();
  // Everything asked for landed, named edit by edit — which is what main really answers (#378).
  stub.commit.mockImplementation(async (payload: unknown) => committedEverything(payload));
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

const rightClick = async (
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
): Promise<void> => {
  await user.pointer({ target: screen.getByTestId(testId), keys: '[MouseRight]' });
};

const labelOf = (item: string): string =>
  screen.getByTestId(`menu-item-${item}`).querySelector('.context-menu__label')?.textContent ?? '';

/* ────────────────────────────────────────────────────────────────────────── *
 * 1 — the position is the row that was pointed at, or nothing
 * ────────────────────────────────────────────────────────────────────────── */

describe('a narrow granularity aims at the row the menu was opened from (FR-049)', () => {
  it('is offered no target when the menu is opened from a group HEADING', async () => {
    const user = await ready();

    // Point at a match in a.ts, then dismiss without choosing anything.
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');

    // …and now open the menu over b.ts's heading, which names a different file entirely.
    await rightClick(user, 'fif-group-header-src/b.ts');

    expect(screen.getByTestId('menu-item-Replace in File')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByTestId('menu-item-Replace Match')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('menu-item-Replace in File'));
    expect(stub.commit).not.toHaveBeenCalled();
  });

  it('is offered no target when the menu is opened from the toolbar', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');

    await rightClick(user, `fif-term-${PANEL_ID}`);

    expect(screen.getByTestId('menu-item-Replace in File')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByTestId('menu-item-Replace in File'));
    expect(stub.commit).not.toHaveBeenCalled();
  });

  it('forgets the position when the search is re-run — those offsets describe an abandoned scan', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');

    stub.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 900)],
      totalMatches: 1,
    });
    await rightClick(user, `fif-status-${PANEL_ID}`);

    expect(screen.getByTestId('menu-item-Replace Match')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('menu-item-Replace Match'));
    expect(stub.commit).not.toHaveBeenCalled();
  });

  it('still aims at the row when the menu WAS opened from one', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/b.ts-40');
    await user.click(screen.getByTestId('menu-item-Replace in File'));

    expect(stub.commit.mock.calls[0]?.[0]).toMatchObject({
      targets: [{ relPath: 'src/b.ts', edits: [{ from: 40, to: 46 }] }],
    });
  });
});

describe('the label names the file the write is aimed at', () => {
  it('names the pointed-at file rather than saying "File"', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    expect(labelOf('Replace in File')).toBe('Replace in src/a.ts');

    await user.keyboard('{Escape}');
    await rightClick(user, 'fif-row-src/b.ts-40');
    expect(labelOf('Replace in File')).toBe('Replace in src/b.ts');
  });

  it('names it on the one-match row too, which is aimed at a file just as squarely', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-80');
    /*
     * The FILE, not the match's line. A line number is a displayed quantity and would have to come
     * through `formatGrouped`, which `find-in-files-grouping-view-only.test.ts` forbids in a menu
     * builder — and which match is already answered by the row carrying `aria-current`.
     */
    expect(labelOf('Replace Match')).toBe('Replace Match in src/a.ts');
  });

  it('falls back to the bare label when there is no target to name', async () => {
    const user = await ready();
    await rightClick(user, `fif-term-${PANEL_ID}`);
    expect(labelOf('Replace in File')).toBe('Replace in File');
    expect(labelOf('Replace Match')).toBe('Replace Match');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 2 — a commit that fails is reported
 * ────────────────────────────────────────────────────────────────────────── */

describe('a commit that cannot be carried out says so (FR-058)', () => {
  const commitAll = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.click(screen.getByTestId('menu-item-Replace All'));
  };

  it('reports a rejected commit instead of doing nothing visible at all', async () => {
    stub.commit.mockRejectedValue(new Error('EPERM: operation not permitted'));
    const user = await ready();
    await commitAll(user);

    const notices = await screen.findAllByTestId('fif-commit-outcome');
    // ONE card, and the same one a successful commit uses: one condition, one surface.
    expect(notices).toHaveLength(1);
    expect(notices[0]?.className).toContain('notice--error');
    expect(notices[0]?.textContent ?? '').toContain('EPERM');
  });

  it('reports an answer whose shape it does not recognise', async () => {
    // A channel that changed under the renderer answers this way, and it used to fall straight
    // through the `committed` check — no notice, no marking, no visible change.
    stub.commit.mockResolvedValue({ status: 'ok' });
    const user = await ready();
    await commitAll(user);

    const notices = await screen.findAllByTestId('fif-commit-outcome');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.className).toContain('notice--error');
  });

  it('reports a rejection of the CONFIRMED re-ask as well', async () => {
    stub.commit
      .mockResolvedValueOnce({ committed: false, reason: 'needsConfirmation', unopenedFileCount: 2 })
      .mockRejectedValue(new Error('EBUSY: resource busy'));
    const user = await ready();
    await commitAll(user);
    await user.click(await screen.findByTestId('confirm-accept'));

    const notices = await screen.findAllByTestId('fif-commit-outcome');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent ?? '').toContain('EBUSY');
  });

  it('still says nothing when the user cancelled — there is no outcome to report', async () => {
    stub.commit.mockResolvedValue({
      committed: false,
      reason: 'needsConfirmation',
      unopenedFileCount: 2,
    });
    const user = await ready();
    await commitAll(user);
    await user.click(await screen.findByTestId('confirm-cancel'));

    expect(screen.queryByTestId('fif-commit-outcome')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 3 — 043 T233 (Constitution VI, FR-049, FR-050, FR-084): a narrow commit row with nothing left to do
 *     is drawn DISABLED
 *
 * FR-084 made Replace All disable itself once nothing listed was pending. Its two narrow siblings
 * were left wired whenever a row was pointed at, and the consequences were not symmetrical:
 *
 *   - Replace in File, on a file whose rows were all committed, sent an empty list and
 *     `commitReplace` returned without doing or saying anything — the inert live control FR-084 was
 *     written to remove.
 *   - Replace Match, on an ALREADY-COMMITTED row, was not filtered to pending rows at all. It
 *     re-sent the committed offset, and when the replacement contains the term (`foo` → `fooBar`)
 *     main's re-check found the offset still "held" and wrote a second time. The file ended
 *     `fooBarBar`, and the panel's record of its own writes stopped matching the file for every row
 *     after it.
 *
 * The second is the one that corrupts data. It is caught here at the panel, by asserting that no
 * second commit is SENT — which holds for any replacement, including this harness's `thread`, where
 * main's re-check would happen to refuse the second write. Stopping it at the source is the fix;
 * relying on main to refuse a write the panel should never have asked for is how it corrupted data.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a narrow commit row with nothing pending is drawn disabled (T233)', () => {
  /** Commit ONE row through Replace Match, and wait until the commit has been answered. */
  async function commitMatch(user: ReturnType<typeof userEvent.setup>, rowTestId: string): Promise<void> {
    await rightClick(user, rowTestId);
    await user.click(screen.getByTestId('menu-item-Replace Match'));
    await screen.findAllByTestId('fif-commit-outcome');
  }

  it('Replace Match is disabled on a row that has already been committed', async () => {
    const user = await ready();
    await commitMatch(user, 'fif-row-src/b.ts-40');

    await rightClick(user, 'fif-row-src/b.ts-40');

    expect(screen.getByTestId('menu-item-Replace Match')).toHaveAttribute('aria-disabled', 'true');
  });

  it('and clicking it sends NOTHING — the second write that corrupted the file', async () => {
    const user = await ready();
    await commitMatch(user, 'fif-row-src/b.ts-40');
    expect(stub.commit).toHaveBeenCalledTimes(1);

    await rightClick(user, 'fif-row-src/b.ts-40');
    await user.click(screen.getByTestId('menu-item-Replace Match'));

    expect(stub.commit).toHaveBeenCalledTimes(1);
  });

  it('Replace in File is disabled once every row in THAT file has been committed', async () => {
    const user = await ready();
    await commitMatch(user, 'fif-row-src/b.ts-40');

    await rightClick(user, 'fif-row-src/b.ts-40');

    expect(screen.getByTestId('menu-item-Replace in File')).toHaveAttribute('aria-disabled', 'true');
    // Still NAMED: a greyed row that says which file it is about tells the user why it is greyed.
    expect(labelOf('Replace in File')).toBe('Replace in src/b.ts');
  });

  it('stays LIVE for a file with a match still pending, and for a pending row beside a committed one', async () => {
    // The guard is per row and per file, not per panel: a.ts has two matches, and committing one
    // leaves the other — and the file — with something to do.
    const user = await ready();
    await commitMatch(user, 'fif-row-src/a.ts-6');

    await rightClick(user, 'fif-row-src/a.ts-80');

    expect(screen.getByTestId('menu-item-Replace Match')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('menu-item-Replace in File')).toHaveAttribute('aria-disabled', 'false');

    await user.keyboard('{Escape}');
    await rightClick(user, 'fif-row-src/a.ts-6');
    // The committed row itself: nothing to do for the MATCH, but its file still has a match pending.
    expect(screen.getByTestId('menu-item-Replace Match')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Replace in File')).toHaveAttribute('aria-disabled', 'false');
  });
});
