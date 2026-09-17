/**
 * What each preview panel in THIS window is showing (044, data-model §12, contracts/preview-ipc.md §2).
 *
 * A mirror, never an authority. Main's `PreviewService` owns every run; this store holds the last
 * `throng:preview:update` applied for each preview panel id — plus, separately, any failure the panel's
 * banner shows that no update carries (`PreviewFailure`, below) — and nothing else: no Back/Forward state
 * (that is `history-store`'s alone), no dirty flag of its own (FR-040), and nothing published to
 * `editor-state`, which is what keeps a dirty preview from being counted a second time anywhere the
 * app counts unsaved documents (FR-044, SC-006).
 *
 * ══ THE REVISION RULE ══
 *
 * An update whose `revision` is not above the last one applied is dropped. Updates arrive on two
 * routes — pushed to viewers, and returned from `attach` / `refresh` / `navigate` — and the two can
 * cross; without the rule a snapshot answered late would overwrite a newer push.
 *
 * `content: null` means "unchanged since the last revision" (a dirty-only, parent-only or notice-only
 * update), so it keeps the content already held rather than blanking the body.
 *
 * Module-level, like `editor-state` and the terminal title store: one window, one store, and every
 * preview header and body subscribes with `useSyncExternalStore` and filters by panel id. A
 * sub-workspace window runs its own module instance, so two windows never share an entry.
 */
import { useSyncExternalStore } from 'react';
import type { PreviewContent, PreviewNotice, PreviewUpdate } from '@throng/core';
import { sameJson } from '../common/same-json.js';

export interface PreviewPanelState {
  revision: number;
  filePath: string;
  providerId: string;
  /** `null` until an update has carried content (a run that could not read its file carries none). */
  content: PreviewContent | null;
  dirty: boolean;
  parent: { panelId: string; title: string } | null;
  notice: PreviewNotice | null;
  /**
   * The last position main asked the body to restore (attach, history navigate — FR-107). On a history
   * step it is always present, and `null` means "an entry with no saved place" (044 FR-121e, research R32).
   */
  viewState?: unknown;
  /**
   * 044 FR-121h — where `viewState` came from: `'attach'` for the panel's attach answer (an opening or a
   * restore, where the editor's line may win), `'update'` for every other apply (a step, where the saved
   * place wins). Present exactly when `viewState` is. Renderer-only; never sent over IPC.
   */
  viewStateSource?: ViewStateSource;
  /**
   * 044 T177 — main's count of this run's navigations, as the last update that carried one named it. A
   * `filePath` that changes while this does not is a re-point (a rename, a move, a Save As), and the body
   * keeps the reader's place. Kept across updates that omit it, so a body is never told the count went
   * away; `undefined` until an update carries one, which reads as "every file change is a navigation".
   */
  navigationSeq?: number;
}

/** Which call site applied a place (044 FR-121h; data-model §15.2). */
export type ViewStateSource = 'attach' | 'update';

const states = new Map<string, PreviewPanelState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/**
 * Apply an update from main. Returns whether it was applied — `false` for a stale or duplicate
 * revision, which changes nothing and notifies nobody.
 *
 * `source` tags a place the update carries: the panel's attach call site passes `'attach'`; every other
 * route — a push, a navigate or refresh reply — is an `'update'`. A present `null` place is kept as
 * `null` (a history step onto an entry with no saved place, 044 FR-121e).
 */
export function applyPreviewUpdate(update: PreviewUpdate, source: ViewStateSource = 'update'): boolean {
  const previous = states.get(update.panelId);
  /*
   * 044 US7b fix round 1, item 4 (FR-107) — a PLACE at the revision already held. Main's attach answers the
   * run's current snapshot WITHOUT a new revision, and a re-attaching view (a tab switch back) is exactly
   * when that snapshot carries the place the reader left. Dropped by the revision rule, the view came back
   * at the top. The rest of the snapshot is what this window already holds, so only the place is taken —
   * and only when it differs from the place held, so the same update arriving by both routes (a push and
   * the navigate reply that shares its revision) restores once.
   */
  if (
    previous !== undefined &&
    update.revision === previous.revision &&
    update.viewState !== undefined &&
    !sameJson(update.viewState, previous.viewState)
  ) {
    states.set(update.panelId, { ...previous, viewState: update.viewState, viewStateSource: source });
    emit();
    return true;
  }
  if (previous !== undefined && update.revision <= previous.revision) return false;
  // 044 T177 — the count main last named; an update that carries none leaves the one held.
  const navigationSeq = update.navigationSeq ?? previous?.navigationSeq;
  const next: PreviewPanelState = {
    revision: update.revision,
    filePath: update.filePath,
    providerId: update.providerId,
    content: update.content ?? previous?.content ?? null,
    dirty: update.dirty,
    parent: update.parent,
    notice: update.notice,
    // Present only when main set it; an update without one keeps the reader where they are (FR-024).
    ...(update.viewState !== undefined ? { viewState: update.viewState, viewStateSource: source } : {}),
    ...(navigationSeq !== undefined ? { navigationSeq } : {}),
  };
  states.set(update.panelId, next);
  emit();
  return true;
}

/**
 * Forget the place this panel was last asked to restore (044 US7b fix round 1, item 4). Called when a view
 * DETACHES: the place it held describes where that view was, and a later mount must wait for main's attach
 * answer — which carries where the reader left — rather than first jumping to the old one.
 */
export function clearPreviewViewState(panelId: string): void {
  const previous = states.get(panelId);
  if (previous === undefined || previous.viewState === undefined) return;
  const { viewState: _dropped, viewStateSource: _droppedSource, ...rest } = previous;
  states.set(panelId, rest);
  emit();
}

/** This panel's state, read without subscribing. */
export function getPreviewState(panelId: string): PreviewPanelState | undefined {
  return states.get(panelId);
}

/** This panel's state, re-rendering when it changes. `undefined` before the first update. */
export function usePreviewState(panelId: string): PreviewPanelState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => states.get(panelId),
    () => undefined,
  );
}

/**
 * A failure the preview's banner is showing that main's update does not carry (044 u8 review, T123 as
 * amended): the attach could not be made, or the body could not be loaded or drawn.
 *
 * It lives HERE, beside the update mirror, rather than in the panel's component state, because two
 * surfaces read it: the banner inside the panel, and the panel header, whose menu offers the banner's
 * three commands exactly while a banner is up (030 FR-042c). A failure only the component could see
 * left the menu unable to mirror it.
 */
export interface PreviewFailure {
  kind: 'attach' | 'body';
  /** The banner's one sentence — what could not be done (030 FR-040). Never a raw error. */
  headline: string;
  /**
   * The path shown under the headline, and the raw cause — which reaches the user only through Copy
   * details and the diagnostics log (030 FR-034, FR-040a). The banner and the header menu both copy
   * from these, so the two Copy details put identical text on the clipboard (FR-042c).
   */
  detail?: { path?: string; systemError?: string };
}

const failures = new Map<string, PreviewFailure>();

/** Record or clear a panel's failure. `null` clears it; clearing one that is not set notifies nobody. */
export function setPreviewFailure(panelId: string, failure: PreviewFailure | null): void {
  if (failure === null) {
    if (failures.delete(panelId)) emit();
    return;
  }
  failures.set(panelId, failure);
  emit();
}

/** This panel's failure, read without subscribing. */
export function getPreviewFailure(panelId: string): PreviewFailure | undefined {
  return failures.get(panelId);
}

/** This panel's failure, re-rendering when it is raised or cleared. */
export function usePreviewFailure(panelId: string): PreviewFailure | undefined {
  return useSyncExternalStore(
    subscribe,
    () => failures.get(panelId),
    () => undefined,
  );
}

/**
 * Forget a preview panel — on DESTROY, never on unmount. A tab switch unmounts the view and re-attaches
 * it later; the run's revisions carry on, so the entry is still the right yardstick. A destroyed run is
 * gone, and a panel id that is later a preview again starts a new run from revision 1, which the old
 * entry would drop as stale.
 */
export function clearPreviewState(panelId: string): void {
  const hadState = states.delete(panelId);
  const hadFailure = failures.delete(panelId);
  if (hadState || hadFailure) emit();
}

/** Tests only: every entry gone. */
export function __resetPreviewStore(): void {
  states.clear();
  failures.clear();
  emit();
}
