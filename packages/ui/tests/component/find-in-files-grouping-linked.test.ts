/**
 * 060 FR-046 — a panel's grouping and `search.inFiles.defaultGrouping` are one setting. Choosing a
 * grouping in a panel writes the preference, and every open panel follows a change to it.
 *
 * Layer: component — the panel's toolbar and its subscription to the settings store are what is
 * under test; jsdom renders both, and the write is observed at `writeConfigPatch`.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { DEFAULT_APP_SETTINGS, type AppSettings, type FindInFilesGrouping } from '@throng/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
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

function settings(defaultGrouping: FindInFilesGrouping): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, defaultGrouping },
    },
  };
}

const pressed = (panelId: string, grouping: FindInFilesGrouping): string | null =>
  screen.getByTestId(`fif-grouping-${grouping}-${panelId}`).getAttribute('aria-pressed');

beforeEach(() => {
  config.set(settings('file'));
  writes.patch.mockClear();
  __resetFindInFilesState();
  installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the grouping preference and the panel are linked (060 FR-046)', () => {
  it('writes the preference when a grouping is chosen in a panel, and regroups that panel at once', () => {
    renderFindInFilesPanel();

    fireEvent.click(screen.getByTestId(`fif-grouping-folderTree-${PANEL_ID}`));

    expect(writes.patch).toHaveBeenCalledWith({ kind: 'settings' }, [
      { path: ['search', 'inFiles', 'defaultGrouping'], value: 'folderTree' },
    ]);
    expect(pressed(PANEL_ID, 'folderTree')).toBe('true');
  });

  it('moves every open panel when the preference changes', () => {
    renderFindInFilesPanel();
    renderFindInFilesPanel({ panelId: 'p2' });

    act(() => config.set(settings('fileAndFolder')));

    expect(pressed(PANEL_ID, 'fileAndFolder')).toBe('true');
    expect(pressed('p2', 'fileAndFolder')).toBe('true');
  });

  it('writes nothing when the grouping chosen is already the preference', () => {
    renderFindInFilesPanel();
    fireEvent.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));
    expect(writes.patch).not.toHaveBeenCalled();
  });
});
