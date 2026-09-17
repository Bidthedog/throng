/**
 * REPRO — a folder the user COLLAPSED raises "Couldn't list the contents of …" when it is deleted.
 *
 * ══ WHAT THE USER SEES ══
 *
 * They open a folder in Files & Folders, look at it, collapse it (or collapse everything), and get on
 * with something else. Later the folder goes — a `git worktree remove`, a branch switch, a cleanup
 * script. An error notice appears: "Couldn't list the contents of <folder> — It could not be found.
 * It may have been moved, renamed or deleted." Nothing on screen was showing that folder, and the user
 * never asked to list it, so the notice reads as a ghost with no context. Seen in the installed
 * build's diagnostics log on 2026-09-07 and 2026-09-11, for four different folders in three projects.
 *
 * ══ WHY ══
 *
 * Collapsing hides a folder but never forgets it: `childrenMap` in `use-explorer-data.ts` only grows,
 * and the watcher's `reloadDirs()` re-reads every folder loaded this session, open or not, through the
 * non-silent path that raises a notice when the read fails.
 *
 * ══ WHAT GOVERNS IT ══
 *
 * 041 US1 / FR-003a REQUIRE one notice when an EXPANDED folder is removed outside throng, and the last
 * case below keeps that honest. Nothing requires one for a collapsed folder: 004 FR-010 scopes the
 * tree's automatic reflection to the currently-visible (expanded) parts, 004 FR-011 says a collapsed
 * subtree is re-read on expansion, and 026 FR-022 keeps listing failures for USER-INITIATED listings.
 *
 * The fixture is `explorer-storm-suppression.test.ts`'s, copied rather than imported because it is
 * not exported: a bridge over a filesystem the test can take folders out of, whose `exists` agrees
 * with `list`, and a watcher the test fires.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const PROJECT = 'project-collapsed';
const ROOT = 'C:/projects/collapsed';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

const LISTINGS: Record<string, FileTreeEntry[]> = {
  '': [entry('a', 'folder'), entry('top.txt', 'file')],
  a: [entry('b', 'folder')],
  'a/b': [entry('leaf.txt', 'file')],
};

function fakeBridge() {
  const gone = new Set<string>();
  const listed: string[] = [];
  let fire: (() => void) | undefined;

  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      listed.push(relDir);
      if (gone.has(relDir)) {
        return Promise.resolve({ error: `ENOENT: no such directory, scandir '${relDir}'`, cause: null });
      }
      const entries = LISTINGS[relDir];
      return Promise.resolve(
        entries ? { entries: [...entries] } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    exists: vi.fn((relPath: string) => Promise.resolve(!gone.has(relPath))),
    onChange: vi.fn((cb: () => void) => {
      fire = cb;
      return () => {};
    }),
    onWatchFailed: vi.fn(() => () => {}),
  };

  return {
    files,
    listed,
    /** Take these paths away and tell the watcher, exactly as a real removal does. */
    remove(...paths: string[]): void {
      for (const p of paths) gone.add(p);
      act(() => fire?.());
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

let world: ReturnType<typeof fakeBridge>;

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
    JSON.stringify({ expanded: ['a', 'a/b'], selectedId: null }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

/** Mount a healthy tree and wait until it has descended to `a/b`, so `a/b` is LOADED. */
async function mountAndDescend(): Promise<HTMLElement> {
  world = fakeBridge();
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
  const tree = await screen.findByRole('tree');
  await waitFor(() => expect(world.listed, 'the tree never descended to a/b').toContain('a/b'));
  expect(notices(), 'the healthy mount raised a notice; the fixture is wrong').toEqual([]);
  return tree;
}

/**
 * Remove `a/b` on disk and wait until the watcher's re-read has run and settled.
 *
 * It waits on the ROOT being re-read rather than on `a/b`, because a correct tree may never re-read
 * a collapsed `a/b` at all. The pause after it lets the ancestor `exists` probes and the notice land.
 */
async function removeAbAndSettle(): Promise<void> {
  const rootReads = world.listed.filter((p) => p === '').length;
  world.remove('a/b'); // `a` survives, so this is a cause of its own (041 FR-003a), never suppressed
  await waitFor(() => expect(world.listed.filter((p) => p === '').length).toBeGreaterThan(rootReads));
  await act(() => new Promise((r) => setTimeout(r, 250)));
}

describe('a folder the user collapsed is not reported when it is deleted on disk', () => {
  it('raises no notice for `a/b` after the user closed `a` by its chevron', async () => {
    const user = userEvent.setup();
    const tree = await mountAndDescend();

    await user.click(within(tree).getByTestId('tree-twisty-a'));
    await waitFor(() => expect(within(tree).queryByText('leaf.txt')).toBeNull());

    await removeAbAndSettle();

    expect(notices(), 'a folder hidden under a collapsed parent was reported gone').toEqual([]);
  });

  it('raises no notice for `a/b` after the user pressed Collapse all', async () => {
    const user = userEvent.setup();
    const tree = await mountAndDescend();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    await waitFor(() => expect(within(tree).queryByText('b')).toBeNull());

    await removeAbAndSettle();

    expect(notices(), 'a folder the user had collapsed away was reported gone').toEqual([]);
  });

  it('(control) still raises exactly one notice for `a/b` while it is EXPANDED — 041 US1 requires it', async () => {
    await mountAndDescend();

    await removeAbAndSettle();

    expect(notices(), 'the fixture cannot raise the notice 041 requires').toHaveLength(1);
  });
});
