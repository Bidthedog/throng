/**
 * An action the Resource Monitor window asks another window to run (055 R12, R14, FR-086). The monitor
 * window holds no workspace, so every Unload, Destroy Tab and Destroy Panel runs in the window that owns
 * it, with that window's own confirmation.
 */
import type { UnloadVariant } from '../sidebar/use-unload-project.js';

export type RoutedAction =
  | { readonly action: 'destroyTab' | 'destroyPanel'; readonly id: string }
  | { readonly action: 'unloadProject'; readonly id: string; readonly name: string; readonly variant?: UnloadVariant }
  /**
   * Activate (FR-110): go to the project — and its tab, and its panel — in the window holding it, which comes
   * forward. A process is resolved to its panel before it is sent.
   */
  | {
      readonly action: 'activate';
      readonly projectId: string;
      readonly tabId?: string;
      readonly panelId?: string;
      /** Set by main on delivery: the receiving window answers it with whether it got there. */
      readonly requestId?: number;
    };
