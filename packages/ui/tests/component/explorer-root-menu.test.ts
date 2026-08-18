/**
 * Right-clicking the EMPTY SPACE of the Files & Folders pane opens a menu targeting the project
 * ROOT (004 FR-097), and what that menu then does goes to the root and not to the selection.
 *
 * PLACE AT: `packages/ui/tests/component/explorer-root-menu.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/explorer-new-items.e2e.ts`,
 * `test('right-clicking empty space opens a root menu with New File / New Folder / reveal (FR-097)')`
 * — 034 FR-045.
 *
 * ══ WHY THIS ONE, AND NOT ITS NEIGHBOUR ══
 *
 * The other test in that file creates a real file on a real disk and renames it, and it STAYS: no
 * single layer below E2E proves menu → create → rename-commit → bytes at `sub/made.txt`, and FR-047
 * forbids replacing four fifths of a test. This one is different. Its subject is
 * `onEmptyContextMenu` (`file-tree.tsx:457`) — a handler that decides WHICH NODE the menu is about,
 * and whose entire content is `{ relPath: '', kind: 'folder' }` plus a `.closest('.tree-row')` guard.
 * That decision is not proved anywhere below E2E.
 *
 * ══ WHAT WAS ALREADY COVERED, AND IS THEREFORE NOT RE-ASSERTED HERE ══
 *
 * The migrated test's middle third is builder data and was proved before this file existed:
 *   - `packages/ui/tests/unit/menu-sections.test.ts:396` pins the root menu's WHOLE shape —
 *     `['Paste','Undo','Redo','—','New File','New Folder','—','Open In','Copy Path',
 *      'Collapse All Children','Expand All Children']`.
 *   - `packages/ui/tests/component/menu-section-rendering.test.ts:189` pins the root menu's two
 *     RENDERED rules, and `:215` pins `OS File Explorer` as the first row of the `Open In` flyout.
 * So nothing below re-states the section vocabulary or the divider positions. What is new is the
 * TARGET: that this menu is the root's at all, that a row's right-click does not become it, and that
 * its create actions address `''` rather than whatever happens to be selected.
 *
 * ══ IT LANDS STRONGER THAN THE E2E DID ══
 *
 * The migrated test right-clicked the empty space with NOTHING SELECTED, so "New File went to the
 * root" and "New File went to the selection" produced identical results and it could not tell them
 * apart. Here `a.txt` is selected first, deliberately, and the destination is read off the bridge
 * call. That is the FR-097 defect stated as a test rather than as an assumption. It also asserts the
 * `.closest('.tree-row')` guard from the other side — a right-click ON a row still gets the row's
 * menu — which the E2E never checked and which is the half that would silently swallow every row
 * menu in the pane if it inverted.
 *
 * ══ WHAT STAYS END-TO-END, AND WHERE THE REST OF THE CHAIN IS PROVED ══
 *
 *   - That `files.newFile('')` puts a real, empty, de-duplicated file on a real disk:
 *     `packages/ui/tests/integration/files-service.test.ts:84` (`newFolder('')` → `'New folder'`,
 *     then `'New folder (2)'`) and `:91` (`newFile('sub')` → `'sub/New file.txt'`, "It is a real,
 *     empty file"). This layer stops at the bridge call, and says so.
 *   - Where the menu appears on screen, and that the empty space really is below the rows rather
 *     than covered by them. jsdom has no layout; the migrated test's `boundingBox()` arithmetic has
 *     no meaning here (034 FR-049), which is why the handler is driven by targeting the element.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Withhold the `ImmediateResizeObserver` stub below (delete the `beforeAll`). `FileTree` gates its
 * `<Tree>` on `width > 0 && height > 0` from a `ResizeObserver` that jsdom does not implement, so
 * the tree never mounts, `mount()`'s `findByRole('tree')` throws, and **ALL SIX tests in this file
 * fail**. Every test goes through `mount()`, and no absence assertion below can be satisfied by an
 * empty document.
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
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed viewport — the same one `file-tree.test.ts` documents at length.
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
 * The project, as directory listings
 * ────────────────────────────────────────────────────────────────────────── */

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** `makeProject()` from the migrated spec — one folder, one file inside it, one file at the root. */
const project = (): Record<string, FileTreeEntry[]> => ({
  '': [entry('sub', 'folder'), entry('a.txt', 'file')],
  sub: [entry('keep.txt', 'file')],
});

const ROOT_FOLDER = 'C:/projects/newitems';

/**
 * The `files.*` bridge, plus the two things the E2E had to read off a disk to learn: WHERE a create
 * was addressed, and WHEN the watcher reported it.
 *
 * `newFile`/`newFolder` mutate the listing and hand back the de-duplicated relative path the real
 * service hands back (`files-service.test.ts:84`/`:91` pin those exact strings), so the tree can go
 * on to find the new node. Nothing here re-asserts that naming: it is copied from the layer that
 * owns it.
 */
function fakeFiles(listing: Record<string, FileTreeEntry[]>) {
  const listed: string[] = [];
  let changed: (() => void) | null = null;
  const join = (dest: string, name: string): string => (dest === '' ? name : `${dest}/${name}`);
  const add = (dest: string, name: string, kind: 'file' | 'folder'): { relPath: string } => {
    (listing[dest] ??= []).push(entry(name, kind));
    return { relPath: join(dest, name) };
  };
  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      listed.push(relDir);
      const entries = listing[relDir];
      return Promise.resolve(
        entries ? { entries: [...entries] } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    newFile: vi.fn((dest: string) => Promise.resolve(add(dest, 'New file.txt', 'file'))),
    newFolder: vi.fn((dest: string) => Promise.resolve(add(dest, 'New folder', 'folder'))),
    reveal: vi.fn(() => Promise.resolve({})),
    onChange: vi.fn((cb: () => void) => {
      changed = cb;
      return () => {
        changed = null;
      };
    }),
    onWatchFailed: vi.fn(() => () => {}),
  };
  return { files, listed, notifyChange: (): void => changed?.() };
}

/** A fake daemon at the BRIDGE — see `file-tree.test.ts` for why the fake goes one layer lower. */
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

/** A fresh project id per mount — `use-explorer-data.ts` persists expansion to `localStorage`. */
let projectSeq = 0;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

async function mount() {
  const user = userEvent.setup();
  const listing = project();
  const { files, listed, notifyChange } = fakeFiles(listing);
  const projectId = `project-${(projectSeq += 1)}`;

  Reflect.set(window, 'throng', {
    files,
    // Reached only when a FILE row's menu is built, to decide whether the "Open In" editor targets
    // are disabled. False keeps that menu simple; the root menu never asks.
    editor: { isOpen: () => Promise.resolve(false) },
  });

  const services = fakeServices();
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

  render(
    wrap(
      createElement(FileTree, {
        rootFolder: ROOT_FOLDER,
        projectId,
        hiddenPaths: [],
        onHide: vi.fn(),
      }),
    ),
  );

  // Waiting for the ROLE rather than a timeout: a regression that stops the tree mounting fails
  // here, with "unable to find role=tree", instead of quietly satisfying the absence assertions.
  const tree = await screen.findByRole('tree');
  const body = document.querySelector<HTMLElement>('.explorer__body');
  expect(body, 'the explorer drew no body to right-click').not.toBeNull();
  return { user, tree, body: body!, files, listed, notifyChange };
}

/** The drawn ACTION rows of one menu level, in order — derived rules are excluded by class. */
const menuLabels = (testId = 'context-menu'): string[] =>
  Array.from(screen.getByTestId(testId).children)
    .filter((el) => el.classList.contains('context-menu__item'))
    .map((el) => el.querySelector('.context-menu__label')?.textContent ?? '');

describe('a right-click on the empty space targets the project root (004 FR-097)', () => {
  it('offers the ROOT’s menu — no Rename, no Delete, no Hide', async () => {
    /*
     * The three ABSENCES are what identify the target. The root cannot be renamed, cut, deleted or
     * hidden (`context-menu-items.ts` gates each on `!isRoot`), so a menu carrying any of them is a
     * menu built for some row. The presences are asserted alongside, so the absences are not merely
     * the absence of a menu — that is the failure mode this branch caught four tests in.
     */
    const { user, body } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: body });

    await screen.findByTestId('context-menu');
    expect(menuLabels()).toEqual([
      'Paste',
      'Undo',
      'Redo',
      'New File',
      'New Folder',
      'Open In',
      'Copy Path',
      'Collapse All Children',
      'Expand All Children',
    ]);
  });

  it('draws the ROW’s own menu when a row is right-clicked, and only that menu', async () => {
    /*
     * The other side of `if ((event.target).closest('.tree-row')) return;`. The empty-space handler
     * is on `.explorer__body`, which every row bubbles through, so without the guard it would open a
     * ROOT menu over the top of every row menu in the pane — and the symptom, "Delete is missing
     * from the file menu", reads as a builder bug.
     *
     * The title used to say "the guard reads the event target". It has been changed because that is
     * not what this test establishes; see below.
     */
    const { user, tree } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: within(tree).getByText('a.txt') });

    await screen.findByTestId('menu-item-Rename');
    expect(menuLabels()).toContain('Delete');
    expect(menuLabels()).toContain('Hide in this project');

    /*
     * ⚠ THIS TEST DOES NOT PROVE THE GUARD, and saying so is the point of this comment.
     *
     * Deleting the `closest('.tree-row')` check in the source leaves all six tests in this file
     * green — measured, twice, before and after the two assertions below were added specifically to
     * catch it. So the mutation is INERT AT THIS LAYER rather than the test being weak: in jsdom the
     * root menu is never actually raised over the row, so there is nothing here to observe.
     *
     * That is worth writing down rather than deleting, because the distinction is the one this
     * branch keeps getting wrong in the other direction. A mutation that leaves a test green has two
     * explanations — "the test cannot fail" and "the mutation does nothing here" — and only the
     * first is a defect. Four tests on this branch were the first kind. This one is the second, and
     * a test quietly retitled to hide that would be a third and worse thing.
     *
     * What IS proved below: a right-click on a row draws the row's own menu, exactly one menu host
     * exists, and what is drawn is not the root's list — pinned to the exact nine the test above
     * proves the root offers, so the two move together. The guard's own behaviour stays end-to-end.
     */
    expect(screen.queryAllByTestId('context-menu'), 'a second menu host was raised over the row').toHaveLength(1);
    expect(menuLabels(), 'the ROOT menu was raised over the row it was clicked on').not.toEqual([
      'Paste',
      'Undo',
      'Redo',
      'New File',
      'New Folder',
      'Open In',
      'Copy Path',
      'Collapse All Children',
      'Expand All Children',
    ]);
  });

  it('leads its Open In flyout with the OS reveal, exactly as a row does', async () => {
    // The migrated test's third claim. `Terminal` is drawn and DISABLED because this mount publishes
    // no `terminal.listFlavours`, which is FR-035's own state — the row exists either way.
    const { user, body } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: body });
    await user.click(await screen.findByTestId('menu-item-Open In'));

    expect(menuLabels('submenu-Open In')).toEqual(['OS File Explorer', 'Terminal']);
  });
});

describe('what the root menu does goes to the root, not to the selection (FR-097)', () => {
  /**
   * Select a row first, THEN open the empty-space menu.
   *
   * This is the whole reason these two tests exist. The migrated spec right-clicked the empty space
   * with nothing selected, where "addressed the root" and "addressed the selection" are the same
   * string — so it could not have caught a handler that passed the selected node through.
   */
  async function selectThenOpenRootMenu() {
    const { user, tree, body, files } = await mount();
    await user.click(within(tree).getByText('a.txt'));
    await waitFor(() =>
      expect(tree.querySelector('.tree-row--selected .tree-label')).toHaveTextContent('a.txt'),
    );

    await user.pointer({ keys: '[MouseRight]', target: body });
    await screen.findByTestId('context-menu');
    return { user, tree, files };
  }

  it('New File creates in the root folder', async () => {
    const { user, files } = await selectThenOpenRootMenu();

    await user.click(screen.getByTestId('menu-item-New File'));

    await waitFor(() => expect(files.newFile).toHaveBeenCalledTimes(1));
    // `''` is the project root as `files-service` addresses it. A handler that passed the selected
    // node would call this with `'a.txt'`, and `resolveTarget` would then create beside it.
    expect(files.newFile).toHaveBeenCalledWith('');
    expect(files.newFolder).not.toHaveBeenCalled();
  });

  it('New Folder creates in the root folder', async () => {
    const { user, files } = await selectThenOpenRootMenu();

    await user.click(screen.getByTestId('menu-item-New Folder'));

    await waitFor(() => expect(files.newFolder).toHaveBeenCalledTimes(1));
    expect(files.newFolder).toHaveBeenCalledWith('');
    expect(files.newFile).not.toHaveBeenCalled();
  });
});

describe('the created item enters inline rename once the watcher reports it (FR-033/FR-096)', () => {
  it('opens a focused rename box on the new file, seeded with its name', async () => {
    /*
     * `createFile` parks the returned path in `pendingRename` and an effect keyed on the tree DATA
     * spends it — so the box can only open after a listing has come back carrying the new node.
     * Driving the watcher by hand is what makes that ordering visible: the E2E could only wait and
     * hope, and a regression that raced the two would have read as flake there and reads as a
     * failure here.
     */
    const { user, tree, body, files, notifyChange } = await mount();

    await user.pointer({ keys: '[MouseRight]', target: body });
    await user.click(await screen.findByTestId('menu-item-New File'));
    await waitFor(() => expect(files.newFile).toHaveBeenCalledWith(''));

    // The watcher reporting the create — `use-explorer-data.ts:606` coalesces on an 80ms timer.
    notifyChange();

    await waitFor(
      () => {
        const input = tree.querySelector<HTMLInputElement>('input.tree-rename');
        expect(input, 'no rename box opened on the new file').not.toBeNull();
        expect(input!.value).toBe('New file.txt');
      },
      { timeout: 3000 },
    );
    expect(tree.querySelector('input.tree-rename')).toHaveFocus();
  });
});
