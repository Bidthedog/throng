/**
 * Reusable themeable action icon button (constitution v3.12.0, Themeable icon
 * controls). Every interactive control that performs an action renders through
 * this: the icon is drawn by the shared <Icon> component — which honours the selected icon PACK,
 * not merely the theme's glyph (017 / #54) — and the colours come from theme tokens via CSS. The
 * button always carries a hover title / aria-label naming the action; the icon inside it is
 * decorative, so a screen reader announces the action once and never the glyph.
 *
 * The dedicated {@link DismissButton} is a thin wrapper over this (token `dismiss`).
 */
import { type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { Icon } from './icon.js';

export interface IconButtonProps {
  /** Active-theme icon token whose glyph is rendered (e.g. `retry`, `add`, `rename`). */
  token: string;
  /** Hover title + aria-label naming the action (required — the icon carries no text). */
  title: string;
  onClick: (event: ReactMouseEvent) => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
  /**
   * An optional COUNT rendered beside the icon — never a label.
   *
   * 031 FR-021 needs three tab-strip controls that each show how many tabs they concern (hidden
   * left, hidden right, total). That is a live quantity, not a name for the action, so it does not
   * breach the icon-control rule: the action is still named by the hover title alone, and the icon
   * is still what identifies it. Adding it here rather than hand-rolling a fourth kind of button is
   * what keeps every action control in the application on one code path.
   */
  badge?: ReactNode;
  /**
   * Pointer events the HOST needs to intercept. A control sitting inside a clickable surface — the
   * tab close affordance inside its chip — must stop the surface's own handlers from also firing,
   * and only the host knows what those are.
   */
  onDoubleClick?: (event: ReactMouseEvent) => void;
  onMouseDown?: (event: ReactMouseEvent) => void;
}

export function IconButton({
  token,
  title,
  onClick,
  className = 'icon-button',
  testId,
  disabled = false,
  badge,
  onDoubleClick,
  onMouseDown,
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
    >
      <Icon token={token} />
      {badge === undefined ? null : (
        <span className="icon-button__badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}
