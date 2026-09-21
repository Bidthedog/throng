/**
 * #391 — the Find in Files panel under a running scan, and where it reports a condition.
 *
 * Two changes to 043, both stated as supersessions in its spec:
 *
 *   - **Results are locked while a scan runs.** For as long as the run control shows the cancel ✕,
 *     the rows ignore double-click, Enter and right-click, and Replace All is disabled — the list is
 *     still streaming in under the pointer, and a row acted on then is a row from a list that has not
 *     finished arriving. The form, the cancel control and the panel's own menu stay live.
 *   - **One notification bar**, between the form and the results list, is the only place the panel
 *     reports a condition. A missing scope reads *Could not find `<scope>`*, and neither the scope row
 *     nor the status line repeats it — one condition, one notice.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;
let opened: ResultOpenRequest[];

const panel = (): HTMLElement => screen.getByTestId(`fif-panel-${PANEL_ID}`);
const scopeControl = (): HTMLElement => screen.getByTestId(`fif-scope-control-${PANEL_ID}`);
const status = (): HTMLElement => screen.getByTestId(`fif-status-${PANEL_ID}`);
const results = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);
const rows = (): HTMLElement[] => screen.getAllByTestId(/^fif-row-/);
const menuItems = (): HTMLElement[] => screen.queryAllByTestId(/^menu-item-/);

function typeAndRun(term: string, scope = ''): void {
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: term } });
  fireEvent.change(screen.getByTestId(`fif-scope-${PANEL_ID}`), { target: { value: scope } });
  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
}

/** A scan that has listed two rows and is still going — the cancel ✕ is showing. */
function streaming(): void {
  typeAndRun('needle');
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'running',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('src/b.ts', 2, 10)],
    totalMatches: 2,
  });
  expect(screen.getByTestId(`fif-cancel-${PANEL_ID}`)).toBeInTheDocument();
}

/** Text appears once in the panel, between the form and the results list, and in neither the scope row nor the status line. */
function expectOneNoticeInTheBar(text: string): void {
  const hits = within(panel()).getAllByText(text, { exact: false });
  expect(hits, `"${text}" is reported ${hits.length} times`).toHaveLength(1);
  const notice = hits[0];
  expect(scopeControl().contains(notice), 'the scope row still carries the notice').toBe(false);
  expect(status().contains(notice), 'the status line still carries the notice').toBe(false);
  expect(
    scopeControl().compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice sits after the form',
  ).toBeTruthy();
  expect(
    notice.compareDocumentPosition(results()) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice sits before the results list',
  ).toBeTruthy();
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
  opened = [];
  registerResultOpener((request) => opened.push(request));
});

afterEach(() => {
  registerResultOpener(null);
  removeFileSearchStub();
  __resetFindInFilesState();
  document.body.replaceChildren();
});

describe('the rows are locked while a scan runs (#391)', () => {
  it('a double-click on a row opens nothing while the cancel ✕ shows', () => {
    renderFindInFilesPanel();
    streaming();

    fireEvent.doubleClick(rows()[0]);

    expect(opened).toEqual([]);
  });

  it('Enter in the list opens nothing while the cancel ✕ shows', () => {
    renderFindInFilesPanel();
    streaming();

    fireEvent.keyDown(results(), { key: 'ArrowDown' });
    fireEvent.keyDown(results(), { key: 'Enter' });

    expect(opened).toEqual([]);
  });

  it('a right-click on a row opens no menu while the cancel ✕ shows', async () => {
    renderFindInFilesPanel();
    streaming();

    await act(async () => {
      fireEvent.contextMenu(rows()[0]);
    });

    expect(menuItems()).toEqual([]);
  });

  it('every row is drawn disabled while the cancel ✕ shows', () => {
    renderFindInFilesPanel();
    streaming();

    for (const row of rows()) expect(row.getAttribute('aria-disabled')).toBe('true');
  });

  it('Replace All is disabled while the cancel ✕ shows', () => {
    renderFindInFilesPanel();
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    streaming();

    expect(screen.getByTestId(`fif-replace-all-${PANEL_ID}`)).toBeDisabled();
  });

  it('the rows come back the moment the scan completes', () => {
    renderFindInFilesPanel();
    streaming();
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', totalMatches: 2 });

    fireEvent.doubleClick(rows()[0]);

    expect(opened).toHaveLength(1);
    for (const row of rows()) expect(row.getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('one notification bar reports every condition (#391)', () => {
  it('a missing scope reads "Could not find <scope>", once, in the bar', () => {
    renderFindInFilesPanel();
    typeAndRun('needle', 'src/old-folder');
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'scopeMissing', rows: [], totalMatches: 0 });

    expectOneNoticeInTheBar('Could not find src/old-folder');
    expect(status()).not.toHaveTextContent('Scope not found');
    expect(scopeControl()).not.toHaveTextContent('Scope missing');
  });

  it('a scope outside the project is refused once, in the bar', () => {
    renderFindInFilesPanel();
    typeAndRun('needle', 'C:/elsewhere/src');

    expectOneNoticeInTheBar('outside the project');
  });

  it('a scan stopped at the cap says the list is partial, and that Replace All reaches only it', () => {
    renderFindInFilesPanel();
    typeAndRun('e');
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 20_000,
      capped: true,
    });

    expectOneNoticeInTheBar('Showing the first 20,000 matches');
    expect(panel()).toHaveTextContent('Replace All acts only on the results listed below');
  });

  it('below the cap there is no partial notice, and no bar at all', () => {
    renderFindInFilesPanel();
    typeAndRun('needle');
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });

    expect(screen.queryByTestId(`fif-notices-${PANEL_ID}`)).toBeNull();
  });

  it('two conditions at once show once each, and clearing one leaves the other', () => {
    renderFindInFilesPanel();
    typeAndRun('e');
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 20_000,
      capped: true,
    });
    // A typed scope outside the project is refused without starting anything, so the capped list stays.
    typeAndRun('e', 'C:/elsewhere/src');

    expectOneNoticeInTheBar('Showing the first 20,000 matches');
    expectOneNoticeInTheBar('outside the project');

    fireEvent.change(screen.getByTestId(`fif-scope-${PANEL_ID}`), { target: { value: 'src' } });

    expect(within(panel()).queryByText('outside the project', { exact: false })).toBeNull();
    expectOneNoticeInTheBar('Showing the first 20,000 matches');
  });
});
