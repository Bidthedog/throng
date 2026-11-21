/**
 * 077 FR-024 (the maintainer, 2026-11-21 08:16: "When entering an invalid value in a preferences box, the error should
 * be shown in preferences toast, rather than inline. The inline setting shifts the layout and its ugly.")
 *
 * A box's problem is said in the Preferences window's toast (the shared notification surface), naming the setting;
 * the box keeps only its red outline, so nothing beside or beneath it moves. One condition, one notice: the same
 * refused entry confirmed again flashes the card already up rather than stacking another, and the card goes once the
 * entry is put right, restored, or the box leaves the window.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatGrouped, SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

afterEach(() => vi.useRealTimers());

const fontSize: FieldDescriptor = {
  key: 'editor.fontSize',
  label: 'Font size',
  description: '',
  group: 'Editor',
  control: 'number',
  type: 'number',
  min: 6,
  max: 72,
} as FieldDescriptor;

const TOAST = `control-${fontSize.key}-invalid`;

function mount(descriptor: FieldDescriptor, value: unknown, props: { disabled?: boolean } = {}) {
  const onCommit = vi.fn();
  const view = render(createElement(NotificationProvider, null, createElement(SettingControl, { descriptor, value, onCommit, ...props })));
  const input = screen.getByTestId(`control-${descriptor.key}`) as HTMLInputElement;
  return { onCommit, input, view };
}

function enter(input: HTMLInputElement, text: string): void {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

describe('a Preferences box says what is wrong in a toast, not beside itself (077 FR-024)', () => {
  it('names the setting and its range in one toast, and the box carries only its outline', () => {
    const { input } = mount(fontSize, 13);
    const box = input.parentElement!;
    enter(input, '99');

    expect(screen.getAllByTestId(TOAST)).toHaveLength(1);
    expect(screen.getByTestId(TOAST)).toHaveTextContent(`Font size must be between ${formatGrouped(6)} and ${formatGrouped(72)}`);
    // Nothing is said inside the control: the outline is the whole of its invalid state.
    expect(box.textContent).not.toMatch(/must be|Up to|At least/);
    expect(box.contains(screen.getByTestId(TOAST))).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('ctl__input--invalid');
  });

  it('flashes the one card when the same refused entry is confirmed again, never a second', () => {
    const { input, onCommit } = mount(fontSize, 13);
    enter(input, 'abc');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(TOAST)).toHaveLength(1);
    expect(screen.getByTestId(TOAST)).toHaveTextContent('Font size must be a whole number');
    // The entry is kept until corrected (040 FR-007), as before.
    expect(input.value).toBe('abc');
  });

  it('rewrites its card when the entry goes wrong another way, rather than raising a second', () => {
    const { input } = mount(fontSize, 13);
    enter(input, 'abc');
    expect(screen.getByTestId(TOAST)).toHaveTextContent('must be a whole number');
    fireEvent.change(input, { target: { value: '500' } });

    expect(screen.getAllByTestId(TOAST)).toHaveLength(1);
    expect(screen.getByTestId(TOAST)).toHaveTextContent('must be between');
  });

  it('takes the card down once the entry is put right, or Escape restores the stored value', () => {
    const { input } = mount(fontSize, 13);
    enter(input, '99');
    expect(screen.getByTestId(TOAST)).toBeTruthy();
    fireEvent.change(input, { target: { value: '14' } });
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByTestId(TOAST)).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId(TOAST)).toBeNull();
    expect(input.value).toBe('13');
  });

  it('takes the card down when the box leaves the window', () => {
    const onCommit = vi.fn();
    function Pane({ show }: { show: boolean }) {
      return show ? createElement(SettingControl, { descriptor: fontSize, value: 13, onCommit }) : null;
    }
    const view = render(createElement(NotificationProvider, null, createElement(Pane, { show: true })));
    enter(screen.getByTestId(`control-${fontSize.key}`) as HTMLInputElement, '99');
    expect(screen.getByTestId(TOAST)).toBeTruthy();

    act(() => view.rerender(createElement(NotificationProvider, null, createElement(Pane, { show: false }))));
    expect(screen.queryByTestId(TOAST)).toBeNull();
  });

  it('says nothing about a disabled box', () => {
    const { input } = mount(fontSize, 999, { disabled: true });
    expect(input).toBeDisabled();
    expect(screen.queryByTestId(TOAST)).toBeNull();
  });

  it('names a text setting its own rule refuses, in the same toast', () => {
    const KEY = 'terminals.titleTemplate';
    const descriptor = SETTINGS_METADATA.find((d: FieldDescriptor) => d.key === KEY) as FieldDescriptor;
    const { input } = mount(descriptor, '{shell}');
    enter(input, '({shell}');
    fireEvent.keyDown(input, { key: 'Enter' });

    const toast = screen.getByTestId(`control-${KEY}-invalid`);
    expect(toast).toHaveTextContent(`${descriptor.label}: Unclosed bracket at 0`);
    // The message is said once, in the toast: nowhere else on the page carries it.
    expect(screen.getAllByText(/Unclosed bracket/).every((el) => toast.contains(el))).toBe(true);
  });
});
