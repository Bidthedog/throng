/**
 * REPRO #482 — one changed file makes File Explorer re-list EVERY folder it has ever loaded.
 *
 * ══ WHAT THE USER SEES ══
 *
 * With steady file activity under a project root, throng's main process runs at 60–140% of a core
 * and typing lags. Part of that is the tree: each watcher signal names the folder that changed, and
 * the tree ignores it and re-reads every folder loaded this session — one `throng:files:list` round
 * trip each, every time any file anywhere under the root changes.
 *
 * ══ WHAT SHOULD HAPPEN ══
 *
 * A change in one folder re-reads that folder. Folders nobody touched are not read again.
 *
 * Layer: component — the re-read is decided in the renderer's `use-explorer-data` hook, and a fake
 * bridge counts the `list` calls it makes; no app, daemon or real filesystem is involved. The fixture
 * follows `explorer-collapsed-removal.test.ts`'s.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

const PROJECT = 'project-change-cost';
const ROOT = 'C:/projects/change-cost';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

const LISTINGS: Record<string, FileTreeEntry[]> = {
  '': [entry('a', 'folder'), entry('c', 'folder'), entry('e', 'folder'), entry('top.txt', 'file')],
  a: [entry('b', 'folder'), entry('a.txt', 'file')],
  'a/b': [entry('churn.txt', 'file')],
  c: [entry('d', 'folder')],
  'c/d': [entry('d.txt', 'file')],
  e: [entry('e.txt', 'file')],
};

function fakeBridge() {
  const listed: string[] = [];
  const gone = new Set<string>();
  let fire: ((evt: { relDir: string; relDirs?: string[] }) => void) | undefined;

  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      listed.push(relDir);
      if (gone.has(relDir)) {
        return Promise.resolve({ error: `ENOENT: no such directory, scandir '${relDir}'`, cause: null });
      }
      const entries = (LISTINGS[relDir] ?? []).filter(
        (e) => !gone.has(relDir === '' ? e.name : `${relDir}/${e.name}`),
      );
      return Promise.resolve(
        LISTINGS[relDir] ? { entries } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    exists: vi.fn((relPath: string) => Promise.resolve(!gone.has(relPath))),
    onChange: vi.fn((cb: (evt: { relDir: string; relDirs?: string[] }) => void) => {
      fire = cb;
      return () => {};
    }),
    onWatchFailed: vi.fn(() => () => {}),
  };

  return {
    files,
    listed,
    /** Take a folder away on "disk" — the next listing of it, or of its parent, says so. */
    remove(relPath: string): void {
      gone.add(relPath);
    },
    /**
     * The watcher reports one file changing in `relDir`, exactly as `throng:files:changed` carries
     * it: `ExplorerWatcher` names the directories a report touched (`explorer-watcher.test.ts` pins
     * that it does).
     */
    changed(relDir: string): void {
      act(() => fire?.({ relDir, relDirs: [relDir] }));
    },
    /** A report that could not name its directories — the shape every report had before #482. */
    changedUnnamed(relDir: string): void {
      act(() => fire?.({ relDir }));
    },
  };
}

function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'document.movePath':
          return Promise.resolve({ moved: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
        case 'fileopUndo.set':
          return Promise.resolve({ ok: true } as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the file tree: ${method}`));
      }
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

const wrap = (services: Services, children: ReactNode): ReactElement =>
  createElement(
    ServicesProvider,
    { services },
    createElement(
      WorkspaceProvider,
      { client: services.workspace, activeProjectId: null },
      createElement(
        NotificationProvider,
        null,
        createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, children)),
      ),
    ),
  );

/** Every notice card on screen, with its text, so a failure says WHICH notice appeared. */
const notices = (): string[] => [
  ...(screen.queryByTestId('notices')?.querySelectorAll<HTMLElement>('.notice') ?? []),
].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());

class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = {
      width: 320,
      height: 600,
      top: 0,
      left: 0,
      right: 320,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    `throng.explorer.tree.${PROJECT}`,
    JSON.stringify({ expanded: ['a', 'a/b', 'c', 'c/d', 'e'], selectedId: null }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

async function mountLoaded(): Promise<ReturnType<typeof fakeBridge>> {
  const world = fakeBridge();
  Reflect.set(window, 'throng', {
    files: world.files,
    editor: { isOpen: () => Promise.resolve(false) },
  });
  render(
    wrap(
      fakeServices(),
      createElement(FileTree, { rootFolder: ROOT, projectId: PROJECT, hiddenPaths: [], onHide: vi.fn() }),
    ),
  );
  await screen.findByRole('tree');
  await waitFor(() => {
    for (const dir of Object.keys(LISTINGS)) {
      expect(world.listed, `the tree never loaded "${dir}"`).toContain(dir);
    }
  });
  // Anything still settling from the mount lands before the count starts.
  await act(() => new Promise((r) => setTimeout(r, 0)));
  return world;
}

/**
 * Run `ms` of a fake clock: the watcher's 80 ms coalescing window, and the re-reads it starts, play out
 * without the test sleeping through them. Installed AFTER `mountLoaded()`, whose `findBy*`/`waitFor`
 * polling would wait forever on a fake clock.
 */
async function afterWatcherWindow(ms = 250): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('#482 — a change in one folder re-reads that folder only', () => {
  it('(control) a report that names no directories still re-reads every loaded folder', async () => {
    const world = await mountLoaded();
    const from = world.listed.length;
    vi.useFakeTimers();
    world.changedUnnamed('a/b');
    await afterWatcherWindow();
    expect(world.listed.slice(from).sort()).toEqual(['', 'a', 'a/b', 'c', 'c/d', 'e']);
  });

  it('an EXPANDED folder deleted outside throng still raises its one notice when only its parent is named (041 FR-003a)', async () => {
    const world = await mountLoaded();
    world.remove('c/d');
    const from = world.listed.length;
    vi.useFakeTimers();
    world.changed('c'); // deleting a folder is an event on its PARENT
    await afterWatcherWindow();
    expect(world.listed.slice(from)).toContain('c/d');
    expect(notices(), 'the deleted expanded folder raised no notice').toHaveLength(1);
    expect(world.listed.slice(from).sort(), 'the targeted re-read spread to untouched folders').toEqual([
      'c',
      'c/d',
    ]);
  });

  it('a file changing in a/b re-lists a/b, not every loaded folder', async () => {
    const world = await mountLoaded();
    const from = world.listed.length;
    vi.useFakeTimers();
    world.changed('a/b');
    await afterWatcherWindow();
    expect(world.listed.slice(from)).toContain('a/b');

    expect(
      world.listed.slice(from).sort(),
      'one change in a/b re-listed folders nothing touched',
    ).toEqual(['a/b']);
  });
});
