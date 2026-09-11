/**
 * 043 T062 — the scan states a Find in Files panel can be in, and the fact that a user can tell
 * them apart (FR-042, FR-024, FR-030a).
 *
 * ══ WHY THIS IS ITS OWN FILE ══
 *
 * "No results" is the answer to three completely different questions — *we have not looked*, *we
 * are looking*, and *we looked and there is nothing there* — and a fourth arrives with FR-030a:
 * *the place you told us to look is gone*. Collapsing any two of them is how a panel comes to say
 * "no matches" about a search it never ran, which is the specific way this surface misleads.
 *
 * So the assertion is not "each state renders": it is that the four render DISTINGUISHABLY, which
 * is asserted as a set of pairwise-different readings rather than as four separate string
 * comparisons. A refactor that made two of them agree would pass four independent assertions and
 * fail this one.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatGrouped, type ScanStatus } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

function mount(): void {
  renderFindInFilesPanel();
}

const status = (): HTMLElement => screen.getByTestId(`fif-status-${PANEL_ID}`);

function reach(state: ScanStatus): { state: string; text: string } {
  mount();
  if (state !== 'notRun') {
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: state, rows: [], totalMatches: 0 });
  }
  const el = status();
  return { state: el.dataset.state ?? '', text: (el.textContent ?? '').trim() };
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the four scan states read differently (FR-042, FR-030a)', () => {
  it('says something, and something different, in each of them', () => {
    const states: ScanStatus[] = ['notRun', 'running', 'complete', 'scopeMissing'];
    const readings = states.map((s) => {
      const reading = reach(s);
      // Each is mounted into its own tree; unmount it before the next so `getByTestId` stays
      // unique and the store starts the next state from nothing.
      cleanup();
      __resetFindInFilesState();
      return reading;
    });

    for (const [i, reading] of readings.entries()) {
      expect(reading.state, `${states[i]} must expose its state`).toBe(states[i]);
      expect(reading.text, `${states[i]} must say something`).not.toBe('');
    }
    const texts = readings.map((r) => r.text);
    expect(new Set(texts).size, `the four states read as: ${texts.join(' | ')}`).toBe(4);
  });

  it('a completed scan that found nothing does not read as one never run (FR-042)', () => {
    mount();
    const before = (status().textContent ?? '').trim();
    expect(status().dataset.state).toBe('notRun');

    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [],
      totalMatches: 0,
      filesScanned: 12,
    });

    expect(status().dataset.state).toBe('complete');
    expect((status().textContent ?? '').trim()).not.toBe(before);
  });
});

describe('a panel with no results displays none (FR-024)', () => {
  it('lists nothing before a scan, and nothing after one that found nothing', () => {
    mount();
    expect(screen.queryAllByTestId(/^fif-row-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^fif-group-header-/)).toHaveLength(0);

    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', rows: [], totalMatches: 0 });

    expect(screen.queryAllByTestId(/^fif-row-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^fif-group-header-/)).toHaveLength(0);
  });
});

describe('a running scan reports its progress digit-grouped (FR-041, FR-014)', () => {
  it('shows what has arrived so far while the walk continues', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1024,
      filesScanned: 2048,
    });

    expect(status().dataset.state).toBe('running');
    // Results appear progressively: the row is listed while the scan is still running.
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent(formatGrouped(1024));
  });

  it('reports the skipped-file count as one figure for the whole scan (FR-045f, FR-014)', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
      filesScanned: 9000,
      skipped: 1500,
    });

    expect(screen.getByTestId(`fif-skipped-${PANEL_ID}`)).toHaveTextContent(formatGrouped(1500));
  });
});

/**
 * 043 T118 — the readout describes the RUN, and the scope control carries the condition.
 *
 * ══ WHY THE STATUS LINE IS NOT THE PLACE TO SAY IT ══
 *
 * FR-030a's point is that a missing scope costs the user nothing: "results already listed MUST stay
 * listed and fully usable". A line that drops "N matches in M files" the moment the directory goes
 * contradicts that in the one place the user is looking — the N rows are still on screen, and the
 * only thing that changed is a directory they are no longer reading from. FR-030a names the SCOPE
 * CONTROL as the surface for the condition and it already carries it, so the status line saying it
 * a second time is the repeated notice, not the missing one.
 *
 * ══ THE READING THAT MUST NOT EXIST ══
 *
 * "Scope not found · 1,500 skipped" is a skip count from a scan the same line says did not happen.
 * It is asserted as an impossible PAIR rather than as two separate expectations, because either
 * half alone is fine: `scopeMissing` is still the honest status for a search REFUSED at the start,
 * and a skip count is still the honest tail of a scan that ran.
 */
describe('a scope that goes underneath a finished run keeps its readout (043 T118, FR-030a)', () => {
  /** A scan that ran, then the watcher noticing the directory has gone — the SAME generation. */
  function scopeGoesOver(counts: { totalMatches: number; filesScanned: number; skipped: number }) {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('sub/a.ts', 1, 0), resultRow('sub/b.ts', 2, 0)],
      ...counts,
    });
    // What `noteScopeMissingIfGone` pushes: the run's own counters, at the run's own generation,
    // with no rows. Nothing about the results changed — only the directory behind them.
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'scopeMissing', ...counts });
  }

  it('still says how many matches, in how many files, with the rows still listed', () => {
    scopeGoesOver({ totalMatches: 1024, filesScanned: 2048, skipped: 0 });

    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(2);
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent(formatGrouped(1024));
    expect(screen.getByTestId(`fif-files-${PANEL_ID}`)).toHaveTextContent(formatGrouped(2048));
    // The condition is raised, once, on the control FR-030a names.
    expect(screen.getByTestId(`fif-scope-control-${PANEL_ID}`).dataset.scopeNotice).toBe('missing');
    expect(screen.getByTestId(`fif-scope-notice-${PANEL_ID}`)).toBeInTheDocument();
    // And the run's own state is still the run's: it completed, and it did.
    expect(status().dataset.state).toBe('complete');
  });

  it('never reads "Scope not found" beside a skip count', () => {
    scopeGoesOver({ totalMatches: 0, filesScanned: 9000, skipped: 1500 });

    const text = (status().textContent ?? '').trim();
    expect(
      text.includes('Scope not found') && screen.queryByTestId(`fif-skipped-${PANEL_ID}`) !== null,
      `the status line reads: ${text}`,
    ).toBe(false);
    // The scan DID happen, so its tail is still told truthfully.
    expect(screen.getByTestId(`fif-skipped-${PANEL_ID}`)).toHaveTextContent(formatGrouped(1500));
  });

  it('keeps "Scope not found" for a search that was refused before it ran, and no skip count', () => {
    mount();
    // A refusal at the start supersedes into a NEW generation with every counter reset, so this is
    // the one place the status is the run's truth: nothing was walked, nothing was skipped.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'scopeMissing',
      rows: [],
      totalMatches: 0,
      filesScanned: 0,
      skipped: 3,
    });

    expect(status().dataset.state).toBe('scopeMissing');
    expect((status().textContent ?? '').trim()).toContain('Scope not found');
    expect(screen.queryByTestId(`fif-skipped-${PANEL_ID}`)).toBeNull();
  });
});
