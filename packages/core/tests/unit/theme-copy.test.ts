import { describe, it, expect } from 'vitest';
import { THEME_TOKEN_COPY, BANNED_ABBREVIATIONS, containsAbbreviation } from '../../src/config/theme-copy.js';
import { themeEditableTokens, mechanicalCopy } from '../../src/config/theme-metadata.js';
import { THRONG_THEME } from '../../src/config/theme.js';

describe('hand-written theme token copy (FR-006/007/008/009)', () => {
  const tokens = themeEditableTokens(THRONG_THEME);

  it('covers every editable token with a hand-written label and description', () => {
    for (const key of tokens) {
      const entry = THEME_TOKEN_COPY[key];
      expect(entry, `missing copy for ${key}`).toBeDefined();
      expect(entry.label.trim().length, key).toBeGreaterThan(0);
      expect(entry.description.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('has no entries for unknown tokens', () => {
    const known = new Set(tokens);
    for (const key of Object.keys(THEME_TOKEN_COPY)) {
      expect(known.has(key), `copy for unknown token ${key}`).toBe(true);
    }
  });

  it('spells words in full — no abbreviation from the blocklist', () => {
    for (const key of tokens) {
      const { label, description } = THEME_TOKEN_COPY[key];
      expect(containsAbbreviation(label), `label "${label}" (${key})`).toBe(false);
      expect(containsAbbreviation(description), `description of ${key}`).toBe(false);
    }
  });

  it('descriptions are not derivable from the identifier (not machine-generated)', () => {
    // A single-word label may legitimately equal the humanised identifier (e.g.
    // "Danger"); it is the DESCRIPTION that must not merely restate the token name.
    for (const key of tokens) {
      const machine = mechanicalCopy(key);
      const hand = THEME_TOKEN_COPY[key];
      expect(hand.description, `${key} restates the identifier`).not.toBe(machine.description);
    }
  });

  it('the blocklist catches the original mechanical abbreviations', () => {
    expect(containsAbbreviation('App bg')).toBe(true);
    expect(containsAbbreviation('Terminal fg')).toBe(true);
    expect(containsAbbreviation('Background')).toBe(false);
    expect(containsAbbreviation('Foreground')).toBe(false);
    expect(BANNED_ABBREVIATIONS).toContain('bg');
  });
});
