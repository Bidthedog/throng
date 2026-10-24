/**
 * The route for an action on a tab or panel that lives in ANOTHER window (055 FR-063, T076): main sends
 * it to the window holding the tab or panel, and that window runs its own destroy flow — keeping its own
 * confirmations.
 *
 * Layer: component — the real listener over the real registries; the bridge is faked. Which window main
 * picks is main's (`resources-ipc` tests).
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EstimatesReporterMount, UnloadRouteMount } from '../../../src/renderer/resources/use-estimates-reporter.js';
import { __resetMonitorStore, setStatusItemElement } from '../../../src/renderer/resources/monitor-store.js';
import { __resetPanelDestroy, registerPanelDestroy } from '../../../src/renderer/workspace/panel-destroy.js';
import { __resetTabDestroy, registerTabDestroy } from '../../../src/renderer/workspace/tab-destroy.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import type { WorkspaceLayout } from '@throng/core';
import {
  navigateToPlace,
  registerAttentionNavigation,
  registerPlaceNavigation,
  type NavigationHost,
} from '../../../src/renderer/attention/attention-navigation.js';

const unload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/sidebar/use-unload-project.js', () => ({ useUnloadProject: () => unload }));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  unload.mockClear();
  __resetTabDestroy();
  __resetPanelDestroy();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetTabDestroy();
  __resetPanelDestroy();
});

describe('an action routed here by another window', () => {
  it('runs this window’s own Destroy Tab for a tab it holds', () => {
    const destroy = vi.fn();
    registerTabDestroy('t9', destroy);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'destroyTab', id: 't9' });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('runs this window’s own Destroy Panel for a panel it holds', () => {
    const destroy = vi.fn();
    registerPanelDestroy('n9', destroy);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'destroyPanel', id: 'n9' });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an id this window does not hold', () => {
    const other = vi.fn();
    registerTabDestroy('t1', other);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'destroyTab', id: 'gone' });

    expect(other).not.toHaveBeenCalled();
  });

  it('does not mistake an Unload Project for a Destroy Panel (it is the main window’s, not a panel’s)', () => {
    const destroyPanel = vi.fn();
    const destroyTab = vi.fn();
    registerPanelDestroy('p1', destroyPanel);
    registerTabDestroy('p1', destroyTab);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'unloadProject', id: 'p1', name: 'Alpha' });

    expect(destroyPanel).not.toHaveBeenCalled();
    expect(destroyTab).not.toHaveBeenCalled();
  });

  it('stops listening when the window’s tree unmounts', () => {
    const destroy = vi.fn();
    registerTabDestroy('t9', destroy);
    const view = render(createElement(EstimatesReporterMount));
    view.unmount();

    bridge.fireAction({ action: 'destroyTab', id: 't9' });

    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('Unload Project routed to the main window (FR-086)', () => {
  it('runs the shared unload command with the variant, and ignores a destroy', () => {
    render(createElement(UnloadRouteMount));

    bridge.fireAction({ action: 'unloadProject', id: 'p1', name: 'Alpha', variant: 'endTerminals' });
    expect(unload).toHaveBeenLastCalledWith({ id: 'p1', name: 'Alpha' }, 'endTerminals');

    bridge.fireAction({ action: 'unloadProject', id: 'p2', name: 'Beta' });
    expect(unload).toHaveBeenLastCalledWith({ id: 'p2', name: 'Beta' }, undefined);

    unload.mockClear();
    bridge.fireAction({ action: 'destroyTab', id: 't1' });
    expect(unload).not.toHaveBeenCalled();
  });

  it('stops listening when the window’s tree unmounts', () => {
    const view = render(createElement(UnloadRouteMount));
    view.unmount();

    bridge.fireAction({ action: 'unloadProject', id: 'p1', name: 'Alpha' });

    expect(unload).not.toHaveBeenCalled();
  });
});

describe('where the monitor should shrink to (FR-085)', () => {
  afterEach(() => __resetMonitorStore());

  it('the main window answers with the status-bar figures’ rectangle, in CSS px', () => {
    const item = document.createElement('button');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({ x: 600, y: 900, width: 80, height: 20 } as DOMRect);
    setStatusItemElement(item);
    render(createElement(EstimatesReporterMount));

    expect(bridge.askStatusRect()).toEqual({ x: 600, y: 900, width: 80, height: 20 });
  });

  it('a window with no status-bar item (a sub-workspace) answers null', () => {
    render(createElement(EstimatesReporterMount));

    expect(bridge.askStatusRect()).toBeNull();
  });

  it('stops answering when the window’s tree unmounts', () => {
    const view = render(createElement(EstimatesReporterMount));
    view.unmount();

    expect(bridge.askStatusRect()).toBeUndefined();
  });
});

describe('Activate routed here (FR-110, US2 scenario 30)', () => {
  afterEach(() => {
    registerAttentionNavigation(null);
    registerPlaceNavigation(null);
  });

  it('a panel: this window goes to it — project, tab and the panel focused — as a toast’s link does', () => {
    const toPanel = vi.fn(() => Promise.resolve(true));
    registerAttentionNavigation(toPanel);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'activate', projectId: 'p1', tabId: 't1', panelId: 'n1' });

    expect(toPanel).toHaveBeenCalledWith({ projectId: 'p1', panelId: 'n1' });
  });

  it('a tab or a project: this window switches project and selects the tab', () => {
    const toPlace = vi.fn(() => Promise.resolve(true));
    registerPlaceNavigation(toPlace);
    render(createElement(EstimatesReporterMount));

    bridge.fireAction({ action: 'activate', projectId: 'p1', tabId: 't1' });
    bridge.fireAction({ action: 'activate', projectId: 'p2' });

    expect(toPlace.mock.calls).toEqual([[{ projectId: 'p1', tabId: 't1' }], [{ projectId: 'p2' }]]);
  });
});

describe('going to a tab or a project (navigateToPlace, FR-110)', () => {
  const layout = (projectId: string, tabIds: string[]): WorkspaceLayout => ({
    projectId,
    schemaVersion: 1,
    activeTabId: tabIds[0]!,
    tabs: tabIds.map((id) => ({ id, title: id, root: { type: 'panel', id: `n-${id}`, originProjectId: projectId, title: 'P' } })),
  });

  function host(start: WorkspaceLayout | null, opts: { canSwitch?: boolean; after?: WorkspaceLayout | null } = {}) {
    const calls: string[] = [];
    let current = start;
    const h: NavigationHost = {
      layout: () => current,
      ws: () => ({ setActiveTab: (id: string) => void calls.push(`tab:${id}`) }) as unknown as ReturnType<NavigationHost['ws']>,
      switchProject:
        opts.canSwitch === false
          ? null
          : (id) => {
              calls.push(`switch:${id}`);
              current = opts.after === undefined ? current : opts.after;
              return Promise.resolve();
            },
      awaitLayout: (match) => Promise.resolve(current !== null && match(current) ? current : null),
    };
    return { h, calls };
  }

  it('selects a tab this window holds, with no project switch', async () => {
    const { h, calls } = host(layout('p1', ['t1', 't2']));
    expect(await navigateToPlace(h, { projectId: 'p1', tabId: 't2' })).toBe(true);
    expect(calls).toEqual(['tab:t2']);
  });

  it('switches project FIRST for a tab of another project, then selects it once it is there', async () => {
    const { h, calls } = host(layout('p1', ['t1']), { after: layout('p2', ['t8', 't9']) });
    expect(await navigateToPlace(h, { projectId: 'p2', tabId: 't9' })).toBe(true);
    expect(calls).toEqual(['switch:p2', 'tab:t9']);
  });

  it('switches to a project alone', async () => {
    const { h, calls } = host(layout('p1', ['t1']), { after: layout('p2', ['t8']) });
    expect(await navigateToPlace(h, { projectId: 'p2' })).toBe(true);
    expect(calls).toEqual(['switch:p2']);
  });

  it('a sub-workspace window selects its tab without a project switch, and cannot switch for one it lacks', async () => {
    const { h, calls } = host(layout('sub', ['t1', 't2']), { canSwitch: false });
    expect(await navigateToPlace(h, { projectId: 'p1', tabId: 't2' })).toBe(true);
    expect(await navigateToPlace(h, { projectId: 'p1', tabId: 'gone' })).toBe(false);
    expect(calls).toEqual(['tab:t2']);
  });

  it('answers false when the tab never appears', async () => {
    const { h } = host(layout('p1', ['t1']), { after: layout('p2', ['t8']) });
    expect(await navigateToPlace(h, { projectId: 'p2', tabId: 'missing' })).toBe(false);
  });
});
