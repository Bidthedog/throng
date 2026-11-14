import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V30_MOVED_ICONS,
  buildShippedDefaults,
  planThemeValueUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 067 hand-test round (maintainer, 2026-11-10): every default icon becomes a monochrome glyph. Every
 * version up to 30 wrote the old emoji into each built-in `themes/*.json`, so an existing install kept
 * drawing them. This is 060's guarded value rewrite again, against a frozen record of what 30 wrote.
 */
const shipped = buildShippedDefaults();

/** A built-in theme file as version 30 wrote it. */
function v30Theme(name: string): Theme {
  const theme = structuredClone(shipped.themes[name]!);
  Object.assign(theme.icons, V30_MOVED_ICONS);
  return theme;
}

describe('the version-30 icons 067’s hand-test round moved', () => {
  it('is shipped-defaults version 31', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(33);
  });

  it('records only glyphs whose shipped value really moved, and is frozen', () => {
    for (const [token, was] of Object.entries(V30_MOVED_ICONS)) {
      expect(shipped.themes.throng!.icons[token], token).not.toBe(was);
    }
    expect(Object.keys(V30_MOVED_ICONS)).toEqual(
      expect.arrayContaining(['resourceMonitor', 'resourceCpu', 'resourceMemory', 'settings', 'paste', 'warning']),
    );
    expect(Object.isFrozen(V30_MOVED_ICONS)).toBe(true);
  });

  it('moves every recorded glyph in an untouched version-30 install, in every built-in theme', () => {
    const present = Object.fromEntries(Object.keys(shipped.themes).map((n) => [n, v30Theme(n)]));
    const plans = planThemeValueUpgrade({ shipped, present });
    for (const name of Object.keys(shipped.themes)) {
      const plan = plans.find((p) => p.name === name);
      expect(plan, name).toBeDefined();
      for (const token of Object.keys(V30_MOVED_ICONS)) {
        expect(plan!.leaves, `${name}.${token}`).toContainEqual({
          path: `icons.${token}`,
          value: shipped.themes[name]!.icons[token],
        });
      }
    }
  });

  it('keeps a glyph the user set, and still moves the others', () => {
    const theme = v30Theme('throng');
    theme.icons.resourceCpu = 'C';
    const [plan] = planThemeValueUpgrade({ shipped, present: { throng: theme } });
    expect(plan!.leaves.map((l) => l.path)).not.toContain('icons.resourceCpu');
    expect(plan!.leaves.map((l) => l.path)).toContain('icons.resourceMemory');
  });

  it('never touches a custom theme', () => {
    expect(planThemeValueUpgrade({ shipped, present: { 'My throng': v30Theme('throng') } })).toEqual([]);
  });

  it('is idempotent: an upgraded install plans nothing', () => {
    const present = { throng: structuredClone(shipped.themes.throng!) };
    expect(planThemeValueUpgrade({ shipped, present })).toEqual([]);
  });
});
