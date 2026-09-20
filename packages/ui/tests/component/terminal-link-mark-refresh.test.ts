import { renderHook } from '@testing-library/react';
import { DEFAULT_APP_SETTINGS, type EditorLinkSettings } from '@throng/core';
import { describe, expect, it } from 'vitest';
import { linkMarkRefreshKey, useLinkMarkRefresh } from '../../src/renderer/terminal/link-mark-refresh.js';

/**
 * 045 FR-178, FR-159, FR-060 / SC-008 (review round four, terminal I3) — a link-settings change
 * repaints a terminal's AT-REST marks with nothing remounted.
 *
 * `LinkViewMarks.refresh()` was declared for exactly this ("for a change the rows cannot show — a
 * setting") and nothing in the repository called it, so the only trigger left was xterm rendering.
 * At an idle prompt no row changes, so clearing `editor.links.detectInTerminals` left every detected
 * path on screen still dashed-underlined while the hover — which reads the switch per row — correctly
 * did nothing. The marks and the hover disagreed until output arrived.
 *
 * The pass itself is already covered (`terminal-link-view-marks.test.ts`). What was missing is the
 * TRIGGER, which is these two pieces: a key that changes whenever the scan would, and an effect that
 * asks for a pass when it does.
 */

const links = (over: Partial<EditorLinkSettings> = {}): EditorLinkSettings => ({
  ...structuredClone(DEFAULT_APP_SETTINGS.editor.links),
  ...over,
});

describe('linkMarkRefreshKey — changes exactly when the next pass would differ (FR-178)', () => {
  it('is stable for equal settings', () => {
    const a = linkMarkRefreshKey({ links: () => links(), detect: () => true });
    const b = linkMarkRefreshKey({ links: () => links(), detect: () => true });
    expect(a).toBe(b);
  });

  it('changes when the detection switch moves (FR-060, SC-008)', () => {
    const on = linkMarkRefreshKey({ links: () => links(), detect: () => true });
    const off = linkMarkRefreshKey({ links: () => links(), detect: () => false });
    expect(off).not.toBe(on);
  });

  it('changes when a known extension is added or removed (FR-178)', () => {
    const base = linkMarkRefreshKey({ links: () => links(), detect: () => true });
    const added = linkMarkRefreshKey({
      links: () => links({ knownFileExtensions: { added: ['throng'], removed: [] } }),
      detect: () => true,
    });
    const removed = linkMarkRefreshKey({
      links: () => links({ knownFileExtensions: { added: [], removed: ['ts'] } }),
      detect: () => true,
    });
    expect(added).not.toBe(base);
    expect(removed).not.toBe(base);
    expect(added).not.toBe(removed);
  });

  it('changes when the protocol allowlist changes (FR-159)', () => {
    const base = linkMarkRefreshKey({ links: () => links(), detect: () => true });
    const wider = linkMarkRefreshKey({ links: () => links({ protocolAllowlist: ['mailto', 'zoommtg'] }), detect: () => true });
    expect(wider).not.toBe(base);
  });
});

describe('useLinkMarkRefresh — a changed key asks for a pass, nothing remounted (FR-178)', () => {
  it('asks for one pass on mount and one per change, and none for an unchanged key', () => {
    let passes = 0;
    const marks = { refresh: () => { passes += 1; } };
    const { rerender } = renderHook(({ key }: { key: string }) => useLinkMarkRefresh(() => marks, key), {
      initialProps: { key: 'a' },
    });
    expect(passes).toBe(1);

    rerender({ key: 'a' });
    expect(passes, 'an unchanged key must not repaint on every render').toBe(1);

    rerender({ key: 'b' });
    expect(passes).toBe(2);
  });

  it('a terminal whose marks are not built yet is not an error', () => {
    expect(() =>
      renderHook(({ key }: { key: string }) => useLinkMarkRefresh(() => null, key), { initialProps: { key: 'a' } }),
    ).not.toThrow();
  });
});
