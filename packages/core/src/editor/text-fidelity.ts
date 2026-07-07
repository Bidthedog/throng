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
}

export interface EncodeOptions {
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
}

/** Detect the encoding of raw bytes. This pass ships UTF-8 (± BOM `EF BB BF`). */
export function detectEncoding(bytes: Uint8Array): { encoding: EncodingId; hasBom: boolean } {
  const hasBom =
    bytes.length >= 3 && bytes[0] === BOM_0 && bytes[1] === BOM_1 && bytes[2] === BOM_2;
  return { encoding: 'utf8', hasBom };
}

/** The dominant line-ending style of a string (LF, CRLF, or CR); LF when none. */
export function detectLineEnding(text: string): LineEndingId {
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
  const counts: Record<LineEndingId, number> = { crlf, lf, cr };
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

function normaliseToLf(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Decode raw bytes: strip a BOM, decode UTF-8, normalise breaks to `\n`, and
 *  record the file's original encoding/BOM/dominant ending. */
export function decode(bytes: Uint8Array): DecodedFile {
  const { encoding, hasBom } = detectEncoding(bytes);
  const body = hasBom ? bytes.subarray(3) : bytes;
  const raw = new TextDecoder('utf-8').decode(body);
  const lineEnding = detectLineEnding(raw);
  return { text: normaliseToLf(raw), encoding, hasBom, lineEnding };
}

/** Encode `\n`-normalised text back to bytes, re-applying the recorded ending and
 *  re-emitting the BOM iff `hasBom`. */
export function encode(text: string, opts: EncodeOptions): Uint8Array {
  const nl = opts.lineEnding === 'crlf' ? '\r\n' : opts.lineEnding === 'cr' ? '\r' : '\n';
  const normalised = normaliseToLf(text);
  const withEndings = nl === '\n' ? normalised : normalised.replace(/\n/g, nl);
  const bodyBytes = new TextEncoder().encode(withEndings);
  if (!opts.hasBom) return bodyBytes;
  const out = new Uint8Array(bodyBytes.length + 3);
  out[0] = BOM_0;
  out[1] = BOM_1;
  out[2] = BOM_2;
  out.set(bodyBytes, 3);
  return out;
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
