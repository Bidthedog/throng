/**
 * The monitor must not cost the user their input (055 SC-003, Principle XII): with a 200-process
 * hierarchy on screen, a frame update is cheap, does no layout read per row, and remounts nothing.
 *
 * Layer: component. Three claims, three kinds of evidence:
 *
 *  - NO LAYOUT READ PER ROW — a count, so deterministic: every API that forces layout is spied on, and
 *    the count over a frame with 20 rows must equal the count over a frame with 200. Whatever the
 *    constant is, it is not a function of the number of rows.
 *  - NO REMOUNT — element identity: the row element before the frame is the row element after it.
 *  - YIELDS TO INPUT — the frame's render is deferred, not done in the turn that delivers it: checked
 *    structurally (the DOM is unchanged when `ingestFrame` returns, and changes in a later task). The
 *    50 ms wall-clock bound itself is NOT asserted here (throng-testing, `performance-sla.md`: a
 *    ceiling is asserted only where the reading means something). jsdom commits DOM far slower than
 *    Chromium, so the number is printed for the record and the SLA is the E2E's (T069).
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { MIB, frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  vi.restoreAllMocks();
  __resetSession();
});

/** `terminals` panels of `perTerminal` processes each, chained shell → child → child…; CPU varies per tick. */
function hierarchy(terminals: number, perTerminal: number, tick: number): ResourceNode {
  const panels = Array.from({ length: terminals }, (_, t) => {
    let chain: ResourceNode | undefined;
    for (let i = perTerminal; i >= 1; i -= 1) {
      const pid = 10_000 + t * 1000 + i;
      chain = proc(pid, `proc${t}-${i}.exe`, metrics({ cpu: ((pid + tick) % 7) / 2, memory: (20 + i) * MIB, ioRead: (pid + tick) % 5 }), chain ? [chain] : []);
    }
    return node({
      id: `n:t${t}`,
      kind: 'panel',
      label: `Terminal ${t}`,
      panelKind: 'terminal',
      children: chain ? [chain] : [],
      owner: { projectId: 'p1', tabId: 't1', panelId: `t${t}` },
    });
  });
  const tab = node({ id: 't:t1', kind: 'tab', label: 'Build', children: panels, owner: { projectId: 'p1', tabId: 't1' } });
  const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

/**
 * A filter that matches every process expands the whole tab into rows: the worst case for a frame. The
 * view is focused on the tab so each row is drawn once (at the root the same nodes also appear under
 * the Projects component).
 */
function mountExpanded(): void {
  act(() => ingestFrame(frame(1, hierarchy(0, 0, 1))));
  act(() => setView({ filterText: '.exe', focusPath: ['root', 'c:projects', 'p:p1', 't:t1'] }));
  render(createElement(Breakdown));
}

const rowCount = (): number => screen.getAllByRole('treeitem').filter((el) => el.getAttribute('data-kind') === 'process').length;

/** Every way the platform lets a script force a layout, counted. */
function spyOnLayoutReads(): { count: () => number } {
  let reads = 0;
  const bump = (): void => {
    reads += 1;
  };
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    bump();
    return rect.call(this);
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function () {
    bump();
    return [] as unknown as DOMRectList;
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((_el: Element) => {
    bump();
    return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle);
  for (const prop of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop'] as const) {
    const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop) ?? Object.getOwnPropertyDescriptor(Element.prototype, prop);
    if (!real?.get) continue;
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        bump();
        return real.get!.call(this);
      },
    });
  }
  return { count: () => reads };
}

describe('a frame update with a 200-process hierarchy (SC-003, XII)', () => {
  it('renders all two hundred rows — the case below is the worst one, not a small one', () => {
    mountExpanded();
    act(() => ingestFrame(frame(2, hierarchy(10, 20, 2))));
    expect(rowCount()).toBe(200);
  });

  it('does no more layout reads for 200 rows than for 20 — none is per row', () => {
    const readsFor = (terminals: number): number => {
      const spy = spyOnLayoutReads();
      mountExpanded();
      const before = spy.count();
      act(() => ingestFrame(frame(2, hierarchy(terminals, 10, 2))));
      act(() => ingestFrame(frame(3, hierarchy(terminals, 10, 3))));
      const during = spy.count() - before;
      screen.getAllByRole('treeitem'); // reading the DOM is the test's, after the count
      return during;
    };
    const small = readsFor(2); // 20 processes
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    __resetSession();
    startSession({ intervalSeconds: 2, historyMinutes: 5 });
    const large = readsFor(20); // 200 processes

    expect(large, `layout reads over two frames: ${small} for 20 rows, ${large} for 200`).toBe(small);
  });

  it('keeps every row element across frames — nothing is remounted', () => {
    mountExpanded();
    act(() => ingestFrame(frame(2, hierarchy(10, 20, 2))));
    const before = screen.getAllByRole('treeitem').map((el) => el);

    act(() => ingestFrame(frame(3, hierarchy(10, 20, 3))));
    act(() => ingestFrame(frame(4, hierarchy(10, 20, 4))));

    // Rows reorder with the metric, so identity is compared as a set, not by position.
    const after = screen.getAllByRole('treeitem');
    expect(after).toHaveLength(before.length);
    const kept = new Set(before);
    expect(after.filter((el) => kept.has(el))).toHaveLength(before.length);
  });

  it('does not render a frame in the turn that delivers it — the rows follow at a lower priority', async () => {
    mountExpanded();
    act(() => ingestFrame(frame(2, hierarchy(10, 20, 2))));
    act(() => ingestFrame(frame(3, hierarchy(10, 20, 3))));

    // Outside `act`, so React schedules as it does in the app. The turn that delivers a frame is also
    // the turn a keystroke would be handled in: it must not carry the 200-row render.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasAct = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const before = document.body.textContent;
      const started = performance.now();
      ingestFrame(frame(4, hierarchy(10, 20, 4)));
      const delivering = performance.now() - started;
      // Nothing of the new frame is on screen yet…
      expect(document.body.textContent).toBe(before);
      // …and it arrives, in a later task.
      const deadline = started + 5000;
      while (document.body.textContent === before && performance.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      expect(document.body.textContent).not.toBe(before);
      // Recorded on every run (not asserted): the turn's own cost, and the whole frame's, in jsdom.
      console.info(
        `monitor frame, 200 processes, jsdom (not reference hardware): delivery ${delivering.toFixed(1)} ms, on screen after ${(performance.now() - started).toFixed(1)} ms`,
      );
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = wasAct;
    }
  });

  // sla-not-measured: the 50 ms long-task bound (SC-003) is a wall-clock claim about Chromium on a
  // reference machine. jsdom commits DOM mutations an order of magnitude slower, so a reading here would
  // adjudicate jsdom, not the product, and is deliberately not asserted; the real bound is held by the
  // E2E (resource-monitor.e2e.ts) in the serial tier, where `expectWithinSla` decides whether it counts.
});
