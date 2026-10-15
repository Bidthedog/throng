import { describe, it, expect } from 'vitest';
import {
  buildHierarchy,
  NOT_MEASURED,
  processKey,
  type BuildHierarchyInput,
  type HierarchyContext,
  type HierarchyRoster,
  type Metrics,
  type ProcessReading,
  type ResourceNode,
} from '../../../src/resources/index.js';

const r = (pid: number, ppid: number, imageName: string, createTime = pid): ProcessReading => ({
  pid,
  ppid,
  createTime,
  imageName,
  cpuTime: 0,
  privateWorkingSet: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  startedAt: createTime,
});

/** Every process a test machine runs. 900 is someone else's; nothing of it may appear. */
const READINGS: ProcessReading[] = [
  r(100, 1, 'throng.exe'),
  r(101, 100, 'throng.exe'),
  r(102, 100, 'throng.exe'),
  r(103, 100, 'node.exe'), // the collector
  r(200, 1, 'node.exe'), // the daemon
  r(210, 200, 'node.exe'), // the pty agent
  r(220, 210, 'conhost.exe'),
  r(300, 210, 'pwsh.exe'),
  r(301, 300, 'node.exe'),
  r(302, 301, 'git.exe'),
  r(400, 7, 'node.exe'), // console-attached, parent long gone
  r(500, 200, 'throng-lock.exe'),
  r(900, 1, 'explorer.exe'),
];

const ROSTER: HierarchyRoster = {
  daemonPid: 200,
  agentPid: 210,
  collectorPid: 103,
  terminals: [{ panelId: 'n1', projectId: 'p1', osPid: 300, conhostPid: 220, attached: [{ pid: 400, startedAt: 400 }] }],
  locks: [{ path: 'D:/repo', projectId: 'p1', pid: 500, panelIds: ['n1'] }],
  ui: [
    { pid: 100, role: 'main', label: 'Application' },
    { pid: 101, role: 'window', label: 'Main window' },
    { pid: 102, role: 'gpu', label: 'GPU' },
  ],
};

const CONTEXT: HierarchyContext = {
  projects: [
    { id: 'p3', name: 'Gamma', state: 'unloaded', listOrder: 0 },
    { id: 'p2', name: 'Beta', state: 'loaded', listOrder: 1 },
    { id: 'p1', name: 'Alpha', state: 'active', listOrder: 2 },
  ],
  tabs: [
    { id: 't1', projectId: 'p1', name: 'Build', subWorkspaceName: null },
    { id: 't2', projectId: 'p1', name: 'Notes', subWorkspaceName: 'Scratch' },
  ],
  panels: [
    { id: 'n1', tabId: 't1', projectId: 'p1', name: 'pwsh', kind: 'terminal' },
    { id: 'n2', tabId: 't2', projectId: 'p1', name: 'README.md', kind: 'editor' },
    { id: 'n3', tabId: 't2', projectId: 'p1', name: 'README.md', kind: 'editor' },
  ],
};

const metricsFor = (readings: readonly ProcessReading[], memory: (pid: number) => number = () => 100) =>
  new Map<string, Metrics>(
    readings.map((x) => [processKey(x.pid, x.createTime), { cpu: 1, memory: memory(x.pid), gpu: 0, ioRead: 0, ioWrite: 0 }]),
  );

const input = (over: Partial<BuildHierarchyInput> = {}): BuildHierarchyInput => ({
  readings: READINGS,
  metrics: metricsFor(READINGS),
  roster: ROSTER,
  context: CONTEXT,
  estimates: [],
  lineage: new Map(),
  ...over,
});

const find = (n: ResourceNode, id: string): ResourceNode | undefined =>
  n.id === id ? n : n.children.map((c) => find(c, id)).find((x) => x !== undefined);
const pids = (n: ResourceNode): number[] => [
  ...(n.process ? [n.process.pid] : []),
  ...n.children.flatMap(pids),
];
const component = (root: ResourceNode, c: string) => root.children.find((x) => x.id === `c:${c}`)!;

describe('buildHierarchy (055 FR-020 – FR-021, FR-080, R6)', () => {
  const { root } = buildHierarchy(input());

  it('has exactly four components, in order', () => {
    expect(root.children.map((c) => c.id)).toEqual(['c:ui', 'c:daemon', 'c:helpers', 'c:projects']);
  });

  it('places every roster process in exactly one component, and nothing else from the machine', () => {
    const all = pids(root).sort((a, b) => a - b);
    expect(all).toEqual([100, 101, 102, 103, 200, 210, 220, 300, 301, 302, 400, 500]);
  });

  it('labels UI processes by role and puts the daemon alone under Daemon', () => {
    expect(pids(component(root, 'ui')).sort()).toEqual([100, 101, 102]);
    expect(find(root, `x:${processKey(101, 101)}`)!.label).toBe('Main window');
    expect(pids(component(root, 'daemon'))).toEqual([200]);
  });

  it('puts console hosts, lock helpers, the agent and the collector under Helpers, each labelled', () => {
    const helpers = component(root, 'helpers');
    expect(pids(helpers).sort()).toEqual([103, 210, 220, 500]);
    const labels = helpers.children.map((c) => c.label);
    expect(labels).toContain('Console host — pwsh');
    expect(labels).toContain('Folder lock — Alpha');
    expect(labels).toContain('Resource collector');
  });

  it("puts a shell's descendants under its panel, and console-attached processes beside it", () => {
    const panel = find(root, 'n:n1')!;
    expect(pids(panel).sort()).toEqual([300, 301, 302, 400]);
    const shell = panel.children.find((c) => c.process?.pid === 300)!;
    expect(shell.children[0]!.process!.pid).toBe(301);
    expect(shell.children[0]!.children[0]!.process!.pid).toBe(302);
    expect(shell.label).toBe('PowerShell');
  });

  it('lists every project — active, then loaded, then unloaded — even with nothing measured', () => {
    const projects = component(root, 'projects').children;
    expect(projects.map((p) => p.id)).toEqual(['p:p1', 'p:p2', 'p:p3']);
    expect(projects[2]!.projectState).toBe('unloaded');
    expect(projects[1]!.rolled.memory).toBe(0);
  });

  it('labels a tab in a sub-workspace "<sub-workspace> › <tab>"', () => {
    expect(find(root, 't:t2')!.label).toBe('Scratch › Notes');
  });

  it('puts a terminal with no project under "No project"', () => {
    const { root: r2 } = buildHierarchy(
      input({ roster: { ...ROSTER, terminals: [{ ...ROSTER.terminals[0]!, projectId: null, panelId: 'loose' }] } }),
    );
    const none = find(r2, 'p:')!;
    expect(none.label).toBe('No project');
    expect(pids(none)).toContain(300);
  });

  it('shows a terminal whose process is not yet known as a limitation with its reason', () => {
    const { root: r2 } = buildHierarchy(
      input({ roster: { ...ROSTER, terminals: [{ ...ROSTER.terminals[0]!, osPid: null }] } }),
    );
    const limit = find(r2, 'n:n1')!.children.find((c) => c.kind === 'limitation')!;
    expect(limit.reason).toMatch(/not known yet/i);
    expect(limit.id).toMatch(/^l:/);
  });

  it('shows the daemon as a limitation when it cannot be reached', () => {
    const { root: r2 } = buildHierarchy(input({ roster: { ...ROSTER, daemonPid: null } }));
    expect(component(r2, 'daemon').children[0]!.kind).toBe('limitation');
  });

  it('keeps node ids stable across ticks', () => {
    const again = buildHierarchy(input()).root;
    const ids = (n: ResourceNode): string[] => [n.id, ...n.children.flatMap(ids)];
    expect(ids(again)).toEqual(ids(root));
  });

  it("never treats a child that started before its parent as the parent's child (pid reuse)", () => {
    const readings = [...READINGS.filter((x) => x.pid !== 301), r(301, 300, 'node.exe', 1)];
    const { root: r2 } = buildHierarchy(input({ readings, metrics: metricsFor(readings) }));
    expect(pids(find(r2, 'n:n1')!)).not.toContain(301);
  });
});

describe('console-attached processes are matched by identity, not pid (055 R6, review #1)', () => {
  const panelPids = (attached: HierarchyRoster['terminals'][number]['attached'], readings = READINGS) => {
    const roster: HierarchyRoster = { ...ROSTER, terminals: [{ ...ROSTER.terminals[0]!, attached }] };
    const { root } = buildHierarchy(input({ readings, metrics: metricsFor(readings), roster }));
    return pids(find(root, 'n:n1')!).sort();
  };

  it('never attributes a reused pid: a start time that does not match leaves the process out', () => {
    expect(panelPids([{ pid: 400, startedAt: 390 }])).toEqual([300, 301, 302]);
  });

  it('never attributes a process whose start time is unknown on either side', () => {
    expect(panelPids([{ pid: 400, startedAt: 0 }])).toEqual([300, 301, 302]);
    const unknown = READINGS.map((x) => (x.pid === 400 ? { ...x, startedAt: undefined } : x));
    expect(panelPids([{ pid: 400, startedAt: 400 }], unknown)).toEqual([300, 301, 302]);
  });

  it('allows the one-millisecond rounding between the two clocks', () => {
    expect(panelPids([{ pid: 400, startedAt: 401 }])).toEqual([300, 301, 302, 400]);
  });
});

describe('lineage (055 FR-021, R6)', () => {
  it('keeps a re-parented descendant under its panel while its identity lives', () => {
    const first = buildHierarchy(input());
    // 301 dies; 302 is re-parented to a pid that is nothing of ours.
    const readings = READINGS.filter((x) => x.pid !== 301).map((x) => (x.pid === 302 ? { ...x, ppid: 4 } : x));
    const second = buildHierarchy(input({ readings, metrics: metricsFor(readings), lineage: first.lineage }));
    expect(pids(find(second.root, 'n:n1')!)).toContain(302);
  });

  it('never lets a reused pid inherit a dead process’s place', () => {
    const first = buildHierarchy(input());
    const readings = READINGS.filter((x) => x.pid !== 302 && x.pid !== 301).concat(r(302, 4, 'calc.exe', 99_999));
    const second = buildHierarchy(input({ readings, metrics: metricsFor(readings), lineage: first.lineage }));
    expect(pids(second.root)).not.toContain(302);
  });

  it('drops an entry when its process is gone', () => {
    const first = buildHierarchy(input());
    expect(first.lineage.has(processKey(302, 302))).toBe(true);
    const readings = READINGS.filter((x) => x.pid !== 302);
    const second = buildHierarchy(input({ readings, metrics: metricsFor(readings), lineage: first.lineage }));
    expect(second.lineage.has(processKey(302, 302))).toBe(false);
  });
});

describe('roll-up and estimates (055 FR-022, FR-024, FR-024b, SC-006)', () => {
  const total = (n: ResourceNode) => n.rolled.memory as number;

  it("makes every node's rolled figure its own plus its children's", () => {
    const { root } = buildHierarchy(input());
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const check = (n: ResourceNode): void => {
      const sum = num(n.own.memory) + n.children.reduce((s, c) => s + num(c.rolled.memory), 0);
      expect(num(n.rolled.memory)).toBe(sum);
      n.children.forEach(check);
    };
    check(root);
    expect(total(root)).toBe(12 * 100);
  });

  it('moves only estimates whose panel is placed: with no context, an editor estimate stays in its process (convergence T102)', () => {
    const base = total(buildHierarchy(input({ context: null })).root);
    const { root } = buildHierarchy(
      input({
        context: null,
        estimates: [
          { panelId: 'n2', target: 'panel', pid: 101, memoryBytes: 30 },
          { panelId: 'n1', target: 'buffers', pid: 200, memoryBytes: 10 },
        ],
      }),
    );
    expect(total(root)).toBe(base);
    expect(find(root, `x:${processKey(101, 101)}`)!.own.memory).toBe(100);
    expect(find(root, `x:${processKey(200, 200)}`)!.own.memory).toBe(90);
    expect(find(root, 'b:n1')!.own.memory).toBe(10);
  });

  it("never drops a terminal whose tab names no project row: it is placed under its own project (convergence T090)", () => {
    const context: HierarchyContext = {
      ...CONTEXT,
      tabs: [{ id: 't9', projectId: null, name: 'Floating', subWorkspaceName: 'Scratch' }],
      panels: [{ id: 'n1', tabId: 't9', projectId: 'p1', name: 'pwsh', kind: 'terminal' }],
    };
    const { root } = buildHierarchy(input({ context }));
    expect(pids(find(root, 'p:p1')!).sort()).toEqual([300, 301, 302, 400]);
    expect(total(root)).toBe(12 * 100);
  });

  it('moves an estimate out of its source process into the panel, leaving the grand total unchanged', () => {
    const base = total(buildHierarchy(input()).root);
    const { root } = buildHierarchy(
      input({
        estimates: [
          { panelId: 'n2', target: 'panel', pid: 101, memoryBytes: 30 },
          { panelId: 'n1', target: 'buffers', pid: 101, memoryBytes: 20 },
          { panelId: 'n1', target: 'buffers', pid: 200, memoryBytes: 10 },
        ],
      }),
    );
    expect(total(root)).toBe(base);
    expect(find(root, `x:${processKey(101, 101)}`)!.own.memory).toBe(50);
    expect(find(root, `x:${processKey(200, 200)}`)!.own.memory).toBe(90);
    const editor = find(root, 'n:n2')!;
    expect(editor.own.memory).toBe(30);
    expect(editor.estimated).toBe(true);
    const buffers = find(root, 'b:n1')!;
    expect(buffers.kind).toBe('buffers');
    expect(buffers.own.memory).toBe(30);
    expect(buffers.estimated).toBe(true);
  });

  it('never takes a source process below zero', () => {
    const { root } = buildHierarchy(input({ estimates: [{ panelId: 'n2', target: 'panel', pid: 102, memoryBytes: 500 }] }));
    expect(find(root, `x:${processKey(102, 102)}`)!.own.memory).toBe(0);
  });

  it('shows a linked editor panel as 0, sharing the panel that owns the document', () => {
    const { root } = buildHierarchy(
      input({ estimates: [{ panelId: 'n3', target: 'panel', pid: 100, memoryBytes: 0, sharedWith: 'n2' }] }),
    );
    expect(find(root, 'n:n3')).toMatchObject({ sharedWith: 'n2', estimated: true });
    expect(find(root, 'n:n3')!.own.memory).toBe(0);
  });

  it("shows an editor's CPU, I/O and GPU as not measured", () => {
    const editor = find(buildHierarchy(input()).root, 'n:n2')!;
    expect(editor.own.cpu).toBe(NOT_MEASURED);
    expect(editor.own.ioRead).toBe(NOT_MEASURED);
    expect(editor.own.gpu).toBe(NOT_MEASURED);
  });
});
