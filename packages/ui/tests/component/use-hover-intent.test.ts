import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHoverIntent } from '../../src/renderer/common/use-hover-intent.js';

/**
 * 069 FR-052 — the hover delay behind a Notifications panel entry's expansion and a cut-off toast's popover. The
 * surfaces' own tests show the delay in use; these pin the hook's rules: one pending reveal, re-arming the same key
 * does not restart the count, and a delay of 0 (`notifications.hoverDelayMs` at its minimum) reveals at once.
 *
 * Layer: component — a React hook needs a render to run.
 */
describe('useHoverIntent (069 FR-052)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals once the delay has passed, counting from the first arm of a key', () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useHoverIntent(250));
    result.current.arm('a', reveal);
    vi.advanceTimersByTime(200);
    result.current.arm('a', reveal);
    vi.advanceTimersByTime(50);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('drops a pending reveal on cancel, and arming another key replaces it', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { result } = renderHook(() => useHoverIntent(250));
    result.current.arm('a', a);
    result.current.cancel('a');
    result.current.arm('b', b);
    result.current.arm('a', a);
    vi.advanceTimersByTime(1000);
    expect(b).not.toHaveBeenCalled();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('reveals at once with a delay of 0', () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useHoverIntent(0));
    result.current.arm('a', reveal);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('drops a pending reveal when the component unmounts', () => {
    const reveal = vi.fn();
    const { result, unmount } = renderHook(() => useHoverIntent(250));
    result.current.arm('a', reveal);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(reveal).not.toHaveBeenCalled();
  });
});
