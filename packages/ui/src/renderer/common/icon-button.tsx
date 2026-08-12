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
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
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
   * Draw the badge BEFORE the icon rather than after it (031 FR-052).
   *
   * The tab strip's two step controls point in opposite directions and their counts belong on the
   * side each control points at: `‹ 3` reads "three that way", and so does `3 ›`. Ordering is a
   * property of the control, not of the badge, so it is a flag here rather than two markups.
   */
  badgeFirst?: boolean;
  /**
   * Pointer events the HOST needs to intercept. A control sitting inside a clickable surface — the
   * tab close affordance inside its chip — must stop the surface's own handlers from also firing,
   * and only the host knows what those are.
   *
   * The pointer pair additionally carries PRESS-AND-HOLD (031 FR-054): a hold begins on
   * `pointerdown` and must end the moment the pointer is released or leaves the control.
   */
  onDoubleClick?: (event: ReactMouseEvent) => void;
  onMouseDown?: (event: ReactMouseEvent) => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
  onPointerUp?: (event: ReactPointerEvent) => void;
  onPointerLeave?: (event: ReactPointerEvent) => void;
  onPointerCancel?: (event: ReactPointerEvent) => void;
  /**
   * Extra `data-*` attributes for the host to expose STATE that has no other visible surface — the
   * tab strip's `data-repeating` while a press-and-hold is running. Deliberately narrow: it carries
   * data attributes and nothing else, so it cannot be used to smuggle a second className or handler
   * past the one code path every action control shares.
   */
  dataAttrs?: Record<string, string>;
}

export function IconButton({
  token,
  title,
  onClick,
  className = 'icon-button',
  testId,
  disabled = false,
  badge,
  badgeFirst = false,
  onDoubleClick,
  onMouseDown,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  dataAttrs,
}: IconButtonProps): ReactElement {
  /*
   * The pill is the SAME class the per-tab panel-count pill wears (031 FR-052b) — reused, not
   * copied, so one visual vocabulary covers "this tab holds three panels" and "three tabs are
   * hidden that way", and a change to the pill reaches both.
   */
  const pill =
    badge === undefined ? null : (
      <span className="icon-button__badge throng-count-pill" aria-hidden="true">
        {badge}
      </span>
    );
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
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      {...dataAttrs}
    >
      {badgeFirst ? pill : null}
      <Icon token={token} />
      {badgeFirst ? null : pill}
    </button>
  );
}
