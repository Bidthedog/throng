/**
 * Last-active preview per tab (047 US2, research.md R8, data-model.md "LastActivePreview").
 *
 * The `last-active-editor.ts` precedent keeps a SINGLE value per tab, because an editor's fallback is
 * "create one" — there is nothing to skip to. A preview's fallback is different (R8): "the last active
 * preview in the visible tab, falling back to the most recently active remaining one there, or null" —
 * so this keeps an ordered LIST, most recent first, and {@link candidateFor} walks it for the first
 * entry that is still a live preview.
 *
 * Pruning happens at READ time, not on write and not through an explicit forget call: a closed panel's
 * id simply stops satisfying whatever `isLive` predicate a caller supplies, and nothing here needs to
 * know when a panel is destroyed to do the right thing. Plain module store (non-reactive) — read at
 * open time, exactly like `last-active-editor.ts`.
 */
const byTab = new Map<string, string[]>();

/**
 * Record `panelId` as the most recently active preview in `tabId` — written on a preview panel's
 * pointerdown AND focus (`preview-panel.tsx`), unlike the editor store's keyboard gap, and whenever an
 * open places, reuses or brings a preview forward (`open-preview.ts`): an open from File Explorer leaves
 * the keyboard in the tree (FR-081), so the preview it showed is never focused, yet it is still the one
 * the next open reuses. Moves an already-recorded panel to the front rather than duplicating it.
 */
export function recordLastActivePreview(tabId: string, panelId: string): void {
  const list = byTab.get(tabId) ?? [];
  byTab.set(tabId, [panelId, ...list.filter((id) => id !== panelId)]);
}

/**
 * The candidate to reuse for a new preview in `tabId` (FR-015): the most recently active panel there
 * that `isLive` still accepts, or `null` when none is. Never looks at another tab's list.
 */
export function candidateFor(tabId: string, isLive: (panelId: string) => boolean): string | null {
  return byTab.get(tabId)?.find(isLive) ?? null;
}

/** Test seam: drop every recorded tab between cases. */
export function __resetLastActivePreview(): void {
  byTab.clear();
}
