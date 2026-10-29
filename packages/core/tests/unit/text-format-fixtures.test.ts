import { describe, it, expect } from 'vitest';
import { detectTextFormat } from '../../src/editor/text-fidelity.js';
import {
  BINARY_FIXTURES,
  BOM_UTF16BE,
  BOM_UTF16LE,
  TEXT_FIXTURES,
  UTF32BE,
  UTF32LE,
  concat,
  utf16,
} from '../fixtures/text-formats.js';

/**
 * 059 FR-002 — one detection function, one precedence table.
 *
 * Every row of the table is a fixture here, because the precedence is exactly what a caller asking
 * its own questions gets wrong: `FF FE 00 00` begins with the UTF-16 LE BOM, and UTF-16 text is full
 * of the zero bytes the binary heuristic looks for.
 */
describe('detectTextFormat (059 FR-002) — every text fixture lands on its encoding', () => {
  for (const [name, f] of Object.entries(TEXT_FIXTURES)) {
    it(`${name} → ${f.encoding}${f.hasBom ? ' + BOM' : ''}`, () => {
      expect(detectTextFormat(f.bytes)).toEqual({
        kind: 'text',
        encoding: f.encoding,
        hasBom: f.hasBom,
      });
    });
  }

  it('an empty file is UTF-8 without a BOM, like a new document', () => {
    expect(detectTextFormat(new Uint8Array(0))).toEqual({
      kind: 'text',
      encoding: 'utf8',
      hasBom: false,
    });
  });

  it('a file that is only a UTF-16 BOM is an empty document of that byte order', () => {
    expect(detectTextFormat(Uint8Array.from(BOM_UTF16LE))).toEqual({
      kind: 'text',
      encoding: 'utf16le',
      hasBom: true,
    });
    expect(detectTextFormat(Uint8Array.from(BOM_UTF16BE))).toEqual({
      kind: 'text',
      encoding: 'utf16be',
      hasBom: true,
    });
  });
});

describe('detectTextFormat — refusals', () => {
  it('UTF-32 is named, and its BOM is checked before UTF-16 LE’s (FR-003, FR-006)', () => {
    expect(detectTextFormat(UTF32LE)).toEqual({ kind: 'refused', reason: 'utf32' });
    expect(detectTextFormat(UTF32BE)).toEqual({ kind: 'refused', reason: 'utf32' });
  });

  for (const [name, bytes] of Object.entries(BINARY_FIXTURES)) {
    it(`${name} is binary, never UTF-16 text (SC-003)`, () => {
      expect(detectTextFormat(bytes)).toEqual({ kind: 'refused', reason: 'binary' });
    });
  }

  it('a UTF-16 BOM over bytes that are not UTF-16 is refused as not decodable, naming the encoding', () => {
    // An odd trailing byte: a BOM is a claim, and the bytes do not keep it.
    const bytes = concat(BOM_UTF16LE, utf16('ab', 'le'), [0x41]);
    expect(detectTextFormat(bytes)).toEqual({
      kind: 'refused',
      reason: 'not-decodable',
      encoding: 'utf16le',
    });
  });

  it('BOM-less bytes with an odd length are never taken for UTF-16', () => {
    // Without a BOM nothing claimed UTF-16, so a failed confirmation falls through to binary.
    const bytes = concat(utf16('hello', 'le'), [0x41]);
    expect(detectTextFormat(bytes)).toEqual({ kind: 'refused', reason: 'binary' });
  });
});

describe('detectTextFormat — determinism and reach (FR-004, FR-005)', () => {
  it('the same bytes give the same answer every time', () => {
    const f = TEXT_FIXTURES.utf16leNoBom.bytes;
    const first = detectTextFormat(f);
    for (let i = 0; i < 5; i++) expect(detectTextFormat(f)).toEqual(first);
  });

  it('the zero-byte scans read no further than the leading 8,000 bytes', () => {
    // 8,000 bytes of plain ASCII, then a NUL. The NUL is valid UTF-8, and it lies past the window the
    // binary heuristic reads — so the file is UTF-8 text, as it was before this feature.
    const bytes = concat('a'.repeat(8000), [0x00], 'tail');
    expect(detectTextFormat(bytes)).toEqual({ kind: 'text', encoding: 'utf8', hasBom: false });
  });

  it('Windows-1252 is the fallback only for bytes that are not valid UTF-8', () => {
    expect(detectTextFormat(concat('café'))).toEqual({
      kind: 'text',
      encoding: 'utf8',
      hasBom: false,
    });
    expect(detectTextFormat(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toEqual({
      kind: 'text',
      encoding: 'windows1252',
      hasBom: false,
    });
  });
});
