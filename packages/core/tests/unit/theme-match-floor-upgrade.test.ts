import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V19_MOVED_COLOURS,
  buildShippedDefaults,
  planThemeValueUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 049 T060 — the colours iterate round 2 moved (FR-009a, FR-025a) reach an EXISTING install. Version 19 wrote
 * them into every `themes/*.json`, so the additive fill cannot deliver them; this is 043's guarded value rewrite
 * again, against a frozen record of what version 19 wrote: built-ins only, per token, and only where the file
 * still holds that exact value.
 */
const shipped = buildShippedDefaults();

/** A built-in theme file as version 19 wrote it: today's theme with every moved token set back to its v19 value. */
function v19Theme(name: string): Theme {
  const theme = structuredClone(shipped.themes[name]!);
  Object.assign(theme.colours, V19_MOVED_COLOURS[name]);
  return theme;
}

describe('the version-19 colours 049 round 2 moved', () => {
  it('is shipped-defaults version 20', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(20);
  });

  it('records only tokens whose shipped value really moved, so the guard can never compare a value with itself', () => {
    const names = Object.keys(V19_MOVED_COLOURS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      for (const [token, was] of Object.entries(V19_MOVED_COLOURS[name]!)) {
        expect((shipped.themes[name]!.colours as Record<string, string>)[token], `${name}.${token}`).not.toBe(was);
      }
    }
    expect(Object.isFrozen(V19_MOVED_COLOURS)).toBe(true);
  });

  it('includes the four themes the maintainer named and the hand-authored throng', () => {
    for (const name of ['Snake', 'VI-VIM', 'English Garden', 'throng']) expect(V19_MOVED_COLOURS[name], name).toBeDefined();
  });

  it('moves every recorded token in an untouched version-19 install to today’s value', () => {
    const present = Object.fromEntries(Object.keys(V19_MOVED_COLOURS).map((n) => [n, v19Theme(n)]));
    const plans = planThemeValueUpgrade({ shipped, present });
    for (const name of Object.keys(V19_MOVED_COLOURS)) {
      const plan = plans.find((p) => p.name === name);
      expect(plan, name).toBeDefined();
      for (const token of Object.keys(V19_MOVED_COLOURS[name]!)) {
        expect(plan!.leaves, `${name}.${token}`).toContainEqual({
          path: `colours.${token}`,
          value: (shipped.themes[name]!.colours as Record<string, string>)[token],
        });
      }
    }
  });

  it('keeps a colour the user changed, and still moves the others', () => {
    const theme = v19Theme('English Garden');
    (theme.colours as Record<string, string>)['searchMatch'] = '#123456';
    const [plan] = planThemeValueUpgrade({ shipped, present: { 'English Garden': theme } });
    expect(plan!.leaves.map((l) => l.path)).not.toContain('colours.searchMatch');
    expect(plan!.leaves.map((l) => l.path)).toContain('colours.editorSelectionInactive');
  });

  it('never touches a custom theme, even one holding a built-in’s version-19 colours', () => {
    expect(planThemeValueUpgrade({ shipped, present: { 'My Snake': v19Theme('Snake') } })).toEqual([]);
  });

  it('is idempotent: an upgraded install plans nothing', () => {
    const present = { Snake: structuredClone(shipped.themes.Snake!) };
    expect(planThemeValueUpgrade({ shipped, present })).toEqual([]);
  });
});
