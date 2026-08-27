/**
 * App-wide open-document registry (006 Phase B, FR-011a). Pure logic over the
 * path→owner map; the UI-main coordinator holds the actual state. One buffer per
 * file everywhere: a second open of an already-open path focuses the existing
 * editor instead of creating a second buffer (the only scope coherent with the
 * machine-wide dirty-file lock). Paths are matched case/separator-insensitively
 * (reuses the 004 normalise). No OS calls.
 */
import { normaliseFolder } from '../projects/project.js';

export interface OpenDocEntry {
  panelId: string;
  windowId: string;
}

export interface OpenDocRegistry {
  /** Normalised absPath → owning editor. */
  byPath: Map<string, OpenDocEntry>;
}

export function createOpenRegistry(): OpenDocRegistry {
  return { byPath: new Map() };
}

/** True when `absPath` is open in an editor anywhere (drives Open-In disabling). */
export function isOpenAnywhere(reg: OpenDocRegistry, absPath: string): boolean {
  return reg.byPath.has(normaliseFolder(absPath));
}

/** One of `NOT_A_MISSING_FILE` — why throng will not open this file at all (041 FR-013). */
export type RefusalReason = string;

/**
 * What to do about an open request.
 *
 * ══ `refuse` IS 041's ONLY ADDITION, AND IT IS DELIBERATELY HERE (FR-013) ══
 *
 * #327: opening a too-large file with no editor panel open created one, showed the refusal inside it
 * as a banner, and raised no notification — so the user was left holding a panel for a file that was
 * never opened. With a panel already open the same action correctly produced a notification and no
 * panel. One action, two outcomes, decided by unrelated workspace state.
 *
 * The obvious design is a separate `probeOpenable` call. It is the wrong one, and the reason is
 * arithmetic: every open path ALREADY awaits this decision, so a second call would make an accepted
 * file cost two round-trips in order to save a refused one a panel. A third variant costs none.
 *
 * It also makes the rule enforceable rather than remembered. FR-013a binds every entry point that
 * would create a panel, and a caller that fails to handle `refuse` FAILS TO COMPILE — which is worth
 * more than a convention, because the one path that skipped the check (`openFileInNewEditor`, which
 * never asks this question at all) is exactly where the defect was reported from.
 *
 * A MISSING file is `open`, never `refuse` (FR-015). Its panel is what holds the recovered buffer.
 */
export type OpenDecision =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' }
  | { action: 'refuse'; reason: RefusalReason };

/** Decide whether to focus the existing editor for `absPath` or open a new one. */
export function openOrFocus(reg: OpenDocRegistry, absPath: string): OpenDecision {
  const existing = reg.byPath.get(normaliseFolder(absPath));
  return existing
    ? { action: 'focus', panelId: existing.panelId, windowId: existing.windowId }
    : { action: 'open' };
}

/** Record `absPath` as open in `entry`'s editor (open/create-with-path). */
export function registerOpen(reg: OpenDocRegistry, absPath: string, entry: OpenDocEntry): void {
  reg.byPath.set(normaliseFolder(absPath), entry);
}

/** Remove the registry entry for a path (close/destroy or path change). */
export function unregisterPath(reg: OpenDocRegistry, absPath: string): void {
  reg.byPath.delete(normaliseFolder(absPath));
}

/** Remove every registry entry owned by `panelId` (Panel destroy/close). */
export function unregisterPanel(reg: OpenDocRegistry, panelId: string): void {
  for (const [key, entry] of reg.byPath) {
    if (entry.panelId === panelId) reg.byPath.delete(key);
  }
}
