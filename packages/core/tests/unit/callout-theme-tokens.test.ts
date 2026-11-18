import { describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_THEMES,
  CALLOUT_ROLES,
  CALLOUT_ROLE_TOKENS,
  CALLOUT_TYPES,
  THEME_AREA_GROUPS,
  THEME_METADATA,
  calloutContrastFailures,
  calloutTint,
  measureCalloutContrast,
} from '../../src/index.js';

/**
 * 075 FR-020 – FR-023, SC-002 — the seven callout colour roles as theme tokens: in every shipped theme, in their
 * own Themes-editor area, described by the types they colour, and legible on their own tint.
 */
describe('callout role tokens (075 FR-020 – FR-022)', () => {
  it('names one colour token per role', () => {
    expect(CALLOUT_ROLES.map((role) => CALLOUT_ROLE_TOKENS[role])).toEqual([
      'calloutNeutral', 'calloutInfo', 'calloutAccent', 'calloutSuccess', 'calloutQuestion', 'calloutWarning', 'calloutDanger',
    ]);
  });

  it('is defined by every shipped theme, as a colour of its own', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      for (const role of CALLOUT_ROLES) {
        expect(theme.colours[CALLOUT_ROLE_TOKENS[role]], `${name}: ${role}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('gives each theme its own values', () => {
    const warnings = new Set(Object.values(ALL_DEFAULT_THEMES).map((t) => t.colours.calloutWarning));
    expect(warnings.size).toBeGreaterThan(1);
  });

  it('sits in the Markdown preview area, after Editor, in a Callouts sub-group (FR-021)', () => {
    expect(THEME_AREA_GROUPS.indexOf('Markdown preview')).toBe(THEME_AREA_GROUPS.indexOf('Editor') + 1);
    for (const role of CALLOUT_ROLES) {
      const d = THEME_METADATA.find((x) => x.key === `colours.${CALLOUT_ROLE_TOKENS[role]}`);
      expect(d?.group, role).toBe('Markdown preview · Callouts');
    }
  });

  it('describes each role by the callout types it colours (FR-021)', () => {
    for (const role of CALLOUT_ROLES) {
      const d = THEME_METADATA.find((x) => x.key === `colours.${CALLOUT_ROLE_TOKENS[role]}`);
      const description = d?.description ?? '';
      for (const entry of CALLOUT_TYPES.filter((t) => t.role === role)) {
        expect(description.toLowerCase(), `${role} names ${entry.id}`).toContain(entry.id);
      }
    }
  });
});

describe('callout contrast (FR-023, SC-002)', () => {
  it('tints over the editor background by the CSS mix', () => {
    expect(calloutTint('#ff0000', '#000000')).toBe('#1f0000');
    expect(calloutTint('#000000', '#ffffff')).toBe('#e0e0e0');
  });

  it('measures title, body and icon for every role', () => {
    const results = measureCalloutContrast(ALL_DEFAULT_THEMES[Object.keys(ALL_DEFAULT_THEMES)[0]]);
    expect(results).toHaveLength(CALLOUT_ROLES.length * 3);
    expect(results.filter((r) => r.label.includes('icon')).every((r) => r.min === 3)).toBe(true);
    expect(results.filter((r) => !r.label.includes('icon')).every((r) => r.min === 4.5)).toBe(true);
  });

  it('passes in every shipped theme, with no exemption', () => {
    const failures = Object.entries(ALL_DEFAULT_THEMES).flatMap(([name, theme]) =>
      calloutContrastFailures(theme).map((f) => `${name}: ${f.label} ${f.ratio.toFixed(2)}`),
    );
    expect(failures).toEqual([]);
  });
});
