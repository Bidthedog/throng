import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  collectPanels,
  countPanels,
  defaultPanelTypeRegistry,
  editorAutoTitle,
  editorPathParts,
  toDisplayPath,
  effectiveActivePanelId,
  panelZoomLevel,
  findPanelLocations,
  planConfirmations,
  firstBinding,
  type Edge,
  type Panel,
} from '@throng/core';
import { PanelBody } from './panel-body.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useServices } from '../composition-root.js';
import { useConfirm } from '../confirm-dialog.js';
import { useNotify } from '../common/notification.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { Icon } from '../common/icon.js';
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
import { useEditorState } from '../editor/editor-state.js';
import { setLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorActions } from '../editor/editor-actions.js';
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
  // An editor with no manual name auto-derives its title from the open file's basename (024 US5,
  // FR-015 — final extension stripped); null when the panel is not an editor, has been renamed, or
  // has no file open (then the default placeholder stands).
  //
  // The file path is taken from the live editor state when it has registered, but FALLS BACK to the
  // panel's own `config.filePath` before that happens (#97 follow-up). `setPanelType(editor, …)` writes
  // the path onto the panel synchronously, while the editor's `editorUi` state registers a beat later
  // when the CodeMirror view mounts — so a freshly opened editor would otherwise show its placeholder
  // name ("Panel N") until that registration landed. Trusting `config.filePath` in the gap makes the
  // auto-name appear immediately, on every open path.
  const editorFilePath = editorUi
    ? (editorUi.filePath ?? null)
    : typeof panel.config?.filePath === 'string'
      ? panel.config.filePath
      : null;
  const editorAuto =
    panel.kind === 'editor' && !panel.titleIsCustom && editorFilePath
      ? editorAutoTitle(editorFilePath)
      : null;
  // The name shown in the header and its hover tooltip. Precedence: a user RENAME wins over
  // everything (#89 follow-up — a rename must not be overridden by the shell's OSC title, or by an
  // editor's file name); otherwise a terminal shows its live window title and an editor shows its
  // open file's basename; otherwise the default placeholder. "Reset Name" clears the custom mark,
  // which drops each panel type back to its auto source.
  const effectiveTitle = panel.titleIsCustom
    ? panel.title
    : panel.kind === 'terminal'
      ? (terminalTitle ?? panel.title)
      : (editorAuto ?? panel.title);

  // Removal verb per ownership + location (011, FR-030/031). Inside a sub-workspace a
  // Panel backed by a real project (`originProject` resolved above) is a mirrored VIEW:
  // removing it here is a **Close** (it leaves this sub-workspace only; the project keeps
  // the Panel and its running terminal). A Panel the sub-workspace itself owns (no backing
  // project, so `originProject` is null) — and every Panel in the main window — is a
  // **Destroy** (gone, session terminated). This mirrors the owner-label logic above.
  const panelVerb = subWin !== null && originProject !== null ? 'Close' : 'Destroy';

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
  const commit = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== panel.title) {
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
      void services.panelNames.claim(panel.id, trimmed).then(({ granted, adjusted }) => {
        ws.renamePanel(panel.id, granted);
        // Clone-sync (003): rename the same Panel in every other window it appears in
        // (its project + any sub-workspaces) in real time.
        window.throng?.panel?.notifyRenamed?.(panel.id, granted);
        if (adjusted) {
          notify({
            severity: 'warning',
            message: `Another panel is already called “${trimmed}”, so this one was named “${granted}”.`,
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
          openMenu(e.clientX, e.clientY, [
            {
              label: 'Rename',
              icon: 'rename',
              // The chord is SHOWN, not merely bound. A menu that offers an action without naming
              // its key teaches nobody the key, and this menu is the panel's canonical index of
              // what it can do (constitution v4.3.0).
              shortcut: firstBinding(keybindings, 'panel.rename'),
              onClick: () => setRenaming(true),
            },
            // Undo a rename back to the panel's default name (a terminal then shows its live title
            // again). Disabled when there is nothing to reset.
            {
              label: 'Reset Name',
              icon: 'resetName',
              disabled: !(panel.titleIsCustom ?? false),
              onClick: () => ws.resetPanelName(panel.id),
            },
            // Per-panel zoom (012) — zoom THIS panel's text independently of others.
            {
              label: 'Zoom',
              icon: 'zoomIn',
              submenu: [
                {
                  label: 'Zoom In',
                  icon: 'zoomIn',
                  shortcut: firstBinding(keybindings, 'panel.zoomIn'),
                  onClick: () => ws.bumpZoom(panel.id, 1),
                },
                {
                  label: 'Zoom Out',
                  icon: 'zoomOut',
                  shortcut: firstBinding(keybindings, 'panel.zoomOut'),
                  onClick: () => ws.bumpZoom(panel.id, -1),
                },
                {
                  label: 'Reset Zoom',
                  icon: 'zoomReset',
                  shortcut: firstBinding(keybindings, 'panel.zoomReset'),
                  onClick: () => ws.resetZoom(panel.id),
                },
              ],
            },
            // Editor Panels: Save (== Ctrl+S, FR-076) and Revert-all-changes with a
            // confirmation (FR-075). Revert is disabled when there is nothing to undo.
            ...(panel.kind === 'editor'
              ? [
                  {
                    label: 'Save',
                    icon: 'send' as const,
                    shortcut: firstBinding(keybindings, 'editor.save'),
                    onClick: () => {
                      void getEditorActions(panel.id)?.save();
                    },
                  },
                  {
                    label: 'Save As…',
                    icon: 'send' as const,
                    shortcut: firstBinding(keybindings, 'editor.saveAs'),
                    onClick: () => {
                      void getEditorActions(panel.id)?.saveAs();
                    },
                  },
                  {
                    label: 'Revert',
                    icon: 'rename' as const,
                    disabled: !editorUi?.dirty,
                    onClick: () => {
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
                  },
                  /**
                   * Reload from disk (027 / #161, FR-013) — a NEW action ALONGSIDE Revert, not a
                   * rename of it. They read different sources of truth: Revert restores throng's
                   * cached copy of what the file last held and refuses when the file is gone;
                   * this re-READS the path, which is the only thing that rescues a stranded
                   * editor. Enabled even with no unsaved changes: "the file changed underneath
                   * me, show me what it says now" is a legitimate ask.
                   *
                   * Menu-only, with no ActionId. Minting one would oblige a default chord, a
                   * COMMAND_SCOPES entry and a KEYBINDINGS_METADATA descriptor (the completeness
                   * gate asserts every ActionId is described) for a recovery action always reached
                   * from a panel already under the pointer.
                   */
                  {
                    label: 'Reload from disk',
                    icon: 'retry' as const,
                    disabled: !editorUi?.filePath,
                    onClick: () => {
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
                  },
                  // US6 (#137) — for a panel backed by an on-disk file: reveal it in throng's own
                  // Files & Folders tree, and open its folder in the OS file manager (via the seam).
                  ...(editorUi?.filePath
                    ? [
                        {
                          label: 'Reveal File in Files & Folders',
                          onClick: () => {
                            window.dispatchEvent(
                              new CustomEvent('throng:reveal-in-tree', {
                                detail: { absPath: editorUi.filePath },
                              }),
                            );
                          },
                        },
                        {
                          label: 'Open in OS Explorer',
                          onClick: () => {
                            const abs = (editorUi.filePath ?? '').replace(/\\/g, '/');
                            const root = (editorUi.ownerRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
                            const rel =
                              root && abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)
                                ? abs.slice(root.length + 1)
                                : null;
                            if (rel !== null) void window.throng?.files?.reveal?.(rel);
                          },
                        },
                      ]
                    : []),
                ]
              : []),
            {
              label: 'Send to Tab',
              icon: 'send',
              submenu: [
                // New Tab == dragging the Panel onto the tab-strip `+` (005 FR-027).
                { label: 'New Tab', icon: 'add', onClick: () => ws.addTabFromPanel(panel.id) },
                ...others.map((t) => ({
                  label: t.title,
                  icon: 'tab',
                  onClick: () => ws.movePanelToTab(panel.id, t.id),
                })),
              ],
            },
            // Sync (clone) this Panel into a sub-workspace (US7). Hidden in
            // sub-workspace windows (no detach context). "New Window" creates a new
            // sub-workspace; an existing one → choose a Tab within it ("New" makes
            // a fresh Tab). Cloning leaves the Panel in the main project.
            ...(detach
              ? [
                  {
                    label: 'Sync to',
                    icon: 'send',
                    submenu: [
                      {
                        label: 'New Sub-workspace',
                        icon: 'detach',
                        onClick: () => detach.detachToNew('panel', panel.id),
                      },
                      // A Panel can live in a given sub-workspace only ONCE: if it's
                      // already there, the entry is greyed out (no submenu).
                      ...detach.subWorkspaces.map((s) => {
                        const already = s.tabs.some((t) =>
                          collectPanels(t.root).some((p) => p.id === panel.id),
                        );
                        if (already) return { label: s.name, icon: 'tab', disabled: true };
                        return {
                          label: s.name,
                          icon: 'tab',
                          submenu: [
                            {
                              label: 'New Tab',
                              icon: 'add',
                              onClick: () => detach.syncToExisting('panel', panel.id, s.id),
                            },
                            ...s.tabs.map((t) => ({
                              label: t.title,
                              icon: 'tab',
                              onClick: () => detach.syncToExisting('panel', panel.id, s.id, t.id),
                            })),
                          ],
                        };
                      }),
                    ],
                  },
                ]
              : []),
            { label: `${panelVerb} Panel`, icon: 'destroy', onClick: () => void destroyPanel() },
          ]);
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
          <input
            className="panel-box__rename"
            data-testid={`panel-rename-input-${panel.id}`}
            defaultValue={panel.title}
            autoFocus
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              // Both keys are CONSUMED here: they finish the rename and mean nothing to anything
              // behind it. Letting them through is what sent Enter on to the panel.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commit((e.target as HTMLInputElement).value);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                endRename(); // cancelled, but still not stranded
              }
            }}
          />
        ) : (
          <span className="panel-box__title" data-testid={`panel-title-${panel.id}`}>
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
