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

/** Kitty modifier bits (the terminal-side encoding adds 1 to the bitmask). */
const MOD_SHIFT = 0b0001;
const MOD_ALT = 0b0010;
const MOD_CTRL = 0b0100;
const MOD_SUPER = 0b1000;

/** The Enter key's kitty/CSI-u code point (carriage return, 0x0d). */
const ENTER_CODE = 13;

/** DEC private mode number for win32-input-mode (`CSI ? 9001 h` / `l`). */
export const WIN32_INPUT_MODE = 9001;

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
  return { flags: 0, stack: [], win32Input: false };
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
 * Apply a DEC private-mode set/reset (`CSI ? <modes> h|l`). We only track win32-input-mode
 * (9001); every other mode is xterm's to handle, so this is a no-op for them. `enable` is true
 * for the `h` (set) form, false for `l` (reset).
 */
export function applyDecPrivateMode(
  state: KittyKeyboardState,
  modes: readonly number[],
  enable: boolean,
): KittyKeyboardState {
  if (!modes.includes(WIN32_INPUT_MODE) || state.win32Input === enable) return state;
  return { ...state, win32Input: enable };
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
  if (win32InputActive(state)) return encodeWin32Enter(chord);
  return LINE_FEED;
}
