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

export type OpenDecision =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' };

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
