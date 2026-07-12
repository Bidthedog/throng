/**
 * SC-009 (015) — the application has exactly ONE notion of "shipped default".
 *
 * It used to have two: feature 010's authoritative record, and a set of helpers that
 * resolved defaults straight from the DEFAULT_* / ALL_DEFAULT_THEMES constants. They
 * drifted — the constants lack throng's bundled `iconPack`, so the per-tab reset and the
 * per-theme restore silently produced *different* themes. Feature 015 retires the second
 * source; this test is what stops it coming back.
 */
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';

describe('one notion of "shipped default"', () => {
  it('no longer exports the editor-compiled defaults helpers', () => {
    const retired = ['resetCurrentSettings', 'resetCurrentKeybindings', 'resetCurrentTheme', 'isBuiltInTheme'];
    for (const name of retired) {
      expect(name in core, `${name} must be retired in favour of buildShippedDefaults()`).toBe(false);
    }
  });

  it('still exports the shipped record and the session undo it did NOT replace', () => {
    // `revertAll` is a session undo, not a defaults reset — a different concept entirely,
    // and it survives untouched (FR-012).
    expect(typeof core.buildShippedDefaults).toBe('function');
    expect(typeof core.isReservedThemeName).toBe('function');
    expect(typeof core.revertAll).toBe('function');
  });
});
