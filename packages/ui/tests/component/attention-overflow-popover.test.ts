/**
 * The tab strip's overflow controls' marks open the attention popover (057 FR-104, US1/17): hovering or
 * keyboard-focusing one lists the marked panels on that side's hidden tabs, one per line as
 * "Tab › Panel" and the reason (FR-100).
 *
 * Layer: component — the REAL `OverflowMark` over the real store. Which tabs are hidden is the strip's
 * measurement and arrives as `panelIds`; what the popover lists for them is a DOM fact.
 *
 * ANTI-VACUITY CONTROL: ignore `panelIds` in the popover and the "only the hidden panels" test fails;
 * leave the native `title` on and the "no competing tooltip" test fails.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { OverflowMark } from '../../src/renderer/attention/holder-marks.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { makeMark } from './attention-fixtures.js';

beforeEach(() => { __resetAttentionStore(); });
afterEach(() => { __resetAttentionStore(); });

const lines = (): HTMLElement[] => screen.queryAllByTestId(/^attention-popover-line-/);

/**
 * Whether focus counts as keyboard focus (`:focus-visible`). jsdom does not model the difference between
 * a Tab and a click, so each test states which it means.
 */
function focusIsVisible(visible: boolean): () => void {
  const matches = Element.prototype.matches;
  const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
    return sel === ':focus-visible' ? visible : matches.call(this, sel);
  });
  return () => spy.mockRestore();
}

function mount(panelIds: readonly string[]) {
  render(createElement(OverflowMark, { side: 'right', panelIds }));
  return screen.getByTestId('attention-overflow-right');
}

describe('the overflow control’s mark (FR-104)', () => {
  it('opens on hover with only the hidden tabs’ marked panels, as "Tab › Panel", and closes on leave', () => {
    act(() => setAttentionMarks([
      makeMark('h1', 'a', { title: 'Shell', tabTitle: 'Build', raisedAt: 1 }),
      makeMark('h2', 'a', { title: 'Logs', tabTitle: 'Ops', raisedAt: 2 }),
      makeMark('shown', 'a', { title: 'Visible', tabTitle: 'Main' }),
    ]));
    const mark = mount(['h1', 'h2']);
    fireEvent.mouseEnter(mark);
    expect(lines().map((l) => l.getAttribute('data-panel-id'))).toEqual(['h1', 'h2']);
    expect(screen.getAllByTestId('attention-popover-name').map((n) => n.textContent)).toEqual(['Build - Shell', 'Ops - Logs']);
    fireEvent.mouseLeave(mark);
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('opens on keyboard focus and closes on blur or Escape', () => {
    act(() => setAttentionMarks([makeMark('h1', 'a', { tabTitle: 'Build' })]));
    const mark = mount(['h1']);
    expect(mark).toHaveAttribute('tabindex', '0');
    const restore = focusIsVisible(true);
    onTestFinished(restore);
    act(() => mark.focus());
    expect(lines()).toHaveLength(1);
    fireEvent.keyDown(mark, { key: 'Escape' });
    expect(screen.queryByTestId('attention-popover')).toBeNull();
    act(() => mark.blur());
    act(() => mark.focus());
    expect(lines()).toHaveLength(1);
    act(() => mark.blur());
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('a pointer click focuses the mark without opening it, so leaving closes it (review)', () => {
    act(() => setAttentionMarks([makeMark('h1', 'a', { tabTitle: 'Build' })]));
    const mark = mount(['h1']);
    onTestFinished(focusIsVisible(false)); // a click's focus
    fireEvent.mouseEnter(mark);
    act(() => mark.focus());
    fireEvent.mouseLeave(mark);
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('carries no native tooltip to compete with the popover, and keeps its accessible name', () => {
    act(() => setAttentionMarks([makeMark('h1', 'a', { title: 'Shell' })]));
    const mark = mount(['h1']);
    expect(mark).not.toHaveAttribute('title');
    expect(mark).toHaveAttribute('aria-label', expect.stringContaining('Shell'));
  });
});
