/**
 * Acting on a node from the Resource Monitor (055 FR-062 – FR-066): the context menu and the detail
 * pane's action row, the kill confirmations, and the one notice a failure raises.
 *
 * Layer: component — the real breakdown, detail pane, confirmation dialog, context menu and settings
 * store over the real session; the bridge is faked. Unload Project, Destroy Tab and Destroy Panel are the
 * SHARED commands (`use-unload-project`, `tab-destroy`, `panel-destroy`), which are replaced or
 * registered here as spies: that each does what it does is their own tests'. What is claimed here is that
 * the monitor reaches them, offers exactly `actionsFor`'s rows, asks `confirmations.killProcesses` the
 * way every other confirmation is asked, and says so plainly when a kill fails.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME, type ResourceNode } from '@throng/core';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { DetailPane } from '../../../src/renderer/resources/detail-pane.js';
import { MonitorNotice } from '../../../src/renderer/resources/monitor-notice.js';
import { NodeActionsProvider } from '../../../src/renderer/resources/node-actions.js';
import { __resetSession, focusOn, ingestFrame, setSelection, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { __resetPanelDestroy, registerPanelDestroy } from '../../../src/renderer/workspace/panel-destroy.js';
import { __resetTabDestroy, registerTabDestroy } from '../../../src/renderer/workspace/tab-destroy.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { MIB, frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

const unload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/sidebar/use-unload-project.js', () => ({ useUnloadProject: () => unload }));

let bridge: ResourcesBridge;

async function mount(confirmations: Record<string, string> = {}): Promise<void> {
  Reflect.set(window.throng as object, 'config', {
    get: () => Promise.resolve({ settings: { confirmations, projects: { unloadTerminalAction: 'keepRunning' } }, theme: THRONG_THEME }),
    onChange: () => () => {},
  });
  // The settings arrive asynchronously; an interaction before they do would read the shipped defaults.
  await act(async () => {
    renderTree();
  });
}

function renderTree(): void {
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ContextMenuProvider,
          null,
          createElement(NodeActionsProvider, null, createElement(Fragment, null, createElement(Breakdown), createElement(DetailPane), createElement(MonitorNotice))),
        ),
      ),
    ),
  );
}

beforeEach(() => {
  bridge = installResourcesBridge(null);
  __resetSession();
  __resetTabDestroy();
  __resetPanelDestroy();
  unload.mockClear();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
  __resetTabDestroy();
  __resetPanelDestroy();
});

const feed = (root: ResourceNode, tick = 1): void => {
  act(() => ingestFrame(frame(tick, root)));
};
const PROCESS_PATH = ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'];
const row = (id: string): HTMLElement => screen.getByTestId(`breakdown-row-${id}`);
const menuLabels = (): string[] => within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.getAttribute('data-testid') ?? '');
const rightClick = (id: string): void => {
  fireEvent.contextMenu(row(id));
};
const keyOf = (id: string): string => {
  const find = (n: ResourceNode): ResourceNode | undefined => (n.id === id ? n : n.children.map(find).find(Boolean));
  return find(sampleHierarchy())!.process!.key;
};

describe('the context menu offers exactly what a node can do (FR-063)', () => {
  it('a process: Kill Process, and Kill All Below when something live runs under it — each with its icon token', async () => {
    feed(sampleHierarchy());
    await mount();
    act(() => focusOn(PROCESS_PATH));

    // A leaf has nothing below it: its Kill All Below would be Kill Process again, so it is not offered.
    rightClick('x:300:1');
    expect(menuLabels()).toEqual(['menu-item-Kill Process']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    rightClick('x:200:1');
    expect(menuLabels()).toEqual(['menu-item-Kill Process', 'menu-item-Kill All Below']);
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(screen.getByTestId('menu-item-Kill Process')).toHaveTextContent(icons.resourceKill!);
    expect(screen.getByTestId('menu-item-Kill All Below')).toHaveTextContent(icons.resourceKillBelow!);
  });

  it('a terminal panel: Destroy Panel and Kill All Below; an editor panel: Destroy Panel only', async () => {
    feed(sampleHierarchy());
    registerPanelDestroy('n1', vi.fn());
    registerPanelDestroy('n2', vi.fn());
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));

    rightClick('n:n1');
    expect(menuLabels()).toEqual(['menu-item-Destroy Panel', 'menu-item-Kill All Below']);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    rightClick('n:n2');
    expect(menuLabels()).toEqual(['menu-item-Destroy Panel']);
  });

  it('a project: both Unload rows, and Kill All Below when it holds a live process', async () => {
    feed(sampleHierarchy());
    await mount();

    rightClick('p:p1');

    // Sections draw in the shared order (destroy before viewState), as every other menu does.
    expect(menuLabels()).toEqual(['menu-item-Kill All Below', 'menu-item-Unload Project', 'menu-item-Unload Project and End Terminals']);
  });

  it('an unloaded project offers nothing to unload', async () => {
    feed(sampleHierarchy());
    await mount();
    rightClick('p:p2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('throng’s own nodes have no menu at all — absent, not disabled', async () => {
    feed(sampleHierarchy());
    await mount();
    for (const id of ['c:ui', 'c:daemon', 'c:helpers']) {
      rightClick(id);
      expect(screen.queryByRole('menu'), `${id} opened a menu`).toBeNull();
    }
    act(() => focusOn(['root', 'c:ui']));
    rightClick('x:10:1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('an ended process has no menu', async () => {
    feed(sampleHierarchy(), 1);
    feed(sampleHierarchy({ withNode: false }), 2);
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1', 'x:200:1']));
    rightClick('x:300:1');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the shared commands (FR-063)', () => {
  it('Unload Project runs the configured default; the other row runs its opposite', async () => {
    feed(sampleHierarchy());
    await mount();

    rightClick('p:p1');
    fireEvent.click(screen.getByTestId('menu-item-Unload Project'));
    expect(unload).toHaveBeenLastCalledWith({ id: 'p1', name: 'Alpha' });

    rightClick('p:p1');
    fireEvent.click(screen.getByTestId('menu-item-Unload Project and End Terminals'));
    expect(unload).toHaveBeenLastCalledWith({ id: 'p1', name: 'Alpha' }, 'endTerminals');
  });

  it('Destroy Tab and Destroy Panel run the tab’s and the panel’s own flows', async () => {
    feed(sampleHierarchy());
    const destroyTab = vi.fn();
    const destroyPanel = vi.fn();
    registerTabDestroy('t1', destroyTab);
    registerPanelDestroy('n1', destroyPanel);
    await mount();

    act(() => focusOn(['root', 'c:projects', 'p:p1']));
    rightClick('t:t1');
    fireEvent.click(screen.getByTestId('menu-item-Destroy Tab'));
    expect(destroyTab).toHaveBeenCalledTimes(1);

    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));
    rightClick('n:n1');
    fireEvent.click(screen.getByTestId('menu-item-Destroy Panel'));
    expect(destroyPanel).toHaveBeenCalledTimes(1);
  });

  it('a tab in a project that is not loaded is disabled, and says why', async () => {
    const sleeping = node({
      id: 'p:p2',
      kind: 'project',
      label: 'Beta',
      projectState: 'unloaded',
      owner: { component: 'projects', projectId: 'p2' },
      children: [node({ id: 't:t9', kind: 'tab', label: 'Old', owner: { component: 'projects', projectId: 'p2', tabId: 't9' } })],
    });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', owner: { component: 'projects' }, children: [sleeping] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p2']));

    rightClick('t:t9');

    const item = screen.getByTestId('menu-item-Destroy Tab');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item.getAttribute('title')).toBe('Switch to Beta to destroy this tab');
  });

  // Only the active project's layout is reported by any window (research R12), so a project that is
  // loaded but not active has nothing open: routing a destroy to it could only fail, and say so falsely.
  it.each([
    ['tab', 't:t8', 'Destroy Tab', 'Switch to Gamma to destroy this tab'],
    ['panel', 'n:n8', 'Destroy Panel', 'Switch to Gamma to destroy this panel'],
  ])('a %s of a project that is loaded but not active is disabled, naming the project to switch to', async (_kind, id, label, reason) => {
    const panel = node({ id: 'n:n8', kind: 'panel', label: 'Logs', panelKind: 'editor', owner: { component: 'projects', projectId: 'p3', tabId: 't8', panelId: 'n8' } });
    const tab = node({ id: 't:t8', kind: 'tab', label: 'Docs', owner: { component: 'projects', projectId: 'p3', tabId: 't8' }, children: [panel] });
    const loaded = node({ id: 'p:p3', kind: 'project', label: 'Gamma', projectState: 'loaded', owner: { component: 'projects', projectId: 'p3' }, children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', owner: { component: 'projects' }, children: [loaded] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    bridge.setRouteAnswer(true);
    await mount();
    act(() => focusOn(id === 't:t8' ? ['root', 'c:projects', 'p:p3'] : ['root', 'c:projects', 'p:p3', 't:t8']));

    rightClick(id);

    const item = screen.getByTestId(`menu-item-${label}`);
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item.getAttribute('title')).toBe(reason);
    fireEvent.click(item);
    expect(bridge.routed).toEqual([]);
  });

  it('a registered tab is destroyable whatever its project’s state', async () => {
    const tab = node({ id: 't:t8', kind: 'tab', label: 'Docs', owner: { component: 'projects', projectId: 'p3', tabId: 't8' } });
    const loaded = node({ id: 'p:p3', kind: 'project', label: 'Gamma', projectState: 'loaded', owner: { component: 'projects', projectId: 'p3' }, children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', owner: { component: 'projects' }, children: [loaded] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    registerTabDestroy('t8', vi.fn());
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p3']));

    rightClick('t:t8');

    expect(screen.getByTestId('menu-item-Destroy Tab')).toHaveAttribute('aria-disabled', 'false');
  });

  it('a tab another window holds is destroyed by routing the request there', async () => {
    feed(sampleHierarchy());
    bridge.setRouteAnswer(true);
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p1']));

    rightClick('t:t1');
    fireEvent.click(screen.getByTestId('menu-item-Destroy Tab'));

    await waitFor(() => expect(bridge.routed).toEqual([{ action: 'destroyTab', id: 't1' }]));
    expect(screen.queryByTestId('monitor-notice')).toBeNull();
  });

  it('and says so, once, when no window holds it', async () => {
    feed(sampleHierarchy());
    bridge.setRouteAnswer(false);
    await mount();
    act(() => focusOn(['root', 'c:projects', 'p:p1']));

    rightClick('t:t1');
    fireEvent.click(screen.getByTestId('menu-item-Destroy Tab'));

    const notice = await screen.findByTestId('monitor-notice');
    expect(notice).toHaveTextContent(/not open in any window/i);
  });
});

describe('the detail pane’s action row', () => {
  it('shows the same rows as the menu, as titled icon controls', async () => {
    feed(sampleHierarchy());
    await mount();
    act(() => focusOn(PROCESS_PATH));
    act(() => setSelection('x:200:1'));

    const bar = screen.getByTestId('detail-actions');
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['Kill Process', 'Kill All Below']);
    for (const b of buttons) expect(b.querySelector('.icon')).not.toBeNull();
  });

  it('is absent for a throng-owned node', async () => {
    feed(sampleHierarchy());
    await mount();
    act(() => setSelection('c:ui'));
    expect(screen.queryByTestId('detail-actions')).toBeNull();
  });

  it('a disabled action keeps its reason as its title', async () => {
    const tab = node({ id: 't:t9', kind: 'tab', label: 'Old', owner: { component: 'projects', projectId: 'p2', tabId: 't9' } });
    const sleeping = node({ id: 'p:p2', kind: 'project', label: 'Beta', projectState: 'unloaded', owner: { component: 'projects', projectId: 'p2' }, children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', owner: { component: 'projects' }, children: [sleeping] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    await mount();
    act(() => setSelection('t:t9'));
    const button = within(screen.getByTestId('detail-actions')).getByRole('button');
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toBe('Switch to Beta to destroy this tab');
  });
});

describe('Kill Process and Kill All Below ask confirmations.killProcesses (FR-063b)', () => {
  const choose = async (label: string, id: string): Promise<void> => {
    act(() => focusOn(PROCESS_PATH));
    rightClick(id);
    fireEvent.click(screen.getByTestId(`menu-item-${label}`));
  };

  it('at the shipped double level: names the node and its owners, lists the processes ending, then asks again', async () => {
    feed(sampleHierarchy());
    await mount({ killProcesses: 'double' });

    await choose('Kill All Below', 'x:200:1');

    const first = await screen.findByTestId('confirm-dialog');
    expect(first).toHaveTextContent('Kill All Below');
    expect(first).toHaveTextContent('pwsh.exe');
    expect(first).toHaveTextContent('Alpha');
    expect(first).toHaveTextContent('Build');
    expect(first).toHaveTextContent('Shell');
    const listed = within(first).getAllByTestId('kill-details-item').map((i) => i.textContent);
    expect(listed).toEqual([expect.stringContaining('node.exe'), expect.stringContaining('pwsh.exe')]);
    expect(listed[0]).toContain('300');
    expect(listed[1]).toContain('200');
    expect(bridge.kills).toHaveLength(0);

    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(/absolutely sure/i));
    expect(bridge.kills).toHaveLength(0);
    fireEvent.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(bridge.kills).toHaveLength(1));
    // Leaves first: the child, then the shell it ran under.
    expect(bridge.kills[0]).toEqual({ mode: 'below', nodeId: 'x:200:1', targets: [keyOf('x:300:1'), keyOf('x:200:1')] });
  });

  it('does not name a panel as its own owner: “Shell” in Alpha › Build, not Alpha › Build › Shell', async () => {
    feed(sampleHierarchy());
    await mount({ killProcesses: 'single' });
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1']));

    rightClick('n:n1');
    fireEvent.click(screen.getByTestId('menu-item-Kill All Below'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('under “Shell” in Alpha › Build?');
    expect(dialog.textContent).not.toContain('Build › Shell');
  });

  it('Kill Process asks the same, for that process alone', async () => {
    feed(sampleHierarchy());
    await mount({ killProcesses: 'single' });

    await choose('Kill Process', 'x:300:1');

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent('Kill Process');
    expect(within(dialog).getAllByTestId('kill-details-item')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(bridge.kills).toEqual([{ mode: 'process', nodeId: 'x:300:1', targets: [keyOf('x:300:1')] }]));
    // `single` is one question, not two.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('at none it asks nothing', async () => {
    feed(sampleHierarchy());
    await mount({ killProcesses: 'none' });
    await choose('Kill Process', 'x:300:1');
    await waitFor(() => expect(bridge.kills).toHaveLength(1));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('Escape cancels, and nothing is killed', async () => {
    feed(sampleHierarchy());
    await mount({ killProcesses: 'double' });
    await choose('Kill Process', 'x:300:1');
    const dialog = await screen.findByTestId('confirm-dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(bridge.kills).toHaveLength(0);
  });

  it('a long list collapses to “and N more” (FR-063b)', async () => {
    const many = Array.from({ length: 12 }, (_, i) => proc(5000 + i, `worker${i}.exe`, metrics({ cpu: 1, memory: 10 * MIB })));
    const shell = proc(4999, 'host.exe', metrics({ cpu: 1, memory: 10 * MIB }), many);
    const panel = node({ id: 'n:n1', kind: 'panel', label: 'Shell', panelKind: 'terminal', owner: { component: 'projects', projectId: 'p1', tabId: 't1', panelId: 'n1' }, children: [shell] });
    const tab = node({ id: 't:t1', kind: 'tab', label: 'Build', owner: { component: 'projects', projectId: 'p1', tabId: 't1' }, children: [panel] });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', owner: { component: 'projects', projectId: 'p1' }, children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', owner: { component: 'projects' }, children: [project] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    await mount({ killProcesses: 'single' });
    act(() => focusOn(PROCESS_PATH));

    rightClick('x:4999:1');
    fireEvent.click(screen.getByTestId('menu-item-Kill All Below'));

    const dialog = await screen.findByTestId('confirm-dialog');
    // 13 processes end; eight are named and the rest are counted.
    expect(within(dialog).getAllByTestId('kill-details-item')).toHaveLength(8);
    expect(within(dialog).getByTestId('kill-details-more')).toHaveTextContent('and 5 more');
  });
});

describe('a failed kill raises ONE inline notice with a plain cause (FR-064)', () => {
  const kill = async (): Promise<void> => {
    act(() => focusOn(PROCESS_PATH));
    rightClick('x:300:1');
    fireEvent.click(screen.getByTestId('menu-item-Kill Process'));
  };

  it('says what failed and why in words, and never shows the raw cause code', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'denied', cause: 'notUsersProcess' }] });
    await mount({ killProcesses: 'none' });

    await kill();

    const notice = await screen.findByTestId('monitor-notice');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('node.exe');
    expect(notice.textContent).not.toMatch(/notUsersProcess/);
    expect(notice.textContent?.length ?? 0).toBeGreaterThan(20);
  });

  it('names no operating system when a kill fails without a known cause', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'failed' }] });
    await mount({ killProcesses: 'none' });

    await kill();

    const notice = await screen.findByTestId('monitor-notice');
    expect(notice).toHaveTextContent('The system would not end it');
    expect(notice.textContent).not.toMatch(/windows/i);
  });

  it('is one surface: a second failure replaces the first rather than adding to it', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'failed', cause: 'timeout' }] });
    await mount({ killProcesses: 'none' });

    await kill();
    await screen.findByTestId('monitor-notice');
    await kill();

    await waitFor(() => expect(bridge.kills).toHaveLength(2));
    expect(screen.getAllByTestId('monitor-notice')).toHaveLength(1);
  });

  it('carries its remedy on itself: a dismiss control, titled, and it goes', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'failed', cause: 'collectorUnavailable' }] });
    await mount({ killProcesses: 'none' });
    await kill();
    const notice = await screen.findByTestId('monitor-notice');

    const dismiss = within(notice).getByTestId('monitor-notice-dismiss');
    expect(dismiss).toHaveAttribute('title', 'Dismiss');
    fireEvent.click(dismiss);

    expect(screen.queryByTestId('monitor-notice')).toBeNull();
  });

  it('is not raised when every target ended', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'ended' }] });
    await mount({ killProcesses: 'none' });
    await kill();
    await waitFor(() => expect(bridge.kills).toHaveLength(1));
    expect(screen.queryByTestId('monitor-notice')).toBeNull();
  });

  // US3/AC9 names "the process already gone" as a failure to report, not a success to swallow.
  it('says so, once, when the one target had already ended', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'gone' }] });
    await mount({ killProcesses: 'none' });
    await kill();

    const notice = await screen.findByTestId('monitor-notice');
    expect(notice).toHaveTextContent('node.exe had already ended');
    expect(notice.textContent).not.toMatch(/couldn.t end/i);
  });

  it('reports a target that was gone beside one that failed, in the same notice', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({
      results: [
        { key: keyOf('x:300:1'), outcome: 'gone' },
        { key: keyOf('x:200:1'), outcome: 'failed', cause: 'timeout' },
      ],
    });
    await mount({ killProcesses: 'none' });
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']));
    rightClick('x:200:1');
    fireEvent.click(screen.getByTestId('menu-item-Kill All Below'));

    const notice = await screen.findByTestId('monitor-notice');
    expect(screen.getAllByTestId('monitor-notice')).toHaveLength(1);
    expect(notice).toHaveTextContent('node.exe: It had already ended');
    expect(notice).toHaveTextContent('pwsh.exe: The monitor could not reach its process reader');
  });

  it('uses the identity-changed sentence for a gone target whose id was reused', async () => {
    feed(sampleHierarchy());
    bridge.setKillResult({ results: [{ key: keyOf('x:300:1'), outcome: 'gone', cause: 'identityChanged' }] });
    await mount({ killProcesses: 'none' });
    await kill();

    expect(await screen.findByTestId('monitor-notice')).toHaveTextContent('now belongs to a different program');
  });
});
