import { hostTraits } from '@throng/core';

/** The fields {@link isPasteChord} reads off a keydown. */
export interface PasteChordEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * A paste chord (#142): the platform's primary modifier + V, or Shift+Insert. Ctrl+Shift+V and Alt combinations are
 * left to the shell. `e.key` is `'v'` (no Shift) but `'V'` is accepted defensively; Shift+Insert reports `'Insert'`.
 *
 * On macOS the primary modifier is Cmd, so Ctrl+V reaches the shell as readline's quoted-insert, like every other Ctrl
 * chord there (070 FR-029).
 */
export function isPasteChord(e: PasteChordEvent): boolean {
  const mac = hostTraits().os === 'macos';
  // Off macOS this is exactly #142's test, Meta unread, so Windows and Linux behave as they always have (FR-039).
  const primary = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
  if (primary && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) return true;
  if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Insert') return true;
  return false;
}
