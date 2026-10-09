/**
 * 053 FR-008 — the Preferences text control refuses a value its descriptor's `validate` rejects.
 *
 * `terminals.titleTemplate` is the one text setting with a grammar. The parser is the validator
 * (`validateTitleTemplate`), so the control shows exactly the message settings validity would, and
 * commits nothing until the text parses. A valid template commits as any text does.
 *
 * Driven with `fireEvent` rather than `user.type`: user-event reads `{shell}` as a key name, and
 * braces are the whole point of this text.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

const KEY = 'terminals.titleTemplate';
const descriptor = SETTINGS_METADATA.find((d: FieldDescriptor) => d.key === KEY) as FieldDescriptor;

function renderControl(value: string) {
  const onCommit = vi.fn();
  render(createElement(SettingControl, { descriptor, value, onCommit }));
  return { onCommit, input: screen.getByTestId(`control-${KEY}`) as HTMLInputElement };
}

function type(input: HTMLInputElement, text: string): void {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

describe('the text control validates before it commits (053 FR-008)', () => {
  it('refuses an unclosed group on Enter, names the offset and commits nothing', () => {
    const { onCommit, input } = renderControl('{shell}');

    type(input, '({shell}');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`control-${KEY}-invalid`).textContent).toContain('Unclosed bracket at 0');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses it on blur too', () => {
    const { onCommit, input } = renderControl('{shell}');

    type(input, '({shell}');
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`control-${KEY}-invalid`)).toBeTruthy();
  });

  it('commits a valid template and shows no error', () => {
    const { onCommit, input } = renderControl('{shell}');

    type(input, '{shell} - ({path})');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('{shell} - ({path})');
    expect(screen.queryByTestId(`control-${KEY}-invalid`)).toBeNull();
  });

  it('clears the error once the text is edited', () => {
    const { input } = renderControl('{shell}');

    type(input, '({shell}');
    fireEvent.blur(input);
    expect(screen.getByTestId(`control-${KEY}-invalid`)).toBeTruthy();

    fireEvent.change(input, { target: { value: '({shell})' } });

    expect(screen.queryByTestId(`control-${KEY}-invalid`)).toBeNull();
  });
});
