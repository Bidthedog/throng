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
import type {
  ProjectCategoryDto,
  ProjectDto,
  ProjectsCreateParams,
  ProjectsUpdateParams,
} from '@throng/ipc-contract';
import { RpcError } from './bridge.js';
import type { ProjectsClient } from './projects-client.js';
import {
  clearProjectSwitchPending,
  getActivePane,
  markProjectSwitchPending,
} from '../workspace/active-pane.js';

export interface ProjectsContextValue {
  projects: ProjectDto[];
  /** Project categories (046 FR-050 – FR-057), in list order — default category first. */
  categories: ProjectCategoryDto[];
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
  /**
   * Release the main window's view of a project without forgetting anything (046 US4, FR-032,
   * FR-036). Removes `id` from `loadedIds` and, only when it is the ACTIVE project, clears
   * `openedId` — the workspace unmounts and no project is active, exactly as at startup. Never
   * touches the daemon's persisted `is_active` (contracts/unload.md §5): purely a client-side
   * transition, session-only, and it never throws.
   */
  unloadProject(id: string): void;
  /**
   * Report a failure whose operation ran OUTSIDE `run()` — Unload's terminal step (046, contracts/
   * unload.md §2 "Failure") and Remove's Save-All guard, neither of which is a `client.*` RPC this
   * store owns. Goes through the SAME `fail` path and notice surface every other refusal here uses,
   * with the project as subject.
   *
   * `action` completes the notice's heading exactly as `run()`'s own `label` does
   * (`notice-text.ts#noticeHeading`: `Couldn't ${action} ${subject}`) — defaulted to `'unload'`
   * because that was this method's only caller until Remove's Save-All guard (branch review C1)
   * gained one too. A caller that does not pass it keeps saying "unload"; Remove says "remove".
   */
  reportFailure(message: string, projectName: string, action?: string): void;

  // ── Project categories (046, contracts/project-categories.md §1, §4) ───────────────────────────
  /**
   * Resolves the created category on success, `null` if the create was refused (empty or duplicate
   * name). Not a bare boolean (046 FR-053 controller ruling): choosing New Category… from a
   * project's Move to Category submenu needs the new category's id to move that project into it,
   * and every existing caller's `if (ok)` truthiness check is unaffected by the wider type.
   */
  createCategory(name: string): Promise<ProjectCategoryDto | null>;
  /** Resolves true on success, false if the rename was refused. */
  renameCategory(id: string, name: string): Promise<boolean>;
  /** Resolves true on success, false if the delete was refused (the default category). */
  deleteCategory(id: string): Promise<boolean>;
  /** Resolves true on success, false if the toggle was refused (the default category). */
  setCategoryMinimised(id: string, minimised: boolean): Promise<boolean>;
  /** Move a project into a category at a position in the owner's global order. */
  moveProject(id: string, categoryId: string, orderedIds: string[]): Promise<boolean>;
  /**
   * Reorder the NON-default categories (046 iterate round 1, FR-083,
   * contracts/project-categories.md §5). `orderedIds` names every non-default category exactly
   * once; the default always stays first. Resolves true on success, false if the reorder was
   * refused (an unknown id, a missing/duplicated id, or the default category's id).
   */
  reorderCategories(orderedIds: string[]): Promise<boolean>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

/**
 * The `errorAction` labels a successful `refresh()` is allowed to clear on its own (fix round on
 * a7ad4767; 030 "one condition, one notice").
 *
 * `refresh()` is not only the mount-time load: it also runs from the CROSS-WINDOW `onChanged`
 * listener, so a successful refresh can be triggered by someone else's edit in another window,
 * with nothing to do with whatever error this window is currently showing. A mutation refusal (from
 * `run()`) carries a different label and must persist until the user dismisses it or a later
 * mutation in THIS window supersedes it — `run()`'s own success path already calls `fail(null)`
 * directly for that case. Without this distinction, window A refuses a delete, leaves the notice
 * unread, window B renames an unrelated project, and A's still-unread refusal silently vanishes the
 * moment A's `onChanged` listener re-fetches and succeeds.
 */
const REFRESH_LOAD_ACTIONS: ReadonlySet<string> = new Set([
  'load your projects',
  'load your project categories',
]);

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
  const [categories, setCategories] = useState<ProjectCategoryDto[]>([]);
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
  // Read by `refresh` (a failed categories fetch keeps the last known value) and `categorySubject`.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  // Read by `refresh`, to tell ITS OWN load errors from a mutation refusal it must not clear.
  const errorActionRef = useRef(errorAction);
  errorActionRef.current = errorAction;

  /*
   * Projects and categories load ALONGSIDE each other, gated on the same `loading` flag, so a
   * caller that waits for loading to settle sees both together — never projects with categories
   * still to come. But the two fetches are resolved INDEPENDENTLY (`allSettled`, not `all`): a
   * genuine `projects.categories.list` failure must surface — through `fail()`, the one path every
   * other refusal in this store goes through — and not be swallowed, while the project list is a
   * completely different RPC and must not go down with it. A user whose categories fetch is broken
   * still needs to see, open and switch between their projects.
   *
   * `projects.list` failing takes priority when both fail at once: it is the more severe loss (no
   * projects at all), and the existing "load your projects" wording already covers it.
   */
  const refresh = useCallback(async () => {
    const [projectsResult, categoriesResult] = await Promise.allSettled([
      client.list(),
      client.listCategories(),
    ]);
    if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value);
    if (categoriesResult.status === 'fulfilled') setCategories(categoriesResult.value);
    if (projectsResult.status === 'rejected') {
      fail(messageOf(projectsResult.reason), 'load your projects');
    } else if (categoriesResult.status === 'rejected') {
      fail(messageOf(categoriesResult.reason), 'load your project categories');
    } else if (errorActionRef.current === null || REFRESH_LOAD_ACTIONS.has(errorActionRef.current)) {
      // Only clear an error refresh() itself could have raised. A mutation refusal (`run()`) is
      // none of those labels, so it survives this unrelated, successful load untouched.
      fail(null);
    }
    setLoading(false);
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

  /**
   * The category an operation is about, as a subject (046, contracts/project-categories.md §1
   * "Failures") — the same reasoning as {@link projectSubject}, one pane along.
   */
  const categorySubject = useCallback(
    (id: string): NoticeSubject => {
      const name = categoriesRef.current.find((c) => c.id === id)?.name;
      return name ? { kind: 'category', name } : { kind: 'none' };
    },
    [],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      categories,
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
        /*
         * FR-082, narrowed by Supersession S26 (spec 046, controller ruling `bb0e3e85`) — only mark
         * when this switch will actually MOVE the active project (`id !== previousId`, see
         * `active-pane.ts`'s `markProjectSwitchPending` doc comment) AND the Projects list is the
         * active pane AT THE MOMENT OF THIS CALL. `switchProject` is the one place both a
         * list-initiated switch (a click/Enter on a row) and a chord (`project.next`/`previous`, from
         * either pane) arrive, and `getActivePane()` here is the only thing that tells them apart.
         *
         * A live product defect (E2E) — marking unconditionally, chord-from-the-workspace included,
         * suppressed that route's OWN focus delivery: open a project's editor, click another
         * project's row, click its panel (active pane now 'workspace'), then project.previous — the
         * mark was set, `PanelFocusSync` consumed it and returned before
         * `setActivePane('workspace')`/`requestPanelFocus` ran, so `getActivePane()` still reported
         * 'workspace' (nothing had MOVED it away) while DOM focus landed in no panel at all — typing
         * went nowhere. 023 FR-030/#144 (`editor-caret-persist.e2e.ts:173`) requires that route to
         * keep delivering real focus into the new project's active panel, exactly as before FR-082.
         *
         * `id === previousId` is ALSO still excluded — a redundant click, or Enter, on the row that
         * is already active never changes `activeTabId`, so `PanelFocusSync` never gets a chance to
         * consume a mark set for it; marking it anyway left the mark stuck until the NEXT, entirely
         * unrelated `activeTabId` change (e.g. the tab picker's own same-project tab switch, which
         * carries no `setActivePane` call of its own), which then wrongly skipped
         * `setActivePane('workspace')`/`requestPanelFocus` too — the 52d8f13d/FR-014 Ctrl+S
         * regression that fix round guarded against, and still does here.
         */
        const willChangeProject = id !== previousId;
        if (willChangeProject && getActivePane() === 'projects') markProjectSwitchPending(id);
        setOpenedId(id); // open on demand (lazy)
        markLoaded(id);
        const opened = await run('open', projectSubject(id), () => client.setActive(id));
        if (!opened) {
          setOpenedId(previousId);
          if (!wasLoaded) unmarkLoaded(id);
          // A failed switch must not leave the mark stuck either — drain it explicitly rather than
          // relying on an activeTabId/layout change to have already consumed it, which is not
          // guaranteed (workspace-store.tsx never clears `layout` while a load is in flight, so a
          // switch that fails fast enough can leave it observably unchanged throughout).
          clearProjectSwitchPending();
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
      unloadProject: (id) => {
        unmarkLoaded(id);
        setOpenedId((cur) => (cur === id ? null : cur));
      },
      reportFailure: (message, projectName, action = 'unload') => {
        fail(message, action, projectName ? { kind: 'project', name: projectName } : { kind: 'none' });
      },
      // ── Project categories (046) — each calls its RPC, then refreshes and notifies other windows,
      // exactly as every project mutation above does. A refusal fails through `categorySubject`/the
      // typed-name subject and neither refreshes nor notifies (§1 "Failures").
      //
      // `createCategory` is NOT routed through `run()` (unlike its siblings below): `run()` discards
      // the action's own return value, and the caller needs the created category's id (046 FR-053
      // controller ruling — New Category… from a project's menu also moves that project into it).
      createCategory: async (name) => {
        try {
          const created = await client.createCategory(name);
          fail(null);
          await refresh();
          window.throng?.projects?.notifyChanged?.();
          return created;
        } catch (err) {
          fail(messageOf(err), 'create', { kind: 'category', name });
          return null;
        }
      },
      renameCategory: (id, name) =>
        run('rename', categorySubject(id), () => client.renameCategory(id, name)),
      deleteCategory: (id) => run('delete', categorySubject(id), () => client.deleteCategory(id)),
      setCategoryMinimised: (id, minimised) =>
        run('change', categorySubject(id), () => client.setCategoryMinimised(id, minimised)),
      moveProject: (id, categoryId, orderedIds) =>
        run('move', projectSubject(id), () => client.moveProject(id, categoryId, orderedIds)),
      // NO SUBJECT — a category reorder is about the LIST, not any one category (FR-027), the same
      // reasoning `reorderProjects` above already uses.
      reorderCategories: (orderedIds) =>
        run('reorder your categories', { kind: 'none' }, () => client.reorderCategories(orderedIds)),
    }),
    [
      projects,
      categories,
      activeProject,
      loadedIds,
      markLoaded,
      unmarkLoaded,
      loading,
      error,
      errorAction,
      errorSubject,
      fail,
      refresh,
      run,
      projectSubject,
      categorySubject,
      client,
    ],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within a ProjectsProvider');
  return ctx;
}
