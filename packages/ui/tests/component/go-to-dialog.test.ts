/**
 * 073 FR-043b — the shared Go to dialog, used for a PDF's pages, a grid's rows and an editor's lines.
 * Layer: component — what the dialog renders, which keystrokes its field refuses, its keyboard and the return
 * of focus need a DOM; the field's rule itself is `go-to-input.test.ts`'s (core).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatGrouped } from '@throng/core';
import { GoToDialog, type GoToDialogProps } from '../../src/renderer/navigate/go-to-dialog.js';

function mount(over: Partial<GoToDialogProps> = {}) {
  const spies = { onGo: vi.fn(), onDismiss: vi.fn(), returnFocus: vi.fn() };
  const props: GoToDialogProps = { unit: 'Row', current: 3, count: 1200, testIdPrefix: 'goto', ...spies, ...over };
  const view = render(createElement(GoToDialog, props));
  const input = (): HTMLInputElement => screen.getByTestId('goto-input') as HTMLInputElement;
  return { ...spies, view, input, rerender: (next: GoToDialogProps | null) => view.rerender(next ? createElement(GoToDialog, next) : createElement('div')), props };
}

describe('the Go to dialog', () => {
  it('names where the reader is and how far it goes, digit-grouped, in the unit it was given', () => {
    mount();
    expect(screen.getByTestId('goto-status').textContent).toBe(`Row ${formatGrouped(3)} of ${formatGrouped(1200)}`);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Go to Row');
    cleanupTree();
    mount({ unit: 'Line', current: 1, count: 120 });
    expect(screen.getByTestId('goto-status').textContent).toBe('Line 1 of 120');
  });

  it('is the app\'s shared dialog surface, over a transient scrim', () => {
    mount();
    expect(screen.getByRole('dialog')).toHaveClass('picker');
    expect(screen.getByTestId('goto-overlay')).toHaveClass('modal-overlay', 'modal-overlay--transient');
  });

  it('takes the keyboard in its field, empty when it has no seed', () => {
    const m = mount();
    expect(m.input()).toHaveFocus();
    expect(m.input().value).toBe('');
  });

  it('accepts digits that make a position in range, and refuses every other keystroke', async () => {
    const m = mount({ count: 1200 });
    const user = userEvent.setup();
    await user.type(m.input(), '9');
    await user.type(m.input(), 'x');
    expect(m.input().value).toBe('9');
    await user.type(m.input(), '00');
    expect(m.input().value).toBe('900');
    await user.type(m.input(), '1');
    expect(m.input().value).toBe('900');
    await user.clear(m.input());
    await user.type(m.input(), '1300');
    // 1, 13 and 130 are in range; the fourth digit would make 1300.
    expect(m.input().value).toBe('130');
  });

  it('refuses a leading zero, a sign and a decimal point', async () => {
    const m = mount();
    const user = userEvent.setup();
    await user.type(m.input(), '0');
    await user.type(m.input(), '-');
    await user.type(m.input(), '+');
    await user.type(m.input(), '.');
    expect(m.input().value).toBe('');
  });

  it('refuses a pasted value that is not a position, as a whole', async () => {
    const m = mount({ count: 50 });
    const user = userEvent.setup();
    await user.click(m.input());
    await user.paste('700');
    expect(m.input().value).toBe('');
    await user.paste('42');
    expect(m.input().value).toBe('42');
  });

  it('goes to the number typed on Enter, and then closes', async () => {
    const m = mount();
    const user = userEvent.setup();
    await user.type(m.input(), '900{Enter}');
    expect(m.onGo).toHaveBeenCalledExactlyOnceWith(900);
    expect(m.onDismiss).toHaveBeenCalledOnce();
  });

  it('stays open on Enter with nothing typed', async () => {
    const m = mount();
    const user = userEvent.setup();
    await user.type(m.input(), '{Enter}');
    expect(m.onGo).not.toHaveBeenCalled();
    expect(m.onDismiss).not.toHaveBeenCalled();
  });

  it('closes on Escape, going nowhere, and swallows the key so nothing behind it also closes', () => {
    const m = mount();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    fireEvent.keyDown(m.input(), { key: 'Escape' });
    window.removeEventListener('keydown', behind);
    expect(m.onDismiss).toHaveBeenCalledOnce();
    expect(m.onGo).not.toHaveBeenCalled();
  });

  it('closes on a press on the scrim, but not on a press inside the dialog', () => {
    const m = mount();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(m.onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('goto-overlay'));
    expect(m.onDismiss).toHaveBeenCalledOnce();
  });

  it('seeds the field with a remembered number and selects it, so typing replaces it', async () => {
    const m = mount({ seed: 42 });
    expect(m.input().value).toBe('42');
    expect(m.input().selectionStart).toBe(0);
    expect(m.input().selectionEnd).toBe(2);
    const user = userEvent.setup();
    await user.keyboard('7');
    expect(m.input().value).toBe('7');
  });

  it('drops a seed that is not a position of this document', () => {
    expect(mount({ seed: 5000, count: 100 }).input().value).toBe('');
  });

  it('returns focus by the name it was given, once the dialog is gone, whether it went or was dismissed', () => {
    const m = mount();
    expect(m.returnFocus).not.toHaveBeenCalled();
    act(() => m.rerender(null));
    expect(m.returnFocus).toHaveBeenCalledOnce();
  });

  it('takes its ids from its prefix, so each surface keeps its own', () => {
    mount({ testIdPrefix: 'gotoline' });
    expect(screen.getByTestId('gotoline')).toBeTruthy();
    expect(screen.getByTestId('gotoline-overlay')).toBeTruthy();
    expect(screen.getByTestId('gotoline-input')).toBeTruthy();
  });
});

function cleanupTree(): void {
  document.body.replaceChildren();
}
