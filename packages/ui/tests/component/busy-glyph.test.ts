/**
 * 060 FR-001a / FR-001b — one busy indicator: the theme's `busy` glyph, turned.
 *
 * Layer: component — the markup is a DOM fact. Whether the box actually rotates about its centre is a
 * stylesheet fact guarded in `tests/unit/busy-glyph-css.test.ts`. The glyph is read FROM THE THEME
 * (`busy` is a token a theme may change), never hard-coded here.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { resolveIconAsset, THRONG_THEME } from '@throng/core';
import { BusyGlyph } from '../../src/renderer/common/busy-glyph.js';
import { Spinner } from '../../src/renderer/common/loading.js';

const themeGlyph = (): string => {
  const asset = resolveIconAsset(THRONG_THEME, {}, 'busy');
  expect(asset.kind).toBe('glyph');
  return asset.kind === 'glyph' ? asset.glyph : '';
};

describe('BusyGlyph', () => {
  it('draws the theme busy token inside one box, and nothing else', () => {
    const { container } = render(createElement(BusyGlyph));
    const box = container.querySelector('.busy-glyph');
    expect(box).not.toBeNull();
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box?.querySelectorAll('.icon')).toHaveLength(1);
    expect(box?.querySelector('.icon')?.textContent).toBe(themeGlyph());
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
    expect(status.querySelector('.busy-glyph .icon')?.textContent).toBe(themeGlyph());
    expect(container.querySelector('.throng-spinner__ring')).toBeNull();
  });

  it('keeps the default label', () => {
    render(createElement(Spinner));
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
