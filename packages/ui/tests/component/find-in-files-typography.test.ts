/**
 * 043 T158/T160/T161/T162 — the Find in Files panel's TYPOGRAPHY (FR-064, FR-063).
 *
 * ══ THIS IS A DEFECT, NOT A FEATURE ══
 *
 * 021 FR-049 already requires the **Pane Text** role to reach *"the body text of every pane and
 * panel"*. `theme.css` implements that as one rule with a selector list, and a component subscribes
 * by carrying a class in that list — `panes.css:50-58`'s `.pane-explorer__empty` is the worked
 * example, comment and all. `find-in-files.css` carries NONE of those selectors: the panel inherits
 * `body` and then shrinks its metadata to `0.85em` against the wrong base. FR-064 records the
 * correction; no requirement is added.
 *
 * ══ WHY THE ASSERTION IS SHAPED THIS WAY ══
 *
 * jsdom does not resolve `var()` through the cascade, so `getComputedStyle(el).fontFamily` on a rule
 * reading `var(--throng-font-paneText-family)` reads back the literal text or nothing at all, and
 * would pass either way. What CAN be asserted exactly is the two halves that together mean "this
 * text resolves the role": the role's selector list, read from `theme.css` as text, and whether the
 * rendered element (or an ancestor it inherits from) MATCHES one of those selectors — which is a
 * real `Element.matches()` against the real DOM the panel renders, not a string comparison.
 *
 * A form control gets its own clause because a browser gives it a UA font rather than the inherited
 * one: an `<input>` under a role-bearing ancestor still renders in Arial unless the sheet says
 * `font: inherit`. Asserting only the ancestor match would pass on an input that visibly does not
 * follow the role.
 *
 * ══ THE SNIPPET KEEPS THE EDITOR FAMILY, AND ONLY THE FAMILY (T160, R29) ══
 *
 * Code is monospace, so `.fif-row__snippet` borrows `--throng-font-editor-family` — and takes its
 * SIZE and WEIGHT from Pane Text like everything else in the panel. The reason is not taste: the
 * editor role's size is independently user-configurable, and the results list is windowed on a fixed
 * row-height constant (R26). A row height that is a function of two independent settings is one the
 * windowing arithmetic cannot predict, and R26's whole finding is that the arithmetic and the
 * rendered height must agree exactly. So the family is borrowed deliberately, and nothing else is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/*
 * Resolved from the working directory, not from `import.meta.url` — this layer runs in jsdom, where
 * `import.meta.url` is an `http:` URL and `fileURLToPath` throws before a test is collected.
 * `find-in-files-results.test.ts` reads the same sheet the same way for the same reason.
 */
const PANEL_CSS = resolve(
  process.cwd(),
  'packages/ui/src/renderer/find-in-files/find-in-files.css',
);
const THEME_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/theme.css');

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

function read(path: string): string {
  expect(existsSync(path), `${path} was not found`).toBe(true);
  return readFileSync(path, 'utf8');
}

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

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render the panel and deliver one result, so a heading and a row exist to read. */
async function withOneResult(): Promise<void> {
  const user = userEvent.setup();
  renderFindInFilesPanel();
  await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/a.ts', 1, 6)],
    totalMatches: 1,
  });
}

/** Whether an element, or something it inherits its font from, subscribes to the Pane Text role. */
function reachesPaneText(el: Element): boolean {
  return paneTextRule().selectors.some((selector) => el.closest(selector) !== null);
}

function bodyTextElements(): Record<string, Element> {
  const heading = document.querySelector('.fif-group__key');
  const snippet = document.querySelector('.fif-row__snippet');
  expect(heading, 'no group heading rendered').not.toBeNull();
  expect(snippet, 'no result snippet rendered').not.toBeNull();
  return {
    'the file heading': heading as Element,
    'a result snippet': snippet as Element,
    'the search term field': screen.getByTestId(`fif-term-${PANEL_ID}`),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-064 — the panel's body text follows Pane Text
 * ────────────────────────────────────────────────────────────────────────── */

describe('the panel takes the Pane Text typography role (FR-064, 021 FR-049)', () => {
  it('hands out family, size and weight from that role, so subscribing is enough', () => {
    // Guard the role itself. If `theme.css` stopped emitting any of the three, every assertion
    // below would still pass while the panel resolved nothing.
    const body = paneTextRule().body;
    expect(body).toContain('font-family: var(--throng-font-paneText-family)');
    expect(body).toContain('font-size: var(--throng-font-paneText-size)');
    expect(body).toContain('font-weight: var(--throng-font-paneText-weight)');
  });

  it('puts every piece of the panel body text under one of that role’s selectors', async () => {
    await withOneResult();
    for (const [what, el] of Object.entries(bodyTextElements())) {
      expect(
        reachesPaneText(el),
        `${what} resolves no Pane Text: nothing it inherits from matches ` +
          `[${paneTextRule().selectors.join(', ')}]`,
      ).toBe(true);
    }
  });

  it('makes the panel’s form controls inherit rather than take a UA font', () => {
    // A browser does not give an `<input>` the inherited font. Without this the term, replacement
    // and scope fields render in the UA's own face at the UA's own size inside a panel that has
    // otherwise taken the role — which the ancestor match above cannot see.
    expect(panelRule('.fif-input')).toMatch(/font:\s*inherit/);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * T160 — the snippet borrows the editor FAMILY and nothing else
 * ────────────────────────────────────────────────────────────────────────── */

describe('the code snippet keeps the editor family only (FR-064, R29)', () => {
  it('reads the editor role’s family', () => {
    expect(panelRule('.fif-row__snippet')).toContain(
      'font-family: var(--throng-font-editor-family)',
    );
  });

  it('sets no size or weight of its own, so both come from Pane Text', async () => {
    const snippet = panelRule('.fif-row__snippet');
    expect(snippet).not.toMatch(/font-size\s*:/);
    expect(snippet).not.toMatch(/font-weight\s*:/);

    await withOneResult();
    const el = document.querySelector('.fif-row__snippet');
    expect(el, 'no result snippet rendered').not.toBeNull();
    expect(reachesPaneText(el as Element)).toBe(true);
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

/* ────────────────────────────────────────────────────────────────────────── *
 * T161 — the metadata stays relative, and stays exactly this much of the sheet
 * ────────────────────────────────────────────────────────────────────────── */

describe('secondary metadata stays relative to the corrected base (T161, R29)', () => {
  it('shrinks exactly five selectors, over three rules', () => {
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
    expect(shrunk).toEqual([
      '.fif-scope__missing',
      '.fif-status',
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

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-063 — the file heading is bold, from a token
 * ────────────────────────────────────────────────────────────────────────── */

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
