/**
 * The attention popover (057 FR-097, FR-098): what a project row's mark and a category header's mark
 * open on hover or keyboard focus, in place of a native tooltip.
 *
 * Layer: component — what it lists, in what order, grouped how, and that a hover or a focused row
 * opens it, are DOM facts. Where it lands is layout (`clampToViewport`, registered in
 * `floating-surfaces.test.ts`); jsdom reports zero rects, so no coordinate is asserted here.
 *
 * ANTI-VACUITY CONTROL: render `null` from AttentionPopover and every test here fails, each of them
 * asserting a line present before anything absent; list every project's marks instead of the ones
 * asked for and the "only this project" test fails.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttentionPopover } from '../../src/renderer/attention/attention-popover.js';
import { CategoryHeaderMark, ProjectRowLead } from '../../src/renderer/attention/holder-marks.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { makeMark } from './attention-fixtures.js';

const anchors: HTMLElement[] = [];
function anchor(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  anchors.push(el);
  return el;
}

beforeEach(() => { __resetAttentionStore(); });
afterEach(() => {
  __resetAttentionStore();
  for (const el of anchors.splice(0)) el.remove();
});

/** jsdom has no focus-visible heuristic (it answers false for any script focus), so say what a browser would. */
function focusVisibleOn(el: HTMLElement, visible: boolean): void {
  const matches = el.matches.bind(el);
  el.matches = (sel: string) => (sel === ':focus-visible' ? visible : matches(sel));
}

function lines(): HTMLElement[] {
  return screen.queryAllByTestId(/^attention-popover-line-/);
}

describe('the popover’s content (FR-097)', () => {
  it('is one line per marked panel in the project: kind icon, panel name, reason', () => {
    act(() => setAttentionMarks([
      makeMark('p1', 'a', { title: 'Build', signal: 'bell', tabTitle: 'Dev', doing: 'Fix the login bug' }),
      makeMark('p2', 'a', { title: 'Tests', kind: 'failed', signal: 'processExited', detail: '1' }),
      makeMark('p3', 'other', { title: 'Elsewhere' }),
    ]));
    render(createElement(AttentionPopover, { anchor: anchor(), projectIds: ['a'], grouped: false }));
    const found = lines();
    expect(found.map((l) => l.getAttribute('data-panel-id'))).toEqual(['p1', 'p2']);
    // FR-119 — "Tab - Title", the title alone when its tab is not known; beneath it, on its own line, what a
    // notification says (FR-117).
    expect(within(found[0]).getByTestId('attention-popover-name').textContent).toBe('Dev - Build');
    expect(within(found[1]).getByTestId('attention-popover-name').textContent).toBe('Tests');
    expect(within(found[0]).getByTestId('attention-popover-reason').textContent).toBe('Wants your attention');
    expect(within(found[1]).getByTestId('attention-popover-reason').textContent).toBe("Process exited '1'");
    // The head (icon and name) and the description are separate rows of the line.
    const head = within(found[0]).getByTestId('attention-popover-head');
    expect(head).toContainElement(within(found[0]).getByTestId('attention-popover-name'));
    expect(head).not.toContainElement(within(found[0]).getByTestId('attention-popover-reason'));
    // The kind is carried by the icon (FR-016), a different one per kind.
    expect(found[0]).toHaveAttribute('data-kind', 'attention');
    expect(found[1]).toHaveAttribute('data-kind', 'failed');
    expect(found[0].querySelector('.icon')).not.toBeNull();
    expect(found[0].querySelector('.icon')!.innerHTML).not.toBe(found[1].querySelector('.icon')!.innerHTML);
  });

  it('is portaled to the body, never intercepts the pointer, and is a tooltip', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    const host = anchor();
    render(createElement(AttentionPopover, { anchor: host, projectIds: ['a'], grouped: false }));
    const pop = screen.getByTestId('attention-popover');
    expect(pop.parentElement).toBe(document.body);
    expect(pop).toHaveAttribute('role', 'tooltip');
    expect(pop).toHaveClass('attention-popover');
  });

  it('lists panels in raise order when no layout is known', () => {
    act(() => setAttentionMarks([
      makeMark('late', 'a', { raisedAt: 30 }),
      makeMark('early', 'a', { raisedAt: 10 }),
      makeMark('mid', 'a', { raisedAt: 20 }),
    ]));
    render(createElement(AttentionPopover, { anchor: anchor(), projectIds: ['a'], grouped: false }));
    expect(lines().map((l) => l.getAttribute('data-panel-id'))).toEqual(['early', 'mid', 'late']);
  });

  it('follows the marks as they change while it is open', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    render(createElement(AttentionPopover, { anchor: anchor(), projectIds: ['a'], grouped: false }));
    expect(lines()).toHaveLength(1);
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'a', { raisedAt: 2 })]));
    expect(lines()).toHaveLength(2);
  });

  it('renders nothing without an anchor', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    render(createElement(AttentionPopover, { anchor: null, projectIds: ['a'], grouped: false }));
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });
});

describe('grouped by project (FR-098)', () => {
  it('names each marked project, then its panels beneath, projects in the order given', () => {
    act(() => setAttentionMarks([
      makeMark('p1', 'b', { title: 'Beta shell', projectName: 'Beta' }),
      makeMark('p2', 'a', { title: 'Alpha build', projectName: 'Alpha' }),
      makeMark('p3', 'a', { title: 'Alpha tests', projectName: 'Alpha', raisedAt: 5 }),
      makeMark('p4', 'unrelated', { projectName: 'Gamma' }),
    ]));
    // List order is a, then b — not the order the marks were raised in.
    render(createElement(AttentionPopover, { anchor: anchor(), projectIds: ['a', 'b', 'unmarked'], grouped: true }));
    const groups = screen.getAllByTestId(/^attention-popover-group-/);
    expect(groups.map((g) => g.getAttribute('data-project-id'))).toEqual(['a', 'b']);
    expect(within(groups[0]).getByTestId('attention-popover-project-name')).toHaveTextContent('Alpha');
    expect(within(groups[0]).getAllByTestId(/^attention-popover-line-/)).toHaveLength(2);
    expect(within(groups[1]).getAllByTestId(/^attention-popover-line-/)).toHaveLength(1);
    expect(within(groups[1]).getByTestId('attention-popover-name')).toHaveTextContent('Beta shell');
  });

  it('is flat, with no project headings, when not grouped', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    render(createElement(AttentionPopover, { anchor: anchor(), projectIds: ['a'], grouped: false }));
    expect(screen.queryByTestId('attention-popover-project-name')).toBeNull();
  });
});

describe('opening it from a project row’s mark (FR-097)', () => {
  function row() {
    // The wrapper stands in for the project list's treeitem row, the focus target of the keyboard model.
    return render(createElement('div', { role: 'treeitem', tabIndex: 0, 'data-testid': 'row' },
      createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' })));
  }

  it('opens on hover and closes on leave, and the mark has no native title', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a', { title: 'Build' })]));
    row();
    const mark = screen.getByTestId('attention-project-a');
    expect(mark).toHaveAttribute('title', '');
    expect(mark).toHaveAttribute('aria-label', expect.stringContaining('Build'));
    expect(screen.queryByTestId('attention-popover')).toBeNull();
    fireEvent.mouseEnter(mark);
    expect(lines()).toHaveLength(1);
    fireEvent.mouseLeave(mark);
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('opens when the ROW takes keyboard focus, and closes when focus leaves or on Escape', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a', { title: 'Build' })]));
    row();
    const treeitem = screen.getByTestId('row');
    focusVisibleOn(treeitem, true);
    act(() => treeitem.focus());
    expect(lines()).toHaveLength(1);
    fireEvent.keyDown(treeitem, { key: 'Escape' });
    expect(screen.queryByTestId('attention-popover')).toBeNull();
    act(() => treeitem.blur());
    act(() => treeitem.focus());
    expect(lines()).toHaveLength(1);
    act(() => treeitem.blur());
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  // The mark is deliberately NOT a tab stop: the project list is a roving-tabindex tree whose inner
  // controls are tabIndex -1 (projects-panel-keyboard.test.ts), so its keyboard route is the row.
  it('is not itself a tab stop, so the list’s roving tab order is unchanged', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    row();
    expect(screen.getByTestId('attention-project-a')).not.toHaveAttribute('tabindex');
  });

  it('does not open for a row focused by a pointer click (not :focus-visible)', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    row();
    const treeitem = screen.getByTestId('row');
    focusVisibleOn(treeitem, false);
    act(() => treeitem.focus());
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('closes when the mark clears under it', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    row();
    fireEvent.mouseEnter(screen.getByTestId('attention-project-a'));
    expect(lines()).toHaveLength(1);
    act(() => setAttentionMarks([]));
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('does not open for an unmarked row that takes focus', () => {
    row();
    act(() => screen.getByTestId('row').focus());
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });
});

describe('opening it from a category header’s mark (FR-098)', () => {
  it('opens on hover, grouped by project, and carries no native title', () => {
    act(() => setAttentionMarks([
      makeMark('p1', 'a', { projectName: 'Alpha' }),
      makeMark('p2', 'b', { projectName: 'Beta' }),
    ]));
    render(createElement('div', { role: 'treeitem', tabIndex: 0 },
      createElement(CategoryHeaderMark, { categoryId: 'c1', projectIds: ['a', 'b'] })));
    const mark = screen.getByTestId('attention-category-c1');
    expect(mark).not.toHaveAttribute('title');
    fireEvent.mouseEnter(mark);
    expect(screen.getAllByTestId(/^attention-popover-group-/).map((g) => g.getAttribute('data-project-id'))).toEqual(['a', 'b']);
  });
});
