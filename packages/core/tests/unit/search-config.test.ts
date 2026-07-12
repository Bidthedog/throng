/**
 * Feature 013 (Terminal & Editor Search) — Phase A config seam.
 *
 * Asserts the search/scrollback commands, the match-highlight colour tokens, the
 * find-bar action-control icon tokens, and the as-you-type debounce setting all
 * exist, are editor-exposed (descriptor-backed), and are legible on every bundled
 * theme (SC-005). Pure config; no OS/DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  parseKeybindings,
  type ActionId,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY, containsAbbreviation } from '../../src/config/theme-copy.js';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { contrastRatio } from '../../src/config/theme-quality.js';

/** The shared find commands (FR-017) — resolved for the active editor or terminal. */
const SEARCH_ACTIONS: ActionId[] = [
  'search.find',
  'search.findNext',
  'search.findPrevious',
  'search.close',
  'search.replace',
  'search.replaceCurrent',
  'search.replaceAll',
];

/** Terminal scrollback navigation (FR-014) — resolved while a terminal is active. */
const SCROLLBACK_ACTIONS: ActionId[] = [
  'terminal.scrollLineUp',
  'terminal.scrollLineDown',
  'terminal.scrollPageUp',
  'terminal.scrollPageDown',
  'terminal.scrollToTop',
  'terminal.scrollToBottom',
];

const NEW_ACTIONS = [...SEARCH_ACTIONS, ...SCROLLBACK_ACTIONS];

/** Match-highlight colours (FR-019) and find-bar control glyphs (FR-018). */
const NEW_COLOUR_TOKENS = ['searchMatch', 'searchMatchCurrent', 'searchMatchCurrentBorder'];
const NEW_ICON_TOKENS = [
  'search',
  'findNext',
  'findPrevious',
  'matchCase',
  'wholeWord',
  'replace',
  'replaceAll',
];

describe('013 search commands (FR-017, FR-020)', () => {
  it('ships every search & scrollback command with a default chord', () => {
    for (const action of NEW_ACTIONS) {
      const chords = DEFAULT_KEYBINDINGS.bindings[action];
      expect(chords, `${action} missing from DEFAULT_KEYBINDINGS`).toBeDefined();
      expect(chords!.length, `${action} has no default chord`).toBeGreaterThan(0);
    }
  });

  it('exposes every new command in the Key Bindings editor (SC-006, completeness)', () => {
    for (const action of NEW_ACTIONS) {
      const described = KEYBINDINGS_METADATA.filter((d) => d.key === action);
      expect(described.length, `${action} needs exactly one descriptor`).toBe(1);
      const d = described[0]!;
      expect(d.control).toBe('chord');
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.group.length).toBeGreaterThan(0);
    }
  });

  it('merges the new defaults into a user file that predates them', () => {
    const merged = parseKeybindings({ version: 1, bindings: { 'zoom.in': ['Ctrl+='] } });
    for (const action of NEW_ACTIONS) {
      expect(merged.bindings[action], `${action} not merged from defaults`).toBeDefined();
    }
  });

  it('does not collide a default chord with an existing binding in the same scope', () => {
    // Terminal-scrollback commands are only live while a terminal panel is active;
    // the shared search commands are live for either panel type. A chord may repeat
    // ACROSS disjoint scopes, but never within one.
    const scoped = (ids: string[]): string[] =>
      ids.flatMap((id) => DEFAULT_KEYBINDINGS.bindings[id] ?? []);
    const global = Object.entries(DEFAULT_KEYBINDINGS.bindings)
      .filter(([id]) => !NEW_ACTIONS.includes(id as ActionId))
      .flatMap(([, chords]) => chords);

    for (const chord of scoped(NEW_ACTIONS)) {
      expect(global, `default chord ${chord} collides with an existing binding`).not.toContain(
        chord,
      );
    }
    const mine = scoped(NEW_ACTIONS);
    expect(new Set(mine).size, 'a chord is bound to two of the new commands').toBe(mine.length);
  });
});

describe('013 match-highlight & find-bar theme tokens (FR-018, FR-019)', () => {
  it('defines the match-highlight colour tokens', () => {
    for (const token of NEW_COLOUR_TOKENS) {
      expect(THRONG_THEME.colours[token], `colours.${token} missing`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defines a themeable glyph for every find-bar action control', () => {
    for (const token of NEW_ICON_TOKENS) {
      expect(THRONG_THEME.icons[token], `icons.${token} missing`).toBeTruthy();
    }
  });

  it('gives every new token hand-written editor copy (completeness)', () => {
    const tokens = [
      ...NEW_COLOUR_TOKENS.map((t) => `colours.${t}`),
      ...NEW_ICON_TOKENS.map((t) => `icons.${t}`),
    ];
    for (const key of tokens) {
      const copy = THEME_TOKEN_COPY[key];
      expect(copy, `${key} needs THEME_TOKEN_COPY`).toBeDefined();
      expect(containsAbbreviation(copy!.label), `${key} label uses an abbreviation`).toBe(false);
      expect(
        containsAbbreviation(copy!.description),
        `${key} description uses an abbreviation`,
      ).toBe(false);
    }
  });

  it('keeps matches legible on every bundled theme (SC-005)', () => {
    for (const theme of Object.values(ALL_DEFAULT_THEMES)) {
      const fg = theme.colours.editorFg!;
      for (const token of ['searchMatch', 'searchMatchCurrent']) {
        const bg = theme.colours[token];
        expect(bg, `${theme.name} missing colours.${token}`).toBeTruthy();
        // Body text must stay readable ON a highlighted match (WCAG AA text floor).
        expect(
          contrastRatio(fg, bg!),
          `${theme.name}: editor text is illegible on colours.${token}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // The current match must be tellable from an ordinary one.
      expect(
        theme.colours.searchMatchCurrent,
        `${theme.name}: current match is identical to an ordinary match`,
      ).not.toBe(theme.colours.searchMatch);
      // Its outline must be identifiable against the fill (non-text floor).
      expect(
        contrastRatio(theme.colours.searchMatchCurrentBorder!, theme.colours.searchMatchCurrent!),
        `${theme.name}: current-match outline is invisible on its fill`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('013 as-you-type debounce setting (Principle X, SC-007)', () => {
  it('ships a sensible default within the 1000 ms budget', () => {
    const ms = DEFAULT_APP_SETTINGS.search.asYouTypeDebounceMs;
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1000);
  });

  it('parses tolerantly and falls back on rubbish', () => {
    expect(parseAppSettings({ search: { asYouTypeDebounceMs: 250 } }).search.asYouTypeDebounceMs).toBe(
      250,
    );
    expect(
      parseAppSettings({ search: { asYouTypeDebounceMs: 'soon' } }).search.asYouTypeDebounceMs,
    ).toBe(DEFAULT_APP_SETTINGS.search.asYouTypeDebounceMs);
    expect(
      parseAppSettings({ search: { asYouTypeDebounceMs: -5 } }).search.asYouTypeDebounceMs,
    ).toBe(DEFAULT_APP_SETTINGS.search.asYouTypeDebounceMs);
  });

  it('is exposed in the Settings editor (completeness)', () => {
    const d = SETTINGS_METADATA.filter((x) => x.key === 'search.asYouTypeDebounceMs');
    expect(d.length, 'search.asYouTypeDebounceMs needs exactly one descriptor').toBe(1);
    expect(d[0]!.control).toBe('number');
  });
});
