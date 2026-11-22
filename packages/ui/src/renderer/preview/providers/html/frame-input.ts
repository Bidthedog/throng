/**
 * 074 FR-083a, FR-085a (research R6a, R6e) — input inside an HTML Preview's page reaches the app as it does anywhere
 * else in the panel.
 *
 * The frame shares the renderer's origin (FR-074a), so its document's events are heard here directly and replayed on
 * the FRAME ELEMENT, where they bubble through the panel to the window's own handlers exactly as input in the panel's
 * own body does. This replaces main's input relay (`before-input-event`, `zoom-changed`, `input-event`) and its three
 * channels, which existed only because an opaque frame could not be listened to.
 *
 * | In the page                       | Replayed on the frame element                    | Who acts on it              |
 * |-----------------------------------|--------------------------------------------------|-----------------------------|
 * | a chord (Ctrl/Alt/Meta) or F-key  | that `keydown`; the page's own is prevented when the replay was | the keybinding dispatch |
 * | Ctrl+wheel (Cmd on macOS)         | that `wheel`, at the point under the pointer     | `mouse-zoom.ts` (panel zoom)|
 * | Ctrl+middle-click                 | that `mousedown` and `mouseup`                   | `mouse-zoom.ts` (zoom reset)|
 * | focus arriving in the page        | a bubbling `focusin`                             | the panel host (activates)  |
 * | a right-click                     | a `contextmenu` at the point under the pointer   | the panel's body menu       |
 * | the platform copy                 | a `copy`; the page's own is prevented when the replay was | the panel's copy routing |
 *
 * Plain typing, arrows and paging stay the page's (it scrolls and selects with them) and are never replayed.
 */

import { installNoMiddlePaste } from '../../../common/no-middle-paste.js';

/** Whether a key in the page is the app's: a key down that is a chord with Ctrl, Alt or Meta, or a function key. */
export function isAppKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return e.ctrlKey || e.altKey || e.metaKey || /^F([1-9]|1[0-9]|2[0-4])$/.test(e.key);
}

/**
 * A point in the frame document's viewport, in the renderer's client coordinates: the frame is laid out at the
 * panel's size divided by its zoom and scaled back up (`html.css`), so a page pixel is `rect.width / clientWidth`
 * renderer pixels.
 */
export function framePointToClient(frame: HTMLIFrameElement, x: number, y: number): { x: number; y: number } {
  const rect = frame.getBoundingClientRect();
  const sx = frame.clientWidth > 0 ? rect.width / frame.clientWidth : 1;
  const sy = frame.clientHeight > 0 ? rect.height / frame.clientHeight : 1;
  return { x: rect.left + x * sx, y: rect.top + y * sy };
}

function mouseInit(frame: HTMLIFrameElement, e: MouseEvent): MouseEventInit {
  const at = framePointToClient(frame, e.clientX, e.clientY);
  return {
    clientX: at.x,
    clientY: at.y,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    buttons: e.buttons,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
}

/** Replay `e` on the frame element; the page's own default is prevented when the app's handler prevented the replay. */
function replay(frame: HTMLIFrameElement, original: Event, copy: Event): void {
  frame.dispatchEvent(copy);
  if (copy.defaultPrevented) original.preventDefault();
}

/**
 * Listen inside `doc` (the frame's loaded document) and replay app input on `frame`. The answer removes every
 * listener; the document's own unload takes them anyway. (No `AbortSignal`: the document is another realm's, and
 * not every DOM accepts this realm's signal there.)
 */
export function listenToFrameInput(frame: HTMLIFrameElement, doc: Document): () => void {
  const removers: (() => void)[] = [];
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, passive?: false): void => {
    const options: AddEventListenerOptions = passive === false ? { capture: true, passive: false } : { capture: true };
    doc.addEventListener(type, fn, options);
    removers.push(() => doc.removeEventListener(type, fn, options));
  };
  on(
    'keydown',
    (e) => {
      if (!isAppKey(e)) return;
      replay(
        frame,
        e,
        new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          location: e.location,
          repeat: e.repeat,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
  );
  on(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // The page never zooms itself: the panel's zoom scales the frame and its page together (FR-083).
      e.preventDefault();
      frame.dispatchEvent(
        new WheelEvent('wheel', { ...mouseInit(frame, e), deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode }),
      );
    },
    false,
  );
  // Ctrl+middle-click (Cmd on macOS), the zoom reset: the press and its release, so Linux's primary paste is held too.
  let resetPress = false;
  on(
    'mousedown',
    (e) => {
      if (e.button !== 1 || (!e.ctrlKey && !e.metaKey)) return;
      resetPress = true;
      e.preventDefault(); // no autoscroll inside the page
      replay(frame, e, new MouseEvent('mousedown', mouseInit(frame, e)));
    },
  );
  on(
    'mouseup',
    (e) => {
      if (e.button !== 1 || !resetPress) return;
      resetPress = false;
      replay(frame, e, new MouseEvent('mouseup', mouseInit(frame, e)));
    },
  );
  // Focus arriving in the page — a click on its text focuses its window, a Tab its link — activates the panel.
  const focused = (): void => {
    frame.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
  };
  on('focusin', focused);
  const view = doc.defaultView;
  if (view !== null) {
    view.addEventListener('focus', focused);
    removers.push(() => view.removeEventListener('focus', focused));
  }
  // FR-085a — the panel's body menu, never the page's own.
  on(
    'contextmenu',
    (e) => {
      e.preventDefault();
      frame.dispatchEvent(new MouseEvent('contextmenu', mouseInit(frame, e)));
    },
  );
  // FR-085a — Copy is routed through the panel as anywhere else in a preview (the copy-format setting).
  on('copy', (e) => replay(frame, e, new Event('copy', { bubbles: true, cancelable: true, composed: true })));
  // 073 FR-008g — the page's events never reach the window's guard, so the page gets its own: a middle-click pastes into
  // no text box or contenteditable the page holds.
  removers.push(installNoMiddlePaste(doc));
  return () => {
    for (const remove of removers) remove();
  };
}
