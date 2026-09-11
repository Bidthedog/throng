/**
 * The find bar READS AS A TOOLBAR (043 US2 — FR-010, FR-011), and still hangs where it always did
 * (FR-012).
 *
 * ══ THREE CLAIMS, TWO TECHNIQUES, ONE FILE ══
 *
 * FR-010 and FR-012 are claims about DECLARED CSS, so they follow `status-strip-declared-css.test.ts`
 * and `notice-pointer-events.test.ts`: load the application's own stylesheet, prove it parsed, and
 * assert only what jsdom resolves faithfully — bare keywords and LITERAL lengths, never a colour and
 * never a `var()`, which jsdom does not substitute.
 *
 * FR-011 is a claim about a RENDERED control, so it renders the bar and reads the element: the
 * disclosure control 043 adds must be a themeable icon from the active theme's set, carrying a hover
 * title that names its action, with nothing hardcoded on it.
 *
 * ══ THE ANCHORING HALF IS A REGRESSION GUARD, NOT A RED STEP ══
 *
 * FR-012 says the bar keeps its EXISTING anchoring. There is no new behaviour to drive out — the
 * point is that re-spacing the controls must not move the bar off the top-right corner of its panel,
 * which is exactly the kind of thing a padding-and-gap pass takes with it silently. So the anchoring
 * block below is green before the re-spacing lands and green after; the spacing block is what fails
 * first.
 *
 * ══ WHY jsdom CAN SETTLE FR-010 AT ALL ══
 *
 * It has no layout, so it cannot measure that a glyph does not touch its border. What it can read
 * back is the declaration that guarantees it — a non-zero padding on every action button — and the
 * declaration that separates the groups: a gap BETWEEN groups strictly larger than the gap WITHIN
 * one. Both are literal lengths on plain class selectors, which is the one thing this environment
 * answers correctly. The pixels themselves remain an E2E-tier claim.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { FindBar } from '../../src/renderer/search/find-bar.js';
import {
  registerPanelSearch,
  unregisterPanelSearch,
  type SearchController,
} from '../../src/renderer/search/search-controller.js';
import { __resetFindState, openFind } from '../../src/renderer/search/search-store.js';

/*
 * Resolved from the runner's root rather than from `import.meta.url`: under jsdom the module URL is
 * an `http://localhost/` one and `fileURLToPath` rejects it. The `existsSync` guard turns a future
 * move of this stylesheet into a named failure rather than an empty sheet and a vacuous pass.
 */
const FIND_BAR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/search/find-bar.css');

const PANEL = 'panel-1';
const NO_MATCHES = { current: 0, total: 0 };

let sheet: HTMLStyleElement;
let bar: HTMLDivElement;
let button: HTMLButtonElement;
let group: HTMLDivElement;
let row: HTMLDivElement;

beforeAll(() => {
  expect(existsSync(FIND_BAR_CSS), `find-bar.css was not found at ${FIND_BAR_CSS}`).toBe(true);
  sheet = document.createElement('style');
  sheet.textContent = readFileSync(FIND_BAR_CSS, 'utf8');
  document.head.appendChild(sheet);

  bar = document.createElement('div');
  bar.className = 'find-bar';
  document.body.appendChild(bar);

  row = document.createElement('div');
  row.className = 'find-bar-row';
  bar.appendChild(row);

  // The group wrapper is its own probe: a probe carrying only the row class would read the row's
  // rule and pass the comparison below for the wrong reason.
  group = document.createElement('div');
  group.className = 'find-bar-group';
  row.appendChild(group);

  button = document.createElement('button');
  button.className = 'find-bar-btn';
  group.appendChild(button);
});

afterAll(() => {
  sheet.remove();
  bar.remove();
});

const declared = (el: Element, property: string): string =>
  getComputedStyle(el).getPropertyValue(property);

/** A declared length in px, or `NaN` when the property is absent — which fails every check below. */
const px = (el: Element, property: string): number => Number.parseFloat(declared(el, property));

/* ────────────────────────────────────────────────────────────────────────── *
 * Anti-vacuity: the sheet really is loaded
 * ────────────────────────────────────────────────────────────────────────── */

describe('the stylesheet under test actually parsed', () => {
  it('applies a rule from find-bar.css to the probe', () => {
    // Every assertion in this file is `getComputedStyle` on a class from this sheet. If the sheet
    // failed to load, absences would read as "not declared" and the spacing tests would pass by
    // asserting nothing. `display: flex` on `.find-bar` is unconditional and has no variable in it.
    expect(declared(bar, 'display')).toBe('flex');
    expect(declared(bar, 'flex-direction')).toBe('column');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-012 — the anchoring the re-spacing must not disturb (REGRESSION GUARD)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar keeps its existing anchoring within its panel (FR-012)', () => {
  it('is absolutely positioned in the top-right corner, above the panel content', () => {
    /*
     * Written and watched GREEN before the controls were re-spaced. It exists so that a change to
     * padding, gaps or the button box cannot quietly turn the bar into a static block that pushes
     * the editor down, or drop it behind the content it floats over.
     */
    expect(declared(bar, 'position')).toBe('absolute');
    // jsdom may normalise a bare `0` either way; both spellings are the same declaration.
    expect(['0', '0px']).toContain(declared(bar, 'top'));
    expect(['0', '0px']).toContain(declared(bar, 'right'));
    expect(declared(bar, 'z-index')).toBe('5');
  });

  it('keeps the corner treatment that makes it read as hanging from the panel edge', () => {
    // The bar meets the panel's top and right edges, so only the inner corner is rounded and the
    // two outer borders are suppressed. A re-space that restored them would draw a line across the
    // panel's own border.
    expect(declared(bar, 'border-top-style')).toBe('none');
    expect(declared(bar, 'border-right-style')).toBe('none');
    /*
     * The SHORTHAND, deliberately. jsdom's cssstyle does not expand `border-radius` into its four
     * corner longhands, so `border-bottom-left-radius` reads back as `0` however the sheet is
     * written — an assertion on it fails against correct CSS, which is worse than no assertion.
     */
    expect(declared(bar, 'border-radius')).toBe('0 0 0 4px');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-010 — space inside every button, and space between the groups
 * ────────────────────────────────────────────────────────────────────────── */

describe('every action button has visible space between its glyph and its border (FR-010)', () => {
  it('declares a non-zero padding on all four sides', () => {
    /*
     * The bar shipped with `padding: 0` on a fixed 24px box, so each glyph sat hard against its own
     * border and the row read as a wall of squares. A padding on all four sides is the declaration
     * that guarantees the gap at every icon size a theme can produce — a fixed box alone does not,
     * because the glyph is centred and scaled to FILL it.
     */
    for (const side of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
      expect(px(button, side), `${side} on .find-bar-btn`).toBeGreaterThan(0);
    }
  });

  it('still sizes every button identically, whatever glyph a theme supplies', () => {
    // The padding must not be bought by letting the glyph set the button's dimensions: the boxes
    // stay uniform across "Aa", "ab" and an emoji, which is what `box-sizing: border-box` on a
    // fixed width and height guarantees once padding exists.
    expect(declared(button, 'box-sizing')).toBe('border-box');
    expect(px(button, 'width')).toBeGreaterThan(0);
    expect(px(button, 'width')).toBe(px(button, 'height'));
  });
});

describe('the match-mode, navigation and replace groups are distinguishable (FR-010)', () => {
  it('separates groups by more than it separates the buttons inside one', () => {
    /*
     * "Visually distinguishable as groups" with no layout to measure comes down to one comparison:
     * the space BETWEEN two groups must exceed the space between two buttons within a group. Equal
     * gaps are exactly the wall of squares the requirement exists to end, and this assertion fails
     * on them.
     */
    const withinGroup = px(group, 'gap');
    const betweenGroups = px(row, 'gap');

    expect(withinGroup, '.find-bar-group must declare its own gap').toBeGreaterThanOrEqual(0);
    expect(
      betweenGroups,
      'the row separates GROUPS; it must give them more room than a group gives its own buttons',
    ).toBeGreaterThan(withinGroup);
  });

  it('lays a group out as a row of centred controls', () => {
    // Without this the wrapper would stack its buttons vertically the moment it was introduced —
    // a change no gap assertion above could see.
    expect(declared(group, 'display')).toBe('flex');
    expect(declared(group, 'align-items')).toBe('center');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-011 — the disclosure control is a themeable icon, and nothing is hardcoded
 * ────────────────────────────────────────────────────────────────────────── */

function editorController(): SearchController {
  return {
    panelKind: 'editor',
    seedFromSelection: () => '',
    setQuery: () => NO_MATCHES,
    findNext: () => NO_MATCHES,
    findPrevious: () => NO_MATCHES,
    close: () => {},
    replaceCurrent: () => NO_MATCHES,
    replaceAll: () => NO_MATCHES,
    isReadOnly: () => false,
  };
}

describe('the disclosure control 043 adds obeys the icon rule (FR-011)', () => {
  beforeEach(() => {
    __resetFindState();
    registerPanelSearch(PANEL, editorController());
    openFind(PANEL, 'editor');
    render(createElement(FindBar, { panelId: PANEL }));
  });

  afterEach(() => {
    unregisterPanelSearch(PANEL);
    __resetFindState();
  });

  it('draws a glyph from the ACTIVE THEME rather than an inline vector', () => {
    /*
     * The constitutional rule, asserted where it can actually be checked: the rendered text is the
     * shipped theme's own glyph for the token, so re-skinning the icon set re-skins this control.
     * An inline `<svg>` — the failure mode SC-002 names — passes no part of this.
     */
    const control = screen.getByTestId('find-toggle-replace');

    expect(control.querySelector('svg'), 'an icon control must never be an inline vector').toBeNull();
    expect(control).toHaveTextContent(THRONG_THEME.icons.expand);
  });

  it('names its action in a hover title, and names the OTHER action once expanded', async () => {
    const user = userEvent.setup();
    const control = screen.getByTestId('find-toggle-replace');

    const collapsedTitle = control.getAttribute('title') ?? '';
    expect(collapsedTitle, 'the control must carry a hover title naming its action').not.toBe('');

    await user.click(control);

    const expanded = screen.getByTestId('find-toggle-replace');
    expect(expanded).toHaveTextContent(THRONG_THEME.icons.collapse);
    expect(
      expanded.getAttribute('title'),
      'the title names what the click will DO, so it changes with the state',
    ).not.toBe(collapsedTitle);
  });

  it('hardcodes no colour on the element itself', () => {
    /*
     * Colours come from the `.find-bar-btn` rule, whose every colour is a theme token. What this can
     * see — and what a hardcoded colour would show up as — is an inline style attribute on the
     * control or on the glyph inside it.
     */
    const control = screen.getByTestId('find-toggle-replace');
    expect(control.getAttribute('style'), 'no inline style on the control').toBeNull();
    for (const child of control.querySelectorAll('*')) {
      expect(child.getAttribute('style'), `no inline style on ${child.tagName}`).toBeNull();
    }
    // It wears the shared action-button class, which is where the theme tokens are applied.
    expect(control.className).toContain('find-bar-btn');
  });
});
