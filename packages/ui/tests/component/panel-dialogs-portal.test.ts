/**
 * The Go to dialog (073 FR-043b) and the cell dialog (073 FR-036a) are modal over the whole window, not over the
 * panel that opened them. A panel is its own stacking context (`.panel-box { isolation: isolate }`), so a dialog
 * drawn inside one is painted over by every panel after it in the layout: the MT-102 and MT-104 walk-through
 * (2026-11-21) saw a grid's Go to Row dialog cut in half by the PDF and Markdown panels beside it, and the cell
 * dialog's Save button hidden under File Explorer. Each is drawn at the document's top level instead.
 *
 * Layer: component — where the dialog lands in the DOM; the stacking itself needs a real layout (the walk-through).
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoToDialog } from '../../src/renderer/navigate/go-to-dialog.js';
import { CellDialog } from '../../src/renderer/grid/cell-dialog.js';

/** A stand-in for a panel's box: the stacking context a dialog must not be drawn inside. */
function panelBox(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'panel-box';
  document.body.appendChild(box);
  return box;
}

beforeEach(() => {
  // jsdom has no text geometry; the cell dialog's CodeMirror asks for it on every measure.
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('a panel\'s modal dialogs are drawn outside the panel', () => {
  it('the Go to dialog', () => {
    const box = panelBox();
    render(
      createElement(GoToDialog, {
        unit: 'Row',
        current: 3,
        count: 1200,
        testIdPrefix: 'goto',
        onGo: vi.fn(),
        onDismiss: vi.fn(),
        returnFocus: vi.fn(),
      }),
      { container: box },
    );
    const overlay = screen.getByTestId('goto-overlay');
    expect(box.contains(overlay), 'drawn inside the panel').toBe(false);
    expect(overlay.closest('.panel-box')).toBeNull();
    expect(overlay.isConnected).toBe(true);
  });

  it('the cell dialog', () => {
    const box = panelBox();
    render(createElement(CellDialog, { cellLabel: 'B3', initial: 'text', json: false, onSave: vi.fn(), onCancel: vi.fn() }), {
      container: box,
    });
    const overlay = screen.getByTestId('cell-dialog-overlay');
    expect(box.contains(overlay), 'drawn inside the panel').toBe(false);
    expect(overlay.closest('.panel-box')).toBeNull();
    expect(overlay.isConnected).toBe(true);
  });
});
