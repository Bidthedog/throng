/**
 * 060 FR-043 — Show results: the `search.inFiles.showResults` preference decides whether result
 * headings start collapsed or expanded, and the panel's toolbar toggle writes that preference.
 *
 * Layer: component — which headings render open, the toggle's pressed state and the patch it writes
 * are all renderer behaviour; the setting's parse is `core/tests/unit/settings-show-results.test.ts`.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/** Settings a hook subscribes to, so a test can change the preference while the panel stays mounted. */
const config = vi.hoisted(() => {
  let value: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: (): unknown => value,
    set: (next: unknown): void => {
      value = next;
      for (const l of [...listeners]) l();
    },
    subscribe: (cb: () => void): (() => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
});
const writes = vi.hoisted(() => ({ patch: vi.fn(async () => ({ ok: true as const })) }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  const { useSyncExternalStore: use } = await import('react');
  return { ...actual, useAppSettings: () => use(config.subscribe, config.get, config.get) as AppSettings };
});
vi.mock('../../src/renderer/config/write-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/config/write-config.js')>();
  return { ...actual, writeConfigPatch: writes.patch };
});

let bridge: FileSearchStub;

function settings(showResults: 'collapsed' | 'expanded'): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, showResults },
    },
  };
}

function emit(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('src/b.ts', 2, 20)],
    totalMatches: 2,
  });
}

const expanded = (key: string): string | null =>
  screen.getByTestId(`fif-group-toggle-${key}`).getAttribute('aria-expanded');
const toggle = (): HTMLElement => screen.getByTestId(`fif-show-results-${PANEL_ID}`);

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
  writes.patch.mockClear();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the Show results preference (060 FR-043)', () => {
  it('opens every heading when it is Expanded, the shipped value', () => {
    config.set(settings('expanded'));
    renderFindInFilesPanel();
    emit();
    expect(expanded('src/a.ts')).toBe('true');
    expect(expanded('src/b.ts')).toBe('true');
  });

  it('closes every heading when it is Collapsed', () => {
    config.set(settings('collapsed'));
    renderFindInFilesPanel();
    emit();
    expect(expanded('src/a.ts')).toBe('false');
    expect(expanded('src/b.ts')).toBe('false');
  });

  it('still lets one heading be opened by hand under Collapsed', () => {
    config.set(settings('collapsed'));
    renderFindInFilesPanel();
    emit();
    fireEvent.click(screen.getByTestId('fif-group-toggle-src/a.ts'));
    expect(expanded('src/a.ts')).toBe('true');
    expect(expanded('src/b.ts')).toBe('false');
  });

  it('applies to the results on screen when it changes, resetting headings flipped by hand', () => {
    config.set(settings('expanded'));
    renderFindInFilesPanel();
    emit();
    fireEvent.click(screen.getByTestId('fif-group-toggle-src/a.ts')); // closed by hand
    act(() => config.set(settings('collapsed')));
    expect(expanded('src/a.ts')).toBe('false');
    expect(expanded('src/b.ts')).toBe('false');
    act(() => config.set(settings('expanded')));
    // a.ts was flipped by hand before; the change of preference resets it with the rest.
    expect(expanded('src/a.ts')).toBe('true');
    expect(expanded('src/b.ts')).toBe('true');
  });
});

describe('the toolbar toggle writes the preference (060 FR-043)', () => {
  it('is pressed while results show collapsed, and titled for what it does', () => {
    config.set(settings('collapsed'));
    renderFindInFilesPanel();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle().getAttribute('title')).toMatch(/Show results/);
    expect(toggle().querySelectorAll('.icon')).toHaveLength(1);
  });

  it('writes the other value to search.inFiles.showResults when clicked', () => {
    config.set(settings('expanded'));
    renderFindInFilesPanel();
    fireEvent.click(toggle());
    expect(writes.patch).toHaveBeenCalledWith({ kind: 'settings' }, [
      { path: ['search', 'inFiles', 'showResults'], value: 'collapsed' },
    ]);
  });
});
