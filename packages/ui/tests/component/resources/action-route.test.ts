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
import { EstimatesReporterMount } from '../../../src/renderer/resources/use-estimates-reporter.js';
import { __resetPanelDestroy, registerPanelDestroy } from '../../../src/renderer/workspace/panel-destroy.js';
import { __resetTabDestroy, registerTabDestroy } from '../../../src/renderer/workspace/tab-destroy.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
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

  it('stops listening when the window’s tree unmounts', () => {
    const destroy = vi.fn();
    registerTabDestroy('t9', destroy);
    const view = render(createElement(EstimatesReporterMount));
    view.unmount();

    bridge.fireAction({ action: 'destroyTab', id: 't9' });

    expect(destroy).not.toHaveBeenCalled();
  });
});
