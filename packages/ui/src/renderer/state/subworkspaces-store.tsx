import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { SubWorkspaceMetaDto } from '@throng/ipc-contract';
import type { SubWorkspacesClient } from './subworkspaces-client.js';

export interface SubWorkspacesContextValue {
  subWorkspaces: SubWorkspaceMetaDto[];
  /**
   * Ids of sub-workspaces opened (loaded into the session) at least once. Like
   * projects, a sub-workspace stays "loaded" after its window is closed — the
   * indicator reflects session membership, not whether a window is currently open.
   */
  loadedIds: ReadonlySet<string>;
  refresh(): Promise<void>;
  /**
   * Last sub-workspace operation error (e.g. a failed detach/create persist),
   * surfaced to the user; null when clear. Without this, a daemon-side failure in
   * the fire-and-forget create path would be silently swallowed.
   */
  error: string | null;
  /** Record an error to surface to the user. */
  reportError(message: string): void;
  /** Dismiss the current error. */
  clearError(): void;
  /** Open (and mark loaded) a sub-workspace window — the lazy reopen path (FR-013). */
  open(id: string): void;
  /** Record that a sub-workspace is loaded this session (e.g. when detach creates one). */
  markLoaded(id: string): void;
  rename(id: string, name: string): Promise<void>;
  recolour(id: string, colour: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Reorder the list to match `orderedIds` (drag-to-reorder), then persist. */
  reorder(orderedIds: string[]): Promise<void>;
}

const SubWorkspacesContext = createContext<SubWorkspacesContextValue | null>(null);

/**
 * Sub-workspaces list + management (US7 / FR-012-015). Loads metadata on mount
 * (lazy: list only, windows opened on demand) and re-fetches after each mutation.
 */
export function SubWorkspacesProvider({
  client,
  children,
}: {
  client: SubWorkspacesClient;
  children: ReactNode;
}): ReactElement {
  const [subWorkspaces, setSubWorkspaces] = useState<SubWorkspaceMetaDto[]>([]);
  // Sub-workspaces opened at least once this session; stays set after the window
  // closes (lazy-load indicator, mirroring projects).
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((message: string) => setError(message), []);
  const clearError = useCallback(() => setError(null), []);
  const markLoaded = useCallback((id: string) => {
    setLoadedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const open = useCallback(
    (id: string) => {
      markLoaded(id);
      window.throng?.subWorkspace?.open(id);
    },
    [markLoaded],
  );

  const refresh = useCallback(async () => {
    try {
      setSubWorkspaces(await client.list());
    } catch {
      /* leave the current list on a transient failure */
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SubWorkspacesContextValue>(
    () => ({
      subWorkspaces,
      loadedIds,
      refresh,
      error,
      reportError,
      clearError,
      open,
      markLoaded,
      rename: async (id, name) => {
        await client.rename(id, name);
        await refresh();
        // Tell an open sub-workspace window so its title (and dominant-colour accent)
        // update live — its onChanged handler re-reads the identity (name/colour).
        window.throng?.subWorkspace?.notifyChanged(id);
      },
      recolour: async (id, colour) => {
        // Optimistic local update — NO list refresh. The native <input type="color">
        // fires `recolour` repeatedly while the user is still picking; a refresh
        // would remount the list and slam the OS colour dialog shut (the swatch
        // "closes the moment you mouse-down"). Persisting without re-rendering keeps
        // the picker open and the swatch live.
        setSubWorkspaces((prev) => prev.map((s) => (s.id === id ? { ...s, colour } : s)));
        await client.recolour(id, colour);
        // Tell an open sub-workspace window so its dominant accent follows live —
        // safe for the picker because the relay excludes this (sender) window, so
        // OUR list never remounts mid-pick (colour syncs like the name does).
        window.throng?.subWorkspace?.notifyChanged(id);
      },
      remove: async (id) => {
        await client.remove(id);
        // If the sub-workspace's window is open, close it — a deleted
        // sub-workspace must not linger on screen.
        window.throng?.subWorkspace?.close(id);
        setLoadedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await refresh();
      },
      reorder: async (orderedIds) => {
        // Optimistic local reorder so the drop lands instantly; persist after.
        setSubWorkspaces((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]));
          return orderedIds.map((id) => byId.get(id)).filter((s): s is typeof prev[number] => !!s);
        });
        await client.reorder(orderedIds);
      },
    }),
    [subWorkspaces, loadedIds, error, reportError, clearError, open, markLoaded, refresh, client],
  );

  return <SubWorkspacesContext.Provider value={value}>{children}</SubWorkspacesContext.Provider>;
}

export function useSubWorkspaces(): SubWorkspacesContextValue {
  const ctx = useContext(SubWorkspacesContext);
  if (!ctx) throw new Error('useSubWorkspaces must be used within a SubWorkspacesProvider');
  return ctx;
}
