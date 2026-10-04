/**
 * Opening a preview, and the two placement messages main sends a window (044 FR-005, FR-010 – FR-014,
 * FR-090c; contracts/preview-ipc.md §1 `open`, §2 `place` / `focus`).
 *
 * ══ MAIN DECIDES, THE WINDOW PLACES ══
 *
 * `preview.open` asks main, which owns every run and every reservation, what should happen — and
 * answers with one of four decisions. This file carries each out in THIS window's layout:
 *
 * | Main answered                    | This window                                                    |
 * |----------------------------------|----------------------------------------------------------------|
 * | `placeLocally`, a parent here    | split the parent's slot, preview on the RIGHT (FR-010)          |
 * | `placeLocally`, no parent here   | a new panel in the active tab, where a new editor goes (FR-011) |
 * | `focused` with a panel id        | its tab to the front, the panel focused (FR-012, FR-014)        |
 * | `focused` with `null`            | nothing — a reservation only, the preview is being placed       |
 * | `placedElsewhere` / `refused`    | nothing                                                         |
 *
 * A placed preview is handed main's reservation (`preview-reservations.ts`) before it is typed, so the
 * attach its mount makes consumes the hold on the path.
 *
 * ══ ONE COMMAND, REGISTERED ══
 *
 * FR-005: every entry point performs the same action. The status-bar button, the editor's two menus,
 * the chord and File Explorer cannot all reach the workspace store, so `PreviewCommands` registers
 * how to open for its window and everyone asks through `requestPreviewOpen` — the arrangement
 * `find-in-files/open-find-in-files.ts` documents for the identical problem.
 */
import {
  PREVIEW_KIND,
  collectPanels,
  normaliseForCompare,
  type Panel,
  type PanelConfig,
  type PanelKind,
  type PreviewFocusMessage,
  type PreviewOpenRequest,
  type PreviewOpenResponse,
  type PreviewPlaceMessage,
  type PreviewPanelConfig,
  type WorkspaceLayout,
} from '@throng/core';
import { getEditorState } from '../editor/editor-state.js';
import { setActivePane } from '../workspace/active-pane.js';
import { requestPanelFocus } from '../workspace/panel-focus.js';
import { requestPanelFlash } from '../workspace/panel-flash.js';
import { setPreviewReservation } from './preview-reservations.js';
import { findHeading } from './link-dom.js';
import { revealPreviewFragment } from './preview-panel-handles.js';
import { candidateFor, recordLastActivePreview } from './last-active-preview.js';

/** What asking for a preview names: the file, its project, and the panel that asked, if one did. */
export interface PreviewOpenIntent {
  absPath: string;
  projectId: string;
  /** The editor the request came from — the status-bar button and the editor's menus send it. */
  requesterPanelId?: string;
  /**
   * 047 US2 (FR-011, FR-014, R8) — override *editor.previews.openTarget* for this ONE request: the
   * Open In menu's explicit **Last Preview Panel** / **New Preview Panel** rows (T037). Omitted: the
   * caller gets the setting's own value, which {@link openPreview} applies (`defaultOpenTarget`).
   */
  target?: { mode: 'lastActive' | 'new' };
  /**
   * 047 FR-077 (R18) — a file dropped onto an EMPTY panel: place the preview INTO this panel rather than
   * adding one. Window-local — never sent to main, whose decision about the run is the same either way.
   * Honoured only while the panel is still untyped in this layout; otherwise placement is as if it were absent.
   */
  intoPanelId?: string;
  /**
   * 047 FR-081 — a file activated in File Explorer: SHOW the preview (its tab forward, the tab's active
   * panel) but leave File Explorer the active pane with the tree holding the keyboard, so F2 and the
   * tree's own keys still work. Window-local, like `intoPanelId`. Every other route leaves it unset.
   */
  keepFocus?: boolean;
  /**
   * 047 FR-083 — flash the preview's border once it is placed, reused or brought forward in this window, to
   * show where the file went. File Explorer's opens set it; window-local, like `keepFocus`.
   */
  flash?: boolean;
}

/**
 * The slice of the workspace store placement needs — named structurally, so the opener can be driven
 * from a test over core's real layout operations without a mounted provider.
 */
export interface PreviewPlacementWorkspace {
  layout: WorkspaceLayout | null;
  /** A new untyped panel in `tabId`, belonging to `originProjectId` when named, else to the layout's project. */
  addPanel(tabId: string, originProjectId?: string): string;
  /**
   * A new untyped panel split beside `targetId`, belonging to `originProjectId` when named, else to the
   * target's project; `null` when the layout does not hold the target.
   */
  addPanelBeside(targetId: string, edge: 'left' | 'right', originProjectId?: string): string | null;
  setPanelType(panelId: string, kind: PanelKind, config: PanelConfig): void;
  setActiveTab(tabId: string): void;
  setActivePanel(tabId: string, panelId: string): void;
}

/** The two bridge calls placement makes. */
export interface PreviewPlacementBridge {
  open(req: PreviewOpenRequest): Promise<PreviewOpenResponse>;
  placeDeclined(requestId: string): void;
}

export type OpenPreviewOutcome =
  | { kind: 'placed'; panelId: string }
  | { kind: 'focused'; panelId: string | null }
  /** 047 US2 (R8) — main navigated an existing standalone run to this file instead of placing a new one. */
  | { kind: 'navigated'; panelId: string }
  | { kind: 'placedElsewhere' }
  | { kind: 'refused'; reason: Extract<PreviewOpenResponse, { kind: 'refused' }>['reason'] }
  /** No preview bridge (a test, the preferences window), or main answered with something unplaceable. */
  | { kind: 'unavailable' };

const panelsOf = (layout: WorkspaceLayout): Panel[] =>
  layout.tabs.flatMap((t) => collectPanels(t.root) as Panel[]);

const tabHolding = (layout: WorkspaceLayout, panelId: string) =>
  layout.tabs.find((t) => collectPanels(t.root).some((p) => p.id === panelId));

/**
 * 047 FR-015 with FR-081 — the preview an open just showed is its tab's Last Active one. Recorded here as
 * well as on the panel's own focus, because an open from File Explorer never gives it the keyboard.
 */
function rememberShown(tabId: string | undefined, panelId: string): void {
  if (tabId !== undefined) recordLastActivePreview(tabId, panelId);
}

/**
 * The editor panel in this window's layout showing `absPath`, or `null` — main's `hasParentLocally`
 * (§1), and the last place a preview can be put beside before it opens standalone (FR-010). The live
 * editor state is read first, the persisted config second, exactly as the header names an editor; paths
 * compare in `normaliseForCompare` form.
 */
function localParentFor(layout: WorkspaceLayout | null, absPath: string): string | null {
  if (layout === null) return null;
  const wanted = normaliseForCompare(absPath);
  const found = panelsOf(layout).find((p) => {
    if (p.kind !== 'editor') return false;
    const path = getEditorState(p.id)?.filePath ?? (p.config as { filePath?: string } | undefined)?.filePath;
    return typeof path === 'string' && normaliseForCompare(path) === wanted;
  });
  return found?.id ?? null;
}

/**
 * Bring `panelId`'s tab to the front, make it the tab's active panel, and move the keyboard into it.
 * `false` when this layout does not hold the panel. Shared with a preview's Go to Editor (`open-in-editor.ts`).
 */
export function focusLocalPanel(
  ws: PreviewPlacementWorkspace,
  layout: WorkspaceLayout,
  panelId: string,
  opts: { keepFocus?: boolean } = {},
): boolean {
  const tab = tabHolding(layout, panelId);
  if (tab === undefined) return false;
  if (layout.activeTabId !== tab.id) ws.setActiveTab(tab.id);
  ws.setActivePanel(tab.id, panelId);
  // 047 FR-081 — shown, not given the keyboard: the pane that asked keeps it.
  if (opts.keepFocus === true) return true;
  setActivePane('workspace');
  // Requested rather than called: a panel in a tab that was just brought forward mounts a commit later,
  // and the registry honours a parked request the moment it registers.
  requestPanelFocus(panelId);
  return true;
}

/**
 * Create and type the preview panel. `beside` names a parent in this layout to split (FR-010);
 * `null` places it standalone in the active tab (FR-011). Returns the new panel's id, or `null` when
 * there was nowhere to put it.
 *
 * The panel belongs to `projectId` — the project main validated the request against — on BOTH routes,
 * never to the layout's. A sub-workspace window's layout belongs to `subworkspace:<id>`, and a preview
 * owned by that attaches as outside every project, is refused, and vanishes (adversarial review I-1).
 */
function placePreview(
  ws: PreviewPlacementWorkspace,
  absPath: string,
  projectId: string,
  reservation: string,
  beside: string | null,
  into: string | null = null,
  keepFocus = false,
): string | null {
  const layout = ws.layout;
  if (layout === null) return null;

  let panelId: string | null;
  let tabId: string | undefined;
  // 047 FR-077 — an empty panel a file was dropped on takes the preview itself: no panel is added.
  const intoPanel = into === null ? undefined : panelsOf(layout).find((p) => p.id === into && p.kind === undefined);
  if (intoPanel !== undefined) {
    panelId = intoPanel.id;
    tabId = tabHolding(layout, intoPanel.id)?.id;
  } else if (beside !== null) {
    tabId = tabHolding(layout, beside)?.id;
    panelId = tabId === undefined ? null : ws.addPanelBeside(beside, 'right', projectId);
  } else {
    tabId = layout.activeTabId ?? undefined;
    panelId = tabId === undefined || !layout.tabs.some((t) => t.id === tabId) ? null : ws.addPanel(tabId, projectId);
  }
  if (panelId === null || tabId === undefined) return null;

  // Before the type, so the attach the preview's mount makes carries it.
  setPreviewReservation(panelId, reservation);
  // This window created this view, so this window ends the preview when it closes it — whichever project
  // the panel belongs to (`forget-preview-panel.ts`, uc-report concern 1). Recorded ON THE PANEL rather
  // than in module state, because the window that must apply the rule after a relaunch is a new process
  // with no memory of this one (review finding 2).
  const config: PreviewPanelConfig = { filePath: absPath, placedInLayoutProjectId: layout.projectId };
  ws.setPanelType(panelId, PREVIEW_KIND, config);
  window.throng?.panel?.notifyTyped?.(panelId, PREVIEW_KIND, config);
  if (layout.activeTabId !== tabId) ws.setActiveTab(tabId);
  ws.setActivePanel(tabId, panelId);
  rememberShown(tabId, panelId);
  // 047 FR-081 — a file activated in File Explorer leaves the keyboard in the tree.
  if (!keepFocus) {
    setActivePane('workspace');
    requestPanelFocus(panelId);
  }
  return panelId;
}

export interface OpenPreviewArgs {
  /**
   * The workspace, or a getter for it. The window's store object is REPLACED on every render, so a
   * caller that outlives a render — the registered opener, awaiting main's answer — passes a getter,
   * and the layout is read after the answer arrives rather than from the object captured before it.
   */
  ws: PreviewPlacementWorkspace | (() => PreviewPlacementWorkspace);
  bridge: PreviewPlacementBridge | undefined;
  intent: PreviewOpenIntent;
  /**
   * 047 US2 (R8) — *editor.previews.openTarget*'s current value, used when `intent.target` does not
   * override it. `PreviewCommands` reads it through a ref so a live settings change applies to the
   * NEXT open rather than one already in flight. Omitted: `'lastActive'`, the setting's own shipped
   * default — so a caller that does not care about this dimension (most of `open-preview.test.ts`,
   * predating US2) need not supply it.
   */
  defaultOpenTarget?: 'lastActive' | 'new';
}

/**
 * A preview panel still standing in tab `tabId` — the renderer's own half of "a live run" (main
 * verifies the rest). The TAB, not the whole layout: a preview recorded here and since dragged into a
 * hidden tab is no longer the visible tab's Last Active one (clarified 2026-09-28).
 */
const isLivePreviewIn = (layout: WorkspaceLayout, tabId: string, panelId: string): boolean => {
  const tab = layout.tabs.find((t) => t.id === tabId);
  return tab !== undefined && collectPanels(tab.root).some((p) => p.id === panelId && p.kind === PREVIEW_KIND);
};

/** Ask main for a preview of `intent.absPath` and carry out its answer in this window. */
export async function openPreview({
  ws: wsOrGetter,
  bridge,
  intent,
  defaultOpenTarget = 'lastActive',
}: OpenPreviewArgs): Promise<OpenPreviewOutcome> {
  if (bridge === undefined) return { kind: 'unavailable' };
  const current = (): PreviewPlacementWorkspace => (typeof wsOrGetter === 'function' ? wsOrGetter() : wsOrGetter);
  const layoutBefore = current().layout;
  const mode = intent.target?.mode ?? defaultOpenTarget;
  // R8 — the visible tab's most recently active preview, still live in THIS window's layout; `null`
  // for `mode: 'new'` (main never consults it there) or a tab/candidate this window no longer holds.
  const tabId = layoutBefore?.activeTabId;
  const reusePanelId =
    mode === 'lastActive' && tabId !== undefined && layoutBefore !== null
      ? candidateFor(tabId, (id) => isLivePreviewIn(layoutBefore, tabId, id))
      : null;
  const request: PreviewOpenRequest = {
    absPath: intent.absPath,
    projectId: intent.projectId,
    ...(intent.requesterPanelId !== undefined ? { requesterPanelId: intent.requesterPanelId } : {}),
    hasParentLocally: localParentFor(layoutBefore, intent.absPath) !== null,
    target: { mode, reusePanelId },
    // 047 FR-081 — main echoes it on the `focus`/`place` message this open may send.
    ...(intent.keepFocus === true ? { keepFocus: true as const } : {}),
  };
  const answer = await bridge.open(request);
  // From here on, the workspace as it is NOW — main's answer may have taken several renders to arrive.
  const ws = current();
  // 047 FR-083 — only a panel this window shows can flash; one in another window is raised by main.
  const shown = (panelId: string, here: boolean): void => {
    if (!here) return;
    if (ws.layout !== null) rememberShown(tabHolding(ws.layout, panelId)?.id, panelId);
    if (intent.flash === true) requestPanelFlash(panelId);
  };

  switch (answer.kind) {
    case 'navigated':
      // R8 — main moved an existing standalone run to this file; bring it forward exactly as `focused`
      // does (FR-015: it is in the visible tab by construction, so no tab-to-front is needed either).
      if (ws.layout !== null) {
        shown(answer.panelId, focusLocalPanel(ws, ws.layout, answer.panelId, { keepFocus: intent.keepFocus === true }));
      }
      return { kind: 'navigated', panelId: answer.panelId };
    case 'placeLocally': {
      const layout = ws.layout;
      if (layout === null) return { kind: 'unavailable' };
      /*
       * Beside the document's panel when this window holds it. Main names the panel its editor registry
       * recorded; if that id is not in this layout (the registry recorded another window's view of the
       * document), the editor that asked stands in, then any editor here showing the file — the case of
       * a request with no requester, from File Explorer. With none of them the preview opens
       * standalone rather than not at all.
       */
      const held = (id: string | null | undefined): id is string =>
        typeof id === 'string' && tabHolding(layout, id) !== undefined;
      let beside: string | null = null;
      if (held(answer.besidePanelId)) beside = answer.besidePanelId;
      else if (answer.besidePanelId !== null) {
        beside = held(intent.requesterPanelId) ? intent.requesterPanelId : localParentFor(layout, intent.absPath);
      }
      const panelId = placePreview(
        ws,
        intent.absPath,
        intent.projectId,
        answer.reservation,
        beside,
        intent.intoPanelId ?? null,
        intent.keepFocus === true,
      );
      if (panelId !== null) shown(panelId, true);
      return panelId === null ? { kind: 'unavailable' } : { kind: 'placed', panelId };
    }
    case 'focused': {
      // `null` is a reservation only: the preview is already being placed. Nothing to look up (§1).
      if (answer.panelId !== null && ws.layout !== null) {
        shown(answer.panelId, focusLocalPanel(ws, ws.layout, answer.panelId, { keepFocus: intent.keepFocus === true }));
      }
      return { kind: 'focused', panelId: answer.panelId };
    }
    case 'placedElsewhere':
      return { kind: 'placedElsewhere' };
    case 'refused':
      return { kind: 'refused', reason: answer.reason };
    default:
      return { kind: 'unavailable' };
  }
}

/**
 * `place` — main asks THIS window to place a preview beside a parent (FR-010). Places it when the
 * layout holds `besidePanelId`; otherwise replies `placeDeclined` so main can try the next window.
 * `besidePanelId: null` is main's last resort, sent to the window that asked, once every window that might
 * hold the parent declined: place it standalone (FR-011) rather than let Open Preview do nothing.
 * Returns whether it placed.
 */
export function handlePreviewPlace(
  ws: PreviewPlacementWorkspace,
  bridge: Pick<PreviewPlacementBridge, 'placeDeclined'> | undefined,
  msg: PreviewPlaceMessage,
): boolean {
  const layout = ws.layout;
  const beside = msg.besidePanelId;
  const keepFocus = msg.keepFocus === true;
  const placed =
    layout === null
      ? null
      : beside === null
        ? placePreview(ws, msg.absPath, msg.projectId, msg.reservation, null, null, keepFocus)
        : tabHolding(layout, beside) !== undefined
          ? placePreview(ws, msg.absPath, msg.projectId, msg.reservation, beside, null, keepFocus)
          : null;
  if (placed === null) {
    bridge?.placeDeclined(msg.requestId);
    return false;
  }
  return true;
}

/** How many frames a fragment scroll waits for the body to draw its headings. */
const HEADING_WAIT_FRAMES = 30;

/**
 * Scroll a preview's body so the heading `fragment` names is at its top (FR-090c). Retried for a few
 * frames, because a preview whose tab was just brought forward mounts, and renders its Markdown, after
 * the focus that asked for it.
 *
 * A MOUNTED preview panel takes the request itself (`preview-panel-handles.ts`): it waits for its body to
 * draw the file and raises `link-missing-heading` when the heading is not there (FR-090c, FR-090e). The
 * frame loop is what remains for a body with no panel around it.
 */
function scrollPreviewToHeading(panelId: string, fragment: string, framesLeft = HEADING_WAIT_FRAMES): void {
  if (revealPreviewFragment(panelId, fragment)) return;
  const body = document.querySelector<HTMLElement>(
    `[data-testid="preview-body-${panelId.replace(/["\\]/g, '\\$&')}"]`,
  );
  const heading = body ? (findHeading(body, fragment) ?? findHeading(body, safeDecode(fragment))) : null;
  if (body && heading) {
    body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
    return;
  }
  if (framesLeft > 0) requestAnimationFrame(() => scrollPreviewToHeading(panelId, fragment, framesLeft - 1));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `focus` — main asks THIS window to bring a preview forward (FR-014), scrolled to a heading when the
 * message names one (FR-090c). Returns whether this window holds the panel.
 */
export function handlePreviewFocus(ws: PreviewPlacementWorkspace, msg: PreviewFocusMessage): boolean {
  const layout = ws.layout;
  if (layout === null || !focusLocalPanel(ws, layout, msg.panelId, { keepFocus: msg.keepFocus === true })) return false;
  rememberShown(tabHolding(layout, msg.panelId)?.id, msg.panelId);
  if (msg.fragment !== undefined && msg.fragment !== '') scrollPreviewToHeading(msg.panelId, msg.fragment);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The registration — one per window realm, held by `PreviewCommands`.
 * ──────────────────────────────────────────────────────────────────────────── */

let opener: ((intent: PreviewOpenIntent) => Promise<OpenPreviewOutcome>) | null = null;

/** Register (or clear, with `null`) how this window opens a preview. */
export function registerPreviewOpener(
  open: ((intent: PreviewOpenIntent) => Promise<OpenPreviewOutcome>) | null,
): void {
  opener = open;
}

/**
 * The `preview.open` command (FR-005). Every entry point calls this — most fire-and-forget, so the
 * `Promise<boolean>` this resolves to is there for the one caller that cares (044 US4 fix round 1, item
 * 5): the default-open-action router (`open-router.ts`), which Quick Open reads to decide whether to
 * remember its query (033 FR-061) and move the caret. `false` covers both a REFUSAL main sends back and
 * a window with no registered opener — either way nothing opened.
 */
export async function requestPreviewOpen(intent: PreviewOpenIntent): Promise<boolean> {
  const outcome = await requestPreviewOpenOutcome(intent);
  return outcome.kind !== 'refused' && outcome.kind !== 'unavailable';
}

/**
 * The same command, answering WHAT happened rather than whether anything did. A caller that made a place
 * for the preview before asking (050 FR-038: the + drop's new tab) must know whether the preview landed
 * THERE — `placed` — or main focused an existing one, placed it in another window, or refused.
 */
export async function requestPreviewOpenOutcome(intent: PreviewOpenIntent): Promise<OpenPreviewOutcome> {
  if (!opener) return { kind: 'unavailable' };
  return opener(intent);
}
