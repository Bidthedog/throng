/**
 * An action the Resource Monitor window asks another window to run (055 R12, R14, FR-086). The monitor
 * window holds no workspace, so every Unload, Destroy Tab and Destroy Panel runs in the window that owns
 * it, with that window's own confirmation.
 */
import type { UnloadVariant } from '../sidebar/use-unload-project.js';

export type RoutedAction =
  | { readonly action: 'destroyTab' | 'destroyPanel'; readonly id: string }
  | { readonly action: 'unloadProject'; readonly id: string; readonly name: string; readonly variant?: UnloadVariant };
