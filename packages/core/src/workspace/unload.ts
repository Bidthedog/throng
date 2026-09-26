/**
 * The Unload plan (046 data-model §8; FR-034a, FR-081, FR-086, FR-111). Pure: given the default
 * terminal action and the menu row the user chose, decide which action Unload applies. No OS, no DOM,
 * no dialogs.
 *
 * FR-111 withdrew the three-button dialog and the "Are you absolutely sure?" step, along with the
 * `confirmations.unloadProject` level that drove them: each Unload row names its action before the
 * click (FR-081), so the click carries it out. The plan is therefore always exactly one `apply` step,
 * and neither how many terminals are busy nor any confirmation level is read.
 *
 * The unsaved-editor prompt (FR-035) runs BEFORE this plan and is not part of it — it protects data,
 * and FR-111 leaves it in place.
 */
import type { UnloadTerminalAction } from '../config/app-settings.js';

export interface UnloadInput {
  /** `projects.unloadTerminalAction` — what the plain "Unload Project" row does. */
  readonly defaultAction: UnloadTerminalAction;
  /** Set when the user chose the opposite-action row (FR-081). */
  readonly variant?: UnloadTerminalAction;
}

/** One step of the plan. Only `apply` remains after FR-111. */
export type UnloadStep = { readonly kind: 'apply'; readonly action: UnloadTerminalAction };

/** Resolve the Unload plan: the chosen row's action, else the preference. Always one step. */
export function planUnload(input: UnloadInput): UnloadStep[] {
  return [{ kind: 'apply', action: input.variant ?? input.defaultAction }];
}
