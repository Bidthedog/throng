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
 * sentence); `focusedOther` changes nothing (FR-090c); `openedInEditor` goes down the File Explorer open
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
  useMemo,
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
  collapseAll as foldCollapseAll,
  defaultOpenActionFor,
  enabledProviderFor,
  expandAll as foldExpandAll,
  firstBinding,
  initialFold,
  isCollapsed,
  normaliseForCompare,
  noticeLogRecord,
  panelZoomLevel,
  parseChordStrokes,
  previewPathOf,
  samePath,
  setSection,
  toDisplayPath,
  toggleAll as foldToggleAll,
  visibleSections,
  zoomFactor,
  type DocumentSymbol,
  type FoldState,
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
import { useWorkspace } from '../state/workspace-store.js';
import { openFileInTab } from '../editor/editor-open.js';
import { positionRevealTarget } from '../editor/reveal-range.js';
import { linkFailureReport, osLinkActions, type LinkActionDeps } from '../links/link-actions.js';
import { useReportSubjectFailure } from '../workspace/panel-failure-notice.js';
import { findHeading, linkOf } from './link-dom.js';
import { previewContentMenu, type PreviewContentMenuArgs, type PreviewContentSection, type PreviewEditorRouteItem } from './content-menu.js';
import { openPreviewLinkMenu } from './preview-link-menu.js';
import { focusLocalPanel, requestPreviewOpen } from './open-preview.js';
import { FindBar } from '../search/find-bar.js';
import { attachPanelSearch, closeFind, getFindSession, openFind, updateCount } from '../search/search-store.js';
import { unregisterPanelSearch } from '../search/search-controller.js';
import { clearPanel } from './highlight-registry.js';
import { createPreviewOccurrences, type PreviewOccurrences } from './preview-occurrences.js';
import { createPreviewSelection, type PreviewSelection } from './preview-selection.js';
import { createModelCache } from './preview-selection-model.js';
import { createCssHighlightPainter, createDomFramePainter, createPreviewSearchController } from './preview-search.js';
import { recordLastActivePreview } from './last-active-preview.js';
import { HeadingOutline } from './heading-outline.js';
import { flattenHeadings, currentHeadingSlug, type HeadingPosition } from './heading-outline-model.js';
import { sectionAtPoint } from './fold-menu-section.js';
import { ChordEngine, strokeLabel, type ChordEngineHost } from '../keybindings/chord-engine.js';
import { setPendingChord, clearPendingChord } from '../editor/pending-chord.js';
import { tweenScrollTop } from './scroll-tween.js';
import { PanelDropTarget, type DropContext } from '../editor/drop-target.js';
import { TreeDropTarget } from '../editor/tree-drop-target.js';
import { getTreeDrag } from '../explorer/tree-drag-store.js';
import { wordWrapDocKey } from '../editor/word-wrap-store.js';
import {
  applyFoldStateFromSync,
  relayedKeyMatches,
  setDocumentFoldState,
  useDocumentFoldState,
} from '../editor/fold-state-store.js';
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
import { isFileNotice, isMovedOutNotice, PreviewFileNotice, shownPreviewFailure } from './preview-notice.js';
import { MovedOutNotice } from '../editor/moved-out-notice.js';
import {
  applyPreviewUpdate,
  clearPreviewViewState,
  getPreviewFailure,
  keepDetachedViewState,
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
import './match-frames.css';

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

/*
 * 047 US3 (T049, FR-037, FR-038, contracts "Commands") — the `markdown.*` fold chords, hosted on this
 * panel's own body host rather than window-level (`preview-commands.tsx`): the SAME `ChordEngine`
 * `editor/commands.ts`'s `multiStrokeChords` hosts per CodeMirror view (Principle VIII), but matched
 * here with a plain lookup trie instead of CodeMirror's `runScopeHandlers` — a preview panel has no
 * CodeMirror scopes underneath it. Attaching the engine directly to the panel that received the keydown
 * is what makes "act on ... a FOCUSED preview's view" (FR-037) true without a separate scope
 * resolution: only the panel a keydown actually reaches can ever match one of these chords.
 */
const MARKDOWN_FOLD_ACTIONS = [
  'markdown.toggleSection',
  'markdown.toggleAll',
  'markdown.collapseSection',
  'markdown.expandSection',
  'markdown.collapseAll',
  'markdown.expandAll',
] as const;
type MarkdownFoldActionId = (typeof MARKDOWN_FOLD_ACTIONS)[number];

/** A node in the stroke trie: either another prefix to extend, or the action its last stroke completes. */
type ChordTrieNode = { readonly action: MarkdownFoldActionId } | { readonly children: Map<string, ChordTrieNode> };

const isChordLeaf = (node: ChordTrieNode): node is { readonly action: MarkdownFoldActionId } => 'action' in node;

/** Every bound chord for the six `markdown.*` fold actions, read into one lookup trie. */
function buildMarkdownFoldChordTrie(bindings: Readonly<Record<string, readonly string[]>>): Map<string, ChordTrieNode> {
  const root = new Map<string, ChordTrieNode>();
  for (const action of MARKDOWN_FOLD_ACTIONS) {
    for (const token of bindings[action] ?? []) {
      const strokes = parseChordStrokes(token);
      if (!strokes || strokes.length === 0) continue;
      let level = root;
      strokes.forEach((stroke, i) => {
        if (i === strokes.length - 1) {
          level.set(stroke, { action });
          return;
        }
        const existing = level.get(stroke);
        const next = existing && !isChordLeaf(existing) ? existing.children : new Map<string, ChordTrieNode>();
        level.set(stroke, { children: next });
        level = next;
      });
    }
  }
  return root;
}

/** One step of the trie walk: the strokes typed so far, and where to look for the next one. */
interface ChordPrefix {
  readonly children: Map<string, ChordTrieNode>;
  readonly physical: readonly string[];
}

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
  /**
   * 047 US5 (T057/T058, contracts/preview-ipc-047.md §4) — the SAME confinement context
   * `panel-body.tsx` already builds for the editor and the untyped panel; a preview's drop is judged
   * against exactly the same facts (main's `resolveDrop`, unchanged, FR-022).
   */
  dropCtx: DropContext;
}

export function PreviewPanel({
  panel,
  projectRoot,
  onRefused,
  onClearType,
  onClose,
  onEditorRoute,
  dropCtx,
}: PreviewPanelProps): ReactElement {
  const panelId = panel.id;
  const state = usePreviewState(panelId);
  const failure = usePreviewFailure(panelId);
  const { views, registry } = usePreviewProviders();
  const settings = useAppSettings();
  const keybindings = useKeybindings();
  const place = usePanelPlace(panelId);
  const placeRef = useRef(place);
  placeRef.current = place;
  const os = window.throng?.osName ?? 'windows';
  const ws = useWorkspace();
  const reportSubject = useReportSubjectFailure();

  // The persisted fields as they were when this view mounted. The run, not the layout, is the authority
  // from then on (contracts/preview-ipc.md §1 "which persisted field wins"); re-attaching on every
  // config write would re-attach on every mirror write main itself caused.
  const config = panel.config as PreviewPanelConfig | undefined;
  const mountFile = useRef(config?.filePath ?? previewPathOf(config) ?? '');
  const mountHistory = useRef(config?.history);
  /**
   * 050 FR-035 (R19) — a move took the file out of this project and the layout says so: the panel shows the
   * moved notice and reads nothing. Read live for the notice, and through a ref where the mount effect
   * decides whether to attach (a config write must not re-attach — see above).
   */
  const heldMovedOut = config?.movedOut === true;
  const heldMovedOutRef = useRef(heldMovedOut);
  heldMovedOutRef.current = heldMovedOut;
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
    // A panel mounted MOVED OUT holds no file it may read: no attach, so main never reads or watches the
    // path and nothing can report it unreadable (050 FR-035). It still hears updates, for the way back.
    if (!heldMovedOutRef.current) {
      void attach().then((result) => {
        if (active) settleAttach(result);
      });
    }
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe?.();
      bridge?.detach(panelId);
      // A failure describes THIS view's attempt; the next mount makes its own and reports its own.
      setPreviewFailure(panelId, null);
    };
  }, [panelId, attach, settleAttach]);

  /*
   * The way back (050 FR-035): the flag a layout carried goes — an undo or redo brought the file back into
   * the project — so this panel, which mounted without attaching, attaches now at the path the layout holds.
   * Only a mounted panel's flag going true → false does it: a live run that moved out and back keeps its
   * attachment, and a config write that leaves the flag alone never re-attaches.
   */
  const wasMovedOut = useRef(heldMovedOut);
  useEffect(() => {
    const was = wasMovedOut.current;
    wasMovedOut.current = heldMovedOut;
    if (!was || heldMovedOut) return;
    mountFile.current = config?.filePath ?? previewPathOf(config) ?? mountFile.current;
    void attach().then((result) => {
      if (mounted.current) settleAttach(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldMovedOut]);

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
  /** 050 R26 — the moved notice is up: every route to the linked editor is unavailable. */
  const movedOutRef = useRef(false);
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

  /* ── Find (047 US1, research R1) ──────────────────────────────────────────────────────────────── */

  /**
   * FR-040 (T050) — reveal the section containing the current match's node before it is scrolled to. A
   * ref so the controller (created once, below) always calls the LATEST implementation without being
   * recreated itself (the `onRefused` ref pattern above); reassigned every render, once `foldState` and
   * the body's own `reveal` are in scope, near the rest of the fold wiring.
   */
  const revealBeforeScrollRef = useRef<(node: Node) => boolean | void>(() => false);
  /** Reassigned once `scrollToHeading` exists, below — declared here so the reveal effect (which runs
   *  before `scrollToHeading`'s own declaration in source order) can call the LATEST version of it. */
  const scrollToHeadingRef = useRef<(fragment: string, animateMs?: number) => boolean>(() => false);
  const searchControllerRef = useRef<ReturnType<typeof createPreviewSearchController> | null>(null);
  /**
   * 047 FR-074 (R16) — the match-frame layer: a sibling of the body, never inside it, so what the sanitiser
   * produced, what copy reads and what find's text model walks are all untouched by the outlines it draws.
   */
  const matchFrameLayerRef = useRef<HTMLDivElement | null>(null);
  /**
   * 049 US4 (#324) — the occurrence tint of this panel's own selection (`preview-occurrences.ts`), governed by
   * `editor.highlightOccurrences` (read at frame time, so a toggle needs no remount — FR-019).
   */
  const occurrencesRef = useRef<PreviewOccurrences | null>(null);
  /** 049 US5 (#457) — the selection this body keeps while it is not focused (`preview-selection.ts`). */
  const selectionRef = useRef<PreviewSelection | null>(null);
  const highlightOccurrencesRef = useRef(settings.editor.highlightOccurrences);
  highlightOccurrencesRef.current = settings.editor.highlightOccurrences;
  useEffect(() => {
    occurrencesRef.current?.schedule();
  }, [settings.editor.highlightOccurrences]);
  useEffect(() => {
    const controller = createPreviewSearchController({
      host: () => bodyHostRef.current,
      painter: createCssHighlightPainter(panelId),
      frames: createDomFramePainter(() => matchFrameLayerRef.current),
      revealBeforeScroll: (node) => revealBeforeScrollRef.current(node),
      // A find match is painted as one and carries no occurrence tint (FR-013): re-evaluate whenever it changes.
      onPaint: () => occurrencesRef.current?.schedule(),
    });
    // One text model per draw, walked once for both controllers that map the DOM selection onto it.
    const models = createModelCache(() => bodyHostRef.current);
    const retainedSelection = createPreviewSelection({ host: () => bodyHostRef.current, panelId, modelCache: models });
    const occurrences = createPreviewOccurrences({
      host: () => bodyHostRef.current,
      panelId,
      modelCache: models,
      // Its occurrences follow a selection the body holds while unfocused, at inactive strength (FR-018a).
      retained: () => retainedSelection.retained(),
      enabled: () => highlightOccurrencesRef.current,
      searchMatches: () => controller.matchRanges(),
      isFocused: () => {
        const host = bodyHostRef.current;
        return host !== null && host.contains(host.ownerDocument.activeElement);
      },
    });
    occurrencesRef.current = occurrences;
    selectionRef.current = retainedSelection;
    searchControllerRef.current = controller;
    attachPanelSearch(panelId, controller);
    // 049 FR-029 — the frames live in the scrolling body and move with their text, so a scroll repaints nothing
    // (`scrolled()` only notices the viewport leaving the band the frames were drawn for). They are redrawn on
    // any resize of the body (the panel, the zoom), through the controller's one requestAnimationFrame; a redraw
    // or a fold repaints through `refresh()` / `repaintFrames()`.
    const body = bodyHostRef.current;
    const repaint = (): void => controller.repaintFrames();
    const scrolled = (): void => controller.scrolled();
    body?.addEventListener('scroll', scrolled, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repaint);
    if (body) observer?.observe(body);
    return () => {
      body?.removeEventListener('scroll', scrolled);
      observer?.disconnect();
      searchControllerRef.current = null;
      occurrences.dispose();
      occurrencesRef.current = null;
      retainedSelection.dispose();
      selectionRef.current = null;
      unregisterPanelSearch(panelId);
      clearPanel(panelId);
    };
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

  /*
   * MT-02 (review, 2026-09-28) — a NAVIGATION onto another file (a Last Active open, a followed link, a
   * history step) closes this panel's find bar and discards its query: the search was for the file that
   * left. A live update or a rename of the same run moves no `navigationSeq` and keeps it (FR-005).
   */
  const shownNavigation = state?.navigationSeq;
  const findFileRef = useRef<{ file: string | undefined; seq: number | undefined }>({ file: shownFile, seq: shownNavigation });
  useEffect(() => {
    const before = findFileRef.current;
    findFileRef.current = { file: shownFile, seq: shownNavigation };
    if (before.file === undefined || shownFile === undefined || before.seq === shownNavigation) return;
    if (samePath(before.file, shownFile)) return;
    if (getFindSession(panelId)) closeFind(panelId);
  }, [panelId, shownFile, shownNavigation]);

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
  /**
   * `animateMs`, given, tweens over that many ms (047 US4, research R7 — the Go to Heading pop-down's
   * own jump, `providers.markdown.headingJumpMs`); omitted (every OTHER caller: a followed
   * same-document heading link, `revealFragmentIn`) sets `scrollTop` once, synchronously, exactly as
   * before this feature existed. Two behaviours on one function rather than a second copy of the
   * heading-finding half.
   */
  /** The fold state as of the last render — read by `scrollToHeading`, which is memoised above it. */
  const foldStateRef = useRef<FoldState>(initialFold('expanded'));
  const scrollToHeading = useCallback(
    (fragment: string, animateMs?: number, expandTarget = false): boolean => {
      const host = bodyHostRef.current;
      const heading = host ? findHeading(host, fragment) : null;
      if (host && heading) {
        // FR-040 (T050) — the heading is inside a collapsed section: reveal it (and its ancestors)
        // first, then finish the scroll once the reveal's `useEffect` sees the DOM reflect it. A
        // heading with no `reveal` registered (no headings reported yet, or not a foldable provider)
        // falls through unchanged — measuring a `hidden` element's zero rect, exactly as before FR-040.
        // `expandTarget` (Go to Heading, maintainer review 2026-09-28): a heading picked from the
        // pop-down is opened too when its OWN section is collapsed.
        //
        // The reveal is keyed by the heading's SLUG, read off the element. The fragment is not one: Go
        // to Heading passes the heading's name ("Three"), which names no section, so the reveal
        // changed nothing and the deferred scroll never ran.
        const slug = heading.getAttribute('data-heading-slug');
        const needsReveal = heading.hidden || (expandTarget && slug !== null && isCollapsed(foldStateRef.current, slug));
        if (needsReveal && slug !== null && revealRef.current) {
          pendingReveal.current = { kind: 'heading', fragment, animateMs };
          revealRef.current(slug);
          clearLinkNotice();
          return true;
        }
        // The heading to the top of THIS body host — host-relative arithmetic, as `open-preview.ts` does,
        // rather than `scrollIntoView`, which would also scroll every scrollable ancestor of the panel.
        const delta = heading.getBoundingClientRect().top - host.getBoundingClientRect().top;
        if (animateMs !== undefined) tweenScrollTop(host, host.scrollTop + delta, animateMs);
        else host.scrollTop += delta;
        // The link was followed: a notice about an earlier one no longer describes anything (item 13).
        clearLinkNotice();
        return true;
      }
      raiseLinkNotice({ kind: 'link-missing-heading', target: fragment });
      return false;
    },
    [raiseLinkNotice, clearLinkNotice],
  );
  scrollToHeadingRef.current = scrollToHeading;

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
    (filePath: string, fragment: string, animateMs?: number, expandTarget = false): void => {
      const leavingViewState = placeLeft() ?? TOP_OF_DOCUMENT;
      if (!scrollToHeading(fragment, animateMs, expandTarget)) return;
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

  /* ── Go to Heading (047 US4, research R7) ────────────────────────────────────────────────────── */

  /** This render's heading tree (`PreviewBodyProps.onHeadings`), for the pop-down and `onJump`. */
  const [headings, setHeadings] = useState<readonly DocumentSymbol[]>([]);
  /**
   * The drawn document's headings as the body last REPORTED them — written here, at the report, and not from
   * the state on this chrome's next render. The body reports in the same task as it inserts the document, and
   * the state only lands a render later: a menu opened over text already on screen in between read no
   * headings, and offered its fold rows disabled or not at all (the `preview-fold-menu` flake, 048). Never
   * assigned from `headings` at render either, where a render that has not yet taken the update would write
   * the older list back over the newer one.
   */
  const headingsRef = useRef<readonly DocumentSymbol[]>(headings);
  const onHeadings = useCallback((symbols: readonly DocumentSymbol[]): void => {
    headingsRef.current = symbols;
    setHeadings(symbols);
  }, []);

  const [headingOutlineOpen, setHeadingOutlineOpen] = useState(false);
  /** Sampled once, when the pop-down opens (R7) — never recomputed while it is up. */
  const [headingOutlineCurrentSlug, setHeadingOutlineCurrentSlug] = useState<string | null>(null);

  /** The heading whose section holds the block at the top of the view right now, or `null`. */
  const computeCurrentHeadingSlug = useCallback((): string | null => {
    const host = bodyHostRef.current;
    if (!host) return null;
    const hostTop = host.getBoundingClientRect().top;
    const positions: HeadingPosition[] = [...host.querySelectorAll<HTMLElement>('[data-heading-slug]')].map((el) => ({
      slug: el.getAttribute('data-heading-slug') ?? '',
      top: el.getBoundingClientRect().top - hostTop,
    }));
    return currentHeadingSlug(positions, 0);
  }, []);

  const openHeadingOutlineHandler = useCallback((): void => {
    setHeadingOutlineCurrentSlug(computeCurrentHeadingSlug());
    setHeadingOutlineOpen(true);
  }, [computeCurrentHeadingSlug]);

  const onHeadingOutlineClose = useCallback((): void => {
    setHeadingOutlineOpen(false);
    bodyHostRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * The reader picked a heading in the pop-down: reuse the SAME jump `onFollow`'s heading case uses
   * (`jumpToHeading` — records history exactly as a followed same-document heading link, 044 FR-115).
   *
   * FR-040: a target inside a collapsed section is revealed first, and the target's own section is
   * opened too (`expandTarget`) — picking a heading means wanting to read it.
   */
  const onHeadingOutlineJump = useCallback(
    (slug: string): void => {
      const symbol = flattenHeadings(headingsRef.current).find((f) => f.symbol.slug === slug)?.symbol;
      const current = stateRef.current;
      if (!symbol || !current) return;
      const rawDuration = settings.editor.previews.providers.markdown?.headingJumpMs;
      jumpToHeading(current.filePath, symbol.name, typeof rawDuration === 'number' ? rawDuration : 0, true);
    },
    [jumpToHeading, settings],
  );

  /* ── Fold state (047 US3, research R3, Principle XI) ─────────────────────────────────────────────
   *
   * THE PANEL NEVER HOLDS ITS OWN FOLD STATE. It reads and writes through `fold-state-store.ts` —
   * the SAME per-window cache `use-editor.ts` uses for an editor view — exactly the way it reads and
   * writes word wrap (`wordWrapDocKey`, reused here unchanged for the key rule): a PARENTED preview
   * resolves to `file:<path>`, the SAME key its editor uses, so the two fold together; a STANDALONE
   * preview resolves to `panel:<id>`, its own entry, however many windows view it (R3). The cache is
   * never the authority — main's fold map beside word wrap is — so a toggle here updates the cache
   * optimistically, tells main, and main relays it to every OTHER view on the same key.
   */
  const isFoldableProvider = state?.providerId === 'markdown';
  const foldParented = state?.parent != null;
  const foldDocKey = wordWrapDocKey(foldParented ? (state?.filePath ?? null) : null, panelId);
  const foldSeed = initialFold(settings.editor.markdownSectionsOpen);
  const foldState = useDocumentFoldState(foldDocKey, foldSeed);
  foldStateRef.current = foldState;

  // Seed this key from the authority once, whenever the KEY changes — becoming parented or standalone
  // re-keys (R3), and each key gets its own seed round trip exactly as word wrap's does.
  useEffect(() => {
    if (!isFoldableProvider) return;
    // A bridge with no `foldState` method at all (a test, a torn-down window) is not a rejection to
    // catch — calling `.then` on the `undefined` an optional CALL answers would throw synchronously,
    // which is not "no authority to ask", it is a crash of this effect. The local seed stands either way.
    const foldStateOf = window.throng?.editor?.foldState;
    if (!foldStateOf) return;
    let live = true;
    const key = foldDocKey;
    foldStateOf(panelId, settings.editor.markdownSectionsOpen)
      .then((next) => {
        if (live && next) applyFoldStateFromSync(key, next);
      })
      .catch(() => {
        /* The authority failed to answer (a torn-down window): the local seed stands. */
      });
    return () => {
      live = false;
    };
  }, [isFoldableProvider, foldDocKey, panelId, settings.editor.markdownSectionsOpen]);

  // The relay is carried on `onSync`'s `foldState`, keyed by the DOCUMENT key rather than by
  // `panelId` (contracts/preview-ipc-047.md §5) — one document, however many views, one broadcast.
  useEffect(() => {
    if (!isFoldableProvider) return;
    const off = window.throng?.editor?.onSync?.((msg) => {
      if (msg.foldState && relayedKeyMatches(msg.foldState.key, foldDocKey)) {
        applyFoldStateFromSync(foldDocKey, msg.foldState.state);
      }
    });
    return () => off?.();
  }, [isFoldableProvider, foldDocKey]);

  const onFoldChange = useCallback(
    (next: FoldState): void => {
      setDocumentFoldState(foldDocKey, next, panelId);
    },
    [foldDocKey, panelId],
  );

  /**
   * 047 US3 (T050, FR-040) — the body's own `reveal(slug)`, registered once via `onRevealSection`
   * below: expands `slug`'s section and every collapsed ancestor (core's `revealing`), via the SAME
   * `onFoldChange` a gutter click uses — the panel never re-derives the ancestor walk itself.
   */
  const revealRef = useRef<((slug: string) => void) | null>(null);

  /**
   * A scroll (a followed heading, or a search match) waiting on a reveal it just started: the fold
   * state change reaches the DOM only on the NEXT render, via the body's own effect reacting to the
   * `foldState` prop — so this is finished from the `useEffect` below rather than inline. `MarkdownBody`
   * is a CHILD of this panel, and React fires a child's passive effects before its parent's OWN ones in
   * the same commit, so the body's fold-gutter DOM update has already happened by the time the effect
   * watching `foldState` here runs.
   */
  const pendingReveal = useRef<{ kind: 'heading'; fragment: string; animateMs?: number } | { kind: 'search' } | null>(null);

  revealBeforeScrollRef.current = (node: Node): boolean => {
    if (!isFoldableProvider || !revealRef.current) return false;
    const host = bodyHostRef.current;
    const slug = host ? sectionAtPoint(host, node) : null;
    if (slug === null) return false;
    // 049 #455: "the section's HEADING is shown" is not "its text is" — a section collapsed ITSELF keeps its
    // heading in `visibleSections` and hides its body. Only a section that is shown AND open needs no reveal.
    if (visibleSections(foldState, headingsRef.current).has(slug) && !isCollapsed(foldState, slug)) return false;
    pendingReveal.current = { kind: 'search' };
    revealRef.current(slug);
    return true;
  };

  /**
   * 049 T056 — folding or unfolding a section moves every block below it, and changes no box the frame layer
   * watches: the body's own box is the same size before and after, so neither its scroll nor its resize
   * observer fires. The outlines were left where the text had been — over blank space, or over other text. The
   * body's fold effect (a child, so before this one) has hidden or shown the blocks by now, so a repaint reads
   * the new geometry. Its ranges, unlike the frames, follow the text on their own.
   */
  useEffect(() => {
    searchControllerRef.current?.repaintFrames();
  }, [foldState]);

  useEffect(() => {
    const pending = pendingReveal.current;
    if (!pending) return;
    pendingReveal.current = null;
    if (pending.kind === 'search') {
      // The match is re-located from its text offset against the body as it is NOW: the redraw the fold
      // change caused may have replaced the node the reveal started from (049 R4).
      searchControllerRef.current?.scrollToCurrent();
    } else {
      // Re-run the whole check: if the target is STILL hidden (an edge case — another fold change
      // landed first), this defers again rather than scrolling to a hidden element's zero rect.
      scrollToHeadingRef.current(pending.fragment, pending.animateMs);
    }
    // Deliberately keyed on `foldState` alone (both refs are refs, correctly omitted): a pending
    // reveal is finished once the fold state that unblocks it has reached this render.
  }, [foldState]);

  /**
   * 047 US3 (T048, FR-036, FR-038, contracts "Preview body menu" / "Status bar") — the fold rows and
   * the status-bar toggle, both built from the SAME `foldState`/`onFoldChange`/`headingsRef` this
   * panel already holds (never a second original, Principle XI).
   */
  const foldMenuChords = useMemo(
    () => ({
      collapseSection: firstBinding(keybindings, 'markdown.collapseSection'),
      expandSection: firstBinding(keybindings, 'markdown.expandSection'),
      collapseAll: firstBinding(keybindings, 'markdown.collapseAll'),
      expandAll: firstBinding(keybindings, 'markdown.expandAll'),
    }),
    [keybindings],
  );

  /**
   * `target` is the DOM node the body menu opened AT (the real contextmenu event's own `e.target`);
   * `null` when the caller has none (the Link-menu path, whose event carries a synthetic point with
   * no useful DOM target) — treated the same as a point before the first heading (FR-036: the
   * This-Section row is then simply absent, Collapse All / Expand All unaffected).
   */
  const buildFoldMenuArgs = useCallback(
    (target: Node | null): PreviewContentMenuArgs['fold'] => {
      if (!isFoldableProvider) return null;
      const host = bodyHostRef.current;
      const slug = host ? sectionAtPoint(host, target) : null;
      const flat = flattenHeadings(headingsRef.current);
      const found = slug !== null ? flat.find((f) => f.symbol.slug === slug) : undefined;
      const section = found ? { level: found.symbol.level, collapsed: isCollapsed(foldState, found.symbol.slug) } : null;
      return {
        section,
        hasSections: flat.length > 0,
        collapseSection: () => {
          if (found) onFoldChange(setSection(foldState, found.symbol.slug, true));
        },
        expandSection: () => {
          if (found) onFoldChange(setSection(foldState, found.symbol.slug, false));
        },
        collapseAll: () => onFoldChange(foldCollapseAll(foldState)),
        expandAll: () => onFoldChange(foldExpandAll(foldState)),
        chords: foldMenuChords,
      };
    },
    [isFoldableProvider, foldState, onFoldChange, foldMenuChords],
  );

  /** The status bar's own toggle (contracts "Status bar", FR-038) — `null` for a non-Markdown provider. */
  const statusBarFold = useMemo(() => {
    if (!isFoldableProvider) return null;
    const anyExpanded = flattenHeadings(headings).some((f) => !isCollapsed(foldState, f.symbol.slug));
    return {
      anyExpanded,
      chord: anyExpanded ? foldMenuChords.collapseAll : foldMenuChords.expandAll,
      onToggleAll: () => onFoldChange(anyExpanded ? foldCollapseAll(foldState) : foldExpandAll(foldState)),
    };
  }, [isFoldableProvider, headings, foldState, onFoldChange, foldMenuChords]);

  /**
   * 047 US3 (T049, FR-037, contracts "Commands") — what each `markdown.*` chord DOES, resolved at the
   * moment it completes rather than baked into the trie (which only needs rebuilding when the
   * keybindings change): *This Section* acts on whichever heading `computeCurrentHeadingSlug` reports
   * for the top of the current view — a no-op before the first heading, exactly the editor's own guard
   * for "This Section" with no headings; *All* acts on the whole document, always.
   */
  const runMarkdownFoldAction = useCallback(
    (action: MarkdownFoldActionId): void => {
      if (!isFoldableProvider) return;
      if (action === 'markdown.collapseAll') {
        onFoldChange(foldCollapseAll(foldState));
        return;
      }
      if (action === 'markdown.expandAll') {
        onFoldChange(foldExpandAll(foldState));
        return;
      }
      if (action === 'markdown.toggleAll') {
        const slugs = flattenHeadings(headingsRef.current).map((f) => f.symbol.slug);
        onFoldChange(foldToggleAll(foldState, slugs));
        return;
      }
      const slug = computeCurrentHeadingSlug();
      if (slug === null) return;
      if (action === 'markdown.collapseSection') onFoldChange(setSection(foldState, slug, true));
      else if (action === 'markdown.expandSection') onFoldChange(setSection(foldState, slug, false));
      else onFoldChange(setSection(foldState, slug, !isCollapsed(foldState, slug)));
    },
    [isFoldableProvider, foldState, onFoldChange, computeCurrentHeadingSlug],
  );
  const runMarkdownFoldActionRef = useRef(runMarkdownFoldAction);
  runMarkdownFoldActionRef.current = runMarkdownFoldAction;

  /** Rebuilt only when the bound chords change — the trie SHAPE, never what each leaf does. */
  const chordTrie = useMemo(
    () => (isFoldableProvider ? buildMarkdownFoldChordTrie(keybindings.bindings) : new Map<string, ChordTrieNode>()),
    [isFoldableProvider, keybindings],
  );
  const chordTrieRef = useRef(chordTrie);
  chordTrieRef.current = chordTrie;

  /** One engine per panel instance (Principle VIII, shared with the editor) — created once, never rebuilt. */
  const chordEngineRef = useRef<ChordEngine<ChordPrefix> | null>(null);
  if (chordEngineRef.current === null) {
    const host: ChordEngineHost<ChordPrefix> = {
      matchFirst: (e) => {
        const stroke = strokeLabel(e);
        const found = chordTrieRef.current.get(stroke);
        if (!found) return false;
        if (isChordLeaf(found)) {
          runMarkdownFoldActionRef.current(found.action);
          return true;
        }
        chordEngineRef.current!.begin({ children: found.children, physical: [stroke] }, [stroke]);
        return true;
      },
      matchNext: (e, prefix) => {
        const stroke = strokeLabel(e);
        const found = prefix.children.get(stroke);
        if (!found) return false;
        if (isChordLeaf(found)) {
          runMarkdownFoldActionRef.current(found.action);
          return true;
        }
        const physical = [...prefix.physical, stroke];
        chordEngineRef.current!.begin({ children: found.children, physical }, physical);
        return true;
      },
      onIndicator: (indicator) => {
        const bodyHost = bodyHostRef.current;
        if (!bodyHost) return;
        if (indicator) setPendingChord({ kind: indicator.kind, host: bodyHost, keys: indicator.keys });
        else clearPendingChord(bodyHost);
      },
    };
    chordEngineRef.current = new ChordEngine<ChordPrefix>(host);
  }
  useEffect(() => {
    // Captured now, not read at cleanup time: React nulls a ref prop during the commit's mutation
    // phase, BEFORE this passive effect's own cleanup runs — `destroy()`'s own `onIndicator(null)`
    // would find `bodyHostRef.current` already `null` and silently skip the clear, leaving a stale
    // indicator up for a panel that no longer exists.
    const host = bodyHostRef.current;
    return () => {
      chordEngineRef.current?.destroy();
      if (host) clearPendingChord(host);
    };
  }, []);

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
      // FR-005 — the body just redrew under any open find session's feet; re-run its active query
      // (a no-op with none) so the reader keeps their place in the search rather than losing it.
      const refreshed = searchControllerRef.current?.refresh();
      if (refreshed) updateCount(panelId, refreshed);
      // 049: the body just replaced its DOM — the cached text model the occurrence tint reads is stale.
      occurrencesRef.current?.invalidate();
      selectionRef.current?.invalidate(); // …and a retained selection is rebuilt over the new nodes, or dropped (FR-026)
      const pending = pendingFragment.current;
      if (pending !== null && samePath(pending.filePath, filePath)) {
        pendingFragment.current = null;
        // analyze Medium 2 — a heading followed mid-redraw: the place left is wherever the draw put the reader.
        if (pending.jump) jumpToHeading(pending.filePath, pending.fragment);
        else scrollToHeading(pending.fragment);
      }
    },
    [panelId, scrollToHeading, jumpToHeading, settleRedraw],
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
              // FR-090d — exactly as if opened from File Explorer; the fragment places the caret.
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

  /* ── Drops (047 US5, research R9, contracts/preview-ipc-047.md §4) ──────────────────────────────── */

  /**
   * Step 2 — a confinement-approved path this window's provider registry has no ENABLED provider for
   * is refused HERE, silently (no notice): main never sees it, and main's confinement decision is
   * untouched for a provider that fires up disabled tomorrow.
   */
  const dropAccepts = useCallback(
    (absPath: string): boolean => enabledProviderFor(registry, settings.editor.previews, absPath) !== undefined,
    [registry, settings],
  );

  /** Step 3/4 — the FIRST accepted path in one drop navigates THIS panel; every later one opens new. */
  const dropBatchFirst = useRef(true);
  const onDropBatchStart = useCallback((): void => {
    dropBatchFirst.current = true;
  }, []);

  const onDropAccepted = useCallback(
    (absPath: string): void => {
      if (!dropBatchFirst.current) {
        void requestPreviewOpen({ absPath, projectId: panel.originProjectId, target: { mode: 'new' } });
        return;
      }
      dropBatchFirst.current = false;
      // MT-03 (review, 2026-09-28) — the panel dropped on takes the keyboard, and the workspace pane
      // becomes the active one: a drag from the explorer left both on the Files pane.
      if (ws.layout) focusLocalPanel(ws, ws.layout, panelId);
      const bridge = window.throng?.preview;
      if (!bridge) return;
      const leavingViewState = placeLeft();
      void bridge
        .navigate({
          panelId,
          target: { absPath },
          intent: { kind: 'drop' },
          ...(leavingViewState !== undefined ? { leavingViewState } : {}),
        })
        .then((res) => {
          if (!mounted.current) return;
          switch (res.kind) {
            case 'shown': {
              const current = stateRef.current;
              const moved = current === undefined || !samePath(res.update.filePath, current.filePath);
              const applied = applyPreviewUpdate(
                moved && res.update.content === null ? { ...res.update, content: CLEARED_CONTENT } : res.update,
              );
              if (applied && moved) clearLinkNotice();
              return;
            }
            case 'refused':
              // `throng:preview:navigate`'s `drop` intent answers `refused` with the same reason text
              // `throng:editor:resolveDrop` produced (contract §2) — reuse the same link-notice path.
              if (isLinkNotice(res.notice)) raiseLinkNotice(res.notice);
              return;
            default:
              // `focusedOther` (FR-023, 044 FR-090c) — main focused the preview already showing it.
              clearLinkNotice();
              return;
          }
        })
        .catch((error: unknown) => {
          window.throng?.notices?.log?.(
            noticeLogRecord({
              severity: 'error',
              message: 'A file dropped on a preview could not be shown.',
              subject: panelSubject(placeRef.current),
              detail: messageOf(error),
            }),
          );
        });
    },
    [panelId, placeLeft, clearLinkNotice, raiseLinkNotice, panel.originProjectId, ws],
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
      if (place === undefined) {
        // Nothing drawn to read: the place this view last restored is not where the reader is now, so a
        // remount waits for the attach answer instead of first jumping to the old one (FR-107).
        clearPreviewViewState(panelId);
        return;
      }
      window.throng?.history?.setViewState(panelId, place);
      // 048 FR-083 (#459) — and keeps it here, so a remount draws AT it rather than at the top while the attach
      // is in flight (a view hidden again in that window stored the top). Restored under `keep` (FR-084).
      keepDetachedViewState(panelId, place);
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

  const { openMenu, updateMenu } = useContextMenu();
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

  /**
   * FR-121e, FR-121h — how the body treats the place the store holds (data-model §15.2). 048 FR-084 refines
   * FR-121h: a place this view kept when its tab was hidden is its own, and comes back as it stands.
   */
  const placePolicy: PreviewBodyProps['placePolicy'] =
    state?.viewState === undefined
      ? 'restore'
      : state.viewStateSource === 'detach'
        ? 'keep'
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
   * 045 FR-169 – FR-171, FR-054 — the Link menu's own destinations for THIS window: Open In ▸ opens the
   * target file exactly as the explorer does (`openFileInTab`, honouring *Open files in*), Open Preview
   * reuses the same `requestPreviewOpen` a terminal and an editor call, and the two OS routes are
   * `osLinkActions()`, unchanged. One failure report, shaped identically to the other two surfaces
   * (`linkFailureReport`), so the wording cannot drift (FR-036, FR-037; 032's lesson).
   */
  const previewLinkDeps = useMemo<LinkActionDeps>(
    () => ({
      openInEditor: (link, position) => {
        const tabId = ws.layout?.activeTabId;
        if (tabId) {
          void openFileInTab(
            ws,
            tabId,
            link.path,
            settings.editor.openTarget,
            position ? positionRevealTarget(position.line, position.column) : undefined,
          );
        }
      },
      openInPreview: (link) => {
        void requestPreviewOpen({
          absPath: link.path,
          projectId: panel.originProjectId,
          requesterPanelId: panelId,
        });
      },
      reportFailure: (outcome) => {
        reportSubject(
          linkFailureReport(outcome, {
            projectRoot,
            osName: os,
            ...(panel.originProjectId ? { projectId: panel.originProjectId } : {}),
          }),
        );
      },
      ...osLinkActions(),
    }),
    [ws, settings.editor.openTarget, panel.originProjectId, panelId, reportSubject, projectRoot, os],
  );

  /**
   * 045 FR-169 – FR-171 — over a link with NO selection, the ONE Link menu opens INSTEAD of this
   * panel's own menu (`preview-link-menu.ts`, the same `buildLinkMenu` path a terminal and an editor
   * draw from); `false` for an inert link — nothing follows it, so the ordinary menu below applies, as
   * it does away from any link. Selecting text is what enables Content, so the two never mix.
   */
  const openLinkMenuOverPreview = useCallback(
    (link: PreviewLink, point: { x: number; y: number }): boolean =>
      openPreviewLinkMenu({
        x: point.x,
        y: point.y,
        opener: { openMenu, updateMenu },
        link,
        panelId,
        ...(panel.originProjectId ? { projectId: panel.originProjectId } : {}),
        projectRoot,
        docPath: stateRef.current?.filePath ?? mountFile.current,
        previewRegistry: registry,
        previewSettings: settings.editor.previews,
        ...(firstBinding(keybindings, 'preview.followLink')
          ? { chord: firstBinding(keybindings, 'preview.followLink')! }
          : {}),
        ws,
        deps: previewLinkDeps,
        onFollow,
      }),
    [openMenu, updateMenu, panelId, panel.originProjectId, projectRoot, registry, settings.editor.previews, keybindings, ws, previewLinkDeps, onFollow],
  );

  /*
   * 045 FR-168 (review round four, editor M2) — what the BODY needs to word a link, which it cannot
   * work out for itself: a body never sees the provider registry (FR-074).
   *
   * `previewable` is the same by-extension question the editor's and the terminal's tooltips ask
   * (`defaultOpenActionFor`), so one link reads the same on all three surfaces (FR-166). A `file`
   * link whose target no enabled provider claims is followed into an EDITOR (044 FR-090d,
   * `preview-service.ts`), and 023 FR-025 decides which one.
   */
  const linkWording = useMemo(
    () => ({
      previewable: (absPath: string) =>
        defaultOpenActionFor(registry, settings.editor.previews, absPath) === 'preview',
      openTarget: settings.editor.openTarget === 'new' ? ('new' as const) : ('lastActive' as const),
    }),
    [registry, settings.editor.previews, settings.editor.openTarget],
  );

  /**
   * The ORDINARY body menu, for a right-click over plain text, over a link WITH a selection (024
   * FR-019d), or over an inert link. The selection is captured NOW: a menu row that copies copies what
   * was selected when the menu opened, whatever pressing the row does to the live selection.
   */
  const openBodyMenu = useCallback(
    (link: PreviewLink | null, point: { x: number; y: number }, target: Node | null = null): void => {
      const host = bodyHostRef.current;
      const captured = host === null ? null : captureSelection(host);
      const selectionEmpty = captured === null;

      if (link !== null && selectionEmpty && openLinkMenuOverPreview(link, point)) return;

      const content: PreviewContentSection | null = textSelection
        ? {
            copyFormat: copyFormatRef.current,
            copy: (format) => copySelection(captured, format),
            selectAll,
          }
        : null;
      const editorRoute: PreviewEditorRouteItem | null =
        providerKind === 'text' && onEditorRoute !== undefined
          ? { parented, run: onEditorRoute, disabled: movedOutRef.current }
          : null;
      const items = previewContentMenu({
        selectionEmpty,
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
        // 047 US1 (FR-007) — always offered, whatever is under the pointer.
        find: { run: () => openFind(panelId, 'preview'), chord: firstBinding(keybindings, 'search.find') },
        // 047 US4 — always offered too, even with no headings (the pop-down itself says so).
        goToHeading: { run: openHeadingOutlineHandler, chord: firstBinding(keybindings, 'preview.goToHeading') },
        // 047 US3 (T048, FR-036) — the fold rows, resolved at the point the menu opened.
        fold: buildFoldMenuArgs(target),
        // 048 — the Split submenu, splitting this panel.
        split: { panelId, keybindings },
      });
      if (items.length > 0) openMenu(point.x, point.y, items);
    },
    [
      openLinkMenuOverPreview,
      textSelection,
      copySelection,
      selectAll,
      providerKind,
      onEditorRoute,
      parented,
      keybindings,
      openMenu,
      onToggleSyncScroll,
      panelId,
      openHeadingOutlineHandler,
      buildFoldMenuArgs,
    ],
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
      openBodyMenu(null, { x: e.clientX, y: e.clientY }, e.target as Node);
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

  /**
   * 047 US5 — the body's OWN drop handler, narrowed to non-file drops (FR-021). A file drag (OS or
   * tree) is meant for the `TreeDropTarget`/`PanelDropTarget` WRAPPING this body: their own `onDrop`
   * calls `stopPropagation` once they claim it, but that only works if this one does not claim it
   * FIRST — React's bubble phase reaches the innermost element (this body) before its ancestors.
   */
  const onBodyDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>): void => {
      const isFileDrag = Array.from(e.dataTransfer?.types ?? []).includes('Files');
      if (isFileDrag || getTreeDrag() !== null) return; // let the ancestor drop targets handle it
      refuse(e);
    },
    [refuse],
  );

  /** Ctrl+A selects the body, not the window. */
  const onHostKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      // 047 T049 — the markdown.* fold chords, consumed before anything else on this key.
      if (chordEngineRef.current?.keydown(e)) return;
      if (!textSelection) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      }
    },
    [textSelection, selectAll],
  );

  /** FR-124 — releasing a held chord modifier ends the prefix; FR-092 — losing focus ends it too. */
  const onHostKeyUp = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    chordEngineRef.current?.keyup(e);
  }, []);
  const onHostBlur = useCallback((): void => {
    chordEngineRef.current?.blur();
  }, []);

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
        openHeadingOutline: openHeadingOutlineHandler,
      }),
    [panelId, onFollow, revealFragmentIn, onHistoryStep, openHeadingOutlineHandler],
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
  /*
   * 050 FR-035 — where the moved notice says the file went, or `null` for an ordinary preview. The run's
   * own word wins while it has spoken (an update with no notice is the way back); before it has, the
   * layout's persisted flag speaks for a panel that mounted without attaching.
   */
  const movedOutTo: string | null =
    state !== undefined && isMovedOutNotice(state.notice)
      ? state.notice.movedTo
      : heldMovedOut
        ? // R26 — the layout's flag wins over what the window's store remembers from before this view
          // unmounted (a project switch): that state predates the move. The flag goes only when main
          // reports the file back in the project (`pathChanged`, `movedOut: false`).
          (config?.filePath ?? mountFile.current)
        : null;
  const bodyCovered = fileNotice !== null || movedOutTo !== null;
  bodyCoveredRef.current = bodyCovered;
  movedOutRef.current = movedOutTo !== null;

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

  /*
   * 047 US2 (FR-015, research R8) — this panel just became the reader's most recently active preview
   * in its tab, for `open-preview.ts`'s "reuse the last active preview" to find. Both pointerdown AND
   * focus record — unlike `last-active-editor.ts`'s keyboard gap, a preview can be brought to the front
   * by Tab alone (no click), and that must count too.
   */
  const recordActive = useCallback((): void => {
    const tabId = ws.layout?.activeTabId;
    if (tabId) recordLastActivePreview(tabId, panelId);
  }, [ws, panelId]);

  return (
    <div
      className="preview-panel"
      data-testid={`preview-${panelId}`}
      style={zoomStyle}
      ref={panelRootRef}
      onCopy={onRootCopy}
      onPointerDown={recordActive}
      onFocus={recordActive}
    >
      {movedOutTo !== null ? (
        <MovedOutNotice panelId={panelId} filePath={movedOutTo} onClose={onClose} />
      ) : shown?.source === 'notice' && state ? (
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
      <TreeDropTarget
        panelId={panelId}
        accepts={(paths, singleFile) => singleFile && paths.length === 1 && dropAccepts(paths[0]!)}
        onDrop={(paths) => {
          onDropBatchStart();
          onDropAccepted(paths[0]!);
        }}
      >
        <PanelDropTarget ctx={dropCtx} onOpen={onDropAccepted} onBatchStart={onDropBatchStart} accepts={dropAccepts}>
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
            // 047 US5 — narrowed to non-file drops (FR-021): a file drag is handled by the drop
            // targets WRAPPING this body, whose own onDrop stops the event before it bubbles here;
            // anything else (a browser text/HTML drag) still lands here and is refused as before.
            onDrop={onBodyDrop}
            onKeyDown={onHostKeyDown}
            onKeyUp={onHostKeyUp}
            onBlur={onHostBlur}
          >
        {Body !== null && state?.content ? (
          <Body
            key={bodyGeneration}
            panelId={panelId}
            content={state.content}
            filePath={state.filePath}
            projectRoot={projectRoot ?? ''}
            providerSettings={settings.editor.previews.providers[state.providerId] ?? NO_PROVIDER_SETTINGS}
            linkWording={linkWording}
            initialViewState={state.viewState}
            initialViewStateBasis={state.viewStateBasis}
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
            // 047 US6 (T063) — a pure passthrough to main's channel; no chrome-level decision (see
            // provider-view.ts's doc comment on why this one differs from onFollow/onFoldChange).
            resolveWikiTargets={(targets) =>
              window.throng?.preview?.resolveWikiTargets(panelId, [...targets]) ?? Promise.resolve({ resolved: targets.map(() => null) })
            }
            // 047 US4 (R2) — this render's heading tree, for the Go to Heading pop-down.
            onHeadings={onHeadings}
            // 047 US3 (R3, Principle XI) — the cache's current value, never a local copy.
            foldState={isFoldableProvider ? foldState : null}
            onFoldChange={onFoldChange}
            gutter={settings.editor.previews.providers.markdown?.gutter === true}
            // 047 US3 (T050, FR-040) — the body's own reveal(slug): expand a collapsed target on jump/find.
            onRevealSection={(reveal) => {
              revealRef.current = reveal;
            }}
          />
        ) : null}
        {/* 047 US1 (FR-074, R16) — the match-frame layer: the outline every find match carries, drawn in a
            layer of its own because `::highlight()` takes no outline. 049 FR-029: INSIDE the scrolling body, so a
            frame scrolls with its text, but a sibling of the rendered content, never in it (the sanitised content,
            copy and find's text model are untouched). aria-hidden, no pointer events (match-frames.css); covered
            with the body, whose visibility it inherits. */}
        <div
          className="preview-match-frames"
          data-testid={`preview-match-frames-${panelId}`}
          aria-hidden="true"
          ref={matchFrameLayerRef}
        />
          </div>
        </PanelDropTarget>
      </TreeDropTarget>
      {/* 047 US1 (FR-007) — the one shared find bar; renders only while find is open on this panel. */}
      <FindBar panelId={panelId} />
      {/* 047 US4 (research R7) — the Go to Heading pop-down; renders only while open. */}
      <HeadingOutline
        panelId={panelId}
        open={headingOutlineOpen}
        headings={headings}
        currentSlug={headingOutlineCurrentSlug}
        onJump={onHeadingOutlineJump}
        onClose={onHeadingOutlineClose}
      />
      {/* FR-015a — the editor's bar, under the editor's setting; FR-015e — none for a binary provider. FR-118 —
          its one readout, the hovered or focused link's target, is shown only while the bar is. */}
      {settings.editor.showStatusBar && onEditorRoute !== undefined ? (
        <PreviewStatusBar
          panelId={panelId}
          providerKind={providerKind}
          parented={parented}
          onEditorRoute={onEditorRoute}
          editorRouteDisabled={movedOutTo !== null}
          syncScroll={settings.editor.previews.syncScroll}
          onToggleSyncScroll={onToggleSyncScroll}
          readout={linkReadout}
          fold={statusBarFold}
        />
      ) : null}
    </div>
  );
}
