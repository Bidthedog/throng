/**
 * Does text throng detected as UTF-8 look like Windows-1252 read as UTF-8? (059 FR-068)
 *
 * Detection tries valid UTF-8 before the Windows-1252 fallback, so a Windows-1252 file whose bytes happen to
 * form valid UTF-8 opens as UTF-8, wrongly. That only happens where every non-ASCII byte is an accented capital
 * (C2–DF) followed by a symbol (80–BF), and each such pair decodes to ONE character in U+0080–U+07FF — mostly
 * IPA, Greek, Cyrillic, Armenian, Hebrew, Arabic or Syriac, sitting in the middle of a Latin word (`CAFə` for
 * `CAFÉ™`). Genuine text in those scripts writes whole words in them; mixing one into a Latin word is the tell.
 *
 * Deliberately NOT flagged: double-encoded UTF-8 (`cafÃ©`). Its characters are Latin-1, indistinguishable
 * from accented text, and reopening it as Windows-1252 makes it worse, so suggesting that would mislead.
 *
 * A hint, not a verdict: the notice it raises says the file MAY be misread, and the user decides.
 */
import type { CodePageId } from '../workspace/model.js';

/** How much of the text is looked at: a misread file shows the tell early, and the check stays cheap. */
const SCAN_CHARS = 65536;
/** The first code point a Windows-1252 pair cannot decode to (three-byte UTF-8 starts here). */
const BEYOND_PAIRS = 0x800;
/** The letters a pair decodes to that are not Latin: IPA up to the end of the two-byte range. */
const NON_LATIN_FROM = 0x250;

const WORD = /[\p{L}\p{M}]+/gu;
const ASCII_LETTER = /[A-Za-z]/;

export function misreadSuspect(text: string): boolean {
  const scanned = text.length > SCAN_CHARS ? text.slice(0, SCAN_CHARS) : text;
  for (const ch of scanned) {
    if ((ch.codePointAt(0) as number) >= BEYOND_PAIRS) return false;
  }
  for (const [word] of scanned.matchAll(WORD)) {
    if (!ASCII_LETTER.test(word)) continue;
    for (const ch of word) {
      const code = ch.codePointAt(0) as number;
      if (code >= NON_LATIN_FROM && code < BEYOND_PAIRS) return true;
    }
  }
  return false;
}

// ── A code page read wrongly (059 FR-069) ─────────────────────────────────────────────────────────

/** The code pages whose letters are Latin: text read in one of them should be mostly ASCII letters. */
const LATIN_PAGES: ReadonlySet<CodePageId> = new Set([
  'windows1250',
  'windows1252',
  'windows1254',
  'windows1257',
  'windows1258',
]);
const SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Hebrew', 'Arabic'] as const;
const SCRIPT_RE = SCRIPTS.map((s) => new RegExp(`\\p{Script=${s}}`, 'u'));
const LETTER = /\p{L}/u;
/** A non-ASCII character that is not a letter, mark or space, standing between two letters. */
const IN_WORD = /(?<=\p{L})[^\p{L}\p{M}\s\p{ASCII}](?=\p{L})/gu;
/** Punctuation that genuinely sits inside words: apostrophes, the Catalan middle dot, soft and hard hyphens. */
const WORD_PUNCTUATION = new Set([0x2019, 0x2018, 0xb7, 0xad, 0x2010, 0x2011]);
/** U+F700 + byte for the bytes 0x80–0xFF a code page leaves undefined (text-fidelity.ts, FR-072). */
const PLACEHOLDERS_FROM = 0xf780;
const PLACEHOLDERS_TO = 0xf7ff;
/** Below this many accented letters a text is too short to call. */
const MIN_ACCENTED = 8;

function scriptOf(ch: string): number {
  for (let i = 0; i < SCRIPT_RE.length; i++) if ((SCRIPT_RE[i] as RegExp).test(ch)) return i;
  return -1;
}

/**
 * Does text read in the code page `readAs` look wrong for it? Bytes cannot tell the single-byte code pages
 * apart, but the decoded text can show it is not what was written:
 *
 * - **a word mixes scripts** — `cafй` is Western text read as Cyrillic;
 * - **a symbol sits inside a word** — `Za¿ó³æ` is Polish read as Western;
 * - **a Latin code page's letters are mostly accented** — `Ïðèâåò` is Russian read as Western.
 *
 * A non-Latin text read in the wrong non-Latin code page often passes all three, which is why the caller
 * also asks a statistical detector (059 FR-069). A hint, not a verdict, like {@link misreadSuspect}.
 */
export function looksMisreadAs(text: string, readAs: CodePageId): boolean {
  const scanned = text.length > SCAN_CHARS ? text.slice(0, SCAN_CHARS) : text;
  let letters = 0;
  let accented = 0;
  for (const [word] of scanned.matchAll(WORD)) {
    let script = -1;
    for (const ch of word) {
      if (!LETTER.test(ch)) continue;
      letters++;
      if ((ch.codePointAt(0) as number) > 0x7f) accented++;
      const s = scriptOf(ch);
      if (s < 0) continue;
      if (script >= 0 && s !== script) return true;
      script = s;
    }
  }
  for (const [ch] of scanned.matchAll(IN_WORD)) {
    const code = ch.codePointAt(0) as number;
    // A placeholder for a byte the code page leaves undefined (FR-072) says nothing about the reading.
    if (code >= PLACEHOLDERS_FROM && code <= PLACEHOLDERS_TO) continue;
    if (!WORD_PUNCTUATION.has(code)) return true;
  }
  return LATIN_PAGES.has(readAs) && accented >= MIN_ACCENTED && accented * 2 > letters;
}
