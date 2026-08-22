import { useEffect, useState, type ReactElement } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  collectPanels,
  countPanels,
  defaultPanelTypeRegistry,
  editorPathParts,
  panelDisplayTitle,
  panelRemovalVerb,
  toDisplayPath,
  effectiveActivePanelId,
  panelZoomLevel,
  findPanelLocations,
  planConfirmations,
  renameCommit,
  type Edge,
  type Panel,
} from '@throng/core';
import { PanelBody } from './panel-body.js';
import { panelHeaderMenu } from './panel-header-menu.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useServices } from '../composition-root.js';
import { useConfirm } from '../confirm-dialog.js';
import { useNotify } from '../common/notification.js';
import { panelFailureText } from '../common/notice-text.js';
import { retryPanelFailure } from '../common/panel-failure-banner.js';
import { usePanelPlace } from '../common/panel-subject.js';
import { useCopyToClipboard } from '../common/use-copy.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { requestRedraw } from '../terminal/redraw.js';
import { focusTerminal } from '../terminal/focus-registry.js';
import { Icon } from '../common/icon.js';
import { NameLimitField } from '../common/name-limit-field.js';
import { panelHasLiveTerminal, panelHasRunningSubprocess } from './subprocess.js';
import { useCapabilities } from '../panel-type/use-capabilities.js';
import { useDetach } from './detach-context.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { destroySubWorkspace } from './destroy-sub-workspace.js';
import { edgeDropId, panelDragId, useDragState } from './drag-state.js';
import { setActivePane } from './active-pane.js';
import { focusPanel } from './panel-focus.js';
import { registerPanelRename, unregisterPanelRename } from './panel-rename.js';
import { useWindowFocus } from './use-window-focus.js';
import { useTerminalCwd } from '../terminal/cwd-store.js';
import { useTerminalTitle } from '../terminal/title-store.js';
import { useEditorFailure } from '../editor/editor-failure.js';
import { useEditorState } from '../editor/editor-state.js';
import { setLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorActions } from '../editor/editor-actions.js';
import { clearEditorPanelType } from '../editor/clear-editor-panel-type.js';
import { disposeEditor } from '../editor/use-editor.js';
import { clearTerminalViewState } from '../terminal/terminal-view-state.js';
import { promptDirtyClose } from '../editor/dirty-close-store.js';

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
  const { openMenu } = useContextMenu();
  const settings = useAppSettings();
  const detach = useDetach();
  const subWin = useSubWorkspaceWindow();
  const services = useServices();
  const { notify } = useNotify();
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
  const [renaming, setRenaming] = useState(false);

  const activeTabId = ws.layout?.activeTabId ?? '';
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
  const isActiveDimmed = isActive && !windowForeground;
  // The terminal's live working directory (012), shown in the header so the path is
  // visible even when a full-screen program hides the prompt. Undefined for
  // non-terminal panels (no cwd is ever pushed for their id).
  const terminalCwd = useTerminalCwd(panel.id);
  // US10 (#89): a terminal's live window title replaces the panel name in the header when present.
  const terminalTitle = useTerminalTitle(panel.id);
  // The file path an editor names itself after: the live editor state when it has registered, and
  // the panel's own `config.filePath` otherwise (#97 follow-up). `setPanelType(editor, …)` writes
  // the path onto the panel synchronously, while `editorUi` registers a beat later when the
  // CodeMirror view mounts — so a freshly opened editor would show its placeholder until that
  // landed. The config also backstops a restored editor whose live state has no path yet (#218).
  const editorFilePath =
    editorUi?.filePath ?? (typeof panel.config?.filePath === 'string' ? panel.config.filePath : null);
  // The name shown in the header and its hover tooltip. The rule lives in core (`panelDisplayTitle`)
  // so it can be asserted without launching the application, and so the header, the tooltip and any
  // future surface that has to name a panel cannot drift apart: a user rename outranks everything,
  // then the live/secondary automatic source for the panel's kind, then the placeholder — which is
  // correct only while the panel is untyped.
  //
  // 031 US4 (N8, T093) — the limit is applied HERE, at the one place every panel-name source is
  // resolved. `panelDisplayTitle` bounds its RESULT, so a user override, a live shell title, a
  // flavour label and a file path are all shortened by the same rule rather than by four of them.
  // The unbounded form is computed alongside purely to decide whether the ellipsis is drawn; the
  // marker itself is a `::after` (FR-037c), so it never enters the value or anything persisted.
  const maxNameLength = settings.tabs.maxNameLength;
  const titleSources = { terminalTitle, editorFilePath };
  const fullTitle = panelDisplayTitle(panel, titleSources);
  const effectiveTitle = panelDisplayTitle(panel, titleSources, maxNameLength);
  const titleTruncated = effectiveTitle !== fullTitle;

  // Removal verb per ownership + location (011, FR-030/031). The rule itself lives in core
  // (`panelRemovalVerb`) with the reasoning and all four combinations asserted there — it is
  // two booleans in, one of two verbs out, and as a ternary here it could only be read by
  // launching the app and hovering a tooltip. This mirrors the owner-label logic above.
  const panelVerb = panelRemovalVerb({
    inSubWorkspace: subWin !== null,
    hasOriginProject: originProject !== null,
  });

  // The F2 chord (`panel.rename`) starts the rename. The header owns the box; the window-level
  // keybinding handler owns the chord and knows only which panel is active — so it asks, here.
  useEffect(() => {
    registerPanelRename(panel.id, () => setRenaming(true));
    return () => unregisterPanelRename(panel.id);
  }, [panel.id]);

  // A freshly added Panel opens directly in rename mode (FR-041 / new-panel UX).
  useEffect(() => {
    if (ws.lastAddedPanelId === panel.id) {
      setRenaming(true);
      ws.clearLastAddedPanel();
    }
  }, [ws, panel.id]);

  /**
   * What the open rename box was SEEDED with — the yardstick a commit is measured against.
   *
   * The input is uncontrolled (`defaultValue`), so it holds whatever it was given at mount for as
   * long as it is open. `panel.title`, meanwhile, can change underneath it: `PanelNameSync` claims
   * every panel's name as it appears and RETITLES the panel when the daemon moves it, which for a
   * brand-new panel happens moments after the box opens — panels are numbered within their own
   * layout, so a clash with another project is the norm rather than the exception (#184).
   *
   * Comparing the submitted value against a title that can move is what let an UNTOUCHED box commit:
   * the box still held "Panel 9", the panel had become "Panel 9 (2)", the two differed, and clicking
   * a panel-type button therefore renamed the panel the user had typed nothing into (#218 A2).
   * Against the seed, an untouched box is always equal to itself, whatever else has happened.
   *
   * Recorded from the INPUT, in its focus handler, rather than from `panel.title` when the box is
   * asked to open: the two can already differ by then, because the box opens from an effect and
   * mounts on a later render. The element's own value is what the user is looking at, so it is the
   * only honest yardstick for "did they change it?".
   *
   * 031 US4 moved the box itself into the shared {@link NameLimitField}, which now carries the seed
   * to `commit` for exactly this reason — the rule is unchanged, it simply lives with the box.
   */

  /**
   * Confirm (or dismiss) the inline rename box.
   *
   * Only a CHANGED name is a rename (024 US5/US10 follow-up). This matters far more than it looks: a
   * newly added Panel opens straight into rename mode, so simply clicking away — to pick a panel
   * type, to drag a file in — blurred the box and committed its unchanged default. That marked the
   * Panel `titleIsCustom`, and a custom title outranks every automatic one, so the terminal's live
   * window title and the editor's file name were suppressed on exactly the panels a user had just
   * created. Running "Reset Name" cleared the mark and made them work, which is precisely the
   * symptom that was reported. A user who typed nothing has renamed nothing.
   */
  const commit = (trimmed: string, seed: string): void => {
    /*
     * #297 — the decision moved to `renameCommit` in core, unchanged in every case that existed
     * before and with one added: a BLANK box on an already-renamed panel clears the override, so
     * the panel names itself again. It is the same route Reset Name takes rather than a second
     * implementation of it, and it is gated on `titleIsCustom` precisely so the click-away path
     * #176 closed stays closed. The rule's own file carries that reasoning.
     */
    const action = renameCommit(trimmed, seed, panel.titleIsCustom ?? false);

    if (action.kind === 'reset') {
      ws.resetPanelName(panel.id);
    } else if (action.kind === 'rename') {
      /*
       * A panel's name is unique across the WHOLE application (024 follow-up) — every project and
       * every sub-workspace — because the name is how a user refers to a panel: in the tab strip, in
       * the window title, in the app-close warning listing what is still running, and out loud.
       * Two panels called "Build" make every one of those a riddle.
       *
       * Only the daemon can see them all, so it grants the name. A taken name is ADJUSTED rather
       * than refused — the rename always goes through — and the user is told, once, in a warning
       * that dismisses itself: nothing was lost and there is nothing to decide.
       */
      void services.panelNames.claim(panel.id, action.name).then(({ granted, adjusted }) => {
        ws.renamePanel(panel.id, granted);
        // Clone-sync (003): rename the same Panel in every other window it appears in
        // (its project + any sub-workspaces) in real time.
        window.throng?.panel?.notifyRenamed?.(panel.id, granted);
        if (adjusted) {
          notify({
            severity: 'warning',
            /*
             * 030 FR-022 — the panel is named `Project — Tab — Panel`, with the name it was ACTUALLY
             * granted. Built here rather than read back from `usePanelPlace`, because `renamePanel`
             * has only just been called and the layout this render closed over still holds the old
             * title: the notice would name the panel by the name it no longer has.
             *
             * FR-023 then takes “${granted}” OUT of the sentence — the heading has just said it, and
             * saying it twice is the stutter that requirement exists to stop. The name the user
             * ASKED for stays, because that is a different fact and the only one left to explain.
             */
            subject: { kind: 'panel', name: granted, tab: place?.tab, project: place?.project },
            message: `Another panel is already called “${action.name}”, so this one was renamed.`,
            testId: 'panel-name-adjusted',
          });
        }
      });
    }
    endRename();
  };

  /**
   * Leave the rename box and hand the keyboard BACK to the panel.
   *
   * Renaming is a detour: the user was working in an editor or a terminal, pressed F2 (or picked
   * Rename), typed a name, and is done. Leaving focus on a header that is no longer an input strands
   * them — the next keystroke goes nowhere, and they have to click back into the thing they were
   * already in. The panel's own view restores its caret when it takes focus, so the cursor lands
   * where they left it rather than at the top of the document.
   */
  const endRename = (): void => {
    setRenaming(false);
    /*
     * DEFERRED, and that is the whole point.
     *
     * Focusing the panel SYNCHRONOUSLY from inside the Enter keydown handler moved the caret into a
     * terminal or an editor while that very keystroke was still being delivered — so the rest of the
     * key's dispatch landed in the newly focused surface and typed a newline into it. Confirming a
     * panel name must not put a blank line in someone's file, or a bare Enter at their shell.
     *
     * A frame later the keystroke is finished, and the panel takes focus with nothing following it.
     */
    requestAnimationFrame(() => focusPanel(panel.id));
  };

  // Shared Destroy Panel flow (FR-020/022/023) used by the header ✕ and the
  // context menu. A confirmation is shown only when the Panel hosts a live
  // terminal; a plain/empty Panel is removed immediately.
  const destroyPanel = async (): Promise<void> => {
    // Dirty-editor guard (FR-006a): destroying a Panel with unsaved editor content
    // prompts save/discard/cancel before anything else. Cancel aborts entirely.
    const editorActions = getEditorActions(panel.id);
    if (editorActions?.isDirty()) {
      const name = editorUi?.displayName ?? panel.title;
      const choice = await promptDirtyClose(name, editorUi?.filePath ? [name] : []);
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const ok = await editorActions.save();
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
    ws.removePanel(panel.id);
    // Cascade to the sub-workspaces ONLY when destroying from the project (FR-026).
    // A sub-workspace destroy stays local (no broadcast → the project is untouched).
    if (!inSubWorkspace) window.throng?.panel?.notifyDestroyed?.(panel.id);
  };

  return (
    <div
      className={`panel-box${isDragging ? ' panel-box--dragging' : ''}${isActive ? ' panel-box--active' : ''}${isActiveDimmed ? ' panel-box--active-dimmed' : ''}`}
      data-testid={`panel-${panel.id}`}
      data-panel-id={panel.id}
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
      // The dominant project/owner colour marks the active panel only while the
      // window is foreground (Principle VI); when the window is background the
      // CSS dimmed-inactive token takes over so no runtime colour hides it.
      style={isActive && windowForeground && activeColour ? { outlineColor: activeColour } : undefined}
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
        title={effectiveTitle}
        onDoubleClick={() => setRenaming(true)}
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
                    { dirty: editorUi?.dirty ?? false, hasFilePath: !!editorUi?.filePath }
                  : null,
              editorFailure: editorFailure !== null,
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
                beginRename: () => setRenaming(true),
                resetName: () => ws.resetPanelName(panel.id),
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
                      detail: { absPath: editorUi?.filePath },
                    }),
                  );
                },
                openInOsExplorer: () => {
                  const abs = (editorUi?.filePath ?? '').replace(/\\/g, '/');
                  const root = (editorUi?.ownerRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
                  const rel =
                    root && abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)
                      ? abs.slice(root.length + 1)
                      : null;
                  if (rel !== null) void window.throng?.files?.reveal?.(rel);
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
                copyDetails: () => {
                  if (editorFailure) {
                    copyToClipboard(panelFailureText(editorFailure), editorFailure.subject);
                  }
                },
                clearPanelType: () => {
                  void clearEditorPanelType(panel.id, {
                    dirty: editorUi?.dirty ?? false,
                    name: editorUi?.displayName ?? panel.title,
                    confirm,
                    clearPanelType: ws.clearPanelType,
                  });
                },
                redraw: () => requestRedraw(panel.id, 'manual'),
                sendToNewTab: () => ws.addTabFromPanel(panel.id),
                sendToTab: (targetTabId) => ws.movePanelToTab(panel.id, targetTabId),
                destroy: () => void destroyPanel(),
              },
            }),
          );
        }}
        {...(renaming ? {} : listeners)}
        {...attributes}
      >
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
        {renaming ? (
          // FR-035g — the panel's rename cap is the tab's cap. One implementation, so they cannot
          // drift into behaving differently for the same limit.
          <NameLimitField
            className="panel-box__rename"
            testId={`panel-rename-input-${panel.id}`}
            counterClassName="panel-box__rename-count"
            counterTestId={`panel-rename-count-${panel.id}`}
            initialValue={panel.title}
            limit={maxNameLength}
            onCommit={commit}
            onCancel={endRename} // cancelled, but still not stranded
          />
        ) : (
          <span
            className={`panel-box__title${titleTruncated ? ' panel-box__title--truncated' : ''}`}
            data-testid={`panel-title-${panel.id}`}
          >
            {effectiveTitle}
          </span>
        )}
        {panel.kind === 'terminal' && terminalCwd ? (
          <span
            className="panel-box__cwd"
            data-testid={`panel-cwd-${panel.id}`}
            title={terminalCwd}
          >
            {terminalCwd}
          </span>
        ) : null}
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
         * survives is the document's business; whether THIS panel displays it is the panel's. */}
        {panel.kind === 'editor' && editorUi?.dirty ? (
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
          <button
            type="button"
            title="Add panel"
            data-testid={`panel-add-${panel.id}`}
            onClick={() => ws.addPanel(activeTabId)}
          >
            +
          </button>
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
      <div className="panel-box__body" data-testid={`panel-body-${panel.id}`}>
        <PanelBody panel={panel} tabId={tabId} />
      </div>
      {showZones ? (
        <div className="edge-zones">
          {EDGES.map((edge) => (
            <EdgeDropZone key={edge} panelId={panel.id} edge={edge} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
