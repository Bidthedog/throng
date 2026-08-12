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
import type { NoticeSubject } from '@throng/core';
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
  /** What was being attempted when {@link error} happened, phrased to complete "…you tried to".
   *  A bare RPC failure names neither the operation nor the project it was for. */
  errorAction: string | null;
  /**
   * WHICH PROJECT the failure was about (030 FR-019/T033a).
   *
   * Recorded with the error for the same reason {@link errorAction} is: the operation knows what it
   * was acting on, and by the time an RPC has failed its message says only what went wrong. A user
   * with four projects open reading "An error occurred when you tried to delete this project" is
   * #195 exactly.
   */
  errorSubject: NoticeSubject | null;
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
  const [errorAction, setErrorAction] = useState<string | null>(null);
  const [errorSubject, setErrorSubject] = useState<NoticeSubject | null>(null);
  /** Record a failure with what was being attempted and what it was about; `null` clears all three. */
  const fail = useCallback((message: string | null, action?: string, subject?: NoticeSubject) => {
    setError(message);
    setErrorAction(message === null ? null : (action ?? null));
    setErrorSubject(message === null ? null : (subject ?? null));
  }, []);
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
  /**
   * A project that was optimistically opened and then FAILED to open is not loaded (#212).
   *
   * `loadedIds` means "opened at least once this session", and a switch marks it before the RPC has
   * agreed. Leaving the mark behind after a failure says a project is in memory when nothing ever
   * put it there.
   */
  const unmarkLoaded = useCallback((id: string) => {
    setLoadedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /*
   * The CURRENT values, readable from a callback that does not list them as dependencies (#212).
   *
   * `switchProject` lives in a `useMemo` whose dependency array deliberately omits `openedId` — so
   * reading it directly there would capture whatever it was when the memo last built, and "restore
   * the previous project" would restore a stale one. Refs are how the rest of this codebase solves
   * exactly that (`terminal-panel.tsx`), and they are always current.
   */
  const openedIdRef = useRef(openedId);
  openedIdRef.current = openedId;
  const loadedIdsRef = useRef(loadedIds);
  loadedIdsRef.current = loadedIds;
  // Read by `projectSubject` so naming a project does not make every command's identity depend on
  // the list — the same reason the two refs above exist.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const refresh = useCallback(async () => {
    try {
      setProjects(await client.list());
      fail(null);
    } catch (err) {
      fail(messageOf(err), 'load your projects');
    } finally {
      setLoading(false);
    }
  }, [client, fail]);

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

  // `label` completes "an error occurred when you tried to …", so a failed reorder no longer reports
  // a bare RPC string with no hint of which action produced it.
  const run = useCallback(
    async (label: string, subject: NoticeSubject, action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action();
        fail(null);
        await refresh();
        window.throng?.projects?.notifyChanged?.(); // sync other windows
        return true;
      } catch (err) {
        fail(messageOf(err), label, subject);
        return false;
      }
    },
    [refresh, fail],
  );

  /**
   * The project an operation is about, as a subject (030 FR-024).
   *
   * By id, resolved against the list, because that is what every command here is given — and the
   * NAME is what the user knows it by. A project that has already gone from the list (a delete that
   * raced a refresh) yields `{ kind: 'none' }` rather than an id rendered as prose: an identifier
   * the user has never seen is a worse answer than saying nothing (FR-027).
   */
  const projectSubject = useCallback(
    (id: string): NoticeSubject => {
      const name = projectsRef.current.find((p) => p.id === id)?.name;
      return name ? { kind: 'project', name } : { kind: 'none' };
    },
    [],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProject,
      loadedIds,
      loading,
      error,
      errorAction,
      errorSubject,
      clearError: () => fail(null),
      refresh,
      createProject: async (input) => {
        try {
          const created = await client.create(input);
          fail(null);
          setOpenedId(created.id); // a freshly created project opens immediately
          markLoaded(created.id);
          await refresh();
          window.throng?.projects?.notifyChanged?.(); // sync other windows
          return true;
        } catch (err) {
          // The name the user typed: the project does not exist yet, so the list cannot supply it.
          fail(messageOf(err), 'create', { kind: 'project', name: input.name });
          return false;
        }
      },
      updateProject: (params) => run('update', projectSubject(params.id), () => client.update(params)),
      deleteProject: async (id) => {
        await run('delete', projectSubject(id), () => client.remove(id));
        setOpenedId((cur) => (cur === id ? null : cur)); // closing what was open
        setLoadedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      switchProject: async (id) => {
        /*
         * Optimistic, and REVERTED when the open fails (#212).
         *
         * Opening on demand before the RPC answers is what keeps the switch feeling instant, and that
         * is worth keeping. What was missing is the other half: when the RPC fails, the store went on
         * believing it was in a project it had never entered.
         *
         * The visible cost was not the wrong highlight — it was the NEXT switch. Asking to open the
         * project the store already (wrongly) thinks is open can be refused as a no-op, so the click
         * does nothing whatever: no work attempted, no error, no notice. Measured as a test that
         * raised a notice on three runs and, unchanged, raised none on the fourth.
         */
        const previousId = openedIdRef.current;
        const wasLoaded = loadedIdsRef.current.has(id);
        setOpenedId(id); // open on demand (lazy)
        markLoaded(id);
        const opened = await run('open', projectSubject(id), () => client.setActive(id));
        if (!opened) {
          setOpenedId(previousId);
          if (!wasLoaded) unmarkLoaded(id);
        }
      },
      reorderProjects: async (orderedIds) => {
        // NO SUBJECT: a reorder is about the LIST, not about any one project in it, and picking one
        // of them would name a project that did not fail (FR-027).
        await run('reorder your projects', { kind: 'none' }, () => client.reorder(orderedIds));
      },
      setProjectHidden: async (id, hiddenPaths) => {
        await run('change what is hidden in', projectSubject(id), () => client.setHidden(id, hiddenPaths));
      },
    }),
    [projects, activeProject, loadedIds, markLoaded, unmarkLoaded, loading, error, errorAction, errorSubject, fail, refresh, run, projectSubject, client],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within a ProjectsProvider');
  return ctx;
}
