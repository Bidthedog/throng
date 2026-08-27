/**
 * 041 FR-003/FR-003c (#278) — ONE removed folder is ONE notice, however many expanded folders it
 * defeats, asserted over the code that actually runs.
 *
 * ══ WHY THIS FILE EXISTS AT ALL (T062) ══
 *
 * `packages/core/tests/unit/notice/ancestor-suppression.test.ts` states the rule beautifully: SC-001's
 * "one cause for one, three and five descendants", and SC-006f's sweep over all 120 arrival orders.
 * Every one of those assertions calls `isSuppressedByAncestor` — and until T062, production did not.
 * `use-explorer-data.ts` walked the ancestors with its own loop and decided for itself, so the rule
 * had two statements and the tests exercised the one that never ran. Delete the suppression from the
 * renderer outright and the whole of that file stayed green.
 *
 * The renderer now delegates the decision, which binds those unit tests to production. What they
 * still cannot see is whether the renderer ASKS. That is this file: the observable outcome FR-029
 * requires — a count of notices on screen — over the real hook, the real bridge shape and the real
 * notification provider.
 *
 * ══ WHY COMPONENT AND NOT E2E (FR-030) ══
 *
 * Counting notices raised for one cause needs a React tree, a notification provider and a bridge that
 * can fail a listing. It needs no window, no daemon and no filesystem, so it does not need an Electron
 * launch. jsdom answers it in milliseconds.
 *
 * ══ THE STORM IS DRIVEN BY THE WATCHER, BECAUSE THAT IS WHERE IT COMES FROM ══
 *
 * The failing reads in #278 are not a first load. They are `reloadDirs()`, which the watcher fires
 * and which re-reads EVERY loaded folder at once — so one removal produces one failure per expanded
 * descendant, all in flight together, in no guaranteed order. That is the shape SC-006f's permutation
 * sweep abstracts, and it is why the fixture mounts a HEALTHY tree, lets it descend, and only then
 * takes the folder away.
 *
 * Seeding the removal before the mount instead would prove nothing: the tree cannot descend past a
 * folder whose listing fails, so the deeper reads would never be attempted and the single notice
 * would be single for the trivial reason that only one read ever ran.
 *
 * ══ WHAT MAKES IT DISCRIMINATE ══
 *
 * The two failures carry DIFFERENT subjects and a null cause, so 029 FR-019's notice-level
 * suppression cannot collapse them — `notice-suppression.test.ts` is explicit that an unclassified
 * failure is not a cause. Without the ancestor rule these are two notices. With it, one.
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

const PROJECT = 'project-storm';
const ROOT = 'C:/projects/storm';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** `a/b`, two folders deep, plus a file at the top so the root is never empty. */
const LISTINGS: Record<string, FileTreeEntry[]> = {
  '': [entry('a', 'folder'), entry('top.txt', 'file')],
  a: [entry('b', 'folder')],
  'a/b': [entry('leaf.txt', 'file')],
};

/**
 * A bridge over a filesystem the TEST can take things out of, mid-run.
 *
 * `exists` is the probe `suppressedByAncestor` resolves absence with, and it agrees with `list` by
 * construction. The explorer fixtures this was modelled on do not stub it at all, which leaves
 * `stillThere` as `undefined` rather than `false` and suppresses nothing — a fixture gap that would
 * make every assertion here pass for the wrong reason.
 */
function fakeBridge() {
  const gone = new Set<string>();
  const listed: string[] = [];
  let fire: (() => void) | undefined;

  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      listed.push(relDir);
      if (gone.has(relDir)) {
        return Promise.resolve({
          error: `ENOENT: no such directory, scandir '${relDir}'`,
          cause: null,
        });
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
    gone,
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

/** Every notice card currently on screen, counted as CHILDREN of the stack. */
const notices = (): HTMLElement[] => [
  ...(screen.queryByTestId('notices')?.querySelectorAll<HTMLElement>('.notice') ?? []),
];

const suppressionLogs = (): string[] => warned.filter((line) => line.includes('suppressing'));

let warned: string[];
let world: ReturnType<typeof fakeBridge>;

/**
 * The stubbed viewport — see `file-tree.test.ts` for the full argument.
 *
 * It must REPORT a size, not merely exist: `FileTree` gates its `<Tree>` on a `ResizeObserver`-fed
 * measurement that jsdom never produces on its own, so an observer that records the target and
 * stays silent leaves the tree at 0×0 and renders no rows at all. Measured here: a no-op stub failed
 * both tests in `findByRole('tree')` before a single assertion was reached.
 */
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
  // The folders the user had open when the removal happened. Persisted per project, so seeding it
  // and mounting is the state a real session is in — not a setup convenience.
  localStorage.setItem(
    `throng.explorer.tree.${PROJECT}`,
    JSON.stringify({ expanded: ['a', 'a/b'], selectedId: null }),
  );
  warned = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

/** Mount a HEALTHY tree and wait until it has descended to `a/b`. */
async function mountAndDescend(): Promise<void> {
  world = fakeBridge();
  Reflect.set(window, 'throng', {
    files: world.files,
    editor: { isOpen: () => Promise.resolve(false) },
  });
  const services = fakeServices();
  render(
    wrap(
      services,
      createElement(FileTree, {
        rootFolder: ROOT,
        projectId: PROJECT,
        hiddenPaths: [],
        onHide: vi.fn(),
      }),
    ),
  );
  await screen.findByRole('tree');
  // The descent is what makes the reload storm possible: `reloadDirs` re-reads the folders it has
  // LOADED, so a test whose tree never opened `a/b` would produce one failure and prove nothing.
  await waitFor(() => {
    expect(world.listed, 'the tree never descended to the expanded folders').toContain('a/b');
  });
  expect(notices(), 'the healthy mount raised a notice — the fixture is wrong').toHaveLength(0);
}

describe('one removed folder is one notice, however many expanded folders it defeats', () => {
  it('collapses a whole storm to the folder that actually went (SC-001, FR-003)', async () => {
    await mountAndDescend();

    // `a` goes, and `a/b` goes with it. The watcher re-reads both; both fail; one cause.
    world.remove('a', 'a/b');

    await waitFor(() => expect(notices().length).toBeGreaterThan(0));
    expect(
      notices(),
      'one removed folder produced a notice per defeated descendant — the storm #278 reported',
    ).toHaveLength(1);

    // FR-005a — suppression narrows what is SHOWN and never what is RECORDED. The screen count
    // falls; the log still carries every casualty.
    expect(
      suppressionLogs(),
      'a casualty was suppressed without being recorded',
    ).not.toHaveLength(0);
  });

  it('still reports a folder whose ancestors are all present (FR-003b)', async () => {
    // The sensitivity half. A suppression that swallowed an unrelated failure would be a worse
    // defect than the storm, so the same fixture is run with the ancestor left in place.
    await mountAndDescend();

    world.remove('a/b');

    await waitFor(() => expect(notices().length).toBeGreaterThan(0));
    expect(notices(), 'a failure with every ancestor present was swallowed').toHaveLength(1);
    expect(suppressionLogs(), 'nothing should have been suppressed here').toHaveLength(0);
  });
});
