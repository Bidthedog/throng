import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V25_MOVED_ICONS,
  buildShippedDefaults,
  planThemeValueUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 060 T036 — the icon glyphs the hand-test round moved (FR-011a, FR-011b, FR-001a) reach an EXISTING
 * install. Every version up to 25 wrote the old glyphs into each built-in `themes/*.json`, so the
 * additive fill cannot deliver the new ones: this is 043's guarded value rewrite against a frozen
 * record of what 25 wrote — built-ins only, per token, and only where the file still holds that glyph.
 */
const shipped = buildShippedDefaults();

/** A built-in theme file as version 25 wrote it. */
function v25Theme(name: string): Theme {
  const theme = structuredClone(shipped.themes[name]!);
  Object.assign(theme.icons, V25_MOVED_ICONS);
  return theme;
}

describe('the version-25 icons 060’s hand-test round moved', () => {
  it('is shipped-defaults version 26 or later (re-pinned: 060 #532 bumps it to 27)', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(27);
  });

  it('records only glyphs whose shipped value really moved, and is frozen', () => {
    for (const [token, was] of Object.entries(V25_MOVED_ICONS)) {
      expect(shipped.themes.throng!.icons[token], token).not.toBe(was);
    }
    expect(Object.keys(V25_MOVED_ICONS)).toEqual(
      expect.arrayContaining(['search', 'folder', 'folderOpen', 'file', 'busy', 'groupFolderTree']),
    );
    expect(Object.isFrozen(V25_MOVED_ICONS)).toBe(true);
  });

  it('moves every recorded glyph in an untouched version-25 install, in every built-in theme', () => {
    const present = Object.fromEntries(Object.keys(shipped.themes).map((n) => [n, v25Theme(n)]));
    const plans = planThemeValueUpgrade({ shipped, present });
    for (const name of Object.keys(shipped.themes)) {
      const plan = plans.find((p) => p.name === name);
      expect(plan, name).toBeDefined();
      for (const token of Object.keys(V25_MOVED_ICONS)) {
        expect(plan!.leaves, `${name}.${token}`).toContainEqual({
          path: `icons.${token}`,
          value: shipped.themes[name]!.icons[token],
        });
      }
    }
  });

  it('keeps a glyph the user set, and still moves the others', () => {
    const theme = v25Theme('throng');
    theme.icons.folder = 'F';
    const [plan] = planThemeValueUpgrade({ shipped, present: { throng: theme } });
    expect(plan!.leaves.map((l) => l.path)).not.toContain('icons.folder');
    expect(plan!.leaves.map((l) => l.path)).toContain('icons.search');
  });

  it('never touches a custom theme', () => {
    expect(planThemeValueUpgrade({ shipped, present: { 'My throng': v25Theme('throng') } })).toEqual([]);
  });

  it('is idempotent: an upgraded install plans nothing', () => {
    const present = { throng: structuredClone(shipped.themes.throng!) };
    expect(planThemeValueUpgrade({ shipped, present })).toEqual([]);
  });
});
