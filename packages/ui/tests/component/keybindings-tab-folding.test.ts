/**
 * Folding the Key Bindings tab (056 US4, US5; FR-010, FR-011b, FR-013).
 *
 * Layer: component — the same claims as `settings-tab-folding.test.ts`, asserted on the second consumer of
 * the one shared rendering. FR-013 is only meaningful if each tab is checked: the failure it exists to
 * stop is a heading that folds correctly in one tab and silently not in another.
 *
 * Uses the SHIPPED registry (it declares groups, no subgroups), so the counts are the registry's own.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYBINDINGS_METADATA, formatGrouped } from '@throng/core';
import { KeybindingsTab } from '../../src/renderer/preferences/keybindings-tab.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';

const DEBOUNCE_MS = 150;
const STORE = 'throng.preferences.folds';

const GROUPS = [...new Set(KEYBINDINGS_METADATA.map((d) => d.group))];
const FIRST = GROUPS[0];
const LAST = GROUPS[GROUPS.length - 1];
const idOf = (group: string): string => `keybindings-group-${group}`;
/** A binding in the LAST group, and a query that finds it. */
const TARGET = [...KEYBINDINGS_METADATA].reverse().find((d) => d.group === LAST)!;

function mount() {
  return render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ContextMenuProvider, null, createElement(KeybindingsTab, { searchDebounceMs: DEBOUNCE_MS })),
      ),
    ),
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

describe('sections start folded (FR-016, FR-017, SC-006) — no seam', () => {
  beforeEach(() => setOpenSeam(false));

  const allRows = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="binding-"]')];

  it('mounts with every group folded and 0 binding rows visible', () => {
    mount();
    expect(allRows().length, 'rows are mounted, just hidden').toBeGreaterThan(0);
    for (const g of GROUPS) expect(expanded(idOf(g)), g).toBe(false);
    expect(allRows().filter((r) => !isHidden(r))).toEqual([]);
    expect(isHidden(toggle(idOf(FIRST))), 'the headings stay visible').toBe(false);
  });

  it('shows all of a group rows after one click, with no second click', () => {
    mount();
    fireEvent.click(toggle(idOf(FIRST)));
    expect(expanded(idOf(FIRST))).toBe(true);
    const keys = KEYBINDINGS_METADATA.filter((d) => d.group === FIRST).map((d) => `binding-${d.key}`);
    const inGroup = keys.map((id) => screen.getByTestId(id));
    expect(inGroup.length).toBeGreaterThan(0);
    expect(inGroup.filter((r) => isHidden(r))).toEqual([]);
    expect(expanded(idOf(LAST)), 'the other groups stay folded').toBe(false);
  });

  it('keeps an unfolded group open across a remount while the rest stay folded (FR-017)', () => {
    const first = mount();
    fireEvent.click(toggle(idOf(LAST)));
    first.unmount();
    mount();
    expect(expanded(idOf(LAST))).toBe(true);
    expect(expanded(idOf(FIRST))).toBe(false);
  });
});

describe('a group heading folds (FR-001, FR-006)', () => {
  it('has at least two groups to tell apart', () => {
    expect(GROUPS.length).toBeGreaterThan(1);
  });

  it('shows its binding count, folds on click and restores on a second click', () => {
    mount();
    const total = KEYBINDINGS_METADATA.filter((d) => d.group === FIRST).length;
    expect(count(idOf(FIRST))).toBe(formatGrouped(total));
    const first = KEYBINDINGS_METADATA.find((d) => d.group === FIRST)!;
    const rowId = `binding-${first.key}`;
    expect(isHidden(screen.getByTestId(rowId))).toBe(false);

    fireEvent.click(toggle(idOf(FIRST)));

    expect(expanded(idOf(FIRST))).toBe(false);
    expect(isHidden(screen.getByTestId(rowId))).toBe(true);
    expect(count(idOf(FIRST))).toBe(formatGrouped(total));
    expect(expanded(idOf(LAST)), 'the other groups are untouched').toBe(true);

    fireEvent.click(toggle(idOf(FIRST)));
    expect(isHidden(screen.getByTestId(rowId))).toBe(false);
  });

  it('toggles with Enter and Space (FR-004)', async () => {
    const user = userEvent.setup();
    mount();
    toggle(idOf(FIRST)).focus();
    await user.keyboard('{Enter}');
    expect(expanded(idOf(FIRST))).toBe(false);
    await user.keyboard(' ');
    expect(expanded(idOf(FIRST))).toBe(true);
  });
});

describe('fold state is remembered, per tab (FR-010, FR-011, FR-012)', () => {
  it('opens every group unfolded with nothing remembered, with the open seam', () => {
    mount();
    for (const g of GROUPS) expect(expanded(idOf(g)), g).toBe(true);
  });

  it('survives a remount over the same storage, in the keybindings namespace only', () => {
    const first = mount();
    fireEvent.click(toggle(idOf(FIRST)));
    first.unmount();
    const stored = JSON.parse(localStorage.getItem(STORE)!) as Record<string, Record<string, boolean>>;
    expect(stored.keybindings).toEqual({ [JSON.stringify([FIRST])]: true });
    expect(stored.settings).toEqual({});

    mount();
    expect(expanded(idOf(FIRST))).toBe(false);
    expect(expanded(idOf(LAST))).toBe(true);
  });

  it('is not affected by a fold remembered for the same name on another tab', () => {
    localStorage.setItem(STORE, JSON.stringify({ v: 2, settings: { [JSON.stringify([FIRST])]: true } }));
    mount();
    expect(expanded(idOf(FIRST))).toBe(true);
  });
});

describe('a search shows matches in folded groups (FR-008, FR-009)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function search(text: string): void {
    fireEvent.change(screen.getByTestId('keybindings-search'), { target: { value: text } });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 10);
    });
  }

  it('unfolds a folded group holding a match, reads "N of M", and restores the fold on clear', () => {
    mount();
    fireEvent.click(toggle(idOf(LAST)));
    expect(isHidden(screen.getByTestId(`binding-${TARGET.key}`))).toBe(true);

    search(TARGET.label);

    expect(expanded(idOf(LAST))).toBe(true);
    expect(isHidden(screen.getByTestId(`binding-${TARGET.key}`))).toBe(false);
    expect(count(idOf(LAST))).toMatch(/^[\d,]+ of [\d,]+$/);
    const total = KEYBINDINGS_METADATA.filter((d) => d.group === LAST).length;
    expect(count(idOf(LAST)).endsWith(`of ${formatGrouped(total)}`)).toBe(true);

    fireEvent.click(screen.getByTestId('keybindings-search-clear'));
    expect(expanded(idOf(LAST))).toBe(false);
    expect(count(idOf(LAST))).toBe(formatGrouped(total));
  });

  it('never writes during a search', () => {
    mount();
    fireEvent.click(toggle(idOf(LAST)));
    const before = localStorage.getItem(STORE);
    search(TARGET.label);
    fireEvent.click(toggle(idOf(LAST)));
    expect(localStorage.getItem(STORE)).toBe(before);
  });
});

describe('Expand All and Collapse All (FR-011b)', () => {
  const expandAll = (): HTMLElement => screen.getByTestId('keybindings-expand-all');
  const collapseAll = (): HTMLElement => screen.getByTestId('keybindings-collapse-all');

  it('fold and unfold every group, and persist', () => {
    const first = mount();
    fireEvent.click(collapseAll());
    for (const g of GROUPS) expect(expanded(idOf(g)), g).toBe(false);
    first.unmount();
    mount();
    for (const g of GROUPS) expect(expanded(idOf(g)), `${g} after remount`).toBe(false);
    fireEvent.click(expandAll());
    for (const g of GROUPS) expect(expanded(idOf(g)), `${g} expanded`).toBe(true);
  });

  it('act on this tab only', () => {
    localStorage.setItem(STORE, JSON.stringify({ v: 2, themes: { [JSON.stringify(['Icons'])]: true } }));
    mount();
    fireEvent.click(collapseAll());
    const stored = JSON.parse(localStorage.getItem(STORE)!) as Record<string, Record<string, boolean>>;
    expect(stored.themes).toEqual({ [JSON.stringify(['Icons'])]: true });
  });

  it('are disabled while the search box has text', () => {
    vi.useFakeTimers();
    try {
      mount();
      fireEvent.change(screen.getByTestId('keybindings-search'), { target: { value: 'x' } });
      expect(expandAll()).toBeDisabled();
      expect(collapseAll()).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('are reachable with Tab and act on Enter', async () => {
    const user = userEvent.setup();
    mount();
    screen.getByTestId('keybindings-search').focus();
    await user.tab();
    expect(document.activeElement).toBe(expandAll());
    await user.tab();
    expect(document.activeElement).toBe(collapseAll());
    await user.keyboard('{Enter}');
    expect(expanded(idOf(FIRST))).toBe(false);
  });
});
