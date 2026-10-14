/**
 * What a right-click on a diagram can do to THAT diagram (054, manual test change request 2026-10-12): copy
 * it as an image, and enter or leave Focus Mode with it. Each `DiagramFrame` registers its own, under the
 * key it already stamps on its in-place and maximised boxes (`data-diagram-zoom-key`), so the preview's
 * body menu finds the diagram under the pointer from the event target alone — wherever the diagram is drawn.
 */
export interface DiagramActions {
  /** Put the diagram on the clipboard as a PNG (with an `<img>` for rich targets). */
  copyImage(): void;
  /** Enter Focus Mode with it, or leave it — the diagram's own (inline) or its panel's (a `.mmd` preview). */
  toggleFocus(): void;
  /** Whether that Focus Mode is on now. */
  inFocus(): boolean;
  /** The chord that does the same, when there is one (a `.mmd` preview's is the panel's). */
  focusChord?: string;
}

const actions = new Map<string, DiagramActions>();

/** Register `key`'s actions; returns the unregister. A later registration for the same key replaces it. */
export function registerDiagramActions(key: string, value: DiagramActions): () => void {
  actions.set(key, value);
  return () => {
    if (actions.get(key) === value) actions.delete(key);
  };
}

/** The actions of the diagram `target` is inside, or `null` when it is in none. */
export function diagramActionsAt(target: Node | null): DiagramActions | null {
  const el = target instanceof Element ? target : (target?.parentElement ?? null);
  const key = el?.closest('[data-diagram-zoom-key]')?.getAttribute('data-diagram-zoom-key');
  return key ? (actions.get(key) ?? null) : null;
}
