/**
 * file-tree (004, T025 + expand/persist refinement) — the File Explorer Pane
 * body. A virtualised react-arborist tree whose single root node (the project's
 * root folder) is always-open + non-collapsible but selectable; subfolders
 * collapse/expand and load lazily. Open-state, selection, and the level-by-level
 * Expand are driven by useExplorerData. All colours/fonts/icons are themed.
 */
import { logCaught, normaliseForCompare, pathCompareKey } from '@throng/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { Tree, type NodeApi, type TreeApi } from 'react-arborist';
import { ExplorerToolbar } from './toolbar.js';
import { useElevatedDropNotice } from './use-elevated-drop-notice.js';
import { TreeRow } from './tree-node.js';
import { PropertiesDialog } from './properties-dialog.js';
import { useExplorerData, ROOT_ID, type TreeNodeData } from './use-explorer-data.js';
import { ExplorerRowContext, type TreeOpenGesture } from './explorer-context.js';
import { buildContextMenuItems, pasteLabel } from './context-menu-items.js';
import { previewTargetFor, useExplorerKeybindings } from './explorer-keybindings.js';
import { registerExplorerCommands, unregisterExplorerCommands } from './explorer-commands.js';
import { useContextMenu } from '../context-menu-provider.js';
import { setTreeDrag, clearTreeDrag } from './tree-drag-store.js';
import { bindTreePointerController, treePointerBackend, type TreePointerController } from './tree-pointer-backend.js';
import { DragActionLabel, type DragActionLabelHandle } from './drag-action-label.js';
import { useErrorNotice, useNotify } from '../common/notification.js';
import { isOsFileDrag, osDropPaths } from '../common/os-drop-paths.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
/*
 * 043 FR-087/FR-089 — the "Open In" targets come from here now, not from ninety lines below.
 *
 * Six imports went with the block they served: `openFileInTab`, `openFileInNewEditor`,
 * `publishRefusedOpen`, `getLastActiveEditor`, `getEditorState`, `collectPanels` and
 * `normaliseFolder`. That this file no longer reaches for any of them is the readable measure of
 * the extraction — a shared builder that left its callers still importing the editor internals
 * would not have moved the decision, only copied it.
 */
import { describeOpenInTargets, openInMenuActions } from '../editor/open-in-targets.js';
import { performOpenIn, readOpenInFacts } from '../editor/open-in-perform.js';
import { useDirtyPathKey } from '../editor/editor-state.js';
import { useActiveEditorFilePath } from '../editor/active-editor-file.js';
import { PanelSkeleton } from '../common/loading.js';
import {
  buildTreeDragPayload,
  relPathUnderRoot,
  resolveDragEffect,
  resolveInboundDragEffect,
  resolveTarget,
  type FlavourOption,
  type PreviewAffordance,
  type TargetNode,
  type TerminalPanelConfig,
} from '@throng/core';
import { usePreviewProviders } from '../preview/provider-registry-context.js';
import { readPreviewOpenIn } from '../preview/preview-open-in.js';
import { useFlavours } from '../panel-type/use-flavours.js';
import { requestFindInFiles } from '../find-in-files/open-find-in-files.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import { focusPanel, requestPanelFocus } from '../workspace/panel-focus.js';
import type { MenuAction } from '../workspace/context-menu.js';
import { guardVisibleRowScroll } from './visible-row-scroll.js';

const ROW_HEIGHT = 24;

/** The folder a root-relative path sits in (`''` for the root). */
function parentOfRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

/** Leaf folder name of an absolute root path (handles `/` and `\`). */
function rootName(rootFolder: string): string {
  const trimmed = rootFolder.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/** Measure a container so the virtualised tree gets a concrete width + height. */
function useSize(): { ref: React.RefObject<HTMLDivElement | null>; width: number; height: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: size.width, height: size.height };
}

export function FileTree({
  rootFolder,
  projectId,
  hiddenPaths,
  onHide,
  onExcludeFromSearch,
  projectNameOf,
}: {
  rootFolder: string;
  projectId: string;
  hiddenPaths: string[];
  onHide: (relPath: string) => void;
  /** 060 FR-033 — add an entry to the project's Find in Files exclusions. Omitted: no menu row. */
  onExcludeFromSearch?: (relPath: string) => void;
  /**
   * The name of a project by id — for Paste's `from <project>` suffix (050 FR-025a). A prop rather
   * than a read of the projects store because the tree is mounted without one in places, and an
   * unresolvable name simply leaves the suffix off.
   */
  projectNameOf?: (projectId: string) => string | undefined;
}): ReactElement {
  const treeRef = useRef<TreeApi<TreeNodeData> | null>(null);
  const name = rootName(rootFolder);
  const {
    data,
    ready,
    error,
    errorAction,
    errorCause,
    errorSubject,
    clearError,
    initialOpenState,
    onToggle,
    onSelect,
    onRename,
    expandStep,
    collapseAll,
    expandChildren,
    collapseChildren,
    selectedRelPaths,
    primarySelected,
    clipboard,
    beginRename,
    cut,
    copy,
    clearClipboard,
    paste,
    remove,
    createFolder,
    createFile,
    reveal,
    openInDefaultProgram,
    revealInTree,
    drop,
    dropInbound,
    undoFileOp,
    redoFileOp,
    canUndoFileOp,
    canRedoFileOp,
  } = useExplorerData(rootFolder, projectId, treeRef, name, hiddenPaths);

  // US6 (#137) — the editor "Reveal File" action asks the tree to reveal a file by its absolute
  // path; do so only when the file belongs to THIS project's root (`relPathUnderRoot` compares
  // case-insensitively and slash-agnostically, since Windows does).
  useEffect(() => {
    const handler = (e: Event): void => {
      const abs = (e as CustomEvent).detail?.absPath as string | undefined;
      if (!abs) return;
      const rel = relPathUnderRoot(rootFolder, abs);
      // Focus travels with this one: the user asked to be taken to the file.
      if (rel) void revealInTree(rel);
    };
    window.addEventListener('throng:reveal-in-tree', handler);
    return () => window.removeEventListener('throng:reveal-in-tree', handler);
  }, [rootFolder, revealInTree]);

  // 018 / FR-051 — was an inline strip; now the one notification model.
  // 030 T033a — the explorer is THE surface #195 was filed about: "this item could not be renamed"
  // with four projects open. `errorSubject` travels with the failure from the operation that knew
  // what it was acting on (`use-explorer-data.ts`), exactly as `errorAction` and `errorCause` do.
  useErrorNotice(error, 'explorer-error', errorSubject ?? { kind: 'none' }, clearError, errorAction, errorCause);

  // 067 FR-012 — an elevated Windows session cannot receive an OS file drag; say so once (research D5).
  useElevatedDropNotice();

  const { ref, width, height } = useSize();
  // 024 US3 (#85): make undo/redo reachable whenever this PANE is the active one, not only while a
  // DOM element inside the tree happens to hold focus — see explorer-commands.ts.
  /*
   * 046 US2 (FR-017): `focusSelectedOrFirst` joins them — the selected row if there is one, else
   * react-arborist's own `firstNode`, so `focus.explorer` lands somewhere real either way.
   *
   * `api.focus()` (and `api.select()`) only move react-arborist's OWN internal highlight — the
   * library keeps real DOM/keyboard focus on the tree's CONTAINER (`role="tree"`, roving focus),
   * never on a row, which is exactly what `app.tsx`'s `menu.open` handler already works around by
   * reading `[data-tree-focused="true"]` rather than `document.activeElement`. So the highlight and
   * the real DOM focus are moved in two separate calls here: the highlight lands on the right row,
   * and the container is what actually takes the caret — which is what lets a following F2 reach
   * the tree's own keydown handler at all.
   */
  const focusSelectedOrFirst = useCallback(() => {
    const api = treeRef.current;
    if (!api) return;
    const target = api.selectedNodes[0] ?? api.firstNode;
    if (target) api.focus(target);
    ref.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
  }, [ref]);
  useEffect(() => {
    /*
     * Gated on `ready && width > 0 && height > 0` — the EXACT condition `<Tree>` itself renders on
     * below — unlike the undo/redo registration before it — a pending `focus.explorer` request
     * (`requestExplorerFocus`) is consumed by the FIRST registration it sees, and a registration made
     * before the tree has SIZE finds `treeRef.current` still null: `focusSelectedOrFirst` would
     * silently no-op, the pending flag would already be spent, and the request would never be
     * retried once the tree actually mounted.
     *
     * Gating on `ready` alone (review finding 4) was not enough: `ready` comes from the file-listing
     * PROMISE settling (a microtask), while width/height come from `ResizeObserver` — which reports
     * back on its own later turn, never synchronously with `observe()`. A real browser can settle
     * `ready` a full tick before the observer's first callback, and a registration made in that
     * window is exactly the no-op above. A user cannot interact with a tree that has not rendered yet
     * either way, so undo/redo waiting the same split second costs nothing real.
     */
    if (!ready || width <= 0 || height <= 0) return undefined;
    const commands = { undoFileOp, redoFileOp, focusSelectedOrFirst };
    registerExplorerCommands(commands);
    return () => unregisterExplorerCommands(commands);
  }, [ready, width, height, undoFileOp, redoFileOp, focusSelectedOrFirst]);
  /*
   * 067 FR-001 — whether the OS clipboard holds a file list, for the Paste item's availability.
   *
   * A ref read when the menu is built, so the menu opens in the same turn as the right-click. The OS
   * clipboard changes in other programs, so it is re-read when throng takes focus back, which is how
   * the user returns from the program that copied the files.
   */
  const osFilesRef = useRef(false);
  useEffect(() => {
    const refresh = (): void => {
      void window.throng?.fileClipboard
        ?.osFiles?.()
        .then((has) => {
          osFilesRef.current = has;
        })
        .catch((error: unknown) => logCaught('file-tree: read whether the OS clipboard holds files', error));
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const { openMenu } = useContextMenu();
  const keybindings = useKeybindings(); // US1 (#125): file.* shortcuts shown on the menu items
  const ws = useWorkspace();
  const appSettings = useAppSettings();
  const explorerSettings = appSettings.explorer;
  // 044 — what `previewAffordance` reads at right-click: the live preview settings and the INJECTED
  // provider registry (contracts/preview-provider-seam.md §3). Refs, because the menu is built after an
  // await and must use the values as they are then.
  const { registry: previewRegistry } = usePreviewProviders();
  const previewRegistryRef = useRef(previewRegistry);
  previewRegistryRef.current = previewRegistry;
  const previewSettingsRef = useRef(appSettings.editor.previews);
  previewSettingsRef.current = appSettings.editor.previews;

  /*
   * #188 — follow the active editor: whichever file the user is working in is the one selected here,
   * so acting on it (rename, copy path, reveal, delete) never starts with a hunt.
   *
   * Three things make this safe rather than intrusive:
   *
   *   - `{ focus: false }`. The reveal fires on every panel and tab switch, and react-arborist's
   *     `select()` otherwise focuses the row — which would pull the caret out of the editor the user
   *     just switched INTO. That is precisely the #144 class of bug, and the reason the setting
   *     cannot simply reuse the manual action's call.
   *   - It keys on the PATH, not on the reveal callback's identity (which changes as folders load).
   *     So a selection the user makes by hand stands until the active editor genuinely changes,
   *     instead of being snapped back on the next unrelated re-render.
   *   - A null path — a terminal, a placeholder, an unsaved document — and a file outside this
   *     project's root both mean "nothing to do", never "clear the selection".
   *
   * `ready` participates because the reveal cannot find a node before the root's children exist;
   * re-running once the tree loads is what makes a restored editor's file selected on arrival.
   */
  const activeEditorPath = useActiveEditorFilePath();
  /** That file as a path of THIS tree, or null when it belongs somewhere else (or there is none). */
  const activeFileRel = useMemo(
    () => (activeEditorPath ? relPathUnderRoot(rootFolder, activeEditorPath) : null),
    [activeEditorPath, rootFolder],
  );
  const revealRef = useRef(revealInTree);
  useEffect(() => {
    revealRef.current = revealInTree;
  }, [revealInTree]);
  useEffect(() => {
    if (!ready || !explorerSettings.autoRevealActiveFile || !activeFileRel) return;
    void revealRef.current(activeFileRel, { focus: false });
  }, [ready, explorerSettings.autoRevealActiveFile, activeFileRel]);

  // 067 FR-004 — the folder an OS file drag over the tree would drop into, for the highlight.
  const [inboundDropFolder, setInboundDropFolder] = useState<string | null>(null);
  // 067 FR-045 — the Properties dialog: one at a time, so one request held here.
  const [propertiesFor, setPropertiesFor] = useState<readonly string[] | null>(null);
  const openProperties = useCallback((relPaths: readonly string[]) => setPropertiesFor(relPaths), []);
  // Read by the window listeners without re-registering them.
  const inboundDropRef = useRef(dropInbound);
  inboundDropRef.current = dropInbound;
  const { notify } = useNotify();
  const inboundNoPathRef = useRef(() => {});
  inboundNoPathRef.current = () =>
    notify({
      severity: 'error',
      subject: { kind: 'none' },
      action: 'add a file you dropped here',
      message: 'That item has no file on disk, so it cannot be added.',
      testId: 'os-drop-error-no-path',
    });

  // Whether the in-progress drag will copy (vs move): set by the pointer backend at the drop, read by onMove.
  const copyDrag = useRef(false);
  const actionLabel = useRef<DragActionLabelHandle | null>(null);
  // Latest copy/move modifier config (user-configurable, FR-095) read without
  // re-registering the drag listeners.
  const dragConfigRef = useRef({
    copy: explorerSettings.dragCopyModifier,
    move: explorerSettings.dragMoveModifier,
  });
  dragConfigRef.current = {
    copy: explorerSettings.dragCopyModifier,
    move: explorerSettings.dragMoveModifier,
  };
  // 024 US2/US4: the current selection + root, read at drag start to record the dragged items'
  // absolute paths for a terminal / empty-panel drop. Held in a ref so the controller need not re-bind.
  const dragPayloadRef = useRef({ selectedRelPaths, primarySelected, rootFolder });
  dragPayloadRef.current = { selectedRelPaths, primarySelected, rootFolder };

  /*
   * 067 FR-110 to FR-114 — a drag from a row runs on the mouse (tree-pointer-backend.ts), so the
   * tree is its owner for the length of the mount: the copy / move decision, what the drag carries to
   * a target outside the tree, the scrolling element for edge scroll, and the hand-over to the OS.
   */
  useEffect(() => {
    const controller: TreePointerController = {
      effectFor: (mods) => resolveDragEffect(mods, dragConfigRef.current),
      begin: (rowEl) => {
        // Record the DRAGGED row's own path (read off its DOM), not whatever happens to be selected —
        // dragging an unselected row must carry that row (#155/#114 follow-up). react-arborist drags the
        // whole selection only when the grabbed row is part of it, so mirror that.
        const { selectedRelPaths: sel, rootFolder: root } = dragPayloadRef.current;
        const draggedRelPath = rowEl.getAttribute('data-rel-path') ?? '';
        const payload = buildTreeDragPayload({
          rootFolder: root,
          draggedRelPath,
          draggedKind: rowEl.getAttribute('data-kind') === 'folder' ? 'folder' : 'file',
          selectedRelPaths: sel,
        });
        if (!payload) return null;
        setTreeDrag(payload);
        return sel.length > 0 && sel.includes(draggedRelPath) ? [...sel] : [draggedRelPath];
      },
      setCopy: (copy) => {
        copyDrag.current = copy;
      },
      end: () => clearTreeDrag(),
      handOver: (relPaths) => window.throng?.files?.startOsDrag?.(relPaths),
      scrollElement: () => treeRef.current?.listEl.current ?? null,
      clearHover: () => treeRef.current?.hover(null, null),
    };
    return bindTreePointerController(controller);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const labelDrop = (effect: string, e: DragEvent): void => {
      if (effect === 'copy' || effect === 'move') actionLabel.current?.show(effect, e.clientX, e.clientY);
      else actionLabel.current?.hide();
    };
    /*
     * 067 FR-004, FR-005a, research D5 — files dragged in from the OS. Handled beside the tree's own
     * listeners above, which deliberately leave a `Files` drag alone: this is the other half of that
     * early return. The folder under the pointer is the target (a file row gives its parent, the tree's
     * empty space the root); a place inside the tree that cannot take a drop (the toolbar) says `none`,
     * which the OS shows as the not-allowed pointer. Anything outside the tree is left to the panels'
     * own drop targets.
     */
    const inboundTarget = (e: DragEvent): string | null => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('[data-testid="file-explorer-tree"]')) return null;
      const rowEl = el.closest('.tree-row') as HTMLElement | null;
      if (rowEl) {
        const rel = rowEl.getAttribute('data-rel-path') ?? '';
        return rowEl.getAttribute('data-kind') === 'folder' ? rel : parentOfRel(rel);
      }
      return el.closest('.explorer__body') ? '' : null;
    };
    const inTree = (e: DragEvent): boolean =>
      !!(e.target as HTMLElement | null)?.closest?.('[data-testid="file-explorer-tree"]');
    const modsOf = (e: DragEvent) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
    // What the last hover offered: Chromium's `drop` no longer carries it once a hover has set `dropEffect`.
    let osOffersMove = false;
    const onInboundDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer || !isOsFileDrag(e.dataTransfer)) return;
      if (!inTree(e)) {
        actionLabel.current?.hide();
        return;
      }
      const target = inboundTarget(e);
      osOffersMove = /Linux/i.test(navigator.platform) && e.dataTransfer.effectAllowed === 'copyMove';
      const effect = resolveInboundDragEffect(modsOf(e), dragConfigRef.current, target !== null, osOffersMove);
      labelDrop(effect, e);
      if (effect === 'none') {
        e.dataTransfer.dropEffect = 'none';
        setInboundDropFolder(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = effect;
      setInboundDropFolder(target);
    };
    const onInboundDrop = (e: DragEvent): void => {
      if (!e.dataTransfer || !isOsFileDrag(e.dataTransfer) || !inTree(e)) return;
      e.preventDefault();
      setInboundDropFolder(null);
      actionLabel.current?.hide();
      const target = inboundTarget(e);
      const effect = resolveInboundDragEffect(modsOf(e), dragConfigRef.current, target !== null, osOffersMove);
      if (effect === 'none' || target === null) return;
      const { count, paths } = osDropPaths(e.dataTransfer);
      if (count > 0 && paths.length === 0) {
        // The item has no file on disk (a virtual folder, an attachment): one notice, nothing sent.
        inboundNoPathRef.current();
        return;
      }
      inboundDropRef.current(paths, target, effect === 'move');
    };
    const clearInbound = (): void => setInboundDropFolder(null);
    // `dragend` never fires for a drag that began in another program: leaving the window is the only signal.
    const onLeaveWindow = (e: DragEvent): void => {
      if (e.relatedTarget !== null) return;
      setInboundDropFolder(null);
      actionLabel.current?.hide();
    };
    window.addEventListener('dragover', onInboundDragOver);
    window.addEventListener('drop', onInboundDrop);
    window.addEventListener('dragend', clearInbound);
    window.addEventListener('dragleave', onLeaveWindow);
    return () => {
      window.removeEventListener('dragover', onInboundDragOver);
      window.removeEventListener('drop', onInboundDrop);
      window.removeEventListener('dragend', clearInbound);
      window.removeEventListener('dragleave', onLeaveWindow);
    };
  }, [ready]);

  const onMove = useCallback(
    (args: { dragIds: string[]; parentId: string | null }) => {
      const dest = args.parentId == null || args.parentId === ROOT_ID ? '' : args.parentId;
      drop(args.dragIds, dest, copyDrag.current);
    },
    [drop],
  );

  const onKeyDown = useExplorerKeybindings({
    selectedRelPaths,
    primarySelected,
    beginRename,
    cut,
    copy,
    clearClipboard,
    paste,
    remove,
    undoFileOp,
    redoFileOp,
    // 044 FR-005 — `preview.open` for the selected FILE; a folder has no preview. Main decides the rest.
    openPreview: (node) => {
      const absPath = previewTargetFor(node, rootFolder);
      if (absPath !== null) void requestPreviewOpen({ absPath, projectId });
    },
  });

  /*
   * 033 US3 (T080, FR-030) — the ONE flavour catalogue.
   *
   * The very same hook the panel type-picker reads (`window.throng.terminal.listFlavours()` →
   * detected built-ins minus disabled, ∪ the user's own). No list is declared here, and none is
   * filtered: a flavour the picker offers is a flavour this menu offers, by construction rather
   * than by two lists being kept in step.
   */
  const flavours = useFlavours();

  /*
   * 033 US3 (T081, FR-031/FR-033/FR-033a) — the launch, in the order contract §A.2 states it.
   *
   * It is `createDedicatedEditor`'s sequence with a terminal config, and every step is load-bearing:
   * `notifyTyped` mirrors the typing to other windows, and `setActivePanel` before
   * focus is what lets the terminal's own mount-time focus fire — see the note on `focusPanel` below.
   */
  /*
   * 043 FR-090 — the tree's *Open In → Search* route into Find in Files, for a FILE or a folder.
   *
   * It goes through `requestFindInFiles`, the SAME opener the chord and the toolbar control use, so
   * there is one place that decides reuse-or-new (FR-021/FR-022) rather than three that must be kept
   * in step. The route travels with the request because it is what settles what happens to the
   * panel: this one RESETS it (FR-091) — boxes and results cleared, scope filled — where the chord
   * and the toolbar re-run its term.
   *
   * It was `findInFolder` and took no disclosure until round five. A file is a scope now (FR-092),
   * and *Find & Replace* is a second item on the same route (FR-090).
   */
  const searchFromTree = useCallback((relPath: string, replace: boolean) => {
    requestFindInFiles({ route: 'contextMenu', replace, scopeSubPath: relPath });
  }, []);

  const openInTerminal = useCallback(
    (node: TargetNode, flavour: FlavourOption) => {
      const activeTabId = ws.layout?.activeTabId;
      if (!activeTabId) return;
      // B4 — the right-clicked FOLDER, or a right-clicked FILE's parent folder. `resolveTarget` is
      // the shipped answer to that exact question (New File / New Folder / paste all ask it).
      const relDir = resolveTarget(node);
      // A REQUEST, not a decision: main hands it to `resolveStartDirectory`, so a path outside the
      // root is refused there and the root substituted (FR-032). Built the same way the tree already
      // builds an absolute path for the editor, forward slash and all — `path-id` normalises.
      const startDirectory = relDir === '' ? rootFolder : `${rootFolder}/${relDir}`;
      const config: TerminalPanelConfig = {
        flavourId: flavour.value,
        flavourLabel: flavour.label,
        shellArguments: flavour.defaultShellArguments,
        startDirectory,
      };
      const newId = ws.addPanel(activeTabId);
      ws.setPanelType(newId, 'terminal', config);
      window.throng?.panel?.notifyTyped?.(newId, 'terminal', config);
      ws.setActivePanel(activeTabId, newId);
      /*
       * FR-033a / SC-015 — the keystroke after the click must reach the SHELL.
       *
       * `focusPanel` is the contract's step and is called as such, but it cannot succeed here: this
       * panel was created microseconds ago, its terminal view has not mounted, nothing has registered
       * a focus callback for it, and it returns false. The real work is done by `requestPanelFocus`,
       * which PARKS the request until the panel registers (issue 144's mechanism) — the same
       * asynchronous gap, already solved once.
       *
       * That fallback is only real because `terminal-panel.tsx` registers its focus callback AFTER
       * `useTerminal` and only once its container exists; registered any earlier it would consume the
       * parked request with a callback that reads a null `apiRef` and does nothing, leaving SC-015
       * resting entirely on the terminal's own mount-time `focusIfActive` in another module. That is
       * exactly the accident this line exists to remove, so the two must stay in step — see the
       * comment on that effect before moving either.
       */
      if (!focusPanel(newId)) requestPanelFocus(newId);
    },
    [ws, rootFolder],
  );

  /** The Paste row's label (050 FR-025a): what will land, and where from. */
  const pasteLabelText = useMemo(
    () => pasteLabel(clipboard, projectId, projectNameOf ?? (() => undefined)),
    [clipboard, projectId, projectNameOf],
  );

  const onContextMenu = useCallback(
    async (node: NodeApi<TreeNodeData>, event: React.MouseEvent) => {
      // A row inside the selection keeps it, so the menu acts on every selected item
      // (`buildContextMenuItems` targets the selection); a row outside it becomes the selection.
      if (!node.isSelected) node.select();
      /*
       * The "Open In" editor targets for a file (043 FR-087, FR-089).
       *
       * Ninety lines of label composition, two disabled conditions and a hand-rolled `openInto`
       * gate used to live here. They now live in `editor/open-in-targets.ts` (the pure decision)
       * and `editor/open-in-perform.ts` (the half that touches the stores), because 043 draws the
       * SAME three targets on a Find in Files result row — and two surfaces each computing their
       * own labels and their own disabled conditions are two implementations, of which one drifts.
       *
       * NOTHING THIS MENU OFFERS CHANGED. The measure of that is not this comment: it is that
       * `explorer-open-in-target.test.ts` — which pins the panel-title suffix, both disabled
       * conditions and the `normaliseFolder` path comparison — passes untouched.
       *
       * The hand-rolled gate went with them. 041 FR-013d required it HERE because this was the one
       * caller of `openFileInNewEditor` that never reached `openInto`. `performOpenIn` routes
       * through `openFileInTab`, which awaits `openInto` on its first line, so the premise is
       * removed rather than the rule broken (043 FR-089) — and `openFileInNewEditor` itself is
       * untouched and still synchronous, which is FR-013d's other half and still stands.
       */
      const osFiles = osFilesRef.current;
      let openIn: MenuAction[] | undefined;
      let preview:
        | { affordance: PreviewAffordance; openLastActive: () => void; openNew: () => void; lastPreviewTitle: string | null }
        | undefined;
      if (node.data.kind === 'file' && node.data.relPath !== '') {
        const absPath = `${rootFolder}/${node.data.relPath}`;
        // Awaited BEFORE the facts are read, so the whole decision is sampled from one moment
        // rather than from either side of an await the layout could move across. 044 FR-012 — main's
        // answer to "does this file have its one preview?" is asked in the same moment.
        const [alreadyOpen, previewOpen] = await Promise.all([
          window.throng?.editor?.isOpen?.(absPath) ?? false,
          window.throng?.preview?.isOpen?.(absPath) ?? false,
        ]);
        openIn = openInMenuActions(
          describeOpenInTargets(readOpenInFacts(ws, absPath, alreadyOpen)),
          // 047 FR-083 — the editor it lands in flashes.
          (target) => void performOpenIn({ ws, absPath, target, flash: true }),
        );
        // 044 FR-003, FR-004, FR-062 — core decides; the menu draws. The live settings and the injected
        // registry are read through refs, so the answer is this moment's rather than the last render's.
        // The reuse candidate and its name are read in `preview-open-in.ts`, shared with Find in Files (060 FR-048).
        preview = {
          ...readPreviewOpenIn({
            layout: ws.layout,
            registry: previewRegistryRef.current,
            settings: previewSettingsRef.current,
            absPath,
            projectRoot: rootFolder,
            previewOpen,
          }),
          // 047 US2 — the two explicit overrides (T037): the `preview.open` request with an EXPLICIT
          // target. The plain, setting-driven Preview row is gone (FR-075). The preview flashes (FR-083).
          openLastActive: () =>
            void requestPreviewOpen({ absPath, projectId, target: { mode: 'lastActive' }, flash: true }),
          openNew: () => void requestPreviewOpen({ absPath, projectId, target: { mode: 'new' }, flash: true }),
        };
      }
      const items = buildContextMenuItems({
        node: node.data,
        selectedRelPaths,
        clipboard,
        pasteLabel: pasteLabelText,
        // 033 US4 (T091) — both act on the RIGHT-CLICKED node's relative path, which
        // `buildContextMenuItems` closes over from `node`, never on the selection.
        ops: { beginRename, cut, copy, paste, remove, reveal, openInDefaultProgram, properties: openProperties, hide: onHide, excludeFromSearch: onExcludeFromSearch, newFolder: createFolder, newFile: createFile, undoFileOp, redoFileOp, openInTerminal, expandChildren, collapseChildren, findInFiles: searchFromTree },
        undoState: { canUndo: canUndoFileOp, canRedo: canRedoFileOp },
        openIn,
        preview,
        keybindings,
        projectRoot: rootFolder,
        flavours,
        showOpenInDefaultProgram: explorerSettings.showOpenInOsDefaultProgram,
        osFiles,
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [selectedRelPaths, clipboard, pasteLabelText, beginRename, cut, copy, paste, remove, reveal, openInDefaultProgram, openProperties, explorerSettings.showOpenInOsDefaultProgram, onHide, onExcludeFromSearch, openMenu, ws, rootFolder, projectId, createFolder, createFile, keybindings, undoFileOp, redoFileOp, canUndoFileOp, canRedoFileOp, flavours, openInTerminal, expandChildren, collapseChildren, searchFromTree],
  );

  // Right-clicking empty space (below the rows) opens a menu targeting the ROOT —
  // New File / New Folder / Paste / Open in file explorer (FR-097). Rows handle
  // their own menu; guard so this doesn't also fire for a row right-click.
  const onEmptyContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.tree-row')) return;
      event.preventDefault();
      const osFiles = osFilesRef.current;
      const items = buildContextMenuItems({
        node: { relPath: '', kind: 'folder' },
        selectedRelPaths: [],
        clipboard,
        pasteLabel: pasteLabelText,
        ops: { beginRename, cut, copy, paste, remove, reveal, openInDefaultProgram, properties: openProperties, hide: onHide, excludeFromSearch: onExcludeFromSearch, newFolder: createFolder, newFile: createFile, undoFileOp, redoFileOp, openInTerminal, expandChildren, collapseChildren, findInFiles: searchFromTree },
        undoState: { canUndo: canUndoFileOp, canRedo: canRedoFileOp },
        keybindings,
        projectRoot: rootFolder,
        flavours,
        showOpenInDefaultProgram: explorerSettings.showOpenInOsDefaultProgram,
        osFiles,
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [clipboard, pasteLabelText, beginRename, cut, copy, paste, remove, reveal, openInDefaultProgram, openProperties, explorerSettings.showOpenInOsDefaultProgram, onHide, onExcludeFromSearch, createFolder, createFile, openMenu, keybindings, rootFolder, undoFileOp, redoFileOp, canUndoFileOp, canRedoFileOp, flavours, openInTerminal, expandChildren, collapseChildren, searchFromTree],
  );
  /*
   * GREYED ROWS (004 FR-017, 050 FR-004): the clipboard holds ABSOLUTE paths from any project, so the
   * cut set is built by asking which of them lie under THIS tree's root — compared slash- and
   * case-insensitively by `relPathUnderRoot`, since Windows calls those the same file. Items from
   * another project fall under another root and simply match nothing here, and a project switched
   * away from and back to reads the same clipboard from main and greys the same rows.
   */
  const cutPaths = useMemo(() => {
    const rels = new Set<string>();
    if (clipboard?.mode === 'cut') {
      for (const item of clipboard.items) {
        const rel = relPathUnderRoot(rootFolder, item.absPath);
        if (rel) rels.add(rel);
      }
    }
    return rels;
  }, [clipboard, rootFolder]);
  // Open-into-editor (006, FR-009): raise an open-file intent the editor consumes,
  // honouring the editor's openOnClick trigger (single / double / none).
  const openOnClick = useAppSettings().editor.openOnClick;
  const onOpenFile = useCallback(
    (relPath: string, gesture?: TreeOpenGesture) => {
      window.dispatchEvent(
        new CustomEvent('throng:open-file', {
          detail: { projectId, relPath, absPath: `${rootFolder}/${relPath}`, gesture },
        }),
      );
    },
    [projectId, rootFolder],
  );
  // 067 FR-116 — the editor refused a file as binary on a double click: this project's tree hands it to the OS,
  // through the same route and the same notice as the menu's Open in OS Default Program (FR-018).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string; relPath?: string }>).detail;
      if (detail.projectId === projectId && detail.relPath !== undefined) openInDefaultProgram(detail.relPath);
    };
    window.addEventListener('throng:open-in-os', handler);
    return () => window.removeEventListener('throng:open-in-os', handler);
  }, [projectId, openInDefaultProgram]);
  // Enter opens a highlighted file (never renames) and toggles a folder (FR-070).
  // Captured on the pane so it preempts react-arborist's default Enter=edit.
  // Left arrow and Space are react-arborist's collapse keys; on the root row they are swallowed,
  // because the root never collapses (004 FR-004, 050 FR-030, #448).
  const onTreeKeyCapture = useCallback(
    (e: ReactKeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return; // rename input
      const node = treeRef.current?.focusedNode;
      if (!node) return;
      if ((e.key === 'ArrowLeft' || e.key === ' ') && node.data.relPath === '') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (node.data.kind === 'folder') {
        if (node.data.relPath !== '') node.toggle();
      } else {
        onOpenFile(node.data.relPath);
      }
    },
    [treeRef, onOpenFile],
  );
  // Which of THIS project's files have unsaved changes (024 follow-up). The store hands back a
  // normalised, sorted key of absolute paths; the tree turns it into the root-relative paths its
  // rows are keyed by, and anything outside this project's root is another project's business.
  const dirtyKey = useDirtyPathKey();
  const dirtyPaths = useMemo(() => {
    const prefix = `${normaliseForCompare(rootFolder)}/`;
    const rels = new Set<string>();
    for (const abs of dirtyKey.split('\n')) {
      if (abs.startsWith(prefix)) rels.add(abs.slice(prefix.length));
    }
    return rels;
  }, [dirtyKey, rootFolder]);

  // Lower-cased for the same reason `dirtyPaths` is: a row's relPath keeps whatever spelling the
  // filesystem reported, and Windows calls those the same file.
  const activeFilePath = useMemo(() => (activeFileRel == null ? null : pathCompareKey(activeFileRel)), [activeFileRel]);

  const rowCtx = useMemo(
    () => ({ onContextMenu, cutPaths, openOnClick, onOpenFile, dirtyPaths, activeFilePath, inboundDropFolder }),
    [onContextMenu, cutPaths, openOnClick, onOpenFile, dirtyPaths, activeFilePath, inboundDropFolder],
  );

  return (
    <ExplorerRowContext.Provider value={rowCtx}>
      <DragActionLabel ref={actionLabel} />
    {propertiesFor !== null ? <PropertiesDialog relPaths={propertiesFor} onClose={() => setPropertiesFor(null)} /> : null}
    <div
      className="explorer"
      data-testid="file-explorer-tree"
      onKeyDown={onKeyDown}
      onKeyDownCapture={onTreeKeyCapture}
    >
      {/* 033 (#219, FR-018c) — this is the toolbar's PROJECT-OPEN rendering. There is a second one
          in `panes/file-explorer-pane.tsx`'s empty state, because Quick Open's control must be drawn
          and DISABLED with no project open, and this component is not mounted at all in that state
          (`file-explorer-pane.tsx` renders `FileTree` only when a project is active). */}
      <ExplorerToolbar
        onExpand={expandStep}
        onCollapseAll={collapseAll}
        onNewFolder={() => createFolder(primarySelected)}
        onDelete={() => remove(selectedRelPaths)}
        keybindings={keybindings}
        quickOpenEnabled
        findInFilesEnabled
      />
      {/* 018 / FR-051 — the second of four copy-pasted error strips. Now the shared model. */}
      <div className="explorer__body" ref={ref} onContextMenu={onEmptyContextMenu}>
        {!ready && (
          <PanelSkeleton
            testId="explorer-skeleton"
            lines={['70%', '52%', '80%', '44%', '64%', '38%', '58%']}
          />
        )}
        {ready && width > 0 && height > 0 && (
          <Tree<TreeNodeData>
            ref={(api: TreeApi<TreeNodeData> | null | undefined) => {
              treeRef.current = api ?? null;
              // #419 — a row already in full view is left where it is; see visible-row-scroll.ts.
              if (api) guardVisibleRowScroll(api);
            }}
            data={data}
            idAccessor="id"
            width={width}
            height={height}
            rowHeight={ROW_HEIGHT}
            indent={14}
            openByDefault={false}
            initialOpenState={initialOpenState}
            onToggle={onToggle}
            onSelect={onSelect}
            onRename={onRename}
            onMove={onMove}
            dndBackend={treePointerBackend}
            // 024 US3 follow-up: the arrow keys must MOVE THE SELECTION, not merely a cursor.
            // react-arborist otherwise keeps "focused row" and "selected row" as two independent
            // things, so arrowing away from a clicked file left the selection behind — and every
            // file operation reads the SELECTION. Cut/copy then acted on the row the user had left,
            // and Paste targeted its folder rather than the one the cursor was resting on. A tree
            // whose highlight and whose operations disagree is a tree that silently does the wrong
            // thing. Shift+Arrow still extends a multi-selection (it takes a different code path).
            selectionFollowsFocus
            disableDrop={({ parentNode }) => parentNode.data.kind === 'file'}
          >
            {TreeRow}
          </Tree>
        )}
      </div>
    </div>
    </ExplorerRowContext.Provider>
  );
}
