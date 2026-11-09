import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';

/**
 * A window carries one `destroyed` listener per thing that watches it, and Electron warns past ten. The terminal path
 * therefore watches a window once, for both of its jobs: detaching the views and dropping the output routes.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
  },
}));

const { registerTerminalIpc } = await import('../../src/main/terminal-ipc.js');
const { TerminalOutputRoutes } = await import('../../src/main/terminal-output-routes.js');

const FLAVOUR = { id: 'sh', label: 'sh', file: '/bin/sh', args: [] };

function fakeWindow() {
  const destroyed: (() => void)[] = [];
  return {
    id: 7,
    isDestroyed: () => false,
    send: () => undefined,
    once: (_event: 'destroyed', listener: () => void) => void destroyed.push(listener),
    destroyedListeners: () => destroyed.length,
    destroy: () => {
      for (const listener of destroyed.splice(0)) listener();
    },
  };
}

const request = (panelId: string) => ({
  panelId,
  projectId: 'project-1',
  projectRoot: '/p',
  flavourId: 'sh',
  shellArguments: '',
  startupCommand: '',
  cols: 80,
  rows: 24,
});

describe('a window that shows terminals', () => {
  let routes: InstanceType<typeof TerminalOutputRoutes>;
  let attachAnswer: Promise<unknown>;
  const calls: string[] = [];

  const attach = (win: ReturnType<typeof fakeWindow>, panelId: string): Promise<unknown> =>
    Promise.resolve(handlers.get('throng:terminal:attach')!({ sender: win }, request(panelId)));

  beforeEach(() => {
    handlers.clear();
    calls.length = 0;
    routes = new TerminalOutputRoutes();
    attachAnswer = Promise.resolve({ sessionId: 's1', status: 'running' });
    registerTerminalIpc({
      outputRoutes: routes,
      daemonClient: {
        call: (method: string) => {
          calls.push(method);
          return method === 'terminal.attach' ? attachAnswer : Promise.resolve({ ok: true });
        },
      } as never,
      shellDetection: { listFlavours: () => Promise.resolve([FLAVOUR]) } as never,
      attachTimeoutMs: 1000,
      clipboard: { writeText: () => {}, writeRich: () => Promise.resolve(), readText: () => '' },
      foregroundHandoff: { handOffForeground: () => {} } as never,
      readTerminalSettings: () => DEFAULT_APP_SETTINGS.terminals,
    });
  });

  it('is watched once, however many terminals it shows', async () => {
    const win = fakeWindow();
    await attach(win, 'a');
    await attach(win, 'b');
    expect(win.destroyedListeners()).toBe(1);
  });

  it('detaches its views and drops its routes when it is destroyed', async () => {
    const win = fakeWindow();
    await attach(win, 'a');

    win.destroy();

    expect(calls).toContain('terminal.detach');
    expect(routes.viewsForSubscribe()).toEqual([]);
  });

  it('drops the route of a terminal still attaching when it is destroyed', () => {
    const win = fakeWindow();
    attachAnswer = new Promise(() => undefined);
    void attach(win, 'a');
    expect(routes.viewsForSubscribe()).toEqual([{ panelId: 'a' }]);

    win.destroy();

    expect(routes.viewsForSubscribe()).toEqual([]);
  });
});
