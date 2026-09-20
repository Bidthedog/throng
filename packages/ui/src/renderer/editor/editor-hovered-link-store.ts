import { useSyncExternalStore } from 'react';
import type { EditorLinkAt } from './link-decorations.js';

/**
 * 045 FR-167 (round four) — the link under the pointer in an EDITOR, keyed by panelId.
 *
 * Module-level rather than component state, on the same precedent as `caret-store.ts` and
 * `document-metrics-store.ts`: the status strip is a SIBLING of the CodeMirror view in the tree, not
 * its parent, so nothing but a shared store lets one tell the other what the pointer is over. Set
 * from `use-editor.ts`'s own `mousemove`/`mouseleave` `domEventHandlers` (installed beside the
 * existing link pointer handlers), read here by `status-strip.tsx`.
 */
const hovered = new Map<string, EditorLinkAt | null>();
const listeners = new Map<string, Set<() => void>>();

function notify(panelId: string): void {
  for (const listener of listeners.get(panelId) ?? []) listener();
}

/** Set by the mount effect on every pointer move; `null` on leave. A no-op when nothing changed. */
export function setEditorHoveredLink(panelId: string, hit: EditorLinkAt | null): void {
  const current = hovered.get(panelId) ?? null;
  if (current === hit) return;
  if (current !== null && hit !== null && sameHit(current, hit)) return;
  hovered.set(panelId, hit);
  notify(panelId);
}

function sameHit(a: EditorLinkAt, b: EditorLinkAt): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'web' && b.kind === 'web') return a.uri === b.uri && a.from === b.from && a.to === b.to;
  return a.kind === 'file' && b.kind === 'file' && a.from === b.from && a.to === b.to;
}

/** This panel's hovered link, live. `null` while nothing is hovered, or before the first move. */
export function useEditorHoveredLink(panelId: string): EditorLinkAt | null {
  return useSyncExternalStore(
    (listener) => {
      let set = listeners.get(panelId);
      if (set === undefined) {
        set = new Set();
        listeners.set(panelId, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(panelId);
      };
    },
    () => hovered.get(panelId) ?? null,
    () => null,
  );
}

/** A panel closing takes its own entry with it, so a later panel with the same id starts clean. */
export function clearEditorHoveredLink(panelId: string): void {
  if (!hovered.has(panelId)) return;
  hovered.delete(panelId);
  notify(panelId);
}
