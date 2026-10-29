/**
 * How the left column shares its height (055 FR-118): Held folders gives up height before the list does;
 * a fixed list keeps every row; a growing list is given room for up to 10 rows, then scrolls; the Total row
 * is always in view.
 *
 * Layer: component. jsdom has no layout, so this asserts the RULES the layout is built from — the floor each
 * list declares, the stylesheet's flex and overflow, and where the Total row sits in the DOM. MT-16 is the
 * visual proof that the browser does what the rules say.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, focusOn, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => __resetSession());

/** A panel holding `n` processes, as the tree the list is focused into. */
function panelWith(n: number): ResourceNode {
  const procs = Array.from({ length: n }, (_, i) => proc(1000 + i, `p${i}.exe`, metrics({ cpu: i, memory: 1 }), [], { projectId: 'pp', tabId: 'tt', panelId: 'nn' }));
  const panel = node({ id: 'n:nn', kind: 'panel', label: 'Big', panelKind: 'terminal', children: procs, owner: { projectId: 'pp', tabId: 'tt', panelId: 'nn' } });
  const tab = node({ id: 't:tt', kind: 'tab', label: 'T', children: [panel], owner: { projectId: 'pp', tabId: 'tt' } });
  const project = node({ id: 'p:pp', kind: 'project', label: 'P', projectState: 'active', children: [tab], owner: { projectId: 'pp' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project], owner: { component: 'projects' } });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

function mountFocused(n: number): void {
  act(() => ingestFrame(frame(1, panelWith(n))));
  render(createElement(Breakdown));
  act(() => focusOn(['root', 'c:projects', 'p:pp', 't:tt', 'n:nn']));
}

const list = (): HTMLElement => within(screen.getByTestId('breakdown-section-children')).getByRole('tree');

describe('the list\'s floor (FR-118)', () => {
  it('is its own row count when the list is short: a 3-row list reserves no blank space', () => {
    mountFocused(3);
    expect(list().style.getPropertyValue('--breakdown-floor')).toBe('3');
    expect(within(list()).getAllByRole('treeitem')).toHaveLength(3);
  });

  it('is 10 rows for a longer list, which holds all its rows and scrolls', () => {
    mountFocused(11);
    expect(list().style.getPropertyValue('--breakdown-floor')).toBe('10');
    expect(within(list()).getAllByRole('treeitem')).toHaveLength(11);
  });

  it('is exactly 10 for a 10-row list', () => {
    mountFocused(10);
    expect(list().style.getPropertyValue('--breakdown-floor')).toBe('10');
  });

  it('keeps every row of the four components in view', () => {
    act(() => ingestFrame(frame(1, sampleHierarchy())));
    render(createElement(Breakdown));
    const tree = within(screen.getByTestId('breakdown-section-components')).getByRole('tree');
    expect(tree.style.getPropertyValue('--breakdown-floor')).toBe('4');
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(4);
  });

  it('is summed on the list, so the column can be given room for it', () => {
    mountFocused(11);
    expect(screen.getByTestId('breakdown').style.getPropertyValue('--breakdown-floor-rows')).toBe('10');
  });
});

describe('the Total row (FR-118, FR-104)', () => {
  it('is in its section, outside the scrolling list, so it is always in view', () => {
    mountFocused(11);
    const total = screen.getByTestId('breakdown-total-children');
    expect(screen.getByTestId('breakdown-section-children').contains(total)).toBe(true);
    expect(list().contains(total)).toBe(false);
  });

  it('does not count toward the floor', () => {
    mountFocused(3);
    expect(within(list()).queryByTestId('breakdown-total-children')).toBeNull();
    expect(list().style.getPropertyValue('--breakdown-floor')).toBe('3');
  });
});

describe('the rules the browser lays it out by (FR-118)', () => {
  it('scrolls the list\'s rows, with a floor of its declared rows', () => {
    const rows = rule('.breakdown__rows');
    expect(rows).toMatch(/overflow-y:\s*auto/);
    expect(rows).toMatch(/min-height:\s*calc\(var\(--breakdown-floor\)\s*\*\s*var\(--breakdown-row-px\)\)/);
  });

  it('gives Held folders up first: it shrinks far faster than the list, and scrolls within what it has', () => {
    const held = rule('.held-folders');
    const shrink = Number(/flex:\s*0\s+(\d+)\s+auto/.exec(held)?.[1] ?? 'NaN');
    expect(shrink).toBeGreaterThan(1);
    expect(rule('.held-folders > .held-folders__list')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.held-folders > .breakdown__heading')).toMatch(/flex:\s*none/);
  });

  it('lets the shortage reach the list: a section can shrink (min-height 0), so the Total row and column names stay put while the rows scroll', () => {
    const section = rule('.breakdown__section');
    expect(section).toMatch(/min-height:\s*0/);
    expect(section).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+auto/);
  });

  it('sizes the list by its floor, and lets a tall window fill it only when it has more than 10 rows (FR-118)', () => {
    // basis = floor rows: beyond 10 rows the list stops asking Held folders for more and scrolls;
    // grow only when there is something to scroll, so a short list leaves no blank space in itself.
    expect(rule('.breakdown__rows')).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+calc\(var\(--breakdown-floor\)\s*\*\s*var\(--breakdown-row-px\)\)/);
    expect(rule('.breakdown')).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+auto/);
  });

  it('declares whether the list grows: 1 for a list of more than 10 rows, 0 otherwise', () => {
    mountFocused(11);
    expect(screen.getByTestId('breakdown').style.getPropertyValue('--breakdown-grow')).toBe('1');
    cleanup();
    mountFocused(10);
    expect(screen.getByTestId('breakdown').style.getPropertyValue('--breakdown-grow')).toBe('0');
  });

  it('never lets Held folders vanish: it keeps room for its heading', () => {
    expect(rule('.held-folders')).toMatch(/min-height:\s*\d+px/);
  });

  it('keeps the list\'s own floor when the column is shorter still: the column scrolls, the list is not squeezed', () => {
    expect(rule('.breakdown')).toMatch(/min-height:\s*calc\(var\(--breakdown-floor-rows[,)]/);
    expect(rule('.monitor-body__breakdown')).toMatch(/overflow-y:\s*auto/);
  });
});
