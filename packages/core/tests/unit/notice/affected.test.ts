/**
 * 030 US3 (#235) / T036 — the LIST a consolidated notice carries.
 *
 * One cause that defeats several panels raises ONE notice listing them, grouped by tab. Three
 * decisions make that list correct rather than merely present, and all three are pure:
 *
 *   • ORDER — tabs in the workspace's own tab order, panels in their order within the tab
 *     (FR-031a). A list ordered by whichever panel happened to fail first would read differently on
 *     every run, because the failures race.
 *   • IDENTITY — a panel appears once however many times its failure is reported (FR-037a). The
 *     notice GROWS as tabs are visited, and a tab re-visited must not double its rows.
 *   • NAMING — every rendered name goes through `formatSubject` (FR-031b), never the raw string.
 *     That is what applies the 48-character bound; a row that rendered `panelName` straight to the
 *     DOM would let one long name break FR-032's height bound.
 *
 * Pure, so it is proven here rather than through a browser: the renderer then has nothing left to
 * decide about the list beyond turning it into elements.
 */
import { describe, expect, it } from 'vitest';
import {
  groupAffected,
  mergeAffected,
  SUBJECT_NAME_MAX,
  type AffectedPanel,
} from '../../../src/notice/index.js';

function panel(overrides: Partial<AffectedPanel> & Pick<AffectedPanel, 'panelId'>): AffectedPanel {
  return {
    panelName: overrides.panelId,
    tabId: 't1',
    tabName: 'Tab 1',
    tabOrder: 0,
    panelOrder: 0,
    ...overrides,
  };
}

describe('groupAffected', () => {
  it('groups rows by tab, tabs in tabOrder and panels in panelOrder', () => {
    // Deliberately shuffled on the way in: the failures that produce these entries race, so the
    // input order carries no information and the output must not inherit it.
    const groups = groupAffected([
      panel({ panelId: 'p3', panelName: 'Gamma', tabId: 't2', tabName: 'Second', tabOrder: 1, panelOrder: 1 }),
      panel({ panelId: 'p1', panelName: 'Alpha', tabId: 't1', tabName: 'First', tabOrder: 0, panelOrder: 1 }),
      panel({ panelId: 'p4', panelName: 'Delta', tabId: 't2', tabName: 'Second', tabOrder: 1, panelOrder: 0 }),
      panel({ panelId: 'p2', panelName: 'Beta', tabId: 't1', tabName: 'First', tabOrder: 0, panelOrder: 0 }),
    ]);

    expect(groups.map((g) => g.tabId)).toEqual(['t1', 't2']);
    expect(groups.map((g) => g.label)).toEqual(['First', 'Second']);
    expect(groups[0]!.rows.map((r) => r.label)).toEqual(['Beta', 'Alpha']);
    expect(groups[1]!.rows.map((r) => r.label)).toEqual(['Delta', 'Gamma']);
  });

  it('lists a repeated panelId once, keeping what the first report said', () => {
    const groups = groupAffected([
      panel({ panelId: 'p1', panelName: 'Alpha', detail: 'ENOENT: first' }),
      panel({ panelId: 'p1', panelName: 'Alpha', detail: 'ENOENT: again' }),
      panel({ panelId: 'p2', panelName: 'Beta', panelOrder: 1 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((r) => r.panelId)).toEqual(['p1', 'p2']);
    expect(groups[0]!.rows[0]!.detail).toBe('ENOENT: first');
  });

  it('renders every name through formatSubject, so a long one arrives truncated', () => {
    const longPanel = 'p'.repeat(60);
    const longTab = 'T'.repeat(60);
    const [group] = groupAffected([
      panel({ panelId: 'p1', panelName: longPanel, tabName: longTab }),
    ]);

    expect(group!.label).toHaveLength(SUBJECT_NAME_MAX);
    expect(group!.label.endsWith('…')).toBe(true);
    expect(group!.rows[0]!.label).toHaveLength(SUBJECT_NAME_MAX);
    expect(group!.rows[0]!.label.endsWith('…')).toBe(true);
    // …and it is the formatter's bound, not a local `slice` that happens to agree with it today.
    expect(group!.rows[0]!.label).toBe(`${'p'.repeat(SUBJECT_NAME_MAX - 1)}…`);
  });

  it('elides the project and the tab a row already sits under (FR-031b)', () => {
    // FR-031 puts the project in the HEADING and never on a row. The row's subject still carries
    // both qualifiers — it is a `panel`, and a panel is `Project — Tab — Panel` everywhere else —
    // so what keeps them off the row is the context, not a second formatting rule.
    const [group] = groupAffected(
      [panel({ panelId: 'p1', panelName: 'Alpha', tabName: 'First' })],
      { project: 'Bravo' },
    );

    expect(group!.rows[0]!.label).toBe('Alpha');
    expect(group!.label).toBe('First');
  });

  it('drops the HEADING of a tab whose name is blank, and keeps its rows', () => {
    // The title used to say the tab was dropped, while the assertion says the opposite — the group
    // survives with an empty label, and `partText`/`notification.tsx` render the heading only when
    // there is one. Losing the rows would lose the panels, which is the one thing a consolidated
    // notice exists to name.
    const [group] = groupAffected([panel({ panelId: 'p1', panelName: 'Alpha', tabName: '  ' })]);
    expect(group!.label).toBe('');
    expect(group!.rows).toHaveLength(1);
    expect(group!.rows[0]!.label).toBe('Alpha');
  });
});

describe('mergeAffected', () => {
  it('adds only the panels the list does not already carry', () => {
    const existing = [panel({ panelId: 'p1' }), panel({ panelId: 'p2', panelOrder: 1 })];
    const merged = mergeAffected(existing, [
      panel({ panelId: 'p2', panelOrder: 1 }),
      panel({ panelId: 'p3', panelOrder: 2 }),
    ]);

    expect(merged.map((p) => p.panelId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('returns the same array identity when nothing joined, so a caller can tell', () => {
    // What makes FR-006a decidable: a raise that reports nothing new is a repeat and must write no
    // record, and a raise that grows the notice must write one. The caller needs to know which.
    const existing = [panel({ panelId: 'p1' })];
    expect(mergeAffected(existing, [panel({ panelId: 'p1' })])).toBe(existing);
    expect(mergeAffected(existing, [])).toBe(existing);
  });
});
