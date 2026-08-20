/**
 * The "Open In" target label in the File Explorer's file menu (006 FR-098/FR-082).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-file-deleted.e2e.ts:40`
 * — `test('the Open-In target is labelled "Last Active Editor (<Panel name>)" (FR-098)')` (034 FR-045).
 *
 * ══ ANTI-VACUITY CONTROL (mandatory, 034) ══
 *
 * Delete the `globalThis.ResizeObserver = ImmediateResizeObserver` assignment in `beforeAll`.
 * `FileTree` gates `<Tree>` behind `useSize` and jsdom implements no `ResizeObserver` at all, so the
 * gate stays false and the tree NEVER mounts. **All THREE tests in this file fail**, each at
 * `await screen.findByRole('tree')` with "Unable to find role=tree". Nothing here can pass on an
 * empty DOM.
 *
 * ══ WHY THIS COMES DOWN FROM E2E ══
 *
 * The E2E launched Electron, started a daemon, made a real temp folder with a real `note.txt`,
 * created a real project, turned a panel into a real CodeMirror editor and renamed it through the
 * real inline rename — in order to read ONE STRING off a menu item. That string is
 * `file-tree.tsx:399`:
 *
 *     label: targetPanel ? `Last Active Editor (${targetPanel.title})` : 'Last Active Editor'
 *
 * composed from the layout the workspace store holds and the panel id the `last-active-editor`
 * module store holds. Neither is a filesystem fact, a watcher fact or a rendering fact, so none of
 * that apparatus was buying anything.
 *
 * ══ WHAT THIS ASSERTS THAT THE E2E DID NOT ══
 *
 * The E2E had exactly ONE panel in the tab, so `Last Active Editor (Scratch)` would have been drawn
 * identically by an implementation that named the tab's *active* panel, or its *first* panel, or any
 * panel at all. Two of the three tests below close that hole:
 *
 *   - the FALLBACK: with nothing in the last-active-editor store the label is the bare
 *     `Last Active Editor`, which proves the parenthetical is composed rather than constant;
 *   - the DISAMBIGUATION: two panels in one tab, with `activePanelId` deliberately pointing at the
 *     panel the store does NOT name, so an implementation reading the tab's active panel names the
 *     wrong one and reddens.
 *
 * ══ WHAT DID NOT MOVE ══
 *
 * Nothing else from that E2E file. The deletion-under-a-live-watcher test and the restart-recovery
 * test both stay: they need a real filesystem watcher and a real abnormal exit respectively.
 *
 * ══ CONTEXTS ══
 *
 * Modelled on `file-tree.test.ts`, which established that `FileTree` mounts in jsdom and that
 * `ContextMenuProvider` drives a real menu there (`file-tree.test.ts:509`). The one thing that file
 * does NOT do is give the workspace store a layout — it mounts with `activeProjectId: null` because
 * nothing under test read `ws.layout`. This test is entirely about `ws.layout`, so it passes a real
 * project id and answers `workspace.load` from the fake bridge with a layout built by core's own
 * `createDefaultLayout` / `addPanel` / `renamePanel`. No production change was needed:
 * `WorkspaceProvider` is exported and takes its client as a prop.
 *
 * `restored: true` is returned deliberately — `workspace-store.tsx:261` schedules a SAVE when a
 * layout comes back unrestored, and a save is an RPC this test has no reason to answer.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPanel,
  createDefaultLayout,
  renamePanel,
  type WorkspaceLayout,
} from '@throng/core';
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
import {
  forgetEditor,
  setLastActiveEditor,
} from '../../src/renderer/editor/last-active-editor.js';
// 035 T055 — the Open In target is disabled by what the TARGET PANEL already holds, which lives here.
import {
  removeEditorState,
  setEditorState,
} from '../../src/renderer/editor/editor-state.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed viewport — the load-bearing global (see the control above)
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
 * The fake project
 * ────────────────────────────────────────────────────────────────────────── */

const ROOT_FOLDER = 'C:/projects/demo';
const PROJECT_ID = 'proj-open-in';
const TAB_ID = 't1';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** One file is all this needs: the menu under test is a FILE's menu (`file-tree.tsx:376`). */
const LISTING: Record<string, FileTreeEntry[]> = {
  '': [entry('note.txt', 'file')],
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Layouts
 * ────────────────────────────────────────────────────────────────────────── */

/** One tab, one panel, renamed — the shape the E2E arranged with a real inline rename. */
function oneNamedPanel(title: string): WorkspaceLayout {
  return renamePanel(createDefaultLayout(PROJECT_ID, { tab: TAB_ID, panel: 'p1' }), 'p1', title);
}

/**
 * Two panels in one tab, with `activePanelId` LEFT ON `p1`.
 *
 * That mismatch is the whole point: the label must name the panel the last-active-editor store
 * holds, and this layout makes "the tab's active panel" and "the last active editor" two different
 * panels, so the two rules can no longer produce the same string.
 */
function twoNamedPanels(first: string, second: string): WorkspaceLayout {
  let layout = createDefaultLayout(PROJECT_ID, { tab: TAB_ID, panel: 'p1' });
  layout = addPanel(layout, TAB_ID, 'p2');
  layout = renamePanel(layout, 'p1', first);
  layout = renamePanel(layout, 'p2', second);
  return layout;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A fake daemon at the BRIDGE, as `file-tree.test.ts` and `project-settings-dialog.test.ts` do:
 * the state clients are classes with private fields, so a structural stub is not assignable to
 * them, but their one dependency `ThrongBridge` is an interface with a single method.
 *
 * Anything unexpected is REJECTED by name rather than answered with undefined, so an RPC nobody
 * planned for reads as a message instead of as a destructure three frames away.
 */
function fakeServices(layout: WorkspaceLayout): { services: Services; loads: string[] } {
  const loads: string[] = [];
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          loads.push((params as { projectId: string }).projectId);
          return Promise.resolve({ layout, restored: true } as TResult);
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
    services: {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new WorkspaceClient(bridge),
      subWorkspaces: new SubWorkspacesClient(bridge),
      documents: new DocumentClient(bridge),
      fileOpUndo: new FileOpUndoClient(bridge),
      panelNames: new PanelNameClient(bridge),
    },
    loads,
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
  // The last-active-editor store is a plain module Map (`last-active-editor.ts:7`) and therefore
  // shared by every test in the process. Left behind, it would make the FALLBACK test below pass or
  // fail depending on which test ran before it.
  forgetEditor('p1');
  forgetEditor('p2');
});

async function mount(layout: WorkspaceLayout) {
  const user = userEvent.setup();
  const { services, loads } = fakeServices(layout);

  // `FileTree` reaches the preload bridge exclusively through optional chaining, so only what it
  // actually calls needs to exist. `editor.isOpen` is reached at `file-tree.tsx:378` to decide
  // whether the Open In targets are disabled; false keeps every target enabled.
  Reflect.set(window, 'throng', {
    files: {
      setRoot: vi.fn(),
      list: vi.fn((relDir: string) => {
        const entries = LISTING[relDir];
        return Promise.resolve(
          entries ? { entries } : { error: `no such folder: ${relDir}`, cause: null },
        );
      }),
      onChange: vi.fn(() => () => {}),
      onWatchFailed: vi.fn(() => () => {}),
    },
    editor: { isOpen: () => Promise.resolve(false) },
  });

  const subject = createElement(FileTree, {
    rootFolder: ROOT_FOLDER,
    projectId: PROJECT_ID,
    hiddenPaths: [],
    onHide: vi.fn(),
  });

  const wrap = (children: ReactNode): ReactElement =>
    createElement(
      ServicesProvider,
      { services },
      createElement(
        WorkspaceProvider,
        { client: services.workspace, activeProjectId: PROJECT_ID },
        createElement(
          NotificationProvider,
          null,
          createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, children)),
        ),
      ),
    );

  render(wrap(subject));

  const tree = await screen.findByRole('tree');
  // The menu is built ONCE, at right-click, from `ws.layout` — so a right-click issued before the
  // load resolves would build a menu with no Open In group at all. Waiting for the load here is
  // what makes the failure below "the label is wrong" rather than "the menu was early".
  await waitFor(() => expect(loads).toEqual([PROJECT_ID]));
  return { user, tree };
}

/** Right-click the file row and open the Open In flyout. Returns the flyout. */
async function openInFlyout(
  user: ReturnType<typeof userEvent.setup>,
  tree: HTMLElement,
): Promise<HTMLElement> {
  await user.pointer({ keys: '[MouseRight]', target: within(tree).getByText('note.txt') });
  await user.click(await screen.findByTestId('menu-item-Open In'));
  return screen.findByTestId('submenu-Open In');
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The label
 * ────────────────────────────────────────────────────────────────────────── */

describe('the Open In target names the tab’s last active editor (FR-098)', () => {
  it('draws "Last Active Editor (<panel name>)" for the panel the store holds', async () => {
    // The migrated claim, verbatim: the E2E renamed its editor panel to "Scratch" and asserted
    // `menu-item-Last Active Editor (Scratch)`.
    setLastActiveEditor(TAB_ID, 'p1');
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    const flyout = await openInFlyout(user, tree);

    expect(within(flyout).getByTestId('menu-item-Last Active Editor (Scratch)')).toBeVisible();
  });

  it('drops the parenthetical entirely when the tab has no last active editor', async () => {
    // Nothing is registered for this tab, so `getLastActiveEditor` returns undefined and there is no
    // panel to name. Without this test a hard-coded "Last Active Editor (Scratch)" would pass the
    // one above, which is precisely the shape the single-panel E2E could not rule out.
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    const flyout = await openInFlyout(user, tree);

    expect(within(flyout).getByTestId('menu-item-Last Active Editor')).toBeVisible();
    expect(within(flyout).queryByTestId('menu-item-Last Active Editor (Scratch)')).toBeNull();
  });

  it('names the STORE’s panel, not the tab’s active one, when the two differ', async () => {
    /*
     * `activePanelId` stays on `p1` (createDefaultLayout sets it and addPanel does not move it)
     * while the last-active-editor store points at `p2`. An implementation that read the tab's
     * active panel — an entirely plausible simplification, and one the E2E's single-panel tab could
     * never have distinguished — draws "(Left)" here.
     */
    setLastActiveEditor(TAB_ID, 'p2');
    const { user, tree } = await mount(twoNamedPanels('Left', 'Right'));

    const flyout = await openInFlyout(user, tree);

    expect(within(flyout).getByTestId('menu-item-Last Active Editor (Right)')).toBeVisible();
    expect(within(flyout).queryByTestId('menu-item-Last Active Editor (Left)')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * One buffer per file, enforced on the menu
 * (FR-011a/FR-072 — migrated from editor-feedback.e2e.ts:116, 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHY THE ITEM IS DISABLED RATHER THAN ABSENT ══
 *
 * throng keeps ONE buffer per file, app-wide. "New Editor" would make a second, so it is refused
 * once the file is open — but it stays on the menu, greyed, because a row that vanishes teaches
 * nobody why. The user who wants a second view of a file needs to learn that the answer is no, not
 * that the command was never there.
 *
 * ══ WHAT MOVED, AND WHAT DID NOT ══
 *
 * The E2E asserted three things: the item is enabled while the file is closed, clicking it opens a
 * second editor panel holding the file, and re-opening the menu afterwards shows it disabled.
 *
 * The first and third are the RULE — `disabled: alreadyOpen || !activeTabId` in `file-tree.tsx`,
 * where `alreadyOpen` comes from `editor.isOpen` over the bridge. This harness already stubs that
 * bridge, so both states are reachable by answering it differently; the E2E reached the second state
 * by really opening a file in a real editor panel.
 *
 * The middle claim stays end-to-end: that clicking actually produces a second editor panel hosting
 * the file is the editor's, not the menu's.
 */
describe('New Editor is refused once the file is open (FR-011a)', () => {
  /** The same mount, with `editor.isOpen` answering as the caller chooses. */
  async function mountWithOpenState(alreadyOpen: boolean) {
    const mounted = await mount(oneNamedPanel('Scratch'));
    // Re-point only `editor.isOpen`; everything else the tree reaches stays as `mount` left it.
    const bridge = Reflect.get(window, 'throng') as { editor: { isOpen: () => Promise<boolean> } };
    bridge.editor.isOpen = () => Promise.resolve(alreadyOpen);
    return mounted;
  }

  const isDisabled = (el: HTMLElement): boolean =>
    el.className.includes('context-menu__item--disabled') ||
    el.getAttribute('aria-disabled') === 'true';

  it('is offered, and ENABLED, while the file is not open anywhere', async () => {
    const { user, tree } = await mountWithOpenState(false);

    const flyout = await openInFlyout(user, tree);

    const item = within(flyout).getByTestId('menu-item-New Editor');
    expect(item).toBeVisible();
    expect(isDisabled(item), 'a closed file must be openable in a new editor').toBe(false);
  });

  it('is still OFFERED but disabled once the file is open — not removed', async () => {
    /*
     * Both halves in one assertion pair, deliberately. "Disabled" alone would pass against an item
     * that had disappeared (`getByTestId` would throw, but a `queryByTestId`-shaped test would not),
     * and "present" alone is what the broken build did.
     */
    const { user, tree } = await mountWithOpenState(true);

    const flyout = await openInFlyout(user, tree);

    const item = within(flyout).getByTestId('menu-item-New Editor');
    expect(item, 'the row must stay on the menu — a vanished row teaches nobody why').toBeVisible();
    expect(isDisabled(item)).toBe(true);
  });

  it('leaves the OTHER Open In targets alone in both states', async () => {
    /*
     * The scope of the refusal. FR-011a is about a SECOND buffer, so "Last Active Editor" — which
     * reuses the buffer that already exists — must stay available exactly when it otherwise would.
     * A fix that disabled the whole submenu would satisfy the test above and take away the one
     * target that still makes sense.
     */
    setLastActiveEditor(TAB_ID, 'p1');
    const { user, tree } = await mountWithOpenState(true);

    const flyout = await openInFlyout(user, tree);

    /*
     * Enabled, not merely present — and the two flags really are independent: `alreadyOpen` is
     * app-wide, while this target is disabled only by `openInTargetAlready`, which asks whether THIS
     * panel already holds THIS file. It does not, so the target stands.
     */
    const lastActive = within(flyout).getByTestId('menu-item-Last Active Editor (Scratch)');
    expect(lastActive).toBeVisible();
    expect(isDisabled(lastActive)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * editor-feedback2.e2e.ts:82 — the target that already holds the file
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * "Last Active Editor" is disabled when that editor ALREADY holds this file (FR-082/FR-098).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-feedback2.e2e.ts:82` (035 T055) — `test('"This editor"
 * is disabled when the file is already open in the target editor')`.
 *
 * ══ WHY THIS BELONGS BESIDE THE NEW EDITOR TESTS ══
 *
 * The two disabled flags above this block are independent, and the file already says so: `New
 * Editor` is disabled by `alreadyOpen`, which is APP-WIDE, while this target is disabled by
 * `openInTargetAlready`, which asks whether THIS panel holds THIS file (`file-tree.tsx:390`).
 *
 * The existing test at "leaves the OTHER Open In targets alone in both states" proves one direction
 * — app-wide-open does not disable this target. Nothing proved the other: that when the panel really
 * does hold the file, the target goes quiet. A build that never computed `openInTargetAlready` at
 * all would pass everything in this file up to here.
 *
 * ══ WHAT IT REPLACES ══
 *
 * The E2E created a project, opened an editor, right-clicked the file, opened the flyout, clicked
 * the target, waited for the document to load, then right-clicked and opened the flyout AGAIN to see
 * the row had gone quiet. The second half is this component's; the first is the click actually
 * loading the file, which `editor-feedback2.e2e.ts` keeps.
 */
describe('Last Active Editor goes quiet when that editor holds the file (FR-082)', () => {
  // The editor store is module state and outlives a render. Left behind, `p1`'s file would decide
  // the NEXT test's answer — which is the shape of leak that makes a suite order-dependent.
  afterEach(() => removeEditorState('p1'));

  const isDisabled = (el: HTMLElement): boolean =>
    el.className.includes('context-menu__item--disabled') ||
    el.getAttribute('aria-disabled') === 'true';

  const target = (flyout: HTMLElement): HTMLElement =>
    within(flyout).getByTestId('menu-item-Last Active Editor (Scratch)');

  it('is ENABLED while that editor holds something else', async () => {
    setLastActiveEditor(TAB_ID, 'p1');
    setEditorState('p1', { filePath: 'C:/projects/demo/other.txt' });
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    expect(isDisabled(target(await openInFlyout(user, tree)))).toBe(false);
  });

  it('is DISABLED once that editor holds THIS file — opening it again would do nothing', async () => {
    setLastActiveEditor(TAB_ID, 'p1');
    setEditorState('p1', { filePath: 'C:/projects/demo/note.txt' });
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    const item = target(await openInFlyout(user, tree));
    expect(item, 'the row stays on the menu — a vanished row teaches nobody why').toBeVisible();
    expect(isDisabled(item)).toBe(true);
  });

  it('compares the PATHS, not the spellings — Windows calls those the same file', async () => {
    /*
     * `file-tree.tsx:390` normalises both sides before comparing, and it has to: the tree composes
     * its path from the project root while the editor store holds whatever spelling the file was
     * opened with. A raw comparison leaves the row enabled, the user clicks it, and nothing happens —
     * the exact no-op the disabling exists to prevent.
     */
    setLastActiveEditor(TAB_ID, 'p1');
    setEditorState('p1', { filePath: 'C:\\Projects\\Demo\\Note.txt' });
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    expect(isDisabled(target(await openInFlyout(user, tree)))).toBe(true);
  });

  it('is ENABLED when the editor holds NO file at all', async () => {
    // A never-saved scratch buffer. There is nothing for this file to already be, so the target is
    // exactly as available as it would be with no editor state at all.
    setLastActiveEditor(TAB_ID, 'p1');
    setEditorState('p1', { filePath: null });
    const { user, tree } = await mount(oneNamedPanel('Scratch'));

    expect(isDisabled(target(await openInFlyout(user, tree)))).toBe(false);
  });
});
