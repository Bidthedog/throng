/**
 * 013 — which keys a terminal takes from the shell.
 *
 * This is the guard on a genuinely dangerous class of bug: reserve too little and find
 * cannot open over a terminal (and its keys leak to the program); reserve too much and the
 * SHELL breaks — Escape never leaves vim's insert mode, Ctrl+H stops being backspace. The
 * rule is that a key with a meaning at the shell may only be taken while there is actually
 * a find session to take it for.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_SCOPES, DEFAULT_KEYBINDINGS, type ActionId, type OsName } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import type { ChordEventLike } from '../../src/renderer/config/chord-key.js';
import { reservedByTerminal, terminalReservesKeydown } from '../../src/renderer/search/search-actions.js';

describe('reservedByTerminal', () => {
  it('always takes the find chord and the scrollback keys', () => {
    for (const open of [true, false]) {
      expect(reservedByTerminal('search.find', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollPageUp', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollPageDown', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollLineUp', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollLineDown', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollToTop', open)).toBe(true);
      expect(reservedByTerminal('terminal.scrollToBottom', open)).toBe(true);
    }
  });

  it('leaves Escape to the program when no find bar is open', () => {
    // The bug this exists to prevent: Escape (search.close) swallowed unconditionally means
    // you cannot leave vim's insert mode, dismiss a menu, or cancel a readline edit.
    expect(reservedByTerminal('search.close', false)).toBe(false);
    expect(reservedByTerminal('search.close', true)).toBe(true);
  });

  it('leaves find-next/previous to the program when no find bar is open', () => {
    expect(reservedByTerminal('search.findNext', false)).toBe(false);
    expect(reservedByTerminal('search.findPrevious', false)).toBe(false);
    expect(reservedByTerminal('search.findNext', true)).toBe(true);
    expect(reservedByTerminal('search.findPrevious', true)).toBe(true);
  });

  it('never takes the replace chords — replace is an editor affordance', () => {
    // Ctrl+H is backspace at a shell; Alt+Enter has its own meanings. A terminal has no
    // replace to offer, so it must never hold on to these.
    for (const open of [true, false]) {
      expect(reservedByTerminal('search.replace', open)).toBe(false);
      expect(reservedByTerminal('search.replaceCurrent', open)).toBe(false);
      expect(reservedByTerminal('search.replaceAll', open)).toBe(false);
    }
  });

  it('ignores keys that are not bound to anything', () => {
    expect(reservedByTerminal(null, true)).toBe(false);
    expect(reservedByTerminal(null, false)).toBe(false);
  });

  it('leaves unrelated actions to their own handlers', () => {
    expect(reservedByTerminal('editor.save', true)).toBe(false);
    expect(reservedByTerminal('focus.cycle', true)).toBe(false);
  });

  it('is NOT a scope table — being live in a terminal does not make a key throng’s (016)', () => {
    // The guard against a tempting refactor. 016's dispatch scope answers "is this command live
    // here?"; this answers "does throng take the key, or does the SHELL?". Every action below is
    // live in a terminal by COMMAND_SCOPES, and every one of them still belongs to the program:
    //
    //   search.replace  → Ctrl+H → BACKSPACE
    //   editor.save     → Ctrl+S → XOFF
    //   search.close    → Escape → vim's insert mode, with no find bar up
    //
    // Replacing this function with `resolveAction(kb, ev, 'terminal') !== null` would swallow all
    // three, and the shell would lose backspace. The default is DENY, and it must stay DENY.
    const liveInATerminalButTheProgram: ActionId[] = [
      'search.replace',
      'search.replaceCurrent',
      'search.replaceAll',
      'editor.save',
      'editor.saveAll',
    ];
    for (const action of liveInATerminalButTheProgram) {
      expect(COMMAND_SCOPES[action]).toContain('terminal'); // …scope says it is live here
      expect(reservedByTerminal(action, true)).toBe(false); // …and the shell keeps the key anyway
    }

    // Escape, specifically: ours only while there is a find session to take it for.
    expect(COMMAND_SCOPES['search.close']).toContain('terminal');
    expect(reservedByTerminal('search.close', false)).toBe(false);
    expect(reservedByTerminal('search.close', true)).toBe(true);
  });
});

/**
 * 070 FR-031a (2026-11-18, maintainer decision) — on macOS, every scroll chord that carries Cmd stays throng's while a
 * program has negotiated the kitty keyboard protocol.
 *
 * xterm.js has no kitty encoder, so a negotiated program is sent the legacy `CSI 1;9H` / `CSI 1;9F` (modifier 9,
 * Meta). bash's readline cannot decode modifier 9 and leaves the final byte on the line: measured against bash 5.3
 * through node-pty, the two chords then `echo RAN_OK` ran as `HFecho` ("command not found"). Every other platform's
 * chords, and the alternate-screen case on macOS, are unchanged.
 */
describe('the Cmd scroll chords under the kitty keyboard protocol (070 FR-031a)', () => {
  const key = (code: string, mods: Partial<ChordEventLike>): ChordEventLike => ({
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });
  const reserves = (os: OsName, e: ChordEventLike, programOwnsKeyboard: boolean, kitty: boolean): boolean =>
    withHostTraits(os, () => terminalReservesKeydown(DEFAULT_KEYBINDINGS, e, false, programOwnsKeyboard, kitty));

  it('keeps Cmd+Home and Cmd+End for throng on macOS while a program has negotiated kitty', () => {
    expect(reserves('macos', key('Home', { metaKey: true }), true, true), 'Cmd+Home reached a kitty program').toBe(true);
    expect(reserves('macos', key('End', { metaKey: true }), true, true), 'Cmd+End reached a kitty program').toBe(true);
  });

  it('still hands them to a program painting the alternate screen without kitty on macOS', () => {
    expect(reserves('macos', key('Home', { metaKey: true }), true, false)).toBe(false);
    expect(reserves('macos', key('End', { metaKey: true }), true, false)).toBe(false);
  });

  it('reserves them as before when no program owns the keyboard on macOS', () => {
    expect(reserves('macos', key('Home', { metaKey: true }), false, false)).toBe(true);
    expect(reserves('macos', key('End', { metaKey: true }), false, false)).toBe(true);
  });

  /*
   * The rule is every scroll chord that carries Cmd, because xterm.js cannot hand Cmd to the program in any form it
   * reads (measured against bash 5.3 through node-pty, each sequence then `echo RAN_OK`): an Arrow with Cmd held is
   * sent as NOTHING (xterm's encoder drops it), Home/End and Ctrl+PageUp/PageDown carry a modifier of 9 or more
   * (`CSI 1;10H`, `CSI 5;13~`), which readline leaves on the line (`0Hecho`, `13~echo`), and PageUp/PageDown without
   * Ctrl lose the Cmd and arrive as a plain PageUp/PageDown.
   */
  it('keeps Shift+Cmd+Up and Shift+Cmd+Down (line scroll) for throng on macOS while a program has negotiated kitty', () => {
    expect(reserves('macos', key('ArrowUp', { metaKey: true, shiftKey: true }), true, true), 'Shift+Cmd+Up').toBe(true);
    expect(reserves('macos', key('ArrowDown', { metaKey: true, shiftKey: true }), true, true), 'Shift+Cmd+Down').toBe(
      true,
    );
  });

  it('keeps a scroll command the user rebound to a Cmd chord on macOS under kitty', () => {
    const rebound = withHostTraits('macos', () => ({
      version: 1,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'terminal.scrollPageUp': ['Meta+PageUp'] },
    }));
    const kept = withHostTraits('macos', () =>
      terminalReservesKeydown(rebound, key('PageUp', { metaKey: true }), false, true, true),
    );
    expect(kept, 'Cmd+PageUp bound to scrollPageUp reached a kitty program').toBe(true);
  });

  it('leaves a scroll chord without Cmd to a kitty program on macOS', () => {
    expect(reserves('macos', key('PageUp', { shiftKey: true }), true, true)).toBe(false);
  });

  it('still hands Shift+Cmd+Up to a program painting the alternate screen without kitty on macOS', () => {
    expect(reserves('macos', key('ArrowUp', { metaKey: true, shiftKey: true }), true, false)).toBe(false);
  });

  it('still hands Ctrl+Home / Ctrl+End to a kitty program on Windows and Linux', () => {
    for (const os of ['windows', 'linux'] as const) {
      expect(reserves(os, key('Home', { ctrlKey: true }), true, true), `${os} Ctrl+Home`).toBe(false);
      expect(reserves(os, key('End', { ctrlKey: true }), true, true), `${os} Ctrl+End`).toBe(false);
    }
  });
});
