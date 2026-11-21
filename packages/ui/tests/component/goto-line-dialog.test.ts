/**
 * 073 FR-043b — the editor's Go to Line, rebuilt on the shared Go to dialog: it names "Line <caret line> of <lines>",
 * its field takes only a line that exists, Enter moves the caret to the line's first column, Escape closes with
 * focus back in the editor, and the remembered number (033 FR-057 – FR-061) is seeded, selected and clamped.
 *
 * Layer: component — a real CodeMirror view is registered the way an editor panel registers its own; the rule
 * is core's (`go-to-input.test.ts`) and the dialog's own behaviour is `go-to-dialog.test.ts`'s. This proves the
 * wiring to the editor and that the three test ids the end-to-end suites use survive.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GotoLine } from '../../src/renderer/navigate/goto-line.js';
import { registerEditorView, unregisterEditorView } from '../../src/renderer/editor/editor-views.js';
import { resetRememberedInput, rememberGotoLineNumber } from '../../src/renderer/navigate/navigation-store.js';
let rememberSetting = true;
vi.mock('../../src/renderer/config/config-store.js', () => ({
  useAppSettings: () => ({ editor: { navigation: { rememberGotoLineNumber: rememberSetting } } }),
}));

const PANEL = 'ed1';
let view: EditorView;
let host: HTMLElement;

const doc = (lines: number): string => Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');

function mountEditor(lines: number, caretLine = 1): void {
  host = document.createElement('div');
  document.body.append(host);
  view = new EditorView({ parent: host, state: EditorState.create({ doc: doc(lines) }) });
  const pos = view.state.doc.line(caretLine).from + 2;
  view.dispatch({ selection: { anchor: pos } });
  registerEditorView(PANEL, view);
}

function open(onDismiss = vi.fn()) {
  const { unmount } = render(createElement(GotoLine, { panelId: PANEL, onDismiss }));
  const input = screen.getByTestId('gotoline-input') as HTMLInputElement;
  return { onDismiss, input, unmount };
}

beforeEach(() => {
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  resetRememberedInput();
  rememberSetting = true;
});
afterEach(() => {
  unregisterEditorView(PANEL);
  view?.destroy();
  host?.remove();
  document.body.replaceChildren();
});

describe('Go to Line on the shared dialog (FR-043b)', () => {
  it('keeps the ids the end-to-end suites address, and names the caret line and the line count', () => {
    mountEditor(300, 3);
    open();
    expect(screen.getByTestId('gotoline')).toBeTruthy();
    expect(screen.getByTestId('gotoline-overlay')).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Go To Line');
    expect(screen.getByRole('dialog').textContent).toContain('Line 3 of 300');
  });

  it('refuses a letter and a line past the end, which can no longer be typed', async () => {
    mountEditor(300);
    const { input } = open();
    const user = userEvent.setup();
    await user.type(input, 'q');
    expect(input.value).toBe('');
    await user.type(input, '301');
    // 3 and 30 are lines; the third digit would make 301.
    expect(input.value).toBe('30');
  });

  it('moves the caret to the first column of the typed line and closes, leaving focus to the editor', async () => {
    mountEditor(300);
    const { input, onDismiss, unmount } = open();
    const focus = vi.spyOn(view, 'focus');
    const user = userEvent.setup();
    await user.type(input, '42{Enter}');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(42);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(42).from);
    expect(onDismiss).toHaveBeenCalledOnce();

    // Focus goes back by name once the dialog unmounts.
    unmount();
    expect(focus).toHaveBeenCalled();
  });

  it('closes on Escape with the caret where it was', () => {
    mountEditor(300, 5);
    const before = view.state.selection.main.head;
    const { input, onDismiss } = open();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(view.state.selection.main.head).toBe(before);
  });

  it('stays open on Enter with nothing typed, and moves nothing', () => {
    mountEditor(300, 5);
    const before = view.state.selection.main.head;
    const { input, onDismiss } = open();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(before);
  });

  it('seeds the remembered number, selected, clamped into the document (033 FR-057 – FR-061)', () => {
    mountEditor(300);
    rememberGotoLineNumber(120);
    const { input } = open();
    expect(input.value).toBe('120');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it('clamps a remembered number past the end of a shorter document to its last line', () => {
    mountEditor(50);
    rememberGotoLineNumber(9000);
    const { input } = open();
    expect(input.value).toBe('50');
  });
});
