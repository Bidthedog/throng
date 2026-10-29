/**
 * The panel's search exclusions (060 #532 T049; FR-027, FR-029, FR-031, FR-032; research R22).
 *
 * A toggle for the search exclusion list, a semicolon box of the panel's own patterns, one inline
 * notice for entries that cannot be compiled, both kept in `panel.config`, both sent with every scan,
 * and all four inputs of the query — toggle, box, the global list, the project's list — re-running the
 * search under the as-you-type trigger exactly as editing the term does (FR-032).
 *
 * The two external inputs (the global preference, the project's list) are swapped through tiny
 * subscribable holders rather than re-mounting, because a re-run on CHANGE is the thing under test: a
 * remount would be a restore, and a restore must start nothing.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings, type FindInFilesPanelConfig } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  PROJECT_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/** A holder a hook can subscribe to, so a test can change it while the panel stays mounted. */
const holder = vi.hoisted(() => {
  function make<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      get: (): T => value,
      set: (next: T): void => {
        value = next;
        for (const l of [...listeners]) l();
      },
      subscribe: (cb: () => void): (() => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
  }
  return {
    settings: make<unknown>(null),
    projects: make<unknown>(null),
    make,
  };
});

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  const { useSyncExternalStore: use } = await import('react');
  return {
    ...actual,
    useAppSettings: () => use(holder.settings.subscribe, holder.settings.get, holder.settings.get) as AppSettings,
  };
});

vi.mock('../../src/renderer/state/projects-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/state/projects-store.js')>();
  const { useSyncExternalStore: use } = await import('react');
  return {
    ...actual,
    useProjectsOptional: () =>
      use(holder.projects.subscribe, holder.projects.get, holder.projects.get) as ReturnType<
        typeof actual.useProjectsOptional
      >,
  };
});

// Referenced so the import is not elided by a bundler that sees only the type use above.
void useSyncExternalStore;

const SETTLE_MS = 250;

function settings(inFiles: Partial<AppSettings['search']['inFiles']> = {}): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: {
        ...DEFAULT_APP_SETTINGS.search.inFiles,
        trigger: 'asYouType',
        settleMs: SETTLE_MS,
        ...inFiles,
      },
    },
  };
}

const setSearchExcludes = vi.fn(async (): Promise<void> => undefined);

function projectsWith(searchExcludeGlobs: string[]): unknown {
  return {
    projects: [{ id: PROJECT_ID, searchExcludeGlobs }],
    activeProject: { id: PROJECT_ID, searchExcludeGlobs },
    setSearchExcludes,
  };
}

let bridge: FileSearchStub;

const term = (): HTMLInputElement => screen.getByTestId(`fif-term-${PANEL_ID}`) as HTMLInputElement;
const toggle = (): HTMLElement => screen.getByTestId(`fif-use-excludes-${PANEL_ID}`);
const box = (): HTMLInputElement => screen.getByTestId(`fif-excludes-${PANEL_ID}`) as HTMLInputElement;
const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const lastStart = (): Record<string, unknown> =>
  bridge.start.mock.calls[bridge.start.mock.calls.length - 1]![0] as Record<string, unknown>;

beforeEach(() => {
  setSearchExcludes.mockClear();
  vi.useFakeTimers();
  holder.settings.set(settings());
  holder.projects.set(projectsWith([]));
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
  vi.useRealTimers();
});

describe('the toggle (FR-027, FR-028, FR-038)', () => {
  it('is a pressed icon control that follows the preference for a NEW panel', () => {
    renderFindInFilesPanel();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle().querySelectorAll('.icon')).toHaveLength(1);
    expect(toggle()).toHaveAttribute('title', expect.stringMatching(/exclusion/i));
  });

  it('opens off when the preference for new panels is off', () => {
    holder.settings.set(settings({ useExcludeGlobs: false }));
    renderFindInFilesPanel();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips on click, for this panel only', () => {
    renderFindInFilesPanel();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('says whether the global list applies and names the preference that edits it', () => {
    renderFindInFilesPanel();
    expect(toggle()).toHaveAttribute(
      'title',
      'Global search exclusions enabled. Edit ‘Excluded from search’ in Preferences to change.',
    );
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute(
      'title',
      'Global search exclusions disabled. Edit ‘Excluded from search’ in Preferences to change.',
    );
  });

  it('is NOT a row in the panel menu: the toolbar toggle is its route (060 FR-042)', () => {
    renderFindInFilesPanel();
    fireEvent.contextMenu(screen.getByTestId(`fif-panel-${PANEL_ID}`));

    expect(screen.queryByTestId('menu-item-Use search exclusions')).toBeNull();
    expect(screen.queryByTestId('menu-item-Use search exclusions ✓')).toBeNull();
    const labels = [...screen.getByTestId('context-menu').querySelectorAll('.context-menu__label')];
    expect(labels.map((el) => el.textContent ?? '').join('|')).not.toMatch(/Use search exclusions/);
  });
});

describe('what a scan is sent (FR-027, FR-029)', () => {
  it('carries the toggle and the box PARSED, trimmed and without empty entries', () => {
    renderFindInFilesPanel();
    fireEvent.change(box(), { target: { value: ' **/fixtures ; *.snap;; ' } });
    fireEvent.change(term(), { target: { value: 'needle' } });
    tick(SETTLE_MS + 10);

    expect(lastStart()).toMatchObject({
      useExcludeGlobs: true,
      extraExcludes: ['**/fixtures', '*.snap'],
    });
  });

  it('sends useExcludeGlobs false once the toggle is off, and still sends the box', () => {
    renderFindInFilesPanel();
    fireEvent.click(toggle());
    fireEvent.change(box(), { target: { value: '**/gen' } });
    fireEvent.change(term(), { target: { value: 'needle' } });
    tick(SETTLE_MS + 10);

    expect(lastStart()).toMatchObject({ useExcludeGlobs: false, extraExcludes: ['**/gen'] });
  });
});

describe('the invalid-entry notice (FR-029; one condition, one notice)', () => {
  it('names every entry that cannot be compiled, in ONE notice under the box', () => {
    renderFindInFilesPanel();
    fireEvent.change(box(), { target: { value: '**/a;[;**/b;{' } });

    const notices = screen.getAllByTestId(`fif-exclude-notice-${PANEL_ID}`);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('[');
    expect(notices[0]).toHaveTextContent('{');
  });

  it('says nothing for a box of valid patterns, or an empty one', () => {
    renderFindInFilesPanel();
    fireEvent.change(box(), { target: { value: '**/a;*.snap' } });
    expect(screen.queryByTestId(`fif-exclude-notice-${PANEL_ID}`)).toBeNull();
  });

  it('still sends the valid entries beside an invalid one', () => {
    renderFindInFilesPanel();
    fireEvent.change(box(), { target: { value: '**/a;[' } });
    fireEvent.change(term(), { target: { value: 'needle' } });
    tick(SETTLE_MS + 10);

    expect(lastStart()).toMatchObject({ extraExcludes: ['**/a'] });
  });
});

describe('kept with the panel (FR-031)', () => {
  it('restores the toggle and the box from panel.config, and starts nothing', () => {
    const config: FindInFilesPanelConfig = { useExcludeGlobs: false, extraExcludes: '**/gen;*.snap' };
    renderFindInFilesPanel({ config });

    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(box()).toHaveValue('**/gen;*.snap');
    tick(5_000);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('a new panel takes the preference and an empty box, and writes nothing untouched', () => {
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ onConfigChange });

    expect(box()).toHaveValue('');
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('writes both back, whole, when either changes', () => {
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ onConfigChange });

    fireEvent.change(box(), { target: { value: '**/gen' } });
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ useExcludeGlobs: true, extraExcludes: '**/gen' }),
    );

    fireEvent.click(toggle());
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ useExcludeGlobs: false, extraExcludes: '**/gen' }),
    );
  });
});

describe('every input is part of the query (FR-032)', () => {
  const startedAfterTyping = (): void => {
    renderFindInFilesPanel();
    fireEvent.change(term(), { target: { value: 'needle' } });
    tick(SETTLE_MS + 10);
    bridge.start.mockClear();
  };

  it('re-runs once the toggle settles', () => {
    startedAfterTyping();
    fireEvent.click(toggle());
    expect(bridge.start).not.toHaveBeenCalled();
    tick(SETTLE_MS + 10);
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(lastStart()).toMatchObject({ useExcludeGlobs: false });
  });

  it('re-runs once the box settles', () => {
    startedAfterTyping();
    fireEvent.change(box(), { target: { value: '**/gen' } });
    tick(SETTLE_MS + 10);
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(lastStart()).toMatchObject({ extraExcludes: ['**/gen'] });
  });

  it('re-runs when the global exclusion list in Preferences changes', () => {
    startedAfterTyping();
    act(() => holder.settings.set(settings({ excludeGlobs: ['**/only-this'] })));
    tick(SETTLE_MS + 10);
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  it('re-runs when the project’s Hidden to Find & Replace list changes', () => {
    startedAfterTyping();
    act(() => holder.projects.set(projectsWith(['src/gen'])));
    tick(SETTLE_MS + 10);
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  it('does not re-run on a change to ANOTHER project’s list', () => {
    startedAfterTyping();
    act(() =>
      holder.projects.set({
        projects: [
          { id: PROJECT_ID, searchExcludeGlobs: [] },
          { id: 'other', searchExcludeGlobs: ['x'] },
        ],
        activeProject: { id: PROJECT_ID, searchExcludeGlobs: [] },
      }),
    );
    tick(SETTLE_MS + 10);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('starts nothing under the explicit-run trigger — it applies to the NEXT run', () => {
    holder.settings.set(settings({ trigger: 'run' }));
    renderFindInFilesPanel();
    fireEvent.change(term(), { target: { value: 'needle' } });
    fireEvent.click(toggle());
    fireEvent.change(box(), { target: { value: '**/gen' } });
    tick(5_000);
    expect(bridge.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    expect(lastStart()).toMatchObject({ useExcludeGlobs: false, extraExcludes: ['**/gen'] });
  });
});

describe('Exclude from Find in Files in this project, from a result heading (T050, FR-034)', () => {
  const EXCLUDE = 'menu-item-Exclude from Find in Files in this project';

  function listFiles(): void {
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/gen/a.ts', 1, 0), resultRow('lib/b.ts', 2, 20)],
      totalMatches: 2,
      filesScanned: 2,
    });
  }

  /**
   * Right-click a heading: the menu is about that file or folder, and nothing else. Awaited, because
   * a file heading asks for its Open In targets before the menu opens (060 FR-041).
   */
  async function menuOver(headingKey: string): Promise<void> {
    // This file runs on fake timers, which `findBy*` polls with — so flush the lookup's promise instead.
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId(`fif-group-header-${headingKey}`));
      await Promise.resolve();
    });
  }

  it('adds the file heading’s path, as a glob, to THIS panel’s project', async () => {
    renderFindInFilesPanel();
    listFiles();
    await menuOver('src/gen/a.ts');

    await act(async () => {
      fireEvent.click(screen.getByTestId(EXCLUDE));
    });

    expect(setSearchExcludes).toHaveBeenCalledWith(PROJECT_ID, ['src/gen/a.ts']);
  });

  it('keeps what the project already excludes, and never adds an entry twice', async () => {
    holder.projects.set(projectsWith(['dist']));
    renderFindInFilesPanel();
    listFiles();
    await menuOver('lib/b.ts');
    await act(async () => {
      fireEvent.click(screen.getByTestId(EXCLUDE));
    });
    expect(setSearchExcludes).toHaveBeenCalledWith(PROJECT_ID, ['dist', 'lib/b.ts']);
  });

  it('is drawn but disabled for a path the project already excludes — a live no-op is worse', async () => {
    holder.projects.set(projectsWith(['lib/b.ts']));
    renderFindInFilesPanel();
    listFiles();
    await menuOver('lib/b.ts');

    expect(screen.getByTestId(EXCLUDE)).toHaveAttribute('aria-disabled', 'true');
  });

  it('is drawn but disabled when the menu is opened over no heading', () => {
    renderFindInFilesPanel();
    listFiles();
    fireEvent.contextMenu(screen.getByTestId(`fif-panel-${PANEL_ID}`));

    expect(screen.getByTestId(EXCLUDE)).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('a following window adopts both (FR-032 with 043 FR-078b)', () => {
  it('takes the toggle and the box from adoptQuery, without scheduling a scan of its own', () => {
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [],
      adoptQuery: {
        term: 'needle',
        modes: { caseSensitive: false, wholeWord: false },
        useExcludeGlobs: false,
        extraExcludes: ['**/gen', '*.snap'],
      },
    });
    tick(5_000);

    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(box()).toHaveValue('**/gen;*.snap');
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('leaves the typed box text alone when the adopted list is what it already parses to', () => {
    renderFindInFilesPanel();
    fireEvent.change(box(), { target: { value: ' **/gen ; *.snap ' } });
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [],
      adoptQuery: {
        term: '',
        modes: { caseSensitive: false, wholeWord: false },
        useExcludeGlobs: true,
        extraExcludes: ['**/gen', '*.snap'],
      },
    });

    expect(box()).toHaveValue(' **/gen ; *.snap ');
  });
});
