import { useEffect, useRef } from 'react';
import { foldKey, type DescriptorGroup } from './group-descriptors.js';

/**
 * 080 FR-064 — the one Preferences reveal, shared by the Settings, Key Bindings and Themes tabs.
 *
 * A request names a row by its key (a setting key, a key binding's action id, a theme setting key) or a whole
 * group by name. The tab unfolds the row's group, then its subgroup, then its subsection, and scrolls the row
 * (or the group) into view. Sections start folded (056 FR-016), so a reveal that only scrolled would land on a
 * closed heading. One fold per render, outermost first: the effect runs again after each unfold lands, and the
 * request's nonce makes it scroll once per request. An unknown name is ignored.
 *
 * Extracted from the Settings tab's 068 deep link (069 FR-053 added setting keys), which it replaces.
 *
 * Callers reach it through `window.throng.openPreferences(tab, target)`, which opens Preferences on that tab
 * or pushes the target into the open window.
 */
export interface RevealRequest {
  name: string;
  nonce: number;
}

export interface RevealableDescriptor {
  key: string;
  group: string;
  subgroup?: string;
  subsection?: string;
}

export interface RevealFolds {
  isFolded(key: string): boolean;
  toggle(key: string): void;
}

export function useRevealRow(
  request: RevealRequest | undefined,
  descriptors: readonly RevealableDescriptor[],
  groups: readonly DescriptorGroup[],
  folds: RevealFolds,
  testIds: { row: (key: string) => string; group: (group: string) => string },
): void {
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    const row = descriptors.find((d) => d.key === request.name);
    const group = row?.group ?? request.name;
    if (!groups.some((g) => g.group === group)) {
      handled.current = request.nonce;
      return;
    }
    const keys = [foldKey(group)];
    if (row?.subgroup !== undefined) keys.push(foldKey(group, row.subgroup));
    if (row?.subgroup !== undefined && row.subsection !== undefined) keys.push(foldKey(group, row.subgroup, row.subsection));
    const folded = keys.find((k) => folds.isFolded(k));
    if (folded !== undefined) {
      folds.toggle(folded);
      return;
    }
    handled.current = request.nonce;
    const testId = row ? testIds.row(row.key) : testIds.group(group);
    const target = [...document.querySelectorAll<HTMLElement>('[data-testid]')].find(
      (el) => el.getAttribute('data-testid') === testId,
    );
    target?.scrollIntoView({ block: row ? 'center' : 'start' });
  });
}
