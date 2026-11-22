/**
 * Print Preview maximises and restores, and the next Print Preview opens at the size and maximised state the last
 * one closed with (maintainer, 2026-11-22; 075 FR-064). Restore returns to the size the window had before it was
 * maximised, so what is remembered of a maximised window is that size, not the screen.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrintPreviewPlacement, PrintPreviewPlacementFile, PRINT_PREVIEW_DEFAULT_SIZE, PRINT_PREVIEW_MIN_SIZE } from '../../src/main/print-preview-placement.js';

function closing(state: { maximised: boolean; bounds: { width: number; height: number }; normal: { width: number; height: number } }) {
  return {
    isMaximized: () => state.maximised,
    getBounds: () => ({ x: 0, y: 0, ...state.bounds }),
    getNormalBounds: () => ({ x: 0, y: 0, ...state.normal }),
    isDestroyed: () => false,
  };
}

describe('Print Preview placement memory', () => {
  it('the first Print Preview opens at the default size, not maximised', () => {
    const memory = new PrintPreviewPlacement();
    expect(memory.next()).toEqual({ size: PRINT_PREVIEW_DEFAULT_SIZE, maximised: false });
  });

  it('a window resized and closed opens next at that size', () => {
    const memory = new PrintPreviewPlacement();
    memory.remember(closing({ maximised: false, bounds: { width: 1180, height: 820 }, normal: { width: 1180, height: 820 } }));
    expect(memory.next()).toEqual({ size: { width: 1180, height: 820 }, maximised: false });
  });

  it('a window closed maximised opens next maximised, and restores to the size it had before maximising', () => {
    const memory = new PrintPreviewPlacement();
    memory.remember(closing({ maximised: true, bounds: { width: 2560, height: 1400 }, normal: { width: 1100, height: 780 } }));
    expect(memory.next()).toEqual({ size: { width: 1100, height: 780 }, maximised: true });
  });

  it('a remembered size is never below the window’s minimum (FR-069)', () => {
    const memory = new PrintPreviewPlacement();
    memory.remember(closing({ maximised: false, bounds: { width: 300, height: 200 }, normal: { width: 300, height: 200 } }));
    const next = memory.next();
    expect(next.size).toEqual(PRINT_PREVIEW_MIN_SIZE);
  });

  // Maintainer, 2026-11-22 — kept between throng sessions, not only between opens.
  it('a placement written as one session closes it is the next session’s first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-pp-'));
    try {
      const file = new PrintPreviewPlacementFile(join(dir, 'print-preview-window.json'));
      const before = new PrintPreviewPlacement();
      before.remember(closing({ maximised: true, bounds: { width: 2560, height: 1400 }, normal: { width: 1100, height: 780 } }));
      await file.write(before.snapshot());

      const after = new PrintPreviewPlacement();
      after.restore(await file.read());
      expect(after.next()).toEqual({ size: { width: 1100, height: 780 }, maximised: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing or damaged file opens at the default size', () => {
    const memory = new PrintPreviewPlacement();
    memory.restore(undefined);
    memory.restore({ width: 'wide', height: -1 });
    expect(memory.next()).toEqual({ size: PRINT_PREVIEW_DEFAULT_SIZE, maximised: false });
  });
});
