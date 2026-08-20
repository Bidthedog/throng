/**
 * The File Explorer TREE itself — which rows it draws, in what order, when it asks the filesystem
 * for them, what a click on one does, and what a cut looks like (004 FR-004/005/015/016/020,
 * FR-026/027/028, FR-031/032, FR-070; 006 FR-009; #121).
 *
 * PLACE AT: `packages/ui/tests/component/file-tree.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/explorer.e2e.ts` lines 97, 134, 426, 515, 545 and 605
 * (034 FR-045).
 *
 * ══ THE THING THAT HAD TO BE ESTABLISHED BEFORE ANY OF THIS WAS WRITTEN ══
 *
 * `FileTree` renders a virtualised `react-arborist` tree behind a hard gate (`file-tree.tsx:561`):
 *
 *     {ready && width > 0 && height > 0 && <Tree … />}
 *
 * and `width`/`height` come from a `ResizeObserver` (`file-tree.tsx:60-74`). **jsdom does not
 * implement `ResizeObserver`** — it is absent from `jsdom@29.1.1` entirely — so without the stub
 * below the effect throws, the gate stays false, and `<Tree>` NEVER MOUNTS. Not "renders zero
 * rows": never mounts, `treeRef.current` stays null, and `expandStep`/`collapseAll` early-return.
 * Every absence assertion in this file would then pass while proving nothing whatever, which is
 * the specific way a migrated test rots into a decoration.
 *
 * So the stub is load-bearing and it is named as such. What it does NOT license is stated with it.
 *
 * That react-arborist itself works under jsdom is not an assumption: the published package ships
 * its maintainer's own jsdom tests (`react-arborist/dist/module/components/default-container.test.js`)
 * which render a `<Tree>` and destructure three `role="treeitem"` rows out of `getAllByRole`.
 * Virtualisation is `react-window`'s `FixedSizeList`, which derives its visible range
 * ARITHMETICALLY from the `height`/`itemSize` props and measures no DOM at all.
 *
 * ══ WHY THESE E2E TESTS COME DOWN ══
 *
 * Each launched Electron, started a daemon, made a real temp folder on disk and created a real
 * project — in order to read which rows were on screen and in what order. Everything they then
 * asserted is this component turning `files.list` replies into rows. Two of them are worse than
 * that: `:545` launched a SECOND, private Electron app (`runOwnApp`) purely to set
 * `editor.openOnClick: 'double'`, and `:97`'s title claims the tree is "sorted" while its body
 * only ever asserted that three names were present.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - `:580` virtualised rows for an 800-entry folder. Under a stubbed viewport the DOM row count
 *     is a function of the height THIS FILE chose, not of the app. Nothing here counts rows.
 *   - Everything that reads a real filesystem, a real watcher or a real trash: `:162`, `:194`,
 *     `:225`, `:274`, `:313`, `:376`, `:400`, `:448`, `:482`, `:620`.
 *   - `:350` drag-and-drop. react-arborist's drop maths is the one part of it that DOES measure
 *     the DOM (`dnd/compute-drop.js` calls `getBoundingClientRect`), which jsdom reports as 0x0.
 *
 * ══ CONTEXTS ══
 *
 * `FileTree` is context-heavy and every one of them is reachable without a production change —
 * which was checked first, because a draft that needs a new export is a draft that has changed the
 * app to suit itself (the trade `picker.test.ts` records making and then reverting).
 *
 *   - `WorkspaceProvider` is exported and takes its client as a PROP. Only `WorkspaceContext` is
 *     private, and we do not need it. As in `project-settings-dialog.test.ts`, the fake goes in one
 *     layer lower — a REAL `WorkspaceClient` over a fake `ThrongBridge` — so no cast is needed.
 *     `activeProjectId` is null: nothing under test reads `ws.layout`, and null skips the load.
 *   - `ConfigContext` has real defaults and needs no provider, which is what makes the exclusion
 *     test honest: `**\/.git` is in the SHIPPED `DEFAULT_EXCLUDE_GLOBS`, so `.git` is hidden by the
 *     defaults rather than by anything this file arranged. The one test that needs a DIFFERENT
 *     setting wraps `ConfigProvider` and feeds it through `window.throng.config.get`.
 *   - `NotificationProvider`, `ContextMenuProvider` and `ConfirmProvider` are all required because
 *     their hooks THROW without them. `useConfirm` is called unconditionally at
 *     `use-explorer-data.ts:218` even though nothing here confirms anything.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import {
  setEditorState,
  removeEditorState,
  allEditorStates,
} from '../../src/renderer/editor/editor-state.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed viewport
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A `ResizeObserver` that reports ONE fixed box, synchronously, the moment it is asked to observe.
 *
 * jsdom has no layout and no `ResizeObserver`, so this is not a simplification of a real thing —
 * it is the only thing that can make `useSize` produce a non-zero size and let the tree mount at
 * all. Firing inside `observe()` is safe: `observe()` is called from a `useEffect`, which RTL's
 * `render()` already wraps in `act()`, so the `setSize` it causes is an ordinary in-act update.
 *
 * WHAT THE 600px BUYS, AND WHAT IT DOES NOT.
 *
 * At `ROW_HEIGHT = 24` a 600px viewport renders 25 rows before virtualisation clips anything, and
 * the largest fixture in this file is SEVEN rows. So every row the data model says should exist is
 * inside the rendered window, and "which rows are on screen, in what order" is a faithful question
 * to ask here.
 *
 * It does NOT make "how many rows are in the DOM" a faithful question — that number is decided by
 * the 600 on the line below and by nothing in the application. `explorer.e2e.ts:580` asserts
 * exactly that about an 800-entry folder and therefore stays where it is; no test in this file
 * counts rows as evidence of virtualisation.
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
  // Removed rather than left behind: this file OWNS the stub (the shared `setup.ts` argues in its
  // own header against becoming a state-seeding harness), and a global that outlives the file that
  // needed it is how a neighbouring test starts passing for a reason nobody wrote down.
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The fake project on disk
 * ────────────────────────────────────────────────────────────────────────── */

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/**
 * `makeProjectFolder()` from the migrated file, as directory listings rather than as real `mkdir`s.
 *
 * The ROOT listing is deliberately given in an order that is neither the sorted order nor the
 * reverse of it: `.git` sits between the folder and the files, and `README.md` precedes `a.txt`.
 * A fixture already in the answer's order would let a tree that does no sorting at all pass the
 * ordering test below.
 */
const PROJECT: Record<string, FileTreeEntry[]> = {
  '': [
    entry('src', 'folder'),
    entry('.git', 'folder'),
    entry('README.md', 'file'),
    entry('a.txt', 'file'),
  ],
  src: [entry('inner', 'folder'), entry('index.ts', 'file')],
  'src/inner': [entry('deep.ts', 'file')],
  // Present so that a tree which DID descend into it would find something and fail loudly on the
  // row count, rather than silently succeeding because the folder happened to be empty.
  '.git': [entry('HEAD', 'file')],
};

const ROOT_FOLDER = 'C:/projects/demo';

/**
 * The `files.*` bridge plus a log of every directory anyone asked for.
 *
 * The log is the half the E2E could not have. "The tree does not list a folder until you open it"
 * is a claim about a call that was NOT made, and from outside the process the only evidence
 * available is the absence of some rows — which is also what a tree that listed everything and
 * then hid it would look like.
 */
function fakeFiles(listing: Record<string, FileTreeEntry[]> = PROJECT) {
  const listed: string[] = [];
  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      listed.push(relDir);
      const entries = listing[relDir];
      return Promise.resolve(
        entries ? { entries } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    // Live sync is not what this file is about; the subscription must simply exist and unsubscribe
    // cleanly, or the unmount in `cleanup()` throws on a missing return value.
    onChange: vi.fn(() => () => {}),
    onWatchFailed: vi.fn(() => () => {}),
  };
  return { files, listed };
}

/**
 * A fake daemon at the BRIDGE, for the same reason `project-settings-dialog.test.ts` puts one
 * there: `WorkspaceClient` and friends are classes with private fields, so a structural stub is not
 * assignable to them — but their one dependency, `ThrongBridge`, is an exported interface with a
 * single method.
 *
 * Two RPCs actually arrive during a mount and both are FIRE-AND-FORGET at the call site:
 * `document.pruneMissing` (`use-explorer-data.ts:427`, explicitly `.catch()`ed so that a store
 * which cannot be pruned never stops a project opening) and `fileopUndo.get` (`:294`, wrapped in a
 * try/catch inside the client for the same reason). Anything else is answered with a rejection
 * that names itself, so an RPC nobody expected shows up as a readable message instead of as an
 * undefined destructure three frames away.
 */
function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
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
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A fresh project id per mount.
 *
 * `use-explorer-data.ts` persists expansion and selection to
 * `localStorage['throng.explorer.tree.<projectId>']` and RESTORES it on mount, re-listing every
 * folder it remembers as open. A leaked entry would pre-open `src` in a later test and make its
 * lazy-load assertion pass without the tree ever having lazily loaded anything. `localStorage` is
 * cleared between tests as well; the counter is the belt to that pair of braces.
 */
let projectSeq = 0;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

interface MountOptions {
  /** Directory listings for this mount; defaults to the shared PROJECT fixture. */
  listing?: Record<string, FileTreeEntry[]>;
  /** Paths this project has hidden (004 "Hide in this project"). */
  hiddenPaths?: string[];
  /**
   * A settings document to serve from `window.throng.config.get`, wrapping the subject in the real
   * `ConfigProvider`. Omitted, no provider is mounted at all and ConfigContext's shipped defaults
   * apply — which is the state five of the six migrated tests were in.
   */
  settings?: Record<string, unknown>;
}

async function mount(options: MountOptions = {}) {
  const user = userEvent.setup();
  const { files, listed } = fakeFiles(options.listing);
  const projectId = `project-${(projectSeq += 1)}`;
  const onHide = vi.fn();

  // The preload bridge, as a plain object on `window`. `FileTree` reaches it exclusively through
  // optional chaining (`window.throng?.files?.list?.(…)`), so only the members actually used need
  // to exist — `terminal.listFlavours` is absent on purpose, and `useFlavours` handles that by
  // staying empty rather than by throwing.
  const throng: Record<string, unknown> = {
    files,
    // Reached only when a FILE's context menu is built (`file-tree.tsx:378`), to decide whether
    // "Open In" targets are disabled. Answering false keeps that menu simple.
    editor: { isOpen: () => Promise.resolve(false) },
  };
  if (options.settings) {
    throng.config = {
      get: () => Promise.resolve({ settings: options.settings }),
      onChange: () => () => {},
    };
  }
  Reflect.set(window, 'throng', throng);

  const treeWith = (hiddenPaths: string[]): ReactElement =>
    createElement(FileTree, { rootFolder: ROOT_FOLDER, projectId, hiddenPaths, onHide });
  const subject = treeWith(options.hiddenPaths ?? []);

  // ONE services object, shared: `WorkspaceProvider` must be handed the SAME `WorkspaceClient` the
  // rest of the tree resolves through `useServices`, or a test that later reads the store would be
  // watching a different fake daemon from the one it wrote to.
  const services = fakeServices();

  // Innermost first. ConfigProvider must sit OUTSIDE WorkspaceProvider, which reads
  // `useAppSettings` for the name limit and the new-tab position.
  const wrap = (children: ReactNode): ReactElement =>
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

  const shell = (child: ReactElement): ReactElement =>
    options.settings ? createElement(ConfigProvider, null, wrap(child)) : wrap(child);
  const { rerender } = render(shell(subject));
  /**
   * Change which paths are hidden, WITHOUT remounting (035 T056).
   *
   * `hiddenPaths` is a prop, and applying it to the derived data rather than to the fetch is what
   * makes hiding instant. A remount would re-read the folder and prove nothing about that — the
   * point of the un-hide case is that the file comes back with NO restart and no second listing.
   */
  const setHidden = async (hiddenPaths: string[]): Promise<void> => {
    await act(async () => {
      rerender(shell(treeWith(hiddenPaths)));
    });
  };

  // The tree mounts only once `ready` is true AND the stubbed size has landed. Waiting for the
  // role rather than for a timeout means a regression that stops the tree mounting fails HERE,
  // with "unable to find role=tree", instead of silently satisfying every absence assertion below.
  const tree = await screen.findByRole('tree');
  return { user, tree, files, listed, onHide, projectId, setHidden };
}

/**
 * The visible row labels, top to bottom.
 *
 * `role="treeitem"` comes from react-arborist's own row container and `react-window` emits its
 * items in index order, so the DOM order IS the on-screen order. Reading `.tree-label` out of each
 * row (rather than the row's whole `textContent`) keeps the icon and the symlink marker out of the
 * string.
 */
const rowLabels = (tree: HTMLElement): string[] =>
  within(tree)
    .getAllByRole('treeitem')
    .map((row) => row.querySelector('.tree-label')?.textContent ?? '');

/** Toggle a folder by its chevron — the ONLY expand/collapse control since #121. */
const twisty = (tree: HTMLElement, relPath: string): HTMLElement =>
  within(tree).getByTestId(`tree-twisty-${relPath}`);

/* ────────────────────────────────────────────────────────────────────────── *
 * :97 — what the tree draws, and when it asks for it
 * ────────────────────────────────────────────────────────────────────────── */

describe('the rows the tree draws (004 FR-004/005/016, migrated from explorer.e2e.ts:97)', () => {
  it('renders one row per visible entry, folders first then case-insensitive A–Z', async () => {
    /*
     * The migrated test is titled "renders the active project tree: sorted, …" and then asserts
     * only that three names are VISIBLE — an assertion a tree emitting them in any order passes.
     * The order is the interesting half and it is what a user actually sees, so it is asserted
     * here properly: folders before files (`src`), then A–Z ignoring case, which puts lowercase
     * `a.txt` ahead of uppercase `README.md`.
     *
     * `sortNodes` is unit-tested in core over plain arrays. What that cannot see, and this does, is
     * react-arborist FLATTENING the nested `TreeNodeData` back into rows in that same order — a
     * regression in which the sort is correct and the render is not looks identical at the unit
     * layer and obvious here.
     */
    const { tree } = await mount();

    expect(rowLabels(tree)).toEqual(['demo', 'src', 'a.txt', 'README.md']);
  });

  it('names the root row after the project folder, and never collapses it', async () => {
    // FR-004: the root is selectable but always open, so it draws the inert twisty rather than a
    // button. Asserting the ABSENCE of a control is only meaningful because the sibling assertion
    // above proves controls are drawn at all.
    const { tree } = await mount();

    /*
     * `role="treeitem"` is react-arborist's OWN row container; throng's classes live on the `.tree-row`
     * div inside it (`tree-node.tsx`). A first draft asserted `tree-row--root` on the treeitem itself
     * and failed — the class was one element down, not missing. Worth the comment because every other
     * row assertion in this file has to make the same distinction.
     */
    const [rootItem] = within(tree).getAllByRole('treeitem');
    const root = rootItem.querySelector('.tree-row');
    expect(root, 'the treeitem drew no .tree-row at all').not.toBeNull();
    expect(root).toHaveClass('tree-row--root');
    expect(rootItem.querySelector('.tree-label')).toHaveTextContent('demo');
    expect(within(tree).queryByTestId('tree-twisty-')).toBeNull();
  });

  it('draws no row for an excluded entry, and never lists it either', async () => {
    /*
     * TWO claims, and the second is the one that could not be made from outside the process.
     *
     * `isExcluded` is unit-tested as a predicate and `**\/.git` is in the shipped
     * DEFAULT_EXCLUDE_GLOBS, so nothing here arranges the exclusion. What is new is that
     * `fetchChildren` APPLIES it (`use-explorer-data.ts:382`) — and that the exclusion happens
     * before the tree ever descends. A tree that listed `.git` and then filtered its rows away
     * looks identical on screen and would walk a repository's entire object store to draw nothing.
     */
    const { tree, listed } = await mount();

    expect(rowLabels(tree)).not.toContain('.git');
    expect(listed).not.toContain('.git');
  });

  it('excludes node_modules too, and leaves everything else in place (SC-019, FR-070)', async () => {
    /*
     * MIGRATED FROM `packages/ui/tests/e2e/quick-open.e2e.ts:549` (035 FR-007) — the TREE half of
     * SC-019, which lived in a Quick Open spec because that spec was the only one that
     * materialised a `node_modules` fixture on disk, and opening a second project on the same root
     * would have breached FR-029's root exclusivity.
     *
     * Neither constraint exists here: the listing is a value, so a fixture costs a line rather than
     * a temp tree, and there is no project root to be exclusive about.
     *
     * `node_modules` is a SEPARATE case from `.git` above rather than a second name in the same
     * assertion. 033 added it to `DEFAULT_EXCLUDE_GLOBS` (`exclude.ts:33`) two years after the
     * VS Code defaults went in, so it is the entry most likely to be dropped by a future edit to
     * that list — and the one whose absence costs the most, since walking a real `node_modules` is
     * the difference between a tree that opens and one that hangs.
     *
     * THE SECOND HALF IS THE CONTROL, and it is why this is not just a longer `not.toContain`. An
     * exclusion rule that matched EVERYTHING would satisfy every assertion above: no `.git` row, no
     * `node_modules` row, nothing listed. Asserting that the ordinary folders survived is what
     * separates "excluded the right things" from "excluded".
     */
    const listing: Record<string, FileTreeEntry[]> = {
      '': [
        entry('src', 'folder'),
        entry('docs', 'folder'),
        entry('node_modules', 'folder'),
        entry('README.md', 'file'),
      ],
      // Present so a tree that DID descend finds something and fails loudly on the row count,
      // rather than passing because the folder happened to be empty — same reason as `.git` above.
      node_modules: [entry('left-pad', 'folder')],
      src: [entry('index.ts', 'file')],
      docs: [entry('guide.md', 'file')],
    };

    const { tree, listed } = await mount({ listing });

    expect(rowLabels(tree)).not.toContain('node_modules');
    expect(listed).not.toContain('node_modules');

    // …and this is not an empty tree.
    expect(rowLabels(tree)).toContain('src');
    expect(rowLabels(tree)).toContain('docs');
    expect(rowLabels(tree)).toContain('README.md');
  });

  it('does not list a subfolder until its chevron is clicked (lazy load)', async () => {
    /*
     * The lazy half of FR-070. On mount only the root is read; `src`'s listing is fetched by
     * `onToggle` → `ensureLoaded` (`use-explorer-data.ts:720-728`) when the twisty fires.
     *
     * Asserting the CALL LOG as well as the rows is what makes this a lazy-load test rather than an
     * expansion test: rows for `index.ts` being absent is equally consistent with a tree that read
     * every folder eagerly and merely kept them closed, which is the actual defect being guarded.
     */
    const { tree, user, listed } = await mount();

    expect(listed).toEqual(['']);
    expect(within(tree).queryByText('index.ts')).toBeNull();

    await user.click(twisty(tree, 'src'));

    await waitFor(() => expect(rowLabels(tree)).toContain('index.ts'));
    expect(listed).toContain('src');
    // One level only: `inner` is now a row, but nothing inside it has been asked for.
    expect(rowLabels(tree)).toEqual(['demo', 'src', 'inner', 'index.ts', 'a.txt', 'README.md']);
    expect(listed).not.toContain('src/inner');
  });

  it('drops a project-hidden path without re-reading the folder', async () => {
    /*
     * `hiddenPaths` is applied to the DERIVED data (`use-explorer-data.ts:464-472`), not to the
     * fetch — which is why hiding is instant in the app. The call log is what says so: exactly one
     * listing, the same as an unfiltered mount, with one fewer row.
     */
    const { tree, listed } = await mount({ hiddenPaths: ['a.txt'] });

    expect(rowLabels(tree)).toEqual(['demo', 'src', 'README.md']);
    expect(listed).toEqual(['']);
  });
  it('brings a path BACK when it stops being hidden, with no second listing (US8 FR-043)', async () => {
    /*
     * MIGRATED FROM `project-settings.e2e.ts:39` (035 T056) — the half the dialog's own tests cannot
     * make. `component/project-settings-dialog.test.ts:223` proves the list draws every hidden path
     * and `:233` proves removing one writes the whole list minus that path (keeping the other two
     * hidden, which is the data-loss guard); neither of them can say what the TREE then does.
     *
     * "With no restart" is the claim, and the call log is what makes it checkable: un-hiding must
     * cost nothing, because `hiddenPaths` filters the DERIVED data. A tree that re-listed the folder
     * would still show the file and would still look correct.
     */
    const { tree, listed, setHidden } = await mount({ hiddenPaths: ['a.txt'] });
    expect(rowLabels(tree)).toEqual(['demo', 'src', 'README.md']);

    await setHidden([]);

    expect(rowLabels(tree)).toEqual(['demo', 'src', 'a.txt', 'README.md']);
    expect(listed, 'no restart, and no re-read either').toEqual(['']);
  });

  it('keeps the OTHERS hidden when one is un-hidden', async () => {
    // The tree's half of the data-loss guard. A filter that treated the list as a single flag would
    // bring all three back, and the dialog's write would be the only thing standing between the user
    // and two paths they had deliberately hidden.
    const { tree, setHidden } = await mount({ hiddenPaths: ['a.txt', 'README.md'] });
    expect(rowLabels(tree)).toEqual(['demo', 'src']);

    await setHidden(['README.md']);

    expect(rowLabels(tree)).toEqual(['demo', 'src', 'a.txt']);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * :134 — the toolbar's Expand / Collapse all
 * ────────────────────────────────────────────────────────────────────────── */

describe('Expand steps one level at a time (004 FR-031/032, migrated from explorer.e2e.ts:134)', () => {
  it('opens the first level of folders, and no deeper', async () => {
    /*
     * `nextExpandTargets` is unit-tested over `ExpandNode` literals. Everything between that pure
     * function and a row on screen is untested below this layer: the toolbar button being wired to
     * `expandStep`, `expandStep` reading the CURRENT open-state back out of react-arborist rather
     * than out of a shadow copy (`use-explorer-data.ts:753-761` — the #120 defect), the per-target
     * lazy fetch, and the open-state being applied to the live tree api.
     *
     * That chain is also why this test cannot exist without the ResizeObserver stub: `expandStep`
     * begins `const api = treeRef.current; if (!api) return;`, so an unmounted Tree makes the
     * button a silent no-op and every assertion here would be about nothing.
     */
    const { tree, user } = await mount();

    await user.click(screen.getByRole('button', { name: 'Expand' }));

    await waitFor(() => expect(rowLabels(tree)).toContain('index.ts'));
    expect(rowLabels(tree)).toContain('inner');
    expect(rowLabels(tree)).not.toContain('deep.ts');
  });

  it('opens the next level on a second press', async () => {
    const { tree, user } = await mount();
    const expand = screen.getByRole('button', { name: 'Expand' });

    await user.click(expand);
    await waitFor(() => expect(rowLabels(tree)).toContain('inner'));
    await user.click(expand);

    await waitFor(() => expect(rowLabels(tree)).toContain('deep.ts'));
  });

  it('Collapse all returns to the root and its own children', async () => {
    /*
     * The migrated test asserted only that `index.ts` went away. That is also what a Collapse all
     * which collapsed the ROOT would look like — and the root is required to stay open (FR-004),
     * which is a different bug with the same symptom. So the surviving rows are asserted whole.
     */
    const { tree, user } = await mount();

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(rowLabels(tree)).toContain('index.ts'));

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));

    await waitFor(() => expect(rowLabels(tree)).toEqual(['demo', 'src', 'a.txt', 'README.md']));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * :426 — the cut marker (the greying half only)
 * ────────────────────────────────────────────────────────────────────────── */

describe('a cut item is marked, and Escape unmarks it (migrated from explorer.e2e.ts:426)', () => {
  it('marks the row with tree-row--cut when Cut is chosen from its menu', async () => {
    /*
     * This asserts the same observable the E2E did — `.tree-row--cut` — because the E2E asserted a
     * CLASS too, not a colour. The greying itself is `explorer.css` painting that class, and
     * remains E2E's business; what is decided here is whether the class arrives on the right row.
     *
     * It goes through the real context menu rather than the Ctrl+X shortcut, because `ops.cut` is
     * reached from both and the menu is the path the migrated test took. `ContextMenuProvider`
     * rendering in jsdom is not a new bet — `context-menu-lifecycle.test.ts` already relies on it.
     */
    const { tree, user } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: within(tree).getByText('a.txt') });
    await user.click(await screen.findByTestId('menu-item-Cut'));

    await waitFor(() => {
      const cut = tree.querySelectorAll('.tree-row--cut');
      expect(cut).toHaveLength(1);
      expect(cut[0].querySelector('.tree-label')).toHaveTextContent('a.txt');
    });
  });

  it('clears the mark on Escape', async () => {
    /*
     * Escape is handled by `useExplorerKeybindings` on the `.explorer` container
     * (`explorer-keybindings.ts:33`), which is why the key goes to the tree and not to the row: the
     * handler is deliberately scoped to the pane so that Ctrl+X here cuts a FILE while the same
     * chord in an editor cuts a LINE (016 FR-017b0).
     */
    const { tree, user } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: within(tree).getByText('a.txt') });
    await user.click(await screen.findByTestId('menu-item-Cut'));
    await waitFor(() => expect(tree.querySelectorAll('.tree-row--cut')).toHaveLength(1));

    await user.click(within(tree).getByText('a.txt'));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(tree.querySelectorAll('.tree-row--cut')).toHaveLength(0));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * :515 / :545 — what a click opens
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Record every `throng:open-file` intent raised on `window`.
 *
 * This is the same event the migrated tests listened for, and it is the real one: `onOpenFile`
 * (`file-tree.tsx:482-491`) dispatches it and the editor consumes it. Listening for it here rather
 * than spying on a prop is what keeps `relPath` and `absPath` under test.
 */
function openIntents(): { detail: { relPath: string; absPath: string }[]; stop: () => void } {
  const detail: { relPath: string; absPath: string }[] = [];
  const handler = (e: Event): void => {
    detail.push((e as CustomEvent).detail);
  };
  window.addEventListener('throng:open-file', handler);
  return { detail, stop: () => window.removeEventListener('throng:open-file', handler) };
}

describe('open-on-click (006 FR-009, migrated from explorer.e2e.ts:515 and :545)', () => {
  it('single click on a file raises exactly one open intent naming that file', async () => {
    /*
     * `decideClick` is unit-tested as a pure switch. It cannot see any of this: that `TreeRow`
     * calls it from `onClick`, that the intent is dispatched at all, or that the detail carries the
     * row's own `relPath` and an `absPath` rooted at the project. A tree that opened the previously
     * selected row would satisfy the unit test perfectly.
     */
    const { tree, user } = await mount();
    const opens = openIntents();

    try {
      await user.click(within(tree).getByText('a.txt'));

      await waitFor(() => expect(opens.detail).toHaveLength(1));
      expect(opens.detail[0].relPath).toBe('a.txt');
      expect(opens.detail[0].absPath).toBe(`${ROOT_FOLDER}/a.txt`);
    } finally {
      opens.stop();
    }
  });

  it('clicking a folder NAME selects it and opens nothing (#121)', async () => {
    /*
     * #121's whole point: the name is not a toggle and not an opener. Both halves are asserted
     * because "no open intent" alone is satisfied by a click that did nothing at all, which would
     * be a different regression — the selection is what proves the click landed.
     */
    const { tree, user } = await mount();
    const opens = openIntents();

    try {
      await user.click(within(tree).getByText('src'));

      await waitFor(() =>
        expect(tree.querySelector('.tree-row--selected .tree-label')).toHaveTextContent('src'),
      );
      expect(opens.detail).toHaveLength(0);
      // …and it did not expand either. The chevron is the only control that does.
      expect(rowLabels(tree)).not.toContain('index.ts');
    } finally {
      opens.stop();
    }
  });

  it('the chevron toggles the folder without opening anything', async () => {
    const { tree, user } = await mount();
    const opens = openIntents();

    try {
      await user.click(twisty(tree, 'src'));

      await waitFor(() => expect(rowLabels(tree)).toContain('index.ts'));
      expect(opens.detail).toHaveLength(0);
    } finally {
      opens.stop();
    }
  });

  it('in double-click mode a single click opens nothing and a double click opens once', async () => {
    /*
     * THE EXPENSIVE ONE. The migrated test could not use the shared app at all — `editor.openOnClick`
     * is read at launch — so it wrote a `settings.json` into a temp config root and started a SECOND
     * Electron app and daemon purely to set one enum. The shim in `explorer.e2e.ts:61` exists
     * because of this test and documents the wrong pass it once produced.
     *
     * Here the setting arrives through the real `ConfigProvider`, which reads
     * `window.throng.config.get()` and pushes the payload through the shipped
     * `guardedSettingsValidator` — so an `openOnClick` the validator would reject is rejected here
     * too, rather than being smuggled past it by a hand-made context value.
     */
    const { tree, user } = await mount({
      settings: { version: 1, editor: { openOnClick: 'double' } },
    });
    const opens = openIntents();

    try {
      await user.click(within(tree).getByText('a.txt'));
      // A negative that needs settling rather than merely observing: give the dispatch a turn of
      // the event loop before claiming it never happened.
      await waitFor(() =>
        expect(tree.querySelector('.tree-row--selected .tree-label')).toHaveTextContent('a.txt'),
      );
      expect(opens.detail).toHaveLength(0);

      await user.dblClick(within(tree).getByText('a.txt'));

      await waitFor(() => expect(opens.detail).toHaveLength(1));
      expect(opens.detail[0].relPath).toBe('a.txt');
    } finally {
      opens.stop();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * :605 — an empty project
 * ────────────────────────────────────────────────────────────────────────── */

describe('an empty project folder (migrated from explorer.e2e.ts:605)', () => {
  it('draws the root row, no children, and raises no notice', async () => {
    /*
     * The edge the migrated test was filed for: an empty listing must be an empty TREE, not a
     * failure. `fetchChildren` returns null for an ERROR and `[]` for an empty folder, and the two
     * are one character apart at the call site — confusing them turns an empty project into
     * "Couldn't list the contents of demo".
     *
     * The notice assertion is the one that catches that. `file-tree.tsx:144` raises through
     * `useErrorNotice(error, 'explorer-error', …)`, and that `testId` becomes the notice element's
     * own `data-testid` (`notification.tsx:706`) — so the explorer's failure is addressable by name
     * in this DOM rather than merely absent from it. Asserting the root row alone would pass with a
     * notice sitting above it.
     */
    const { tree } = await mount({ listing: { '': [] } });

    expect(rowLabels(tree)).toEqual(['demo']);
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(1);
    expect(screen.queryByTestId('explorer-error')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The shared unsaved dot, on the FILE
 * (024 follow-up / 006 US8, migrated from tree-unsaved-dot.e2e.ts:29)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHAT THE E2E DID, AND WHAT IT WAS ACTUALLY ASKING ══
 *
 * It launched Electron, started a daemon, made a real temp folder with two real files, created a
 * real project, opened an editor, CLICKED a row, waited for CodeMirror to show the file's text,
 * typed into it, then read one `<span>` out of a tree row — and afterwards added a real `cmd`
 * terminal and answered the close prompt so teardown would not force-kill a live shell.
 *
 * Every one of those steps is a way of getting `setEditorState` called with `dirty: true` and a
 * file path. The claim is what the TREE does with that: `file-tree.tsx:515-522` turns the dirty
 * store's absolute paths into root-relative ones, and `tree-node.tsx:32` marks a row whose
 * `relPath` is in that set. Driving the store directly asserts the same rule one process cheaper,
 * and asserts it on the RULE rather than on a side effect of typing — so a regression says which
 * half broke.
 *
 * ══ WHAT THIS CAN ASK THAT THE E2E COULD NOT ══
 *
 * The path normalisation. `dirtyPathKey()` lower-cases and forward-slashes every path precisely
 * because Windows calls `C:/Proj/A.txt` and `C:\\proj\\a.txt` the same file, and the tree
 * composes its keys from a project root it was handed rather than from the editor. The E2E used one
 * spelling throughout — a real editor opens the file the tree gave it — so it could never have
 * caught a normalisation that was dropped. Two of the tests below are that, and they are new
 * coverage rather than a migration.
 *
 * ══ WHAT DID NOT COME DOWN WITH IT ══
 *
 * The E2E's middle section asserted that a TERMINAL panel never wears the editor's unsaved dot —
 * a claim about the panel HEADER (`panel-placeholder.tsx:690`), not the tree, and about editor
 * state outliving an editor's unmount. It is not asserted here and it is not asserted anywhere; it
 * is recorded in the backlog against `panel-placeholder`, whose header this file does not render.
 */
describe('the unsaved dot on a file row (migrated from tree-unsaved-dot.e2e.ts:29)', () => {
  // The dirty store is a module-level Map shared by every test in the process. A test that leaves
  // an entry behind marks a row in the NEXT file to render a tree, which is the kind of failure
  // that gets blamed on the tree.
  afterEach(() => {
    for (const s of allEditorStates()) removeEditorState(s.panelId);
  });

  /** Mark `absPath` dirty (or clean) as panel `id`, the way an editor does. */
  const dirty = (id: string, absPath: string, isDirty: boolean): void => {
    act(() => {
      setEditorState(id, { filePath: absPath, dirty: isDirty });
    });
  };

  it('marks the edited file and no other, and unmarks it when saved', async () => {
    const { tree } = await mount();

    // Clean: no mark anywhere. Asserted BEFORE the dirty step so a dot that is always drawn cannot
    // pass the next assertion by having been there all along.
    expect(within(tree).queryByTestId('tree-unsaved-a.txt')).toBeNull();
    expect(within(tree).queryByTestId('tree-unsaved-README.md')).toBeNull();

    dirty('p1', `${ROOT_FOLDER}/a.txt`, true);

    expect(within(tree).getByTestId('tree-unsaved-a.txt')).toBeVisible();
    expect(within(tree).queryByTestId('tree-unsaved-README.md')).toBeNull();

    // Saved: the mark goes with the dirtiness it was reporting.
    dirty('p1', `${ROOT_FOLDER}/a.txt`, false);

    expect(within(tree).queryByTestId('tree-unsaved-a.txt')).toBeNull();
  });

  it('carries the accessible name rather than leaving the dot to speak for itself', async () => {
    const { tree } = await mount();
    dirty('p1', `${ROOT_FOLDER}/a.txt`, true);

    // FR-006d: the mark's entire job is to say "unsaved", so it may not be a bare decorative glyph.
    // The E2E asserted the testid and stopped there.
    const dot = within(tree).getByTestId('tree-unsaved-a.txt');
    expect(dot).toHaveAttribute('aria-label', 'Unsaved changes');
    expect(dot).toHaveAttribute('title', 'Unsaved changes');
  });

  it('marks a file inside a folder once that folder is open', async () => {
    const { user, tree } = await mount();
    dirty('p1', `${ROOT_FOLDER}/src/index.ts`, true);

    // Not rendered while the folder is shut — the row does not exist, which is the tree's business
    // and not a failure of the mark.
    expect(within(tree).queryByTestId('tree-unsaved-src/index.ts')).toBeNull();

    await user.click(twisty(tree, 'src'));
    await waitFor(() => expect(rowLabels(tree)).toContain('index.ts'));

    // The row's key is root-RELATIVE and keeps its separator, which is the join the E2E's
    // single-file fixture never exercised.
    expect(within(tree).getByTestId('tree-unsaved-src/index.ts')).toBeVisible();
  });

  it('marks the row when the editor spells the path with backslashes and different case', async () => {
    const { tree } = await mount();

    // What an editor on Windows actually holds: the OS's own spelling, which is neither the tree's
    // separator nor its case. `dirtyPathKey()` normalises both, and the E2E could not have caught
    // that being dropped because a real editor is handed the tree's own string.
    dirty('p1', 'C:\\Projects\\DEMO\\A.TXT', true);

    expect(within(tree).getByTestId('tree-unsaved-a.txt')).toBeVisible();
  });

  it('ignores a dirty file belonging to another project', async () => {
    const { tree } = await mount();

    // Another project's unsaved work is another project's business — the prefix test at
    // `file-tree.tsx:518` is the whole of that rule, and a tree that dropped it would mark rows
    // by basename.
    dirty('p1', 'C:/projects/other/a.txt', true);

    expect(within(tree).queryByTestId('tree-unsaved-a.txt')).toBeNull();
  });

  it('marks two files at once, each from its own editor panel', async () => {
    const { tree } = await mount();

    dirty('p1', `${ROOT_FOLDER}/a.txt`, true);
    dirty('p2', `${ROOT_FOLDER}/README.md`, true);

    expect(within(tree).getByTestId('tree-unsaved-a.txt')).toBeVisible();
    expect(within(tree).getByTestId('tree-unsaved-README.md')).toBeVisible();

    // One saved, one not: the store is keyed by panel, so a save must clear exactly one mark.
    dirty('p1', `${ROOT_FOLDER}/a.txt`, false);

    expect(within(tree).queryByTestId('tree-unsaved-a.txt')).toBeNull();
    expect(within(tree).getByTestId('tree-unsaved-README.md')).toBeVisible();
  });

  it('never marks a FOLDER row, whatever the dirty store says', async () => {
    const { tree } = await mount();

    // `tree-node.tsx:32` gates on `data.kind === 'file'`. Without that gate a folder whose
    // relPath collided with a dirty file's would wear a mark the user cannot act on.
    dirty('p1', `${ROOT_FOLDER}/src`, true);

    expect(within(tree).queryByTestId('tree-unsaved-src')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Expand / Collapse All Children
 * (029 US4, AS-3/4/6/7/8/9, FR-042/044; migrated from
 *  subtree-expand-collapse.e2e.ts:415, :477 and :577)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHAT THE THREE MIGRATED TESTS DROVE ══
 *
 * Each made a five-level folder tree on a real disk, launched Electron, started a daemon, created a
 * project, and then right-clicked a row and chose an item from throng's context menu. That menu is
 * an in-DOM React component (`ContextMenuProvider`), not a native `Menu` — `context-menu-lifecycle
 * .test.ts` and the Cut test above already drive it in jsdom — so the native-menu entry on the
 * constitution's reserve never applied to any of them. What was left was a folder tree, and a folder
 * tree is a set of directory listings.
 *
 * The pure half went to `core/tests/unit/explorer-subtree.test.ts` under 034:
 * `immediateChildFolders` and `descendantOpenFolders` over an `ExpandNode`. What that cannot show
 * is the TREE applying those answers — which rows end up drawn, which chevrons end up open, and
 * which folders got listed on the way. That is this.
 *
 * ══ THE ASSERTION THE FAKE MAKES BETTER, NOT WORSE ══
 *
 * The migrated file's most valuable check is `expectNoOpenFolderLies` (#120): no folder may be drawn
 * OPEN over children it never loaded. It had to consult the real filesystem, because an unloaded
 * folder and an empty one render identically and the tree alone cannot tell them apart.
 *
 * Here the listings ARE the filesystem and `listed` records every directory the tree asked for, so
 * the two are directly distinguishable: a folder drawn open whose path is absent from `listed` is
 * the #120 desync, stated as itself rather than inferred from a `readdirSync`.
 *
 * ══ AND THE ONE THE FAKE MAKES EASIER ══
 *
 * `settledOpenFolders` polled until two consecutive reads agreed, because `expandChildren` is a
 * fire-and-forget `void (async () => {…})()` and every negative assertion here ("no grandchild
 * opened") is TRUE at t=0. That hazard is real and does not go away: it is answered by `waitFor` on
 * the POSITIVE outcome first, so the tree has demonstrably finished before any absence is read.
 */

/** The five-level fixture from the migrated file, as listings. */
const SUBTREE: Record<string, FileTreeEntry[]> = {
  '': [entry('branch', 'folder'), entry('other', 'folder'), entry('root.txt', 'file')],
  branch: [
    entry('l1a', 'folder'),
    entry('l1b', 'folder'),
    entry('node_modules', 'folder'),
    entry('branch.txt', 'file'),
  ],
  'branch/l1a': [entry('l2a', 'folder'), entry('l1a.txt', 'file')],
  'branch/l1a/l2a': [entry('l3a', 'folder'), entry('l2a.txt', 'file')],
  'branch/l1a/l2a/l3a': [entry('deep.txt', 'file')],
  // Genuinely empty, and drawn as a folder — the case #120's check has to acquit rather than fail.
  'branch/l1b': [entry('empty', 'folder'), entry('l1b.txt', 'file')],
  'branch/l1b/empty': [],
  // Present so that a tree which DID descend into an excluded folder would find something.
  'branch/node_modules': [entry('pkg', 'folder')],
  'branch/node_modules/pkg': [entry('index.js', 'file')],
  other: [entry('other.txt', 'file')],
};

const COLLAPSE = 'Collapse All Children';
const EXPAND = 'Expand All Children';

const rowFor = (tree: HTMLElement, relPath: string): HTMLElement | null =>
  tree.querySelector(`.tree-row[data-rel-path="${CSS.escape(relPath)}"]`);

/** Every folder the tree is currently DRAWING as open, sorted — the migrated `openFolders`. */
const openFolders = (tree: HTMLElement): string[] =>
  [...tree.querySelectorAll('.tree-row')]
    .filter((el) => el.getAttribute('data-kind') === 'folder')
    .filter(
      (el) =>
        el.classList.contains('tree-row--root') ||
        el.querySelector('.tree-twisty')?.getAttribute('aria-expanded') === 'true',
    )
    .map((el) => el.getAttribute('data-rel-path') ?? '')
    .sort();

const isOpen = (tree: HTMLElement, relPath: string): string | null | undefined =>
  rowFor(tree, relPath)?.querySelector('.tree-twisty')?.getAttribute('aria-expanded');

/**
 * SC-009 / AS-8 — no folder is drawn OPEN over children it never loaded (#120).
 *
 * Returns the folders that had to be acquitted by consulting the listings, so a caller can assert
 * the branch actually RAN rather than short-circuiting on every folder rendering a child. The
 * migrated file makes exactly that point about its own version.
 */
function expectNoOpenFolderLies(tree: HTMLElement, listed: string[]): string[] {
  const rows = [...tree.querySelectorAll('.tree-row')];
  const rendered = rows.map((el) => el.getAttribute('data-rel-path') ?? '');
  const parentOf = (rel: string): string =>
    rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const acquitted: string[] = [];
  for (const rel of openFolders(tree)) {
    if (rendered.some((r) => r !== rel && parentOf(r) === rel)) continue;
    // Drawn open, renders nothing. Legitimate only if the tree ASKED for the listing and it was
    // empty; if it never asked, the chevron is advertising children nobody fetched.
    expect(
      listed,
      `folder "${rel || '<root>'}" is drawn OPEN but renders no children and was never listed — #120 desync`,
    ).toContain(rel);
    expect(
      SUBTREE[rel] ?? [],
      `folder "${rel}" is drawn OPEN, renders nothing, but is not empty`,
    ).toHaveLength(0);
    acquitted.push(rel);
  }
  return acquitted;
}

describe('Collapse All Children (AS-3/AS-4, migrated from subtree-expand-collapse.e2e.ts:415)', () => {
  it('closes every depth and leaves the anchor itself open', async () => {
    const { tree, user, listed } = await mount({ listing: SUBTREE });

    // US4's own Independent Test: drill three levels down by hand, with the chevron.
    for (const rel of ['branch', 'branch/l1a', 'branch/l1a/l2a', 'branch/l1a/l2a/l3a']) {
      await user.click(twisty(tree, rel));
      await waitFor(() => expect(isOpen(tree, rel)).toBe('true'));
    }
    await waitFor(() => expect(rowLabels(tree)).toContain('deep.txt'));
    expect(openFolders(tree)).toEqual([
      '',
      'branch',
      'branch/l1a',
      'branch/l1a/l2a',
      'branch/l1a/l2a/l3a',
    ]);

    await user.pointer({ keys: '[MouseRight]', target: rowFor(tree, 'branch') as HTMLElement });
    await user.click(await screen.findByTestId(`menu-item-${COLLAPSE}`));

    // AS-4 / D1 — the anchor is STILL OPEN: its own children are on screen. The disappearance of a
    // grandchild row is waited for FIRST, as the positive outcome, so the absences below are read
    // from a tree that has demonstrably moved rather than from one that has not started.
    await waitFor(() => expect(rowFor(tree, 'branch/l1a/l2a')).toBeNull());
    expect(isOpen(tree, 'branch')).toBe('true');
    expect(rowFor(tree, 'branch/l1a')).not.toBeNull();
    // AS-3 — and every descendant, at every depth, is closed.
    expect(rowLabels(tree)).not.toContain('deep.txt');
    expect(openFolders(tree)).toEqual(['', 'branch']);

    expectNoOpenFolderLies(tree, listed);
  });
});

describe('Expand All Children (AS-6/7/8/9, migrated from subtree-expand-collapse.e2e.ts:477)', () => {
  it('opens itself and its immediate child folders, and no grandchild', async () => {
    const { tree, user, listed } = await mount({ listing: SUBTREE });

    // AS-7 / D5 / FR-042 — the anchor is CLOSED when the action is chosen.
    expect(isOpen(tree, 'branch')).toBe('false');

    await user.pointer({ keys: '[MouseRight]', target: rowFor(tree, 'branch') as HTMLElement });
    await user.click(await screen.findByTestId(`menu-item-${EXPAND}`));

    // …so it opens ITSELF first, and then its immediate children. AS-6 / D4.
    await waitFor(() => expect(isOpen(tree, 'branch/l1b')).toBe('true'));
    expect(isOpen(tree, 'branch')).toBe('true');
    expect(isOpen(tree, 'branch/l1a')).toBe('true');
    // The immediate child FILE is untouched — it is drawn because its parent opened, not expanded.
    expect(rowLabels(tree)).toContain('branch.txt');

    /*
     * AS-6 / C4 — and NO GRANDCHILD is open. The two grandchildren are DRAWN (their parents opened)
     * but closed, so nothing inside them is on screen. Every assertion from here is a negative, and
     * a negative is true before the work finishes — which is why the positive above is waited for
     * first. A recursive descent that eventually opened the grandchildren fails here rather than
     * beating the read.
     */
    expect(rowFor(tree, 'branch/l1a/l2a')).not.toBeNull();
    expect(isOpen(tree, 'branch/l1a/l2a')).toBe('false');
    expect(isOpen(tree, 'branch/l1b/empty')).toBe('false');
    expect(rowFor(tree, 'branch/l1a/l2a/l3a')).toBeNull();
    expect(rowLabels(tree)).not.toContain('l2a.txt');
    expect(openFolders(tree)).toEqual(['', 'branch', 'branch/l1a', 'branch/l1b']);

    /*
     * AS-9 / D7 — an EXCLUDED folder is not expanded into, and the mechanism is that it is not in
     * the tree at all: `fetchChildren` filters by the shipped globs, so `node_modules` is never a
     * target for anything. Asserted on the row AND on its contents, because a filtered parent that
     * still leaked a child is the same defect wearing a different face.
     */
    expect(rowFor(tree, 'branch/node_modules')).toBeNull();
    expect(rowLabels(tree)).not.toContain('node_modules');
    expect(rowLabels(tree)).not.toContain('index.js');
    // …and the tree never even ASKED for it. The E2E could only assert the absence of rows; the
    // listing log is evidence about the call that was not made.
    expect(listed).not.toContain('branch/node_modules');

    // AS-8 / SC-009 — passes by SHORT-CIRCUIT here (the empty folder is drawn but closed), exactly
    // as the migrated test notes about itself. The honest-empty branch runs in the test below.
    expect(expectNoOpenFolderLies(tree, listed)).toEqual([]);
  });

  it('acquits a folder that is genuinely open and genuinely empty (#120, the branch that usually short-circuits)', async () => {
    const { tree, user, listed } = await mount({ listing: SUBTREE });

    // Open the empty folder for real: it renders no rows, and must NOT be reported as a desync.
    for (const rel of ['branch', 'branch/l1b', 'branch/l1b/empty']) {
      await user.click(twisty(tree, rel));
      await waitFor(() => expect(isOpen(tree, rel)).toBe('true'));
    }

    // The loop body RUNS this time — that is the point of returning the acquitted list rather than
    // merely calling the function, which is a green bar for a body that never executed.
    expect(expectNoOpenFolderLies(tree, listed)).toEqual(['branch/l1b/empty']);
  });
});

describe('a HIDDEN folder is never expanded into (FR-044, migrated from subtree-expand-collapse.e2e.ts:577)', () => {
  it('is not listed, not drawn, and not asked for', async () => {
    /*
     * D7's SECOND half: hidden by "Hide in this project", not by a shipped glob. Same requirement,
     * different mechanism — `hiddenPaths` is per-project state rather than a compiled excluder — and
     * the migrated test existed because the two could diverge.
     */
    const { tree, user, listed } = await mount({
      listing: SUBTREE,
      hiddenPaths: ['branch/l1a'],
    });

    await user.pointer({ keys: '[MouseRight]', target: rowFor(tree, 'branch') as HTMLElement });
    await user.click(await screen.findByTestId(`menu-item-${EXPAND}`));

    await waitFor(() => expect(isOpen(tree, 'branch/l1b')).toBe('true'));

    // Not drawn, and nothing from inside it leaked either.
    expect(rowFor(tree, 'branch/l1a')).toBeNull();
    expect(rowLabels(tree)).not.toContain('l1a');
    expect(rowLabels(tree)).not.toContain('l1a.txt');
    // The hidden half has NO visible consequence beyond that, which is why the migrated file
    // recorded every directory listing the app issued: the requirement is that the folder is not
    // expanded INTO, and a tree that drew no row while still listing it would satisfy every
    // assertion above while doing the work FR-044 forbids.
    expect(listed).not.toContain('branch/l1a');
    expect(openFolders(tree)).toEqual(['', 'branch', 'branch/l1b']);
  });
});
