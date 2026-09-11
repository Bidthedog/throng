/**
 * 043 T196 (FR-080, FR-080a, FR-080b, FR-080c) — a Clear on each of the panel's three text inputs.
 *
 * ══ WHAT IS BEING ASSERTED, AND WHY EACH PART IS HERE RATHER THAN SOMEWHERE ELSE ══
 *
 *   1. **Absent, not disabled** (FR-080). Clearing an empty box is not temporarily unavailable, it
 *      is never meaningful — Constitution VI's "absent when meaningless", which is the distinction
 *      FR-045b's own parenthetical draws from the other side. A disabled ghost on an empty field
 *      would be a control that can never do anything, and 016's F6 records what that teaches a user.
 *   2. **The shipped vocabulary, not a second one** (FR-080). The application already clears an
 *      input in three places — the settings, keybindings and themes search boxes — each an
 *      `IconButton` on the `dismiss` token with a hover title. The assertion is over the RENDERED
 *      control: the `dismiss` glyph resolved, a non-empty title, and no word label.
 *   3. **The box** (FR-080a). This is the trap the requirement was written for and it is worth
 *      naming: `.settings-search__clear` — one of the three patterns being copied — hardcodes
 *      `width: 20px; height: 20px`, which is exactly the frozen box FR-079/FR-079c removed ONE
 *      ROUND AGO. Copying the markup and the CSS together would ship the fix and a fresh instance
 *      of the bug in the same panel. So the box is asserted from the sheet, at several icon sizes,
 *      with border and padding taken out — see the block at the bottom.
 *   4. **Nothing is discarded and nothing is started** (FR-080b). The listed rows stand over an
 *      empty box, which is not the same thing as a search that found nothing (FR-042).
 *   5. **The scope row keeps its shape** (FR-080c). The clear goes INSIDE the scope input's own box;
 *      the folder chooser stays a sibling BESIDE it, because a clear acts on the text and a browse
 *      acts on the scope, and one box for both would claim they are the same kind of thing.
 *
 * ══ WHY THIS IS A COMPONENT TEST AND NOT AN E2E ══
 *
 * Every claim above is about what one component renders, what it does to its own state, and what its
 * stylesheet declares. None of them needs a window: the only thing on this list that an Electron
 * launch could add is a resolved pixel, and jsdom cannot produce one either — which is why the box
 * is read off the sheet as TEXT, exactly as `find-in-files-results.test.ts` reads it for `.fif-btn`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, THRONG_THEME, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const CSS_PATH = resolve(process.cwd(), 'packages/ui/src/renderer/find-in-files/find-in-files.css');

/*
 * The trigger is chosen deliberately in this file rather than inherited.
 *
 * FR-074 made as-you-type the shipped default, and FR-080b's claim is about BOTH triggers — so a
 * test that simply took whatever the defaults say would be silently asserting only one of them, and
 * would stop asserting the interesting one the day the default moves again.
 */
const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

const SETTLE_MS = 250;

function settings(trigger: 'run' | 'asYouType'): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, settleMs: SETTLE_MS, trigger },
    },
  };
}

let bridge: FileSearchStub;

beforeEach(() => {
  config.settings = settings('asYouType');
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  cleanup();
  removeFileSearchStub();
  __resetFindInFilesState();
  vi.useRealTimers();
});

const el = (testId: string): HTMLElement => screen.getByTestId(testId);
const maybe = (testId: string): HTMLElement | null => screen.queryByTestId(testId);
const input = (testId: string): HTMLInputElement => el(testId) as HTMLInputElement;

const type = (testId: string, value: string): void => {
  fireEvent.change(el(testId), { target: { value } });
};

/** Two files, four rows — enough that "the rows stand" is a claim about a list, not about one row. */
function emitResults(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [
      resultRow('src/a.ts', 3, 10),
      resultRow('src/a.ts', 9, 120),
      resultRow('src/b.ts', 1, 0),
      resultRow('lib/c.ts', 4, 40),
    ],
    totalMatches: 4,
    filesScanned: 3,
  });
}

/**
 * The three fields FR-080 reaches, and nothing else.
 *
 * The panel has exactly three text inputs and the requirement reaches all of them. A table rather
 * than three near-identical blocks, because the whole point of FR-080's "a second vocabulary MUST
 * NOT be introduced" is that these three are the SAME control — and three hand-written blocks are
 * how they would quietly stop being.
 */
interface Field {
  readonly what: string;
  readonly input: string;
  readonly clear: string;
  /** Disclose the replace row first, for the one field that is not always mounted. */
  readonly discloseReplace: boolean;
}

const FIELDS: readonly Field[] = [
  { what: 'search term', input: `fif-term-${PANEL_ID}`, clear: `fif-term-clear-${PANEL_ID}`, discloseReplace: false },
  {
    what: 'replacement',
    input: `fif-replacement-${PANEL_ID}`,
    clear: `fif-replacement-clear-${PANEL_ID}`,
    discloseReplace: true,
  },
  { what: 'scope', input: `fif-scope-${PANEL_ID}`, clear: `fif-scope-clear-${PANEL_ID}`, discloseReplace: false },
];

/** Mount the panel with the replace row disclosed where the field under test needs it. */
function mount(field?: Field): void {
  renderFindInFilesPanel();
  if (field?.discloseReplace === true) {
    fireEvent.click(el(`fif-toggle-replace-${PANEL_ID}`));
  }
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080 — drawn only while there is something to clear
 * ────────────────────────────────────────────────────────────────────────── */

describe('each input offers a clear only while it has content (FR-080)', () => {
  for (const field of FIELDS) {
    it(`draws no clear control at all on an empty ${field.what}`, () => {
      mount(field);
      expect(input(field.input).value).toBe('');
      // Absent, not disabled: `queryByTestId` finding a DISABLED button would pass a weaker
      // assertion and fail this one, which is the distinction the requirement turns on.
      expect(maybe(field.clear), `an empty ${field.what} drew a clear control`).toBeNull();
    });

    it(`draws one once the ${field.what} has content, and takes it away again when emptied`, () => {
      mount(field);
      type(field.input, 'needle');
      expect(maybe(field.clear), `a non-empty ${field.what} drew no clear control`).not.toBeNull();

      type(field.input, '');
      expect(maybe(field.clear), `the clear control outlived its ${field.what}`).toBeNull();
    });
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080 — the shipped vocabulary, reused rather than re-invented
 * ────────────────────────────────────────────────────────────────────────── */

describe('the clear reuses the vocabulary the application already ships (FR-080)', () => {
  for (const field of FIELDS) {
    it(`draws the ${field.what}'s clear as a titled \`dismiss\` icon and no word`, () => {
      mount(field);
      type(field.input, 'needle');
      const clear = el(field.clear);

      // The `dismiss` glyph RESOLVED. A token the theme has never heard of renders nothing at all —
      // an invisible control with no error anywhere, which is how 029's Clear control shipped.
      const icon = clear.querySelector('.icon');
      expect(icon, `${field.what}'s clear draws no themed icon`).not.toBeNull();
      const glyph = (icon?.textContent ?? '').trim();
      if (clear.querySelector('svg') === null) {
        expect(glyph, `${field.what}'s clear draws a blank icon`).toBe(THRONG_THEME.icons.dismiss);
      }

      // The hover title is the control's whole accessible name, and it NAMES THE FIELD: three
      // controls all titled "Clear" would be three controls a screen reader cannot tell apart.
      const title = (clear.getAttribute('title') ?? '').trim();
      expect(title, `${field.what}'s clear has no hover title`).not.toBe('');
      expect(clear.getAttribute('aria-label')).toBe(title);
      expect(title.toLowerCase()).toContain('clear');

      // No word label: everything the control renders is the icon.
      expect((clear.textContent ?? '').replace(glyph, '').trim()).toBe('');
    });
  }

  it('gives the three controls three different names', () => {
    // The set, not each one: distinct titles is a property of the GROUP, and asserting it per
    // control is how three of them end up saying "Clear search".
    mount();
    fireEvent.click(el(`fif-toggle-replace-${PANEL_ID}`));
    for (const field of FIELDS) type(field.input, 'needle');
    const titles = FIELDS.map((field) => el(field.clear).getAttribute('title'));
    expect(new Set(titles).size, `two clear controls share a name: ${titles.join(' / ')}`).toBe(3);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080 — what the click does: empties the field, and leaves the caret in it
 * ────────────────────────────────────────────────────────────────────────── */

describe('clearing empties the field and leaves focus in it (FR-080)', () => {
  for (const field of FIELDS) {
    it(`empties the ${field.what} and hands the caret back to it`, () => {
      mount(field);
      type(field.input, 'needle');
      fireEvent.click(el(field.clear));

      expect(input(field.input).value).toBe('');
      // Focus is the half that makes this a clear rather than a delete: the user's next keystroke
      // types the replacement term, without a second click.
      expect(document.activeElement, `focus left the ${field.what}`).toBe(el(field.input));
    });
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080b — nothing listed is discarded, and nothing is started
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ AN EMPTY BOX IS NOT A SEARCH THAT FOUND NOTHING ══
 *
 * FR-042 keeps those two apart on the status line, and FR-080b keeps them apart in the list: the
 * rows from the last run stand over an empty field until the user searches again. Discarding them
 * would make a clear destructive, and there is no undo for a scan.
 *
 * The clear is asserted to start nothing AS AN ACTION — which is the claim FR-080b actually makes,
 * and the only one that is true of a control whose whole job is text editing (FR-080d says so in as
 * many words: *"Emptying a focused text field is text editing on that field, not a discrete command
 * the panel offers"*). So a cleared field behaves exactly as a field the user emptied with the
 * keyboard, and the trigger preference decides what happens next — which is what the two blocks
 * below assert, one per trigger.
 */
describe('clearing discards no listed rows and starts no scan (FR-080b)', () => {
  for (const field of FIELDS) {
    it(`leaves every listed row listed after the ${field.what} is cleared`, () => {
      mount(field);
      type(field.input, 'needle');
      emitResults();
      expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);

      fireEvent.click(el(field.clear));

      // Still four rows, still four, and each still carries the title that makes it actionable.
      expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
      expect(el('fif-row-src/a.ts-120')).toBeInTheDocument();
      expect(screen.getAllByTestId(/^fif-group-header-/).length).toBeGreaterThan(0);
    });

    it(`starts nothing at the moment the ${field.what} is cleared`, () => {
      mount(field);
      type(field.input, 'needle');
      emitResults();
      bridge.start.mockClear();

      fireEvent.click(el(field.clear));

      expect(bridge.start, `clearing the ${field.what} ran a search`).not.toHaveBeenCalled();
    });
  }

  it('an empty term refuses to run even once the as-you-type settle elapses (FR-043b)', () => {
    // The interesting half, and the reason the term is the field FR-080b names: as-you-type is the
    // shipped default, so the clear DOES schedule the same settle any other edit would. What must
    // not happen is a scan — an empty term matches nothing, so the run is refused and the list
    // simply stands.
    vi.useFakeTimers();
    mount();
    type(`fif-term-${PANEL_ID}`, 'needle');
    emitResults();
    bridge.start.mockClear();

    fireEvent.click(el(`fif-term-clear-${PANEL_ID}`));
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 8);
    });

    expect(bridge.start, 'an empty term started a scan').not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
  });

  it('clears the scope back to the project root and starts nothing under an explicit run (FR-030)', () => {
    // The scope's own half of FR-080b, asserted under FR-043a's explicit-run trigger — which is
    // where FR-030a's "a retarget starts nothing" was written, and the only trigger under which a
    // scope EDIT (by button or by keyboard, they are the same edit) starts nothing at all.
    config.settings = settings('run');
    vi.useFakeTimers();
    mount();
    type(`fif-term-${PANEL_ID}`, 'needle');
    type(`fif-scope-${PANEL_ID}`, 'lib/deep');
    emitResults();
    bridge.start.mockClear();

    fireEvent.click(el(`fif-scope-clear-${PANEL_ID}`));
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 8);
    });

    // An empty scope control IS the whole project (FR-030) — there is no second spelling of it.
    expect(input(`fif-scope-${PANEL_ID}`).value).toBe('');
    expect(bridge.start, 'clearing the scope ran a search').not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080c — the scope row's shape: one control inside the box, one beside it
 * ────────────────────────────────────────────────────────────────────────── */

describe('the scope row keeps the browse control beside the box (FR-080c)', () => {
  it('puts the clear inside the scope input’s own box and the chooser outside it', () => {
    mount();
    type(`fif-scope-${PANEL_ID}`, 'lib/deep');

    const scopeInput = el(`fif-scope-${PANEL_ID}`);
    const clear = el(`fif-scope-clear-${PANEL_ID}`);
    const browse = el(`fif-scope-browse-${PANEL_ID}`);

    /*
     * "Inside the box" is a containment claim, and the only honest way to make it without layout is
     * over the DOM: the clear shares the input's positioned wrapper, and the browse does not. A
     * browse that had drifted inside that wrapper would render as part of the field, which is the
     * thing FR-080c is about — a clear acts on the text, a browse acts on the scope.
     */
    const wrapper = scopeInput.parentElement;
    expect(wrapper, 'the scope input has no wrapper to position a clear against').not.toBeNull();
    expect(wrapper?.contains(clear), 'the scope clear is not inside the input’s box').toBe(true);
    expect(wrapper?.contains(browse), 'the folder chooser moved inside the input’s box').toBe(false);
    // And the chooser is still in the scope control, beside the box rather than gone from the row.
    expect(el(`fif-scope-control-${PANEL_ID}`).contains(browse)).toBe(true);
  });

  it('leaves FR-030a’s notice its place beside the field', () => {
    mount();
    type(`fif-scope-${PANEL_ID}`, 'lib/deep');
    // The refusal a chooser outside the project raises (FR-070) — the notice that shares this row's
    // right-hand edge, and which FR-080c says the new control must not displace.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'scopeMissing',
      rows: [],
      totalMatches: 0,
    });

    const notice = maybe(`fif-scope-notice-${PANEL_ID}`);
    expect(notice, 'the scope notice lost its place to the clear control').not.toBeNull();
    // Beside the field, not inside it: the notice is the scope control's child and the input's peer.
    expect(el(`fif-scope-control-${PANEL_ID}`).contains(notice as HTMLElement)).toBe(true);
    expect(el(`fif-scope-${PANEL_ID}`).parentElement?.contains(notice as HTMLElement)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-080a — the box, which is the whole reason this requirement was written
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE CONTROL BEING COPIED CARRIES THE DEFECT THAT WAS JUST FIXED ══
 *
 * `.settings-search__clear` (`preferences.css`) is `width: 20px; height: 20px` — a token's resolved
 * default frozen as a number, which is precisely what FR-079 and FR-079c removed from this panel one
 * round ago. FR-080a is stated as a requirement rather than left to review because the new control
 * is a copy of a control that has the bug, which is the most likely way it comes back.
 *
 * So the assertion is the ARITHMETIC, not the vocabulary, and it is made over the classes the
 * rendered control actually wears rather than over a class name written down here — a control whose
 * class list was changed to something the sheet does not style would otherwise pass this file while
 * rendering as a bare browser button. `icon-section.tsx`'s `.icon-colour__clear` is that exact
 * failure, shipped: a `className` that overrides `IconButton`'s default and matches no rule anywhere.
 */
describe('the clear control’s box derives from the icon token (FR-080a, FR-079, FR-079c)', () => {
  const sheet = (): string => {
    expect(existsSync(CSS_PATH), `find-in-files.css was not found at ${CSS_PATH}`).toBe(true);
    return readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  };

  /** Every `selector { body }` rule whose selector list names exactly `.<class>`. */
  const rulesFor = (className: string): string[] =>
    [...sheet().matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) =>
        selector
          .split(',')
          .map((one) => one.trim().replace(/\s+/g, ' '))
          .includes(`.${className}`),
      )
      .map(([, , body]) => body);

  const declared = (body: string, property: string): string | null => {
    const found = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`).exec(body);
    return found === null ? null : found[1].trim();
  };

  /** Custom properties a rule declares on itself, so its own `calc()` can be resolved. */
  const varsOf = (body: string): Map<string, string> =>
    new Map(
      [...body.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]),
    );

  const pxOf = (value: string, vars: Map<string, string>): number => {
    const viaVar = /var\((--[\w-]+)\)/.exec(value);
    const resolved = viaVar === null ? value : (vars.get(viaVar[1]) ?? '');
    const width = /(-?\d+(?:\.\d+)?)px/.exec(resolved);
    return width === null ? 0 : Number.parseFloat(width[1]);
  };

  /** Evaluate a declared box at one icon size. Only the `calc()` shapes this sheet authors. */
  const resolveBox = (value: string, vars: Map<string, string>, iconPx: number): number => {
    let expr = value.replace(/var\(--throng-size-icon(?:,[^)]*)?\)/g, `${iconPx}px`);
    for (const [name, declaredValue] of vars) expr = expr.replaceAll(`var(${name})`, declaredValue);
    expr = expr.replace(/calc\(/g, '(').replace(/px/g, '');
    expect(expr, `a box expression left something unresolved: ${value}`).toMatch(
      /^[\d\s.+\-*/()]+$/,
    );
    return Number(new Function(`return ${expr};`)());
  };

  /** The classes the rendered clear control actually wears — the subject of every assertion below. */
  const clearClasses = (): string[] => {
    renderFindInFilesPanel();
    type(`fif-term-${PANEL_ID}`, 'needle');
    return el(`fif-term-clear-${PANEL_ID}`).className.split(/\s+/).filter((one) => one !== '');
  };

  it('is styled by this sheet at all, rather than rendering as a bare button', () => {
    const styled = clearClasses().filter((one) => rulesFor(one).length > 0);
    expect(
      styled,
      `the clear control wears no class this sheet styles — \`IconButton\`'s \`className\` was ` +
        `overridden with a name that matches no rule (the \`.icon-colour__clear\` failure)`,
    ).not.toEqual([]);
  });

  it('states its width and height, and states both from --throng-size-icon', () => {
    const bodies = clearClasses().flatMap((one) => rulesFor(one));
    for (const metric of ['width', 'height']) {
      const values = bodies
        .map((body) => declared(body, metric))
        .filter((value): value is string => value !== null);
      expect(values, `the clear control declares no ${metric} at all`).not.toEqual([]);
      for (const value of values) {
        expect(
          value,
          `the clear control's ${metric} must derive from --throng-size-icon, not from its ` +
            `resolved default — this is \`.settings-search__clear\`'s \`${metric}: 20px\` coming back`,
        ).toContain('var(--throng-size-icon');
      }
    }
  });

  it('freezes no box metric in pixels anywhere in its rules', () => {
    const frozen = clearClasses()
      .flatMap((one) => rulesFor(one))
      .flatMap((body) =>
        ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']
          .map((metric) => declared(body, metric))
          .filter((value): value is string => value !== null),
      )
      .filter((value) => /^\d+(?:\.\d+)?px$/.test(value));
    expect(frozen, 'the clear control hardcodes a box metric in pixels (FR-079)').toEqual([]);
  });

  it('holds the glyph once its border and padding come out, at every icon size (FR-079c)', () => {
    /*
     * `theme.css` sets `* { box-sizing: border-box }` globally, so a declared size is spent on
     * border and padding BEFORE content. `16 + 3 + 3 = 22` is the tell that made FR-079 findable and
     * it is itself an incomplete sum — the first correction of `.fif-btn` wrote exactly that sum in
     * `calc()` form and clipped the glyph by 1px at every icon size while passing every test that
     * existed for it. So the check is the arithmetic: the CONTENT box must equal the token.
     */
    const bodies = clearClasses().flatMap((one) => rulesFor(one));
    const merged = bodies.join(';');
    const vars = varsOf(merged);
    const border = declared(merged, 'border');
    const padding = declared(merged, 'padding');
    const borderPx = border === null ? 0 : pxOf(border, vars);
    const paddingPx = padding === null ? 0 : pxOf(padding, vars);

    for (const iconPx of [16, 17, 19, 24, 32]) {
      for (const metric of ['width', 'height']) {
        const value = declared(merged, metric) as string;
        const box = resolveBox(value, vars, iconPx);
        expect(
          box - borderPx * 2 - paddingPx * 2,
          `at sizes.iconPx ${iconPx}, the clear control's content ${metric} must equal the ` +
            `glyph's ${iconPx}px — the declared ${metric} is ${box}px, and border-box spends ` +
            `${borderPx * 2}px of it on the border and ${paddingPx * 2}px on padding`,
        ).toBe(iconPx);
      }
    }
  });
});
