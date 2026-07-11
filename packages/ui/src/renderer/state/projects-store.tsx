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
import type { ProjectDto, ProjectsCreateParams, ProjectsUpdateParams } from '@throng/ipc-contract';
import { RpcError } from './bridge.js';
import type { ProjectsClient } from './projects-client.js';

export interface ProjectsContextValue {
  projects: ProjectDto[];
  activeProject: ProjectDto | null;
  /** Ids of projects opened (loaded into memory) this session (Lazy loading). */
  loadedIds: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  /** Dismiss the current error immediately (011, US1, FR-002). */
  clearError(): void;
  refresh(): Promise<void>;
  /** Resolves true on success, false if the create was rejected (e.g. validation). */
  createProject(input: ProjectsCreateParams): Promise<boolean>;
  /** Resolves true on success, false if the update was rejected. */
  updateProject(params: ProjectsUpdateParams): Promise<boolean>;
  deleteProject(id: string): Promise<void>;
  switchProject(id: string): Promise<void>;
  reorderProjects(orderedIds: string[]): Promise<void>;
  /** Replace a project's hidden-paths list (004 file-tree hide). */
  setProjectHidden(id: string, hiddenPaths: string[]): Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof RpcError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Projects state + commands for US1 (FR-002/004/005). Loads the project list on
 * mount, re-fetches after every mutation, and applies the active project's
 * dominant colour as the `--accent` CSS variable so the current context is
 * unambiguous (FR-004). The Workspace and Terminals panels read `activeProject`
 * to swap per project (FR-005).
 */
export function ProjectsProvider({
  client,
  children,
}: {
  client: ProjectsClient;
  children: ReactNode;
}): ReactElement {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lazy project loading (Constitution "Lazy project loading", research D7):
  // startup opens NOTHING — only the project the user explicitly opens (or just
  // created) becomes active. The daemon still persists a "last active" project,
  // but it is listed, not auto-opened, on launch.
  const [openedId, setOpenedId] = useState<string | null>(null);
  // Projects opened (and thus loaded into memory) at least once this session.
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(() => new Set());
  const markLoaded = useCallback((id: string) => {
    setLoadedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setProjects(await client.list());
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh when ANOTHER window mutates a project (create/rename/recolour/delete),
  // so this window's projects list — and the sub-workspace owner labels derived from
  // it — stay live without a reload.
  useEffect(() => {
    return window.throng?.projects?.onChanged?.(() => void refresh());
  }, [refresh]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === openedId) ?? null,
    [projects, openedId],
  );

  // Apply the active project's dominant colour as the active-context accent (FR-004).
  useEffect(() => {
    const accent = activeProject?.colour;
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
    }
  }, [activeProject]);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action();
        setError(null);
        await refresh();
        window.throng?.projects?.notifyChanged?.(); // sync other windows
        return true;
      } catch (err) {
        setError(messageOf(err));
        return false;
      }
    },
    [refresh],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProject,
      loadedIds,
      loading,
      error,
      clearError: () => setError(null),
      refresh,
      createProject: async (input) => {
        try {
          const created = await client.create(input);
          setError(null);
          setOpenedId(created.id); // a freshly created project opens immediately
          markLoaded(created.id);
          await refresh();
          window.throng?.projects?.notifyChanged?.(); // sync other windows
          return true;
        } catch (err) {
          setError(messageOf(err));
          return false;
        }
      },
      updateProject: (params) => run(() => client.update(params)),
      deleteProject: async (id) => {
        await run(() => client.remove(id));
        setOpenedId((cur) => (cur === id ? null : cur)); // closing what was open
        setLoadedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      switchProject: async (id) => {
        setOpenedId(id); // open on demand (lazy)
        markLoaded(id);
        await run(() => client.setActive(id));
      },
      reorderProjects: async (orderedIds) => {
        await run(() => client.reorder(orderedIds));
      },
      setProjectHidden: async (id, hiddenPaths) => {
        await run(() => client.setHidden(id, hiddenPaths));
      },
    }),
    [projects, activeProject, loadedIds, markLoaded, loading, error, refresh, run, client],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within a ProjectsProvider');
  return ctx;
}
