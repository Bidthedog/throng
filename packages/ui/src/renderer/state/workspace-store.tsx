import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  addPanel as opAddPanel,
  addTab as opAddTab,
  movePanelToEdge as opMovePanelToEdge,
  movePanelToTab as opMovePanelToTab,
  addTabFromPanel as opAddTabFromPanel,
  removePanel as opRemovePanel,
  reorderTab as opReorderTab,
  setActiveTab as opSetActiveTab,
  renameTab as opRenameTab,
  renamePanel as opRenamePanel,
  resetPanelName as opResetPanelName,
  closeTab as opCloseTab,
  closeOtherTabs as opCloseOtherTabs,
  resizeSplit as opResizeSplit,
  setActivePanel as opSetActivePanel,
  panelAfterRemoval,
  effectiveActivePanelId,
  collectPanels,
  bumpZoom as opBumpZoom,
  resetZoom as opResetZoom,
  setPanelType as opSetPanelType,
  clearPanelType as opClearPanelType,
  updatePanelConfig as opUpdatePanelConfig,
  type Edge,
  type PanelConfig,
  type PanelKind,
  type WorkspaceLayout,
} from '@throng/core';
import type { WorkspaceClient } from './workspace-client.js';
import { registerLayoutFlusher, trackLayoutSave } from './layout-saves.js';

const AUTOSAVE_DEBOUNCE_MS = 400;

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export interface WorkspaceContextValue {
  layout: WorkspaceLayout | null;
  loading: boolean;
  /** True when a previously-saved layout could not be restored (US3). */
  restoreFailed: boolean;
  /** The Panel just created via addPanel — it should open in rename mode (FR-041). */
  lastAddedPanelId: string | null;
  clearLastAddedPanel(): void;
  /** Returns the new Tab's id so the caller can immediately rename it. */
  addTab(): string;
  /** Returns the new Panel's id. */
  addPanel(tabId: string): string;
  movePanelToEdge(sourceId: string, targetId: string, edge: Edge): void;
  movePanelToTab(sourceId: string, tabId: string): void;
  /** Move a Panel into a brand-new Tab containing only that Panel (FR-027). */
  addTabFromPanel(sourceId: string): void;
  removePanel(panelId: string): void;
  reorderTab(tabId: string, toIndex: number): void;
  setActiveTab(tabId: string): void;
  /** Activate (highlight) a Panel within a Tab (FR-002). Window-local: selection is
   *  deliberately NOT mirrored across windows (revised 2026-07-02 — sub-workspace
   *  focus is independent of the main window's). */
  setActivePanel(tabId: string, panelId: string): void;
  /** Zoom ONE panel in/out by `presses` (012, per-instance). Persisted on the panel
   *  in the layout blob; every other panel is untouched. */
  bumpZoom(panelId: string, presses: number): void;
  /** Reset ONE panel to its default (inherited) text size (012, FR-009). */
  resetZoom(panelId: string): void;
  renameTab(tabId: string, title: string): void;
  renamePanel(panelId: string, title: string): void;
  resetPanelName(panelId: string): void;
  closeTab(tabId: string): void;
  closeOtherTabs(tabId: string): void;
  resizeSplit(tabId: string, path: number[], sizes: number[]): void;
  /** Assign a confirmed type + config to an untyped Panel (005 / FR-006). */
  setPanelType(panelId: string, kind: PanelKind, config: PanelConfig): void;
  /** Revert a typed Panel back to the type-selection form (005 / FR-020). */
  clearPanelType(panelId: string): void;
  /** Merge partial config into an already-typed Panel (006 — persist editor path). */
  updatePanelConfig(panelId: string, config: PanelConfig): void;
  /**
   * Replace the whole layout and persist it (US7 detach): a detach trims a Tab/
   * Panel out of the main workspace, so the result is set wholesale rather than
   * via an incremental op.
   */
  replaceLayout(next: WorkspaceLayout): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Renderer workspace store (US2/US3): mirrors the active project's layout and
 * dispatches the pure core operations locally (instant, no IPC in the drag loop),
 * persisting each result to the daemon via a debounced `workspace.save`
 * (research D4). Loads the layout when the active project changes.
 */
export function WorkspaceProvider({
  client,
  activeProjectId,
  children,
}: {
  client: WorkspaceClient;
  activeProjectId: string | null;
  children: ReactNode;
}): ReactElement {
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [lastAddedPanelId, setLastAddedPanelId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The layout pending a debounced save, so it can be flushed immediately on a
  // project switch or unmount rather than being dropped (no silent data loss).
  const pendingSave = useRef<WorkspaceLayout | null>(null);

  // RETURNS the save, rather than dropping it with `void` (019 FR-010): a drain that is not
  // awaited is not a drain — `await` on a void function awaits `undefined` and acks having
  // settled nothing, which is the very defect #86 reports. Nothing pending resolves
  // immediately, and a FAILED save still resolves: a write that cannot land must not wedge
  // the close (it is surfaced through the existing reload path, as before).
  const flushSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (!pending) return;
    // Tracked as well as awaited: a save is not one hop (a sub-workspace's is two round-trips),
    // and this same promise is what a concurrent drain must await rather than race.
    await trackLayoutSave(client.save(pending.projectId, pending));
  }, [client]);

  // Join the window's drain (019 FR-010). Registered for as long as the provider is mounted,
  // so the close settles this layout wherever it is hosted — main window or sub-workspace (C6).
  useEffect(() => registerLayoutFlusher(flushSave), [flushSave]);

  // Load the active project's layout whenever it changes. Flush any pending save
  // for the OUTGOING project first so switching never drops an in-flight edit.
  useEffect(() => {
    let cancelled = false;
    // Unchanged behaviour: these two fire-and-forget exactly as they did before the drain
    // gave `flushSave` a return type. `void` states that this caller is not the drain.
    void flushSave();
    if (!activeProjectId) {
      setLayout(null);
      setRestoreFailed(false);
      return;
    }
    setLoading(true);
    void client
      .load(activeProjectId)
      .then((result) => {
        if (cancelled) return;
        setLayout(result.layout);
        setRestoreFailed(result.restored === false && result.reason === 'corrupt');
      })
      .catch(() => {
        if (!cancelled) setRestoreFailed(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      // On switch/unmount, persist whatever was queued for this project.
      void flushSave();
    };
  }, [activeProjectId, client, flushSave]);

  const scheduleSave = useCallback(
    (next: WorkspaceLayout) => {
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const pending = pendingSave.current;
        pendingSave.current = null;
        if (pending) {
          // The promise is still DROPPED here — the drag loop must not await a save — but it is
          // no longer dropped on the FLOOR. Once this timer has fired, `flushSave` has nothing
          // pending to report, so this is the only record that the write exists; without it a
          // drain arriving now acks a write that is still in flight, and the close that follows
          // destroys the window mid-round-trip (019 FR-010).
          void trackLayoutSave(client.save(pending.projectId, pending));
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [client],
  );

  const apply = useCallback(
    (op: (current: WorkspaceLayout) => WorkspaceLayout) => {
      setLayout((prev) => {
        if (!prev) return prev;
        const next = op(prev);
        if (next !== prev) scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      layout,
      loading,
      restoreFailed,
      lastAddedPanelId,
      clearLastAddedPanel: () => setLastAddedPanelId(null),
      addTab: () => {
        const tab = newId();
        apply((l) => opAddTab(l, { tab, panel: newId() }));
        return tab;
      },
      addPanel: (tabId) => {
        const panel = newId();
        setLastAddedPanelId(panel);
        apply((l) => opAddPanel(l, tabId, panel));
        return panel;
      },
      movePanelToEdge: (sourceId, targetId, edge) =>
        apply((l) => opMovePanelToEdge(l, sourceId, targetId, edge)),
      movePanelToTab: (sourceId, tabId) => apply((l) => opMovePanelToTab(l, sourceId, tabId)),
      addTabFromPanel: (sourceId) => apply((l) => opAddTabFromPanel(l, sourceId, { tab: newId() })),
      removePanel: (panelId) =>
        apply((l) => {
          // Deterministic focus fallback (012, FR-005): when the panel being
          // removed is the active one, re-home focus to the panel preceding it in
          // layout order (or the following one if it was first) so the window is
          // never left routing input to a panel that no longer exists.
          const tab = l.tabs.find((t) => collectPanels(t.root).some((p) => p.id === panelId));
          const wasActive = tab ? effectiveActivePanelId(tab) === panelId : false;
          const fallback = tab && wasActive ? panelAfterRemoval(tab.root, panelId) : undefined;
          const next = opRemovePanel(l, panelId);
          if (next === l) return l; // removal refused (last panel) — no change
          return tab && fallback ? opSetActivePanel(next, tab.id, fallback) : next;
        }),
      reorderTab: (tabId, toIndex) => apply((l) => opReorderTab(l, tabId, toIndex)),
      setActiveTab: (tabId) => apply((l) => opSetActiveTab(l, tabId)),
      setActivePanel: (tabId, panelId) => apply((l) => opSetActivePanel(l, tabId, panelId)),
      bumpZoom: (panelId, presses) => apply((l) => opBumpZoom(l, panelId, presses)),
      resetZoom: (panelId) => apply((l) => opResetZoom(l, panelId)),
      renameTab: (tabId, title) => apply((l) => opRenameTab(l, tabId, title)),
      renamePanel: (panelId, title) => apply((l) => opRenamePanel(l, panelId, title)),
      resetPanelName: (panelId) => apply((l) => opResetPanelName(l, panelId)),
      closeTab: (tabId) => apply((l) => opCloseTab(l, tabId)),
      closeOtherTabs: (tabId) => apply((l) => opCloseOtherTabs(l, tabId)),
      resizeSplit: (tabId, path, sizes) => apply((l) => opResizeSplit(l, tabId, path, sizes)),
      setPanelType: (panelId, kind, config) =>
        apply((l) => opSetPanelType(l, panelId, kind, config)),
      clearPanelType: (panelId) => apply((l) => opClearPanelType(l, panelId)),
      updatePanelConfig: (panelId, config) => apply((l) => opUpdatePanelConfig(l, panelId, config)),
      replaceLayout: (next) => {
        setLayout(next);
        scheduleSave(next);
      },
    }),
    [layout, loading, restoreFailed, lastAddedPanelId, apply, scheduleSave],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
