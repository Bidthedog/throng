/**
 * Per-panel ownership of the document-wide CSS Custom Highlight registry (049 R2).
 *
 * `CSS.highlights` is ONE map per document, keyed by name. Two preview panels painting
 * `throng-preview-match` with `registry.set(name, …)` overwrite each other, so a panel that remounts (or
 * a second preview in the same window) wipes the other's paint. Every painter goes through here instead:
 * each panel's ranges are kept per (name, panel) and the registry holds ONE `Highlight` per name containing
 * the union. Like `preview-search.ts`, this never names `CSS.highlights` or `Highlight` at compile time, so
 * jsdom (which has neither) makes every call a no-op.
 */

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
}
interface HighlightCtor {
  new (...ranges: Range[]): unknown;
}

function runtime(): { registry: HighlightRegistry; Ctor: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Ctor ? { registry: css.highlights, Ctor } : null;
}

/** name → panelId → that panel's ranges. */
const owned = new Map<string, Map<string, Range[]>>();

function publish(name: string): void {
  const rt = runtime();
  const perPanel = owned.get(name);
  if (!rt) return;
  const all: Range[] = [];
  perPanel?.forEach((ranges) => all.push(...ranges));
  if (all.length === 0) rt.registry.delete(name);
  else rt.registry.set(name, new rt.Ctor(...all));
}

/** Replace `panelId`'s ranges under `name` (an empty list removes them). */
export function setPanelRanges(name: string, panelId: string, ranges: readonly Range[]): void {
  let perPanel = owned.get(name);
  if (ranges.length === 0) {
    perPanel?.delete(panelId);
    if (perPanel?.size === 0) owned.delete(name);
  } else {
    if (!perPanel) owned.set(name, (perPanel = new Map()));
    perPanel.set(panelId, [...ranges]);
  }
  publish(name);
}

/** Remove every range `panelId` holds, under every name; other panels' ranges stay painted. */
export function clearPanel(panelId: string): void {
  for (const name of [...owned.keys()]) {
    const perPanel = owned.get(name);
    if (!perPanel?.delete(panelId)) continue;
    if (perPanel.size === 0) owned.delete(name);
    publish(name);
  }
}
