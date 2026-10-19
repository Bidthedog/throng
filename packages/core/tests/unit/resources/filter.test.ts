import { describe, it, expect } from 'vitest';
import {
  filterHierarchy,
  orderChildren,
  ZERO_METRICS,
  NOT_MEASURED,
  type ResourceNode,
  type ResourceNodeKind,
} from '../../../src/resources/index.js';

let seq = 0;
function node(
  id: string,
  kind: ResourceNodeKind,
  children: ResourceNode[] = [],
  over: Partial<ResourceNode> = {},
): ResourceNode {
  return { id, kind, label: id, own: ZERO_METRICS, rolled: ZERO_METRICS, children, owner: { component: 'projects' }, ...over };
}
const proc = (pid: number, label: string, children: ResourceNode[] = [], commandLine?: string): ResourceNode =>
  node(`x:${pid}:${++seq}`, 'process', children, {
    label,
    process: { pid, createTime: 1, key: `${pid}:1`, imageName: label, commandLine },
  });

const tree = (): ResourceNode =>
  node('root', 'root', [
    node('c:ui', 'component', [proc(100, 'throng.exe')]),
    node('c:projects', 'component', [
      node('p:a', 'project', [
        node('t:1', 'tab', [
          node('n:1', 'panel', [proc(200, 'pwsh', [proc(201, 'node', [], 'node C:/tools/claude/cli.js')])]),
        ]),
      ]),
      node('p:b', 'project', [node('t:2', 'tab', [node('n:2', 'panel', [proc(300, 'cmd')])])]),
    ]),
  ]);

const ids = (n: ResourceNode | null): string[] => (n ? [n.id, ...n.children.flatMap(ids)] : []);

describe('filterHierarchy (055 FR-061)', () => {
  it('returns the tree untouched with no filter', () => {
    const t = tree();
    expect(filterHierarchy(t, {})).toBe(t);
  });

  it('matches name, command line or pid, case-insensitively, keeping every ancestor', () => {
    const byCmd = ids(filterHierarchy(tree(), { text: 'CLAUDE' }));
    expect(byCmd).toEqual(['root', 'c:projects', 'p:a', 't:1', 'n:1', expect.stringMatching(/^x:200/), expect.stringMatching(/^x:201/)]);
    expect(ids(filterHierarchy(tree(), { text: '300' }))).toContain('n:2');
    expect(ids(filterHierarchy(tree(), { text: 'throng' }))).toEqual(['root', 'c:ui', expect.stringMatching(/^x:100/)]);
  });

  it("keeps a matching node's whole subtree", () => {
    expect(ids(filterHierarchy(tree(), { text: 'pwsh' }))).toContainEqual(expect.stringMatching(/^x:201/));
  });

  it('is null when nothing matches', () => {
    expect(filterHierarchy(tree(), { text: 'nothing-like-this' })).toBeNull();
  });

  it('narrows to one component or one project, keeping the path down to it', () => {
    expect(ids(filterHierarchy(tree(), { narrowTo: 'c:ui' }))).toEqual(['root', 'c:ui', expect.stringMatching(/^x:100/)]);
    const p = ids(filterHierarchy(tree(), { narrowTo: 'p:b' }));
    expect(p.slice(0, 3)).toEqual(['root', 'c:projects', 'p:b']);
    expect(p).not.toContain('p:a');
  });

  it('hides the processes a predicate hides, unless one of their descendants stays', () => {
    const hidden = (n: ResourceNode) => n.process?.pid === 200 || n.process?.pid === 300;
    const out = ids(filterHierarchy(tree(), { hide: hidden }));
    expect(out).toContainEqual(expect.stringMatching(/^x:200/)); // kept: 201 is visible beneath it
    expect(out).not.toContainEqual(expect.stringMatching(/^x:300/));
    expect(out).toContain('n:2'); // UI elements are never hidden
  });
});

describe('orderChildren (055 FR-061, FR-020c)', () => {
  const m = (cpu: number | typeof NOT_MEASURED) => ({ ...ZERO_METRICS, cpu });

  it('orders by the chosen metric, largest first, ties in their given order', () => {
    const kids = [
      node('a', 'process', [], { rolled: m(1) }),
      node('b', 'process', [], { rolled: m(5) }),
      node('c', 'process', [], { rolled: m(1) }),
      node('d', 'process', [], { rolled: m(NOT_MEASURED) }),
    ];
    expect(orderChildren(kids, 'cpu').map((k) => k.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('puts the active project first, then loaded, then unloaded, each group by the metric', () => {
    const kids = [
      node('u', 'project', [], { projectState: 'unloaded', rolled: m(90) }),
      node('l1', 'project', [], { projectState: 'loaded', rolled: m(1) }),
      node('l2', 'project', [], { projectState: 'loaded', rolled: m(9) }),
      node('a', 'project', [], { projectState: 'active', rolled: m(0) }),
    ];
    expect(orderChildren(kids, 'cpu').map((k) => k.id)).toEqual(['a', 'l2', 'l1', 'u']);
  });
});
