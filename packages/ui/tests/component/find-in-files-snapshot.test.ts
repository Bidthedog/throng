/**
 * 043 T130 — the panel a second window is showing (R23, FR-078, FR-078a, US5 scenario 6, #380).
 *
 * ══ THE DEFECT, AS THE USER MEETS IT ══
 *
 * You search a project, sync the Find in Files panel into a sub-workspace, and the second window
 * shows an EMPTY panel. Nothing distinguishes it from a search that found nothing, so you retype a
 * search that was already correct. A window could only subscribe to a scan by STARTING one, and the
 * mirrored view had started nothing.
 *
 * ══ WHY THIS IS THE RIGHT LAYER FOR MOST OF IT ══
 *
 * Two of the three claims are about what THIS window's panel does with what arrives on the channel,
 * and neither needs a second window to be true: that it announces itself on mount, and that it can
 * tell a full re-statement from a batch. The stub in `helpers/find-in-files.ts` is a real channel —
 * `emit` calls whatever the store subscribed with — so the subscribe/route/fold path under test is
 * the one the running app uses.
 *
 * What genuinely needs two real windows is that a panel in the SECOND one shows the parent's results
 * and follows them, and that is the single assertion left at E2E
 * (`find-in-files-subworkspace.e2e.ts`). The main-side half — one run, several viewers, released on
 * the last detach — is `file-search-viewers.integration.test.ts`.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import {
  __resetFindInFilesState,
  destroyFindInFilesPanel,
  getFindInFilesPanel,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import { __resetLastActiveFindInFiles } from '../../src/renderer/find-in-files/last-active-find-in-files.js';
import {
  PANEL_ID,
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

let bridge: FileSearchStub;

const rowsIn = (id: string): number =>
  screen.getByTestId(`fif-results-${id}`).querySelectorAll('.fif-row').length;

const status = (id: string): string =>
  screen.getByTestId(`fif-status-${id}`).getAttribute('data-state') ?? '';

beforeEach(() => {
  config.settings = DEFAULT_APP_SETTINGS;
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  bridge = installFileSearchStub();
});

afterEach(() => {
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  removeFileSearchStub();
  vi.restoreAllMocks();
});

describe('a mounted panel says it is displaying the panel (FR-078)', () => {
  it('attaches once, with its own panel id', () => {
    /*
     * Once, not once per render. The mount effect beside `ensureFindInFilesPanel` runs on the
     * panel's identity and not on every ownership re-statement — an attach per render would ask main
     * to re-send the whole result set on every keystroke, which for a scan with no match ceiling
     * (Assumptions) is unbounded work per character typed.
     */
    renderFindInFilesPanel();

    expect(bridge.attach).toHaveBeenCalledTimes(1);
    expect(bridge.attach).toHaveBeenCalledWith(PANEL_ID);
  });

  it('detaches when the panel is destroyed, and not when it merely unmounts', () => {
    /*
     * The asymmetry is the requirement. A window that unmounts a panel it still holds — a tab
     * switched away from — is still displaying it as far as the workspace is concerned, and dropping
     * there would release a run the OTHER window is watching. Destroying the panel is what detaches,
     * in every window, which is what keeps FR-023 exactly as it was.
     */
    const view = renderFindInFilesPanel();
    view.unmount();
    expect(bridge.drop).not.toHaveBeenCalled();

    act(() => destroyFindInFilesPanel(PANEL_ID));
    expect(bridge.drop).toHaveBeenCalledWith(PANEL_ID);
    expect(getFindInFilesPanel(PANEL_ID)).toBeUndefined();
  });
});

describe('a snapshot replaces, a delta appends (FR-078a)', () => {
  it('shows a completed scan’s whole result set to a panel that never ran one', () => {
    // #380 at this layer: the panel is displaying results it did not start, which is precisely what
    // a synced view is. Before FR-078 nothing could arrive here at all.
    renderFindInFilesPanel();
    expect(status(PANEL_ID)).toBe('notRun');

    bridge.emit({
      panelId: PANEL_ID,
      generation: 4,
      status: 'complete',
      snapshot: true,
      rows: [resultRow('src/a.ts', 1, 0), resultRow('src/b.ts', 2, 20)],
      totalMatches: 2,
      filesScanned: 7,
    });

    expect(status(PANEL_ID)).toBe('complete');
    expect(rowsIn(PANEL_ID)).toBe(2);
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent('2');
  });

  it('replaces rather than appends when the same run is re-stated', () => {
    /*
     * A window that attaches twice — a remount, a sub-workspace closed and synced again — is sent the
     * snapshot again, at the same generation. Folded as a delta it would show every row twice under
     * a total that said otherwise, which is worse than the empty panel it replaced: a wrong list
     * reads as a real answer.
     */
    renderFindInFilesPanel();
    const snapshot = {
      panelId: PANEL_ID,
      generation: 4,
      status: 'complete' as const,
      snapshot: true as const,
      rows: [resultRow('src/a.ts', 1, 0), resultRow('src/b.ts', 2, 20)],
      totalMatches: 2,
      filesScanned: 7,
    };
    bridge.emit(snapshot);
    bridge.emit(snapshot);

    expect(rowsIn(PANEL_ID)).toBe(2);
  });

  it('still appends a batch that is not a snapshot', () => {
    // The control for the case above: the flag must be what decides, not the generation or the
    // status, or a streaming scan would render only its last batch.
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 4,
      status: 'running',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 4,
      status: 'complete',
      rows: [resultRow('src/b.ts', 2, 20)],
      totalMatches: 2,
    });

    expect(rowsIn(PANEL_ID)).toBe(2);
  });

  it('drops a superseded run’s update whether it is a snapshot or a delta', () => {
    /*
     * The one guarantee the flag must not buy its way past. A snapshot is a full re-statement, so an
     * ABANDONED run's snapshot would not merely add stale rows — it would put the whole superseded
     * result set back on screen under the current run's heading.
     */
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 4,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });

    bridge.emit({
      panelId: PANEL_ID,
      generation: 3,
      status: 'complete',
      snapshot: true,
      rows: [resultRow('old/x.ts', 1, 0), resultRow('old/y.ts', 1, 0)],
      totalMatches: 2,
    });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 3,
      status: 'complete',
      rows: [resultRow('old/z.ts', 1, 0)],
      totalMatches: 3,
    });

    expect(rowsIn(PANEL_ID)).toBe(1);
    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent('1');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-078b — the box says what the list is
 * ────────────────────────────────────────────────────────────────────────── */

describe('a following window shows the query its rows came from (FR-078b)', () => {
  const termBox = (): HTMLInputElement =>
    screen.getByTestId(`fif-term-${PANEL_ID}`) as HTMLInputElement;

  /*
   * FR-078 gave a synced panel the parent's RESULTS. This is the other half, and without it the
   * sharing made the panel worse than the empty list it replaced: an empty panel is merely
   * unhelpful, whereas a populated one under the wrong term is WRONG, and the user has no way to
   * tell. With FR-074's as-you-type shipping by default, the parent re-runs 500 ms after the last
   * keystroke with nobody pressing anything, so this happens without either window being touched.
   *
   * The consequence is not cosmetic. `commitRows` sends THIS window's term with the SHARED run's
   * rows, and FR-054 re-checks the term against the bytes before writing — so a Replace All from a
   * following window refuses every file as `matchGone`, naming matches that are plainly on screen.
   * No wrong bytes are ever written, which is what keeps this a confusion defect rather than a
   * data-loss one, but the panel reports a failure that did not happen.
   *
   * Main decides who is following, so `adoptQuery`'s PRESENCE is the whole instruction here. There
   * is no local rule the renderer could apply and get wrong.
   */
  it('takes the term from the update that brought the rows', () => {
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 4,
      status: 'complete',
      snapshot: true,
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
      adoptQuery: { term: 'haystack', modes: { caseSensitive: false, wholeWord: false } },
    });

    expect(termBox().value, 'the box must describe the list beneath it').toBe('haystack');
    expect(rowsIn(PANEL_ID)).toBe(1);
  });

  it('follows the term again when the other window retypes it', () => {
    // The sequence a user actually performs: sync, then keep typing in the parent. Each re-run is a
    // new generation carrying the query that produced it.
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      snapshot: true,
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
      adoptQuery: { term: 'needle', modes: { caseSensitive: false, wholeWord: false } },
    });
    expect(termBox().value).toBe('needle');

    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/b.ts', 2, 20)],
      totalMatches: 1,
      adoptQuery: { term: 'haystack', modes: { caseSensitive: true, wholeWord: false } },
    });

    expect(termBox().value).toBe('haystack');
    expect(
      getFindInFilesPanel(PANEL_ID)?.modes.caseSensitive,
      'the modes travel with the term — they are as much a part of the query',
    ).toBe(true);
  });

  it('leaves the box alone when the update carries no query', () => {
    /*
     * The originator's case, and the reason `adoptQuery` is absent rather than present-and-equal:
     * this window is the one being typed into, and a debounced re-run landing mid-word must not
     * write anything back into its box. Every update in the single-window case looks like this, so
     * this is also the assertion that the change is inert for the ordinary user.
     */
    renderFindInFilesPanel();
    const box = termBox();
    box.focus();
    act(() => {
      bridge.emit({
        panelId: PANEL_ID,
        generation: 1,
        status: 'complete',
        rows: [resultRow('src/a.ts', 1, 0)],
        totalMatches: 1,
      });
    });

    expect(termBox().value).toBe('');
    expect(rowsIn(PANEL_ID)).toBe(1);
  });
});
