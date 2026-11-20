/**
 * 074 FR-072c — the Preferences list editor refuses an entry its descriptor's `validateItem` rejects, and says why.
 *
 * `editor.previews.providers.html.safeSources` is the list with a grammar: every entry is an https origin or a
 * `*.domain` wildcard. The descriptor carries the rule (`safeSourceFault`, the same words Project Settings shows), so
 * the control names no setting. A refused entry is never written; the text stays so it can be corrected.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

const KEY = 'editor.previews.providers.html.safeSources';
const descriptor = SETTINGS_METADATA.find((d: FieldDescriptor) => d.key === KEY) as FieldDescriptor;
const SHIPPED = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

function renderControl(value: string[] = SHIPPED) {
  const onCommit = vi.fn();
  render(createElement(SettingControl, { descriptor, value, onCommit }));
  return { onCommit };
}

function addEntry(text: string): HTMLInputElement {
  fireEvent.click(screen.getByTestId(`control-${KEY}-add`));
  const input = screen.getByTestId(`control-${KEY}-item-${SHIPPED.length}`) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe('the list editor validates each entry before it commits (074 FR-072c)', () => {
  it('refuses an http address on Enter, says only https can be a source, and writes nothing', () => {
    const { onCommit } = renderControl();

    const input = addEntry('http://cdn.example.com');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`control-${KEY}-item-${SHIPPED.length}-invalid`).textContent).toBe(
      'Only https addresses can be sources',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('http://cdn.example.com');
  });

  it('refuses an edit that is not a web address on blur, and names an example', () => {
    const { onCommit } = renderControl();

    const input = screen.getByTestId(`control-${KEY}-item-0`) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'not a source' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`control-${KEY}-item-0-invalid`).textContent).toContain('Not a web address: not a source');
  });

  it('commits a valid source once it is confirmed, not keystroke by keystroke', () => {
    const { onCommit } = renderControl();

    const input = addEntry('https://cdn.example.com');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith([...SHIPPED, 'https://cdn.example.com']);
    expect(screen.queryByTestId(`control-${KEY}-item-${SHIPPED.length}-invalid`)).toBeNull();
  });

  it('clears the message once the entry is edited again', () => {
    renderControl();

    const input = addEntry('http://cdn.example.com');
    fireEvent.blur(input);
    expect(screen.getByTestId(`control-${KEY}-item-${SHIPPED.length}-invalid`)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'https://cdn.example.com' } });

    expect(screen.queryByTestId(`control-${KEY}-item-${SHIPPED.length}-invalid`)).toBeNull();
  });

  it('drops an added entry left empty without writing or complaining', () => {
    const { onCommit } = renderControl();

    fireEvent.click(screen.getByTestId(`control-${KEY}-add`));
    const input = screen.getByTestId(`control-${KEY}-item-${SHIPPED.length}`);
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`control-${KEY}-item-${SHIPPED.length}`)).toBeNull();
  });
});
