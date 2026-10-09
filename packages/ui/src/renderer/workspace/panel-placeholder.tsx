import { useEffect, useRef, type ReactElement } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { dragFromNonInteractive } from './drag-handle.js';
import {
  canGoBack,
  canGoForward,
  collectPanels,
  countPanels,
  defaultPanelTypeRegistry,
  editorPathParts,
  panelDisplayTitle,
  panelRemovalVerb,
  previewTitleParts,
  PREVIEW_KIND,
  toDisplayPath,
  effectiveActivePanelId,
  panelZoomLevel,
  findPanelLocations,
  planConfirmations,
  type Edge,
  type Panel,
} from '@throng/core';
import { PanelBody } from './panel-body.js';
import { panelHeaderMenu, removalVerbFor } from './panel-header-menu.js';
import { placeholderContentMenu, splitMenuItems } from './split-menu.js';
import { useSplitMode } from './split-mode.js';
import { registerPanelDestroy } from './panel-destroy.js';
import { isKeyboardMenu } from './keyboard-menu.js';
import { usePreviewFailure, usePreviewState } from '../preview/preview-store.js';
import { usePreviewProviders } from '../preview/provider-registry-context.js';
import { releasePreviewView } from '../preview/forget-preview-panel.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import { runPreviewEditorRoute } from '../preview/open-in-editor.js';
import { refreshPreviewPanel } from '../preview/refresh-preview.js';
import { toggleSyncScroll } from '../preview/sync-scroll-toggle.js';
import { shownPreviewFailure, shownPreviewFailureFacts } from '../preview/preview-notice.js';
import { useEditorPreviewAffordance } from '../editor/editor-preview.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useServices } from '../composition-root.js';
import { useConfirm } from '../confirm-dialog.js';
import { panelFailureText } from '../common/notice-text.js';
import { retryPanelFailure } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import { useCopyToClipboard } from '../common/use-copy.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import {
  getFindSession,
  openFind,
  replaceAll as replaceAllMatches,
  type FindPanelKind,
} from '../search/search-store.js';
import { requestRedraw } from '../terminal/redraw.js';
import { focusTerminal } from '../terminal/focus-registry.js';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { panelHasLiveTerminal, panelHasRunningSubprocess } from './subprocess.js';
import { useCapabilities } from '../panel-type/use-capabilities.js';
import { useDetach } from './detach-context.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { destroySubWorkspace } from './destroy-sub-workspace.js';
import { edgeDropId, panelDragId, useDragState } from './drag-state.js';
import { setActivePane, useActivePane } from './active-pane.js';
import { useWindowFocus } from './use-window-focus.js';
import { usePanelFlash } from './panel-flash.js';
import { useTerminalCommandVersion } from '../terminal/command-store.js';
import { useTerminalCwdVersion } from '../terminal/cwd-store.js';
import { terminalTitleSource, useTerminalTitleContextVersion } from '../terminal/title-context.js';
import { useTerminalTitle } from '../terminal/title-store.js';
import { useEditorFailure } from '../editor/editor-failure.js';
import { useEditorState } from '../editor/editor-state.js';
import { setLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorActions } from '../editor/editor-actions.js';
import { clearEditorPanelType } from '../editor/clear-editor-panel-type.js';
import { disposeEditor } from '../editor/use-editor.js';
import { destroyPanelSearch } from '../search/search-store.js';
import { openPreviewHeadingOutline } from '../preview/preview-panel-handles.js';
import { destroyFindInFilesPanel } from '../find-in-files/find-in-files-store.js';
import { clearTerminalViewState } from '../terminal/terminal-view-state.js';
import { promptDirtyClose } from '../editor/dirty-close-store.js';
import { revealPanelFile } from './reveal-panel-file.js';
import { BackForwardButtons } from '../navigation/back-forward-buttons.js';
import { usePanelHistory } from '../navigation/history-store.js';
import { navigatePanelHistory } from '../navigation/navigate-history.js';
import { purgePanelHistory } from '../navigation/purge-history.js';

const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];

function EdgeDropZone({ panelId, edge }: { panelId: string; edge: Edge }): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: edgeDropId(panelId, edge) });
  return (
    <div
      ref={setNodeRef}
      className={`edge-zone edge-zone--${edge}${isOver ? ' edge-zone--over' : ''}`}
      data-testid={`edge-${edge}-${panelId}`}
      aria-hidden
    />
  );
}

/**
 * An untyped placeholder Panel (FR-015): the atomic, draggable content unit with
 * an empty body. The header is the drag handle (move/split). While another Panel
 * is being dragged, four edge drop-zones appear so a drop produces a split
 * (FR-014/018). Header buttons add a sibling Panel or close this one.
 */
export function PanelPlaceholder({ panel, tabId }: { panel: Panel; tabId: string }): ReactElement {
  const ws = useWorkspace();
  const { activeProject, projects } = useProjects();
  const confirm = useConfirm();
  const { openMenu, openId } = useContextMenu();
  const addMenuWasOpen = useRef(false);
  /** The opening id of the split menu THIS + last opened — only that one is the + 's to toggle shut (R6). */
  const addMenuOpId = useRef<number | null>(null);
  const settings = useAppSettings();
  const detach = useDetach();
  const subWin = useSubWorkspaceWindow();
  const services = useServices();
  /** Where this panel lives, for any notice raised about it (030 FR-022). */
  const place = usePanelPlace(panel.id);
  const { elevated } = useCapabilities();
  const { draggingPanelId } = useDragState();
  // The live chords, so a rebind moves what the menu SHOWS as well as what the key does.
  const keybindings = useKeybindings();

  // Inside a sub-workspace window, each Panel shows which project it belongs to:
  // its origin project's name + colour, or — for a Panel created in the
  // sub-workspace (no project) — the sub-workspace's own name + colour (FR-005).
  // The active-Panel outline uses the same colour so the dominant context reads
  // per-Panel here (a sub-workspace may mix projects); the main window keeps using
  // the single active project's colour.
  const originProject = subWin ? projects.find((p) => p.id === panel.originProjectId) ?? null : null;
  const ownerLabel = subWin
    ? { name: originProject?.name ?? subWin.name, colour: originProject?.colour ?? subWin.colour }
    : null;
  const activeColour = subWin ? ownerLabel?.colour : activeProject?.colour;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: panelDragId(panel.id),
  });

  const showZones = draggingPanelId !== null && draggingPanelId !== panel.id;

  // Editor Panels surface a `filename (relative folder)` pill + the shared unsaved
  // dot (006). Non-editor Panels have no editor state, so this stays undefined.
  const editorUi = useEditorState(panel.id);
  /**
   * What an unreadable editor's failure banner is about (030 FR-042c/FR-052).
   *
   * The SAME assembly the banner uses (`editor/editor-failure.ts`), so *Copy details* here and
   * *Copy details* on the banner put identical text on the clipboard. `null` while the panel is
   * fine, which is what the three failure commands below are gated on.
   */
  const editorFailure = useEditorFailure(panel.id);
  const copyToClipboard = useCopyToClipboard();
  // The editor pill's fully-qualified path (or name), per the per-ownership setting
  // (FR-088), with native OS separators (FR-101). Split into a truncatable directory
  // prefix + always-visible name.
  const os = window.throng?.osName ?? 'windows';
  const filePill =
    editorUi?.filePath != null
      ? editorPathParts(
          editorUi.filePath,
          editorUi.ownerRoot,
          editorUi.ownerKind,
          editorUi.ownerKind === 'subworkspace'
            ? settings.editor.subWorkspacePathDisplay
            : settings.editor.projectPathDisplay,
          os,
        )
      : null;

  // The Panel is "active" (highlighted) when it is its Tab's effective active
  // Panel (FR-002). Clicking anywhere in the Panel activates it.
  const ownTab = ws.layout?.tabs.find((t) => t.id === tabId);
  const isActive = ownTab ? effectiveActivePanelId(ownTab) === panel.id : false;
  // Two-state focus context (012, FR-002): the active-panel indicator is drawn in
  // the foreground treatment when this window is the foreground OS window, and a
  // dimmed inactive treatment when it is background — it persists in both, never
  // disappearing (SC-001a). Distinct from the OS focus/raise group.
  const windowForeground = useWindowFocus();
  // 047 FR-083 — a file opened from File Explorer landed here: flash the border to say so.
  const flashKey = usePanelFlash(panel.id);
  const inSplitMode = useSplitMode(panel.id);
  // 046 FR-121 (S28) — the treatment (both states) shows only while the WORKSPACE holds the active
  // pane; from the Projects pane or the File Explorer the side pane's own outline is the only active
  // indication. The tab's active panel id is untouched, so every route back lights this same panel.
  // A torn-off window never sets the active pane, so it stays 'workspace' there.
  const workspaceHoldsPane = useActivePane() === 'workspace';
  const showsActive = isActive && workspaceHoldsPane;
  const isActiveDimmed = showsActive && !windowForeground;
  // US10 (#89): a terminal's live window title is one of the values its name can be rendered from.
  const terminalTitle = useTerminalTitle(panel.id);
  // 053 FR-001, FR-013 — and the others: the observed command, the working directory (which the
  // header used to draw as a separate element, 012) and the template with its limits. Subscribed for
  // the re-render only; `terminalTitleSource` below reads the values.
  useTerminalCommandVersion();
  useTerminalCwdVersion();
  useTerminalTitleContextVersion();
  // The file path an editor names itself after: the live editor state when it has registered, and
  // the panel's own `config.filePath` otherwise (#97 follow-up). `setPanelType(editor, …)` writes
  // the path onto the panel synchronously, while `editorUi` registers a beat later when the
  // CodeMirror view mounts — so a freshly opened editor would show its placeholder until that
  // landed. The config also backstops a restored editor whose live state has no path yet (#218).
  const editorFilePath =
    editorUi?.filePath ?? (typeof panel.config?.filePath === 'string' ? panel.config.filePath : null);
  // The name shown in the header and its hover tooltip. The rule lives in core (`panelDisplayTitle`)
  // so it can be asserted without launching the application, and so the header, the tooltip and any
  // future surface that has to name a panel cannot drift apart: the title is always derived — the
  // live/secondary automatic source for the panel's kind (048: panels are not renamable), then the
  // placeholder — which is correct only while the panel is untyped.
  //
  // 031 US4 (N8, T093) — the limit is applied HERE, at the one place every panel-name source is
  // resolved. `panelDisplayTitle` bounds its RESULT, so a live shell title, a flavour
  // label and a file path (there is no user override any more, 048) are all shortened by the same rule.
  // The unbounded form is computed alongside purely to decide whether the ellipsis is drawn; the
  // marker itself is a `::after` (FR-037c), so it never enters the value or anything persisted.
  const maxNameLength = settings.tabs.maxNameLength;
  /*
   * 044 — what a PREVIEW panel mirrors of its run (`preview-store`, fed by main's updates). Read for
   * every panel because hooks cannot be conditional; only a preview ever has an entry, and every use
   * below is gated on the kind as the editor's state is (see the unsaved-dot note).
   */
  const isPreview = panel.kind === PREVIEW_KIND;
  const previewUi = usePreviewState(panel.id);
  // A preview failure the banner shows that main's update does not carry (attach, body load). Only a
  // preview ever records one.
  const previewFailure = usePreviewFailure(panel.id);
  /*
   * 044 T123 — the failure the preview's ONE banner slot shows right now: an attach or body failure, or a
   * file notice (FR-026, FR-027), ranked exactly as the panel ranks them (`shownPreviewFailure`). The header
   * menu mirrors THAT banner: its three rows appear while it offers them, and Copy details copies its text.
   */
  const previewBanner = isPreview ? shownPreviewFailure(previewUi, previewFailure) : null;
  // The file the preview shows NOW — a followed link moves it — else the one it was opened on.
  const previewFilePath = isPreview ? (previewUi?.filePath ?? editorFilePath ?? null) : null;
  const { registry: previewRegistry } = usePreviewProviders();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  /*
   * 044 FR-100 — only an editor and a preview have a navigation history. Its mirror (`history-store`, fed by
   * main's broadcast) decides whether Back and Forward are enabled, on the buttons and the menu alike.
   */
  const hasHistory = panel.kind === 'editor' || isPreview;
  const panelHistory = usePanelHistory(panel.id);
  /**
   * The mouse X-button pressed over THIS panel and not yet released (FR-105, fix round 1 item 5). Cleared by
   * any release anywhere: the window's own `mouseup` listener runs after this panel's handler (React listens
   * at the root, below the window), so a release elsewhere disarms it before a stray release here could fire.
   */
  const xButtonPress = useRef<number | null>(null);
  useEffect(() => {
    if (!hasHistory) return;
    const disarm = (): void => {
      xButtonPress.current = null;
    };
    window.addEventListener('mouseup', disarm);
    return () => window.removeEventListener('mouseup', disarm);
  }, [hasHistory]);
  // FR-031 — a standalone preview names itself after the file the RUN shows (a followed link moves it),
  // falling back to the persisted config inside `panelDisplayTitle`. A PARENTED preview takes its
  // parent editor's displayed name, which main forwards on each update as `parent.title` (published by
  // `EditorTitlePublisher`), so it follows a rename of that editor live.
  const terminalSource = terminalTitleSource(panel);
  const titleSources = {
    terminalTitle,
    editorFilePath,
    ...(terminalSource ? { terminal: terminalSource } : {}),
    ...(isPreview ? { previewFilePath: previewUi?.filePath, previewParentTitle: previewUi?.parent?.title } : {}),
  };
  /*
   * 044 FR-001/FR-002/FR-004 — an editor's Open Preview affordance, against the editor's OWN project
   * root: a panel whose origin project is not a registered project (a sub-workspace's own) has none,
   * and is offered no preview. Computed for every panel because hooks cannot be conditional; only an
   * editor passes it to the menu.
   */
  const editorProjectRoot = projects.find((p) => p.id === panel.originProjectId)?.rootFolder ?? null;
  const editorPreview = useEditorPreviewAffordance(
    panel.kind === 'editor' ? editorUi?.filePath : null,
    editorProjectRoot,
  );
  const fullTitle = panelDisplayTitle(panel, titleSources);
  const effectiveTitle = panelDisplayTitle(panel, titleSources, maxNameLength);
  const titleTruncated = effectiveTitle !== fullTitle;
  /*
   * FR-032 — a preview's title in its two halves, so the header's truncation marker lands on the NAME
   * (`name… - Preview`). The generic `--truncated` class draws its `…` after the whole title, which for
   * a preview would read `name - Preview…` and mark the one half that is never cut.
   */
  const previewTitle = previewTitleParts(panel, titleSources, maxNameLength);

  // Removal verb per ownership + location (011, FR-030/031). The rule itself lives in core
  // (`panelRemovalVerb`) with the reasoning and all four combinations asserted there — it is
  // two booleans in, one of two verbs out, and as a ternary here it could only be read by
  // launching the app and hovering a tooltip. This mirrors the owner-label logic above.
  // 044 FR-033 — a preview is always Closed; `removalVerbFor` is the menu's own rule, so the ✕ and the
  // menu cannot name the same action two ways.
  const panelVerb = removalVerbFor(
    panel,
    panelRemovalVerb({
      inSubWorkspace: subWin !== null,
      hasOriginProject: originProject !== null,
    }),
  );

  // Shared Destroy Panel flow (FR-020/022/023) used by the header ✕ and the
  // context menu. A confirmation is shown only when the Panel hosts a live
  // terminal; a plain/empty Panel is removed immediately.
  const destroyPanel = async (): Promise<void> => {
    // Dirty-editor guard (FR-006a): destroying a Panel with unsaved editor content
    // prompts save/discard/cancel before anything else. Cancel aborts entirely.
    const editorActions = getEditorActions(panel.id);
    if (editorActions?.isDirty()) {
      const name = editorUi?.displayName ?? panel.title;
      const choice = await promptDirtyClose(name, editorUi?.filePath ? [name] : [], {
        movedOut: editorUi?.movedOut === true,
      });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        // A moved-out editor cannot Save (050 FR-036): "save" there is Save As, and a cancelled one aborts.
        const ok = await editorActions.saveForClose();
        if (!ok) return; // save failed/cancelled → don't destroy (no silent loss)
      }
    }

    const active = panelHasRunningSubprocess(panel.id);
    const plan = planConfirmations('panel', settings.confirmations, { panelActive: active });

    // Destroy cascade is ONE-directional (clarified 2026-07-01, FR-026): destroying a
    // Panel in the PROJECT removes it from every sub-workspace mirroring it; destroying
    // it inside a SUB-WORKSPACE is LOCAL — it only leaves that sub-workspace, the
    // project (and any other view) keeps its Panel. `subWin` is non-null only in a
    // sub-workspace window, so the cascade + warning apply only in the main window.
    const inSubWorkspace = subWin !== null;
    // Revision (2026-07-02): a local sub-workspace destroy of a CLONED project Panel
    // must NOT kill the shared terminal session — the project keeps the Panel and its
    // live terminal (FR-021); only this window's view goes away. An OWNED
    // sub-workspace Panel (it carries the window's synthetic project id) has no other
    // view, so destroying it does take its session down.
      // NOTE: this uses the synthetic-project-id predicate, whereas the header/menu
    // `panelVerb` (above) keys off `originProject` (found in the projects list). The
    // two agree in every normal case; they can only diverge if a mirrored Panel's
    // backing project is unregistered while its sub-workspace view is still open —
    // an extreme edge with no correctness impact on the session-kill decision here.
    const ownedBySub = inSubWorkspace && panel.originProjectId === ws.layout?.projectId;
    const killsSession = !inSubWorkspace || ownedBySub;
    // The same question for the preview routes (`viewEndsPreview`), which answer it from the PANEL as
    // well as the place: a preview this window opened is its to end whichever project it belongs to.
    const previewPlace = { inSubWorkspace, layoutProjectId: ws.layout?.projectId };
    const activeMessage = killsSession
      ? `Destroy “${panel.title}”? Its running terminal will be terminated.`
      : `Destroy “${panel.title}”? Its terminal keeps running in the project.`;

    // Closing the LAST Panel of a sub-workspace closes the whole sub-workspace
    // (FR-029): the removePanel op keeps the workspace non-empty, so here the ✕
    // would otherwise no-op. Destroy the sub-workspace instead (with a warning).
    const totalPanels = ws.layout
      ? ws.layout.tabs.reduce((n, t) => n + countPanels(t.root), 0)
      : 0;
    if (subWin !== null && totalPanels <= 1) {
      const ok = await confirm({
        title: 'Destroy sub-workspace',
        message: active ? activeMessage : `Destroy “${panel.title}”?`,
        warningMessage: `This is the last panel in “${subWin.name}” — destroying it destroys the sub-workspace (project-owned panels it mirrored are merely closed).`,
        confirmLabel: 'Destroy sub-workspace',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      if (killsSession && panelHasLiveTerminal(panel.id)) {
        void window.throng?.terminal?.kill?.(panel.id);
        clearTerminalViewState(panel.id); // the session is gone — don't leak its saved scroll/selection
      }
      // 044 FR-042/FR-110 — this return skips the per-kind cleanup below, so a preview is ended here.
      releasePreviewView(panel, previewPlace);
      // 044 FR-110 (fix round 1, item 7) — and its history, when the sub-workspace owned the panel.
      if (killsSession) purgePanelHistory(panel);
      await destroySubWorkspace(services.subWorkspaces, subWin.id);
      return;
    }
    const subLocations =
      !inSubWorkspace && detach ? findPanelLocations(detach.subWorkspaces, panel.id) : [];
    const subNames = detach
      ? subLocations.map((id) => detach.subWorkspaces.find((s) => s.id === id)?.name ?? id)
      : [];
    const warningMessage =
      subNames.length > 0
        ? `This panel also appears in ${subNames.length} sub-workspace${
            subNames.length === 1 ? '' : 's'
          } (${subNames.join(', ')}). Destroying it removes it from all of them.`
        : undefined;
    const cascades = warningMessage !== undefined;

    // A project-owned Panel closed from a sub-workspace uses "Close" wording; the
    // active-terminal message already reflects that its session keeps running.
    const closeActiveMessage = killsSession
      ? activeMessage
      : `Close “${panel.title}”? It leaves this sub-workspace; its terminal keeps running in the project.`;
    if (plan.dialogs > 0 || cascades) {
      const ok = await confirm({
        title: `${panelVerb} Panel`,
        message: active ? (panelVerb === 'Close' ? closeActiveMessage : activeMessage) : `${panelVerb} “${panel.title}”?`,
        warningMessage,
        confirmLabel: `${panelVerb} Panel`,
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: killsSession
          ? `This destroys “${panel.title}” and terminates its running terminal.`
          : `This closes “${panel.title}” here (its terminal keeps running in the project).`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }
    // Destroying a Terminal Panel terminates its live session once (FR-018) — but a
    // LOCAL sub-workspace destroy of a CLONED project Panel leaves the shared session
    // running (only this view detaches, FR-021); `killsSession` captures that.
    if (killsSession && panelHasLiveTerminal(panel.id)) {
      void window.throng?.terminal?.kill?.(panel.id);
    }
    // Tear down the editor document (release the dirty-file lock, drop the recovery
    // temp, free the one-buffer registry) whenever this destroy removes the document
    // for good: from the project, OR a sub-workspace-OWNED editor whose only view is
    // this one (`killsSession`). A LOCAL destroy of a *synced* project editor keeps
    // the document alive in the project, so it must NOT dispose (FR-006a / FR-021).
    if (panel.kind === 'editor' && killsSession) disposeEditor(panel.id);
    /*
     * 044 FR-042 — a preview ends with no prompt and without touching its source document: it owns
     * neither, so there is nothing to ask about (the dirty guard above finds no editor actions for it).
     * Gated on `killsSession`'s rule for the editor's reason — a LOCAL close of a synced project preview
     * inside a sub-workspace leaves the preview alive in the project, and main must keep its run.
     */
    releasePreviewView(panel, previewPlace);
    /*
     * 044 FR-110 — the panel no longer exists, so neither does its history. Under `killsSession`'s rule for
     * the editor's reason: a LOCAL close of a synced project panel leaves the panel — and its one history —
     * alive in the project. A preview's `destroyed` above already purges in main; this is idempotent.
     */
    if (killsSession) purgePanelHistory(panel);
    // The find session goes with the Panel, whatever kind it was and whether or not this destroy
    // killed the underlying session (043 FR-006): the Panel is leaving THIS window's layout, so
    // its bar can never be shown again here. A terminal has no `disposeEditor` to ride on.
    destroyPanelSearch(panel.id);
    /*
     * 043 FR-023 — a Find in Files panel's RESULTS die with the panel, exactly as closing the
     * application discards them. There is no retention store and no eviction policy to reach for:
     * the state is dropped here, so a panel opened afterwards starts with none.
     *
     * Unconditional, and NOT gated on `killsSession`: a sub-workspace view closing takes this
     * window's copy of the results with it, and FR-027 keeps the parent panel — which has its own
     * copy in its own window's store — entirely unaffected.
     *
     * That last claim is only true because MAIN keys a scan run by `(webContentsId, panelId)`. A
     * synced view carries the SAME panel id, so with the id alone as the key this drop would have
     * released the parent window's run — the scan it was watching run.
     */
    destroyFindInFilesPanel(panel.id);
    /*
     * 044 FR-064 — `removePanel` keeps the workspace's LAST panel, which would leave a preview whose run
     * main has just dropped: a preview of nothing. Clearing its type first makes that case an empty
     * panel, the same order `panel-body`'s FR-067 refusal uses; any other close removes it as before.
     */
    if (isPreview) ws.clearPanelType(panel.id);
    ws.removePanel(panel.id);
    // Cascade to the sub-workspaces ONLY when destroying from the project (FR-026).
    // A sub-workspace destroy stays local (no broadcast → the project is untouched).
    if (!inSubWorkspace) window.throng?.panel?.notifyDestroyed?.(panel.id);
  };
  /*
   * 048 FR-131 — the `panel.destroy` chord reaches THIS flow through the shared opener, never a copy
   * of it. Registered once per panel id; the ref keeps the callback reading this render's state (the
   * flow closes over settings, the layout and the sub-workspace context).
   */
  const destroyRef = useRef(destroyPanel);
  destroyRef.current = destroyPanel;
  useEffect(() => registerPanelDestroy(panel.id, () => void destroyRef.current()), [panel.id]);

  return (
    <div
      className={`panel-box${isDragging ? ' panel-box--dragging' : ''}${showsActive ? ' panel-box--active' : ''}${isActiveDimmed ? ' panel-box--active-dimmed' : ''}`}
      data-testid={`panel-${panel.id}`}
      data-panel-id={panel.id}
      /* 046 fix round (IMPORTANT review finding) — a marker ONLY the panel host itself emits, for
         `mouse-zoom.ts`'s `closest()` lookup. `data-panel-id` is also a test hook elsewhere in the
         app (`notification.tsx`'s notice rows, FR-038) — an element that carries it purely to be
         found by a test is not a panel, and a Ctrl+wheel over it must not zoom whatever panel it
         names. Same value, so nothing downstream needs a second read. */
      data-panel-host={panel.id}
      data-active={isActive}
      data-active-dimmed={isActiveDimmed}
      data-zoom={panelZoomLevel(panel)}
      onPointerDown={() => {
        ws.setActivePanel(tabId, panel.id);
        setActivePane('workspace'); // a workspace Panel is now active (gates Ctrl+S)
        if (panel.kind === 'editor') setLastActiveEditor(tabId, panel.id); // FR-010
        /*
         * 028 (issue 200) — move focus into the terminal NOW, in the pointer-down handler itself.
         *
         * The reported defect is that clicking into an idle terminal and typing immediately loses
         * the first character: the shell receives `it status` for a typed `git status`. Focus used
         * to arrive by two later routes — a mount-time call, and one after the async attach resolves
         * — so a key pressed in the same beat as the click reached document.body instead of xterm's
         * hidden textarea, and was simply gone. Nothing downstream can recover it, because it never
         * became terminal input at all.
         *
         * Pointer-down is the earliest moment the intent is known, and this call is synchronous, so
         * the textarea holds focus before the keydown that follows the click can be dispatched.
         */
        if (panel.kind === 'terminal') focusTerminal(panel.id);
      }}
      /*
       * 044 FR-105 — the mouse's back (3) and forward (4) buttons over an editor or a preview step THIS panel,
       * the one under the pointer, whichever panel has focus. Default-prevented on both press and release, so
       * nothing else — Chromium's own history navigation included — acts on them. Performed on release, and
       * only when the PRESS was on this panel too (fix round 1, item 5): a press over one panel released over
       * another is a gesture that went nowhere, as a click is. `mouseup` rather than `auxclick`, which needs
       * no press record, because whether Chromium sends `auxclick` for the X-buttons is not something a test
       * here can establish. Any other panel kind leaves the buttons alone.
       */
      onMouseDown={hasHistory ? (e) => {
        if (e.button !== 3 && e.button !== 4) return;
        e.preventDefault();
        xButtonPress.current = e.button;
      } : undefined}
      onMouseUp={hasHistory ? (e) => {
        if (e.button !== 3 && e.button !== 4) return;
        e.preventDefault();
        const pressedHere = xButtonPress.current === e.button;
        xButtonPress.current = null;
        if (pressedHere) void navigatePanelHistory(wsRef.current, panel.id, e.button === 3 ? 'back' : 'forward');
      } : undefined}
      // The dominant project/owner colour marks the active panel only while the
      // window is foreground (Principle VI); when the window is background the
      // CSS dimmed-inactive token takes over so no runtime colour hides it.
      style={showsActive && windowForeground && activeColour ? { outlineColor: activeColour } : undefined}
    >
      <div
        ref={setNodeRef}
        className="panel-box__header"
        data-testid={`panel-handle-${panel.id}`}
        /*
         * 017 / #57 — the TITLE, not a list of instructions.
         *
         * `.panel-box__title` is ellipsized, so hovering the header is the only way to read a long
         * panel name in full — and this tooltip used to spend itself on "Click: Activate · Drag:
         * Move · …", withholding the one thing it existed to give. The interactions remain
         * discoverable from the right-click menu, which is where they belong.
         *
         * The title goes on the HEADER rather than on the inner span: put it on the span and the
         * tooltip would change meaning as the pointer moved two pixels sideways.
         */
        title={fullTitle}
        onContextMenu={(e) => {
          e.preventDefault();
          const others = (ws.layout?.tabs ?? []).filter((t) => t.id !== tabId);
          // 033 US5 (T062) — the items live in `panel-header-menu.ts`, which declares their
          // sections; `ContextMenu` derives the dividers from those. This handler supplies the
          // panel's state and the action bodies that need the confirm dialog, the clipboard and the
          // workspace store, and decides nothing about order or grouping.
          openMenu(
            e.clientX,
            e.clientY,
            panelHeaderMenu({
              panel,
              panelVerb,
              keybindings,
              otherTabs: others,
              editor:
                panel.kind === 'editor'
                  ? // Truthiness, NOT `!= null`. The inline menu this was extracted from wrote
                    // `disabled: !editorUi?.filePath` and gated the two reveal items on the same
                    // test, so an empty string disabled Reload from disk and drew neither reveal
                    // item. `EditorUiState.filePath` is typed `string | null` and nothing narrows
                    // it further, so `''` is a value the type admits even though no path in the
                    // app produces one today — and under `!= null` it would enable Reload and draw
                    // two reveal items for a panel with no file. N6: the extraction alters no
                    // condition.
                    {
                      dirty: editorUi?.dirty ?? false,
                      hasFilePath: !!editorUi?.filePath,
                      movedOut: editorUi?.movedOut === true,
                    }
                  : null,
              // 044 — true while an editor's banner is up, or a preview's banner offering the three commands:
              // an attach or body failure, or an FR-026 file notice. The FR-027 notice (no preview for this
              // file type) offers Close alone — the menu's own Close Panel — so none of the three is added.
              panelFailure: editorFailure !== null || previewBanner?.offers === 'retry',
              // 044 FR-033 — a preview's provider KIND (never its identity) and whether it is parented.
              preview: isPreview
                ? {
                    // The run's provider once an update has named it; before that, whichever provider
                    // claims the persisted file (`editorFilePath` reads `config.filePath` for any kind).
                    providerKind:
                      (previewUi ? previewRegistry.get(previewUi.providerId) : undefined)?.kind ??
                      previewRegistry.forPath(previewUi?.filePath ?? editorFilePath ?? '')?.kind ??
                      'text',
                    parented: previewUi?.parent != null,
                  }
                : null,
              // 044 FR-002 — an editor's Open Preview, from the same affordance its status-bar button uses.
              ...(panel.kind === 'editor' ? { openPreview: editorPreview } : {}),
              // 044 FR-122b — checked from the setting; WHERE it is drawn follows the affordance above (an
              // editor) or the provider kind (a preview), inside the builder.
              syncScroll: settings.editor.previews.syncScroll,
              // 044 FR-111 — Back / Forward enabled exactly as the header buttons are, from the mirrored history.
              history: hasHistory && panelHistory ? { canGoBack: canGoBack(panelHistory), canGoForward: canGoForward(panelHistory) } : null,
              detach: detach
                ? {
                    subWorkspaces: detach.subWorkspaces.map((s) => ({
                      id: s.id,
                      name: s.name,
                      alreadyHasPanel: s.tabs.some((t) =>
                        collectPanels(t.root).some((p) => p.id === panel.id),
                      ),
                      tabs: s.tabs.map((t) => ({ id: t.id, title: t.title })),
                    })),
                    detachToNew: () => detach.detachToNew('panel', panel.id),
                    syncToExisting: (subWorkspaceId, targetTabId) =>
                      detach.syncToExisting('panel', panel.id, subWorkspaceId, targetTabId),
                  }
                : null,
              actions: {
                split: (direction) => {
                  ws.splitPanel(tabId, panel.id, direction);
                },
                zoomIn: () => ws.bumpZoom(panel.id, 1),
                zoomOut: () => ws.bumpZoom(panel.id, -1),
                resetZoom: () => ws.resetZoom(panel.id),
                save: () => {
                  void getEditorActions(panel.id)?.save();
                },
                saveAs: () => {
                  void getEditorActions(panel.id)?.saveAs();
                },
                revert: () => {
                  void (async () => {
                    const ok = await confirm({
                      title: 'Revert changes',
                      message: `Discard all unsaved changes to “${editorUi?.displayName ?? panel.title}”? This cannot be undone.`,
                      confirmLabel: 'Revert',
                      cancelLabel: 'Cancel',
                      danger: true,
                    });
                    if (ok) getEditorActions(panel.id)?.revert();
                  })();
                },
                reloadFromDisk: () => {
                  void (async () => {
                    // Unsaved edits are the only copy — a reload discards them, so it asks
                    // first. A clean document has nothing to lose and is not interrupted.
                    if (editorUi?.dirty) {
                      const ok = await confirm({
                        title: 'Reload from disk',
                        message: `Discard unsaved changes to “${editorUi?.displayName ?? panel.title}” and load what is on disk now? This cannot be undone.`,
                        confirmLabel: 'Reload',
                        cancelLabel: 'Cancel',
                        danger: true,
                      });
                      if (!ok) return;
                    }
                    await getEditorActions(panel.id)?.reloadFromDisk();
                  })();
                },
                revealInTree: () => {
                  window.dispatchEvent(
                    new CustomEvent('throng:reveal-in-tree', {
                      // 044 T123 — a preview reveals the file IT shows; it has no editor state to read.
                      detail: { absPath: isPreview ? (previewFilePath ?? undefined) : editorUi?.filePath },
                    }),
                  );
                },
                // #273 — the panel's OWN absolute path. See `revealPanelFile` for what this used to
                // do and why a root-relative path was wrong in two directions at once. A preview's is the
                // file it shows, which main's confinement check accepts (menus-and-controls.md §1).
                openInOsExplorer: () => {
                  revealPanelFile(isPreview ? previewFilePath : editorUi?.filePath, window.throng?.files);
                },
                /*
                 * The BANNER'S retry, not a second call to the same operation.
                 *
                 * This used to run `reloadFromDisk()` directly, which is the same re-read and
                 * therefore looked equivalent — but it bypassed the banner's retry state entirely,
                 * so FR-045 ("a failed retry remains and says so") held on the button and nowhere
                 * else. Retrying from the menu left the banner standing in silence.
                 */
                tryAgain: () => {
                  retryPanelFailure(panel.id);
                },
                // 039 FR-024/FR-025 (#293). The SAME action the dormant placeholder's button runs —
                // clearing the flag is what mounts `TerminalPanel`, so both routes go through the
                // one start path rather than the menu having a shortcut of its own.
                reloadTerminal: () => {
                  ws.setPanelDormant(panel.id, false);
                },
                copyDetails: () => {
                  if (editorFailure) {
                    copyToClipboard(panelFailureText(editorFailure), editorFailure.subject);
                  } else if (previewBanner) {
                    // 044 — the facts of the preview banner ON SCREEN (a failure's, or a file notice's),
                    // assembled the way that banner assembles them, so the two copies are identical.
                    const subject = panelSubject(place);
                    const facts = shownPreviewFailureFacts(previewBanner, previewUi?.filePath, os);
                    copyToClipboard(panelFailureText({ ...facts, subject }), subject);
                  }
                },
                clearPanelType: () => {
                  /*
                   * 044 T123 — on a preview, the banner's Clear panel type: no prompt (a preview owns no
                   * document, FR-042), and `preview.destroyed` FIRST when this view ends the preview, so
                   * main drops the run and every window hears the file has no preview (FR-012) — then the
                   * type is cleared and the panel stays (030 FR-043).
                   */
                  if (isPreview) {
                    releasePreviewView(panel, {
                      inSubWorkspace: subWin !== null,
                      layoutProjectId: ws.layout?.projectId,
                    });
                    ws.clearPanelType(panel.id);
                    return;
                  }
                  void clearEditorPanelType(panel.id, {
                    dirty: editorUi?.dirty ?? false,
                    name: editorUi?.displayName ?? panel.title,
                    // 044 T179 (FR-110) — `killsSession`'s rule, as the preview branch above takes it: a
                    // synced project panel keeps its history in the window that still holds it.
                    endsPanel: subWin === null || panel.originProjectId === ws.layout?.projectId,
                    confirm,
                    clearPanelType: ws.clearPanelType,
                  });
                },
                redraw: () => requestRedraw(panel.id, 'manual'),
                sendToNewTab: () => ws.addTabFromPanel(panel.id),
                sendToTab: (targetTabId) => ws.movePanelToTab(panel.id, targetTabId),
                /*
                 * 043 FR-015 — the SAME store actions the chords run, so the menu is a second door
                 * onto one command rather than a second implementation of it. `openFind` is what
                 * `search.find` calls; the `{ replace: true }` form is what `search.replace` calls.
                 * The menu rows only exist for a panel with a kind, so the cast is over a value the
                 * builder has already narrowed.
                 */
                find: () => {
                  /*
                   * `PanelKind` is an OPEN string — custom panel kinds exist — so comparing it to
                   * the three literals narrows nothing on its own. The membership is captured as a
                   * value TypeScript can carry into `openFind`, exactly as
                   * `search-keybindings.tsx` does for the chord route. 047 US1 adds `preview`.
                   */
                  const findKind: FindPanelKind | null =
                    panel.kind === 'editor'
                      ? 'editor'
                      : panel.kind === 'terminal'
                        ? 'terminal'
                        : panel.kind === PREVIEW_KIND
                          ? 'preview'
                          : null;
                  if (findKind) openFind(panel.id, findKind);
                },
                replace: () => openFind(panel.id, 'editor', { replace: true }),
                // 047 US4 — the same handle `preview.goToHeading`'s chord dispatch uses.
                goToHeading: () => {
                  openPreviewHeadingOutline(panel.id);
                },
                /*
                 * Replace All needs a term and a replacement, and with no bar open there is
                 * neither. So the menu row OPENS the bar in that case rather than firing a
                 * replace-all over nothing and reporting no change — the user asked to replace
                 * all, and this is the first thing they need on screen to do it. With a session
                 * already up it runs the replacement, exactly as `search.replaceAll` does.
                 */
                replaceAll: () => {
                  if (getFindSession(panel.id)) void replaceAllMatches(panel.id);
                  else openFind(panel.id, 'editor', { replace: true });
                },
                destroy: () => void destroyPanel(),
                // 044 FR-002, FR-005 — the one `preview.open` command, from this editor.
                openPreview: () => {
                  const filePath = editorUi?.filePath;
                  if (!filePath) return;
                  void requestPreviewOpen({ absPath: filePath, projectId: panel.originProjectId, requesterPanelId: panel.id });
                },
                // 044 FR-111 — the same command the header buttons, the chord and the mouse run, for THIS panel.
                navigateBack: () => {
                  void navigatePanelHistory(wsRef.current, panel.id, 'back');
                },
                navigateForward: () => {
                  void navigatePanelHistory(wsRef.current, panel.id, 'forward');
                },
                // 044 FR-028 — re-read the source now, ignoring the update delay.
                refreshPreview: () => {
                  void refreshPreviewPanel(panel.id).catch((error: unknown) =>
                    console.error('[preview] refresh failed', error),
                  );
                },
                // 044 FR-015b — the SAME function the status bar's button and the body menu's row run; it
                // reads parented-or-standalone from the store when chosen, so both rows reach it.
                openInEditor: () => runPreviewEditorRoute(panel, () => wsRef.current),
                goToEditor: () => runPreviewEditorRoute(panel, () => wsRef.current),
                // 044 FR-122 — the one command body, from the value this window holds when the menu opened.
                toggleSyncScroll: () => void toggleSyncScroll(settings.editor.previews.syncScroll),
              },
            }),
          );
        }}
        {...dragFromNonInteractive(listeners)}
        {...attributes}
      >
        {/* 044 FR-104 — Back / Forward, top left, before the type icon, on editors and previews only (FR-100). */}
        {hasHistory ? (
          <BackForwardButtons
            panelId={panel.id}
            onBack={() => void navigatePanelHistory(wsRef.current, panel.id, 'back')}
            onForward={() => void navigatePanelHistory(wsRef.current, panel.id, 'forward')}
          />
        ) : null}
        {/* Panel-type marker (012): a small themeable icon at the head of the title,
            replacing the former "TERMINAL/EDITOR PANEL" text pill. The type and
            flavour move into its hover title. */}
        {panel.kind
          ? (() => {
              const desc = defaultPanelTypeRegistry.get(panel.kind);
              const typeLabel = desc?.label ?? panel.kind;
              if (!desc?.icon) return null;
              // Prefer the captured flavour label; fall back to the flavour id for
              // Panels typed before the label was persisted (back-compat).
              const flavour =
                (typeof panel.config?.flavourLabel === 'string' && panel.config.flavourLabel) ||
                (typeof panel.config?.flavourId === 'string' && panel.config.flavourId) ||
                null;
              return (
                <span
                  className="panel-box__type-icon"
                  data-testid={`panel-kind-${panel.id}`}
                  title={flavour ? `${typeLabel} · ${flavour}` : `Panel type: ${typeLabel}`}
                  aria-label={typeLabel}
                >
                  <Icon token={desc.icon} />
                </span>
              );
            })()
          : null}
        <span
          className={`panel-box__title${titleTruncated && previewTitle === null ? ' panel-box__title--truncated' : ''}`}
          data-testid={`panel-title-${panel.id}`}
        >
          {previewTitle !== null ? (
            // 044 FR-032 — the marker on the name half, the suffix whole after it.
            <>
              <span
                className={`panel-box__title-name${previewTitle.nameTruncated ? ' panel-box__title-name--truncated' : ''}`}
              >
                {previewTitle.name}
              </span>
              <span className="panel-box__title-suffix">{previewTitle.suffix}</span>
            </>
          ) : (
            effectiveTitle
          )}
        </span>
        {panel.kind === 'editor' && editorUi ? (
          <span
            className="panel-box__file"
            data-testid={`panel-file-${panel.id}`}
            title={editorUi.filePath ? toDisplayPath(editorUi.filePath, os) : 'Unsaved new document'}
          >
            {filePill && filePill.dir ? (
              // Directory prefix — truncated first when the header is tight, so the
              // file name (and the owner text) always win (FR-085/088).
              <span className="panel-box__file-folder">{filePill.dir}</span>
            ) : null}
            <span className="panel-box__file-name">{filePill ? filePill.name : editorUi.displayName}</span>
          </span>
        ) : null}
        {/* Gated on the panel being an EDITOR, exactly as the file pill above it is.
         *
         * Editor state is keyed by panel id and DELIBERATELY outlives an editor's unmount — a
         * document moved between tabs or windows must not be destroyed by the move (use-editor.ts).
         * So a panel that once held a dirty editor and has since been re-typed still HAS that state,
         * and the dot alone was reading it: a terminal wearing another document's unsaved mark,
         * reporting work the user cannot reach from it and cannot save there. Whether the state
         * survives is the document's business; whether THIS panel displays it is the panel's.
         *
         * 044 FR-040, FR-043 — a PARENTED preview displays its source document's dot too, read from the
         * update main sent (never editor-state, so the document is still counted once). A standalone
         * preview never wears it. The editor gate stays spelled out inline, where
         * `unsaved-dot-call-sites.test.ts` reads it. */}
        {(panel.kind === 'editor' && editorUi?.dirty) || (isPreview && previewUi?.parent != null && previewUi.dirty) ? (
          <span
            className="throng-unsaved-dot panel-box__unsaved"
            data-testid={`panel-unsaved-${panel.id}`}
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        ) : null}
        {panel.kind === 'terminal' && panel.config?.runAsAdmin === true && elevated ? (
          <span className="panel-box__admin" data-testid={`panel-admin-${panel.id}`} title="Running as administrator">
            ADMIN
          </span>
        ) : null}
        {ownerLabel ? (
          <span
            className="panel-box__project"
            data-testid={`panel-project-${panel.id}`}
            style={{ color: ownerLabel.colour }}
            title={`Belongs to ${ownerLabel.name}`}
          >
            {ownerLabel.name}
          </span>
        ) : null}
        <span className="panel-box__actions">
          {/*
            Through `IconButton` (#282). Its sibling below already carried an `aria-label`; this one
            did not, and a `title` alone loses the accessible name to the `+` text node — so the two
            controls that sit three lines apart announced as "Destroy panel" and "plus".

            `className=""` is deliberate and is NOT the default left blank. `IconButton` defaults it
            to `icon-button`, a class defined in `preferences.css` — which the main window never
            loads, so the default would resolve to nothing here. That is #276 exactly, and adding a
            fourth instance of it in the commit that removes the other three would be absurd. This
            control needs no class of its own: `.panel-box__actions button` styles it by element.
          */}
          {/*
            048 FR-010/FR-011/FR-012/FR-014 — the + opens the split menu for THIS panel. It first makes
            its own panel active, in its own tab (`tabId`, not the window's active tab), so the chosen
            split applies to the panel whose button was clicked. Nothing is added until an item is
            chosen. A real button, so Enter and Space open it and the menu's arrow keys do the rest.
          */}
          <IconButton
            token="add"
            title="Split panel…"
            className=""
            testId={`panel-add-${panel.id}`}
            ariaHasPopup="menu"
            // The provider closes an open menu on any `pointerdown`, before this click — so a click on
            // the + while its menu is open would close and reopen it. Remember whether one was open when
            // the press began, exactly as the cog does, so the + can close its own menu.
            onPointerDown={() => {
              // Only the menu THIS + opened is its to close: with some other menu open (a File Explorer
              // context menu, say) the provider closes that one on this same press, and the click opens ours.
              addMenuWasOpen.current = openId !== null && openId === addMenuOpId.current;
            }}
            onClick={(e) => {
              const wasOpen = addMenuWasOpen.current;
              addMenuWasOpen.current = false;
              if (wasOpen) return;
              ws.setActivePanel(tabId, panel.id);
              setActivePane('workspace');
              const rect = e.currentTarget.getBoundingClientRect();
              addMenuOpId.current = openMenu(
                rect.left,
                rect.bottom,
                splitMenuItems(panel.id, keybindings, (id, direction) => {
                  ws.splitPanel(tabId, id, direction);
                }),
              );
            }}
          />
          <button
            type="button"
            title={`${panelVerb} panel`}
            aria-label={`${panelVerb} panel`}
            data-testid={`panel-close-${panel.id}`}
            onClick={() => void destroyPanel()}
          >
            ✕
          </button>
        </span>
      </div>
      <div
        className="panel-box__body"
        data-testid={`panel-body-${panel.id}`}
        /*
         * 048 FR-015 — the untyped placeholder's FIRST content menu: Split alone (one section, so no
         * divider). Only an untyped panel: every typed body draws its own menu, which already carries
         * Split (`withSplit`). A right-click on a text box keeps the operating system's own menu (copy,
         * paste) — unless the menu was asked for from the keyboard, where the focused control is whatever
         * the type form holds and there is no native alternative.
         */
        onContextMenu={
          // A DORMANT terminal is the same case (T062): its body is a placeholder with no xterm and so no
          // content menu of its own, and right-clicking inside it must still offer Split.
          panel.kind === undefined || (panel.kind === 'terminal' && panel.dormant === true)
            ? (e) => {
                const target = e.target as HTMLElement;
                if (
                  !isKeyboardMenu() &&
                  target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea') !== null
                ) {
                  return;
                }
                e.preventDefault();
                openMenu(e.clientX, e.clientY, placeholderContentMenu({ panelId: panel.id, keybindings }));
              }
            : undefined
        }
      >
        <PanelBody panel={panel} tabId={tabId} onDestroy={() => void destroyPanel()} />
      </div>
      {showZones ? (
        <div className="edge-zones">
          {EDGES.map((edge) => (
            <EdgeDropZone key={edge} panelId={panel.id} edge={edge} />
          ))}
        </div>
      ) : null}
      {inSplitMode ? (
        // 048 FR-026 — split mode's pulse: decorative, opacity-only, never in the pointer's way.
        <div className="panel-box__split-mode" data-testid={`panel-split-mode-${panel.id}`} aria-hidden="true" />
      ) : null}
      {flashKey !== null ? (
        // Keyed per request, so a second flash while one plays restarts the animation.
        <div key={flashKey} className="panel-box__flash" data-testid={`panel-flash-${panel.id}`} aria-hidden="true" />
      ) : null}
    </div>
  );
}
