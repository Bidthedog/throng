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

/*
 * 054 FR-001, FR-002 (research R1) — the order survives a restart. The layout's `Tab.previewRecency` is its
 * persisted form: the workspace store SEEDS each tab from it when a layout loads (`seedLastActivePreview`),
 * and SUBSCRIBES to every change of order here, answering with a normal debounced layout save. A seed is
 * not a change — it came from the layout — so it reports nothing.
 */
type RecencyListener = (tabId: string, ids: string[]) => void;
const listeners = new Set<RecencyListener>();

/** Replace `tabId`'s order with `ids` (most recent first) — a restored layout's. Reports nothing. */
export function seedLastActivePreview(tabId: string, ids: readonly string[]): void {
  byTab.set(tabId, [...ids]);
}

/** Hear every change of a tab's order, to persist it. Returns the unsubscribe. */
export function subscribeLastActivePreview(listener: RecencyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record `panelId` as the most recently active preview in `tabId` — written on a preview panel's
 * pointerdown AND focus (`preview-panel.tsx`), unlike the editor store's keyboard gap, and whenever an
 * open places, reuses or brings a preview forward (`open-preview.ts`): an open from File Explorer leaves
 * the keyboard in the tree (FR-081), so the preview it showed is never focused, yet it is still the one
 * the next open reuses. Moves an already-recorded panel to the front rather than duplicating it.
 */
export function recordLastActivePreview(tabId: string, panelId: string): void {
  const list = byTab.get(tabId) ?? [];
  if (list[0] === panelId) return;
  const next = [panelId, ...list.filter((id) => id !== panelId)];
  byTab.set(tabId, next);
  for (const listener of [...listeners]) listener(tabId, [...next]);
}

/**
 * The candidate to reuse for a new preview in `tabId` (FR-015): the most recently active panel there
 * that `isLive` still accepts, or `null` when none is. Never looks at another tab's list.
 *
 * 054 FR-007 — with `provider`, Last Active is per panel TYPE: a candidate counts only when the file it
 * shows now is `provider.id`'s (`provider.of`, the caller's registry lookup), so opening a Mermaid file
 * never reuses a Markdown preview, and the reverse.
 */
export function candidateFor(
  tabId: string,
  isLive: (panelId: string) => boolean,
  provider?: { id: string; of(panelId: string): string | undefined },
): string | null {
  const accepts = (id: string): boolean => isLive(id) && (provider === undefined || provider.of(id) === provider.id);
  return byTab.get(tabId)?.find(accepts) ?? null;
}

/** Test seam: drop every recorded tab between cases. */
export function __resetLastActivePreview(): void {
  byTab.clear();
}
