/**
 * v1 review (#732) — the one Copy as ▸ submenu every menu offering a copy in a named format builds. The plain Copy beside
 * it runs the preference; this offers each format by name.
 *
 * Layer: unit — `copyAsSubmenu` is a pure builder.
 */
import { describe, expect, it, vi } from 'vitest';
import { copyAsSubmenu } from '../../src/renderer/common/copy-as-menu.js';

describe('copyAsSubmenu', () => {
  it('is one Copy as row with the copy icon, holding Rich Text then Plain Text, in its section and group', () => {
    const row = copyAsSubmenu({ section: 'content', group: 'clipboard', copy: vi.fn() });
    expect(row).toMatchObject({ label: 'Copy as', icon: 'copy', section: 'content', group: 'clipboard' });
    expect(row.disabled).toBeUndefined();
    expect(row.submenu?.map((leaf) => [leaf.label, leaf.icon, leaf.section, leaf.group, leaf.testId])).toEqual([
      ['Rich Text', 'copy', 'content', 'clipboard', 'menu-item-Copy as Rich Text'],
      ['Plain Text', 'copy', 'content', 'clipboard', 'menu-item-Copy as Plain Text'],
    ]);
  });

  it('runs each leaf in its own format', () => {
    const copy = vi.fn();
    const leaves = copyAsSubmenu({ section: 'content', copy }).submenu ?? [];
    for (const leaf of leaves) leaf.onClick?.();
    expect(copy.mock.calls).toEqual([['rich'], ['plain']]);
  });

  it('disables the parent and both leaves together', () => {
    const row = copyAsSubmenu({ section: 'content', disabled: true, copy: vi.fn() });
    expect(row.disabled).toBe(true);
    expect(row.submenu?.map((leaf) => leaf.disabled)).toEqual([true, true]);
  });
});
