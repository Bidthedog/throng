/**
 * 080 FR-010 — F1 (`help.open`) opens the guide's start page from the window dispatcher, in every
 * scope except a terminal, where it reaches the program running in it.
 *
 * Pressed through the real `KeybindingsHandler` (`app.tsx`), which mounts the one window dispatcher.
 * `window-chords.ts` names this file as `help.open`'s coverage: F1 is a function key, so the manifest
 * guard (`window-chord-manifest.test.ts`) discovers it and wants a press that carries it.
 *
 * What stays elsewhere: that a real shell receives F1 is the pty's; this proves the window does not
 * take it (the key is not consumed, no browser is opened).
 */
import { act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, createDefaultLayout, startPageUrl, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;

const panel = (kind: 'editor' | 'terminal'): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: PROJECT,
  title: 'p1',
  kind,
  config: kind === 'editor' ? { filePath: 'D:/proj/a.ts' } : {},
});

function layoutOf(kind: 'editor' | 'terminal'): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = panel(kind);
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const openHelp = vi.fn();

async function mount(kind: 'editor' | 'terminal', throng: Record<string, unknown> = {}): Promise<void> {
  m = await mountWorkspace(layoutOf(kind), {
    extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {}, onRevealLeft: () => {}, onRevealRight: () => {} })],
    throng: { openHelp, ...throng },
  });
}

/** Returns false when the window consumed the key (default prevented). */
function pressF1(): boolean {
  let taken = true;
  act(() => {
    taken = fireEvent.keyDown(document.body, { key: 'F1', code: 'F1' });
  });
  return taken;
}

beforeEach(() => {
  openHelp.mockClear();
  setActivePane('workspace');
});

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('help.open — F1 from the window dispatcher (FR-010)', () => {
  it('opens the start page once, and consumes the key, over an editor', async () => {
    await mount('editor');
    expect(pressF1()).toBe(false);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(startPageUrl(HELP_APP_BASE_URL));
  });

  it('opens it from a side pane too — the scope is every surface but a terminal', async () => {
    await mount('editor');
    act(() => setActivePane('files'));
    pressF1();
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(startPageUrl(HELP_APP_BASE_URL));
  });

  it('does nothing over a terminal: the key is not consumed and no browser is opened', async () => {
    await mount('terminal');
    expect(pressF1()).toBe(true);
    expect(openHelp).not.toHaveBeenCalled();
  });
});
