import { describe, it, expect } from 'vitest';
import {
  detectEncoding,
  detectLineEnding,
  decode,
  encode,
  newDocumentDefaults,
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
