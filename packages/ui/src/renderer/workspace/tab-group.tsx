import { useRef, useState, type ReactElement, type KeyboardEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  collectPanels,
  countPanels,
  planConfirmations,
  type Edge,
  type Tab,
} from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useServices } from '../composition-root.js';
import { useConfirm } from '../confirm-dialog.js';
import { useEditorDirty } from '../editor/editor-state.js';
import { disposeEditor } from '../editor/use-editor.js';
import { useDetach } from './detach-context.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { destroySubWorkspace } from './destroy-sub-workspace.js';
import { SplitTree } from './split-tree.js';
import { panelHasLiveTerminal, runningSubprocessCount } from './subprocess.js';
import { type MenuItem } from './context-menu.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useAppSettings } from '../config/config-store.js';
import {
  DragStateContext,
  parseEdgeDropId,
  parsePanelDragId,
  parseTabDragId,
  parseTabDropId,
  tabDragId,
  tabDropId,
  useDragState,
  NEW_TAB_DROP_ID,
} from './drag-state.js';

function mergeRefs<T>(...refs: Array<(node: T | null) => void>): (node: T | null) => void {
  return (node) => refs.forEach((ref) => ref(node));
}

interface TabMenuState {
  tabId: string;
  x: number;
  y: number;
}

function TabChip({
  tab,
  active,
  renaming,
  onRenameCommit,
  onStartRename,
  onMenu,
}: {
  tab: Tab;
  active: boolean;
  renaming: boolean;
  onRenameCommit: (title: string) => void;
  onStartRename: () => void;
  onMenu: (state: TabMenuState) => void;
}): ReactElement {
  const ws = useWorkspace();
  const { draggingPanelId } = useDragState();
  // Any unsaved editor in this Tab lights the shared dot (006, US8).
  const tabDirty = useEditorDirty(collectPanels(tab.root).map((p) => p.id));
  const drag = useDraggable({ id: tabDragId(tab.id) });
  const drop = useDroppable({ id: tabDropId(tab.id) });
  // Highlight only when a Panel (not a Tab) is being dragged over — moving a
  // Panel into this Tab. Tab reordering shows an insertion indicator instead.
  const panelOver = drop.isOver && draggingPanelId !== null;

  const commit = (value: string): void => {
    const trimmed = value.trim();
    onRenameCommit(trimmed.length > 0 ? trimmed : tab.title);
  };

  return (
    <div
      ref={mergeRefs(drag.setNodeRef, drop.setNodeRef)}
      className={`tab-chip${active ? ' tab-chip--active' : ''}${panelOver ? ' tab-chip--over' : ''}`}
      data-testid={`tab-${tab.id}`}
      data-active={active ? 'true' : 'false'}
      onClick={() => ws.setActiveTab(tab.id)}
      onDoubleClick={() => onStartRename()}
      /*
       * 017 / #57 — the TITLE, not instructions. A tab label is not ellipsized (a long tab grows
       * and the strip scrolls), so this is a reachability and consistency fix rather than the
       * "no other way to read it" case the panel header has. The interactions stay in the
       * right-click menu.
       */
      title={tab.title}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
      }}
      {...(renaming ? {} : drag.listeners)}
      {...drag.attributes}
    >
      {renaming ? (
        <input
          className="tab-chip__rename"
          data-testid={`tab-rename-input-${tab.id}`}
          defaultValue={tab.title}
          autoFocus
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') onRenameCommit(tab.title);
          }}
        />
      ) : (
        <>
          <span className="tab-chip__label" data-testid={`tab-title-${tab.id}`}>
            {tab.title}
          </span>
          {tabDirty ? (
            <span
              className="throng-unsaved-dot tab-chip__unsaved"
              data-testid={`tab-unsaved-${tab.id}`}
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          ) : null}
          <span className="tab-chip__count" data-testid={`tab-count-${tab.id}`}>
            [{countPanels(tab.root)}]
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The New-Tab (+) button. It is also a drop target: dropping a Panel here moves
 * it into a brand-new solo Tab (FR-027). Its `useDroppable` lives in this small
 * component (mirroring TabChip) so dnd-kit reliably registers/measures it — a
 * droppable declared in the parent alongside the DndContext is not tracked.
 */
function NewTabButton({ onNewTab }: { onNewTab: () => void }): ReactElement {
  const { draggingPanelId } = useDragState();
  const drop = useDroppable({ id: NEW_TAB_DROP_ID });
  const panelOver = drop.isOver && draggingPanelId !== null;
  return (
    <button
      ref={drop.setNodeRef}
      type="button"
      className={`tab-strip__add${panelOver ? ' tab-strip__add--over' : ''}`}
      data-testid="tab-add"
      title={draggingPanelId ? 'Drop to move into a new tab' : 'New tab'}
      onClick={onNewTab}
    >
      +
    </button>
  );
}

/**
 * The Workspace Pane's tab group (Principle XI / FR-010,012): a reorderable tab
 * strip plus the active Tab's split tree. One DndContext drives all docking
 * (FR-017): drag a Panel onto another Panel's edge to split/regroup, onto a Tab
 * to move it there, or drag a Tab to reorder. Reordering shows an absolutely
 * positioned insertion indicator at the exact drop boundary (FR-035) — it never
 * shifts the tabs. Right-clicking (or double-clicking) a Tab renames it (FR-036).
 */
export function TabGroup(): ReactElement {
  const ws = useWorkspace();
  const confirm = useConfirm();
  const { openMenu } = useContextMenu();
  const settings = useAppSettings();
  const detach = useDetach();
  const subWin = useSubWorkspaceWindow();
  const services = useServices();
  const layout = ws.layout;
  const stripRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<number | null>(null);
  const pointerXRef = useRef(0);
  // Last pointer position during a drag (window coords), used to detect a drop
  // outside the window → detach into a new sub-workspace window (US7 / FR-016).
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  // Throttle timestamp for the ghost drop-target hint updates during a drag.
  const hintAt = useRef(0);
  // What's being dragged, for the drop-target hint + once-only sync check.
  const dragInfo = useRef<{ kind: 'tab' | 'panel'; id: string } | null>(null);
  // True while dragging a sub-workspace-OWNED Panel: it can't be moved out of its
  // window, so leaving the window shows an invalid-drop warning on the ghost (FR-030).
  const draggingOwned = useRef(false);
  const moveListener = useRef<((e: PointerEvent) => void) | null>(null);
  const ghostMove = useRef<((e: PointerEvent) => void) | null>(null);
  const ghostRaf = useRef(false);
  // Hover-over-a-tab-to-activate during a panel drag (FR-023).
  const hoverTabId = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!layout) return <></>;
  const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0];

  // Compute the reorder slot + indicator position from the live cursor X against
  // the OTHER tabs' DOM rects (the dragged tab is excluded — its rect follows the
  // drag overlay). The slot is the index into the post-removal array, which is
  // exactly what reorderTab expects. This is fully deterministic, unlike relying
  // on dnd-kit's cached collision rects while the dragged tab is still in flow.
  const trackTabDrag = (draggingId: string) => (e: PointerEvent): void => {
    pointerXRef.current = e.clientX;
    const strip = stripRef.current;
    if (!strip) return;
    const others = (Array.from(strip.querySelectorAll('.tab-chip')) as HTMLElement[]).filter(
      (c) => c.getAttribute('data-testid') !== `tab-${draggingId}`,
    );
    const stripLeft = strip.getBoundingClientRect().left;
    let slot = others.length;
    for (let i = 0; i < others.length; i += 1) {
      const r = others[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        slot = i;
        break;
      }
    }
    slotRef.current = slot;
    let boundary: number;
    if (others.length === 0) boundary = stripLeft;
    else if (slot < others.length) boundary = others[slot].getBoundingClientRect().left;
    else boundary = others[others.length - 1].getBoundingClientRect().right;
    setIndicatorX(boundary - stripLeft + strip.scrollLeft);
  };

  const onDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id);
    const panelId = parsePanelDragId(id);
    const tabId = parseTabDragId(id);
    if (!panelId && !tabId) return;
    dragInfo.current = panelId ? { kind: 'panel', id: panelId } : { kind: 'tab', id: tabId! };

    // Drive the OS ghost from coalesced pointer moves (one tick per frame) so it
    // follows the cursor smoothly. dnd-kit's pointer capture keeps these firing
    // even when the cursor leaves the window.
    const onMove = (e: PointerEvent): void => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      // Update the ghost's drop-target hint (throttled): outside the window, show
      // which sub-workspace + Tab the drop will land on; inside, clear it. This is
      // the cross-window drop indicator (item 5 fallback).
      if (detach && e.timeStamp - hintAt.current > 120) {
        hintAt.current = e.timeStamp;
        const outside =
          e.clientX < 0 ||
          e.clientY < 0 ||
          e.clientX > window.innerWidth ||
          e.clientY > window.innerHeight;
        if (!outside) {
          window.throng?.dragGhost?.hint?.('');
        } else {
          void window.throng?.subWorkspace?.atPoint?.().then((subId) =>
            window.throng?.dragGhost?.hint?.(dropHint(subId)),
          );
        }
      }
      // Inside a sub-workspace window, a sub-workspace-OWNED Panel cannot be moved
      // out (to another sub-workspace or the main window). Leaving the window shows
      // a red invalid-drop warning; the drop itself is a no-op (no `detach` here).
      if (subWin && draggingOwned.current && e.timeStamp - hintAt.current > 120) {
        hintAt.current = e.timeStamp;
        const outside =
          e.clientX < 0 ||
          e.clientY < 0 ||
          e.clientX > window.innerWidth ||
          e.clientY > window.innerHeight;
        window.throng?.dragGhost?.hint?.(
          outside ? 'Can’t move a sub-workspace panel out of its window' : '',
          outside,
        );
      }
      if (ghostRaf.current) return;
      ghostRaf.current = true;
      requestAnimationFrame(() => {
        ghostRaf.current = false;
        window.throng?.dragGhost?.move();
      });
    };
    ghostMove.current = onMove;
    window.addEventListener('pointermove', onMove, true);

    if (panelId) {
      setDraggingPanelId(panelId);
      const panel = activeTab ? collectPanels(activeTab.root).find((p) => p.id === panelId) : null;
      // A Panel created inside a sub-workspace carries the window's synthetic
      // project id (`subworkspace:<id>` = layout.projectId); a cloned project Panel
      // keeps its real origin. Only the former is "owned" and blocked from leaving.
      draggingOwned.current = subWin !== null && panel?.originProjectId === layout.projectId;
      window.throng?.dragGhost?.start('panel', panel?.title ?? 'Panel');
    }
    if (tabId) {
      setDraggingTabId(tabId);
      const tab = layout.tabs.find((t) => t.id === tabId);
      window.throng?.dragGhost?.start('tab', tab?.title ?? 'Tab');
      const handler = trackTabDrag(tabId);
      moveListener.current = handler;
      window.addEventListener('pointermove', handler, true);
    }
  };

  const reset = (): void => {
    if (moveListener.current) {
      window.removeEventListener('pointermove', moveListener.current, true);
      moveListener.current = null;
    }
    if (ghostMove.current) {
      window.removeEventListener('pointermove', ghostMove.current, true);
      ghostMove.current = null;
    }
    window.throng?.dragGhost?.stop();
    clearHover();
    draggingOwned.current = false;
    setDraggingPanelId(null);
    setDraggingTabId(null);
    setIndicatorX(null);
    slotRef.current = null;
  };

  const clearHover = (): void => {
    hoverTabId.current = null;
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  // While dragging a PANEL over a tab chip, activate that tab after a configurable
  // dwell (FR-023) so the user can place the panel inside it. Dropping a panel on
  // a tab still moves it immediately (onDragEnd), so quick moves are unaffected.
  const onDragOver = (event: DragOverEvent): void => {
    if (!parsePanelDragId(String(event.active.id))) return;
    const overId = event.over ? String(event.over.id) : null;
    const overTab = overId ? parseTabDropId(overId) : null;
    if (overTab && overTab !== layout.activeTabId) {
      if (hoverTabId.current !== overTab) {
        clearHover();
        hoverTabId.current = overTab;
        hoverTimer.current = setTimeout(() => {
          ws.setActiveTab(overTab);
          clearHover();
        }, settings.behaviour.tabHoverActivateMs);
      }
    } else {
      clearHover();
    }
  };

  // A drop is "outside the window" when the last pointer position fell beyond the
  // viewport — that's the gesture that detaches a Tab/Panel into a new window
  // (US7 / FR-016). Only meaningful in the main window (where `detach` exists).
  const droppedOutside = (): boolean => {
    const p = lastPointer.current;
    return (
      !!p && (p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight)
    );
  };

  // Does a sub-workspace already contain this Panel? A Panel may live in a given
  // sub-workspace only once.
  const subHasPanel = (subId: string, panelId: string): boolean => {
    const sub = detach?.subWorkspaces.find((s) => s.id === subId);
    return !!sub?.tabs.some((t) => collectPanels(t.root).some((p) => p.id === panelId));
  };

  // The label shown on the ghost for the window/sub-workspace currently under the
  // cursor (item 4): which sub-workspace + Tab a drop will land on.
  const dropHint = (subId: string | null): string => {
    const info = dragInfo.current;
    if (!info) return '';
    if (!subId) return 'New sub-workspace';
    const sub = detach?.subWorkspaces.find((s) => s.id === subId);
    if (!sub) return 'New sub-workspace';
    const subPanelIds = new Set(sub.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id)));
    if (info.kind === 'tab') {
      const draggedTab = layout.tabs.find((t) => t.id === info.id);
      const newPanels = draggedTab
        ? collectPanels(draggedTab.root).filter((p) => !subPanelIds.has(p.id))
        : [];
      // Every Panel already present → no Tab will be created.
      if (draggedTab && newPanels.length === 0) return `All panels already in ${sub.name}`;
      return `Add to ${sub.name}`;
    }
    if (subPanelIds.has(info.id)) return `Already in ${sub.name}`;
    const tabId = sub.activeTabId ?? sub.tabs[0]?.id;
    const tab = sub.tabs.find((t) => t.id === tabId);
    return tab ? `Add to ${sub.name} › ${tab.title}` : `Add to ${sub.name}`;
  };

  // Drop outside the main window: if the cursor is over an existing sub-workspace
  // window, **sync** (clone) into it; otherwise create a **new** sub-workspace.
  // The main process resolves which window (if any) is under the cursor — the
  // renderer can't see other OS windows (US7 / item 5).
  const dropToSubWorkspace = (kind: 'tab' | 'panel', id: string): void => {
    if (!detach) return;
    void (async () => {
      const subId = (await window.throng?.subWorkspace?.atPoint?.()) ?? null;
      if (!subId) {
        detach.detachToNew(kind, id);
        return;
      }
      if (kind === 'tab') {
        detach.syncToExisting('tab', id, subId);
        return;
      }
      // A Panel can't be added to a sub-workspace it's already in; otherwise it
      // joins that window's active Tab (queried from the persisted record).
      if (subHasPanel(subId, id)) return;
      const target = detach.subWorkspaces.find((s) => s.id === subId);
      detach.syncToExisting('panel', id, subId, target?.activeTabId ?? target?.tabs[0]?.id);
    })();
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const slot = slotRef.current;
    const outside = droppedOutside();
    reset();

    const panelSrc = parsePanelDragId(activeId);
    if (panelSrc) {
      // Dropped beyond the window edge with no in-window target → sync/detach.
      if (!overId && outside && detach) {
        dropToSubWorkspace('panel', panelSrc);
        return;
      }
      if (!overId) return;
      // Dropped on the New-Tab (+) button → move the Panel into its own new Tab (FR-027).
      if (overId === NEW_TAB_DROP_ID) {
        ws.addTabFromPanel(panelSrc);
        return;
      }
      const edge = parseEdgeDropId(overId);
      if (edge && edge.panelId !== panelSrc) {
        ws.movePanelToEdge(panelSrc, edge.panelId, edge.edge as Edge);
        return;
      }
      const tabTarget = parseTabDropId(overId);
      if (tabTarget) ws.movePanelToTab(panelSrc, tabTarget);
      return;
    }

    const tabSrc = parseTabDragId(activeId);
    if (tabSrc) {
      if (outside && detach) {
        dropToSubWorkspace('tab', tabSrc);
        return;
      }
      if (slot !== null) {
        // `slot` is already the index into the post-removal array (reorderTab
        // removes the source first), so it maps directly.
        ws.reorderTab(tabSrc, slot);
      }
    }
  };

  // Tear down the editor documents a Tab destroy removes for good. Their state lives
  // in UI-main keyed by panelId — the one-buffer registry, the machine-wide dirty-file
  // lock and the recovery temp — and DELIBERATELY survives a panel unmount (a document
  // moved between tabs/windows must not be destroyed, use-editor.ts:918-931). So a Tab
  // destroy, which drops the panels for good, has to dispose them itself exactly as a
  // Panel destroy does (panel-placeholder.tsx:268); `ws.closeTab` is a pure layout op
  // and never would. Without this the file stays "open" forever and can never be
  // reopened in another editor until the daemon restarts (issue #145). `killsSession`
  // mirrors the Panel path: a LOCAL destroy of a *synced* project editor in a
  // sub-workspace keeps the document alive in the project (FR-006a / FR-021).
  const releaseTabEditors = (tab: Tab): void => {
    const inSubWorkspace = subWin !== null;
    for (const p of collectPanels(tab.root)) {
      const killsSession = !inSubWorkspace || p.originProjectId === layout.projectId;
      if (p.kind === 'editor' && killsSession) disposeEditor(p.id);
    }
  };

  const confirmCloseTab = async (tabId: string): Promise<void> => {
    const tab = layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const panels = countPanels(tab.root);
    const subs = runningSubprocessCount(tab.root);

    // Closing the LAST Tab of a sub-workspace closes the whole sub-workspace
    // (FR-029): closeTab keeps the workspace non-empty, so it would otherwise
    // no-op. Destroy the sub-workspace instead (terminating its live terminals).
    if (subWin !== null && layout.tabs.length <= 1) {
      const ok = await confirm({
        title: 'Destroy sub-workspace',
        message: `Destroy “${tab.title}”? It has ${panels} panel${panels === 1 ? '' : 's'}, ${subs} of which ${subs === 1 ? 'is' : 'are'} active.`,
        warningMessage: `This is the last tab in “${subWin.name}” — destroying it destroys the sub-workspace (project-owned panels it mirrored are merely closed).`,
        confirmLabel: 'Destroy sub-workspace',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      for (const p of collectPanels(tab.root)) {
        if (panelHasLiveTerminal(p.id)) void window.throng?.terminal?.kill?.(p.id);
      }
      await destroySubWorkspace(services.subWorkspaces, subWin.id);
      return;
    }

    const plan = planConfirmations('tab', settings.confirmations);
    if (plan.dialogs > 0) {
      const ok = await confirm({
        title: 'Destroy Tab',
        message: `Destroy “${tab.title}”? It has ${panels} panel${panels === 1 ? '' : 's'}, ${subs} of which ${subs === 1 ? 'is' : 'are'} active.`,
        confirmLabel: 'Destroy Tab',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: `This destroys “${tab.title}” and its ${panels} panel${panels === 1 ? '' : 's'}.`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }
    releaseTabEditors(tab);
    ws.closeTab(tabId);
  };

  const confirmCloseOthers = async (tabId: string): Promise<void> => {
    const others = layout.tabs.filter((t) => t.id !== tabId);
    const panels = others.reduce((n, t) => n + countPanels(t.root), 0);
    const subs = others.reduce((n, t) => n + runningSubprocessCount(t.root), 0);
    const plan = planConfirmations('tab', settings.confirmations);
    if (plan.dialogs > 0) {
      const ok = await confirm({
        title: 'Destroy other tabs',
        message: `Destroy ${others.length} other tab${others.length === 1 ? '' : 's'}? ${panels} panel${panels === 1 ? '' : 's'} across them, ${subs} active.`,
        confirmLabel: 'Destroy tabs',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: `This destroys ${others.length} tab${others.length === 1 ? '' : 's'} and their ${panels} panel${panels === 1 ? '' : 's'}.`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }
    for (const t of others) releaseTabEditors(t);
    ws.closeOtherTabs(tabId);
  };

  const menuItems = (tabId: string): MenuItem[] => [
    { label: 'Rename', icon: 'rename', onClick: () => setRenamingTabId(tabId) },
    // Sync (clone) this Tab into a sub-workspace (US7). Hidden in a sub-workspace
    // window (no detach context). "New Window" creates a new sub-workspace; an
    // existing one gets the Tab added. Cloning leaves the Tab in place.
    ...(detach
      ? [
          {
            label: 'Sync to',
            icon: 'send',
            submenu: [
              {
                label: 'New Sub-workspace',
                icon: 'detach',
                onClick: () => detach.detachToNew('tab', tabId),
              },
              ...detach.subWorkspaces.map((s) => ({
                label: s.name,
                icon: 'tab',
                onClick: () => detach.syncToExisting('tab', tabId, s.id),
              })),
            ],
          },
        ]
      : []),
    {
      label: 'Destroy Tab',
      icon: 'destroy',
      onClick: () => void confirmCloseTab(tabId),
      // In a sub-workspace the last Tab IS closeable — it closes the whole
      // sub-workspace (FR-029). In the main window a project keeps its last Tab.
      disabled: layout.tabs.length <= 1 && subWin === null,
    },
    {
      label: 'Destroy other tabs',
      icon: 'destroy',
      onClick: () => void confirmCloseOthers(tabId),
      disabled: layout.tabs.length <= 1,
    },
  ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <DragStateContext.Provider value={{ draggingPanelId }}>
        <div className="tab-strip" data-testid="tab-strip" ref={stripRef}>
          {draggingTabId !== null && indicatorX !== null ? (
            <div
              className="tab-insert"
              data-testid="tab-insert-indicator"
              style={{ left: indicatorX }}
              aria-hidden
            />
          ) : null}
          {layout.tabs.map((tab) => (
            <TabChip
              key={tab.id}
              tab={tab}
              active={tab.id === activeTab?.id}
              renaming={renamingTabId === tab.id}
              onRenameCommit={(title) => {
                ws.renameTab(tab.id, title);
                setRenamingTabId(null);
              }}
              onStartRename={() => setRenamingTabId(tab.id)}
              onMenu={(s) => openMenu(s.x, s.y, menuItems(s.tabId))}
            />
          ))}
          <NewTabButton onNewTab={() => setRenamingTabId(ws.addTab())} />
        </div>
        <div className="tab-body" data-testid="tab-body">
          {activeTab ? <SplitTree node={activeTab.root} tabId={activeTab.id} path={[]} /> : null}
        </div>
      </DragStateContext.Provider>
    </DndContext>
  );
}
