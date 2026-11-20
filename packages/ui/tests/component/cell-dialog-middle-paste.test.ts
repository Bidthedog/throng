/**
 * 073 FR-036e — the middle mouse button never pastes in the cell dialog (maintainer, 2026-11-20: "Middle mouse should
 * not paste in throng at all"). Reported from hand-testing on Linux: a middle-click in the dialog's editor pasted, where
 * the grid behind it (FR-008f) already refused. Confirmed in the running app: the dialog's text `two lines` became
 * `twoCLIPBOARDlines` after one middle-click.
 *
 * Chromium's middle-click paste is the DEFAULT of the middle button's press and release, delivered as a `paste` event to
 * the focused editor; jsdom performs no default, so what is asserted is that each of them is cancelled, and that a paste
 * arriving just after a middle press does not reach the editor. Ctrl+middle-click stays the zoom reset (070 FR-030).
 *
 * Layer: component — the dialog mounted whole, its CodeMirror editor real.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellDialog } from '../../src/renderer/grid/cell-dialog.js';

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(): Promise<HTMLElement> {
  render(createElement(CellDialog, { cellLabel: 'B3', initial: 'two lines', json: false, onSave: vi.fn(), onCancel: vi.fn() }));
  const content = await waitFor(() => {
    const el = screen.getByTestId('cell-dialog').querySelector<HTMLElement>('.cm-content');
    if (el === null) throw new Error('no editor yet');
    return el;
  });
  return content;
}

function paste(target: HTMLElement, text: string): Event {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: DataTransfer };
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => text, types: ['text/plain'] } });
  act(() => void target.dispatchEvent(e));
  return e;
}

describe('the cell dialog refuses the middle button\'s paste (073 FR-036e)', () => {
  it('cancels the press, the release and the auxclick, so Chromium starts no paste and no autoscroll', async () => {
    const content = await mount();
    for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
      act(() => void content.dispatchEvent(e));
      expect(e.defaultPrevented, type).toBe(true);
    }
  });

  it('drops a paste that follows a middle press, and the text is unchanged', async () => {
    const content = await mount();
    fireEvent.mouseDown(content, { button: 1 });
    fireEvent.mouseUp(content, { button: 1 });
    const e = paste(content, 'CLIPBOARD');
    expect(e.defaultPrevented).toBe(true);
    expect(content.textContent).toBe('two lines');
  });

  it('leaves the reader\'s own paste alone: a key ends the latch', async () => {
    const content = await mount();
    fireEvent.mouseDown(content, { button: 1 });
    fireEvent.keyDown(content, { key: 'v', ctrlKey: true });
    paste(content, 'mine');
    // CodeMirror cancels every paste and inserts it itself, so the insertion is what shows the paste reached it.
    expect(content.textContent).toContain('mine');
  });

  it('leaves Ctrl+middle-click alone: it is the zoom reset (070 FR-030)', async () => {
    const content = await mount();
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, ctrlKey: true });
    act(() => void content.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(false);
  });
});
