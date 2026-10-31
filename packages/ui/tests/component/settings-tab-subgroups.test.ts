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
 * Change `SUBGROUP` below to a subgroup no descriptor declares (`'Nonsense'`). The chained test
 * fails on the missing subsection, and its FR-036c filter step would start passing for the wrong
 * reason on its own, which is why the chain asserts the subsection is PRESENT before the search and
 * absent after, rather than only absent after.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';

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
  // 056 FR-016 folds sections by default; this file is about subgroups, so open the sections (research R10).
  window.history.replaceState(null, '', '/?foldDefault=open');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/*
 * ONE mount for the five read-only subgroup tests (audit, component-2a): FR-036a placement, rows,
 * label, FR-036b order, FR-053 controls — then the two that CHANGE the tree (fold, FR-036c search)
 * last, in that order. Every assertion is kept.
 */
describe('a subgroup is a subsection of its group, ordered, editable, foldable and filterable (FR-036a/b/c, FR-053, 056 FR-002)', () => {
  it('renders the Status Bar subsection inside Editor, with its rows, label, order and controls, then folds and filters', () => {
    mount();

    // FR-036a: inside the Editor section, with its name as a heading.
    expect(groupSection()).toContainElement(subsection());
    expect(within(subsection()).getByText(SUBGROUP)).toBeInTheDocument();

    // The three status-bar settings and only those, in declaration order. Rows by CLASS rather than
    // by a test-id pattern: `setting-inert-<key>` shares the `setting-` prefix, so a regex over test
    // ids would silently count an explanation as a row.
    const rows = [...subsection().querySelectorAll('.settings-row')].map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(IN_SUBGROUP.map((k) => `setting-${k}`));

    /*
     * A labelled group to assistive technology, not an anonymous div. The subsection heading is the
     * only thing that says which fields belong together; `role="group"` plus `aria-labelledby` is the
     * standard pair. Asserted through the accessible NAME so it fails if `aria-labelledby` points at
     * an id that does not resolve.
     */
    expect(screen.getByRole('group', { name: SUBGROUP })).toBe(subsection());

    // FR-036b: an ordinary Editor row comes before the subsection in document order — a field must
    // never appear below a subsection heading it does not belong to.
    const plain = screen.getByTestId(`setting-${NOT_IN_SUBGROUP}`);
    expect(
      plain.compareDocumentPosition(subsection()) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the plain row must come BEFORE the subsection',
    ).toBeTruthy();
    expect(subsection()).not.toContainElement(plain);

    // FR-053: a checkbox for each new toggle, inside the subsection, editable and ticked (both ship on).
    for (const key of ['editor.statusBar.showCursorPosition', 'editor.statusBar.showCounts']) {
      const control = screen.getByTestId(`control-${key}`) as HTMLInputElement;
      expect(control.tagName, key).toBe('INPUT');
      expect(control.type, key).toBe('checkbox');
      expect(control.disabled, `${key} must be editable, not inert`).toBe(false);
      expect(control.checked, key).toBe(true);
      expect(subsection(), key).toContainElement(control);
    }

    /*
     * Folds — the heading is a disclosure button, superseding "not collapsible" (056 FR-002).
     * 040 FR-036a said a subsection MUST NOT be collapsible and contract rule 3 pinned it. 056 FR-002
     * supersedes both: every section, subgroup and nested subsection folds, through one shared heading.
     */
    const button = within(subsection()).getByTestId(`${SUBGROUP_ID}-toggle`);
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(subsection().querySelector('details')).toBeNull();

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'false');
    const row = screen.getByTestId(`setting-${IN_SUBGROUP[0]}`);
    expect(row.closest('[hidden]'), 'the subgroup’s rows are hidden').not.toBeNull();
    // The rest of the Editor section is untouched.
    expect(screen.getByTestId(`setting-${NOT_IN_SUBGROUP}`).closest('[hidden]')).toBeNull();

    /*
     * FR-036c: a search that empties the subgroup removes its heading too (present first, above).
     * ONE token, and a key rather than prose. The search is OR over whitespace-separated tokens
     * (`settings-search.ts`), so a phrase like "missing or deleted" would match on "or" — a
     * substring of half the registry — and the subsection would survive for the wrong reason.
     */
    search('warnonmissingfile');

    expect(screen.queryByTestId(`setting-${NOT_IN_SUBGROUP}`), 'the group survives').not.toBeNull();
    expect(screen.queryByTestId(SUBGROUP_ID), 'the emptied subsection is gone').toBeNull();
    expect(screen.queryByText(SUBGROUP), 'and so is its heading').toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 054 FR-050a — a third level: a subsection nested in its subgroup
 * ────────────────────────────────────────────────────────────────────────── */

describe('a subsection nests inside its subgroup (054 FR-050a)', () => {
  /** Real keys, so the rows have values to draw; placement is the registry's, not the key's. */
  const at = (key: string, subsection?: string): FieldDescriptor => {
    const real = SETTINGS_METADATA.find((d) => d.key === key)!;
    return { ...real, group: 'Editor', subgroup: 'Previews', ...(subsection ? { subsection } : {}) };
  };
  const REGISTRY: readonly FieldDescriptor[] = [
    at('editor.statusBar.showCounts', 'Markdown'),
    at('editor.showStatusBar'),
    at('editor.statusBar.showCursorPosition', 'Mermaid'),
  ];
  const SUB_ID = 'settings-subsection-Editor-Previews-Markdown';

  function mountWith(): void {
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
            createElement(
              SettingsMetadataContext.Provider,
              { value: REGISTRY },
              createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS }),
            ),
          ),
        ),
      ),
    );
  }

  it('renders inside its subgroup, after the subgroup’s own rows, under an h5 heading, and disappears with its heading when a search empties it', () => {
    // Chained from two tests on one mount (audit, component-2a).
    mountWith();
    const previews = screen.getByTestId('settings-subgroup-Editor-Previews');
    const markdown = screen.getByTestId(SUB_ID);
    expect(previews).toContainElement(markdown);
    expect(markdown.querySelector('h5')).toHaveTextContent('Markdown');
    expect(screen.getByRole('group', { name: 'Markdown' })).toBe(markdown);
    const plain = screen.getByTestId('setting-editor.showStatusBar');
    expect(markdown).not.toContainElement(plain);
    expect(plain.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(markdown).toContainElement(screen.getByTestId('setting-editor.statusBar.showCounts'));
    // Declaration order: Markdown before Mermaid.
    const mermaid = screen.getByTestId('settings-subsection-Editor-Previews-Mermaid');
    expect(markdown.compareDocumentPosition(mermaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Present first (above), so a subsection that never rendered cannot pass this by being absent.
    search('showcursorposition');
    expect(screen.queryByTestId(SUB_ID)).toBeNull();
    expect(screen.queryByText('Markdown')).toBeNull();
    expect(screen.queryByTestId('settings-subsection-Editor-Previews-Mermaid')).not.toBeNull();
  });
});
