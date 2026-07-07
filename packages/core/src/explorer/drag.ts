/**
 * Drag-and-drop copy-vs-move resolution (004 FR-019; 006 FR-095). Pure. Windows
 * convention: plain drag moves, a copy modifier copies, a move modifier forces move.
 * Which key does which is user-configurable (default Ctrl=copy, Shift=move). No OS/DOM.
 */
export type DragModifierKey = 'ctrl' | 'shift' | 'alt';

export interface DragModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Which modifier key triggers copy vs (explicit) move (FR-095). */
export interface DragModifierConfig {
  copy: DragModifierKey;
  move: DragModifierKey;
}

export const DEFAULT_DRAG_MODIFIERS: DragModifierConfig = { copy: 'ctrl', move: 'shift' };

export type DragEffect = 'move' | 'copy';

export function resolveDragEffect(
  mods: DragModifiers,
  config: DragModifierConfig = DEFAULT_DRAG_MODIFIERS,
): DragEffect {
  if (mods[config.copy]) return 'copy';
  if (mods[config.move]) return 'move'; // explicit move (also the default)
  return 'move';
}
