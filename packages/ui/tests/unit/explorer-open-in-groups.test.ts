/**
 * #483 — the File Explorer's Open In submenu is drawn in five divided groups: the OS reveal alone, the
 * editor targets with Other Tab, the previews, Terminal, Search. The dividers come from `withDividers`,
 * which now also splits a section wherever an item's `group` changes.
 *
 * Layer: unit — the pure builder and the pure divider derivation the menu renders from.
 */
import { describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS, type PreviewAffordance } from '@throng/core';
import { buildContextMenuItems, type ContextMenuOps } from '../../src/renderer/explorer/context-menu-items.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import type { MenuAction, MenuItem } from '../../src/renderer/workspace/context-menu.js';

const noop = (): void => {};
const ops = new Proxy({}, { get: () => noop }) as unknown as ContextMenuOps;
const markdown = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.find((p) => p.id === 'markdown')!;

/** The drawn rows, as labels with `---` for each divider. */
const drawn = (rows: MenuItem[]) => rows.map((r) => ('separator' in r && !('section' in r) ? '---' : (r as MenuAction).label));

function openIn(kind: 'file' | 'folder'): MenuAction[] {
  const items = buildContextMenuItems({
    node: { relPath: kind === 'file' ? 'README.md' : 'docs', kind },
    selectedRelPaths: [],
    clipboard: null,
    ops,
    openIn:
      kind === 'file'
        ? [
            { label: 'Last Active Editor', section: 'navigate', onClick: noop },
            { label: 'New Editor', section: 'navigate', onClick: noop },
            { label: 'Other Tab', section: 'navigate', submenu: [] },
          ]
        : undefined,
    preview:
      kind === 'file'
        ? {
            affordance: { state: 'enabled', provider: markdown } satisfies PreviewAffordance,
            openLastActive: noop,
            openNew: noop,
            lastPreviewTitle: null,
          }
        : undefined,
    flavours: [{ id: 'pwsh', label: 'PowerShell' }] as never,
  } as never);
  return items.find((i) => i.label === 'Open In')!.submenu!;
}

describe('Open In (#483)', () => {
  it('divides a file’s submenu into the five groups, in order', () => {
    expect(drawn(withDividers(openIn('file')))).toEqual([
      'OS File Explorer',
      '---',
      'Last Active Editor',
      'New Editor',
      'Other Tab',
      '---',
      'Last Preview Panel',
      'New Preview Panel',
      '---',
      'Terminal',
      '---',
      'Search',
    ]);
  });

  it('a folder’s submenu has one divider between each of its three groups, none doubled or trailing', () => {
    expect(drawn(withDividers(openIn('folder')))).toEqual(['OS File Explorer', '---', 'Terminal', '---', 'Search']);
  });
});

describe('withDividers inside one section', () => {
  it('draws no divider for items with no group, as before', () => {
    const rows = withDividers([
      { label: 'A', section: 'navigate' },
      { label: 'B', section: 'navigate' },
    ]);
    expect(drawn(rows)).toEqual(['A', 'B']);
  });
});
