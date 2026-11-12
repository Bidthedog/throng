/**
 * tree-pointer-backend (067 FR-110 to FR-114; research D21, D22, D23) — the react-dnd backend the
 * File Explorer tree runs on, driven by MOUSE events rather than web drags.
 *
 * Why not the HTML5 backend: a web drag is owned by the OS once it starts. Chromium starts none from a
 * press with Shift held, native Wayland reports no modifier after the first event, and the pointer is
 * the desktop's to draw, so none of copy / move / not-allowed could be promised on every desktop. Here
 * the page owns the whole gesture, so the live keys, the pointer and Esc are all ours.
 *
 * react-arborist keeps its sources, drop computation, cursor line and drag preview: this backend only
 * feeds react-dnd's manager (`beginDrag`, `hover`, `drop`, `endDrag`) from the mouse.
 *
 * Targets outside the tree (an editor, a preview, a terminal, an empty panel, a tab, the new-tab
 * area) already answer `dragenter` / `dragover` / `dragleave` / `drop` and read the shared tree-drag
 * record, so while the pointer is outside the tree those events are replayed at the element under it
 * (D22). The effect such a target chose comes back through `takeTreeDropEffect`.
 */
import type { ComponentProps } from 'react';
import type { Tree } from 'react-arborist';
import type { DragEffect, DragModifiers } from '@throng/core';
import { takeTreeDropEffect } from './tree-drag-store.js';

type BackendFactory = NonNullable<ComponentProps<typeof Tree>['dndBackend']>;
type Manager = Parameters<BackendFactory>[0];
type Backend = ReturnType<BackendFactory>;
type HandlerId = string | symbol;
type Effect = 'copy' | 'move' | 'none';

/** Past this many pixels from the press a press becomes a drag; below it, it stays a click. */
export const DRAG_THRESHOLD_PX = 4;
/** How near the tree's top or bottom edge the tree starts to scroll. */
export const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_INTERVAL_MS = 16;
const EDGE_SCROLL_MIN_STEP_PX = 4;
const EDGE_SCROLL_MAX_STEP_PX = 20;

/** What the backend needs from the tree that mounted it. */
export interface TreePointerController {
  /** Copy or move for the keys held now (the configured modifiers). */
  effectFor(mods: DragModifiers): DragEffect;
  /**
   * A drag is about to start from this row. Records what it carries for the drop targets outside the
   * tree and returns the root-relative paths, or `null` when the row carries nothing (the root).
   */
  begin(source: HTMLElement): readonly string[] | null;
  /** The decision a drop inside the tree will act on. */
  setCopy(copy: boolean): void;
  /** The drag is over, however it ended. */
  end(): void;
  /** The pointer left the window with the button held: hand these paths to the OS. */
  handOver(relPaths: readonly string[]): void;
  /** The tree's scrolling element, for edge scroll. */
  scrollElement(): HTMLElement | null;
  /** Clear the drop highlight and cursor line the tree is showing. */
  clearHover(): void;
}

let controller: TreePointerController | null = null;

/** The tree mounts itself as the owner of the next drags. Returns the unbind. */
export function bindTreePointerController(next: TreePointerController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

/** What a replayed web drag event carries: enough for the handlers, never `Files`. */
function stubDataTransfer(): Record<string, unknown> {
  return {
    dropEffect: 'none',
    effectAllowed: 'copyMove',
    types: ['application/x-throng-tree-row'],
    files: [],
    items: [],
    getData: () => '',
    setData: () => undefined,
    clearData: () => undefined,
    setDragImage: () => undefined,
  };
}

function replay(type: string, target: Element, at: { x: number; y: number }, mods: DragModifiers, related: Element | null): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: at.x,
    clientY: at.y,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    relatedTarget: related,
  });
  Object.defineProperty(event, 'dataTransfer', { value: stubDataTransfer() });
  target.dispatchEvent(event);
}

function contains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

class TreePointerBackend implements Backend {
  private readonly sources = new Map<HandlerId, HTMLElement>();
  private readonly targets = new Map<HandlerId, HTMLElement>();
  private press: { sourceId: HandlerId; x: number; y: number } | null = null;
  private session: { sourceId: HandlerId; relPaths: readonly string[]; outside: Element | null; lastEffect: Effect } | null = null;
  private last = { x: 0, y: 0, mods: {} as DragModifiers };
  private suppressClick = false;
  private scrollTimer: ReturnType<typeof setInterval> | null = null;
  private scrollStep = 0;
  private active = false;

  constructor(private readonly manager: Manager) {}

  setup(): void {
    if (this.active || typeof window === 'undefined') return;
    this.active = true;
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('selectstart', this.onSelectStart, true);
    window.addEventListener('dragstart', this.onNativeDragStart, true);
    window.addEventListener('contextmenu', this.onContextMenu, true);
    document.addEventListener('mouseout', this.onMouseOut);
  }

  teardown(): void {
    if (!this.active) return;
    this.active = false;
    this.cancel();
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mouseup', this.onMouseUp, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKey, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('selectstart', this.onSelectStart, true);
    window.removeEventListener('dragstart', this.onNativeDragStart, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
    document.removeEventListener('mouseout', this.onMouseOut);
  }

  connectDragSource(sourceId: HandlerId, node?: unknown): () => void {
    if (!(node instanceof HTMLElement)) return () => {};
    this.sources.set(sourceId, node);
    const onDown = (e: MouseEvent): void => this.onMouseDown(sourceId, e);
    // Never `preventDefault` here: the press must still focus, select and click as it always did.
    node.addEventListener('mousedown', onDown);
    return () => {
      node.removeEventListener('mousedown', onDown);
      if (this.sources.get(sourceId) === node) this.sources.delete(sourceId);
    };
  }

  connectDragPreview(): () => void {
    return () => {};
  }

  connectDropTarget(targetId: HandlerId, node?: unknown): () => void {
    if (!(node instanceof HTMLElement)) return () => {};
    this.targets.set(targetId, node);
    return () => {
      if (this.targets.get(targetId) === node) this.targets.delete(targetId);
    };
  }

  profile(): Record<string, number> {
    return {};
  }

  // ---- press -> drag ----

  private onMouseDown(sourceId: HandlerId, e: MouseEvent): void {
    this.suppressClick = false;
    if (e.button !== 0 || this.session || this.press) return;
    // A control inside the row (the twisty, the rename box) keeps its own press.
    if ((e.target as Element | null)?.closest?.('button, input, textarea')) return;
    this.press = { sourceId, x: e.clientX, y: e.clientY };
    this.last = { x: e.clientX, y: e.clientY, mods: modsOf(e) };
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.last = { x: e.clientX, y: e.clientY, mods: modsOf(e) };
    if (this.press && !this.session) {
      if ((e.buttons & 1) === 0) {
        this.press = null; // the release happened where nothing heard it
        return;
      }
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < DRAG_THRESHOLD_PX) return;
      if (!this.begin()) return;
    }
    if (this.session) {
      e.preventDefault();
      this.update();
    }
  };

  private begin(): boolean {
    const press = this.press;
    this.press = null;
    const node = press ? this.sources.get(press.sourceId) : undefined;
    if (!press || !node || !controller) return false;
    const monitor = this.manager.getMonitor();
    if (!monitor.canDragSource(press.sourceId)) return false; // e.g. the row is being renamed
    const relPaths = controller.begin(node);
    if (relPaths === null) return false;
    const actions = this.manager.getActions();
    actions.beginDrag([press.sourceId], {
      publishSource: false,
      clientOffset: { x: press.x, y: press.y },
      getSourceClientOffset: () => {
        const r = node.getBoundingClientRect();
        return { x: r.left, y: r.top };
      },
    });
    if (!monitor.isDragging()) {
      controller.end();
      return false;
    }
    actions.publishDragSource();
    this.session = { sourceId: press.sourceId, relPaths, outside: null, lastEffect: 'move' };
    window.getSelection?.()?.removeAllRanges();
    return true;
  }

  // ---- hit testing ----

  /** Registered targets under the point, outermost first. By geometry: react-window turns rows' pointer events off while it scrolls. */
  private targetsAt(x: number, y: number): HandlerId[] {
    const hit: { id: HandlerId; el: HTMLElement; area: number }[] = [];
    const list = controller?.scrollElement() ?? null;
    const inList = list === null || contains(list.getBoundingClientRect(), x, y);
    for (const [id, el] of this.targets) {
      // A row react-window renders past the list's ends sits over whatever is beyond the list.
      if (!inList && list !== el && list?.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (contains(r, x, y)) hit.push({ id, el, area: r.width * r.height });
    }
    hit.sort((a, b) => (a.el.contains(b.el) ? -1 : b.el.contains(a.el) ? 1 : b.area - a.area));
    // Siblings that overlap by a pixel are not a chain: keep what the innermost one sits in.
    const inner = hit[hit.length - 1];
    return inner ? hit.filter((h) => h.el.contains(inner.el)).map((h) => h.id) : [];
  }

  private update(): void {
    const session = this.session;
    if (!session || !controller) return;
    const { x, y, mods } = this.last;
    if (outsideWindow(x, y)) {
      this.handOver();
      return;
    }
    const ids = this.targetsAt(x, y);
    const actions = this.manager.getActions();
    actions.hover(ids, { clientOffset: { x, y } });
    let effect: Effect;
    if (ids.length > 0) {
      this.leaveOutside(mods);
      const inner = ids[ids.length - 1];
      effect = this.manager.getMonitor().canDropOnTarget(inner) ? controller.effectFor(mods) : 'none';
    } else {
      controller.clearHover();
      effect = this.replayOutside(mods);
    }
    session.lastEffect = effect;
    document.documentElement.dataset.treeDrag = effect;
    this.edgeScroll();
  }

  /** D22: the web events a drop target outside the tree expects, at the element under the pointer. */
  private replayOutside(mods: DragModifiers): Effect {
    const session = this.session!;
    const at = { x: this.last.x, y: this.last.y };
    const el = document.elementFromPoint?.(at.x, at.y) ?? null;
    if (el !== session.outside) {
      if (session.outside) replay('dragleave', session.outside, at, mods, el);
      if (el) replay('dragenter', el, at, mods, session.outside);
      session.outside = el;
    }
    if (!el) return 'none';
    takeTreeDropEffect(); // a claim left by an earlier event is not this one's
    replay('dragover', el, at, mods, null);
    return takeTreeDropEffect() === 'copy' ? 'copy' : 'none';
  }

  private leaveOutside(mods: DragModifiers): void {
    const session = this.session;
    if (!session?.outside) return;
    replay('dragleave', session.outside, { x: this.last.x, y: this.last.y }, mods, null);
    session.outside = null;
  }

  // ---- edge scroll (FR-113) ----

  private edgeScroll(): void {
    const el = controller?.scrollElement();
    const { x, y } = this.last;
    let step = 0;
    if (el) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right) {
        const zone = EDGE_SCROLL_ZONE_PX;
        const intoTop = zone - (y - r.top); // positive within `zone` of the top edge, and beyond it above
        const intoBottom = zone - (r.bottom - y);
        const reach = (into: number): number =>
          Math.min(
            EDGE_SCROLL_MAX_STEP_PX,
            EDGE_SCROLL_MIN_STEP_PX + ((EDGE_SCROLL_MAX_STEP_PX - EDGE_SCROLL_MIN_STEP_PX) * Math.min(into, zone)) / zone,
          );
        if (intoTop > 0 && intoTop <= 2 * zone) step = -reach(intoTop);
        else if (intoBottom > 0 && intoBottom <= 2 * zone) step = reach(intoBottom);
      }
    }
    this.scrollStep = step;
    if (step === 0) {
      this.stopScroll();
      return;
    }
    this.scrollTimer ??= setInterval(() => {
      const target = controller?.scrollElement();
      if (!this.session || !target || this.scrollStep === 0) return this.stopScroll();
      target.scrollTop += this.scrollStep;
      this.update(); // the rows moved under a still pointer
    }, EDGE_SCROLL_INTERVAL_MS);
  }

  private stopScroll(): void {
    if (this.scrollTimer !== null) clearInterval(this.scrollTimer);
    this.scrollTimer = null;
    this.scrollStep = 0;
  }

  // ---- the ways a drag ends ----

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.press = null;
    if (!this.session) {
      if (this.suppressClick) setTimeout(() => (this.suppressClick = false), 0);
      return;
    }
    this.last = { x: e.clientX, y: e.clientY, mods: modsOf(e) };
    // Released outside with no move heard first: there is nothing left to hand over, and nowhere to drop.
    const inside = !outsideWindow(e.clientX, e.clientY);
    if (inside) this.update();
    this.finish(inside);
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
  };

  private finish(drop: boolean): void {
    const session = this.session;
    if (!session || !controller) return;
    const { mods } = this.last;
    const at = { x: this.last.x, y: this.last.y };
    const actions = this.manager.getActions();
    if (drop && session.lastEffect !== 'none') {
      if (session.outside) {
        const target = session.outside;
        session.outside = null;
        replay('drop', target, at, mods, null);
      } else {
        controller.setCopy(session.lastEffect === 'copy');
        actions.drop();
      }
    }
    this.leaveOutside(mods);
    this.teardownSession();
    if (this.manager.getMonitor().isDragging()) actions.endDrag();
    controller.end();
  }

  private teardownSession(): void {
    this.session = null;
    this.stopScroll();
    delete document.documentElement.dataset.treeDrag;
    controller?.clearHover();
  }

  /** Esc, a lost window, a context menu, or the backend going away: nothing changes. */
  private cancel(): void {
    this.press = null;
    if (!this.session) return;
    this.finish(false);
    this.suppressClick = true; // the button is still down; its release must not click
  }

  private handOver(): void {
    const session = this.session;
    if (!session || !controller) return;
    const relPaths = session.relPaths;
    this.finish(false);
    this.suppressClick = false;
    controller.handOver(relPaths);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.session) return;
    if (e.type === 'keydown' && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    // A modifier pressed or released takes effect at once, wherever the pointer rests.
    this.last = { ...this.last, mods: modsOf(e) };
    this.update();
  };

  private readonly onBlur = (): void => this.cancel();
  private readonly onContextMenu = (e: MouseEvent): void => {
    if (!this.session) return;
    e.preventDefault();
    this.cancel();
  };
  private readonly onMouseOut = (e: MouseEvent): void => {
    if (this.session && e.relatedTarget === null && (e.buttons & 1) === 1 && atWindowEdge(e.clientX, e.clientY)) this.handOver();
  };
  private readonly onClick = (e: MouseEvent): void => {
    if (!this.suppressClick) return;
    e.stopPropagation();
    e.preventDefault();
  };
  private readonly onSelectStart = (e: Event): void => {
    if (this.session || this.press) e.preventDefault();
  };
  private readonly onNativeDragStart = (e: Event): void => {
    if (this.session || this.press) e.preventDefault();
  };
}

function outsideWindow(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
}

/** A leave reported with no related element also happens inside the window, over a frame. */
function atWindowEdge(x: number, y: number): boolean {
  return x <= 1 || y <= 1 || x >= window.innerWidth - 2 || y >= window.innerHeight - 2;
}

function modsOf(e: MouseEvent | KeyboardEvent): DragModifiers {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
}

/** Handed to react-arborist's `dndBackend`. */
export const treePointerBackend: BackendFactory = (manager) => new TreePointerBackend(manager);
