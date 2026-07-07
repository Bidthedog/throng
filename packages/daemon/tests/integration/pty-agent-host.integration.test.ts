import { describe, it, expect } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import process from 'node:process';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { encodeLine, type AgentCommand } from '../../src/pty-agent-protocol.js';

// PtyAgentHost is the daemon-side proxy that hosts de-elevated terminals in a
// separate medium-integrity PTY agent process (FR-025c mixed mode). These tests
// stand up a REAL fake agent (a named-pipe server speaking the protocol) — no mocks
// — and drive the failure the audit found: the agent dying while the daemon lives.

let seq = 0;
function uniquePipe(): string {
  seq += 1;
  return `\\\\.\\pipe\\throng-test-agent-${process.pid}-${Date.now()}-${seq}`;
}

function startOpts() {
  return { file: 'cmd.exe', args: [] as string[], cwd: 'C:\\', cols: 80, rows: 24 };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await delay(10);
  }
}

interface FakeAgent {
  readonly server: Server;
  nextConnection(): Promise<Socket>;
  commandsFrom(sock: Socket): AgentCommand[];
  close(): Promise<void>;
}

function startFakeAgent(pipeName: string): Promise<FakeAgent> {
  const ready: Socket[] = [];
  const waiters: Array<(s: Socket) => void> = [];
  const commands = new Map<Socket, AgentCommand[]>();
  const server = createServer((sock) => {
    sock.setEncoding('utf8');
    const cmds: AgentCommand[] = [];
    commands.set(sock, cmds);
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) cmds.push(JSON.parse(line) as AgentCommand);
      }
    });
    sock.on('error', () => {
      /* peer reset — ignore */
    });
    const w = waiters.shift();
    if (w) w(sock);
    else ready.push(sock);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(pipeName, () => {
      resolve({
        server,
        nextConnection() {
          const existing = ready.shift();
          if (existing) return Promise.resolve(existing);
          return new Promise((res) => waiters.push(res));
        },
        commandsFrom(sock) {
          return commands.get(sock) ?? [];
        },
        close() {
          return new Promise((res) => server.close(() => res()));
        },
      });
    });
  });
}

describe('PtyAgentHost — agent death is surfaced, not swallowed', () => {
  it('surfaces an unexpected exit for every live terminal when the agent connection drops', async () => {
    const pipe = uniquePipe();
    const agent = await startFakeAgent(pipe);
    const host = new PtyAgentHost(pipe, () => {}); // agent already listening; launch is a no-op here
    const sock = await agent.nextConnection();

    const h1 = host.start(startOpts());
    const h2 = host.start(startOpts());
    const exited: number[] = [];
    host.onExit(h1, () => exited.push(h1.pid));
    host.onExit(h2, () => exited.push(h2.pid));

    // The agent process dies (crash / external kill) while the daemon lives.
    sock.destroy();

    await waitFor(() => exited.length === 2);
    expect([...exited].sort()).toEqual([h1.pid, h2.pid].sort());

    host.dispose();
    await agent.close();
  });

  it('does not fire a second exit for a terminal that already exited when the agent later drops', async () => {
    const pipe = uniquePipe();
    const agent = await startFakeAgent(pipe);
    const host = new PtyAgentHost(pipe, () => {});
    const sock = await agent.nextConnection();

    const h1 = host.start(startOpts());
    let exitCount = 0;
    host.onExit(h1, () => (exitCount += 1));

    // The agent reports a normal exit for this terminal.
    sock.write(encodeLine({ ev: 'exit', key: h1.pid, code: 0 }));
    await waitFor(() => exitCount === 1);

    // Now the agent connection drops — the already-exited terminal must NOT re-exit
    // (a double exit would double-release the project-root lock).
    sock.destroy();
    await delay(200);
    expect(exitCount).toBe(1);

    host.dispose();
    await agent.close();
  });

  it('relaunches the agent and delivers a new start after the connection drops', async () => {
    const pipe = uniquePipe();
    const agent = await startFakeAgent(pipe);
    let launches = 0;
    const host = new PtyAgentHost(pipe, () => (launches += 1)); // count (re)launch calls
    const sock1 = await agent.nextConnection();
    expect(launches).toBe(1); // constructor launched the agent once

    const h1 = host.start(startOpts());
    host.onExit(h1, () => {});
    sock1.destroy(); // agent dies

    // The host recovers: it relaunches the agent and reconnects.
    const sock2 = await agent.nextConnection();
    expect(launches).toBe(2);

    // A NEW de-elevated terminal now works — its start reaches the fresh agent
    // rather than hanging in the outbox forever.
    const h2 = host.start(startOpts());
    await waitFor(() =>
      agent.commandsFrom(sock2).some((c) => c.op === 'start' && c.key === h2.pid),
    );

    host.dispose();
    await agent.close();
  });
});
