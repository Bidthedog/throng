/**
 * The workspace context a window reports (055 FR-020, FR-020c, US2/AC3, Edge Cases "Sub-workspace
 * windows" and "Rootless terminals"; T090, T092, T099).
 *
 * Layer: unit — `buildWorkspaceContext` is a pure function of the facts a window holds. What matters is
 * what core's hierarchy does WITH the context it builds, so most cases feed the real `buildHierarchy`
 * rather than asserting the context's shape alone: a tab sent with no project was well-formed and was
 * silently dropped on the far side.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHierarchy,
  processKey,
  type Metrics,
  type Panel,
  type ProcessReading,
  type ResourceNode,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import { buildWorkspaceContext, loadOtherLayouts, type WorkspaceFacts } from '../../../src/renderer/resources/estimates-sources.js';
import { clearTerminalTitle, setTerminalTitle } from '../../../src/renderer/terminal/title-store.js';
import { currentPanelTitle } from '../../../src/renderer/workspace/use-panel-display-names.js';

const panel = (id: string, originProjectId: string, kind: Panel['kind'] = 'terminal'): Panel => ({
  type: 'panel',
  id,
  originProjectId,
  title: id,
  ...(kind !== undefined ? { kind } : {}),
});
const tab = (id: string, panels: Panel[]): Tab => ({
  id,
  title: `Tab ${id}`,
  root:
    panels.length === 1
      ? panels[0]!
      : { type: 'split', orientation: 'row', children: panels, sizes: panels.map(() => 1 / panels.length) },
});
const layout = (projectId: string, tabs: Tab[]): WorkspaceLayout => ({ projectId, schemaVersion: 1, tabs, activeTabId: tabs[0]!.id });

const PROJECTS = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
  { id: 'p3', name: 'Gamma' },
] as WorkspaceFacts['projects'];

const facts = (over: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  projects: PROJECTS,
  activeProjectId: 'p1',
  loadedIds: new Set(['p1', 'p2']),
  layout: null,
  subWorkspaceName: null,
  ...over,
});

const reading = (pid: number, ppid: number, imageName: string): ProcessReading => ({
  pid,
  ppid,
  createTime: pid,
  imageName,
  cpuTime: 0,
  privateWorkingSet: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  startedAt: pid,
});

/** The hierarchy for one terminal (`panelId`, shell pid 300) under the context the window built. */
function hierarchyFor(context: ReturnType<typeof buildWorkspaceContext>, panelId: string, projectId: string | null): ResourceNode {
  const readings = [reading(300, 1, 'pwsh.exe')];
  const metrics = new Map<string, Metrics>([[processKey(300, 300), { cpu: 1, memory: 1, gpu: 0, ioRead: 0, ioWrite: 0 }]]);
  return buildHierarchy({
    readings,
    metrics,
    roster: {
      daemonPid: null,
      agentPid: null,
      collectorPid: null,
      terminals: [{ panelId, projectId, osPid: 300, conhostPid: null, attached: [] }],
      locks: [],
      ui: [],
    },
    context,
    estimates: [],
    lineage: new Map(),
  }).root;
}

const find = (n: ResourceNode, id: string): ResourceNode | undefined =>
  n.id === id ? n : n.children.map((c) => find(c, id)).find((x) => x !== undefined);

describe('a sub-workspace window’s tabs (T090)', () => {
  const sub = facts({ subWorkspaceName: 'Scratch', layout: layout('sub-1', [tab('ts1', [panel('n1', 'p1'), panel('n2', 'p1', 'editor')])]) });

  it('are sent with the project their panels come from, never with none', () => {
    const context = buildWorkspaceContext(sub);
    expect(context.tabs).toEqual([{ id: 'ts1', projectId: 'p1', name: 'Tab ts1', subWorkspaceName: 'Scratch', mounted: true }]);
  });

  it('place the tab, its panels and the shell under the origin project in the hierarchy', () => {
    const root = hierarchyFor(buildWorkspaceContext(sub), 'n1', 'p1');
    const project = find(root, 'p:p1')!;
    const t = find(project, 't:ts1')!;
    expect(t).toBeDefined();
    const terminal = find(t, 'n:n1')!;
    expect(terminal).toBeDefined();
    expect(find(terminal, 'x:300:300')).toBeDefined();
  });

  it('go to the project most of their panels come from when a tab mixes projects', () => {
    const mixed = facts({
      subWorkspaceName: 'Scratch',
      layout: layout('sub-1', [tab('tm', [panel('a', 'p2', 'editor'), panel('b', 'p1', 'editor'), panel('c', 'p1', 'editor')])]),
    });
    expect(buildWorkspaceContext(mixed).tabs[0]!.projectId).toBe('p1');
  });

  it('report each panel under its own origin project', () => {
    const mixed = facts({
      subWorkspaceName: 'Scratch',
      layout: layout('sub-1', [tab('tm', [panel('a', 'p2', 'editor'), panel('b', 'p1', 'editor')])]),
    });
    expect(buildWorkspaceContext(mixed).panels.map((p) => [p.id, p.projectId])).toEqual([
      ['a', 'p2'],
      ['b', 'p1'],
    ]);
  });
});

describe('the other projects’ layouts (T092)', () => {
  const other = new Map<string, WorkspaceLayout>([
    ['p2', layout('p2', [tab('tb', [panel('nb', 'p2', 'editor'), panel('nb2', 'p2')])])],
    ['p3', layout('p3', [tab('tg', [panel('ng', 'p3')]), tab('tg2', [panel('ng2', 'p3', 'editor')])])],
  ]);
  const withOthers = (): ReturnType<typeof buildWorkspaceContext> =>
    buildWorkspaceContext(facts({ layout: layout('p1', [tab('ta', [panel('na', 'p1')])]), otherLayouts: other }));

  it('keeps the active project’s tabs and panels mounted', () => {
    const context = withOthers();
    expect(context.tabs.find((t) => t.id === 'ta')?.mounted).toBe(true);
    expect(context.panels.find((p) => p.id === 'na')?.mounted).toBe(true);
  });

  it('reports the tabs and panels of a loaded project, not mounted', () => {
    const context = withOthers();
    expect(context.tabs.find((t) => t.id === 'tb')).toMatchObject({ projectId: 'p2', mounted: false });
    expect(context.panels.filter((p) => p.tabId === 'tb').map((p) => [p.id, p.mounted, p.projectId])).toEqual([
      ['nb', false, 'p2'],
      ['nb2', false, 'p2'],
    ]);
  });

  it('reports only the terminal tabs of an unloaded project, since only a kept terminal survives an unload', () => {
    const context = withOthers();
    expect(context.tabs.map((t) => t.id)).toEqual(['ta', 'tb', 'tg']);
    expect(context.panels.filter((p) => p.projectId === 'p3').map((p) => p.id)).toEqual(['ng']);
    expect(context.tabs.find((t) => t.id === 'tg')?.mounted).toBe(false);
  });

  it('does not repeat the active project if its layout is also among the others', () => {
    const dup = new Map(other).set('p1', layout('p1', [tab('ta', [panel('na', 'p1')])]));
    const context = buildWorkspaceContext(facts({ layout: layout('p1', [tab('ta', [panel('na', 'p1')])]), otherLayouts: dup }));
    expect(context.tabs.filter((t) => t.id === 'ta')).toHaveLength(1);
  });

  it('puts a kept terminal of an unloaded project in its tab in the hierarchy', () => {
    const root = hierarchyFor(withOthers(), 'ng', 'p3');
    const project = find(root, 'p:p3')!;
    expect(project.projectState).toBe('unloaded');
    expect(find(project, 't:tg')).toBeDefined();
    expect(find(find(project, 't:tg')!, 'n:ng')).toBeDefined();
  });

  it('a window that holds a sub-workspace reports no other projects’ layouts', () => {
    const context = buildWorkspaceContext(
      facts({ subWorkspaceName: 'Scratch', layout: layout('sub-1', [tab('ts1', [panel('n1', 'p1')])]), otherLayouts: other }),
    );
    expect(context.tabs.map((t) => t.id)).toEqual(['ts1']);
  });
});

describe('reading the other projects’ layouts (T092)', () => {
  const saved = (projectId: string, restored = true) => ({ layout: layout(projectId, [tab(`t-${projectId}`, [panel(`n-${projectId}`, projectId)])]), restored });

  it('keeps a saved layout per project, from the daemon’s own workspace.load', async () => {
    const asked: string[] = [];
    const got = await loadOtherLayouts(['p2', 'p3'], (id) => {
      asked.push(id);
      return Promise.resolve(saved(id));
    });
    expect(asked).toEqual(['p2', 'p3']);
    expect([...got.keys()]).toEqual(['p2', 'p3']);
    expect(got.get('p2')?.tabs[0]?.id).toBe('t-p2');
  });

  it('leaves out a project that has no saved layout — load synthesises a default one, which is not a workspace', async () => {
    const got = await loadOtherLayouts(['p2', 'p3'], (id) => Promise.resolve(saved(id, id === 'p2')));
    expect([...got.keys()]).toEqual(['p2']);
  });

  it('leaves out a project whose read fails, and still reads the others', async () => {
    const got = await loadOtherLayouts(['p2', 'p3'], (id) => (id === 'p2' ? Promise.reject(new Error('daemon')) : Promise.resolve(saved(id))));
    expect([...got.keys()]).toEqual(['p3']);
  });
});

describe('a panel’s name is the one its own header shows (D2, FR-020, FR-082)', () => {
  afterEach(() => clearTerminalTitle('nt'));

  it('names a terminal by its live window title, not its flavour label', () => {
    const t: Panel = { ...panel('nt', 'p1'), config: { flavourLabel: 'PowerShell' } };
    setTerminalTitle('nt', 'claude — fixing the build');
    const context = buildWorkspaceContext(facts({ layout: layout('p1', [tab('ta', [t])]) }));
    expect(context.panels[0]!.name).toBe('claude — fixing the build');
  });

  it('names an editor by its file, as its header does', () => {
    const e: Panel = { ...panel('ne', 'p1', 'editor'), config: { filePath: 'C:/work/notes.md' } };
    const context = buildWorkspaceContext(facts({ layout: layout('p1', [tab('ta', [e])]) }));
    expect(context.panels[0]!.name).toBe(currentPanelTitle(e));
    expect(context.panels[0]!.name).toContain('notes');
  });
});

describe('a terminal whose project is not known (T099, “Rootless terminals”)', () => {
  const rootless = facts({ layout: layout('ghost', [tab('tr', [panel('nr', 'ghost')])]), activeProjectId: null, loadedIds: new Set() });

  it('reports its tab and panel with no project', () => {
    const context = buildWorkspaceContext(rootless);
    expect(context.tabs[0]).toMatchObject({ id: 'tr', projectId: null });
    expect(context.panels[0]).toMatchObject({ id: 'nr', projectId: null });
  });

  it('lands under “No project”, in its own tab node', () => {
    const root = hierarchyFor(buildWorkspaceContext(rootless), 'nr', null);
    const group = find(root, 'p:')!;
    expect(group.label).toBe('No project');
    expect(find(find(group, 't:tr')!, 'n:nr')).toBeDefined();
  });
});
