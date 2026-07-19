import { describe, it, expect } from 'vitest';
import { THEME_TOKEN_COPY, BANNED_ABBREVIATIONS, containsAbbreviation } from '../../src/config/theme-copy.js';
import {
  themeEditableTokens,
  mechanicalCopy,
  THEME_METADATA,
  THEME_PROPERTY_VOCABULARY,
  assertNamingConvention,
} from '../../src/config/theme-metadata.js';
import { filterFields } from '../../src/config/settings-search.js';
import type { FieldDescriptor } from '../../src/config/metadata.js';
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

  it('ships the editing-mode glyphs the preferences toggle needs (015, FR-009c)', () => {
    // The UI⇄JSON toggle was text ("{ }" / "UI") — the last un-themeable control in the
    // window. It needs two tokens of its own: `fileJson`/`fileCode` mean "a JSON/code FILE"
    // in the explorer tree, so reusing them would re-skin the toolbar by accident.
    expect(THRONG_THEME.icons.editJson, 'icons.editJson').toBeDefined();
    expect(THRONG_THEME.icons.editVisual, 'icons.editVisual').toBeDefined();
    expect(THEME_TOKEN_COPY['icons.editJson']).toBeDefined();
    expect(THEME_TOKEN_COPY['icons.editVisual']).toBeDefined();
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

describe('naming & description convention (US5, FR-018/019/020)', () => {
  it('THEME_PROPERTY_VOCABULARY is a non-empty closed list of property words', () => {
    expect(Array.isArray(THEME_PROPERTY_VOCABULARY)).toBe(true);
    expect(THEME_PROPERTY_VOCABULARY.length).toBeGreaterThan(0);
    // the properties the spot-checked labels close on must be members
    for (const p of ['Background', 'Text', 'Font Size', 'Surface']) {
      expect(THEME_PROPERTY_VOCABULARY, p).toContain(p);
    }
  });

  it('the whole shipped registry satisfies the convention guard', () => {
    expect(() => assertNamingConvention(THEME_METADATA)).not.toThrow();
  });

  it('rejects a label with no context (bare property), naming the token', () => {
    const bare: FieldDescriptor = {
      key: 'colours.appBg',
      label: 'Size',
      description: 'A perfectly long and element-naming sentence about the app background.',
      group: 'General',
      control: 'colour',
    };
    expect(() => assertNamingConvention([bare])).toThrowError(/colours\.appBg/);
  });

  it('rejects a self-referential description, naming the token', () => {
    const selfRef: FieldDescriptor = {
      key: 'colours.accent',
      label: 'Primary Accent',
      description: 'The "X" colour token.',
      group: 'General',
      control: 'colour',
    };
    expect(() => assertNamingConvention([selfRef])).toThrowError(/colours\.accent/);
  });

  it('applies the specific relabels from data-model §3', () => {
    const label = (key: string): string =>
      THEME_METADATA.find((d) => d.key === key)!.label;
    expect(label('typography.editor.sizePx')).toBe('Editor Font Size');
    expect(label('colours.terminalFg')).toBe('Terminal Text');
    expect(label('colours.accentText')).toBe('Highlighted Option Text');
    expect(label('colours.surface')).toBe('Panel Surface');
    expect(label('colours.sidebarBg')).toBe('Side Panel Background');
  });

  it('SC-005: every token stays reachable by its key AND its new label after the renames', () => {
    for (const d of THEME_METADATA) {
      const byKey = filterFields(d.key, THEME_METADATA, () => '');
      expect(byKey.some((f) => f.key === d.key), `key ${d.key}`).toBe(true);
      const byLabel = filterFields(d.label, THEME_METADATA, () => '');
      expect(byLabel.some((f) => f.key === d.key), `label "${d.label}" (${d.key})`).toBe(true);
    }
  });
});
