/**
 * 074 FR-083a, FR-085a (research R6a, R6e) — input inside an HTML Preview's same-origin page reaches the app: heard on
 * the frame's document and replayed on the frame element, where the panel and the window's handlers listen. These are
 * the assertions main's input relay (`frame-input-relay`, deleted) carried, moved to the frame-document listeners.
 *
 * Layer: component — a real jsdom frame with its own document. What Electron delivers to a real page is
 * `preview-media.e2e.ts`'s.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isAppKey, listenToFrameInput } from '../../src/renderer/preview/providers/html/frame-input.js';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

async function mount(): Promise<{ frame: HTMLIFrameElement; doc: Document; seen: Event[] }> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<p id="text">Some page text</p>';
  const seen: Event[] = [];
  for (const type of ['keydown', 'wheel', 'mousedown', 'mouseup', 'focusin', 'contextmenu', 'copy']) {
    window.addEventListener(type, (e) => seen.push(e));
  }
  stop = listenToFrameInput(frame, doc);
  return { frame, doc, seen };
}

const inPage = (doc: Document): Element => doc.getElementById('text')!;
const pageWindow = (doc: Document): Window & typeof globalThis => doc.defaultView as Window & typeof globalThis;

describe('a key in the page (FR-083a)', () => {
  it('replays a chord or a function key as a keydown from the frame, bubbling to the window', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    inPage(doc).dispatchEvent(new W.KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, altKey: true, bubbles: true }));
    inPage(doc).dispatchEvent(new W.KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true }));
    const keys = seen.filter((e): e is KeyboardEvent => e.type === 'keydown');
    expect(keys.map((k) => [k.key, k.code, k.ctrlKey, k.altKey, k.target])).toEqual([
      ['=', 'Equal', true, true, frame],
      ['F2', 'F2', false, false, frame],
    ]);
  });

  it('leaves the page its own typing, arrows, paging and Shift chords', async () => {
    const { doc, seen } = await mount();
    const W = pageWindow(doc);
    for (const key of ['a', 'ArrowDown', 'PageDown', ' ', 'Escape', 'F25']) {
      inPage(doc).dispatchEvent(new W.KeyboardEvent('keydown', { key, bubbles: true }));
    }
    inPage(doc).dispatchEvent(new W.KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }));
    expect(seen.filter((e) => e.type === 'keydown')).toHaveLength(0);
    expect(isAppKey({ key: 'p', ctrlKey: false, altKey: false, metaKey: true })).toBe(true);
  });

  it('prevents the page’s own key when the app handled the replay', async () => {
    const { frame, doc } = await mount();
    frame.addEventListener('keydown', (e) => e.preventDefault());
    const W = pageWindow(doc);
    const key = new W.KeyboardEvent('keydown', { key: 'g', altKey: true, bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
  });
});

describe('the zoom gestures in the page (FR-083a)', () => {
  it('replays a Ctrl+wheel on the frame — in is up, out is down — and the page never zooms itself', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    const up = new W.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(up);
    inPage(doc).dispatchEvent(new W.WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(up.defaultPrevented).toBe(true);
    const wheels = seen.filter((e): e is WheelEvent => e.type === 'wheel');
    expect(wheels.map((w) => [w.ctrlKey, Math.sign(w.deltaY), w.target])).toEqual([
      [true, -1, frame],
      [true, 1, frame],
    ]);
  });

  it('leaves a plain wheel to scroll the page', async () => {
    const { doc, seen } = await mount();
    const W = pageWindow(doc);
    const plain = new W.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(seen.filter((e) => e.type === 'wheel')).toHaveLength(0);
  });

  it('replays a Ctrl+middle-click as that press and release on the frame, and no other middle-click', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    inPage(doc).dispatchEvent(new W.MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
    inPage(doc).dispatchEvent(new W.MouseEvent('mouseup', { button: 1, bubbles: true, cancelable: true }));
    inPage(doc).dispatchEvent(new W.MouseEvent('mousedown', { button: 1, ctrlKey: true, bubbles: true, cancelable: true }));
    inPage(doc).dispatchEvent(new W.MouseEvent('mouseup', { button: 1, ctrlKey: true, bubbles: true, cancelable: true }));
    const presses = seen.filter((e): e is MouseEvent => e.type === 'mousedown' || e.type === 'mouseup');
    expect(presses.map((p) => [p.type, p.button, p.ctrlKey, p.target])).toEqual([
      ['mousedown', 1, true, frame],
      ['mouseup', 1, true, frame],
    ]);
  });
});

describe('focus and the menu (FR-083a, FR-085a)', () => {
  it('tells the panel when focus arrives in the page: a bubbling focusin from the frame', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    inPage(doc).dispatchEvent(new W.FocusEvent('focusin', { bubbles: true }));
    pageWindow(doc).dispatchEvent(new W.FocusEvent('focus'));
    const focus = seen.filter((e) => e.type === 'focusin');
    expect(focus.map((f) => [f.target, f.bubbles])).toEqual([
      [frame, true],
      [frame, true],
    ]);
  });

  it('opens the panel’s menu, never the page’s own, at the point under the pointer', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    const menu = new W.MouseEvent('contextmenu', { clientX: 20, clientY: 30, button: 2, bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    const replayed = seen.filter((e): e is MouseEvent => e.type === 'contextmenu');
    expect(replayed.map((m) => [m.target, m.clientX, m.clientY])).toEqual([[frame, 20, 30]]);
  });

  it('routes the platform copy through the panel, and keeps the page’s own when the panel did not take it', async () => {
    const { frame, doc, seen } = await mount();
    const W = pageWindow(doc);
    const untaken = new W.Event('copy', { bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(untaken);
    expect(untaken.defaultPrevented).toBe(false);
    frame.addEventListener('copy', (e) => e.preventDefault());
    const taken = new W.Event('copy', { bubbles: true, cancelable: true });
    inPage(doc).dispatchEvent(taken);
    expect(taken.defaultPrevented).toBe(true);
    expect(seen.filter((e) => e.type === 'copy').map((e) => e.target)).toEqual([frame, frame]);
  });

  it('stops listening when asked', async () => {
    const { doc, seen } = await mount();
    stop!();
    stop = undefined;
    const W = pageWindow(doc);
    inPage(doc).dispatchEvent(new W.KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(seen).toHaveLength(0);
  });
});

/*
 * 073 FR-008g — the page's events never reach the window's guard, so the page has its own: a middle click pastes into no
 * text box or contenteditable the page holds, while Ctrl+middle-click is still replayed for the zoom reset.
 */
describe('a middle click in the page pastes nowhere (073 FR-008g)', () => {
  it('a contenteditable in the page: the press is cancelled and the paste never reaches it', async () => {
    const { doc } = await mount();
    const editable = doc.body.appendChild(doc.createElement('div'));
    editable.contentEditable = 'true';
    const heard: Event[] = [];
    editable.addEventListener('paste', (e) => heard.push(e));
    const press = new (pageWindow(doc).MouseEvent)('mousedown', { bubbles: true, cancelable: true, button: 1 });
    editable.dispatchEvent(press);
    editable.dispatchEvent(new (pageWindow(doc).MouseEvent)('mouseup', { bubbles: true, cancelable: true, button: 1 }));
    editable.dispatchEvent(new (pageWindow(doc).Event)('paste', { bubbles: true, cancelable: true }));
    expect(press.defaultPrevented).toBe(true);
    expect(heard).toHaveLength(0);
  });

  it('Ctrl+middle-click is still replayed on the frame for the zoom reset', async () => {
    const { doc, seen } = await mount();
    inPage(doc).dispatchEvent(new (pageWindow(doc).MouseEvent)('mousedown', { bubbles: true, cancelable: true, button: 1, ctrlKey: true }));
    expect(seen.filter((e) => e.type === 'mousedown')).toHaveLength(1);
  });
});
