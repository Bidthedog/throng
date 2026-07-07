import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { projectRootWouldContainOpenEditor } from '@throng/core';
import { useDirtyProjectKey } from '../editor/editor-state.js';
import { promptDirtyClose } from '../editor/dirty-close-store.js';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { countPanels, planConfirmations, SUBWORKSPACE_PALETTE } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useConfirm } from '../confirm-dialog.js';

const MARQUEE_DELAY_MS = 200;

const projectDragId = (id: string): string => `proj|${id}`;
const parseProjectDragId = (id: string): string | null =>
  id.startsWith('proj|') ? id.slice(5) : null;

/** A drag handle for reordering a project (FR-046). */
function ProjectGrip({ id }: { id: string }): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: projectDragId(id) });
  return (
    <span
      ref={setNodeRef}
      className="project-item__grip"
      data-testid={`project-grip-${id}`}
      title="Drag to reorder"
      {...listeners}
      {...attributes}
    >
      ⠿
    </span>
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
    activeProject,
    loadedIds,
    error,
    createProject,
    updateProject,
    deleteProject,
    switchProject,
    reorderProjects,
  } = useProjects();
  const confirm = useConfirm();
  const settings = useAppSettings();
  const ws = useWorkspace();
  // Projects with any unsaved editor light the shared unsaved dot (006, US8) —
  // which replaces the old "loaded" dot.
  const dirtyKey = useDirtyProjectKey();
  const dirtyProjects = useMemo(
    () => new Set(dirtyKey ? dirtyKey.split(',') : []),
    [dirtyKey],
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Drag-to-reorder state (FR-046), computed from the live cursor Y vs the other
  // rows' rects — deterministic, like the tab strip.
  const listRef = useRef<HTMLUListElement>(null);
  const slotRef = useRef<number | null>(null);
  const moveListener = useRef<((e: PointerEvent) => void) | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicatorY, setIndicatorY] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  // Open the OS folder picker and apply the result to the draft, auto-naming +
  // selecting the name when it is empty (FR-026).
  const runFolderPicker = async (): Promise<void> => {
    const dir = await window.throng?.pickFolder?.();
    if (!dir) return;
    setDraft((d) =>
      d ? { ...d, rootFolder: dir, name: d.name.trim().length === 0 ? folderBasename(dir) : d.name } : d,
    );
    setTimeout(() => {
      const el = nameRef.current;
      if (el && el.value.trim().length > 0) {
        el.focus();
        el.select();
      }
    }, 0);
  };

  // "+ New": open the create form (with a random unused colour) and immediately
  // prompt for the folder.
  const openCreate = (): void => {
    setDraft({ mode: 'create', name: '', colour: pickInitialColour(), rootFolder: '' });
    void runFolderPicker();
  };

  const confirmDelete = async (id: string, name: string): Promise<void> => {
    // Dirty-editor guard (FR-006a): deleting a project with unsaved editors prompts
    // save/discard/cancel first. Cancel aborts; save writes them (confined).
    if (dirtyProjects.has(id)) {
      const choice = await promptDirtyClose(name, []);
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await window.throng?.editor?.saveAll?.({ scope: 'all', activeProjectId: id });
      }
    }
    // Project confirmation level → number of dialogs (FR-023/024). Default
    // "double": a summary then the wry "Yes, I'm absolutely sure" dialog.
    // TODO(FR-025a): refuse + name the sub-workspaces holding this project's
    // panels once sub-workspace windows exist.
    const plan = planConfirmations('project', settings.confirmations);
    if (plan.dialogs >= 1) {
      const ok = await confirm({
        title: 'Destroy Project',
        message: `Destroy project “${name}”? Its saved workspace layout is removed too.`,
        confirmLabel: 'Destroy Project',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: `This permanently destroys “${name}” and cannot be undone.`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }
    void deleteProject(id);
  };

  const trackReorder = (dragId: string) => (e: PointerEvent): void => {
    const list = listRef.current;
    if (!list) return;
    const rows = (Array.from(list.querySelectorAll('.project-item')) as HTMLElement[]).filter(
      (el) => el.getAttribute('data-testid') !== `project-item-${dragId}`,
    );
    const listTop = list.getBoundingClientRect().top;
    let slot = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        slot = i;
        break;
      }
    }
    slotRef.current = slot;
    let boundary: number;
    if (rows.length === 0) boundary = listTop;
    else if (slot < rows.length) boundary = rows[slot].getBoundingClientRect().top;
    else boundary = rows[rows.length - 1].getBoundingClientRect().bottom;
    setIndicatorY(boundary - listTop + list.scrollTop);
  };

  const onDragStart = (event: DragStartEvent): void => {
    const id = parseProjectDragId(String(event.active.id));
    if (!id) return;
    setDraggingId(id);
    const handler = trackReorder(id);
    moveListener.current = handler;
    window.addEventListener('pointermove', handler, true);
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const id = parseProjectDragId(String(event.active.id));
    const slot = slotRef.current;
    if (moveListener.current) {
      window.removeEventListener('pointermove', moveListener.current, true);
      moveListener.current = null;
    }
    setDraggingId(null);
    setIndicatorY(null);
    slotRef.current = null;
    if (!id || slot === null) return;
    const others = projects.map((p) => p.id).filter((pid) => pid !== id);
    others.splice(slot, 0, id);
    void reorderProjects(others);
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
    <div className="panel projects-panel" data-testid="projects-panel">
      <header className="panel__header">
        <span className="panel__title">Projects</span>
        <span className="panel__header-actions">
          <button
            type="button"
            className="panel__action panel__action--icon panel__action--neutral"
            data-testid="project-new"
            title="New project"
            aria-label="New project"
            onClick={openCreate}
          >
            ＋
          </button>
          {headerExtra}
        </span>
      </header>

      <div className="panel__body">
      {error ? (
        <p className="panel__error" data-testid="project-error">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form className="project-form" data-testid="project-form" onSubmit={submit}>
          <div className="project-form__row">
            <input
              className={`project-form__field project-form__field--grow${folderError ? ' project-form__field--error' : ''}`}
              data-testid="project-root-input"
              placeholder="Folder Selection"
              value={draft.rootFolder}
              onChange={(e) => setDraft({ ...draft, rootFolder: e.target.value })}
            />
            <button
              type="button"
              className="project-form__browse"
              data-testid="project-pick-folder"
              onClick={() => void runFolderPicker()}
            >
              Browse…
            </button>
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
        <ul className="project-list" data-testid="project-list" ref={listRef}>
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
            projects.map((project) => {
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
                <li
                  key={project.id}
                  className={`project-item${isActive ? ' project-item--active' : ''}${loaded ? '' : ' project-item--unloaded'}${draggingId === project.id ? ' project-item--dragging' : ''}`}
                  data-testid={`project-item-${project.id}`}
                  data-active={isActive ? 'true' : 'false'}
                  data-loaded={loaded ? 'true' : 'false'}
                >
                  <ProjectGrip id={project.id} />
                  {renamingId === project.id ? (
                  <input
                    className="project-item__rename"
                    data-testid={`project-rename-input-${project.id}`}
                    defaultValue={project.name}
                    maxLength={120}
                    autoFocus
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
                    onClick={() => switchProject(project.id)}
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
                    title="Delete"
                    onClick={() => void confirmDelete(project.id, project.name)}
                  >
                    ✕
                  </button>
                </span>
              </li>
              );
            })
          )}
        </ul>
      </DndContext>
      </div>
    </div>
  );
}
