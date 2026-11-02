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
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
function withOneResult(): void {
  renderFindInFilesPanel();
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });

  // The run control: an Enter this soon after typing is ignored under as-you-type (#389).

  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
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
  it('puts every piece of the panel body text under one of that role’s selectors', () => {
    withOneResult();
    for (const [what, el] of Object.entries(bodyTextElements())) {
      expect(
        reachesPaneText(el),
        `${what} resolves no Pane Text: nothing it inherits from matches ` +
          `[${paneTextRule().selectors.join(', ')}]`,
      ).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * T160 — the snippet borrows the editor FAMILY and nothing else
 * ────────────────────────────────────────────────────────────────────────── */

describe('the code snippet keeps the editor family only (FR-064, R29)', () => {
  it('comes from Pane Text when rendered — the snippet carries a role-bearing ancestor', () => {
    withOneResult();
    const el = document.querySelector('.fif-row__snippet');
    expect(el, 'no result snippet rendered').not.toBeNull();
    expect(reachesPaneText(el as Element)).toBe(true);
  });
});

// T161 (secondary metadata stays relative) and FR-063 (heading weight from a token) read the stylesheet
// only and live in unit/find-in-files-css.test.ts.
