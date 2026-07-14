/**
 * Language registry invariants (016, FR-001/FR-002b/FR-004a).
 *
 * The registry is the feature's open/closed extension point: a new language is a new
 * descriptor and nothing else changes. These are the invariants that keep it usable —
 * a suffix claimed by two descriptors makes detection ambiguous, and a duplicate id
 * makes a persisted override resolve to the wrong language.
 */
import { describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  PLAIN_TEXT_ID,
  languageById,
  type LanguageDescriptor,
} from '../../src/editor/languages.js';

/** The 31 targets FR-001 enumerates: 17 programming, 6 markup/styling, 8 data/config/docs. */
const FR_001_TARGETS = [
  // Programming (17)
  'csharp', 'c', 'cpp', 'rust', 'go', 'python', 'javascript', 'typescript', 'java',
  'kotlin', 'swift', 'dart', 'php', 'ruby', 'lua', 'powershell', 'shell',
  // Markup & styling (6)
  'html', 'css', 'sass', 'less', 'vue', 'xml',
  // Data, config & documentation (8)
  'json', 'jsonc', 'yaml', 'toml', 'ini', 'markdown', 'sql', 'jupyter',
] as const;

describe('language registry (FR-004)', () => {
  it('declares all 31 FR-001 targets, and exactly those', () => {
    expect(FR_001_TARGETS).toHaveLength(31);
    const ids = LANGUAGES.map((l) => l.id).sort();
    expect(ids).toEqual([...FR_001_TARGETS].sort());
  });

  it('has a unique id per descriptor', () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never lets two descriptors claim the same extension (FR-004a)', () => {
    const owner = new Map<string, string>();
    for (const lang of LANGUAGES) {
      for (const ext of lang.extensions) {
        const previous = owner.get(ext);
        expect(previous, `${ext} claimed by both ${previous} and ${lang.id}`).toBeUndefined();
        owner.set(ext, lang.id);
      }
    }
  });

  it('claims every extension as a dot-prefixed, lower-case suffix', () => {
    for (const lang of LANGUAGES) {
      expect(lang.extensions.length, lang.id).toBeGreaterThan(0);
      for (const ext of lang.extensions) {
        expect(ext.startsWith('.'), `${lang.id}: ${ext}`).toBe(true);
        expect(ext, `${lang.id}: ${ext}`).toBe(ext.toLowerCase());
      }
    }
  });

  it('gives .h to C++ by fiat (FR-004a) — a header is ambiguous, and the tie is decided once', () => {
    const owners = LANGUAGES.filter((l) => l.extensions.includes('.h')).map((l) => l.id);
    expect(owners).toEqual(['cpp']);
  });

  it('leaves `filenames` empty for every descriptor — the shape is RESERVED, not used (FR-002b)', () => {
    for (const lang of LANGUAGES) {
      expect(lang.filenames ?? [], lang.id).toHaveLength(0);
    }
  });

  it('names every descriptor for a human (the picker and the status strip show it)', () => {
    for (const lang of LANGUAGES) {
      expect(lang.name.length, lang.id).toBeGreaterThan(0);
    }
  });

  it('carries Jupyter as its own descriptor, not an extension hung off JSON (data-model A1)', () => {
    const jupyter = languageById('jupyter');
    expect(jupyter?.extensions).toContain('.ipynb');
    expect(languageById('json')?.extensions).not.toContain('.ipynb');
  });

  it('is NOT itself a language: plain text is a first-class value, outside the registry', () => {
    expect(PLAIN_TEXT_ID).toBe('plaintext');
    expect(LANGUAGES.map((l) => l.id)).not.toContain(PLAIN_TEXT_ID);
  });

  it('overrides indentation only where the convention differs from the 2-space global default', () => {
    const withIndent = LANGUAGES.filter((l): l is LanguageDescriptor & { indent: object } =>
      l.indent !== undefined,
    ).map((l) => l.id);
    expect(withIndent.sort()).toEqual(
      ['c', 'cpp', 'csharp', 'go', 'java', 'kotlin', 'php', 'powershell', 'python', 'rust', 'shell', 'sql', 'swift'].sort(),
    );
    expect(languageById('go')?.indent).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
    expect(languageById('python')?.indent).toEqual({ style: 'spaces', indentWidth: 4, tabWidth: 4 });
  });

  it('resolves a descriptor by id, and nothing for an unknown one', () => {
    expect(languageById('rust')?.name).toBe('Rust');
    expect(languageById('klingon')).toBeUndefined();
  });
});
