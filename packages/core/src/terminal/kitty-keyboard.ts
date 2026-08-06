/**
 * Terminal keyboard negotiation — the pure state + encoding behind #90 (Shift+Enter fidelity).
 *
 * A throng terminal is a faithful emulator: a modifier+key should reach the running program
 * exactly as a native terminal would send it. By default xterm.js transmits `\r` for BOTH
 * Enter and Shift+Enter, so a program that treats a modified Enter as a soft line break can
 * never tell the two keystrokes apart — they arrive as identical bytes. What byte(s) a modified
 * Enter SHOULD become depends on how the program on the other end reads input, so this module
 * tracks two independent negotiations and picks the right encoding for each:
 *
 *   1. **Kitty keyboard protocol** (Claude Code, some REPLs). A modified Enter is reported in
 *      the CSI-u form (`\x1b[13;2u`), which such programs recognise. This is a state machine and
 *      not a constant because the enhanced encoding is emitted ONLY after the program enables the
 *      protocol — a plain prompt never does, and blasting `\x1b[13;2u` at one prints literal
 *      `[13;2u` garbage. So, as a native terminal does, we negotiate:
 *        - the program queries support with `CSI ? u`; the terminal replies `CSI ? <flags> u`;
 *        - it enables/pushes flags with `CSI = <flags> ; <mode> u` or `CSI > <flags> u`;
 *        - it restores them on exit with `CSI < <n> u`.
 *      Only while the disambiguate flag (bit 0) is set does a modified Enter encode to CSI-u.
 *
 *   2. **win32-input-mode** (DEC private mode 9001 — PowerShell/PSReadLine, cmd). These read
 *      console KEY events, not raw bytes, and enable this mode (`CSI ? 9001 h`) while editing a
 *      line. For them a bare LF misfires: PSReadLine inserts the newline but leaves the cursor on
 *      the first line (#90 follow-up). Reported instead as a win32-input key event, a modified
 *      Enter reaches PSReadLine's real binding for that chord — a clean soft line break with the
 *      cursor advancing. Note this only works where the console host asks for the mode; where it
 *      does not (older hosts — observed on Windows build 20348), we fall back to the LF below and
 *      the cursor stays put.
 *
 * When NEITHER is active — an ordinary raw-stdin prompt (python/node REPL) — a modified Enter
 * falls back to a line feed (`\n`), the same byte Ctrl+J sends, so a program that newlines on
 * Ctrl+J newlines here too instead of submitting. Plain (unmodified) Enter is never touched.
 *
 * This is the scoped step the issue sanctions — done through the key-encoding seam, so a fuller
 * protocol can grow from it later (or be replaced by xterm.js's own native support, added in
 * 6.1.0-beta.196+).
 *
 * Spec: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * win32-input-mode: https://learn.microsoft.com/windows/console/console-virtual-terminal-sequences#win32-input-mode
 */

/** Bit 0 of the kitty flags: "disambiguate escape codes" — the presence of this bit is what
 *  marks the protocol as active for modified-key reporting. */
export const KITTY_DISAMBIGUATE = 0b1;

/**
 * Bit 3 of the kitty flags: "report all keys as escape codes".
 *
 * This is the flag that decides how a key WITH a legacy encoding is reported. Under
 * {@link KITTY_DISAMBIGUATE} alone, the spec keeps the legacy form — so `Ctrl+Backspace` stays the
 * bare `^H` that is indistinguishable from `Ctrl+H`, which is exactly what a user sees as "it just
 * deletes one character". Only a program that sets THIS flag has asked for the CSI-u report.
 *
 * throng does not advertise it yet, so nothing sets it and the branch below is inert. It is named
 * and honoured rather than assumed, because an earlier revision sent CSI-u for Backspace to a
 * program that had only asked to disambiguate — a report it never agreed to receive, and duly
 * ignored.
 */
export const KITTY_REPORT_ALL_KEYS = 0b1000;

/** Has the program asked for keys with legacy encodings to be reported as escape codes? */
export function kittyReportsAllKeys(state: KittyKeyboardState): boolean {
  return (state.flags & KITTY_REPORT_ALL_KEYS) !== 0;
}

/** Kitty modifier bits (the terminal-side encoding adds 1 to the bitmask). */
const MOD_SHIFT = 0b0001;
const MOD_ALT = 0b0010;
const MOD_CTRL = 0b0100;
const MOD_SUPER = 0b1000;

/** The Enter key's kitty/CSI-u code point (carriage return, 0x0d). */
const ENTER_CODE = 13;


/**
 * What Ctrl+Backspace sends to a program that is reading input itself: `^W` (0x17), the classic
 * word-erase — WERASE in a POSIX line discipline, `backward-kill-word` in readline, and what Claude
 * Code was measured acting on. It is the only candidate that deletes a word in a Claude session
 * hosted by PowerShell, where `^H`, a win32 key record and ESC DEL all fail differently.
 */
const BACKSPACE_KILL_WORD = '\x17';

/**
 * What a terminal sends for Ctrl+Backspace: `^H`, the byte Windows Terminal was measured sending.
 * Plain Backspace stays 0x7f (DEL), which is what makes the two chords distinguishable at all.
 */
const BACKSPACE_CTRL = '';

/** DEC private mode number for win32-input-mode (`CSI ? 9001 h` / `l`). */
export const WIN32_INPUT_MODE = 9001;

/**
 * DEC private mode 2004 — bracketed paste.
 *
 * Tracked here not for pasting, but as the one reliable answer to "is an APPLICATION reading input,
 * or is the shell editing its own command line?". win32-input-mode cannot answer it: the shell turns
 * 9001 on to read its prompt and leaves it on for whatever runs next, so it stays true underneath a
 * program that never asked for it. Bracketed paste is turned on by the application itself as it
 * starts (Claude Code does; a bare PowerShell or cmd prompt does not), which makes it a statement
 * about who is reading right now.
 *
 * Measured, both in one user's terminal and here: at the prompt the mode log is `9001, 1004`; the
 * moment `claude` starts it becomes `2004, 1004, 2031`.
 */
export const BRACKETED_PASTE_MODE = 2004;

/**
 * Progressive-enhancement state for one terminal. `flags` is the live kitty flag set; `stack`
 * holds the flag sets the program pushed over (restored by pop), newest last; `win32Input`
 * mirrors DEC private mode 9001 — set true while a console app (PowerShell/cmd) has asked for
 * win32-input key events.
 */
export interface KittyKeyboardState {
  readonly flags: number;
  readonly stack: readonly number[];
  readonly win32Input: boolean;
  /** Mirrors DEC private mode 2004 — see {@link BRACKETED_PASTE_MODE} for why it is tracked. */
  readonly bracketedPaste: boolean;
}

/** A keystroke reduced to the fields that decide its encoding (a DOM-event-shaped subset). */
export interface KeyChord {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export function createKittyKeyboardState(): KittyKeyboardState {
  return { flags: 0, stack: [], win32Input: false, bracketedPaste: false };
}

/** Is enhanced modified-key reporting active? (the disambiguate bit is set) */
export function kittyKeyboardActive(state: KittyKeyboardState): boolean {
  return (state.flags & KITTY_DISAMBIGUATE) !== 0;
}

/** Is win32-input-mode active? (a console app has asked for win32-input key events) */
export function win32InputActive(state: KittyKeyboardState): boolean {
  return state.win32Input;
}

/**
 * Is an APPLICATION reading input, rather than the shell editing its own command line?
 *
 * See {@link BRACKETED_PASTE_MODE}: the application turns this on as it starts, so unlike
 * win32-input-mode it is not left over from whoever ran before.
 */
export function applicationReadingInput(state: KittyKeyboardState): boolean {
  return state.bracketedPaste;
}

/**
 * Apply a DEC private-mode set/reset (`CSI ? <modes> h|l`). We track win32-input-mode (9001) and
 * bracketed paste (2004); every other mode is xterm's to handle, so this is a no-op for them.
 * `enable` is true for the `h` (set) form, false for `l` (reset).
 */
export function applyDecPrivateMode(
  state: KittyKeyboardState,
  modes: readonly number[],
  enable: boolean,
): KittyKeyboardState {
  let next = state;
  if (modes.includes(WIN32_INPUT_MODE) && state.win32Input !== enable) {
    next = { ...next, win32Input: enable };
  }
  if (modes.includes(BRACKETED_PASTE_MODE) && state.bracketedPaste !== enable) {
    next = { ...next, bracketedPaste: enable };
  }
  return next;
}

/**
 * `CSI = <flags> ; <mode> u` — set the current flags. mode 1 replaces all (default), 2 ORs the
 * given bits in, 3 clears the given bits. Does not touch the stack.
 */
export function kittySet(state: KittyKeyboardState, flags: number, mode = 1): KittyKeyboardState {
  const next =
    mode === 2 ? state.flags | flags : mode === 3 ? state.flags & ~flags : flags & 0xff;
  return { ...state, flags: next };
}

/** `CSI > <flags> u` — push the current flags and make `flags` current. */
export function kittyPush(state: KittyKeyboardState, flags: number): KittyKeyboardState {
  return { ...state, flags: flags & 0xff, stack: [...state.stack, state.flags] };
}

/** `CSI < <n> u` — pop `n` entries, restoring the flags beneath. Underflow resets to 0. */
export function kittyPop(state: KittyKeyboardState, n = 1): KittyKeyboardState {
  const count = Math.max(1, n);
  if (count >= state.stack.length + 1) return { ...state, flags: 0, stack: [] };
  const stack = state.stack.slice(0, state.stack.length - count);
  const flags = state.stack[state.stack.length - count] ?? 0;
  return { ...state, flags, stack };
}

/** `CSI ? u` query → the reply bytes `CSI ? <flags> u` advertising current support. */
export function kittyQueryReply(state: KittyKeyboardState): string {
  return `\x1b[?${state.flags}u`;
}

/** The private-marker prefix of a kitty CSI-u control sequence. */
export type KittyCsiPrefix = '?' | '=' | '>' | '<';

/** The outcome of applying one negotiation sequence: the next state, and any bytes to send back. */
export interface KittyCsiResult {
  state: KittyKeyboardState;
  /** Bytes to transmit to the program (only the `?` query produces one). */
  reply?: string;
}

/**
 * Apply one kitty CSI-u negotiation sequence to the state — the single contract the terminal
 * wiring dispatches every `CSI <prefix> … u` through:
 *
 *   '?'  query → reply `CSI ? <flags> u`, state unchanged
 *   '='  set   → `CSI = <flags> ; <mode> u`   (params: [flags, mode])
 *   '>'  push  → `CSI > <flags> u`            (params: [flags])
 *   '<'  pop   → `CSI < <n> u`                (params: [n], default 1)
 *
 * `params` are the already-flattened numeric CSI parameters (0 for an omitted one). An
 * unknown prefix is a no-op. Keeping this pure makes the whole negotiation testable without
 * standing up an xterm instance.
 */
export function applyKittyCsi(
  state: KittyKeyboardState,
  prefix: KittyCsiPrefix,
  params: readonly number[],
): KittyCsiResult {
  switch (prefix) {
    case '?':
      return { state, reply: kittyQueryReply(state) };
    case '=':
      return { state: kittySet(state, params[0] ?? 0, params[1] ?? 1) };
    case '>':
      return { state: kittyPush(state, params[0] ?? 0) };
    case '<':
      return { state: kittyPop(state, params[0] || 1) };
    default:
      return { state };
  }
}

/** Kitty modifier code for a chord: 1 + the OR of the held-modifier bits (0 ⇒ unmodified). */
function modifierBitmask(chord: KeyChord): number {
  return (
    (chord.shift ? MOD_SHIFT : 0) |
    (chord.alt ? MOD_ALT : 0) |
    (chord.ctrl ? MOD_CTRL : 0) |
    (chord.meta ? MOD_SUPER : 0)
  );
}

/** The line feed a modified Enter sends when no enhanced protocol is negotiated (see below). */
const LINE_FEED = '\n';

/** VK_RETURN and its scan code, plus the win32 control-key-state bits we encode. */
const VK_RETURN = 13;
const ENTER_SCANCODE = 28;
const WIN32_SHIFT = 0x10; // SHIFT_PRESSED
const WIN32_LCTRL = 0x08; // LEFT_CTRL_PRESSED
const WIN32_LALT = 0x02; // LEFT_ALT_PRESSED

/**
 * A modified Enter as a win32-input-mode key event pair — keydown then keyup — in the form
 * `CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` (virtual-key, scan code, unicode char, key-down flag,
 * control-key state, repeat count).
 *
 * SHIFT_PRESSED is ALWAYS set in the control-key state, and that is load-bearing — PSReadLine's
 * default bindings turn each Enter chord into a DIFFERENT function:
 *
 *     Enter            AcceptLine         (submit)
 *     Shift+Enter      AddLine            (soft line break, cursor advances)
 *     Ctrl+Enter       InsertLineAbove    (opens a line ABOVE — cursor ends up on the wrong one)
 *     Shift+Ctrl+Enter InsertLineBelow    (soft line break, cursor advances)
 *
 * Only the Shift-bearing chords do what a user pressing Ctrl+Enter means, so forcing the bit maps
 * Ctrl+Enter onto InsertLineBelow instead of InsertLineAbove. Drop it and Ctrl+Enter opens a line
 * above the one being typed — which is precisely the reversed-line bug this exists to prevent.
 * The user's real Ctrl/Alt are OR-ed in on top, so a program that reads the whole key event still
 * sees them.
 */
function encodeWin32Enter(chord: KeyChord): string {
  const cs = WIN32_SHIFT | (chord.ctrl ? WIN32_LCTRL : 0) | (chord.alt ? WIN32_LALT : 0);
  const event = (down: 0 | 1): string =>
    `\x1b[${VK_RETURN};${ENTER_SCANCODE};${VK_RETURN};${down};${cs};1_`;
  return event(1) + event(0);
}

/** VK_BACK and its scan code, and the character a real console reports for Ctrl+Backspace. */
const VK_BACK = 8;
const BACKSPACE_SCANCODE = 14;
/**
 * Windows reports Ctrl+Backspace with UnicodeChar 0x7f, not 0x08 — the long-standing console quirk
 * that makes the two chords distinguishable at all. Measured: with 0x7f both PSReadLine and cmd
 * delete the previous word; with 0x08 cmd deletes one character, which is the defect itself.
 */
const BACKSPACE_CTRL_UNICODE = 127;

/**
 * Ctrl+Backspace as a win32-input-mode key event pair, in the same form as {@link encodeWin32Enter}.
 *
 * This exists because a byte cannot carry a modifier. `^H` IS Ctrl+Backspace's legacy byte, but by
 * the time the console has it, the Ctrl is gone — it arrives as an unmodified VK_BACK, which is
 * "delete one character". That is exactly what a user sees, and why the chord works in a real
 * console (which gets key events) and not through a byte.
 */
function encodeWin32Backspace(chord: KeyChord): string {
  const cs = (chord.ctrl ? WIN32_LCTRL : 0) | (chord.alt ? WIN32_LALT : 0);
  const event = (down: 0 | 1): string =>
    `\x1b[${VK_BACK};${BACKSPACE_SCANCODE};${BACKSPACE_CTRL_UNICODE};${down};${cs};1_`;
  return event(1) + event(0);
}

/**
 * The other modified keys throng re-encodes (028 follow-up), beyond Enter.
 *
 * #90 solved this problem for Enter alone. The same problem applies to every modified key: a program
 * that has enabled **win32-input-mode** asked for key EVENTS, and handing it an escape sequence
 * instead means the chord never reaches its binding. Measured in a throng terminal, `Ctrl+Left` and
 * `Ctrl+Backspace` produced identical bytes whether the program had negotiated anything or not —
 * correct for a raw VT reader, useless to PSReadLine, which is exactly the reported symptom
 * ("works in Windows Terminal, not in throng").
 *
 * Deliberately a SMALL set: the keys with a well-known editing meaning that users press by reflex.
 * Every key not listed here keeps xterm's encoding, because xterm's encoding is right for the
 * un-negotiated case and the point is to stop inventing sequences nobody asked for.
 *
 * `unicode` is the character the key produces (0 for keys that produce none) — the `Uc` field of a
 * win32 key record. Backspace's is 8, which is why a bare `^H` is what a legacy terminal sends for
 * it, and why PSReadLine reads that as delete-a-character rather than delete-a-word.
 */
/*
 * Escape is deliberately ABSENT from this table, and from every re-encoding path.
 *
 * The kitty spec says a program that asked to disambiguate escape codes should receive `CSI 27 u`,
 * and throng sent exactly that for a day. Captured from both terminals with the flags pushed as
 * Claude Code pushes them, pressing Escape:
 *
 *   Windows Terminal   1b                 <- the push is ignored outright
 *   throng (then)      1b 5b 32 37 75     <- `CSI 27 u`
 *
 * Windows Terminal does not implement the protocol, and it is the terminal the program works in. So
 * the bare byte xterm already sends is the right answer, and the way to send it is to say nothing.
 */
const WIN32_KEYS: Record<string, { vk: number; scan: number; unicode: number; kitty?: number }> = {
  Backspace: { vk: 8, scan: 14, unicode: 8, kitty: 127 },
  ArrowLeft: { vk: 37, scan: 75, unicode: 0 },
  ArrowUp: { vk: 38, scan: 72, unicode: 0 },
  ArrowRight: { vk: 39, scan: 77, unicode: 0 },
  ArrowDown: { vk: 40, scan: 80, unicode: 0 },
};

/**
 * The bytes to transmit for a modified key other than Enter, or `null` to let xterm encode it.
 *
 * Order matters: kitty is asked first, because a program that negotiated it decides what a chord
 * means and its reporting is the more expressive of the two. Only keys with NO legacy modified form
 * move to CSI-u under kitty — the arrows keep `CSI 1;5D`, which the kitty spec preserves and which
 * already works, so re-encoding them would break something that is not broken.
 */
export function encodeModifiedKey(chord: KeyChord, state: KittyKeyboardState): string | null {
  const spec = WIN32_KEYS[chord.key];
  if (!spec) return null;
  const mods = modifierBitmask(chord);
  if (mods === 0) return null; // unmodified - xterm's encoding is the right one

  /*
   * A program that asked for every key as an escape code gets the CSI-u report. Only that flag
   * earns it: under disambiguate-only the kitty spec PRESERVES the legacy encoding of any key that
   * has one, and sending CSI-u to a program that never agreed to receive it means the key is simply
   * ignored - measured, and worse than the wrong byte.
   */
  if (kittyReportsAllKeys(state)) {
    return spec.kitty === undefined ? null : `[${spec.kitty};${mods + 1}u`;
  }

  /*
   * Ctrl+Backspace has to be said explicitly because xterm.js will not say it: xterm sends 0x7f for
   * Backspace whether or not Ctrl is held, so the two chords arrive IDENTICAL and no program can
   * tell them apart. That is the whole of "Ctrl+Backspace just does a single backspace".
   *
   * WHICH encoding depends on WHO is reading, and getting that wrong is what kept this defect alive
   * through three attempts:
   *
   *   - **an application is reading** (bracketed paste on — Claude Code, editors, REPLs) → `^W`,
   *     the word-erase every raw line editor honours. Measured: in a Claude Code session hosted by
   *     PowerShell, `^W` deletes the word while both `^H` and a win32 key record delete a single
   *     character, and ESC DEL does nothing at all.
   *   - **the shell is editing its own line** with win32-input-mode on → a key EVENT. PSReadLine and
   *     cmd read key records, and a record is the only form that carries the Ctrl: a bare `^H`
   *     arrives as an unmodified VK_BACK, which is "delete one character". `^W` is no use here
   *     either — cmd ignores it completely.
   *   - **nothing negotiated** → `^H` (0x08), what Windows Terminal was measured sending (`[8]` for
   *     Ctrl+Backspace against `[127]` for Backspace) and what a raw VT reader on a clean pty acts
   *     on.
   *
   * The order matters, and it is not the obvious one. win32-input-mode is checked SECOND because it
   * is the shell's, left switched on underneath whatever runs next — asking it first is what sent a
   * key record into Claude Code and produced the single-character delete users kept reporting. The
   * same input can be right for one reader and wrong for another, so the question has to be who is
   * reading, not what the console once asked for.
   */
  if (chord.key === 'Backspace' && chord.ctrl && !chord.alt) {
    if (applicationReadingInput(state)) return BACKSPACE_KILL_WORD;
    return win32InputActive(state) ? encodeWin32Backspace(chord) : BACKSPACE_CTRL;
  }

  /*
   * The arrows keep xterm's own modified encoding (`CSI 1;5D` and friends), which is what Windows
   * Terminal sends too - so there is nothing to correct, and re-encoding them would only risk
   * breaking what already works.
   */
  return null;
}

/**
 * The bytes to transmit for an Enter keystroke, or `null` to let xterm encode it as usual.
 *
 * - **Plain Enter** (no modifier), any non-Enter key, → `null`: xterm sends its usual `\r`, which
 *   every shell and REPL treats as "submit". Unchanged.
 * - **Modified Enter while the kitty protocol is active** → CSI-u `\x1b[13;<1+mods>u`. A program
 *   that negotiated the protocol (e.g. Claude Code) decides what it means.
 * - **Modified Enter while win32-input-mode is active** → a win32-input key event (see
 *   {@link encodeWin32Enter}). PowerShell/PSReadLine and cmd enable this while reading a line; the
 *   key event makes PSReadLine insert a newline AND advance the cursor (a bare LF would leave the
 *   cursor stranded on the first line).
 * - **Modified Enter with NO protocol negotiated** → a line feed (`\n`). This is the ordinary
 *   raw-stdin prompt (python, node and many REPLs), which reads bytes, not key events, and inserts a
 *   newline on Ctrl+J (LF): a modified Enter then does the same, instead of submitting. It is the
 *   same byte Ctrl+J already sends, so it can only ever be as safe as Ctrl+J — a program that
 *   submits on LF keeps submitting.
 *
 * The distinction from a bare `\r` is deliberately NOT gated behind negotiation here (the `\n`
 * branch is the ungated one) — a native terminal's enhanced reporting IS gated, but LF-as-newline is
 * a plain, long-standing keystroke mapping, and gating it would leave the ordinary-shell case (the
 * one that actually bit us) unfixed.
 */
export function encodeEnterKey(chord: KeyChord, state: KittyKeyboardState): string | null {
  if (chord.key !== 'Enter') return null;
  const mods = modifierBitmask(chord);
  if (mods === 0) return null; // plain Enter → xterm's \r → submit
  if (kittyKeyboardActive(state)) return `\x1b[${ENTER_CODE};${mods + 1}u`;
  /*
   * The win32 key record is for a SHELL editing its own line, not for an application that happens
   * to run under a console with the mode still set. The mode is the CONSOLE's and stays on after
   * the shell hands over, so it cannot decide this alone — a program reading raw VT ignores a key
   * record completely, which is how a modified Enter went missing inside one.
   *
   * Bracketed paste says who is actually reading, exactly as it does for Ctrl+Backspace.
   */
  if (win32InputActive(state) && !applicationReadingInput(state)) return encodeWin32Enter(chord);
  return LINE_FEED;
}
