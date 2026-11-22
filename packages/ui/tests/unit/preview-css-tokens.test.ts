import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES, contrastPairingsFor } from '@throng/core';

/**
 * 044 T093 — the rendered document's colours come from theme tokens, and only from tokens whose
 * contrast every shipped theme already measures (FR-083, FR-096b, SC-005; contracts/
 * settings-bindings-tokens.md §Colour tokens).
 *
 * SC-005 is made true by construction rather than by a new measurement: every background a preview
 * paints is `editorBg`, and every text colour is `editorFg` or a `syntax*` token — each of which
 * `theme-quality.ts` already pairs with `editorBg` on every theme. So the two stylesheets are held to
 * that shape, declaration by declaration, and the pairing is checked to exist rather than assumed.
 *
 * Two files (fix round 1, item 2): the panel chrome, `preview/preview.css`, loaded eagerly and never
 * naming a provider; and the Markdown provider's own document rules,
 * `preview/providers/markdown/markdown.css`, loaded with that provider's chunk. The token rules below
 * apply to both, so both are read and checked together — a selector like `.preview-markdown` is found
 * only in the provider file, `.preview-panel` only in the chrome file, and every check below runs over
 * declarations from either.
 */
const CHROME_CSS = readFileSync(fileURLToPath(new URL('../../src/renderer/preview/preview.css', import.meta.url)), 'utf8');
const MARKDOWN_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/preview/providers/markdown/markdown.css', import.meta.url)),
  'utf8',
);
const CSS = `${CHROME_CSS}\n${MARKDOWN_CSS}`;

interface Decl {
  selector: string;
  property: string;
  value: string;
}

/** Flat declarations, with at-rule wrappers (keyframes, media) looked through. Comments removed. */
function declarations(css: string): Decl[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: Decl[] = [];
  // Innermost blocks: a selector followed by a body with no nested braces.
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (property) out.push({ selector, property, value });
    }
  }
  return out;
}

const ALL_DECLS = declarations(CSS);

/*
 * 075 FR-020 — a callout is the one place the document paints a colour of its own: its role token, on a tint
 * of that token over `editorBg`. Those rules are held to their OWN shape below (`callout rules`), and their
 * contrast is measured on exactly that tint by core's `measureCalloutContrast` (callout-theme-tokens.test.ts),
 * so every other check here runs over the rest of the document's rules, unchanged.
 */
const isCallout = (d: Decl): boolean => /\[data-callout/.test(d.selector);
const CALLOUT_DECLS = ALL_DECLS.filter(isCallout);
/*
 * 073 FR-033d (maintainer, 2026-11-22: "highlight the full line that matches the editor scroll highlight") — the sync
 * mark washes its block exactly as the editor washes its line, a passing highlight that fades: those two rules are held
 * to the editor's own declaration below (`the sync mark`), whose visibility editor-sync-mark-css.test.ts measures.
 */
const SYNC_WASH_SELECTORS = new Set(['.preview-markdown .preview-sync-mark', '.preview-markdown .preview-sync-mark--on']);
const isSyncWash = (d: Decl): boolean => SYNC_WASH_SELECTORS.has(d.selector);
const SYNC_WASH_DECLS = ALL_DECLS.filter(isSyncWash);
const DECLS = ALL_DECLS.filter((d) => !isCallout(d) && !isSyncWash(d));
/** The one colour function a callout may use: its role token, 12%, over the editor background. */
const CALLOUT_TINT = /^color-mix\(in srgb, var\(--throng-colour-(callout[A-Z][a-z]+)\) 12%, var\(--throng-colour-editorBg\)\)$/;

const NAMED_COLOURS =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight highlighttext mark marktext graytext accentcolor accentcolortext'.split(
    ' ',
  );

/** Every `--throng-colour-<token>` a value names. */
const tokensIn = (value: string): string[] => [...value.matchAll(/--throng-colour-([A-Za-z0-9]+)/g)].map((m) => m[1]);

const COLOUR_PROPERTIES = /^(color|background|background-color|border(-[a-z]+)*|outline(-color)?|text-decoration(-color)?|caret-color|column-rule(-color)?|fill|stroke|box-shadow|text-shadow|accent-color|scrollbar-color)$/;

describe('preview.css names no colour literal (FR-083)', () => {
  it('parses into declarations (guard: the checks below are not vacuous)', () => {
    expect(DECLS.length).toBeGreaterThan(20);
  });

  it('has no hex, functional or named colour anywhere — var() fallbacks included', () => {
    // The sync mark's wash is held to the editor's own declaration instead (`the sync mark`, below).
    for (const d of ALL_DECLS.filter((x) => !isSyncWash(x))) {
      if (d.property.startsWith('--')) continue;
      // Identifiers such as `--throng-colour-editorFg` are names, not colours. A callout's tint is the one
      // admitted function, and only in exactly its shape (075).
      const value = isCallout(d) && CALLOUT_TINT.test(d.value) ? 'var(--tint)' : d.value;
      const bare = value.replace(/--[A-Za-z0-9-]+/g, ' ');
      const where = `${d.selector} { ${d.property}: ${d.value} }`;
      expect(bare, where).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(bare, where).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
      for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
        expect(NAMED_COLOURS.includes(word), `${where} names the colour "${word}"`).toBe(false);
      }
    }
  });

  it('declares no custom property of its own that could smuggle a colour in', () => {
    expect(ALL_DECLS.filter((d) => d.property.startsWith('--'))).toEqual([]);
  });
});

describe('callout rules (075 FR-020)', () => {
  /** The role a selector styles: `[data-callout-role='x']`, or the neutral default on bare `[data-callout]`. */
  const roleOf = (selector: string): string => /\[data-callout-role='([a-z]+)'\]/.exec(selector)?.[1] ?? 'neutral';
  const tokenOf = (role: string): string => `callout${role.charAt(0).toUpperCase()}${role.slice(1)}`;

  it('styles all seven roles (guard: the checks below are not vacuous)', () => {
    const roles = new Set(CALLOUT_DECLS.filter((d) => d.property === 'background').map((d) => roleOf(d.selector)));
    expect([...roles].sort()).toEqual(['accent', 'danger', 'info', 'neutral', 'question', 'success', 'warning']);
  });

  it('tints each role\'s background with that role\'s own token, and nothing else', () => {
    for (const d of CALLOUT_DECLS.filter((x) => x.property === 'background' || x.property === 'background-color')) {
      expect(CALLOUT_TINT.exec(d.value)?.[1], d.selector).toBe(tokenOf(roleOf(d.selector)));
    }
  });

  it('colours a title and border with the role token, and names no token but that, editorFg, editorBg and accent', () => {
    for (const d of CALLOUT_DECLS.filter((x) => COLOUR_PROPERTIES.test(x.property))) {
      for (const token of tokensIn(d.value)) {
        if (token === 'accent') {
          expect(d.property, d.selector).toMatch(/^outline(-color)?$/);
          expect(d.selector).toMatch(/focus/);
        } else if (token !== 'editorBg' && token !== 'editorFg') {
          expect(token, `${d.selector} ${d.property}`).toBe(tokenOf(roleOf(d.selector)));
        }
      }
    }
  });
});

describe('the body is the editor-text contrast pair, in the pane text font (SC-005)', () => {
  const body = DECLS.filter((d) => d.selector === '.preview-markdown');

  it('color is exactly editorFg and background exactly editorBg', () => {
    expect(body.find((d) => d.property === 'color')?.value).toBe('var(--throng-colour-editorFg)');
    expect(body.find((d) => d.property === 'background' || d.property === 'background-color')?.value).toBe(
      'var(--throng-colour-editorBg)',
    );
  });

  it('font is the paneText role', () => {
    expect(body.find((d) => d.property === 'font-family')?.value).toBe('var(--throng-font-paneText-family)');
  });
});

describe('every colour sits on a pairing theme-quality already measures (SC-005)', () => {
  it('no rule sets a background other than editorBg', () => {
    for (const d of DECLS.filter((x) => x.property === 'background' || x.property === 'background-color')) {
      expect(d.value, d.selector).toBe('var(--throng-colour-editorBg)');
    }
  });

  it('every color is editorFg or a syntax* token', () => {
    const colours = DECLS.filter((d) => d.property === 'color');
    expect(colours.length).toBeGreaterThan(1);
    for (const d of colours) {
      expect(d.value, d.selector).toMatch(/^var\(--throng-colour-(editorFg|syntax[A-Z][A-Za-z]*)\)$/);
    }
  });

  it('every such token is paired with editorBg on every shipped theme', () => {
    const used = new Set(DECLS.filter((d) => d.property === 'color').flatMap((d) => tokensIn(d.value)));
    const themes = Object.entries(ALL_DEFAULT_THEMES);
    expect(themes.length).toBeGreaterThan(1);
    for (const [name, theme] of themes) {
      const pairs = contrastPairingsFor(theme);
      for (const token of used) {
        expect(
          pairs.some((p) => p.fg === token && p.bg === 'editorBg'),
          `${name}: ${token} on editorBg`,
        ).toBe(true);
      }
    }
  });

  it('borders and rules use the border token and nothing else', () => {
    for (const d of DECLS.filter((x) => /^border/.test(x.property) || x.property === 'column-rule')) {
      for (const token of tokensIn(d.value)) expect(token, `${d.selector} ${d.property}`).toBe('border');
    }
  });

  it('accent appears only as the focus indicator’s outline, never as a text colour', () => {
    const withAccent = DECLS.filter((d) => tokensIn(d.value).includes('accent'));
    expect(withAccent.length).toBeGreaterThan(0);
    for (const d of withAccent) {
      expect(d.property, d.selector).toMatch(/^outline(-color)?$/);
      expect(d.selector).toMatch(/focus/);
    }
  });

  it('names no colour token outside editorFg, editorBg, syntax*, border and accent', () => {
    for (const d of DECLS.filter((x) => COLOUR_PROPERTIES.test(x.property))) {
      for (const token of tokensIn(d.value)) {
        expect(token, `${d.selector} ${d.property}`).toMatch(/^(editorFg|editorBg|syntax[A-Z][A-Za-z]*|border|accent)$/);
      }
    }
  });
});

describe('each element takes the colour the editor’s Markdown highlighting gives it (highlight-style.ts)', () => {
  const find = (selectorPart: RegExp, property: string): Decl | undefined =>
    DECLS.find((d) => selectorPart.test(d.selector) && d.property === property);

  it('links are syntaxFunction, underlined', () => {
    expect(find(/\[data-throng-link\]/, 'color')?.value).toBe('var(--throng-colour-syntaxFunction)');
    expect(find(/\[data-throng-link\]/, 'text-decoration')?.value).toMatch(/underline/);
  });

  it('block quotes are syntaxComment, italic', () => {
    expect(find(/blockquote/, 'color')?.value).toBe('var(--throng-colour-syntaxComment)');
    expect(find(/blockquote/, 'font-style')?.value).toBe('italic');
  });

  it('code, inline and in blocks, uses the editor font role', () => {
    expect(find(/\bcode\b/, 'font-family')?.value).toBe('var(--throng-font-editor-family)');
  });

  it('headings are editorFg', () => {
    expect(find(/\bh1\b/, 'color')?.value ?? find(/\.preview-markdown$/, 'color')?.value).toBe(
      'var(--throng-colour-editorFg)',
    );
  });

  it('the focus indicator is drawn on the focused link', () => {
    const focus = DECLS.filter((d) => /preview-markdown__link--focused|:focus-visible/.test(d.selector));
    expect(focus.some((d) => /^outline/.test(d.property) && tokensIn(d.value).includes('accent'))).toBe(true);
  });

  it('a task item, tight or loose, draws its checkbox and no bullet (fix round 1, item 15)', () => {
    const rule = DECLS.find(
      (d) =>
        /li:has\(\s*>\s*input\[type=['"]checkbox['"]\]\s*,\s*>\s*p\s*>\s*input\[type=['"]checkbox['"]\]\s*\)/.test(d.selector) &&
        d.property === 'list-style',
    );
    expect(rule?.value).toBe('none');
  });

  it('table cells honour data-align', () => {
    for (const align of ['left', 'center', 'right']) {
      expect(find(new RegExp(`\\[data-align=["']?${align}["']?\\]`), 'text-align')?.value).toBe(align);
    }
  });
});

describe('the sync mark (073 FR-033d)', () => {
  const EDITOR_CSS = readFileSync(fileURLToPath(new URL('../../src/renderer/editor/editor.css', import.meta.url)), 'utf8');
  const editor = declarations(EDITOR_CSS);
  const valueOf = (decls: Decl[], selector: string, property: string): string | undefined =>
    decls.find((d) => d.selector === selector && d.property === property)?.value;

  it('washes its block with the editor line highlight itself, and fades as it does', () => {
    expect(valueOf(SYNC_WASH_DECLS, '.preview-markdown .preview-sync-mark--on', 'background-color')).toBe(
      valueOf(editor, '.cm-line.throng-sync-mark--on', 'background-color'),
    );
    expect(valueOf(SYNC_WASH_DECLS, '.preview-markdown .preview-sync-mark', 'transition')).toBe(
      valueOf(editor, '.cm-line.throng-sync-mark', 'transition'),
    );
  });

  // A code block scrolls sideways, so its overflow clipped the ::before bar: it never showed (maintainer, 2026-11-22).
  it('draws the bar of a block that scrolls sideways as shadows, which its overflow does not clip', () => {
    for (const selector of ['.preview-markdown--gutter pre.preview-sync-mark--on', '.preview-markdown--gutter div[data-math].preview-sync-mark--on']) {
      expect(ALL_DECLS.find((d) => d.selector.split(', ').includes(selector) && d.property === 'box-shadow')?.value, selector).toMatch(/-2em 0 0 var\(--throng-colour-border\)/);
    }
  });

  // 073 T107 (FR-033d): that bar fades as every other block's does — out over 600 ms, in over 120 ms — its colour easing
  // from the page's own background, never vanishing at once.
  it('fades the bar of a block that scrolls sideways, as every other block\'s', () => {
    const decl = (selector: string, property: string): string | undefined =>
      ALL_DECLS.find((d) => d.selector.split(', ').includes(selector) && d.property === property)?.value;
    expect(decl('.preview-markdown--gutter pre.preview-sync-mark', 'box-shadow')).toMatch(/-2em 0 0 var\(--throng-colour-editorBg\)/);
    expect(decl('.preview-markdown--gutter pre.preview-sync-mark', 'transition')).toMatch(/box-shadow 600ms/);
    expect(decl('.preview-markdown--gutter pre.preview-sync-mark--on', 'transition-duration')).toBe('120ms');
  });

  it('sets nothing else', () => {
    for (const d of SYNC_WASH_DECLS) expect(['background-color', 'transition', 'transition-duration'], d.selector).toContain(d.property);
  });
});
