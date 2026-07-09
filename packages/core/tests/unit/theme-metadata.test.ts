import { describe, it, expect } from 'vitest';
import {
  THEME_METADATA,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { assertEveryKeyDescribed, auditRegistry } from '../../src/config/metadata.js';
import { THRONG_THEME } from '../../src/config/theme.js';

describe('THEME_METADATA completeness (FR-038/047)', () => {
  const tokens = themeEditableTokens(THRONG_THEME);

  it('describes every editable theme token and no unknown keys', () => {
    expect(() => assertEveryKeyDescribed(tokens, THEME_METADATA)).not.toThrow();
    expect(auditRegistry(tokens, THEME_METADATA)).toEqual({ missing: [], unknown: [], duplicated: [] });
  });

  it('exposes a font-family control for every typography role + the base family (H4, FR-038)', () => {
    // Every typography role — even those that do NOT pin a family in the default.
    for (const role of Object.keys(THRONG_THEME.typography ?? {})) {
      const key = `typography.${role}.family`;
      const desc = THEME_METADATA.find((d) => d.key === key);
      expect(desc, key).toBeDefined();
      expect(desc!.control, key).toBe('font-family');
    }
    expect(THEME_METADATA.find((d) => d.key === 'fonts.family')?.control).toBe('font-family');
  });

  it('covers the button colour + font tokens (H5, FR-046a/047)', () => {
    for (const key of ['colours.buttonBg', 'colours.buttonText', 'colours.buttonHoverBg', 'colours.buttonHoverText']) {
      const desc = THEME_METADATA.find((d) => d.key === key);
      expect(desc, key).toBeDefined();
      expect(desc!.control, key).toBe('colour');
    }
    expect(THEME_METADATA.find((d) => d.key === 'typography.button.family')?.control).toBe('font-family');
  });

  it('has unique keys and non-empty label/description/group', () => {
    const seen = new Set<string>();
    for (const d of THEME_METADATA) {
      expect(seen.has(d.key), d.key).toBe(false);
      seen.add(d.key);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.group.length).toBeGreaterThan(0);
    }
  });
});

describe('control-type inference (FR-038)', () => {
  it('colour tokens → colour, icon tokens → icon', () => {
    expect(descriptorForThemeToken('colours.accent').control).toBe('colour');
    expect(descriptorForThemeToken('colours.appBg').group).toBe('Colours');
    expect(descriptorForThemeToken('icons.folder').control).toBe('icon');
    expect(descriptorForThemeToken('icons.terminal').group).toBe('Icons');
  });

  it('font family/size/weight/case map to the right controls', () => {
    expect(descriptorForThemeToken('fonts.family').control).toBe('font-family');
    expect(descriptorForThemeToken('fonts.baseSizePx').control).toBe('font-size');
    expect(descriptorForThemeToken('fonts.weights.normal').control).toBe('number');
    expect(descriptorForThemeToken('typography.editor.family').control).toBe('font-family');
    expect(descriptorForThemeToken('typography.paneTitle.sizePx').control).toBe('font-size');
    expect(descriptorForThemeToken('typography.tab.weight').control).toBe('number');
    const caseDesc = descriptorForThemeToken('typography.paneTitle.case');
    expect(caseDesc.control).toBe('enum');
    expect(caseDesc.allowedValues).toEqual(['original', 'title', 'lower', 'upper']);
  });

  it('every descriptor with allowedValues uses a choice control', () => {
    for (const d of THEME_METADATA) {
      if (d.allowedValues) expect(['select', 'multiselect', 'enum'], d.key).toContain(d.control);
    }
  });
});
