import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
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
  panelDisplayTitle,
  planConfirmations,
  revealTarget,
  stepTarget,
  stripCounts,
  truncateGraphemes,
  wasTruncated,
  type Edge,
  type StripCounts,
  type StripMetrics,
  type Tab,
} from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { NameLimitField } from '../common/name-limit-field.js';
import { useTabScroll } from './tab-scroll.js';
import { TabPicker, registerTabPicker } from './tab-picker.js';
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
import { setActivePane } from './active-pane.js';
import { openFileInTab } from '../editor/editor-open.js';
import {
  getTreeDrag,
  clearTreeDrag,
  setTreeDropEffect,
  TREE_DROP_EVENT,
  type TreeDropDetail,
} from '../explorer/tree-drag-store.js';
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
  maxNameLength,
  closeArmingDelayMs,
  closeDisabled,
  onRenameCommit,
  onStartRename,
  onClose,
  onMenu,
}: {
  tab: Tab;
  active: boolean;
  renaming: boolean;
  /** `tabs.maxNameLength`, in grapheme clusters (031 US4). */
  maxNameLength: number;
  /** `tabs.closeArmingDelayMs` — how long a hover-revealed close affordance stays inert (P6). */
  closeArmingDelayMs: number;
  /** P10 — unavailable exactly where the Destroy Tab menu item is. */
  closeDisabled: boolean;
  /** The new title, or `null` when the box is leaving without a change (see `commit`). */
  onRenameCommit: (title: string | null) => void;
  onStartRename: () => void;
  onClose: () => void;
  onMenu: (state: TabMenuState) => void;
}): ReactElement {
  const ws = useWorkspace();
  const { draggingPanelId } = useDragState();
  const hoverActivateMs = useAppSettings().behaviour.tabHoverActivateMs;
  // Any unsaved editor in this Tab lights the shared dot (006, US8).
  const tabDirty = useEditorDirty(collectPanels(tab.root).map((p) => p.id));
  const drag = useDraggable({ id: tabDragId(tab.id) });
  const drop = useDroppable({ id: tabDropId(tab.id) });
  // Highlight only when a Panel (not a Tab) is being dragged over — moving a
  // Panel into this Tab. Tab reordering shows an insertion indicator instead.
  const panelOver = drop.isOver && draggingPanelId !== null;

  /*
   * 024 US4 follow-up — a file dragged from Files & Folders over a tab chip.
   *
   * A tree drag is a NATIVE HTML5 drag, not a dnd-kit one, so none of the panel-drag machinery above
   * sees it. It gets the same two affordances a panel drag has, for the same reason: dwelling on a
   * tab activates it (so the user can carry the file through to a panel in ANOTHER tab, which is
   * otherwise unreachable mid-drag), and dropping on the chip itself opens the file in that tab —
   * the drag equivalent of the tree menu's "Open In › Other Tab". Both reuse the panel drag's own
   * dwell preference rather than inventing a second one.
   */
  const treeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [treeOver, setTreeOver] = useState(false);
  const clearTreeHover = (): void => {
    if (treeHoverTimer.current) {
      clearTimeout(treeHoverTimer.current);
      treeHoverTimer.current = null;
    }
    setTreeOver(false);
  };
  useEffect(
    () => () => {
      if (treeHoverTimer.current) clearTimeout(treeHoverTimer.current);
    },
    [],
  );

  /** Open a dropped tree file in THIS tab. Only ever a single file (a folder is refused). */
  const acceptTreeDrop = (paths: string[], singleFile: boolean): void => {
    clearTreeHover();
    if (!singleFile || paths.length !== 1) return;
    ws.setActiveTab(tab.id);
    void openFileInTab(ws, tab.id, paths[0]);
  };
  // Read through a ref so the seam listener below registers once per tab rather than on every render.
  const acceptRef = useRef(acceptTreeDrop);
  acceptRef.current = acceptTreeDrop;

  // e2e seam (mirrors the panel drop targets): a real native drag cannot be driven from Playwright.
  useEffect(() => {
    const onTreeDrop = (e: Event): void => {
      const detail = (e as CustomEvent<TreeDropDetail>).detail;
      if (!detail || detail.tabId !== tab.id) return;
      acceptRef.current(detail.paths, detail.singleFile ?? false);
    };
    window.addEventListener(TREE_DROP_EVENT, onTreeDrop);
    return () => window.removeEventListener(TREE_DROP_EVENT, onTreeDrop);
  }, [tab.id]);

  /**
   * A commit is measured against WHAT THE BOX WAS SEEDED WITH, so an untouched box can be told from
   * an edit (#218).
   *
   * The panel header's rename had this guard and the tab strip's did not — the asymmetry the issue
   * asks about. A tab carries no `titleIsCustom`, so committing an unchanged title never branded
   * anything; it did write an identical layout and pay for an autosave, and it left the one rule
   * ("only a changed name is a rename") stated in only one of the two places that need it.
   *
   * The seed now travels with the value from {@link NameLimitField}, which owns the box.
   */
  const commit = (value: string, seed: string): void => {
    if (value.length === 0 || value === seed.trim()) {
      onRenameCommit(null); // nothing typed, or typed back to what it already said
      return;
    }
    onRenameCommit(value);
  };

  /*
   * 031 US5 — the close affordance and its ARMING DELAY (P4–P9, FR-044a–g).
   *
   * The affordance is present on every tab and its space is reserved on every tab (P5), so nothing
   * reflows when it appears; only its VISIBILITY changes. It shows on the active tab always, and on
   * whichever tab the pointer is over.
   *
   * A hover-revealed one is INERT for `tabs.closeArmingDelayMs` (P6). This is not decoration: a
   * control that materialises under a pointer already in motion is a control the user has not yet
   * decided to press, and a tab is a lot of work to lose to a mis-click. A click inside the window
   * is IGNORED, not queued (P7) — it does not destroy the tab a moment later, and it does not fall
   * through to activating the tab or starting a rename (P8).
   *
   * The timer is keyed on the hover, so it restarts on each appearance and can never accumulate: a
   * pointer that leaves and returns waits the full delay again, and one that stays waits it once.
   * The ACTIVE tab's affordance is always present, so it was never revealed by a hover and has no
   * delay at all (P9).
   */
  const [hovered, setHovered] = useState(false);
  const showClose = active || hovered;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (active) {
      setArmed(true); // P9 — always present, so nothing appeared under the pointer
      return;
    }
    if (!hovered) {
      setArmed(false);
      return;
    }
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), closeArmingDelayMs);
    return () => clearTimeout(timer);
  }, [active, hovered, closeArmingDelayMs]);

  /*
   * FR-037/FR-037c — the name is bounded for DISPLAY and the ellipsis is drawn by CSS.
   *
   * `wasTruncated` decides whether the marker is drawn; the marker itself is a `::after` in the
   * stylesheet, so it exists in no string, is copied by no selection, and can never reach the
   * stored title (N4). Shortening on read never rewrites what is persisted (NP1).
   */
  const shownTitle = truncateGraphemes(tab.title, maxNameLength);
  const titleTruncated = wasTruncated(tab.title, maxNameLength);

  /*
   * P2 / FR-043 — the hover title names the tab, counts its panels, and then lists them one per
   * line. A tab is a container, and "what is in it?" is the question a user hovers one to ask;
   * before this, the tooltip repeated the label they were already reading.
   */
  const panels = collectPanels(tab.root);
  const hoverTitle = [
    shownTitle,
    `${panels.length} panel${panels.length === 1 ? '' : 's'}`,
    ...panels.map((panel) => panelDisplayTitle(panel, undefined, maxNameLength)),
  ].join('\n');

  return (
    <div
      ref={mergeRefs(drag.setNodeRef, drop.setNodeRef)}
      className={`tab-chip${active ? ' tab-chip--active' : ''}${panelOver || treeOver ? ' tab-chip--over' : ''}`}
      data-testid={`tab-${tab.id}`}
      data-active={active ? 'true' : 'false'}
      onDragOver={(e) => {
        const treeDrag = getTreeDrag();
        if (!treeDrag) return; // a panel/tab drag — dnd-kit owns it
        e.preventDefault();
        const effect = treeDrag.singleFile ? 'copy' : 'none';
        e.dataTransfer.dropEffect = effect;
        setTreeDropEffect(effect);
        setTreeOver(treeDrag.singleFile);
        // Dwell on an inactive tab to bring it forward. Armed once per hover — `dragover` fires
        // continuously, and re-arming on every event would mean the timer never elapsed.
        if (!active && treeHoverTimer.current === null) {
          treeHoverTimer.current = setTimeout(() => {
            treeHoverTimer.current = null;
            ws.setActiveTab(tab.id);
          }, hoverActivateMs);
        }
      }}
      onDragLeave={clearTreeHover}
      onDrop={(e) => {
        const treeDrag = getTreeDrag();
        if (!treeDrag) return;
        e.preventDefault();
        clearTreeDrag();
        acceptTreeDrop(treeDrag.paths, treeDrag.singleFile);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={() => ws.setActiveTab(tab.id)}
      onDoubleClick={() => onStartRename()}
      /*
       * 017 / #57 — the TITLE, not instructions. The interactions stay in the right-click menu.
       * 031 FR-043 extends it to the tab's CONTENTS: name, panel count, then one panel per line.
       */
      title={hoverTitle}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
      }}
      {...(renaming ? {} : drag.listeners)}
      {...drag.attributes}
    >
      {renaming ? (
        <NameLimitField
          className="tab-chip__rename"
          testId={`tab-rename-input-${tab.id}`}
          counterClassName="tab-chip__rename-count"
          // `tabstrip-`, never `tab-`: `[data-testid^="tab-"]` is how ~20 specs select tabs.
          counterTestId={`tabstrip-rename-count-${tab.id}`}
          initialValue={tab.title}
          limit={maxNameLength}
          onCommit={commit}
          onCancel={() => onRenameCommit(null)} // cancelled — nothing to write
        />
      ) : (
        <>
          <span
            className={`tab-chip__label${titleTruncated ? ' tab-chip__label--truncated' : ''}`}
            data-testid={`tab-title-${tab.id}`}
          >
            {shownTitle}
          </span>
          {tabDirty ? (
            <span
              className="throng-unsaved-dot tab-chip__unsaved"
              data-testid={`tab-unsaved-${tab.id}`}
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          ) : null}
          {/* P1 / FR-042 — a PILL, not `[3]`. The bracketed form read as markup rather than as a
              count of the things inside the tab. */}
          <span className="tab-chip__count" data-testid={`tab-count-${tab.id}`}>
            {countPanels(tab.root)}
          </span>
        </>
      )}
      {/* P4/P5 — rendered on EVERY tab so its space is reserved; only its visibility changes. */}
      <IconButton
        token="destroy"
        title="Destroy Tab"
        className={`tab-chip__close${showClose ? ' tab-chip__close--shown' : ''}${
          showClose && !armed ? ' tab-chip__close--inert' : ''
        }`}
        testId={`tabstrip-close-${tab.id}`}
        disabled={closeDisabled}
        // Never reaches the chip: it must not activate the tab (P8) and a double-click on it must
        // not open the rename box.
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (!armed) return; // P7 — ignored, not queued. Nothing happens later either.
          onClose();
        }}
      />
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
  // Read by the reveal effect, which must NOT depend on `layout`'s identity: the store hands back a
  // fresh object on every change, so depending on it would re-run (and re-scroll) for reasons that
  // have nothing to do with which tab is active.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
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
  /*
   * 031 US1 (#225) — the strip's scroll lives on a TRACK inside it, and this is that track.
   *
   * Deliberately a ref plus component state rather than anything in `layout`: scroll position is
   * VIEW state (FR-006), and persisting it would restore a project to wherever the last session
   * happened to have dragged the strip.
   */
  const trackRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ left: false, right: false });
  /*
   * 031 US3 — the live counts the tab-actions group displays (FR-021, S1/S2).
   *
   * View state, like the scroll position: derived from what is on screen, never persisted.
   */
  const [counts, setCounts] = useState<StripCounts>({
    hiddenLeft: 0,
    hiddenRight: 0,
    total: 0,
    overflowing: false,
  });
  // The trailing controls' width, so the right-hand fade stops at their leading edge instead of
  // painting a gradient over them. Measured rather than guessed: the group's width changes with the
  // number of digits in its counts.
  const [actionsWidth, setActionsWidth] = useState(0);
  /*
   * The track's own visible width, as last measured.
   *
   * State rather than a ref because the REVEAL depends on it (FR-029, A1). The width is not a
   * constant of the strip: the tab-actions group appears only on overflow and takes its width out of
   * the track when it does, so a reveal computed the instant a layout is restored is computed
   * against a viewport ~118px wider than the one that exists a render later — and the restored
   * active tab is then left cut off by exactly that much. Re-running the reveal when the width
   * changes is what makes "brought into view" true of the viewport the user actually has.
   */
  const [viewportWidth, setViewportWidth] = useState(0);
  /**
   * The scroll position the last reveal concluded with — its target, or where the strip already was
   * when the tab was already visible. `null` until the first reveal.
   *
   * This is what tells "the strip is still where the reveal put it" (so a viewport change has
   * invalidated that reveal's arithmetic) from "the user has scrolled somewhere else since" (so it
   * has not, and dragging them back would be the bug).
   */
  const revealedTo = useRef<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { maxNameLength, smoothScrollMs, closeArmingDelayMs } = settings.tabs;
  const { scrollTo, pendingTarget } = useTabScroll(trackRef, smoothScrollMs);

  /**
   * The strip as core's geometry module wants it: every tab's edges in the track's own content
   * space, plus where the viewport currently sits over them.
   *
   * `offsetLeft` is relative to the track (which is `position: relative`), so these ARE content-space
   * coordinates and need no correction for the current scroll.
   *
   * `from` overrides "where the viewport sits" with where it is HEADING (A7, A9) — see
   * {@link TabScroller.pendingTarget}. It is clamped to the CURRENT content, which is what makes a
   * recomputation against a destroyed tab honest: a target chosen for a strip that had one more tab
   * in it is not a position this strip has, and measuring visibility from it would answer about a
   * viewport that cannot exist. Omitted (the default) it reads the live scroll, which is what the
   * counts and the fades must always use.
   */
  const readMetrics = useCallback((from?: number | null): StripMetrics | null => {
    const track = trackRef.current;
    if (!track) return null;
    const chips = Array.from(track.querySelectorAll<HTMLElement>('.tab-chip'));
    const tabOffsets = chips.map((chip) => ({
      left: chip.offsetLeft,
      right: chip.offsetLeft + chip.offsetWidth,
    }));
    const viewportWidth = track.clientWidth;
    const contentWidth = tabOffsets.reduce((widest, tab) => Math.max(widest, tab.right), 0);
    const maxScroll = Math.max(0, contentWidth - viewportWidth);
    return {
      tabOffsets,
      scrollLeft:
        from === undefined || from === null ? track.scrollLeft : Math.min(Math.max(from, 0), maxScroll),
      viewportWidth,
    };
  }, []);

  /*
   * Recompute the fades AND the counts from what is actually on screen. Runs on scroll, on resize,
   * and whenever the tab set changes — the three things FR-022 names.
   *
   * The fades are deliberately still driven by SCROLL POSITION rather than by the hidden counts: a
   * fade marks the edge a partly-visible tab is being cut off at, which is a different question from
   * "how many tabs are entirely out of view" (that one is the counts', and a partly-visible tab is
   * counted on neither side).
   */
  const syncStrip = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    const left = track.scrollLeft > 1;
    const right = track.scrollLeft + track.clientWidth < track.scrollWidth - 1;
    setFades((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));

    const metrics = readMetrics();
    if (metrics) {
      const next = stripCounts(metrics);
      setCounts((prev) =>
        prev.hiddenLeft === next.hiddenLeft &&
        prev.hiddenRight === next.hiddenRight &&
        prev.total === next.total &&
        prev.overflowing === next.overflowing
          ? prev
          : next,
      );
    }
    const width = actionsRef.current?.offsetWidth ?? 0;
    setActionsWidth((prev) => (prev === width ? prev : width));
    // Rounded, because a fractional layout width would make this state churn on renders that
    // changed nothing. It is a REVEAL dependency (see below), not decoration.
    const viewport = Math.round(track.clientWidth);
    setViewportWidth((prev) => (prev === viewport ? prev : viewport));
  }, [readMetrics]);

  /*
   * The observer is attached ONCE. `layout.tabs` is a fresh array identity on every render, so
   * depending on it would tear the ResizeObserver down and rebuild it each time — churn that buys
   * nothing, because the observer already fires when the track's box changes.
   *
   * A tab added, destroyed or renamed changes the CONTENT width rather than the track's own box, so
   * that case is covered by re-measuring on each render below instead.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(syncStrip);
    observer.observe(track);
    return () => observer.disconnect();
  }, [syncStrip]);

  // Re-measure after every render: cheap, and `syncStrip` bails out without setting state when
  // nothing changed, so this cannot loop.
  //
  // Nor can showing the actions group oscillate against its own width. With the group HIDDEN the
  // track is `W` wide and the group appears when the tabs exceed `W`; with it SHOWN the track is
  // `W - A` and it stays while they exceed `W - A`. Every content width satisfies at most one of
  // those transitions, so the band between them is hysteresis rather than a flip-flop.
  useEffect(syncStrip);

  const activeTabId = layout?.activeTabId ?? null;
  const tabIds = layout?.tabs.map((t) => t.id).join(' ') ?? '';

  /*
   * A1–A3 / FR-029–FR-029b — bring the active tab into view whenever it changes, BY ANY ROUTE.
   *
   * The trigger is the settled active tab id, not any particular gesture, which is what makes it
   * route-independent: created, clicked, chosen from the picker, reached by a chord, dwell-activated
   * during a drag, or restored with the layout all end here. `tabIds` is in the dependencies for
   * A3 — when the ACTIVE tab is destroyed its successor becomes active, and the strip must close the
   * gap that leaves rather than resting on empty space.
   *
   * `revealTarget` returns `null` for an already-fully-visible tab, so A2 costs nothing: a click on
   * a tab the user can already see causes no movement at all.
   *
   * Measured from the PENDING target, not from the live `scrollLeft`: visibility is judged from
   * where the strip is heading. Judged from where it currently is, a tab destroyed mid-flight leaves
   * this effect looking at the strip's starting position, finding the new active tab already visible
   * there, and returning `null` — and `null` means "no movement needed", not "cancel the movement in
   * flight", so the strip finishes a journey to a tab that no longer exists (A9).
   */
  const revealActiveTab = useCallback((): void => {
    const current = layoutRef.current;
    const active = current?.activeTabId ?? null;
    if (active === null) return;
    const index = current?.tabs.findIndex((t) => t.id === active) ?? -1;
    if (index < 0) return;
    const metrics = readMetrics(pendingTarget());
    if (!metrics) return;
    const target = revealTarget(metrics, index);
    // Where this reveal concluded the strip belongs — its target, or where it already was when the
    // answer was "nowhere to go". See the geometry effect below, which needs to know whether the
    // strip is still there.
    revealedTo.current = target ?? metrics.scrollLeft;
    scrollTo(target);
  }, [readMetrics, pendingTarget, scrollTo]);

  useEffect(() => {
    revealActiveTab();
  }, [activeTabId, tabIds, revealActiveTab]);

  /*
   * FR-029 again, for the case where the ACTIVE TAB did not change but the arithmetic did.
   *
   * A reveal is a sum over the track's visible width, and that width is not a constant of the strip:
   * the tab-actions group appears only on overflow and takes its width out of the track when it
   * does. On a restored layout both happen in the same beat — the tabs arrive, the reveal is
   * computed against a full-width track, and the group then appears and takes ~118px of it — so the
   * strip comes to rest against a viewport that no longer exists and the tab the user was last on is
   * left cut off by exactly the group's width.
   *
   * The GUARD is the substance here. Re-revealing on every width change would make the strip
   * un-scrollable: the counts change as it scrolls, the group's controls change with them, and any
   * width change that followed would haul the user straight back to the active tab. So the recompute
   * applies only while the strip is still where the last reveal put it (or still heading there) —
   * which is precisely the case where that reveal's conclusion was the thing invalidated. Once the
   * user has gone somewhere else, where they are is not a stale answer to be corrected.
   */
  useEffect(() => {
    const track = trackRef.current;
    const anchor = revealedTo.current;
    if (!track || anchor === null) return;
    const heading = pendingTarget() ?? track.scrollLeft;
    if (Math.abs(heading - anchor) > 1) return;
    revealActiveTab();
  }, [viewportWidth, revealActiveTab, pendingTarget]);

  // T5/T7 — the `tabs.openPicker` chord opens the SAME picker the "show all" control does.
  useEffect(() => {
    registerTabPicker(() => setPickerOpen(true));
    return () => registerTabPicker(null);
  }, []);

  if (!layout) return <></>;
  const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0];

  // Compute the reorder slot + indicator position from the live cursor X against
  // the OTHER tabs' DOM rects (the dragged tab is excluded — its rect follows the
  // drag overlay). The slot is the index into the post-removal array, which is
  // exactly what reorderTab expects. This is fully deterministic, unlike relying
  // on dnd-kit's cached collision rects while the dragged tab is still in flow.
  const trackTabDrag = (draggingId: string) => (e: PointerEvent): void => {
    pointerXRef.current = e.clientX;
    /*
     * 031 US1 — measure against the TRACK, not the strip.
     *
     * The chips and the insertion indicator both live inside the scrolling track now, so the track
     * is the indicator's positioning context AND the thing that carries `scrollLeft`. Reading either
     * from the outer strip would put the indicator at the wrong x the moment the strip is scrolled —
     * the strip's own `scrollLeft` is permanently 0 by design (FR-001).
     */
    const strip = trackRef.current;
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

  /**
   * Move by exactly one tab, landing it flush with the left edge (S3). `null` → nothing to do.
   *
   * Measured from the scroll's PENDING target, so presses ACCUMULATE (A7): two quick steps move two
   * tabs. Measured from the live `scrollLeft` they did not — 50ms into a 400ms glide the strip has
   * barely left its mark, so the second press recomputed the same anchor and chose the same
   * destination the first one had, and the strip settled one tab along having been asked twice.
   * Superseding was never the problem; the arithmetic feeding it was.
   */
  const step = (direction: 'left' | 'right'): void => {
    const metrics = readMetrics(pendingTarget());
    if (metrics) scrollTo(stepTarget(metrics, direction));
  };

  /**
   * K2 — choosing in the picker scrolls the strip to that tab **and** makes it active.
   *
   * Both, explicitly. Activating alone would be enough for every tab except the one that is already
   * active, and "go to the tab I am on" is precisely what a user does after scrolling the strip away
   * from it — the case where doing nothing would look broken.
   */
  const chooseTab = (tabId: string): void => {
    setPickerOpen(false);
    ws.setActiveTab(tabId);
    const index = layout.tabs.findIndex((t) => t.id === tabId);
    // From the pending target, for the same reason the reveal effect does: choosing a second tab
    // while the first choice is still gliding must decide against where the strip is going.
    const metrics = readMetrics(pendingTarget());
    if (metrics && index >= 0) scrollTo(revealTarget(metrics, index));
  };

  /** P10 / FR-046 — the close affordance is unavailable exactly where Destroy Tab is. */
  const destroyTabDisabled = layout.tabs.length <= 1 && subWin === null;

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
      disabled: destroyTabDisabled,
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
        <div
          className="tab-strip"
          data-testid="tab-strip"
          data-fade-left={fades.left ? 'true' : 'false'}
          data-fade-right={fades.right ? 'true' : 'false'}
          ref={stripRef}
          // Reaching for a tab is using the WORKSPACE, so it stops being the Files & Folders pane's
          // turn — otherwise the tree kept its selection highlight lit while the user was plainly
          // somewhere else, and two surfaces claimed to be current at once. Panels already do this
          // on pointerdown; the strip above them was the gap.
          onPointerDown={() => setActivePane('workspace')}
          // Measured, not guessed: the right-hand fade must stop at the trailing controls' leading
          // edge, and their width changes with the number of digits in the counts they show.
          style={{ '--tabstrip-actions-width': `${actionsWidth}px` } as CSSProperties}
        >
          <div
            className="tab-strip__track"
            data-testid="tabstrip-track"
            ref={trackRef}
            onScroll={syncStrip}
          >
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
                maxNameLength={maxNameLength}
                closeArmingDelayMs={closeArmingDelayMs}
                closeDisabled={destroyTabDisabled}
                onRenameCommit={(title) => {
                  if (title !== null) ws.renameTab(tab.id, title);
                  setRenamingTabId(null);
                }}
                onStartRename={() => setRenamingTabId(tab.id)}
                onClose={() => void confirmCloseTab(tab.id)}
                onMenu={(s) => openMenu(s.x, s.y, menuItems(s.tabId))}
              />
            ))}
          </div>
          {/*
           * T1–T4 / FR-019–FR-021, FR-032 — the tab-actions group.
           *
           * Only on overflow, inside the pane, and between the tabs and New Tab: the controls answer
           * "there are tabs you cannot see", so a strip with nothing hidden must not carry them.
           * Each is a themed icon with a hover title naming its action, and each shows the count it
           * concerns — hidden left, hidden right, total.
           */}
          {counts.overflowing ? (
            <div className="tabstrip-actions" data-testid="tabstrip-actions" ref={actionsRef}>
              <IconButton
                token="chevronLeft"
                className="tabstrip-actions__btn"
                testId="tabstrip-step-left"
                title={`Scroll to the previous tab (${counts.hiddenLeft} hidden to the left)`}
                // S4 — nothing hidden that way means there is nothing to reveal, so the control is
                // unavailable rather than a click that does nothing.
                disabled={counts.hiddenLeft === 0}
                badge={counts.hiddenLeft}
                onClick={() => step('left')}
              />
              <IconButton
                token="chevronRight"
                className="tabstrip-actions__btn"
                testId="tabstrip-step-right"
                title={`Scroll to the next tab (${counts.hiddenRight} hidden to the right)`}
                disabled={counts.hiddenRight === 0}
                badge={counts.hiddenRight}
                onClick={() => step('right')}
              />
              <IconButton
                token="chevronDown"
                className="tabstrip-actions__btn"
                testId="tabstrip-show-all"
                title={`Show all tabs (${counts.total})`}
                badge={counts.total}
                onClick={() => setPickerOpen(true)}
              />
            </div>
          ) : null}
          <NewTabButton onNewTab={() => setRenamingTabId(ws.addTab())} />
        </div>
        {/* T5 — opens at ANY tab count, including when nothing overflows, because the chord can ask
            for it. Rendered outside the strip: it is a full-viewport overlay, not strip chrome. */}
        {pickerOpen ? (
          <TabPicker
            tabs={layout.tabs}
            activeTabId={layout.activeTabId ?? null}
            maxNameLength={maxNameLength}
            onChoose={chooseTab}
            onDismiss={() => setPickerOpen(false)}
          />
        ) : null}
        <div className="tab-body" data-testid="tab-body">
          {activeTab ? <SplitTree node={activeTab.root} tabId={activeTab.id} path={[]} /> : null}
        </div>
      </DragStateContext.Provider>
    </DndContext>
  );
}
