/**
 * The cancel ✕ must stop what the panel SHOWS, even when main has already finished the scan — and,
 * since 060 FR-003a, it KEEPS what was already listed.
 *
 * Measured in a running app: a scan that hits the 20,000 cap finishes in main in under 300 ms, and
 * the renderer then spends ~9 s folding the batches that are already on their way. The ✕ is on
 * screen for all of that time. A cancel sent then reaches a scan main has already completed, so main
 * ignores it — and the batches still in flight carry on landing, the list keeps growing, and the run
 * ends "complete". To the user, the ✕ did nothing.
 *
 * So cancelling is decided HERE as well as in main: the moment the ✕ is pressed the panel reads
 * Cancelled, and nothing that arrives afterwards from that run lands (FR-003d).
 *
 * ══ WHAT CHANGED IN 060 ══
 *
 * 043 read FR-043 as "a cancelled walk yields nothing, not a truncated set" and the panel emptied
 * itself on cancel. 060 FR-003a supersedes that: every row already listed STAYS, with its headings,
 * counts and grouping, and the partial notice (see `find-in-files-notices.test.ts`) says the list is
 * partial. What did not change is the other half — a batch that arrives after the cancel adds nothing.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const status = (): HTMLElement => screen.getByTestId(`fif-status-${PANEL_ID}`);
const rows = (): HTMLElement[] => screen.queryAllByTestId(/^fif-row-/);

function runAndStream(): void {
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'compute' } });
  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'running',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('src/a.ts', 2, 10)],
    totalMatches: 2,
  });
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
  document.body.replaceChildren();
});

describe('the cancel ✕ stops the panel and keeps what was listed (FR-003a, FR-003d)', () => {
  it('reads Cancelled at once and keeps every listed row, heading and count', () => {
    renderFindInFilesPanel();
    runAndStream();

    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    expect(bridge.cancel).toHaveBeenCalledTimes(1);
    expect(status().dataset.state).toBe('cancelled');
    expect(rows().map((r) => r.dataset.relPath)).toEqual(['src/a.ts', 'src/a.ts']);
    expect(screen.getByTestId('fif-group-header-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('fif-group-count-src/a.ts')).toHaveTextContent('2');
    // The status line reads the scan as cancelled WITH the count it listed.
    expect(status()).toHaveTextContent('Cancelled');
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent('2');
  });

  it('takes nothing that arrives afterwards from that run', () => {
    renderFindInFilesPanel();
    runAndStream();
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    // Main had already finished: what it sent before the cancel reached it is still arriving.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/b.ts', 2, 10)],
      totalMatches: 3,
    });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/c.ts', 3, 20)],
      totalMatches: 4,
    });

    expect(status().dataset.state).toBe('cancelled');
    expect(rows().map((r) => r.dataset.relPath)).toEqual(['src/a.ts', 'src/a.ts']);
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent('2');
  });

  it('a cancel with nothing listed yet shows an empty, cancelled list', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'compute' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'running', rows: [], totalMatches: 0 });

    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    expect(status().dataset.state).toBe('cancelled');
    expect(rows()).toEqual([]);
  });

  it('a new run after a cancel supersedes the kept rows and lists normally', () => {
    renderFindInFilesPanel();
    runAndStream();
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/d.ts', 1, 0)],
      totalMatches: 1,
    });

    expect(status().dataset.state).toBe('complete');
    expect(rows().map((r) => r.dataset.relPath)).toEqual(['src/d.ts']);
  });
});
