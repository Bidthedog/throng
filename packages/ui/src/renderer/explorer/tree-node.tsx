/**
 * tree-node (004, T024/T052, FR-004/005/016/020) — a themed file/folder row for
 * react-arborist. One uniform-size icon, a chevron twisty for folders, and the
 * name (or an inline rename input while editing). Clicking a folder selects +
 * toggles it; the root selects but never collapses (FR-004); right-click opens
 * the operations menu.
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
  // does beyond selecting: toggle a folder, or raise an open-file intent for a
  // file per the open-on-click mode (FR-026/027/028). The root never collapses.
  const act = (clickCount: 1 | 2): void => {
    if (isFolder) {
      // Folders toggle on click and never open into an editor (FR-009). Root never
      // collapses.
      if (!isRoot) node.toggle();
      return;
    }
    const openOnClick = row?.openOnClick ?? 'single';
    if (openOnClick === 'none') return; // click never opens; use Enter or Open In
    if (decideClick(openOnClick, 'file', clickCount) === 'open') {
      row?.onOpenFile(data.relPath);
    }
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
      <span className={`tree-twisty${node.isOpen ? ' tree-twisty--open' : ''}`} aria-hidden>
        {isFolder && !isRoot ? <Icon token="chevron" /> : ''}
      </span>
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
