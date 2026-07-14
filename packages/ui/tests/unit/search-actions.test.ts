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
import { COMMAND_SCOPES, type ActionId } from '@throng/core';
import { reservedByTerminal } from '../../src/renderer/search/search-actions.js';

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
