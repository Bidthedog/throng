/**
 * 012 FR-002, 074 FR-083a — whether this window is the foreground one: a blur caused by focus moving into a frame in
 * the window (an HTML preview's page) is not losing the foreground; a blur with focus leaving the window is.
 *
 * Layer: component — a hook over DOM focus events; `document.hasFocus()` is stood in for, as jsdom has no OS window.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWindowFocus } from '../../src/renderer/workspace/use-window-focus.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('useWindowFocus (FR-083a)', () => {
  it('stays foreground when the blur is focus moving into a frame in this window', () => {
    vi.useFakeTimers();
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { result } = renderHook(() => useWindowFocus());
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frame.focus();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.runAllTimers();
    });
    expect(result.current).toBe(true);
    // The window then loses the OS foreground with the frame still focused.
    hasFocus.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.runAllTimers();
    });
    expect(result.current).toBe(false);
  });

  it('goes background at once on a blur with no frame focused, and foreground on focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { result } = renderHook(() => useWindowFocus());
    act(() => window.dispatchEvent(new Event('blur')));
    expect(result.current).toBe(false);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe(true);
  });
});
