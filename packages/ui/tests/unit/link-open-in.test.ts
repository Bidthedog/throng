/**
 * 045 FR-170 row 2 — the Link menu's **Open In ▸ <editor name>** rows, and what each Open In row
 * performs (T277).
 *
 * `buildLinkMenu` (core) draws one named row per entry of `ctx.openEditors`; which editors those are
 * is this module's question, answered from the window's layout and the editor store:
 *
 *   - every EDITOR panel in this window, in every tab, in layout order, named by its panel title;
 *   - except one already showing the link's target — opening a file into the editor that already
 *     shows it is meaningless, so the row is absent rather than a no-op;
 *   - that comparison normalises separators and case, because the path a store holds and the path
 *     main resolved genuinely differ in both while naming the same file (#229's trap).
 */
import { describe, expect, it } from 'vitest';
import type { LayoutNode, Panel, WorkspaceLayout } from '@throng/core';
import { linkOpenInEditors } from '../../src/renderer/links/link-open-in.js';

const panel = (id: string, title: string, kind?: string): Panel =>
  ({ type: 'panel', id, originProjectId: 'p', title, ...(kind ? { kind } : {}) }) as Panel;

const split = (...children: LayoutNode[]): LayoutNode => ({
  type: 'split',
  orientation: 'row',
  children,
  sizes: children.map(() => 1 / children.length),
});

const layout = (...roots: LayoutNode[]): WorkspaceLayout => ({
  projectId: 'p',
  schemaVersion: 1,
  activeTabId: 't1',
  tabs: roots.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root })),
});

const held: Record<string, string> = {
  e1: 'C:/proj/notes.md',
  e2: 'C:\\proj\\src\\foo.ts',
  e3: 'C:/proj/README.md',
};
const heldPath = (id: string): string | undefined => held[id];

describe('linkOpenInEditors — one Open In row per open editor, by name (FR-170 row 2)', () => {
  it('lists every editor panel in every tab, in layout order, and nothing that is not an editor', () => {
    const ws = layout(
      split(panel('e1', 'Notes', 'editor'), panel('term', 'Terminal', 'terminal')),
      split(panel('e3', 'Readme', 'editor'), panel('blank', 'Panel 4')),
    );
    expect(linkOpenInEditors(ws, { heldPath })).toEqual([
      { id: 'e1', name: 'Notes' },
      { id: 'e3', name: 'Readme' },
    ]);
  });

  it('leaves out an editor already showing the target — separators and case do not matter', () => {
    const ws = layout(split(panel('e1', 'Notes', 'editor'), panel('e2', 'Foo', 'editor')));
    expect(linkOpenInEditors(ws, { heldPath, targetPath: 'c:/PROJ/src/foo.ts' })).toEqual([
      { id: 'e1', name: 'Notes' },
    ]);
  });

  it('with no target known yet, lists every editor', () => {
    const ws = layout(split(panel('e1', 'Notes', 'editor'), panel('e2', 'Foo', 'editor')));
    expect(linkOpenInEditors(ws, { heldPath, targetPath: null }).map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('no layout, no rows', () => {
    expect(linkOpenInEditors(null, { heldPath })).toEqual([]);
  });
});
