import { createServer, type Server, type Socket } from 'node:net';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { IPtyHost } from '@throng/core';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { encodeLine, type AgentCommand, type AgentEvent } from '../../src/pty-agent-protocol.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

/**
 * 046 US4 review #1 — Unload's busy decision on a terminal hosted by the de-elevated PTY agent.
 *
 * On an elevated throng every ordinary terminal runs in the agent (FR-025c), and the agent answers
 * a child-process query over a pipe, i.e. LATER. `PtyAgentHost.listChildPids` is synchronous: it
 * sends the query and returns whatever the previous answer was — nothing at all for a session never
 * asked before. Unload asks exactly once: `terminal.list {includeBusy}` to decide whether to show a
 * dialog, then `terminal.closeIdle` to close the idle shells. If both read that empty cache, a shell
 * running `ping -t` is counted idle, no dialog appears, and closeIdle kills the running process —
 * FR-034 / FR-034c / Principle III.
 *
 * Real `TerminalService`, real `PtyAgentHost`, real named pipe. The agent at the other end is a
 * protocol-speaking fake that reports ONE running child for every session — the thing under test is
 * how the daemon consumes an asynchronous answer, not how the agent enumerates processes (the real
 * agent's enumeration is covered where the agent is). No `list` call precedes the two calls under
 * test, which is what a user who opens a project, starts a command and unloads does.
 */

const BUSY_CHILD = 4242;

interface FakeAgent {
  readonly server: Server;
  readonly commands: AgentCommand[];
  close(): Promise<void>;
}

function startFakeAgent(pipeName: string, probe: 'busy' | 'failed'): Promise<FakeAgent> {
  const commands: AgentCommand[] = [];
  const sockets: Socket[] = [];
  const server = createServer((sock) => {
    sockets.push(sock);
    sock.setEncoding('utf8');
    const send = (ev: AgentEvent) => sock.write(encodeLine(ev));
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const cmd = JSON.parse(line) as AgentCommand;
        commands.push(cmd);
        switch (cmd.op) {
          case 'start':
            send({ ev: 'started', key: cmd.key, pid: 9000 + cmd.key });
            break;
          case 'childpids':
            send(
              probe === 'failed'
                ? { ev: 'childpids', key: cmd.key, reqId: cmd.reqId, pids: [], failed: true }
                : { ev: 'childpids', key: cmd.key, reqId: cmd.reqId, pids: [BUSY_CHILD] },
            );
            break;
          case 'childprocs':
            send({
              ev: 'childprocs',
              key: cmd.key,
              reqId: cmd.reqId,
              procs: [{ pid: BUSY_CHILD, ppid: 9000 + cmd.key, commandLine: 'ping -t 127.0.0.1', startedAt: Date.now() }],
            });
            break;
          case 'kill':
            send({ ev: 'exit', key: cmd.key, code: 1 });
            break;
          default:
            break;
        }
      }
    });
    sock.on('error', () => {
      /* peer reset on dispose */
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(pipeName, () =>
      resolve({
        server,
        commands,
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.destroy();
            server.close(() => res());
          }),
      }),
    );
  });
}

/** The local host is never used: `forceAgent` routes every terminal through the agent. */
const unusedLocal: IPtyHost = {
  start: () => {
    throw new Error('the local host must not be used when the agent is forced');
  },
  write: () => {},
  resize: () => {},
  kill: () => {},
  onData: () => () => {},
  onExit: () => () => {},
  listChildPids: () => [],
  listChildProcesses: () => Promise.resolve([]),
};

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };

let agent: FakeAgent | undefined;
let host: PtyAgentHost | undefined;

afterEach(async () => {
  host?.dispose();
  await agent?.close();
  host = undefined;
  agent = undefined;
});

async function setUp(probe: 'busy' | 'failed' = 'busy') {
  const pipeName = `\\\\.\\pipe\\throng-unload-agent-${process.pid}-${Date.now()}`;
  agent = await startFakeAgent(pipeName, probe);
  host = new PtyAgentHost(pipeName, () => {
    /* the fake agent is already listening */
  });
  const service = new TerminalService(
    unusedLocal,
    new TerminalEvents(),
    new TerminalLockManager(noopLock),
    { isElevated: () => false },
    host,
    true, // forceAgent — what an elevated throng does for every ordinary terminal
  );
  const router = new RpcRouter();
  service.register(router);
  const call = async (method: string, params: object): Promise<any> => {
    const res = (await router.handle({ jsonrpc: '2.0', id: 1, method, params })) as { result?: unknown; error?: unknown };
    expect(res.error, `${method} failed: ${JSON.stringify(res.error)}`).toBeUndefined();
    return res.result;
  };
  return { call, agent };
}

async function attachAndStart(call: (m: string, p: object) => Promise<any>, fake: FakeAgent): Promise<void> {
  await call('terminal.attach', {
    panelId: 'busy1',
    projectId: 'proj',
    launch: { file: 'cmd.exe', args: [], cwd: 'C:\\' },
    cols: 80,
    rows: 24,
  });
  // Wait for the agent to have taken the start — the session is then as live as it gets.
  const deadline = Date.now() + 5000;
  while (!fake.commands.some((c) => c.op === 'start')) {
    if (Date.now() > deadline) throw new Error('the agent never received start');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Unload on an agent-hosted terminal that is running a process (review #1)', () => {
  it('terminal.list {includeBusy} reports it busy on the FIRST ask', async () => {
    const { call, agent: fake } = await setUp();
    await attachAndStart(call, fake);

    const list = await call('terminal.list', { projectId: 'proj', includeBusy: true });

    expect(list.sessions.find((s: any) => s.panelId === 'busy1')?.busy).toBe(true);
  });

  it('terminal.closeIdle {projectId} does not kill it', async () => {
    const { call, agent: fake } = await setUp();
    await attachAndStart(call, fake);

    const res = await call('terminal.closeIdle', { projectId: 'proj' });

    expect(res.closed).toEqual([]);
    expect(fake.commands.some((c) => c.op === 'kill')).toBe(false);
  });
});

describe('an agent whose probe FAILED is not an idle terminal (branch review #2)', () => {
  /*
   * The agent could not enumerate processes (PowerShell timed out on a loaded machine). An empty
   * list is how an idle shell looks, so reading the failure as one would end a running build.
   */
  it('terminal.list {includeBusy} reports it busy', async () => {
    const { call, agent: fake } = await setUp('failed');
    await attachAndStart(call, fake);

    const list = await call('terminal.list', { projectId: 'proj', includeBusy: true });

    expect(list.sessions.find((s: any) => s.panelId === 'busy1')?.busy).toBe(true);
  });

  it('terminal.closeIdle {projectId} keeps it', async () => {
    const { call, agent: fake } = await setUp('failed');
    await attachAndStart(call, fake);

    const res = await call('terminal.closeIdle', { projectId: 'proj' });

    expect(res.closed).toEqual([]);
    expect(fake.commands.some((c) => c.op === 'kill')).toBe(false);
  });
});
