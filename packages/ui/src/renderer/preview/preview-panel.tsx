/**
 * The preview panel — its chrome, identical for every provider (044, FR-020, FR-034, FR-070,
 * data-model §13, contracts/preview-ipc.md §1–§2).
 *
 * ══ A VIEWER, NOT AN OWNER ══
 *
 * Main's `PreviewService` owns the run: the file, the source it follows, the content, the dirty flag,
 * the notice. This panel ATTACHES to it on mount — becoming one of its viewers — applies the updates
 * main pushes into `preview-store`, and DETACHES on unmount. Unmounting is not destroying: a tab switch
 * or a move unmounts the view and a later mount re-attaches to the same run. Only the routes that end a
 * preview tell main it is gone (`preview.destroyed`, `forget-preview-panel.ts`), and those live in the
 * workspace code that performs them.
 *
 * ══ THE PROVIDER IS INJECTED ══
 *
 * The body is whatever view `PreviewProviderRegistryContext` holds for the update's `providerId`. This
 * file names no provider and imports none (contracts/preview-provider-seam.md §3), so a provider added
 * later — or a test's — mounts here with no edit.
 *
 * ══ WHAT AN ATTACH REFUSAL MEANS ══
 *
 * `no-provider`, `disabled` and `outside-project` mean this preview must not exist here (FR-067): the
 * panel is cleared through `onRefused`. ANY other refusal — `failed`, main's answer for an unexpected
 * error, or a reason added later — is a failure to show, not a verdict on the panel: it keeps the panel
 * and says so through the shared failure banner, whose Try again attaches again.
 *
 * ══ EVERY FAILURE IS SHOWN, AND THE HEADER CAN SEE IT ══
 *
 * Three things can leave a preview blank: the attach, the body's load (a chunk that did not arrive),
 * and the body's own renderer. Each is caught, recorded in `preview-store` as the panel's failure,
 * shown through the one shared `PanelFailureBanner` (030 FR-039), and its cause written to the
 * diagnostics log — never a `void`ed promise that rejects into nothing. The failure lives in the store
 * rather than in this component because the panel HEADER reads it too: its menu offers the banner's
 * commands while a banner is up (030 FR-042c), and its Try again reaches this banner's retry through
 * `retryPanelFailure(panelId)`.
 *
 * ══ FOLLOWING A LINK IS THE CHROME'S DECISION ══
 *
 * The body says WHICH link the reader followed (`onFollow`); this panel decides what that means (FR-090,
 * FR-091), identically for every provider:
 *
 * | Link              | Here                                                                          |
 * |-------------------|-------------------------------------------------------------------------------|
 * | `external`        | `window.throng.preview.openExternal` — main's preview-link scheme check, the OS seam |
 * | `heading`         | scroll to the heading, then `preview.navigate` with intent `heading` and both places (FR-115); or one `link-missing-heading` notice, sending nothing (FR-090f) |
 * | `outside`         | one `link-outside` notice; main is not asked (FR-090e)                         |
 * | `file`, this file | with a fragment, as a heading; without one, the top, sending nothing (FR-103)  |
 * | `file`, another   | `preview.navigate` with intent `link` and the body's view state (FR-107)       |
 *
 * A heading jump is a history entry (FR-115): the place left and the place arrived at both go to main, the top
 * of the document as `{ line: 0, offsetRatio: 0 }`, never omitted. Main records it and answers the run's
 * unchanged snapshot, which changes nothing here. A heading followed while the body is still drawing the run's
 * file waits for `onDrawn` — and its intent waits with it. A fragment main hands back for a link to ANOTHER
 * file, and main's own `revealFragment`, scroll without recording: neither is a followed same-document heading.
 *
 * and main's answer: `shown` applies the update and scrolls to the fragment once the body has drawn the
 * new file — or raises `link-missing-heading` when that file has no such heading (FR-090e, second
 * sentence); `focusedOther` changes nothing (FR-090c); `openedInEditor` goes down the Files & Folders open
 * path, carrying the fragment so the caret can land on the heading (FR-090d); `refused` raises main's
 * notice (FR-090e).
 *
 * ══ LINK NOTICES: ONE CONDITION, ONE NOTIFICATION (FR-123) ══
 *
 * A link notice is this panel's own condition — no update carries it — and it is raised as an application
 * notification, never drawn in the panel. One per panel at a time: the same condition again flashes the
 * notification already showing; a different one replaces it; a link followed or a step taken clears it.
 *
 * ══ FILE NOTICES: THE RUN'S CONDITION, ONE BANNER ══
 *
 * The notice main carries on the run (FR-026, FR-027) is drawn by `preview-notice.tsx` in the one banner
 * slot, and the body is covered beneath it — the notice and nothing else. Whether the preview is parented
 * is not this component's to draw: the header reads `parent` and `dirty` from the same store (FR-013a).
 *
 * ══ A VIEW, NOT A DOCUMENT (FR-020, FR-035, FR-015) ══
 *
 * The body host refuses paste, cut and drop outright, so nothing underneath can act on them. It
 * intercepts the platform copy gesture and routes it through the same copy the body menu runs, in the
 * `editor.previews.copyFormat` read at that moment (`copy.ts`), and answers Ctrl+A by selecting the body
 * and nothing else. Its right-click menu (`content-menu.ts`) carries Content — Copy, Copy as Rich Text,
 * Copy as Plain Text, Select All — for a provider that draws selectable text, and Navigate's route back to
 * the source for a text provider. The status bar (`preview-status-bar.tsx`) carries that same route, under
 * the editor's `editor.showStatusBar`, and the panel HEADER's menu the same again: all three call the one
 * `onEditorRoute` the panel body hands in. The bar's one readout is the hovered or focused link's target
 * (FR-118), resolved here from the body's two reports.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import {
  firstBinding,
  normaliseForCompare,
  noticeLogRecord,
  panelZoomLevel,
  previewPathOf,
  samePath,
  toDisplayPath,
  zoomFactor,
  type Panel,
  type PreviewAttachRequest,
  type PreviewContent,
  type PreviewCopyFormat,
  type PreviewLink,
  type PreviewNotice,
  type PreviewPanelConfig,
  type ProviderSettings,
} from '@throng/core';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import { findHeading, linkOf } from './link-dom.js';
import { linkAddress, previewContentMenu, type PreviewContentSection, type PreviewEditorRouteItem } from './content-menu.js';
import {
  isLinkNotice,
  linkNoticeAction,
  linkNoticeMessage,
  previewLinkNoticeTestId,
  sameLinkNotice,
  type LinkNotice,
} from './preview-link-notice.js';
import { useNotify } from '../common/notification.js';
import { registerPreviewPanelHandles } from './preview-panel-handles.js';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import { isFileNotice, PreviewFileNotice, shownPreviewFailure } from './preview-notice.js';
import {
  applyPreviewUpdate,
  clearPreviewViewState,
  getPreviewFailure,
  getPreviewState,
  setPreviewFailure,
  usePreviewFailure,
  usePreviewState,
  type PreviewFailure,
  type PreviewPanelState,
} from './preview-store.js';
import { refreshPreviewPanel } from './refresh-preview.js';
import {
  captureSelection,
  copyCapturedSelection,
  selectAllIn,
  selectionRangeIn,
  type CapturedSelection,
} from './copy.js';
import { PreviewStatusBar } from './preview-status-bar.js';
import { toggleSyncScroll } from './sync-scroll-toggle.js';
import {
  editorDocLinesOf,
  editorTopLineOf,
  requestEditorTopLine,
  useEditorDocLines,
  useEditorTopLine,
  type EditorTopLine,
} from '../editor/editor-scroll-store.js';
import { pairStart } from './scroll-sync-policy.js';
import { usePreviewProviders } from './provider-registry-context.js';
import { clearPreviewReservation, previewReservationFor } from './preview-reservations.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import type { PreviewBody, PreviewBodyProps } from './provider-view.js';
import './preview.css';

/** The refusals that mean the preview must not be restored here (FR-067). Everything else is kept. */
const CLEARING_REFUSALS: ReadonlySet<string> = new Set(['no-provider', 'disabled', 'outside-project']);

/** What a preview says when main could not attach it for a reason that is not a verdict (030 FR-040). */
const ATTACH_FAILED = 'This preview could not be opened.';

/** What a preview says when its body could not be loaded or drawn (030 FR-040). */
const BODY_FAILED = 'This preview could not be drawn.';

/** What a navigated preview shows when its update names no content for the new file (fix round 1). */
const CLEARED_CONTENT: PreviewContent = { kind: 'text', text: '' };

/**
 * 044 FR-115 — the top of a document as a place, for a reader the body has no anchor for. The wire value
 * contracts/preview-ipc.md §1 fixes; only a text provider's headings can be jumped to.
 *
 * It is what EVERY route out of an entry reports for a reader at the top (u3b concern 1): a heading jump,
 * a followed link, a history step and a detaching view. Reported as "no place", main stores nothing on the
 * entry being left, and its later Back onto that entry carries no `viewState` — which the body cannot tell
 * from an ordinary update, so the position moved and the reader did not.
 */
const TOP_OF_DOCUMENT = { line: 0, offsetRatio: 0 } as const;

/** 044 U2 — the file a body last drew, and how many lines its text had (`null` for content that is not text). */
interface DrawnLines {
  filePath: string;
  lines: number | null;
}

/** Lines in `text`, counted as CodeMirror and the Markdown pipeline count them: each line-ending style is one break. */
function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) count += 1;
    else if (c === 13) {
      count += 1;
      if (text.charCodeAt(i + 1) === 10) i += 1;
    }
  }
  return count;
}

/**
 * 044 U2 — whether the text drawn for the shown file is BEHIND the parent editor's document: the two line
 * counts differ, so the drawn `data-source-line`s number an older text than the editor's line does. Unknown
 * on either side, or a different file drawn (a navigation in progress), is not behind.
 */
function isBehind(drawn: DrawnLines | null, current: PreviewPanelState | undefined, docLines: number | null): boolean {
  return (
    docLines !== null &&
    drawn !== null &&
    drawn.lines !== null &&
    current !== undefined &&
    samePath(drawn.filePath, current.filePath) &&
    drawn.lines !== docLines
  );
}

/** 044 FR-121h — an adopted editor, asked to come to `target`, not yet followed. */
interface Adoption {
  editor: string;
  target: number;
  requested: boolean;
}

/** What the chrome last saw of the pair, to tell what changed (`pairStart`). */
interface PairState {
  seen: boolean;
  parent: string | null;
  navigationSeq?: number;
  adopt: Adoption | null;
}

const NO_PAIR: PairState = { seen: false, parent: null, adopt: null };

/** A provider without its own settings entry reads as disabled — the registry's own safe reading. */
const NO_PROVIDER_SETTINGS: ProviderSettings = { enabled: false };

type AttachResult = { outcome: 'ok' | 'refused' } | { outcome: 'failed'; error?: unknown };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface PreviewPanelProps {
  panel: Panel;
  /** The panel's origin project root, or `null` while it is unknown. */
  projectRoot: string | null;
  /** Main refused the attach with a reason that removes the preview (FR-067). */
  onRefused: () => void;
  /** *Clear panel type* from the failure banner: the panel stays (030 FR-043). */
  onClearType: () => void;
  /**
   * 044 FR-027 — *Close* on the no-provider notice: the panel goes exactly as its header's Close Panel
   * takes it, which is also what tells main the preview is gone (`preview.destroyed`). Required: a
   * fallback that removed the panel some other way would leave main holding a run for a preview nobody
   * can see (FR-012).
   */
  onClose: () => void;
  /**
   * 044 FR-015 — the route back to the source: Open in Editor while standalone, Go to Editor while parented
   * (`runPreviewEditorRoute`). The status bar's button and the body menu's row both call it, as the header
   * menu's row calls the same function. Omitted where no workspace can place an editor: neither is drawn.
   */
  onEditorRoute?: () => void;
}

export function PreviewPanel({ panel, projectRoot, onRefused, onClearType, onClose, onEditorRoute }: PreviewPanelProps): ReactElement {
  const panelId = panel.id;
  const state = usePreviewState(panelId);
  const failure = usePreviewFailure(panelId);
  const { views, registry } = usePreviewProviders();
  const settings = useAppSettings();
  const place = usePanelPlace(panelId);
  const placeRef = useRef(place);
  placeRef.current = place;
  const os = window.throng?.osName ?? 'windows';

  // The persisted fields as they were when this view mounted. The run, not the layout, is the authority
  // from then on (contracts/preview-ipc.md §1 "which persisted field wins"); re-attaching on every
  // config write would re-attach on every mirror write main itself caused.
  const config = panel.config as PreviewPanelConfig | undefined;
  const mountFile = useRef(config?.filePath ?? previewPathOf(config) ?? '');
  const mountHistory = useRef(config?.history);
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;
  /** For a RETRY's answer only — each effect guards its own answers with its own `active` flag. */
  const mounted = useRef(false);

  /** Record a failure for the banner and the header, and log its cause (030 FR-034, FR-052). */
  const reportFailure = useCallback(
    (kind: PreviewFailure['kind'], headline: string, error?: unknown): void => {
      const systemError = error === undefined ? undefined : messageOf(error);
      const path = mountFile.current ? toDisplayPath(mountFile.current, os) : undefined;
      setPreviewFailure(panelId, {
        kind,
        headline,
        detail: { ...(path ? { path } : {}), ...(systemError ? { systemError } : {}) },
      });
      // The log, not a notice: the banner IS this condition's one surface (one condition, one notice).
      window.throng?.notices?.log?.(
        noticeLogRecord({
          severity: 'error',
          message: headline,
          subject: panelSubject(placeRef.current),
          ...(systemError ? { detail: systemError } : {}),
        }),
      );
    },
    [panelId, os],
  );

  const clearFailure = useCallback(
    (kind: PreviewFailure['kind']): void => {
      if (getPreviewFailure(panelId)?.kind === kind) setPreviewFailure(panelId, null);
    },
    [panelId],
  );

  const attach = useCallback(async (): Promise<AttachResult> => {
    const bridge = window.throng?.preview;
    if (!bridge) return { outcome: 'failed' };
    // 044 T080 — a preview `openPreview` just placed carries main's reservation, so its first attach
    // consumes the hold on the path (FR-012). A restored or re-mounted preview has none.
    const reservation = previewReservationFor(panelId);
    const req: PreviewAttachRequest = {
      panelId,
      projectId: panel.originProjectId,
      filePath: mountFile.current,
      ...(reservation !== undefined ? { reservation } : {}),
      ...(mountHistory.current !== undefined ? { history: mountHistory.current } : {}),
    };
    try {
      const res = await bridge.attach(req);
      // Main has answered: it consumed the reservation, or released it with its refusal.
      if (reservation !== undefined) clearPreviewReservation(panelId);
      if (res.ok) {
        // 044 FR-121h (research R32) — a place in the attach answer is an OPENING's, tagged so the body can
        // let the editor's line win over it; every other apply tags its place `update`.
        applyPreviewUpdate(res.update, 'attach');
        return { outcome: 'ok' };
      }
      return CLEARING_REFUSALS.has(res.reason) ? { outcome: 'refused' } : { outcome: 'failed' };
    } catch (error) {
      // Failures are returned, never thrown, across this bridge — a throw is a broken bridge, and it is
      // shown the same way as main's own `failed`, with the cause logged.
      return { outcome: 'failed', error };
    }
  }, [panelId, panel.originProjectId]);

  const settleAttach = useCallback(
    (result: AttachResult): void => {
      if (result.outcome === 'refused') onRefusedRef.current();
      else if (result.outcome === 'failed') reportFailure('attach', ATTACH_FAILED, result.error);
      else clearFailure('attach');
    },
    [reportFailure, clearFailure],
  );

  useEffect(() => {
    // THIS mount's flag. StrictMode (and any fast remount) runs mount → cleanup → mount, and the first
    // mount's attach answers after the second has begun; a flag shared across mounts would let that
    // stale answer apply too — an FR-067 refusal clearing the panel twice.
    let active = true;
    mounted.current = true;
    const bridge = window.throng?.preview;
    // Subscribe BEFORE attaching, so a push that races the attach's answer is not lost; the revision
    // rule in the store settles which of the two wins.
    const unsubscribe = bridge?.onUpdate((update) => {
      if (update.panelId === panelId) applyPreviewUpdate(update);
    });
    void attach().then((result) => {
      if (active) settleAttach(result);
    });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe?.();
      bridge?.detach(panelId);
      // A failure describes THIS view's attempt; the next mount makes its own and reports its own.
      setPreviewFailure(panelId, null);
    };
  }, [panelId, attach, settleAttach]);

  const retryAttach = useCallback(async (): Promise<boolean> => {
    const result = await attach();
    if (mounted.current) settleAttach(result);
    return result.outcome !== 'failed';
  }, [attach, settleAttach]);

  // The body: whatever view the injected registry holds for this run's provider, loaded on first use.
  const view = state ? views[state.providerId] : undefined;
  const [body, setBody] = useState<{ id: string; Body: PreviewBody } | null>(null);
  /** Bumped to remount the body, so a body whose renderer failed builds it again (retry). */
  const [bodyGeneration, setBodyGeneration] = useState(0);

  useEffect(() => {
    if (!view || body?.id === view.id) return;
    let active = true;
    view.load().then(
      (Body) => {
        if (!active) return;
        setBody({ id: view.id, Body });
        clearFailure('body');
      },
      (error: unknown) => {
        if (active) reportFailure('body', BODY_FAILED, error);
      },
    );
    return () => {
      active = false;
    };
  }, [view, body?.id, reportFailure, clearFailure]);

  /**
   * A REDRAW in progress — the body's retry after it loaded and could not draw — waiting for the remounted
   * body to say how it went: `onDrawn` (it drew) or `onBodyFailure` (it failed again). The retry resolves
   * from THAT, so a redraw that fails again leaves the one banner standing and saying so (030 FR-045),
   * exactly as a failed load retry does. The failure stays recorded until the body has drawn, so the banner
   * is not taken down and put back in between.
   */
  const redraw = useRef<((drew: boolean) => void) | null>(null);
  const settleRedraw = useCallback((drew: boolean): void => {
    const settle = redraw.current;
    redraw.current = null;
    settle?.(drew);
  }, []);
  useEffect(() => () => settleRedraw(false), [settleRedraw]);

  /** A body that loaded but could not draw reports here (the provider's renderer, its chunk). */
  const onBodyFailure = useCallback(
    (error: unknown): void => {
      reportFailure('body', BODY_FAILED, error);
      settleRedraw(false);
    },
    [reportFailure, settleRedraw],
  );

  const retryBody = useCallback(async (): Promise<boolean> => {
    if (!view) return false;
    if (body?.id !== view.id) {
      // The LOAD failed: nothing is cached for a failed load, so asking again really asks again.
      try {
        const Body = await view.load();
        if (mounted.current) {
          setBody({ id: view.id, Body });
          clearFailure('body');
        }
        return true;
      } catch (error) {
        if (mounted.current) reportFailure('body', BODY_FAILED, error);
        return false;
      }
    }
    // The body loaded and could not DRAW: remount it, so it builds its renderer again, and answer with what
    // the remounted body reports — `onDrawn` or `onBodyFailure` — rather than with the asking.
    settleRedraw(false);
    const drew = new Promise<boolean>((resolve) => {
      redraw.current = resolve;
    });
    setBodyGeneration((g) => g + 1);
    const ok = await drew;
    if (ok && mounted.current) clearFailure('body');
    return ok;
  }, [view, body?.id, reportFailure, clearFailure, settleRedraw]);

  // FR-107 — the body registers how to read its position; the chrome asks when it leaves an entry.
  const captureViewState = useRef<(() => unknown) | null>(null);
  const onViewStateCapture = useCallback((capture: () => unknown): void => {
    captureViewState.current = capture;
  }, []);

  /*
   * 044 FR-010, FR-014 — focus. Opening a preview, and choosing a pressed status-bar button, both end
   * with "the preview is focused" (`requestPanelFocus`), which reaches a panel only through the focus
   * registry. The body host is the focusable surface: it is what the keyboard reads and scrolls.
   */
  const bodyHostRef = useRef<HTMLDivElement | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  /** Whether the body is covered by a file notice right now — read by the focus callback below. */
  const bodyCoveredRef = useRef(false);
  useEffect(() => {
    registerPanelFocus(panelId, () => {
      // US2 fix round 1 — while a file notice covers the body, the body is inert and cannot take the
      // keyboard: the notice is what the reader is looking at, so its first control does.
      if (bodyCoveredRef.current) {
        const control = panelRootRef.current?.querySelector<HTMLElement>(
          `[data-testid="panel-failure-${panelId.replace(/["\\]/g, '\\$&')}"] button:not(:disabled)`,
        );
        if (control) {
          control.focus({ preventScroll: true });
          return;
        }
      }
      bodyHostRef.current?.focus({ preventScroll: true });
    });
    return () => unregisterPanelFocus(panelId);
  }, [panelId]);

  /* ── Link notices (FR-090e, FR-090f, FR-123) ─────────────────────────────────────────────────── */

  /*
   * FR-123 — an application notification, never an element in the panel. One per panel at a time
   * (FR-123b): the same condition again goes to `notify`, whose duplicate rule flashes the card already up;
   * a different one clears the last first; a link followed or a step taken clears it.
   */
  const { notify, clear } = useNotify();
  const linkNoticeTestId = previewLinkNoticeTestId(panelId);
  const lastLinkNotice = useRef<LinkNotice | null>(null);
  const projectRootRef = useRef(projectRoot);
  projectRootRef.current = projectRoot;
  const raiseLinkNotice = useCallback(
    (notice: LinkNotice): void => {
      const last = lastLinkNotice.current;
      if (last !== null && !sameLinkNotice(last, notice)) clear(linkNoticeTestId);
      lastLinkNotice.current = notice;
      notify({
        severity: 'warning',
        subject: panelSubject(placeRef.current),
        action: linkNoticeAction(notice),
        message: linkNoticeMessage(notice, projectRootRef.current),
        testId: linkNoticeTestId,
        onDismiss: () => {
          if (lastLinkNotice.current !== null && sameLinkNotice(lastLinkNotice.current, notice)) lastLinkNotice.current = null;
        },
      });
    },
    [notify, clear, linkNoticeTestId],
  );
  const clearLinkNotice = useCallback((): void => {
    if (lastLinkNotice.current === null) return;
    lastLinkNotice.current = null;
    clear(linkNoticeTestId);
  }, [clear, linkNoticeTestId]);
  /** The body's own reports. Only the link notices are a body's to raise (FR-090e/f). */
  const onNotice = useCallback(
    (notice: PreviewNotice): void => {
      if (isLinkNotice(notice)) raiseLinkNotice(notice);
    },
    [raiseLinkNotice],
  );

  /* ── The link target readout (FR-118) ────────────────────────────────────────────────────────── */

  /**
   * The link under the pointer and the link holding keyboard focus, as the body reports them. The readout shows
   * `hover ?? focus`: the hovered link wins, and when the pointer leaves it a still-focused link shows again
   * (contracts/menus-and-controls.md §8). Both go when the panel shows another file.
   */
  const [linkTargets, setLinkTargets] = useState<{ hover: string | null; focus: string | null }>({ hover: null, focus: null });
  const onLinkTarget = useCallback((source: 'hover' | 'focus', target: string | null): void => {
    setLinkTargets((current) => (current[source] === target ? current : { ...current, [source]: target }));
  }, []);
  const shownFile = state?.filePath;
  useEffect(() => {
    setLinkTargets((current) => (current.hover === null && current.focus === null ? current : { hover: null, focus: null }));
  }, [shownFile]);
  const linkReadout = linkTargets.hover ?? linkTargets.focus;

  /* ── Fragments (FR-090b, FR-090c, FR-090f) ───────────────────────────────────────────────────── */

  /**
   * The file the body last put on screen, and a fragment waiting for a file to be drawn — with whether scrolling
   * to it is a followed same-document heading, which records a jump (FR-115), or a fragment that only scrolls.
   */
  const drawnFile = useRef<string | null>(null);
  /** 044 U2 — the file last drawn and its line count, re-rendering when the count changes (see `isBehind`). */
  const drawnLines = useRef<DrawnLines | null>(null);
  const [drawnSeen, setDrawnLinesSeen] = useState<DrawnLines | null>(null);
  const pendingFragment = useRef<{ filePath: string; fragment: string; jump: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Scroll the heading `fragment` names to the top of the body. Returns whether there was one. */
  const scrollToHeading = useCallback(
    (fragment: string): boolean => {
      const host = bodyHostRef.current;
      const heading = host ? findHeading(host, fragment) : null;
      if (host && heading) {
        // The heading to the top of THIS body host — host-relative arithmetic, as `open-preview.ts` does,
        // rather than `scrollIntoView`, which would also scroll every scrollable ancestor of the panel.
        host.scrollTop += heading.getBoundingClientRect().top - host.getBoundingClientRect().top;
        // The link was followed: a notice about an earlier one no longer describes anything (item 13).
        clearLinkNotice();
        return true;
      }
      raiseLinkNotice({ kind: 'link-missing-heading', target: fragment });
      return false;
    },
    [raiseLinkNotice, clearLinkNotice],
  );

  /**
   * 044 FR-115 — a followed same-document heading: read where the reader is, scroll, read where they landed, and
   * tell main both, so the jump is a history entry. A reader at the top has no body anchor (`null`), and the top
   * is still a place: `{ line: 0, offsetRatio: 0 }`, never omitted (contracts/preview-ipc.md §1). A heading that
   * is not found raised its notice in `scrollToHeading` and sends nothing. Main's answer is the run's unchanged
   * snapshot: the reader stays where the jump put them, so it is not applied.
   */
  /**
   * Where the reader is, for main to store on the entry being left (FR-107). A body that answers `null` is
   * a reader at the TOP, which is a place — never an omission (see {@link TOP_OF_DOCUMENT}). `undefined`
   * only when no body has registered a capture at all: then this chrome knows nothing to report.
   */
  const placeLeft = useCallback((): unknown => {
    const capture = captureViewState.current;
    return capture === null ? undefined : (capture() ?? TOP_OF_DOCUMENT);
  }, []);

  const jumpToHeading = useCallback(
    (filePath: string, fragment: string): void => {
      const leavingViewState = placeLeft() ?? TOP_OF_DOCUMENT;
      if (!scrollToHeading(fragment)) return;
      const arrivingViewState = placeLeft() ?? TOP_OF_DOCUMENT;
      const bridge = window.throng?.preview;
      if (!bridge) return;
      void bridge
        .navigate({
          panelId,
          target: { absPath: filePath, fragment },
          intent: { kind: 'heading' },
          leavingViewState,
          arrivingViewState,
        })
        .catch((error: unknown) => {
          window.throng?.notices?.log?.(
            noticeLogRecord({
              severity: 'error',
              message: 'A heading jump in a preview could not be recorded.',
              subject: panelSubject(placeRef.current),
              detail: messageOf(error),
            }),
          );
        });
    },
    [panelId, scrollToHeading, placeLeft],
  );

  /**
   * Scroll to `fragment` in `filePath` — now if the body shows that file, else once it has drawn it. `jump`: a
   * followed same-document heading, which also records the jump (FR-115) — deferred with the scroll.
   */
  const revealFragmentIn = useCallback(
    (filePath: string, fragment: string, jump = false): void => {
      if (drawnFile.current !== null && samePath(drawnFile.current, filePath)) {
        pendingFragment.current = null;
        if (jump) jumpToHeading(filePath, fragment);
        else scrollToHeading(fragment);
      } else {
        pendingFragment.current = { filePath, fragment, jump };
      }
    },
    [scrollToHeading, jumpToHeading],
  );

  const onDrawn = useCallback(
    (filePath: string): void => {
      drawnFile.current = filePath;
      // U2 — the body draws the text the store holds now (a draw overtaken by newer text reports nothing).
      const content = stateRef.current?.content;
      const lines = content?.kind === 'text' ? countLines(content.text) : null;
      const before = drawnLines.current;
      if (before === null || before.filePath !== filePath || before.lines !== lines) {
        const next = { filePath, lines };
        drawnLines.current = next;
        setDrawnLinesSeen(next);
      }
      // A redraw retry waiting on this body has its answer: it drew (see `redraw`).
      settleRedraw(true);
      const pending = pendingFragment.current;
      if (pending !== null && samePath(pending.filePath, filePath)) {
        pendingFragment.current = null;
        // analyze Medium 2 — a heading followed mid-redraw: the place left is wherever the draw put the reader.
        if (pending.jump) jumpToHeading(pending.filePath, pending.fragment);
        else scrollToHeading(pending.fragment);
      }
    },
    [scrollToHeading, jumpToHeading, settleRedraw],
  );

  /* ── Following (FR-090, FR-091) ──────────────────────────────────────────────────────────────── */

  const onFollow = useCallback(
    (link: PreviewLink): void => {
      const current = stateRef.current;
      switch (link.kind) {
        case 'external':
          // The preview's own channel: main allows `mailto:` there, and keeps the general one http(s)-only.
          window.throng?.preview?.openExternal?.(link.url);
          clearLinkNotice();
          return;
        case 'heading':
          if (current) revealFragmentIn(current.filePath, link.fragment, true);
          return;
        case 'outside':
          raiseLinkNotice({ kind: 'link-outside', target: link.target });
          return;
        case 'file':
          break;
        default:
          return;
      }
      if (!current) return;
      if (samePath(link.absPath, current.filePath)) {
        // FR-115 — this file with a fragment is a same-document heading jump; without one, only the top.
        if (link.fragment !== undefined) revealFragmentIn(current.filePath, link.fragment, true);
        else if (bodyHostRef.current) bodyHostRef.current.scrollTop = 0;
        return;
      }
      const bridge = window.throng?.preview;
      if (!bridge) return;
      // Read BEFORE the call: the position being left is where the reader is now (FR-107) — the top of
      // the document included, which is a place like any other (u3b concern 1).
      const leavingViewState = placeLeft();
      void bridge
        .navigate({
          panelId,
          target: link.fragment !== undefined ? { absPath: link.absPath, fragment: link.fragment } : { absPath: link.absPath },
          intent: { kind: 'link' },
          ...(leavingViewState !== undefined ? { leavingViewState } : {}),
        })
        .then((res) => {
          if (!mounted.current) return;
          switch (res.kind) {
            case 'shown': {
              // OVERTAKEN (fix round 2): a later link of this panel moved it on while main read this one's
              // target, and main answered with the run as it stands — another file, no fragment. That answer
              // describes the later link, which has already been handled: this one does nothing at all, or
              // it would clear the later link's notice and look for this link's heading in its file.
              if (normaliseForCompare(res.update.filePath) !== normaliseForCompare(link.absPath)) return;
              clearLinkNotice();
              // A navigation's update for ANOTHER file must carry that file's content. `null` means
              // "unchanged", which here would keep the previous document on screen under the new path
              // — so it is read as nothing to show (fix round 1, item 1; main sends content explicitly).
              const moved = !samePath(res.update.filePath, current.filePath);
              applyPreviewUpdate(
                moved && res.update.content === null ? { ...res.update, content: CLEARED_CONTENT } : res.update,
              );
              // Main's fragment only: it passes the link's back untouched, and leaves it off an overtaken answer.
              if (res.fragment !== undefined) revealFragmentIn(res.update.filePath, res.fragment);
              return;
            }
            case 'openedInEditor':
              // A successful follow: a notice about an earlier link describes nothing now.
              clearLinkNotice();
              // FR-090d — exactly as if opened from Files & Folders; the fragment places the caret.
              window.dispatchEvent(
                new CustomEvent('throng:open-file', {
                  detail: {
                    absPath: link.absPath,
                    ...(link.fragment !== undefined ? { headingFragment: link.fragment } : {}),
                  },
                }),
              );
              return;
            case 'refused':
              if (isLinkNotice(res.notice)) raiseLinkNotice(res.notice);
              return;
            default:
              // `focusedOther` — main focused the preview that already shows the file (FR-090c). This one
              // does not change, but the link WAS followed, so an earlier link's notice goes.
              clearLinkNotice();
              return;
          }
        })
        .catch((error: unknown) => {
          // A thrown bridge is a broken bridge (failures are returned, never thrown). The reader stays
          // where they are; the cause goes to the diagnostics log.
          window.throng?.notices?.log?.(
            noticeLogRecord({
              severity: 'error',
              message: 'A link in a preview could not be followed.',
              subject: panelSubject(placeRef.current),
              detail: messageOf(error),
            }),
          );
        });
    },
    [panelId, raiseLinkNotice, clearLinkNotice, revealFragmentIn, placeLeft],
  );

  /* ── Back and Forward (044 US7: FR-102, FR-106b–d, FR-107) ───────────────────────────────────── */

  /**
   * A step through this panel's history. Main moves the position — or refuses, or focuses another preview —
   * and answers; the renderer never moves it itself (contracts/navigation-history.md §1, §4):
   *
   * | Reply                      | Here                                                                   |
   * |----------------------------|------------------------------------------------------------------------|
   * | `shown`, moved             | the update applied; its `viewState` restores the reader's place       |
   * | `shown`, same file (FR-115)| a step between jump entries: `content: null` keeps the drawn document, |
   * |                            | and the body restores the entry's `viewState` in place — no redraw     |
   * | `shown`, unchanged snapshot| a stale step: its revision is not above the last one, so nothing      |
   * | `shown` with a file notice | the file is missing or unreadable: the banner shows, the position moved|
   * | `refused`                  | one `history-refused` notice naming the file; nothing else changes    |
   * | `focusedOther`             | main focused the preview already showing it; nothing here changes     |
   */
  const onHistoryStep = useCallback(
    (target: { index: number; filePath: string }): void => {
      const current = stateRef.current;
      const bridge = window.throng?.preview;
      if (!bridge) return;
      // Read BEFORE the call: the place being left is where the reader is now (FR-107) — the top of the
      // document included, so a Back onto this entry later restores it (u3b concern 1).
      const leavingViewState = placeLeft();
      void bridge
        .navigate({
          panelId,
          target: { absPath: target.filePath },
          intent: { kind: 'history', index: target.index },
          ...(leavingViewState !== undefined ? { leavingViewState } : {}),
        })
        .then((res) => {
          if (!mounted.current) return;
          switch (res.kind) {
            case 'shown': {
              const moved = current !== undefined && !samePath(res.update.filePath, current.filePath);
              // A navigation's update for ANOTHER file carries that file's content; `null` there means there
              // is nothing to show (a missing or unreadable file), never "keep the previous document".
              const applied = applyPreviewUpdate(
                moved && res.update.content === null ? { ...res.update, content: CLEARED_CONTENT } : res.update,
              );
              if (applied && moved) clearLinkNotice();
              return;
            }
            case 'refused':
              if (isLinkNotice(res.notice)) raiseLinkNotice(res.notice);
              return;
            default:
              // `focusedOther` (FR-106b) — this panel does not change. `openedInEditor` is never a history reply.
              return;
          }
        })
        .catch((error: unknown) => {
          window.throng?.notices?.log?.(
            noticeLogRecord({
              severity: 'error',
              message: 'A preview could not step through its history.',
              subject: panelSubject(placeRef.current),
              detail: messageOf(error),
            }),
          );
        });
    },
    [panelId, raiseLinkNotice, clearLinkNotice, placeLeft],
  );

  /*
   * §6 — a view that DETACHES (a tab switch, a move, an unmount) stores the reader's place on its current
   * entry first, so a re-attach restores where they were rather than where they last left that entry. A
   * LAYOUT effect's cleanup, because it runs before the body's DOM is taken out of the document: read after
   * that, the scroller would report the top.
   */
  useLayoutEffect(
    () => () => {
      // A reader at the top leaves the TOP on the entry, never "nothing" (u3b concern 1): an entry with no
      // place cannot be stepped back onto visibly.
      const place = placeLeft();
      if (place !== undefined) window.throng?.history?.setViewState(panelId, place);
      // The place this view last restored is not where the reader is now: a remount waits for the attach
      // answer, which carries the place just stored, instead of first jumping to the old one (FR-107).
      clearPreviewViewState(panelId);
    },
    [panelId, placeLeft],
  );

  /* ── Copy and Select All (FR-035, FR-035a – FR-035c) ─────────────────────────────────────────── */

  // Read through a ref by the copy gesture, so the format is the setting as it is when the reader copies.
  const copyFormatRef = useRef<PreviewCopyFormat>(settings.editor.previews.copyFormat);
  copyFormatRef.current = settings.editor.previews.copyFormat;
  /** 044 FR-122 — scroll sync as this window holds it NOW, for a menu row chosen after the render that built it. */
  const syncScrollRef = useRef<boolean>(settings.editor.previews.syncScroll);
  syncScrollRef.current = settings.editor.previews.syncScroll;
  const exportHtml = view?.exportHtml?.bind(view);

  const copySelection = useCallback(
    (captured: CapturedSelection | null, format: PreviewCopyFormat): void => {
      if (captured === null) return;
      void copyCapturedSelection(captured, format, window.throng?.clipboard, exportHtml);
    },
    [exportHtml],
  );

  const selectAll = useCallback((): void => {
    const host = bodyHostRef.current;
    if (host === null) return;
    // Focus FIRST: moving focus into the host collapses a selection made before it (observed in jsdom, and
    // the order is harmless in Chromium), so the keyboard lands in the body and the selection survives.
    host.focus({ preventScroll: true });
    selectAllIn(host);
  }, []);

  /* ── The body menu (FR-015b, FR-035, FR-095, FR-096d) ────────────────────────────────────────── */

  const { openMenu } = useContextMenu();
  const keybindings = useKeybindings();
  const textSelection = view?.textSelection ?? false;
  const providerKind =
    (state ? registry.get(state.providerId) : undefined)?.kind ?? registry.forPath(mountFile.current)?.kind ?? 'text';
  const parented = state?.parent != null;

  /*
   * FR-113, FR-114, FR-121 — two-way scroll sync. The parent editor's top line, from the store its view in
   * THIS window publishes to; nothing when the setting is off, the preview is standalone, or the provider has
   * no source lines. Subscribed to the parent's panel id as main names it on each update, so a re-parent
   * follows the new editor. The other direction is a REQUEST to that editor's view here
   * (`requestEditorTopLine`), never a write into the store; a sync scroll records no history (FR-101).
   */
  const parentId = state?.parent?.panelId ?? null;
  const syncing = settings.editor.previews.syncScroll && providerKind === 'text' && parentId !== null;
  const parentTop = useEditorTopLine(syncing ? parentId : null);
  const parentDocLines = useEditorDocLines(syncing ? parentId : null);
  const syncingRef = useRef(syncing);
  syncingRef.current = syncing;

  /** FR-121h — the body's way to read the line of the block at its top, for adoption. */
  const readTopLine = useRef<(() => number | null) | null>(null);
  const onTopLineRead = useCallback((read: () => number | null): void => {
    readTopLine.current = read;
  }, []);

  /*
   * FR-121h — where a pair starts, decided from what changed since the last update this view saw
   * (`pairStart`). Derived during render (React's "state from previous props" pattern), because the body must
   * not be handed the adopted editor's line even once: it would follow it. An ADOPTION — a drawn standalone
   * preview gaining an editor, the navigation count standing still — asks the new editor to come to the
   * preview's top block, and follows none of that editor's lines until it has arrived (an echo, or the line
   * asked for); a request made before the editor's view exists here is made again when it publishes.
   */
  const navigationSeq = state?.navigationSeq;
  const [pair, setPair] = useState<PairState>(NO_PAIR);
  if (state !== undefined && (!pair.seen || pair.parent !== parentId || pair.navigationSeq !== navigationSeq)) {
    const start = pairStart({
      firstUpdate: !pair.seen,
      drawn: drawnFile.current !== null,
      parentBefore: pair.parent,
      parentNow: parentId,
      navigationSeqBefore: pair.navigationSeq,
      navigationSeqNow: navigationSeq,
    });
    const adopting = start === 'preview' && syncing && pair.parent === null && pair.navigationSeq === navigationSeq;
    const target = adopting ? (readTopLine.current?.() ?? null) : null;
    setPair({
      seen: true,
      parent: parentId,
      navigationSeq,
      adopt: parentId !== null && target !== null ? { editor: parentId, target, requested: false } : null,
    });
  }
  const adopt = syncing && pair.adopt?.editor === parentId ? pair.adopt : null;
  useEffect(() => {
    if (pair.adopt === null) return;
    const a = pair.adopt;
    const settle = (next: Adoption | null): void => setPair((p) => (p.adopt === a ? { ...p, adopt: next } : p));
    if (!syncing || a.editor !== parentId) {
      settle(null);
      return;
    }
    if (!a.requested) {
      if (requestEditorTopLine(a.editor, a.target)) settle({ ...a, requested: true });
      // The editor's line is known here but no view of it answers (FR-121a): there is nothing to place, and
      // its line is followed as any parent's is.
      else if (parentTop !== null) settle(null);
      return;
    }
    if (parentTop !== null && (parentTop.fromSync || parentTop.line === a.target)) settle(null);
  }, [pair.adopt, parentTop, syncing, parentId]);

  /*
   * U2 (analysis) — the editor publishes its line one frame after an edit, while this preview draws the
   * edited text only after its update delay. While the text drawn here has a different number of lines from
   * the editor's document, its `data-source-line`s number the OLD text: the editor's line is held at the
   * last one handed down, and nothing is requested, until the draw catches up.
   */
  /*
   * Refs here are READ during render and WRITTEN only after commit or in callbacks, so a double render
   * (StrictMode) decides the same thing twice.
   *
   * - `lastPassed` — the line handed to the body at the last commit: what a hold keeps.
   * - `reportDropped` — the reader scrolled while behind, and the request was dropped. The line released at
   *   catch-up is then only the edit's renumbering of where the editor already was, so it is handed down as
   *   an echo: recorded, not scrolled to, and the reader's kept place drives the editor instead.
   * - `echoFor` — the released value that is to be read as an echo for as long as it stands.
   */
  const lastPassed = useRef<{ parent: string; value: EditorTopLine } | null>(null);
  const reportDropped = useRef(false);
  const echoFor = useRef<EditorTopLine | null>(null);
  const live: EditorTopLine | null = syncing && adopt === null ? parentTop : null;
  const behind = live !== null && isBehind(drawnSeen, state, parentDocLines);
  const held = behind && lastPassed.current !== null && lastPassed.current.parent === parentId ? lastPassed.current.value : null;
  const follow = held ?? live;
  const releasing = live !== null && !behind && reportDropped.current && lastPassed.current?.value !== live;
  const syncLine = follow?.line ?? null;
  const syncEcho = follow !== null && (follow.fromSync || releasing || follow === echoFor.current);
  useEffect(() => {
    lastPassed.current = follow === null || parentId === null ? null : { parent: parentId, value: follow };
    if (releasing) echoFor.current = follow;
    if (!behind) reportDropped.current = false;
  });

  /**
   * FR-121, FR-121a — the body's top block moved: ask the parent editor's view in this window to follow.
   *
   * Answers `false` — "report again once `syncLine` changes" — when the body compared its block with a line
   * that is not the editor's latest: while the drawn text is behind (U2), or when the editor has published a
   * line this chrome has not yet handed down (a draw's report can run before the render that releases it).
   */
  const onTopLineChange = useCallback((line: number): boolean => {
    const current = stateRef.current;
    const editor = current?.parent?.panelId;
    if (!syncingRef.current || editor === undefined) return true;
    if (isBehind(drawnLines.current, current, editorDocLinesOf(editor))) {
      reportDropped.current = true;
      return false;
    }
    const passed = lastPassed.current;
    if (passed === null || passed.parent !== editor || passed.value !== editorTopLineOf(editor)) return false;
    requestEditorTopLine(editor, line);
    return true;
  }, []);

  /** FR-121e, FR-121h — how the body treats the place the store holds (data-model §15.2). */
  const placePolicy: PreviewBodyProps['placePolicy'] =
    state?.viewState === undefined
      ? 'restore'
      : state.viewStateSource === 'attach'
        ? syncing
          ? 'editorLine'
          : 'restore'
        : 'editorLineIfTop';

  /**
   * 044 FR-122 — Synchronise Scrolling, shared by the body menu's row and the status bar's toggle: the one
   * command body, flipping the value this window holds at the moment it is chosen.
   */
  const onToggleSyncScroll = useCallback((): void => {
    void toggleSyncScroll(syncScrollRef.current);
  }, []);

  /**
   * The whole menu, for a right-click over `link` or over plain text. The selection is captured NOW: a
   * menu row that copies copies what was selected when the menu opened, whatever pressing the row does to
   * the live selection.
   */
  const openBodyMenu = useCallback(
    (link: PreviewLink | null, point: { x: number; y: number }): void => {
      const host = bodyHostRef.current;
      const captured = host === null ? null : captureSelection(host);
      const content: PreviewContentSection | null = textSelection
        ? {
            copyFormat: copyFormatRef.current,
            copy: (format) => copySelection(captured, format),
            selectAll,
          }
        : null;
      const editorRoute: PreviewEditorRouteItem | null =
        providerKind === 'text' && onEditorRoute !== undefined ? { parented, run: onEditorRoute } : null;
      const items = previewContentMenu({
        link,
        selectionEmpty: captured === null,
        followChord: firstBinding(keybindings, 'preview.followLink'),
        actions: {
          openLink: onFollow,
          // FR-116 — a same-document heading copies THIS panel's file, read when the row is chosen.
          copyLinkAddress: (l) =>
            void window.throng?.clipboard?.write({
              text: linkAddress(l, stateRef.current?.filePath ?? mountFile.current),
              mode: 'verbatim',
            }),
        },
        content,
        editorRoute,
        // FR-122a/b — every text-provider preview, whatever is under the pointer; never a binary one.
        syncScroll:
          providerKind === 'text'
            ? {
                on: syncScrollRef.current,
                toggle: onToggleSyncScroll,
                chord: firstBinding(keybindings, 'preview.toggleSyncScroll'),
              }
            : null,
      });
      if (items.length > 0) openMenu(point.x, point.y, items);
    },
    [textSelection, copySelection, selectAll, providerKind, onEditorRoute, parented, keybindings, onFollow, openMenu, onToggleSyncScroll],
  );

  /** The body's own report: the reader asked for a LINK's menu, with nothing selected (FR-095). */
  const onLinkMenu = useCallback(
    (link: PreviewLink, point: { x: number; y: number }): void => openBodyMenu(link, point),
    [openBodyMenu],
  );

  /** A right-click anywhere else in the body — the body leaves every event but a link's to the chrome. */
  const onHostContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      e.preventDefault();
      openBodyMenu(null, { x: e.clientX, y: e.clientY });
    },
    [openBodyMenu],
  );

  /* ── Read-only (FR-020) ──────────────────────────────────────────────────────────────────────── */

  /**
   * The platform copy gesture: routed through the setting, never the browser's own copy (FR-035b).
   *
   * Listened for on the panel ROOT, not the body (US3 review): a selection that starts in the link notice
   * or a banner above the body and is dragged into the document fires `copy` at its start, outside the
   * body — and the browser's own copy would then carry the body's `data-throng-link` (absolute project
   * paths), `class` and `throng-preview:` addresses. Any selection reaching into the body is copied from
   * the body alone, through the export profile. One wholly outside it (a notice's own words) is not the
   * document's, and is left to the browser.
   *
   * The test is whether the selection reaches into the body AT ALL, not whether it has text: a selection of
   * an image alone has none, and the browser's copy of it would carry the same addresses (adversarial
   * review M1).
   */
  const onRootCopy = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>): void => {
      const host = bodyHostRef.current;
      if (host === null || selectionRangeIn(host) === null) return;
      e.preventDefault();
      copySelection(captureSelection(host), copyFormatRef.current);
    },
    [copySelection],
  );

  /** Paste and cut change a document; a preview has none to change. */
  const refuse = useCallback((e: ReactClipboardEvent<HTMLDivElement> | ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Ctrl+A selects the body, not the window. */
  const onHostKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (!textSelection) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      }
    },
    [textSelection, selectAll],
  );

  // What the window's key handler and main's `focus` reach this panel through (FR-096c, FR-090c).
  useEffect(
    () =>
      registerPreviewPanelHandles(panelId, {
        followFocusedLink: () => {
          const host = bodyHostRef.current;
          const active = host?.ownerDocument.activeElement ?? null;
          const link = active !== null && host?.contains(active) ? linkOf(active) : null;
          if (link === null) return false;
          onFollow(link);
          return true;
        },
        revealFragment: (fragment) => {
          const current = stateRef.current;
          if (current) revealFragmentIn(current.filePath, fragment);
        },
        navigateHistory: onHistoryStep,
      }),
    [panelId, onFollow, revealFragmentIn, onHistoryStep],
  );

  // FR-034 — this panel's own zoom, published for `preview.css` to multiply the body text with.
  const zoomStyle = {
    ['--throng-zoom-preview']: String(zoomFactor(panelZoomLevel(panel))),
  } as CSSProperties;

  const Body = body !== null && view !== undefined && body.id === view.id ? body.Body : null;

  /* ── The file notice (FR-026, FR-027; T110, T111) ────────────────────────────────────────────── */

  /** Try again on a file notice is Refresh (FR-028): main re-reads the source now. */
  const refreshForNotice = useCallback(async (): Promise<boolean> => {
    if (!(await refreshPreviewPanel(panelId))) return false;
    return !isFileNotice(getPreviewState(panelId)?.notice);
  }, [panelId]);

  /*
   * One banner slot, ranked by `shownPreviewFailure` — the ranking the header's menu reads too, so its
   * Try again, Copy details and Clear panel type always describe the banner actually on screen.
   */
  const shown = shownPreviewFailure(state, failure);
  const fileNotice = state !== undefined && isFileNotice(state.notice) ? state.notice : null;
  const bodyCovered = fileNotice !== null;
  bodyCoveredRef.current = bodyCovered;

  /*
   * US2 scenario 6 — while the file cannot be shown, the notice and nothing else. The body is COVERED
   * (`visibility: hidden` and `inert`), not taken out of layout: `display: none` resets a scroll offset in
   * Chromium, and a file that vanishes for a moment (a checkout, a delete-and-rename save) must come back
   * where the reader was (FR-024). `inert` keeps it out of focus, selection and the accessibility tree;
   * set imperatively because React 18 has no `inert` prop.
   */
  useLayoutEffect(() => {
    const host = bodyHostRef.current;
    if (host === null) return;
    if (bodyCovered) host.setAttribute('inert', '');
    else host.removeAttribute('inert');
  }, [bodyCovered]);

  return (
    <div
      className="preview-panel"
      data-testid={`preview-${panelId}`}
      style={zoomStyle}
      ref={panelRootRef}
      onCopy={onRootCopy}
    >
      {shown?.source === 'notice' && state ? (
        <PreviewFileNotice
          panelId={panelId}
          notice={shown.notice}
          revision={state.revision}
          filePath={state.filePath}
          subject={panelSubject(place)}
          onRetry={refreshForNotice}
          onClearType={onClearType}
          onClose={onClose}
        />
      ) : shown?.source === 'failure' ? (
        <PanelFailureBanner
          panelId={panelId}
          headline={shown.failure.headline}
          subject={panelSubject(place)}
          detail={shown.failure.detail}
          // The cause goes to the diagnostics log, never to a notification, so the pointer names none.
          notified={false}
          onRetry={shown.failure.kind === 'attach' ? retryAttach : retryBody}
          onCancel={onClearType}
        />
      ) : null}
      <div
        className="preview-panel__body"
        data-testid={`preview-body-${panelId}`}
        ref={bodyHostRef}
        tabIndex={-1}
        // Covered, not hidden — see the note on the `inert` effect above.
        style={bodyCovered ? { visibility: 'hidden' } : undefined}
        onContextMenu={onHostContextMenu}
        onCut={refuse}
        onPaste={refuse}
        onDrop={refuse}
        onKeyDown={onHostKeyDown}
      >
        {Body !== null && state?.content ? (
          <Body
            key={bodyGeneration}
            panelId={panelId}
            content={state.content}
            filePath={state.filePath}
            projectRoot={projectRoot ?? ''}
            providerSettings={settings.editor.previews.providers[state.providerId] ?? NO_PROVIDER_SETTINGS}
            initialViewState={state.viewState}
            navigationSeq={state.navigationSeq}
            syncLine={syncLine}
            syncEcho={syncEcho}
            onTopLineChange={onTopLineChange}
            onTopLineRead={onTopLineRead}
            placePolicy={placePolicy}
            onViewStateCapture={onViewStateCapture}
            onFollow={onFollow}
            onNotice={onNotice}
            onLinkMenu={onLinkMenu}
            onLinkTarget={onLinkTarget}
            onDrawn={onDrawn}
            onBodyFailure={onBodyFailure}
          />
        ) : null}
      </div>
      {/* FR-015a — the editor's bar, under the editor's setting; FR-015e — none for a binary provider. FR-118 —
          its one readout, the hovered or focused link's target, is shown only while the bar is. */}
      {settings.editor.showStatusBar && onEditorRoute !== undefined ? (
        <PreviewStatusBar
          panelId={panelId}
          providerKind={providerKind}
          parented={parented}
          onEditorRoute={onEditorRoute}
          syncScroll={settings.editor.previews.syncScroll}
          onToggleSyncScroll={onToggleSyncScroll}
          readout={linkReadout}
        />
      ) : null}
    </div>
  );
}
