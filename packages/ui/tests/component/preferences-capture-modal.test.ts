/**
 * 015 / US4 — capturing a key binding (FR-031 … FR-033b).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-keybindings.e2e.ts` (034 FR-045).
 *
 * Those tests opened a real preferences window and then dispatched **synthetic** `KeyboardEvent`s
 * at `window` — which is what a component test does natively. The window bought nothing: the modal
 * listens on `window`, decides whether the chord is bindable, and hands a new bindings map to its
 * parent. Every step of that is visible in a DOM.
 *
 * WHAT STAYED AN E2E, and why:
 *
 *  - **That the captured chord reaches `keybindings.json`.** The modal hands `onApply` a map; who
 *    writes it, and whether it survives, is the config-write path.
 *  - **The `user-select: none` assertions.** They read `getComputedStyle(el).userSelect` and expect
 *    the value INHERITED from the app's stylesheet. jsdom does not apply a real cascade, so a
 *    component test asserting it would be asserting about jsdom rather than about throng — which is
 *    the trap 034 FR-049 names: an assertion that looks like markup but depends on real style
 *    resolution stays where the styles are real.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CaptureModal } from '../../src/renderer/preferences/capture-modal.js';
import { KeybindingsTab } from '../../src/renderer/preferences/keybindings-tab.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';

/** The shipped defaults the E2E relied on, restated so a change to them cannot rewrite the claim. */
const BINDINGS: Record<string, string[]> = {
  'view.toggleProjects': ['Ctrl+Alt+B'],
  'view.toggleExplorer': ['Ctrl+Alt+N'],
};

/**
 * The action a two-key capture is recorded for (046 FR-092, bug B1): `editor.toggleWordWrap` is
 * EDITOR_ONLY, so a two-key chord is legal on it. A command live in a terminal (every
 * `view.toggle…`) refuses one. The c7e5fd84 repro and the two-key captures below were re-pinned
 * onto it from `view.toggleExplorer` — the maintainer confirmed the capture TIMING, not the action.
 */
const WRAP = 'editor.toggleWordWrap';

function openCapture(action = 'view.toggleExplorer') {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    createElement(CaptureModal, {
      action: action as never,
      label: 'Toggle File Explorer',
      bindings: BINDINGS,
      onApply,
      onClose,
    }),
  );
  return { onApply, onClose };
}

/**
 * Press a chord the way the modal hears one: keydown then keyup on `window`.
 *
 * This is the same helper the E2E had, minus the `page.evaluate` round trip — which is the whole
 * migration in one line.
 *
 * Wrapped in `act` because the modal listens on `window` rather than on a React element, so the
 * state it sets lands outside React's batching and the re-render has not flushed by the time an
 * assertion runs. Without it the two tests that assert RENDERED feedback — the error and the
 * conflict — fail while the three that only assert `onApply` pass, because a mock records its call
 * whether or not anything re-rendered. That split is worth knowing: it is the shape of every
 * "passes locally, fails in CI" timing complaint at this layer.
 */
function press(key: string, mods: Partial<KeyboardEventInit> = {}): void {
  const init = { key, bubbles: true, ...mods } as KeyboardEventInit;
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
    releaseModifiers(init);
  });
}

/**
 * 046 iterate round 5 (FR-124, T207) — the capture records only once EVERY key is up, modifiers
 * included, so a press ends with the modifier keyups a real keyboard sends: each released in turn,
 * its own flag already clear on its keyup, the last one reporting nothing held.
 */
function releaseModifiers(init: KeyboardEventInit): void {
  const held = { ctrlKey: init.ctrlKey ?? false, shiftKey: init.shiftKey ?? false, altKey: init.altKey ?? false, metaKey: init.metaKey ?? false };
  const names: [keyof typeof held, string][] = [['shiftKey', 'Shift'], ['altKey', 'Alt'], ['metaKey', 'Meta'], ['ctrlKey', 'Control']];
  for (const [flag, name] of names) {
    if (!held[flag]) continue;
    held[flag] = false;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, ...held }));
  }
}

describe('capturing a chord', () => {
  it('ADDS the captured chord rather than replacing what is bound', () => {
    // Multiple chords per action (FR-033b). Replacing would silently take away a binding the user
    // never asked to lose, and the E2E caught that by comparing the whole array.
    const { onApply } = openCapture('view.toggleProjects');
    press('k', { ctrlKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleProjects': ['Ctrl+Alt+B', 'Ctrl+K'] }),
    );
  });

  it('binds a bare single key, no modifier required', () => {
    const { onApply } = openCapture();
    press('F7');
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'F7'] }),
    );
  });

  it('refuses an excluded single key, keeps the modal open, and applies nothing', () => {
    // Space on its own. The modal STAYING OPEN is half the requirement: a dialog that closed on a
    // refusal would look like it had accepted.
    const { onApply } = openCapture();
    press(' ');
    expect(screen.getByTestId('capture-error')).toBeVisible();
    expect(screen.getByTestId('capture-modal')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('surfaces a chord the OS has reserved as unavailable, and applies nothing', () => {
    // Alt+F4. throng never receives it, so binding it would produce a command the user can see in
    // the list and never trigger — worse than refusing, because it looks like it worked.
    const { onApply } = openCapture();
    press('F4', { altKey: true });
    expect(screen.getByTestId('capture-error')).toHaveTextContent(/reserved/i);
    expect(screen.getByTestId('capture-modal')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('ignores a modifier pressed on its own', () => {
    // Holding Ctrl before the real key must not be read as a chord — otherwise every capture would
    // resolve the instant the user reached for a modifier.
    const { onApply } = openCapture();
    press('Control', { ctrlKey: true });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('capture-modal')).toBeVisible();
  });

  it('warns on a chord already bound elsewhere instead of silently stealing it', () => {
    // A REAL clash: Ctrl+Alt+B belongs to view.toggleProjects, and this capture is for a different
    // action. The user is offered the choice; nothing is applied until they take it.
    const { onApply } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });
    expect(screen.getByTestId('capture-conflict')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });
});

/**
 * 046 US3 (T047, FR-026, R2) — capturing the physical digit-row chord `Ctrl+Shift+0`.
 *
 * `fromDomEvent` normalises only the physical backtick today (`chordKey`), so a captured
 * Ctrl+Shift+0 records the PRODUCED character — `Ctrl+Shift+)` on a US layout — rather than the
 * portable `Ctrl+Shift+0` `zoom.reset`'s shipped default actually needs (US3 scenario 3). R2 derives
 * this modal fix as the prerequisite for that scenario to round-trip: a user who captures the chord
 * they see documented must get back the same token that resolves it at runtime.
 */
describe('capturing the physical digit row (046 FR-026)', () => {
  it('records Ctrl+Shift+0 for a physical Digit0 chord, not the produced character', () => {
    const { onApply } = openCapture();
    // US layout: Shift+0 produces ")"; the PHYSICAL key is Digit0 regardless of layout.
    press(')', { code: 'Digit0', ctrlKey: true, shiftKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Shift+0'] }),
    );
  });
});

/**
 * 046 iterate round 1 (T108, FR-104, FR-105) — capturing a TIER-1 chord (`Ctrl+Shift+Alt`) records
 * the PHYSICAL token, the same reasoning as the digit row above, extended: `fromDomEvent` has no
 * tier-1 branch yet, so it currently records whatever the layout PRODUCED (which, fed a non-US
 * `key` with a US `code`, is not `Ctrl+Shift+Alt+F`) — RED until T112 adds it.
 */
describe('capturing a tier-1 chord records the physical token (046 FR-104)', () => {
  it('Ctrl+Shift+Alt+F, from a "Ń" event — physical KeyF held under Ctrl+Shift+Alt', () => {
    // A layout that put a fourth-level character on KeyF would still be pressing the physical F key;
    // "Ń" here stands for "whatever the layout produced", the digit row's own device above.
    const { onApply } = openCapture();
    press('Ń', { code: 'KeyF', ctrlKey: true, shiftKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Shift+Alt+F'] }),
    );
  });

  it('the Polish AltGr+Shift+N event itself records Ctrl+Shift+Alt+N, not "Ń" (R22)', () => {
    // Chromium reports AltGr as ctrlKey+altKey together, so this IS a tier-1 press.
    const { onApply } = openCapture();
    press('Ń', { code: 'KeyN', ctrlKey: true, shiftKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Shift+Alt+N'] }),
    );
  });
});

/**
 * 046 iterate round 1 (T108, FR-105) — the `+`/`-` SAME-BINDING rule at capture time: the main-row
 * key and the keypad key record IDENTICALLY, and no `Numpad…` token is ever recorded for either.
 *
 * 046 iterate round 2 (FR-114) narrowed the THIRD member of that trio. The maintainer's own words,
 * mid-build: "The 'Zoom Reset' key bindings need to use the numpad zero, NOT the 0 key." So a
 * captured `Ctrl+Alt+Numpad0` no longer folds onto the main-row `Ctrl+Alt+0` — it records its own
 * literal `Numpad0` segment, for whichever action is being captured. `+`/`-` are unaffected.
 */
describe('capturing + / - always records the main-row token, never a keypad one (046 FR-105)', () => {
  it('Ctrl+Alt and the keypad + records Ctrl+Alt++, the SAME token the main-row key records', () => {
    const { onApply } = openCapture();
    press('+', { code: 'NumpadAdd', ctrlKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Alt++'] }),
    );
  });

  it('Ctrl+Alt on the = key WITHOUT Shift also records Ctrl+Alt++, the same binding again', () => {
    const { onApply } = openCapture();
    press('=', { code: 'Equal', ctrlKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Alt++'] }),
    );
  });

  it('records a Numpad0 press as its own Numpad0 token, for whichever action is being captured (FR-114)', () => {
    const { onApply } = openCapture();
    press('0', { code: 'Numpad0', ctrlKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+Alt+Numpad0'] }),
    );
  });
});

/**
 * 046 iterate round 2 (FR-114) — the two commands this round retargets record their OWN shipped
 * shape when re-captured: `zoom.reset` at Ctrl+Shift+Alt+Numpad0 (a physical Numpad0 press, with or
 * without NumLock), and `panel.zoomReset` at Ctrl+Alt+Numpad0. Neither ever records the main-row
 * `0`'s token any more, whatever key a NumLock-on/off keypad happens to produce.
 */
describe('re-capturing zoom.reset / panel.zoomReset records the Numpad0 shape (FR-114)', () => {
  it('Ctrl+Shift+Alt+Numpad0 (NumLock on, key "0") is recorded for zoom.reset', () => {
    const { onApply } = openCapture('zoom.reset');
    press('0', { code: 'Numpad0', ctrlKey: true, shiftKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'zoom.reset': ['Ctrl+Shift+Alt+Numpad0'] }));
  });

  it('Ctrl+Shift+Alt+Numpad0 (NumLock off, key "Insert", Shift reported) records the SAME token for zoom.reset', () => {
    const { onApply } = openCapture('zoom.reset');
    press('Insert', { code: 'Numpad0', ctrlKey: true, shiftKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'zoom.reset': ['Ctrl+Shift+Alt+Numpad0'] }));
  });

  it('Ctrl+Alt+Numpad0 is recorded for panel.zoomReset, never Ctrl+Alt+0', () => {
    const { onApply } = openCapture('panel.zoomReset');
    press('0', { code: 'Numpad0', ctrlKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'panel.zoomReset': ['Ctrl+Alt+Numpad0'] }));
  });
});

/**
 * 046 FR-120 (T189) — the MEASURED NumLock-ON sequence (research R22, "T149 follow-up"): with Ctrl,
 * Shift and Alt down, Windows sends a synthesised Shift key-UP, then the keypad key as
 * `{ code Numpad0, key "Insert", shift false }` with NumLock on, then Shift down again. The modal must
 * record what the user pressed, `Ctrl+Shift+Alt+Numpad0`, not the `Ctrl+Alt+Numpad0` the event looks
 * like. `modifierNumLock` is how jsdom's `getModifierState('NumLock')` is set, as a real event's is.
 */
describe('capturing Ctrl+Shift+Alt+Numpad0 with NumLock ON (046 FR-120)', () => {
  const send = (type: 'keydown' | 'keyup', init: KeyboardEventInit): void => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
    });
  };

  it('records Ctrl+Shift+Alt+Numpad0 for zoom.reset from the measured sequence', () => {
    const { onApply } = openCapture('zoom.reset');
    const held = { ctrlKey: true, altKey: true, modifierNumLock: true } as KeyboardEventInit;
    send('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, modifierNumLock: true } as KeyboardEventInit);
    send('keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true, modifierNumLock: true } as KeyboardEventInit);
    send('keydown', { key: 'Alt', code: 'AltLeft', ctrlKey: true, shiftKey: true, altKey: true, modifierNumLock: true } as KeyboardEventInit);
    send('keyup', { key: 'Shift', code: 'ShiftLeft', ...held });
    send('keydown', { key: 'Insert', code: 'Numpad0', ...held });
    send('keyup', { key: 'Insert', code: 'Numpad0', ...held });
    // FR-124 (re-pinned): the press is recorded once every key is up, so the modifiers are released.
    send('keyup', { key: 'Alt', code: 'AltLeft', ctrlKey: true, modifierNumLock: true } as KeyboardEventInit);
    send('keyup', { key: 'Control', code: 'ControlLeft', modifierNumLock: true } as KeyboardEventInit);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'zoom.reset': ['Ctrl+Shift+Alt+Numpad0'] }));
  });

  it('a genuine Ctrl+Alt+Numpad0 with NumLock ON (key "0") is still recorded as Ctrl+Alt+Numpad0', () => {
    const { onApply } = openCapture('panel.zoomReset');
    press('0', { code: 'Numpad0', ctrlKey: true, altKey: true, modifierNumLock: true } as KeyboardEventInit);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'panel.zoomReset': ['Ctrl+Alt+Numpad0'] }));
  });

  it('a genuine Ctrl+Alt+Numpad0 with NumLock OFF (key "Insert") is still recorded as Ctrl+Alt+Numpad0', () => {
    const { onApply } = openCapture('panel.zoomReset');
    press('Insert', { code: 'Numpad0', ctrlKey: true, altKey: true });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'panel.zoomReset': ['Ctrl+Alt+Numpad0'] }));
  });
});

/**
 * 046 iterate round 1 (T108, FR-091, FR-092) — capturing a TWO-STROKE chord.
 *
 * Re-pinned in place for 046 iterate round 5 (FR-124), which supersedes the armed
 * `capture-two-stroke` control and round 4's FR-123 carried-modifier reading: a two-key chord is
 * recorded by holding the modifiers through both keys, is written `Mods+K1,K2`, and nothing is
 * recorded until every key is up. `capture-pending` still shows the chord while it forms.
 */
describe('capturing a TWO-STROKE chord (046 FR-091, FR-092; re-pinned for FR-124)', () => {
  it('a plain capture stays single-stroke — one key under the modifiers', () => {
    const { onApply } = openCapture();
    press('e', { ctrlKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+E'] }),
    );
  });

  const one = (type: 'keydown' | 'keyup', key: string, mods: Partial<KeyboardEventInit> = {}): void => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...mods }));
    });
  };

  it('two keys under the held Ctrl record "Ctrl+E,W", the first shown pending until the release', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    // The modal shows the forming chord while the modifiers are still held.
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E');
    expect(onApply).not.toHaveBeenCalled(); // not yet — Ctrl is still down
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAP]: ['Ctrl+E,W'] }),
    );
  });

  it('Ctrl held from the first stroke through the W records "Ctrl+E,W" (FR-124 over FR-123)', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E');
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAP]: ['Ctrl+E,W'] }),
    );
  });

  it('Ctrl released and pressed again is two presses: the first records "Ctrl+E" on the release (FR-124)', () => {
    const { onApply } = openCapture();
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+E'] }),
    );
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    one('keyup', 'Control');
    const recorded = onApply.mock.calls.map((c) => (c[0] as Record<string, string[]>)['view.toggleExplorer']);
    expect(recorded.flat()).not.toContain('Ctrl+E,W');
  });

  it('there is no two-stroke control to activate (FR-124 removes it)', () => {
    openCapture();
    expect(screen.queryByTestId('capture-two-stroke')).not.toBeInTheDocument();
  });

  it('a first stroke that collides with a whole single-stroke chord warns', () => {
    // Ctrl+Alt+B is view.toggleProjects' whole chord (BINDINGS above) — using it as a FIRST stroke
    // would make the two-stroke binding unreachable, because the single-stroke chord fires first.
    const { onApply } = openCapture(WRAP);
    one('keydown', 'b', { ctrlKey: true, altKey: true });
    one('keyup', 'b', { ctrlKey: true, altKey: true });
    one('keydown', 'x', { ctrlKey: true, altKey: true });
    one('keyup', 'x', { ctrlKey: true, altKey: true });
    one('keyup', 'Alt', { ctrlKey: true });
    one('keyup', 'Control');
    expect(screen.getByTestId('capture-conflict')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });
});

/**
 * Branch-review finding (spec 046, FR-092) — the MISSING direction of the two-stroke first-stroke
 * collision. `editor.toggleWordWrap` ships the real chord `Ctrl+E W`; capturing the PLAIN
 * single-stroke `Ctrl+E` for a different, intersecting-scope command (`editor.save`, live in
 * `editor` via `PANELS`) used to save silently — `Ctrl+E` never equals `Ctrl+E W` under exact
 * comparison, so `findConflict` saw no conflict at all, and the two commands ended up genuinely
 * ambiguous on that key. Real shipped action ids are used (not the hand-rolled `BINDINGS` other
 * tests in this file share) because `CaptureModal` reads scopes from the real `COMMAND_SCOPES`
 * registry, not from a prop.
 */
describe('capturing a single-stroke chord that is ANOTHER chord’s first stroke warns (046, FR-092)', () => {
  function openCaptureForSave() {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      createElement(CaptureModal, {
        action: 'editor.save' as never,
        label: 'Save',
        bindings: { 'editor.save': ['Ctrl+S'], 'editor.toggleWordWrap': ['Ctrl+E,W'] }, // FR-124 form
        onApply,
        onClose,
      }),
    );
    return { onApply, onClose };
  }

  it('warns instead of saving, and offers no Reassign (it would rebind the wrong token)', async () => {
    const { onApply } = openCaptureForSave();
    press('e', { ctrlKey: true });
    expect(screen.getByTestId('capture-conflict')).toBeVisible();
    expect(screen.getByTestId('capture-conflict')).toHaveTextContent('editor.toggleWordWrap');
    expect(screen.queryByTestId('capture-reassign')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});

/**
 * REPRO (maintainer, 046 iterate round 4 feedback, verbatim): "I can't record CTRL+E, CTRL+W as a
 * multi-step chord in the preferences either. It just records CTRL+E. Seems it returns on the first
 * key up, rather than when the control keys are all raised."
 *
 * The two-stroke control is NOT armed here — the maintainer pressed the keys and nothing else. The
 * events arrive one at a time, as a real keyboard sends them. Expected: nothing is recorded until
 * every key, Ctrl included, is released; Ctrl held from E through W records `Ctrl+E W` (FR-123's
 * rule, a modifier held since the first stroke is not part of the second). A plain `Ctrl+S` still
 * records, on Ctrl's release.
 */
describe('REPRO — a capture completes only once every key, Ctrl included, is released', () => {
  const one = (type: 'keydown' | 'keyup', key: string, mods: Partial<KeyboardEventInit> = {}): void => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...mods }));
    });
  };

  it('Ctrl down, E down/up, W down/up, Ctrl up records "Ctrl+E,W" (FR-124) — nothing on E’s keyup', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    expect(onApply, 'recorded on E’s keyup while Ctrl was still held').not.toHaveBeenCalled();
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    expect(onApply, 'recorded before Ctrl was released').not.toHaveBeenCalled();
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAP]: ['Ctrl+E,W'] }),
    );
  });

  it('Ctrl down, S down/up, Ctrl up still records the single stroke "Ctrl+S", on Ctrl’s release', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 's', { ctrlKey: true });
    one('keyup', 's', { ctrlKey: true });
    expect(onApply, 'recorded on S’s keyup while Ctrl was still held').not.toHaveBeenCalled();
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAP]: ['Ctrl+S'] }),
    );
  });
});

/**
 * 046 iterate round 5 (FR-124, T206) — the capture box records the press as the user made it: the
 * modifiers held, one key or two pressed under them. A third key under the same held modifiers is
 * refused inline, and there is no "record a two-stroke chord" control any more — holding the
 * modifiers through two keys IS how a two-key chord is recorded.
 */
describe('FR-124 — at most two keys follow the modifiers, and no two-stroke control', () => {
  const one = (type: 'keydown' | 'keyup', key: string, mods: Partial<KeyboardEventInit> = {}): void => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...mods }));
    });
  };

  // Re-pinned in place for FR-126 (iterate round 6): three keys may follow the modifiers, so the
  // refusal moves to the FOURTH key — and the box is no longer stuck by it: the refused key is
  // dropped, and releasing every key records the chord as it stood, the notice clearing.
  it('a fourth key under the held modifiers is refused inline: "Only three keys can follow the modifiers." (FR-126)', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    for (const k of ['e', 'w', 'q', 'x']) {
      one('keydown', k, { ctrlKey: true });
      one('keyup', k, { ctrlKey: true });
    }
    expect(screen.getByTestId('capture-error')).toHaveTextContent('Only three keys can follow the modifiers.');
    expect(onApply, 'nothing is recorded while Ctrl is still held').not.toHaveBeenCalled();
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ [WRAP]: ['Ctrl+E,W,Q'] }));
  });

  it('Ctrl held through E, W and Q, then released, records "Ctrl+E,W,Q" (FR-126, SC-021)', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    for (const k of ['e', 'w', 'q']) {
      one('keydown', k, { ctrlKey: true });
      one('keyup', k, { ctrlKey: true });
    }
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E,W,Q');
    expect(onApply).not.toHaveBeenCalled();
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ [WRAP]: ['Ctrl+E,W,Q'] }));
  });

  it('the refusal notice clears once the chord is recorded — the box is not stuck (FR-126)', () => {
    // The parent closes the box on apply; mounted here without one, the notice must still be gone.
    openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    for (const k of ['e', 'w', 'q', 'x']) {
      one('keydown', k, { ctrlKey: true });
      one('keyup', k, { ctrlKey: true });
    }
    expect(screen.getByTestId('capture-error')).toBeVisible();
    one('keyup', 'Control');
    expect(screen.queryByTestId('capture-error')).not.toBeInTheDocument();
  });

  it('a later key without a first-key modifier is refused and dropped; the release records the chord as it stood (FR-126)', () => {
    // Ctrl+Shift held for E; Shift let go; W pressed under Ctrl alone — not part of this chord.
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'Shift', { ctrlKey: true, shiftKey: true });
    one('keydown', 'E', { ctrlKey: true, shiftKey: true });
    one('keyup', 'E', { ctrlKey: true, shiftKey: true });
    one('keyup', 'Shift', { ctrlKey: true });
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    expect(screen.getByTestId('capture-error')).toBeVisible();
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ [WRAP]: ['Ctrl+Shift+E'] }));
  });

  it('a two-key chord for a command live in a terminal is refused inline, and nothing is saved (FR-092, B1)', () => {
    // view.toggleExplorer is scoped EVERYWHERE, terminal included: a shell would swallow the prefix,
    // and `parseKeybindings` drops such a token on load — so the capture box must refuse it.
    const { onApply } = openCapture('view.toggleExplorer');
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    one('keydown', 'w', { ctrlKey: true });
    one('keyup', 'w', { ctrlKey: true });
    one('keyup', 'Control');
    expect(screen.getByTestId('capture-error')).toHaveTextContent(/terminal/i);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('capture-modal')).toBeVisible();
  });

  it('renders no capture-two-stroke control', () => {
    openCapture();
    expect(screen.queryByTestId('capture-two-stroke')).not.toBeInTheDocument();
  });

  it('a modifier added for the second key is part of it: Ctrl, E, then Shift+W records "Ctrl+E,Shift+W"', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    one('keydown', 'Shift', { ctrlKey: true, shiftKey: true });
    one('keydown', 'W', { ctrlKey: true, shiftKey: true });
    one('keyup', 'W', { ctrlKey: true, shiftKey: true });
    one('keyup', 'Shift', { ctrlKey: true });
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAP]: ['Ctrl+E,Shift+W'] }),
    );
  });

  it('the live chord shows the comma form while the modifiers are still held', () => {
    openCapture();
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    one('keydown', 'w', { ctrlKey: true });
    expect(screen.getByTestId('capture-live')).toHaveTextContent('Ctrl+E,W');
  });
});

/**
 * Fix round for c0d85941 (review findings CRITICAL 2/3, IMPORTANT 4/5, MINOR 6).
 *
 * Re-pinned in place for 046 iterate round 5 (FR-124): there is no armed control, so each finding
 * is now driven by the press itself — two keys under the modifiers — and recorded on the release.
 */
describe('two-stroke capture — fix round (review findings on c0d85941; re-pinned for FR-124)', () => {
  const one = (type: 'keydown' | 'keyup', key: string, mods: Partial<KeyboardEventInit> = {}): void => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...mods }));
    });
  };

  // CRITICAL 2: a bare (modifier-less) first stroke must never be saved as a two-key chord —
  // otherwise it hijacks every plain press of that key.
  it('CRITICAL 2 — two keys with no modifier held are refused, never saved (FR-092)', () => {
    const { onApply } = openCapture();
    one('keydown', 'e');
    one('keydown', 'w');
    one('keyup', 'w');
    one('keyup', 'e');
    expect(screen.getByTestId('capture-error')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  // CRITICAL 3: a first-stroke collision must never offer Reassign — Reassign would move only the
  // exact token it matches, and the other action's whole chord would still fire first.
  it('CRITICAL 3 — a first-stroke collision offers no Reassign (would bind the wrong token)', () => {
    const { onApply } = openCapture(WRAP);
    one('keydown', 'b', { ctrlKey: true, altKey: true }); // view.toggleProjects' whole chord
    one('keyup', 'b', { ctrlKey: true, altKey: true });
    one('keydown', 'x', { ctrlKey: true, altKey: true });
    one('keyup', 'x', { ctrlKey: true, altKey: true });
    one('keyup', 'Alt', { ctrlKey: true });
    one('keyup', 'Control');
    expect(screen.getByTestId('capture-conflict')).toBeVisible();
    expect(screen.queryByTestId('capture-reassign')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  // IMPORTANT 5: the modal's buttons stay pointer-only — FR-124 removes the two-stroke control, and
  // Cancel is the plain button it always was.
  it('IMPORTANT 5 — no two-stroke control remains; Cancel is a plain button', () => {
    openCapture();
    expect(screen.queryByTestId('capture-two-stroke')).not.toBeInTheDocument();
    expect(screen.getByTestId('capture-close').tagName).toBe('BUTTON');
  });

  // IMPORTANT 4: bare Escape closes the box and records nothing — including after a press that is
  // still forming has been let go.
  it('IMPORTANT 4 — bare Escape closes the modal and records nothing', () => {
    const { onApply, onClose } = openCapture();
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E');
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    one('keyup', 'e', { ctrlKey: true });
    one('keyup', 'Control');
    expect(onApply).not.toHaveBeenCalled();
  });

  // MINOR 6: a lone modifier press after the first key is not a real keystroke — nothing is saved
  // by it, and the pending indicator stays exactly as it was.
  it('MINOR 6 — a lone modifier after the first key changes nothing; pending stays visible', () => {
    const { onApply } = openCapture();
    one('keydown', 'Control', { ctrlKey: true });
    one('keydown', 'e', { ctrlKey: true });
    one('keyup', 'e', { ctrlKey: true });
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E');
    one('keydown', 'Shift', { ctrlKey: true, shiftKey: true });
    one('keyup', 'Shift', { ctrlKey: true });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('capture-pending')).toHaveTextContent('Ctrl+E');
    one('keyup', 'Control');
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'Ctrl+E'] }),
    );
  });
});

/**
 * Resolving a conflict (FR-034).
 *
 * NEW COVERAGE, not a migration. `applyReassign` is proved on its own in
 * `packages/core/tests/unit/chord-capture.test.ts`, and the E2E watched a reassign happen through a
 * real preferences window — but NOTHING at any layer asserted that the Reassign BUTTON calls it, or
 * that Cancel leaves the bindings alone. A conflict dialog whose two buttons were wired the wrong way
 * round would have passed every test in the repo.
 */
describe('resolving a conflict', () => {
  it('Reassign moves the chord off the other action and onto this one', async () => {
    const { onApply } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });

    await userEvent.click(screen.getByTestId('capture-reassign'));

    expect(onApply).toHaveBeenCalledTimes(1);
    const next = onApply.mock.calls[0][0] as Record<string, string[]>;
    // Taken FROM the previous owner…
    expect(next['view.toggleProjects']).not.toContain('Ctrl+Alt+B');
    // …and given to this one, ALONGSIDE what it already had rather than instead of it.
    expect(next['view.toggleExplorer']).toContain('Ctrl+Alt+B');
    expect(next['view.toggleExplorer']).toContain('Ctrl+Alt+N');
  });

  it('Cancel applies nothing at all, leaving both actions as they were', async () => {
    const { onApply, onClose } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });

    await userEvent.click(screen.getByTestId('capture-cancel'));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('names both the chord and the action it would be taken from', () => {
    // "Already bound" is not enough to decide with — the user has to know what they are about to
    // break before they press the button that breaks it.
    openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });
    const conflict = screen.getByTestId('capture-conflict').textContent ?? '';
    expect(conflict).toContain('Ctrl+Alt+B');
    expect(conflict).toContain('view.toggleProjects');
  });
});

/**
 * 046 iterate round 1 (T108, controller addition — analyze M6 found no owner) — the Key Bindings
 * ROW renders a two-stroke binding and a tier-1 binding in their DISPLAY FORM: `Ctrl+E W` and
 * `Ctrl+Shift+Alt++`, never `Numpad…` or `Plus` (FR-091, FR-105's display clause).
 *
 * `keybindings-tab.tsx`'s pill renders the STORED token verbatim
 * (`<span className="kb-pill__chord">{c}</span>`, no formatting function in between — R22's own
 * reading: "a token is displayed as written… tokens are already the display form"). So this is a
 * claim about what gets STORED reaching the row unmangled, checked with REAL shipped rows rather
 * than an invented one — `editor.toggleWordWrap` (`Ctrl+E W`, FR-091) and `zoom.in`
 * (`Ctrl+Shift+Alt++`, FR-102) already carry these exact values in `keybindings.ts` (T099), so this
 * is a CHARACTERISATION guard against a future "helpful" reformatting between the store and the
 * pill, not a gap in today's rendering — unlike the rest of this round, nothing here waits on
 * T111/T112 to turn green. No `ConfigProvider` is mounted: `useKeybindings()`'s context defaults to
 * `DEFAULT_KEYBINDINGS`, the real shipped bindings, the same arrangement
 * `keybindings-tab-subgroups.test.ts` relies on.
 */
describe('the Key Bindings row shows two-stroke and tier-1 tokens in their display form (T108)', () => {
  function mountTab(): void {
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(
          ResetNoticeProvider,
          null,
          createElement(ContextMenuProvider, null, createElement(KeybindingsTab, {})),
        ),
      ),
    );
  }

  it('editor.toggleWordWrap’s two-stroke chord shows as "Ctrl+E,W", the comma form (re-pinned for FR-124)', () => {
    mountTab();
    expect(screen.getByTestId('binding-editor.toggleWordWrap-pill-0')).toHaveTextContent('Ctrl+E,W');
  });

  it('zoom.in’s tier-1 chord on the + key shows as "Ctrl+Shift+Alt++", never Numpad… or Plus', () => {
    mountTab();
    const pill = screen.getByTestId('binding-zoom.in-pill-0');
    expect(pill).toHaveTextContent('Ctrl+Shift+Alt++');
    expect(pill.textContent).not.toMatch(/Numpad|Plus/);
  });
});
