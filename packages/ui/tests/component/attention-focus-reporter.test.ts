import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, collectPanels, type FocusReport, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { currentPanelTitle } from '../../src/renderer/workspace/use-panel-display-names.js';
import { FocusReporter } from '../../src/renderer/attention/focus-reporter.js';

/**
 * What this window tells main about itself (057 US1, FR-004/FR-005; research R5; contracts/app-attention.md
 * `throng:attention:focus`).
 *
 * Main cannot know a panel is attended unless a renderer says so, and it must be told cheaply: the
 * report is coalesced to ONE per animation frame however many things changed in it (Principle XII — a
 * focus change is an input path). Layer: component — it needs a DOM, a focus model and the real
 * workspace store, and no window: `document.activeElement` is the whole of "keyboard focus" here.
 *
 * ANTI-VACUITY CONTROL: make `FocusReporter` send on every change instead of on the frame and the
 * coalescing test fails; send `focusedPanelId` from the active panel instead of from the DOM and the
 * Files-pane test fails.
 */

const PROJECT = 'proj-1';

function fakeDaemon() {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the focus reporter: ${method}`));
      }
    },
  };
  return bridge;
}

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };
const live = (): Ws => captured.ws as Ws;

/** Panels as the host markers the reporter reads, plus a Files pane control outside every panel. */
function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const layout = ws.layout;
  if (!layout) return null;
  const panels = layout.tabs.flatMap((t) => collectPanels(t.root));
  return createElement(
    'div',
    null,
    createElement('button', { 'data-testid': 'files-control' }, 'files'),
    ...panels.map((p) =>
      createElement(
        'div',
        { key: p.id, 'data-panel-host': p.id },
        createElement('button', { 'data-testid': `inside-${p.id}` }, 'inside'),
      ),
    ),
    createElement(FocusReporter),
  );
}

/** requestAnimationFrame as a queue the test drains, so "one per frame" is observable. */
let frames: Array<() => void> = [];
function flushFrame(): void {
  const run = frames;
  frames = [];
  act(() => {
    for (const f of run) f();
  });
}

let reportFocus: ReturnType<typeof vi.fn<(r: FocusReport) => void>>;

beforeEach(() => {
  captured.ws = null;
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  reportFocus = vi.fn<(r: FocusReport) => void>();
  Reflect.set(window, 'throng', { attention: { reportFocus }, panels: { publishIdentities: () => {} } });
  setActivePane('workspace');
  const bridge = fakeDaemon();
  render(
    createElement(
      WorkspaceProvider,
      { client: new WorkspaceClient(bridge), activeProjectId: PROJECT },
      createElement(Host),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'throng');
  setActivePane('workspace');
});

async function settled(): Promise<FocusReport> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  // The report is sent from a frame, and frames here run only when flushed. The reporter can schedule its
  // frame after any one flush (a render after the layout lands), so flush on every poll, not once.
  await waitFor(() => {
    flushFrame();
    expect(reportFocus).toHaveBeenCalled();
  });
  flushFrame();
  return reportFocus.mock.calls.at(-1)![0];
}

describe('the focus report (057 R5, contracts/app-attention.md)', () => {
  it('names the panels this window hosts, with their live titles and projects', async () => {
    const report = await settled();
    const layout = live().layout as WorkspaceLayout;
    const panel = collectPanels(layout.tabs[0].root)[0];
    expect(report.hostedPanels).toEqual([
      { panelId: panel.id, projectId: PROJECT, title: currentPanelTitle(panel), tabTitle: layout.tabs[0].title }, // FR-100
    ]);
  });

  // FR-095: being the active panel is not focus, so nothing reads an active-panel list any more and the
  // report no longer carries one (a tab switch alone must not cost an IPC message).
  it('does not carry a list of active panels', async () => {
    const report = await settled();
    expect(report).not.toHaveProperty('activePanelIds');
  });

  it('reports the panel holding keyboard focus, and null once focus is in the Files pane (FR-004)', async () => {
    await settled();
    const panelId = collectPanels((live().layout as WorkspaceLayout).tabs[0].root)[0].id;

    const inside = document.querySelector<HTMLElement>(`[data-testid="inside-${panelId}"]`)!;
    act(() => inside.focus());
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].focusedPanelId).toBe(panelId);

    // The Files pane: the active pane says so, and DOM focus is outside every panel.
    act(() => {
      setActivePane('files');
      document.querySelector<HTMLElement>('[data-testid="files-control"]')!.focus();
    });
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].focusedPanelId).toBeNull();
  });

  it('reports null for a panel whose pane is not the workspace, even with DOM focus inside it', async () => {
    await settled();
    const panelId = collectPanels((live().layout as WorkspaceLayout).tabs[0].root)[0].id;
    act(() => {
      setActivePane('projects');
      document.querySelector<HTMLElement>(`[data-testid="inside-${panelId}"]`)!.focus();
    });
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].focusedPanelId).toBeNull();
  });

  it('follows the window losing and regaining focus', async () => {
    await settled();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].windowFocused).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    flushFrame();
    expect(reportFocus.mock.calls.at(-1)![0].windowFocused).toBe(true);
  });

  it('sends ONE report per frame however many things changed in it (Principle XII)', async () => {
    await settled();
    const panelId = collectPanels((live().layout as WorkspaceLayout).tabs[0].root)[0].id;
    reportFocus.mockClear();

    act(() => {
      window.dispatchEvent(new Event('blur'));
      document.querySelector<HTMLElement>(`[data-testid="inside-${panelId}"]`)!.focus();
      setActivePane('files');
      window.dispatchEvent(new Event('focus'));
    });
    expect(reportFocus).not.toHaveBeenCalled(); // nothing is sent until the frame
    flushFrame();
    expect(reportFocus).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when nothing the report carries has changed', async () => {
    await settled();
    // Reach the focused state first (jsdom's initial `document.hasFocus()` is its own business).
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    flushFrame();
    reportFocus.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    flushFrame();
    expect(reportFocus).not.toHaveBeenCalled();
  });
});
