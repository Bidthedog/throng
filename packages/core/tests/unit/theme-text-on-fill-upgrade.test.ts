import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V38_MOVED_COLOURS,
  V39_MOVED_COLOURS,
  buildShippedDefaults,
  planThemeValueUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 078 FR-005 / FR-005a — the readable text on the accent and danger fills reaches an EXISTING install. Version 38
 * wrote the old values into every `themes/*.json`, so the additive fill cannot deliver them: the guarded value
 * rewrite again (#105's `V37_MOVED_COLOURS`), against a frozen record of what 38 wrote.
 */
const shipped = buildShippedDefaults();
const colourOf = (name: string, token: string): string | undefined =>
  (shipped.themes[name]!.colours as Record<string, string>)[token];

/** A built-in theme file as version 38 wrote it. */
function v38Theme(name: string): Theme {
  const theme = structuredClone(shipped.themes[name]!);
  Object.assign(theme.colours, V38_MOVED_COLOURS[name]);
  return theme;
}

const ON_ACCENT = ['accentText', 'confirmButtonText', 'confirmButtonHoverText', 'cancelButtonHoverText'];
const ON_DANGER = ['dangerText', 'destroyButtonText', 'destroyButtonHoverText'];
const FAMILIES = [ON_ACCENT, ON_DANGER];

describe('the version-38 text-on-fill colours 078 moved', () => {
  it('is shipped-defaults version 40', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(42);
  });

  it('moves Debian’s text on the accent from what an interim 39 build wrote — white on the crimson — to today’s', () => {
    expect(V39_MOVED_COLOURS).toEqual({ Debian: Object.fromEntries(ON_ACCENT.map((t) => [t, '#ffffff'])) });
    expect(Object.isFrozen(V39_MOVED_COLOURS)).toBe(true);
    // The interim 39 file: 38's crimson accent family, with white text on it.
    const interim = v38Theme('Debian');
    Object.assign(interim.colours, V39_MOVED_COLOURS.Debian);
    const [plan] = planThemeValueUpgrade({ shipped, present: { Debian: interim } });
    const moved = Object.fromEntries(plan!.leaves.map((l) => [l.path.replace('colours.', ''), l.value]));
    for (const token of [...Object.keys(V38_MOVED_COLOURS.Debian!), ...ON_ACCENT]) {
      expect(moved[token], `Debian.${token}`).toBe(colourOf('Debian', token));
    }
    expect(moved.accent).toBe('#ff5c8f');
    expect(moved.accentText).toBe('#000000');
  });

  it('records what 38 wrote: text on the accent fill of five themes, on SUBNET’s danger fill, three selections and Debian’s accent', () => {
    const onAccent = (was: string): Record<string, string> => Object.fromEntries(ON_ACCENT.map((t) => [t, was]));
    expect(V38_MOVED_COLOURS).toEqual({
      VSCode: onAccent('#1e1e1e'),
      'English Garden': onAccent('#f0f4e8'),
      Debian: {
        ...onAccent('#1a1a1a'),
        accent: '#d70a53',
        attentionMark: '#d70a53',
        terminalCursor: '#d70a53',
        editorCursor: '#d70a53',
        searchMatchCurrent: '#5c142e',
        searchMatchCurrentBorder: '#d44477',
        editorSelectionInactive: '#29171e',
        activePanelBorder: '#d5316b',
        activePanelBorderInactive: '#7d2b48',
        confirmButtonBg: '#d70a53',
        confirmButtonHoverBg: '#d70a53',
        confirmButtonBorder: '#d70a53',
        confirmButtonHoverBorder: '#d70a53',
        cancelButtonHoverBg: '#d70a53',
        editorStatusStripHover: '#542737',
        linkUnderline: '#d70a53',
        linkUnderlineHover: '#d70a53',
      },
      SUBNET: Object.fromEntries(ON_DANGER.map((t) => [t, '#ffffff'])),
      Gothic: { ...onAccent('#140f16'), editorSelection: '#3a2540', editorSelectionInactive: '#2d121d' },
      'VI-VIM': { ...onAccent('#1c1c1c'), editorSelection: '#5f5f00', editorSelectionInactive: '#343412' },
      Matrix: { editorSelection: '#0f4f0f', editorSelectionInactive: '#051c05' },
    });
    expect(Object.isFrozen(V38_MOVED_COLOURS)).toBe(true);
  });

  it('records only tokens whose shipped value really moved, and moves each family together', () => {
    for (const [name, moved] of Object.entries(V38_MOVED_COLOURS)) {
      for (const family of FAMILIES) {
        const recorded = family.filter((token) => token in moved);
        if (recorded.length === 0) continue;
        expect(recorded, `${name}: a family moves whole`).toEqual(family);
        expect(new Set(recorded.map((token) => colourOf(name, token))).size, `${name}: one value per family`).toBe(1);
      }
      for (const [token, was] of Object.entries(moved)) expect(colourOf(name, token), `${name}.${token}`).not.toBe(was);
    }
  });

  it('moves every recorded token in an untouched version-38 install to today’s value', () => {
    const present = Object.fromEntries(Object.keys(V38_MOVED_COLOURS).map((n) => [n, v38Theme(n)]));
    const plans = planThemeValueUpgrade({ shipped, present });
    for (const [name, moved] of Object.entries(V38_MOVED_COLOURS)) {
      const plan = plans.find((p) => p.name === name);
      expect(plan, name).toBeDefined();
      for (const token of Object.keys(moved)) {
        expect(plan!.leaves, `${name}.${token}`).toContainEqual({ path: `colours.${token}`, value: colourOf(name, token) });
      }
    }
  });

  it('keeps a value the user changed, and still moves the rest of the family', () => {
    const theme = v38Theme('VSCode');
    theme.colours.accentText = '#123456';
    const [plan] = planThemeValueUpgrade({ shipped, present: { VSCode: theme } });
    expect(plan!.leaves.map((l) => l.path).sort()).toEqual(
      ['colours.cancelButtonHoverText', 'colours.confirmButtonHoverText', 'colours.confirmButtonText'],
    );
  });

  it('never touches a custom theme holding a built-in’s version-38 colours', () => {
    expect(planThemeValueUpgrade({ shipped, present: { 'My VSCode': v38Theme('VSCode') } })).toEqual([]);
  });

  it('is idempotent: an upgraded install plans nothing', () => {
    const present = Object.fromEntries(Object.keys(V38_MOVED_COLOURS).map((n) => [n, structuredClone(shipped.themes[n]!)]));
    expect(planThemeValueUpgrade({ shipped, present })).toEqual([]);
  });
});
