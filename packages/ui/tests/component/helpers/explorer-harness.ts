/**
 * A mountable File Explorer over doubles for everything 050 added to the bridge — the shared
 * arrangement behind the paste, reveal, greying, drag, override and undo component tests.
 *
 * ══ WHAT IS REAL AND WHAT IS A DOUBLE ══
 *
 * Real: `FileTree`, `useExplorerData`, the notification provider, the context menu, the confirm
 * provider, the file-clipboard store, the transfer-completion host. Doubles: `window.throng.files`
 * (listings the test can edit), `fileClipboard`, `transfer` (every call recorded, every push
 * emittable) and the daemon RPCs behind `fileOpUndo` / `documents` (backed by maps the test can read
 * and seed). The point is to assert the ARGUMENTS the renderer sends and what it does with what comes
 * back — main's behaviour is proven at the integration layer.
 *
 * The `ResizeObserver` stub is load-bearing: see `file-tree.test.ts`. Call `installResizeObserver()`
 * from `beforeAll`.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';
import type {
  ClashQuestion,
  FileClipboard,
  FileOpUndoEntry,
  TransferProgress,
  TransferResult,
} from '@throng/core';
import { emptyStack, type FileOpUndoStack } from '@throng/core';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { FileTree } from '../../../src/renderer/explorer/file-tree.js';
import { resetFileClipboardStoreForTests } from '../../../src/renderer/explorer/file-clipboard-store.js';
import type { FileTreeEntry } from '../../../src/renderer/global.js';

export class ImmediateResizeObserver implements ResizeObserver {
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

export function installResizeObserver(): void {
  globalThis.ResizeObserver = ImmediateResizeObserver;
}
export function uninstallResizeObserver(): void {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
}

export const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** An emitter for one bridge push channel: `on` returns an unsubscriber, `emit` fires every listener. */
function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on: vi.fn((cb: (value: T) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
    emit(value: T): void {
      act(() => {
        for (const l of [...listeners]) l(value);
      });
    },
    get size(): number {
      return listeners.size;
    },
  };
}

/** `window.throng.fileClipboard` — main's clipboard, as a value the test sets and every window follows. */
export function fakeFileClipboard(initial: FileClipboard = null) {
  let current = initial;
  const changed = channel<FileClipboard>();
  const api = {
    get: vi.fn(() => Promise.resolve(current)),
    set: vi.fn((_mode: 'cut' | 'copy', _relPaths: readonly string[]) => Promise.resolve({ ok: true as const })),
    clear: vi.fn(() => {
      current = null;
      changed.emit(null);
    }),
    onChange: changed.on,
  };
  return {
    api,
    /** What main would push after a change made anywhere. */
    push(next: FileClipboard): void {
      current = next;
      changed.emit(next);
    },
    get value(): FileClipboard {
      return current;
    },
  };
}

/** `window.throng.transfer` — every call recorded, every push emittable. */
export function fakeTransfer() {
  const progress = channel<TransferProgress>();
  const clash = channel<ClashQuestion>();
  const cancelChoice = channel<{ jobId: string }>();
  const done = channel<TransferResult>();
  const quitPrompt = channel<{ running: number; queued: number }>();
  const api = {
    paste: vi.fn((_targetRelDir: string) => Promise.resolve({ jobId: 'job-1' })),
    drop: vi.fn(
      (_src: readonly string[], _dest: string, _mode: 'cut' | 'copy') =>
        Promise.resolve(undefined as unknown as TransferResult),
    ),
    cancel: vi.fn(),
    finishCancel: vi.fn(),
    resolveClash: vi.fn(),
    applyUndo: vi.fn((_entry: FileOpUndoEntry, _direction: 'undo' | 'redo') =>
      Promise.resolve({ ok: true as const }),
    ),
    exists: vi.fn((paths: readonly string[]) => Promise.resolve(paths.map(() => true))),
    quitChoice: vi.fn(),
    onProgress: progress.on,
    onClash: clash.on,
    onCancelChoice: cancelChoice.on,
    onDone: done.on,
    onQuitPrompt: quitPrompt.on,
  };
  return {
    api,
    progress: (p: Partial<TransferProgress> & { jobId: string }): void =>
      progress.emit({
        kind: 'paste',
        state: 'running',
        done: 0,
        total: 1,
        current: null,
        queuedBehind: 0,
        bytesDone: 0,
        bytesTotal: null,
        filesDone: 0,
        filesTotal: null,
        targetDir: 'C:/projects/demo',
        // Main decides when a card is worth showing (FR-031); a test opts in with `display: true`.
        display: false,
        ...p,
      }),
    clash: clash.emit,
    cancelChoice: cancelChoice.emit,
    done: (r: Partial<TransferResult> & { jobId: string }): void =>
      done.emit({
        kind: 'paste',
        outcome: 'completed',
        placed: [],
        undo: null,
        failures: [],
        rollbackFailures: [],
        sourceProjectId: 'project-a',
        targetProjectId: 'project-a',
        ...r,
      }),
    quitPrompt: quitPrompt.emit,
  };
}

/** The daemon behind `fileOpUndo` and `documents`, as maps the test can read and seed. */
export function fakeDaemon() {
  const stacks = new Map<string, string>();
  /** `projectId|relPath` → language id. */
  const overrides = new Map<string, string>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  /** The projects the daemon reports (`projects.list`): two, with distinct roots. */
  const projectList: { id: string; name: string; rootFolder: string }[] = [
    { id: 'project-a', name: 'Demo', rootFolder: 'C:/projects/demo' },
    { id: 'project-b', name: 'Other', rootFolder: 'D:/projects/other' },
  ];
  const key = (projectId: string, relPath: string): string => `${projectId}|${relPath}`;

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      const p = (params ?? {}) as Record<string, string>;
      calls.push({ method, params: p });
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: projectList } as TResult);
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'document.movePath': {
          // The daemon's contract: the item's own row and every row beneath it (#471), into
          // `toProjectId` when given.
          const fromRel = p.fromRelPath!;
          const toProject = p.toProjectId ?? p.projectId!;
          const moving = [...overrides].filter(([k]) => {
            const [proj, rel] = k.split('|') as [string, string];
            return proj === p.projectId && (rel === fromRel || rel.startsWith(`${fromRel}/`));
          });
          for (const [k, lang] of moving) {
            const rel = k.slice(p.projectId!.length + 1);
            overrides.delete(k);
            overrides.set(key(toProject, p.toRelPath! + rel.slice(fromRel.length)), lang);
          }
          return Promise.resolve({ moved: moving.length > 0 } as TResult);
        }
        case 'document.getState': {
          const lang = overrides.get(key(p.projectId!, p.relPath!));
          return Promise.resolve({
            state: lang === undefined ? null : { languageId: lang },
          } as TResult);
        }
        case 'document.setState': {
          const k = key(p.projectId!, p.relPath!);
          if (p.languageId === null || p.languageId === undefined) overrides.delete(k);
          else overrides.set(k, p.languageId);
          return Promise.resolve({ state: { languageId: p.languageId ?? null } } as TResult);
        }
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: stacks.get(p.projectId!) ?? null } as TResult);
        case 'fileopUndo.set':
          stacks.set(p.projectId!, p.stackJson!);
          return Promise.resolve({ ok: true } as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the file tree: ${method}`));
      }
    },
  };
  const services: Services = {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  return {
    services,
    calls,
    overrides,
    /** The projects `projects.list` reports — mutate it to remove one. */
    projects: projectList,
    /** The persisted undo stack of a project, parsed. */
    stack(projectId: string): FileOpUndoStack {
      const json = stacks.get(projectId);
      return json ? (JSON.parse(json) as FileOpUndoStack) : emptyStack();
    },
    seedStack(projectId: string, stack: FileOpUndoStack): void {
      stacks.set(projectId, JSON.stringify(stack));
    },
    seedOverride(projectId: string, relPath: string, languageId: string): void {
      overrides.set(key(projectId, relPath), languageId);
    },
    override(projectId: string, relPath: string): string | undefined {
      return overrides.get(key(projectId, relPath));
    },
  };
}

/** `window.throng.files` over listings the test can edit. */
export function fakeFiles(listings: Record<string, FileTreeEntry[]>) {
  const dirs = new Map<string, FileTreeEntry[]>(Object.entries(listings));
  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      const entries = dirs.get(relDir);
      return Promise.resolve(
        entries ? { entries: [...entries] } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    exists: vi.fn((relPath: string) => {
      if (relPath === '') return Promise.resolve(true);
      const cut = relPath.lastIndexOf('/');
      const siblings = dirs.get(cut === -1 ? '' : relPath.slice(0, cut));
      const leaf = relPath.slice(cut + 1);
      return Promise.resolve(siblings?.some((e) => e.name === leaf) ?? false);
    }),
    rename: vi.fn(() => Promise.resolve({ ok: true as const })),
    move: vi.fn(() => Promise.resolve({ ok: true as const })),
    copy: vi.fn(() => Promise.resolve({ ok: true as const })),
    onChange: vi.fn(() => () => {}),
    onWatchFailed: vi.fn(() => () => {}),
  };
  return { files, dirs };
}

export interface MountedExplorer {
  clipboard: ReturnType<typeof fakeFileClipboard>;
  transfer: ReturnType<typeof fakeTransfer>;
  daemon: ReturnType<typeof fakeDaemon>;
  files: ReturnType<typeof fakeFiles>;
  tree: HTMLElement;
  unmount(): void;
}

export interface MountOptions {
  rootFolder?: string;
  projectId?: string;
  listing?: Record<string, FileTreeEntry[]>;
  clipboard?: FileClipboard;
  /** Extra providers or siblings rendered next to the tree (a transfer host, a prompt host). */
  extra?: ReactNode;
  /** Reuse doubles across a remount — a project switch keeps main's clipboard and the daemon. */
  reuse?: Pick<MountedExplorer, 'clipboard' | 'transfer' | 'daemon'>;
  projectNameOf?: (projectId: string) => string | undefined;
}

export const DEFAULT_LISTING = (): Record<string, FileTreeEntry[]> => ({
  '': [entry('Docs', 'folder'), entry('a.txt', 'file'), entry('b.txt', 'file')],
  Docs: [entry('note.txt', 'file')],
});

export async function mountExplorer(
  host: (props: { services: Services; children: ReactNode }) => ReactElement,
  opts: MountOptions = {},
): Promise<MountedExplorer> {
  const projectId = opts.projectId ?? 'project-a';
  const rootFolder = opts.rootFolder ?? 'C:/projects/demo';
  if (!opts.reuse) resetFileClipboardStoreForTests();
  const clipboard = opts.reuse?.clipboard ?? fakeFileClipboard(opts.clipboard ?? null);
  const transfer = opts.reuse?.transfer ?? fakeTransfer();
  const daemon = opts.reuse?.daemon ?? fakeDaemon();
  const files = fakeFiles(opts.listing ?? DEFAULT_LISTING());

  Reflect.set(window, 'throng', {
    files: files.files,
    fileClipboard: clipboard.api,
    transfer: transfer.api,
    editor: { isOpen: () => Promise.resolve(false) },
  });

  const { services } = daemon;
  const view = render(
    host({
      services,
      children: createElement(
        'div',
        null,
        createElement(FileTree, {
          rootFolder,
          projectId,
          hiddenPaths: [],
          onHide: vi.fn(),
          projectNameOf: opts.projectNameOf,
        }),
        opts.extra,
      ),
    }),
  );
  const tree = await screen.findByRole('tree');
  return { clipboard, transfer, daemon, files, tree, unmount: view.unmount };
}

/** The standard provider stack the tree needs, with `extra` hosts rendered inside the notification provider. */
export function standardHost({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}): ReactElement {
  return createElement(
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
}
