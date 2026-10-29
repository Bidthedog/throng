/**
 * 059 FR-069 — the single-byte Windows code pages 1250, 1251 and 1253–1258.
 *
 * Each reads and writes exactly as Windows-1252 does: every byte read is written back unchanged, a byte the
 * code page leaves undefined makes the file unreadable in it, and a character it cannot hold refuses the save.
 * None is detected from its bytes: they are chosen, or they are the configured fallback. The expected bytes
 * below come from the published code-page tables, not from the decoder under test. Characters are built from
 * code points: an escape typed into a source file has arrived as the raw character before.
 */
import { describe, expect, it } from 'vitest';
import {
  ENCODING_CHOICES,
  UnrepresentableTextError,
  encode,
  encodingLabel,
  readText,
} from '../../src/editor/text-fidelity.js';
import type { EncodingId } from '../../src/workspace/model.js';

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

/** One letter per code page, at the byte its table puts it. */
const SAMPLE: readonly [EncodingId, number, string][] = [
  ['windows1250', 0xb3, cp(0x142)], // ł
  ['windows1251', 0xcf, cp(0x41f)], // П
  ['windows1253', 0xc1, cp(0x391)], // Α
  ['windows1254', 0xfd, cp(0x131)], // ı
  ['windows1255', 0xf9, cp(0x5e9)], // ש
  ['windows1256', 0xc7, cp(0x627)], // ا
  ['windows1257', 0xe8, cp(0x10d)], // č
  ['windows1258', 0xd0, cp(0x110)], // Đ
];

/** The bytes each code page leaves undefined. */
const HOLES: Partial<Record<EncodingId, number[]>> = {
  windows1253: [0xaa, 0xd2, 0xff],
  windows1255: [0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xfb, 0xfc, 0xff],
  windows1257: [0xa1, 0xa5],
};

const opts = (encoding: EncodingId) => ({ encoding, hasBom: false, lineEnding: 'lf' as const });

describe('the single-byte Windows code pages (059 FR-069)', () => {
  for (const [encoding, byte, ch] of SAMPLE) {
    it(`${encoding} reads its letter at ${byte.toString(16)} and writes it back`, () => {
      const r = readText(Uint8Array.of(0x41, byte, 0x0a), encoding);
      expect(r).toMatchObject({ ok: true, file: { text: `A${ch}\n`, encoding, hasBom: false } });
      expect([...encode(`A${ch}\n`, opts(encoding))]).toEqual([0x41, byte, 0x0a]);
    });

    it(`${encoding}: every defined byte round-trips exactly`, () => {
      const holes = HOLES[encoding] ?? [];
      const bytes = Uint8Array.from(
        Array.from({ length: 256 - 0x20 }, (_, i) => i + 0x20).filter((b) => !holes.includes(b)),
      );
      const r = readText(bytes, encoding);
      expect(r.ok).toBe(true);
      if (r.ok) expect([...encode(r.file.text, opts(encoding))]).toEqual([...bytes]);
    });
  }

  for (const [encoding, holes] of Object.entries(HOLES) as [EncodingId, number[]][]) {
    it(`${encoding} keeps a byte it leaves undefined as U+F700 + byte, and writes it back (FR-072)`, () => {
      for (const hole of holes) {
        const r = readText(Uint8Array.of(0x41, hole), encoding);
        expect(r).toMatchObject({ ok: true, file: { encoding, text: `A${cp(0xf700 + hole)}` } });
        if (r.ok) expect([...encode(r.file.text, opts(encoding))]).toEqual([0x41, hole]);
      }
    });
  }

  it('every byte, defined or not, round-trips in every code page (FR-072)', () => {
    const all = Uint8Array.from({ length: 256 - 0x20 }, (_, i) => i + 0x20);
    for (const [encoding] of SAMPLE) {
      const r = readText(all, encoding);
      expect(r.ok, encoding).toBe(true);
      if (r.ok) expect([...encode(r.file.text, opts(encoding))], encoding).toEqual([...all]);
    }
  });

  it('a placeholder belongs to its own code page: another one cannot write it', () => {
    expect(() => encode(cp(0xf7aa), opts('windows1252'))).toThrow(UnrepresentableTextError);
  });

  it('a character the code page cannot hold refuses the write, naming it', () => {
    expect(() => encode(`A${cp(0x391)}\n`, opts('windows1251'))).toThrow(UnrepresentableTextError);
    try {
      encode(`ab\nc${cp(0x391)}\n`, opts('windows1251'));
    } catch (e) {
      expect((e as UnrepresentableTextError).detail).toEqual({ encoding: 'windows1251', char: cp(0x391), line: 2, column: 2 });
    }
    expect(() => encode(`A${cp(0x1f600)}\n`, opts('windows1253'))).toThrow(UnrepresentableTextError);
  });

  it('a code page has no BOM: bytes that look like one are content', () => {
    const r = readText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41), 'windows1251');
    expect(r).toMatchObject({ ok: true, file: { hasBom: false } });
    if (r.ok) expect(r.file.text).toHaveLength(4);
  });

  it('the status bar names a code page alone', () => {
    expect(encodingLabel('windows1253', false)).toBe('Windows-1253');
    expect(encodingLabel('windows1250', false)).toBe('Windows-1250');
  });

  it('the lists show the Unicode encodings, then every code page with its script', () => {
    expect(ENCODING_CHOICES.map((c) => `${c.group}:${c.label}`)).toEqual([
      'unicode:UTF-8',
      'unicode:UTF-8 with BOM',
      'unicode:UTF-16 LE',
      'unicode:UTF-16 BE',
      'codepage:Windows-1250 (Central European)',
      'codepage:Windows-1251 (Cyrillic)',
      'codepage:Windows-1252 (Western European)',
      'codepage:Windows-1253 (Greek)',
      'codepage:Windows-1254 (Turkish)',
      'codepage:Windows-1255 (Hebrew)',
      'codepage:Windows-1256 (Arabic)',
      'codepage:Windows-1257 (Baltic)',
      'codepage:Windows-1258 (Vietnamese)',
    ]);
  });
});

describe('detection ends in the fallback encoding (059 FR-069)', () => {
  // Russian in Windows-1251: not valid UTF-8, not UTF-16, no NUL.
  const RUSSIAN = Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a); // Привет
  const PRIVET = cp(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442);

  it('without a fallback it is Windows-1252, as before', () => {
    expect(readText(RUSSIAN)).toMatchObject({ ok: true, file: { encoding: 'windows1252' } });
  });

  it('with a fallback the file reads in it', () => {
    expect(readText(RUSSIAN, undefined, 'windows1251')).toMatchObject({
      ok: true,
      file: { encoding: 'windows1251', text: `${PRIVET}\n` },
    });
  });

  it('a byte the fallback leaves undefined is kept: the file still reads in the fallback (FR-072)', () => {
    expect(readText(Uint8Array.of(0x41, 0xaa, 0x0a), undefined, 'windows1253')).toMatchObject({
      ok: true,
      file: { encoding: 'windows1253', text: `A${cp(0xf7aa)}\n` },
    });
  });

  it('a UTF-8 file is still UTF-8 whatever the fallback', () => {
    expect(readText(new TextEncoder().encode(`caf${cp(0xe9)}\n`), undefined, 'windows1251')).toMatchObject({
      ok: true,
      file: { encoding: 'utf8' },
    });
  });
});
