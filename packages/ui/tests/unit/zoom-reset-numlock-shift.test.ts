/**
 * Bug repro (maintainer, physical keyboard, Windows, 2026-09-25): `zoom.reset` ships
 * `Ctrl+Shift+Alt+Numpad0` (046 FR-113/FR-114), but with NumLock ON pressing it resets the active
 * PANEL's zoom (`panel.zoomReset`, `Ctrl+Alt+Numpad0`) instead of the window's.
 *
 * ══ THE EVENT SHAPES BELOW ARE MEASURED, NOT ASSUMED ══
 *
 * Captured on Windows 11 / Electron 44.4.3 by injecting hardware SCAN CODES with `SendInput`
 * (`KEYEVENTF_SCANCODE`: LCtrl 0x1D, LShift 0x2A, LAlt 0x38, keypad 0 = 0x52 without the extended
 * flag) into a bare Electron window logging every DOM `keydown`/`keyup` and `before-input-event`.
 * With NumLock ON and Shift held, Windows' keyboard layer inverts the keypad to its navigation keys
 * AND synthesises a Shift key-UP before the keypad key (and a Shift key-down after it):
 *
 *   NumLock ON,  Ctrl+Shift+Alt+Numpad0 → keyup Shift, then keydown {code Numpad0, key "Insert", ctrl, alt, shift FALSE}
 *   NumLock ON,  Ctrl+Alt+Numpad0       → keydown {code Numpad0, key "0",      ctrl, alt, shift false}
 *   NumLock OFF, Ctrl+Shift+Alt+Numpad0 → keydown {code Numpad0, key "Insert", ctrl, alt, shift TRUE}
 *   NumLock OFF, Ctrl+Alt+Numpad0       → keydown {code Numpad0, key "Insert", ctrl, alt, shift false}
 *
 * So the NumLock-ON tier-1 press arrives looking like a Ctrl+Alt press, and rule 1b
 * (`sameBindingSymbolOfCode('Numpad0', …)`, unconditional) turns it into `Ctrl+Alt+Numpad0`. The
 * only thing telling it apart from a genuine NumLock-OFF `Ctrl+Alt+Numpad0` is the NumLock state
 * itself (`getModifierState('NumLock')`, measured true/false correctly in both cases).
 *
 * Resolved through the SAME composition the window listener uses (`app.tsx` `KeybindingsHandler`:
 * `resolveKeydown(e, ev => resolveScoped(keybindings, ev, scopeInput()), windowProducedEvent(e))`),
 * against the shipped defaults.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, DEFAULT_KEYBINDINGS } from '@throng/core';
import { resolveKeydown, windowProducedEvent, type ChordEventLike } from '../../src/renderer/config/chord-key.js';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';

/** A measured Windows keydown, carrying the NumLock state a real `KeyboardEvent` reports. */
type MeasuredKeydown = ChordEventLike & { getModifierState(key: string): boolean };

const numpad0 = (key: string, shiftKey: boolean, numLock: boolean): MeasuredKeydown => ({
  code: 'Numpad0',
  key,
  ctrlKey: true,
  altKey: true,
  shiftKey,
  metaKey: false,
  getModifierState: (k: string) => k === 'NumLock' && numLock,
});

const layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });

/** What the window listener resolves the keydown to — `app.tsx`'s own call, verbatim in shape. */
function windowResolves(e: MeasuredKeydown): string | null {
  return resolveKeydown(
    e,
    (ev) =>
      resolveScoped(DEFAULT_KEYBINDINGS, ev, { tabs: layout.tabs, activeTabId: layout.activeTabId }, {
        transientFocus: false,
        overlayOpen: false,
      }),
    windowProducedEvent(e),
  );
}

beforeEach(() => {
  setActivePane('workspace');
});

describe('Ctrl+Shift+Alt+Numpad0 on Windows resets the WINDOW zoom whatever the NumLock state (bug repro)', () => {
  it('NumLock ON: the measured shape (fake Shift-up, key "Insert", shiftKey false) resolves to zoom.reset', () => {
    expect(windowResolves(numpad0('Insert', false, true))).toBe('zoom.reset');
  });

  it('NumLock OFF: the measured shape (key "Insert", shiftKey true) resolves to zoom.reset', () => {
    expect(windowResolves(numpad0('Insert', true, false))).toBe('zoom.reset');
  });
});

describe('a genuine Ctrl+Alt+Numpad0 still resets the PANEL zoom (guards any fix for the case above)', () => {
  it('NumLock ON: key "0", shiftKey false → panel.zoomReset', () => {
    expect(windowResolves(numpad0('0', false, true))).toBe('panel.zoomReset');
  });

  it('NumLock OFF: key "Insert", shiftKey false → panel.zoomReset', () => {
    expect(windowResolves(numpad0('Insert', false, false))).toBe('panel.zoomReset');
  });
});
