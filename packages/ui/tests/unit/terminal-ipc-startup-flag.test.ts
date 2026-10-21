import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type TerminalFlavour } from '@throng/core';

/**
 * 057 T053 (FR-065a, R8) — the attach carries `launch.startupCommand: true` whenever a user startup
 * command is in effect.
 *
 * Layer: unit — a flavour command-recipe launch folds the command into `args`, so the daemon cannot
 * tell from the launch that the first command it sees finish is the startup one; main is the only
 * place that knows, and it is decided here before the RPC leaves.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
  },
}));

const { registerTerminalIpc } = await import('../../src/main/terminal-ipc.js');

const CMD: TerminalFlavour = {
  id: 'cmd',
  label: 'Command Prompt',
  file: 'C:\\Windows\\System32\\cmd.exe',
  args: [],
  commandRecipe: ['/K', '{command}'],
};

const NO_RECIPE: TerminalFlavour = { id: 'plain', label: 'Plain', file: 'C:\\plain.exe', args: [] };

let launches: Array<{ startupCommand?: boolean }> = [];

beforeEach(() => {
  handlers.clear();
  launches = [];
  registerTerminalIpc({
    daemonClient: {
      call: (method: string, params: unknown) => {
        if (method === 'terminal.attach') launches.push((params as { launch: { startupCommand?: boolean } }).launch);
        return Promise.resolve({ sessionId: 's1', status: 'running' });
      },
    } as never,
    shellDetection: { listFlavours: () => Promise.resolve([CMD, NO_RECIPE]) } as never,
    attachTimeoutMs: 1000,
    clipboard: { writeText: () => {}, writeRich: () => Promise.resolve(), readText: () => '' },
    foregroundHandoff: { handOffForeground: () => {} } as never,
    readTerminalSettings: () => DEFAULT_APP_SETTINGS.terminals,
  });
});

async function attach(flavourId: string, startupCommand: string): Promise<void> {
  await handlers.get('throng:terminal:attach')!({ sender: { id: 1, once: () => {} } }, {
    panelId: 'panel-1',
    projectId: 'project-1',
    projectRoot: 'D:\\p',
    flavourId,
    shellArguments: '',
    startupCommand,
    cols: 80,
    rows: 24,
  });
}

describe('launch.startupCommand', () => {
  it('is true for a flavour with a command recipe and a startup command', async () => {
    await attach('cmd', 'npm run dev');
    expect(launches.at(-1)?.startupCommand).toBe(true);
  });

  it('is true for a flavour with no recipe too (the command is written once ready)', async () => {
    await attach('plain', 'npm run dev');
    expect(launches.at(-1)?.startupCommand).toBe(true);
  });

  it('is absent when there is no startup command', async () => {
    await attach('cmd', '');
    expect(launches.at(-1)?.startupCommand).toBeUndefined();
  });

  it('is absent for a whitespace-only startup command', async () => {
    await attach('cmd', '   ');
    expect(launches.at(-1)?.startupCommand).toBeUndefined();
  });
});
