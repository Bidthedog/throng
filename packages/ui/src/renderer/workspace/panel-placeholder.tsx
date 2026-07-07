import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  collectPanels,
  countPanels,
  defaultPanelTypeRegistry,
  editorPathParts,
  toDisplayPath,
  effectiveActivePanelId,
  findPanelLocations,
  planConfirmations,
  type Edge,
  type Panel,
} from '@throng/core';
import { PanelBody } from './panel-body.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useServices } from '../composition-root.js';
import { useConfirm } from '../confirm-dialog.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useAppSettings } from '../config/config-store.js';
import { panelHasLiveTerminal, panelHasRunningSubprocess } from './subprocess.js';
import { useCapabilities } from '../panel-type/use-capabilities.js';
import { useDetach } from './detach-context.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { destroySubWorkspace } from './destroy-sub-workspace.js';
import { edgeDropId, panelDragId, useDragState } from './drag-state.js';
import { setActivePane } from './active-pane.js';
import { useEditorState } from '../editor/editor-state.js';
import { setLastActiveEditor } from '../editor/last-active-editor.js';
import { getEditorActions } from '../editor/editor-actions.js';
import { disposeEditor } from '../editor/use-editor.js';
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
  const { elevated } = useCapabilities();
  const { draggingPanelId } = useDragState();

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

  // A freshly added Panel opens directly in rename mode (FR-041 / new-panel UX).
  useEffect(() => {
    if (ws.lastAddedPanelId === panel.id) {
      setRenaming(true);
      ws.clearLastAddedPanel();
    }
  }, [ws, panel.id]);

  const commit = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      ws.renamePanel(panel.id, trimmed);
      // Clone-sync (003): rename the same Panel in every other window it appears in
      // (its project + any sub-workspaces) in real time.
      window.throng?.panel?.notifyRenamed?.(panel.id, trimmed);
    }
    setRenaming(false);
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
        title: 'Close sub-workspace',
        message: active ? activeMessage : `Destroy “${panel.title}”?`,
        warningMessage: `This is the last panel in “${subWin.name}” — closing it will close the sub-workspace.`,
        confirmLabel: 'Close sub-workspace',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      if (killsSession && panelHasLiveTerminal(panel.id)) {
        void window.throng?.terminal?.kill?.(panel.id);
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

    if (plan.dialogs > 0 || cascades) {
      const ok = await confirm({
        title: 'Destroy Panel',
        message: active ? activeMessage : `Destroy “${panel.title}”?`,
        warningMessage,
        confirmLabel: 'Destroy Panel',
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
          : `This destroys “${panel.title}” (its terminal keeps running in the project).`,
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
      className={`panel-box${isDragging ? ' panel-box--dragging' : ''}${isActive ? ' panel-box--active' : ''}`}
      data-testid={`panel-${panel.id}`}
      data-panel-id={panel.id}
      data-active={isActive}
      onPointerDown={() => {
        ws.setActivePanel(tabId, panel.id);
        setActivePane('workspace'); // a workspace Panel is now active (gates Ctrl+S)
        if (panel.kind === 'editor') setLastActiveEditor(tabId, panel.id); // FR-010
      }}
      style={isActive && activeColour ? { outlineColor: activeColour } : undefined}
    >
      <div
        ref={setNodeRef}
        className="panel-box__header"
        data-testid={`panel-handle-${panel.id}`}
        title="Click: Activate · Drag: Move · Double-click: Rename · Right-click: Menu"
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          const others = (ws.layout?.tabs ?? []).filter((t) => t.id !== tabId);
          openMenu(e.clientX, e.clientY, [
            { label: 'Rename', icon: 'rename', onClick: () => setRenaming(true) },
            // Editor Panels: Save (== Ctrl+S, FR-076) and Revert-all-changes with a
            // confirmation (FR-075). Revert is disabled when there is nothing to undo.
            ...(panel.kind === 'editor'
              ? [
                  {
                    label: 'Save',
                    icon: 'send' as const,
                    onClick: () => {
                      void getEditorActions(panel.id)?.save();
                    },
                  },
                  {
                    label: 'Save As…',
                    icon: 'send' as const,
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
            { label: 'Destroy Panel', icon: 'destroy', onClick: () => void destroyPanel() },
          ]);
        }}
        {...(renaming ? {} : listeners)}
        {...attributes}
      >
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
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="panel-box__title">{panel.title}</span>
        )}
        {panel.kind
          ? (() => {
              const typeLabel = defaultPanelTypeRegistry.get(panel.kind)?.label ?? panel.kind;
              // Prefer the captured flavour label; fall back to the flavour id for
              // Panels typed before the label was persisted (back-compat).
              const flavour =
                (typeof panel.config?.flavourLabel === 'string' && panel.config.flavourLabel) ||
                (typeof panel.config?.flavourId === 'string' && panel.config.flavourId) ||
                null;
              return (
                <span
                  className="panel-box__kind"
                  data-testid={`panel-kind-${panel.id}`}
                  title={flavour ? `${typeLabel} · ${flavour}` : `Panel type: ${typeLabel}`}
                >
                  {typeLabel}
                  {flavour ? <span className="panel-box__flavour">{flavour}</span> : null}
                </span>
              );
            })()
          : null}
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
        {editorUi?.dirty ? (
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
            title="Destroy panel"
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
