/**
 * 044 T069 — `preview-open-store` holds main's `openChanged` broadcasts in ONE spelling (FR-012, FR-014,
 * contracts/preview-ipc.md §2 as amended 2026-09-15).
 *
 * Main keys the broadcast by core's `normaliseForCompare`. An editor asks with whatever spelling its
 * own path has — backslashes, mixed case — and must still find the preview; a store that compared raw
 * strings would draw the status-bar button unpressed for a file whose preview is plainly open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normaliseForCompare } from '@throng/core';
import {
  __resetPreviewOpenStore,
  applyPreviewOpenChanged,
  isPreviewOpen,
  listenForPreviewOpenChanged,
} from '../../src/renderer/preview/preview-open-store.js';

afterEach(() => __resetPreviewOpenStore());

describe('preview-open-store', () => {
  it('finds an open preview however the path is spelled', () => {
    applyPreviewOpenChanged({ path: normaliseForCompare('D:\\Proj\\Docs\\README.md'), open: true });
    expect(isPreviewOpen('D:\\Proj\\Docs\\README.md')).toBe(true);
    expect(isPreviewOpen('d:/proj/docs/readme.md')).toBe(true);
    expect(isPreviewOpen('D:/PROJ/DOCS/README.MD/')).toBe(true);
    expect(isPreviewOpen('D:/proj/docs/other.md')).toBe(false);
  });

  it('forgets the file on open: false', () => {
    applyPreviewOpenChanged({ path: 'd:/proj/a.md', open: true });
    applyPreviewOpenChanged({ path: 'd:/proj/a.md', open: false });
    expect(isPreviewOpen('D:/proj/a.md')).toBe(false);
  });

  it('is fed by the bridge’s onOpenChanged, and unsubscribes', () => {
    let listener: ((evt: { path: string; open: boolean }) => void) | null = null;
    const off = vi.fn();
    const stop = listenForPreviewOpenChanged({
      onOpenChanged: (cb) => {
        listener = cb;
        return off;
      },
    });
    listener!({ path: 'd:/proj/b.md', open: true });
    expect(isPreviewOpen('D:\\proj\\b.md')).toBe(true);
    stop();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing without a bridge', () => {
    expect(() => listenForPreviewOpenChanged(undefined)()).not.toThrow();
  });
});
