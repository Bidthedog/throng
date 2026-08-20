import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { OPTIONAL_THEME_COLOUR_TOKENS, toCssVariables } from '../../src/config/theme.js';

/**
 * SC-004 — every bundled theme repaints every surface, and nothing is left stale.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/theme-sweep.e2e.ts:113` (035 T055).
 *
 * ══ WHAT THE E2E WAS ACTUALLY MEASURING ══
 *
 * It activated each of the fourteen-plus bundled themes in a real window — a config write, a
 * watcher round-trip and a repaint apiece — then read the computed custom properties back off the
 * document and compared the key sets. That is a real cost per theme, and every theme added since
 * has paid it again.
 *
 * But the property it was checking is a property of `toCssVariables`, which merges each theme over
 * the throng defaults precisely so that no token can ever be missing. Whether the fourteenth theme
 * emits the same key set as the first is decided entirely by that function and the theme
 * definitions — both pure, both in this package, neither of which the window contributes anything
 * to.
 *
 * ══ WHY THE KEY-SET EQUALITY IS THE INTERESTING ASSERTION ══
 *
 * The E2E's own comment says it, and it is worth keeping: *"a theme carrying a property no other
 * theme has is a property left behind by the theme before it"* — staleness, observed as an
 * asymmetry. That framing only makes sense when the properties are read off a live document, which
 * is why the test lived where it did. As a statement about the FUNCTION it is simpler and stronger:
 * every theme must emit the same required key set, so no ordering of theme switches can leave one
 * behind.
 *
 * What does NOT move is the E2E's other half — that the app is still painted, and that switching
 * themes repaints the real surfaces. That needs a document. `theme-sweep.e2e.ts` keeps it.
 */

const THEMES = Object.entries(ALL_DEFAULT_THEMES);

/** The keys a theme emits, minus the ones whose ABSENCE is their meaning. */
function requiredKeys(vars: Record<string, string>): string[] {
  const optional = new Set(OPTIONAL_THEME_COLOUR_TOKENS.map((t) => `--throng-colour-${t}`));
  return Object.keys(vars)
    .filter((k) => !optional.has(k))
    .sort();
}

describe('the bundled themes, as a set', () => {
  it('ships at least the fourteen the E2E counted, so this is a sweep and not one theme', () => {
    /*
     * The E2E asked the APPLICATION which themes it ships rather than listing them, so that a new
     * theme was covered the moment it existed. That property is kept here by enumerating
     * `ALL_DEFAULT_THEMES` — the same registry the shipped-defaults record is built from — rather
     * than naming any theme in this file.
     */
    expect(THEMES.length).toBeGreaterThanOrEqual(14);
  });

  it.each(THEMES)('%s leaves no required surface unpainted', (_name, theme) => {
    const vars = toCssVariables(theme);
    for (const required of [
      '--throng-colour-surface',
      // 021 / FR-023 folded the menu/dropdown card onto `surfaceActive` (`menuSurface` is gone).
      '--throng-colour-surfaceActive',
      '--throng-colour-scrollbarThumb',
      '--throng-colour-text',
      '--throng-colour-accent',
    ]) {
      expect(vars[required], `${_name} left ${required} unset`).toMatch(/^#|rgb|hsl/);
    }
  });

  it('every theme emits the SAME required key set — the staleness SC-004 forbids', () => {
    /*
     * The E2E reasoned about this as residue: a theme carrying a property no other theme has is a
     * property the PREVIOUS theme left behind. Stated about the function instead, it is the
     * condition that makes such residue impossible — if every theme emits the same keys, no
     * ordering of switches can leave one set and unoverwritten.
     */
    const [firstName, firstTheme] = THEMES[0]!;
    const baseline = requiredKeys(toCssVariables(firstTheme));
    expect(baseline.length).toBeGreaterThan(0);

    for (const [name, theme] of THEMES) {
      expect(
        requiredKeys(toCssVariables(theme)),
        `${name} does not emit the same token set as ${firstName}`,
      ).toEqual(baseline);
    }
  });

  it('emits NO property for an optional token no bundled theme sets', () => {
    /*
     * The other half of the same rule, and the reason the optional tokens are excluded above rather
     * than ignored. Their absence is their meaning — unset `iconColour` means a glyph keeps its own
     * colour, unset `menuItemHoverSurface` means the highlight follows the active project — and
     * `toCssVariables` deletes them precisely so the CSS `var(--x, fallback)` beside them can fire.
     * Emitting a merged default instead would silently disable both fallbacks for every theme.
     */
    for (const [name, theme] of THEMES) {
      const vars = toCssVariables(theme);
      for (const token of OPTIONAL_THEME_COLOUR_TOKENS) {
        const own = theme.colours?.[token];
        if (typeof own === 'string' && own.trim() !== '') continue;
        expect(
          `--throng-colour-${token}` in vars,
          `${name} emitted ${token}, which no fallback can then override`,
        ).toBe(false);
      }
    }
  });
});
