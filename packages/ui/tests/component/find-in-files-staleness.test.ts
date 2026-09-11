/**
 * 043 T079 — a stale marking is INFORMATIONAL, and that is the whole assertion (FR-045a, FR-045b,
 * US3 scenarios 14 and 15).
 *
 * ══ WHY THE NEGATIVE CLAIMS ARE THE POINT ══
 *
 * "That file's group is marked stale" is the easy half and would be satisfied by a panel that also
 * greyed the rows out, dropped them to the bottom, or refused to open them. FR-045b rules all three
 * out in as many words: nothing is disabled, hidden, greyed or reordered, and every row still opens
 * and still acts. Those are four separate ways to breach one requirement, so they are asserted
 * separately — a single "the rows are still there" would pass while three of them were broken.
 *
 * `data-stale` on the GROUP header and nothing on the row is the shape that makes it true by
 * construction, and asserting the row carries no marking of its own is what keeps it that way.
 *
 * ══ AND WHY STALENESS ARRIVES OVER THE CHANNEL ══
 *
 * There is no renderer-side detector to seed. `staleFiles` is cumulative per run and pushed by the
 * scan service on the EXISTING project watch (FR-045d, research R6), so the honest fixture at this
 * tier is an update carrying it — the same one the service sends.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Three matches over three files, so "that file and no other" is a distinguishable claim. */
function emitResults(generation = 1): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation,
    status: 'complete',
    rows: [
      resultRow('lib/b.ts', 2, 20),
      resultRow('src/a.ts', 1, 0),
      resultRow('src/a.ts', 4, 40),
      resultRow('src/c.ts', 7, 70),
    ],
    totalMatches: 4,
    filesScanned: 3,
  });
}

/** One staleness push for the run already on screen — no rows, no new generation. */
function emitStale(files: string[], generation = 1): void {
  bridge.emit({ panelId: PANEL_ID, generation, status: 'complete', staleFiles: files });
}

const groupKeys = (): string[] =>
  screen.queryAllByTestId(/^fif-group-header-/).map((el) => el.dataset.groupKey ?? '');
const rowIds = (): string[] =>
  screen.queryAllByTestId(/^fif-row-/).map((el) => el.getAttribute('data-testid') ?? '');

describe('per-file staleness (FR-045a, US3 scenario 14)', () => {
  it('marks THAT file and no other', () => {
    renderFindInFilesPanel();
    emitResults();

    emitStale(['src/a.ts']);

    expect(screen.getByTestId('fif-group-header-src/a.ts').dataset.stale).toBe('true');
    expect(screen.getByTestId('fif-group-stale-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('fif-group-header-lib/b.ts').dataset.stale).toBeUndefined();
    expect(screen.getByTestId('fif-group-header-src/c.ts').dataset.stale).toBeUndefined();
    // A panel-level "something changed" indicator is explicitly NOT sufficient (FR-045a).
    expect(screen.queryAllByTestId(/^fif-group-stale-/)).toHaveLength(1);
  });

  it('accumulates across pushes rather than replacing the last one', () => {
    renderFindInFilesPanel();
    emitResults();

    emitStale(['src/a.ts']);
    emitStale(['src/a.ts', 'lib/b.ts']);

    expect(screen.getByTestId('fif-group-header-src/a.ts').dataset.stale).toBe('true');
    expect(screen.getByTestId('fif-group-header-lib/b.ts').dataset.stale).toBe('true');
  });

  it('survives a regrouping — staleness belongs to the FILE, not to the heading', () => {
    renderFindInFilesPanel();
    emitResults();
    emitStale(['src/a.ts']);

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    expect(screen.getByTestId('fif-group-header-src/a.ts').dataset.stale).toBe('true');
    // A FOLDER is not a file, so its heading is never the thing marked (core's `markStale`).
    expect(screen.getByTestId('fif-group-header-src').dataset.stale).toBeUndefined();
  });
});

describe('a stale marking changes nothing else (FR-045b, US3 scenario 15)', () => {
  it('hides no row and reorders none', () => {
    renderFindInFilesPanel();
    emitResults();
    const groupsBefore = groupKeys();
    const rowsBefore = rowIds();

    emitStale(['src/a.ts']);

    expect(groupKeys()).toEqual(groupsBefore);
    expect(rowIds()).toEqual(rowsBefore);
  });

  it('disables and greys no row — the marking lives on the heading alone', () => {
    renderFindInFilesPanel();
    emitResults();
    emitStale(['src/a.ts']);

    for (const row of screen.queryAllByTestId(/^fif-row-/)) {
      expect(row.dataset.stale).toBeUndefined();
      expect(row.getAttribute('aria-disabled')).toBeNull();
      expect(row.className).not.toContain('stale');
      expect(row.className).not.toContain('disabled');
    }
    // Nor is the group's own toggle taken away: a stale group still collapses and expands.
    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).not.toBeDisabled();
  });

  it('still opens a row in the stale file, exactly as an unstale one', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((req) => {
      opened.push(req);
    });
    try {
      renderFindInFilesPanel();
      emitResults();
      emitStale(['src/a.ts']);

      fireEvent.doubleClick(screen.getByTestId('fif-row-src/a.ts-0'));
      fireEvent.doubleClick(screen.getByTestId('fif-row-lib/b.ts-20'));

      expect(opened.map((r) => r.relPath)).toEqual(['src/a.ts', 'lib/b.ts']);
    } finally {
      registerResultOpener(null);
    }
  });
});

/**
 * 043 T146 — SC-012 says PER FILE, and it says nothing about a grouping.
 *
 * ══ WHAT T116 ADDED, AND WHY FR-073 TAKES IT BACK ══
 *
 * `ResultGroup.stale` is only ever true for a `kind: 'file'` group, and that is right: a folder is
 * not a file, and marking one would over-report every sibling that did not change. `'folder'`
 * grouping bucketed rows straight onto a folder heading, so there was no file heading under it to
 * carry the flag — and T116 answered that by marking the ROWS instead, in that grouping alone.
 *
 * FR-073 withdrew the grouping, and says so in its own note: the per-row marking "exists only
 * because folder grouping produces no file heading to carry the flag, so its reason for existing
 * goes with the grouping". Both surviving groupings put every row under a file heading, so the row
 * marking could no longer be reached by any user — and an unreachable branch in a rendering path is
 * a claim that the component needs a state it does not have.
 *
 * ══ WHAT REPLACES IT ══
 *
 * The claim T116 was really making, over the groupings that exist: under EVERY grouping a changed
 * file is marked, exactly once, on the heading that names it — and never on a row. That is stronger
 * than what it replaces, because it is asserted over both groupings rather than one, and it is the
 * assertion that fails if the row marking is ever reintroduced.
 */
describe('per-file staleness under every grouping (043 T146, SC-012, FR-045a)', () => {
  it.each(['file', 'fileAndFolder'] as const)(
    'marks the changed file on its heading under %s grouping',
    (grouping) => {
      renderFindInFilesPanel();
      emitResults();
      emitStale(['src/a.ts']);

      fireEvent.click(screen.getByTestId(`fif-grouping-${grouping}-${PANEL_ID}`));

      expect(screen.getByTestId('fif-group-header-src/a.ts').dataset.stale).toBe('true');
      // In words, not by a colour alone — and once, not once per row of the file.
      expect(screen.getByTestId('fif-group-stale-src/a.ts')).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^fif-group-stale-/)).toHaveLength(1);
      // Its folder-mate and its sibling elsewhere are untouched.
      expect(screen.getByTestId('fif-group-header-src/c.ts').dataset.stale).toBeUndefined();
      expect(screen.getByTestId('fif-group-header-lib/b.ts').dataset.stale).toBeUndefined();
    },
  );

  it.each(['file', 'fileAndFolder'] as const)(
    'says it ONCE — no row carries a marking of its own under %s grouping (FR-073)',
    (grouping) => {
      renderFindInFilesPanel();
      emitResults();
      emitStale(['src/a.ts']);

      fireEvent.click(screen.getByTestId(`fif-grouping-${grouping}-${PANEL_ID}`));

      for (const row of screen.queryAllByTestId(/^fif-row-/)) {
        expect(row.dataset.stale).toBeUndefined();
      }
      // The per-row marking element T116 introduced is gone from the rendering path entirely, not
      // merely unset: a `data-stale` that is never true would still leave the span behind it live.
      expect(screen.queryAllByTestId(/^fif-stale-row-/)).toHaveLength(0);
    },
  );

  it('marks nothing anywhere when a folder heading is what sits above the file (FR-045a)', () => {
    renderFindInFilesPanel();
    emitResults();
    emitStale(['src/a.ts']);

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    // A FOLDER is never the thing marked — the `src` heading would report `src/c.ts` too.
    expect(screen.getByTestId('fif-group-header-src').dataset.stale).toBeUndefined();
    expect(screen.getByTestId('fif-group-header-lib').dataset.stale).toBeUndefined();
  });

  it('hides, disables, greys and reorders nothing under either grouping (FR-045b)', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((req) => {
      opened.push(req);
    });
    try {
      renderFindInFilesPanel();
      emitResults();
      fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
      const groupsBefore = groupKeys();
      const rowsBefore = rowIds();

      emitStale(['src/a.ts']);

      expect(groupKeys()).toEqual(groupsBefore);
      expect(rowIds()).toEqual(rowsBefore);
      for (const row of screen.queryAllByTestId(/^fif-row-/)) {
        expect(row.getAttribute('aria-disabled')).toBeNull();
        // The marking is a child element on the HEADING, never a modifier that could grey a row out.
        expect(row.className).not.toContain('stale');
        expect(row.className).not.toContain('disabled');
      }
      fireEvent.doubleClick(screen.getByTestId('fif-row-src/a.ts-0'));
      expect(opened.map((r) => r.relPath)).toEqual(['src/a.ts']);
    } finally {
      registerResultOpener(null);
    }
  });
});

describe('re-running clears staleness (FR-045c, US3 scenario 16)', () => {
  it('clears every file the new run re-scanned', () => {
    renderFindInFilesPanel();
    emitResults();
    emitStale(['src/a.ts', 'lib/b.ts']);
    expect(screen.queryAllByTestId(/^fif-group-stale-/)).toHaveLength(2);

    // A re-run is a NEW generation: the results are replaced, and so is everything said about them.
    emitResults(2);

    expect(screen.queryAllByTestId(/^fif-group-stale-/)).toHaveLength(0);
  });
});
