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
