/**
 * The Markdown provider's body (044, FR-080 – FR-084, FR-094 – FR-096, contracts/security-policy.md
 * Layers 1 and 2).
 *
 * ══ THE RENDERER ARRIVES BY DYNAMIC IMPORT ══
 *
 * `createMarkdownRenderer` binds `markdown-it` to DOMPurify, and both — with `yaml` — ride in the lazy
 * `preview` chunk (`vite.config.ts`, R21). This module is itself loaded lazily by the view's `load`, but
 * the renderer is imported with `import()` here too, so no static edge from any module to the pipeline
 * or the sanitiser exists anywhere: a later static import of this body cannot fold the chunk into the
 * eager bundle by accident. One renderer is built per window and reused by every Markdown body in it.
 *
 * ══ NO innerHTML ══
 *
 * The renderer returns a sanitised `DocumentFragment`, and the body is filled with `replaceChildren`.
 * A sanitised STRING could only reach the DOM through `innerHTML` — a second parse, which is exactly what
 * a mutation-XSS payload needs (Layer 2). There is no string here to parse. What happens after insertion
 * — code highlighting (`highlight.ts`), a blocked image's alternative text — builds nodes, never markup.
 *
 * The host element is not `contenteditable` and never becomes so: a preview is read-only (FR-020). It is
 * focusable (`tabIndex=-1`), so the arrow, Page and Home/End keys scroll it natively (FR-096a); none of
 * them is handled here. The one input that changes a document is a task box's click or Space (054 FR-022),
 * and even that only ASKS: the chrome has main change the marker, and the re-render shows it (`task-toggle.ts`).
 *
 * ══ AN UPDATE KEEPS THE READER'S PLACE; A NEW FILE STARTS AT THE TOP ══
 *
 * Every content update is drawn between a scroll-anchor capture and restore (`scroll-anchor.ts`,
 * FR-024), so typing in the editor never moves the reader. A render for a DIFFERENT file is not an
 * update — it is a link followed or a history step — and is shown from its top. A followed link's
 * fragment is the chrome's to scroll to, once `onDrawn` says the file is on screen.
 *
 * A different file is not ALWAYS a navigation (T177, FR-013c). An in-app rename or move, and a Save As
 * from the parent editor, re-point the run at a new path showing the same document, and the reader must
 * stay where they were reading. `navigationSeq` — main's count of this run's navigations, on every update
 * — is what separates the two: a file change that leaves it standing still is a re-point, and is drawn as
 * the update it is.
 *
 * A parented preview also follows its editor (FR-113): when the chrome's `syncLine` CHANGES, that source
 * line is brought to the top with the same restore. An update does not re-apply it — it keeps the captured
 * anchor, so the last sync, or the reader's own scroll after it, is the place an edit preserves.
 *
 * ══ AND DRIVES IT BACK (FR-121) ══
 *
 * Every scroll this body did not make to follow `syncLine` — the reader's, a heading jump, a kept place, a
 * restored history place, a navigation's start — is reported through `onTopLineChange`, once a frame, as the
 * line of the block at the top. Two guards keep the pair from oscillating (FR-121g, research R31): the body
 * marks its own sync placement and never reports it, and it neither follows nor reports when the other
 * side's line falls in the block already at the top. A line the editor went to FOLLOW this body
 * (`syncEcho`) is recorded as where the editor is, and never scrolled to. Where a place lands is
 * `placePolicy`'s (FR-121e, FR-121h; `scroll-sync-policy.ts`).
 *
 * ══ LINKS ══
 *
 * The sanitiser has already classified each link into `data-throng-link` (`link-dom.ts`). Here:
 *
 * - **Ctrl+click** follows, once, and only when the click left no selection — a Ctrl+drag selects text
 *   (FR-094). A plain click does nothing; the link's title says what does.
 * - **Tab / Shift+Tab** move between links natively, in document order: each followable link is
 *   `tabindex=0`, and Tab is never intercepted, so past the last link focus leaves the preview (FR-096b).
 *   The focused link carries `preview-markdown__link--focused` for the theme's focus indicator.
 * - **A primary press** on a link lifts its `tabindex` until the press ends, so a drag that starts on the
 *   link selects text (FR-094) — Chromium will not start a selection on a focusable element.
 * - **Pointer over, or keyboard focus on, a link** reports its `data-throng-target` through `onLinkTarget`,
 *   hover and focus separately, and `null` when each leaves; the chrome shows it in its status bar (FR-118).
 * - **Enter** does nothing; **Ctrl+Enter** is `preview.followLink`, resolved by the window's key handler
 *   and routed to the chrome (FR-096c).
 * - **Right-click** on a link with nothing selected asks the chrome for the link menu (FR-095). With a
 *   selection the event is left alone: the ordinary menu wins.
 * - **The keyboard menu** (FR-096d) is NOT a key handler here. `menu.open` is a bindable, window-level
 *   command (Shift+F10 and the menu key as shipped); `app.tsx` resolves it in the capture phase and
 *   re-dispatches a `contextmenu` at the focused element — so a focused link receives exactly the event a
 *   right-click sends, and a user's rebinding is honoured (Principle X). A key handler of its own would
 *   never see the keys, and would ignore the binding if it did.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  buildSymbolTree,
  initialFold,
  resolveIconAsset,
  revealing,
  splitFrontMatter,
  toggleSection,
  type HeadingRecord,
} from '@throng/core';
import type { PreviewBodyProps } from '../../provider-view.js';
import { linkElementOf, linkOf, linkTargetOf, previewLinkHoverText } from '../../link-dom.js';
import { taskBoxOf, taskToggleFor } from '../../task-toggle.js';
import { linkHintAnchor } from '../../../links/link-hint-anchor.js';
import { showLinkHint } from '../../../links/link-hint-store.js';
import { useActiveTheme, useIconPacks } from '../../../config/config-store.js';
import type { MarkdownRenderer } from './markdown-renderer.js';
import { placeOnStep, shouldDrive, shouldFollow } from '../../scroll-sync-policy.js';
import {
  blockLineFor,
  captureScrollAnchor,
  remapAnchorLine,
  restoreScrollAnchor,
  topBlockLine,
  type ScrollAnchor,
} from './scroll-anchor.js';
import { highlightCodeBlocks } from './highlight.js';
import { applyFoldGutter } from './fold-gutter.js';
import { applyWikiResolution } from './wikilinks.js';
import {
  applyTableLayout,
  chToPx,
  measureColumns,
  measureTables,
  relayoutTables,
  type TableHandSet,
} from '../../table-layout.js';
// The rendered document's own styles (fix round 1, item 2): loaded with this body's chunk, not with
// the panel chrome's `preview.css`, which never mentions a provider (FR-070).
import './markdown.css';

let renderer: Promise<MarkdownRenderer> | null = null;

/** Whether a stored view state is this body's own scroll anchor — provider-owned JSON, so checked, never assumed. */
function isScrollAnchor(value: unknown): value is ScrollAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const { line, offsetRatio } = value as { line?: unknown; offsetRatio?: unknown };
  return typeof line === 'number' && Number.isFinite(line) && typeof offsetRatio === 'number' && Number.isFinite(offsetRatio);
}

/** The window's one Markdown renderer, imported and built on first use. */
function markdownRenderer(): Promise<MarkdownRenderer> {
  renderer ??= import('./markdown-renderer.js')
    .then((m) => m.createMarkdownRenderer(window))
    .catch((error: unknown) => {
      // A chunk that failed to load must not be cached as failed for the life of the window: the
      // next render tries the import again.
      renderer = null;
      throw error;
    });
  return renderer;
}

/** The class the focused link carries (FR-096b); `markdown.css` draws the indicator. */
export const FOCUSED_LINK_CLASS = 'preview-markdown__link--focused';

/** The class a front matter block carries once inserted, for `markdown.css`. */
/**
 * Principle XII — how long a draw's table layout waits for the next draw (a keystroke in a parented
 * editor), and how long a resize waits for the resizing to pause. Rendering yields to input: the reader
 * sees the table a moment later rather than the panel lagging.
 */
const TABLE_LAYOUT_DEBOUNCE_MS = 120;
const TABLE_RESIZE_DEBOUNCE_MS = 150;

const FRONT_MATTER_CLASS = 'preview-markdown__front-matter';

/** An image that could not be shown, as its alternative text (FR-084). */
const ALT_CLASS = 'preview-markdown__alt';

/** What `sanitise.ts` marks a blocked image with. Duplicated rather than imported: that module is lazy. */
const BLOCKED_IMAGE_SELECTOR = 'img[data-throng-alt]';

/**
 * The element that scrolls this body: the chrome's body host (`preview-panel.css`), or the body itself
 * when it is mounted outside a panel.
 */
/** Whether `scroller` sits at its bottom extent, within the engine's sub-pixel rounding. */
function atScrollEnd(scroller: HTMLElement): boolean {
  return scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
}

function scrollerOf(body: HTMLElement): HTMLElement {
  return body.closest<HTMLElement>('.preview-panel__body') ?? body;
}

/**
 * Put an image's alternative text where the image was — or nothing, for an image with none. The span carries
 * the image's tooltip (FR-120): a blocked or failed image names its source exactly as a shown one does.
 */
function showAltText(img: HTMLImageElement): void {
  const alt = img.getAttribute('alt') ?? '';
  if (alt.length === 0) {
    img.remove();
    return;
  }
  const span = img.ownerDocument.createElement('span');
  span.className = ALT_CLASS;
  span.textContent = alt;
  const title = img.getAttribute('title');
  if (title !== null) span.setAttribute('title', title);
  img.replaceWith(span);
}

/**
 * 044 FR-121g — the block `line` is shown in: the block at or before it, or — for a line above every block —
 * the first block, where `restoreScrollAnchor` would put that line. `null` only for a body with no blocks.
 */
function blockOf(body: HTMLElement, line: number): number | null {
  const at = blockLineFor(body, line);
  if (at !== null) return at;
  const first = Number(body.querySelector('[data-source-line]')?.getAttribute('data-source-line'));
  return Number.isFinite(first) ? first : null;
}

/**
 * What the body does with a place it is handed (044 FR-107, FR-121e, FR-121h). `keep` restores like `restore`
 * but drives nothing: the view's own place, shown again (048 FR-084).
 */
type PlaceAction = 'sync' | 'restore' | 'keep' | 'top' | 'none';

/**
 * 048 FR-083 (#459) — a restored place that the content has not finished laying out under yet. The fold
 * gutter hides collapsed sections after a draw places the reader, and the table pass lays tables out after
 * that; either moves content above the place under a fixed `scrollTop`, and a programmatic scroll leaves the
 * engine no scroll anchor of its own to compensate with. So the place stays pending, is re-applied at each of
 * those settle points (once each, never per frame — Principle XII), and is dropped after the table pass, or as
 * soon as the reader scrolls, or anything else places the view.
 */
const READER_INPUT = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

interface PendingPlace {
  anchor: ScrollAnchor;
  /** Whether a re-application is reported to the editor (`restore`) or is this body's own (`keep`). */
  report: boolean;
}

/** Whether the document's selection is empty — a click that selected text is a selection, not a follow. */
function selectionIsEmpty(doc: Document): boolean {
  const selection = doc.getSelection();
  return selection === null || selection.rangeCount === 0 || selection.isCollapsed;
}

/** The element carrying `data-heading-slug="slug"` among `body`'s headings, or `null`. */
function headingElementBySlug(body: HTMLElement, slug: string): HTMLElement | null {
  for (const el of body.querySelectorAll<HTMLElement>('[data-heading-slug]')) {
    if (el.getAttribute('data-heading-slug') === slug) return el;
  }
  return null;
}

export function MarkdownBody({
  panelId,
  content,
  filePath,
  projectRoot,
  providerSettings,
  initialViewState,
  initialViewStateBasis,
  navigationSeq,
  syncLine,
  syncEcho,
  onTopLineChange,
  onTopLineRead,
  placePolicy,
  onViewStateCapture,
  onFollow,
  onLinkMenu,
  onLinkTarget,
  onDrawn,
  onBodyFailure,
  linkWording,
  foldState,
  onFoldChange,
  gutter,
  onHeadings,
  onRevealSection,
  resolveWikiTargets,
  onToggleTask,
}: PreviewBodyProps): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const text = content.kind === 'text' ? content.text : null;
  const remoteImages = providerSettings.loadRemoteImages === true;
  /*
   * 045 FR-168 (review round four, M2) — read through a ref, like the other live collaborators here:
   * it changes when a provider is enabled or `editor.openTarget` moves, and neither should re-run
   * the render effect below (which would re-parse the document to change a tooltip). The render pass
   * reads it for the titles it bakes; the plain-click hint reads it at the click.
   */
  const linkWordingRef = useRef(linkWording);
  linkWordingRef.current = linkWording;
  /** FR-117 — Show front matter. Shipped on, so anything but an explicit `false` shows the block. */
  const frontMatter = providerSettings.showFrontMatter !== false;
  const onFailureRef = useRef(onBodyFailure);
  onFailureRef.current = onBodyFailure;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onLinkTargetRef = useRef(onLinkTarget);
  onLinkTargetRef.current = onLinkTarget;
  /*
   * ── 047 US3 — fold gutter (R6, provider-view.ts "Markdown section folding") ──
   *
   * Read through refs, like every other live collaborator here: none of them should re-run the
   * (expensive, re-parsing) draw effect below. `foldStateRef` is Principle XI's read-only copy of
   * what main holds; this body computes a NEXT state from it and hands that to `onFoldChange`, and
   * only ever draws what `foldState` itself says once the chrome's next prop confirms it.
   */
  const foldStateRef = useRef(foldState);
  foldStateRef.current = foldState;
  const gutterRef = useRef(gutter);
  gutterRef.current = gutter;
  const onFoldChangeRef = useRef(onFoldChange);
  onFoldChangeRef.current = onFoldChange;
  const onHeadingsRef = useRef(onHeadings);
  onHeadingsRef.current = onHeadings;
  const resolveWikiTargetsRef = useRef(resolveWikiTargets);
  resolveWikiTargetsRef.current = resolveWikiTargets;
  /** This render's flat heading list (R2), for the fold gutter and `onRevealSection`. */
  const lastHeadingsRef = useRef<readonly HeadingRecord[]>([]);
  /**
   * 047 T065/T066, FR-064 — a reader's drag on a column border, by table index within THIS document.
   * Survives an UPDATE (the same map is handed to every `applyTableLayout` call); a NEW file starts a
   * fresh one, in the same place the draw effect already tells an update from a navigation.
   */
  const tableHandSetRef = useRef(new Map<number, TableHandSet>());
  const theme = useActiveTheme();
  const packs = useIconPacks();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const packsRef = useRef(packs);
  packsRef.current = packs;
  /**
   * Insert/remove the gutter's toggles and hide a collapsed section's blocks over `body`'s CURRENT
   * children — never `replaceChildren`, so calling this from a fold-only update (no new render) never
   * disturbs the reader's scroll position or selection (FR-035).
   */
  const drawFoldGutter = useCallback((body: HTMLElement, headings: readonly HeadingRecord[]): void => {
    applyFoldGutter(body, headings, {
      // Absent reads as off, like `remoteImages`/`frontMatter` above: a harness that does not know
      // about this prop yet gets exactly what it got before this feature landed, not a guess at the
      // shipped setting's default (the chrome is what actually reads `editor.previews.providers.
      // markdown.gutter` and always passes a concrete value once it is wired).
      gutter: gutterRef.current === true,
      foldState: foldStateRef.current ?? initialFold('expanded'),
      onToggle: (slug) => {
        const current = foldStateRef.current ?? initialFold('expanded');
        onFoldChangeRef.current?.(toggleSection(current, slug));
      },
      iconFor: (token) => resolveIconAsset(themeRef.current, packsRef.current, token),
    });
  }, []);
  /**
   * 047 T065/T066, R13 — fair column widths for every table under `body` (provider-agnostic;
   * `table-layout.ts` names no provider). Reapplying over the SAME `tableHandSetRef` map is what lets
   * a reader's drag survive an update to the same file; a fresh map (drawn whenever a NEW file lands,
   * below) is what "dropped on navigation" (FR-064) means.
   */
  const tableLayoutOptions = useCallback(
    () => ({ measure: measureColumns, measureAll: measureTables, minLegiblePx: chToPx, handSet: tableHandSetRef.current }),
    [],
  );
  /**
   * Principle XII — the tables are laid out AFTER the draw has painted, never inside it: the reader sees
   * the document (its tables at their natural widths for a moment) and input is never held behind the
   * measuring. Debounced, so a parented preview re-rendering on every keystroke measures once when the
   * typing pauses rather than once per key; a newer draw supersedes a pending one.
   */
  const tableLayoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 048 FR-083 — a restored place still waiting for the content to settle (see {@link PendingPlace}). */
  const pendingPlace = useRef<PendingPlace | null>(null);
  /** Re-apply a pending place; assigned below, once the reporting it needs is defined. */
  const reanchorRef = useRef<(scroller: HTMLElement) => void>(() => undefined);
  const drawTableLayout = useCallback(
    (body: HTMLElement): void => {
      if (tableLayoutTimer.current !== null) clearTimeout(tableLayoutTimer.current);
      tableLayoutTimer.current = setTimeout(() => {
        tableLayoutTimer.current = null;
        if (bodyRef.current === body && body.isConnected) {
          applyTableLayout(body, tableLayoutOptions());
          // The last settle point: the place lands under the final layout, and is no longer pending.
          reanchorRef.current(scrollerOf(body));
        }
        pendingPlace.current = null;
      }, TABLE_LAYOUT_DEBOUNCE_MS);
    },
    [tableLayoutOptions],
  );
  useEffect(
    () => () => {
      if (tableLayoutTimer.current !== null) clearTimeout(tableLayoutTimer.current);
    },
    [],
  );
  /**
   * What the body currently SHOWS — the text, file and navigation count of the last render that reached
   * the DOM — so the next render can tell an update (same file: keep the reader's place, FR-024) from a
   * navigation (a different file AND a different count: start at its top, FR-090b). A different file at
   * the SAME count is a re-point (T177, FR-013c): the same document under a new path, which keeps the
   * place like any other update. Recorded at draw time, not at prop time, because a render overtaken by
   * a newer text never drew anything.
   */
  const shown = useRef<{ text: string; filePath: string; navigationSeq?: number } | null>(null);
  /** FR-107 — the place main asked this body to restore, read when the file is first drawn. */
  const viewStateRef = useRef<unknown>(initialViewState);
  viewStateRef.current = initialViewState;
  /** 048 review R3 — the text that place was measured on, when it may not be the text being drawn. */
  const viewStateBasisRef = useRef(initialViewStateBasis);
  viewStateBasisRef.current = initialViewStateBasis;
  /** The last place actually restored, so the same one is never applied twice. */
  const restoredRef = useRef<unknown>(undefined);
  /** T177 — main's navigation count as it is now, read by the draw (it never moves without the file). */
  const navigationSeqRef = useRef<number | undefined>(navigationSeq);
  navigationSeqRef.current = navigationSeq;
  /** FR-113 — the parent editor's top line as it is now, read by the draw. */
  const syncLineRef = useRef<number | null>(syncLine ?? null);
  syncLineRef.current = syncLine ?? null;
  /** The last synced line actually brought to the top, so a line is applied once — never again by an update. */
  const syncedRef = useRef<number | null>(null);
  /** FR-121g — whether `syncLine` is where the editor went to follow this body. */
  const syncEchoRef = useRef(syncEcho === true);
  syncEchoRef.current = syncEcho === true;
  /** FR-121e/h — how a place handed to this body lands. */
  const placePolicyRef = useRef(placePolicy ?? 'restore');
  placePolicyRef.current = placePolicy ?? 'restore';
  const onTopLineChangeRef = useRef(onTopLineChange);
  onTopLineChangeRef.current = onTopLineChange;
  /**
   * FR-121g — where the editor is, as far as this body knows: the chrome's latest line, or the line this body
   * last drove it to. Taken from the prop whenever the prop changes, so a report is compared with the editor
   * the chrome now names.
   */
  const editorLineRef = useRef<number | null>(syncLine ?? null);
  const syncPropRef = useRef<{ line: number | null; echo: boolean }>({ line: syncLine ?? null, echo: syncEcho === true });
  if (syncPropRef.current.line !== (syncLine ?? null) || syncPropRef.current.echo !== (syncEcho === true)) {
    syncPropRef.current = { line: syncLine ?? null, echo: syncEcho === true };
    editorLineRef.current = syncLine ?? null;
  }
  /**
   * FR-121c/g — the scroller's `scrollTop` right after this body scrolled it to FOLLOW the editor. The scroll
   * event that write causes is not reported; any other position is someone else's scroll, and clears it.
   */
  const ownScrollTop = useRef<number | null>(null);
  /** The pending once-a-frame report, if any. */
  const reportFrame = useRef<number | null>(null);
  /** A report the chrome could not act on yet, to be made again when `syncLine` changes. */
  const reportDeferred = useRef(false);

  /** FR-121f — report the top block to the chrome, unless it is this body's own sync or the same block (FR-121g). */
  const reportTopLine = useCallback((): void => {
    reportFrame.current = null;
    const body = bodyRef.current;
    if (body === null || shown.current === null) return;
    const scroller = scrollerOf(body);
    const own = ownScrollTop.current;
    ownScrollTop.current = null;
    // The claim stands while the position is this body's, so a shrink that lands in a later frame is read the
    // same way as one that lands in this frame.
    if (own !== null && scroller.scrollTop === own) {
      ownScrollTop.current = own;
      return;
    }
    if (own !== null && scroller.scrollTop < own && atScrollEnd(scroller)) {
      // Content that laid out after this body placed itself made the document shorter, and the engine clamped
      // the position to the new end: still this body's place, not the reader's scroll (hands-on report
      // 2026-09-17).
      ownScrollTop.current = own;
      return;
    }
    const report = onTopLineChangeRef.current;
    const editorLine = editorLineRef.current;
    if (report === undefined || editorLine === null) return;
    const top = topBlockLine(scroller);
    if (top === null || !shouldDrive({ previewTopBlock: top, editorLineBlock: blockOf(body, editorLine) })) return;
    if (report(top) === false) {
      // Compared with a stale editor line: decide again against the next one the chrome hands down.
      reportDeferred.current = true;
      return;
    }
    editorLineRef.current = top;
  }, []);

  /** Report at the next frame — coalescing every scroll, and every place this body applied, in between. */
  const scheduleReport = useCallback((): void => {
    if (reportFrame.current !== null) return;
    const win = bodyRef.current?.ownerDocument.defaultView;
    if (!win) return;
    reportFrame.current = win.requestAnimationFrame(reportTopLine);
  }, [reportTopLine]);

  /**
   * Bring the editor's line to the top of `scroller`, unless that line has already been applied — or is an
   * echo of this body's own report, or falls in the block already at the top (FR-121g).
   */
  const applyPendingSync = useCallback((scroller: HTMLElement): void => {
    const line = syncLineRef.current;
    const body = bodyRef.current;
    if (line === null || line === syncedRef.current || body === null) return;
    syncedRef.current = line;
    if (syncEchoRef.current) return;
    if (!shouldFollow({ previewTopBlock: topBlockLine(scroller), editorLineBlock: blockOf(body, line) })) return;
    // The editor moved, and the preview follows it: a place still settling is no longer where it should be.
    pendingPlace.current = null;
    restoreScrollAnchor(scroller, { line, offsetRatio: 0 });
    ownScrollTop.current = scroller.scrollTop;
  }, []);

  /** FR-107, FR-121e, FR-121h — what a place handed to this body does, under the chrome's policy. */
  const placeActionFor = useCallback((place: unknown, crossFile: boolean): PlaceAction => {
    if (place === undefined) return 'none';
    const line = syncLineRef.current;
    const restorable: PlaceAction = isScrollAnchor(place) ? 'restore' : 'none';
    switch (placePolicyRef.current) {
      case 'editorLineIfTop': {
        const decided = placeOnStep({ place, crossFile, synced: line !== null, editorLine: line });
        if (decided.kind === 'editorLine') return 'sync';
        return decided.kind === 'top' ? 'top' : restorable;
      }
      case 'editorLine':
        // An opening or a restore: the editor's line decides when this window knows it (FR-121h).
        return line !== null ? 'sync' : restorable;
      case 'keep':
        // 048 FR-084 — shown again: its own place, whatever the editor's line, and the editor keeps its own.
        return restorable === 'restore' ? 'keep' : 'none';
      default:
        return restorable;
    }
  }, []);

  /** Apply `place` as `action` decided, to `scroller`. */
  const applyPlace = useCallback(
    (scroller: HTMLElement, place: unknown, action: PlaceAction, drawnText: string | null): void => {
      if (action === 'none') return;
      restoredRef.current = place;
      pendingPlace.current = null;
      // 048 review R3 — a place taken on another text (a view shown again after edits it did not hear) is carried
      // onto the text drawn, by the edit between them, exactly as a live update carries the reader's anchor.
      const basis = viewStateBasisRef.current;
      if (isScrollAnchor(place) && basis?.kind === 'text' && drawnText !== null && basis.text !== drawnText) {
        place = remapAnchorLine(place, basis.text, drawnText);
      }
      if (action === 'sync') {
        // The editor's line places the preview, as a sync scroll: it drives nothing back (FR-121e, FR-121h).
        syncedRef.current = null;
        applyPendingSync(scroller);
        return;
      }
      if (action === 'keep') {
        // 048 FR-084 — its own place, shown again. Claimed as this body's own position, so the scroll it causes
        // reports nothing, and the editor's current line counts as applied, so it does not pull the view away.
        const anchor = place as ScrollAnchor;
        restoreScrollAnchor(scroller, anchor);
        pendingPlace.current = { anchor, report: false };
        syncedRef.current = syncLineRef.current;
        ownScrollTop.current = scroller.scrollTop;
        return;
      }
      if (action === 'restore') {
        restoreScrollAnchor(scroller, place as ScrollAnchor);
        pendingPlace.current = { anchor: place as ScrollAnchor, report: true };
      } else scroller.scrollTop = 0;
      // The reader's place WINS over the editor's line (FR-107, FR-101): claim the line as already applied, so
      // the sync leaves this place alone until the editor really moves. Without this a Back onto a parented
      // file overwrites it whenever the run passed through a file with no editor — which stops sync, and
      // forgetting the applied line makes the editor's unchanged line look new (review finding 1). The top of
      // a document is such a place too, except where FR-121e gives it to the editor ('sync' above). Then the
      // editor follows the place restored (FR-121f).
      syncedRef.current = syncLineRef.current;
      ownScrollTop.current = null;
      scheduleReport();
    },
    [applyPendingSync, scheduleReport],
  );

  /** 048 FR-083 — at a settle point, put a pending place back where it belongs under the layout as it now is. */
  const reanchor = useCallback(
    (scroller: HTMLElement): void => {
      const pending = pendingPlace.current;
      if (pending === null) return;
      const before = scroller.scrollTop;
      restoreScrollAnchor(scroller, pending.anchor);
      if (!pending.report) ownScrollTop.current = scroller.scrollTop;
      else if (scroller.scrollTop !== before) {
        ownScrollTop.current = null;
        scheduleReport();
      }
    },
    [scheduleReport],
  );
  reanchorRef.current = reanchor;

  /*
   * FR-113 — the editor scrolled: follow it now, if the body already shows this file's text. Otherwise the
   * draw in progress applies it (a line that arrived before its file). Only a CHANGED line scrolls, so a live
   * update — which changes the text and not the line — keeps the anchor the draw captured, and a reader who
   * scrolled the preview by hand stays put until the editor moves again ("not fight it").
   */
  useEffect(() => {
    if (syncLine === null || syncLine === undefined) {
      // Sync stopped (the setting, the parent, the editor's view): a later start applies its line afresh.
      syncedRef.current = null;
      reportDeferred.current = false;
      return;
    }
    const body = bodyRef.current;
    const drawn = shown.current;
    if (body === null || drawn === null || drawn.filePath !== filePath || drawn.text !== text) return;
    applyPendingSync(scrollerOf(body));
    if (reportDeferred.current) {
      // FR-121f — a report the chrome deferred, decided again against the line just handed down.
      reportDeferred.current = false;
      scheduleReport();
    }
  }, [syncLine, syncEcho, filePath, text, applyPendingSync, scheduleReport]);

  /*
   * 044 US7b fix round 1, item 4 — a place that arrives for the file ALREADY drawn: a re-attaching view
   * whose attach answer carries where the reader left, after the body drew from what the store held. The
   * draw above covers a place that comes with a new file; this covers one that comes alone — which is also
   * how a same-file history step arrives (FR-115), so it lands under the same-file reading of FR-121e.
   * Neither a live update nor a followed link carries a place, so this never fights the update anchor or a
   * fragment scroll.
   */
  useEffect(() => {
    const place = initialViewState;
    const body = bodyRef.current;
    const drawn = shown.current;
    if (place === undefined || place === restoredRef.current || body === null) return;
    if (drawn === null || drawn.filePath !== filePath || drawn.text !== text) return; // the draw will apply it
    applyPlace(scrollerOf(body), place, placeActionFor(place, false), text);
    // 048 FR-083 — already drawn and folded; only a table pass still to come can move the content under it.
    if (tableLayoutTimer.current === null) pendingPlace.current = null;
  }, [initialViewState, filePath, text, applyPlace, placeActionFor]);

  /*
   * FR-121f — every scroll of the host, reported once a frame. The engine fires `scroll` for the reader's
   * wheel, scrollbar and keys and for every `scrollTop` write — this body's and the chrome's heading jumps
   * alike; `reportTopLine` sorts out which of them drive the editor.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const scroller = scrollerOf(body);
    const onScroll = (): void => scheduleReport();
    // 048 FR-083 — the reader's own wheel, key or scrollbar press ends a pending place: never fight the reader.
    const onReaderInput = (): void => {
      pendingPlace.current = null;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    for (const type of READER_INPUT) scroller.addEventListener(type, onReaderInput, { capture: true, passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      for (const type of READER_INPUT) scroller.removeEventListener(type, onReaderInput, { capture: true });
      if (reportFrame.current !== null) body.ownerDocument.defaultView?.cancelAnimationFrame(reportFrame.current);
      reportFrame.current = null;
    };
  }, [scheduleReport]);

  // FR-121h — the chrome reads where this body is, to place an editor it adopts there.
  useEffect(() => {
    onTopLineRead?.(() => {
      const body = bodyRef.current;
      return body === null || shown.current === null ? null : topBlockLine(scrollerOf(body));
    });
  }, [onTopLineRead]);

  // FR-107 — the chrome reads the position when it leaves this entry (a link followed, a history step).
  useEffect(() => {
    onViewStateCapture(() => {
      const body = bodyRef.current;
      // 048 FR-083 — a place still settling IS where the reader is: the layout under it is what has not
      // finished, and reading it now would store a place the reader never had.
      if (pendingPlace.current !== null) return pendingPlace.current.anchor;
      return body === null ? null : captureScrollAnchor(scrollerOf(body));
    });
  }, [onViewStateCapture]);

  useEffect(() => {
    if (text === null) return;
    let cancelled = false;
    markdownRenderer()
      .then((r) => {
        const body = bodyRef.current;
        // A newer text, or an unmount, has overtaken this render: drawing it would show stale content.
        if (cancelled || body === null) return;
        const { fragment, headings, wikiTargets } = r.render(text, { panelId, docPath: filePath, projectRoot, remoteImages, frontMatter, linkWording: linkWordingRef.current ?? {} });
        lastHeadingsRef.current = headings;
        // Dressed BEFORE it is inserted, so the place kept or restored below is measured against the layout the
        // reader will see. The front matter class alone makes its table shorter; dressed after the restore, the
        // text below moved up under the reader, and at the preview's end the engine's clamp read as the
        // reader's scroll and pulled the editor up with it (hands-on report 2026-09-17).
        // Only the table a front matter block rendered — never the document's own first element, which is
        // what `firstElementChild` is when the block was empty (fix round 1, item 12).
        const first = fragment.firstElementChild;
        if (
          frontMatter &&
          splitFrontMatter(text).source !== null &&
          first?.tagName === 'TABLE' &&
          first.getAttribute('data-source-line') === '0'
        ) {
          first.classList.add(FRONT_MATTER_CLASS);
        }
        for (const img of fragment.querySelectorAll<HTMLImageElement>(BLOCKED_IMAGE_SELECTOR)) showAltText(img);
        const scroller = scrollerOf(body);
        const file = filePath;
        const previous = shown.current;
        const navigated = navigationSeqRef.current;
        // T177 — the file changed with no navigation behind it (a rename, a move, a Save As): the same
        // document under a new path, which is an update, not a place to arrive at.
        const repointed =
          previous !== null && previous.filePath !== file && navigated !== undefined && previous.navigationSeq === navigated;
        if (previous !== null && (previous.filePath === file || repointed)) {
          // FR-024 — an UPDATE. Capture, replace and restore in one synchronous turn, so no scroll the
          // user makes can fall between the two and be undone.
          // 048 FR-083 — a place still settling is the reader's place, not the unsettled layout's.
          const pending = pendingPlace.current;
          const anchor = pending?.anchor ?? captureScrollAnchor(scroller);
          body.replaceChildren(fragment);
          const kept = anchor === null ? null : remapAnchorLine(anchor, previous.text, text);
          if (kept !== null) restoreScrollAnchor(scroller, kept);
          if (pending !== null && kept !== null) pendingPlace.current = { ...pending, anchor: kept };
          if ((anchor !== null && kept !== null && kept.line !== anchor.line) || reportDeferred.current) {
            // FR-121f — a kept place whose block was renumbered drives the editor; so does a report the chrome
            // deferred while this text was on its way (U2).
            reportDeferred.current = false;
            ownScrollTop.current = null;
            scheduleReport();
          } else if (reportFrame.current === null) {
            // FR-121c/g — the place is unchanged, so there is nothing new to tell the editor. Where the preview
            // sits short of the editor's block (its own bottom), a report now would pull the editor up to it on
            // every keystroke (review round 2, I1). The scroll event the restore — or the engine's clamp —
            // causes is this body's own. A report already due is a real scroll's, and is left to run.
            ownScrollTop.current = scroller.scrollTop;
          }
        } else {
          body.replaceChildren(fragment);
          // A different file: whatever place was settling belonged to the one it replaced.
          pendingPlace.current = null;
          // 047 FR-064 — a different file drops every hand-set table width the reader dragged.
          tableHandSetRef.current = new Map();
          // A different file is shown from its top (FR-024's second sentence, FR-090b)…
          if (previous !== null) scroller.scrollTop = 0;
          // …unless main named the place to return to: an attach, or a Back / Forward step (FR-107), which
          // lands under `placePolicy` (FR-121e for a step onto the top, FR-121h for an opening).
          const place = viewStateRef.current;
          const action = placeActionFor(place, true);
          if (action !== 'none') {
            applyPlace(scroller, place, action, text);
          } else if (previous !== null) {
            // A followed link (no place): its start position — or the fragment the chrome scrolls to next —
            // drives the new file's editor, and that editor's own line does not move it (FR-121f; analysis C2).
            syncedRef.current = syncLineRef.current;
            ownScrollTop.current = null;
            scheduleReport();
          }
        }
        // FR-113 — an editor line that changed while this draw was on its way. An unchanged one does nothing,
        // so the update path above keeps its captured anchor.
        applyPendingSync(scroller);
        shown.current = { text, filePath: file, ...(navigated !== undefined ? { navigationSeq: navigated } : {}) };
        // 047 R6 — the gutter's toggles and a collapsed section's hidden blocks, over what THIS draw just
        // inserted. After the place above, not before: a toggle's own gutter offset must never be measured
        // as part of the scroll anchor's layout.
        drawFoldGutter(body, headings);
        // 048 FR-083 — the collapsed sections just hidden moved everything below them: a place applied above
        // lands again under the folded layout. In the same task, so the reader never sees the unfolded one.
        reanchor(scroller);
        // 047 R13 — fair column widths, same reasoning: after the place has already settled.
        drawTableLayout(body);

        // FR-118 — a focused link this draw replaced no longer holds focus, and its removal sent no blur.
        const active = body.ownerDocument.activeElement;
        onLinkTargetRef.current?.('focus', active !== null && body.contains(active) ? linkTargetOf(active) : null);
        // Highlighting only rebuilds code elements' children, so it can land after the anchor restore.
        void highlightCodeBlocks(body).catch(() => undefined);
        // 047 R2 — this render's heading tree, the same moment as onDrawn (data-model §13 amended).
        onHeadingsRef.current?.(buildSymbolTree(headings));
        /*
         * 047 T061/T063 (R12) — a BATCHED call, never blocking the draw above: the reader sees the
         * document immediately, and an unresolved wikilink's styling lands once main answers. Guarded
         * by the same `cancelled` this whole effect already closes over, so an answer for a superseded
         * render can never mark a LATER render's links — the body it would apply to may not even be
         * this file's any more.
         */
        if (wikiTargets.length > 0 && resolveWikiTargetsRef.current) {
          resolveWikiTargetsRef
            .current(wikiTargets)
            .then(({ resolved }) => {
              if (cancelled) return;
              const current = bodyRef.current;
              if (current === null) return;
              applyWikiResolution(current, resolved);
            })
            .catch(() => undefined); // main unreachable: links stay unmarked rather than failing the draw
        }
        // Exactly one of `onDrawn` / `onBodyFailure` per draw (data-model §13): this is the draw's report.
        onDrawnRef.current(file);
      })
      .catch((error: unknown) => {
        // The renderer could not be imported or built, or it threw on this text. The chrome says so
        // through the shared banner; its Try again remounts this body, and the cleared cache above
        // means the import is really attempted again.
        if (!cancelled) onFailureRef.current(error);
      });
    return () => {
      cancelled = true;
    };
    // `filePath` too: the same text under another file is a navigation — unless the navigation count says
    // it is a re-point (T177) — and links and images resolve against it either way. The project, the panel
    // and the remote-image setting change what they resolve to; the front matter setting changes what is
    // drawn at the top. `navigationSeq` is read, not depended on: it never moves without the file moving.
  }, [text, filePath, projectRoot, panelId, remoteImages, frontMatter, applyPendingSync, applyPlace, placeActionFor, scheduleReport, drawFoldGutter, drawTableLayout, reanchor]);

  /*
   * 047 US3 — the reader (or the chrome) toggled a section, Collapse/Expand All, or the gutter setting
   * moved, with NO new text to draw. Re-applies over the body's CURRENT children — never
   * `replaceChildren` — so nothing here can move the reader's scroll or disturb a selection (FR-035).
   * A guard on `shown.current`: before the first draw there is nothing to fold yet, and the draw effect
   * above already calls `drawFoldGutter` once that first render lands.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null || shown.current === null) return;
    drawFoldGutter(body, lastHeadingsRef.current);
    // 048 FR-083 — fold state seeded late (main's answer after the draw) is a settle point too.
    reanchor(scrollerOf(body));
  }, [foldState, gutter, theme, packs, drawFoldGutter, reanchor]);

  /*
   * FR-040 — the chrome's way to expand one section's collapsed ancestors and itself, and bring it to
   * view: a link followed into a fold, a find match inside one, a heading jumped to. `revealing` is
   * pure and deterministic, so applying its result to THIS render's DOM ahead of main's confirmation
   * is not a second source of truth (Principle XI) — it is the SAME state main's round-trip will hand
   * back, applied once now so the scroll below has something visible to land on rather than waiting a
   * frame for it.
   */
  useEffect(() => {
    onRevealSection?.((slug: string): void => {
      const body = bodyRef.current;
      if (body === null) return;
      const current = foldStateRef.current ?? initialFold('expanded');
      const tree = buildSymbolTree(lastHeadingsRef.current);
      const next = revealing(current, tree, slug);
      if (next !== current) {
        onFoldChangeRef.current?.(next);
        drawFoldGutter(body, lastHeadingsRef.current);
      }
      headingElementBySlug(body, slug)?.scrollIntoView({ block: 'start' });
    });
  }, [onRevealSection, drawFoldGutter]);

  /*
   * 047 T065/T066, R13 — the panel resizing (a split, a window resize, zoom) changes every fitting
   * table's fair share and an overflowing one's need to scroll at all. Principle XII: a resize RE-SHARES
   * the widths its last draw measured (`relayoutTables`) — it measures nothing — and only once the
   * resizing pauses. A notification whose width did not change (the tables' own height changing, say)
   * does nothing, so the layout can never feed its own trigger. A draw still pending will measure at the
   * new width anyway, so a resize defers to it.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const current = bodyRef.current;
        if (current !== null && tableLayoutTimer.current === null) relayoutTables(current, tableLayoutOptions());
      }, TABLE_RESIZE_DEBOUNCE_MS);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [tableLayoutOptions]);

  // FR-084 — an image that fails to load shows its alternative text. `error` does not bubble: captured.
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const onError = (e: Event): void => {
      if (e.target instanceof HTMLImageElement && body.contains(e.target)) showAltText(e.target);
    };
    body.addEventListener('error', onError, true);
    return () => body.removeEventListener('error', onError, true);
  }, []);

  /*
   * 054 FR-022 (R4) — a task box asks the chrome for a toggle and never toggles itself: its native change is
   * prevented, so it shows its new state only once main has changed the source and the re-render draws it,
   * and a refusal leaves it exactly as it was (FR-028). Read against the text this body DREW, so the line
   * and the item text are the ones on screen.
   */
  const onToggleTaskRef = useRef(onToggleTask);
  onToggleTaskRef.current = onToggleTask;
  const requestToggle = useCallback((box: HTMLInputElement): void => {
    const drawn = shown.current;
    if (drawn === null) return;
    onToggleTaskRef.current?.(taskToggleFor(box, drawn.text));
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      // Space on a focused task box (FR-022). Every other key is left to the chrome and the engine.
      if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey) return;
      const box = taskBoxOf(e.target);
      if (box === null) return;
      e.preventDefault();
      requestToggle(box);
    },
    [requestToggle],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      const box = taskBoxOf(e.target);
      if (box !== null) {
        e.preventDefault();
        requestToggle(box);
        return;
      }
      if (!e.ctrlKey) {
        // 045 FR-165, FR-166 (round four; S6) — the shared link hint SUPERSEDES 044 FR-094's own
        // plain-click remedy as far as the plain click goes (FR-094's HOVER tooltip stands unchanged).
        // Additive: nothing here is prevented, so whatever a plain click already does — placing the
        // caret, starting a selection — is untouched.
        const link = linkOf(e.target);
        if (link !== null && selectionIsEmpty(e.currentTarget.ownerDocument)) {
          const text = previewLinkHoverText(link, 'Ctrl', linkWordingRef.current ?? {});
          if (text.length > 0) {
            // Maintainer correction (FR-165b, FR-165c): the LINK's own last row's bottom-right corner
            // — `getClientRects()`'s LAST rect, for an anchor text that wraps across lines — not the
            // click point. Falls back to the click point only when nothing was measured at all.
            const rects = linkElementOf(e.target)?.getClientRects();
            const anchor =
              rects && rects.length > 0
                ? linkHintAnchor(rects[rects.length - 1]!)
                : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
            showLinkHint({ text, anchor });
          }
        }
        return;
      }
      const link = linkOf(e.target);
      if (link === null) return;
      // A Ctrl+drag ends in a click too; it selected text, and following would throw the selection away.
      if (!selectionIsEmpty(e.currentTarget.ownerDocument)) return;
      e.preventDefault();
      onFollow(link);
    },
    [onFollow, requestToggle],
  );

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      const link = linkOf(e.target);
      if (link === null || !onLinkMenu || !selectionIsEmpty(e.currentTarget.ownerDocument)) return;
      e.preventDefault();
      e.stopPropagation();
      onLinkMenu(link, { x: e.clientX, y: e.clientY });
    },
    [onLinkMenu],
  );

  /*
   * A drag that starts ON a link must be able to select (FR-035, FR-094). Chromium starts no mouse
   * selection from a press that lands on a focusable element — measured against an anchor and a span, at
   * tabindex 0 and -1 alike (`preview-scroll.e2e.ts`, iteration 2026-09-15) — so with every followable link
   * `tabindex=0` for the keyboard (FR-096b), a drag from one selected nothing and its closing Ctrl+click then
   * FOLLOWED it. The attribute is lifted for the length of a primary press and put back when the press
   * ends, so the engine sees plain text under the pointer and the Tab order is untouched between presses.
   * The press focuses the body instead of the link, which is what a click on any other text does.
   */
  const liftedLink = useRef<HTMLElement | null>(null);
  const restoreLiftedLink = useCallback((): void => {
    liftedLink.current?.setAttribute('tabindex', '0');
    liftedLink.current = null;
  }, []);
  useEffect(
    () => () => {
      window.removeEventListener('mouseup', restoreLiftedLink, { capture: true });
      restoreLiftedLink();
    },
    [restoreLiftedLink],
  );

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      restoreLiftedLink();
      if (e.button !== 0) return;
      const link = linkElementOf(e.target);
      if (link === null || link.getAttribute('tabindex') !== '0') return;
      link.removeAttribute('tabindex');
      liftedLink.current = link;
      // Capture on the window: the press may end anywhere, and Chromium sends the mouseup to the window that
      // saw the mousedown even when the pointer has left it.
      window.addEventListener('mouseup', restoreLiftedLink, { capture: true, once: true });
    },
    [restoreLiftedLink],
  );

  const onFocus = useCallback((e: ReactFocusEvent<HTMLDivElement>): void => {
    const link = linkElementOf(e.target);
    if (link === null) return;
    link.classList.add(FOCUSED_LINK_CLASS);
    onLinkTargetRef.current?.('focus', linkTargetOf(link));
  }, []);

  const onBlur = useCallback((e: ReactFocusEvent<HTMLDivElement>): void => {
    const link = linkElementOf(e.target);
    if (link === null) return;
    link.classList.remove(FOCUSED_LINK_CLASS);
    onLinkTargetRef.current?.('focus', null);
  }, []);

  /*
   * FR-118 — the link under the pointer, for the chrome's status bar readout. Delegated, and resolved with
   * `closest`, so an image or an emphasis inside a link counts as the link. Moving between two elements of
   * the SAME link (its text onto its image) is not leaving it, so that `pointerout` reports nothing; any other
   * `pointerout` from a link clears, and the `pointerover` that follows names whatever is under the pointer.
   */
  const onPointerOver = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    onLinkTargetRef.current?.('hover', linkTargetOf(e.target));
  }, []);

  const onPointerOut = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    const from = linkElementOf(e.target);
    if (from === null || linkElementOf(e.relatedTarget) === from) return;
    onLinkTargetRef.current?.('hover', null);
  }, []);

  return (
    <div
      ref={bodyRef}
      className="preview-markdown"
      data-testid={`preview-markdown-${panelId}`}
      tabIndex={-1}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}
