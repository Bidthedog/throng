/**
 * The cancel ✕ must stop what the panel SHOWS, even when main has already finished the scan.
 *
 * Measured in a running app: a scan that hits the 20,000 cap finishes in main in under 300 ms, and
 * the renderer then spends ~9 s folding the batches that are already on their way. The ✕ is on
 * screen for all of that time. A cancel sent then reaches a scan main has already completed, so main
 * ignores it — and the batches still in flight carry on landing, the list keeps growing, and the run
 * ends "complete". To the user, the ✕ did nothing.
 *
 * So cancelling is decided HERE as well as in main: the moment the ✕ is pressed the panel reads
 * Cancelled and lists nothing — FR-043's "a cancelled walk yields nothing, not a truncated set",
 * which is what main's own cancel shows — and nothing that arrives afterwards from that run lands.
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

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
  document.body.replaceChildren();
});

describe('the cancel ✕ stops the panel, whatever main has already sent', () => {
  it('reads Cancelled at once, lists nothing, and takes nothing that arrives afterwards from that run', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'compute' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });

    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));
    expect(bridge.cancel).toHaveBeenCalledTimes(1);
    expect(status().dataset.state).toBe('cancelled');

    // Main had already finished: what it sent before the cancel reached it is still arriving.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/b.ts', 2, 10)],
      totalMatches: 2,
    });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/c.ts', 3, 20)],
      totalMatches: 3,
    });

    expect(status().dataset.state).toBe('cancelled');
    expect(rows()).toEqual([]);
  });

  it('a new run after a cancel lists normally', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'compute' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'running', rows: [], totalMatches: 0 });
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
