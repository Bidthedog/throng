import { describe, expect, it } from 'vitest';
import {
  createKittyKeyboardState,
  kittyKeyboardActive,
  win32InputActive,
  applyDecPrivateMode,
  kittyPush,
  kittyPop,
  kittySet,
  kittyQueryReply,
  encodeEnterKey,
  applyKittyCsi,
} from '../../src/terminal/kitty-keyboard.js';

/**
 * #90 — Shift+Enter fidelity via the kitty keyboard protocol.
 *
 * A terminal must transmit a DISTINCT sequence for Shift+Enter so a program (Claude Code,
 * many REPLs) can treat it as a soft newline — but ONLY once that program has enabled an
 * enhanced keyboard protocol. Emitting a CSI-u sequence at a plain shell prompt that never
 * negotiated it prints literal garbage, so the encoding is GATED on the protocol being
 * active. These tests pin both halves: the negotiation state machine, and the gated encoding.
 */

const enter = (mods: Partial<{ shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }> = {}) => ({
  key: 'Enter',
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
  ...mods,
});

describe('#90 kitty keyboard — negotiation state', () => {
  it('starts inactive with no flags', () => {
    const s = createKittyKeyboardState();
    expect(s.flags).toBe(0);
    expect(kittyKeyboardActive(s)).toBe(false);
  });

  it('a push of the disambiguate flag turns the protocol on', () => {
    const s = kittyPush(createKittyKeyboardState(), 1);
    expect(kittyKeyboardActive(s)).toBe(true);
  });

  it('pop restores the flags the app pushed over — protocol goes back off', () => {
    let s = createKittyKeyboardState();
    s = kittyPush(s, 1);
    s = kittyPop(s, 1);
    expect(kittyKeyboardActive(s)).toBe(false);
  });

  it('popping more than was pushed resets to no enhancement, never underflows', () => {
    let s = kittyPush(createKittyKeyboardState(), 1);
    s = kittyPop(s, 5);
    expect(s.flags).toBe(0);
    expect(s.stack).toEqual([]);
  });

  it('set mode 1 replaces the flags, mode 2 ORs bits in, mode 3 clears bits', () => {
    let s = kittySet(createKittyKeyboardState(), 0b0001, 1); // replace → 1
    expect(s.flags).toBe(0b0001);
    s = kittySet(s, 0b0100, 2); // OR in bit 2 → 0b0101
    expect(s.flags).toBe(0b0101);
    s = kittySet(s, 0b0001, 3); // clear bit 0 → 0b0100
    expect(s.flags).toBe(0b0100);
  });

  it('the query reply reports the current flags in CSI ? <flags> u form', () => {
    let s = createKittyKeyboardState();
    expect(kittyQueryReply(s)).toBe('\x1b[?0u');
    s = kittyPush(s, 1);
    expect(kittyQueryReply(s)).toBe('\x1b[?1u');
  });
});

describe('#90 kitty keyboard — CSI-u negotiation dispatch (the wire contract)', () => {
  it('CSI > 1 u (push) enables the protocol; CSI < 1 u (pop) disables it', () => {
    let r = applyKittyCsi(createKittyKeyboardState(), '>', [1]);
    expect(kittyKeyboardActive(r.state)).toBe(true);
    expect(r.reply).toBeUndefined();
    r = applyKittyCsi(r.state, '<', [1]);
    expect(kittyKeyboardActive(r.state)).toBe(false);
  });

  it('CSI = flags ; mode u sets the flags (mode 2 ORs bits in)', () => {
    let r = applyKittyCsi(createKittyKeyboardState(), '=', [1, 1]);
    expect(r.state.flags).toBe(0b0001);
    r = applyKittyCsi(r.state, '=', [0b0100, 2]);
    expect(r.state.flags).toBe(0b0101);
  });

  it('CSI ? u answers with the current flags and leaves state untouched', () => {
    const off = applyKittyCsi(createKittyKeyboardState(), '?', []);
    expect(off.reply).toBe('\x1b[?0u');
    expect(off.state.flags).toBe(0);
    const on = applyKittyCsi(kittyPush(createKittyKeyboardState(), 1), '?', []);
    expect(on.reply).toBe('\x1b[?1u');
  });

  it('a pop with no count defaults to one entry', () => {
    const s = kittyPush(kittyPush(createKittyKeyboardState(), 1), 1);
    const r = applyKittyCsi(s, '<', []);
    expect(r.state.stack.length).toBe(1); // popped exactly one
  });
});

describe('#90 Enter encoding — kitty when negotiated, line feed otherwise', () => {
  it('a modified Enter with NO protocol sends a line feed (\\n) — a newline for LF-newline programs', () => {
    const s = createKittyKeyboardState();
    expect(encodeEnterKey(enter({ shift: true }), s)).toBe('\n'); // Shift+Enter
    expect(encodeEnterKey(enter({ ctrl: true }), s)).toBe('\n'); // Ctrl+Enter — the reported case
  });

  it('Shift+Enter becomes CSI-u \\x1b[13;2u once the kitty protocol is enabled', () => {
    const s = kittyPush(createKittyKeyboardState(), 1);
    expect(encodeEnterKey(enter({ shift: true }), s)).toBe('\x1b[13;2u');
  });

  it('plain (unmodified) Enter is left to xterm (bare \\r → submit), protocol on or off', () => {
    expect(encodeEnterKey(enter(), createKittyKeyboardState())).toBeNull();
    expect(encodeEnterKey(enter(), kittyPush(createKittyKeyboardState(), 1))).toBeNull();
  });

  it('Ctrl+Enter and Shift+Alt+Enter carry the right kitty modifier code when enabled', () => {
    const s = kittyPush(createKittyKeyboardState(), 1);
    expect(encodeEnterKey(enter({ ctrl: true }), s)).toBe('\x1b[13;5u'); // ctrl(4)+1
    expect(encodeEnterKey(enter({ shift: true, alt: true }), s)).toBe('\x1b[13;4u'); // shift(1)+alt(2)+1
  });

  it('non-Enter keys are never touched — xterm encodes them as usual', () => {
    const off = createKittyKeyboardState();
    const on = kittyPush(createKittyKeyboardState(), 1);
    expect(encodeEnterKey({ key: 'a', shift: true, alt: false, ctrl: false, meta: false }, off)).toBeNull();
    expect(encodeEnterKey({ key: 'a', shift: true, alt: false, ctrl: false, meta: false }, on)).toBeNull();
  });
});

describe('#90 win32-input-mode — DEC private mode 9001 tracking', () => {
  it('starts inactive', () => {
    expect(win32InputActive(createKittyKeyboardState())).toBe(false);
  });

  it('CSI ? 9001 h enables it, CSI ? 9001 l disables it', () => {
    let s = applyDecPrivateMode(createKittyKeyboardState(), [9001], true);
    expect(win32InputActive(s)).toBe(true);
    s = applyDecPrivateMode(s, [9001], false);
    expect(win32InputActive(s)).toBe(false);
  });

  it('other private modes (cursor, alt-screen, bracketed paste) never touch win32-input', () => {
    const s = applyDecPrivateMode(createKittyKeyboardState(), [25, 1049, 2004], true);
    expect(win32InputActive(s)).toBe(false);
  });

  it('win32-input survives a kitty push/pop (independent negotiations)', () => {
    let s = applyDecPrivateMode(createKittyKeyboardState(), [9001], true);
    s = kittyPush(s, 1);
    expect(win32InputActive(s)).toBe(true); // still on under a kitty push
    s = kittyPop(s, 1);
    expect(win32InputActive(s)).toBe(true); // and after the pop
  });
});

describe('#90 Enter encoding — win32-input key event when PowerShell/cmd are reading', () => {
  const on = () => applyDecPrivateMode(createKittyKeyboardState(), [9001], true);
  // Enter as a win32-input key event pair (down then up); SHIFT_PRESSED (0x10) is always set so the
  // chord lands on a PSReadLine binding that breaks the line and advances the cursor (Shift+Enter =>
  // AddLine, Shift+Ctrl+Enter => InsertLineBelow) rather than Ctrl+Enter's InsertLineAbove, which
  // would open a line above the one being typed. The user's real Ctrl/Alt bits ride on top.
  const win32 = (cs: number) => `\x1b[13;28;13;1;${cs};1_\x1b[13;28;13;0;${cs};1_`;

  it('Shift+Enter → a Shift-only win32 key event (Cs = SHIFT_PRESSED)', () => {
    expect(encodeEnterKey(enter({ shift: true }), on())).toBe(win32(0x10));
  });

  it('Ctrl+Enter → SHIFT forced on top of LEFT_CTRL (so PSReadLine still inserts a newline)', () => {
    expect(encodeEnterKey(enter({ ctrl: true }), on())).toBe(win32(0x10 | 0x08));
  });

  it('Alt+Enter → SHIFT forced on top of LEFT_ALT', () => {
    expect(encodeEnterKey(enter({ alt: true }), on())).toBe(win32(0x10 | 0x02));
  });

  it('plain Enter is still left to xterm even while win32-input is active (bare \\r → submit)', () => {
    expect(encodeEnterKey(enter(), on())).toBeNull();
  });

  it('kitty wins when BOTH are active — a program that negotiated kitty gets CSI-u', () => {
    const both = kittyPush(on(), 1);
    expect(win32InputActive(both)).toBe(true);
    expect(encodeEnterKey(enter({ shift: true }), both)).toBe('\x1b[13;2u');
  });
});
