/**
 * 043 T164 — FR-066: before and after must be TELLABLE APART in the replace preview.
 *
 * Layer: unit — moved down from the component layer, where it rendered nothing: these read the stylesheet
 * source (jsdom does not substitute `var()`), so they need neither a DOM nor a mount.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The DOM tests in `find-in-files-replace-preview.test.ts` prove a struck match and a proposed replacement are both THERE. FR-066 is the
 * separate claim that a reader can tell which is which: the original receded relative to its
 * replacement, and the replacement carrying a highlight distinct from both the original and the row
 * behind it, in every bundled theme.
 *
 * It fails today on the second half, and the collision is exact rather than a matter of degree: on
 * the row the reader is on, `.fif-row[data-current='true'] .fif-match` and `.fif-replacement` name
 * the SAME token, so the text going away and the text arriving are painted identically.
 *
 * Asserted over the stylesheet's source for the reason `find-in-files-results.test.ts` gives at its
 * own token guard — jsdom does not substitute `var()`, so a computed-style assertion here would read
 * back the literal text or nothing at all and pass either way. What the source says exactly is the
 * thing FR-066 asks: WHICH token each surface names, and whether any two of them are the same one.
 */
describe('T164 — the preview tells before from after (FR-066)', () => {
  const CSS_PATH = resolve(__dirname, '../../src/renderer/find-in-files/find-in-files.css');

  interface Rule {
    readonly selectors: readonly string[];
    readonly body: string;
  }

  function rules(): Rule[] {
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    const flat = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
      body: m[2],
    }));
  }

  function ruleFor(selector: string): string {
    const found = rules().filter((r) => r.selectors.includes(selector));
    expect(found.length, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(0);
    return found.map((r) => r.body).join('\n');
  }

  /** Every colour token any rule whose selector mentions `part` paints its background with. */
  function backgroundTokensUnder(part: string): string[] {
    const found = rules()
      .filter((r) => r.selectors.some((s) => s.includes(part)))
      .flatMap((r) => [...r.body.matchAll(/background:\s*var\(\s*--throng-colour-([a-zA-Z0-9-]+)/g)])
      .map((m) => m[1]);
    return [...new Set(found)];
  }

  it('recedes the struck original, with opacity rather than a colour', () => {
    // FR-066 names the instrument because the sheet forbids the obvious one: "recession is opacity
    // or a token — not a hex value and not a `var()` fallback". A dimmed colour would be a literal.
    const struck = ruleFor('.fif-match--struck');
    const opacity = /opacity:\s*([0-9.]+)/.exec(struck);
    expect(opacity, '.fif-match--struck states no recession').not.toBeNull();
    const value = Number((opacity as RegExpExecArray)[1]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    // Relative to its REPLACEMENT — so the replacement must not be receding too.
    expect(ruleFor('.fif-replacement')).not.toMatch(/opacity\s*:/);
  });

  it('gives the replacement a highlight no other surface on the row is using', () => {
    const replacement = ruleFor('.fif-replacement');
    const painted = /background:\s*var\(\s*--throng-colour-([a-zA-Z0-9-]+)/.exec(replacement);
    expect(painted, '.fif-replacement paints no highlight').not.toBeNull();
    const token = (painted as RegExpExecArray)[1];

    // "Distinct from the original": the original is a match, in either of the two states a match
    // has. "Distinct from the surrounding row": the row and the panel behind it, in all of theirs.
    // 060 FR-009 — a match is no longer painted by this sheet: it takes the find bar's shared
    // `.throng-search-match` rule, so THAT is the surface the replacement has to differ from.
    const sharedMatchCss = readFileSync(
      resolve(__dirname, '../../src/renderer/search/find-bar.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    const original = [
      ...new Set(
        [...sharedMatchCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter((m) => m[1].includes('.throng-search-match'))
          .flatMap((m) =>
            [...m[2].matchAll(/background:\s*var\(\s*--throng-colour-([a-zA-Z0-9-]+)/g)].map((t) => t[1]),
          ),
      ),
    ];
    const surrounding = [...backgroundTokensUnder('.fif-row'), ...backgroundTokensUnder('.fif-panel')];
    expect(original.length, 'no match rule paints a background — this guard would be vacuous')
      .toBeGreaterThan(0);
    expect(
      [...original, ...surrounding].filter((t) => t !== token),
      `the replacement is painted --throng-colour-${token}, which another surface on the same row ` +
        `also uses: [${[...original, ...surrounding].join(', ')}]`,
    ).toEqual([...original, ...surrounding]);
  });

  it('states a foreground for that highlight rather than inheriting one', () => {
    // A highlight strong enough to be distinct is strong enough to swallow the row's text colour,
    // and `color: inherit` is how that ships unnoticed. The pair has to be named together.
    expect(ruleFor('.fif-replacement')).toMatch(/color:\s*var\(\s*--throng-colour-/);
  });
});
