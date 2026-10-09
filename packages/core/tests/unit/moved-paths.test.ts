import { describe, expect, it } from 'vitest';
import {
  EDITOR_KIND,
  PREVIEW_KIND,
  moveLayoutTabs,
  movedPanelConfig,
  movedPathOf,
  type LayoutNode,
  type Panel,
  type Tab,
} from '@throng/core';

/**
 * 050 R19, FR-016, FR-035 — a panel's config after an in-app move: its paths follow, and the move taking its
 * file out of (or back into) its project sets (or clears) `movedOut`. Shared by main's walk of unheld
 * layouts and the window that holds a layout, for its unmounted panels.
 */

const ROOT_A = 'D:/a';

const editor = (config: Record<string, unknown>, id = 'e1'): Panel => ({
  type: 'panel',
  id,
  originProjectId: 'A',
  title: id,
  kind: EDITOR_KIND,
  config,
});
const preview = (config: Record<string, unknown>, id = 'v1'): Panel => ({ ...editor(config, id), kind: PREVIEW_KIND });
const plain: Panel = { type: 'panel', id: 'p', originProjectId: 'A', title: 'p' };

const out = [{ from: 'D:/a/x.md', to: 'D:/b/in/x.md' }];
const back = [{ from: 'D:/b/in/x.md', to: 'D:/a/x.md' }];
const within = [{ from: 'D:/a/x.md', to: 'D:/a/sub/x.md' }];

describe('movedPathOf', () => {
  it('follows a file, a folder by prefix, and nothing else', () => {
    expect(movedPathOf('D:/a/x.md', out)).toBe('D:/b/in/x.md');
    expect(movedPathOf('D:/a/docs/r.md', [{ from: 'D:\\a\\docs', to: 'D:\\b\\docs' }])).toBe('D:\\b\\docs\\r.md');
    expect(movedPathOf('D:/a/xy.md', out)).toBeNull();
  });
});

describe('movedPanelConfig', () => {
  it('an editor whose file leaves its project: new path, movedOut set, history rewritten', () => {
    const config = movedPanelConfig(
      editor({ filePath: 'D:/a/x.md', encoding: 'utf8', history: { v: 1, entries: [{ filePath: 'D:/a/x.md' }], index: 0 } }),
      out,
      ROOT_A,
    );
    expect(config).toEqual({
      filePath: 'D:/b/in/x.md',
      encoding: 'utf8',
      history: { v: 1, entries: [{ filePath: 'D:/b/in/x.md' }], index: 0 },
      movedOut: true,
    });
  });

  it('a move back inside its project clears the flag', () => {
    expect(movedPanelConfig(editor({ filePath: 'D:/b/in/x.md', movedOut: true }), back, ROOT_A)).toEqual({
      filePath: 'D:/a/x.md',
    });
  });

  it('a move within the project sets no flag', () => {
    expect(movedPanelConfig(editor({ filePath: 'D:/a/x.md' }), within, ROOT_A)).toEqual({ filePath: 'D:/a/sub/x.md' });
  });

  it('a moved-out panel moving again stays moved out', () => {
    expect(
      movedPanelConfig(editor({ filePath: 'D:/b/in/x.md', movedOut: true }), [{ from: 'D:/b/in', to: 'D:/b/out' }], ROOT_A),
    ).toEqual({ filePath: 'D:/b/out/x.md', movedOut: true });
  });

  it("a preview is judged by the file it SHOWS (history's current entry), not a stale filePath", () => {
    const config = movedPanelConfig(
      preview({ filePath: 'D:/a/old.md', history: { v: 1, entries: [{ filePath: 'D:/a/x.md' }], index: 0 } }),
      out,
      ROOT_A,
    );
    expect(config).toEqual({
      filePath: 'D:/a/old.md',
      history: { v: 1, entries: [{ filePath: 'D:/b/in/x.md' }], index: 0 },
      movedOut: true,
    });
  });

  it('only a back entry moved: paths follow, no flag (the shown file did not move)', () => {
    const config = movedPanelConfig(
      editor({ filePath: 'D:/a/y.md', history: { v: 1, entries: [{ filePath: 'D:/a/x.md' }, { filePath: 'D:/a/y.md' }], index: 1 } }),
      out,
      ROOT_A,
    );
    expect(config).toEqual({
      filePath: 'D:/a/y.md',
      history: { v: 1, entries: [{ filePath: 'D:/b/in/x.md' }, { filePath: 'D:/a/y.md' }], index: 1 },
    });
  });

  it('no project root (a sub-workspace panel): paths follow, never flagged', () => {
    expect(movedPanelConfig(editor({ filePath: 'D:/a/x.md' }), out, undefined)).toEqual({ filePath: 'D:/b/in/x.md' });
  });

  // 052 T024 — a replaced editor has let go of its path: the file there is another document's, and a move of it is
  // not this panel's news (the live coordinator never moves a replaced document either).
  it('a replaced editor does not follow a move of the path it was replaced at', () => {
    expect(movedPanelConfig(editor({ filePath: 'D:/a/x.md', replaced: true }), within, ROOT_A)).toBeNull();
  });

  it('untouched, or not an editor/preview: null', () => {
    expect(movedPanelConfig(editor({ filePath: 'D:/a/other.md' }), out, ROOT_A)).toBeNull();
    expect(movedPanelConfig(plain, out, ROOT_A)).toBeNull();
  });
});

describe('moveLayoutTabs', () => {
  const row = (...children: Panel[]): LayoutNode => ({
    type: 'split',
    orientation: 'row',
    children,
    sizes: children.map(() => 1 / children.length),
  });

  it('rewrites the panels a move touches, keeps the rest by identity, and answers null when nothing changed', () => {
    const untouched: Tab = { id: 't2', title: 'T2', root: editor({ filePath: 'D:/a/other.md' }, 'e2') };
    const tabs: Tab[] = [{ id: 't1', title: 'T1', root: row(editor({ filePath: 'D:/a/x.md' }), plain) }, untouched];

    const next = moveLayoutTabs(tabs, out, () => ROOT_A);

    expect(next).not.toBeNull();
    expect(next![1]).toBe(untouched);
    const panels = (next![0]!.root as { children: Panel[] }).children;
    expect(panels[0]!.config).toEqual({ filePath: 'D:/b/in/x.md', movedOut: true });
    expect(panels[1]).toBe(plain);
    expect(moveLayoutTabs(next!, out, () => ROOT_A)).toBeNull();
  });

  // 052 FR-006 (R6) — 044 FR-012's collision rule, inside one saved layout.
  it('a preview moved onto a file another preview in the layout already shows keeps its old path and history', () => {
    const moving = preview({ filePath: 'D:/a/x.md', history: { v: 1, entries: [{ filePath: 'D:/a/x.md' }], index: 0 } }, 'v1');
    const holder = preview({ filePath: 'D:/a/sub/x.md' }, 'v2');
    const tabs: Tab[] = [{ id: 't1', title: 'T1', root: row(moving, holder) }];

    expect(moveLayoutTabs(tabs, within, () => ROOT_A)).toBeNull();
  });

  it('a preview moved in the same batch is not "already there"', () => {
    const first = preview({ filePath: 'D:/a/x.md' }, 'v1');
    const second = preview({ filePath: 'D:/a/sub/x.md' }, 'v2');
    const tabs: Tab[] = [{ id: 't1', title: 'T1', root: row(first, second) }];
    const swap = [
      { from: 'D:/a/x.md', to: 'D:/a/sub/x.md' },
      { from: 'D:/a/sub/x.md', to: 'D:/a/y.md' },
    ];

    const panels = (moveLayoutTabs(tabs, swap, () => ROOT_A)![0]!.root as { children: Panel[] }).children;
    expect(panels[0]!.config).toEqual({ filePath: 'D:/a/sub/x.md' });
    expect(panels[1]!.config).toEqual({ filePath: 'D:/a/y.md' });
  });

  it('an editor on the destination does not hold a preview back (the rule is preview against preview)', () => {
    const tabs: Tab[] = [{ id: 't1', title: 'T1', root: row(preview({ filePath: 'D:/a/x.md' }), editor({ filePath: 'D:/a/sub/x.md' })) }];
    const panels = (moveLayoutTabs(tabs, within, () => ROOT_A)![0]!.root as { children: Panel[] }).children;
    expect(panels[0]!.config).toEqual({ filePath: 'D:/a/sub/x.md' });
  });

  it('a chain of moves ends at the last path; a folder matches by segment; a case-only rename follows', () => {
    const tabs: Tab[] = [{ id: 't1', title: 'T1', root: editor({ filePath: 'D:/a/x.md' }) }];
    const once = moveLayoutTabs(tabs, [{ from: 'D:/a/x.md', to: 'D:/a/b.md' }], () => ROOT_A)!;
    const twice = moveLayoutTabs(once, [{ from: 'D:/a/b.md', to: 'D:/a/c.md' }], () => ROOT_A)!;
    expect((twice[0]!.root as Panel).config).toEqual({ filePath: 'D:/a/c.md' });

    const docsOld: Tab[] = [{ id: 't1', title: 'T1', root: editor({ filePath: 'D:/a/docs-old/r.md' }) }];
    expect(moveLayoutTabs(docsOld, [{ from: 'D:/a/docs', to: 'D:/a/notes' }], () => ROOT_A)).toBeNull();

    const caseOnly = moveLayoutTabs(tabs, [{ from: 'D:/a/x.md', to: 'D:/a/X.md' }], () => ROOT_A)!;
    expect((caseOnly[0]!.root as Panel).config).toEqual({ filePath: 'D:/a/X.md' });
  });
});
