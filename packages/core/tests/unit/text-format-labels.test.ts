import { describe, it, expect } from 'vitest';
import {
  ENCODING_CHOICES,
  encodingLabel,
  isEncodingId,
  lineEndingLabel,
  refusalMessage,
} from '../../src/index.js';

/** 059 FR-031 — the words the status bar and the menus show, owned once, in core. */
describe('encodingLabel (059 FR-031)', () => {
  it('names each of the five formats', () => {
    expect(encodingLabel('utf8', false)).toBe('UTF-8');
    expect(encodingLabel('utf8', true)).toBe('UTF-8 with BOM');
    expect(encodingLabel('utf16le', true)).toBe('UTF-16 LE');
    expect(encodingLabel('utf16le', false)).toBe('UTF-16 LE');
    expect(encodingLabel('utf16be', true)).toBe('UTF-16 BE');
    expect(encodingLabel('windows1252', false)).toBe('Windows-1252');
  });
});

describe('lineEndingLabel (059 FR-031)', () => {
  it('names a uniform ending, and a mixed one by its dominant ending', () => {
    expect(lineEndingLabel('lf', false)).toBe('LF');
    expect(lineEndingLabel('crlf', false)).toBe('CRLF');
    expect(lineEndingLabel('cr', false)).toBe('CR');
    expect(lineEndingLabel('crlf', true)).toBe('Mixed (CRLF)');
  });
});

describe('ENCODING_CHOICES (059 FR-027, widened by FR-069)', () => {
  it('offers UTF-8 with and without a BOM, UTF-16 only with one, then the code pages without one', () => {
    expect(ENCODING_CHOICES.slice(0, 4).map((c) => [c.encoding, c.hasBom, c.label])).toEqual([
      ['utf8', false, 'UTF-8'],
      ['utf8', true, 'UTF-8 with BOM'],
      ['utf16le', true, 'UTF-16 LE'],
      ['utf16be', true, 'UTF-16 BE'],
    ]);
    // Every code page, named with its script, never with a BOM (the full order: text-fidelity-codepages.test.ts).
    expect(ENCODING_CHOICES.slice(4).every((c) => c.encoding.startsWith('windows') && !c.hasBom)).toBe(true);
    expect(ENCODING_CHOICES.find((c) => c.encoding === 'windows1252')?.label).toBe('Windows-1252 (Western European)');
  });
});

describe('isEncodingId', () => {
  it('accepts the Unicode ids and the nine code pages, and nothing else (FR-069)', () => {
    for (const id of ['utf8', 'utf16le', 'utf16be', 'windows1250', 'windows1252', 'windows1258']) {
      expect(isEncodingId(id)).toBe(true);
    }
    for (const id of ['utf-8', 'utf32', 'windows1249', 'windows-1252', 'shiftjis', '', 7, null]) {
      expect(isEncodingId(id)).toBe(false);
    }
  });
});

/** 059 FR-006, FR-007, FR-053 — one wording per refusal, on every path. */
describe('refusalMessage', () => {
  it('names UTF-32 rather than calling it not text', () => {
    expect(refusalMessage('utf32')).toBe('This file is UTF-32, which throng does not open.');
  });

  it('keeps today’s wording for a binary file', () => {
    expect(refusalMessage('binary')).toBe('That file is not text, so it cannot be opened in an editor.');
  });

  it('names the encoding a file could not be read in', () => {
    expect(refusalMessage('not-decodable', 'utf8')).toBe('That file is not valid UTF-8 text.');
    expect(refusalMessage('not-decodable', 'utf16be')).toBe('That file is not valid UTF-16 BE text.');
  });
});
