import { describe, expect, it } from 'vitest';
import { createDefaultLayout, collectPanels, type AttentionMark } from '@throng/core';
import { groupMarksByProject, nextInCycle } from '../../src/renderer/attention/mark-order.js';

/**
 * The order a project's or category's marked panels are listed and cycled in (057 FR-097, FR-098,
 * FR-105): layout order where this window has the project's layout, else the order they were raised;
 * projects in the order given (list order).
 *
 * Layer: unit — pure functions over marks and a layout; the popover and the click-to-cycle share them.
 * ANTI-VACUITY CONTROL: sort by `raisedAt` only and the layout-order test fails; sort projects by id
 * and the project-order test fails.
 */
const mark = (panelId: string, projectId: string, raisedAt: number): AttentionMark => ({
  panelId,
  projectId,
  panelTitle: panelId,
  projectName: projectId.toUpperCase(),
  tabTitle: '',
  doing: null,
  producer: 'terminal',
  kind: 'attention',
  reason: { signal: 'bell', detail: null },
  raisedAt,
  dwellStartedAt: null,
});

describe('groupMarksByProject', () => {
  it('orders a project’s panels by raise time when no layout is known', () => {
    const groups = groupMarksByProject([mark('b', 'a', 2), mark('a', 'a', 1)], ['a'], null);
    expect(groups[0].marks.map((m) => m.panelId)).toEqual(['a', 'b']);
  });

  it('orders them by the layout when the layout belongs to that project', () => {
    const layout = createDefaultLayout('a', { tab: 't1', panel: 'p1' });
    const [panel] = collectPanels(layout.tabs[0].root);
    // `late` was raised first, but the layout holds `panel` ahead of it (it is the layout's only panel).
    const groups = groupMarksByProject([mark('late', 'a', 1), mark(panel.id, 'a', 9)], ['a'], layout);
    expect(groups[0].marks.map((m) => m.panelId)).toEqual([panel.id, 'late']);
  });

  it('lists projects in the order given and skips unmarked ones', () => {
    const groups = groupMarksByProject([mark('x', 'b', 1), mark('y', 'a', 2)], ['a', 'none', 'b'], null);
    expect(groups.map((g) => g.projectId)).toEqual(['a', 'b']);
    expect(groups[0].projectName).toBe('A');
  });
});

describe('nextInCycle', () => {
  const list = ['p1', 'p2', 'p3'];

  it('starts at the first, advances, and wraps', () => {
    expect(nextInCycle(list, null, -1)).toEqual({ panelId: 'p1', index: 0 });
    expect(nextInCycle(list, 'p1', 0)).toEqual({ panelId: 'p2', index: 1 });
    expect(nextInCycle(list, 'p3', 2)).toEqual({ panelId: 'p1', index: 0 });
  });

  it('takes the panel that slid into the last one’s place when that one has cleared', () => {
    expect(nextInCycle(['p2', 'p3'], 'p1', 0)).toEqual({ panelId: 'p2', index: 0 });
    expect(nextInCycle(['p2'], 'p3', 2)).toEqual({ panelId: 'p2', index: 0 });
  });

  it('is null with nothing marked', () => {
    expect(nextInCycle([], 'p1', 0)).toBeNull();
  });
});
