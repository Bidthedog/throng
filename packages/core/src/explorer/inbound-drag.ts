import type { DragModifierConfig, DragModifiers } from './drag.js';

/**
 * What a drop from the OS onto the tree would do (067 FR-004, FR-005a). An internal drag defaults to a move; a file
 * arriving from outside defaults to a copy, and throng's own modifiers still choose.
 *
 * `osOffersMove`: a Linux file manager reaches throng with no modifier at all, but offers a move only while Shift
 * is held. It is the OS reading Shift, so it speaks for throng's move key only when that key is Shift.
 */
export function resolveInboundDragEffect(
  mods: DragModifiers,
  config: DragModifierConfig,
  hasTarget: boolean,
  osOffersMove = false,
): 'copy' | 'move' | 'none' {
  if (!hasTarget) return 'none';
  if (mods[config.copy]) return 'copy';
  return mods[config.move] || (osOffersMove && config.move === 'shift') ? 'move' : 'copy';
}
