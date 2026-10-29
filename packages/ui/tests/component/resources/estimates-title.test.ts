/**
 * The monitor names a panel by the title its own header shows, and follows it as it changes (055 D2,
 * FR-020, FR-082, research R19). The reporter used to re-report only on layout, project and active
 * changes, so a terminal whose shell retitled itself kept its old name in the monitor until something
 * else moved.
 *
 * Layer: component — the real reporter hook over the real title store; the bridge is faked, and the
 * workspace store is stood in by one fixed layout (what the hook reads from it is the layout alone).
 */
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLayout } from '@throng/core';
import { EstimatesReporterMount } from '../../../src/renderer/resources/use-estimates-reporter.js';
import { clearTerminalTitle, setTerminalTitle } from '../../../src/renderer/terminal/title-store.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';

const LAYOUT: WorkspaceLayout = {
  projectId: 'p1',
  schemaVersion: 1,
  activeTabId: 't1',
  tabs: [{ id: 't1', title: 'Tab 1', root: { type: 'panel', id: 'n1', originProjectId: 'p1', title: 'Panel 1', kind: 'terminal', config: { flavourLabel: 'PowerShell' } } }],
};

vi.mock('../../../src/renderer/state/workspace-store.js', () => ({ useWorkspaceOptional: () => ({ layout: LAYOUT }) }));
vi.mock('../../../src/renderer/sidebar/use-unload-project.js', () => ({ useUnloadProject: () => () => undefined }));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  bridge.setDemand(true);
});
afterEach(() => {
  clearTerminalTitle('n1');
  Reflect.deleteProperty(window, 'throng');
});

const lastName = (): string | undefined =>
  bridge.reports.filter((r) => r.context !== null).at(-1)?.context?.panels.find((p) => p.id === 'n1')?.name;

describe('a terminal’s name in the monitor (D2)', () => {
  it('is reported again when the terminal’s title changes', async () => {
    render(createElement(EstimatesReporterMount));
    await act(async () => {
      await Promise.resolve();
    });
    expect(lastName()).toBe('PowerShell');

    act(() => setTerminalTitle('n1', 'claude — fixing the build'));

    expect(lastName()).toBe('claude — fixing the build');
  });
});
