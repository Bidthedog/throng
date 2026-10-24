import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AttentionMark } from '../../src/renderer/attention/attention-mark.js';

/**
 * The shared attention mark (057 US1, FR-015/FR-016/FR-017) — what every holder draws.
 *
 * Layer: component. What it renders, its accessible name and the classes that carry its colour are all
 * a DOM can see; how the colour is PAINTED on a selected project row (FR-017's legibility) is real
 * layout and rides the manual test plan.
 *
 * ANTI-VACUITY CONTROL: draw the mark with `throng-unsaved-dot` instead of its own class and the
 * "distinct from the unsaved dot" test fails; drop the `aria-label` and the name test fails.
 */

const ATTENTION = { kind: 'attention' as const, label: 'Build — Alpha: Bell (Attention)', count: 1 };
const FAILED = { kind: 'failed' as const, label: 'Build — Alpha: Exited with code 1 (Failed)', count: 1 };

function mount(mark: typeof ATTENTION | typeof FAILED) {
  render(createElement(AttentionMark, { mark, testId: 'attention-panel-p1' }));
  return screen.getByTestId('attention-panel-p1');
}

describe('AttentionMark', () => {
  it('names itself from the holder label, with no native tooltip on any holder (FR-015, FR-123)', () => {
    const el = mount(ATTENTION);
    expect(el).toHaveAttribute('aria-label', ATTENTION.label);
    // FR-123: a hover popover says it all; a native tooltip on top of one is noise.
    expect(el).not.toHaveAttribute('title');
    expect(el).toHaveAttribute('role', 'img');
  });

  it('draws an Attention mark with the attention icon and its own colour class', () => {
    const el = mount(ATTENTION);
    expect(el).toHaveClass('throng-attention-mark', 'throng-attention-mark--attention');
    expect(el).not.toHaveClass('throng-attention-mark--failed');
    expect(el).toHaveAttribute('data-kind', 'attention');
    expect(el.querySelector('.icon')).not.toBeNull();
  });

  it('draws a Failed mark in the failed colour class', () => {
    const el = mount(FAILED);
    expect(el).toHaveClass('throng-attention-mark--failed');
    expect(el).toHaveAttribute('data-kind', 'failed');
  });

  it('is not colour alone: the two kinds draw different icons (FR-016)', () => {
    const a = mount(ATTENTION).innerHTML;
    document.body.innerHTML = '';
    const f = mount(FAILED).innerHTML;
    expect(f).not.toBe(a);
  });

  // FR-131 — a numbered mark shows how many marked panels sit beneath its holder, inside its flag.
  describe('the number (FR-131)', () => {
    const numbered = (count: number, kind: 'attention' | 'failed' = 'attention') => {
      render(createElement(AttentionMark, { mark: { kind, label: 'x', count }, testId: 'm', showCount: true }));
      return screen.getByTestId('m');
    };

    it('draws the count laid over the registry icon, with no inline svg or colour of its own', () => {
      const el = numbered(3);
      const digits = el.querySelector('.throng-attention-mark__count');
      expect(digits).toHaveTextContent('3');
      expect(el.querySelector('.icon')).not.toBeNull();
      expect(digits).toHaveAttribute('aria-hidden', 'true');
      expect(el.querySelector('[style]')).toBeNull();
      expect(el.querySelector('.throng-attention-mark__count svg')).toBeNull();
    });

    it('shows 1 through 9 as they are and anything above as 9+', () => {
      expect(numbered(1).textContent).toContain('1');
      document.body.innerHTML = '';
      expect(numbered(9).querySelector('.throng-attention-mark__count')).toHaveTextContent(/^9$/);
      document.body.innerHTML = '';
      expect(numbered(10).querySelector('.throng-attention-mark__count')).toHaveTextContent('9+');
      document.body.innerHTML = '';
      expect(numbered(250).querySelector('.throng-attention-mark__count')).toHaveTextContent('9+');
    });

    it('keeps the Failed style when numbered', () => {
      const el = numbered(2, 'failed');
      expect(el).toHaveClass('throng-attention-mark--failed');
      expect(el.querySelector('.throng-attention-mark__count')).toHaveTextContent('2');
    });

    it('a panel header mark carries no number (it is not asked to)', () => {
      const el = mount(ATTENTION);
      expect(el.querySelector('.throng-attention-mark__count')).toBeNull();
    });
  });

  it('is visibly distinct from the unsaved dot, and can sit beside it (FR-017)', () => {
    const el = mount(ATTENTION);
    expect(el).not.toHaveClass('throng-unsaved-dot');
    // The two marks are siblings in a header: neither wraps the other and they share no class.
    const dot = document.createElement('span');
    dot.className = 'throng-unsaved-dot';
    el.parentElement!.append(dot);
    expect(el.contains(dot)).toBe(false);
    expect(dot.className).not.toContain('throng-attention-mark');
  });
});
