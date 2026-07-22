/**
 * tree-node (004, T024/T052, FR-004/005/016/020) — a themed file/folder row for
 * react-arborist. One uniform-size icon, a chevron twisty for folders, and the
 * name (or an inline rename input while editing).
 *
 * #121 — clicking a folder's NAME (or its glyph) SELECTS only; expansion is
 * toggled ONLY by the chevron, which is a real, keyboard-labelled control with a
 * hover affordance (Constitution VI, Discoverable UX). The folder glyph still
 * swaps 📁/📂 with open state as a pure indicator. The root selects but never
 * collapses (FR-004); right-click opens the operations menu.
 */
import { useRef, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { decideClick } from '@throng/core';
import { Icon } from '../common/icon.js';
import { fileIconToken } from './tree-icons.js';
import { useExplorerRow } from './explorer-context.js';
import type { TreeNodeData } from './use-explorer-data.js';

export function TreeRow({
  node,
  style,
  dragHandle,
}: NodeRendererProps<TreeNodeData>): ReactElement {
  const row = useExplorerRow();
  const data = node.data;
  const isRoot = data.relPath === '';
  const isFolder = data.kind === 'folder';
  const isCut = row?.cutPaths.has(data.relPath) ?? false;
  // Escape cancels a rename and suppresses the follow-on blur-commit (FR-090).
  const escapedRef = useRef(false);
  // Highlight the folder that would receive a drop while dragging (FR-091).
  const willDrop = node.willReceiveDrop;
  const iconToken = isFolder
    ? node.isOpen || isRoot
      ? 'folderOpen'
      : 'folder'
    : fileIconToken(data.name);

  // Selection — including Ctrl/Shift multi-select (FR-015) — is handled by
  // react-arborist's DefaultRow (node.handleClick). Here we decide what a click
  // does beyond selecting: raise an open-file intent for a file per the
  // open-on-click mode (FR-026/027/028). A folder click SELECTS only — the
  // chevron (below) is the sole expand/collapse control (#121).
  const act = (clickCount: 1 | 2): void => {
    const openOnClick = row?.openOnClick ?? 'single';
    const action = decideClick(openOnClick, data.kind, clickCount);
    // US2 (#140): a folder toggles its expansion on a DOUBLE-click (single-click still selects
    // only, #121); the root never collapses (FR-004). Independent of the file open-on-click mode.
    if (action === 'toggle') {
      if (!isRoot) node.toggle();
      return;
    }
    if (openOnClick === 'none') return; // a file click never opens here; use Enter or Open In
    if (action === 'open') row?.onOpenFile(data.relPath);
  };
  const onClick = (e: MouseEvent): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // multi-select gesture
    act(1);
  };
  const onDoubleClick = (e: MouseEvent): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    act(2);
  };

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`tree-row${node.isSelected ? ' tree-row--selected' : ''}${
        isRoot ? ' tree-row--root' : ''
      }${isCut ? ' tree-row--cut' : ''}${willDrop ? ' tree-row--drop-target' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        row?.onContextMenu(node, e);
      }}
      title={isRoot ? data.name : data.relPath}
    >
      {isFolder && !isRoot ? (
        // #121 — the chevron is now the ONLY expand/collapse control, so it is a
        // real button: it carries the action (accessible label + aria-expanded),
        // stops the click from also selecting, and gets a hover affordance in CSS
        // so its purpose is discoverable. Enter still toggles at the row level
        // (file-tree onEnterCapture); tabIndex=-1 keeps react-arborist's roving
        // row focus intact rather than adding a tab stop per folder.
        <button
          type="button"
          className={`tree-twisty${node.isOpen ? ' tree-twisty--open' : ''}`}
          data-testid={`tree-twisty-${data.relPath}`}
          // Disclosure control: the accessible NAME names the target folder and the
          // STATE is carried by aria-expanded (a screen reader announces
          // "Toggle src, collapsed, button"). The verb is deliberately not
          // "Expand"/"Collapse" so it doesn't collide with the toolbar's Expand /
          // Collapse-all buttons under accessible-name matching. `title` gives a
          // plain hover tooltip (aria-label wins for the a11y name, so it stays clear).
          aria-label={`Toggle ${data.name}`}
          aria-expanded={node.isOpen}
          title={node.isOpen ? 'Collapse' : 'Expand'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation(); // toggle only — do not also select the row
            node.toggle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon token="chevron" />
        </button>
      ) : (
        <span className="tree-twisty" aria-hidden />
      )}
      <span className="tree-icon" aria-hidden>
        <Icon token={iconToken} />
      </span>
      {node.isEditing ? (
        <input
          className="tree-rename"
          autoFocus
          defaultValue={data.name}
          onFocus={(e) => {
            // Select only the name, not the extension, so a rename edits the stem
            // (a leading dot = a dotfile with no extension → select all).
            const v = e.currentTarget.value;
            const dot = v.lastIndexOf('.');
            if (dot > 0) e.currentTarget.setSelectionRange(0, dot);
            else e.currentTarget.select();
          }}
          onClick={(e) => e.stopPropagation()}
          // Clicking away commits the rename immediately (FR-090) — same as Enter.
          // Escape cancels first and suppresses the resulting blur-commit.
          onBlur={(e) => {
            if (escapedRef.current) {
              escapedRef.current = false;
              return;
            }
            node.submit(e.currentTarget.value);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') node.submit(e.currentTarget.value);
            else if (e.key === 'Escape') {
              e.stopPropagation(); // cancel the rename, not the clipboard
              escapedRef.current = true;
              node.reset();
            }
          }}
        />
      ) : (
        <span className="tree-label">{data.name}</span>
      )}
      {/*
        FR-006d — an icon may not be the SOLE carrier of meaning.

        This marker's entire job is to say "this is a symbolic link". Making icons decorative
        (aria-hidden, FR-006c) is right for an icon that merely decorates an already-labelled
        control — but it would erase this one's meaning outright, with nothing left in its place.
        So the MARKER carries the name while the icon inside it stays decorative: a screen reader
        hears "Symbolic link" once, and never the glyph.
      */}
      {data.isSymlink && !node.isEditing && (
        <span className="tree-symlink" role="img" aria-label="Symbolic link" title="Symbolic link">
          <Icon token="symlink" />
        </span>
      )}
    </div>
  );
}
