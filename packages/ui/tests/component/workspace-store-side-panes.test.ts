/**
 * 067 T078 (FR-056 to FR-060) — each project remembers its own side panes.
 *
 * The state lives with the project's layout (FR-060), so `setSidePanes` writes `layout.sidePanes` through
 * the ordinary debounced save. A layout with nothing stored reads as both expanded (FR-057), and a write
 * happens only on a user's toggle (FR-058) — never to record what the window width did, which is why the
 * op ignores a patch that changes nothing. The no-project state keeps its own flags (FR-059), so the
 * preference function falls back to them whenever no layout is loaded.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, effectiveSidePanes, type WorkspaceLayout } from '@throng/core';
import { settleLayoutSaves } from '../../src/renderer/state/layout-saves.js';
import { panePrefs, type PanePref, type SidePanesSync } from '../../src/renderer/panes/side-pane-prefs.js';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';

const PROJECT = 'proj-panes';
let m: MountedTabGroup | undefined;

const settle = async (): Promise<void> => {
  await act(async () => {
    await settleLayoutSaves();
  });
};

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('setSidePanes (FR-056, FR-058, FR-060)', () => {
  it('a fresh layout reads as both expanded and stores nothing (FR-057)', async () => {
    m = mountTabGroup(createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }));
    await screen.findByTestId('panel-p1');
    expect(m.ws().layout!.sidePanes).toBeUndefined();
    expect(effectiveSidePanes(m.ws().layout!)).toEqual({ projects: true, files: true });
  });

  it('records one pane without touching the other, and saves it with the layout', async () => {
    m = mountTabGroup(createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }));
    await screen.findByTestId('panel-p1');
    await settle();
    const before = m.saves.mock.calls.length;
    act(() => m!.ws().setSidePanes({ files: false }));
    expect(m.ws().layout!.sidePanes).toEqual({ projects: true, files: false });
    await settle();
    expect(m.saves.mock.calls.length).toBe(before + 1);
    expect(JSON.stringify(m.saves.mock.calls.at(-1)![0])).toContain('"sidePanes":{"projects":true,"files":false}');
  });

  it('restores what the layout was saved with', async () => {
    const saved: WorkspaceLayout = {
      ...createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }),
      sidePanes: { projects: false, files: true },
    };
    m = mountTabGroup(saved);
    await screen.findByTestId('panel-p1');
    expect(effectiveSidePanes(m.ws().layout!)).toEqual({ projects: false, files: true });
  });

  it('writes nothing for a patch that changes nothing, so a derived state is never stored (FR-058)', async () => {
    m = mountTabGroup(createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }));
    await screen.findByTestId('panel-p1');
    await settle();
    const before = m.saves.mock.calls.length;
    const held = m.ws().layout;
    act(() => m!.ws().setSidePanes({ projects: true }));
    act(() => m!.ws().setSidePanes({}));
    await settle();
    expect(m.ws().layout).toBe(held);
    expect(m.saves.mock.calls.length).toBe(before);
  });
});

describe('panePrefs: which store answers (FR-059)', () => {
  const pref = (value: boolean): PanePref & { set: ReturnType<typeof vi.fn> } => ({ value, set: vi.fn() });

  it('uses the persisted flags when no layout is loaded — the no-project state is unchanged', () => {
    const fallback = { projects: pref(false), files: pref(true) };
    const sync: SidePanesSync = { panes: null, set: vi.fn() };
    const prefs = panePrefs(sync, fallback);
    expect(prefs.projects.value).toBe(false);
    expect(prefs.files.value).toBe(true);
    prefs.files.set(false);
    expect(fallback.files.set).toHaveBeenCalledWith(false);
    expect(sync.set).not.toHaveBeenCalled();
  });

  it('uses the project’s panes when a layout is loaded, and writes them back through the layout', () => {
    const fallback = { projects: pref(true), files: pref(true) };
    const sync: SidePanesSync = { panes: { projects: true, files: false }, set: vi.fn() };
    const prefs = panePrefs(sync, fallback);
    expect(prefs.files.value).toBe(false);
    prefs.projects.set(false);
    expect(sync.set).toHaveBeenCalledWith({ projects: false });
    expect(fallback.projects.set).not.toHaveBeenCalled();
  });
});
