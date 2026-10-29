/**
 * The Resource Monitor chord, through the real window dispatcher (055 FR-056, FR-086): it asks main to
 * open the monitor window — or bring it forward — and never closes it; and nothing else is suppressed
 * while the monitor is up, because it is a window of its own and no longer an exclusive modal (the
 * retired FR-050).
 *
 * ANTI-VACUITY: restore the old `isMonitorOpen()` gate at the top of the dispatcher's `onKeyDown` and the
 * "other chords still work" test goes red alone; point the chord back at a toggle and "never closes" goes
 * red alone.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../../src/renderer/app.js';
import { setActivePane } from '../../../src/renderer/workspace/active-pane.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { mountWorkspace, type MountedWorkspace } from '../helpers/mount-workspace.js';

const PROJECT = 'proj';
const editor = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id, kind: 'editor', config: { filePath: `D:/proj/${id}.ts` } });

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor('p1'), editor('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const FOCUS_RIGHT = { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true };
const OPEN_MONITOR = { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true, altKey: true };

let m: MountedWorkspace | undefined;
let bridge: ResourcesBridge;

async function mountWindow(): Promise<void> {
  bridge = installResourcesBridge(null);
  setActivePane('workspace');
  m = await mountWorkspace(twoPanels(), {
    extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {}, onRevealLeft: () => {}, onRevealRight: () => {} })],
    throng: { resources: (window as unknown as { throng: { resources: unknown } }).throng.resources },
  });
}
const active = (): string | undefined => m!.ws().layout!.tabs[0].activePanelId;

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('the Resource Monitor chord', () => {
  it('asks main to open the monitor window, and opens nothing in this one', async () => {
    await mountWindow();

    act(() => void fireEvent.keyDown(document.body, OPEN_MONITOR));

    expect(bridge.opens()).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks again on a second press — it brings an open monitor forward and never closes it', async () => {
    await mountWindow();

    act(() => void fireEvent.keyDown(document.body, OPEN_MONITOR));
    act(() => void fireEvent.keyDown(document.body, OPEN_MONITOR));

    expect(bridge.opens()).toBe(2);
  });

  it('leaves every other window chord live afterwards: nothing is suppressed behind a window', async () => {
    await mountWindow();
    act(() => void fireEvent.keyDown(document.body, OPEN_MONITOR));

    act(() => void fireEvent.keyDown(document.body, FOCUS_RIGHT));

    expect(active()).toBe('p2');
  });
});
