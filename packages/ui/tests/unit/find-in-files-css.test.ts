/**
 * The Find in Files panel's stylesheet (`find-in-files.css`), read as TEXT.
 *
 * Moved from the component project: none of these renders anything. jsdom resolves no `var()`
 * through the cascade, so every claim here was already made over the sheet's source, the theme's, or
 * the theme registry — never a computed style. They come from `find-in-files-results.test.ts`
 * (FR-044 colour tokens, FR-079 icon boxes, FR-085 double-click affordance),
 * `find-in-files-panel-controls.test.ts` (FR-011 control colours), `find-in-files-typography.test.ts`
 * (FR-063/FR-064 Pane Text and weights) and `find-in-files-zoom.test.ts` (FR-062 zoom rules, R26). What
 * each of those files still renders stays in the component project.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';

const CSS_PATH = resolve(process.cwd(), 'packages/ui/src/renderer/find-in-files/find-in-files.css');
const PANEL_CSS = CSS_PATH;
const THEME_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/theme.css');

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

function read(path: string): string {
  expect(existsSync(path), `${path} was not found`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** The sheet with comments removed. */
const sheet = (): string => read(PANEL_CSS).replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every rule in a flat stylesheet, comments removed.
 *
 * Deliberately not a CSS parser: these sheets nest nothing but `@media`, and a rule inside one still
 * comes out as its own entry, which is all any assertion here asks for.
 */
function rulesOf(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !s.startsWith('@')),
    body: m[2],
  }));
}

/** The one rule in `theme.css` that hands out the Pane Text role's six variables. */
function paneTextRule(): Rule {
  const found = rulesOf(read(THEME_CSS)).filter((r) =>
    r.body.includes('--throng-font-paneText-family'),
  );
  expect(found, 'theme.css must declare exactly one Pane Text rule').toHaveLength(1);
  return found[0];
}

/** The declaration block of one selector in the panel's own sheet. */
function panelRule(selector: string): string {
  const found = rulesOf(read(PANEL_CSS)).filter((r) => r.selectors.includes(selector));
  expect(found.length, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(0);
  return found.map((r) => r.body).join('\n');
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-044 — the highlight reuses 013's tokens and hardcodes nothing
 * ────────────────────────────────────────────────────────────────────────── */

describe('the match highlight resolves from the shipped search-match tokens (FR-044)', () => {
  const css = (): string => {
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    return readFileSync(CSS_PATH, 'utf8');
  };

  it('reads searchMatch and searchMatchCurrent, which 013 already ships', () => {
    // Guard the token names themselves: a rename in `theme.ts` must break this rather than leave
    // the sheet reading a property nothing defines (which renders as no highlight, silently).
    expect(THRONG_THEME.colours.searchMatch).toBeDefined();
    expect(THRONG_THEME.colours.searchMatchCurrent).toBeDefined();

    // 060 FR-009 — the list's matches take the find bar's own rule (`.throng-search-match`, widened
    // to `.fif-results`), so the tokens are read THERE; this sheet names none of them.
    const findBar = readFileSync(
      resolve(process.cwd(), 'packages/ui/src/renderer/search/find-bar.css'),
      'utf8',
    );
    expect(findBar).toContain(':where(.cm-editor, .fif-results) .throng-search-match');
    expect(findBar).toContain('var(--throng-colour-searchMatch,');
    expect(findBar).toContain('var(--throng-colour-searchMatchCurrent,');
    const sheet = css().replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(sheet).not.toMatch(/--throng-colour-searchMatch(?:Current)?\b(?!Border)/);
  });

  it('introduces no colour token of its own', () => {
    // Every `--throng-colour-*` this sheet reads must already exist in the shipped theme. R15's
    // decision was to add NO colour token; a new one would show up here as a name the theme has
    // never heard of, which is also how it would show up on screen: as nothing at all.
    const known = new Set(Object.keys(THRONG_THEME.colours));
    const unknown = [...css().matchAll(/var\(\s*--throng-colour-([a-zA-Z0-9-]+)/g)]
      .map((m) => m[1])
      .filter((name) => !known.has(name));
    expect([...new Set(unknown)], 'colour tokens read but not shipped').toEqual([]);
  });

  it('hardcodes no colour anywhere in the sheet', () => {
    const sheet = css().replace(/\/\*[\s\S]*?\*\//g, ' ');
    const literals = [
      ...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...sheet.matchAll(/\b(?:rgb|rgba|hsl|hsla)\(/g),
    ].map((m) => m[0]);
    expect(literals, 'a themeable surface hardcodes no colour (FR-044, constitution XI)').toEqual(
      [],
    );
  });

  /*
   * T165a — FR-079, and it is the BOX, not the font size.
   *
   * `.fif-btn` ships `width: 22px; height: 22px; padding: 3px` with `overflow: hidden`, and
   *
   *     16 + 3 + 3 = 22
   *
   * is the whole finding: 16 is `sizes.iconPx`'s DEFAULT (`theme.ts:329`, emitted as
   * `--throng-size-icon`), and `.icon` sizes itself from that token. Raise it in the Themes editor —
   * a shipped control — and the glyph grows inside a box that does not, and `overflow: hidden` clips
   * it with nothing to say why. It clips at 17, the very next step.
   *
   * A magic number equal to a token's default plus its own padding is a token dependency written in
   * ARITHMETIC, which is why nothing found it: the token's name appears nowhere in the rule, so no
   * grep for `--throng-size-icon` reaches it. And this is Principle X rather than the themeable-icon
   * rule — `.fif-btn` passes that in full (an `Icon` from a token, a hover title, colours from
   * tokens, and the sweep above proving no colour literal). What is frozen is a METRIC.
   *
   * Why this layer, stated because a computed-pixel assertion is the thing a reader will look for
   * and not find: jsdom does not resolve `var()` through the cascade, and these tests read the sheet
   * as TEXT rather than attaching it to a document — so no layer below a real browser can produce a
   * pixel value here. The literal guard is the honest instrument, and it is the same one the colour
   * sweep directly above already uses.
   */
  /** One rule's declaration block, comments stripped so a commented-out figure is not "declared". */
  const ruleFor = (selector: string): string => {
    const sheet = css().replace(/\/\*[\s\S]*?\*\//g, ' ');
    const at = sheet.indexOf(`${selector} {`);
    expect(at, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(-1);
    return sheet.slice(at, sheet.indexOf('}', at));
  };

  /** FR-079 in one place: no frozen box, and what there is derives from the token. */
  const expectBoxDerivedFromTheIconToken = (selector: string, block: string): void => {
    for (const metric of ['width', 'height']) {
      const declared = new RegExp(`${metric}:\\s*([^;}]+)`).exec(block);
      expect(declared, `${selector} declares no ${metric}`).not.toBeNull();
      expect(
        (declared as RegExpExecArray)[1],
        `${selector}'s ${metric} must derive from --throng-size-icon, not from its resolved default`,
      ).toContain('var(--throng-size-icon');
    }

    // And no box metric is a frozen pixel figure. `padding` is deliberately not in this list: the
    // control's own breathing space is a design choice, not a value computed from the token — it is
    // the thing the box is derived FROM.
    const frozen = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']
      .map((metric) => new RegExp(`(?:^|[;{\\s])${metric}:\\s*([^;}]+)`).exec(block))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1].trim())
      .filter((value) => /^\d+(?:\.\d+)?px$/.test(value));
    expect(frozen, `${selector} hardcodes a box metric in pixels (FR-079)`).toEqual([]);
  };

  it('sizes its icon controls from --throng-size-icon rather than from its default (FR-079)', () => {
    const btn = ruleFor('.fif-btn');
    expectBoxDerivedFromTheIconToken('.fif-btn', btn);

    /*
     * And the inert line goes with it — a SEPARATE and smaller problem, recorded so the next reader
     * does not mistake it for the defect. `font-size: 12px` cannot size the glyph: `.icon` sets its
     * own from the token, and `theme.css` says why in as many words ("an icon has its OWN size …
     * Every icon was sized in `em`, so it inherited the font size of whatever surface it happened to
     * sit on", 018 follow-up). These buttons contain nothing but an `Icon`, so it governed nothing.
     * It goes because it is dead and misleading — it is the line somebody would edit while trying to
     * fix icon size, and it would do nothing — not because it was doing harm.
     */
    expect(btn, '.fif-btn states a font size that governs nothing').not.toMatch(/font-size\s*:/);
  });

  /*
   * The SAME defect, one rule down, and it is R31's OTHER symptom.
   *
   * `.fif-field__icon` is the glyph that labels each of the panel's three fields — the term, the
   * replacement and the scope. It is `flex: 0 0 auto; width: 16px`, and 16 is `sizes.iconPx`'s
   * default with no padding to hide behind, so the arithmetic is barer here than in `.fif-btn`:
   * the token's resolved value, copied.
   *
   * What differs is what a user SEES, and R31 tabulates the two cases precisely because a task
   * written for the wrong one sends its implementer hunting. `.fif-btn` sets `overflow: hidden`, so
   * a raised `sizes.iconPx` CLIPS the glyph. This rule sets none — so the glyph OVERFLOWS its box
   * and collides with the input beside it, and the icon that is supposed to label a field ends up
   * sitting on the text it labels.
   *
   * Why this one is taken when FR-079a left four others recorded: the other four are an inherited
   * repository-wide pattern in stylesheets this feature does not own. This one is in
   * `find-in-files.css`, which 043 WROTE — so it is not an instance of the pattern, it is a defect
   * this feature introduced, and fixing the frozen box in two controls while shipping a third in the
   * very panel being fixed is incoherent in the way FR-062a is about.
   */
  it('sizes its field glyphs from the token too — they overflow rather than clip (FR-079)', () => {
    expectBoxDerivedFromTheIconToken('.fif-field__icon', ruleFor('.fif-field__icon'));
  });

  /*
   * FR-079c — THE BOX MUST ALSO HOLD THE GLYPH, and naming the token is not the same thing.
   *
   * The two assertions above check the box's VOCABULARY: that it derives from `--throng-size-icon`
   * rather than freezing its resolved default. That was the defect FR-079 was written for, and both
   * rules now pass it. It is not sufficient, and this test exists because it was not:
   *
   *     .fif-btn { box-sizing: border-box; padding: 3px; border: 1px solid transparent;
   *                width: calc(var(--throng-size-icon) + var(--fif-btn-pad) * 2); }
   *
   * reads as `16 + 3 + 3 = 22` and is short by the BORDER. Under `border-box` the declared width
   * covers border and padding as well as content, so the content box is 22 − 2 − 6 = 14, and a 16px
   * glyph is clipped 1px on every side — at the DEFAULT icon size, with no setting touched. Measured
   * in headless Chromium against these exact declarations rather than derived from the spec:
   * content 14, glyph 16, clipped 2px total. The `16 + 3 + 3` tell that made FR-079 findable is
   * itself an incomplete sum, so the corrected form of the rule reproduced the defect exactly.
   *
   * So the check is the arithmetic, not the vocabulary: substitute the rule's own custom properties,
   * evaluate the width at a range of icon sizes, and require the CONTENT box to come out equal to
   * the token at every one of them. A rule that forgets a term fails here however it is spelled.
   *
   * `.fif-field__icon` is deliberately included: it declares no border and no padding, so its
   * content box is its width, and it passes trivially — which is the point. The assertion is about
   * every icon box in the sheet, and one that has nothing to forget should say so rather than be
   * excluded by hand.
   */
  const px = (value: string): number => Number.parseFloat(value);

  /**
   * The first px length in a declaration, with a `var()` resolved against the rule's own custom
   * properties. Both callers need that resolution, and the border needed it only AFTER the fix —
   * `border: 1px solid` became `border: var(--fif-btn-border) solid`, and a helper that read the
   * literal alone would have silently scored the border as 0 and passed the broken box. It did
   * exactly that once, which is why the two are one function now.
   */
  const lengthOf = (block: string, property: string, vars: Map<string, string>): number => {
    const declared = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`).exec(block);
    if (declared === null) return 0;
    const value = declared[1].trim();
    const viaVar = /var\((--[\w-]+)\)/.exec(value);
    const resolved = viaVar === null ? value : (vars.get(viaVar[1]) ?? '');
    const width = /(-?\d+(?:\.\d+)?)px/.exec(resolved);
    expect(
      width,
      `${property} is declared as "${value}" and no px length could be resolved from it`,
    ).not.toBeNull();
    return px((width as RegExpExecArray)[1]);
  };

  /**
   * Resolve a declared `width`/`height` to pixels for one icon size. Restricted on purpose to the
   * shapes this sheet authors — `calc()` over `+`, `-` and `*` with px terms — because a general
   * CSS evaluator would be a second implementation of the browser and would have its own bugs.
   */
  const resolveBox = (declared: string, vars: Map<string, string>, iconPx: number): number => {
    let expr = declared.trim();
    expr = expr.replace(/var\(--throng-size-icon(?:,[^)]*)?\)/g, `${iconPx}px`);
    for (const [name, value] of vars) expr = expr.replaceAll(`var(${name})`, value);
    expr = expr.replace(/calc\(/g, '(').replace(/px/g, '');
    expect(expr, `width expression left something unresolved: ${declared}`).toMatch(
      /^[\d\s.+\-*/()]+$/,
    );
    // The guard above admits digits, whitespace and arithmetic operators only, so nothing that
    // reaches here can name an identifier — which is what makes evaluating it safe.
    return Number(new Function(`return ${expr};`)());
  };

  const expectTheBoxHoldsTheGlyph = (selector: string): void => {
    const block = ruleFor(selector);
    const vars = new Map(
      [...block.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]),
    );
    const border = /(?:^|[;{\s])border:/.test(block) ? lengthOf(block, 'border', vars) : 0;
    const padding = /(?:^|[;{\s])padding:/.test(block) ? lengthOf(block, 'padding', vars) : 0;

    for (const iconPx of [16, 17, 19, 24, 32]) {
      for (const metric of ['width', 'height']) {
        const declared = new RegExp(`(?:^|[;{\\s])${metric}:\\s*([^;}]+)`).exec(block);
        const box = resolveBox((declared as RegExpExecArray)[1], vars, iconPx);
        expect(
          box - border * 2 - padding * 2,
          `at sizes.iconPx ${iconPx}, ${selector}'s content ${metric} must equal the glyph's ` +
            `${iconPx}px — the declared ${metric} is ${box}px, and border-box spends ` +
            `${border * 2}px of it on the border and ${padding * 2}px on padding`,
        ).toBe(iconPx);
      }
    }
  };

  it('leaves the glyph room once the border and padding are taken out (FR-079c)', () => {
    expectTheBoxHoldsTheGlyph('.fif-btn');
    expectTheBoxHoldsTheGlyph('.fif-field__icon');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-085 (T192) — a gesture that says it is there
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything in this list that answers a DOUBLE-CLICK must say so on hover.
 *
 * ══ THE SET IS TWO ELEMENTS, AND ONE OF THEM IS BOTH KINDS OF HEADING ══
 *
 * `renderGroup` in `results-list.tsx` produces the file heading and the folder heading from the same
 * element, differing only by `data-group-kind`. So the choice is not "which headings" — scoping the
 * affordance to folders would leave the file headings with a working double-click and nothing to
 * announce it, and the inconsistency would then sit INSIDE one list rather than between two
 * surfaces. Every heading and every row, which is what FR-085 says in as many words.
 *
 * Rows already carry the hover fill (it shipped with the list) and gain only the cursor; headings
 * have neither today. That asymmetry is why the two properties are asserted separately rather than
 * as one "the affordance is present" check — a rule that gave the heading a cursor and no fill would
 * pass a combined assertion on the row and fail the user.
 *
 * ══ WHY THIS IS READ OFF THE SHEET AND NOT `getComputedStyle` ══
 *
 * The same reason the FR-044 sweep above states: these tests read the stylesheet as TEXT and never
 * attach it to a document, and jsdom resolves no `var()` through the cascade — a computed-style
 * assertion here would read back the literal text or nothing at all, and pass either way. `:hover`
 * is additionally unreachable from jsdom, which has no pointer.
 *
 * ══ THE GATE IS PART OF THE REQUIREMENT, NOT A STYLE PREFERENCE ══
 *
 * An ungated hover-surface rule strands its tint on a blurred window (021 FR-035), and
 * `tests/unit/hover-suppression-coverage.test.ts` fails the build for one. It is asserted here as
 * well because that guard is a repository-wide sweep: it would name the offending rule without ever
 * saying which requirement wanted the rule in the first place.
 */
describe('every double-clickable thing in the list shows that it is (FR-085, T192)', () => {
  /** Every `selector { body }` rule in the sheet, comments stripped. This CSS nests no braces. */
  const rules = (): { selector: string; body: string }[] => {
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    const sheet = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.trim().replace(/\s+/g, ' '),
      body,
    }));
  };

  /** The heading (both kinds — ONE element) and the match row. */
  const DOUBLE_CLICKABLE = ['.fif-group', '.fif-row'];

  const GATE = 'body:not([data-window-blurred])';

  it('gives the heading and the row a pointer cursor', () => {
    for (const target of DOUBLE_CLICKABLE) {
      // Membership of the selector LIST, not a substring: `.fif-group__key` must not be mistaken
      // for `.fif-group`, and the two share a rule in this sheet.
      const declaring = rules().filter(
        (rule) =>
          rule.selector
            .split(',')
            .map((one) => one.trim())
            .includes(target) && /(?:^|[;{\s])cursor:\s*pointer/.test(rule.body),
      );
      expect(
        declaring.length,
        `${target} responds to a double-click and declares no \`cursor: pointer\` (FR-085)`,
      ).toBeGreaterThan(0);
    }
  });

  it('gives each of them a hover fill from the hover token, gated on window focus', () => {
    for (const target of DOUBLE_CLICKABLE) {
      const hovers = rules().filter((rule) => rule.selector.includes(`${target}:hover`));
      expect(hovers.length, `${target} has no :hover rule at all (FR-085)`).toBeGreaterThan(0);
      for (const rule of hovers) {
        expect(
          rule.body,
          `${target}:hover must paint --throng-colour-hoverSurface (FR-085)`,
        ).toMatch(/background(-color)?:\s*var\(--throng-colour-hoverSurface\)/);
        expect(
          rule.selector,
          `${target}:hover is not gated behind \`${GATE}\` — its tint would strand on a blurred ` +
            `window (021 FR-035)`,
        ).toContain(GATE);
      }
    }
  });

  /*
   * `--throng-colour-surfaceActive` is the SELECTED/ENGAGED role on this surface — the panel's own
   * `.fif-btn--on` toggles and the row the reading position is on are its two instances, and both
   * are legitimate. What FR-085 forbids is BORROWING it for a hover, which would make "the pointer
   * is over this" and "this is the one you are on" the same colour.
   *
   * So the assertion is over `:hover` rules rather than over the sheet: a blanket "the token appears
   * nowhere" would fail on `.fif-btn--on` and `.fif-row[data-current='true']`, which are the role
   * being used correctly.
   */
  it('never borrows the selected/active surface for a hover', () => {
    const borrowed = rules()
      .filter(
        (rule) =>
          rule.selector.includes(':hover') && rule.body.includes('--throng-colour-surfaceActive'),
      )
      .map((rule) => rule.selector);
    expect(borrowed, 'surfaceActive is the selected role and must not be a hover fill').toEqual([]);
  });
});


/* ────────────────────────────────────────────────────────────────────────── *
 * The colours — resolved from tokens, which is the half a rendered DOM cannot show
 * ────────────────────────────────────────────────────────────────────────── */

describe('the control resolves its colours from theme tokens (FR-011)', () => {
  it('reads foreground, background and border from tokens in every state it draws', () => {
    /*
     * `find-in-files-results.test.ts` already asserts the negative over the whole sheet — no
     * hardcoded colour, and no token the shipped theme has never heard of. That sweep passes
     * perfectly on a control that states no colour at all, which is the failure this asserts
     * against: an icon control that inherits whatever it lands on is not themeable, it is
     * accidental, and it is invisible until somebody switches to a light theme.
     */
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    const sheet = readFileSync(CSS_PATH, 'utf8');
    const ruleFor = (selector: string): string => {
      const at = sheet.indexOf(`${selector} {`);
      expect(at, `${selector} has no rule in find-in-files.css`).toBeGreaterThan(-1);
      return sheet.slice(at, sheet.indexOf('}', at));
    };

    // The resting state: a control that names no colour of its own is the defect above.
    expect(ruleFor('.fif-btn')).toContain('color: var(--throng-colour-');
    // The engaged state — a match mode or the grouping in force — reads as SELECTED, and that is a
    // colour decision the theme has to own too.
    const engaged = ruleFor('.fif-btn--on');
    expect(engaged).toContain('color: var(--throng-colour-');
    expect(engaged).toContain('background: var(--throng-colour-');
    expect(engaged).toContain('border-color: var(--throng-colour-');
  });
});

describe('the panel takes the Pane Text typography role (FR-064, 021 FR-049) — stylesheet half', () => {
  it('hands out family, size and weight from that role, so subscribing is enough', () => {
    // Guard the role itself. If `theme.css` stopped emitting any of the three, every assertion
    // below would still pass while the panel resolved nothing.
    const body = paneTextRule().body;
    expect(body).toContain('font-family: var(--throng-font-paneText-family)');
    expect(body).toContain('font-size: var(--throng-font-paneText-size)');
    expect(body).toContain('font-weight: var(--throng-font-paneText-weight)');
  });

  it('makes the panel’s form controls inherit rather than take a UA font', () => {
    // A browser does not give an `<input>` the inherited font. Without this the term, replacement
    // and scope fields render in the UA's own face at the UA's own size inside a panel that has
    // otherwise taken the role — which the ancestor match above cannot see.
    expect(panelRule('.fif-input')).toMatch(/font:\s*inherit/);
  });
});

describe('the code snippet keeps the editor family only (FR-064, R29) — stylesheet half', () => {
  it('reads the editor role’s family', () => {
    expect(panelRule('.fif-row__snippet')).toContain(
      'font-family: var(--throng-font-editor-family)',
    );
  });

  it('sets no size or weight of its own, so both come from Pane Text', () => {
    const snippet = panelRule('.fif-row__snippet');
    expect(snippet).not.toMatch(/font-size\s*:/);
    expect(snippet).not.toMatch(/font-weight\s*:/);
  });

  it('takes nothing else from the editor role anywhere in the sheet', () => {
    // The sub-decision in one assertion: a snippet that also read `--throng-font-editor-size` would
    // give the row a height that is a function of two independently-configurable settings, and the
    // windowed list measures rows from one constant (R26).
    const borrowed = [...read(PANEL_CSS).matchAll(/--throng-font-editor-([a-zA-Z]+)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(borrowed)]).toEqual(['family']);
  });
});

describe('secondary metadata stays relative to the corrected base (T161, R29)', () => {
  it('shrinks exactly six selectors', () => {
    /*
     * Metadata BESIDE the body text — counts, positions, the scan's state — not the body text
     * itself, so a relative secondary size is an ordinary typographic choice once the base is
     * right. The count is pinned because it is the thing that drifts: `.fif-scope__ran` went with
     * FR-072 and `.fif-row__stale` with FR-073, and a sixth selector appearing here later would
     * mean a new piece of the panel had quietly opted out of the role's size.
     */
    const shrunk = rulesOf(read(PANEL_CSS))
      .filter((r) => /font-size:\s*0\.85em/.test(r.body))
      .flatMap((r) => r.selectors);
    // #391 — `.fif-scope__missing` went with the notice it styled; the notice bar's `.fif-notice`
    // took its place, and its size, in the same slot of the sheet.
    // 060 FR-004 — `.fif-group__dir`, the muted folder beside a file name under Per file grouping,
    // is the sixth: metadata beside the name it qualifies, smaller by the same relative step.
    expect(shrunk).toEqual([
      '.fif-notice',
      '.fif-status',
      '.fif-group__dir',
      '.fif-group__count',
      '.fif-group__stale',
      '.fif-row__pos',
    ]);
  });

  it('states no absolute font size anywhere', () => {
    /*
     * An absolute size is how a panel opts out of the role without saying so. The one this caught
     * when it was written was `.fif-btn`'s `font-size: 12px`, which FR-079 removes for an unrelated
     * reason — it was INERT, because `.icon` sizes itself from `--throng-size-icon` and these
     * buttons contain nothing else. Both changes land together, so this reads green either way; it
     * is here for the next absolute size somebody adds, not for that one.
     */
    const sizes = [
      ...read(PANEL_CSS)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .matchAll(/font-size:\s*([^;}]+)/g),
    ].map((m) => m[1].trim());
    expect(sizes.filter((v) => /\d(?:px|pt|rem)\b/.test(v))).toEqual([]);
  });
});

describe('a file heading is bold from the theme’s own weight token (FR-063)', () => {
  it('reads --throng-font-weight-bold, a weight the shipped theme emits', () => {
    // Guard the token's source as well as its name: 021 made weight themeable, and a heading
    // reading a variable nothing emits renders at the inherited weight — silently un-bold.
    expect(THRONG_THEME.fonts.weights.bold).toBeDefined();
    expect(panelRule('.fif-group__key')).toContain('font-weight: var(--throng-font-weight-bold)');
  });

  it('hardcodes no weight anywhere in the sheet', () => {
    // The same class of mistake as a hex colour, and forbidden for the same reason.
    const literals = [
      ...read(PANEL_CSS)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .matchAll(/font-weight:\s*([^;}]+)/g),
    ]
      .map((m) => m[1].trim())
      .filter((v) => !v.startsWith('var('));
    expect(literals, 'a themeable surface hardcodes no font weight (FR-063)').toEqual([]);
  });

  it('leaves the rows beneath it unweighted, which is what makes the heading distinct', () => {
    // "Visually distinct from the result rows beneath it" is a comparison, so the other side of it
    // is asserted too: if a row also bolded itself the heading would stop standing out.
    for (const selector of ['.fif-row__snippet', '.fif-row__pos']) {
      expect(panelRule(selector)).not.toMatch(/font-weight\s*:/);
    }
  });
});

describe('the panel’s text and row metrics are told to the stylesheet, not computed by it (FR-062, R26)', () => {
  it('multiplies the Pane Text size by it in the stylesheet', () => {
    // The role still decides the BASE (FR-064): this multiplies the role's own variable rather than
    // restating a size, so a user who changes Pane Text still changes this panel's text.
    expect(sheet()).toMatch(
      /font-size:\s*calc\(\s*var\(--throng-font-paneText-size\)\s*\*\s*var\(--throng-zoom-fif[^)]*\)\s*\)/,
    );
  });

  it('does so from a selector that outranks the role rule, not one that ties with it', () => {
    /*
     * ══ THE CASCADE FACT THIS RULE EXISTS INSIDE, AND WHY THE SELECTOR IS DOUBLED ══
     *
     * `theme.css` hands `.fif-panel` the Pane Text role, and `theme.css` is imported LAST in
     * `main.tsx` while this sheet arrives through the component graph — so in the built bundle the
     * role rule comes AFTER everything here. Two rules of equal specificity are settled by document
     * order, so a plain `.fif-panel { font-size: … }` in this file would lose to the role rule and
     * do nothing at all.
     *
     * That is not a hypothetical: it is precisely the defect FR-079 has just removed from this same
     * sheet — `.fif-btn`'s `font-size: 12px`, a declaration that read as the obvious place to change
     * something and governed nothing. A zoom that silently did not apply would be the same failure
     * with a requirement behind it.
     *
     * `.fif-panel.fif-panel` is one element, twice named: same subject, specificity (0,2,0), and no
     * dependence on which sheet a bundler happens to emit first. It is asserted here rather than
     * only explained in the sheet, because a later tidy-up to the "obvious" single class would leave
     * every text assertion in this file passing.
     */
    expect(
      sheet(),
      'the zoom rule must outrank theme.css’s Pane Text rule, which is emitted after this sheet',
    ).toMatch(/\.fif-panel\.fif-panel\s*\{/);
  });

  it('asks the stylesheet to compute no row height of its own', () => {
    /*
     * The negative half, and the one that makes the rule enforceable rather than a convention: the
     * sheet may READ `--fif-row-height`, and it may not multiply it. A `calc(var(--fif-row-height) *
     * var(--throng-zoom-fif))` anywhere here would give the browser a second rounding authority over
     * a number the arithmetic has already rounded.
     */
    const offenders = [...sheet().matchAll(/calc\([^;{}]*--fif-row-height[^;{}]*\)/g)].map(
      (m) => m[0],
    );
    expect(offenders, 'CSS is told the row height, never asked to compute it (R26)').toEqual([]);
  });
});
