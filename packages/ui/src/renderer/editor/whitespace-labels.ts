/**
 * The characters View Whitespace names, and what it calls them (059 FR-062).
 *
 * Every Unicode White_Space character, every other C0 and C1 control and DEL, and the invisible look-alikes
 * that render as nothing — the set the maintainer's `whitespace-all.txt` exercises. SPACE and TAB have marks
 * of their own (a dot and an arrow), and a line break is drawn as its ending, so those three are not here.
 *
 * The hover names each by Unicode's abbreviation where it has one (the name aliases, and the abbreviations the code
 * charts print in the dashed boxes of the space characters), else `U+XXXX`. Code points are NUMBERS, never
 * escapes typed into the source: an escape has arrived on disk as the raw character before, and U+2028 then
 * breaks the literal it sits in.
 */

export interface WhitespaceLabel {
  /** Unicode's abbreviation, for the hover: `NBSP`, `ZWSP`, `ESC`, or `U+2800` where there is none. */
  abbr: string;
  /** The full name, for the hover: `U+2003 EM SPACE`. */
  name: string;
  /**
   * What the marker shows: ONE glyph, because a marker is one character cell (FR-064) and a multi-letter label
   * cannot be read at that size. One per family, so the families are told apart at a glance; the hover names
   * the exact character.
   */
  glyph: string;
}

/** The glyph for each family of marked character (FR-064). Ranges are inclusive. */
const GLYPH_FAMILIES: readonly (readonly [string, readonly (number | readonly [number, number])[]])[] = [
  ['°', [0x00a0, 0x202f]], // no-break spaces: the mark word processors show
  ['␣', [0x1680, [0x2000, 0x200a], 0x205f, 0x3000]], // every other space with a width
  ['ø', [0x034f, 0x180e, [0x200b, 0x200d], [0x2060, 0x2064], 0xfeff]], // zero-width characters
  ['↔', [0x061c, 0x200e, 0x200f, [0x202a, 0x202e], [0x2066, 0x206f]]], // directional marks and controls
  ['¤', [0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0]], // blank fillers
  ['↲', [0x2028]], // line separator
  ['¶', [0x2029]], // paragraph separator
  ['⤓', [0x0085]], // next line
  ['-', [0x00ad]], // soft hyphen
  ['ε', [0x1b]], // escape: E for escape
  ['◄', [0x08]], // backspace
  ['►', [0x7f]], // delete
  ['⇣', [0x0b]], // vertical tab
  ['↡', [0x0c]], // form feed: the arrow ISO 2047 gives it
  ['←', [0x0d]], // carriage return
  ['0', [0x00]], // null
];

function glyphFor(code: number): string {
  for (const [glyph, members] of GLYPH_FAMILIES) {
    if (members.some((m) => (typeof m === 'number' ? m === code : code >= m[0] && code <= m[1]))) return glyph;
  }
  return '■'; // every other C0 and C1 control
}

const C0 = [
  ['NUL', 'NULL'], ['SOH', 'START OF HEADING'], ['STX', 'START OF TEXT'], ['ETX', 'END OF TEXT'],
  ['EOT', 'END OF TRANSMISSION'], ['ENQ', 'ENQUIRY'], ['ACK', 'ACKNOWLEDGE'], ['BEL', 'BELL'],
  ['BS', 'BACKSPACE'], ['HT', 'CHARACTER TABULATION'], ['LF', 'LINE FEED'], ['VT', 'LINE TABULATION'],
  ['FF', 'FORM FEED'], ['CR', 'CARRIAGE RETURN'], ['SO', 'SHIFT OUT'], ['SI', 'SHIFT IN'],
  ['DLE', 'DATA LINK ESCAPE'], ['DC1', 'DEVICE CONTROL ONE'], ['DC2', 'DEVICE CONTROL TWO'],
  ['DC3', 'DEVICE CONTROL THREE'], ['DC4', 'DEVICE CONTROL FOUR'], ['NAK', 'NEGATIVE ACKNOWLEDGE'],
  ['SYN', 'SYNCHRONOUS IDLE'], ['ETB', 'END OF TRANSMISSION BLOCK'], ['CAN', 'CANCEL'], ['EM', 'END OF MEDIUM'],
  ['SUB', 'SUBSTITUTE'], ['ESC', 'ESCAPE'], ['FS', 'INFORMATION SEPARATOR FOUR'],
  ['GS', 'INFORMATION SEPARATOR THREE'], ['RS', 'INFORMATION SEPARATOR TWO'], ['US', 'INFORMATION SEPARATOR ONE'],
] as const;

const C1 = [
  ['PAD', 'PADDING CHARACTER'], ['HOP', 'HIGH OCTET PRESET'], ['BPH', 'BREAK PERMITTED HERE'],
  ['NBH', 'NO BREAK HERE'], ['IND', 'INDEX'], ['NEL', 'NEXT LINE'], ['SSA', 'START OF SELECTED AREA'],
  ['ESA', 'END OF SELECTED AREA'], ['HTS', 'CHARACTER TABULATION SET'], ['HTJ', 'CHARACTER TABULATION WITH JUSTIFICATION'],
  ['VTS', 'LINE TABULATION SET'], ['PLD', 'PARTIAL LINE FORWARD'], ['PLU', 'PARTIAL LINE BACKWARD'],
  ['RI', 'REVERSE LINE FEED'], ['SS2', 'SINGLE SHIFT TWO'], ['SS3', 'SINGLE SHIFT THREE'],
  ['DCS', 'DEVICE CONTROL STRING'], ['PU1', 'PRIVATE USE ONE'], ['PU2', 'PRIVATE USE TWO'],
  ['STS', 'SET TRANSMIT STATE'], ['CCH', 'CANCEL CHARACTER'], ['MW', 'MESSAGE WAITING'],
  ['SPA', 'START OF GUARDED AREA'], ['EPA', 'END OF GUARDED AREA'], ['SOS', 'START OF STRING'],
  ['SGC', 'SINGLE GRAPHIC CHARACTER INTRODUCER'], ['SCI', 'SINGLE CHARACTER INTRODUCER'],
  ['CSI', 'CONTROL SEQUENCE INTRODUCER'], ['ST', 'STRING TERMINATOR'], ['OSC', 'OPERATING SYSTEM COMMAND'],
  ['PM', 'PRIVACY MESSAGE'], ['APC', 'APPLICATION PROGRAM COMMAND'],
] as const;

/** Everything else, by code point. An empty abbreviation means Unicode gives none: the label is `U+XXXX`. */
const OTHERS: readonly (readonly [number, string, string])[] = [
  [0x007f, 'DEL', 'DELETE'],
  [0x00a0, 'NBSP', 'NO-BREAK SPACE'],
  [0x00ad, 'SHY', 'SOFT HYPHEN'],
  [0x034f, 'CGJ', 'COMBINING GRAPHEME JOINER'],
  [0x061c, 'ALM', 'ARABIC LETTER MARK'],
  [0x115f, '', 'HANGUL CHOSEONG FILLER'],
  [0x1160, '', 'HANGUL JUNGSEONG FILLER'],
  [0x1680, '', 'OGHAM SPACE MARK'],
  [0x17b4, '', 'KHMER VOWEL INHERENT AQ'],
  [0x17b5, '', 'KHMER VOWEL INHERENT AA'],
  [0x180e, 'MVS', 'MONGOLIAN VOWEL SEPARATOR'],
  [0x2000, 'NQSP', 'EN QUAD'],
  [0x2001, 'MQSP', 'EM QUAD'],
  [0x2002, 'ENSP', 'EN SPACE'],
  [0x2003, 'EMSP', 'EM SPACE'],
  [0x2004, '3/MSP', 'THREE-PER-EM SPACE'],
  [0x2005, '4/MSP', 'FOUR-PER-EM SPACE'],
  [0x2006, '6/MSP', 'SIX-PER-EM SPACE'],
  [0x2007, 'FSP', 'FIGURE SPACE'],
  [0x2008, 'PSP', 'PUNCTUATION SPACE'],
  [0x2009, 'THSP', 'THIN SPACE'],
  [0x200a, 'HSP', 'HAIR SPACE'],
  [0x200b, 'ZWSP', 'ZERO WIDTH SPACE'],
  [0x200c, 'ZWNJ', 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZWJ', 'ZERO WIDTH JOINER'],
  [0x200e, 'LRM', 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RLM', 'RIGHT-TO-LEFT MARK'],
  [0x2028, 'LSEP', 'LINE SEPARATOR'],
  [0x2029, 'PSEP', 'PARAGRAPH SEPARATOR'],
  [0x202a, 'LRE', 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RLE', 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'PDF', 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LRO', 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RLO', 'RIGHT-TO-LEFT OVERRIDE'],
  [0x202f, 'NNBSP', 'NARROW NO-BREAK SPACE'],
  [0x205f, 'MMSP', 'MEDIUM MATHEMATICAL SPACE'],
  [0x2060, 'WJ', 'WORD JOINER'],
  [0x2061, '', 'FUNCTION APPLICATION'],
  [0x2062, '', 'INVISIBLE TIMES'],
  [0x2063, '', 'INVISIBLE SEPARATOR'],
  [0x2064, '', 'INVISIBLE PLUS'],
  [0x2066, 'LRI', 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RLI', 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FSI', 'FIRST STRONG ISOLATE'],
  [0x2069, 'PDI', 'POP DIRECTIONAL ISOLATE'],
  [0x206a, '', 'INHIBIT SYMMETRIC SWAPPING'],
  [0x206b, '', 'ACTIVATE SYMMETRIC SWAPPING'],
  [0x206c, '', 'INHIBIT ARABIC FORM SHAPING'],
  [0x206d, '', 'ACTIVATE ARABIC FORM SHAPING'],
  [0x206e, '', 'NATIONAL DIGIT SHAPES'],
  [0x206f, '', 'NOMINAL DIGIT SHAPES'],
  [0x2800, '', 'BRAILLE PATTERN BLANK'],
  [0x3000, 'IDSP', 'IDEOGRAPHIC SPACE'],
  [0x3164, '', 'HANGUL FILLER'],
  [0xfeff, 'ZWNBSP', 'ZERO WIDTH NO-BREAK SPACE'],
  [0xffa0, '', 'HALFWIDTH HANGUL FILLER'],
];

const hex = (code: number): string => code.toString(16).toUpperCase().padStart(4, '0');

/** SPACE, TAB and LF have marks of their own; nothing else in C0 does. */
const OWN_MARK = new Set([0x09, 0x0a, 0x20]);

const LABELS = new Map<number, WhitespaceLabel>();
const add = (code: number, abbr: string, name: string): void => {
  if (OWN_MARK.has(code)) return;
  LABELS.set(code, { abbr: abbr || `U+${hex(code)}`, name: `U+${hex(code)} ${name}`, glyph: glyphFor(code) });
};
C0.forEach(([abbr, name], code) => add(code, abbr, name));
C1.forEach(([abbr, name], i) => add(0x80 + i, abbr, name));
for (const [code, abbr, name] of OTHERS) add(code, abbr, name);

/** The label for a character View Whitespace names, or `null` for one it does not. */
export function whitespaceLabel(code: number): WhitespaceLabel | null {
  return LABELS.get(code) ?? null;
}

export function isMarkedCharacter(code: number): boolean {
  return LABELS.has(code);
}

/**
 * A global regex matching every named character, for CodeMirror's special-character drawing. Built from the
 * table's code points at run time, so no escape is ever typed into the source.
 */
export function markedCharacterPattern(): RegExp {
  const backslash = String.fromCharCode(92);
  const cls = [...LABELS.keys()].map((c) => `${backslash}u${hex(c)}`).join('');
  return new RegExp(`[${cls}]`, 'g');
}
