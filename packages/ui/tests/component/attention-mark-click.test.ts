/**
 * Clicking a project row's mark, or a category header's, goes to the next marked panel it stands for,
 * wrapping (057 FR-105, US1/16).
 *
 * Layer: component — the REAL `ProjectRowLead` / `CategoryHeaderMark` over the real store, with
 * `window.throng.attention.goTo` (the route a toast's link takes) standing in for main. Which panel is
 * next is a function of the rendered marks; the navigation itself is main's and is proved elsewhere
 * (`attention-focus-panel.test.ts`).
 *
 * ANTI-VACUITY CONTROL: drop the `onClick` on the mark and every test here fails; drop the
 * stopPropagation and the "does not also trigger the row" test fails.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryHeaderMark, ProjectRowLead } from '../../src/renderer/attention/holder-marks.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { __resetMarkCycles } from '../../src/renderer/attention/mark-cycle.js';
import { makeMark } from './attention-fixtures.js';

const goTo = vi.fn();

beforeEach(() => {
  goTo.mockReset();
  __resetAttentionStore();
  __resetMarkCycles();
  Reflect.set(window, 'throng', { attention: { goTo } });
});
afterEach(() => {
  __resetAttentionStore();
  Reflect.deleteProperty(window, 'throng');
});

const clicked = (): string[] => goTo.mock.calls.map((c) => c[0] as string);

describe('a project row’s mark (FR-105)', () => {
  it('goes to the project’s marked panels in turn, and wraps', () => {
    act(() => setAttentionMarks([makeMark('p2', 'a', { raisedAt: 2 }), makeMark('p1', 'a', { raisedAt: 1 })]));
    render(createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' }));
    const mark = screen.getByTestId('attention-project-a');
    fireEvent.click(mark);
    fireEvent.click(mark);
    fireEvent.click(mark);
    expect(clicked()).toEqual(['p1', 'p2', 'p1']);
  });

  it('keeps cycling past a panel that has cleared meanwhile', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a', { raisedAt: 1 }), makeMark('p2', 'a', { raisedAt: 2 })]));
    render(createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' }));
    const mark = screen.getByTestId('attention-project-a');
    fireEvent.click(mark);
    act(() => setAttentionMarks([makeMark('p2', 'a', { raisedAt: 2 })]));
    fireEvent.click(mark);
    expect(clicked()).toEqual(['p1', 'p2']);
  });

  it('only counts its own project’s panels', () => {
    act(() => setAttentionMarks([makeMark('other', 'b'), makeMark('p1', 'a')]));
    render(createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' }));
    fireEvent.click(screen.getByTestId('attention-project-a'));
    expect(clicked()).toEqual(['p1']);
  });

  it('does not also trigger the row’s own click or double-click (rename)', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    render(createElement('button', { onClick, onDoubleClick }, createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' })));
    const mark = screen.getByTestId('attention-project-a');
    fireEvent.click(mark);
    fireEvent.doubleClick(mark);
    expect(onClick).not.toHaveBeenCalled();
    expect(onDoubleClick).not.toHaveBeenCalled();
    expect(clicked()).toEqual(['p1']);
  });

  it('is a pointer target, so the user is told it does something', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    render(createElement(ProjectRowLead, { projectId: 'a', colour: '#3b82f6' }));
    expect(screen.getByTestId('attention-project-a')).toHaveAttribute('data-clickable', 'true');
  });
});

describe('a category header’s mark (FR-105)', () => {
  it('goes through its projects’ marked panels project by project in list order, and wraps', () => {
    act(() => setAttentionMarks([
      makeMark('pb', 'b', { raisedAt: 1 }),
      makeMark('pa2', 'a', { raisedAt: 3 }),
      makeMark('pa1', 'a', { raisedAt: 2 }),
    ]));
    render(createElement(CategoryHeaderMark, { categoryId: 'c', projectIds: ['a', 'b'] }));
    const mark = screen.getByTestId('attention-category-c');
    for (let i = 0; i < 4; i++) fireEvent.click(mark);
    expect(clicked()).toEqual(['pa1', 'pa2', 'pb', 'pa1']);
  });

  it('does not also toggle the header', () => {
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    const onClick = vi.fn();
    render(createElement('div', { onClick }, createElement(CategoryHeaderMark, { categoryId: 'c', projectIds: ['a'] })));
    fireEvent.click(screen.getByTestId('attention-category-c'));
    expect(onClick).not.toHaveBeenCalled();
    expect(clicked()).toEqual(['p1']);
  });
});
