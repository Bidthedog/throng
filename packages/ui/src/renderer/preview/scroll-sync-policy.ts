/**
 * The pure decisions of two-way scroll sync (044 FR-121e, FR-121g, FR-121h; data-model §15.3, plan.md
 * Iteration 2026-09-16 decisions 4 and 5, research R31–R32).
 *
 * Plain values in, a decision out: the body and the chrome feed these, and the unit tests pin them without a
 * layout. The block readings they compare (`topBlockLine`, `blockLineFor`) are the Markdown body's, in
 * `providers/markdown/scroll-anchor.ts`; nothing here imports a provider, because the panel chrome imports
 * this module (contracts/preview-provider-seam.md §3).
 */

/**
 * FR-121e (research R32) — whether a history step's place is the very top of its document: `null` (an entry
 * left at the top stores no place, and main sends that as `null`) or `{ line: 0, offsetRatio: 0 }` (the top
 * as a jump chain records it, which `restoreScrollAnchor` scrolls to 0). An ABSENT place (`undefined`) is
 * not: that is a followed link or a live update, never a step (analysis C2).
 */
export function isTopOfDocument(place: unknown): boolean {
  if (place === null) return true;
  if (typeof place !== 'object') return false;
  const { line, offsetRatio } = place as { line?: unknown; offsetRatio?: unknown };
  return line === 0 && offsetRatio === 0;
}

/** The two blocks FR-121g compares: the preview's top block, and the block the editor's line falls in. */
export interface BlockPair {
  previewTopBlock: number | null;
  editorLineBlock: number | null;
}

/** P4 — the preview follows the editor only onto a different block; either side unknown decides nothing. */
export function shouldFollow({ previewTopBlock, editorLineBlock }: BlockPair): boolean {
  return previewTopBlock !== null && editorLineBlock !== null && previewTopBlock !== editorLineBlock;
}

/** P4 — the preview drives the editor only from a different block; either side unknown decides nothing. */
export function shouldDrive({ previewTopBlock, editorLineBlock }: BlockPair): boolean {
  return previewTopBlock !== null && editorLineBlock !== null && previewTopBlock !== editorLineBlock;
}

export type StepPlacement = { kind: 'editorLine'; line: number } | { kind: 'restore'; place: unknown } | { kind: 'top' };

/**
 * P1 — where a HISTORY step lands. Called only for an update that carries a history place (the `viewState`
 * key is present), never for a followed link or a live update (analysis C2).
 *
 * A step that crosses files onto the top of a document, on a synchronised pair whose editor line is known in
 * this window, lands on the editor's line (FR-121e, T222). Any other step onto the top lands at the top — a
 * same-file step included, per the ruling of 519d3a8a, so Back after a contents link returns to the top and
 * the editor follows it (FR-115, FR-121f). Every other place is restored (FR-107).
 */
export function placeOnStep(a: { place: unknown; crossFile: boolean; synced: boolean; editorLine: number | null }): StepPlacement {
  if (!isTopOfDocument(a.place)) return { kind: 'restore', place: a.place };
  if (a.crossFile && a.synced && a.editorLine !== null) return { kind: 'editorLine', line: a.editorLine };
  return { kind: 'top' };
}

/**
 * P2 — which side decides where a pair starts (FR-121h), from what the chrome sees change.
 *
 * - `editor`: an opening or a restore (the view's first update is already parented, or a parent arrives
 *   before anything is drawn), or a parent replaced by another while the navigation count stands still —
 *   the editor's line places the preview.
 * - `preview`: an adoption (a drawn standalone preview gains a parent, count unchanged), or a link or step
 *   that moved the count — the preview's place drives the editor.
 * - `none`: no parent now, or nothing changed.
 */
export function pairStart(a: {
  firstUpdate: boolean;
  drawn: boolean;
  parentBefore: string | null;
  parentNow: string | null;
  navigationSeqBefore?: number;
  navigationSeqNow?: number;
}): 'editor' | 'preview' | 'none' {
  if (a.parentNow === null) return 'none';
  if (a.firstUpdate) return 'editor';
  if (a.navigationSeqBefore !== a.navigationSeqNow) return 'preview';
  if (a.parentBefore === a.parentNow) return 'none';
  if (a.parentBefore === null) return a.drawn ? 'preview' : 'editor';
  return 'editor';
}
