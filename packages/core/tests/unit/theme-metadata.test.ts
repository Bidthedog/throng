import { describe, it, expect } from 'vitest';
import {
  THEME_METADATA,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { assertEveryKeyDescribed, auditRegistry } from '../../src/config/metadata.js';
import { THRONG_THEME, TYPOGRAPHY_ROLES, fieldsForRole } from '../../src/config/theme.js';

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
    // 018 / FR-034: a font SIZE is a slider. It declared bounds (6-96) and still rendered as a bare
    // text box — the descriptor disagreed with itself, and only the forward guard was watching.
    expect(descriptorForThemeToken('fonts.baseSizePx').control).toBe('slider');
    expect(descriptorForThemeToken('fonts.weights.normal').control).toBe('slider'); // 018: weights gained the CSS 100-900 range they never had
    expect(descriptorForThemeToken('typography.editor.family').control).toBe('font-family');
    expect(descriptorForThemeToken('typography.paneTitle.sizePx').control).toBe('slider');
    // A ROLE says bold or not — a TOGGLE. A numeric per-role weight promised a granularity that does
    // not exist: nearly every installed font ships two weights, so 400, 500 and 600 rendered
    // identically and the slider did nothing for two thirds of its travel. The two numbers those words
    // MEAN stay numeric, on `fonts.weights`, where a variable font's owner can still tune them.
    expect(descriptorForThemeToken('typography.tab.bold').control).toBe('toggle');
    expect(descriptorForThemeToken('fonts.weights.bold').control).toBe('slider');
    // Every role carries the FULL set, including the two that never existed on a role before.
    expect(descriptorForThemeToken('typography.tab.strikethrough').control).toBe('toggle');
    expect(descriptorForThemeToken('typography.dialog.italic').control).toBe('toggle');
    const caseDesc = descriptorForThemeToken('typography.paneTitle.case');
    expect(caseDesc.control).toBe('enum');
    expect(caseDesc.allowedValues).toEqual(['original', 'title', 'lower', 'upper']);
  });

  it('every typography role offers every attribute (not just the ones its theme pinned)', () => {
    // The editor used to expose only the fields a theme happened to PIN — so `tab: { weight: 500 }`
    // offered a weight and a family, and a tab title could not be italicised however much you wanted
    // to, because its author had not thought to italicise it first. Completeness is a property of the
    // MODEL, not a shadow of one theme's choices.
    for (const role of TYPOGRAPHY_ROLES) {
      // The TERMINAL is not HTML: xterm draws its glyphs on a canvas from a family and a size, and can
      // honour nothing else. A control that cannot possibly do anything is worse than a missing one.
      for (const field of fieldsForRole(role)) {
        const key = `typography.${role}.${field}`;
        expect(
          THEME_METADATA.find((d) => d.key === key),
          `${key} is not editable`,
        ).toBeDefined();
      }
    }
  });

  it('every descriptor with allowedValues uses a choice control', () => {
    for (const d of THEME_METADATA) {
      if (d.allowedValues) expect(['select', 'multiselect', 'enum'], d.key).toContain(d.control);
    }
  });
});
