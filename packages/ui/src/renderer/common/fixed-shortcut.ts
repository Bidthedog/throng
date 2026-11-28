/**
 * The keys a surface handles itself, outside Key Bindings, as a menu row shows them (maintainer's v1 review, #732).
 *
 * Cut, Copy, Paste, Select All, Undo and Redo keep fixed native chords in the editor (CodeMirror's `Mod-` keymap,
 * FR-017c), the CSV grid (`grid/data-grid.tsx`), a preview body (the browser's own) and the terminal's paste
 * (`terminal/paste-chord.ts`). There is no ActionId to resolve, so a menu row names the key here, once, in the form
 * the user presses on this platform: `Ctrl+…` on Windows and Linux, `Cmd+…` on macOS, where every one of those
 * surfaces answers to Cmd (`Mod-`, `metaKey`, the platform's clipboard events). Redo on macOS is Shift+Cmd+Z, the Mac
 * convention, which the editor binds (`mac: 'Mod-Shift-z'`) and the grid accepts.
 *
 * Read when the menu is built, never at module load: host traits are configured after this module loads.
 */
import { chordLabel, ctrlToMeta, hostTraits } from '@throng/core';

export type FixedShortcut = 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo';

/** The Windows and Linux chord. */
const CHORD: Readonly<Record<FixedShortcut, string>> = {
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  selectAll: 'Ctrl+A',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
};

/** Where macOS is not the plain Ctrl-to-Cmd form. */
const MACOS_CHORD: Readonly<Partial<Record<FixedShortcut, string>>> = {
  redo: 'Shift+Meta+Z',
};

/** The fixed key for `command` as this platform reads it, for a menu row's `shortcut`. */
export function fixedShortcut(command: FixedShortcut): string {
  if (hostTraits().os !== 'macos') return CHORD[command];
  return chordLabel(MACOS_CHORD[command] ?? ctrlToMeta(CHORD[command]), 'macos');
}
