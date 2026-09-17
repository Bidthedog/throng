import { describe, it, expect } from 'vitest';
import { canonicalisePersistedPaths, previewPathOf } from '../../src/workspace/persisted-paths.js';
import type { LayoutNode, Panel, PanelConfig, WorkspaceLayout } from '../../src/workspace/model.js';

/**
 * 044 T013 — the persisted paths a preview and a navigation history add (FR-066 – FR-068, FR-109).
 *
 * A preview's `config.filePath` needs no new code: it uses the editor's key, which is exactly why the
 * key was reused (FR-068). The history's entries do — they are the first absolute paths in a layout
 * blob that sit inside an ARRAY — and `previewPathOf` is the one reader of "which file is this
 * persisted preview?", so the attach path, the restore filter and the unloaded-layout purge cannot
 * disagree about it.
 */

const WIN = '\\' as const;
const POSIX = '/' as const;

const panel = (id: string, kind: string, config: PanelConfig): Panel => ({
  type: 'panel',
  id,
  originProjectId: 'proj',
  title: id,
  kind,
  config,
});

const layoutOf = (root: LayoutNode): WorkspaceLayout => ({
  projectId: 'proj',
  schemaVersion: 3,
  tabs: [{ id: 't1', title: 'Tab 1', root }],
  activeTabId: 't1',
});

const configOf = (l: WorkspaceLayout, index = 0): PanelConfig => {
  const root = l.tabs[0].root;
  const node = root.type === 'split' ? root.children[index] : root;
  return (node as Panel).config!;
};

describe('canonicalisePersistedPaths — preview and history paths (FR-068, FR-109)', () => {
  it("canonicalises a preview's config.filePath through the existing key", () => {
    const l = layoutOf(panel('pv', 'preview', { filePath: 'D:\\p/docs/a.md' }));
    expect(configOf(canonicalisePersistedPaths(l, WIN)).filePath).toBe('D:\\p\\docs\\a.md');
  });

  it('canonicalises every history entry on an editor AND a preview, keeping viewState and index', () => {
    const l = layoutOf({
      type: 'split',
      orientation: 'row',
      sizes: [0.5, 0.5],
      children: [
        panel('ed', 'editor', {
          filePath: 'D:\\p/src/b.ts',
          history: { v: 1, entries: [{ filePath: 'D:\\p/src/a.ts' }, { filePath: 'D:\\p/src/b.ts' }], index: 1 },
        }),
        panel('pv', 'preview', {
          filePath: 'D:/p/README.md',
          history: {
            v: 1,
            entries: [{ filePath: 'D:/p/README.md', viewState: { top: 40 } }, { filePath: 'D:\\p\\docs/guide.md' }],
            index: 0,
          },
        }),
      ],
    });
    const out = canonicalisePersistedPaths(l, WIN);
    expect(configOf(out, 0)).toEqual({
      filePath: 'D:\\p\\src\\b.ts',
      history: { v: 1, entries: [{ filePath: 'D:\\p\\src\\a.ts' }, { filePath: 'D:\\p\\src\\b.ts' }], index: 1 },
    });
    expect(configOf(out, 1)).toEqual({
      filePath: 'D:\\p\\README.md',
      history: {
        v: 1,
        entries: [{ filePath: 'D:\\p\\README.md', viewState: { top: 40 } }, { filePath: 'D:\\p\\docs\\guide.md' }],
        index: 0,
      },
    });
  });

  it('never mutates the caller’s layout', () => {
    const history = { v: 1, entries: [{ filePath: 'D:/p/a.md' }], index: 0 };
    const l = layoutOf(panel('pv', 'preview', { history }));
    canonicalisePersistedPaths(l, WIN);
    expect(history.entries[0].filePath).toBe('D:/p/a.md');
  });

  it('leaves non-string and malformed values exactly as they are', () => {
    const history = {
      v: 1,
      entries: [{ filePath: 42 }, null, 'D:/p/raw.md', { filePath: '' }, { viewState: 1 }, { filePath: 'D:/p/ok.md' }],
      index: 'x',
    };
    const out = canonicalisePersistedPaths(layoutOf(panel('pv', 'preview', { history })), WIN);
    expect(configOf(out).history).toEqual({
      v: 1,
      entries: [{ filePath: 42 }, null, 'D:/p/raw.md', { filePath: '' }, { viewState: 1 }, { filePath: 'D:\\p\\ok.md' }],
      index: 'x',
    });
    for (const odd of [null, 'text', 7, { entries: 'no' }, { entries: [{ filePath: 9 }] }]) {
      const l = layoutOf(panel('pv', 'preview', { history: odd }));
      expect(canonicalisePersistedPaths(l, WIN)).toBe(l);
    }
  });

  it('returns the layout by identity when every history path is already canonical', () => {
    const l = layoutOf(
      panel('pv', 'preview', {
        filePath: 'D:\\p\\a.md',
        history: { v: 1, entries: [{ filePath: 'D:\\p\\a.md' }], index: 0 },
      }),
    );
    expect(canonicalisePersistedPaths(l, WIN)).toBe(l);
  });

  it('is a no-op on POSIX, history included', () => {
    const l = layoutOf(panel('pv', 'preview', { history: { v: 1, entries: [{ filePath: '/home/u/odd\\name.md' }], index: 0 } }));
    expect(canonicalisePersistedPaths(l, POSIX)).toBe(l);
  });
});

describe('previewPathOf (FR-066, FR-067)', () => {
  it("is the persisted history's current entry when the history is present and non-empty", () => {
    expect(
      previewPathOf({
        filePath: 'C:/p/stale.md',
        history: { v: 1, entries: [{ filePath: 'C:/p/a.md' }, { filePath: 'C:/p/b.md' }], index: 0 },
      }),
    ).toBe('C:/p/a.md');
  });

  it('falls back to filePath when the history is absent, empty or unreadable', () => {
    expect(previewPathOf({ filePath: 'C:/p/a.md' })).toBe('C:/p/a.md');
    expect(previewPathOf({ filePath: 'C:/p/a.md', history: { v: 1, entries: [], index: -1 } })).toBe('C:/p/a.md');
    const unreadable = { v: 9, entries: [{ filePath: 'C:/p/z.md' }], index: 0 };
    expect(previewPathOf({ filePath: 'C:/p/a.md', history: unreadable as never })).toBe('C:/p/a.md');
  });

  it('reads the history exactly as attach does: bad entries dropped, index clamped', () => {
    const history = { v: 1, entries: [{ filePath: 'C:/p/a.md' }, { filePath: 3 }, { filePath: 'C:/p/c.md' }], index: 99 };
    expect(previewPathOf({ history: history as never })).toBe('C:/p/c.md');
  });

  it('is undefined with neither, and for no config at all', () => {
    expect(previewPathOf({})).toBeUndefined();
    expect(previewPathOf({ filePath: '' })).toBeUndefined();
    expect(previewPathOf(undefined)).toBeUndefined();
  });
});
