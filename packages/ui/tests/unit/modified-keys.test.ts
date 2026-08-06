import { describe, expect, it } from 'vitest';
import {
  createKittyKeyboardState,
  applyDecPrivateMode,
  kittySet,
  KITTY_DISAMBIGUATE,
  KITTY_REPORT_ALL_KEYS,
  encodeModifiedKey,
} from '@throng/core';

const ESC = String.fromCharCode(27);
/** `^H` — written as a code point because a literal control byte in source is invisible. */
const BS = String.fromCharCode(8);
/** Ctrl+Backspace as a win32-input-mode key event pair: VK_BACK, scan 14, char 0x7f, LEFT_CTRL. */
const WIN32_CTRL_BACKSPACE = `${ESC}[8;14;127;1;8;1_${ESC}[8;14;127;0;8;1_`;

/** `^W` — the word-erase an application reading its own input honours. */
const KILL_WORD = String.fromCharCode(23);

const plain = createKittyKeyboardState();
const win32 = applyDecPrivateMode(plain, [9001], true);
/** A program reading input under a shell that left win32-input-mode on — the reported case. */
const appUnderShell = applyDecPrivateMode(win32, [2004], true);
const kitty = kittySet(plain, KITTY_DISAMBIGUATE);
const kittyAll = kittySet(plain, KITTY_DISAMBIGUATE | KITTY_REPORT_ALL_KEYS);

const chord = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
  alt: mods.alt ?? false,
  meta: false,
});

/**
 * 028 follow-up — Ctrl+Backspace and Ctrl+Arrow do nothing in a throng terminal but work in Windows
 * Terminal.
 *
 * Measured first, which is what made the cause obvious: throng sends the SAME bytes whatever the
 * program negotiated. `ESC [ 1 ; 5 D` for Ctrl+Left is exactly right for a program reading VT — and
 * exactly wrong for one that has enabled win32-input-mode, which is what PSReadLine does while
 * editing a line. It asked for key EVENTS and keeps being handed escape sequences, so the chord
 * never reaches its binding.
 *
 * This is the generalisation of #90, which solved the identical problem for Enter alone.
 */
describe('encodeModifiedKey', () => {
  it('leaves an unmodified key to xterm', () => {
    for (const key of ['Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(encodeModifiedKey(chord(key), win32)).toBeNull();
      expect(encodeModifiedKey(chord(key), kitty)).toBeNull();
    }
  });

  it('leaves keys it does not own to xterm', () => {
    expect(encodeModifiedKey(chord('a', { ctrl: true }), win32)).toBeNull();
    expect(encodeModifiedKey(chord('F5', { ctrl: true }), win32)).toBeNull();
    expect(encodeModifiedKey(chord('Home', { ctrl: true }), win32)).toBeNull();
  });

  it('leaves an arrow alone when nothing has been negotiated', () => {
    // xterm's own encoding is correct for a raw VT program, and matches Windows Terminal.
    expect(encodeModifiedKey(chord('ArrowLeft', { ctrl: true }), plain)).toBeNull();
  });

  describe('Ctrl+Backspace', () => {
    it('sends ^H when nothing has been negotiated', () => {
      /*
       * xterm.js sends 0x7f for Backspace whether or not Ctrl is held, so without this the two
       * chords arrive identical and no program can tell them apart - "Ctrl+Backspace just does a
       * single backspace". 0x08 is measured, not chosen: Windows Terminal prints [8] for
       * Ctrl+Backspace and [127] for Backspace, and a raw VT reader on a clean pty acts on it.
       */
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), plain)).toBe(BS);
    });

    it('sends a KEY EVENT once the console has asked for key events', () => {
      /*
       * The defect this fixes: a byte cannot carry a modifier. Under win32-input-mode the console
       * translates input into key records, so `^H` arrives as an UNMODIFIED VK_BACK - delete one
       * character - and the Ctrl the user held is lost on the way. Measured against a real Claude
       * Code session started from a PowerShell prompt, where `^H` removed a single character and the
       * record below removes the word.
       *
       * The mode is normally enabled by the SHELL and left on for whatever runs next, so this branch
       * is live for programs that never asked for it. That is deliberate: the console doing the
       * translating is still the shell's, whoever is reading.
       */
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), win32)).toBe(WIN32_CTRL_BACKSPACE);
    });

    it('sends ^W once an APPLICATION is reading, even under a shell that left 9001 on', () => {
      /*
       * The case users kept reporting, and the one three earlier attempts got wrong. A shell turns
       * win32-input-mode on to read its own prompt and leaves it on for whatever runs next, so the
       * flag says nothing about who is reading now. Send a key record into Claude Code on that
       * evidence and it deletes ONE character; `^W` deletes the word.
       *
       * Bracketed paste is the honest signal: the application turns it on as it starts.
       */
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), appUnderShell)).toBe(KILL_WORD);
    });

    it('sends ^W to an application even with nothing else negotiated', () => {
      const appOnly = applyDecPrivateMode(plain, [2004], true);
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), appOnly)).toBe(KILL_WORD);
    });

    it('goes back to the key record when the application stops reading', () => {
      // The shell gets its prompt back, and with it the encoding that works for a line editor.
      const backToShell = applyDecPrivateMode(appUnderShell, [2004], false);
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), backToShell)).toBe(
        WIN32_CTRL_BACKSPACE,
      );
    });

    it('leaves PLAIN Backspace to xterm, which sends DEL', () => {
      // The distinction only exists while the unmodified key keeps its own encoding.
      expect(encodeModifiedKey(chord('Backspace'), plain)).toBeNull();
      expect(encodeModifiedKey(chord('Backspace'), win32)).toBeNull();
    });

    it('leaves Alt+Backspace alone — a different chord with its own meaning', () => {
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true, alt: true }), plain)).toBeNull();
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true, alt: true }), win32)).toBeNull();
    });
  });

  describe('Escape', () => {
    it('stays the bare byte even once the program asked to disambiguate', () => {
      /*
       * Deliberately NOT the conformant `CSI 27 u`, which throng sent for a day and which fixed
       * nothing. Captured from Windows Terminal with the kitty flags pushed exactly as claude
       * pushes them, Escape still arrives as a bare `1b` — WT does not implement the protocol, and
       * it is the terminal the program demonstrably works in.
       */
      expect(encodeModifiedKey(chord('Escape'), kitty)).toBeNull();
    });

    it('stays the bare byte when nothing has been negotiated', () => {
      // Unnegotiated, 0x1b is correct and universal — xterm already sends it, so throng says nothing.
      expect(encodeModifiedKey(chord('Escape'), plain)).toBeNull();
      expect(encodeModifiedKey(chord('Escape'), win32)).toBeNull();
      expect(encodeModifiedKey(chord('Escape'), appUnderShell)).toBeNull();
    });

    it('leaves a MODIFIED Escape to xterm', () => {
      // Alt+Esc and friends are their own chords with their own meanings; only the bare key is ours.
      expect(encodeModifiedKey(chord('Escape', { ctrl: true }), kitty)).toBeNull();
      expect(encodeModifiedKey(chord('Escape', { alt: true }), kitty)).toBeNull();
    });
  });

  describe('the arrows', () => {
    it('keep xterm’s modified encoding, which already matches Windows Terminal', () => {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        expect(encodeModifiedKey(chord(key, { ctrl: true }), plain)).toBeNull();
        expect(encodeModifiedKey(chord(key, { ctrl: true }), win32)).toBeNull();
      }
    });
  });

  describe('kitty protocol (Claude Code)', () => {
    it('keeps the LEGACY encoding under disambiguate-only, which is what the spec says', () => {
      /*
       * The flag a program sets decides this, and getting it wrong is not harmless: an earlier
       * revision sent CSI-u to a program that had only asked to disambiguate, and the program
       * ignored a report it never agreed to receive — so the chord did nothing at all.
       *
       * "Legacy" here means ^H, emitted deliberately. It cannot be left to xterm, which sends DEL
       * for Backspace with or without Ctrl and so erases the distinction entirely.
       */
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), kitty)).toBe(BS);
    });

    it('reports Ctrl+Backspace in CSI-u form once the program asks for all keys', () => {
      // 127 is the kitty code point for Backspace; 5 = 1 + ctrl(4).
      expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), kittyAll)).toBe(`${ESC}[127;5u`);
    });

    it('leaves the arrows to xterm, whose modified encoding a kitty program already understands', () => {
      // The arrows have a legacy modified form (`CSI 1;5D`) that the kitty spec keeps; only keys
      // WITHOUT one move to CSI-u. Re-encoding them would break what already works.
      expect(encodeModifiedKey(chord('ArrowLeft', { ctrl: true }), kitty)).toBeNull();
    });
  });

  it('prefers kitty over win32 when a program has negotiated both', () => {
    // A program that asked for all keys as escape codes said so itself; the console's key-record
    // request belongs to whatever was reading the line before it.
    const both = applyDecPrivateMode(kittyAll, [9001], true);
    expect(encodeModifiedKey(chord('Backspace', { ctrl: true }), both)).toBe(`${ESC}[127;5u`);
  });
});
