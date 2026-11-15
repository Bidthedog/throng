import { hostTraits, shippedBindingsFor, type ColumnSelectModifier } from '@throng/core';

/**
 * The host platform's modifiers, from host traits (070 FR-030, research R21, R32) — never `navigator.platform`, and
 * never the build's default platform, so a macOS renderer answers to Cmd and Option and Windows and Linux are
 * unchanged.
 */

/** Cmd on macOS, Ctrl elsewhere: the modifier a gesture (zoom by wheel, follow a link) is pressed under. */
export function primaryModifierHeld(e: { readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return hostTraits().os === 'macos' ? e.metaKey : e.ctrlKey;
}

/** The primary modifier as a user reads it: `Cmd` on macOS, `Ctrl` elsewhere. */
export function primaryModifierLabel(): 'Cmd' | 'Ctrl' {
  return hostTraits().os === 'macos' ? 'Cmd' : 'Ctrl';
}

/** The primary modifier as a binding token names it: `Meta` on macOS, `Ctrl` elsewhere. */
export function primaryModifierToken(): 'Meta' | 'Ctrl' {
  return hostTraits().os === 'macos' ? 'Meta' : 'Ctrl';
}

/** The column-select drag's modifier, from the host platform's shipped table (016 FR-017e). */
export function columnSelectModifier(): ColumnSelectModifier {
  return shippedBindingsFor(hostTraits().os).columnSelectModifier;
}

/** {@link columnSelectModifier} in the spelling CodeMirror's crosshair cursor wants. */
export function crosshairKey(): 'Alt' | 'Control' | 'Meta' {
  const modifier = columnSelectModifier();
  return modifier === 'Ctrl' ? 'Control' : modifier === 'Meta' ? 'Meta' : 'Alt';
}
