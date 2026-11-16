/**
 * 069 FR-059 — the File Explorer row's hover POPOVER: the row's icon, drawn large, beside its path.
 *
 * It replaces the row's native `title`, which could only carry the path as plain text. The icon is
 * twice the theme's icon size and sits to the left of the path, centred on it, so the art a 16 px row
 * can only hint at can be read when the pointer rests on the row.
 *
 * A floating surface like the tab popover (registered in `floating-surfaces.test.ts`): anchored to its
 * row by the shared {@link useAnchoredPosition}, so it opens below the row and flips above it or clamps
 * where the window runs out, held invisible until placed, portaled to `document.body` so the tree's
 * own scroll box cannot clip it, and `pointer-events: none` so it never takes a click meant for the tree.
 */
import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { fileIconCategory, type IconKey } from '@throng/core';
import { useAnchoredPosition } from '../common/use-anchored-position.js';
import { Icon } from '../common/icon.js';

export interface ExplorerPathPopoverProps {
  /** The `id` the row's `aria-describedby` names while this is open. */
  id: string;
  /** The row's own icon key — the one the row draws small. */
  token: IconKey;
  /** The root's name, or any other row's project-relative path. */
  path: string;
  /** The row to anchor against. `null` renders nothing. */
  anchor: HTMLElement | null;
}

export function ExplorerPathPopover({ id, token, path, anchor }: ExplorerPathPopoverProps): ReactElement | null {
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, `${token}\n${path}`);
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="explorer-path-popover"
      data-testid="explorer-path-popover"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <span
        className="explorer-path-popover__icon"
        data-testid="explorer-path-popover-icon"
        data-icon-category={fileIconCategory(token) ?? undefined}
      >
        <Icon token={token} />
      </span>
      <span className="explorer-path-popover__path">{path}</span>
    </div>,
    document.body,
  );
}
