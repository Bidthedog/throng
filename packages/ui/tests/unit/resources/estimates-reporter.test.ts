/**
 * The renderer's estimates reporter (055 FR-024, R7, R9): what it sends to main, and when.
 *
 * Layer: unit — the reporter is a plain object over injected sources and an injected bridge, so the
 * rule under test (nothing is sent unless a detail subscription exists; the context only on change;
 * the estimates on every tick) needs no DOM. Where the sources get their figures is the registries'
 * own, and the figures' size is the calibration E2E's.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PanelEstimate, WorkspaceContext } from '@throng/ipc-contract';
import { createEstimatesReporter } from '../../../src/renderer/resources/estimates-reporter.js';

const CONTEXT: WorkspaceContext = {
  projects: [{ id: 'p1', name: 'Alpha', state: 'active', listOrder: 0 }],
  tabs: [{ id: 't1', projectId: 'p1', name: 'Build', subWorkspaceName: null, mounted: true }],
  panels: [{ id: 'n1', tabId: 't1', projectId: 'p1', name: 'Shell', kind: 'terminal', mounted: true }],
};
const ESTIMATE: PanelEstimate = { panelId: 'n1', target: 'buffers', source: 'renderer', pid: 4242, memoryBytes: 1_000_000 };

function harness(overrides: { context?: () => WorkspaceContext; estimates?: () => PanelEstimate[] } = {}) {
  const reportPanels = vi.fn();
  const context = vi.fn(overrides.context ?? (() => CONTEXT));
  const estimates = vi.fn(overrides.estimates ?? (() => [ESTIMATE]));
  const reporter = createEstimatesReporter({ reportPanels, readContext: context, readEstimates: estimates });
  return { reporter, reportPanels, context, estimates };
}

describe('with no detail subscription', () => {
  it('sends nothing at all, and reads nothing, on a tick or a context change', () => {
    const { reporter, reportPanels, context, estimates } = harness();

    reporter.tick();
    reporter.contextChanged();
    reporter.tick();

    expect(reportPanels).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(estimates).not.toHaveBeenCalled();
  });
});

describe('when a subscription starts', () => {
  it('sends the context and the estimates at once, so the first frame already has them', () => {
    const { reporter, reportPanels } = harness();

    reporter.setSubscribed(true);

    expect(reportPanels).toHaveBeenCalledTimes(1);
    expect(reportPanels).toHaveBeenCalledWith(CONTEXT, [ESTIMATE]);
  });

  it('does not send twice for a second "subscribed"', () => {
    const { reporter, reportPanels } = harness();
    reporter.setSubscribed(true);
    reporter.setSubscribed(true);
    expect(reportPanels).toHaveBeenCalledTimes(1);
  });
});

describe('while subscribed', () => {
  it('sends the estimates every tick and the context only when it changed', () => {
    let context = CONTEXT;
    const { reporter, reportPanels } = harness({ context: () => context });
    reporter.setSubscribed(true);
    reportPanels.mockClear();

    reporter.tick();
    reporter.tick();
    expect(reportPanels.mock.calls).toEqual([
      [null, [ESTIMATE]],
      [null, [ESTIMATE]],
    ]);

    reportPanels.mockClear();
    context = { ...CONTEXT, panels: [...CONTEXT.panels, { id: 'n2', tabId: 't1', projectId: 'p1', name: 'Notes', kind: 'editor', mounted: true }] };
    reporter.contextChanged();
    expect(reportPanels).toHaveBeenCalledTimes(1);
    expect(reportPanels.mock.calls[0]![0]).toEqual(context);

    // And then it is the last-sent context again: unchanged, so null.
    reportPanels.mockClear();
    reporter.tick();
    expect(reportPanels).toHaveBeenCalledWith(null, [ESTIMATE]);
  });

  it('treats a context that reads back equal as unchanged, so a re-render storm sends nothing new', () => {
    const { reporter, reportPanels } = harness({ context: () => JSON.parse(JSON.stringify(CONTEXT)) as WorkspaceContext });
    reporter.setSubscribed(true);
    reportPanels.mockClear();

    reporter.contextChanged();
    reporter.contextChanged();

    expect(reportPanels).not.toHaveBeenCalled();
  });
});

describe('when the subscription ends', () => {
  it('stops sending, and the next subscription sends the context afresh', () => {
    const { reporter, reportPanels } = harness();
    reporter.setSubscribed(true);
    reporter.setSubscribed(false);
    reportPanels.mockClear();

    reporter.tick();
    reporter.contextChanged();
    expect(reportPanels).not.toHaveBeenCalled();

    // Main discarded the old context when the last subscription went (FR-003), so it must be resent.
    reporter.setSubscribed(true);
    expect(reportPanels).toHaveBeenCalledWith(CONTEXT, [ESTIMATE]);
  });
});
