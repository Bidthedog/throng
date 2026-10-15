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

/**
 * Could one filename be matched by both entries? With at most one `*` per entry this is decidable
 * exactly (055 research R3), so FR-006 is a proof over the registry rather than a sample of names.
 * Folder-qualified entries are matched on folder AND name, so they only meet each other.
 */
function entriesOverlap(a: string, b: string): boolean {
  if (a.includes('/') || b.includes('/')) return a === b;
  const split = (e: string): { pre: string; suf: string; wild: boolean } => {
    const star = e.indexOf('*');
    return star < 0 ? { pre: e, suf: '', wild: false } : { pre: e.slice(0, star), suf: e.slice(star + 1), wild: true };
  };
  const x = split(a);
  const y = split(b);
  if (!x.wild && !y.wild) return a === b;
  if (!x.wild || !y.wild) {
    const [name, p] = x.wild ? [b, x] : [a, y];
    return name.length >= p.pre.length + p.suf.length && name.startsWith(p.pre) && name.endsWith(p.suf);
  }
  const prefixesMeet = x.pre.startsWith(y.pre) || y.pre.startsWith(x.pre);
  const suffixesMeet = x.suf.endsWith(y.suf) || y.suf.endsWith(x.suf);
  return prefixesMeet && suffixesMeet;
}

/** The languages 055 adds (FR-011–FR-015). */
const SPEC_055_TARGETS = [
  // Known by name (US2)
  'dockerfile', 'cmake', 'groovy', 'nginx', 'dotenv', 'ignore',
  // Shipped grammars (US4)
  'diff', 'protobuf', 'fsharp', 'vb', 'vbscript', 'scala', 'perl', 'r', 'haskell', 'elm', 'erlang',
  'clojure', 'julia', 'http', 'gherkin', 'jinja', 'nsis',
  // Hand-written (US5)
  'batch',
] as const;

describe('language registry (FR-004)', () => {
  it('declares the 31 FR-001 targets plus the 055 additions, and exactly those', () => {
    expect(FR_001_TARGETS).toHaveLength(31);
    const ids = LANGUAGES.map((l) => l.id).sort();
    expect(ids).toEqual([...FR_001_TARGETS, ...SPEC_055_TARGETS].sort());
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

  it('gives every descriptor something to match — an extension, a filename, or both (055 FR-001)', () => {
    // 016 required at least one extension. 055 lets a language be matched by name alone (Dotenv,
    // the ignore files), so the invariant widens rather than disappears: a descriptor nothing can
    // detect would be reachable only through the picker.
    for (const lang of LANGUAGES) {
      expect(lang.extensions.length + (lang.filenames?.length ?? 0), lang.id).toBeGreaterThan(0);
    }
  });

  it('writes every filename entry in one of the three forms (055 FR-002–FR-004)', () => {
    for (const lang of LANGUAGES) {
      for (const entry of lang.filenames ?? []) {
        const where = `${lang.id}: ${entry}`;
        expect(entry, where).toBe(entry.toLowerCase());
        expect(entry.split('*').length - 1, where).toBeLessThanOrEqual(1);
        if (entry.includes('/')) {
          // Folder-qualified: exactly one folder, and no pattern inside it.
          expect(entry.split('/').length - 1, where).toBe(1);
          expect(entry.includes('*'), where).toBe(false);
        }
        expect(entry.includes('\\'), where).toBe(false);
      }
    }
  });

  it('never lets two languages claim filename entries one name could match (055 FR-006)', () => {
    const owned = LANGUAGES.flatMap((l) => (l.filenames ?? []).map((entry) => ({ entry, id: l.id })));
    for (let i = 0; i < owned.length; i++) {
      for (let j = i + 1; j < owned.length; j++) {
        const a = owned[i]!;
        const b = owned[j]!;
        if (a.id === b.id) continue; // same-language overlap is not a conflict
        expect(entriesOverlap(a.entry, b.entry), `${a.entry} (${a.id}) vs ${b.entry} (${b.id})`).toBe(false);
      }
    }
  });

  it('has an overlap check that can actually fail — it is not passing vacuously', () => {
    expect(entriesOverlap('.env.*', '.env.local')).toBe(true);
    expect(entriesOverlap('.env.*', '.env.*.local')).toBe(true);
    expect(entriesOverlap('tsconfig.*.json', 'tsconfig.app.json')).toBe(true);
    expect(entriesOverlap('dockerfile', 'dockerfile')).toBe(true);
    expect(entriesOverlap('.vscode/launch.json', '.vscode/launch.json')).toBe(true);
    expect(entriesOverlap('.env.*', '.envrc')).toBe(false);
    expect(entriesOverlap('dockerfile.*', 'dockerfile')).toBe(false);
    expect(entriesOverlap('.vscode/launch.json', 'launch.json')).toBe(false);
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
      [
        'c', 'cpp', 'csharp', 'go', 'java', 'kotlin', 'php', 'powershell', 'python', 'rust', 'shell', 'sql', 'swift',
        // 055 FR-021
        'groovy', 'fsharp', 'vb', 'vbscript', 'scala', 'perl', 'haskell', 'elm', 'erlang', 'julia', 'batch',
      ].sort(),
    );
    expect(languageById('go')?.indent).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
    expect(languageById('python')?.indent).toEqual({ style: 'spaces', indentWidth: 4, tabWidth: 4 });
  });

  it('resolves a descriptor by id, and nothing for an unknown one', () => {
    expect(languageById('rust')?.name).toBe('Rust');
    expect(languageById('klingon')).toBeUndefined();
  });
});
