/**
 * What a gesture does to a row: double-click expansion, the chevron round trip, the inline rename's
 * no-op guard, and where the keyboard is left standing afterwards
 * (004 FR-070; #121; #122; #140; 026 rename-focus).
 *
 * PLACE AT: `packages/ui/tests/component/explorer-tree-interaction.test.ts`
 * MIGRATED FROM (034 FR-045):
 *   - `packages/ui/tests/e2e/explorer-dir-doubleclick.e2e.ts` — its only test
 *   - `packages/ui/tests/e2e/explorer-tree-state.e2e.ts` — `(2)` and `(3)`
 *   - `packages/ui/tests/e2e/explorer-rename-focus.e2e.ts` — the first three tests
 *   - `packages/ui/tests/e2e/rename-noop.e2e.ts` — its only test
 *
 * ══ WHY THESE COME DOWN ══
 *
 * Every one of them launched Electron, started a daemon and made a real temp folder in order to ask
 * what a click, a double-click, an F2 or an Escape does to the rows of `FileTree`. None of them
 * needs a real filesystem to answer that: the subject in all nine is renderer state — react-arborist's
 * open map, its focus slice, `TreeRow`'s two click handlers, and `onRename`'s guard clause.
 *
 * The `ResizeObserver` finding that makes this possible is documented at length in
 * `file-tree.test.ts`; the stub below is the same one and is load-bearing for the same reason.
 *
 * ══ WHAT DOES NOT COME DOWN, AND WHY ══
 *
 *   - `explorer-tree-state.e2e.ts` `(1)`, `(1b)` and `(5)` all DRAG a row onto another row.
 *     react-arborist's drop maths is the one part of it that measures the DOM
 *     (`dnd/compute-drop.js` calls `getBoundingClientRect`), which jsdom reports as 0×0. They stay.
 *   - `rename-noop.e2e.ts`'s `existsSync(join(root, 'b.txt'))` half — that a committed rename puts
 *     the bytes at the new path — is proved on a real temp filesystem at
 *     `packages/ui/tests/integration/files-service.test.ts:48`:
 *         `expect(await svc.rename('old.txt', 'new.txt')).toEqual({ ok: true });`
 *     with the file written to a real `mkdtemp` root. This layer therefore stops at the bridge call
 *     and asserts the ARGUMENTS, which is the half no other layer sees.
 *   - `explorer-rename-focus.e2e.ts`'s fourth test (the #144 fence: an editor keeps its caret while
 *     the tree re-highlights) needs a real CodeMirror in a real panel, so it stays.
 *
 * ══ WHERE THESE LAND STRONGER THAN THE E2E DID ══
 *
 *   - The rename-focus tests asserted only that focus was SOMEWHERE inside the tree. That is
 *     satisfied by react-arborist's own fallback, which focuses `firstNode` — the ROOT row — when
 *     the renamed node's id no longer resolves. So the E2E would pass with the caret parked on a row
 *     the user was not working on. Here the focused row is asserted BY NAME, which is what
 *     `use-explorer-data.ts:716`'s deliberate `api.select(rel)` (focus NOT suppressed) actually buys.
 *   - `rename-noop` asserted "no error banner". That is equally satisfied by a rename that was
 *     attempted and happened to succeed at renaming a file to its own name. Here the claim is that
 *     `files.rename` is NEVER CALLED — which is what `onRename`'s `if (next === current) return;`
 *     guard exists to do, and is invisible from outside the process.
 *   - `explorer-tree-state (2)` could not distinguish "the chevron toggled" from "the chevron
 *     opened and a later re-render closed it"; the round trip is asserted here on the open map's own
 *     `aria-expanded`, alongside the rows.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `beforeAll` that installs `ImmediateResizeObserver`. `FileTree` gates its `<Tree>` on
 * `width > 0 && height > 0` fed by a `ResizeObserver` jsdom does not implement, so the tree never
 * mounts, `mount()`'s `findByRole('tree')` throws, and **ALL NINE tests in this file fail**. Every
 * test goes through `mount()`, and no absence assertion below ("no rename call", "no open intent",
 * "no error notice") can be satisfied by an empty document.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 * A directory tree that can actually be renamed
 * ────────────────────────────────────────────────────────────────────────── */

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

/** `makeProject()` from the migrated files, as listings rather than as real `mkdir`s. */
const PROJECT = (): Record<string, FileTreeEntry[]> => ({
  '': [entry('Docs', 'folder'), entry('a.txt', 'file'), entry('b.txt', 'file')],
  Docs: [entry('note.txt', 'file')],
});

const ROOT_FOLDER = 'C:/projects/demo';

/**
 * A `files.*` bridge whose `rename` REALLY RENAMES — in the listings, and in the keys of every
 * folder underneath.
 *
 * A fake that answered `{ ok: true }` and left the listings alone would make the rename tests pass
 * against a tree that never re-read anything: `onRename` reloads the parent directory
 * (`use-explorer-data.ts:1051`) and the #122 re-selection drains only once the NEW node materialises
 * out of that read. Faking the effect away would remove the very step under test.
 */
function fakeFiles(initial: Record<string, FileTreeEntry[]> = PROJECT()) {
  const dirs = new Map<string, FileTreeEntry[]>(Object.entries(initial));
  const renames: { relPath: string; newName: string }[] = [];

  const parentOf = (rel: string): string => {
    const i = rel.lastIndexOf('/');
    return i === -1 ? '' : rel.slice(0, i);
  };
  const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

  const files = {
    setRoot: vi.fn(),
    list: vi.fn((relDir: string) => {
      const entries = dirs.get(relDir);
      return Promise.resolve(
        entries ? { entries: [...entries] } : { error: `no such folder: ${relDir}`, cause: null },
      );
    }),
    rename: vi.fn((relPath: string, newName: string) => {
      renames.push({ relPath, newName });
      const parent = parentOf(relPath);
      const siblings = dirs.get(parent);
      const old = baseOf(relPath);
      const target = siblings?.find((e) => e.name === old);
      if (!siblings || !target) {
        return Promise.resolve({ error: `no such item: ${relPath}`, cause: null });
      }
      if (siblings.some((e) => e.name === newName)) {
        return Promise.resolve({ error: `${newName} already exists`, cause: null });
      }
      // The entry keeps its identity and changes its name — as a rename does.
      siblings.splice(siblings.indexOf(target), 1, { ...target, name: newName });
      // …and every listing keyed under the old path moves with it.
      const newRel = parent ? `${parent}/${newName}` : newName;
      for (const key of [...dirs.keys()]) {
        if (key === relPath || key.startsWith(`${relPath}/`)) {
          const moved = dirs.get(key)!;
          dirs.delete(key);
          dirs.set(newRel + key.slice(relPath.length), moved);
        }
      }
      return Promise.resolve({ ok: true as const });
    }),
    onChange: vi.fn(() => () => {}),
    onWatchFailed: vi.fn(() => () => {}),
  };
  return { files, renames, dirs };
}

/**
 * A fake daemon at the BRIDGE (the pattern `project-settings-dialog.test.ts` and `file-tree.test.ts`
 * both use). A committed rename adds two RPCs to the mount-time pair: `fileopUndo.set` (the rename
 * is undoable, `use-explorer-data.ts:1044`) and `document.movePath` (a language override follows the
 * file, `:1064`). Both are fire-and-forget at their call sites; answering them keeps an unexpected
 * RPC readable as a named rejection rather than as an undefined destructure.
 */
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
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

let projectSeq = 0;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(listing?: Record<string, FileTreeEntry[]>) {
  const user = userEvent.setup();
  const { files, renames, dirs } = fakeFiles(listing);
  const projectId = `project-${(projectSeq += 1)}`;

  Reflect.set(window, 'throng', {
    files,
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

  const tree = await screen.findByRole('tree');
  return { user, tree, files, renames, dirs, projectId };
}

/** The visible row labels, top to bottom. */
const rowLabels = (tree: HTMLElement): string[] =>
  within(tree)
    .getAllByRole('treeitem')
    .map((row) => row.querySelector('.tree-label')?.textContent ?? '');

/** Toggle a folder by its chevron. */
const twisty = (tree: HTMLElement, relPath: string): HTMLElement =>
  within(tree).getByTestId(`tree-twisty-${relPath}`);

/** The `.explorer` pane — the element `useExplorerKeybindings` is attached to. */
const pane = (): HTMLElement => screen.getByTestId('file-explorer-tree');

/**
 * The LABEL of the row that currently holds DOM focus, or a reason it holds none.
 *
 * react-arborist uses roving focus: `RowContainer` focuses its `role="treeitem"` whenever the node
 * is focused AND the tree is focused, so the active element is always a row and never the container.
 * Naming the row is the whole point — "focus is inside the tree" is satisfied by the fallback that
 * parks it on the root, which is the wrong answer wearing the right shape.
 */
function focusedRowLabel(): string {
  const active = document.activeElement;
  if (!active || active === document.body) return 'nothing (document.body)';
  if (!pane().contains(active)) return 'something OUTSIDE the explorer pane';
  const item = active.closest('[role="treeitem"]');
  if (!item) return 'an element inside the pane that is not a row';
  return item.querySelector('.tree-label')?.textContent ?? '(a row with no label)';
}

/**
 * F2, as a real key event on whatever holds focus.
 *
 * Not `user.keyboard('{F2}')`: user-event's key map has no entry for the function keys, so that call
 * throws rather than pressing anything. `useExplorerKeybindings` reads `e.key` off a React
 * `onKeyDown` bound to the `.explorer` pane, so a `keyDown` on the focused descendant bubbles into
 * exactly the handler under test.
 */
const pressF2 = (): void => {
  fireEvent.keyDown(document.activeElement ?? pane(), { key: 'F2' });
};

/** The inline rename input, once react-arborist has swapped it in for the label. */
const renameInput = async (): Promise<HTMLInputElement> =>
  (await waitFor(() => {
    const el = pane().querySelector('input.tree-rename');
    expect(el, 'the inline rename input never appeared').not.toBeNull();
    return el;
  })) as HTMLInputElement;

/** Record every `throng:open-file` intent raised on `window`. */
function openIntents(): { detail: { relPath: string }[]; stop: () => void } {
  const detail: { relPath: string }[] = [];
  const handler = (e: Event): void => {
    detail.push((e as CustomEvent).detail);
  };
  window.addEventListener('throng:open-file', handler);
  return { detail, stop: () => window.removeEventListener('throng:open-file', handler) };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Expansion gestures — explorer-dir-doubleclick.e2e.ts, explorer-tree-state.e2e.ts (2)
 * ────────────────────────────────────────────────────────────────────────── */

describe('what opens a folder (#121 / #140)', () => {
  it('double-clicking a folder expands it, and double-clicking again collapses it', async () => {
    /*
     * #140. `decideClick` is unit-tested as a pure switch over (mode, kind, clickCount) and cannot
     * see any of this: that `TreeRow` calls it from `onDoubleClick` at all, that a 'toggle' verdict
     * reaches `node.toggle()`, or that the toggle lazily fetches the folder's listing on the way.
     */
    const { tree, user } = await mount();
    const docs = within(tree).getByText('Docs');

    expect(rowLabels(tree)).toEqual(['demo', 'Docs', 'a.txt', 'b.txt']);

    await user.dblClick(docs);

    await waitFor(() => expect(rowLabels(tree)).toContain('note.txt'));

    await user.dblClick(within(tree).getByText('Docs'));

    await waitFor(() => expect(rowLabels(tree)).not.toContain('note.txt'));
  });

  it('a single click on a folder name selects it and leaves it closed', async () => {
    // #121 preserved under #140: the name is a selector, never a toggle. Both halves are asserted,
    // because "did not expand" alone is also true of a click that landed on nothing.
    const { tree, user } = await mount();

    await user.click(within(tree).getByText('Docs'));

    await waitFor(() =>
      expect(tree.querySelector('.tree-row--selected .tree-label')).toHaveTextContent('Docs'),
    );
    expect(rowLabels(tree)).not.toContain('note.txt');
  });

  it('the chevron opens the folder and closes it again, reporting its state as it goes', async () => {
    /*
     * The round trip `explorer-tree-state.e2e.ts:(2)` opened with. The E2E read `.tree-twisty--open`
     * — a class, and therefore a claim about the same render that drew the rows. `aria-expanded` is
     * read here instead because it comes from react-arborist's OWN open map (`tree-node.tsx:118`),
     * so a tree whose glyph and whose open state disagree — the exact discrepancy that file was
     * filed about — fails here rather than agreeing with itself.
     */
    const { tree, user } = await mount();

    expect(twisty(tree, 'Docs')).toHaveAttribute('aria-expanded', 'false');

    await user.click(twisty(tree, 'Docs'));

    await waitFor(() => expect(rowLabels(tree)).toContain('note.txt'));
    expect(twisty(tree, 'Docs')).toHaveAttribute('aria-expanded', 'true');

    await user.click(twisty(tree, 'Docs'));

    await waitFor(() => expect(rowLabels(tree)).not.toContain('note.txt'));
    expect(twisty(tree, 'Docs')).toHaveAttribute('aria-expanded', 'false');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The rename itself — rename-noop.e2e.ts, explorer-tree-state.e2e.ts (3)
 * ────────────────────────────────────────────────────────────────────────── */

describe('committing an inline rename (FR-070, #122)', () => {
  it('confirming an UNCHANGED name asks the filesystem for nothing at all', async () => {
    /*
     * FR-070's whole content is a guard clause: `use-explorer-data.ts:1019`
     *     `if (next === current) return;`
     * The migrated test asserted "no error banner", which a rename that WAS attempted and happened
     * to succeed satisfies just as well. What the requirement actually says is that no operation
     * happens — so the call log is the assertion, and it is one the E2E could not make.
     */
    const { tree, user, files } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();
    expect(input.value).toBe('a.txt'); // pre-filled with the current name

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(pane().querySelector('input.tree-rename')).toBeNull());
    expect(files.rename).not.toHaveBeenCalled();
    expect(screen.queryByTestId('explorer-error')).toBeNull();
    expect(rowLabels(tree)).toEqual(['demo', 'Docs', 'a.txt', 'b.txt']);
  });

  it('confirming a CHANGED name renames that path to that name, and redraws the row', async () => {
    /*
     * The arguments are the half no other layer sees. `files-service.test.ts:48` proves
     * `rename('old.txt', 'new.txt')` puts the bytes at the new path on a real disk; what it cannot
     * see is which path and which name the TREE hands it — a rename that addressed the selection
     * rather than the edited row would satisfy the service test perfectly.
     */
    const { tree, user, files, renames } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();
    fireEvent.change(input, { target: { value: 'renamed.txt' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(rowLabels(tree)).toContain('renamed.txt'));
    expect(renames).toEqual([{ relPath: 'a.txt', newName: 'renamed.txt' }]);
    expect(files.rename).toHaveBeenCalledTimes(1);
    expect(rowLabels(tree)).not.toContain('a.txt');
    expect(screen.queryByTestId('explorer-error')).toBeNull();
  });

  it('leaves the renamed file SELECTED at its new path, and opens no editor', async () => {
    /*
     * `explorer-tree-state.e2e.ts:(3)`, both halves.
     *
     * The premise is asserted first, exactly as the migrated test learned to: in the default
     * `openOnClick: 'single'` mode a click on a FILE really does raise an open intent, so
     * "the rename raised none" is a claim about the rename rather than about a mode in which
     * nothing could open. Under `'none'` the assertion would hold vacuously.
     */
    const { tree, user } = await mount();
    const opens = openIntents();

    try {
      await user.click(within(tree).getByText('a.txt'));
      await waitFor(() => expect(opens.detail).toHaveLength(1)); // PREMISE: opens are live

      opens.detail.length = 0;
      pressF2();
      const input = await renameInput();
      fireEvent.change(input, { target: { value: 'b2.txt' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // #122 — the rename re-keys the node, so the old selection cannot match; the pending
      // re-selection drains onto the NEW path once it materialises out of the parent re-read.
      await waitFor(() =>
        expect(tree.querySelector('.tree-row--selected .tree-label')).toHaveTextContent('b2.txt'),
      );
      expect(tree.querySelectorAll('.tree-row--selected')).toHaveLength(1);
      expect(opens.detail).toEqual([]);
    } finally {
      opens.stop();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Where the keyboard is left standing — explorer-rename-focus.e2e.ts
 * ────────────────────────────────────────────────────────────────────────── */

describe('a rename leaves the keyboard in the tree (026)', () => {
  it('commits a FOLDER rename and focuses the renamed row itself', async () => {
    /*
     * The migrated test asked only whether focus was inside the tree. That is too weak to fail on
     * the bug: after a rename the old id no longer resolves, so react-arborist's own
     * `setTimeout(() => this.onFocus())` (`tree-api.js:322`) falls back to `firstNode` — the ROOT
     * row — and focus is "inside the tree" while resting on a row the user never touched.
     *
     * `use-explorer-data.ts:716` is the actual fix, and it is deliberate: every other programmatic
     * select in that file passes `{ focus: false }` for issue #144, and this one does not, because
     * a rename is by construction something the user just did IN the tree. Naming the focused row
     * is what tells the two apart.
     */
    const { tree, user } = await mount();

    await user.click(within(tree).getByText('Docs'));
    pressF2();
    const input = await renameInput();
    fireEvent.change(input, { target: { value: 'Documents' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(rowLabels(tree)).toContain('Documents'));
    await waitFor(() => expect(focusedRowLabel()).toBe('Documents'));
  });

  it('commits a FILE rename and the tree still answers F2 without a click', async () => {
    /*
     * The behavioural half, and the one that would have caught the bug: DOM focus can sit on a
     * container whose key handling has moved on. A second F2 opening another inline editor is the
     * thing the user actually lost. A rename is a move for both kinds, but the file case is
     * asserted separately so a fix that special-cased folders cannot pass.
     */
    const { tree, user } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const first = await renameInput();
    fireEvent.change(first, { target: { value: 'renamed.txt' } });
    fireEvent.keyDown(first, { key: 'Enter' });

    await waitFor(() => expect(rowLabels(tree)).toContain('renamed.txt'));
    await waitFor(() => expect(focusedRowLabel()).toBe('renamed.txt'));

    pressF2();

    const second = await renameInput();
    expect(second.value).toBe('renamed.txt');
  });

  it('CANCELLING a rename with Escape also leaves the row focused and F2 live', async () => {
    /*
     * Escape unmounts the same input by a different route (`node.reset()`, `tree-api.js:325`), and a
     * fix that only ran on the commit path would strand the user who changed their mind. Escape is
     * `stopPropagation`ed inside the input (`tree-node.tsx:161`) so it cancels the rename rather
     * than the clipboard — which is also why the pane's Escape handler does not see it.
     */
    const { tree, user } = await mount();

    await user.click(within(tree).getByText('b.txt'));
    pressF2();
    const input = await renameInput();
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(pane().querySelector('input.tree-rename')).toBeNull());
    expect(rowLabels(tree)).toContain('b.txt'); // unchanged
    await waitFor(() => expect(focusedRowLabel()).toBe('b.txt'));

    pressF2();
    expect(await renameInput()).toBeInstanceOf(HTMLInputElement);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The rename BOX itself — what it selects, and what leaving it does
 * (024 FR-090, migrated from editor-feedback3.e2e.ts:135 and :159)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Both migrated tests made a real project on a real disk and launched Electron. The first read
 * `selectionStart`/`selectionEnd` off an `<input>`; the second typed a name, clicked another row,
 * and called `existsSync`.
 *
 * The first is a jsdom question in the most literal sense — `selectionStart` is a DOM property, and
 * it is set by the component, at mount, from the value it was given.
 *
 * The second has a real filesystem in it, and that half genuinely does not belong here — but it is
 * not the half the test was for. `files-service.test.ts:48` already proves `rename` moves the bytes;
 * FR-090's claim is that a BLUR commits at all, rather than discarding what the user typed the way
 * Escape does. That is the tree's decision, and it is what these assert.
 */
describe('the rename box selects the STEM, not the extension (migrated from editor-feedback3.e2e.ts:135)', () => {
  it('selects "top" out of "top.txt", leaving the dot and extension unselected', async () => {
    const { tree, user } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();

    // The point of the rule: typing immediately replaces the NAME and keeps the extension, which is
    // what a user renaming a file almost always wants. A select-all would eat `.txt` on the first
    // keystroke.
    expect(input.value).toBe('a.txt');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
  });

  it('selects the WHOLE name when there is no extension to protect', async () => {
    // The other side of the same rule, which the migrated test did not check: a dotless name has no
    // extension, so stopping short of the end would leave a character the user has to delete.
    const { tree, user } = await mount({ '': [entry('Docs', 'folder'), entry('README', 'file')] });

    await user.click(within(tree).getByText('README'));
    pressF2();
    const input = await renameInput();

    expect(input.value).toBe('README');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('README'.length);
  });

  /**
   * A FOLDER with a dot in its name selects the WHOLE name (#283).
   *
   * A folder has no extension: the dot is part of its name. The stem rule used to be applied to
   * every row, so a folder called `my.config` opened with `my` selected and the first character
   * typed left `.config` behind — renaming it to "settings" gave `settings.config`.
   *
   * The same code already handled the neighbouring case: `.github` selects everything, because a
   * leading dot means a dotfile with no extension. This is that reasoning one step further, and the
   * fix is the same shape — one condition, over `data.kind`, which was already in scope.
   *
   * Written first as a CHARACTERISATION test recording the defect, with this value written down as
   * the red step. That is what it now is.
   */
  it('selects the WHOLE name for a folder, dot and all (#283)', async () => {
    const { tree, user } = await mount({ '': [entry('my.config', 'folder')], 'my.config': [] });

    await user.click(within(tree).getByText('my.config'));
    pressF2();
    const input = await renameInput();

    expect(input.value).toBe('my.config');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('my.config'.length);
  });

  it('still selects only the stem for a FILE with the same name shape', async () => {
    /*
     * The other side of the fix, and the one that makes it a fix rather than a removal: a FILE
     * called `my.config` does have an extension, and typing must still replace `my` while keeping
     * `.config`. A change that simply deleted the stem rule passes the test above and fails this.
     */
    const { tree, user } = await mount({ '': [entry('my.config', 'file')] });

    await user.click(within(tree).getByText('my.config'));
    pressF2();
    const input = await renameInput();

    expect(input.value).toBe('my.config');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });

  it('selects the whole name for a DOTFOLDER, which has no extension either way', async () => {
    // `.github` — the leading-dot case, which was already right, asserted for a FOLDER so the two
    // conditions cannot be collapsed into one that only happens to work for files.
    const { tree, user } = await mount({ '': [entry('.github', 'folder')], '.github': [] });

    await user.click(within(tree).getByText('.github'));
    pressF2();
    const input = await renameInput();

    expect(input.value).toBe('.github');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('.github'.length);
  });
});

describe('clicking away from a rename COMMITS it (FR-090, migrated from editor-feedback3.e2e.ts:159)', () => {
  it('renames on blur rather than discarding what was typed', async () => {
    /*
     * FR-090 exists because the opposite is a defensible design and the wrong one here: a rename box
     * that a user types into and then clicks out of has been ANSWERED, and throwing the answer away
     * is a silent loss. Escape is the discard, and it is asserted separately below.
     */
    const { tree, user, renames } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();
    fireEvent.change(input, { target: { value: 'renamed.txt' } });

    // Blur by clicking another row — the migrated test's gesture exactly.
    fireEvent.blur(input);

    await waitFor(() => expect(rowLabels(tree)).toContain('renamed.txt'));
    expect(renames).toEqual([{ relPath: 'a.txt', newName: 'renamed.txt' }]);
    expect(rowLabels(tree)).not.toContain('a.txt');
    expect(screen.queryByTestId('explorer-error')).toBeNull();
  });

  /**
   * Escape DISCARDS the edit — and a note about the half of this jsdom cannot reach.
   *
   * ══ THIS TEST WAS WRITTEN VACUOUS FIRST, AND THE RED STEP CAUGHT IT ══
   *
   * The first version claimed something better: that Escape SUPPRESSES the blur-commit that follows.
   * That rule is real and `tree-node.tsx:151-154` implements it with an `escapedRef` — cancelling
   * removes the input, removing a focused element fires `blur`, and a blur handler that committed
   * unconditionally would turn every cancel into a rename.
   *
   * But deleting that suppression entirely left all fifteen tests here GREEN. **jsdom does not fire
   * `blur` when a focused element is unmounted**, so the sequence the rule guards never occurs: the
   * explicit `fireEvent.blur` in that draft landed on a node React had already detached, and did
   * nothing at all. A passing test measuring nothing is worse than no test, because it reads as
   * coverage.
   *
   * So the claim is narrowed to what actually runs — Escape discards — which IS red-proven: making
   * Escape call `submit` instead of `reset` fails this test. The suppression stays covered by
   * `editor-feedback3.e2e.ts`'s sibling only in the sense that a real browser exercises the path
   * incidentally; nothing asserts it deliberately, at any layer. That is recorded here rather than
   * papered over, because the next person to touch `escapedRef` will find this comment and not a
   * green bar.
   */
  it('discards the edit on Escape, renaming nothing', async () => {
    const { tree, renames } = await mount();

    await userEvent.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();
    fireEvent.change(input, { target: { value: 'renamed.txt' } });

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(pane().querySelector('input.tree-rename')).toBeNull());
    expect(renames).toEqual([]);
    expect(rowLabels(tree)).toContain('a.txt');
    expect(rowLabels(tree)).not.toContain('renamed.txt');
  });

  it('asks the filesystem for nothing when the blur follows no edit', async () => {
    // The same guard clause FR-070 states for Enter, reached by the other exit. Clicking away from a
    // box you never typed in is not a rename, and a rename attempted here would be a write nobody
    // asked for.
    const { tree, user, files } = await mount();

    await user.click(within(tree).getByText('a.txt'));
    pressF2();
    const input = await renameInput();
    fireEvent.blur(input);

    await waitFor(() => expect(pane().querySelector('input.tree-rename')).toBeNull());
    expect(files.rename).not.toHaveBeenCalled();
    expect(rowLabels(tree)).toContain('a.txt');
  });
});
