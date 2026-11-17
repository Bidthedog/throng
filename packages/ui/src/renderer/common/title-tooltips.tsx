/**
 * Every `title` in the app, drawn as the app's own popup (constitution v6.7.0, "One popup style").
 *
 * The OS draws a native `title` tooltip in its own face, size and colours, unlike every popover throng draws — and no
 * stylesheet can reach it. So the window takes the job over: while the pointer rests on an element with a `title`, the
 * attribute is moved aside (to `data-throng-title`) so the OS has nothing to draw, and after the native delay the text
 * is shown in the shared popup style. When the pointer leaves, the attribute goes straight back. Nothing renders a
 * `title` differently: components keep writing the attribute they always wrote, and keep their accessible description
 * everywhere except under the resting pointer.
 *
 * - A press, a key, a wheel or scroll, or the window losing focus hides it, as the OS's does. After a press the title
 *   stays aside, and the tooltip stays down, until the pointer leaves that element — a click is not a request to read
 *   its label, and the OS must not draw the title under the pointer that just pressed it.
 * - While a title is aside its element keeps an EMPTY `title`, never none: the OS takes the nearest element that has
 *   the attribute, so removing it would hand the OS an ancestor's title to draw beside this one (a project row's path
 *   inside its "Double-click to rename" button, a panel header's icons inside the header that names the panel).
 *
 * ══ A TITLE ITS OWNER CHANGES UNDER A RESTING POINTER ══
 *
 * The terminal has no element per link, so it writes the hovered link's target into its host's `title` and blanks it
 * (`''`) when the pointer leaves the link — the same element, under a pointer that never left it. Three rules follow,
 * and each was a reported defect before it was a rule:
 *
 * - **The owner blanking it hides the tooltip at once.** Only this module's own writes are ignored, and they are told
 *   apart by being swallowed as they are made (`write`), not by their value: the owner's `''` and ours are the same
 *   string, and reading them as one left a link's tooltip up after the pointer had left the link.
 * - **New text is a new request.** It arms the delay as a fresh rest would, and it ends a press: the press was on the
 *   link that was there, and the next one is a different label. (A click to focus the terminal used to silence every
 *   link in it until the pointer left the whole terminal — so links read reliably only while throng was unfocused.)
 * - **A title written onto the element under the pointer is noticed without a move.** xterm finds a link
 *   asynchronously after the move that reached it, so the pointer has usually stopped by the time the title exists.
 *
 * One host per window, mounted at the renderer entry every window kind shares (`window-popups.tsx`).
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport } from './clamp-to-viewport.js';

/** How long the pointer rests before the tooltip shows — the OS's own delay. */
export const TITLE_TOOLTIP_DELAY_MS = 500;
/** Where a hovered element's `title` waits while the app draws it. */
export const MOVED_TITLE = 'data-throng-title';
/** The tooltip sits this far below the pointer, clear of the cursor's own glyph. */
const BELOW_POINTER = 18;

interface Shown {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

let shown: Shown | null = null;
const listeners = new Set<() => void>();

function publish(next: Shown | null): void {
  shown = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Shown | null {
  return shown;
}

/**
 * The nearest element from `start` up whose title is (or is being) drawn: `current` itself, or one with a `title` —
 * the OS's own rule, under which the nearest element that HAS the attribute decides, and an empty one means "no
 * tooltip here" rather than "ask my ancestors" (the attention mark relies on it, FR-097).
 */
function titledAncestor(start: EventTarget | null, current: Element | null): Element | null {
  let node = start instanceof Element ? start : null;
  while (node !== null) {
    if (node === current) return node;
    const title = node.getAttribute('title');
    if (title !== null) return title.trim() === '' ? null : node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Take over `title` tooltips in `doc`. Returns the uninstall. `show`/`hide` default to this module's host; tests pass
 * their own.
 */
export function installTitleTooltips(
  doc: Document = document,
  delayMs: number = TITLE_TOOLTIP_DELAY_MS,
  show: (text: string, x: number, y: number) => void = (text, x, y) => publish({ text, x, y }),
  hide: () => void = () => {
    if (shown !== null) publish(null);
  },
): () => void {
  const view = doc.defaultView;
  /** The element whose title is moved aside now. */
  let current: Element | null = null;
  /** Whether `current`'s owner REMOVED its title while it was aside, rather than blanking it. */
  let removedByOwner = false;
  /** An element pressed while hovered: left alone until the pointer leaves it, or its owner retitles it. */
  let pressed: Element | null = null;
  /** The element under the pointer, for a title written there without a move. */
  let under: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer = { x: 0, y: 0 };
  let visible = false;

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const conceal = (): void => {
    stopTimer();
    if (visible) hide();
    visible = false;
  };

  const arm = (): void => {
    stopTimer();
    timer = setTimeout(() => {
      timer = undefined;
      const now = current?.getAttribute(MOVED_TITLE);
      if (current === null || !current.isConnected || !now) return;
      visible = true;
      show(now, pointer.x, pointer.y + BELOW_POINTER);
    }, delayMs);
  };

  /** The owner wrote `current`'s title while it was aside. */
  const rewritten = (el: Element): void => {
    const text = el.getAttribute('title');
    if (text === null || text === '') {
      // Taken away or blanked: nothing to show, so the tooltip goes now.
      removedByOwner = text === null;
      if (text === null) write(el, () => el.setAttribute('title', ''));
      el.setAttribute(MOVED_TITLE, '');
      conceal();
      return;
    }
    removedByOwner = false;
    const previous = el.getAttribute(MOVED_TITLE);
    write(el, () => el.setAttribute('title', ''));
    el.setAttribute(MOVED_TITLE, text);
    if (visible) {
      show(text, pointer.x, pointer.y + BELOW_POINTER);
      return;
    }
    if (text === previous) return; // the same label restated — a repaint, not a new request
    if (pressed === el) pressed = null;
    if (pressed === null) arm();
  };

  /** Re-judge the element under a pointer that has not moved — as a move to the same point would. */
  const reconsider = (): void => {
    if (under === null || !under.isConnected) return;
    if (pressed !== null && pressed.contains(under)) return;
    const target = titledAncestor(under, current);
    if (target === current) return;
    release();
    if (target !== null) take(target);
  };

  const handle = (records: readonly MutationRecord[]): void => {
    let currentChanged = false;
    let nearPointer = false;
    for (const record of records) {
      if (record.target === current) currentChanged = true;
      else if (under !== null && record.target instanceof Node && record.target.contains(under)) nearPointer = true;
    }
    if (currentChanged && current !== null) rewritten(current);
    if (nearPointer) reconsider();
  };

  // Every `title` in the document: the owner's writes are what this listens for, so this module's own are swallowed.
  const observer = new (view?.MutationObserver ?? MutationObserver)(handle);

  /**
   * Make one of this module's own writes to `el`, which the observer must not mistake for the owner's. The owner's
   * records still pending for `el` go too: the caller read `el`'s title as it stands, so they are already acted on,
   * and replayed after the write they would read this module's blank as the owner's.
   */
  function write(el: Element, change: () => void): void {
    const pending = observer.takeRecords().filter((record) => record.target !== el);
    change();
    observer.takeRecords();
    if (pending.length > 0) handle(pending);
  }

  /** Put the moved title back, and take the tooltip down. */
  function release(): void {
    conceal();
    if (current === null) return;
    const el = current;
    const text = el.getAttribute(MOVED_TITLE);
    const removed = removedByOwner;
    current = null;
    removedByOwner = false;
    write(el, () => {
      el.removeAttribute(MOVED_TITLE);
      // Our blank goes; a title the owner blanked stays blank, and one it took away stays away.
      if (text) el.setAttribute('title', text);
      else if (removed) el.removeAttribute('title');
      else el.setAttribute('title', '');
    });
  }

  function take(el: Element): void {
    const text = el.getAttribute('title') ?? '';
    current = el;
    removedByOwner = false;
    write(el, () => {
      el.setAttribute(MOVED_TITLE, text);
      // EMPTY, not removed: removing it would hand the OS the nearest ancestor's title to draw instead.
      el.setAttribute('title', '');
    });
    arm();
  }

  const onMove = (event: Event): void => {
    const e = event as PointerEvent;
    pointer = { x: e.clientX, y: e.clientY };
    under = e.target instanceof Element ? e.target : null;
    if (pressed !== null) {
      if (e.target instanceof Node && pressed.contains(e.target)) return;
      pressed = null;
    }
    const target = titledAncestor(e.target, current);
    if (target === current) return;
    release();
    if (target !== null) take(target);
  };

  const onOut = (event: Event): void => {
    const related = (event as PointerEvent).relatedTarget;
    const inside = (el: Element | null): boolean => el !== null && related instanceof Node && el.contains(related);
    if (related === null) under = null;
    if (!inside(pressed)) pressed = null;
    if (current !== null && !inside(current)) release();
  };

  // The title stays aside until the pointer leaves: put back under a resting pointer, the OS would draw it.
  const onPress = (): void => {
    if (current === null) return;
    pressed = current;
    conceal();
  };

  const root = doc.documentElement ?? doc;
  observer.observe(root, { attributes: true, attributeFilter: ['title'], subtree: true });
  doc.addEventListener('pointerover', onMove, true);
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerout', onOut, true);
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('keydown', conceal, true);
  doc.addEventListener('wheel', conceal, { capture: true, passive: true });
  doc.addEventListener('scroll', conceal, true);
  view?.addEventListener('blur', release);
  return () => {
    release();
    observer.disconnect();
    doc.removeEventListener('pointerover', onMove, true);
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerout', onOut, true);
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('keydown', conceal, true);
    doc.removeEventListener('wheel', conceal, true);
    doc.removeEventListener('scroll', conceal, true);
    view?.removeEventListener('blur', release);
  };
}

/** The tooltip. Below the pointer, flipped above it at the window's foot, kept on screen by the one positioner. */
export function TitleTooltipHost(): ReactElement | null {
  const tip = useSyncExternalStore(subscribe, snapshot, snapshot);
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ tip: Shown; left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (tip === null || el === null) return;
    const pos = clampToViewport(
      { left: tip.x, top: tip.y - 2 * BELOW_POINTER, right: tip.x, bottom: tip.y },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced({ tip, ...pos });
  }, [tip]);

  if (tip === null) return null;
  const at = placed?.tip === tip ? placed : null;
  return createPortal(
    <div
      ref={box}
      className="throng-popup title-tooltip"
      role="tooltip"
      data-testid="title-tooltip"
      style={at ? { left: `${at.left}px`, top: `${at.top}px` } : { visibility: 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
