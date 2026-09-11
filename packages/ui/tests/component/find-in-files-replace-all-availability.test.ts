/**
 * 043 T212 — Replace All is drawn DISABLED when there is nothing to commit (FR-084, FR-084a, FR-084b).
 *
 * ══ THIS CLOSES A SHIPPED DEFECT, NOT A POLISH ITEM ══
 *
 * `pendingRows()` already returns an empty list once every listed match has been committed, and
 * `commitReplace` returns without asking anything when it is handed no targets. So the control today
 * is drawn live, clicks, and does nothing — a control whose action is unavailable drawn inert
 * instead of disabled, which is the Constitution VI violation FR-062a is about, on this same panel.
 *
 * ══ BOTH ROUTES, OR THE ACCELERATOR AND THE CANONICAL ROUTE DISAGREE ══
 *
 * FR-068 makes the toolbar control an accelerator over the FR-025a menu row. Two routes to one
 * action must not differ about whether the action is available, so every assertion here is made
 * twice — once on the button, once on the menu item.
 *
 * ══ WHY THE TRIGGER IS SELECTED RATHER THAN INHERITED ══
 *
 * FR-084a's two routes back to available are NOT the same event under both triggers. A new scan
 * clears the committed marking by generation under either. A term the user has TYPED BUT NOT RUN
 * coincides with a new scan under FR-074's shipped as-you-type default, and does not under
 * FR-043a's explicit run — which is the only setting where that clause is observable at all. So the
 * block that tests it says which trigger it means, exactly as `find-in-files-trigger.test.ts` does
 * and for the reason recorded there.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  committedEverything,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

function settings(inFiles: Partial<AppSettings['search']['inFiles']>): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, ...inFiles },
    },
  };
}

let bridge: FileSearchStub;

const ROWS = [resultRow('src/a.ts', 1, 6), resultRow('src/b.ts', 2, 40)];

beforeEach(() => {
  config.settings = settings({});
  __resetFindInFilesState();
  bridge = installFileSearchStub();
  bridge.commit.mockImplementation(async (payload: unknown) => committedEverything(payload));
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Let the commit's promise chain settle — it crosses the bridge and comes back. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const toolbarReplaceAll = (): HTMLButtonElement =>
  screen.getByTestId(`fif-replace-all-${PANEL_ID}`) as HTMLButtonElement;

/**
 * Run a search, list two matches, disclose replace and type a replacement.
 *
 * The search is RUN rather than merely typed, because FR-084a turns on the term the listed results
 * came from — which a panel that never ran has never had.
 */
async function listed(trigger: 'run' | 'asYouType'): Promise<void> {
  config.settings = settings({ trigger });
  renderFindInFilesPanel();
  fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
  fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
  await flush();
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: ROWS,
    totalMatches: 2,
  });
  fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
  fireEvent.change(screen.getByTestId(`fif-replacement-${PANEL_ID}`), {
    target: { value: 'thread' },
  });
}

/** Commit every listed match, through the toolbar accelerator. */
async function replaceAll(): Promise<void> {
  fireEvent.click(toolbarReplaceAll());
  await flush();
}

/**
 * Whether the MENU row says the command is unavailable.
 *
 * `aria-disabled` is what carries it — the menu draws a `li`, so there is no `disabled` property to
 * read, and its absence is what makes a row live.
 *
 * ASYNCHRONOUS SINCE 043 FR-087, and the change is in the production handler rather than here. A
 * right-click ON A ROW now asks main whether that row's file is already open, because the Open In
 * targets cannot be labelled or disabled without the answer — so the menu is built one round trip
 * after the click. The file explorer's identical menu has behaved this way since 006; this panel
 * has simply joined it.
 *
 * Only a row is affected: a right-click that names no file skips the query and still opens
 * synchronously, which is why three of this file's four call sites moved and the toolbar assertions
 * did not.
 */
async function menuSaysUnavailable(): Promise<boolean> {
  fireEvent.contextMenu(screen.getByTestId('fif-row-src/a.ts-6'));
  const row = await screen.findByTestId('menu-item-Replace All');
  return row.getAttribute('aria-disabled') === 'true';
}

describe('Replace All while matches are pending (FR-084)', () => {
  it('is live on the toolbar and in the menu', async () => {
    await listed('asYouType');
    expect(toolbarReplaceAll()).not.toBeDisabled();
    expect(await menuSaysUnavailable()).toBe(false);
  });
});

describe('Replace All once everything listed has been committed (FR-084)', () => {
  it('is disabled on the toolbar', async () => {
    await listed('asYouType');
    await replaceAll();
    // It clicked and did something. There is now nothing left for it to do, and it must say so.
    expect(toolbarReplaceAll()).toBeDisabled();
  });

  it('is disabled in the menu too, so the two routes agree (FR-025a, FR-068)', async () => {
    await listed('asYouType');
    await replaceAll();
    expect(await menuSaysUnavailable()).toBe(true);
  });

  it('does not disable, hide or grey a ROW (FR-084b, FR-045b)', async () => {
    await listed('asYouType');
    await replaceAll();

    // FR-045b's four negatives are about rows; FR-084 is about a panel control. Stated here so the
    // two are not read as contradicting each other, and so a fix that reached the rows fails.
    for (const testId of ['fif-row-src/a.ts-6', 'fif-row-src/b.ts-40']) {
      const row = screen.getByTestId(testId);
      expect(row).toBeInTheDocument();
      expect(row).not.toHaveAttribute('aria-disabled');
      expect(row).not.toHaveAttribute('data-disabled');
    }
  });

  it('stays disabled when replace is put away, which was already true', async () => {
    await listed('asYouType');
    await replaceAll();
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    expect(toolbarReplaceAll()).toBeDisabled();
  });
});

describe('Replace All becomes available again (FR-084a)', () => {
  it('on a new scan — a new generation clears the committed marking', async () => {
    await listed('asYouType');
    await replaceAll();
    expect(toolbarReplaceAll()).toBeDisabled();

    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: ROWS,
      totalMatches: 2,
    });

    expect(toolbarReplaceAll()).not.toBeDisabled();
    expect(await menuSaysUnavailable()).toBe(false);
  });

  /*
   * FR-084c — AND NOT ON A TERM THAT HAS ONLY BEEN TYPED.
   *
   * This assertion is the reverse of the one it replaces, and the reversal is the point. FR-084a
   * required a typed-but-unrun term to re-enable the control; implementing it showed that it
   * re-creates the very defect FR-084 removes. Under explicit run the listed rows are still the
   * previous term's rows and all of them are committed, so a re-enabled control has nothing to send:
   * pressing it commits nothing, and had it sent anything FR-054's re-check would refuse every row
   * against the new term and report matches gone that are on screen.
   *
   * Kept as a live test rather than deleted, because the withdrawn clause is the intuitive reading of
   * the maintainer's words and would otherwise be re-added by the next person who reads them.
   */
  it('stays disabled on a term that has only been typed, under explicit run (FR-084c)', async () => {
    // Explicit run is the only trigger where this is observable at all: under FR-074's as-you-type
    // default the same keystroke is also a new scan, which re-enables through the clause above.
    await listed('run');
    await replaceAll();
    expect(toolbarReplaceAll()).toBeDisabled();

    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'thimble' } });

    expect(
      toolbarReplaceAll(),
      'a typed term re-enabled Replace All over rows that are all committed — there is nothing for ' +
        'it to send, which is the inert control FR-084 exists to remove',
    ).toBeDisabled();
    expect(await menuSaysUnavailable()).toBe(true);
  });

  it('and a new scan for that term does re-enable it — the route that always worked', async () => {
    await listed('run');
    await replaceAll();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'thimble' } });

    // The user actually runs it: a new generation, which clears the committed marking.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: ROWS,
      totalMatches: 2,
    });

    expect(toolbarReplaceAll()).not.toBeDisabled();
  });
});

describe('a panel with no results at all (FR-084)', () => {
  it('draws Replace All disabled rather than live over an empty list', async () => {
    config.settings = settings({ trigger: 'run' });
    renderFindInFilesPanel();
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });

    // Nothing has been listed, so there is nothing pending and no term any results came from.
    expect(toolbarReplaceAll()).toBeDisabled();
  });
});
