/**
 * Re-entering a project whose folders have MOVED since the expansion was remembered
 * (026 / #197, FR-021/FR-022).
 *
 * PLACE AT: `packages/ui/tests/component/explorer-reentry.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/explorer-rename-reentry.e2e.ts` — all three tests
 * (034 FR-045).
 *
 * ══ WHY THIS IS NOT AN END-TO-END CLAIM ══
 *
 * The persisted explorer state is `localStorage['throng.explorer.tree.<projectId>']`, written and
 * read by `use-explorer-data.ts` in the RENDERER. Nothing about it crosses a process boundary: not
 * the daemon, not the database, not the config store. So "leave the project and come back" and
 * "close and reopen throng" are, from this state's point of view, exactly one thing — a fresh mount
 * of `FileTree` against storage that survived. The migrated file spent an Electron launch, a daemon
 * and a real `mkdtemp` project on each of three variants of that mount, and its own header says so:
 * "the persisted explorer state lives in the renderer's localStorage, so a reload is the faithful
 * in-harness equivalent". A component remount is the same equivalence one layer down.
 *
 * ══ WHERE THESE LAND STRONGER THAN THE E2E DID ══
 *
 *   - The E2E could only ever assert the ABSENCE of an error notice. Absence is also what a tree
 *     that failed to restore anything at all looks like, and what a tree that never mounted looks
 *     like. Here the persisted document is read back and asserted directly: `expanded` names the NEW
 *     path and no longer names the old one. That is the migration (`use-explorer-data.ts:1034-1038`)
 *     stated as a fact rather than inferred from a quiet screen.
 *   - The third case — a folder renamed OUTSIDE throng while the project was closed — is the one the
 *     issue was actually filed about, and its requirement has two halves: the failed restore must
 *     not reach the USER (FR-021) and must not be INVISIBLE either (SC-013, "an intermittent restore
 *     failure that leaves no trace is how #186 survived four wrong diagnoses"). The E2E could see
 *     only the first. `fetchChildren`'s `console.warn` is asserted here, so a fix that made the
 *     silence total — which passes the E2E — fails.
 *
 * ══ WHAT DOES NOT COME DOWN ══
 *
 * Nothing from that file. The project-switch CONTROL in the sidebar and the window reload itself
 * belong to the app shell, not to `FileTree`, and neither is what any of the three tests asserted;
 * they used those routes to reach a remount. If the parent judges that the sidebar's switch control
 * needs its own coverage, that is a new test about `projects-panel.tsx` rather than a reason to keep
 * three Electron launches here.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `beforeAll` that installs `ImmediateResizeObserver`. `FileTree` gates its `<Tree>` on a
 * `ResizeObserver`-fed size that jsdom cannot produce, so the tree never mounts, every `mountAt()`
 * throws in `findByRole('tree')`, and **ALL FOUR tests in this file fail**. The two absence
 * assertions here — no `explorer-error`, and the old path gone from storage — would otherwise both
 * be satisfied by an empty document, which is precisely why they are paired with a positive one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed viewport — see `file-tree.test.ts` for the full argument.
 * ────────────────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────────────── *
 * A filesystem that outlives a mount
 * ────────────────────────────────────────────────────────────────────────── */

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** `makeProject()` from the migrated file: `Docs/note.txt` plus a file at the top. */
const PROJECT = (): Record<string, FileTreeEntry[]> => ({
  '': [entry('Docs', 'folder'), entry('top.txt', 'file')],
  Docs: [entry('note.txt', 'file')],
});

const ROOT_A = 'C:/projects/reentry';
const ROOT_B = 'C:/projects/elsewhere';

/**
 * The fake filesystem, owned by the TEST rather than by a mount — which is the whole point here.
 * Every assertion in this file is about what a SECOND mount finds, so the listings, the rename and
 * the `window.throng` bridge all have to outlive the first one.
 */
function fakeWorld() {
  const dirs = new Map<string, FileTreeEntry[]>(Object.entries(PROJECT()));
  /** The unrelated second project the switch test detours through — one file, nothing to expand. */
  const dirsB = new Map<string, FileTreeEntry[]>([['', [entry('other.txt', 'file')]]]);

  const parentOf = (rel: string): string => {
    const i = rel.lastIndexOf('/');
    return i === -1 ? '' : rel.slice(0, i);
  };

  /** Rename in the listings AND re-key every folder underneath — as a real rename does. */
  const renameOnDisk = (relPath: string, newName: string): void => {
    const parent = parentOf(relPath);
    const siblings = dirs.get(parent);
    const old = relPath.slice(relPath.lastIndexOf('/') + 1);
    const target = siblings?.find((e) => e.name === old);
    if (!siblings || !target) throw new Error(`fixture: no such item ${relPath}`);
    siblings.splice(siblings.indexOf(target), 1, { ...target, name: newName });
    const newRel = parent ? `${parent}/${newName}` : newName;
    for (const key of [...dirs.keys()]) {
      if (key === relPath || key.startsWith(`${relPath}/`)) {
        const moved = dirs.get(key)!;
        dirs.delete(key);
        dirs.set(newRel + key.slice(relPath.length), moved);
      }
    }
  };

  /**
   * Which project's listings `files.list` is currently answering from.
   *
   * `files.setRoot` is what the real preload uses to scope the bridge to one project, and
   * `use-explorer-data.ts:415` calls it on every project change — so honouring it here is not a
   * convenience, it is the mechanism that makes "switch to another project" mean anything at all in
   * this fixture. A bridge that answered project A's listings while B was mounted would let a test
   * pass that had never actually left A.
   */
  let root = ROOT_A;

  const files = {
    setRoot: vi.fn((r: string | null) => {
      root = r ?? ROOT_A;
    }),
    list: vi.fn((relDir: string) => {
      const entries = (root === ROOT_B ? dirsB : dirs).get(relDir);
      return Promise.resolve(
        entries ? { entries: [...entries] } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    rename: vi.fn((relPath: string, newName: string) => {
      try {
        renameOnDisk(relPath, newName);
      } catch (e) {
        return Promise.resolve({ error: String(e), cause: null });
      }
      return Promise.resolve({ ok: true as const });
    }),
    onChange: vi.fn(() => () => {}),
    onWatchFailed: vi.fn(() => () => {}),
  };
  return { files, dirs, renameOnDisk };
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

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounting, repeatedly
 * ────────────────────────────────────────────────────────────────────────── */

const PROJECT_A = 'project-reentry-a';
const PROJECT_B = 'project-reentry-b';

let world: ReturnType<typeof fakeWorld>;
let warned: string[];

beforeEach(() => {
  localStorage.clear();
  world = fakeWorld();
  Reflect.set(window, 'throng', {
    files: world.files,
    editor: { isOpen: () => Promise.resolve(false) },
  });
  warned = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

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

/** Mount `FileTree` for one project and wait for the tree to exist. */
async function mountAt(projectId: string, rootFolder: string): Promise<HTMLElement> {
  const services = fakeServices();
  render(
    wrap(
      services,
      createElement(FileTree, { rootFolder, projectId, hiddenPaths: [], onHide: vi.fn() }),
    ),
  );
  return screen.findByRole('tree');
}

/** Leave the project: unmount everything, exactly as a project switch or a reload does. */
const leave = (): void => cleanup();

const rowLabels = (tree: HTMLElement): string[] =>
  within(tree)
    .getAllByRole('treeitem')
    .map((row) => row.querySelector('.tree-label')?.textContent ?? '');

const twisty = (tree: HTMLElement, relPath: string): HTMLElement =>
  within(tree).getByTestId(`tree-twisty-${relPath}`);

const pane = (): HTMLElement => screen.getByTestId('file-explorer-tree');

/** What `use-explorer-data.ts` has written down for a project. */
const persisted = (projectId: string): { expanded: string[]; selectedId: string | null } =>
  JSON.parse(localStorage.getItem(`throng.explorer.tree.${projectId}`) ?? '{"expanded":[]}');

/** Expand `Docs`, then rename it to `Documents` through the tree's own inline editor. */
async function expandAndRename(tree: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.click(twisty(tree, 'Docs'));
  await waitFor(() => expect(rowLabels(tree)).toContain('note.txt'));

  await user.click(within(tree).getByText('Docs'));
  fireEvent.keyDown(document.activeElement ?? pane(), { key: 'F2' });
  const input = (await waitFor(() => {
    const el = pane().querySelector('input.tree-rename');
    expect(el, 'the inline rename input never appeared').not.toBeNull();
    return el;
  })) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Documents' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(rowLabels(tree)).toContain('Documents'));
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The tests
 * ────────────────────────────────────────────────────────────────────────── */

describe('a renamed folder is still remembered as open (026 / #197)', () => {
  it('writes the expansion out at the NEW path the moment the rename lands', async () => {
    /*
     * The mechanism, asserted directly rather than inferred from a later screen.
     *
     * `onRename` migrates every open path under the renamed folder into `pendingOpen`
     * (`use-explorer-data.ts:1034-1038`), and the effect that applies it re-persists immediately
     * (#120's "Finding 5", `:682-688`). Without the migration the stale entry is not merely left
     * behind — #122's re-selection drains through `onSelect → persist`, re-snapshots the open state
     * from a tree where the renamed folder is no longer open, and writes the expansion OUT. That is
     * why both halves are asserted: the new path present, and the old one gone.
     */
    const user = userEvent.setup();
    const tree = await mountAt(PROJECT_A, ROOT_A);

    await expandAndRename(tree, user);

    await waitFor(() => expect(persisted(PROJECT_A).expanded).toContain('Documents'));
    expect(persisted(PROJECT_A).expanded).not.toContain('Docs');
  });

  it('comes back expanded, and silent, after another project has been in between', async () => {
    /*
     * The migrated test's first case. The detour through project B is not decoration: `persist` is
     * keyed by `projectId` and B's own mount writes its own key, so a restore that read the wrong
     * key — or a fixture that never actually left A — shows up here and nowhere else.
     */
    const user = userEvent.setup();
    const treeA = await mountAt(PROJECT_A, ROOT_A);
    await expandAndRename(treeA, user);

    leave();
    const treeB = await mountAt(PROJECT_B, ROOT_B);
    await waitFor(() => expect(rowLabels(treeB)).toContain('other.txt'));
    leave();

    const back = await mountAt(PROJECT_A, ROOT_A);

    await waitFor(() => expect(rowLabels(back)).toContain('Documents'));
    // The expansion followed the rename, exactly as it follows a move (#120).
    await waitFor(() => expect(rowLabels(back)).toContain('note.txt'));
    // A restore is never a user-facing failure — least of all one naming a folder they renamed
    // on purpose (FR-021).
    expect(screen.queryByTestId('explorer-error')).toBeNull();
  });

  it('comes back expanded after a reload, with nothing but storage to go on', async () => {
    /*
     * The migrated test's second case — "or close and reopen throng". Every scrap of React state is
     * gone at the point of the second mount, so the expansion below can only have come from what the
     * rename wrote to `localStorage`. Asserted as the restore rather than as the write, because the
     * two are different steps: `loadPersisted` → `fetchChildren(rel, silent)` → `initialOpenState`
     * (`:431-452`) is what turns a remembered path back into rows.
     */
    const user = userEvent.setup();
    const tree = await mountAt(PROJECT_A, ROOT_A);
    await expandAndRename(tree, user);
    leave();

    const back = await mountAt(PROJECT_A, ROOT_A);

    await waitFor(() => expect(rowLabels(back)).toContain('note.txt'));
    expect(rowLabels(back)).toContain('Documents');
    expect(screen.queryByTestId('explorer-error')).toBeNull();
  });

  it('a folder renamed OUTSIDE throng is discarded quietly — and logged, not swallowed', async () => {
    /*
     * The migrated test's third case, and the one #197 was actually reported as: nothing in-app
     * renamed anything, so nothing could have migrated, and the remembered path is simply gone.
     *
     * Both halves of FR-021 are asserted, because they pull in opposite directions and a fix that
     * satisfies one by breaking the other is exactly what happened before: the failure must not
     * reach the USER, and it must not vanish without trace either (SC-013 — `fetchChildren`'s
     * `silent` branch logs precisely so an intermittent restore failure leaves evidence).
     * The E2E could see only the first half.
     */
    const user = userEvent.setup();
    const tree = await mountAt(PROJECT_A, ROOT_A);
    await user.click(twisty(tree, 'Docs'));
    await waitFor(() => expect(rowLabels(tree)).toContain('note.txt'));
    await waitFor(() => expect(persisted(PROJECT_A).expanded).toContain('Docs'));

    leave();
    world.renameOnDisk('Docs', 'Archive'); // renamed while the project was closed

    const back = await mountAt(PROJECT_A, ROOT_A);

    await waitFor(() => expect(rowLabels(back)).toContain('Archive'));
    expect(screen.queryByTestId('explorer-error')).toBeNull();
    expect(
      warned.filter((w) => w.includes('discarding unresolvable persisted path "Docs"')),
      'the failed restore left no trace at all',
    ).toHaveLength(1);
  });
});
