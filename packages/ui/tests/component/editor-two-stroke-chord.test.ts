/**
 * `Ctrl+E,W` (round 4: `Ctrl+E W`) toggles word wrap, as TWO strokes, in a mounted editor (046 T116; FR-091, FR-092).
 *
 * ══ WHAT IS RED, AND WHY ══
 *
 * The shipped default is already `editor.toggleWordWrap: ['Ctrl+E W']` (10A), and the editor keymap
 * is built from it — through `toCodeMirrorKey`, which splits on `+` alone and hands CodeMirror
 * `Ctrl-E W`. CodeMirror names a Ctrl+E keydown `Ctrl-e`, so that prefix never matches, and the
 * chord does nothing at all: no pending state, no toggle, and the first stroke is not consumed.
 * T115 is the unit half of that; this file is what the user sees. T117 turns both green, adding the
 * pending indication in `editor/pending-chord.tsx`, mounted from `EditorChrome`.
 *
 * ══ THE CONTRACT THIS FILE FIXES FOR T117 ══
 *
 * The indication is ONE element, `data-testid="editor-pending-chord"`, rendered while a prefix is
 * pending (and briefly after an unbound second stroke) and ABSENT otherwise. Its text names the
 * stroke as the Key Bindings editor spells it (`Ctrl+E`) and says a second key is awaited; after an
 * unbound second stroke it names both strokes and says the combination is not bound (VS Code's
 * wording, FR-092). Nothing else about its markup is asserted.
 *
 * ══ WHY THE ENDINGS ARE THE INTERESTING HALF ══
 *
 * CodeMirror's own prefix engine (research R19) gives two of FR-092's endings for free — the second
 * stroke, and a 4 s timeout — and gets the other two WRONG for this app:
 * - **Escape.** CodeMirror consumes it (`prevented = true` once a prefix is stored), but it does not
 *   stop propagation, so the window-level `SearchKeybindings` still sees an Escape and closes an open
 *   find bar. FR-092: Escape "cancels and is consumed without closing any bar".
 * - **Focus leaving.** `storedPrefix` survives a blur. Tab away and back within 4 s, press W, and
 *   the chord completes — the user pressed W in a document with no prefix showing.
 * So both are asserted through their CONSEQUENCE, not only through the indication disappearing.
 *
 * ══ WHAT THIS LAYER CANNOT SHOW ══
 *
 * jsdom inserts no text for a synthetic keydown, so "nothing is typed" is asserted as what makes it
 * true in a browser — the keydown's default is prevented — plus the document being unchanged.
 *
 * ══ 046 iterate round 5 (FR-124, SC-020) — ONE continuous press ══
 *
 * The chord is written `Ctrl+E,W` and pressed with Ctrl HELD from E through W. Matching is exact: the
 * second key completes only while every first-stroke modifier is still held, and a modifier added for
 * it is part of it (`Ctrl+E,Shift+W`). Releasing a first-stroke modifier ends the prefix silently. So
 * every second stroke below carries the first stroke's Ctrl (`KEYS.ctrlW`, `KEYS.ctrlX`); the round-4
 * (FR-123) assertions this supersedes are re-pinned in place, each citing FR-124.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import {
  __resetFindState,
  isFindShowingOn,
  openFind,
} from '../../src/renderer/search/search-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';

const PANEL = 'p-two-stroke';
const PENDING = 'editor-pending-chord';
/** The 4 s CodeMirror stores a prefix for, which FR-092 adopts. */
const PREFIX_TIMEOUT_MS = 4000;

/**
 * A fresh path per test. Word wrap is per DOCUMENT and the store is module-level
 * (`word-wrap-store.ts`), so a shared path would carry one test's toggle into the next.
 */
let seq = 0;
const nextPath = (): string => `C:/proj/two-stroke-${++seq}.ts`;

/**
 * A keydown as a US keyboard reports it — `key`, `code` AND `keyCode`. CodeMirror reads all three:
 * `key` for the binding name, `keyCode` to tell a modifier-only press (which must NOT end a stored
 * prefix) from a real second stroke.
 */
const KEYS = {
  ctrlE: { key: 'e', code: 'KeyE', keyCode: 69, ctrlKey: true },
  w: { key: 'w', code: 'KeyW', keyCode: 87 },
  x: { key: 'x', code: 'KeyX', keyCode: 88 },
  /** A second stroke with the first stroke's Ctrl still held (FR-124). */
  ctrlW: { key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true },
  ctrlX: { key: 'x', code: 'KeyX', keyCode: 88, ctrlKey: true },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
} as const;

/** Press on `el`; true when the default SURVIVED (fireEvent's own return), i.e. the key was not consumed. */
function press(el: HTMLElement, init: KeyboardEventInit & { keyCode?: number }): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(el, { bubbles: true, cancelable: true, ...init });
  });
  return notPrevented;
}

const indication = (): HTMLElement | null => screen.queryByTestId(PENDING);
const wrapped = (h: EditorHarness): boolean =>
  h.view().contentDOM.classList.contains('cm-lineWrapping');

let h: EditorHarness | undefined;
let outside: HTMLInputElement | undefined;

async function mount(keybindings?: Record<string, string[]>): Promise<EditorHarness> {
  const harness = mountEditor({
    panelId: PANEL,
    doc: { text: 'const a = 1;\nconst b = 2;\n', version: 1, absPath: nextPath() },
    withChrome: true,
    extras: [createElement(SearchKeybindings, { key: 'search-keys' })],
    ...(keybindings ? { keybindings } : {}),
  });
  h = harness;
  await waitFor(() => expect(harness.text()).toContain('const a = 1;'));
  // The keymap is built from the LIVE keybindings, delivered with the settings (issue #335).
  await waitFor(() => expect(harness.settingsLoaded()).toBe(true));
  act(() => harness.view().focus());
  return harness;
}

beforeEach(() => {
  __resetFindState();
  setActivePane('workspace');
});

afterEach(() => {
  vi.useRealTimers();
  outside?.remove();
  outside = undefined;
  h?.unmount();
  h = undefined;
  __resetFindState();
});

describe('Ctrl+E,W toggles the document’s word wrap (FR-091, FR-092, FR-124, US3 scenario 8)', () => {
  it('Ctrl+E is consumed and shows a pending indication naming the stroke; W, Ctrl held, then toggles wrap', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    expect(press(ed.content(), KEYS.ctrlE), 'the first stroke must be consumed, never typed or left to CodeMirror').toBe(false);
    const shown = indication();
    expect(shown, 'a pending prefix must show an indication in the focused editor (FR-092)').not.toBeNull();
    expect(shown!.textContent).toContain('Ctrl+E');
    expect(shown!.textContent).toMatch(/second key|waiting|awaiting/i);
    expect(wrapped(ed), 'the first stroke alone must not toggle anything').toBe(before);

    // FR-124 — re-pinned from a bare W: the second key completes only with Ctrl still held.
    expect(press(ed.content(), KEYS.ctrlW), 'the completing stroke must be consumed — W is not typed').toBe(false);
    expect(wrapped(ed), 'Ctrl+E,W must toggle the document’s word wrap').toBe(!before);
    expect(indication(), 'the prefix ends on its second stroke').toBeNull();
    expect(ed.view().state.doc.toString()).toBe(doc);
  });

  it('a second Ctrl+E,W toggles it back — the chord is repeatable, not a one-shot', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW); // FR-124 — Ctrl held (re-pinned from a bare W)
    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW);
    expect(wrapped(ed)).toBe(before);
  });
});

describe('Escape cancels the prefix (FR-092)', () => {
  it('Escape is consumed, ends the prefix, toggles nothing, and a later W is just W', async () => {
    const ed = await mount();
    const before = wrapped(ed);

    press(ed.content(), KEYS.ctrlE);
    expect(press(ed.content(), KEYS.escape), 'Escape during a pending prefix must be consumed').toBe(false);
    expect(indication()).toBeNull();

    // W after the cancel is an ordinary key: not consumed, and no toggle.
    expect(press(ed.content(), KEYS.w)).toBe(true);
    expect(wrapped(ed), 'a cancelled prefix must not complete on a later W').toBe(before);
  });

  it('Escape during a pending prefix closes NO open find bar', async () => {
    const ed = await mount();
    act(() => openFind(PANEL, 'editor'));
    await waitFor(() => expect(isFindShowingOn(PANEL)).toBe(true));
    act(() => ed.view().focus());

    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.escape);

    expect(
      isFindShowingOn(PANEL),
      'the Escape that cancels a prefix belongs to the prefix — the window-level search.close must not also see it',
    ).toBe(true);
  });

  it('control: with NO prefix pending, Escape still closes the find bar as it always has', async () => {
    const ed = await mount();
    act(() => openFind(PANEL, 'editor'));
    await waitFor(() => expect(isFindShowingOn(PANEL)).toBe(true));
    act(() => ed.view().focus());

    press(ed.content(), KEYS.escape);

    expect(isFindShowingOn(PANEL), 'the fix must not swallow every Escape').toBe(false);
  });
});

describe('an unbound second stroke (FR-092, VS Code’s behaviour)', () => {
  it('is consumed, types nothing, toggles nothing, and says the combination is not bound', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), KEYS.ctrlE);
    // FR-124 — Ctrl held (re-pinned from a bare X): a released Ctrl ends the prefix silently instead.
    expect(press(ed.content(), KEYS.ctrlX), 'an unbound second stroke must be consumed, not typed').toBe(false);

    expect(wrapped(ed)).toBe(before);
    expect(ed.view().state.doc.toString()).toBe(doc);
    const shown = indication();
    expect(shown, 'the indication must report the unbound combination').not.toBeNull();
    expect(shown!.textContent).toContain('Ctrl+E');
    expect(shown!.textContent).toMatch(/\bX\b/);
    expect(shown!.textContent).toMatch(/not bound/i);
  });

  it('ends the prefix — a W straight after is an ordinary key', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlX); // FR-124 — Ctrl held (re-pinned from a bare X)
    expect(press(ed.content(), KEYS.w)).toBe(true);
    expect(wrapped(ed)).toBe(before);
  });
});

/**
 * 046 iterate round 4 (FR-123, SC-019) — Ctrl held through the second stroke; re-pinned by round 5
 * (FR-124, SC-020, supersession S29).
 *
 * The maintainer's measured report: Ctrl held → E down → E up → W down produced "Ctrl+E, Ctrl+W …
 * not bound". Under FR-124 that sequence IS the chord `Ctrl+E,W` — one continuous press, matched
 * exactly. What FR-124 changes is the release: a first-stroke modifier let go before the second key
 * ends the prefix at once and silently, and the next key is an ordinary key. A modifier ADDED for the
 * second key is part of it (`Ctrl+E,Shift+W`), which replaces round 4's "released and pressed again".
 */
describe('Ctrl held from the first stroke through the second (FR-124)', () => {
  const CTRL_DOWN = { key: 'Control', code: 'ControlLeft', keyCode: 17, ctrlKey: true };
  const CTRL_UP = { key: 'Control', code: 'ControlLeft', keyCode: 17 };
  const E_UP = { key: 'e', code: 'KeyE', keyCode: 69, ctrlKey: true };
  const CTRL_W = { key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true };
  const up = (el: HTMLElement, init: KeyboardEventInit & { keyCode?: number }): void => {
    act(() => {
      fireEvent.keyUp(el, { bubbles: true, cancelable: true, ...init });
    });
  };

  it('Ctrl down, E down, E up, W down (no Ctrl keyup) toggles word wrap and reports nothing unbound', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), CTRL_DOWN);
    press(ed.content(), KEYS.ctrlE);
    up(ed.content(), E_UP);
    expect(press(ed.content(), CTRL_W), 'the second stroke is consumed').toBe(false);

    expect(indication()?.textContent ?? '', 'no "not bound" notice for Ctrl held through W').not.toMatch(/not bound/i);
    expect(wrapped(ed), 'Ctrl held through W must still complete Ctrl+E W').toBe(!before);
    expect(indication()).toBeNull();
    expect(ed.view().state.doc.toString()).toBe(doc);
  });

  it('Ctrl released before the W does NOT toggle it: the prefix ends silently and W is typed (FR-124)', async () => {
    // Re-pinned from round 4's "Ctrl released before the W still toggles it" — FR-124 supersedes it.
    const ed = await mount();
    const before = wrapped(ed);

    press(ed.content(), CTRL_DOWN);
    press(ed.content(), KEYS.ctrlE);
    up(ed.content(), E_UP);
    up(ed.content(), CTRL_UP);
    expect(indication(), 'releasing the first stroke’s Ctrl ends the prefix at once').toBeNull();
    expect(press(ed.content(), KEYS.w), 'W after the release is an ordinary key — not consumed, so typed').toBe(true);

    expect(wrapped(ed), 'a released Ctrl must not complete Ctrl+E,W').toBe(before);
    expect(indication()?.textContent ?? '', 'the ending is silent — no "not bound" notice').not.toMatch(/not bound/i);
    expect(indication()).toBeNull();
  });

  it('a modifier ADDED for the second key is part of it: `Ctrl+E,Shift+W` is reached with Ctrl held, Shift added', async () => {
    // Re-pinned from round 4's "`Ctrl+E Ctrl+W` reached by Ctrl released and pressed again" (FR-124).
    const ed = await mount({ 'editor.indentLines': ['Ctrl+E,Shift+W'] });
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), CTRL_DOWN);
    press(ed.content(), KEYS.ctrlE);
    up(ed.content(), E_UP);
    press(ed.content(), { key: 'Shift', code: 'ShiftLeft', keyCode: 16, ctrlKey: true, shiftKey: true });
    expect(press(ed.content(), { key: 'W', code: 'KeyW', keyCode: 87, ctrlKey: true, shiftKey: true })).toBe(false);

    expect(ed.view().state.doc.toString(), 'Ctrl+E,Shift+W must run editor.indentLines').not.toBe(doc);
    expect(wrapped(ed), 'and must not toggle wrap').toBe(before);
    expect(indication()).toBeNull();
  });

  it('with BOTH `Ctrl+E,W` and `Ctrl+E,Shift+W` bound, Ctrl held through W runs `Ctrl+E,W`’s command only', async () => {
    // Re-pinned from round 4's `Ctrl+E Ctrl+W` pairing: matching is exact (FR-124), so the held-Ctrl W
    // is `Ctrl+E,W` and never the chord that also wants Shift.
    const ed = await mount({ 'editor.indentLines': ['Ctrl+E,Shift+W'] });
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), CTRL_DOWN);
    press(ed.content(), KEYS.ctrlE);
    up(ed.content(), E_UP);
    expect(press(ed.content(), CTRL_W)).toBe(false);

    expect(wrapped(ed), 'Ctrl held through W must toggle wrap').toBe(!before);
    expect(ed.view().state.doc.toString(), 'and must not run the Ctrl+E,Shift+W command').toBe(doc);
  });

  it('an unbound second stroke with Ctrl held is labelled without the carried Ctrl', async () => {
    const ed = await mount();
    press(ed.content(), CTRL_DOWN);
    press(ed.content(), KEYS.ctrlE);
    up(ed.content(), E_UP);
    press(ed.content(), { key: 'x', code: 'KeyX', keyCode: 88, ctrlKey: true });

    const shown = indication();
    expect(shown?.textContent ?? '').toMatch(/not bound/i);
    expect(shown!.textContent).toMatch(/\bX\b/);
    expect(shown!.textContent).not.toContain('Ctrl+X');
  });
});

/**
 * The engine is not a word-wrap special case (FR-092 "a binding MAY be a two-stroke chord"): a second
 * editor command sharing the same first stroke completes on its own second stroke, and the two never
 * collide — one prefix, two completions, each running only its own command.
 */
describe('two chords sharing one first stroke (FR-092)', () => {
  it('Ctrl+E,X indents and Ctrl+E,W wraps — each fires its own command only', async () => {
    // FR-124 — re-pinned to the comma form, second strokes pressed with Ctrl held.
    const ed = await mount({ 'editor.indentLines': ['Ctrl+E,X'] });
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), KEYS.ctrlE);
    expect(press(ed.content(), KEYS.ctrlX), 'the bound second stroke X is consumed').toBe(false);
    expect(ed.view().state.doc.toString(), 'Ctrl+E,X must run editor.indentLines').not.toBe(doc);
    expect(wrapped(ed), 'Ctrl+E,X must not also toggle wrap').toBe(before);
    expect(indication(), 'a completed chord shows no "not bound" notice').toBeNull();

    const indented = ed.view().state.doc.toString();
    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW);
    expect(wrapped(ed), 'Ctrl+E,W still toggles wrap').toBe(!before);
    expect(ed.view().state.doc.toString(), 'Ctrl+E,W must not also indent').toBe(indented);
  });
});

describe('focus leaving the editor ends the prefix (FR-092)', () => {
  it('the indication goes, and coming back and pressing W does NOT complete the chord', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    outside = document.createElement('input');
    document.body.append(outside);

    press(ed.content(), KEYS.ctrlE);
    expect(indication()).not.toBeNull();

    act(() => outside!.focus());
    expect(indication(), 'focus leaving the editor must end the prefix').toBeNull();

    // Back well inside CodeMirror's 4 s — its own stored prefix would still be live here.
    act(() => ed.view().focus());
    expect(press(ed.content(), KEYS.w), 'W after a focus change is an ordinary key').toBe(true);
    expect(wrapped(ed), 'a prefix abandoned by a focus change must not complete later').toBe(before);
  });
});

describe('the prefix times out at 4 s (FR-092, CodeMirror’s PrefixTimeout)', () => {
  it('is still pending just before 4 s and gone at 4 s; a W after that toggles nothing', async () => {
    const ed = await mount();
    const before = wrapped(ed);
    // Faked only after the mount: `waitFor` above polls on real timers.
    vi.useFakeTimers();

    press(ed.content(), KEYS.ctrlE);
    expect(indication()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(PREFIX_TIMEOUT_MS - 1);
    });
    expect(indication(), 'the prefix must still be pending at 3.999 s').not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(indication(), 'the prefix must end at 4 s').toBeNull();

    expect(press(ed.content(), KEYS.w)).toBe(true);
    expect(wrapped(ed), 'a timed-out prefix must not complete').toBe(before);
  });
});

/**
 * The window listener (`app.tsx` `KeybindingsHandler`) with a TERMINAL focused.
 *
 * FR-091: the command is `EDITOR_ONLY`, so "no terminal ever receives it or waits on it", and Ctrl+E
 * is readline's end-of-line — reserved tier. This is a GUARD rather than a red: today the window
 * listener matches one event against one token, so it cannot match `Ctrl+E W` at all. It is here
 * because T117 must not satisfy the cases above by adding a prefix state to the window listener,
 * which is the one place that would hold back a shell's Ctrl+E.
 */
describe('with a terminal focused, the window listener does not consume Ctrl+E (FR-091, EDITOR_ONLY)', () => {
  const PROJECT = 'proj-term';
  let ws: MountedWorkspace | undefined;
  let terminalEl: HTMLTextAreaElement | undefined;

  afterEach(() => {
    terminalEl?.remove();
    terminalEl = undefined;
    ws?.unmount();
    ws = undefined;
  });

  function terminalLayout(): WorkspaceLayout {
    const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'term-1' });
    const terminal: Panel = { type: 'panel', id: 'term-1', originProjectId: PROJECT, title: 'Terminal', kind: 'terminal' };
    l.tabs[0].root = terminal;
    l.tabs[0].activePanelId = 'term-1';
    return l;
  }

  it('Ctrl+E and then W both reach the terminal untouched', async () => {
    ws = await mountWorkspace(terminalLayout(), {
      extras: [
        createElement(KeybindingsHandler, {
          key: 'keys',
          onToggleProjects: () => {},
          onToggleExplorer: () => {},
          onRevealLeft: () => {},
          onRevealRight: () => {},
        }),
      ],
      throng: { zoomReset: vi.fn(), zoomBy: vi.fn() },
    });
    // xterm's own focused element.
    terminalEl = document.createElement('textarea');
    terminalEl.className = 'xterm-helper-textarea';
    document.body.append(terminalEl);
    act(() => terminalEl!.focus());

    expect(press(terminalEl, KEYS.ctrlE), 'Ctrl+E is readline end-of-line; the window must not take it').toBe(true);
    expect(press(terminalEl, KEYS.w), 'no prefix may be pending in a terminal, so W is just W').toBe(true);
  });
});

/**
 * 046 iterate round 6 (FR-126, SC-021) — up to THREE keys under the held modifiers: `Ctrl+E,W,Q`, one
 * continuous press, matched exactly as FR-124 matches two. Everything FR-124 says of the second key
 * holds for the third, and the pending indication names the keys pressed so far.
 *
 * No shipped default is three keys, so the binding is test-local. Word wrap is unbound for it: a
 * two-key chord that prefixes a three-key one in an intersecting scope is a collision (T218).
 */
describe('a three-key chord `Ctrl+E,W,Q` (FR-126)', () => {
  const THREE = { 'editor.indentLines': ['Ctrl+E,W,Q'], 'editor.toggleWordWrap': [] };
  const CTRL_UP = { key: 'Control', code: 'ControlLeft', keyCode: 17 };
  const ctrlQ = { key: 'q', code: 'KeyQ', keyCode: 81, ctrlKey: true };
  const up = (el: HTMLElement, init: KeyboardEventInit & { keyCode?: number }): void => {
    act(() => {
      fireEvent.keyUp(el, { bubbles: true, cancelable: true, ...init });
    });
  };

  it('Ctrl held through E, W and Q runs the command; each key is consumed', async () => {
    const ed = await mount(THREE);
    const before = wrapped(ed);
    const doc = ed.view().state.doc.toString();

    expect(press(ed.content(), KEYS.ctrlE)).toBe(false);
    expect(press(ed.content(), KEYS.ctrlW), 'the second key of three is consumed, not typed').toBe(false);
    expect(ed.view().state.doc.toString(), 'two keys of three run nothing').toBe(doc);
    expect(press(ed.content(), ctrlQ), 'the completing third key is consumed').toBe(false);

    expect(ed.view().state.doc.toString(), 'Ctrl+E,W,Q must run editor.indentLines').not.toBe(doc);
    expect(wrapped(ed), 'and nothing else').toBe(before);
    expect(indication(), 'the prefix ends on its third key').toBeNull();
  });

  it('after E and W the indication names the keys pressed so far', async () => {
    const ed = await mount(THREE);
    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW);
    const shown = indication();
    expect(shown, 'a two-key prefix of a three-key chord is still pending').not.toBeNull();
    expect(shown!.textContent).toContain('Ctrl+E,W');
    expect(shown!.textContent).not.toMatch(/not bound/i);
  });

  it('releasing Ctrl after W ends the prefix silently; Q is then an ordinary key', async () => {
    const ed = await mount(THREE);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW);
    up(ed.content(), CTRL_UP);
    expect(indication(), 'releasing the first stroke’s Ctrl ends the prefix at once').toBeNull();
    expect(press(ed.content(), { key: 'q', code: 'KeyQ', keyCode: 81 }), 'Q after the release is not consumed').toBe(true);

    expect(ed.view().state.doc.toString(), 'a released Ctrl must not complete Ctrl+E,W,Q').toBe(doc);
    expect(indication()).toBeNull();
  });

  it('an unbound third key is consumed and reported, naming all three keys', async () => {
    const ed = await mount(THREE);
    const doc = ed.view().state.doc.toString();

    press(ed.content(), KEYS.ctrlE);
    press(ed.content(), KEYS.ctrlW);
    expect(press(ed.content(), KEYS.ctrlX), 'an unbound third key is consumed, not typed').toBe(false);

    expect(ed.view().state.doc.toString()).toBe(doc);
    const shown = indication();
    expect(shown?.textContent ?? '').toMatch(/not bound/i);
    expect(shown!.textContent).toContain('Ctrl+E');
    expect(shown!.textContent).toMatch(/\bW\b/);
    expect(shown!.textContent).toMatch(/\bX\b/);
  });
});
