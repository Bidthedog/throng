/**
 * 059 FR-068 — does a file detected as UTF-8 look like Windows-1252 text read as UTF-8?
 *
 * Windows-1252 bytes form valid UTF-8 only where an accented capital (C2–DF) is followed by a symbol
 * (80–BF), and each such pair decodes to one character in U+0080–U+07FF — mostly IPA, Greek, Cyrillic,
 * Armenian, Hebrew, Arabic or Syriac, landing in the middle of a Latin word. So the tell is a word that
 * mixes an ASCII letter with a letter from U+0250–U+07FF, in a file holding no character from U+0800 up
 * (which no such pair can produce). Text is built from code points: an escape typed into a source file has
 * arrived as the raw character before.
 */
import { describe, expect, it } from 'vitest';
import { misreadSuspect } from '../../src/editor/misread-hint.js';

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
/** Windows-1252 bytes read as UTF-8: what `misread-1252.txt` shows. */
const asUtf8 = (bytes: number[]): string => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe('misreadSuspect (059 FR-068)', () => {
  it('flags Windows-1252 accent-and-symbol pairs read as UTF-8 inside Latin words', () => {
    // CAFÉ™ → C9 99 → U+0259; HÔTEL•PARIS → D4 95 → U+0515; SEÑOR’S → D1 92 → U+0452.
    expect(misreadSuspect(asUtf8([...ascii('CAF'), 0xc9, 0x99, ...ascii(' - the brand\n')]))).toBe(true);
    expect(misreadSuspect(asUtf8([...ascii('H'), 0xd4, 0x95, ...ascii('TEL PARIS\n')]))).toBe(true);
    expect(misreadSuspect(asUtf8([...ascii('SE'), 0xd1, 0x92, ...ascii('OR MENU\n')]))).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(misreadSuspect('plain ASCII\nsecond line\n')).toBe(false);
    expect(misreadSuspect(`na${cp(0xef)}ve caf${cp(0xe9)} Z${cp(0xfc)}rich\n`)).toBe(false); // accented Latin
    expect(misreadSuspect(`${cp(0x3b1, 0x3b2, 0x3b3)} and ${cp(0x43f, 0x440, 0x438)}\n`)).toBe(false); // whole Greek and Cyrillic words
    expect(misreadSuspect('')).toBe(false);
  });

  it('does not flag double-encoded UTF-8, which reopening as Windows-1252 would only make worse', () => {
    expect(misreadSuspect(`caf${cp(0xc3, 0xa9)} ${cp(0xc3, 0xbc)}ber\n`)).toBe(false); // cafÃ© Ã¼ber
  });

  it('does not flag text holding a character from U+0800 up, which no Windows-1252 pair produces', () => {
    expect(misreadSuspect(`CAF${cp(0x259)} costs 5${cp(0x20ac)}\n`)).toBe(false); // € is U+20AC
    expect(misreadSuspect(`CAF${cp(0x259)} ${cp(0x1f600)}\n`)).toBe(false);
  });
});
