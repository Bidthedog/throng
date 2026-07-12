/**
 * Reusable themeable action icon button (constitution v3.12.0, Themeable icon
 * controls). Every interactive control that performs an action renders through
 * this: the glyph is resolved from the active theme's icon token (never an inline
 * SVG or text label) and the colours come from theme tokens via CSS, and it always
 * carries a hover title / aria-label that names the action.
 *
 * The dedicated {@link DismissButton} is a thin wrapper over this (token `dismiss`).
 */
import { type ReactElement } from 'react';
import { resolveIcon } from '@throng/core';
import { useActiveTheme } from '../config/config-store.js';

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
  const theme = useActiveTheme();
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
      {resolveIcon(theme, token)}
    </button>
  );
}
