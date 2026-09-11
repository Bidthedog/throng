import { describe, it, expect } from 'vitest';
import {
  detectEncoding,
  detectLineEnding,
  decode,
  encode,
  newDocumentDefaults,
  isDecodableUtf8,
  isProbablyBinary,
} from '../../src/editor/text-fidelity.js';

const enc = new TextEncoder();
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

describe('text fidelity (006, contracts/text-fidelity.md)', () => {
  it('detects UTF-8 with and without a BOM', () => {
    expect(detectEncoding(bytes('hi'))).toEqual({ encoding: 'utf8', hasBom: false });
    expect(detectEncoding(bytes(BOM, 'hi'))).toEqual({ encoding: 'utf8', hasBom: true });
  });

  it('detects the dominant line ending', () => {
    expect(detectLineEnding('a\nb\nc')).toBe('lf');
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('crlf');
    expect(detectLineEnding('a\rb\rc')).toBe('cr');
    // mixed → dominant (2 crlf vs 1 lf)
    expect(detectLineEnding('a\r\nb\r\nc\nd')).toBe('crlf');
    // no endings → lf
    expect(detectLineEnding('single line')).toBe('lf');
  });

  it('decode strips the BOM, normalises to \\n, and records metadata', () => {
    const d = decode(bytes(BOM, 'a\r\nb'));
    expect(d).toEqual({ text: 'a\nb', encoding: 'utf8', hasBom: true, lineEnding: 'crlf' });
  });

  it('round-trips byte-identical for an unedited UTF-8+BOM+CRLF file', () => {
    const original = bytes(BOM, 'line1\r\nline2\r\n');
    const d = decode(original);
    const out = encode(d.text, d);
    expect([...out]).toEqual([...original]);
  });

  it('round-trips byte-identical for an unedited UTF-8/no-BOM/LF file', () => {
    const original = bytes('line1\nline2\n');
    const d = decode(original);
    expect([...encode(d.text, d)]).toEqual([...original]);
  });

  it('detects + preserves a CR-only file', () => {
    const original = bytes('a\rb\rc');
    const d = decode(original);
    expect(d.lineEnding).toBe('cr');
    expect([...encode(d.text, d)]).toEqual([...original]);
  });

  it('a single-line edit only changes that line (CRLF preserved on untouched lines)', () => {
    const original = bytes('one\r\ntwo\r\nthree\r\n');
    const d = decode(original); // text = 'one\ntwo\nthree\n'
    const edited = d.text.replace('two', 'TWO');
    const out = encode(edited, d);
    expect(new TextDecoder().decode(out)).toBe('one\r\nTWO\r\nthree\r\n');
  });

  it('newDocumentDefaults = UTF-8/no-BOM/<default ending>', () => {
    expect(newDocumentDefaults('lf')).toEqual({ encoding: 'utf8', hasBom: false, lineEnding: 'lf' });
    expect(newDocumentDefaults('crlf')).toEqual({
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'crlf',
    });
  });

  it('flags a NUL-containing (binary) stream and passes clean text', () => {
    expect(isProbablyBinary(new Uint8Array([0x48, 0x00, 0x49]))).toBe(true);
    expect(isProbablyBinary(bytes('plain text file'))).toBe(false);
    expect(isProbablyBinary(bytes(BOM, 'text with bom'))).toBe(false);
  });
});

/**
 * 043 — the NUL scan is not a text test, and a write path that treats it as one destroys bytes.
 *
 * `isProbablyBinary` is git's heuristic and answers "is this a blob". A single-byte legacy encoding
 * — Windows-1252, Latin-1 — contains NO NULs, so it passes that scan, and `decode` then runs a
 * NON-FATAL `TextDecoder`, which turns every byte outside ASCII into `U+FFFD`. Round-tripped
 * through `encode` those become `EF BF BD` on disk: the whole file's accented text destroyed, in a
 * file the user never opened, with no undo.
 *
 * 006's editor path is protected by a human reading the buffer before saving it. 043's replace
 * commit has no such step, so the decodability question has to be asked in code.
 */
describe('isDecodableUtf8 (043 FR-053) — the question the NUL scan does not answer', () => {
  /** `café\ncolour\n` in Windows-1252: the `é` is a lone `0xE9`, and there is no NUL anywhere. */
  const WINDOWS_1252 = new Uint8Array([
    0x63, 0x61, 0x66, 0xe9, 0x0a, 0x63, 0x6f, 0x6c, 0x6f, 0x75, 0x72, 0x0a,
  ]);

  it('the NUL scan calls a Windows-1252 file text, because it is not binary', () => {
    // Anti-vacuity: the guard that already exists genuinely lets this file through, which is why a
    // second one is needed rather than a tightened first.
    expect(isProbablyBinary(WINDOWS_1252)).toBe(false);
  });

  it('refuses bytes that are not valid UTF-8', () => {
    expect(isDecodableUtf8(WINDOWS_1252)).toBe(false);
    // A truncated multi-byte sequence, and a bare continuation byte.
    expect(isDecodableUtf8(new Uint8Array([0x61, 0xc3]))).toBe(false);
    expect(isDecodableUtf8(new Uint8Array([0x80]))).toBe(false);
  });

  it('accepts real UTF-8, with and without a BOM, and empty input', () => {
    expect(isDecodableUtf8(bytes('café — colour'))).toBe(true);
    expect(isDecodableUtf8(bytes(BOM, 'café'))).toBe(true);
    expect(isDecodableUtf8(new Uint8Array(0))).toBe(true);
  });

  it('shows what the non-fatal decode would have written back', () => {
    // Not a requirement — the cost, stated once so the guard above is not mistaken for caution.
    const wrecked = encode(decode(WINDOWS_1252).text, decode(WINDOWS_1252));
    expect([...wrecked.subarray(0, 7)]).toEqual([0x63, 0x61, 0x66, 0xef, 0xbf, 0xbd, 0x0a]);
  });
});

/**
 * 043 FR-056 — a file that MIXES line endings comes back mixed.
 *
 * `detectLineEnding` records the dominant ending and `encode` re-applies it to every break, so a
 * mostly-CRLF file with three LF lines is rewritten end to end and `git diff` shows every line
 * changed. 006 could live with that because the user had the file open and could see it; 043
 * reaches files nobody opened, so the churn is invisible until it lands in a diff.
 *
 * The per-break record is kept ONLY when the file actually mixes, so the overwhelmingly common
 * uniform file allocates nothing and the shape of `DecodedFile` for it is unchanged.
 */
describe('mixed line endings survive a round trip (043 FR-056)', () => {
  const MIXED = 'one\r\ntwo\nthree\r\nfour\r';

  it('records nothing extra for a uniform file', () => {
    expect(decode(bytes('a\r\nb\r\n')).mixedLineEndings).toBeUndefined();
    expect(decode(bytes('a\nb\n')).mixedLineEndings).toBeUndefined();
    expect(decode(bytes('no endings at all')).mixedLineEndings).toBeUndefined();
  });

  it('records each break of a mixed file, in order', () => {
    expect(decode(bytes(MIXED)).mixedLineEndings).toEqual(['crlf', 'lf', 'crlf', 'cr']);
    // The dominant ending is still reported, unchanged — the editor path reads only that.
    expect(decode(bytes(MIXED)).lineEnding).toBe('crlf');
  });

  it('round-trips a mixed file byte-identically', () => {
    const original = bytes(MIXED);
    const d = decode(original);
    expect([...encode(d.text, d)]).toEqual([...original]);
  });

  it('preserves every OTHER line’s ending when one line’s text is edited', () => {
    const d = decode(bytes(MIXED));
    const out = encode(d.text.replace('two', 'TWO'), d);
    expect(new TextDecoder().decode(out)).toBe('one\r\nTWO\nthree\r\nfour\r');
  });

  it('falls back to the dominant ending when the line count no longer matches', () => {
    // A replacement that adds or removes a line makes the positional record meaningless. Falling
    // back is the honest answer; guessing which break the new line inherited is not.
    const d = decode(bytes(MIXED));
    const out = encode(d.text.replace('two\n', 'two\nextra\n'), d);
    expect(new TextDecoder().decode(out)).toBe('one\r\ntwo\r\nextra\r\nthree\r\nfour\r\n');
  });
});
