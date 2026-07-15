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
import { useContextMenu } from '../context-menu-provider.js';
import { useErrorNotice } from '../common/notification.js';
import { useAppSettings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { openFileInTab, openFileInNewEditor } from '../editor/editor-open.js';
import { getLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorState } from '../editor/editor-state.js';
import { collectPanels, normaliseFolder, resolveDragEffect } from '@throng/core';
import type { MenuItem } from '../workspace/context-menu.js';

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
    clearError,
    initialOpenState,
    onToggle,
    onSelect,
    onRename,
    expandStep,
    collapseAll,
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
    drop,
  } = useExplorerData(rootFolder, projectId, treeRef, name, hiddenPaths);

  // 018 / FR-051 — was an inline strip; now the one notification model.
  useErrorNotice(error, 'explorer-error', clearError);
  const { ref, width, height } = useSize();
  const { openMenu } = useContextMenu();
  const ws = useWorkspace();
  const explorerSettings = useAppSettings().explorer;

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
    };
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer) return;
      // 018 / US9 (FR-063) — this listener is for the tree's OWN drags (moving a file within the
      // project). An OS file drag is not one, and rewriting its cursor told the user their file was
      // about to be MOVED out of the folder it lives in — which is not what a drop into Throng does,
      // and not something Throng could do even if it wanted to. Leave OS drags entirely alone; the
      // panel's own drop target says `copy`.
      if (Array.from(e.dataTransfer.types).includes('Files')) return;
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
  });

  const onContextMenu = useCallback(
    async (node: NodeApi<TreeNodeData>, event: React.MouseEvent) => {
      node.select();
      // Build the "Open In" editor targets for a file (current-project tabs only),
      // disabling any target when the file is already open in an editor (FR-011a).
      let openIn: MenuItem[] | undefined;
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
            disabled: alreadyOpen || !activeTabId,
            onClick: () => {
              if (activeTabId) openFileInNewEditor(ws, activeTabId, absPath);
            },
          },
        ];
        if (otherTabs.length > 0) {
          openIn.push({
            label: 'Other Tab',
            icon: 'tab',
            submenu: otherTabs.map((t) => ({
              label: t.title,
              icon: 'tab',
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
        ops: { beginRename, cut, copy, paste, remove, reveal, hide: onHide, newFolder: createFolder, newFile: createFile },
        openIn,
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [selectedRelPaths, clipboard, beginRename, cut, copy, paste, remove, reveal, onHide, openMenu, ws, rootFolder, createFolder, createFile],
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
        ops: { beginRename, cut, copy, paste, remove, reveal, hide: onHide, newFolder: createFolder, newFile: createFile },
      });
      openMenu(event.clientX, event.clientY, items);
    },
    [clipboard, beginRename, cut, copy, paste, remove, reveal, onHide, createFolder, createFile, openMenu],
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
  const rowCtx = useMemo(
    () => ({ onContextMenu, cutPaths, openOnClick, onOpenFile }),
    [onContextMenu, cutPaths, openOnClick, onOpenFile],
  );

  return (
    <ExplorerRowContext.Provider value={rowCtx}>
    <div
      className="explorer"
      data-testid="file-explorer-tree"
      onKeyDown={onKeyDown}
      onKeyDownCapture={onEnterCapture}
    >
      <ExplorerToolbar
        onExpand={expandStep}
        onCollapseAll={collapseAll}
        onNewFolder={() => createFolder(primarySelected)}
        onDelete={() => remove(selectedRelPaths)}
      />
      {/* 018 / FR-051 — the second of four copy-pasted error strips. Now the shared model. */}
      <div className="explorer__body" ref={ref} onContextMenu={onEmptyContextMenu}>
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
