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
import { useTransientOverlay } from '../common/transient-overlay.js';
import { TabPopover } from './tab-popover.js';
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
import { type MenuAction } from './context-menu.js';
import { tabContextMenu } from './tab-menu.js';
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
  const { draggingPanelId, draggingTabId } = useDragState();
  const settings = useAppSettings();
  const hoverActivateMs = settings.behaviour.tabHoverActivateMs;
  const popoverDelayMs = settings.tabs.popoverDelayMs;
  /**
   * FR-059 — a drag is in progress ANYWHERE in the strip.
   *
   * Deliberately the whole strip's state rather than this chip's own `drag.isDragging`: the chip
   * being dragged is not the one at risk. A reorder or a panel drag sweeps the pointer over every
   * OTHER chip on the way to its target, and it is those chips whose X must stay dead.
   */
  const dragInProgress = draggingPanelId !== null || draggingTabId !== null;
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
   *
   * ══ 031 US7 / FR-057 — THE DELAY APPLIES TO EVERY TAB, INCLUDING THE ACTIVE ONE ══
   *
   * This SUPERSEDES FR-044g (P9), which exempted the active tab on the reasoning that its affordance
   * is always present, so nothing materialises under the pointer and there is no mis-click to guard
   * against. In use that reasoning is wrong twice over. The active tab's X is the one most often
   * adjacent to where the pointer already is, so it is the most likely to be caught in passing; and
   * "the rule depends on which tab you are over" is a harder thing to hold than "the X arms once you
   * rest on it". The rule is now uniform, and `active` is no longer part of this arithmetic at all.
   *
   * ══ FR-059 — AND IT DOES NOT EVEN START COUNTING DURING A DRAG ══
   *
   * A drag passes the pointer over tabs by definition, so an arming delay alone is no protection: a
   * long reorder would arm the X of every chip it crossed, and the drop would land on a destroy.
   * The guard is on the TIMER, not just on the click — hence the bail-out here rather than only in
   * the handler — because a delay that ran to completion under a drag would leave the affordance
   * live the instant the drop finished, with the pointer still on top of it.
   */
  const [hovered, setHovered] = useState(false);
  const showClose = active || hovered;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (dragInProgress) {
      setArmed(false);
      return;
    }
    // FR-044h — zero is "no window to wait out", so there is nothing for a hover to start counting
    // and the affordance is simply live. Stated as its own branch rather than falling out of a
    // `setTimeout(…, 0)`, which would only arm a tab the pointer had already been seen to enter.
    if (closeArmingDelayMs <= 0) {
      setArmed(true);
      return;
    }
    if (!hovered) {
      setArmed(false);
      return;
    }
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), closeArmingDelayMs);
    return () => clearTimeout(timer);
  }, [hovered, dragInProgress, closeArmingDelayMs]);

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
   * P2 / FR-043, as FR-051 supersedes it — the hover is a POPOVER, not a `title`.
   *
   * The content is unchanged in substance (the tab's name, how many panels it holds, then each of
   * them) and changed entirely in form: a native tooltip cannot indent, so the panels read as peers
   * of the tab itself. The name here is the FULL one (FR-050b) — `shownTitle` is what the strip
   * shows, and the whole point of hovering an ellipsised tab is to see past the ellipsis.
   *
   * Suppressed during a drag: a surface following the pointer while a chip is in flight is noise
   * over the drop targets the user is actually aiming at.
   */
  const panels = collectPanels(tab.root);
  const panelNames = panels.map((panel) => panelDisplayTitle(panel, undefined, maxNameLength));
  /*
   * The chip the popover anchors to, held in a REF and never in state.
   *
   * `mergeRefs` builds a new callback on every render, so React detaches and re-attaches this ref on
   * every render — with `null` first. A state setter in that position is a render loop: `null`, then
   * the node, then a render because the state changed, then `null` again, for ever. It cost three
   * reveal E2Es (the strip never settled long enough to be brought into view) before it was
   * anything visible.
   *
   * A ref is enough because the popover only ever renders on a hover, and a hover is itself a
   * re-render that arrives after the chip has been committed — so `current` is the live node by the
   * time anything reads it.
   */
  const chipRef = useRef<HTMLElement | null>(null);
  const holdChip = useCallback((node: HTMLElement | null): void => {
    chipRef.current = node;
  }, []);

  /*
   * FR-058 — the popover WAITS for `tabs.popoverDelayMs` with the pointer at rest.
   *
   * It used to open the instant the pointer touched a chip, so simply crossing the strip on the way
   * to somewhere else flashed a surface over every tab in between. The delay is what distinguishes
   * "I want to know what is in this tab" from "I am passing through", and leaving before it elapses
   * shows nothing at all — the timer is torn down by the effect's own cleanup, so it cannot fire
   * behind a pointer that has already gone.
   *
   * A setting rather than a constant because it is the same class of judgement as the close
   * affordance's arming delay, and the maintainer wanted both aimable.
   *
   * FR-061 / FR-061a — a RIGHT-CLICK hides it, and it stays hidden until the pointer leaves.
   *
   * The context menu opens directly under the pointer, which is exactly where the popover already
   * is, so the popover obscured the menu it had just summoned. Hiding it is half the fix; the other
   * half is that it must not come back while the menu is open, and "the pointer has not moved" is
   * not a state React re-renders on. So the suppression is sticky and is cleared by the one event
   * that unambiguously means the user has finished with this tab: `pointerleave`. Re-entering the
   * chip starts the whole delay again from zero.
   */
  const [restedOn, setRestedOn] = useState(false);
  const [popoverSuppressed, setPopoverSuppressed] = useState(false);
  useEffect(() => {
    if (!hovered) {
      setRestedOn(false);
      return;
    }
    setRestedOn(false);
    const timer = setTimeout(() => setRestedOn(true), popoverDelayMs);
    return () => clearTimeout(timer);
  }, [hovered, popoverDelayMs]);

  const showPopover =
    hovered &&
    restedOn &&
    !popoverSuppressed &&
    !renaming &&
    !treeOver &&
    !panelOver &&
    // `dragInProgress` rather than `draggingPanelId === null && !drag.isDragging`: a tab being
    // REORDERED sweeps the pointer across every other chip, and a popover blooming under each one
    // in turn is noise laid directly over the drop targets the user is aiming at (the same reason
    // FR-059 keeps the close affordance dead).
    !dragInProgress &&
    !drag.isDragging;

  return (
    <div
      ref={mergeRefs(drag.setNodeRef, drop.setNodeRef, holdChip)}
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
      /*
       * A MOVE re-establishes the hover, and this matters now that something waits on it (FR-058).
       *
       * `pointerenter` fires once, on the way in. If the chip is then re-mounted or re-laid-out
       * under a stationary pointer — a tab renamed as its project settles, the strip re-rendering
       * around it — the browser can leave React's `hovered` reading false with no further event to
       * correct it, because the pointer never moved. The old popover appeared on the enter and had
       * nothing to lose; a delayed one would simply never arrive, and the user would be resting on a
       * tab that stayed silent for as long as they held still.
       *
       * Setting the same value costs nothing: React bails out of an identical state, so this is a
       * no-op on every move of an already-hovered chip and does NOT restart the delay.
       */
      onPointerMove={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        // FR-061a — leaving is the ONLY thing that lifts a right-click's suppression.
        setPopoverSuppressed(false);
      }}
      onClick={() => ws.setActiveTab(tab.id)}
      onDoubleClick={() => onStartRename()}
      /*
       * 017 / #57 — the hover says WHAT THIS IS, never what you can do to it; the interactions stay
       * in the right-click menu. 031 FR-051 moved it off the `title` attribute and onto a formatted
       * popover, so there is deliberately no `title` here: two tooltips for one chip is one too many.
       */
      onContextMenu={(e) => {
        e.preventDefault();
        // FR-061 — the menu opens where the popover is, so the popover goes first.
        setPopoverSuppressed(true);
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
          <span
            className="throng-count-pill tab-chip__count"
            data-testid={`tab-count-${tab.id}`}
          >
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
        /*
         * The arming state, made READABLE (FR-057/FR-059).
         *
         * `--inert` is a visual class and `opacity` is a rendering detail; whether the control will
         * act is a fact about the control. Exposing it is what lets "the active tab's X is inert
         * until you have rested on it" and "nothing arms during a drag" be asserted on the state
         * rather than on a stylesheet, or worse, on a stopwatch.
         */
        dataAttrs={{ 'data-armed': armed ? 'true' : 'false' }}
        // Never reaches the chip: it must not activate the tab (P8) and a double-click on it must
        // not open the rename box.
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          // P7 — ignored, not queued. Nothing happens later either. `dragInProgress` is redundant
          // with `armed` (the effect above never arms during a drag) and stated anyway: FR-059 is
          // about the close never ACTIVATING, and a guard that depends on a timer having been
          // cancelled correctly is a guard one refactor away from not being one.
          if (dragInProgress || !armed) return;
          onClose();
        }}
      />
      {showPopover ? (
        <TabPopover
          tabId={tab.id}
          name={tab.title}
          panelNames={panelNames}
          anchor={chipRef.current}
        />
      ) : null}
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
 * How often a held chevron takes its next step, once the hold delay has elapsed (031 FR-054).
 *
 * Deliberately shorter than the shipped smooth-scroll duration (300ms). Each repeat measures from
 * the scroll's PENDING target rather than its live position, so a step issued mid-glide advances the
 * destination by one more tab instead of re-choosing the one already in flight — which is what turns
 * a series of discrete steps into the continuous travel FR-054 asks for, using nothing but the
 * supersede rule that was already there.
 */
const CHEVRON_REPEAT_INTERVAL_MS = 120;

/**
 * FR-054 / FR-054b / FR-054c — press-and-hold on a chevron.
 *
 * `onStep` returns whether the strip actually moved; `false` (nothing left to reveal that way) ends
 * the hold, because a repeat that keeps firing against an edge is a control that looks alive and is
 * not.
 *
 * **Nothing is queued** (FR-054c). The repeat only ever writes the scroller's single replaceable
 * target, so releasing stops the *stepping* and the strip eases to the last target it was given.
 * There is no backlog to drain and no timer closing over a destination that outlives the gesture —
 * the same structural guarantee A6–A8 already give every other scroll.
 *
 * Release is caught on `window`, not on the button. A control that becomes disabled under the
 * pointer (the count reaching zero) never sees its own `pointerup`, and a pointer released outside
 * the window never would either — both would leave the strip scrolling on its own.
 */
function useHoldRepeat(
  delayMs: number,
  onStep: (direction: 'left' | 'right') => boolean,
): {
  start: (direction: 'left' | 'right') => void;
  stop: () => void;
  /** Which direction is currently repeating, for `data-repeating` on the control. */
  repeating: 'left' | 'right' | null;
  /** True when the hold has produced movement, so the release click must not add one more step. */
  consumedClick: () => boolean;
} {
  const [repeating, setRepeating] = useState<'left' | 'right' | null>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const repeated = useRef(false);
  // Read through a ref so `start`/`stop` keep a stable identity across renders — the strip
  // re-renders on every scroll event, and rebuilding these would tear down a hold in progress.
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const stop = useCallback((): void => {
    if (delay.current) {
      clearTimeout(delay.current);
      delay.current = null;
    }
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setRepeating((prev) => (prev === null ? prev : null));
  }, []);

  const start = useCallback(
    (direction: 'left' | 'right'): void => {
      stop();
      repeated.current = false;
      delay.current = setTimeout(() => {
        delay.current = null;
        setRepeating(direction);
        timer.current = setInterval(() => {
          repeated.current = true;
          if (!stepRef.current(direction)) stop();
        }, CHEVRON_REPEAT_INTERVAL_MS);
      }, delayMs);
    },
    [delayMs, stop],
  );

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const end = (): void => stop();
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', end);
    };
  }, [stop]);

  /*
   * A `click` fires on release even after a long hold, and taking it would move the strip one tab
   * further than the user asked for — the gesture would always overshoot by exactly one.
   */
  const consumedClick = useCallback((): boolean => {
    const was = repeated.current;
    repeated.current = false;
    return was;
  }, []);

  return { start, stop, repeating, consumedClick };
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

  /*
   * FR-071 — the picker takes this window's ONE transient-overlay slot while it is up, and gives it
   * up when it closes or when this strip unmounts (a layout change remounts the strip).
   *
   * The flag STAYS LOCAL. Lifting it into a store so the navigation modals could read it is exactly
   * the coupling FR-071a forbids — nothing outside this component has any business knowing whether
   * the strip is showing a list, and the next overlay added would have to be taught about this one.
   * All the registry is told is "I am open" and "here is how to close me".
   */
  useTransientOverlay(pickerOpen, () => setPickerOpen(false));

  const { maxNameLength, maxWidth, smoothScrollMs, closeArmingDelayMs, chevronRepeatDelayMs } =
    settings.tabs;
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
  // Declared before the effects that depend on them — a dependency array cannot reach a `const`
  // below it.
  const activeTabId = layout?.activeTabId ?? null;
  const tabIds = layout?.tabs.map((t) => t.id).join('\0') ?? '';

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(syncStrip);
    observer.observe(track);
    return () => observer.disconnect();
  }, [syncStrip]);

  /*
   * Re-measure when the TAB SET changes — not after every render.
   *
   * This was `useEffect(syncStrip)` with no dependency array, on the reasoning that it "bails out
   * without setting state when nothing changed, so this cannot loop". That is true and it was not
   * the problem. `syncStrip` reads `scrollLeft`/`clientWidth`/`scrollWidth`, which forces a
   * synchronous layout, and the workspace re-renders constantly in an app whose panels are live
   * terminals — so every one of those renders paid for a reflow of the whole strip.
   *
   * Measured, not theorised: the parallel E2E tier went from 3.9 minutes to 12.6, and terminal
   * specs across ten unrelated files began timing out at thirty seconds. It looked exactly like
   * machine contention, which is what makes this class of defect expensive — the symptom appears
   * everywhere except where the cause is.
   *
   * Geometry only changes when the track resizes (the ResizeObserver above), when the strip
   * scrolls (`onScroll`), or when the tabs themselves change — which is this.
   *
   * The hysteresis argument still holds and is still worth keeping: with the actions group HIDDEN
   * the track is `W` wide and the group appears when the tabs exceed `W`; with it SHOWN the track
   * is `W - A` and it stays while they exceed `W - A`. Every content width satisfies at most one of
   * those transitions, so the band between them cannot flip-flop.
   */
  useEffect(syncStrip, [syncStrip, tabIds, activeTabId]);

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

  /*
   * FR-054 — press-and-hold. Declared HERE, above the `!layout` bail-out, because it is a hook and
   * every hook has to run on every render. It steps through a ref because `step` itself is defined
   * below (it needs the live layout), and a hold that outlived a render would otherwise be calling
   * the arithmetic of the strip as it used to be.
   */
  const stepRef = useRef<(direction: 'left' | 'right') => boolean>(() => false);
  const hold = useHoldRepeat(chevronRepeatDelayMs, (direction) => stepRef.current(direction));

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
  const step = (direction: 'left' | 'right'): boolean => {
    const metrics = readMetrics(pendingTarget());
    if (!metrics) return false;
    const target = stepTarget(metrics, direction);
    scrollTo(target);
    // `null` is "there is nowhere further that way" — which is what ends a press-and-hold (FR-054).
    return target !== null;
  };
  stepRef.current = step;

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

  // 033 US5 (T062a) — the items live in `tab-menu.ts`, which declares their sections; the dividers
  // are derived from those by `ContextMenu`. This closure only supplies the state and the actions.
  const menuItems = (tabId: string): MenuAction[] =>
    tabContextMenu({
      tabId,
      destroyTabDisabled,
      destroyOthersDisabled: layout.tabs.length <= 1,
      detach: detach
        ? {
            subWorkspaces: detach.subWorkspaces,
            detachToNew: (id) => detach.detachToNew('tab', id),
            syncToExisting: (id, subId) => detach.syncToExisting('tab', id, subId),
          }
        : null,
      actions: {
        rename: (id) => setRenamingTabId(id),
        destroyTab: (id) => void confirmCloseTab(id),
        destroyOthers: (id) => void confirmCloseOthers(id),
      },
    });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <DragStateContext.Provider value={{ draggingPanelId, draggingTabId }}>
        <div
          className="tab-strip"
          data-testid="tab-strip"
          data-fade-left={fades.left ? 'true' : 'false'}
          data-fade-right={fades.right ? 'true' : 'false'}
          // FR-050 — the width cap in force, in characters, for anything that needs to state it.
          data-max-width={maxWidth}
          ref={stripRef}
          // Reaching for a tab is using the WORKSPACE, so it stops being the Files & Folders pane's
          // turn — otherwise the tree kept its selection highlight lit while the user was plainly
          // somewhere else, and two surfaces claimed to be current at once. Panels already do this
          // on pointerdown; the strip above them was the gap.
          onPointerDown={() => setActivePane('workspace')}
          /*
           * Two measurements the stylesheet cannot make for itself.
           *
           * `--tabstrip-actions-width` is MEASURED, not guessed: the right-hand fade must stop at
           * the trailing controls' leading edge, and their width changes with the number of digits
           * in the counts they show.
           *
           * `--tabstrip-max-width` is FR-050's cap. It is expressed in `ch` because the setting is
           * declared in CHARACTERS — the same unit as `tabs.maxNameLength`, so the two are directly
           * comparable — and a custom property resolves its units where it is USED, so the `ch`
           * here is a character of the tab label's own themed font rather than of this element's.
           */
          style={
            {
              '--tabstrip-actions-width': `${actionsWidth}px`,
              '--tabstrip-max-width': `${maxWidth}ch`,
            } as CSSProperties
          }
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
              {/*
               * FR-052 — the order reads `[ ‹ n ] [ n › ] [ ▾ n ]`.
               *
               * Each count sits on the side its control points at, so the group reads outward from
               * the tabs in both directions instead of as three identically-shaped lumps. Only the
               * right-hand step is `badgeFirst`; the show-all chevron leads its total because it
               * points at the list it opens, not at either edge of the strip.
               */}
              <IconButton
                token="chevronLeft"
                className="tabstrip-actions__btn"
                testId="tabstrip-step-left"
                title={`Scroll to the previous tab (${counts.hiddenLeft} hidden to the left)`}
                // S4 — nothing hidden that way means there is nothing to reveal, so the control is
                // unavailable rather than a click that does nothing.
                disabled={counts.hiddenLeft === 0}
                badge={counts.hiddenLeft}
                dataAttrs={{ 'data-repeating': hold.repeating === 'left' ? 'true' : 'false' }}
                onPointerDown={() => {
                  step('left'); // the press itself is the first step; the hold only repeats it
                  hold.start('left');
                }}
                onPointerUp={hold.stop}
                onPointerLeave={hold.stop} // FR-054b — leaving the control stops it immediately
                onPointerCancel={hold.stop}
                onClick={() => {
                  // The press already took the first step; the release must not take a second, and
                  // after a hold it must not take one at all (FR-054).
                  hold.consumedClick();
                }}
              />
              <IconButton
                token="chevronRight"
                className="tabstrip-actions__btn"
                testId="tabstrip-step-right"
                title={`Scroll to the next tab (${counts.hiddenRight} hidden to the right)`}
                disabled={counts.hiddenRight === 0}
                badge={counts.hiddenRight}
                badgeFirst
                dataAttrs={{ 'data-repeating': hold.repeating === 'right' ? 'true' : 'false' }}
                onPointerDown={() => {
                  step('right');
                  hold.start('right');
                }}
                onPointerUp={hold.stop}
                onPointerLeave={hold.stop}
                onPointerCancel={hold.stop}
                onClick={() => {
                  hold.consumedClick();
                }}
              />
              <IconButton
                token="chevronDown"
                // FR-052a — the modifier is what centres the chevron in its own box; see the
                // stylesheet, where the icon is given a square and centred inside it.
                className="tabstrip-actions__btn tabstrip-actions__btn--show-all"
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
