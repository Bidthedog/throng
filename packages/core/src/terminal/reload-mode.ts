/**
 * 039 (#293) — what happens to a terminal Panel when its project is opened.
 *
 * Pure, so the whole of FR-021/FR-022/FR-028/FR-029a is decidable without an Electron window, a
 * daemon or a shell. The renderer's job is to carry out the verdict, not to re-derive it.
 */

import type { TerminalReloadMode } from '../config/app-settings.js';
import type { WorkspaceLayout } from '../workspace/model.js';
import { collectPanels } from '../workspace/invariants.js';
import { setPanelDormant } from '../panel-type/assignment.js';
import { TERMINAL_KIND } from './panel-type.js';

/**
 * What the caller must do with one terminal Panel.
 *
 * - `start` — launch it, exactly as throng does today.
 * - `stay-dormant` — do nothing at all. No layout write either: it is already dormant, and
 *   rewriting the same value on every project open would churn the workspace for no reason.
 * - `mark-dormant` — record dormancy on the Panel, and do NOT launch.
 * - `wake-and-start` — clear the dormancy flag and launch.
 */
export type TerminalReloadAction = 'start' | 'stay-dormant' | 'mark-dormant' | 'wake-and-start';

/**
 * Decide what opening a project does to one of its terminal Panels.
 *
 * `dormant` is the Panel's persisted flag; `undefined` (absent) means "not dormant", which is what
 * every Panel written before 039 holds and what Automatic mode never changes.
 *
 * The four outcomes, and why each is what it is:
 *
 * | mode        | dormant   | action           | requirement |
 * |-------------|-----------|------------------|-------------|
 * | `automatic` | absent    | `start`          | FR-021 — today's behaviour, byte for byte |
 * | `automatic` | `true`    | `wake-and-start` | FR-029a — switching back to Automatic takes effect at the next project open, which is here |
 * | `manual`    | absent    | `mark-dormant`   | FR-022 — opening a project starts no terminal |
 * | `manual`    | `true`    | `stay-dormant`   | FR-028 — switching a project away and back must not wake what the user left dormant |
 *
 * The `automatic` + absent row is the one that matters most, because it is every existing install:
 * it returns `start` and touches nothing, so this feature is invisible until someone goes looking
 * for the preference.
 */
export function terminalReloadAction(
  mode: TerminalReloadMode,
  dormant: boolean | undefined,
): TerminalReloadAction {
  if (mode === 'automatic') return dormant === true ? 'wake-and-start' : 'start';
  return dormant === true ? 'stay-dormant' : 'mark-dormant';
}

/** Does this action launch a shell? The single place that question is answered. */
export function startsTerminal(action: TerminalReloadAction): boolean {
  return action === 'start' || action === 'wake-and-start';
}

/**
 * Does this action need the Panel's persisted dormancy flag changed?
 *
 * Only the two transitions do. `start` and `stay-dormant` are steady states, and returning `false`
 * for them is what keeps Automatic mode from writing to the workspace layout on every project open
 * (FR-021) — a write nobody asked for is an observable change, even when the rendered result looks
 * identical.
 */
export function changesDormancy(action: TerminalReloadAction): boolean {
  return action === 'mark-dormant' || action === 'wake-and-start';
}

/**
 * 039 FR-022/FR-028/FR-029a/FR-032 (#293) — apply the reload mode to a whole workspace layout, at
 * the moment a project is opened.
 *
 * Walks EVERY tab, not only the rendered one. That is FR-032's requirement in the reload direction:
 * a project's terminals are decided when its layout loads, so a tab the user has never looked at in
 * this session is treated exactly like the one in front of them. Deciding per panel at render time
 * would give the opposite behaviour — dormancy would depend on what the user happened to click.
 *
 * Returns the SAME layout object when nothing changed, so a caller can use identity to decide
 * whether a save is warranted. That is what keeps FR-021 true of the workspace file: in Automatic
 * mode with no dormant panels — every install today — this returns its input untouched and no write
 * is queued.
 */
export function applyReloadMode(layout: WorkspaceLayout, mode: TerminalReloadMode): WorkspaceLayout {
  let next = layout;
  for (const tab of layout.tabs) {
    for (const panel of collectPanels(tab.root)) {
      if (panel.kind !== TERMINAL_KIND) continue;
      const action = terminalReloadAction(mode, panel.dormant);
      if (!changesDormancy(action)) continue;
      next = setPanelDormant(next, panel.id, action === 'mark-dormant');
    }
  }
  return next;
}
