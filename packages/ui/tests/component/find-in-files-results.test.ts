/**
 * 043 T057/T059 — the Find in Files results list: what it lists, how it highlights, and how it
 * survives a result set nothing bounds.
 *
 * ══ FOUR CLAIMS ABOUT THE RENDERED LIST ══
 *
 *   1. FR-032 — one row per MATCH. A file with three occurrences contributes three rows, each
 *      independently there to be acted on, never one row standing for the file.
 *   2. FR-036 — the matched text is highlighted INSIDE its snippet, with an ellipsis marking only
 *      the side that was actually truncated. A snippet that shows an ellipsis on an untruncated
 *      side is claiming text was cut that never was.
 *   3. FR-034a — results open EXPANDED at every grouping, so every row is reachable without an
 *      expand action; FR-034 — a collapsed group stays present and says how many matches it holds,
 *      digit-grouped (FR-014).
 *   4. FR-044 — the highlight's colours resolve from the search-match tokens 013 already ships.
 *      This is asserted over the STYLESHEET's source rather than through `getComputedStyle`,
 *      because jsdom does not substitute `var()` — a computed-style assertion here would read back
 *      the literal text or nothing at all, and pass either way. What the source can say exactly is
 *      the thing FR-044 asks: these rules read `searchMatch`/`searchMatchCurrent`, every colour they
 *      read is a token that already exists, and no colour is written into the sheet by hand.
 *
 * ══ AND ONE ABOUT THE LIST BEING WINDOWED (T059) ══
 *
 * Nothing in this renderer is windowed today (research R18), and the spec's Assumptions decline a
 * match ceiling — so a results list that renders every row is one `Ctrl+Shift+F` on a common word
 * away from painting tens of thousands of nodes. The assertion is structural, not timed: the DOM
 * holds a small window while the scroll extent covers the whole list, and scrolling changes WHICH
 * rows are in the DOM. jsdom has no layout, so the scroller's geometry is supplied the only way it
 * can be — `defineProperty` on the element, which is exactly what the component reads.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatGrouped, THRONG_THEME } from '@throng/core';
import { RESULT_ROW_HEIGHT_PX } from '../../src/renderer/find-in-files/results-list.js';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const CSS_PATH = resolve(
  process.cwd(),
  'packages/ui/src/renderer/find-in-files/find-in-files.css',
);

let bridge: FileSearchStub;

function mount(): void {
  renderFindInFilesPanel();
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-032 — one row per match
 * ────────────────────────────────────────────────────────────────────────── */

describe('the results list holds one row per match (FR-032)', () => {
  it('gives a file with three occurrences three rows, not one', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 3, 10),
        resultRow('src/a.ts', 9, 120),
        resultRow('src/a.ts', 40, 400),
        resultRow('src/b.ts', 1, 0),
      ],
      totalMatches: 4,
      filesScanned: 2,
    });

    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
    // Two files, so two headings — and the headings are not what carries the matches.
    expect(screen.getAllByTestId(/^fif-group-header-/)).toHaveLength(2);
    expect(screen.getByTestId('fif-row-src/a.ts-120')).toBeInTheDocument();
  });

  it('shows the total, digit-grouped, once the scan completes (FR-014)', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 4096,
      filesScanned: 2048,
    });

    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent(formatGrouped(4096));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-036 — the match, highlighted inside its snippet, with honest ellipses
 * ────────────────────────────────────────────────────────────────────────── */

describe('each row highlights the match inside its snippet (FR-036)', () => {
  it('marks the matched text and leaves the surrounding context unmarked', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 3, 10)],
      totalMatches: 1,
    });

    const row = screen.getByTestId('fif-row-src/a.ts-10');
    const mark = within(row).getByTestId('fif-match');
    expect(mark).toHaveTextContent('needle');
    expect(mark.className).toContain('fif-match');
    // The context is present and is NOT inside the mark — a row that highlighted the whole
    // snippet would satisfy "the match is highlighted" and show the user nothing.
    expect(row).toHaveTextContent('const needle = 1;');
    expect(mark.textContent).toBe('needle');
  });

  it('shows an ellipsis only on the side that was truncated', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 3, 10, { truncatedStart: true, truncatedEnd: false }),
        resultRow('src/b.ts', 4, 20, { truncatedStart: false, truncatedEnd: true }),
        resultRow('src/c.ts', 5, 30, { truncatedStart: false, truncatedEnd: false }),
      ],
      totalMatches: 3,
    });

    const leading = screen.getByTestId('fif-row-src/a.ts-10');
    expect(within(leading).queryByTestId('fif-ellipsis-start')).not.toBeNull();
    expect(within(leading).queryByTestId('fif-ellipsis-end')).toBeNull();

    const trailing = screen.getByTestId('fif-row-src/b.ts-20');
    expect(within(trailing).queryByTestId('fif-ellipsis-start')).toBeNull();
    expect(within(trailing).queryByTestId('fif-ellipsis-end')).not.toBeNull();

    const whole = screen.getByTestId('fif-row-src/c.ts-30');
    expect(within(whole).queryByTestId('fif-ellipsis-start')).toBeNull();
    expect(within(whole).queryByTestId('fif-ellipsis-end')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-034a / FR-034 — open expanded; a collapsed group keeps its count
 * ────────────────────────────────────────────────────────────────────────── */

describe('groups open expanded and collapse to a count (FR-034a, FR-034, FR-014)', () => {
  it('shows every match row with no expand action first', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 1, 0),
        resultRow('src/a.ts', 2, 30),
        resultRow('lib/deep/c.ts', 7, 70),
      ],
      totalMatches: 3,
    });

    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(3);
    // The toggle names what the CLICK will do, so an expanded group offers "Collapse".
    for (const toggle of screen.getAllByTestId(/^fif-group-toggle-/)) {
      expect(toggle.getAttribute('title')).toMatch(/collapse/i);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('keeps a collapsed group present, showing its digit-grouped match count', async () => {
    const user = userEvent.setup();
    mount();
    // 1,234 matches in one file and one in another: the collapsed heading is the only place that
    // count is readable, so it is the place FR-014 has to be true.
    const many = Array.from({ length: 1234 }, (_, i) => resultRow('src/big.ts', i + 1, i * 10));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [...many, resultRow('src/small.ts', 1, 0)],
      totalMatches: 1235,
    });

    await user.click(screen.getByTestId('fif-group-toggle-src/big.ts'));

    const heading = screen.getByTestId('fif-group-header-src/big.ts');
    expect(heading).toBeInTheDocument();
    expect(within(heading).getByTestId('fif-group-count-src/big.ts')).toHaveTextContent(
      formatGrouped(1234),
    );
    expect(screen.getByTestId('fif-group-toggle-src/big.ts').getAttribute('aria-expanded')).toBe(
      'false',
    );
    // Its rows are gone; the other group's row is untouched.
    expect(screen.queryByTestId('fif-row-src/big.ts-0')).toBeNull();
    expect(screen.getByTestId('fif-row-src/small.ts-0')).toBeInTheDocument();
  });
});

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

    const sheet = css();
    expect(sheet).toContain('var(--throng-colour-searchMatch)');
    expect(sheet).toContain('var(--throng-colour-searchMatchCurrent)');
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
 * T059 — the list is windowed
 * ────────────────────────────────────────────────────────────────────────── */

describe('the results list is virtualised (T059, FR-041)', () => {
  const HUGE = 4000;

  function emitHuge(): void {
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: Array.from({ length: HUGE }, (_, i) => resultRow('src/big.ts', i + 1, i * 10)),
      totalMatches: HUGE,
    });
  }

  it('renders a small window of a large result set, sized for the whole of it', () => {
    mount();
    emitHuge();

    const rendered = screen.getAllByTestId(/^fif-row-/);
    expect(rendered.length).toBeLessThan(200);
    expect(rendered.length).toBeGreaterThan(0);

    // The scroll extent still covers every row plus its heading, so the scrollbar tells the truth
    // about how much there is — the thing a hard cap at 200 rows cannot do.
    const sizer = screen.getByTestId(`fif-sizer-${PANEL_ID}`);
    expect(sizer.style.height).toBe(`${(HUGE + 1) * RESULT_ROW_HEIGHT_PX}px`);
  });

  it('renders different rows once the list is scrolled', () => {
    mount();
    emitHuge();

    expect(screen.getByTestId('fif-row-src/big.ts-0')).toBeInTheDocument();
    const deep = 2000;
    expect(screen.queryByTestId(`fif-row-src/big.ts-${deep * 10}`)).toBeNull();

    const scroller = screen.getByTestId(`fif-results-${PANEL_ID}`);
    // jsdom has no layout, so the scroller's geometry is supplied rather than measured — these are
    // exactly the two properties the component reads off the event target.
    Object.defineProperty(scroller, 'scrollTop', {
      value: deep * RESULT_ROW_HEIGHT_PX,
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    fireEvent.scroll(scroller);

    expect(screen.getByTestId(`fif-row-src/big.ts-${deep * 10}`)).toBeInTheDocument();
    expect(screen.queryByTestId('fif-row-src/big.ts-0')).toBeNull();
  });
});
