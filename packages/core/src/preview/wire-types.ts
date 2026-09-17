/**
 * The shapes that cross the preview bridge (044, contracts/preview-ipc.md §1–§2, data-model §10).
 *
 * In core rather than beside `PreviewService` because three independently compiled halves speak
 * them — main's service and registrar, the preload, and the renderer's stores — and core is the one
 * package all three already import. Types only: no OS, no DOM.
 */
import type { PersistedHistory } from '../workspace/model.js';

/** What a preview shows. `null` on an update means "unchanged since the last revision". */
export type PreviewContent =
  /** Text providers: the source's text at the moment of the snapshot. */
  | { kind: 'text'; text: string }
  /** Binary providers: `throng-preview://source/<previewPanelId>?rev=<n>`. */
  | { kind: 'resource'; url: string };

/**
 * The one inline notice a preview may carry (FR-026, FR-027, FR-090e, FR-106c).
 *
 * `repeat` is set when the same condition is reported again, so the renderer FLASHES the notice it
 * already shows rather than raising another (*one condition, one notice*).
 */
export type PreviewNotice = (
  | { kind: 'unreadable' | 'deleted' | 'too-large' | 'not-text' }
  | { kind: 'no-provider' }
  | { kind: 'link-missing-file' | 'link-outside'; target: string }
  /** Raised by the RENDERER, never by main: main does not parse headings. */
  | { kind: 'link-missing-heading'; target: string }
  | { kind: 'history-refused'; target: string; reason: string }
) & { repeat?: true };

/** `throng:preview:update` — to the run's viewers only (FR-022, FR-040, Principle I). */
export interface PreviewUpdate {
  panelId: string;
  /** A renderer drops an update whose revision is not above the last it applied. */
  revision: number;
  filePath: string;
  providerId: string;
  content: PreviewContent | null;
  /** FR-040 — always `false` while standalone (FR-043). */
  dirty: boolean;
  /** `null` = standalone (FR-013). */
  parent: { panelId: string; title: string } | null;
  notice: PreviewNotice | null;
  /** Set only on attach and on a history navigate (FR-024, FR-107). */
  viewState?: unknown;
  /**
   * 044 T177 — how many times this run has been NAVIGATED: a link followed to another file, or a history
   * step onto one. Carried on EVERY update, and only a navigation moves it, so a `filePath` that changes
   * while it stands still is a RE-POINT — an in-app rename or move, or a Save As (FR-013c) — and the
   * reader keeps their place rather than being taken to the top (FR-024). Absent (an update built by
   * something older than this field) means every file change is read as a navigation, as it was.
   */
  navigationSeq?: number;
}

export interface PreviewOpenRequest {
  absPath: string;
  projectId: string;
  requesterPanelId?: string;
  hasParentLocally: boolean;
}

export type PreviewOpenResponse =
  /**
   * A preview of this file exists, or is being placed (FR-012, FR-014). With a `panelId`, main focused
   * that panel's window and sent it `focus`. `null` means only a reservation exists: the preview is
   * already being placed, nothing has attached to focus, and main sends nothing.
   */
  | { kind: 'focused'; panelId: string | null }
  | { kind: 'placeLocally'; reservation: string; besidePanelId: string | null }
  | { kind: 'placedElsewhere' }
  | { kind: 'refused'; reason: 'no-provider' | 'disabled' | 'outside-project' | 'no-file' };

export interface PreviewAttachRequest {
  panelId: string;
  projectId: string;
  filePath: string;
  reservation?: string;
  history?: PersistedHistory;
}

export type PreviewAttachResponse =
  | { ok: true; update: PreviewUpdate }
  /** A verdict on the panel: the renderer clears it (FR-067). */
  | { ok: false; reason: 'no-provider' | 'disabled' | 'outside-project' }
  /**
   * Not a verdict: an unexpected error, or an attach overtaken by its panel's `destroyed`. The renderer
   * keeps the panel and shows its failure banner.
   */
  | { ok: false; reason: 'failed' };

export interface PreviewNavigateRequest {
  panelId: string;
  /** For `heading`: the run's current file, and the heading as written. */
  target: { absPath: string; fragment?: string };
  /**
   * `heading` (FR-115, iteration 2026-09-15): the renderer found a heading in the file it already shows and
   * scrolled to it. Main records a jump when `target.absPath` is the run's current file; it reads nothing
   * and answers `shown` with the run's unchanged snapshot either way.
   */
  intent: { kind: 'link' } | { kind: 'history'; index: number } | { kind: 'heading' };
  /** Stored on the entry being left (FR-107). For `heading`, always sent: the top is `{ line: 0, offsetRatio: 0 }`. */
  leavingViewState?: unknown;
  /** `heading` only: where the jump landed (FR-115). Always sent with it; never `null`. */
  arrivingViewState?: unknown;
}

export type PreviewNavigateResponse =
  /**
   * `fragment` is the request's, passed back untouched (§1 `navigate`): main does not parse headings, so
   * a fragment naming no heading is still `shown`, and the renderer raises `link-missing-heading`.
   */
  | { kind: 'shown'; update: PreviewUpdate; fragment?: string }
  | { kind: 'focusedOther'; panelId: string }
  | { kind: 'openedInEditor' }
  | { kind: 'refused'; notice: PreviewNotice };

/** `throng:preview:refresh`'s answer. `null` when the panel has no run (§1, amended). */
export interface PreviewRefreshResponse {
  update: PreviewUpdate | null;
}

/** `throng:preview:openChanged` — broadcast to every window. A path and nothing else. */
export interface PreviewOpenChanged {
  /**
   * The path in COMPARE form — `normaliseForCompare(path)`: forward slashes, lower-cased, no trailing
   * separator — never the persisted spelling. A renderer store keys by the same function and normalises
   * every lookup through it, or FR-012's greying and FR-014's pressed state never match on Windows.
   */
  path: string;
  /** `false` only when NO run remains for the path — a second preview of it keeps it open. */
  open: boolean;
}

/** `throng:preview:pathChanged` — broadcast (FR-066, FR-013c, FR-090a). */
export interface PreviewPathChanged {
  panelId: string;
  filePath: string;
}

/** `throng:preview:focus` — to one window (FR-014, FR-090c). */
export interface PreviewFocusMessage {
  panelId: string;
  fragment?: string;
}

/** `throng:preview:place` — to one window (FR-010). */
export interface PreviewPlaceMessage {
  requestId: string;
  absPath: string;
  projectId: string;
  /**
   * The parent to place it beside, or `null` — main's last resort when every window that might hold the
   * parent declined: place it standalone, as FR-011 would, rather than not at all (§1, amended).
   */
  besidePanelId: string | null;
  reservation: string;
}
