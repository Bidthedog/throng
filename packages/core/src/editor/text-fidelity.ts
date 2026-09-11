/**
 * Text fidelity — encoding & line-ending detection/preservation (006 Phase A,
 * FR-025/026/026a, SC-005). Pure over `Uint8Array`/`string`; no OS/DOM (uses the
 * global `TextEncoder`/`TextDecoder`, available in both Node and the renderer).
 *
 * The buffer model: `decode` normalises all line breaks to `\n` and records the
 * file's dominant ending; `encode` re-applies that ending, so an unedited file
 * round-trips byte-identical (BOM + endings preserved) and only edited lines
 * change (no whole-file churn). New documents are UTF-8, no BOM, with the
 * settings-supplied default ending.
 */
import type { EncodingId, LineEndingId } from '../workspace/model.js';

const BOM_0 = 0xef;
const BOM_1 = 0xbb;
const BOM_2 = 0xbf;

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

/** Detect the encoding of raw bytes. This pass ships UTF-8 (± BOM `EF BB BF`). */
export function detectEncoding(bytes: Uint8Array): { encoding: EncodingId; hasBom: boolean } {
  const hasBom =
    bytes.length >= 3 && bytes[0] === BOM_0 && bytes[1] === BOM_1 && bytes[2] === BOM_2;
  return { encoding: 'utf8', hasBom };
}

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

/** Decode raw bytes: strip a BOM, decode UTF-8, normalise breaks to `\n`, and
 *  record the file's original encoding/BOM/dominant ending. */
export function decode(bytes: Uint8Array): DecodedFile {
  const { encoding, hasBom } = detectEncoding(bytes);
  const body = hasBom ? bytes.subarray(3) : bytes;
  const raw = new TextDecoder('utf-8').decode(body);
  const counts = lineEndingCounts(raw);
  const lineEnding = dominantEnding(counts);
  const kinds = (counts.crlf > 0 ? 1 : 0) + (counts.lf > 0 ? 1 : 0) + (counts.cr > 0 ? 1 : 0);
  const decoded: DecodedFile = { text: normaliseToLf(raw), encoding, hasBom, lineEnding };
  if (kinds > 1) decoded.mixedLineEndings = lineEndingsOf(raw);
  return decoded;
}

/** Encode `\n`-normalised text back to bytes, re-applying the recorded ending and
 *  re-emitting the BOM iff `hasBom`. */
export function encode(text: string, opts: EncodeOptions): Uint8Array {
  const nl = opts.lineEnding === 'crlf' ? '\r\n' : opts.lineEnding === 'cr' ? '\r' : '\n';
  const normalised = normaliseToLf(text);
  const bodyBytes = new TextEncoder().encode(withLineEndings(normalised, nl, opts));
  if (!opts.hasBom) return bodyBytes;
  const out = new Uint8Array(bodyBytes.length + 3);
  out[0] = BOM_0;
  out[1] = BOM_1;
  out[2] = BOM_2;
  out.set(bodyBytes, 3);
  return out;
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

/**
 * Can these bytes be read as UTF-8 without losing any of them? (043 FR-053.)
 *
 * ══ WHY THE NUL SCAN IS NOT ENOUGH, AND WHAT IT COSTS ══
 *
 * {@link isProbablyBinary} answers "is this a blob", using git's NUL heuristic. A single-byte legacy
 * encoding — Windows-1252, Latin-1 — contains no NULs at all, so it passes that scan and is treated
 * as text. {@link decode} then runs a NON-FATAL `TextDecoder`, which silently substitutes `U+FFFD`
 * for every byte it cannot read, and {@link encode} writes `EF BF BD` back. Every non-ASCII byte in
 * the file is destroyed — not just the ones near an edit.
 *
 * 006's editor path survives that because a human reads the buffer before saving it. 043's replace
 * commit writes files nobody opened, so the question has to be asked in code, and the answer to a
 * `false` is to REFUSE the file rather than to transcode it: guessing the code page is a second
 * chance to destroy the same bytes.
 */
export function isDecodableUtf8(bytes: Uint8Array): boolean {
  const start = detectEncoding(bytes).hasBom ? 3 : 0;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
    return true;
  } catch {
    return false;
  }
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
 * Heuristic: does the byte stream look like a non-text/binary file? Uses the
 * standard NUL-byte scan over the leading bytes (git's approach). Drives the
 * "cannot open as text" indication (edge case) so a binary file never becomes a
 * corrupted buffer.
 */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const start = detectEncoding(bytes).hasBom ? 3 : 0;
  const scanEnd = Math.min(bytes.length, start + 8000);
  for (let i = start; i < scanEnd; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
