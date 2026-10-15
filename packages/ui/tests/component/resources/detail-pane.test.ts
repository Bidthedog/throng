/**
 * The right column (055 US2 scenario 8, FR-024, FR-032, FR-046, FR-097): the selected node — or the level
 * the left column shows — its facts and figures, what it is made of, and its line graphs.
 *
 * Layer: component — the real pane over the real session. `share-bars.test.ts` and `line-graph.test.ts`
 * own how the bars and the graphs behave; here they are asked only to be there for the right node.
 */
import { act, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatGrouped, type ResourceNode } from '@throng/core';
import { DetailPane } from '../../../src/renderer/resources/detail-pane.js';
import { __resetSession, focusOn, ingestFrame, setSelection, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { GIB, MIB, frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  __resetSession();
});

function feed(root: ResourceNode, tick = 1): void {
  act(() => ingestFrame(frame(tick, root)));
}
const pane = (): HTMLElement => screen.getByTestId('detail-pane');
const field = (name: string): HTMLElement => within(pane()).getByTestId(`detail-${name}`);

describe('a process (US2 scenario 8)', () => {
  beforeEach(() => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']));
    act(() => setSelection('x:300:1'));
  });

  it('names it, with its process id, full command line and executable path', () => {
    expect(field('name')).toHaveTextContent('node.exe');
    expect(field('pid')).toHaveTextContent('300');
    expect(field('command-line')).toHaveTextContent('node server.js --port 3000');
    expect(field('executable-path')).toHaveTextContent('C:/Program Files/nodejs/node.exe');
  });

  it('gives its start time and how long it has been running', () => {
    // startedAt is 1_700_000_000_000; the frame reads 2 s later (tick 1).
    expect(field('started')).toHaveTextContent(new Date(1_700_000_000_000).toLocaleString());
    expect(field('running-for')).toHaveTextContent(/2 s/);
  });

  it('names the project, tab and panel it belongs to', () => {
    expect(field('owner')).toHaveTextContent('Alpha');
    expect(field('owner')).toHaveTextContent('Build');
    expect(field('owner')).toHaveTextContent('Shell');
  });

  it('shows its figures digit-grouped with units, banded, and its own as well as rolled-up', () => {
    expect(field('figure-cpu')).toHaveTextContent(`${formatGrouped(12)}%`);
    expect(field('figure-memory')).toHaveTextContent(`${formatGrouped(300)} MB`);
    expect(field('figure-cpu')).toHaveAttribute('data-band', 'normal');
  });

  it('marks a hot process by band, with the band in words as well as the colour', () => {
    feed(sampleHierarchy({ nodeCpu: 95 }), 2);
    expect(field('figure-cpu')).toHaveAttribute('data-band', 'critical');
    expect(field('figure-cpu')).toHaveTextContent('critical');
  });

  it('puts no figure in any title: what a figure is, never what it reads (FR-095)', () => {
    const title = field('figure-cpu').getAttribute('title') ?? '';
    expect(title).toMatch(/CPU/);
    expect(title).not.toContain(`${formatGrouped(12)}%`);
    for (const el of pane().querySelectorAll('[title]')) expect(el.getAttribute('title')).not.toMatch(/\d+(\.\d+)? ?(%|MB|GB|B\/s|KB)/);
  });
});

describe('a throng-owned process (FR-020)', () => {
  it('names its component rather than a project', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:ui']));
    act(() => setSelection('x:10:1'));

    expect(field('name')).toHaveTextContent('electron.exe');
    expect(field('owner')).toHaveTextContent('UI');
    expect(field('owner')).not.toHaveTextContent('Alpha');
  });
});

describe('an editor panel (FR-024)', () => {
  it('shows its memory as an estimate and its CPU as not measured, and has no process fields', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));
    act(() => setSelection('n:n2'));

    expect(field('name')).toHaveTextContent('Notes');
    expect(field('figure-memory')).toHaveTextContent(/estimated/i);
    expect(field('figure-memory')).toHaveTextContent(`${formatGrouped(40)} MB`);
    expect(field('figure-cpu')).toHaveTextContent('Not measured');
    expect(within(pane()).queryByTestId('detail-pid')).toBeNull();
    expect(field('owner')).toHaveTextContent('Alpha');
    expect(field('owner')).toHaveTextContent('Build');
  });
});

describe('a process that ended', () => {
  it('says so, keeps what it knew, and shows no live figures', () => {
    feed(sampleHierarchy(), 1);
    feed(sampleHierarchy({ withNode: false }), 2);
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']));
    act(() => setSelection('x:300:1'));

    expect(field('name')).toHaveTextContent('node.exe');
    expect(field('state')).toHaveTextContent(/ended/i);
    expect(field('command-line')).toHaveTextContent('node server.js --port 3000');
    expect(within(pane()).queryByTestId('detail-figure-cpu')).toBeNull();
  });
});

describe('a process whose command line could not be read (FR-080, T100)', () => {
  it('says why where the command line would go, rather than a bare “Not available”', () => {
    const hidden = proc(77, 'locked.exe', metrics({ memory: MIB }), [], { component: 'helpers' }, {
      unavailableReason: 'Access denied reading another user’s process',
    });
    const helpers = node({ id: 'c:helpers', kind: 'component', label: 'Helpers', children: [hidden], owner: { component: 'helpers' } });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [helpers], owner: { component: 'ui' } }));
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:helpers']));
    act(() => setSelection(hidden.id));

    expect(field('command-line')).toHaveTextContent('Access denied reading another user’s process');
    expect(field('command-line')).not.toHaveTextContent('Not available');
    expect(field('executable-path')).toHaveTextContent('Access denied reading another user’s process');
  });

  it('keeps the plain “Not available” when no reason was given', () => {
    const bare = proc(78, 'plain.exe', metrics({ memory: MIB }), [], { component: 'helpers' });
    const helpers = node({ id: 'c:helpers', kind: 'component', label: 'Helpers', children: [bare], owner: { component: 'helpers' } });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [helpers], owner: { component: 'ui' } }));
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:helpers']));
    act(() => setSelection(bare.id));

    expect(field('command-line')).toHaveTextContent('Not available');
  });
});

describe('what it describes', () => {
  it('is the node in focus when nothing is selected, and the selected row once there is one', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));
    expect(field('name')).toHaveTextContent('Build');

    act(() => setSelection('n:n1'));
    expect(field('name')).toHaveTextContent('Shell');

    // A selection that vanished falls back to the focus rather than describing nothing.
    feed(sampleHierarchy({ withEditor: false }), 2);
    act(() => setSelection('n:n2'));
    expect(field('name')).toHaveTextContent('Build');
  });

  it('is a single tab stop that names itself', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    expect(pane()).toHaveAttribute('tabindex', '0');
    expect(pane()).toHaveAttribute('aria-label', 'Details');
  });

  it('says nothing is selected before the first frame', () => {
    render(createElement(DetailPane));
    expect(screen.queryByTestId('detail-pane')).not.toBeNull();
    expect(screen.queryByTestId('detail-name')).toBeNull();
  });
});

describe('the column (FR-097)', () => {
  it('names the kind of what it describes beside its name', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));
    expect(within(pane()).getByTestId('detail-kind')).toHaveTextContent('Tab');
    act(() => setSelection('x:300:1'));
    expect(within(pane()).getByTestId('detail-kind')).toHaveTextContent('Process');
  });

  it('holds what the item is made of and a graph per metric, for the same node as the facts', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));
    expect(within(pane()).getByTestId('share-bars')).toBeInTheDocument();
    expect(within(pane()).getByTestId('line-graphs')).toHaveAttribute('aria-label', 'Usage over time: Build');

    act(() => setSelection('n:n1'));
    expect(within(pane()).getByTestId('line-graphs')).toHaveAttribute('aria-label', 'Usage over time: Shell');
    expect(within(pane()).getAllByTestId(/^line-graph-(cpu|memory|gpu|io)$/)).toHaveLength(4);
  });

  it('has no stacked chart and no chart region of its own', () => {
    feed(sampleHierarchy());
    render(createElement(DetailPane));
    expect(document.querySelectorAll('[data-testid="chart-pane"], [data-testid^="timeseries"], .uplot')).toHaveLength(0);
  });
});

describe('quantities', () => {
  it('groups digits in a large memory figure', () => {
    const big = proc(777, 'huge.exe', metrics({ memory: 2_500 * GIB }));
    const panel = node({ id: 'n:h', kind: 'panel', label: 'H', panelKind: 'terminal', children: [big] });
    const tab = node({ id: 't:h', kind: 'tab', label: 'T', children: [panel] });
    const project = node({ id: 'p:h', kind: 'project', label: 'P', projectState: 'active', children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    render(createElement(DetailPane));
    act(() => focusOn(['root', 'c:projects', 'p:h', 't:h', 'n:h']));
    act(() => setSelection('x:777:1'));

    expect(field('figure-memory')).toHaveTextContent(`${formatGrouped(2500)} GB`);
    expect(MIB).toBeGreaterThan(0);
  });
});
