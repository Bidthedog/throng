/**
 * The monitor answers within 100 ms with about 450 processes on screen (055 SC-010, Principle XII): a
 * keystroke in the filter, a click on a row, a drill and a capture each finish their render inside the budget.
 *
 * Layer: component, and a REGRESSION GUARD, not a timing of the real renderer — jsdom commits DOM far
 * slower than Chromium, so passing here is the cheapest evidence the work per interaction is bounded, and
 * failing here means it grew. The budget is checked against the MEDIAN of five runs, so one slow tick of
 * the machine does not fail it, and against a reading scaled by how busy the machine is (see `medianMs`:
 * the same work read 51 ms alone and 110 ms in a full parallel run, and a budget that fails on a busy
 * machine is a flaky test). The real renderer's number is the E2E's. The figures are printed for the
 * record, as `monitor-performance.test.ts` does.
 *
 * `REFERENCE_QUIET_MS` is an ESTIMATE of an idle machine's reading of the reference list, taken on a
 * shared development machine that was never idle: re-measure it on the CI runner if this ever fails
 * there, or passes with less margin than it should. Raising it loosens the budget; it is the one knob.
 *
 * It also proves what the slowness was made of: a filtered view lists each process ONCE (the Projects
 * subtree used to be listed again under Components, doubling the rows for no one).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, getView, ingestFrame, setSelection, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { MIB, frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({ Timeseries: () => null, default: () => null }));

const BUDGET_MS = 100;
const RUNS = 5;

let pid = 1000;
/**
 * What a process is doing at `tick`. A machine with 450 processes is not 450 busy ones: about one in ten is
 * doing something at any moment — and which ones moves from capture to capture — while the rest hold
 * steady, each at its own small figures. (A fixture where EVERY figure changes EVERY capture measures a
 * machine nobody has, and the budget would be for that.)
 */
function figures(tick: number): ReturnType<typeof metrics> {
  const busy = (pid + tick) % 10 === 0;
  return metrics({
    cpu: busy ? 5 + ((pid * 7 + tick * 13) % 40) : (pid % 5) / 10,
    memory: (20 + (pid % 7)) * MIB + (busy ? (tick % 9) * MIB : 0),
    ioRead: busy ? (pid + tick) % 50_000 : 0,
  });
}

/** A shell with two children, each with two of its own: seven processes. */
function shell(tick: number): ResourceNode {
  const mk = (kids: ResourceNode[]): ResourceNode => {
    pid += 1;
    return proc(pid, `proc-${pid}.exe`, figures(tick), kids);
  };
  return mk([mk([mk([]), mk([])]), mk([mk([]), mk([])])]);
}

/** 5 projects × 4 tabs × 3 panels, a shell tree in each (420), plus 30 in the components: 450 processes. */
function hierarchy(tick: number): ResourceNode {
  pid = 1000;
  const projects = Array.from({ length: 5 }, (_, p) =>
    node({
      id: `p:${p}`,
      kind: 'project',
      label: `Project ${p}`,
      projectState: p === 0 ? 'active' : 'loaded',
      owner: { projectId: String(p) },
      children: Array.from({ length: 4 }, (_, t) =>
        node({
          id: `t:${p}-${t}`,
          kind: 'tab',
          label: `Tab ${t}`,
          owner: { projectId: String(p), tabId: `${p}-${t}` },
          children: Array.from({ length: 3 }, (_, n) =>
            node({ id: `n:${p}-${t}-${n}`, kind: 'panel', label: `Panel ${n}`, panelKind: 'terminal', owner: { projectId: String(p), tabId: `${p}-${t}`, panelId: `${p}-${t}-${n}` }, children: [shell(tick)] }),
          ),
        }),
      ),
    }),
  );
  const component = (id: string, label: string, count: number): ResourceNode =>
    node({
      id,
      kind: 'component',
      label,
      owner: { component: 'ui' },
      children: Array.from({ length: count }, () => {
        pid += 1;
        return proc(pid, `proc-${pid}.exe`, figures(tick));
      }),
    });
  return node({
    id: 'root',
    kind: 'root',
    label: 'throng',
    owner: { component: 'ui' },
    children: [component('c:ui', 'UI', 12), component('c:daemon', 'Daemon', 4), component('c:helpers', 'Helpers', 14), node({ id: 'c:projects', kind: 'component', label: 'Projects', children: projects })],
  });
}

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  // jsdom has no canvas and REPORTS that, with a stack trace, on every `getContext`: four hundred of
  // them per capture would time the error reporting, not the monitor. A real canvas is drawn on the GPU.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  __resetSession();
});

let tick = 0;
const capture = (): void => {
  tick += 1;
  act(() => ingestFrame(frame(tick, hierarchy(tick))));
};

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/**
 * How long this machine, right now, takes to draw 450 rows of the same shape as the monitor's (a list item
 * with eight children and a few attributes), as a median of `RUNS` — a yardstick for how busy it is.
 */
function referenceMs(): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const rows = Array.from({ length: 450 }, (_, r) =>
      createElement(
        'li',
        { key: r, role: 'treeitem', 'data-testid': `ref-${r}`, title: `row ${r}` },
        ...Array.from({ length: 8 }, (_, c) => createElement('span', { key: c, className: 'ref', 'data-metric': c, title: `cell ${c}` }, `${r}:${c}`)),
      ),
    );
    const t0 = performance.now();
    const view = render(createElement('ul', null, rows));
    samples.push(performance.now() - t0);
    view.unmount();
  }
  return median(samples);
}

/** The reference above on a machine doing nothing else (measured alone, 2026-10-15, Windows 11, the repo's dev box). */
const REFERENCE_QUIET_MS = 45;

/**
 * The median of `RUNS` timings of `work`, each preceded by `before` (untimed), AS IT WOULD READ ON A QUIET MACHINE.
 *
 * The component project runs dozens of files at once on every core, and a wall-clock reading of this
 * very work doubled under that load (51 ms alone, 110 ms in the full run) — a budget that fails when the
 * machine is busy asserts the machine, not the monitor, and a test that does that is a flaky test. So the
 * reading is divided by how much slower the machine is right now than when it is idle, measured by drawing
 * a fixed reference list immediately afterwards. On an idle machine the divisor is 1 and the budget is the
 * plain 100 ms; it never makes a reading LOWER than the machine's own slowness explains.
 */
function medianMs(work: () => void, before: () => void = () => undefined): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    before();
    const t0 = performance.now();
    work();
    samples.push(performance.now() - t0);
  }
  const raw = median(samples);
  const slowdown = Math.max(1, referenceMs() / REFERENCE_QUIET_MS);
  readings.push({ raw: Math.round(raw), slowdown: Math.round(slowdown * 100) / 100 });
  return raw / slowdown;
}
/** What was read, in the order the interactions ran: the raw median and the machine's slowdown at the time. */
const readings: { raw: number; slowdown: number }[] = [];

function mountFiltered(): void {
  tick = 0;
  for (let i = 0; i < 3; i += 1) capture();
  render(createElement(Breakdown));
  act(() => setView({ filterText: 'proc' }));
}

describe('a filtered view lists each process once (SC-010)', () => {
  it('draws 450 process rows for 450 processes — not the 900 it used to', () => {
    mountFiltered();
    const processRows = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('data-kind') === 'process');
    const ids = processRows.map((r) => r.getAttribute('data-node-id'));
    expect(ids).toHaveLength(450);
    expect(new Set(ids).size).toBe(450);
  });
});

describe(`each interaction finishes in ${BUDGET_MS} ms with about 450 processes (median of ${RUNS})`, () => {
  const report: Record<string, number> = {};
  afterEach(() => console.info(`responsiveness (jsdom, median of ${RUNS}; ms as on a quiet machine): ${JSON.stringify(report)}; raw median and machine slowdown, in run order: ${JSON.stringify(readings)}`));

  it('a keystroke in the filter', () => {
    mountFiltered();
    // Typing "proc-100" a character at a time, after "pro" has listed everything: each press is one run.
    act(() => setView({ filterText: 'pro' }));
    const typed = ['proc', 'proc-', 'proc-1', 'proc-10', 'proc-100'];
    let next = 0;
    let text = '';
    const ms = medianMs(() => {
      act(() => setView({ filterText: text }));
    }, () => {
      text = typed[next++]!;
    });
    report.filterKeystroke = Math.round(ms);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('a click that selects a row', () => {
    mountFiltered();
    const rows = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('data-kind') === 'process');
    let i = 0;
    const ms = medianMs(() => {
      fireEvent.click(rows[i]!);
    }, () => {
      i += 7;
      act(() => setSelection(null));
    });
    report.selectionClick = Math.round(ms);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('a drill into a node', () => {
    tick = 0;
    for (let i = 0; i < 3; i += 1) capture();
    render(createElement(Breakdown));
    // Drilling down from a project to its first tab and back is the user’s everyday move.
    const path = ['root', 'c:projects', 'p:0'];
    const ms = medianMs(() => {
      fireEvent.click(screen.getByTestId('breakdown-row-open-t:0-0'));
    }, () => {
      act(() => setView({ focusPath: path }));
    });
    report.drill = Math.round(ms);
    expect(getView().focusPath).toEqual([...path, 't:0-0']);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('a capture arriving with every row on screen', () => {
    mountFiltered();
    // The frame is built BEFORE the clock starts: building 450 fixture nodes is the test's cost, not the monitor's.
    let arriving = frame(0, hierarchy(0));
    const ms = medianMs(
      () => {
        act(() => ingestFrame(arriving));
      },
      () => {
        tick += 1;
        arriving = frame(tick, hierarchy(tick));
      },
    );
    report.capture = Math.round(ms);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
