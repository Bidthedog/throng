import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { planConfirmations } from '@throng/core';
import { useSubWorkspaces } from '../state/subworkspaces-store.js';
import { useConfirm } from '../confirm-dialog.js';
import { useAppSettings } from '../config/config-store.js';
import { DismissButton } from '../common/dismiss-button.js';

const dragId = (id: string): string => `subws|${id}`;
const parseDragId = (id: string): string | null => (id.startsWith('subws|') ? id.slice(6) : null);

/** A drag handle for reordering a sub-workspace (mirrors the project list). */
function SubWorkspaceGrip({ id }: { id: string }): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: dragId(id) });
  return (
    <span
      ref={setNodeRef}
      className="subworkspace-item__grip"
      data-testid={`subworkspace-grip-${id}`}
      title="Drag to reorder"
      {...listeners}
      {...attributes}
    >
      ⠿
    </span>
  );
}

/**
 * Sub-workspaces Panel (US7 / FR-012-015): lists the user's first-class
 * sub-workspaces below Projects, mirroring the Projects panel — drag-to-reorder,
 * a colour swatch, the name (double-click to rename), tab/panel counts, a
 * lazy-load indicator (italic/muted until opened this session, then a green
 * "loaded" dot that stays after the window closes), an **Open** button where the
 * project's edit button sits, and a delete button. Sub-workspaces can't be
 * "edited" like a project (no folder), so Open replaces edit.
 */
export function SubworkspacesPanel(): ReactElement {
  const { subWorkspaces, loadedIds, open, rename, recolour, remove, reorder, error, clearError } =
    useSubWorkspaces();
  const confirm = useConfirm();
  const settings = useAppSettings();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Drag-to-reorder state, computed from the live cursor Y vs the other rows'
  // rects — deterministic, like the project list / tab strip.
  const listRef = useRef<HTMLUListElement>(null);
  const slotRef = useRef<number | null>(null);
  const moveListener = useRef<((e: PointerEvent) => void) | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicatorY, setIndicatorY] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const commit = (id: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) void rename(id, trimmed);
    setRenamingId(null);
  };

  const destroy = async (id: string, name: string): Promise<void> => {
    // Configurable confirmation level (settings.confirmations.destroySubWorkspace,
    // default "double" → a summary then the wry "absolutely sure").
    const plan = planConfirmations('subWorkspace', settings.confirmations);
    if (plan.dialogs > 0) {
      const ok = await confirm({
        title: 'Destroy sub-workspace',
        message: `Destroy “${name}”? Its tabs and the panels it owns are destroyed and cannot be recovered; project-owned panels it mirrored are merely closed.`,
        confirmLabel: 'Destroy',
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
    await remove(id);
  };

  const trackReorder = (id: string) => (e: PointerEvent): void => {
    const list = listRef.current;
    if (!list) return;
    const rows = (Array.from(list.querySelectorAll('.subworkspace-item')) as HTMLElement[]).filter(
      (el) => el.getAttribute('data-testid') !== `subworkspace-item-${id}`,
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
    const id = parseDragId(String(event.active.id));
    if (!id) return;
    setDraggingId(id);
    const handler = trackReorder(id);
    moveListener.current = handler;
    window.addEventListener('pointermove', handler, true);
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const id = parseDragId(String(event.active.id));
    const slot = slotRef.current;
    if (moveListener.current) {
      window.removeEventListener('pointermove', moveListener.current, true);
      moveListener.current = null;
    }
    setDraggingId(null);
    setIndicatorY(null);
    slotRef.current = null;
    if (!id || slot === null) return;
    const others = subWorkspaces.map((s) => s.id).filter((sid) => sid !== id);
    others.splice(slot, 0, id);
    void reorder(others);
  };

  return (
    <div className="panel subworkspaces-panel" data-testid="subworkspaces-panel">
      <header className="panel__header">
        <span className="panel__title">Sub-workspaces</span>
      </header>
      {error !== null ? (
        <div className="subworkspaces-panel__error" data-testid="subworkspace-error" role="alert">
          <span className="subworkspaces-panel__error-text">{error}</span>
          <DismissButton
            onDismiss={clearError}
            title="Dismiss error"
            className="subworkspaces-panel__error-dismiss"
            testId="subworkspace-error-dismiss"
          />
        </div>
      ) : null}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ul className="subworkspace-list" data-testid="subworkspace-list" ref={listRef}>
          {draggingId !== null && indicatorY !== null ? (
            <div
              className="subworkspace-insert"
              data-testid="subworkspace-insert-indicator"
              style={{ top: indicatorY }}
              aria-hidden
            />
          ) : null}
          {subWorkspaces.length === 0 ? (
            <li className="subworkspace-list__empty" data-testid="subworkspaces-empty">
              No sub-workspaces — detach a tab or panel to create one.
            </li>
          ) : (
            subWorkspaces.map((sw) => {
              const loaded = loadedIds.has(sw.id);
              return (
                <li
                  key={sw.id}
                  className={`subworkspace-item${loaded ? '' : ' subworkspace-item--unloaded'}${draggingId === sw.id ? ' subworkspace-item--dragging' : ''}`}
                  data-testid={`subworkspace-item-${sw.id}`}
                  data-loaded={loaded ? 'true' : 'false'}
                >
                  <SubWorkspaceGrip id={sw.id} />
                  {/* stopPropagation so opening the OS colour dialog never reaches the
                      row (which would otherwise steal the mouse-down). */}
                  <label
                    className="subworkspace-item__swatch"
                    title="Recolour"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="color"
                      data-testid={`subworkspace-colour-${sw.id}`}
                      value={sw.colour}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void recolour(sw.id, e.target.value)}
                    />
                  </label>
                  {renamingId === sw.id ? (
                    <input
                      className="subworkspace-item__rename"
                      data-testid={`subworkspace-rename-input-${sw.id}`}
                      defaultValue={sw.name}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => commit(sw.id, e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') commit(sw.id, (e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className="subworkspace-item__name-row">
                      <span
                        className="subworkspace-item__name"
                        data-testid={`subworkspace-name-${sw.id}`}
                        title="Double-click to rename"
                        onDoubleClick={() => setRenamingId(sw.id)}
                      >
                        {sw.name}
                      </span>
                      {loaded ? (
                        <span
                          className="subworkspace-item__loaded"
                          data-testid={`subworkspace-loaded-${sw.id}`}
                          title="Loaded"
                          aria-label="Loaded"
                        />
                      ) : null}
                      <span
                        className="subworkspace-item__counts"
                        data-testid={`subworkspace-counts-${sw.id}`}
                        title={`${sw.tabCount} tab${sw.tabCount === 1 ? '' : 's'}, ${sw.panelCount} panel${sw.panelCount === 1 ? '' : 's'}`}
                      >
                        ({sw.tabCount}T·{sw.panelCount}P)
                      </span>
                    </span>
                  )}
                  <span className="subworkspace-item__controls">
                    <button
                      type="button"
                      data-testid={`subworkspace-open-${sw.id}`}
                      title="Open"
                      aria-label="Open"
                      onClick={() => open(sw.id)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="subworkspace-item__delete"
                      data-testid={`subworkspace-delete-${sw.id}`}
                      title="Destroy sub-workspace"
                      aria-label="Destroy sub-workspace"
                      onClick={() => void destroy(sw.id, sw.name)}
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
  );
}
