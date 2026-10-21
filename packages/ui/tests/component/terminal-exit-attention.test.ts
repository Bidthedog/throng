/**
 * A terminal that ended while marked (057 US6 AS3).
 *
 * The user looks at an exited, marked panel: the mark clears (main does that, on the focus report), and
 * 005's exit notice — the exit code and the output the shell left — must be exactly as it was. Clearing a
 * mark is not acknowledging the exit; the notice carries its own Dismiss, and the Panel's exit record
 * (`exit-store`) is what the returning form reads.
 *
 * Layer: component — the REAL `PanelPlaceholder` with a terminal whose exit is delivered by hand
 * (`useTerminal` stubbed, as `terminal-stopped-title.test.ts` does), the real `FocusReporter`, and the
 * attention store standing in for main. Which mark main clears and when is core's rule, proved there.
 *
 * ANTI-VACUITY CONTROL: have focusing the panel call `dismissPanelExit` and the "exit notice is
 * untouched" test fails; a mark that never rendered fails the first assertion of every test.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, collectPanels, type FocusReport, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { FocusReporter } from '../../src/renderer/attention/focus-reporter.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { clearPanelExit, getVisiblePanelExit } from '../../src/renderer/terminal/exit-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { makeMark } from './attention-fixtures.js';

const PROJECT = 'proj-exit';

const captured = vi.hoisted(() => ({
  terminal: null as null | { onExit: (e: { code: number | null; unexpected: boolean }) => void },
}));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { onExit: (e: { code: number | null; unexpected: boolean }) => void }) => {
    captured.terminal = opts;
  },
}));
vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

function bridge(): ThrongBridge {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  return {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load': return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save': return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list': return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list': return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list': return Promise.resolve({ categories: [] } as T);
        case 'panelName.claim': return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
        default: return Promise.resolve({} as T);
      }
    },
  };
}

type Ws = ReturnType<typeof useWorkspace>;
const held: { ws: Ws | null } = { ws: null };

function Host(): ReactElement | null {
  const ws = useWorkspace();
  held.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
    createElement(FocusReporter),
  );
}

let frames: Array<() => void> = [];
const flushFrame = (): void => {
  const run = frames;
  frames = [];
  act(() => {
    for (const f of run) f();
  });
};
let reportFocus: ReturnType<typeof vi.fn<(r: FocusReport) => void>>;
let panelId = '';

beforeEach(async () => {
  captured.terminal = null;
  frames = [];
  __resetAttentionStore();
  setActivePane('workspace');
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  reportFocus = vi.fn<(r: FocusReport) => void>();
  Reflect.set(window, 'throng', {
    attention: { reportFocus },
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn() },
    panels: { publishIdentities: () => {} },
  });
  const b = bridge();
  const services: Services = {
    bridge: b,
    projects: new ProjectsClient(b),
    workspace: new WorkspaceClient(b),
    subWorkspaces: new SubWorkspacesClient(b),
    documents: new DocumentClient(b),
    fileOpUndo: new FileOpUndoClient(b),
    panelNames: new PanelNameClient(b),
  };
  render(
    createElement(ServicesProvider, { services },
      createElement(ProjectsProvider, { client: services.projects },
        createElement(WorkspaceProvider, { client: services.workspace, activeProjectId: PROJECT },
          createElement(NotificationProvider, null,
            createElement(ConfirmProvider, null,
              createElement(ContextMenuProvider, null, createElement(Host))))))),
  );
  await waitFor(() => expect(held.ws?.layout).toBeTruthy());
  panelId = collectPanels((held.ws!.layout as WorkspaceLayout).tabs[0].root)[0].id;
  act(() => held.ws!.setPanelType(panelId, 'terminal', { flavourId: 'bash', flavourLabel: 'Git Bash' }));
  await waitFor(() => expect(captured.terminal, 'the terminal panel mounted').not.toBeNull());
});

afterEach(() => {
  clearPanelExit(panelId);
  __resetAttentionStore();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'throng');
});

describe('focusing an exited, marked panel (US6 AS3)', () => {
  it('leaves 005’s exit notice and exit record as they were while the mark clears', async () => {
    act(() => setAttentionMarks([makeMark(panelId, PROJECT, { kind: 'failed', signal: 'processExited', detail: '3' })]));
    expect(await screen.findByTestId(`attention-panel-${panelId}`)).toBeInTheDocument();

    act(() => captured.terminal!.onExit({ code: 3, unexpected: true }));
    const noticeBefore = await screen.findByTestId(`panel-exit-${panelId}`);
    const exitBefore = getVisiblePanelExit(panelId);
    expect(exitBefore?.code).toBe(3);

    // The user looks at the panel: keyboard focus lands inside it, and this window says so.
    const host = document.querySelector<HTMLElement>(`[data-panel-host="${panelId}"]`)!;
    const target = host.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]') ?? host;
    if (target === host) host.tabIndex = -1;
    act(() => target.focus());
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].focusedPanelId).toBe(panelId);

    // Main answers a focus by clearing the mark.
    act(() => setAttentionMarks([]));
    expect(screen.queryByTestId(`attention-panel-${panelId}`)).toBeNull();

    // …and the exit is exactly as it was: the same notice element, the same record, still not dismissed.
    expect(screen.getByTestId(`panel-exit-${panelId}`)).toBe(noticeBefore);
    expect(getVisiblePanelExit(panelId)).toEqual(exitBefore);
  });
});
