/**
 * How the readouts reach a screen reader (040 US1 — FR-015, FR-016, FR-017, FR-018).
 *
 * ══ THE THREE CLAIMS, AND WHY EACH IS A REQUIREMENT RATHER THAN A PREFERENCE ══
 *
 * **FR-015 — the name says what the figure IS.** `Ln` is not a word. A reader that announces
 * "Ell En four one two" has given the user a puzzle, and one that announces "412" has given them a
 * number with no subject. The abbreviated form exists for sighted density and must not be the
 * accessible name.
 *
 * **FR-016 — NOT a live region.** The caret moves on every keypress, and the editor already
 * announces the line the user navigated to. A polite region here would queue an announcement per
 * arrow key; an assertive one would interrupt the editor's own on every arrow key. Either makes the
 * editor unusable with a screen reader, and the failure would be invisible to everyone who does not
 * use one.
 *
 * **FR-017 — hidden means ABSENT, not invisible.** A figure a sighted user cannot see must not be
 * read out to a user who cannot see the bar either. `display: none` and "not rendered" both satisfy
 * that; `visibility` tricks and `width: 0` do not.
 *
 * **FR-018 — a negative, and negatives are what a later feature quietly breaks.** #282 tracks
 * status-bar controls announced by their glyph rather than their action. This feature is not
 * required to fix that, and is required not to add to it.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  scheduleDocumentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';

const PANEL = 'p1';
const DOC_KEY = `panel:${PANEL}`;

beforeEach(() => {
  vi.useFakeTimers();
  __resetCaretStore();
  __resetDocumentMetricsStore();
});

afterEach(() => {
  vi.useRealTimers();
  removePanelLanguage(PANEL);
});

function strip(opts: { line: number; column: number; selected?: number | null; text?: string }) {
  setPanelCaret(PANEL, { line: opts.line, column: opts.column }, opts.selected ?? null);
  if (opts.text !== undefined) {
    scheduleDocumentMetrics(DOC_KEY, opts.text);
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }
  render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
}

const readout = (id: string): HTMLElement => screen.getByTestId(`editor-status-${id}-${PANEL}`);

/** 1,204 characters over 208 words — the figures FR-012 and FR-015 both use as their example. */
const FIXTURE = Array.from({ length: 208 }, (_, i) => 'x'.repeat(i < 165 ? 5 : 4)).join(' ');

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-015 — "line 412", never "Ln 412" and never "412"
 * ────────────────────────────────────────────────────────────────────────── */

describe('each readout is named by what its figure IS (FR-015)', () => {
  it('names all five in words', () => {
    strip({ line: 412, column: 7, selected: 63, text: FIXTURE });

    expect(readout('line')).toHaveAccessibleName('line 412');
    expect(readout('column')).toHaveAccessibleName('column 7');
    expect(readout('selected')).toHaveAccessibleName('63 characters selected');
    expect(readout('chars')).toHaveAccessibleName('1,204 characters');
    expect(readout('words')).toHaveAccessibleName('208 words');
  });

  it('never announces the ABBREVIATION, which is what the requirement names', () => {
    // The literal wording of FR-015: "line 412", not "Ln 412" and not "412". Asserted as a negative
    // as well as a positive, because a name that merely differs from the visible text is not
    // automatically a good one.
    strip({ line: 412, column: 7, text: FIXTURE });

    // `?? ''` so a MISSING label fails the positive assertions above rather than throwing here on
    // a null — the negative is about what the name says, not about whether there is one.
    expect(readout('line').getAttribute('aria-label') ?? '').not.toMatch(/\bLn\b/);
    expect(readout('column').getAttribute('aria-label') ?? '').not.toMatch(/\bCol\b/);
  });

  it('never announces a bare number with no subject', () => {
    strip({ line: 412, column: 7, text: FIXTURE });

    for (const id of ['line', 'column', 'chars', 'words']) {
      const name = readout(id).getAttribute('aria-label') ?? '';
      expect(name, `${id} must say what its figure is`).toMatch(/[a-z]{3,}/);
    }
  });

  it('reads a singular figure in the singular', () => {
    /*
     * "1 characters" is the tell of a name assembled by concatenation and never read aloud. The
     * VISIBLE label stays `chars`/`words` — those are the declared forms US2 shortens, and they are
     * abbreviations rather than English — but the announced name is a sentence and has to sound
     * like one.
     */
    strip({ line: 1, column: 1, selected: 1, text: 'x' });

    expect(readout('selected')).toHaveAccessibleName('1 character selected');
    expect(readout('chars')).toHaveAccessibleName('1 character');
    expect(readout('words')).toHaveAccessibleName('1 word');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-016 — nothing here announces itself
 * ────────────────────────────────────────────────────────────────────────── */

describe('the readouts are not a live region (FR-016)', () => {
  /** Every element from a readout up to the strip — the whole chain a live region could hide in. */
  function ancestry(id: string): HTMLElement[] {
    const chain: HTMLElement[] = [];
    let node: HTMLElement | null = readout(id);
    const root = screen.getByTestId(`editor-status-strip-${PANEL}`);
    while (node) {
      chain.push(node);
      if (node === root) break;
      node = node.parentElement;
    }
    return chain;
  }

  it('declares no aria-live anywhere between the readout and the strip', () => {
    /*
     * Checked up the ANCESTRY rather than on the readout itself: `aria-live` is inherited by
     * descendants, so a `role="status"` on the strip would make all five readouts announce while
     * every per-element assertion passed.
     */
    strip({ line: 412, column: 7, selected: 63, text: FIXTURE });

    for (const el of ancestry('line')) {
      expect(el.getAttribute('aria-live'), `${el.className} must not be a live region`).toBeNull();
    }
  });

  it('uses none of the roles that ARE live regions', () => {
    // `role="status"` and `role="alert"` carry implicit `aria-live` — a live region declared
    // without the attribute that would have made it searchable.
    strip({ line: 412, column: 7, selected: 63, text: FIXTURE });

    for (const el of ancestry('chars')) {
      expect(['status', 'alert', 'log', 'marquee', 'timer']).not.toContain(el.getAttribute('role'));
    }
  });

  it('is not aria-atomic either', () => {
    // `aria-atomic` alone announces nothing, but it is only ever added in service of a live region,
    // so its presence means one is on the way.
    strip({ line: 412, column: 7, text: FIXTURE });

    for (const el of ancestry('words')) {
      expect(el.getAttribute('aria-atomic')).toBeNull();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-017 — a readout that is not shown is not in the tree
 * ────────────────────────────────────────────────────────────────────────── */

describe('a readout that is not shown is absent from the accessibility tree (FR-017)', () => {
  it('leaves no named element behind when there is no selection', () => {
    /*
     * The case that exists today. The width-driven half of FR-017 arrives with US2's hide order and
     * is asserted there; the preference-driven half with US3. What makes all three ONE requirement
     * is that a hidden readout must be gone rather than merely invisible — so the mechanism proved
     * here (it is not rendered at all) is the mechanism the other two inherit.
     */
    strip({ line: 412, column: 7, selected: null, text: FIXTURE });

    expect(screen.queryByLabelText(/selected/)).toBeNull();
    expect(screen.queryByTestId(`editor-status-selected-${PANEL}`)).toBeNull();
  });

  it('leaves no named element behind while the counts have not settled', () => {
    strip({ line: 412, column: 7 });

    expect(screen.queryByLabelText(/characters$/)).toBeNull();
    expect(screen.queryByLabelText(/words$/)).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-018 — nothing this feature adds joins #282's backlog
 * ────────────────────────────────────────────────────────────────────────── */

describe('everything this feature adds arrives named (FR-018)', () => {
  it('gives every readout in the bar a non-empty accessible name', () => {
    /*
     * Written over whatever the leading group CONTAINS rather than over a list of five ids, so a
     * sixth readout added later is covered by this test on the day it is added. That is the whole
     * point of a negative requirement: the thing it guards against is a FUTURE change.
     */
    strip({ line: 412, column: 7, selected: 63, text: FIXTURE });
    const group = screen.getByTestId(`editor-status-readouts-${PANEL}`);
    const children = [...group.children] as HTMLElement[];

    expect(children.length, 'the group must actually hold the readouts').toBe(5);
    const unnamed = children.filter((el) => (el.getAttribute('aria-label') ?? '').trim() === '');
    expect(
      unnamed.map((el) => el.textContent),
      'a readout announced by its abbreviation alone is exactly what #282 tracks',
    ).toEqual([]);
  });

  it('keeps the measuring ruler out of the accessibility tree, and out of the duplicate business', () => {
    /*
     * ══ WHAT THE RULER IS AND WHAT IT MUST NOT BE ══
     *
     * The bar draws every present readout a second time, hidden and out of flow, so both label forms
     * can be measured before the first fit decision (FR-021, FR-022a). Those copies are a measuring
     * stick, not content, and this pins the two properties that keep them so.
     *
     * **Nothing in the a11y tree.** No `aria-label`, no test id, `aria-hidden` on the container. That
     * is exactly what makes FR-016 and FR-017 checkable at all: every query that can answer them
     * (`getByRole`, `getByLabelText`, `getByTestId`) is blind to the ruler by construction. It is NOT
     * blind to `getByText`, which filters on neither `aria-hidden` nor `visibility` — which is why
     * nothing in this area queries the bar by its text.
     *
     * **One copy per DISTINCT form.** `Ln` and `Col` are their own short form, so a ruler that drew
     * both forms unconditionally put a second character-identical copy of those two readouts into
     * the document — measuring a width it already had, and taking `getByText('Ln 412')` from two
     * matches to three. The bar must draw exactly the strings whose widths it does not already know.
     */
    strip({ line: 412, column: 7, selected: 63, text: FIXTURE });
    const bar = screen.getByTestId(`editor-status-strip-${PANEL}`);
    const ruler = bar.querySelector('.editor-status-strip__ruler');

    expect(ruler, 'the bar must draw a ruler at all, or every width below is vacuous').not.toBeNull();
    expect(ruler?.getAttribute('aria-hidden')).toBe('true');
    const copies = [...(ruler?.children ?? [])];
    expect(
      copies.filter((el) => el.hasAttribute('aria-label') || el.hasAttribute('data-testid')),
      'a ruler copy that answered getByLabelText or getByTestId would be indistinguishable from a readout',
    ).toEqual([]);

    // `line` and `column` measure once; `selected`, `chars` and `words` measure twice. Read off the
    // measurement keys, so the claim is about what is DRAWN rather than about a count.
    expect(copies.map((el) => el.getAttribute('data-measure'))).toEqual([
      'line:full',
      'column:full',
      'selected:full',
      'selected:short',
      'chars:full',
      'chars:short',
      'words:full',
      'words:short',
    ]);
  });

  it('adds no control to the bar, so it adds no unnamed control either', () => {
    // US1 adds READOUTS. The only controls in the bar are 016's language indicator and 024's wrap
    // toggle, both of which predate this feature — so #282's list is unchanged by construction, and
    // this test is what makes that claim checkable rather than asserted.
    strip({ line: 412, column: 7, text: FIXTURE });
    const bar = screen.getByTestId(`editor-status-strip-${PANEL}`);

    const controls = [...bar.querySelectorAll('button, input, select, textarea, a[href]')];
    expect(controls.map((el) => el.getAttribute('data-testid'))).toEqual([
      `editor-language-${PANEL}`,
      `editor-word-wrap-${PANEL}`,
    ]);
  });
});
