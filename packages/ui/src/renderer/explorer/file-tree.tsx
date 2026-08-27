/**
 * file-tree (004, T025 + expand/persist refinement) — the File Explorer Pane
 * body. A virtualised react-arborist tree whose single root node (the project's
 * root folder) is always-open + non-collapsible but selectable; subfolders
 * collapse/expand and load lazily. Open-state, selection, and the level-by-level
 * Expand are driven by useExplorerData. All colours/fonts/icons are themed.
 */
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
import { TreeRow } from './tree-node.js';
import { useExplorerData, ROOT_ID, type TreeNodeData } from './use-explorer-data.js';
import { ExplorerRowContext } from './explorer-context.js';
import { buildContextMenuItems } from './context-menu-items.js';
import { useExplorerKeybindings } from './explorer-keybindings.js';
import { registerExplorerCommands, unregisterExplorerCommands } from './explorer-commands.js';
import { useContextMenu } from '../context-menu-provider.js';
import { setTreeDrag, clearTreeDrag, getTreeDrag, takeTreeDropEffect } from './tree-drag-store.js';
import { useErrorNotice } from '../common/notification.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { openFileInTab, openFileInNewEditor } from '../editor/editor-open.js';
import { publishRefusedOpen } from '../editor/refusal-store.js';
import { getLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorState, useDirtyPathKey } from '../editor/editor-state.js';
import { useActiveEditorFilePath } from '../editor/active-editor-file.js';
import { PanelSkeleton } from '../common/loading.js';
import {
  buildTreeDragPayload,
  collectPanels,
  normaliseFolder,
  relPathUnderRoot,
  resolveDragEffect,
  resolveTarget,
  type FlavourOption,
  type TargetNode,
  type TerminalPanelConfig,
} from '@throng/core';
import { useFlavours } from '../panel-type/use-flavours.js';
import { focusPanel, requestPanelFocus } from '../workspace/panel-focus.js';
import type { MenuAction } from '../workspace/context-menu.js';

const ROW_HEIGHT = 24;

/** Leaf folder name of an absolute root path (handles `/` and `\`). */
function rootName(rootFolder: string): string {
  const trimmed = rootFolder.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/** Measure a container so the virtualised tree gets a concrete width + height. */
function useSize(): { ref: React.RefObject<HTMLDivElement>; width: number; height: number } {
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
}: {
  rootFolder: string;
  projectId: string;
  hiddenPaths: string[];
  onHide: (relPath: string) => void;
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
    revealInTree,
    drop,
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

  // 024 US3 (#85): make undo/redo reachable whenever this PANE is the active one, not only while a
  // DOM element inside the tree happens to hold focus — see explorer-commands.ts.
  useEffect(() => {
    const commands = { undoFileOp, redoFileOp };
    registerExplorerCommands(commands);
    return () => unregisterExplorerCommands(commands);
  }, [undoFileOp, redoFileOp]);
  const { ref, width, height } = useSize();
  const { openMenu } = useContextMenu();
  const keybindings = useKeybindings(); // US1 (#125): file.* shortcuts shown on the menu items
  const ws = useWorkspace();
  const explorerSettings = useAppSettings().explorer;

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

  // Whether the in-progress drag will copy (vs move). Driven live from the drag
  // event's modifier keys below, and read by react-arborist's onMove at drop time.
  const copyDrag = useRef(false);
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
  // absolute paths for a terminal / empty-panel drop (the tree's react-dnd channel is unreadable to
  // a native drop target). Held in a ref so the window drag listeners need not re-register.
  const dragPayloadRef = useRef({ selectedRelPaths, primarySelected, rootFolder });
  dragPayloadRef.current = { selectedRelPaths, primarySelected, rootFolder };

  // The drag cursor + copy/move decision (FR-092/095). react-arborist uses react-dnd,
  // whose HTML5 backend sets dataTransfer.dropEffect on a WINDOW-level `dragover`
  // from the ALT key — overriding any handler on our own element. So we override it
  // right back, on window, registered AFTER the backend (gated on `ready`, whose
  // Tree mount installs the backend first), reading the LIVE modifier keys from the
  // drag event so it tracks press/release mid-drag. effectAllowed is set to copyMove
  // at dragstart so the copy (+) cursor is permitted.
  useEffect(() => {
    if (!ready) return;
    const onDragStart = (e: DragEvent): void => {
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
      // 024 US2/US4: record the dragged items' absolute paths so a terminal / empty-panel drop can
      // read them. Only our OWN tree drags (not an OS 'Files' drag), and only from within the tree.
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      const target = e.target as HTMLElement | null;
      const rowEl = target?.closest?.('.tree-row') as HTMLElement | null;
      if (!rowEl || !target?.closest?.('[data-testid="file-explorer-tree"]')) return;
      // Record the DRAGGED row's own path (read off its DOM), not whatever happens to be selected —
      // dragging an unselected row must paste that row (#155/#114 follow-up). react-arborist drags the
      // whole selection only when the grabbed row is part of it, so mirror that: if the dragged row is
      // in the selection, carry the selection; otherwise carry just the dragged row.
      const { selectedRelPaths: sel, rootFolder: root } = dragPayloadRef.current;
      const payload = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: rowEl.getAttribute('data-rel-path') ?? '',
        draggedKind: rowEl.getAttribute('data-kind') === 'folder' ? 'folder' : 'file',
        selectedRelPaths: sel,
      });
      if (!payload) return;
      setTreeDrag(payload);
    };
    const onDragEnd = (): void => clearTreeDrag();
    window.addEventListener('dragend', onDragEnd);
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer) return;
      // 018 / US9 (FR-063) — this listener is for the tree's OWN drags (moving a file within the
      // project). An OS file drag is not one, and rewriting its cursor told the user their file was
      // about to be MOVED out of the folder it lives in — which is not what a drop into Throng does,
      // and not something Throng could do even if it wanted to. Leave OS drags entirely alone; the
      // panel's own drop target says `copy`.
      if (Array.from(e.dataTransfer.types).includes('Files')) return;
      // 024 US2/US4: a tree drag hovering a throng target OUTSIDE the tree (a terminal, an untyped
      // panel, an editor, a tab chip) is a valid drop for us — the target's own `onDragOver` set
      // `dropEffect`, but react-dnd's window handler (which runs before this one, and for which any
      // non-tree element is "not a drop target") just reset it to 'none'. Re-assert it, so Chromium
      // delivers the `drop`: with `none` at release the browser fires `dragleave`, not `drop`, and the
      // target's handler never runs.
      //
      // The effect re-asserted is the one the TARGET chose (takeTreeDropEffect), not a blanket
      // 'copy' — a target that refused the drag must keep showing the "not allowed" cursor rather
      // than promising a copy it will then decline. Nothing under the pointer → 'copy', because the
      // panel bodies have uncovered gaps and a drag across one must not flicker.
      const overTree = (e.target as HTMLElement | null)?.closest?.('[data-testid="file-explorer-tree"]');
      if (!overTree && getTreeDrag()) {
        const chosen = takeTreeDropEffect() ?? 'copy';
        e.preventDefault();
        e.dataTransfer.dropEffect = chosen;
        return;
      }
      const effect = resolveDragEffect(
        { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        dragConfigRef.current,
      );
      copyDrag.current = effect === 'copy';
      // Preserve 'none' — react-dnd rejected this drop target (e.g. onto a file).
      if (e.dataTransfer.dropEffect !== 'none') e.dataTransfer.dropEffect = effect;
    };
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', onDragEnd);
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
   * `clearLastAddedPanel` is what stops the new panel opening in RENAME mode (only a user-added panel
   * renames on add), `notifyTyped` mirrors the typing to other windows, and `setActivePanel` before
   * focus is what lets the terminal's own mount-time focus fire — see the note on `focusPanel` below.
   */
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
      ws.clearLastAddedPanel();
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

  const onContextMenu = useCallback(
    async (node: NodeApi<TreeNodeData>, event: React.MouseEvent) => {
      node.select();
      // Build the "Open In" editor targets for a file (current-project tabs only),
      // disabling any target when the file is already open in an editor (FR-011a).
      let openIn: MenuAction[] | undefined;
      if (node.data.kind === 'file' && node.data.relPath !== '') {
        const absPath = `${rootFolder}/${node.data.relPath}`;
        const alreadyOpen = (await window.throng?.editor?.isOpen?.(absPath)) ?? false;
        const layout = ws.layout;
        const activeTabId = layout?.activeTabId;
        const otherTabs = (layout?.tabs ?? []).filter((t) => t.id !== activeTabId);
        // "This editor" targets the active tab's last active editor. Disable it when
        // that editor already holds this file (opening would be a no-op, FR-082).
        const targetEditor = activeTabId ? getLastActiveEditor(activeTabId) : undefined;
        const activeTab = (layout?.tabs ?? []).find((t) => t.id === activeTabId);
        const targetPanel =
          targetEditor && activeTab
            ? collectPanels(activeTab.root).find((p) => p.id === targetEditor)
            : undefined;
        const openInTargetAlready =
          targetEditor !== undefined &&
          getEditorState(targetEditor)?.filePath != null &&
          normaliseFolder(getEditorState(targetEditor)!.filePath as string) === normaliseFolder(absPath);
        openIn = [
          {
            // Replicates the click action: open into the tab's last active editor,
            // reusing it (FR-082/098). The label names that target panel. Disabled
            // when that editor already holds the file.
            label: targetPanel ? `Last Active Editor (${targetPanel.title})` : 'Last Active Editor',
            icon: 'add',
            // Every Open In target takes you somewhere — the submenu is single-section and
            // therefore divider-free (033 US5, contracts §3.8).
            section: 'navigate',
            disabled: !activeTabId || openInTargetAlready,
            onClick: () => {
              if (activeTabId) void openFileInTab(ws, activeTabId, absPath);
            },
          },
          {
            // Forces a brand-new dedicated editor Panel — only when the file is not
            // already open anywhere (app-wide one buffer, FR-011a/FR-072).
            label: 'New Editor',
            icon: 'add',
            section: 'navigate',
            disabled: alreadyOpen || !activeTabId,
            /*
             * 041 FR-013d (#327) — gated HERE, at the call site, not inside `openFileInNewEditor`.
             *
             * That function is the one entry point the refusal's compile-time enforcement cannot
             * reach: it is synchronous and never asks `openInto`, so nothing makes this caller
             * handle a refusal. And it is the path #327 was reported from.
             *
             * The gate goes in the caller because 033 already decided that, in as many words
             * (`quick-open.tsx`): "That function means force a new panel; making it silently not
             * force would change a shipped contract under a caller that has already done the check,
             * and would turn a synchronous call into an asynchronous one for both."
             *
             * `openFileInTab` needs no equivalent — it awaits `openInto` on its first line, before
             * the `openTarget === 'new'` branch reaches this same function.
             */
            onClick: () => {
              if (!activeTabId) return;
              void (async () => {
                const decision = await window.throng?.editor?.openInto({ absPath, ownerKind: 'project', ownerProjectId: projectId });
                if (decision?.action === 'refuse') {
                  publishRefusedOpen({ absPath, reason: decision.reason });
                  return;
                }
                if (decision?.action === 'focus') {
                  void openFileInTab(ws, activeTabId, absPath);
                  return;
                }
                openFileInNewEditor(ws, activeTabId, absPath);
              })();
            },
          },
        ];
        if (otherTabs.length > 0) {
          openIn.push({
            label: 'Other Tab',
            icon: 'tab',
            section: 'navigate',
            submenu: otherTabs.map((t) => ({
              label: t.title,
              icon: 'tab',
              section: 'navigate' as const,
              disabled: alreadyOpen,
              onClick: () => void openFileInTab(ws, t.id, absPath),
            })),
          });
        }
      }
      const items = buildContextMenuItems({
        node: node.data,
        selectedRelPaths,
        clipboard,
        // 033 US4 (T091) — both act on the RIGHT-CLICKED node's relative path, which
        // `buildContextMenuItems` closes over from `node`, never on the selection.
        ops: { beginRename, cut, copy, paste, remove, reveal, hide: onHide, newFolder: createFolder, newFile: createFile, undoFileOp, redoFileOp, openInTerminal, expandChildren, collapseChildren },
        undoState: { canUndo: canUndoFileOp, canRedo: canRedoFileOp },
        openIn,
        keybindings,
        projectRoot: rootFolder,
        flavours,
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [selectedRelPaths, clipboard, beginRename, cut, copy, paste, remove, reveal, onHide, openMenu, ws, rootFolder, createFolder, createFile, keybindings, undoFileOp, redoFileOp, canUndoFileOp, canRedoFileOp, flavours, openInTerminal, expandChildren, collapseChildren],
  );

  // Right-clicking empty space (below the rows) opens a menu targeting the ROOT —
  // New File / New Folder / Paste / Open in file explorer (FR-097). Rows handle
  // their own menu; guard so this doesn't also fire for a row right-click.
  const onEmptyContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.tree-row')) return;
      event.preventDefault();
      const items = buildContextMenuItems({
        node: { relPath: '', kind: 'folder' },
        selectedRelPaths: [],
        clipboard,
        ops: { beginRename, cut, copy, paste, remove, reveal, hide: onHide, newFolder: createFolder, newFile: createFile, undoFileOp, redoFileOp, openInTerminal, expandChildren, collapseChildren },
        undoState: { canUndo: canUndoFileOp, canRedo: canRedoFileOp },
        keybindings,
        projectRoot: rootFolder,
        flavours,
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [clipboard, beginRename, cut, copy, paste, remove, reveal, onHide, createFolder, createFile, openMenu, keybindings, rootFolder, undoFileOp, redoFileOp, canUndoFileOp, canRedoFileOp, flavours, openInTerminal, expandChildren, collapseChildren],
  );
  const cutPaths = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.relPaths : []),
    [clipboard],
  );
  // Open-into-editor (006, FR-009): raise an open-file intent the editor consumes,
  // honouring the editor's openOnClick trigger (single / double / none).
  const openOnClick = useAppSettings().editor.openOnClick;
  const onOpenFile = useCallback(
    (relPath: string) => {
      window.dispatchEvent(
        new CustomEvent('throng:open-file', {
          detail: { projectId, relPath, absPath: `${rootFolder}/${relPath}` },
        }),
      );
    },
    [projectId, rootFolder],
  );
  // Enter opens a highlighted file (never renames) and toggles a folder (FR-070).
  // Captured on the pane so it preempts react-arborist's default Enter=edit.
  const onEnterCapture = useCallback(
    (e: ReactKeyboardEvent): void => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return; // rename input
      const node = treeRef.current?.focusedNode;
      if (!node) return;
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
    const prefix = `${rootFolder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;
    const rels = new Set<string>();
    for (const abs of dirtyKey.split('\n')) {
      if (abs.startsWith(prefix)) rels.add(abs.slice(prefix.length));
    }
    return rels;
  }, [dirtyKey, rootFolder]);

  // Lower-cased for the same reason `dirtyPaths` is: a row's relPath keeps whatever spelling the
  // filesystem reported, and Windows calls those the same file.
  const activeFilePath = useMemo(() => activeFileRel?.toLowerCase() ?? null, [activeFileRel]);

  const rowCtx = useMemo(
    () => ({ onContextMenu, cutPaths, openOnClick, onOpenFile, dirtyPaths, activeFilePath }),
    [onContextMenu, cutPaths, openOnClick, onOpenFile, dirtyPaths, activeFilePath],
  );

  return (
    <ExplorerRowContext.Provider value={rowCtx}>
    <div
      className="explorer"
      data-testid="file-explorer-tree"
      onKeyDown={onKeyDown}
      onKeyDownCapture={onEnterCapture}
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
            ref={treeRef}
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
