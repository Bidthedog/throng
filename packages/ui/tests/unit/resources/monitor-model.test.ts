/**
 * The breakdown model's ordering (055 FR-046): rows are ordered by the chosen figure, and the I/O
 * figure is read PLUS write — the number the row prints — not the read half alone.
 */
import { describe, expect, it } from 'vitest';
import { buildBreakdown } from '../../../src/renderer/resources/monitor-model.js';
import { DEFAULT_VIEW, type ViewState } from '../../../src/renderer/resources/monitor-session.js';
import { MIB, metrics, node, proc } from '../../component/helpers/resource-fixtures.js';

const view = (over: Partial<ViewState> = {}): ViewState => ({
  metric: 'io',
  filterText: '',
  hideIdle: false,
  hideEnded: true,
  focusPath: ['root', 'c:projects', 'p:a', 't:a', 'n:a'],
  ...over,
});

const ctx = {
  isEnded: () => false,
  ownHistory: () => [],
  thresholds: { cpuWarning: 50, cpuCritical: 80, memoryWarning: 50, memoryCritical: 80 },
  machine: { installedRamBytes: 16 * 1024 * MIB },
};

function tree() {
  // Reader: 10 read, 0 write. Writer: 4 read, 9 write → 13 in all, so it leads by I/O.
  const reader = proc(101, 'reader.exe', metrics({ ioRead: 10 * MIB }));
  const writer = proc(102, 'writer.exe', metrics({ ioRead: 4 * MIB, ioWrite: 9 * MIB }));
  const panel = node({
    id: 'n:a',
    kind: 'panel',
    label: 'Shell',
    panelKind: 'terminal',
    children: [reader, writer],
    owner: { projectId: 'a', tabId: 'a', panelId: 'a' },
  });
  const tab = node({ id: 't:a', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'a', tabId: 'a' } });
  const project = node({ id: 'p:a', kind: 'project', label: 'A', projectState: 'active', children: [tab], owner: { projectId: 'a' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

describe('a held order (FR-090)', () => {
  const ctxFor = (heldOrder?: readonly string[]) => ({ ...ctx, ...(heldOrder ? { heldOrder } : {}) });
  const idsOf = (t: ReturnType<typeof tree>, held?: readonly string[]) =>
    buildBreakdown(t, view({ metric: 'cpu' }), ctxFor(held)).sections[0]!.nodes.map((n) => n.process?.pid);

  function withCpu(cpus: Record<number, number>, extra: ReturnType<typeof proc>[] = []) {
    const kids = Object.entries(cpus).map(([pid, cpu]) => proc(Number(pid), `p${pid}.exe`, metrics({ cpu })));
    const panel = node({ id: 'n:a', kind: 'panel', label: 'Shell', panelKind: 'terminal', children: [...kids, ...extra], owner: { projectId: 'a', tabId: 'a', panelId: 'a' } });
    const tab = node({ id: 't:a', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'a', tabId: 'a' } });
    const project = node({ id: 'p:a', kind: 'project', label: 'A', projectState: 'active', children: [tab], owner: { projectId: 'a' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
  }
  const orderOf = (t: ReturnType<typeof tree>) => buildBreakdown(t, view({ metric: 'cpu' }), ctx).sections[0]!.nodes.map((n) => n.id);

  it('ranks by the chosen metric when no order is held', () => {
    expect(idsOf(withCpu({ 1: 5, 2: 9 }))).toEqual([2, 1]);
  });

  it('keeps the held order even though the figures re-ranked', () => {
    const before = withCpu({ 1: 9, 2: 5 });
    const held = orderOf(before);
    expect(idsOf(withCpu({ 1: 5, 2: 9 }), held)).toEqual([1, 2]);
  });

  it('appends a new node after the held ones, and drops a gone one', () => {
    const held = orderOf(withCpu({ 1: 9, 2: 5, 3: 1 }));
    // 3 is gone; 4 is new and larger than both, yet comes last; 2 and 1 keep their places.
    expect(idsOf(withCpu({ 1: 1, 2: 2, 4: 99 }), held)).toEqual([1, 2, 4]);
  });

  it('appends several new nodes in their ranked order', () => {
    const held = orderOf(withCpu({ 1: 9 }));
    expect(idsOf(withCpu({ 1: 1, 5: 3, 6: 8 }), held)).toEqual([1, 6, 5]);
  });
});

describe('the top level lists the components only (FR-103)', () => {
  it('has one section, and its top-level nodes are the components', () => {
    const model = buildBreakdown(tree(), view({ focusPath: ['root'] }), ctx);
    expect(model.sections.map((s) => s.id)).toEqual(['components']);
    expect(model.sections[0]!.nodes.map((n) => n.id)).toEqual(['c:projects']);
    // Projects is a row, not opened: its projects are reached by drilling into it.
    expect(model.sections[0]!.rows.map((r) => r.node.id)).toEqual(['c:projects']);
  });
});

describe('a filter lists each node once (FR-061, SC-010)', () => {
  it('lists every match once, under its ancestors, from the components down', () => {
    const model = buildBreakdown(tree(), view({ filterText: 'exe', focusPath: ['root'] }), ctx);
    const ids = model.sections.flatMap((s) => s.rows.map((r) => r.node.id));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const kept = model.sections[0]!.rows.map((r) => r.node.process?.pid ?? r.node.id);
    expect(kept).toEqual(expect.arrayContaining(['c:projects', 'p:a', 't:a', 'n:a', 101, 102]));
  });

  it('keeps a match under its ancestors when the focus is below the root', () => {
    const model = buildBreakdown(tree(), view({ filterText: 'reader', focusPath: ['root', 'c:projects', 'p:a'] }), ctx);
    const rows = model.sections[0]!.rows;
    expect(rows.map((r) => r.node.id)).toEqual(['t:a', 'n:a', expect.stringMatching(/^x:101/)]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });
});

describe('what the filter and Hide idle left out, in numbers (FR-092)', () => {
  const idle = metrics({});
  const busy = metrics({ cpu: 5 });
  const scene = () => {
    const kids = [proc(1, 'alpha.exe', idle), proc(2, 'beta.exe', busy), proc(3, 'gamma.exe', idle), proc(4, 'alpha-helper.exe', busy)];
    const panel = node({ id: 'n:a', kind: 'panel', label: 'Shell', panelKind: 'terminal', children: kids, owner: { projectId: 'a', tabId: 'a', panelId: 'a' } });
    const tab = node({ id: 't:a', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'a', tabId: 'a' } });
    const project = node({ id: 'p:a', kind: 'project', label: 'A', projectState: 'active', children: [tab], owner: { projectId: 'a' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
  };
  const history = (id: string) => (id === 'x:1:1' || id === 'x:3:1' ? [idle, idle, idle] : [busy, busy, busy]);
  const build = (over: Partial<ViewState>) =>
    buildBreakdown(scene(), view({ metric: 'cpu', focusPath: ['root', 'c:projects', 'p:a', 't:a', 'n:a'], ...over }), { ...ctx, ownHistory: history });

  it('counts the processes the filter shows, and none when it is empty', () => {
    expect(build({ filterText: 'alpha' }).matches).toBe(2);
    expect(build({ filterText: '' }).matches).toBe(0);
  });

  it('counts zero for a filter nothing matches', () => {
    const model = build({ filterText: 'nothing-is-called-this' });
    expect(model.matches).toBe(0);
    expect(model.sections.flatMap((s) => s.rows)).toHaveLength(0);
  });

  it('counts the idle processes Hide idle left out', () => {
    expect(build({ hideIdle: true }).hiddenIdle).toBe(2);
    expect(build({ hideIdle: false }).hiddenIdle).toBe(0);
  });

  it('counts only the idle ones inside what the filter matched', () => {
    expect(build({ hideIdle: true, filterText: 'alpha' }).hiddenIdle).toBe(1);
  });
});

describe('Hide ended processes (FR-105)', () => {
  const ended = new Set(['x:101:1']);
  const build = (hideEnded: boolean) =>
    buildBreakdown(tree(), view({ metric: 'cpu', hideEnded }), { ...ctx, isEnded: (id: string) => ended.has(id) });

  it('on, an ended process leaves the list before it is ordered', () => {
    expect(build(true).sections[0]!.rows.map((r) => r.node.id)).toEqual(['x:102:1']);
  });

  it('off, it stays in its place, marked ended (FR-065a)', () => {
    const rows = build(false).sections[0]!.rows;
    expect(rows.map((r) => r.node.id).sort()).toEqual(['x:101:1', 'x:102:1']);
    expect(rows.find((r) => r.node.id === 'x:101:1')?.ended).toBe(true);
  });

  it('is on in a first-open view', () => {
    expect(DEFAULT_VIEW.hideEnded).toBe(true);
  });
});

describe('ordering by I/O', () => {
  it('puts the larger read PLUS write first, as the row’s own figure reads', () => {
    const model = buildBreakdown(tree(), view(), ctx);
    const ids = model.sections[0]!.nodes.map((n) => n.process?.pid);
    expect(ids).toEqual([102, 101]);
  });
});
