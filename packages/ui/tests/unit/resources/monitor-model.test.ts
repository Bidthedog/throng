/**
 * The breakdown model's ordering (055 FR-046): rows are ordered by the chosen figure, and the I/O
 * figure is read PLUS write — the number the row prints — not the read half alone.
 */
import { describe, expect, it } from 'vitest';
import { buildBreakdown } from '../../../src/renderer/resources/monitor-model.js';
import type { ViewState } from '../../../src/renderer/resources/monitor-session.js';
import { MIB, metrics, node, proc } from '../../component/helpers/resource-fixtures.js';

const view = (over: Partial<ViewState> = {}): ViewState => ({
  maximised: false,
  metric: 'io',
  filterText: '',
  narrowTo: null,
  hideIdle: false,
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

describe('ordering by I/O', () => {
  it('puts the larger read PLUS write first, as the row’s own figure reads', () => {
    const model = buildBreakdown(tree(), view(), ctx);
    const ids = model.sections[0]!.nodes.map((n) => n.process?.pid);
    expect(ids).toEqual([102, 101]);
  });
});
