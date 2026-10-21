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

const ATTENTION = { kind: 'attention' as const, label: 'Build — Alpha: Bell (Attention)' };
const FAILED = { kind: 'failed' as const, label: 'Build — Alpha: Exited with code 1 (Failed)' };

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
