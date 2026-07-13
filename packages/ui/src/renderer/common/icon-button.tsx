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
import { type ReactElement } from 'react';
import { Icon } from './icon.js';

export interface IconButtonProps {
  /** Active-theme icon token whose glyph is rendered (e.g. `retry`, `add`, `rename`). */
  token: string;
  /** Hover title + aria-label naming the action (required — the icon carries no text). */
  title: string;
  onClick: () => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

export function IconButton({
  token,
  title,
  onClick,
  className = 'icon-button',
  testId,
  disabled = false,
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
    >
      <Icon token={token} />
    </button>
  );
}
