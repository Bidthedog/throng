import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type TerminalFlavour, type TerminalSettings } from '@throng/core';

/**
 * 045 T116, FR-080 – FR-080c; R11 — where the hyperlink-advertising variable is merged, and when
 * the setting behind it is read.
 *
 * ══ `launch.env`, NEVER `baseEnv` ══
 *
 * A de-elevated terminal never receives `baseEnv`. `daemon/src/pty-agent-host.ts:290` sends only
 * `env`, and `pty-agent-entry.ts:172-179` forwards only `env` — so a variable merged into the base
 * would reach an ordinary terminal and silently miss the elevated one, which is precisely the case
 * a user would report as "it works in one terminal and not the other". `launch.env` also layers ON
 * TOP of the base at `platform-windows/src/node-pty-host.ts:135-138`, so it wins either way.
 *
 * ══ READ PER ATTACH, WHICH IS FR-080c ══
 *
 * A process's environment is fixed when it starts, so a change cannot reach a running terminal and
 * must not be made to look as though it has. Reading the setting on every attach gives exactly the
 * behaviour the requirement asks for and the setting's own description promises: it applies to the
 * next terminal, and the one already running is untouched.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
  },
}));

const { registerTerminalIpc } = await import('../../src/main/terminal-ipc.js');

const FLAVOUR: TerminalFlavour = {
  id: 'cmd',
  label: 'Command Prompt',
  file: 'C:\\Windows\\System32\\cmd.exe',
  args: [],
};

interface AttachCall {
  readonly method: string;
  readonly params: {
    readonly launch: { readonly env?: Record<string, string>; readonly baseEnv?: Record<string, string> };
  };
}

const calls: AttachCall[] = [];
/** What `readTerminalSettings` answers on the NEXT attach. Moved between attaches on purpose. */
let terminals: TerminalSettings;
let reads = 0;

function register(): void {
  handlers.clear();
  calls.length = 0;
  reads = 0;
  registerTerminalIpc({
    daemonClient: {
      call: (method: string, params: unknown) => {
        calls.push({ method, params: params as AttachCall['params'] });
        return Promise.resolve({ sessionId: 's1', status: 'running' });
      },
    } as never,
    shellDetection: { listFlavours: () => Promise.resolve([FLAVOUR]) } as never,
    attachTimeoutMs: 1000,
    clipboard: { writeText: () => {}, writeRich: () => Promise.resolve(), readText: () => '' },
    foregroundHandoff: { handOffForeground: () => {} } as never,
    readTerminalSettings: () => {
      reads += 1;
      return terminals;
    },
  });
}

const attach = async (): Promise<void> => {
  const handler = handlers.get('throng:terminal:attach');
  expect(handler, 'throng:terminal:attach must still be registered').toBeDefined();
  // The view-tracking backstop reads `event.sender.id` and subscribes to its destruction; a fake
  // webContents is enough, and keeps this a unit test of the attach path rather than of Electron.
  await handler!({ sender: { id: 1, once: () => {} } }, {
    panelId: 'panel-1',
    projectId: 'project-1',
    projectRoot: 'D:\\p',
    flavourId: 'cmd',
    shellArguments: '',
    startupCommand: '',
    cols: 80,
    rows: 24,
  });
};

const lastLaunch = (): AttachCall['params']['launch'] => {
  const attaches = calls.filter((c) => c.method === 'terminal.attach');
  expect(attaches.length, 'the attach never reached the daemon').toBeGreaterThan(0);
  return attaches[attaches.length - 1]!.params.launch;
};

beforeEach(() => {
  terminals = { ...DEFAULT_APP_SETTINGS.terminals, advertiseHyperlinks: true };
  register();
});

describe('FR-080 — the variable is merged into `launch.env`', () => {
  it('a terminal started with the setting ON carries FORCE_HYPERLINK=1', async () => {
    await attach();
    expect(lastLaunch().env?.FORCE_HYPERLINK).toBe('1');
  });

  it('and NEVER into `baseEnv`, which a de-elevated terminal never receives', async () => {
    await attach();
    const launch = lastLaunch();
    expect(launch.baseEnv, 'the base is still sent').toBeDefined();
    expect(
      Object.keys(launch.baseEnv!).filter((k) => k.toUpperCase() === 'FORCE_HYPERLINK'),
      'throng added nothing to the base environment',
    ).toEqual([]);
  });

  it('with the setting OFF, throng neither sets nor unsets it', async () => {
    terminals = { ...terminals, advertiseHyperlinks: false };
    await attach();
    const launch = lastLaunch();
    expect(launch.env?.FORCE_HYPERLINK).toBeUndefined();
  });

  it('the shipped value advertises — the setting is ON out of the box', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.advertiseHyperlinks).toBe(true);
  });
});

describe('FR-080d — throng adds one key, and it is FORCE_HYPERLINK', () => {
  it('no WT_SESSION and no TERM_PROGRAM are added by the merge', async () => {
    await attach();
    const added = Object.keys(lastLaunch().env ?? {});
    expect(added, 'a borrowed terminal identity is never throng’s to claim').not.toContain(
      'WT_SESSION',
    );
    expect(added).not.toContain('TERM_PROGRAM');
  });
});

describe('FR-080c — the setting is read PER ATTACH', () => {
  it('a change applies to the next terminal, with no restart', async () => {
    await attach();
    expect(lastLaunch().env?.FORCE_HYPERLINK).toBe('1');

    terminals = { ...terminals, advertiseHyperlinks: false };
    await attach();
    expect(lastLaunch().env?.FORCE_HYPERLINK, 'the next attach saw the change').toBeUndefined();

    terminals = { ...terminals, advertiseHyperlinks: true };
    await attach();
    expect(lastLaunch().env?.FORCE_HYPERLINK, 'and the one after that').toBe('1');
  });

  it('the reader is consulted once per attach, never once at registration', async () => {
    expect(reads, 'nothing is read when the bridge is registered').toBe(0);
    await attach();
    await attach();
    expect(reads).toBe(2);
  });
});
