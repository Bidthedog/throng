import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V37_MOVED_COLOURS,
  buildShippedDefaults,
  planThemeValueUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * #105 — the readable editor selections reach an EXISTING install. Version 37 wrote the old selection and inactive
 * selection into every `themes/*.json`, so the additive fill cannot deliver them: 049 round 2's guarded value rewrite,
 * against a frozen record of what 37 wrote — built-ins only, per token, only where the file still holds that value.
 */
const shipped = buildShippedDefaults();

/** A built-in theme file as version 37 wrote it. */
function v37Theme(name: string): Theme {
  const theme = structuredClone(shipped.themes[name]!);
  Object.assign(theme.colours, V37_MOVED_COLOURS[name]);
  return theme;
}

describe('the version-37 selection colours #105 moved', () => {
  it('is shipped-defaults version 38', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(38);
  });

  it('records the seven recoloured themes, and only tokens whose shipped value really moved', () => {
    expect(Object.keys(V37_MOVED_COLOURS).sort()).toEqual(
      ['Bash', 'Claude', 'Snake', 'Ubuntu', 'VSCode', 'Windows Terminal', 'throng'].sort(),
    );
    for (const [name, moved] of Object.entries(V37_MOVED_COLOURS)) {
      for (const [token, was] of Object.entries(moved)) {
        expect((shipped.themes[name]!.colours as Record<string, string>)[token], `${name}.${token}`).not.toBe(was);
      }
    }
    expect(Object.isFrozen(V37_MOVED_COLOURS)).toBe(true);
  });

  it('moves every recorded token in an untouched version-37 install to today’s value', () => {
    const present = Object.fromEntries(Object.keys(V37_MOVED_COLOURS).map((n) => [n, v37Theme(n)]));
    const plans = planThemeValueUpgrade({ shipped, present });
    for (const [name, moved] of Object.entries(V37_MOVED_COLOURS)) {
      const plan = plans.find((p) => p.name === name);
      expect(plan, name).toBeDefined();
      for (const token of Object.keys(moved)) {
        expect(plan!.leaves, `${name}.${token}`).toContainEqual({
          path: `colours.${token}`,
          value: (shipped.themes[name]!.colours as Record<string, string>)[token],
        });
      }
    }
  });

  it('keeps a selection the user changed, and still moves the inactive one', () => {
    const theme = v37Theme('Bash');
    theme.colours.editorSelection = '#123456';
    const [plan] = planThemeValueUpgrade({ shipped, present: { Bash: theme } });
    expect(plan!.leaves.map((l) => l.path)).toEqual(['colours.editorSelectionInactive']);
  });

  it('never touches a custom theme holding a built-in’s version-37 colours', () => {
    expect(planThemeValueUpgrade({ shipped, present: { 'My Bash': v37Theme('Bash') } })).toEqual([]);
  });

  it('is idempotent: an upgraded install plans nothing', () => {
    const present = Object.fromEntries(Object.keys(V37_MOVED_COLOURS).map((n) => [n, structuredClone(shipped.themes[n]!)]));
    expect(planThemeValueUpgrade({ shipped, present })).toEqual([]);
  });
});
