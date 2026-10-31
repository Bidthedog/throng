/**
 * Folding the Themes tab, Icons section included (056 US4, US5; FR-010, FR-011b, FR-012, FR-013, SC-002).
 *
 * Layer: component — the third consumer of the one shared rendering, and the one with the awkward cases:
 * it borrows the Settings tab's `settings-group-` test-id prefix (so fold keys must come from names, never
 * from ids — research R4), and its Icons section is hand-built rather than generated from the registry.
 *
 * Uses the SHIPPED theme registry, so counts are the registry's own.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_METADATA, THRONG_THEME, formatGrouped } from '@throng/core';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

const DEBOUNCE_MS = 150;
const STORE = 'throng.preferences.folds';

/** The groups the tab draws: icon tokens belong to the Icons section, `iconColour` sits beside the pack. */
const TOKENS = THEME_METADATA.filter((d) => d.control !== 'icon' && d.key !== 'colours.iconColour');
const GROUPS = [...new Set(TOKENS.map((d) => d.group))];
const FIRST = GROUPS[0];
const LAST = GROUPS[GROUPS.length - 1];
const idOf = (group: string): string => `settings-group-${group}`;
const ICONS = 'settings-group-Icons';
const ICON_TOTAL = Object.keys(THRONG_THEME.icons).length + 2;
const ALL = [...GROUPS.map(idOf), ICONS];

/** A colour token, and the group it is drawn in. */
const COLOUR = TOKENS.find((d) => d.key.startsWith('colours.') && d.clearable !== true)!;

function mount() {
  return render(
    createElement(NotificationProvider, null, createElement(ConfirmProvider, null, createElement(ThemesTab))),
  );
}

const toggle = (id: string): HTMLElement => screen.getByTestId(`${id}-toggle`);
const count = (id: string): string => screen.getByTestId(`${id}-count`).textContent ?? '';
const expanded = (id: string): boolean => toggle(id).getAttribute('aria-expanded') === 'true';
const isHidden = (el: HTMLElement): boolean => el.closest('[hidden]') !== null;

/**
 * 056 FR-016 folds sections by default. The suites below were written against all-open, so they run with
 * the test seam (`foldDefault=open`, research R10). The "sections start folded" describe clears it.
 */
const setOpenSeam = (open: boolean): void => window.history.replaceState(null, '', open ? '/?foldDefault=open' : '/');

beforeEach(() => {
  localStorage.clear();
  setOpenSeam(true);
});

describe('sections start folded, Icons included (FR-016, FR-017, SC-006) — no seam', () => {
  beforeEach(() => setOpenSeam(false));

  const allRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid^="theme-row-"]')];

  it('mounts with every group and the Icons section folded and 0 rows visible', () => {
    mount();
    expect(allRows().length, 'rows are mounted, just hidden').toBeGreaterThan(0);
    for (const id of ALL) expect(expanded(id), id).toBe(false);
    expect(allRows().filter((r) => !isHidden(r))).toEqual([]);
    expect(isHidden(screen.getByTestId('icon-grid')), 'the Icons grid is hidden').toBe(true);
    expect(isHidden(toggle(ICONS)), 'the headings stay visible').toBe(false);
  });

  it('shows all of a group rows after one click, with no second click', () => {
    mount();
    fireEvent.click(toggle(idOf(FIRST)));
    expect(expanded(idOf(FIRST))).toBe(true);
    const inGroup = [...screen.getByTestId(idOf(FIRST)).querySelectorAll<HTMLElement>('[data-testid^="theme-row-"]')];
    expect(inGroup.length).toBeGreaterThan(0);
    expect(inGroup.filter((r) => isHidden(r))).toEqual([]);
    // Nested headings under it default to unfolded (US1 scenario 6).
    const nested = [...screen.getByTestId(idOf(FIRST)).querySelectorAll<HTMLElement>('button[data-testid$="-toggle"]')].filter(
      (b) => b !== toggle(idOf(FIRST)),
    );
    for (const b of nested) expect(b.getAttribute('aria-expanded')).toBe('true');
  });

  it('unfolds the Icons section on one click', () => {
    mount();
    fireEvent.click(toggle(ICONS));
    expect(isHidden(screen.getByTestId('icon-grid'))).toBe(false);
  });

  it('keeps an unfolded group open across a remount while the rest stay folded (FR-017)', () => {
    const first = mount();
    fireEvent.click(toggle(idOf(LAST)));
    first.unmount();
    mount();
    expect(expanded(idOf(LAST))).toBe(true);
    expect(expanded(idOf(FIRST))).toBe(false);
    expect(expanded(ICONS)).toBe(false);
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a token group heading folds (FR-001, FR-006)', () => {
  it('has the groups the tests below rely on', () => {
    expect(GROUPS.length).toBeGreaterThan(1);
    expect(COLOUR).toBeDefined();
  });


  // MOVED DOWN: fold-on-click and restore is the shared element's behaviour, asserted for the Settings tab in
  // settings-tab-folding.test.ts and in isolation in preferences-fold-heading.test.ts.
});

describe('the Icons section folds like every other section (FR-013)', () => {
  it('counts the pack row, the colour row and every icon token', () => {
    mount();
    expect(count(ICONS)).toBe(formatGrouped(ICON_TOTAL));
  });

  it('hides its grid when folded and shows it again when unfolded', () => {
    mount();
    expect(isHidden(screen.getByTestId('icon-grid'))).toBe(false);
    fireEvent.click(toggle(ICONS));
    expect(expanded(ICONS)).toBe(false);
    expect(isHidden(screen.getByTestId('icon-grid'))).toBe(true);
    expect(count(ICONS)).toBe(formatGrouped(ICON_TOTAL));
    fireEvent.click(toggle(ICONS));
    expect(isHidden(screen.getByTestId('icon-grid'))).toBe(false);
  });

  it('is remembered under the themes namespace as ["Icons"]', () => {
    const first = mount();
    fireEvent.click(toggle(ICONS));
    first.unmount();
    const stored = JSON.parse(localStorage.getItem(STORE)!) as Record<string, Record<string, boolean>>;
    expect(stored.themes).toEqual({ [JSON.stringify(['Icons'])]: true });
    mount();
    expect(expanded(ICONS)).toBe(false);
  });
});

describe('fold state is remembered, per tab (FR-010, FR-012)', () => {
  it('opens every group, Icons included, unfolded with nothing remembered, with the open seam', () => {
    mount();
    for (const id of ALL) expect(expanded(id), id).toBe(true);
  });

  it('folding a group here leaves the same-named Settings group alone, and the reverse', () => {
    const first = mount();
    fireEvent.click(toggle(idOf(FIRST)));
    first.unmount();
    const stored = JSON.parse(localStorage.getItem(STORE)!) as Record<string, Record<string, boolean>>;
    expect(stored.themes).toEqual({ [JSON.stringify([FIRST])]: true });
    expect(stored.settings, 'the settings namespace is untouched').toEqual({});
  });

  it('is not affected by a fold remembered for the same name on the Settings tab', () => {
    localStorage.setItem(STORE, JSON.stringify({ v: 2, settings: { [JSON.stringify([FIRST])]: true } }));
    mount();
    expect(expanded(idOf(FIRST))).toBe(true);
  });
});

// DELETED: the Tab walk and Enter / Space on a heading are the shared FoldHeading's (preferences-fold-heading.test.ts:
// a real button, toggles on Enter and Space); nothing here is Themes-specific.

describe('a search shows matches in folded groups (FR-008, FR-009)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function search(text: string): void {
    fireEvent.change(screen.getByTestId('themes-search'), { target: { value: text } });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 10);
    });
  }

  it('unfolds a folded group holding a match, reads "N of M", and restores the fold on clear', () => {
    mount();
    fireEvent.click(toggle(idOf(COLOUR.group)));
    const row = screen.getByTestId(`theme-row-${COLOUR.key}`);
    expect(isHidden(row)).toBe(true);

    search(COLOUR.key);

    expect(expanded(idOf(COLOUR.group))).toBe(true);
    expect(isHidden(screen.getByTestId(`theme-row-${COLOUR.key}`))).toBe(false);
    expect(count(idOf(COLOUR.group))).toMatch(/^[\d,]+ of [\d,]+$/);

    fireEvent.click(screen.getByTestId('themes-search-clear'));
    expect(expanded(idOf(COLOUR.group))).toBe(false);
  });

  it('unfolds a folded Icons section that holds a match, with "N of M" against its total', () => {
    mount();
    fireEvent.click(toggle(ICONS));
    search('chevron');
    expect(expanded(ICONS)).toBe(true);
    expect(isHidden(screen.getByTestId('icon-grid'))).toBe(false);
    expect(count(ICONS).endsWith(`of ${formatGrouped(ICON_TOTAL)}`)).toBe(true);
    fireEvent.click(screen.getByTestId('themes-search-clear'));
    expect(expanded(ICONS)).toBe(false);
  });
});

describe('an invalid entry is flagged on a folded heading (FR-007)', () => {
  it('shows the warning marker for a colour made invalid then folded', async () => {
    const user = userEvent.setup();
    mount();
    const hex = screen.getByTestId(`control-${COLOUR.key}-hex`);
    await user.clear(hex);
    await user.type(hex, 'not a colour');
    await user.tab();
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId(`${idOf(COLOUR.group)}-invalid`)).toBeNull();

    await user.click(toggle(idOf(COLOUR.group)));
    expect(await screen.findByTestId(`${idOf(COLOUR.group)}-invalid`)).toBeInTheDocument();
    // Unfolding shows the entry exactly as it was left.
    await user.click(toggle(idOf(COLOUR.group)));
    expect(screen.getByTestId(`control-${COLOUR.key}-hex`)).toHaveValue('not a colour');
  });
});

describe('Expand All and Collapse All (FR-011b)', () => {
  const expandAll = (): HTMLElement => screen.getByTestId('themes-expand-all');
  const collapseAll = (): HTMLElement => screen.getByTestId('themes-collapse-all');

  it('cover every group and the Icons key, and persist', () => {
    const first = mount();
    fireEvent.click(collapseAll());
    for (const id of ALL) expect(expanded(id), id).toBe(false);
    first.unmount();
    mount();
    for (const id of ALL) expect(expanded(id), `${id} after remount`).toBe(false);
    fireEvent.click(expandAll());
    for (const id of ALL) expect(expanded(id), `${id} expanded`).toBe(true);
  });

  // DELETED: disabled-while-searching, tab-only and Tab / Enter reachability of the bulk buttons are the shared
  // FoldAllButtons' (preferences-fold-heading.test.ts) and the Settings tab's wiring (settings-tab-folding.test.ts).
});
