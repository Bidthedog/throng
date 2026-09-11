import { describe, it, expect } from 'vitest';
import { DEFAULT_THEMES, ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import PRE_REFACTOR from './fixtures/pre-refactor-theme-colours.json';

const REMOVED_TOKENS = ['menuSurface', 'dialogSurface', 'buttonBg', 'buttonText', 'buttonHoverBg', 'buttonHoverText'];
const BUTTON_TOKENS = ['confirm', 'cancel', 'destroy'].flatMap((t) =>
  ['Bg', 'HoverBg', 'Border', 'HoverBorder', 'Text', 'HoverText'].map((v) => `${t}Button${v}`),
);
/** 56 pre-refactor − 6 removed + 18 typed button tokens = 68; follow-up dropped `activePaneHighlight`
 *  (consolidated onto `activePanelBorder`) → 67 (D1). */
// 68 since 024 added `warning` — the amber cue for a warning notice, distinct from `danger`.
//
// STILL 68 after 043, and that is a decision rather than an omission (043 R15). Find in Files
// highlights its matches with `searchMatch` / `searchMatchCurrent` / `searchMatchCurrentBorder`,
// which `theme.ts` already documents as "one pair of surfaces shared by the editor and the
// terminal" — a result row is that same idea on a third surface. A new colour token here would
// need the argument `editorStatusStripBg` records for not reusing `statusBarBg`, and there is none.
const EXPECTED_COLOUR_TOKEN_COUNT = 68;
/**
 * The icon set's counterpart to the colour count above — 63 before 043, plus `findInFiles` and
 * `searchScope` (FR-029a/FR-029b, FR-030).
 *
 * It did not exist until 043 needed to update it, and the gap is worth naming: `ICON_TOKENS` below
 * is `Object.keys(THRONG_THEME.icons)`, so every icon assertion in this file walks whatever the
 * shipped set happens to hold. A token silently dropped from it would take its own assertion with
 * it and the suite would stay green — the exact drift the colour count has been guarding against
 * since D1, on the half of the theme that had no guard at all.
 */
const EXPECTED_ICON_TOKEN_COUNT = 65;
/** Tokens removed AFTER the fixture was captured — stripped from the fixture before non-drift compare. */
const REMOVED_SINCE_FIXTURE = ['activePaneHighlight'];
/**
 * Tokens ADDED since the fixture was captured.
 *
 * The guarantee this test makes is that no SURVIVING token drifted — that a refactor did not quietly
 * change a colour a user is looking at. A token that did not exist when the fixture was taken cannot
 * have drifted, and listing it here is what keeps the guard about drift rather than about the size
 * of the palette.
 */
const ADDED_SINCE_FIXTURE = ['warning'];

const EXPECTED = [
  'Light',
  'Snake',
  'Gothic',
  'Windows Terminal',
  'Bash',
  'SUBNET',
  'VSCode',
  'VI-VIM',
  'English Garden',
  'Matrix',
  'Cyberpunk',
  'Claude',
  'Debian',
  'Ubuntu',
];

const COLOUR_TOKENS = Object.keys(THRONG_THEME.colours);
const ICON_TOKENS = Object.keys(THRONG_THEME.icons);

describe('DEFAULT_THEMES (FR-044/046, SC-007)', () => {
  it('ships exactly the 14 named default themes', () => {
    expect(Object.keys(DEFAULT_THEMES).sort()).toEqual([...EXPECTED].sort());
  });

  it('every theme name matches its record key and is unique', () => {
    const names = Object.entries(DEFAULT_THEMES).map(([key, theme]) => {
      expect(theme.name).toBe(key);
      return theme.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  it('every theme styles the full colour + icon token set (FR-046)', () => {
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      for (const token of COLOUR_TOKENS) {
        expect(theme.colours[token], `${name}.colours.${token}`).toBeTruthy();
      }
      for (const token of ICON_TOKENS) {
        expect(theme.icons[token], `${name}.icons.${token}`).toBeTruthy();
      }
      expect(theme.fonts.family.length).toBeGreaterThan(0);
    }
  });

  it('every default theme populates the 18 typed button tokens and drops the 6 removed (021, US7)', () => {
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      for (const token of BUTTON_TOKENS) {
        expect(theme.colours[token], `${name}.colours.${token}`).toBeTruthy();
      }
      for (const token of REMOVED_TOKENS) {
        expect(theme.colours[token], `${name}.colours.${token} must be removed`).toBeUndefined();
      }
      expect(theme.typography?.button, `${name}.typography.button`).toBeDefined();
    }
  });

  it('every bundled theme carries the sizes baseline so per-token Reset has a shipped value (#130 follow-up)', () => {
    // `sizes.iconPx` / `sizes.scrollbarPx` are concrete measurements with concrete defaults. Left off
    // the theme, the Themes editor's Reset had no shipped leaf to compare against or restore, so it was
    // permanently disabled on every bundled theme (it only worked on `throng`, which carries the block).
    // The values are throng's own, so no theme renders differently — this is purely a reset baseline.
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(theme.sizes?.iconPx, `${name}.sizes.iconPx`).toBe(THRONG_THEME.sizes?.iconPx);
      expect(theme.sizes?.scrollbarPx, `${name}.sizes.scrollbarPx`).toBe(THRONG_THEME.sizes?.scrollbarPx);
    }
  });

  it('THRONG_THEME.colours has exactly the expected token count (D1 — no silent drift)', () => {
    expect(Object.keys(THRONG_THEME.colours)).toHaveLength(EXPECTED_COLOUR_TOKEN_COUNT);
    for (const token of BUTTON_TOKENS) expect(THRONG_THEME.colours[token], token).toBeTruthy();
    for (const token of REMOVED_TOKENS) expect(THRONG_THEME.colours[token], token).toBeUndefined();
  });

  it('THRONG_THEME.icons has exactly the expected token count (043 — no silent drift)', () => {
    expect(Object.keys(THRONG_THEME.icons)).toHaveLength(EXPECTED_ICON_TOKEN_COUNT);
    // Named as well as counted: a count alone is satisfied by a token being renamed, and a renamed
    // icon token renders as NOTHING at its call site with no error anywhere (`icon-tokens-exist`).
    expect(THRONG_THEME.icons.findInFiles, 'icons.findInFiles').toBeTruthy();
    expect(THRONG_THEME.icons.searchScope, 'icons.searchScope').toBeTruthy();
  });

  /*
   * 043 T182 (FR-065) — the Find in Files toolbar control reads at the same weight as its neighbours.
   *
   * ══ WHAT WAS ACTUALLY WRONG, AND WHY IT IS TESTABLE AT ALL ══
   *
   * The maintainer reported the control as DWARFED by Quick Open beside it. Both are drawn in the
   * same 22×22 box at the same 16 px icon size, so the box was never the problem: `findInFiles`
   * shipped as `'⌕'`, a thin monochrome OUTLINE character that a text font draws at whatever
   * stroke weight it happens to use, sitting next to `'🔎'`, a colour emoji that fills its
   * em box. That difference has a name in Unicode — **Emoji_Presentation** — and it is exactly the
   * property that decides whether a codepoint is rendered by the emoji font at full weight or by the
   * text font as a hairline. So "reads at the same visual weight" is not a matter of taste here; it
   * is one derivable property, and this is the layer that can read it.
   *
   * `EXPECTED_ICON_TOKEN_COUNT` does NOT move: this is a value change, not a token (plan D6). It
   * reaches an installed build only through the shipped-defaults version bump (T121/T123/T124), and
   * only for a theme still holding the version-6 glyph — a user who chose their own keeps it.
   *
   * ══ THE CONSTRAINT THAT PREDATES FR-065 AND IS NOT RELAXED BY IT ══
   *
   * There are THREE searches in this application, `theme.ts:427-437` says why they are held apart,
   * and two of them can appear in one toolbar. Making this one heavier must not make it a third
   * magnifier: the pair 🔍/🔎 differ only in which way the handle tilts, and a third would be told
   * apart by nothing at 16 px.
   */
  it('draws Find in Files at the same weight as the controls beside it (FR-065)', () => {
    const glyph = THRONG_THEME.icons.findInFiles;
    expect(
      /\p{Emoji_Presentation}/u.test(glyph),
      `icons.findInFiles is ${JSON.stringify(glyph)}, a text-presentation character: it is drawn ` +
        `as a hairline outline beside quickOpen's ${JSON.stringify(THRONG_THEME.icons.quickOpen)}, ` +
        `which fills its em box`,
    ).toBe(true);
    // The neighbour it is measured against, so this cannot pass by that one becoming thin too.
    expect(/\p{Emoji_Presentation}/u.test(THRONG_THEME.icons.quickOpen)).toBe(true);
  });

  it('keeps the three searches distinguishable from one another (FR-065)', () => {
    const { search, quickOpen, findInFiles } = THRONG_THEME.icons;
    expect(new Set([search, quickOpen, findInFiles]).size, 'three actions, three glyphs').toBe(3);
    // And not a third magnifier. The existing pair is told apart by the tilt of one handle; a third
    // member of that family would be told apart by nothing at all at 16 px.
    const MAGNIFIERS = ['\u{1F50D}', '\u{1F50E}', '\u{1F52C}'];
    expect(MAGNIFIERS, 'findInFiles must not be a third lens').not.toContain(findInFiles);
  });

  it('(SC-006′, F2) non-drift: every surviving token keeps its exact pre-refactor value', () => {
    // The ONLY colour changes are the deliberate button derivations. Every other token — across all 15
    // bundled themes — is byte-identical to its pre-refactor value (captured in the fixture).
    //
    // 043/FR-067 RE-SEEDED the fixture's `searchMatch` in all fifteen themes, and did so rather than
    // adding the token to a carve-out list, deliberately. The fixture records WHAT IS SHIPPED, so
    // re-seeding it is the act of shipping something else — the guarantee this test makes is "you did
    // not change a colour by accident", not "no colour ever changes". A carve-out would have retired
    // the token from the guarantee permanently; the re-seed keeps it under guard at its new value.
    //
    // The other two search-match tokens did NOT move, and that is worth reading as a result rather
    // than an omission: `searchMatchCurrent` is the accent ray 016 tuned and FR-067 leaves alone, and
    // `searchMatchCurrentBorder` is derived from it. Nor did any `syntax*` token move — the final
    // legibility lift in `syntaxAndSearch` is a no-op whenever the match surfaces are readable, and
    // the new ordinary match is chosen under exactly that constraint.
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const expected = { ...(PRE_REFACTOR as Record<string, Record<string, string>>)[name] };
      expect(expected, `fixture missing ${name}`).toBeDefined();
      // Tokens removed since the fixture was captured are not part of the non-drift guarantee.
      for (const k of REMOVED_SINCE_FIXTURE) delete expected[k];
      const surviving: Record<string, string> = {};
      for (const [k, v] of Object.entries(theme.colours)) {
        if (!BUTTON_TOKENS.includes(k) && !ADDED_SINCE_FIXTURE.includes(k)) surviving[k] = v;
      }
      expect(surviving, `${name} surviving colours drifted`).toEqual(expected);
    }
  });

  it('themes are pairwise-distinct by their colour palette (not merely vs throng)', () => {
    const themes = Object.values(ALL_DEFAULT_THEMES); // includes throng
    for (let i = 0; i < themes.length; i += 1) {
      for (let j = i + 1; j < themes.length; j += 1) {
        expect(
          JSON.stringify(themes[i].colours),
          `${themes[i].name} vs ${themes[j].name}`,
        ).not.toBe(JSON.stringify(themes[j].colours));
      }
    }
  });

  it('ALL_DEFAULT_THEMES includes throng plus the 14', () => {
    expect(Object.keys(ALL_DEFAULT_THEMES)).toContain('throng');
    expect(Object.keys(ALL_DEFAULT_THEMES)).toHaveLength(15);
  });
});

import {
  hexToRgb,
  contrastRatio,
  relativeLuminance,
  assertDistinct,
  assertInScopeContrast,
  assertMatchDistinctness,
  assertSyntaxBodyContrast,
} from '../../src/config/theme-quality.js';

/** HSL hue (degrees) of a hex colour; NaN for greys. */
function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d < 0.08) return NaN; // near-grey → no meaningful hue
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe('editor gutter tokens (009, US3/FR-010/012)', () => {
  it('every bundled theme supplies both gutter tokens', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(theme.colours.editorGutterBg, `${name}.editorGutterBg`).toBeTruthy();
      expect(theme.colours.editorGutterFg, `${name}.editorGutterFg`).toBeTruthy();
    }
  });

  it('gutter background is a visible but subtle offset from the editor body', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const bg = theme.colours.editorBg;
      const gutter = theme.colours.editorGutterBg;
      expect(gutter, `${name} gutter equals editor body`).not.toBe(bg);
      const dl = Math.abs(
        relativeLuminance(hexToRgb(bg)) - relativeLuminance(hexToRgb(gutter)),
      );
      expect(dl, `${name} gutter offset too large`).toBeLessThan(0.25); // subtle, not a slab
    }
  });

  it('default gutter text meets the 3:1 pairing on the gutter background', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const ratio = contrastRatio(theme.colours.editorGutterFg, theme.colours.editorGutterBg);
      expect(ratio, `${name} gutter text on gutter background`).toBeGreaterThanOrEqual(3.0);
    }
  });
});

describe('Bash is multi-hue and distinct from Matrix (009, US1/FR-001)', () => {
  it('Bash spans green, teal, cyan, yellow and magenta', () => {
    const hues = Object.values(ALL_DEFAULT_THEMES.Bash.colours)
      .map(hueOf)
      .filter((h) => !Number.isNaN(h));
    const inRange = (lo: number, hi: number): boolean => hues.some((h) => h >= lo && h < hi);
    expect(inRange(90, 165), 'green').toBe(true);
    expect(inRange(165, 185), 'teal').toBe(true);
    expect(inRange(185, 210), 'cyan').toBe(true);
    expect(inRange(35, 70), 'yellow').toBe(true);
    expect(inRange(285, 330), 'magenta').toBe(true);
  });

  it('Matrix keeps its mono-green identity (text/accent/terminal/editor all green)', () => {
    const c = ALL_DEFAULT_THEMES.Matrix.colours;
    // The identity tokens that define the Matrix look are all in the green band;
    // semantic tokens (danger/unsaved) may legitimately differ.
    for (const token of ['text', 'accent', 'terminalFg', 'editorFg']) {
      const h = hueOf(c[token]);
      expect(h, `Matrix ${token} hue ${h}`).toBeGreaterThanOrEqual(90);
      expect(h, `Matrix ${token} hue ${h}`).toBeLessThan(165);
    }
  });
});

describe('brand palettes (009, US4/US5)', () => {
  it('SUBNET uses Deep Space Blue as its base and both neon accents', () => {
    const c = ALL_DEFAULT_THEMES.SUBNET.colours;
    expect(c.appBg).toBe('#001B40');
    expect(c.terminalBg).toBe('#001B40');
    expect(c.editorBg).toBe('#001B40');
    expect(c.accent).toBe('#39FF14'); // Neon Core Green — active states
    expect(c.editorCursor).toBe('#00EFFF'); // Neon Cyan — second accent
    expect(c.border).toBe('#4C4C4C'); // Gunmetal Grey — chrome
  });

  it('Cyberpunk derives from its reference palette on a near-black base', () => {
    const c = ALL_DEFAULT_THEMES.Cyberpunk.colours;
    expect(c.appBg).toBe('#000000');
    expect(c.danger).toBe('#c5003c'); // crimson
    expect(c.border).toBe('#880425'); // deep maroon
    expect(c.unsavedDot).toBe('#f3e600'); // bright yellow
    expect(c.accent).toBe('#55ead4'); // pale teal
  });
});

describe('theme-quality guards hold for the shipped set (009, US6)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);
  it('all shipped themes pass the distinctness gate', () => {
    expect(() => assertDistinct(themes)).not.toThrow();
  });
  it('Bash, SUBNET and Cyberpunk pass WCAG 2.1 AA contrast', () => {
    expect(() => assertInScopeContrast(themes)).not.toThrow();
  });
  // 019/#83: the syntax hues on the editor body are gated across every shipped theme bar the
  // by-design carve-out — a different pairing set from the one IN_SCOPE_THEMES governs.
  it('every shipped theme renders code legibly on its own editor body', () => {
    expect(() => assertSyntaxBodyContrast(themes)).not.toThrow();
  });
  // 043/FR-067: the two match FILLS and the page behind them, measured against each other rather
  // than against the code drawn on top. `themes` here is ALL_DEFAULT_THEMES, which is the point —
  // hand-authored `throng` is not maintained by the derivation and is exactly what a gate scoped to
  // the derived fourteen would miss (plan D5).
  it('every shipped theme keeps its two search matches distinct from each other and the page', () => {
    expect(() => assertMatchDistinctness(themes)).not.toThrow();
  });
  it('ships the dismiss icon token distinct from destroy (009 addition)', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(theme.icons.dismiss, `${name}.icons.dismiss`).toBeTruthy();
    }
    expect(THRONG_THEME.icons.dismiss).toBe('✕');
  });

  /**
   * 031 / FR-032 (T063). The tab strip's step and show-all controls are icons drawn from the active
   * theme, so the chevrons they need must exist as tokens in EVERY shipped set — a control whose
   * token is missing renders an empty box.
   *
   * They are their OWN tokens, deliberately not `collapse`/`expand`: those mean tree-node state, and
   * sharing them would make re-skinning a tree chevron silently re-skin the tab strip. Both pairs
   * must therefore survive as four distinct keys, whatever glyphs they happen to default to.
   */
  it('ships the tab-strip chevron icon tokens, separate from collapse/expand (031, FR-032)', () => {
    const chevrons = ['chevronLeft', 'chevronRight', 'chevronDown'] as const;
    for (const token of chevrons) {
      expect(THRONG_THEME.icons[token], `THRONG_THEME.icons.${token}`).toBeTruthy();
    }
    expect(THRONG_THEME.icons.chevronLeft).toBe('‹');
    expect(THRONG_THEME.icons.chevronRight).toBe('›');
    expect(THRONG_THEME.icons.chevronDown).toBe('▾');

    // Four distinct keys — the tree-node pair is untouched and still resolvable on its own.
    for (const token of [...chevrons, 'collapse', 'expand']) {
      expect(Object.prototype.hasOwnProperty.call(THRONG_THEME.icons, token), token).toBe(true);
    }

    // Every shipped theme spreads the icon set, so all 14 resolve the new tokens.
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      for (const token of chevrons) {
        expect(theme.icons[token], `${name}.icons.${token}`).toBeTruthy();
      }
    }
  });
});
