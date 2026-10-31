/**
 * Folding the Settings tab (056 US1, US2, US3 and US5 on this tab; FR-001..FR-012, FR-011b).
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * Every claim is about a rendered tree and what happens to it on a click, a keypress or a search: which
 * rows are hidden, which are still mounted, what the heading says, what reached `localStorage`. jsdom
 * renders all of it faithfully, and nothing here needs a window (research R8) — which is why there is no
 * E2E for this feature.
 *
 * The tab is mounted twice in a test to prove persistence: unmount, then mount again over the SAME
 * `localStorage`. That is the whole of what a restart adds, and the browser guarantees the rest.
 *
 * ══ ANTI-VACUITY ══
 *
 * Each absence assertion ("the rows are hidden") is preceded by a presence assertion on the same rows, so
 * a section that never rendered cannot pass it.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const DEBOUNCE_MS = 150;
const STORE = 'throng.preferences.folds';

/** Real keys so the rows have values to draw; the placement is this registry's, not the key's. */
const at = (key: string, group: string, subgroup?: string, subsection?: string): FieldDescriptor => {
  const real = SETTINGS_METADATA.find((d) => d.key === key)!;
  return { ...real, group, ...(subgroup ? { subgroup } : {}), ...(subsection ? { subsection } : {}) };
};

/**
 * A registry of five rows whose counts are legible at a glance:
 *
 *   Editor                       4
 *   ├─ own row                   1   editor.warnOnMissingFile
 *   └─ Previews                  3
 *      ├─ own row                1   editor.showStatusBar
 *      ├─ Markdown               1   editor.statusBar.showCounts
 *      └─ Mermaid                1   editor.statusBar.showCursorPosition
 *   Terminals                    1   (a second top-level section, for "no match disappears")
 */
const NESTED: readonly FieldDescriptor[] = [
  at('editor.warnOnMissingFile', 'Editor'),
  at('editor.showStatusBar', 'Editor', 'Previews'),
  at('editor.statusBar.showCounts', 'Editor', 'Previews', 'Markdown'),
  at('editor.statusBar.showCursorPosition', 'Editor', 'Previews', 'Mermaid'),
  at('terminals.defaultRunAsAdmin', 'Terminals'),
];

const EDITOR = 'settings-group-Editor';
const PREVIEWS = 'settings-subgroup-Editor-Previews';
const MARKDOWN = 'settings-subsection-Editor-Previews-Markdown';
const MERMAID = 'settings-subsection-Editor-Previews-Mermaid';
const TERMINALS = 'settings-group-Terminals';

function tree(registry?: readonly FieldDescriptor[]) {
  const tab = createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS });
  return createElement(
    NotificationProvider,
    null,
    createElement(
      ResetNoticeProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        registry ? createElement(SettingsMetadataContext.Provider, { value: registry }, tab) : tab,
      ),
    ),
  );
}

const mount = (registry?: readonly FieldDescriptor[]) => render(tree(registry));

const toggle = (id: string): HTMLElement => screen.getByTestId(`${id}-toggle`);
const count = (id: string): string => screen.getByTestId(`${id}-count`).textContent ?? '';
const expanded = (id: string): boolean => toggle(id).getAttribute('aria-expanded') === 'true';
const isHidden = (el: HTMLElement): boolean => el.closest('[hidden]') !== null;
const row = (key: string): HTMLElement => screen.getByTestId(`setting-${key}`);

/**
 * 056 FR-016 folds sections by default. The suites below were written against all-open, so they run with
 * the test seam (`foldDefault=open`, research R10) — the same one the E2E harness sets. The "sections start
 * folded" describe clears it, because that is what a real user gets.
 */
const setOpenSeam = (open: boolean): void => window.history.replaceState(null, '', open ? '/?foldDefault=open' : '/');

beforeEach(() => {
  localStorage.clear();
  setOpenSeam(true);
});

/* ────────────────────────────────────────────────────────────────────────── *
 * US1 — fold away the sections I am not working in
 * ────────────────────────────────────────────────────────────────────────── */

describe('clicking a heading folds and unfolds it (FR-001, FR-003)', () => {
  it('hides every row and subsection under a section and leaves the heading, then restores them in order', () => {
    mount(NESTED);
    const rows = ['editor.warnOnMissingFile', 'editor.showStatusBar', 'editor.statusBar.showCounts'];
    for (const key of rows) expect(isHidden(row(key)), `${key} starts visible`).toBe(false);

    fireEvent.click(toggle(EDITOR));

    expect(expanded(EDITOR)).toBe(false);
    // The heading stays in its place and every row and descendant heading is hidden — and still mounted.
    expect(isHidden(toggle(EDITOR))).toBe(false);
    for (const key of rows) expect(isHidden(row(key)), `${key} is hidden`).toBe(true);
    expect(isHidden(screen.getByTestId(PREVIEWS))).toBe(true);
    // Other sections are untouched.
    expect(isHidden(row('terminals.defaultRunAsAdmin'))).toBe(false);

    fireEvent.click(toggle(EDITOR));

    expect(expanded(EDITOR)).toBe(true);
    for (const key of rows) expect(isHidden(row(key)), `${key} is back`).toBe(false);
    const order = [...screen.getByTestId(EDITOR).querySelectorAll('.settings-row')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'setting-editor.warnOnMissingFile',
      'setting-editor.showStatusBar',
      'setting-editor.statusBar.showCounts',
      'setting-editor.statusBar.showCursorPosition',
    ]);
  });

  it('folds a nested subsection without touching the rest of its section', () => {
    mount(NESTED);
    fireEvent.click(toggle(PREVIEWS));
    expect(isHidden(screen.getByTestId(MARKDOWN))).toBe(true);
    expect(isHidden(row('editor.statusBar.showCounts'))).toBe(true);
    // The section's own row and the heading itself remain.
    expect(isHidden(row('editor.warnOnMissingFile'))).toBe(false);
    expect(isHidden(toggle(PREVIEWS))).toBe(false);
  });

  it('folds just the nested subsection when its own heading is clicked', () => {
    mount(NESTED);
    fireEvent.click(toggle(MARKDOWN));
    expect(isHidden(row('editor.statusBar.showCounts'))).toBe(true);
    expect(isHidden(row('editor.statusBar.showCursorPosition'))).toBe(false);
  });

  it('does not cascade: a descendant keeps its own state (FR-003)', () => {
    mount(NESTED);
    fireEvent.click(toggle(PREVIEWS));
    fireEvent.click(toggle(EDITOR));
    fireEvent.click(toggle(EDITOR));
    expect(expanded(EDITOR)).toBe(true);
    expect(expanded(PREVIEWS), 'Previews is still folded').toBe(false);
    expect(isHidden(row('editor.statusBar.showCounts'))).toBe(true);
  });

  it('keeps the group accessible name unchanged (FR-005)', () => {
    mount(NESTED);
    expect(screen.getByRole('group', { name: 'Previews' })).toBe(screen.getByTestId(PREVIEWS));
    expect(screen.getByRole('group', { name: 'Markdown' })).toBe(screen.getByTestId(MARKDOWN));
  });
});

describe('every heading shows how many rows it holds (FR-006)', () => {
  it('counts descendants, folded or not', () => {
    mount(NESTED);
    expect(count(EDITOR)).toBe('4');
    expect(count(PREVIEWS)).toBe('3');
    expect(count(MARKDOWN)).toBe('1');
    expect(count(TERMINALS)).toBe('1');
    fireEvent.click(toggle(EDITOR));
    expect(count(EDITOR)).toBe('4');
  });


  // MOVED DOWN: the real registry's per-section count is asserted over `groupCounts` in
  // unit/group-counts.test.ts; the digit grouping of the rendered number in preferences-fold-heading.test.ts.
});

describe('fold state is remembered (FR-010, FR-011, FR-011a, FR-012)', () => {
  it('opens everything unfolded when nothing is remembered, with the open seam', () => {
    mount(NESTED);
    for (const id of [EDITOR, PREVIEWS, MARKDOWN, MERMAID, TERMINALS]) expect(expanded(id), id).toBe(true);
  });

  it('survives an unmount and a remount over the same storage', () => {
    const first = mount(NESTED);
    fireEvent.click(toggle(PREVIEWS));
    fireEvent.click(toggle(TERMINALS));
    first.unmount();

    mount(NESTED);
    expect(expanded(PREVIEWS)).toBe(false);
    expect(expanded(TERMINALS)).toBe(false);
    expect(expanded(EDITOR)).toBe(true);
    expect(isHidden(row('editor.statusBar.showCounts'))).toBe(true);
  });

  // MOVED DOWN (stored-state cases): the namespace written, a stale key, corrupt JSON and a key missing
  // from the store are asserted in unit/preferences-folds.test.ts and component/use-preference-folds.test.ts.
});

describe('sections start folded (FR-016, FR-017, SC-006) — no seam', () => {
  beforeEach(() => setOpenSeam(false));

  const allRows = (): HTMLElement[] => [...screen.getByTestId('settings-tab').querySelectorAll<HTMLElement>('.settings-row')];

  it('mounts with every section folded and 0 rows visible', () => {
    mount(NESTED);
    expect(allRows().length, 'rows are mounted, just hidden').toBe(5);
    expect(expanded(EDITOR)).toBe(false);
    expect(expanded(TERMINALS)).toBe(false);
    expect(allRows().filter((r) => !isHidden(r))).toEqual([]);
    expect(isHidden(toggle(EDITOR)), 'the headings stay visible').toBe(false);
  });

  it('shows every row and all subsections unfolded after unfolding one section, with no second click', () => {
    mount(NESTED);
    for (const id of [PREVIEWS, MARKDOWN, MERMAID]) expect(expanded(id), `${id} defaults unfolded`).toBe(true);
    fireEvent.click(toggle(EDITOR));
    expect(expanded(EDITOR)).toBe(true);
    const inEditor = [...screen.getByTestId(EDITOR).querySelectorAll<HTMLElement>('.settings-row')];
    expect(inEditor.length).toBe(4);
    expect(inEditor.filter((r) => isHidden(r))).toEqual([]);
    expect(isHidden(row('terminals.defaultRunAsAdmin')), 'other sections stay folded').toBe(true);
  });

  it('keeps an unfolded section open across a remount while the rest stay folded (FR-017)', () => {
    const first = mount(NESTED);
    fireEvent.click(toggle(TERMINALS));
    first.unmount();
    mount(NESTED);
    expect(expanded(TERMINALS)).toBe(true);
    expect(expanded(EDITOR)).toBe(false);
  });

  it('Expand All then a remount keeps every heading open', () => {
    const first = mount(NESTED);
    fireEvent.click(screen.getByTestId('settings-expand-all'));
    first.unmount();
    mount(NESTED);
    for (const id of [EDITOR, PREVIEWS, MARKDOWN, MERMAID, TERMINALS]) expect(expanded(id), id).toBe(true);
  });
});

describe('folding never discards an invalid entry (FR-007)', () => {
  it('shows the warning marker while folded and keeps the entry for when it unfolds', async () => {
    const user = userEvent.setup();
    mount([at('editor.maxOpenFileBytes', 'Editor'), at('terminals.defaultRunAsAdmin', 'Terminals')]);
    const input = screen.getByTestId('control-editor.maxOpenFileBytes');
    await user.clear(input);
    await user.type(input, 'abc');
    await user.tab();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId(`${EDITOR}-invalid`), 'no marker while unfolded').toBeNull();

    await user.click(toggle(EDITOR));
    expect(await screen.findByTestId(`${EDITOR}-invalid`)).toHaveAttribute('title', 'Contains an invalid entry');

    await user.click(toggle(EDITOR));
    expect(screen.queryByTestId(`${EDITOR}-invalid`)).toBeNull();
    expect(screen.getByTestId('control-editor.maxOpenFileBytes')).toHaveValue('abc');
  });

});

/* ────────────────────────────────────────────────────────────────────────── *
 * US2 — the keyboard
 * ────────────────────────────────────────────────────────────────────────── */

describe('the keyboard folds and unfolds (FR-004, FR-005)', () => {
  it('Enter folds and Space unfolds, and aria-expanded follows', async () => {
    const user = userEvent.setup();
    mount(NESTED);
    toggle(EDITOR).focus();
    expect(toggle(EDITOR)).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(toggle(EDITOR)).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(toggle(EDITOR)).toHaveAttribute('aria-expanded', 'true');
  });

  it('never moves focus into a folded section’s rows', async () => {
    const user = userEvent.setup();
    mount(NESTED);
    fireEvent.click(toggle(EDITOR));
    toggle(EDITOR).focus();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      expect(isHidden(active), 'focus is never inside the folded section').toBe(false);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * US3 — search
 * ────────────────────────────────────────────────────────────────────────── */

describe('a search shows its matches in folded sections (FR-008, FR-009)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function search(text: string): void {
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: text } });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 10);
    });
  }

  it('unfolds a folded section and subsection that hold a match, and reads "N of M"', () => {
    mount(NESTED);
    fireEvent.click(toggle(PREVIEWS));
    fireEvent.click(toggle(EDITOR));
    expect(isHidden(row('editor.statusBar.showCursorPosition'))).toBe(true);

    search('showcursorposition');

    expect(expanded(EDITOR)).toBe(true);
    expect(expanded(PREVIEWS)).toBe(true);
    expect(isHidden(row('editor.statusBar.showCursorPosition'))).toBe(false);
    expect(count(EDITOR)).toBe('1 of 4');
    expect(count(PREVIEWS)).toBe('1 of 3');
    expect(count(MERMAID)).toBe('1 of 1');
  });

  it('removes a section with no match together with its heading, folded or not (040 FR-036c)', () => {
    mount(NESTED);
    fireEvent.click(toggle(TERMINALS));
    expect(screen.queryByTestId(TERMINALS)).not.toBeNull();
    search('showcursorposition');
    expect(screen.queryByTestId(TERMINALS)).toBeNull();
    expect(screen.queryByTestId(MARKDOWN), 'an emptied subsection is gone too').toBeNull();
  });

  it('restores the pre-search folds when the search is cleared', () => {
    mount(NESTED);
    fireEvent.click(toggle(EDITOR));
    search('showcursorposition');
    expect(expanded(EDITOR)).toBe(true);

    fireEvent.click(screen.getByTestId('settings-search-clear'));

    expect(expanded(EDITOR)).toBe(false);
    expect(isHidden(row('editor.warnOnMissingFile'))).toBe(true);
    expect(count(EDITOR)).toBe('4');
  });

  // MOVED DOWN: the transient search folds (a toggle during a search, in the debounce gap, repeating a
  // query, a whitespace-only query, nothing stored) are asserted over the hook in
  // component/use-preference-folds.test.ts ("during a search", "one definition of searching").
});

/* ────────────────────────────────────────────────────────────────────────── *
 * US5 — Expand All / Collapse All
 * ────────────────────────────────────────────────────────────────────────── */

describe('Expand All and Collapse All (FR-011b)', () => {
  const expandAll = (): HTMLElement => screen.getByTestId('settings-expand-all');
  const collapseAll = (): HTMLElement => screen.getByTestId('settings-collapse-all');

  it('are icon buttons with hover titles beside the search box', () => {
    mount(NESTED);
    expect(expandAll()).toHaveAttribute('title', 'Expand All Sections');
    expect(collapseAll()).toHaveAttribute('title', 'Collapse All Sections');
    const bar = screen.getByTestId('settings-search').closest('.settings-search')!;
    expect(bar).toContainElement(expandAll());
    expect(bar).toContainElement(collapseAll());
  });

  it('Collapse All folds every heading so only top-level headings remain visible', () => {
    mount(NESTED);
    fireEvent.click(collapseAll());
    for (const id of [EDITOR, PREVIEWS, MARKDOWN, MERMAID, TERMINALS]) expect(expanded(id), id).toBe(false);
    expect(isHidden(toggle(EDITOR))).toBe(false);
    expect(isHidden(toggle(TERMINALS))).toBe(false);
    expect(isHidden(toggle(PREVIEWS))).toBe(true);
  });

  it('Expand All unfolds every heading', () => {
    mount(NESTED);
    fireEvent.click(collapseAll());
    fireEvent.click(expandAll());
    for (const id of [EDITOR, PREVIEWS, MARKDOWN, MERMAID, TERMINALS]) expect(expanded(id), id).toBe(true);
  });

  it('persists across a remount', () => {
    const first = mount(NESTED);
    fireEvent.click(collapseAll());
    first.unmount();
    mount(NESTED);
    expect(expanded(EDITOR)).toBe(false);
    expect(expanded(PREVIEWS)).toBe(false);
  });

  it('acts on this tab only', () => {
    localStorage.setItem(STORE, JSON.stringify({ v: 2, keybindings: { [JSON.stringify(['Global'])]: true } }));
    mount(NESTED);
    fireEvent.click(collapseAll());
    const stored = JSON.parse(localStorage.getItem(STORE)!) as Record<string, Record<string, boolean>>;
    expect(stored.keybindings).toEqual({ [JSON.stringify(['Global'])]: true });
    expect(Object.keys(stored.settings!).length).toBe(5);
  });

  it('are disabled while the search box has text', () => {
    vi.useFakeTimers();
    try {
      mount(NESTED);
      expect(expandAll()).not.toBeDisabled();
      fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'warn' } });
      // Disabled the moment text is typed — before the debounce settles — because the query box is the
      // thing the user sees, and a bulk fold racing a pending filter has nothing coherent to mean.
      expect(expandAll()).toBeDisabled();
      expect(collapseAll()).toBeDisabled();
      fireEvent.click(screen.getByTestId('settings-search-clear'));
      expect(expandAll()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('are reachable with Tab and act on Enter', async () => {
    const user = userEvent.setup();
    mount(NESTED);
    screen.getByTestId('settings-search').focus();
    await user.tab();
    expect(document.activeElement).toBe(expandAll());
    await user.tab();
    expect(document.activeElement).toBe(collapseAll());
    await user.keyboard('{Enter}');
    expect(expanded(EDITOR)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Principle XII — no forced layout in the fold path (T028)
 * ────────────────────────────────────────────────────────────────────────── */

describe('folding forces no layout (Principle XII)', () => {
  // Layer: component; tier regression — a cost property (no forced layout) measured over the whole real registry.
  it('performs zero layout reads for Collapse All and for a single toggle, over the real registry', { tags: ['regression'] }, () => {
    mount();
    const reads: string[] = [];
    const spies = [
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
        reads.push('getBoundingClientRect');
        return new DOMRect();
      }),
      vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
        reads.push('getComputedStyle');
        return {} as CSSStyleDeclaration;
      }),
    ];
    for (const prop of ['offsetHeight', 'offsetWidth'] as const) {
      const spy = vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(() => {
        reads.push(prop);
        return 0;
      });
      spies.push(spy as unknown as (typeof spies)[number]);
    }
    try {
      fireEvent.click(screen.getByTestId('settings-collapse-all'));
      fireEvent.click(toggle(EDITOR));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(reads).toEqual([]);
    expect(within(screen.getByTestId('settings-tab')).getAllByRole('button', { expanded: false }).length).toBeGreaterThan(0);
  });
});
