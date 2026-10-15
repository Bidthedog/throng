/**
 * The loader map must be TOTAL over the registry (016, SC-001 — the MVP's headline criterion).
 *
 * This is the only guard on it, and it is load-bearing. The registry test asserts which DESCRIPTORS
 * exist; the highlighting E2E opens three fixtures. A descriptor whose loader entry is missing or
 * mistyped does not throw — it degrades SILENTLY to plain text, and every other test in the suite
 * still passes. "Every language is highlighted" would be asserted nowhere and true nowhere, and the
 * way you would find out is a user opening a Kotlin file.
 *
 * A set-equality assertion is cheaper than 55 end-to-end cases and strictly stronger.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, PLAIN_TEXT_ID } from '@throng/core';
import { LANGUAGE_LOADERS, loadLanguage } from '../../src/renderer/editor/language-loaders.js';

describe('the grammar loader map covers the registry exactly (SC-001)', () => {
  it('has a loader for every registry language', () => {
    const missing = LANGUAGES.map((l) => l.id).filter((id) => !(id in LANGUAGE_LOADERS));
    expect(missing, `these languages would silently render as plain text: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('has no loader for a language the registry does not declare', () => {
    const registry = new Set(LANGUAGES.map((l) => l.id));
    const orphans = Object.keys(LANGUAGE_LOADERS).filter((id) => !registry.has(id));
    expect(orphans, `loaders for unknown languages: ${orphans.join(', ')}`).toEqual([]);
  });

  it('covers the 31 FR-001 targets and the languages 055 adds', () => {
    expect(Object.keys(LANGUAGE_LOADERS)).toHaveLength(55);
  });

  it('returns nothing for plain text — it is a first-class value, not a grammar (FR-004c)', async () => {
    await expect(loadLanguage(PLAIN_TEXT_ID)).resolves.toBeNull();
  });

  it('returns nothing — rather than throwing — for a language a later build removed (FR-005b)', async () => {
    await expect(loadLanguage('elvish')).resolves.toBeNull();
  });
});

describe('grammars stay lazily loaded (055 FR-019)', () => {
  // A STATIC import of a grammar would still pass every test above — the loader resolves either way —
  // while quietly putting that grammar in the main chunk for every user, whatever they open. The
  // source text is the only place the difference is visible.
  it('imports a grammar only inside import(), never with a static import statement', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/renderer/editor/language-loaders.ts', import.meta.url)), 'utf8');
    const staticImports = source.split('\n').filter((line) => /^\s*import\s[^(]/.test(line));
    const offending = staticImports.filter((line) => /grammars\/|legacy-modes|@codemirror\/lang-/.test(line));
    expect(offending).toEqual([]);
  });
});

describe('every loader actually RESOLVES to a grammar', () => {
  // The set-equality test above proves an entry EXISTS. This proves it WORKS: a typo'd export name
  // in a legacy StreamLanguage wrapper ('powershell' vs 'powerShell') is exactly the kind of bug
  // that survives a key check and dies at runtime, in front of a user.
  it.each(LANGUAGES.map((l) => l.id))('loads a grammar for %s', async (id) => {
    const support = await loadLanguage(id);
    expect(support, `${id} resolved to nothing`).not.toBeNull();
    expect(support!.language, `${id} produced no language`).toBeDefined();
  });
});
