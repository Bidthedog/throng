/**
 * 050 T025 (FR-025a, contracts/ui-surfaces §5) — the context menu's Paste label names what will land.
 *
 * `pasteLabel(clipboard, activeProjectId, projectName)` is pure, so it is proven here rather than by
 * opening a menu: one item → its name, several → the count (digit-grouped, constitution 4.5.0), and a
 * ` from <project>` suffix only when the items came from a project other than the active one. No other
 * indicator of a pending clipboard exists (FR-025a), so this string IS the whole feature surface.
 */
import { describe, expect, it } from 'vitest';
import { formatGrouped } from '@throng/core';
import { pasteLabel } from '../../src/renderer/explorer/context-menu-items.js';

const item = (absPath: string, projectId = 'p1') => ({ absPath, projectId, projectRoot: 'C:/a' });
const clip = (mode: 'cut' | 'copy', ...items: ReturnType<typeof item>[]) => ({ mode, items });
const nameOf = (id: string): string | undefined => (id === 'p2' ? 'Other' : 'Mine');

describe('pasteLabel (FR-025a)', () => {
  it('is plain `Paste` with nothing on the clipboard', () => {
    expect(pasteLabel(null, 'p1', nameOf)).toBe('Paste');
  });

  it('names a single item from the active project', () => {
    expect(pasteLabel(clip('copy', item('C:/a/config.json')), 'p1', nameOf)).toBe('Paste "config.json"');
  });

  it('names the leaf of a Windows-spelled path too', () => {
    expect(pasteLabel(clip('cut', item('C:\\a\\src\\main.ts')), 'p1', nameOf)).toBe('Paste "main.ts"');
  });

  it('counts several items', () => {
    const c = clip('copy', item('C:/a/x'), item('C:/a/y'), item('C:/a/z'));
    expect(pasteLabel(c, 'p1', nameOf)).toBe('Paste 3 items');
  });

  it('digit-groups the count through the one formatter', () => {
    const many = Array.from({ length: 1000 }, (_, i) => item(`C:/a/f${i}`));
    expect(pasteLabel(clip('copy', ...many), 'p1', nameOf)).toBe(`Paste ${formatGrouped(1000)} items`);
    // Anti-vacuity: the grouped form really differs from the bare digits in the default locale.
    expect(formatGrouped(1000)).not.toBe('1000');
  });

  it('adds `from <project>` when the items came from another project', () => {
    expect(pasteLabel(clip('cut', item('C:/b/config.json', 'p2')), 'p1', nameOf)).toBe(
      'Paste "config.json" from Other',
    );
    const two = clip('copy', item('C:/b/x', 'p2'), item('C:/b/y', 'p2'));
    expect(pasteLabel(two, 'p1', nameOf)).toBe('Paste 2 items from Other');
  });

  it('omits the suffix when the source project’s name is unknown rather than printing a blank', () => {
    expect(pasteLabel(clip('copy', item('C:/b/x', 'gone')), 'p1', () => undefined)).toBe('Paste "x"');
  });
});
