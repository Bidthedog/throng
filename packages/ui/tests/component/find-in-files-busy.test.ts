/**
 * 060 US1 / FR-001 — a running scan SHOWS that it is running, on the very control that stops it.
 *
 * The cancel control is already on screen for exactly as long as the scan runs, so it carries the
 * busy state rather than a second indicator beside it (one condition, one surface). The rotation
 * itself is CSS and is guarded in `tests/unit/busy-glyph-css.test.ts`; what a render can
 * prove is the markup that rule hangs off, and that it clears again.
 *
 * Layer: component — attributes and the rendered icon are DOM facts; whether it visibly spins is a
 * stylesheet fact the unit guard owns.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveIconAsset, THRONG_THEME } from '@throng/core';
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

const cancel = (): HTMLElement => screen.getByTestId(`fif-cancel-${PANEL_ID}`);
const results = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);

function startRunning(): void {
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'running',
    rows: [resultRow('src/a.ts', 1, 0)],
    totalMatches: 1,
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

describe('the cancel control carries the busy state (FR-001)', () => {
  it('is marked busy and draws the busy icon while the scan runs', () => {
    renderFindInFilesPanel();
    startRunning();

    expect(cancel()).toHaveAttribute('data-busy', 'true');
    expect(cancel()).toHaveAttribute('aria-busy', 'true');
    expect(cancel()).toHaveAttribute('title', 'Cancel search');
    // The shared BusyGlyph box (it is what rotates), holding the themeable `busy` icon. The glyph is
    // read from the theme, not hard-coded: it is a token a theme may change. An unknown token renders
    // NOTHING, so a drawn glyph is also the proof the token exists. One `.icon` per button.
    const asset = resolveIconAsset(THRONG_THEME, {}, 'busy');
    expect(asset.kind).toBe('glyph');
    const busy = cancel().querySelector('.busy-glyph');
    expect(busy).not.toBeNull();
    expect(cancel().querySelectorAll('.icon')).toHaveLength(1);
    expect(busy?.querySelector('.icon')?.textContent).toBe(asset.kind === 'glyph' ? asset.glyph : '');
  });

  it('marks the results list busy too, so assistive technology hears the list is still filling', () => {
    renderFindInFilesPanel();
    startRunning();

    expect(results()).toHaveAttribute('aria-busy', 'true');
  });

  it('clears the list’s busy state when the scan completes', () => {
    renderFindInFilesPanel();
    startRunning();

    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', totalMatches: 1 });

    expect(screen.queryByTestId(`fif-cancel-${PANEL_ID}`)).toBeNull();
    expect(results()).not.toHaveAttribute('aria-busy', 'true');
  });

  it('shows the ✕ while the pointer is on the control, and the busy icon again on the next scan', () => {
    renderFindInFilesPanel();
    startRunning();

    fireEvent.mouseEnter(cancel());
    expect(cancel().querySelector('.fif-cancel-x')).not.toBeNull();
    expect(cancel().querySelector('.busy-glyph')).toBeNull();
    expect(cancel().querySelectorAll('.icon')).toHaveLength(1);

    // The scan ends under the pointer: the control unmounts without ever seeing a mouse-leave.
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', totalMatches: 1 });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({ panelId: PANEL_ID, generation: 2, status: 'running', rows: [], totalMatches: 0 });

    expect(cancel().querySelector('.busy-glyph')).not.toBeNull();
    expect(cancel().querySelector('.fif-cancel-x')).toBeNull();
  });

  it('clears both when the scan is cancelled, and clicking the control is what cancels', () => {
    renderFindInFilesPanel();
    startRunning();

    fireEvent.click(cancel());

    expect(bridge.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`fif-cancel-${PANEL_ID}`)).toBeNull();
    expect(results()).not.toHaveAttribute('aria-busy', 'true');
  });
});
