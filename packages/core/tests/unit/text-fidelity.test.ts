import { describe, it, expect } from 'vitest';
import {
  detectTextFormat,
  detectLineEnding,
  decode,
  readText,
  encode,
  findUnrepresentable,
  newDocumentDefaults,
  TextRefusedError,
  UnrepresentableTextError,
} from '../../src/editor/text-fidelity.js';
import {
  CP1252_ALL_BYTES,
  CP1252_SAMPLE,
  CP1252_SAMPLE_TEXT,
  TEXT_FIXTURES,
  BOM_UTF16LE,
  concat,
  utf16,
} from '../fixtures/text-formats.js';

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
    expect(detectTextFormat(bytes('hi'))).toEqual({ kind: 'text', encoding: 'utf8', hasBom: false });
    expect(detectTextFormat(bytes(BOM, 'hi'))).toEqual({
      kind: 'text',
      encoding: 'utf8',
      hasBom: true,
    });
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

  it('refuses a NUL-containing (binary) stream and reads clean text', () => {
    expect(detectTextFormat(new Uint8Array([0x48, 0x00, 0x49]))).toEqual({ kind: 'refused', reason: 'binary' });
    expect(detectTextFormat(bytes('plain text file'))).toMatchObject({ kind: 'text', encoding: 'utf8' });
    expect(detectTextFormat(bytes(BOM, 'text with bom'))).toMatchObject({ kind: 'text', encoding: 'utf8', hasBom: true });
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
describe('a file that is not UTF-8 and not binary (043 FR-053, 059 FR-002) — the question the NUL scan does not answer', () => {
  /** `café\ncolour\n` in Windows-1252: the `é` is a lone `0xE9`, and there is no NUL anywhere. */
  const WINDOWS_1252 = new Uint8Array([
    0x63, 0x61, 0x66, 0xe9, 0x0a, 0x63, 0x6f, 0x6c, 0x6f, 0x75, 0x72, 0x0a,
  ]);

  it('is text, and is not UTF-8 — so it is read as Windows-1252, never as lossy UTF-8', () => {
    expect(detectTextFormat(WINDOWS_1252)).toMatchObject({ kind: 'text', encoding: 'windows1252' });
    // A truncated multi-byte sequence, and a bare continuation byte: not UTF-8 either.
    expect(detectTextFormat(new Uint8Array([0x61, 0xc3]))).toMatchObject({ encoding: 'windows1252' });
    expect(detectTextFormat(new Uint8Array([0x80]))).toMatchObject({ encoding: 'windows1252' });
  });

  it('reads real UTF-8 as UTF-8, with and without a BOM, and empty input', () => {
    expect(detectTextFormat(bytes('café — colour'))).toMatchObject({ encoding: 'utf8', hasBom: false });
    expect(detectTextFormat(bytes(BOM, 'café'))).toMatchObject({ encoding: 'utf8', hasBom: true });
    expect(detectTextFormat(new Uint8Array(0))).toMatchObject({ encoding: 'utf8' });
  });

  it('decodes such a file as Windows-1252 and writes it back byte for byte (059 FR-002, FR-020)', () => {
    // Before 059 this round trip wrote `EF BF BD` for the `é` — the whole file's accented text
    // destroyed. The file is now read in its own encoding instead.
    const d = decode(WINDOWS_1252);
    expect(d.encoding).toBe('windows1252');
    expect(d.text).toBe('café\ncolour\n');
    expect([...encode(d.text, d)]).toEqual([...WINDOWS_1252]);
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

const EF_BF_BD = (b: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xef && b[i + 1] === 0xbf && b[i + 2] === 0xbd) n++;
  return n;
};

/** 059 FR-011 / SC-001 — every supported format round-trips byte-identically when unedited. */
describe('every format round-trips (059 FR-011, SC-001)', () => {
  for (const [name, f] of Object.entries(TEXT_FIXTURES)) {
    it(`${name} comes back byte for byte`, () => {
      const d = decode(f.bytes);
      expect({ encoding: d.encoding, hasBom: d.hasBom }).toEqual({
        encoding: f.encoding,
        hasBom: f.hasBom,
      });
      expect([...encode(d.text, d)]).toEqual([...f.bytes]);
    });
  }

  it('a mixed-ending UTF-16 file keeps every line’s ending', () => {
    const original = concat(BOM_UTF16LE, utf16('a\r\nb\nc\r\n', 'le'));
    const d = decode(original);
    expect(d.mixedLineEndings).toEqual(['crlf', 'lf', 'crlf']);
    expect([...encode(d.text, d)]).toEqual([...original]);
  });

  it('a one-line edit changes only that line’s bytes in UTF-16 BE (FR-012)', () => {
    const d = decode(TEXT_FIXTURES.utf16beBom.bytes);
    const out = encode(d.text.replace('line two', 'LINE TWO'), d);
    const expected = concat([0xfe, 0xff], utf16('héllo wörld\r\nσ LINE TWO\r\n', 'be'));
    expect([...out]).toEqual([...expected]);
  });

  it('decodes the readable text of each format', () => {
    expect(decode(TEXT_FIXTURES.powershell.bytes).text).toBe('héllo\n');
    expect(decode(CP1252_SAMPLE).text).toBe(CP1252_SAMPLE_TEXT);
  });
});

describe('Windows-1252 round-trips every byte value (059 FR-013, SC-002)', () => {
  it('0x01–0xFF, including the five values the code page leaves undefined', () => {
    const d = decode(CP1252_ALL_BYTES);
    expect(d.encoding).toBe('windows1252');
    expect([...encode(d.text, d)]).toEqual([...CP1252_ALL_BYTES]);
  });

  it('a lone NUL is still binary, so the 256th value is covered by a forced decode', () => {
    const withNul = Uint8Array.from([0x00, 0x80, 0x81, 0x8d, 0x8f, 0x90, 0x9d, 0xff]);
    const d = decode(withNul, 'windows1252');
    expect([...encode(d.text, d)]).toEqual([...withNul]);
  });
});

describe('a forced encoding decodes losslessly or refuses (059 FR-014)', () => {
  it('Windows-1252 bytes reopened as UTF-8 are refused, naming UTF-8', () => {
    expect(readText(CP1252_SAMPLE, 'utf8')).toEqual({
      ok: false,
      reason: 'not-decodable',
      encoding: 'utf8',
    });
    expect(() => decode(CP1252_SAMPLE, 'utf8')).toThrow(TextRefusedError);
  });

  it('an odd byte count is not UTF-16', () => {
    expect(readText(Uint8Array.from([0x68, 0x00, 0x69]), 'utf16le')).toEqual({
      ok: false,
      reason: 'not-decodable',
      encoding: 'utf16le',
    });
  });

  it('an unpaired surrogate is not UTF-16', () => {
    // D800 with nothing after it: a high surrogate that never finds its low half.
    expect(readText(Uint8Array.from([0x00, 0xd8, 0x41, 0x00]), 'utf16le')).toMatchObject({
      ok: false,
      reason: 'not-decodable',
    });
  });

  it('a forced UTF-16 read keeps the BOM it finds', () => {
    const r = readText(TEXT_FIXTURES.utf16leBom.bytes, 'utf16le');
    expect(r).toMatchObject({ ok: true, file: { encoding: 'utf16le', hasBom: true } });
  });

  it('any bytes at all can be read as Windows-1252', () => {
    expect(readText(concat('café'), 'windows1252')).toMatchObject({
      ok: true,
      file: { encoding: 'windows1252', text: 'cafÃ©' },
    });
  });

  it('a detected refusal is returned, not thrown, by readText', () => {
    expect(readText(Uint8Array.from([0xff, 0xfe, 0x00, 0x00]))).toEqual({
      ok: false,
      reason: 'utf32',
    });
  });
});

describe('nothing writes a replacement character that was not there (059 FR-020, FR-021, SC-004)', () => {
  it('no fixture gains EF BF BD through decode → encode', () => {
    for (const f of [...Object.values(TEXT_FIXTURES).map((x) => x.bytes), CP1252_ALL_BYTES]) {
      const d = decode(f);
      expect(EF_BF_BD(encode(d.text, d))).toBe(EF_BF_BD(f));
    }
  });

  it('a character Windows-1252 cannot hold is refused, not substituted', () => {
    const d = decode(CP1252_SAMPLE);
    expect(() => encode('café\nsmile 😀\n', d)).toThrow(UnrepresentableTextError);
  });

  it('a lone surrogate is refused in every encoding, UTF-8 included', () => {
    for (const encoding of ['utf8', 'utf16le', 'utf16be', 'windows1252'] as const) {
      expect(() =>
        encode('a\ud800b', { encoding, hasBom: false, lineEnding: 'lf' }),
      ).toThrow(UnrepresentableTextError);
    }
  });
});

describe('findUnrepresentable (059 FR-021, FR-022)', () => {
  it('names the first character Windows-1252 cannot hold, with its 1-based line and column', () => {
    expect(findUnrepresentable('ok\nstill ok €\nbad 😀 and ✓', 'windows1252')).toEqual({
      encoding: 'windows1252',
      char: '😀',
      line: 3,
      column: 5,
    });
  });

  it('finds nothing in text the encoding holds', () => {
    expect(findUnrepresentable('café £5 € — “quoted”', 'windows1252')).toBeNull();
    expect(findUnrepresentable('anything 😀 at all', 'utf8')).toBeNull();
    expect(findUnrepresentable('anything 😀 at all', 'utf16be')).toBeNull();
  });

  it('a lone surrogate is unrepresentable everywhere', () => {
    expect(findUnrepresentable('x\udc00', 'utf8')).toMatchObject({ line: 1, column: 2 });
  });

  it('the error carries the same detail', () => {
    try {
      encode('a\n😀', { encoding: 'windows1252', hasBom: false, lineEnding: 'lf' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnrepresentableTextError);
      expect((e as UnrepresentableTextError).detail).toEqual({
        encoding: 'windows1252',
        char: '😀',
        line: 2,
        column: 1,
      });
    }
  });
});
