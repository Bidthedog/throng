/**
 * 076 FR-004, research R4 — `commitPanelConfig`: a panel-config change saved AT ONCE, whose promise says whether
 * the write landed. The terminal toggles write through it, because the daemon reads the saved layout to decide
 * whether a panel is ignored, and because FR-004 needs the outcome of the write to report a failure.
 *
 * Layer: component — the workspace store is a React provider; its save path is observable only mounted, over a
 * bridge whose `workspace.save` the test answers.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const p: Panel = {
    type: 'panel',
    id: 'p1',
    originProjectId: PROJECT,
    title: 'p1',
    kind: 'terminal',
    config: { flavourId: 'cmd', shellArguments: '' },
  };
  l.tabs[0].root = p;
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const configOf = (mw: MountedWorkspace): Record<string, unknown> | undefined =>
  collectPanels(mw.ws().layout!.tabs[0].root).find((p) => p.id === 'p1')?.config as Record<string, unknown>;

describe('commitPanelConfig (076 FR-004)', () => {
  it('applies the patch and saves at once, with no autosave debounce, resolving true', async () => {
    m = await mountWorkspace(layout());
    const mw = m;
    let pending!: Promise<boolean>;
    // Not awaited inside `act`: act holds state updates until its scope ends, and the commit resolves only
    // once its update has run.
    act(() => {
      pending = mw.ws().commitPanelConfig('p1', { notifications: true });
    });
    const ok = await pending;
    expect(ok).toBe(true);
    expect(configOf(mw)?.notifications).toBe(true);
    // Saved by the commit itself: the autosave debounce (400 ms) has not had time to fire.
    const saved = mw.saves.mock.calls.at(-1)?.[0] as { layout: WorkspaceLayout };
    const panel = collectPanels(saved.layout.tabs[0].root).find((p) => p.id === 'p1');
    expect((panel?.config as Record<string, unknown>).notifications).toBe(true);
  });

  it('resolves false when the save fails', async () => {
    m = await mountWorkspace(layout(), { save: () => Promise.reject(new Error('disk full')) });
    const mw = m;
    let pending!: Promise<boolean>;
    // Not awaited inside `act`: act holds state updates until its scope ends, and the commit resolves only
    // once its update has run.
    act(() => {
      pending = mw.ws().commitPanelConfig('p1', { rememberCommand: true });
    });
    const ok = await pending;
    expect(ok).toBe(false);
  });

  it('resolves true, and saves nothing, for a panel it cannot find', async () => {
    m = await mountWorkspace(layout());
    const mw = m;
    const before = mw.saves.mock.calls.length;
    let pending!: Promise<boolean>;
    // Not awaited inside `act`: act holds state updates until its scope ends, and the commit resolves only
    // once its update has run.
    act(() => {
      pending = mw.ws().commitPanelConfig('nope', { rememberCommand: true });
    });
    const ok = await pending;
    expect(ok).toBe(true);
    expect(mw.saves.mock.calls.length).toBe(before);
  });
});
