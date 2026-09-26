/**
 * Binding token → the keydown a US keyboard produces for it (046 T044, plan R2).
 *
 * Its own module, apart from `window-chords.ts`, because that file resolves paths from
 * `import.meta.url` at module scope and so cannot be imported under jsdom (whose `import.meta.url`
 * is not a `file:` URL). A component test pressing a chord through the real `KeybindingsHandler`
 * needs this builder and nothing else from there.
 */
import type { ChordEventLike } from '../../src/renderer/config/chord-key.js';

/** The key segment of a binding token — everything after the modifiers. `Ctrl++` → `+`. */
export function keyOf(token: string): string {
  let rest = token;
  for (;;) {
    const mod = /^(Ctrl|Control|Shift|Alt|Meta)\+(?=.)/.exec(rest);
    if (!mod) return rest;
    rest = rest.slice(mod[0].length);
  }
}

/** A US-layout keydown, as a real engine reports it: both the PRODUCED `key` and the PHYSICAL `code`. */
export interface ChordEvent extends ChordEventLike {
  metaKey: boolean;
  /** Present when the builder was told the NumLock state (046 FR-120), as a real event's is. */
  getModifierState?: (key: string) => boolean;
}

/** US layout: what Shift+digit produces. `)` for Shift+0 is the case 046 FR-026 is about. */
const US_SHIFTED_DIGIT = ')!@#$%^&*(';
const US_CODE_OF: Readonly<Record<string, string>> = {
  '`': 'Backquote', '-': 'Minus', '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
  '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
};

/**
 * The keydown a US keyboard produces for a binding token — `key` AND `code`.
 *
 * The window listener no longer reads `e.key` alone: `chordCandidates` tries the physical digit
 * (`e.code === 'Digit0'`) before the produced character, so an event without a `code` would test a
 * listener that no longer exists. `mods` overrides the token's own modifiers, which is how a caller
 * asks "and what if Shift were held too".
 */
export function chordEvent(
  token: string,
  mods: Partial<Pick<ChordEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {},
): ChordEvent {
  const key = keyOf(token);
  const prefix = token.slice(0, token.length - key.length);
  const has = (m: string): boolean => new RegExp(String.raw`(^|\+)${m}\+`).test(prefix);
  const ctrlKey = mods.ctrlKey ?? (has('Ctrl') || has('Control'));
  const altKey = mods.altKey ?? has('Alt');
  const shiftKey = mods.shiftKey ?? has('Shift');
  const metaKey = mods.metaKey ?? has('Meta');
  let code: string;
  let produced = key;
  if (/^[0-9]$/.test(key)) {
    code = `Digit${key}`;
    if (shiftKey) produced = US_SHIFTED_DIGIT[Number(key)] as string;
  } else if (/^[a-z]$/i.test(key)) {
    code = `Key${key.toUpperCase()}`;
    produced = shiftKey ? key.toUpperCase() : key.toLowerCase();
  } else {
    code = US_CODE_OF[key] ?? key; // F-keys, arrows, PageDown… name their own physical key
  }
  return { key: produced, code, ctrlKey, altKey, shiftKey, metaKey };
}

/**
 * The five layouts 046 FR-104 / FR-109 name (research R22): US, UK, German, French (AZERTY) and
 * Polish (programmer's). Only US is a full table — the others hold OVERRIDES for the physical keys
 * this feature's chords actually touch, since a full keyboard-layout database is out of scope
 * (constitution VIII, YAGNI) and every code this suite does not override falls back to the US-produced
 * character, which R22 records as identical across all five for the tier-1 letters (`KeyA`–`KeyZ`
 * bar the AZERTY `M` case below).
 */
export type Layout = 'US' | 'UK' | 'German' | 'French' | 'Polish';

/** What a physical `code` produces on one non-US layout, keyed by the modifier state that selects it. */
interface LayoutChar {
  /** No modifier (or Ctrl/Ctrl+Shift, which read the same character as plain on every key below). */
  plain?: string;
  shift?: string;
  /** AltGr — Chromium on Windows reports this as `ctrlKey && altKey` (research R22). */
  altGr?: string;
  /** AltGr+Shift, the fourth level (Polish programmer's `Ń`, R22). */
  altGrShift?: string;
}

const LAYOUT_OVERRIDES: Readonly<Record<Exclude<Layout, 'US'>, Readonly<Record<string, LayoutChar>>>> = {
  // UK matches US on every code this feature binds; its own divergence (the backtick key producing
  // `¬`/`~` under Shift) is already handled by `chordKey`'s Backquote normalisation, not by this table.
  UK: {},
  German: {
    // No dedicated `+`/`-` keys: `Equal` carries the acute accent, `Minus` carries `ß` (R22).
    Equal: { plain: '´', shift: '`' },
    Minus: { plain: 'ß', shift: '?' },
    // AltGr+0 is `}` on German — R2's reason Alt excludes the digit candidate at all.
    Digit0: { altGr: '}' },
  },
  French: {
    // AZERTY: the key in the US `M` position produces a comma (R22's own example).
    KeyM: { plain: ',', shift: '?' },
    // AltGr+0 (the AZERTY digit row's `à` position) is `@`.
    Digit0: { altGr: '@' },
  },
  Polish: {
    // Polish programmer's: AltGr+Shift+N is `Ń`, the one fourth-level character R22 found on a
    // tier-1 bound letter (B, F, M, N, P, T) across the layouts it checked.
    KeyN: { altGrShift: 'Ń' },
  },
};

/**
 * The keydown a keyboard on `layout` sends for a PHYSICAL `code`, with the given modifiers — the
 * layout table's counterpart to {@link chordEvent}, which is US-only and works from a token rather
 * than a `code`. Falls back to the US-produced character for anything the layout's table does not
 * override.
 *
 * The keypad (046 FR-120, measured on Windows, research R22 "T149 follow-up"). `code` is the physical
 * key whatever NumLock says, which is why the physical rule matches on `code`. What `key` and
 * `shiftKey` report depends on NumLock, and `numLock` selects it:
 *  - `numLock: true` — with Shift held, Windows inverts the pad to its navigation key AND hides the
 *    Shift (`Numpad0` → `key "Insert"`, `shiftKey` FALSE); without Shift, the digit;
 *  - `numLock: false` — the navigation key, with `shiftKey` as held;
 *  - omitted — the NumLock state is not modelled and no `getModifierState` is attached: `key`
 *    follows Shift (`Insert` with it, `0` without), which is the NumLock-OFF shape with Shift and the
 *    NumLock-ON shape without. This used to be described as "Shift held and NumLock on", which is
 *    not a shape a real keyboard sends: with NumLock on, the Shift is not reported.
 */
export function chordEventOnLayout(
  layout: Layout,
  code: string,
  mods: Partial<Pick<ChordEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> & { numLock?: boolean } = {},
): ChordEvent {
  const ctrlKey = mods.ctrlKey ?? false;
  const altKey = mods.altKey ?? false;
  const shiftKey = mods.shiftKey ?? false;
  const metaKey = mods.metaKey ?? false;
  const keypadNav = KEYPAD_NAV_KEY_OF_CODE[code];
  if (mods.numLock !== undefined && keypadNav !== undefined) {
    const numLock = mods.numLock;
    const getModifierState = (k: string): boolean => k === 'NumLock' && numLock;
    if (numLock && shiftKey) {
      // The measured NumLock-ON shape: the navigation key, and the held Shift hidden from the event.
      return { key: keypadNav, code, ctrlKey, altKey, shiftKey: false, metaKey, getModifierState };
    }
    const key = numLock ? (KEYPAD_DIGIT_OF_CODE[code] as string) : keypadNav;
    return { key, code, ctrlKey, altKey, shiftKey, metaKey, getModifierState };
  }
  const altGr = ctrlKey && altKey && !metaKey; // Chromium's Windows AltGr shape (R22)
  const override = layout === 'US' ? undefined : LAYOUT_OVERRIDES[layout][code];
  let key: string | undefined;
  if (override) {
    if (altGr && shiftKey) key = override.altGrShift ?? override.altGr;
    else if (altGr) key = override.altGr;
    else if (shiftKey) key = override.shift;
    else key = override.plain;
  }
  if (key === undefined) key = usProducedChar(code, shiftKey);
  return { key, code, ctrlKey, altKey, shiftKey, metaKey };
}

/** A physical key that produces NOTHING on keydown — a dead key, before its accent is composed. */
export const DEAD_KEY = 'Dead';

/** The character a US keyboard produces for a physical `code`, the reverse of {@link chordEvent}. */
function usProducedChar(code: string, shiftKey: boolean): string {
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return shiftKey ? (US_SHIFTED_DIGIT[Number(digit[1])] as string) : (digit[1] as string);
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shiftKey ? (letter[1] as string) : (letter[1] as string).toLowerCase();
  // NumLock not modelled (see chordEventOnLayout): Insert with Shift (NumLock OFF), 0 without.
  if (code === 'Numpad0') return shiftKey ? 'Insert' : '0';
  if (code === 'NumpadAdd') return '+';
  if (code === 'NumpadSubtract') return '-';
  // A NumLock-off keypad reports its navigation name regardless of Shift (fix round MINOR) — the
  // same shape Numpad0's own Insert/0 split already exercises for one key of the pad.
  const navpad = NUMPAD_NAV_KEY_OF_CODE[code];
  if (navpad) return navpad;
  const symbol = US_SYMBOL_OF_CODE[code];
  if (symbol) return shiftKey ? symbol.shift : symbol.plain;
  return code; // ArrowLeft, PageDown, F-keys… the code already names the produced key.
}

/** Every keypad digit key's navigation name (NumLock off, or NumLock on with Shift), by `code`. */
const KEYPAD_NAV_KEY_OF_CODE: Readonly<Record<string, string>> = {
  Numpad0: 'Insert',
  Numpad1: 'End',
  Numpad2: 'ArrowDown',
  Numpad3: 'PageDown',
  Numpad4: 'ArrowLeft',
  Numpad5: 'Clear',
  Numpad6: 'ArrowRight',
  Numpad7: 'Home',
  Numpad8: 'ArrowUp',
  Numpad9: 'PageUp',
  NumpadDecimal: 'Delete',
};

/** What a keypad digit key reports with NumLock on and no Shift (US). */
const KEYPAD_DIGIT_OF_CODE: Readonly<Record<string, string>> = {
  Numpad0: '0', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4',
  Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9', NumpadDecimal: '.',
};

/** What a NumLock-off keypad key reports as `key`, keyed by its (NumLock-invariant) `code`. */
const NUMPAD_NAV_KEY_OF_CODE: Readonly<Record<string, string>> = {
  Numpad1: 'End',
  Numpad2: 'ArrowDown',
  Numpad3: 'PageDown',
  Numpad4: 'ArrowLeft',
  Numpad6: 'ArrowRight',
  Numpad7: 'Home',
  Numpad8: 'ArrowUp',
  Numpad9: 'PageUp',
};

const US_SYMBOL_OF_CODE: Readonly<Record<string, { plain: string; shift: string }>> = {
  Equal: { plain: '=', shift: '+' },
  Minus: { plain: '-', shift: '_' },
  Backquote: { plain: '`', shift: '~' },
  BracketLeft: { plain: '[', shift: '{' },
  BracketRight: { plain: ']', shift: '}' },
  Backslash: { plain: '\\', shift: '|' },
  Semicolon: { plain: ';', shift: ':' },
  Quote: { plain: "'", shift: '"' },
  Comma: { plain: ',', shift: '<' },
  Period: { plain: '.', shift: '>' },
  Slash: { plain: '/', shift: '?' },
};
