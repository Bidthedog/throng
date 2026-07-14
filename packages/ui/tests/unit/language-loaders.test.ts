/**
 * The loader map must be TOTAL over the registry (016, SC-001 — the MVP's headline criterion).
 *
 * This is the only guard on it, and it is load-bearing. The registry test asserts 31 DESCRIPTORS
 * exist; the highlighting E2E opens three fixtures. A descriptor whose loader entry is missing or
 * mistyped does not throw — it degrades SILENTLY to plain text, and every other test in the suite
 * still passes. "Every one of the 31 languages is highlighted" would be asserted nowhere and true
 * nowhere, and the way you would find out is a user opening a Kotlin file.
 *
 * A set-equality assertion is cheaper than 31 end-to-end cases and strictly stronger.
 */
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

  it('covers all 31 FR-001 targets', () => {
    expect(Object.keys(LANGUAGE_LOADERS)).toHaveLength(31);
  });

  it('returns nothing for plain text — it is a first-class value, not a grammar (FR-004c)', async () => {
    await expect(loadLanguage(PLAIN_TEXT_ID)).resolves.toBeNull();
  });

  it('returns nothing — rather than throwing — for a language a later build removed (FR-005b)', async () => {
    await expect(loadLanguage('elvish')).resolves.toBeNull();
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
