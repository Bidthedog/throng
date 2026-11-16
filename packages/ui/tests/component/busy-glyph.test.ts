/**
 * 060 FR-001a / FR-001b — one busy indicator: the `busy` icon, turned.
 *
 * Layer: component — the markup is a DOM fact. Whether the box actually rotates about its centre is a
 * stylesheet fact guarded in `tests/unit/busy-glyph-css.test.ts`. The art is the default set's `busy`
 * icon (069), resolved through `resolveIcon`, never hard-coded here.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { resolveIcon, THRONG_THEME, type IconKey } from '@throng/core';
import { BusyGlyph } from '../../src/renderer/common/busy-glyph.js';
import { Spinner } from '../../src/renderer/common/loading.js';

/** The markup the default icon set draws for `key`, round-tripped through the DOM so it compares like `innerHTML`. */
const markupFor = (key: IconKey): string => {
  const host = document.createElement('div');
  host.innerHTML = resolveIcon(THRONG_THEME, [], key);
  return host.innerHTML;
};

const busyMarkup = (): string => markupFor('busy');

describe('BusyGlyph', () => {
  it('draws the theme busy token inside one box, and nothing else', () => {
    const { container } = render(createElement(BusyGlyph));
    const box = container.querySelector('.busy-glyph');
    expect(box).not.toBeNull();
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box?.querySelectorAll('.icon')).toHaveLength(1);
    expect(box?.querySelector('.icon')?.innerHTML).toBe(busyMarkup());
  });

  it('accepts an extra class on the box', () => {
    const { container } = render(createElement(BusyGlyph, { className: 'extra' }));
    expect(container.querySelector('.busy-glyph.extra')).not.toBeNull();
  });
});

describe('Spinner (FR-011b)', () => {
  it('is a status with its label, drawn by the busy glyph rather than a CSS ring', () => {
    const { container } = render(createElement(Spinner, { label: 'Opening' }));
    const status = screen.getByRole('status', { name: 'Opening' });
    expect(status.querySelector('.busy-glyph .icon')?.innerHTML).toBe(busyMarkup());
    expect(container.querySelector('.throng-spinner__ring')).toBeNull();
  });

  it('keeps the default label', () => {
    render(createElement(Spinner));
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
