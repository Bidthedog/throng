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
import { render, screen, waitFor, within } from '@testing-library/react';
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

  const subject = createElement(FileTree, {
    rootFolder: ROOT_FOLDER,
    projectId,
    hiddenPaths: options.hiddenPaths ?? [],
    onHide,
  });

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

  render(options.settings ? createElement(ConfigProvider, null, wrap(subject)) : wrap(subject));

  // The tree mounts only once `ready` is true AND the stubbed size has landed. Waiting for the
  // role rather than for a timeout means a regression that stops the tree mounting fails HERE,
  // with "unable to find role=tree", instead of silently satisfying every absence assertion below.
  const tree = await screen.findByRole('tree');
  return { user, tree, files, listed, onHide, projectId };
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
