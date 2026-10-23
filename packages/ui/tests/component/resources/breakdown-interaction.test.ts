/**
 * How the left list answers the pointer and the clock (055 FR-088 – FR-090, FR-095, FR-096, SC-010; defects
 * D3, D6): a click selects and only selects, a double-click (or Enter, or Right) opens, exactly the selected
 * node is marked, the list holds still while the pointer is over it, the order holds while something is
 * selected, and a re-sort moves with a short animation.
 *
 * Layer: component — the real `Breakdown` over the real session store, fed frames the way the shell feeds
 * them. jsdom has no layout and no Web Animations, so `animate` is a recorded stub: what is claimed is
 * WHICH elements are asked to move and for how long, never how it looks.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown, __onRowDrawn } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, getSelection, getView, ingestFrame, requestCatchUp, setSelection, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { MIB, frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

const counted = vi.hoisted(() => ({ figureOf: 0, rowRenders: [] as string[] }));
vi.mock('../../../src/renderer/resources/figures.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/renderer/resources/figures.js')>();
  return {
    ...actual,
    figureOf: (...args: Parameters<typeof actual.figureOf>) => {
      counted.figureOf += 1;
      return actual.figureOf(...args);
    },
  };
});
beforeEach(() => {
  counted.rowRenders = [];
  __onRowDrawn((id) => counted.rowRenders.push(id));
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  __onRowDrawn(undefined);
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate');
  Reflect.deleteProperty(window, 'matchMedia');
  __resetSession();
});

const PANEL = ['root', 'c:projects', 'p:p1', 't:big', 'n:big'];

/** A terminal panel running one process per entry of `cpus` (pid → CPU %), the shell of each with a child when asked. */
function scene(cpus: Record<number, number>, withChild: readonly number[] = []): ResourceNode {
  const kids = Object.entries(cpus).map(([pid, cpu]) =>
    proc(Number(pid), `p${pid}.exe`, metrics({ cpu }), withChild.includes(Number(pid)) ? [proc(Number(pid) + 5000, `c${pid}.exe`, metrics({ cpu: 1 }))] : []),
  );
  const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: kids, owner: { projectId: 'p1', tabId: 'big', panelId: 'big' } });
  const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
  const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

let tick = 0;
const feed = (root: ResourceNode): void => {
  tick += 1;
  act(() => ingestFrame(frame(tick, root)));
};
function mountOn(root: ResourceNode, path: readonly string[] = PANEL): void {
  tick = 0;
  feed(root);
  render(createElement(Breakdown));
  act(() => setView({ focusPath: path }));
}

const row = (id: string): HTMLElement => screen.getByTestId(`breakdown-row-${id}`);
const rowOrder = (): (string | null)[] => screen.getAllByRole('treeitem').map((r) => r.getAttribute('data-node-id'));
const topOrder = (): (string | null)[] => screen.getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '1').map((r) => r.getAttribute('data-node-id'));
const breakdown = (): HTMLElement => screen.getByTestId('breakdown');

describe('a click selects, and only selects (FR-088, FR-096)', () => {
  beforeEach(() => mountOn(scene({ 11: 9, 12: 5, 13: 2 }, [11])));

  it('selects a row without moving the view', () => {
    fireEvent.click(row('x:12:1'));
    expect(getSelection()).toBe('x:12:1');
    expect(getView().focusPath).toEqual(PANEL);
  });

  it('clears the selection on a second click on the same row', () => {
    fireEvent.click(row('x:12:1'));
    fireEvent.click(row('x:12:1'));
    expect(getSelection()).toBeNull();
  });

  it('clears the selection on a click on empty space in the list', () => {
    fireEvent.click(row('x:12:1'));
    fireEvent.click(screen.getByTestId('breakdown-header'));
    expect(getSelection()).toBeNull();
  });

  it('moves the selection to another row on a click on it', () => {
    fireEvent.click(row('x:12:1'));
    fireEvent.click(row('x:13:1'));
    expect(getSelection()).toBe('x:13:1');
  });

  it('does not take the second click of a double-click for a deselection', () => {
    fireEvent.click(row('x:11:1'), { detail: 1 });
    fireEvent.click(row('x:11:1'), { detail: 2 });
    expect(getSelection()).toBe('x:11:1');
  });
});

describe('a double-click opens; nothing else does, and no row has a button for it (FR-096)', () => {
  beforeEach(() => mountOn(scene({ 11: 9, 12: 5 }, [11])));

  it('has no drill-down button on any row, and no treemap tile', () => {
    expect(document.querySelectorAll('[data-testid^="breakdown-row-open-"], .breakdown-row__open')).toHaveLength(0);
    expect(document.querySelectorAll('.treemap, [data-testid^="treemap-"]')).toHaveLength(0);
  });

  it('opens a row on a double-click, clearing the selection, and does nothing on a double-click of a leaf', () => {
    fireEvent.click(row('x:12:1'));
    fireEvent.doubleClick(row('x:12:1'));
    expect(getView().focusPath).toEqual(PANEL);
    fireEvent.click(row('x:11:1'));
    fireEvent.doubleClick(row('x:11:1'));
    expect(getView().focusPath).toEqual([...PANEL, 'x:11:1']);
    expect(getSelection()).toBeNull();
  });

  it('opens on Enter or Right for a node with children; for a leaf it never opens to an empty view', () => {
    // The keys act on the node the keyboard is on, which a click on it makes the selected one.
    fireEvent.click(row('x:12:1'));
    fireEvent.keyDown(row('x:12:1'), { key: 'Enter' });
    fireEvent.keyDown(row('x:12:1'), { key: 'ArrowRight' });
    expect(getView().focusPath).toEqual(PANEL);

    fireEvent.click(row('x:11:1'));
    fireEvent.keyDown(row('x:11:1'), { key: 'Enter' });
    expect(getView().focusPath).toEqual([...PANEL, 'x:11:1']);
  });
});

describe('exactly the selected node is marked (FR-089, D6)', () => {
  beforeEach(() => mountOn(scene({ 11: 9, 12: 5, 13: 2 })));

  it('marks no row while nothing is selected, though the first row has the keyboard', () => {
    expect(row('x:11:1')).toHaveAttribute('tabindex', '0');
    expect(document.querySelectorAll('.breakdown-row--selected')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
  });

  it('marks the one selected row, and nothing else', () => {
    fireEvent.click(row('x:12:1'));
    expect([...document.querySelectorAll('.breakdown-row--selected')].map((e) => e.getAttribute('data-node-id'))).toEqual(['x:12:1']);
  });

  it('unmarks it when the selection is cleared', () => {
    fireEvent.click(row('x:12:1'));
    act(() => setSelection(null));
    expect(document.querySelectorAll('.breakdown-row--selected')).toHaveLength(0);
  });
});

describe('the order holds while the pointer is over it, or something is selected (FR-090)', () => {
  const calm = (): ResourceNode => scene({ 11: 9, 12: 5, 13: 2 });
  const swapped = (): ResourceNode => scene({ 11: 1, 12: 5, 13: 9 });

  it('ranks by the metric when nothing holds it', () => {
    mountOn(calm());
    feed(swapped());
    expect(rowOrder()).toEqual(['x:13:1', 'x:12:1', 'x:11:1']);
  });

  it('holds the order AND the figures while the pointer is over the list, then catches up on leaving (FR-095)', () => {
    mountOn(calm());
    fireEvent.mouseEnter(breakdown());
    feed(swapped());
    expect(rowOrder()).toEqual(['x:11:1', 'x:12:1', 'x:13:1']);
    // Nothing under the pointer changes — not even a number.
    expect(within13().textContent).not.toContain('9');
    expect(within(row('x:11:1')).getByTestId('breakdown-row-x:11:1-cpu')).toHaveTextContent('9');

    fireEvent.mouseLeave(breakdown());
    expect(rowOrder()).toEqual(['x:13:1', 'x:12:1', 'x:11:1']);
    expect(within13().textContent).toContain('9');
  });

  it('shows what the user just did while the pointer stays on the list: the next captures catch its figures up, in place (FR-095)', () => {
    mountOn(calm());
    fireEvent.mouseEnter(breakdown());
    act(() => requestCatchUp());
    feed(swapped());
    // The figures are the new capture's — a killed process would show as ended — but nothing moves.
    expect(within13().textContent).toContain('9');
    expect(rowOrder()).toEqual(['x:11:1', 'x:12:1', 'x:13:1']);
    // Two captures catch up, then the list holds again.
    feed(calm());
    feed(swapped());
    expect(within13().textContent).not.toContain('9');
  });

  it('keeps the order while a node is selected with the pointer elsewhere — the figures keep moving — and re-ranks once the selection is cleared', () => {
    mountOn(calm());
    fireEvent.click(row('x:12:1'));
    fireEvent.mouseLeave(breakdown());
    feed(swapped());
    expect(rowOrder()).toEqual(['x:11:1', 'x:12:1', 'x:13:1']);
    expect(within13().textContent).toContain('9');

    fireEvent.click(row('x:12:1'));
    expect(rowOrder()).toEqual(['x:13:1', 'x:12:1', 'x:11:1']);
  });

  it('appends a process that appears while the order is held, and drops one that is gone from the held order', () => {
    mountOn(calm());
    fireEvent.click(row('x:12:1'));
    fireEvent.mouseLeave(breakdown());
    feed(scene({ 11: 1, 12: 5, 14: 99 }));
    // 13 ended (kept, as ended, by the session); 14 is new and biggest, yet comes after the held ones.
    expect(rowOrder().filter((id) => id !== 'x:13:1')).toEqual(['x:11:1', 'x:12:1', 'x:14:1']);
  });

  function within13(): HTMLElement {
    return row('x:13:1');
  }
});

describe('the hold survives moving about (FR-090)', () => {
  /** Process 11 with two children (21, 22), and a sibling 12. Each is `[cpu, memory in MiB]`. */
  const family = (f: { p11: [number, number]; p21: [number, number]; p22: [number, number]; p12: [number, number] }): ResourceNode => {
    const m = ([cpu, mem]: [number, number]) => metrics({ cpu, memory: mem * MIB });
    const kids = [proc(11, 'p11.exe', m(f.p11), [proc(21, 'c21.exe', m(f.p21)), proc(22, 'c22.exe', m(f.p22))]), proc(12, 'p12.exe', m(f.p12))];
    const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: kids, owner: { projectId: 'p1', tabId: 'big', panelId: 'big' } });
    const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
  };
  const base = { p11: [1, 1], p21: [5, 5], p22: [9, 9], p12: [8, 8] } as const;
  const mutable = (f: typeof base) => ({ p11: [...f.p11], p21: [...f.p21], p22: [...f.p22], p12: [...f.p12] }) as Parameters<typeof family>[0];

  it('after a drill with the pointer over it: the new level ranks once, then holds', () => {
    mountOn(family(mutable(base)));
    fireEvent.mouseEnter(breakdown());

    fireEvent.doubleClick(row('x:11:1'));
    expect(rowOrder()).toEqual(['x:22:1', 'x:21:1']);

    // The two children swap rank; the pointer is still over the list, so nothing moves.
    feed(family({ ...mutable(base), p21: [9, 9], p22: [5, 5] }));
    expect(rowOrder()).toEqual(['x:22:1', 'x:21:1']);
  });

  it('after a drill with the pointer over it: the new level shows the latest figures, not those from when the pointer arrived', () => {
    mountOn(family(mutable(base)));
    fireEvent.mouseEnter(breakdown());

    // Minutes pass under the resting pointer: the children's figures change.
    feed(family({ ...mutable(base), p21: [9, 9], p22: [5, 5] }));
    expect(row('x:11:1')).toBeInTheDocument();

    fireEvent.doubleClick(row('x:11:1'));

    expect(rowOrder()).toEqual(['x:21:1', 'x:22:1']);
    expect(within(row('x:21:1')).getByTestId('breakdown-row-x:21:1-cpu')).toHaveTextContent('9');
    // …and holds from there.
    feed(family({ ...mutable(base), p21: [1, 1], p22: [8, 8] }));
    expect(rowOrder()).toEqual(['x:21:1', 'x:22:1']);
    expect(within(row('x:21:1')).getByTestId('breakdown-row-x:21:1-cpu')).toHaveTextContent('9');
  });

  it('after Back with the pointer over it: the level above shows the latest figures too', () => {
    mountOn(family(mutable(base)), [...PANEL, 'x:11:1']);
    fireEvent.mouseEnter(breakdown());
    feed(family({ ...mutable(base), p12: [20, 1] }));

    fireEvent.click(screen.getByTestId('breakdown-back'));

    expect(topOrder()).toEqual(['x:12:1', 'x:11:1']);
  });

  it('after Back by the keyboard with a node selected: the level ranks once, then holds', () => {
    mountOn(family(mutable(base)), [...PANEL, 'x:11:1']);
    fireEvent.click(row('x:21:1'));

    fireEvent.keyDown(row('x:21:1'), { key: 'ArrowLeft' });
    expect(getView().focusPath).toEqual(PANEL);
    // 11 rolls up 1 + 5 + 9 = 15; 12 is 8.
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);

    feed(family({ ...mutable(base), p11: [0, 1], p21: [1, 1], p22: [1, 1] }));
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);
  });

  it('after Back by the pointer (the button) with the pointer over it', () => {
    mountOn(family(mutable(base)), [...PANEL, 'x:11:1']);
    fireEvent.mouseEnter(breakdown());

    fireEvent.click(screen.getByTestId('breakdown-back'));
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);

    feed(family({ ...mutable(base), p11: [0, 1], p21: [1, 1], p22: [1, 1] }));
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);
  });

  it('after the metric changes with a node selected: ranks by the new metric once, then holds', () => {
    mountOn(family({ ...mutable(base), p11: [9, 1], p12: [5, 5] }));
    fireEvent.click(row('x:12:1'));

    act(() => setView({ metric: 'memory' }));
    // 11 rolls up 1 + 5 + 9 MiB = 15, 12 is 5: by memory 11 leads.
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);

    // 12 now outweighs 11 by memory — held, so nothing moves.
    feed(family({ ...mutable(base), p11: [9, 0], p21: [5, 0], p22: [9, 0], p12: [5, 50] }));
    expect(topOrder()).toEqual(['x:11:1', 'x:12:1']);
  });
});

describe('a re-sort moves with a short animation (FR-090)', () => {
  let animate: ReturnType<typeof vi.fn>;
  const movedIds = (): string[] =>
    (animate.mock.contexts as HTMLElement[])
      .filter((el) => el.getAttribute('role') === 'treeitem')
      .map((el) => el.getAttribute('data-node-id') ?? '')
      .sort();

  beforeEach(() => {
    animate = vi.fn(() => ({ cancel: () => undefined }));
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q.includes('never-matches'), addEventListener: () => {}, removeEventListener: () => {} }) });
  });

  it('animates the rows that changed place, over 200 ms', () => {
    mountOn(scene({ 11: 9, 12: 5, 13: 2 }));
    animate.mockClear();

    feed(scene({ 11: 1, 12: 5, 13: 9 }));

    expect(movedIds()).toEqual(['x:11:1', 'x:13:1']);
    for (const call of animate.mock.calls) expect((call as unknown[])[1]).toMatchObject({ duration: 200 });
  });

  it('animates nothing when nothing changed place', () => {
    mountOn(scene({ 11: 9, 12: 5, 13: 2 }));
    animate.mockClear();
    feed(scene({ 11: 8, 12: 6, 13: 3 }));
    expect(animate).not.toHaveBeenCalled();
  });

  it('animates nothing under reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q.includes('prefers-reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }) });
    mountOn(scene({ 11: 9, 12: 5, 13: 2 }));
    animate.mockClear();
    feed(scene({ 11: 1, 12: 5, 13: 9 }));
    expect(animate).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(['x:13:1', 'x:12:1', 'x:11:1']);
  });

});

describe('a selection or a capture re-renders only what changed (D3, SC-010)', () => {
  it('re-renders the two rows whose mark changed for a click, not all of them', () => {
    const cpus: Record<number, number> = {};
    for (let i = 0; i < 40; i += 1) cpus[100 + i] = 40 - i;
    mountOn(scene(cpus));
    counted.figureOf = 0;

    fireEvent.click(row('x:105:1'));

    // A row is four figures; the readout is four more. All 40 rows would be 160+.
    expect(counted.figureOf).toBeLessThan(40);
  });
});

describe('a capture re-renders only the rows whose figures changed (D3, SC-010)', () => {
  const crowd = (change: Record<number, number> = {}): ResourceNode => {
    const cpus: Record<number, number> = {};
    for (let i = 0; i < 30; i += 1) cpus[100 + i] = change[100 + i] ?? 10 + i;
    return scene(cpus, Object.keys(cpus).map(Number));
  };

  it('leaves every row alone when a capture says what the last one did, though it is all new objects', () => {
    mountOn(crowd());
    counted.rowRenders = [];

    feed(crowd());

    expect(counted.rowRenders).toEqual([]);
  });

  it('re-renders exactly the row whose figure changed', () => {
    mountOn(crowd());
    counted.rowRenders = [];

    // 105 was 15 and is 77 now: it outranks everyone, so it takes the keyboard’s stop from the old first
    // row too — those two, and no one else, are drawn again.
    feed(crowd({ 105: 77 }));

    expect(counted.rowRenders.sort()).toEqual(['x:105:1', 'x:129:1']);
    expect(within(row('x:105:1')).getByTestId('breakdown-row-x:105:1-cpu')).toHaveTextContent('78');
  });

  it('does not re-render a row for a change too small to show', () => {
    mountOn(crowd());
    counted.rowRenders = [];

    // 10.001 and 10 print the same.
    feed(crowd({ 100: 10.001 }));

    expect(counted.rowRenders).toEqual([]);
  });

  it('redraws only its own row when a figure changes and nothing re-ranks', () => {
    mountOn(crowd());
    counted.rowRenders = [];

    // 105 prints 15.5 now; nothing re-ranks, so the only row that changes is its own.
    feed(crowd({ 105: 15.5 }));

    expect(counted.rowRenders).toEqual(['x:105:1']);
    expect(within(row('x:105:1')).getByTestId('breakdown-row-x:105:1-cpu')).toHaveTextContent('16.5');
  });
});

describe('the filter follows the field, not the other way round (D1, SC-010)', () => {
  it('shows the typed text at once and lists the matches in a later, interruptible render', async () => {
    mountOn(scene({ 11: 9, 12: 5, 13: 2 }));
    const { flushSync } = await import('react-dom');
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => setView({ filterText: 'p12' }));
      // The urgent render left the breakdown as it was…
      expect(rowOrder()).toHaveLength(3);
      // …and the deferred one catches up.
      await vi.waitFor(() => expect(rowOrder()).toEqual(['x:12:1']));
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before;
    }
  });
});

describe('the sample hierarchy still opens at the root (guard for the first view)', () => {
  it('lists each component once, and no project (FR-103)', () => {
    tick = 0;
    feed(sampleHierarchy());
    render(createElement(Breakdown));
    expect(screen.getAllByTestId('breakdown-row-c:projects')).toHaveLength(1);
    expect(screen.queryByTestId('breakdown-row-p:p1')).toBeNull();
  });
});
