/**
 * `zoom.reset` / `panel.zoomReset` — the FR-080 routing split, pressed through the REAL window key
 * handler (`app.tsx` `KeybindingsHandler`) — 046 iterate round 1 (T110, FR-080 under FR-102).
 *
 * ══ WHAT CHANGED IN ROUND 1 ══
 *
 * `zoom.reset`'s shipped chord moved from `Ctrl+Shift+0` to the TIER-1 `Ctrl+Shift+Alt+0` (FR-102):
 * the app-wide reset needs all three modifiers held, matched on the PHYSICAL `Digit0` key (FR-104)
 * exactly as the plain digit row needed physical matching for the pre-round `Ctrl+Shift+0` (FR-026,
 * R2). `panel.zoomReset` (`Ctrl+Alt+0`) was UNCHANGED by round 1 and already routed correctly
 * (`app.tsx`'s `wsRef.current.resetZoom(id)`).
 *
 * ══ WHAT CHANGED IN ROUND 2 (FR-114) ══
 *
 * The maintainer's own words, mid-build: "The 'Zoom Reset' key bindings need to use the numpad
 * zero, NOT the 0 key." Both chords' key segment moves from the main-row `Digit0` to the physical
 * keypad `Numpad0` — matched on `code` alone, with or without NumLock — and the main-row `0` key no
 * longer resets either zoom at all. Every case below presses `Numpad0`; the cases proving the
 * main-row key no longer works are new.
 *
 * Pressed with focus in three different DOM contexts — a real textarea (a terminal's own focused
 * element), an editor's content surface, and a transient find-bar input — because `zoom.reset` is
 * scoped EVERYWHERE (`COMMAND_SCOPES`) and the window listener runs at the CAPTURE phase specifically
 * so a focused surface never gets first look at the chord (`app.tsx`'s own comment on the listener).
 */
import { act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';
import { chordEvent } from '../shared/chord-event.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;
let zoomReset: ReturnType<typeof vi.fn>;
let zoomBy: ReturnType<typeof vi.fn>;
let terminalEl: HTMLTextAreaElement;
let editorEl: HTMLDivElement;
let findWrapEl: HTMLDivElement;
let findEl: HTMLInputElement;

const editor = (id: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind: 'editor',
  config: { filePath: `D:/proj/${id}.ts` },
});

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = editor('p1');
  l.tabs[0].activePanelId = 'p1';
  return l;
}

let resetZoom: ReturnType<typeof vi.fn>;
let bumpZoom: ReturnType<typeof vi.fn>;

async function mount(): Promise<void> {
  zoomReset = vi.fn();
  zoomBy = vi.fn();
  m = await mountWorkspace(layout(), {
    extras: [
      createElement(KeybindingsHandler, {
        key: 'keys',
        onToggleProjects: () => {},
        onToggleExplorer: () => {},
        onRevealLeft: () => {},
        onRevealRight: () => {},
      }),
    ],
    throng: { zoomReset, zoomBy },
  });
  // The PANEL-STORE half of the FR-080 split (`panel.zoomReset` / `panel.zoomIn` / `panel.zoomOut`),
  // spied on the live store `app.tsx`'s `wsRef.current` reads — as distinct from `window.throng`'s
  // app-wide `zoomReset`/`zoomBy` above, which `zoom.reset` / `zoom.in` / `zoom.out` call instead.
  resetZoom = vi.spyOn(m.ws(), 'resetZoom') as unknown as ReturnType<typeof vi.fn>;
  bumpZoom = vi.spyOn(m.ws(), 'bumpZoom') as unknown as ReturnType<typeof vi.fn>;
  // Three focus contexts, each a real element a user's caret could actually be in — not the
  // workspace panels themselves (which the listener's window-level scope makes irrelevant to
  // zoom.reset), but the SURFACES this chord must survive being captured while: a terminal's
  // own focused element is a textarea, an editor's document is its content div, and 013's find
  // bar is a transient `<input>` inside a `[data-find-bar]` wrapper (`scope.ts`
  // `transientInputFocused`).
  terminalEl = document.createElement('textarea');
  editorEl = document.createElement('div');
  editorEl.className = 'cm-content';
  editorEl.tabIndex = 0;
  findWrapEl = document.createElement('div');
  findWrapEl.setAttribute('data-find-bar', '');
  findEl = document.createElement('input');
  findWrapEl.appendChild(findEl);
  document.body.append(terminalEl, editorEl, findWrapEl);
}

beforeEach(() => {
  setActivePane('workspace');
});

afterEach(() => {
  terminalEl?.remove();
  editorEl?.remove();
  findWrapEl?.remove();
  m?.unmount();
  m = undefined;
});

/** Press a chord over `el`, returning whether the event's default survived (fireEvent's own return). */
function press(el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(el, { key, bubbles: true, ...mods });
  });
  return notPrevented;
}

/**
 * Press a binding token as a US keyboard reports it — `key` AND `code`, from the shared T044 builder
 * (`tests/shared/chord-event.ts`), so the event is the one `chordCandidates` actually reads.
 * `Ctrl++` is Shift+`=` on US, hence the `shiftKey` override where the token spells no Shift.
 */
function pressChord(el: HTMLElement, token: string, mods: { shiftKey?: boolean } = {}): boolean {
  const e = chordEvent(token, mods);
  return press(el, e.key, { code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });
}

describe('zoom.reset / panel.zoomReset — the FR-080 routing split under the tier-1 chord (T110, FR-102)', () => {
  const contexts: Array<[string, () => HTMLElement]> = [
    ['a terminal', () => terminalEl],
    ['an editor', () => editorEl],
    ['a find input', () => findEl],
  ];

  for (const [label, getEl] of contexts) {
    it(`Ctrl+Shift+Alt+Numpad0 resets the APP-WIDE zoom and is captured, with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      // Matched on the PHYSICAL Numpad0 code (FR-114) — the maintainer's own words, mid-build: "the
      // numpad zero, NOT the 0 key."
      const notPrevented = pressChord(el, 'Ctrl+Shift+Alt+Numpad0');
      expect(notPrevented, 'Ctrl+Shift+Alt+Numpad0 must be captured by the window listener, not left to the focused surface').toBe(false);
      expect(zoomReset, 'zoom.reset must reach the APP-WIDE reset (window.throng.zoomReset)').toHaveBeenCalledTimes(1);
      expect(resetZoom, 'zoom.reset must NOT reach the per-panel store').not.toHaveBeenCalled();
    });

    it(`Ctrl+Alt+Numpad0 resets only the ACTIVE PANEL and never calls the window API, with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = pressChord(el, 'Ctrl+Alt+Numpad0');
      expect(notPrevented, 'Ctrl+Alt+Numpad0 must be captured by the window listener').toBe(false);
      expect(resetZoom, 'panel.zoomReset must reach the per-panel store').toHaveBeenCalledWith('p1');
      expect(zoomReset, 'panel.zoomReset must NOT reach the app-wide reset').not.toHaveBeenCalled();
    });

    it(`the main-row Ctrl+Shift+Alt+0 (Digit0) no longer resets the window zoom (FR-114), with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = pressChord(el, 'Ctrl+Shift+Alt+0');
      expect(notPrevented, 'the main-row 0 names no shipped chord any more — it must not be captured').toBe(true);
      expect(zoomReset).not.toHaveBeenCalled();
      expect(resetZoom).not.toHaveBeenCalled();
    });

    // Re-pinned in place for 046 iterate round 7 (FR-127), which supersedes FR-114 for the PANEL
    // reset only: `panel.zoomReset` ships the main-row `Ctrl+Alt+0` again, as a second chord beside
    // Numpad0 (Constitution IV's named exception). The window reset stays Numpad0-only (above).
    it(`the main-row Ctrl+Alt+0 (US, key "0") resets only the ACTIVE PANEL, never the window (FR-127), with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = pressChord(el, 'Ctrl+Alt+0');
      expect(notPrevented, 'Ctrl+Alt+0 must be captured by the window listener').toBe(false);
      expect(resetZoom, 'panel.zoomReset must reach the per-panel store').toHaveBeenCalledWith('p1');
      expect(zoomReset, 'the main-row 0 must still reset no window zoom').not.toHaveBeenCalled();
    });

    it(`Ctrl+Shift+0 now does NOTHING — #390's chord is retired (FR-107), with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = pressChord(el, 'Ctrl+Shift+0');
      expect(notPrevented, 'Ctrl+Shift+0 names no shipped chord any more — it must not be captured').toBe(true);
      expect(zoomReset).not.toHaveBeenCalled();
      expect(resetZoom).not.toHaveBeenCalled();
    });

    it(`plain Ctrl++, Ctrl+= and Ctrl+- are unbound, with focus in ${label}`, async () => {
      // FR-102: "Plain Ctrl++, Ctrl+-, Ctrl+= and Ctrl+0 become unbound" — zoom.in/out moved to
      // tier 1 and panel.zoomIn/out kept only Ctrl+Alt++/-, so a bare Ctrl+ combination names
      // nothing at all any more.
      await mount();
      const el = getEl();
      el.focus();
      pressChord(el, 'Ctrl++', { shiftKey: true });
      pressChord(el, 'Ctrl+=');
      pressChord(el, 'Ctrl+-');
      expect(zoomBy).not.toHaveBeenCalled();
      expect(bumpZoom).not.toHaveBeenCalled();
      expect(zoomReset).not.toHaveBeenCalled();
      expect(resetZoom).not.toHaveBeenCalled();
    });

    it(`German AltGr+0 ("}", Ctrl+Alt) fires nothing and is not captured, with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      // Browsers report AltGr as Ctrl+Alt held together; the produced character is "}" on a
      // German layout. Alt held must exclude the physical-digit candidate (chordCandidates Rule 1),
      // so this must resolve to nothing — neither zoom.reset (Numpad0, a different physical key
      // entirely) NOR panel.zoomReset: its main-row `Ctrl+Alt+0` (FR-127) is matched on the PRODUCED
      // `0`, and this press produces `}`.
      const notPrevented = press(el, '}', { code: 'Digit0', ctrlKey: true, altKey: true });
      expect(notPrevented, 'AltGr+0 must not be captured — it names no shipped chord').toBe(true);
      expect(zoomReset).not.toHaveBeenCalled();
      expect(resetZoom).not.toHaveBeenCalled();
      expect(zoomBy).not.toHaveBeenCalled();
    });

    it(`AZERTY AltGr+0 ("@", Ctrl+Alt) fires nothing and is not captured (FR-127), with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = press(el, '@', { code: 'Digit0', ctrlKey: true, altKey: true });
      expect(notPrevented, 'AltGr+0 must reach the focused surface — it types "@"').toBe(true);
      expect(zoomReset).not.toHaveBeenCalled();
      expect(resetZoom).not.toHaveBeenCalled();
    });
  }
});

/**
 * 046 iterate round 1 (T106/T111, SC-021) — `zoom.in` / `zoom.out` / `panel.zoomIn` /
 * `panel.zoomOut` / `panel.zoomReset` newly appear in `discoverKeepShiftChords()` the moment
 * `chordCandidates` gains the tier-1 rule (T111): every `Ctrl+Alt`-shaped default now differs by
 * whether Shift is also held, which is exactly what the coverage manifest
 * (`window-chord-manifest.test.ts`'s "covers every discovered chord" guard) exists to catch. Claimed
 * in `COVERED_IN_COMPONENT` (`tests/shared/window-chords.ts`) and pressed here, beside the sibling
 * `zoom.reset` / `panel.zoomReset` cases above, rather than added to an E2E spec — a component test
 * is the lowest layer that can already see this dispatcher (Principle V).
 */
describe('zoom.in / zoom.out / panel.zoomIn / panel.zoomOut / panel.zoomReset resolve their shipped defaults (SC-021, T106)', () => {
  it('Ctrl+Shift+Alt++ (zoom.in) and Ctrl+Shift+Alt+- (zoom.out) reach the app-wide zoom', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, '+', { code: 'Equal', ctrlKey: true, shiftKey: true, altKey: true });
    expect(zoomBy).toHaveBeenCalledWith(1);
    press(terminalEl, '_', { code: 'Minus', ctrlKey: true, shiftKey: true, altKey: true });
    expect(zoomBy).toHaveBeenCalledWith(-1);
  });

  it('Ctrl+Alt++ (panel.zoomIn) reaches the per-panel store', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, '=', { code: 'Equal', ctrlKey: true, altKey: true });
    expect(bumpZoom).toHaveBeenCalledWith('p1', 1);
  });

  it('Ctrl+Alt+- (panel.zoomOut) reaches the per-panel store', async () => {
    // A fresh mount, not a second press on the one above: `bumpZoom` here is a spy on the LIVE
    // workspace store (unlike `zoomBy`, a bare `vi.fn()`), so the first press's real state change
    // re-renders the provider and hands `KeybindingsHandler`'s ref a NEW context value object whose
    // `bumpZoom` is the unspied original — the second press would call that one, unseen by the spy.
    await mount();
    terminalEl.focus();
    press(terminalEl, '-', { code: 'Minus', ctrlKey: true, altKey: true });
    expect(bumpZoom).toHaveBeenCalledWith('p1', -1);
  });

  it('Ctrl+Alt+Numpad0 (panel.zoomReset) reaches the per-panel store from a literal keypad press too', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, '0', { code: 'Numpad0', ctrlKey: true, altKey: true });
    expect(resetZoom).toHaveBeenCalledWith('p1');
  });

  // Re-pinned in place for FR-127 (supersedes FR-114 for the panel reset): the main-row key is
  // panel.zoomReset's second shipped chord.
  it('the main-row Ctrl+Alt+0 (Digit0, key "0") reaches the per-panel store, never the window (FR-127)', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, '0', { code: 'Digit0', ctrlKey: true, altKey: true });
    expect(resetZoom).toHaveBeenCalledWith('p1');
    expect(zoomReset).not.toHaveBeenCalled();
  });
});

/**
 * 046 FR-120 (T189) — the MEASURED Windows shapes (research R22, "T149 follow-up"), pressed through
 * the real window listener. With NumLock ON, Windows hides a held Shift on the keypad: the tier-1
 * press arrives as `{ code Numpad0, key "Insert", shift false }` with NumLock on, which FR-105's
 * same-binding rule used to resolve as `panel.zoomReset`. `modifierNumLock` sets what
 * `getModifierState('NumLock')` answers, as a real keyboard's event does.
 */
describe('Ctrl+Shift+Alt+Numpad0 resets the WINDOW whatever the NumLock state (FR-120)', () => {
  const contexts: Array<[string, () => HTMLElement]> = [
    ['a terminal', () => terminalEl],
    ['an editor', () => editorEl],
    ['a find input', () => findEl],
  ];
  const NUMLOCK_ON_TIER1 = { code: 'Numpad0', ctrlKey: true, altKey: true, shiftKey: false, modifierNumLock: true } as KeyboardEventInit;

  for (const [label, getEl] of contexts) {
    it(`NumLock ON: the measured shape resets the APP-WIDE zoom, never the panel, with focus in ${label}`, async () => {
      await mount();
      const el = getEl();
      el.focus();
      const notPrevented = press(el, 'Insert', NUMLOCK_ON_TIER1);
      expect(notPrevented, 'the chord must be captured by the window listener').toBe(false);
      expect(zoomReset, 'zoom.reset must reach the APP-WIDE reset').toHaveBeenCalledTimes(1);
      expect(resetZoom, 'the NumLock-ON tier-1 press must NOT reset the panel').not.toHaveBeenCalled();
    });
  }

  it('NumLock OFF: the measured shape (key "Insert", Shift reported) resets the APP-WIDE zoom', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, 'Insert', { code: 'Numpad0', ctrlKey: true, altKey: true, shiftKey: true });
    expect(zoomReset).toHaveBeenCalledTimes(1);
    expect(resetZoom).not.toHaveBeenCalled();
  });

  it('NumLock ON: a genuine Ctrl+Alt+Numpad0 (key "0") still resets only the PANEL', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, '0', { code: 'Numpad0', ctrlKey: true, altKey: true, modifierNumLock: true } as KeyboardEventInit);
    expect(resetZoom).toHaveBeenCalledWith('p1');
    expect(zoomReset).not.toHaveBeenCalled();
  });

  it('NumLock OFF: a genuine Ctrl+Alt+Numpad0 (key "Insert") still resets only the PANEL', async () => {
    await mount();
    terminalEl.focus();
    press(terminalEl, 'Insert', { code: 'Numpad0', ctrlKey: true, altKey: true });
    expect(resetZoom).toHaveBeenCalledWith('p1');
    expect(zoomReset).not.toHaveBeenCalled();
  });
});

/**
 * Fix round CRITICAL (review of T111) — an AltGr combination Chromium reports as Ctrl+Alt (R22) must
 * NOT be swallowed by the panel.zoomIn/panel.zoomOut same-binding rule (FR-105), through the REAL
 * window listener: `preventDefault` must NOT be called, so the character actually reaches whatever
 * has focus (a terminal, an editor) instead of silently zooming a panel and eating the keystroke.
 * `chord-candidates.test.ts` proves the same guard at the unit layer; this is the DOM-dispatch proof
 * that `panel.zoomIn`/`panel.zoomOut` genuinely do not fire and the keystroke is not captured.
 */
describe('an AltGr combination reported as Ctrl+Alt is never folded onto panel.zoomIn/panel.zoomOut (fix round CRITICAL)', () => {
  // Built directly rather than through chordEventOnLayout('German'/'French', …) — see the identical
  // note in chord-candidates.test.ts's sibling describe block: that shared table's AltGr branch keys
  // only on `ctrlKey && altKey`, so an override added there for this unshifted case also reaches the
  // tier-1 (Ctrl+Shift+Alt) event on the same code and breaks unrelated, already-passing tests.
  it('German AltGr+ß (physical Minus, produces \\) is not captured and fires no panel zoom', async () => {
    await mount();
    terminalEl.focus();
    const notPrevented = press(terminalEl, '\\', { code: 'Minus', ctrlKey: true, altKey: true });
    expect(notPrevented, 'AltGr+ß must reach the terminal — it names no shipped chord').toBe(true);
    expect(bumpZoom).not.toHaveBeenCalled();
    expect(resetZoom).not.toHaveBeenCalled();
  });

  it('AZERTY AltGr+= (physical Equal, produces }) is not captured and fires no panel zoom', async () => {
    await mount();
    terminalEl.focus();
    const notPrevented = press(terminalEl, '}', { code: 'Equal', ctrlKey: true, altKey: true });
    expect(notPrevented, 'AltGr+= must reach the terminal — it names no shipped chord').toBe(true);
    expect(bumpZoom).not.toHaveBeenCalled();
    expect(resetZoom).not.toHaveBeenCalled();
  });
});
