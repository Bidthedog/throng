/**
 * The path STORAGE canon, both branches, on either host (#229).
 *
 * The separator is a parameter precisely so this file can assert the Windows rule on a POSIX runner
 * and vice versa — the acceptance criteria ask for "a Windows root and a POSIX root", and a test
 * that could only exercise the host's own branch would be half a test on every machine.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalisePersistedPaths,
  isCanonicalPath,
  toCanonicalPath,
  type Panel,
  type WorkspaceLayout,
} from '../../src/index.js';

const WIN = '\\' as const;
const POSIX = '/' as const;

describe('toCanonicalPath', () => {
  it('rewrites the mixed form the explorer tree produces (Windows)', () => {
    expect(toCanonicalPath('D:\\git\\throng/SECURITY.md', WIN)).toBe('D:\\git\\throng\\SECURITY.md');
    expect(toCanonicalPath('D:\\git\\throng/a/b/c.txt', WIN)).toBe('D:\\git\\throng\\a\\b\\c.txt');
  });

  it('leaves an already-native Windows path alone', () => {
    expect(toCanonicalPath('D:\\git\\throng\\SECURITY.md', WIN)).toBe('D:\\git\\throng\\SECURITY.md');
  });

  it('preserves a UNC root rather than collapsing its leading pair', () => {
    expect(toCanonicalPath('\\\\server\\share/notes.md', WIN)).toBe('\\\\server\\share\\notes.md');
  });

  it('is a no-op on POSIX, where a backslash is part of a FILENAME', () => {
    // Rewriting this would rename the file, not normalise the path.
    expect(toCanonicalPath('/home/u/odd\\name.txt', POSIX)).toBe('/home/u/odd\\name.txt');
    expect(toCanonicalPath('/home/u/project/SECURITY.md', POSIX)).toBe(
      '/home/u/project/SECURITY.md',
    );
  });

  it('passes an empty path through', () => {
    expect(toCanonicalPath('', WIN)).toBe('');
    expect(toCanonicalPath('', POSIX)).toBe('');
  });

  it('isCanonicalPath agrees with toCanonicalPath', () => {
    expect(isCanonicalPath('D:\\a\\b.txt', WIN)).toBe(true);
    expect(isCanonicalPath('D:\\a/b.txt', WIN)).toBe(false);
    expect(isCanonicalPath('/home/u/a\\b.txt', POSIX)).toBe(true);
  });
});

function layoutWith(panel: Partial<Panel>): WorkspaceLayout {
  const leaf: Panel = {
    type: 'panel',
    id: 'p1',
    originProjectId: 'proj',
    title: 'Panel 1',
    ...panel,
  };
  return {
    projectId: 'proj',
    schemaVersion: 3,
    tabs: [{ id: 't1', title: 'Tab 1', root: leaf, activePanelId: 'p1' }],
    activeTabId: 't1',
  };
}

const onlyPanel = (layout: WorkspaceLayout): Panel => layout.tabs[0].root as Panel;

describe('canonicalisePersistedPaths', () => {
  it('canonicalises an editor panel’s filePath', () => {
    const out = canonicalisePersistedPaths(
      layoutWith({ kind: 'editor', config: { filePath: 'D:\\p/notes.md' } }),
      WIN,
    );
    expect(onlyPanel(out).config?.filePath).toBe('D:\\p\\notes.md');
  });

  it('canonicalises a terminal panel’s startDirectory and lastCwd', () => {
    const out = canonicalisePersistedPaths(
      layoutWith({
        kind: 'terminal',
        config: { startDirectory: 'D:\\p/src' },
        terminalMemory: { lastCwd: 'D:\\p/src/deep' },
      }),
      WIN,
    );
    expect(onlyPanel(out).config?.startDirectory).toBe('D:\\p\\src');
    expect(onlyPanel(out).terminalMemory?.lastCwd).toBe('D:\\p\\src\\deep');
  });

  it('leaves a non-string config value exactly as it was', () => {
    const out = canonicalisePersistedPaths(
      layoutWith({ kind: 'editor', config: { filePath: 42, zoom: 1.5 } }),
      WIN,
    );
    expect(onlyPanel(out).config?.filePath).toBe(42);
    expect(onlyPanel(out).config?.zoom).toBe(1.5);
  });

  it('does not mutate the caller’s layout', () => {
    const input = layoutWith({ kind: 'editor', config: { filePath: 'D:\\p/notes.md' } });
    canonicalisePersistedPaths(input, WIN);
    expect(onlyPanel(input).config?.filePath).toBe('D:\\p/notes.md');
  });

  it('returns the SAME layout by identity when nothing needed rewriting', () => {
    const input = layoutWith({ kind: 'editor', config: { filePath: 'D:\\p\\notes.md' } });
    expect(canonicalisePersistedPaths(input, WIN)).toBe(input);
  });

  it('walks into split trees', () => {
    const base = layoutWith({ kind: 'editor', config: { filePath: 'D:\\p/one.md' } });
    const other: Panel = {
      type: 'panel',
      id: 'p2',
      originProjectId: 'proj',
      title: 'Panel 2',
      kind: 'editor',
      config: { filePath: 'D:\\p/two.md' },
    };
    const split: WorkspaceLayout = {
      ...base,
      tabs: [
        {
          ...base.tabs[0],
          root: {
            type: 'split',
            orientation: 'row',
            children: [base.tabs[0].root, other],
            sizes: [0.5, 0.5],
          },
        },
      ],
    };

    const out = canonicalisePersistedPaths(split, WIN);
    const root = out.tabs[0].root as { children: Panel[] };
    expect(root.children[0].config?.filePath).toBe('D:\\p\\one.md');
    expect(root.children[1].config?.filePath).toBe('D:\\p\\two.md');
  });
});
