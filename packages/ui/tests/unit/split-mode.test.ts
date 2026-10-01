/**
 * 048 FR-021, FR-022, FR-025 — the split-mode store: which panel (if any) is in split mode, and the
 * one-at-a-time rule. The keyboard behaviour that drives it is `tests/component/split-mode.test.ts`.
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSplitMode,
  endSplitMode,
  getSplitModePanel,
  startSplitMode,
  subscribeSplitMode,
  useSplitMode,
} from '../../src/renderer/workspace/split-mode.js';

function Probe({ id }: { id: string }): ReactElement {
  return createElement('span', null, useSplitMode(id) ? 'on' : 'off');
}
const shown = (id: string): string => renderToStaticMarkup(createElement(Probe, { id }));

afterEach(() => __resetSplitMode());

describe('split-mode store (048)', () => {
  it('is idle to begin with', () => {
    expect(getSplitModePanel()).toBeNull();
    expect(shown('p1')).toBe('<span>off</span>');
  });

  it('startSplitMode puts exactly that panel in split mode', () => {
    startSplitMode('p1');
    expect(getSplitModePanel()).toBe('p1');
    expect(shown('p1')).toBe('<span>on</span>');
    expect(shown('p2')).toBe('<span>off</span>');
  });

  it('endSplitMode ends it', () => {
    startSplitMode('p1');
    endSplitMode();
    expect(getSplitModePanel()).toBeNull();
    expect(shown('p1')).toBe('<span>off</span>');
  });

  it('a restart on the same panel does not stack — one end ends it (FR-025)', () => {
    startSplitMode('p1');
    startSplitMode('p1');
    endSplitMode();
    expect(getSplitModePanel()).toBeNull();
  });

  it('starting on another panel moves split mode there — never two at once', () => {
    startSplitMode('p1');
    startSplitMode('p2');
    expect(shown('p1')).toBe('<span>off</span>');
    expect(shown('p2')).toBe('<span>on</span>');
  });

  it('notifies subscribers on start and end, and not for an end while idle', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSplitMode(listener);
    endSplitMode();
    expect(listener).not.toHaveBeenCalled();
    startSplitMode('p1');
    endSplitMode();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    startSplitMode('p1');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
