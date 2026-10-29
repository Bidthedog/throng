/**
 * #391 — the Find in Files panel under a running scan, and where it reports a condition.
 *
 * Two changes to 043, both stated as supersessions in its spec:
 *
 *   - **Results were locked while a scan ran** (#391, 043 FR-095) — and 060 FR-003 withdraws the row
 *     lock. The rows, the keyboard and the menu stay live while the list streams in; what stays
 *     disabled is the WRITING (Replace All, here; Replace in File and Replace Match in
 *     `find-in-files-commit-target.test.ts`), which is what the lock was protecting.
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

describe('the rows stay live while a scan runs (060 FR-003, SC-008)', () => {
  it('a double-click on a row opens it while the cancel control shows', () => {
    renderFindInFilesPanel();
    streaming();

    fireEvent.doubleClick(rows()[0]);

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ relPath: 'src/a.ts' });
  });

  it('Enter in the list opens the row the arrow keys landed on', () => {
    renderFindInFilesPanel();
    streaming();

    // Index 0 is a.ts's heading and the first press selects it, so a second lands on its row.
    fireEvent.keyDown(results(), { key: 'ArrowDown' });
    fireEvent.keyDown(results(), { key: 'ArrowDown' });
    fireEvent.keyDown(results(), { key: 'Enter' });

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ relPath: 'src/a.ts' });
  });

  it('a right-click on a row opens the menu while the cancel control shows', async () => {
    renderFindInFilesPanel();
    streaming();

    await act(async () => {
      fireEvent.contextMenu(rows()[0]);
    });

    expect(menuItems().length).toBeGreaterThan(0);
  });

  it('no row is drawn disabled while the cancel control shows', () => {
    renderFindInFilesPanel();
    streaming();

    for (const row of rows()) expect(row).not.toHaveAttribute('aria-disabled');
  });

  it('Replace All is still disabled while the cancel control shows', () => {
    renderFindInFilesPanel();
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    streaming();

    expect(screen.getByTestId(`fif-replace-all-${PANEL_ID}`)).toBeDisabled();
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
    expect(screen.getByTestId(`fif-partial-notice-${PANEL_ID}`)).toHaveTextContent(
      'Replace All acts only on the results listed below.',
    );
  });

  it('a cancel that left rows listed says the list is partial, once (FR-003b)', () => {
    renderFindInFilesPanel();
    streaming();
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    expectOneNoticeInTheBar('Replace All acts only on the results listed below.');
    const notice = screen.getByTestId(`fif-partial-notice-${PANEL_ID}`);
    expect(notice).toHaveTextContent('cancelled');
    expect(notice.textContent ?? '').toMatch(/partial/i);
    // The cap's old id is gone: one notice with one id, whichever condition raised it.
    expect(screen.queryByTestId(`fif-capped-notice-${PANEL_ID}`)).toBeNull();
  });

  it('a cancel with nothing listed raises no notice', () => {
    renderFindInFilesPanel();
    typeAndRun('needle');
    bridge.emit({ panelId: PANEL_ID, generation: 1, status: 'running', rows: [], totalMatches: 0 });
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    expect(screen.queryByTestId(`fif-partial-notice-${PANEL_ID}`)).toBeNull();
    expect(screen.queryByTestId(`fif-notices-${PANEL_ID}`)).toBeNull();
  });

  it('a cancel on a capped list is still ONE partial notice, naming both causes (FR-003b)', () => {
    renderFindInFilesPanel();
    typeAndRun('e');
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 20_000,
      capped: true,
    });
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));

    expect(screen.getAllByTestId(`fif-partial-notice-${PANEL_ID}`)).toHaveLength(1);
    const text = screen.getByTestId(`fif-partial-notice-${PANEL_ID}`).textContent ?? '';
    expect(text).toContain('20,000');
    expect(text).toContain('cancelled');
  });

  it('running again clears the partial notice (FR-003c)', () => {
    renderFindInFilesPanel();
    streaming();
    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));
    expect(screen.getByTestId(`fif-partial-notice-${PANEL_ID}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });

    expect(screen.queryByTestId(`fif-partial-notice-${PANEL_ID}`)).toBeNull();
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
