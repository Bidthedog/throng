import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { formatGrouped, listRows, projectRootWouldContainOpenEditor, type ListRow } from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { useErrorNotice } from '../common/notification.js';
import { allEditorStates, useDirtyProjectKey } from '../editor/editor-state.js';
import { promptDirtyClose } from '../editor/dirty-close-store.js';
import { disposeEditor } from '../editor/use-editor.js';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  countPanels,
  planConfirmations,
  resolveStartingFolder,
  SUBWORKSPACE_PALETTE,
} from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { writeConfigPatch } from '../config/write-config.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useConfirm } from '../confirm-dialog.js';
import { FolderPicker } from '../common/folder-picker.js';
import { setActivePane, useActivePane } from '../workspace/active-pane.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useDetach } from '../workspace/detach-context.js';
import { projectMenu } from './project-menu.js';
import { categoryMenu } from './category-menu.js';
import { unloadProject as runUnload, type UnloadCollaborators } from './unload-project.js';
import {
  registerProjectsPanelCommands,
  unregisterProjectsPanelCommands,
} from './projects-panel-commands.js';

type Row = ListRow<ProjectDto, ProjectCategoryDto>;

/** `project:<id>` or `category:<id>` — the roving-tabindex/focus pointer (046 US2, T040). */
type RowKey = string;
const rowKey = (row: Row): RowKey =>
  row.kind === 'category' ? `category:${row.category.id}` : `project:${row.project.id}`;

const MARQUEE_DELAY_MS = 200;

const projectDragId = (id: string): string => `proj|${id}`;
const parseProjectDragId = (id: string): string | null =>
  id.startsWith('proj|') ? id.slice(5) : null;

/** 046 iterate round 1 (FR-083, T138) — a distinct drag-id scheme for a category HEADER, so ONE
 *  `DndContext` (`onDragStart`/`onDragEnd` below) can tell a header drag from a project drag apart
 *  by its id alone. */
const categoryDragId = (id: string): string => `cat|${id}`;
const parseCategoryDragId = (id: string): string | null =>
  id.startsWith('cat|') ? id.slice(4) : null;

/**
 * A drag affordance for reordering a project (FR-046). 046 iterate round 1 (FR-075, T137) moved
 * the actual `useDraggable` wiring to the row itself (`DraggableProjectRow` below) — a press
 * anywhere on the row starts the same drag, the name/swatch/empty-space included — so this is now a
 * plain visual handle: its own `pointerdown` bubbles to the row exactly as one on the name or the
 * swatch does. Out of Tab order for the same reason it always was: only the row is a tab stop.
 */
function ProjectGrip({ id }: { id: string }): ReactElement {
  return (
    <span className="project-item__grip" data-testid={`project-grip-${id}`} title="Drag to reorder" tabIndex={-1}>
      ⠿
    </span>
  );
}

/**
 * 046 iterate round 1 (FR-075, T137) — the whole-row drag source: `useDraggable`'s `listeners`
 * (dnd-kit's `onPointerDown`) now live on the row `<li>` itself, not just the grip, so a press
 * starting on the name, the colour swatch or the row's own empty space starts the same real dnd-kit
 * drag `dragGripTo` (the grip) already did. `refCallback` merges dnd-kit's `setNodeRef` with the
 * panel's own roving-tabindex row ref (`rowRefs`) on the SAME node — whole-row dragging is exactly
 * the case where both need the one element. `{...listeners} {...attributes}` are spread BEFORE the
 * row's own `role`/`aria-*`/`tabIndex` (passed through `rest`), the same ordering `ProjectGrip` used
 * to rely on, so the tree semantics this row already carries are never overwritten by dnd-kit's
 * defaults.
 */
function DraggableProjectRow({
  id,
  refCallback,
  children,
  ...rest
}: {
  id: string;
  refCallback: (el: HTMLLIElement | null) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'li'>, 'ref' | 'children'>): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: projectDragId(id) });
  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        refCallback(el);
      }}
      {...listeners}
      {...attributes}
      {...rest}
    >
      {children}
    </li>
  );
}

/**
 * 046 iterate round 1 (FR-083, T138) — the header drag source for a NON-default category: the same
 * `useDraggable`/`refCallback` merge `DraggableProjectRow` uses, keyed by {@link categoryDragId}
 * instead. The default category never renders through this component (the row map below routes it
 * to a plain `<li>`), so it is simply never a draggable node — no drop can ever place a category
 * above it, and this component's own existence is exactly the "not draggable" contract for it.
 */
function DraggableCategoryHeader({
  id,
  refCallback,
  children,
  ...rest
}: {
  id: string;
  refCallback: (el: HTMLLIElement | null) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'li'>, 'ref' | 'children'>): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: categoryDragId(id) });
  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        refCallback(el);
      }}
      {...listeners}
      {...attributes}
      {...rest}
    >
      {children}
    </li>
  );
}

/**
 * The project's root path in a de-emphasised line. When it overflows, hovering
 * starts a horizontal marquee scroll after ~200 ms and resets on leave (FR-032).
 */
function PathLabel({ path }: { path: string }): ReactElement {
  const outerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);

  const onEnter = (): void => {
    timer.current = setTimeout(() => {
      const el = outerRef.current;
      if (!el) return;
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow > 0) setOffset(overflow);
    }, MARQUEE_DELAY_MS);
  };
  const onLeave = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setOffset(0);
  };

  return (
    <span
      ref={outerRef}
      className="project-item__path"
      data-testid="project-path"
      title={path}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span
        className="project-item__path-text"
        style={{
          transform: `translateX(${-offset}px)`,
          transition: offset > 0 ? `transform ${Math.max(2, offset / 30)}s linear` : 'transform 0.2s',
        }}
      >
        {path}
      </span>
    </span>
  );
}

interface DraftState {
  mode: 'create' | 'edit';
  id?: string;
  name: string;
  colour: string;
  rootFolder: string;
}

/**
 * Projects Panel (US1 / FR-002,009): the project list plus create / edit /
 * delete / switch controls. A single form drives both create and edit. Clicking
 * a project switches the active context (FR-005).
 */
export function ProjectsPanel({ headerExtra }: { headerExtra?: ReactNode } = {}): ReactElement {
  const {
    projects,
    categories,
    activeProject,
    loadedIds,
    error,
    errorAction,
    errorSubject,
    clearError,
    createProject,
    updateProject,
    deleteProject,
    switchProject,
    reorderProjects,
    unloadProject: unloadProjectInStore,
    reportFailure,
    createCategory,
    renameCategory,
    deleteCategory,
    setCategoryMinimised,
    moveProject,
    reorderCategories,
  } = useProjects();

  // 018 / FR-051 — this used to be a bespoke error STRIP rendered inline, one of four across the
  // main window, each with its own markup, its own dismiss button and its own CSS block.
  useErrorNotice(error, 'project-error', errorSubject ?? { kind: 'none' }, clearError, errorAction);

  const confirm = useConfirm();
  const settings = useAppSettings();
  const ws = useWorkspace();
  const contextMenu = useContextMenu();
  // 046 US4 (FR-037) — the sub-workspaces WITH their Tabs, so Unload can spare a panel one of them
  // holds. `null` only outside the main window, which never renders ProjectsPanel.
  const detach = useDetach();
  // Projects with any unsaved editor light the shared unsaved dot (006, US8) —
  // which replaces the old "loaded" dot.
  const dirtyKey = useDirtyProjectKey();
  const dirtyProjects = useMemo(
    () => new Set(dirtyKey ? dirtyKey.split(',') : []),
    [dirtyKey],
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  /**
   * 046 US5 (FR-053) — the ONE inline name field shared by New Category and Rename Category,
   * exactly as the task text asks ("refusing as `commitRename` does"): a single piece of state, a
   * single `category-name-input`, never two of them mounted at once.
   */
  type CategoryDraftState =
    | { mode: 'create'; forProjectId?: string }
    | { mode: 'rename'; id: string };
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraftState | null>(null);

  // Drag-to-reorder state (FR-046), computed from the live cursor Y vs the other
  // rows' rects — deterministic, like the tab strip.
  const listRef = useRef<HTMLUListElement>(null);
  const moveListener = useRef<((e: PointerEvent) => void) | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicatorY, setIndicatorY] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /*
   * 046 US2 (FR-015, FR-018, T040) — the ARIA tree over `listRows`: one row per category header and
   * per project, in the SAME order the Next/Previous chords and the cog menu already step through
   * (`listRows`/`stepProject`, `side-pane-actions.ts`), so the visible order and the keyboard order
   * can never disagree.
   */
  const rows = useMemo<Row[]>(
    () => listRows(projects, categories, activeProject?.id ?? null),
    [projects, categories, activeProject],
  );

  /** Category ids in LIST order (FR-056) — read off `rows`, so it can never disagree with what is
   *  drawn. Used to find "the next category" when a target category has no current members. */
  const categoryOrder = useMemo(
    () => rows.filter((r) => r.kind === 'category').map((r) => r.category.id),
    [rows],
  );

  /**
   * The GLOBAL flat order (contracts/project-categories.md §1 — `projects.move`'s `orderedIds`)
   * after `movingId` is appended to the END of `categoryId`'s members (FR-055 "at the end of that
   * category"; FR-056 — an EMPTY category is still a legitimate drop/move target).
   *
   * With no current member of `categoryId`, the insertion point is just before the first project of
   * whichever LATER category (in list order) has one — or the very end, when none does.
   */
  const orderedIdsAppendingToCategory = useCallback(
    (movingId: string, categoryId: string): string[] => {
      const withoutMoving = projects.map((p) => p.id).filter((pid) => pid !== movingId);
      const categoryOf = (pid: string): string | undefined => projects.find((p) => p.id === pid)?.categoryId;
      let lastIdx = -1;
      withoutMoving.forEach((pid, i) => {
        if (categoryOf(pid) === categoryId) lastIdx = i;
      });
      let insertAt: number;
      if (lastIdx !== -1) {
        insertAt = lastIdx + 1;
      } else {
        const pos = categoryOrder.indexOf(categoryId);
        const later = new Set(categoryOrder.slice(pos + 1));
        const nextIdx = withoutMoving.findIndex((pid) => later.has(categoryOf(pid) ?? ''));
        insertAt = nextIdx === -1 ? withoutMoving.length : nextIdx;
      }
      withoutMoving.splice(insertAt, 0, movingId);
      return withoutMoving;
    },
    [projects, categoryOrder],
  );

  const rowRefs = useRef(new Map<RowKey, HTMLLIElement>());
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const [focusedKey, setFocusedKey] = useState<RowKey | null>(null);
  const isProjectsActive = useActivePane() === 'projects';

  /** The row a fresh `focus.projects` (or Home) lands on: the active project's, else the first. */
  const defaultRowKey = useMemo<RowKey | null>(() => {
    if (rows.length === 0) return null;
    const activeRow = activeProject
      ? rows.find((r) => r.kind === 'project' && r.project.id === activeProject.id)
      : undefined;
    return rowKey(activeRow ?? rows[0]);
  }, [rows, activeProject]);

  /*
   * The row roving tabindex treats as "current" — the row a user last MOVED TO with the state's own
   * keyboard handler, OR (before that has ever happened) the default row, so exactly one row is
   * `tabIndex={0}` from the very first render rather than none being reachable by Tab at all.
   *
   * Fix round (flake investigation; a real, if narrow, production race, not only a test-timing one)
   * — falls back to `defaultRowKey` the MOMENT `focusedKey` names a row `rows` no longer renders,
   * computed HERE during render rather than waiting for the correcting `useEffect` below to catch up
   * on its own next commit. `focusedKey ?? defaultRowKey` alone only ever substitutes for `null`, so
   * a project deleted (or a category minimised) out from under the focused row left `focusedKey`
   * truthy but pointing at nothing for exactly one render — `tabIndex={effectiveFocusedKey === key ?
   * 0 : -1}` then matched NOTHING at all, and the whole tree lost its one Tab stop until the effect's
   * next render committed. A user tabbing in that gap left the tree instead of entering it (the same
   * gap made `projects-panel-keyboard.test.ts`'s own assertion of this flaky under load, depending on
   * whether it ran before or after the effect's correction landed). The effect still runs afterwards,
   * unchanged, for the smarter category-header fallback and to move real DOM focus.
   */
  const effectiveFocusedKey =
    focusedKey !== null && rows.some((r) => rowKey(r) === focusedKey) ? focusedKey : defaultRowKey;

  /*
   * Review finding 6 — `focusedKey` named a row that can vanish out from under it: a project
   * deleted, or (US5) a category minimising over a non-active member. Left alone, `effectiveFocusedKey`
   * would keep naming a row nothing renders, and `tabIndex={effectiveFocusedKey === key ? 0 : -1}`
   * would then match NOTHING — the whole tree loses its one Tab stop rather than falling back to the
   * default row the `?? defaultRowKey` above exists to provide.
   */
  /*
   * Branch review (renderer-ui #1) — leaving DOM focus untouched here drops it to `document.body`
   * the moment the row holding it disappears (a minimised category hiding it, a move into one, or
   * another window minimising the category that holds the locally focused row): the roving tabindex
   * still shows `tabIndex={0}` on SOME row, but nothing is actually focused, so the next Tab leaves
   * the tree instead of entering it. Move real DOM focus — only when the vanishing row actually held
   * it — to the category header it went under, if that header still renders, else the default row.
   *
   * `hadDomFocusOnVanish` MUST be read during RENDER, not inside the effect below: an unmounted DOM
   * node's focus falls back to `document.body` as part of the removal itself (both in browsers and
   * jsdom), which happens during React's commit — before a passive effect ever runs. By then
   * `document.activeElement` already says `body` and the vanishing row's ref has already been
   * cleared, so checking there would always read false. Render still sees the OLD, still-mounted DOM.
   */
  const vanishingFocusedRowKey: RowKey | null =
    focusedKey !== null && !rows.some((r) => rowKey(r) === focusedKey) ? focusedKey : null;
  const hadDomFocusOnVanish =
    vanishingFocusedRowKey !== null && document.activeElement === rowRefs.current.get(vanishingFocusedRowKey);

  useEffect(() => {
    if (vanishingFocusedRowKey === null) return;
    const projectId = vanishingFocusedRowKey.startsWith('project:')
      ? vanishingFocusedRowKey.slice('project:'.length)
      : null;
    const categoryId = projectId ? projects.find((p) => p.id === projectId)?.categoryId : undefined;
    const headerKey: RowKey | null =
      categoryId !== undefined && rows.some((r) => rowKey(r) === `category:${categoryId}`)
        ? `category:${categoryId}`
        : null;
    const fallback = headerKey ?? defaultRowKey;
    setFocusedKey(fallback);
    if (hadDomFocusOnVanish && fallback) rowRefs.current.get(fallback)?.focus();
  }, [rows, vanishingFocusedRowKey, hadDomFocusOnVanish, projects, defaultRowKey]);

  const focusRow = useCallback((key: RowKey | null) => {
    setFocusedKey(key);
    if (key) rowRefs.current.get(key)?.focus();
  }, []);

  /*
   * Real DOM focus can also arrive WITHOUT going through `focusRow` — Tab, a mouse click on a row,
   * or `focus.projects`'s imperative `.focus()` before this component's own state has ever been
   * touched. Without this, the roving-tabindex STATE would silently disagree with which row the
   * keyboard is actually on, and the very next Arrow/Enter would act on the wrong row (or none).
   */
  const onTreeFocus = useCallback((e: ReactFocusEvent<HTMLUListElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-row-key]')?.dataset.rowKey;
    if (key) setFocusedKey((prev) => (prev === key ? prev : key));
  }, []);

  /*
   * 046 US2 (FR-018) — `focus.projects`'s target: the active row, or the create control with none.
   *
   * Gated on `projects.length`, NOT `rows.length` (review finding 3): `listRows` always returns a
   * header row for every known CATEGORY, count 0 included, so with zero projects `rows` still held
   * the default category's header and this never took the empty branch — it tried to focus a row
   * that, with no projects, is never rendered at all (the JSX below swaps in the empty message
   * instead), so the `.focus()` landed on an unmounted ref and focus went nowhere. `projects.length`
   * is the exact condition that JSX renders on, so the two can never disagree again.
   */
  const focusActiveRow = useCallback(() => {
    if (projects.length === 0) {
      newButtonRef.current?.focus();
      return;
    }
    focusRow(defaultRowKey);
  }, [projects, defaultRowKey, focusRow]);

  useEffect(() => {
    const commands = { focusActiveRow };
    registerProjectsPanelCommands(commands);
    return () => unregisterProjectsPanelCommands(commands);
  }, [focusActiveRow]);

  /** Arrow/Home/End move the roving highlight; Enter switches a PROJECT row only (FR-015). Moving
   *  alone never switches — that is simply that no other key calls `switchProject`.
   *
   *  Reads `document.activeElement` rather than the `focusedKey` STATE: the key is pressed on
   *  whichever row REALLY holds DOM focus, and that is true the instant a row is focused — by a
   *  click, by Tab, or by `focus.projects` — with no dependency on a state update having committed
   *  and this callback having been rebuilt from a fresh render first. */
  const onTreeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLUListElement>) => {
      if (rows.length === 0) return;
      /*
       * Don't hijack keystrokes typed into a nested form field (the rename box's own `<input>`, or
       * the create/edit form) — their events bubble up to this handler too, where Enter would
       * otherwise ALSO switch the project the row it lives in belongs to. React-arborist's own tree
       * container guards its keydown handler the identical way, for the identical reason (#257).
       */
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      /*
       * Review finding 2 — the SAME bubbling problem, for a row's own Edit/Remove button (and the
       * drag grip): Enter/Space on a focused button is that button's own gesture, not the row's, so
       * it must not ALSO be read as "Enter switched this row's project" here. Widened to any nested
       * `<button>` / `role="button"` for the same reason the react-arborist comment above gives — it
       * is never this handler's row-level Enter/Space that a nested control wants.
       *
       * T090 — narrowed to Enter/Space ONLY: every nested control here (the grip, Edit, Remove, the
       * switch button, the chevron) is out of Tab order (`tabIndex={-1}`), so it holds real DOM focus
       * only after a click or a `.focus()` call — and Arrow/Home/End must still move the roving row
       * from there, exactly as they do from the row itself. Swallowing them too (the previous, wider
       * guard) left the tree's own navigation dead the moment one of those controls had focus.
       */
      if (
        (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') &&
        (e.key === 'Enter' || e.key === ' ')
      ) {
        return;
      }
      const activeKey =
        (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row-key]')
          ?.dataset.rowKey ?? null;
      const currentIndex = activeKey ? rows.findIndex((r) => rowKey(r) === activeKey) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusRow(rowKey(rows[Math.min(rows.length - 1, currentIndex + 1)]));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusRow(rowKey(rows[Math.max(0, currentIndex - 1)]));
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusRow(rowKey(rows[0]));
      } else if (e.key === 'End') {
        e.preventDefault();
        focusRow(rowKey(rows[rows.length - 1]));
      } else if (e.key === 'Enter' || e.key === ' ') {
        const row = currentIndex >= 0 ? rows[currentIndex] : undefined;
        if (row?.kind === 'project') {
          // Space never switches a project — that would collide with the page-scroll a bare Space
          // means everywhere else; only Enter does (FR-015).
          if (e.key === 'Enter') {
            e.preventDefault();
            switchProject(row.project.id);
          }
        } else if (row?.kind === 'category' && row.collapsible) {
          // 046 US5 (FR-051) — the keyboard route for the chevron: Enter OR Space toggles a
          // non-default header exactly as clicking its chevron does. The default header (never
          // collapsible) does nothing on either key, as before.
          e.preventDefault();
          void setCategoryMinimised(row.category.id, !row.category.minimised);
        }
      }
    },
    [rows, focusRow, switchProject, setCategoryMinimised],
  );

  const open = (next: DraftState): void => setDraft(next);
  const close = (): void => setDraft(null);

  // Auto-name source + name field ref so an auto-filled name can be selected for
  // immediate overtyping (FR-026).
  const nameRef = useRef<HTMLInputElement>(null);
  const folderBasename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? '';

  // Surface validation errors on the relevant field (FR-028/029) by inspecting
  // the message from the rejected create/update.
  const folderError = !!error && draft !== null && /folder/i.test(error);
  const nameError = !!error && draft !== null && /name/i.test(error);

  // A random colour from the shared palette not already used by a project (FR-027).
  const pickInitialColour = (): string => {
    const used = new Set(projects.map((p) => p.colour.toLowerCase()));
    const free = SUBWORKSPACE_PALETTE.filter((c) => !used.has(c.toLowerCase()));
    const pool = free.length > 0 ? free : SUBWORKSPACE_PALETTE;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  // A folder was chosen through the OS dialog: auto-name from its basename when the
  // name is still empty, then select the name for immediate overtyping (FR-026).
  //
  // The selection is made after the render that fills the name, not on a timer: a `setTimeout(0)` raced
  // React's commit, and under React 19's scheduling it could run first, find the field still empty, and
  // leave the caret after the name — so typing appended to it instead of replacing it.
  const [selectNameAfter, setSelectNameAfter] = useState(0);
  const applyPickedFolder = (dir: string): void => {
    setDraft((d) =>
      d ? { ...d, name: d.name.trim().length === 0 ? folderBasename(dir) : d.name } : d,
    );
    setSelectNameAfter((n) => n + 1);
  };
  useLayoutEffect(() => {
    if (selectNameAfter === 0) return;
    const el = nameRef.current;
    if (el && el.value.trim().length > 0) {
      el.focus();
      el.select();
    }
  }, [selectNameAfter]);

  // The candidate start folder for the new-project picker (011, FR-040/041). The
  // profile fallback for 'profile' mode / empty values is applied in UI-main (it
  // owns the OS home dir), so an empty candidate here resolves to the profile there.
  const startFolder = resolveStartingFolder(settings.newProject, { profileDir: '' });

  // "+ New": open the create form (with a random unused colour). The FolderPicker
  // (autoOpenOnMount) then pops the OS dialog at the resolved start folder.
  const openCreate = (): void => {
    setDraft({ mode: 'create', name: '', colour: pickInitialColour(), rootFolder: '' });
  };

  /**
   * Persist the folder last chosen for a project so 'Last Viewed' opens there next time (011,
   * FR-040) — as ONE KEY, never the whole document (032, FR-001).
   *
   * THIS IS THE OTHER HALF OF #249. It used to spread `settings` — the main window's copy, as of
   * whenever the watcher last broadcast — into a complete document and write all of it. Change a
   * setting in Preferences, create a project here a moment later, and this write put every other key
   * back the way this window remembered it. The Preferences change was gone, with nothing on screen
   * to say so, and from the user's chair it simply "didn't save".
   *
   * Naming the one key removes the ability to express that. The copy can be as stale as it likes; a
   * write that mentions `newProject.lastProjectFolder` and nothing else cannot revert anything else.
   */
  const persistLastProjectFolder = (folder: string): void => {
    if (folder.trim().length === 0) return;
    void writeConfigPatch({ kind: 'settings' }, [
      { path: ['newProject', 'lastProjectFolder'], value: folder },
    ]);
  };

  const confirmDelete = async (id: string, name: string): Promise<void> => {
    // Dirty-editor guard (FR-006a): deleting a project with unsaved editors prompts
    // save/discard/cancel first. Cancel aborts; save writes them (confined).
    if (dirtyProjects.has(id)) {
      const choice = await promptDirtyClose(name, []);
      if (choice === 'cancel') return;
      if (choice === 'save') {
        // 046 branch review C1/I2 — the same two bugs Unload carried, here too: the result of a
        // Save-All was never inspected (a failed or skipped save still fell through into removing
        // the project, dropping the unsaved text), and 'all' saved every OTHER loaded project's
        // dirty editors as a side effect of removing just this one. `activeProjectId: id` scopes
        // 'project' to exactly the project being removed (`editorsInScope`, `@throng/core`).
        const result = await window.throng?.editor?.saveAll?.({ scope: 'project', activeProjectId: id });
        if (!result || result.failed.length > 0 || result.skippedUnpathed.length > 0) {
          // Coordinator follow-up (C1) — `reportFailure` defaults its action to 'unload' (its only
          // caller before this one); naming it explicitly here is what keeps this notice's heading
          // saying "Couldn't remove", not "Couldn't unload".
          reportFailure(`Nothing was removed: not every unsaved change in ${name} could be saved.`, name, 'remove');
          return;
        }
      }
    }
    // Project confirmation level → number of dialogs (FR-023/024). Default
    // "double": a summary then the wry "Yes, I'm absolutely sure" dialog.
    // TODO(FR-025a): refuse + name the sub-workspaces holding this project's
    // panels once sub-workspace windows exist.
    // "Remove" a project: it is unregistered from Throng and its panels/tabs are
    // destroyed, but NO files on disk are touched (011, FR-030/033/035). The
    // confirmation states that consequence explicitly.
    const plan = planConfirmations('project', settings.confirmations);
    if (plan.dialogs >= 1) {
      const ok = await confirm({
        title: 'Remove Project',
        message: `Remove project “${name}” from Throng? Its panels, tabs and saved layout are removed. No files on disk are deleted.`,
        confirmLabel: 'Remove Project',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: `This unregisters “${name}” from Throng. No files on disk are deleted, but its layout cannot be recovered.`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }
    void deleteProject(id);
  };

  /** 046 US4 — Unload, routed through the orchestrator (contracts/unload.md §6). `variant` is the
   *  opposite-action row's action; `undefined` (the plain Unload Project row) runs the configured
   *  default. No dialog either way (FR-111). */
  const runUnloadProject = (project: ProjectDto, variant?: 'keepRunning' | 'endTerminals'): void => {
    // Review round (US4-B #1) — NOT `ws.layout`, which only ever holds the ACTIVE project's layout
    // (the main Workspace Pane never mixes projects). Unloading a project that is loaded but not
    // active (US4's own Independent Test) must still find and dispose its editors, and
    // `allEditorStates()` keeps an entry per panel for exactly that case: an editor's state SURVIVES
    // its panel unmounting when you switch away from its project, and is removed only on an explicit
    // destroy — the same reason `useDirtyProjectKey`'s dot survives the switch above.
    const editorPanelIds = allEditorStates()
      .filter((s) => s.ownerProjectId === project.id)
      .map((s) => s.panelId);
    const collaborators: UnloadCollaborators = {
      settings: {
        projects: { unloadTerminalAction: settings.projects.unloadTerminalAction },
      },
      isDirty: (id) => dirtyProjects.has(id),
      subWorkspaces: detach?.subWorkspaces ?? [],
      editorPanelIds,
      unloadProject: unloadProjectInStore,
      // Review round (US4-B #2) — the REAL teardown (state, actions, language, view state, search,
      // caret, links, metrics, and `window.throng.editor.destroy` → EditorCoordinator.destroy, which
      // stops the file watcher and drops the recovery entry), not a bare `Map.delete`.
      disposeEditor,
      reportFailure,
    };
    void runUnload(project.id, project.name, variant, collaborators);
  };

  /** 046 US5 (FR-053) — move `project` into `categoryId`, at the end of its current members (the
   *  same rule the drag-and-drop "drop on a minimised header" case uses, FR-055). */
  const moveProjectToCategory = (project: ProjectDto, categoryId: string): void => {
    void moveProject(project.id, categoryId, orderedIdsAppendingToCategory(project.id, categoryId));
  };

  /** 046 US4/US5 (contracts/menus.md §1) — the project row's right-click menu: Edit, Rename, Remove,
   *  Move to Category and the two Unload rows. Opened by right-click here; Shift+F10/ContextMenu on
   *  a focused row reach the SAME handler through `menu.open`'s activeElement redirect (T075). */
  const openProjectMenu = (e: { preventDefault(): void; clientX: number; clientY: number }, project: ProjectDto): void => {
    e.preventDefault();
    const items = projectMenu({
      loaded: loadedIds.has(project.id),
      // FR-081 — read at open time, so a Preferences change shows on the next open with no restart.
      defaultAction: settings.projects.unloadTerminalAction,
      onEdit: () =>
        open({
          mode: 'edit',
          id: project.id,
          name: project.name,
          colour: project.colour,
          rootFolder: project.rootFolder,
        }),
      onRename: () => setRenamingId(project.id),
      onRemove: () => void confirmDelete(project.id, project.name),
      onUnload: (variant) => runUnloadProject(project, variant),
      categories: categories
        .filter((c) => c.id !== project.categoryId)
        .map((c) => ({ id: c.id, name: c.name })),
      onMoveToCategory: (categoryId) => moveProjectToCategory(project, categoryId),
      // 046 FR-053 controller ruling — "Creating and moving happen from a project's context menu"
      // is ONE control, not create-then-leave-it-put: New Category… from THIS project's submenu
      // moves the project into the category it creates. `commitCategoryName` below is what performs
      // the move, once the create RPC hands back the new category's id.
      onNewCategory: () => setCategoryDraft({ mode: 'create', forProjectId: project.id }),
    });
    contextMenu.openMenu(e.clientX, e.clientY, items);
  };

  /** 046 US5 (contracts/menus.md §2) — a category header's right-click menu: Rename Category always,
   *  Delete Category and the checkable Minimise Category only for a non-default category (FR-050).
   *  Reached the same two ways the project menu is: right-click, or Shift+F10/ContextMenu on a
   *  focused row — a header included, since it holds real DOM focus the same way a project row does
   *  (roving tabindex), so `app.tsx`'s generic `document.activeElement` path in `menu.open` already
   *  dispatches the synthetic `contextmenu` on it (T091: no dedicated redirect is needed here). */
  const openCategoryMenu = (
    e: { preventDefault(): void; clientX: number; clientY: number },
    category: ProjectCategoryDto,
  ): void => {
    e.preventDefault();
    /*
     * 046 iterate round 1 (T138, FR-083) — the live NON-default order `categories` already carries
     * (the default first, then the rest in list order — `projects.categories.list`'s own contract),
     * so moving one earlier/later is a plain adjacent swap of ids, sent back whole as
     * `reorderCategories`'s `orderedIds` (contracts/project-categories.md §5).
     */
    const nonDefault = categories.filter((c) => !c.isDefault);
    const index = nonDefault.findIndex((c) => c.id === category.id);
    const swap = (other: number): void => {
      const ids = nonDefault.map((c) => c.id);
      [ids[index], ids[other]] = [ids[other], ids[index]];
      void reorderCategories(ids);
    };
    const items = categoryMenu({
      isDefault: category.isDefault,
      minimised: category.minimised,
      canMoveUp: index > 0,
      canMoveDown: index >= 0 && index < nonDefault.length - 1,
      onRename: () => setCategoryDraft({ mode: 'rename', id: category.id }),
      onDelete: () => void deleteCategory(category.id),
      onToggleMinimised: () => void setCategoryMinimised(category.id, !category.minimised),
      onMoveUp: () => swap(index - 1),
      onMoveDown: () => swap(index + 1),
    });
    contextMenu.openMenu(e.clientX, e.clientY, items);
  };

  /**
   * 046 US5 (FR-053, task text "refusing as `commitRename` does") — commit the shared New
   * Category / Rename Category field. An empty value cancels; a refusal (empty or duplicate name)
   * leaves the field OPEN rather than closing it, exactly as `commitRename` below leaves a rejected
   * project rename open — the refusal itself surfaces through the ONE shared `project-error` notice
   * `run()` already raises (018/FR-051 "one condition, one notice"), not a second, field-level echo.
   */
  const commitCategoryName = async (value: string): Promise<void> => {
    if (!categoryDraft) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setCategoryDraft(null);
      return;
    }
    if (categoryDraft.mode === 'create') {
      const created = await createCategory(trimmed);
      if (!created) return; // refusal — leave the field open, exactly as a rejected rename does.
      // 046 FR-053 controller ruling — New Category… opened from a PROJECT's own submenu also
      // moves that project into the category just created, at the end of its (empty) membership.
      if (categoryDraft.forProjectId) {
        void moveProject(
          categoryDraft.forProjectId,
          created.id,
          orderedIdsAppendingToCategory(categoryDraft.forProjectId, created.id),
        );
      }
      setCategoryDraft(null);
    } else {
      const ok = await renameCategory(categoryDraft.id, trimmed);
      if (ok) setCategoryDraft(null);
    }
  };

  /**
   * 046 US5 (FR-055, S3; review-US2.md's note for US5) — where a drop lands, resolved from the
   * cursor's Y against every rendered row (headers AND projects, in DOM order) rather than a VISIBLE
   * `.project-item` count spliced into the full array: that used to shove a hidden, interleaved
   * category's own members out of place the moment a minimised category sat between two visible
   * ones, because the slot index counted rows the flat array's positions did not agree with.
   *
   * A header's full rect (not its midpoint) is its drop zone — "dropping ONTO a minimised category's
   * header" (FR-055) is one target, not an upper/lower half like a project row's is — so landing
   * anywhere on a header resolves to "the end of that category" directly.
   */
  type DropTarget =
    | { kind: 'beforeProject'; projectId: string }
    | { kind: 'afterProject'; projectId: string }
    | { kind: 'categoryEnd'; categoryId: string };

  const targetRef = useRef<DropTarget | null>(null);

  const dragRowEls = (dragId: string): HTMLElement[] => {
    const list = listRef.current;
    if (!list) return [];
    return (Array.from(list.querySelectorAll('.project-item, .category-header')) as HTMLElement[]).filter(
      (el) => el.getAttribute('data-testid') !== `project-item-${dragId}`,
    );
  };

  const resolveDropTarget = (clientY: number, rowEls: HTMLElement[]): DropTarget | null => {
    for (const el of rowEls) {
      const testid = el.getAttribute('data-testid') ?? '';
      const r = el.getBoundingClientRect();
      if (testid.startsWith('category-header-')) {
        // A header's own zone is its FULL rect, bounded top AND bottom (review-US5.md CRITICAL) —
        // without the lower bound, `clientY < r.bottom` was true for every Y above ANY later
        // header, including the lower half of the project row directly ABOVE it, so a header stole
        // that row's own "after me, at the end of my own category" gesture.
        if (clientY >= r.top && clientY < r.bottom) {
          return { kind: 'categoryEnd', categoryId: testid.slice('category-header-'.length) };
        }
      } else if (testid.startsWith('project-item-')) {
        if (clientY < r.top + r.height / 2) {
          return { kind: 'beforeProject', projectId: testid.slice('project-item-'.length) };
        }
        // The row's OWN lower half is "after this row, in its own category" (review-US5.md
        // CRITICAL) — resolved here, before the loop ever reaches a later header, so it can no
        // longer be stolen. Covers the pinned active row under a minimised category the same way:
        // it renders as an ordinary `.project-item`, so no separate case is needed for it.
        if (clientY < r.bottom) {
          return { kind: 'afterProject', projectId: testid.slice('project-item-'.length) };
        }
      }
    }
    const last = rowEls[rowEls.length - 1];
    if (!last) return null;
    const testid = last.getAttribute('data-testid') ?? '';
    if (testid.startsWith('category-header-')) {
      return { kind: 'categoryEnd', categoryId: testid.slice('category-header-'.length) };
    }
    if (testid.startsWith('project-item-')) {
      return { kind: 'afterProject', projectId: testid.slice('project-item-'.length) };
    }
    return null;
  };

  const trackReorder = (dragId: string) => (e: PointerEvent): void => {
    const list = listRef.current;
    if (!list) return;
    const rowEls = dragRowEls(dragId);
    const listTop = list.getBoundingClientRect().top;
    const target = resolveDropTarget(e.clientY, rowEls);
    targetRef.current = target;

    const findEl = (testid: string): HTMLElement | undefined =>
      rowEls.find((el) => el.getAttribute('data-testid') === testid);
    let boundary = listTop;
    if (target?.kind === 'beforeProject') {
      boundary = findEl(`project-item-${target.projectId}`)?.getBoundingClientRect().top ?? boundary;
    } else if (target?.kind === 'afterProject') {
      boundary = findEl(`project-item-${target.projectId}`)?.getBoundingClientRect().bottom ?? boundary;
    } else if (target?.kind === 'categoryEnd') {
      boundary = findEl(`category-header-${target.categoryId}`)?.getBoundingClientRect().bottom ?? boundary;
    } else if (rowEls.length > 0) {
      boundary = rowEls[rowEls.length - 1].getBoundingClientRect().bottom;
    }
    setIndicatorY(boundary - listTop + list.scrollTop);
  };

  /*
   * 046 iterate round 1 (FR-083, T138) — a category-header drag: resolves to a plain INSERT INDEX
   * among the non-default categories (order is all there is to decide, unlike a project's
   * before/after/categoryEnd), sent whole as `reorderCategories`'s `orderedIds`
   * (contracts/project-categories.md §5). The default header is excluded from the target list
   * entirely — it is never draggable (no `useDraggable` wired for it, see
   * `DraggableCategoryHeader`), so no drop can ever resolve to landing above it.
   */
  const categoryTargetRef = useRef<number | null>(null);

  const dragCategoryHeaderEls = (dragId: string): HTMLElement[] => {
    const list = listRef.current;
    if (!list) return [];
    return (Array.from(list.querySelectorAll('.category-header')) as HTMLElement[]).filter((el) => {
      const testid = el.getAttribute('data-testid') ?? '';
      if (testid === `category-header-${dragId}`) return false;
      const catId = testid.slice('category-header-'.length);
      const cat = categories.find((c) => c.id === catId);
      return cat !== undefined && !cat.isDefault;
    });
  };

  const trackCategoryReorder = (dragId: string) => (e: PointerEvent): void => {
    const headerEls = dragCategoryHeaderEls(dragId);
    let index = headerEls.length;
    for (let i = 0; i < headerEls.length; i++) {
      const r = headerEls[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    categoryTargetRef.current = index;
  };

  const onDragStart = (event: DragStartEvent): void => {
    const raw = String(event.active.id);
    const projectId = parseProjectDragId(raw);
    if (projectId) {
      setDraggingId(projectId);
      const handler = trackReorder(projectId);
      moveListener.current = handler;
      window.addEventListener('pointermove', handler, true);
      return;
    }
    const categoryId = parseCategoryDragId(raw);
    if (!categoryId) return;
    const handler = trackCategoryReorder(categoryId);
    moveListener.current = handler;
    window.addEventListener('pointermove', handler, true);
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const raw = String(event.active.id);
    if (moveListener.current) {
      window.removeEventListener('pointermove', moveListener.current, true);
      moveListener.current = null;
    }
    const projectId = parseProjectDragId(raw);
    if (projectId) {
      const target = targetRef.current;
      setDraggingId(null);
      setIndicatorY(null);
      targetRef.current = null;
      const dragged = projects.find((p) => p.id === projectId);
      if (!target || !dragged) return;

      let orderedIds: string[];
      let categoryId: string;
      if (target.kind === 'categoryEnd') {
        categoryId = target.categoryId;
        orderedIds = orderedIdsAppendingToCategory(projectId, categoryId);
      } else {
        // review-US5.md Important — the neighbour's ROW-RESOLVED category (`listRows`'s heal rule),
        // not its raw `categoryId`: a project naming a category that no longer exists heals to the
        // default at read time, and the raw field would send `moveProject` an id nothing recognises.
        const neighbourRow = rows.find((r) => r.kind === 'project' && r.project.id === target.projectId);
        categoryId =
          (neighbourRow?.kind === 'project' ? neighbourRow.categoryId : undefined) ?? dragged.categoryId;
        const withoutDragged = projects.map((p) => p.id).filter((pid) => pid !== projectId);
        const neighbourIdx = withoutDragged.indexOf(target.projectId);
        const insertAt =
          neighbourIdx === -1
            ? withoutDragged.length
            : target.kind === 'afterProject'
              ? neighbourIdx + 1
              : neighbourIdx;
        withoutDragged.splice(insertAt, 0, projectId);
        orderedIds = withoutDragged;
      }

      if (categoryId === dragged.categoryId) {
        void reorderProjects(orderedIds);
      } else {
        void moveProject(projectId, categoryId, orderedIds);
      }
      return;
    }

    const categoryId = parseCategoryDragId(raw);
    const index = categoryTargetRef.current;
    categoryTargetRef.current = null;
    if (!categoryId || index === null) return;
    const withoutDragged = categories.filter((c) => !c.isDefault && c.id !== categoryId).map((c) => c.id);
    withoutDragged.splice(index, 0, categoryId);
    void reorderCategories(withoutDragged);
  };

  // Double-click a project to rename it inline (alongside the edit form). Keep the
  // inline editor OPEN when the rename is rejected (e.g. a duplicate name) so the
  // user can fix it in place instead of losing their edit; an empty value cancels.
  const commitRename = async (id: string, value: string): Promise<void> => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setRenamingId(null);
      return;
    }
    const ok = await updateProject({ id, name: trimmed });
    if (ok) setRenamingId(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft) return;
    let ok = false;
    if (draft.mode === 'create') {
      // Project-overlap block (FR-038): refuse a root that would swallow a file
      // open in a sub-workspace-owned editor; instruct the user to save + close it.
      const openFiles = (await window.throng?.editor?.subWorkspaceFiles?.()) ?? [];
      const overlap = projectRootWouldContainOpenEditor(draft.rootFolder, openFiles);
      if (overlap.blocked) {
        await confirm({
          title: 'Cannot create project',
          message: `A sub-workspace editor is editing a file inside this folder (${overlap.files.join(', ')}). Save and close it first.`,
          confirmLabel: 'OK',
          cancelLabel: 'OK',
        });
        return;
      }
      ok = await createProject({ name: draft.name, colour: draft.colour, rootFolder: draft.rootFolder });
      // Remember the folder for the next new project's 'Last Viewed' start (FR-040).
      if (ok) persistLastProjectFolder(draft.rootFolder);
    } else if (draft.id) {
      ok = await updateProject({
        id: draft.id,
        name: draft.name,
        colour: draft.colour,
        rootFolder: draft.rootFolder,
      });
    }
    // Keep the form open with the error highlighted on validation failure (FR-028/029).
    if (ok) setDraft(null);
  };

  return (
    <div
      className={`panel projects-panel${isProjectsActive ? ' projects-panel--active' : ''}`}
      data-testid="projects-panel"
      // 046 US2 (FR-015, R3, A1) — the Projects PANEL is the focus target (the project list, not the
      // whole sidebar): a pointerdown or a real focus arrival here makes it the active pane, gating
      // Ctrl+S/F2/etc. exactly as clicking the File Explorer pane already does. A pointerdown in the
      // SIBLING Sub-workspaces panel does NOT reach this handler — it lives outside this element.
      onPointerDown={() => setActivePane('projects')}
      onFocus={() => setActivePane('projects')}
    >
      <header className="panel__header">
        <span className="panel__title">Projects</span>
        <span className="panel__header-actions">
          <button
            ref={newButtonRef}
            type="button"
            className="panel__action panel__action--icon panel__action--neutral"
            data-testid="project-new"
            title="New project"
            aria-label="New project"
            onClick={openCreate}
          >
            {/* 018 / FR-014b — this was a hard-coded ＋ character. The theme has shipped an `add`
                icon token since 007, and every other action control in the app already uses it; this
                one was simply missed. An icon drawn from a literal is an icon outside the theming
                system, which is the whole of the constitution's themeable-icon rule. */}
            <Icon token="add" />
          </button>
          {headerExtra}
        </span>
      </header>

      <div className="panel__body">
      {/* 018 / FR-051 — one of four copy-pasted error strips, each with its own markup, its own
          dismiss button and its own CSS block. It is the shared notification model now (see
          `useErrorNotice` above), and its identifiers are preserved. */}

      {draft ? (
        <form className="project-form" data-testid="project-form" onSubmit={submit}>
          <div className="project-form__row">
            <FolderPicker
              value={draft.rootFolder}
              onChange={(path) => setDraft((d) => (d ? { ...d, rootFolder: path } : d))}
              onPick={applyPickedFolder}
              autoOpenOnMount={draft.mode === 'create'}
              defaultPath={startFolder}
              browseTitle="Browse for project folder"
              placeholder="Folder Selection"
              inputClassName={`project-form__field project-form__field--grow${folderError ? ' project-form__field--error' : ''}`}
              inputTestId="project-root-input"
              browseTestId="project-pick-folder"
            />
          </div>
          <input
            ref={nameRef}
            className={`project-form__field${nameError ? ' project-form__field--error' : ''}`}
            data-testid="project-name-input"
            placeholder="Project name"
            value={draft.name}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
          <label className="project-form__colour-row">
            <input
              type="color"
              className="project-form__colour"
              data-testid="project-colour-input"
              value={draft.colour}
              onChange={(e) => setDraft({ ...draft, colour: e.target.value })}
            />
            <span className="project-form__colour-label">Project accent colour</span>
          </label>
          <div className="project-form__buttons">
            <button type="submit" data-testid="project-save">
              {draft.mode === 'create' ? 'Create' : 'Save'}
            </button>
            <button type="button" data-testid="project-cancel" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ul
          className="project-list"
          data-testid="project-list"
          ref={listRef}
          role="tree"
          aria-label="Projects"
          onKeyDown={onTreeKeyDown}
          onFocus={onTreeFocus}
        >
          {draggingId !== null && indicatorY !== null ? (
            <div
              className="project-insert"
              data-testid="project-insert-indicator"
              style={{ top: indicatorY }}
              aria-hidden
            />
          ) : null}
          {projects.length === 0 ? (
            <li className="project-list__empty" data-testid="projects-empty">
              No projects yet — create one to begin.
            </li>
          ) : (
            rows.map((row) => {
              if (row.kind === 'category') {
                const key = rowKey(row);
                const headerRefCallback = (el: HTMLLIElement | null): void => {
                  if (el) rowRefs.current.set(key, el);
                  else rowRefs.current.delete(key);
                };
                // 046 branch review I3 (contracts/project-categories.md §4 "Clicking a non-default
                // header toggles minimise") — the chevron was the ONLY click target; the name and
                // count beside it did nothing. A nested interactive element (the chevron button,
                // or the rename input) handles its own click and must not also toggle here.
                const headerOnClick = (e: ReactMouseEvent<HTMLLIElement>): void => {
                  if (!row.collapsible) return;
                  if ((e.target as HTMLElement).closest('input, button, [role="button"]')) return;
                  void setCategoryMinimised(row.category.id, !row.category.minimised);
                };
                const headerOnContextMenu = (e: ReactMouseEvent<HTMLLIElement>): void =>
                  openCategoryMenu(e, row.category);
                const headerChildren = (
                  <>
                    {row.collapsible ? (
                      <IconButton
                        token="chevron"
                        title={row.category.minimised ? 'Expand category' : 'Minimise category'}
                        testId={`category-toggle-${row.category.id}`}
                        className={`icon-button category-header__toggle${row.category.minimised ? '' : ' category-header__toggle--open'}`}
                        // T090 (review finding 5's fix applied here too) — out of Tab order: this
                        // control is reached by activating its row (Enter/Space), not by tabbing to
                        // it directly.
                        tabIndex={-1}
                        // Fix-round regression (FR-083, FR-051) — a non-default header is now a
                        // dnd-kit drag source of its own (T138); without this, a press on the
                        // chevron that moves ≥4px before release started a header drag instead of
                        // the collapse gesture the chevron exists for, the same guard the row's
                        // Edit/Remove/rename controls already carry against the whole-row project
                        // drag (T137).
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          // Stop this click reaching the header's own onContextMenu-adjacent
                          // handlers or any future click handler on the row — this button is the
                          // whole of the click gesture FR-051 asks for.
                          e.stopPropagation();
                          void setCategoryMinimised(row.category.id, !row.category.minimised);
                        }}
                      />
                    ) : (
                      // A fixed-width spacer keeps the default header's name aligned with every
                      // other header's, which draws a real chevron in that same slot.
                      <span className="category-header__toggle category-header__toggle--spacer" aria-hidden />
                    )}
                    {categoryDraft?.mode === 'rename' && categoryDraft.id === row.category.id ? (
                      <input
                        className="category-header__name-input"
                        data-testid="category-name-input"
                        defaultValue={row.category.name}
                        maxLength={120}
                        autoFocus
                        // FR-083 — a drag started inside the open rename field must not move the
                        // category, the same guard `DraggableProjectRow`'s own rename input carries.
                        onPointerDown={(e) => e.stopPropagation()}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => void commitCategoryName(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitCategoryName(e.currentTarget.value);
                          if (e.key === 'Escape') setCategoryDraft(null);
                        }}
                      />
                    ) : (
                      <span className="category-header__name">{row.category.name}</span>
                    )}
                    <span className="category-header__count" data-testid={`category-count-${row.category.id}`}>
                      {formatGrouped(row.count)}
                    </span>
                  </>
                );
                // FR-083 — the default category's header is never draggable: it stays a plain `<li>`,
                // so no `useDraggable` is ever wired for it and no drop can ever place a category
                // above it.
                if (row.category.isDefault) {
                  return (
                    <li
                      key={key}
                      ref={headerRefCallback}
                      className="category-header"
                      data-testid={`category-header-${row.category.id}`}
                      data-row-key={key}
                      role="treeitem"
                      aria-level={1}
                      // FR-050 — the default category cannot be minimised, so it carries no
                      // aria-expanded at all rather than one that is always true.
                      aria-expanded={row.collapsible ? !row.category.minimised : undefined}
                      tabIndex={effectiveFocusedKey === key ? 0 : -1}
                      onContextMenu={headerOnContextMenu}
                      onClick={headerOnClick}
                    >
                      {headerChildren}
                    </li>
                  );
                }
                return (
                  <DraggableCategoryHeader
                    key={key}
                    id={row.category.id}
                    refCallback={headerRefCallback}
                    className="category-header"
                    data-testid={`category-header-${row.category.id}`}
                    data-row-key={key}
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={row.collapsible ? !row.category.minimised : undefined}
                    tabIndex={effectiveFocusedKey === key ? 0 : -1}
                    onContextMenu={headerOnContextMenu}
                    onClick={headerOnClick}
                  >
                    {headerChildren}
                  </DraggableCategoryHeader>
                );
              }
              const project = row.project;
              const key = rowKey(row);
              const isActive = activeProject?.id === project.id;
              const loaded = loadedIds.has(project.id);
              // Live counts for the open project (its layout is loaded); persisted
              // counts (from projects.list) for the rest.
              const counts =
                ws.layout && ws.layout.projectId === project.id
                  ? {
                      tabs: ws.layout.tabs.length,
                      panels: ws.layout.tabs.reduce((n, t) => n + countPanels(t.root), 0),
                    }
                  : { tabs: project.tabCount ?? 0, panels: project.panelCount ?? 0 };
              return (
                <DraggableProjectRow
                  key={project.id}
                  id={project.id}
                  refCallback={(el) => {
                    if (el) rowRefs.current.set(key, el);
                    else rowRefs.current.delete(key);
                  }}
                  className={`project-item${isActive ? ' project-item--active' : ''}${loaded ? '' : ' project-item--unloaded'}${draggingId === project.id ? ' project-item--dragging' : ''}`}
                  data-testid={`project-item-${project.id}`}
                  data-active={isActive ? 'true' : 'false'}
                  data-loaded={loaded ? 'true' : 'false'}
                  // 046 US5 (FR-052) — the active project's row stays visible under its own
                  // minimised category header; this names that it is pinned there rather than
                  // ordinarily listed.
                  data-pinned-active={row.pinnedActive ? 'true' : undefined}
                  data-row-key={key}
                  role="treeitem"
                  aria-level={2}
                  // Review finding 5 — the WAI-ARIA tree pattern's selection state: named explicitly
                  // (never simply absent) on every project row, true only for the active project.
                  // Category headers carry no selection state at all — there is nothing to select.
                  aria-selected={isActive}
                  tabIndex={effectiveFocusedKey === key ? 0 : -1}
                  onContextMenu={(e) => openProjectMenu(e, project)}
                >
                  <ProjectGrip id={project.id} />
                  {renamingId === project.id ? (
                  <input
                    className="project-item__rename"
                    data-testid={`project-rename-input-${project.id}`}
                    defaultValue={project.name}
                    maxLength={120}
                    autoFocus
                    // FR-075 — a drag started inside the open rename field must not move the project.
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => void commitRename(project.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(project.id, e.currentTarget.value);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="project-item__switch"
                    data-testid={`project-switch-${project.id}`}
                    // T090 (review finding 5's fix applied here too) — out of Tab order: reached by
                    // activating the row (Enter), not by tabbing to it directly.
                    tabIndex={-1}
                    onClick={() => {
                      // FR-082 — a list-initiated switch leaves DOM focus on the chosen row, not on
                      // this button (which a native click would otherwise focus).
                      focusRow(key);
                      switchProject(project.id);
                    }}
                    onDoubleClick={() => setRenamingId(project.id)}
                    title="Double-click to rename"
                  >
                    <span
                      className="project-item__dot"
                      style={{ background: project.colour }}
                      aria-hidden
                    />
                    <span className="project-item__labels">
                      <span className="project-item__name-row">
                        <span className="project-item__name">{project.name}</span>
                        {dirtyProjects.has(project.id) ? (
                          <span
                            className="throng-unsaved-dot project-item__unsaved"
                            data-testid={`project-unsaved-${project.id}`}
                            title="Unsaved changes"
                            aria-label="Unsaved changes"
                          />
                        ) : null}
                        <span
                          className="project-item__counts"
                          data-testid={`project-counts-${project.id}`}
                          title={`${counts.tabs} tab${counts.tabs === 1 ? '' : 's'}, ${counts.panels} panel${counts.panels === 1 ? '' : 's'}`}
                        >
                          ({counts.tabs}T·{counts.panels}P)
                        </span>
                      </span>
                      <PathLabel path={project.rootFolder} />
                    </span>
                  </button>
                )}
                <span className="project-item__controls">
                  <button
                    type="button"
                    data-testid={`project-edit-${project.id}`}
                    title="Edit"
                    // Review finding 5 — out of Tab order; still reachable by click, or by focus()
                    // (e.g. right after that click), per the WAI-ARIA tree view pattern.
                    tabIndex={-1}
                    // FR-075 — a drag started on Edit must not move the project; Edit's own click
                    // still runs undisturbed.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() =>
                      open({
                        mode: 'edit',
                        id: project.id,
                        name: project.name,
                        colour: project.colour,
                        rootFolder: project.rootFolder,
                      })
                    }
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    data-testid={`project-delete-${project.id}`}
                    title="Remove project"
                    aria-label="Remove project"
                    tabIndex={-1}
                    // FR-075 — a drag started on Remove must not move the project.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void confirmDelete(project.id, project.name)}
                  >
                    ✕
                  </button>
                </span>
                </DraggableProjectRow>
              );
            })
          )}
          {categoryDraft?.mode === 'create' ? (
            <li className="category-header category-header--draft" data-testid="category-header-new">
              <span className="category-header__toggle category-header__toggle--spacer" aria-hidden />
              <input
                className="category-header__name-input"
                data-testid="category-name-input"
                defaultValue=""
                placeholder="Category name"
                maxLength={120}
                autoFocus
                onFocus={(e) => e.target.select()}
                onBlur={(e) => void commitCategoryName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitCategoryName(e.currentTarget.value);
                  if (e.key === 'Escape') setCategoryDraft(null);
                }}
              />
            </li>
          ) : null}
        </ul>
      </DndContext>
      </div>
    </div>
  );
}
