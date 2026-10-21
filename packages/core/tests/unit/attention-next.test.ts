import { describe, expect, it } from 'vitest';
import { nextMarkedPanel, type AttentionOrder } from '../../src/attention/attention-next.js';
import type { AttentionMark } from '../../src/attention/attention-types.js';

function mark(panelId: string, projectId: string, raisedAt = 0): AttentionMark {
  return {
    panelId,
    projectId,
    panelTitle: panelId,
    projectName: projectId,
    producer: 'terminal',
    kind: 'attention',
    reason: { signal: 'bell', detail: null },
    raisedAt,
    dwellStartedAt: null,
  };
}

const order: AttentionOrder = [
  { projectId: 'A', panelIds: ['a1', 'a2', 'a3'] },
  { projectId: 'B', panelIds: ['b1', 'b2'] },
  { projectId: 'C', panelIds: [] },
];

const next = (position: Parameters<typeof nextMarkedPanel>[0], marks: AttentionMark[], o = order) =>
  nextMarkedPanel(position, o, marks);

describe('nextMarkedPanel (FR-080)', () => {
  it('returns null when nothing is marked', () => {
    expect(next({ projectId: 'A', panelId: 'a1' }, [])).toBeNull();
  });

  it('goes to the next marked panel after the current one, in panel order within a project', () => {
    const marks = [mark('a2', 'A'), mark('a3', 'A')];
    expect(next({ projectId: 'A', panelId: 'a1' }, marks)).toEqual({ panelId: 'a2', projectId: 'A' });
    expect(next({ projectId: 'A', panelId: 'a2' }, marks)).toEqual({ panelId: 'a3', projectId: 'A' });
  });

  it('crosses to the next project in project-list order', () => {
    const marks = [mark('a1', 'A'), mark('b2', 'B')];
    expect(next({ projectId: 'A', panelId: 'a1' }, marks)).toEqual({ panelId: 'b2', projectId: 'B' });
  });

  it('wraps round to the first marked panel', () => {
    const marks = [mark('a1', 'A'), mark('b2', 'B')];
    expect(next({ projectId: 'B', panelId: 'b2' }, marks)).toEqual({ panelId: 'a1', projectId: 'A' });
  });

  it('with a single marked panel, returns it from anywhere, including from itself', () => {
    const marks = [mark('b1', 'B')];
    expect(next({ projectId: 'A', panelId: 'a2' }, marks)).toEqual({ panelId: 'b1', projectId: 'B' });
    expect(next({ projectId: 'B', panelId: 'b1' }, marks)).toEqual({ panelId: 'b1', projectId: 'B' });
  });

  it('starts from the first marked panel when there is no position', () => {
    const marks = [mark('b1', 'B'), mark('a3', 'A')];
    expect(next(null, marks)).toEqual({ panelId: 'a3', projectId: 'A' });
  });

  it('a position with no panel sits at the start of its project', () => {
    const marks = [mark('a1', 'A'), mark('b1', 'B')];
    expect(next({ projectId: 'B', panelId: null }, marks)).toEqual({ panelId: 'b1', projectId: 'B' });
    expect(next({ projectId: 'C', panelId: null }, marks)).toEqual({ panelId: 'a1', projectId: 'A' });
  });

  it('a position on an unmarked panel finds the next marked one after it', () => {
    const marks = [mark('a1', 'A'), mark('b2', 'B')];
    expect(next({ projectId: 'A', panelId: 'a3' }, marks)).toEqual({ panelId: 'b2', projectId: 'B' });
  });

  it('marked panels a project\'s order does not list follow its listed panels, oldest raise first', () => {
    const marks = [mark('c-new', 'C', 20), mark('c-old', 'C', 10), mark('a1', 'A')];
    expect(next({ projectId: 'B', panelId: 'b2' }, marks)).toEqual({ panelId: 'c-old', projectId: 'C' });
    expect(next({ projectId: 'C', panelId: 'c-old' }, marks)).toEqual({ panelId: 'c-new', projectId: 'C' });
    const extra = [mark('a9', 'A', 1), mark('a2', 'A', 2)];
    expect(next({ projectId: 'A', panelId: 'a1' }, extra)).toEqual({ panelId: 'a2', projectId: 'A' });
    expect(next({ projectId: 'A', panelId: 'a2' }, extra)).toEqual({ panelId: 'a9', projectId: 'A' });
  });

  it('marks for a project the order does not list come last', () => {
    const marks = [mark('x1', 'X'), mark('a1', 'A')];
    expect(next({ projectId: 'A', panelId: 'a1' }, marks)).toEqual({ panelId: 'x1', projectId: 'X' });
    expect(next({ projectId: 'X', panelId: 'x1' }, marks)).toEqual({ panelId: 'a1', projectId: 'A' });
  });
});
