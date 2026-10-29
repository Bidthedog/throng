/**
 * The Held folders section (055 FR-070 – FR-072, US4): every folder throng holds, with the project it
 * serves and the terminals that keep it held; choosing a terminal drills the breakdown to that panel.
 *
 * Layer: component — the real section over the real session. Which folders are held, and when one stops
 * being, is the daemon's roster and the collector's (`heldFolders` is core's, unit-tested).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HeldFolder } from '@throng/ipc-contract';
import { HeldFolders } from '../../../src/renderer/resources/held-folders.js';
import { __resetSession, getSelection, getView, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const HELD: HeldFolder[] = [
  {
    path: 'D:/Work/Alpha',
    projectId: 'p1',
    panels: [
      { panelId: 'n1', tabName: 'Build', panelName: 'Shell' },
      { panelId: 'n3', tabName: 'Build', panelName: 'Logs' },
    ],
  },
  { path: 'D:/Work/Elsewhere', projectId: 'p9', panels: [{ panelId: 'n7', tabName: 'Misc', panelName: 'Old' }] },
];

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  __resetSession();
});

const feed = (held: HeldFolder[], tick = 1): void => {
  act(() => ingestFrame(frame(tick, sampleHierarchy(), { held })));
};

describe('the section', () => {
  it('lists each folder with its project and every terminal keeping it held, by tab and panel name', () => {
    feed(HELD);
    render(createElement(HeldFolders));

    const items = screen.getAllByTestId('held-folder');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('D:/Work/Alpha');
    expect(items[0]).toHaveTextContent('Alpha');
    const terminals = within(items[0]!).getAllByTestId(/^held-folder-terminal-/);
    expect(terminals.map((t) => t.textContent)).toEqual(['Build › Shell', 'Build › Logs']);
  });

  it('names a project the hierarchy does not know by what it can, never a blank', () => {
    feed(HELD);
    render(createElement(HeldFolders));
    expect(screen.getAllByTestId('held-folder')[1]).toHaveTextContent('p9');
  });

  it('has a heading and is a labelled region', () => {
    feed(HELD);
    render(createElement(HeldFolders));
    const region = screen.getByTestId('held-folders');
    expect(region).toHaveAttribute('aria-label', 'Held folders');
    expect(within(region).getByRole('heading', { name: 'Held folders' })).toBeInTheDocument();
  });

  it('says plainly when nothing is held', () => {
    feed([]);
    render(createElement(HeldFolders));
    expect(screen.getByTestId('held-folders')).toHaveTextContent('No folders are held');
    expect(screen.queryAllByTestId('held-folder')).toHaveLength(0);
  });

  it('drops a folder at the first frame after its last terminal ended (FR-072)', () => {
    feed(HELD, 1);
    render(createElement(HeldFolders));
    expect(screen.getAllByTestId('held-folder')).toHaveLength(2);

    feed([HELD[0]!], 2);

    expect(screen.getAllByTestId('held-folder')).toHaveLength(1);
    expect(screen.queryByText('D:/Work/Elsewhere')).toBeNull();
  });

  it('shows nothing before the first frame', () => {
    render(createElement(HeldFolders));
    expect(screen.queryAllByTestId('held-folder')).toHaveLength(0);
  });
});

describe('choosing a terminal (FR-071)', () => {
  it('drills the breakdown to that panel and selects it', () => {
    feed(HELD);
    render(createElement(HeldFolders));

    fireEvent.click(screen.getByTestId('held-folder-terminal-n1'));

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']);
    expect(getSelection()).toBe('n:n1');
  });

  it('is a real button, so the keyboard reaches it', () => {
    feed(HELD);
    render(createElement(HeldFolders));
    const link = screen.getByTestId('held-folder-terminal-n1');
    expect(link.tagName).toBe('BUTTON');
    expect(link).toHaveAttribute('title', 'Show Build › Shell in the breakdown');
  });

  it('is inert for a panel the hierarchy does not hold, rather than drilling to nowhere', () => {
    feed(HELD);
    render(createElement(HeldFolders));
    const before = getView().focusPath;

    fireEvent.click(screen.getByTestId('held-folder-terminal-n7'));

    expect(getView().focusPath).toEqual(before);
    expect(screen.getByTestId('held-folder-terminal-n7')).toBeDisabled();
  });
});
