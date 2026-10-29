/**
 * Text fidelity — encoding & line-ending detection/preservation (006 Phase A, FR-025/026/026a,
 * SC-005; widened to five formats by 059). Pure over `Uint8Array`/`string`; no OS/DOM (uses the
 * global `TextEncoder`/`TextDecoder`, available in both Node and the renderer).
 *
 * The buffer model: `decode` normalises all line breaks to `\n` and records the file's format —
 * encoding, BOM, dominant ending and, for a file that mixes them, every break; `encode` re-applies
 * all of it, so an unedited file round-trips byte-identical and only edited lines change (no
 * whole-file churn). New documents are UTF-8, no BOM, with the settings-supplied default ending.
 *
 * ══ ONE DETECTION, FOR EVERY READER (059 FR-001) ══
 *
 * {@link detectTextFormat} is the only place a file's encoding is decided. Before 059 three questions
 * — "is it binary", "is it decodable UTF-8", "which BOM" — were asked by three functions at different
 * call sites, and the editor's load path skipped the second one: a Windows-1252 file opened with every
 * accented byte turned into `U+FFFD`, and saving it wrote `EF BF BD` back over all of them.
 *
 * ══ LOSSLESS OR REFUSED (059 FR-014, FR-020, FR-021) ══
 *
 * Every decoder here is FATAL, and {@link encode} throws rather than substitute. A replacement
 * character that was not in the file can therefore never reach the buffer, and so never reach disk.
 */
import { CODE_PAGE_IDS, type CodePageId, type EncodingId, type LineEndingId } from '../workspace/model.js';

const BOM_0 = 0xef;
const BOM_1 = 0xbb;
const BOM_2 = 0xbf;

/**
 * How far the zero-byte heuristics read: the UTF-16 pattern and the binary scan (git's window). A
 * decisive byte further in changes nothing, which is what keeps detection cheap on a large file
 * (059 FR-005); the one whole-file pass is the fatal decode that confirms the answer.
 */
const SCAN_WINDOW = 8000;

/**
 * BOM-less UTF-16 (059 research R2). ASCII-range text in UTF-16 LE has a zero in every odd byte; a
 * Latin or CJK file still has zeros in a large share of one side and almost none on the other, since
 * code units whose low byte is zero are rare. Binary formats put zeros on BOTH sides — headers,
 * padding, aligned integers — which the second threshold rejects. A lossless decode of the whole file
 * then confirms it, so the thresholds only have to be good, not perfect.
 */
const UTF16_ZERO_SIDE_MIN = 0.3;
const UTF16_OTHER_SIDE_MAX = 0.02;

export interface DecodedFile {
  text: string;
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  /**
   * Every line break of a file that MIXES endings, in order — absent when the file is uniform
   * (043 FR-056).
   *
   * The dominant ending alone is enough for a file that has one, and re-applying it to a mixed file
   * rewrites every line that disagreed. 006 could live with that because the user had the file
   * open; 043's replace commit writes files nobody opened, so the churn first surfaces in a diff.
   *
   * Recorded ONLY when the file actually mixes, so the overwhelmingly common uniform file allocates
   * nothing and its `DecodedFile` is the same shape it always was.
   */
  mixedLineEndings?: readonly LineEndingId[];
}

export interface EncodeOptions {
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  /** The original per-break endings of a mixed file — see {@link DecodedFile.mixedLineEndings}. */
  mixedLineEndings?: readonly LineEndingId[];
}

/** Why a file is not opened as text. `not-decodable` names the encoding it failed in. */
export type TextRefusalReason = 'utf32' | 'binary' | 'not-decodable';

export type TextFormatVerdict =
  | { kind: 'text'; encoding: EncodingId; hasBom: boolean }
  | { kind: 'refused'; reason: 'utf32' | 'binary' }
  | { kind: 'refused'; reason: 'not-decodable'; encoding: EncodingId };

export type TextReadResult =
  | { ok: true; file: DecodedFile }
  | { ok: false; reason: 'utf32' | 'binary' }
  | { ok: false; reason: 'not-decodable'; encoding: EncodingId };

/** Thrown by {@link decode} for a file {@link readText} would refuse. */
export class TextRefusedError extends Error {
  constructor(
    readonly reason: TextRefusalReason,
    readonly encoding?: EncodingId,
  ) {
    super(refusalMessage(reason, encoding));
    this.name = 'TextRefusedError';
  }
}

/** The first character an encoding cannot hold, 1-based in the `\n`-normalised buffer. */
export interface Unrepresentable {
  encoding: EncodingId;
  char: string;
  line: number;
  column: number;
}

/** Thrown by {@link encode} instead of writing a substitute (059 FR-021). */
export class UnrepresentableTextError extends Error {
  constructor(readonly detail: Unrepresentable) {
    super(
      `${encodingLabel(detail.encoding, false)} cannot represent "${detail.char}" (line ${detail.line})`,
    );
    this.name = 'UnrepresentableTextError';
  }
}

// ── The Windows code pages, derived from the platform decoder (059 research R4, FR-069) ───────────

/** Each code page's WHATWG label and the script it is named by in the encoding lists. */
const CODE_PAGE: Record<CodePageId, { label: string; script: string }> = {
  windows1250: { label: 'windows-1250', script: 'Central European' },
  windows1251: { label: 'windows-1251', script: 'Cyrillic' },
  windows1252: { label: 'windows-1252', script: 'Western European' },
  windows1253: { label: 'windows-1253', script: 'Greek' },
  windows1254: { label: 'windows-1254', script: 'Turkish' },
  windows1255: { label: 'windows-1255', script: 'Hebrew' },
  windows1256: { label: 'windows-1256', script: 'Arabic' },
  windows1257: { label: 'windows-1257', script: 'Baltic' },
  windows1258: { label: 'windows-1258', script: 'Vietnamese' },
};

function isCodePage(encoding: EncodingId): encoding is CodePageId {
  return encoding in CODE_PAGE;
}

/** The menu name of a code page: its number and its script (FR-069). */
export function codePageName(encoding: CodePageId): string {
  return `${encodingLabel(encoding, false)} (${CODE_PAGE[encoding].script})`;
}

/**
 * Each code page as the WHATWG decoder reads it. Windows-1252's five undefined values (0x81, 0x8D,
 * 0x8F, 0x90, 0x9D) map to the C1 controls of the same number, so it reads every byte. 1253, 1255 and
 * 1257 leave some bytes undefined; the platform decoder turns those into U+FFFD, which FR-014 forbids, so
 * each is kept instead as the private-use character U+F700 + byte (FR-072) — a placeholder no code page
 * defines, which writes back as the byte it came from. The ENCODER is this table inverted, so the round
 * trip is exact by construction — there is no second table that could disagree with the first (FR-013).
 * Built on first use: nine 64K-entry tables are not worth paying for at startup when most sessions touch
 * one or none.
 */
const PLACEHOLDER_BASE = 0xf700;
const decodeTables = new Map<CodePageId, Uint16Array>();
function decodeTable(encoding: CodePageId): Uint16Array {
  let table = decodeTables.get(encoding);
  if (!table) {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const chars = new TextDecoder(CODE_PAGE[encoding].label).decode(all);
    table = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      const c = chars.charCodeAt(i);
      table[i] = c === 0xfffd ? PLACEHOLDER_BASE + i : c;
    }
    decodeTables.set(encoding, table);
  }
  return table;
}

const encodeTables = new Map<CodePageId, Int16Array>();
function encodeTable(encoding: CodePageId): Int16Array {
  let table = encodeTables.get(encoding);
  if (!table) {
    const chars = decodeTable(encoding);
    table = new Int16Array(0x10000).fill(-1);
    for (let i = 0; i < 256; i++) table[chars[i] as number] = i;
    encodeTables.set(encoding, table);
  }
  return table;
}

/**
 * Read a code page: every byte maps to one character, so it never fails (FR-072). The platform decoder does the
 * work — a table loop here measured well over 1.5× UTF-8 on a large file — and only the U+FFFD it writes for an
 * undefined byte is patched. Every byte is ONE BMP character in these code pages, so character i is byte i, and
 * U+FFFD is never a genuine character of one.
 */
function decodeCodePage(body: Uint8Array, encoding: CodePageId): string {
  const text = new TextDecoder(CODE_PAGE[encoding].label).decode(body);
  if (!text.includes('\u{fffd}')) return text;
  return text.replace(/\u{fffd}/gu, (_m, i: number) => String.fromCharCode(PLACEHOLDER_BASE + (body[i] as number)));
}

// ── Detection ─────────────────────────────────────────────────────────────────────────────────────

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

const BOM_UTF32LE = [0xff, 0xfe, 0x00, 0x00];
const BOM_UTF32BE = [0x00, 0x00, 0xfe, 0xff];
const BOM_UTF8 = [BOM_0, BOM_1, BOM_2];
const BOM_UTF16LE = [0xff, 0xfe];
const BOM_UTF16BE = [0xfe, 0xff];

function bomLength(encoding: EncodingId): number {
  return encoding === 'utf8' ? 3 : isCodePage(encoding) ? 0 : 2;
}

function hasBomFor(bytes: Uint8Array, encoding: EncodingId): boolean {
  switch (encoding) {
    case 'utf8':
      return startsWith(bytes, BOM_UTF8);
    case 'utf16le':
      return startsWith(bytes, BOM_UTF16LE);
    case 'utf16be':
      return startsWith(bytes, BOM_UTF16BE);
    default:
      return false; // a code page has no BOM
  }
}

function decoderLabel(encoding: EncodingId): string {
  switch (encoding) {
    case 'utf8':
      return 'utf-8';
    case 'utf16le':
      return 'utf-16le';
    case 'utf16be':
      return 'utf-16be';
    default:
      return CODE_PAGE[encoding].label;
  }
}

/** Decode a body (BOM already removed) losslessly, or `null`. A code page reads any byte (FR-072). */
function decodeBody(body: Uint8Array, encoding: EncodingId): string | null {
  if (isCodePage(encoding)) return decodeCodePage(body, encoding);
  try {
    // `ignoreBOM`: the BOM, if any, was already stripped — a second one is content, and must survive.
    return new TextDecoder(decoderLabel(encoding), { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return null;
  }
}

function utf16Pattern(bytes: Uint8Array): 'utf16le' | 'utf16be' | null {
  const scanned = Math.min(bytes.length, SCAN_WINDOW) & ~1;
  const pairs = scanned / 2;
  if (pairs < 1) return null;
  let zEven = 0;
  let zOdd = 0;
  for (let i = 0; i < scanned; i += 2) {
    if (bytes[i] === 0) zEven++;
    if (bytes[i + 1] === 0) zOdd++;
  }
  if (zOdd >= UTF16_ZERO_SIDE_MIN * pairs && zEven <= UTF16_OTHER_SIDE_MAX * pairs) return 'utf16le';
  if (zEven >= UTF16_ZERO_SIDE_MIN * pairs && zOdd <= UTF16_OTHER_SIDE_MAX * pairs) return 'utf16be';
  return null;
}

/**
 * The one decision (059 FR-002), returning the decoded body alongside the verdict so that a read
 * does not decode twice.
 */
function classify(
  bytes: Uint8Array,
  fallback: CodePageId = 'windows1252',
): { verdict: TextFormatVerdict; raw?: string } {
  // 1. UTF-32 — before UTF-16 LE, whose BOM is its prefix (FR-003).
  if (startsWith(bytes, BOM_UTF32LE) || startsWith(bytes, BOM_UTF32BE)) {
    return { verdict: { kind: 'refused', reason: 'utf32' } };
  }
  // 2–4. A BOM is a claim; a body that does not keep it is refused, naming the claim.
  for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
    if (!hasBomFor(bytes, encoding)) continue;
    const raw = decodeBody(bytes.subarray(bomLength(encoding)), encoding);
    if (raw === null) return { verdict: { kind: 'refused', reason: 'not-decodable', encoding } };
    return { verdict: { kind: 'text', encoding, hasBom: true }, raw };
  }
  // 5. BOM-less UTF-16, confirmed by a lossless decode of the whole file.
  const pattern = utf16Pattern(bytes);
  if (pattern !== null) {
    const raw = decodeBody(bytes, pattern);
    if (raw !== null) return { verdict: { kind: 'text', encoding: pattern, hasBom: false }, raw };
  }
  // 6. Binary.
  if (isProbablyBinary(bytes)) return { verdict: { kind: 'refused', reason: 'binary' } };
  // 7. UTF-8.
  const utf8 = decodeBody(bytes, 'utf8');
  if (utf8 !== null) return { verdict: { kind: 'text', encoding: 'utf8', hasBom: false }, raw: utf8 };
  // 8. The fallback code page (FR-069, `editor.fallbackEncoding`). A code page reads every byte — one it
  //    leaves undefined is kept as a placeholder (FR-072) — so it never invents one.
  return { verdict: { kind: 'text', encoding: fallback, hasBom: false }, raw: decodeCodePage(bytes, fallback) };
}

/**
 * What a file's bytes are (059 FR-001/FR-002): a supported format, or why it is not opened as text. A file
 * no step claims is read in `fallback` (FR-069), Windows-1252 by default.
 */
export function detectTextFormat(bytes: Uint8Array, fallback?: CodePageId): TextFormatVerdict {
  return classify(bytes, fallback).verdict;
}

// ── Line endings ──────────────────────────────────────────────────────────────────────────────────

/** How many breaks of each style the text carries. One pass, no allocation per break. */
function lineEndingCounts(text: string): Record<LineEndingId, number> {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10 /* \n */) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (c === 10 /* \n */) {
      lf++;
    }
  }
  return { crlf, lf, cr };
}

function dominantEnding(counts: Record<LineEndingId, number>): LineEndingId {
  let best: LineEndingId = 'lf';
  let bestN = -1;
  for (const k of ['crlf', 'lf', 'cr'] as const) {
    if (counts[k] > bestN) {
      best = k;
      bestN = counts[k];
    }
  }
  return bestN <= 0 ? 'lf' : best;
}

/** The dominant line-ending style of a string (LF, CRLF, or CR); LF when none. */
export function detectLineEnding(text: string): LineEndingId {
  return dominantEnding(lineEndingCounts(text));
}

/**
 * Every break in order — a second pass, taken ONLY for a file that mixes endings (FR-056).
 *
 * A uniform file needs nothing beyond its dominant ending, and it is the overwhelming majority, so
 * paying an array of the file's line count for every decode would be a cost with no beneficiary.
 */
function lineEndingsOf(text: string): LineEndingId[] {
  const out: LineEndingId[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10 /* \n */) {
        out.push('crlf');
        i++;
      } else {
        out.push('cr');
      }
    } else if (c === 10 /* \n */) {
      out.push('lf');
    }
  }
  return out;
}

function normaliseToLf(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toDecodedFile(raw: string, encoding: EncodingId, hasBom: boolean): DecodedFile {
  const counts = lineEndingCounts(raw);
  const lineEnding = dominantEnding(counts);
  const kinds = (counts.crlf > 0 ? 1 : 0) + (counts.lf > 0 ? 1 : 0) + (counts.cr > 0 ? 1 : 0);
  const decoded: DecodedFile = { text: normaliseToLf(raw), encoding, hasBom, lineEnding };
  if (kinds > 1) decoded.mixedLineEndings = lineEndingsOf(raw);
  return decoded;
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Read bytes as text: detect the format (or use `forced`, for Reopen with Encoding — 059 FR-024),
 * decode losslessly, normalise breaks to `\n` and record the format. A file that cannot be read
 * losslessly is refused, never patched with replacement characters (FR-014).
 */
export function readText(bytes: Uint8Array, forced?: EncodingId, fallback?: CodePageId): TextReadResult {
  if (forced !== undefined) {
    const hasBom = hasBomFor(bytes, forced);
    const raw = decodeBody(hasBom ? bytes.subarray(bomLength(forced)) : bytes, forced);
    if (raw === null) return { ok: false, reason: 'not-decodable', encoding: forced };
    return { ok: true, file: toDecodedFile(raw, forced, hasBom) };
  }
  const { verdict, raw } = classify(bytes, fallback);
  if (verdict.kind === 'refused') {
    return verdict.reason === 'not-decodable'
      ? { ok: false, reason: 'not-decodable', encoding: verdict.encoding }
      : { ok: false, reason: verdict.reason };
  }
  return { ok: true, file: toDecodedFile(raw ?? '', verdict.encoding, verdict.hasBom) };
}

/** {@link readText}, throwing {@link TextRefusedError} for a refused file. */
export function decode(bytes: Uint8Array, forced?: EncodingId, fallback?: CodePageId): DecodedFile {
  const r = readText(bytes, forced, fallback);
  if (!r.ok) throw new TextRefusedError(r.reason, r.reason === 'not-decodable' ? r.encoding : undefined);
  return r.file;
}

// ── Writing ───────────────────────────────────────────────────────────────────────────────────────

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/**
 * The first character `encoding` cannot hold, or `null` (059 FR-021/FR-022). A lone surrogate is
 * unrepresentable everywhere — `TextEncoder` would silently write `EF BF BD` for it.
 */
export function findUnrepresentable(text: string, encoding: EncodingId): Unrepresentable | null {
  let line = 1;
  let column = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      line++;
      column = 0;
      continue;
    }
    column++;
    if (isHighSurrogate(c) && isLowSurrogate(text.charCodeAt(i + 1))) {
      // A whole astral character: two units, one column. No code page holds any of them.
      if (isCodePage(encoding)) {
        return { encoding, char: text.slice(i, i + 2), line, column };
      }
      i++;
      continue;
    }
    if (isHighSurrogate(c) || isLowSurrogate(c)) {
      return { encoding, char: text[i] as string, line, column };
    }
    if (isCodePage(encoding) && (encodeTable(encoding)[c] as number) < 0) {
      return { encoding, char: text[i] as string, line, column };
    }
  }
  return null;
}

function fail(normalisedText: string, encoding: EncodingId): never {
  const detail = findUnrepresentable(normalisedText, encoding);
  // Only reachable when the encoder met a unit `findUnrepresentable` agrees it cannot hold.
  throw new UnrepresentableTextError(detail ?? { encoding, char: '', line: 1, column: 1 });
}

function encodeUtf16(s: string, order: 'le' | 'be', bom: boolean, normalised: string, enc: EncodingId) {
  const offset = bom ? 2 : 0;
  const out = new Uint8Array(offset + s.length * 2);
  if (bom) {
    out[0] = order === 'le' ? 0xff : 0xfe;
    out[1] = order === 'le' ? 0xfe : 0xff;
  }
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    if (isHighSurrogate(u)) {
      if (!isLowSurrogate(s.charCodeAt(i + 1))) fail(normalised, enc);
    } else if (isLowSurrogate(u) && !isHighSurrogate(s.charCodeAt(i - 1))) {
      fail(normalised, enc);
    }
    const o = offset + i * 2;
    out[o] = order === 'le' ? u & 0xff : u >> 8;
    out[o + 1] = order === 'le' ? u >> 8 : u & 0xff;
  }
  return out;
}

/**
 * Encode `\n`-normalised text back to bytes in the recorded encoding, re-applying the recorded
 * endings and BOM. Throws {@link UnrepresentableTextError} rather than substitute a character the
 * encoding cannot hold (059 FR-021) — no caller can forget the check, because there is no way past it.
 */
export function encode(text: string, opts: EncodeOptions): Uint8Array {
  const nl = opts.lineEnding === 'crlf' ? '\r\n' : opts.lineEnding === 'cr' ? '\r' : '\n';
  const normalised = normaliseToLf(text);
  const s = withLineEndings(normalised, nl, opts);
  switch (opts.encoding) {
    case 'utf8': {
      if (findUnrepresentable(normalised, 'utf8') !== null) fail(normalised, 'utf8');
      const bodyBytes = new TextEncoder().encode(s);
      if (!opts.hasBom) return bodyBytes;
      const out = new Uint8Array(bodyBytes.length + 3);
      out[0] = BOM_0;
      out[1] = BOM_1;
      out[2] = BOM_2;
      out.set(bodyBytes, 3);
      return out;
    }
    case 'utf16le':
      return encodeUtf16(s, 'le', opts.hasBom, normalised, 'utf16le');
    case 'utf16be':
      return encodeUtf16(s, 'be', opts.hasBom, normalised, 'utf16be');
    default: {
      const encoding = opts.encoding;
      const table = encodeTable(encoding);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) {
        const b = table[s.charCodeAt(i)] as number;
        if (b < 0) fail(normalised, encoding);
        out[i] = b;
      }
      return out;
    }
  }
}

/**
 * Re-apply the file's endings to `\n`-normalised text (FR-056).
 *
 * Per break when the file mixed them AND the break count is unchanged; the dominant ending
 * otherwise. The count check is the honest half: an edit that added or removed a line makes the
 * positional record meaningless, and there is no way to say which ending a line nobody wrote before
 * should inherit — so that case falls back rather than guessing.
 */
function withLineEndings(normalised: string, nl: string, opts: EncodeOptions): string {
  const mixed = opts.mixedLineEndings;
  if (mixed && mixed.length > 0) {
    const parts = normalised.split('\n');
    if (parts.length - 1 === mixed.length) {
      let out = parts[0] as string;
      for (let i = 1; i < parts.length; i++) {
        const kind = mixed[i - 1];
        out += kind === 'crlf' ? '\r\n' : kind === 'cr' ? '\r' : '\n';
        out += parts[i] as string;
      }
      return out;
    }
  }
  return nl === '\n' ? normalised : normalised.replace(/\n/g, nl);
}

/** Metadata for a brand-new document: UTF-8, no BOM, settings-supplied ending. */
export function newDocumentDefaults(defaultLineEnding: LineEndingId): {
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
} {
  return { encoding: 'utf8', hasBom: false, lineEnding: defaultLineEnding };
}

/**
 * Heuristic: does the byte stream look like a non-text/binary file? Uses the standard NUL-byte scan
 * over the leading bytes (git's approach). It is step 6 of {@link detectTextFormat}, taken only once
 * UTF-16 has been ruled out — UTF-16 text is full of the zeros this looks for. Not exported: a caller
 * asking only this question would skip the UTF-16 step and refuse UTF-16 text (059 FR-001).
 */
function isProbablyBinary(bytes: Uint8Array): boolean {
  const start = startsWith(bytes, BOM_UTF8) ? 3 : 0;
  const scanEnd = Math.min(bytes.length, start + SCAN_WINDOW);
  for (let i = start; i < scanEnd; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

// ── Words (059 FR-006/FR-007/FR-031/FR-053) ───────────────────────────────────────────────────────

/** The status-bar and menu name of a format. */
export function encodingLabel(encoding: EncodingId, hasBom: boolean): string {
  switch (encoding) {
    case 'utf8':
      return hasBom ? 'UTF-8 with BOM' : 'UTF-8';
    case 'utf16le':
      return 'UTF-16 LE';
    case 'utf16be':
      return 'UTF-16 BE';
    default:
      return `Windows-${encoding.slice('windows'.length)}`;
  }
}

const ENDING_LABEL: Record<LineEndingId, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' };

/** The status-bar name of a document's line endings; a mixed file is named by its dominant one. */
export function lineEndingLabel(lineEnding: LineEndingId, mixed: boolean): string {
  return mixed ? `Mixed (${ENDING_LABEL[lineEnding]})` : ENDING_LABEL[lineEnding];
}

/**
 * The formats the encoding lists offer, in menu order (059 FR-055, FR-069): the Unicode encodings, then the
 * Windows code pages named with their script. UTF-16 is offered only with a BOM: a BOM-less UTF-16 file is
 * detected and preserved, never chosen (spec Assumptions).
 */
export const ENCODING_CHOICES: readonly {
  encoding: EncodingId;
  hasBom: boolean;
  label: string;
  group: 'unicode' | 'codepage';
}[] = [
  ...(
    [
      ['utf8', false],
      ['utf8', true],
      ['utf16le', true],
      ['utf16be', true],
    ] as const
  ).map(([encoding, hasBom]) => ({ encoding, hasBom, label: encodingLabel(encoding, hasBom), group: 'unicode' as const })),
  ...CODE_PAGE_IDS.map((encoding) => ({
    encoding,
    hasBom: false,
    label: codePageName(encoding),
    group: 'codepage' as const,
  })),
];

/** One wording per refusal, used by every path that refuses a file (059 FR-053). */
export function refusalMessage(reason: TextRefusalReason, encoding?: EncodingId): string {
  switch (reason) {
    case 'utf32':
      return 'This file is UTF-32, which throng does not open.';
    case 'binary':
      return 'That file is not text, so it cannot be opened in an editor.';
    case 'not-decodable':
      return `That file is not valid ${encodingLabel(encoding ?? 'utf8', false)} text.`;
  }
}
