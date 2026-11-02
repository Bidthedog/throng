/**
 * MOVED DOWN from `component/explorer-toolbar.test.ts` (pass 2): these five tests read `explorer.css` as
 * text and render nothing (043 T182a/T182b, FR-079, FR-079a).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T182a/T182b (FR-079, FR-079a) — the toolbar control's box is DERIVED
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The same defect as `.fif-btn`'s, on the control FR-065 is about.
 *
 * ══ THE TELL ══
 *
 *     16 + 3 + 3 = 22
 *
 * `.explorer-toolbar__btn` shipped `width: 22px; height: 22px`. The theme's icon size is
 * `sizes.iconPx: 16`, emitted as `--throng-size-icon`, and `.icon` sizes ITSELF from that token —
 * so 22 is the token's DEFAULT resolved by hand at authoring time and then frozen. Raise
 * `sizes.iconPx` in the Themes editor, which is a shipped control, and the glyph grows while its
 * box does not.
 *
 * A magic number equal to a token's default is a token dependency written in ARITHMETIC, and the
 * token's name appears nowhere in the rule — so no grep for `--throng-size-icon` will ever find it.
 * That is why nothing caught it, and it is why the guard is written as a prohibition on the LITERAL
 * rather than as a search for the token.
 *
 * ══ THIS IS PRINCIPLE X, NOT THE THEMEABLE-ICON RULE ══
 *
 * That NON-NEGOTIABLE asks three things of a control — its glyph comes from an icon token, it
 * carries a hover title naming its action, its colours come from theme tokens — and this control
 * passes all three, as the tests above assert. What is hardcoded is a METRIC. `sizes.iconPx` is a
 * shipped setting, and a control whose box ignores it is a setting that governs less than it claims,
 * which is the class the `settings-inertness` guards exist for.
 *
 * ══ ONE HONEST DIFFERENCE FROM `.fif-btn` ══
 *
 * `.fif-btn` sets `overflow: hidden`, so a raised `iconPx` CLIPS its glyph. This rule sets none and
 * `padding: 0`, so the glyph OVERFLOWS instead — it spills over the controls either side of it. Same
 * defect, same fix, and a DIFFERENT symptom: the user reports "the toolbar icons overlap", not "the
 * icon is cut in half", and a test claiming otherwise would send its reader hunting for a clip that
 * is not there.
 *
 * ══ WHY IT IS ORDERED BESIDE FR-065 THOUGH IT IS FR-079'S ══
 *
 * FR-065 exists because this control read as dwarfed beside Quick Open, and the fix is a heavier
 * glyph. The most natural next thing a user does after meeting that fix is reach for `sizes.iconPx`
 * to make the toolbar icons bigger — and this frozen box is exactly what would punish them for it.
 * Shipping "make this icon more prominent" beside the mechanism that penalises making icons more
 * prominent is the incoherence FR-062a is about.
 *
 * ══ WHY THE STYLESHEET IS READ AS TEXT ══
 *
 * jsdom does not resolve `var()` through the cascade and this suite reads these sheets as text
 * rather than attaching them to a document, so no layer below a real browser can produce a pixel
 * value here. The literal guard is the honest instrument. `find-in-files-results.test.ts` sets out
 * the same reasoning for the same assertion on `.fif-btn`, and it is not repeated at length there.
 */
describe('the toolbar control sizes itself from the icon token (FR-079, FR-079a)', () => {
  const EXPLORER_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/explorer/explorer.css');

  const sheet = (): string => {
    expect(existsSync(EXPLORER_CSS), `explorer.css was not found at ${EXPLORER_CSS}`).toBe(true);
    return readFileSync(EXPLORER_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  };

  /** One rule's declaration block, comments already stripped. */
  const ruleFor = (selector: string): string => {
    const css = sheet();
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} has no rule in explorer.css`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('declares no absolute pixel box metric', () => {
    const block = ruleFor('.explorer-toolbar__btn');
    const frozen = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']
      .map((metric) => new RegExp(`(?:^|[;{\\s])${metric}:\\s*([^;}]+)`).exec(block))
      .filter((m) => m !== null)
      .map((m) => m[1].trim())
      .filter((value) => /^\d+(?:\.\d+)?px$/.test(value));
    expect(
      frozen,
      '.explorer-toolbar__btn hardcodes a box metric in pixels — a raised sizes.iconPx then ' +
        'overflows it onto the controls beside it (FR-079)',
    ).toEqual([]);
  });

  it('derives both axes from --throng-size-icon', () => {
    const block = ruleFor('.explorer-toolbar__btn');
    for (const metric of ['width', 'height']) {
      const declared = new RegExp(`${metric}:\\s*([^;}]+)`).exec(block);
      expect(declared, `.explorer-toolbar__btn declares no ${metric}`).not.toBeNull();
      expect(
        declared[1],
        `.explorer-toolbar__btn's ${metric} must derive from --throng-size-icon, not from its resolved default`,
      ).toContain('var(--throng-size-icon');
    }
  });

  it('keeps a box the glyph can breathe in, so the fix is not "make it 16"', () => {
    // The shipped appearance is 22 at the default 16, and the padding is what the difference IS.
    // Deriving the box as exactly the token would shrink every control in the toolbar by six pixels
    // — a visible regression wearing a fix's clothes.
    const block = ruleFor('.explorer-toolbar__btn');
    expect(block).toMatch(/width:\s*calc\(/);
    expect(block).toMatch(/height:\s*calc\(/);
  });

  it('states no font size, which could never have sized the glyph anyway', () => {
    /*
     * A SEPARATE and smaller problem, recorded so the next reader does not mistake it for the
     * defect. `font-size: 14px` sat in this rule and governed nothing: `.icon` sets its own from
     * `--throng-size-icon`, and `theme.css` says why in as many words — "an icon has its OWN size …
     * Every icon was sized in `em`, so it inherited the font size of whatever surface it happened to
     * sit on" (018 follow-up). These buttons contain nothing but an `Icon`, which the V2 assertion
     * near the top of this file proves independently. It goes because it is dead and MISLEADING: it
     * is the line somebody would edit while trying to make a toolbar icon bigger, and it would do
     * nothing. `.fif-btn` carried the identical line and lost it for the identical reason.
     */
    expect(ruleFor('.explorer-toolbar__btn')).not.toMatch(/font-size\s*:/);
  });

  it('hardcodes no colour anywhere in the sheet', () => {
    // Not part of FR-079, and green before this task: it is here because this file now reads
    // explorer.css as text, and the sweep costs one assertion. Constitution XI — a themeable surface
    // names no colour literal, not even as a var() fallback.
    const literals = [
      ...sheet().matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...sheet().matchAll(/\b(?:rgb|rgba|hsl|hsla)\(/g),
    ].map((m) => m[0]);
    expect(literals, 'a themeable surface hardcodes no colour').toEqual([]);
  });
});
