/**
 * 043 T064a–T064d — what actually starts a scan (FR-043a, FR-043b, FR-043c).
 *
 * ══ WHICH ONE SHIPS — MOVED BY FR-074, AND THE TESTS DID NOT ══
 *
 * This file was written when the shipped trigger was an EXPLICIT run, and its two blocks were named
 * for that: "the shipped default" meant explicit run, and as-you-type was the opt-in. **FR-074
 * reverses which of the two the application comes with**, and reverses nothing else — explicit run
 * remains available and remains a preference, so every assertion below is still a requirement.
 *
 * What changed is what each block has to SAY to be true. The explicit-run block now selects its
 * trigger deliberately instead of relying on the default, and the as-you-type block is the one
 * describing what a user gets out of the box. The assertions are untouched; only which of them is
 * the default's is.
 *
 * The negative assertions are still the interesting ones under explicit run: editing the term, the
 * modes or the scope starts nothing, and what stays on screen is the last run's results rather than
 * an empty list implying the new term found nothing.
 *
 * ══ THE AS-YOU-TYPE HALF HAS A TRAP WITH A NUMBER ON IT ══
 *
 * A pure quiet-period debounce NEVER FIRES under sustained churn (#186, measured). So the
 * as-you-type tests do not merely type-and-pause: one of them types forever without pausing, at an
 * interval shorter than the settle period, and requires a scan to have started anyway. That test
 * fails against the obvious implementation, which is the whole reason it is written down.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import {
  __resetFindInFilesState,
  invokeFindInFiles,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  PROJECT_ROOT,
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

const SETTLE_MS = 250;

function settings(inFiles: Partial<AppSettings['search']['inFiles']>): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, settleMs: SETTLE_MS, ...inFiles },
    },
  };
}

let bridge: FileSearchStub;

function mount(): void {
  renderFindInFilesPanel();
}

const input = (): HTMLInputElement =>
  screen.getByTestId(`fif-term-${PANEL_ID}`) as HTMLInputElement;

const type = (text: string): void => {
  fireEvent.change(input(), { target: { value: text } });
};

const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** The term every `start` since the last check was asked for. */
const startedTerms = (): string[] =>
  bridge.start.mock.calls.map((call) => (call[0] as { term: string }).term);

beforeEach(() => {
  vi.useFakeTimers();
  config.settings = settings({});
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-043a — explicit run only. A PREFERENCE since FR-074, no longer the default
 * ────────────────────────────────────────────────────────────────────────── */

describe('with explicit run selected, only an explicit run starts a scan (FR-043a)', () => {
  beforeEach(() => {
    // SELECTED, not inherited. This block used to lean on the shipped default being `'run'`; FR-074
    // moved that, and a block that kept leaning on it would silently start testing the other mode —
    // which is exactly how it failed when the default moved, and why it now says what it wants.
    config.settings = settings({ trigger: 'run' });
  });

  it('starts nothing when the term, the modes or the scope are edited', () => {
    mount();
    type('needle');
    tick(5_000);
    fireEvent.click(screen.getByTestId(`fif-match-case-${PANEL_ID}`));
    fireEvent.click(screen.getByTestId(`fif-whole-word-${PANEL_ID}`));
    fireEvent.change(screen.getByTestId(`fif-scope-${PANEL_ID}`), {
      target: { value: 'src/lib' },
    });
    tick(5_000);

    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('leaves the last run’s results listed while the term is edited (US3 scenario 26)', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);

    type('something else entirely');
    tick(5_000);

    // Still the previous run's row — not an empty list saying the new term found nothing.
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
    expect(screen.getByTestId(`fif-status-${PANEL_ID}`).dataset.state).toBe('complete');
  });

  it('starts one on Enter in the search input', () => {
    mount();
    type('needle');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(startedTerms()).toEqual(['needle']);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({
      panelId: PANEL_ID,
      projectRoot: PROJECT_ROOT,
      scopeSubPath: null,
      modes: { caseSensitive: false, wholeWord: false },
    });
  });

  it('starts one from the run control, carrying the modes the user set', () => {
    mount();
    type('needle');
    fireEvent.click(screen.getByTestId(`fif-match-case-${PANEL_ID}`));
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({
      term: 'needle',
      modes: { caseSensitive: true, wholeWord: false },
    });
  });

  it('asks for nothing when the term is empty', () => {
    mount();
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));

    expect(bridge.start).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-043b / FR-043c — as you type
 * ────────────────────────────────────────────────────────────────────────── */

describe('with as-you-type on, a settled edit starts a scan (FR-043b)', () => {
  beforeEach(() => {
    config.settings = settings({ trigger: 'asYouType' });
  });

  it('is what the application SHIPS with, so an untouched install behaves this way (FR-074)', () => {
    // Deliberately does not override the trigger: the point is what `DEFAULT_APP_SETTINGS` says.
    // `settings({})` still pins `settleMs` — the interval is a fixture value here, and its shipped
    // figure is FR-075's, asserted in `settings-metadata.test.ts` where the descriptor lives.
    config.settings = settings({});
    expect(DEFAULT_APP_SETTINGS.search.inFiles.trigger).toBe('asYouType');

    mount();
    type('needle');
    tick(SETTLE_MS + 10);

    expect(startedTerms()).toEqual(['needle']);
  });

  it('waits for typing to settle, then starts exactly one scan', () => {
    mount();
    type('n');
    tick(50);
    type('ne');
    tick(50);
    type('needle');
    expect(bridge.start).not.toHaveBeenCalled();

    tick(SETTLE_MS + 10);

    expect(startedTerms()).toEqual(['needle']);
  });

  it('starts one under sustained churn, which a quiet period alone never would (#186)', () => {
    mount();
    // Never a gap as long as the settle period: a pure debounce re-arms on every change and fires
    // never. The forced ceiling is what makes this pass.
    for (let i = 0; i < 20; i++) {
      type(`needle${i}`);
      tick(SETTLE_MS - 50);
    }

    expect(bridge.start.mock.calls.length).toBeGreaterThan(0);
  });

  it('supersedes rather than compounds: a superseded run’s rows never land (FR-043c)', () => {
    mount();
    type('alpha');
    tick(SETTLE_MS + 10);
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'running',
      rows: [resultRow('src/old.ts', 1, 0)],
      totalMatches: 1,
    });

    type('beta');
    tick(SETTLE_MS + 10);
    expect(startedTerms()).toEqual(['alpha', 'beta']);

    // The newer run reports first, and then the abandoned one finally answers. Its rows are from a
    // question nobody is asking any more, and must not be added to — or mixed into — the list.
    bridge.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/new.ts', 1, 0)],
      totalMatches: 1,
    });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/old.ts', 9, 90)],
      totalMatches: 2,
    });

    expect(screen.getAllByTestId(/^fif-row-/).map((el) => el.dataset.relPath)).toEqual([
      'src/new.ts',
    ]);
  });

  it('starts one when a match mode or the scope changes, not only the term', () => {
    mount();
    type('needle');
    tick(SETTLE_MS + 10);
    expect(bridge.start).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId(`fif-whole-word-${PANEL_ID}`));
    tick(SETTLE_MS + 10);

    expect(bridge.start).toHaveBeenCalledTimes(2);
    expect(bridge.start.mock.calls[1][0]).toMatchObject({ modes: { wholeWord: true } });
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-043a's final clause — invoking find in files IS an explicit run
 * ────────────────────────────────────────────────────────────────────────── */

describe('invoking find in files runs (FR-043a, T064c)', () => {
  it('re-runs a reused panel’s existing term when nothing is seeded', () => {
    mount();
    type('needle');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(startedTerms()).toEqual(['needle']);

    // The user pressed the chord again with no selection: they asked for a search, and the term
    // they get is the one already in the box — not stale results with nothing said about them.
    act(() => {
      invokeFindInFiles(PANEL_ID, {});
    });

    expect(startedTerms()).toEqual(['needle', 'needle']);
  });

  it('runs the seeded term when one is supplied', () => {
    mount();
    type('needle');
    act(() => {
      invokeFindInFiles(PANEL_ID, { seedTerm: 'haystack' });
    });

    expect(startedTerms()).toEqual(['haystack']);
    expect(input().value).toBe('haystack');
  });

  it('starts nothing when a reused panel has no term to re-run', () => {
    mount();
    act(() => {
      invokeFindInFiles(PANEL_ID, {});
    });

    expect(bridge.start).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T235 (FR-078b, FR-043c) — a FOLLOWING window never re-runs a query it merely adopted
 *
 * When a panel is shown in two windows, main sends the window that is NOT typing the query its rows
 * came from (`adoptQuery`), and the store writes it into the box so box and list agree. Under the
 * shipped as-you-type default the panel's effect could not tell that write from typing: the term
 * changed, so it scheduled a scan. Once the settle passed the FOLLOWER started a scan, became the
 * query's originator in main, and the parent was sent its own older term back — overwriting whatever
 * the user had typed there since. "The query travels one way" is FR-078b's own wording.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a following window never re-runs a query it adopted (T235)', () => {
  it('starts no scan after adopting another window’s term, however long it waits', () => {
    mount();

    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
      adoptQuery: { term: 'haystack', modes: { caseSensitive: false, wholeWord: false } },
    });
    // The box follows — that half of FR-078b already worked.
    expect(input().value).toBe('haystack');

    tick(SETTLE_MS * 20);

    expect(startedTerms()).toEqual([]);
  });

  it('still searches when the follower’s user TYPES — adopting is not a lock on the box', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [],
      totalMatches: 0,
      adoptQuery: { term: 'haystack', modes: { caseSensitive: false, wholeWord: false } },
    });
    tick(SETTLE_MS * 20);

    type('needle');
    tick(SETTLE_MS * 20);

    expect(startedTerms()).toEqual(['needle']);
  });

  it('drops a settle this window had already armed, rather than letting it overwrite the adopted query', () => {
    // The user in THIS window typed and paused for less than the settle; the other window's query
    // then arrived. The pending run would send this window's stale text and take the query over.
    mount();
    type('needl');

    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [],
      totalMatches: 0,
      adoptQuery: { term: 'haystack', modes: { caseSensitive: false, wholeWord: false } },
    });
    tick(SETTLE_MS * 20);

    expect(startedTerms()).toEqual([]);
  });
});
