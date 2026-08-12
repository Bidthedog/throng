/**
 * The tab picker (031 US3, contracts/tab-strip.md §5, FR-026–FR-028g).
 *
 * This file is the SEEDING of the general control in `common/picker.tsx`, and nothing more: it turns
 * tabs into entries and turns a chosen entry back into "reveal it and make it active". Every piece
 * of behaviour a user would call "the picker" — typing narrows, arrows move, Enter chooses, Escape
 * dismisses, matched terms are marked, results stay in the seeded order, no match says so — lives in
 * the general control, which is what makes #219 able to reuse it for file paths (K8).
 *
 * The searchable text is the tab's **displayed** name (FR-028d). Searching the stored name would let
 * a query match on characters the strip has truncated away, so a row would appear to match nothing
 * the user can see.
 */
import { type ReactElement } from 'react';
import { countPanels, truncateGraphemes, type Tab } from '@throng/core';
import { Picker, type PickerEntry } from '../common/picker.js';

/**
 * Open the picker from outside the strip — the `tabs.openPicker` chord (T5, T7).
 *
 * A module-level registration for the same reason `panel-rename.ts` has one: the chord is resolved
 * by the window-level keydown listener, which has no route into a component's state. Chord and
 * click therefore open the SAME picker, rather than there being two that must be kept in step.
 */
let opener: (() => void) | null = null;

/** Register (or clear, with `null`) how the tab picker opens. */
export function registerTabPicker(open: (() => void) | null): void {
  opener = open;
}

/** Open the tab picker. Returns whether anything was listening — no strip mounted is a no-op. */
export function requestTabPicker(): boolean {
  if (!opener) return false;
  opener();
  return true;
}

export interface TabPickerProps {
  tabs: readonly Tab[];
  activeTabId: string | null;
  /** `tabs.maxNameLength` — the picker shows the same bounded name the strip does. */
  maxNameLength: number;
  /** Reveal the tab in the strip AND make it active (K2). */
  onChoose: (tabId: string) => void;
  onDismiss: () => void;
}

/** Every tab, in strip order, whether it is currently visible or not (K1). */
export function tabPickerEntries(
  tabs: readonly Tab[],
  activeTabId: string | null,
  maxNameLength: number,
): PickerEntry[] {
  return tabs.map((tab) => {
    const name = truncateGraphemes(tab.title, maxNameLength);
    const panels = countPanels(tab.root);
    return {
      id: tab.id,
      text: name,
      label: name,
      // K9 — the entry carries the panel count as well as the name, so a user picking between two
      // similarly named tabs has the one fact that tells them apart without opening either.
      meta: `${panels} panel${panels === 1 ? '' : 's'}`,
      isCurrent: tab.id === activeTabId,
    };
  });
}

export function TabPicker({
  tabs,
  activeTabId,
  maxNameLength,
  onChoose,
  onDismiss,
}: TabPickerProps): ReactElement {
  return (
    <Picker
      title="Go to tab"
      /*
       * `tabpicker`, not `tab-picker`. Roughly twenty existing specs select tabs with
       * `[data-testid^="tab-"]`, and every id this control derives from its prefix would be caught
       * by that — silently, since the picker is only in the DOM while it is open. The same trap
       * already forced `tab-strip-track` to become `tabstrip-track`.
       */
      testId="tabpicker"
      placeholder="Type to filter tabs…"
      emptyMessage="No tabs match"
      entries={tabPickerEntries(tabs, activeTabId, maxNameLength)}
      onChoose={(entry) => onChoose(entry.id)}
      onDismiss={onDismiss}
    />
  );
}
