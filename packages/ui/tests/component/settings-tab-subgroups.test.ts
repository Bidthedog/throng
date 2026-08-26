/**
 * A subgroup renders as a subsection of its group, and the Status Bar settings arrive in one
 * (040 US3 — FR-036a, FR-036b, FR-036c, FR-053).
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * Every claim is about the shape of a rendered tree: which element contains which, in what order,
 * and whether a heading survives a filter. jsdom renders all of that faithfully. Nothing here is a
 * measurement, and nothing needs a window — the E2E that opens the preferences window is about the
 * window, not about a heading.
 *
 * ══ WHY FR-053 IS ASSERTED HERE AND NOT IN THE REGISTRY TEST ══
 *
 * `settings-metadata-040.test.ts` proves a DESCRIPTOR exists. That is not the same claim as a row
 * appearing: the completeness gate would stay green for a setting the form never renders, which is
 * exactly the failure mode Principle X's configuration-editor rule exists to stop. So the two
 * toggles are looked for as editable `input`s, inside the subsection, with the right test ids.
 *
 * ══ THE TEST ID IS UNSLUGIFIED, DELIBERATELY ══
 *
 * `settings-subgroup-Editor-Status Bar`, space and all. Every shipped group id is the raw group
 * string — `settings-group-Editor · Navigation`, `settings-group-File Explorer` — so slugifying
 * only the new one would make it the single id in the registry that does not match the string it
 * names. Ugly and consistent beats tidy and singular.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change `SUBGROUP` below to a subgroup no descriptor declares (`'Nonsense'`). Four of the five
 * tests fail on the missing subsection, and the fifth — the FR-036c filter test — starts passing
 * for the wrong reason, which is why it asserts the subsection is PRESENT before the search and
 * absent after, rather than only absent after.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const DEBOUNCE_MS = 150;
const GROUP = 'Editor';
const SUBGROUP = 'Status Bar';
const SUBGROUP_ID = `settings-subgroup-${GROUP}-${SUBGROUP}`;

/** The three settings FR-037 puts in the subsection, in the order the registry declares them. */
const IN_SUBGROUP = [
  'editor.showStatusBar',
  'editor.statusBar.showCursorPosition',
  'editor.statusBar.showCounts',
];

/** An `Editor` setting with NO subgroup — the FR-036b control. */
const NOT_IN_SUBGROUP = 'editor.warnOnMissingFile';

function mount(): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS }),
        ),
      ),
    ),
  );
}

const groupSection = (): HTMLElement => screen.getByTestId(`settings-group-${GROUP}`);
const subsection = (): HTMLElement => screen.getByTestId(SUBGROUP_ID);

function search(text: string): void {
  fireEvent.change(screen.getByTestId('settings-search'), { target: { value: text } });
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE_MS + 10);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-036a — a subsection INSIDE its group's section, in declaration order
 * ────────────────────────────────────────────────────────────────────────── */

describe('a subgroup is a subsection of its group (FR-036a)', () => {
  it('renders the Status Bar subsection inside the Editor section, with its name as a heading', () => {
    mount();
    expect(groupSection()).toContainElement(subsection());
    expect(within(subsection()).getByText(SUBGROUP)).toBeInTheDocument();
  });

  it('holds the three status-bar settings and only those, in declaration order', () => {
    mount();
    // Rows by CLASS rather than by a test-id pattern: `setting-inert-<key>` shares the `setting-`
    // prefix, so a regex over test ids would silently count an explanation as a row.
    const rows = [...subsection().querySelectorAll('.settings-row')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rows).toEqual(IN_SUBGROUP.map((k) => `setting-${k}`));
  });

  it('is not collapsible — no disclosure element and nothing to expand (FR-036a)', () => {
    /*
     * The sections CONTAINING it are plain `<section>` + `<h3>`, so a subsection that folded would
     * be the one foldable thing in a form full of things that do not. Minimisable grouping is
     * #292's, on a different surface.
     */
    mount();
    const el = subsection();
    expect(el.tagName).not.toBe('DETAILS');
    expect(el.querySelector('details')).toBeNull();
    expect(el.querySelector('summary')).toBeNull();
    expect(el.querySelector('[aria-expanded]')).toBeNull();
    // No control of any kind in the heading — the heading is a label, not an affordance.
    expect(within(el).queryByRole('button', { name: SUBGROUP })).toBeNull();
  });

  it('is a labelled group to assistive technology, not an anonymous div', () => {
    /*
     * The subsection heading is the only thing that says which fields belong together, and a bare
     * `<div>` + `<h4>` conveys that VISUALLY and nowhere else — a screen reader reading the form
     * field by field hears three status-bar toggles with nothing to say they are a set.
     * `role="group"` plus `aria-labelledby` pointing at the `<h4>` is the standard grouping pair,
     * and the heading text is already the right label, so nothing new has to be written for it.
     *
     * Asserted through the accessible NAME rather than the raw attribute, so the assertion fails if
     * `aria-labelledby` points at an id that does not resolve — which is the way this breaks.
     */
    mount();
    expect(screen.getByRole('group', { name: SUBGROUP })).toBe(subsection());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-036b — the ungrouped fields come FIRST
 * ────────────────────────────────────────────────────────────────────────── */

describe('fields with no subgroup render above every subsection (FR-036b)', () => {
  it('puts an ordinary Editor row before the Status Bar subsection in document order', () => {
    mount();
    const plain = screen.getByTestId(`setting-${NOT_IN_SUBGROUP}`);
    const position = plain.compareDocumentPosition(subsection());
    // A field must never appear below a subsection heading it does not belong to.
    expect(
      position & Node.DOCUMENT_POSITION_FOLLOWING,
      'the plain row must come BEFORE the subsection',
    ).toBeTruthy();
    expect(subsection()).not.toContainElement(plain);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-036c — an emptied subgroup takes its heading with it
 * ────────────────────────────────────────────────────────────────────────── */

describe('a search that empties a subgroup removes its heading too (FR-036c)', () => {
  it('drops the Status Bar subsection while the Editor section survives', () => {
    mount();
    // Present first, so a subsection that never rendered cannot pass this test by being absent.
    expect(screen.queryByTestId(SUBGROUP_ID)).not.toBeNull();

    /*
     * ONE token, and a key rather than prose. The search is OR over whitespace-separated tokens
     * (`settings-search.ts`), so a phrase like "missing or deleted" would match on "or" — a
     * substring of half the registry — and the subsection would survive for a reason that has
     * nothing to do with the requirement.
     */
    search('warnonmissingfile');

    expect(screen.queryByTestId(`setting-${NOT_IN_SUBGROUP}`), 'the group survives').not.toBeNull();
    expect(screen.queryByTestId(SUBGROUP_ID), 'the emptied subsection is gone').toBeNull();
    expect(screen.queryByText(SUBGROUP), 'and so is its heading').toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-053 — the two new settings are EDITABLE from the visual editor
 * ────────────────────────────────────────────────────────────────────────── */

describe('both new toggles are editable controls in the subsection (FR-053)', () => {
  it('renders a checkbox for each, inside the Status Bar subsection', () => {
    mount();
    for (const key of ['editor.statusBar.showCursorPosition', 'editor.statusBar.showCounts']) {
      const control = screen.getByTestId(`control-${key}`) as HTMLInputElement;
      expect(control.tagName, key).toBe('INPUT');
      expect(control.type, key).toBe('checkbox');
      expect(control.disabled, `${key} must be editable, not inert`).toBe(false);
      // Ticked, because both ship on — and in the subsection, not loose under Editor.
      expect(control.checked, key).toBe(true);
      expect(subsection(), key).toContainElement(control);
    }
  });
});
