import { describe, it, expect } from 'vitest';
import {
  actionsFor,
  killOrder,
  ZERO_METRICS,
  type ActionContext,
  type ComponentId,
  type ResourceNode,
  type ResourceNodeKind,
} from '../../../src/resources/index.js';

function node(
  id: string,
  kind: ResourceNodeKind,
  children: ResourceNode[] = [],
  over: Partial<ResourceNode> = {},
  component: ComponentId = 'projects',
): ResourceNode {
  return { id, kind, label: id, own: ZERO_METRICS, rolled: ZERO_METRICS, children, owner: { component }, ...over };
}
const proc = (pid: number, children: ResourceNode[] = [], component: ComponentId = 'projects'): ResourceNode =>
  node(`x:${pid}:1`, 'process', children, { process: { pid, createTime: 1, key: `${pid}:1`, imageName: 'p' } }, component);

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  isEnded: () => false,
  isMounted: () => true,
  ...over,
});
const ids = (n: ResourceNode, c = ctx()) => actionsFor(n, c).map((a) => a.id);

describe('actionsFor (055 FR-062 – FR-063b, data-model Actions)', () => {
  it('offers nothing under UI, Daemon or Helpers — absent, not disabled', () => {
    expect(ids(proc(1, [], 'ui'))).toEqual([]);
    expect(ids(node('c:helpers', 'component', [proc(2, [], 'helpers')], {}, 'helpers'))).toEqual([]);
  });

  it('offers a project both Unload rows and Kill All Below', () => {
    const p = node('p:a', 'project', [proc(10)], { projectState: 'loaded' });
    expect(ids(p)).toEqual(['unloadProject', 'unloadProjectOther', 'killBelow']);
  });

  // The "No project" group holds rootless terminals (id `p:`, no project id): there is no project to
  // unload, so offering the row would unload nothing, or the wrong thing (Principle VI).
  it('offers the "No project" group no Unload row, only Kill All Below', () => {
    const none = node('p:', 'project', [proc(10)], { projectState: 'loaded', label: 'No project' });
    expect(ids(none)).toEqual(['killBelow']);
  });

  it('offers an unloaded project no Unload row — it is already unloaded', () => {
    const p = node('p:a', 'project', [proc(10)], { projectState: 'unloaded' });
    expect(ids(p)).toEqual(['killBelow']);
  });

  it('offers a tab Destroy Tab and Kill All Below', () => {
    expect(ids(node('t:1', 'tab', [proc(10)]))).toEqual(['destroyTab', 'killBelow']);
  });

  it('offers a terminal panel Destroy Panel and Kill All Below; an editor or preview only Destroy Panel', () => {
    expect(ids(node('n:1', 'panel', [proc(10)], { panelKind: 'terminal' }))).toEqual(['destroyPanel', 'killBelow']);
    expect(ids(node('n:2', 'panel', [], { panelKind: 'editor' }))).toEqual(['destroyPanel']);
    expect(ids(node('n:3', 'panel', [], { panelKind: 'preview' }))).toEqual(['destroyPanel']);
  });

  it('offers buffers nothing', () => {
    expect(ids(node('b:1', 'buffers'))).toEqual([]);
  });

  it('offers a process Kill Process and Kill All Below', () => {
    expect(ids(proc(10, [proc(11)]))).toEqual(['killProcess', 'killBelow']);
  });

  it('drops Kill All Below where no live process is below', () => {
    expect(ids(node('t:1', 'tab', [node('n:1', 'panel', [], { panelKind: 'terminal' })]))).toEqual(['destroyTab']);
    const endedOnly = node('n:1', 'panel', [proc(10)], { panelKind: 'terminal' });
    expect(ids(endedOnly, ctx({ isEnded: (n) => n.process?.pid === 10 }))).toEqual(['destroyPanel']);
  });

  it('disables Destroy with a reason when the tab or panel is not open in a window', () => {
    const tab = actionsFor(node('t:1', 'tab', [proc(10)]), ctx({ isMounted: () => false }));
    expect(tab[0]).toMatchObject({ id: 'destroyTab', enabled: false });
    // True of a project that is loaded but not the active one, as well as of one that is not loaded:
    // what opens a tab is switching to its project, not "loading" it (research R12).
    expect(tab[0]!.reason).toMatch(/not open/i);
    expect(tab[0]!.reason).toMatch(/switch to its project/i);
    expect(tab[0]!.reason).not.toMatch(/load/i);
    expect(tab[1]).toMatchObject({ id: 'killBelow', enabled: true });
  });

  it('offers an ended node nothing', () => {
    expect(ids(proc(10), ctx({ isEnded: () => true }))).toEqual([]);
  });
});

describe('killOrder (055 FR-063a, research R8)', () => {
  it('lists the live processes below, leaves first, a process node itself last', () => {
    const tree = proc(1, [proc(2, [proc(3)]), proc(4)]);
    const order = killOrder(tree, ctx());
    expect(order).toEqual(['3:1', '2:1', '4:1', '1:1']);
  });

  it('ends only processes inside a project, tab or panel — never the UI element', () => {
    const tab = node('t:1', 'tab', [node('n:1', 'panel', [proc(5, [proc(6)])], { panelKind: 'terminal' })]);
    expect(killOrder(tab, ctx())).toEqual(['6:1', '5:1']);
  });

  it('skips ended processes', () => {
    expect(killOrder(proc(1, [proc(2)]), ctx({ isEnded: (n) => n.process?.pid === 2 }))).toEqual(['1:1']);
  });

  it('returns nothing outside Projects', () => {
    expect(killOrder(proc(1, [proc(2, [], 'daemon')], 'daemon'), ctx())).toEqual([]);
  });
});
