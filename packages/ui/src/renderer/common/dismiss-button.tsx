/**
 * Shared trailing-edge dismiss control (011, US1, FR-001/006). One reusable
 * themeable icon button used by all four panel error surfaces (Projects, File
 * Explorer, terminal exit notice, sub-workspaces) so they dismiss identically and
 * the glyph/colours come from the active theme's `dismiss` token (009) — never a
 * text label or an inline vector (constitution v3.12.0, Themeable icon controls).
 *
 * Activating it MUST remove the error immediately (FR-002): the parent passes an
 * `onDismiss` that clears the error state synchronously, with no focus change or
 * re-render trigger required.
 */
import { type ReactElement } from 'react';
import { resolveIcon } from '@throng/core';
import { useActiveTheme } from '../config/config-store.js';

export interface DismissButtonProps {
  /** Clears the owning surface's error immediately (FR-002). */
  onDismiss: () => void;
  /** Hover title / aria-label naming the action (FR-006). */
  title?: string;
  className?: string;
  testId?: string;
}

export function DismissButton({
  onDismiss,
  title = 'Dismiss',
  className = 'dismiss-button',
  testId,
}: DismissButtonProps): ReactElement {
  const theme = useActiveTheme();
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onDismiss}
    >
      {resolveIcon(theme, 'dismiss')}
    </button>
  );
}
