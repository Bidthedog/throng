import { createServer, type Server, type Socket } from 'node:net';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { encodeLine, type AgentCommand, type AgentEvent } from '../../src/pty-agent-protocol.js';

/**
 * 051 contracts/pty-agent-protocol.md — the daemon's proxy for de-elevated terminals ends them with
 * an outcome, like the local host (FR-005, FR-013), and escalates through the agent (FR-015a).
 *
 * The "agent" is an in-process pipe server scripted per test: it records every command and answers
 * (or does not) as the case needs. The real agent process is the integration test's business.
 */

let counter = 0;
let server: Server | undefined;
let host: PtyAgentHost | undefined;

afterEach(async () => {
  await host?.dispose?.();
  host = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** A fake agent: `onCommand` sees every command with a `reply` that writes an event back. */
function fakeAgent(onCommand: (cmd: AgentCommand, reply: (ev: AgentEvent) => void) => void): Promise<string> {
  counter += 1;
  const pipeName = `\\\\.\\pipe\\throng-agent-end-${process.pid}-${counter}`;
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      const reply = (ev: AgentEvent): void => void socket.write(encodeLine(ev));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line) onCommand(JSON.parse(line) as AgentCommand, reply);
        }
      });
    });
    server.listen(pipeName, () => resolve(pipeName));
  });
}

function connectHost(pipeName: string): PtyAgentHost {
  host = new PtyAgentHost(pipeName, () => {}, { connectMs: 5000, readyMs: 5000 });
  return host;
}

const startOpts = { file: 'cmd.exe', args: [], cwd: '.', cols: 80, rows: 24 };

describe('051 — PtyAgentHost.end', () => {
  it('sends end with a request id and the limit, and resolves when the agent reports it ended', async () => {
    const seen: AgentCommand[] = [];
    const pipe = await fakeAgent((cmd, reply) => {
      seen.push(cmd);
      if (cmd.op === 'start') reply({ ev: 'started', key: cmd.key, pid: 4321 });
      if (cmd.op === 'end') reply({ ev: 'ended', reqId: cmd.reqId, ok: true });
    });
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    await expect(h.end(handle, 1000)).resolves.toBeUndefined();
    const end = seen.find((c) => c.op === 'end');
    expect(end).toMatchObject({ op: 'end', key: handle.pid, timeoutMs: 1000 });
    expect(seen.some((c) => (c as { op: string }).op === 'kill')).toBe(false);
  });

  it("rejects with the agent's reason when the agent's own end failed", async () => {
    const pipe = await fakeAgent((cmd, reply) => {
      if (cmd.op === 'end') reply({ ev: 'ended', reqId: cmd.reqId, ok: false, reason: 'did not end within 1 second' });
    });
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    await expect(h.end(handle, 1000)).rejects.toThrow('did not end within 1 second');
  });

  it('rejects by itself when the agent never answers, one second after the limit', async () => {
    const pipe = await fakeAgent(() => {});
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    const started = Date.now();
    await expect(h.end(handle, 100)).rejects.toThrow(/did not answer/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1050);
  });

  it('returns the same promise for a second end, and resolves for a terminal it does not hold', async () => {
    const pipe = await fakeAgent((cmd, reply) => {
      if (cmd.op === 'end') setTimeout(() => reply({ ev: 'ended', reqId: cmd.reqId, ok: true }), 20);
    });
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    const first = h.end(handle, 1000);
    expect(h.end(handle, 1000)).toBe(first);
    await first;
    await expect(h.end({ pid: 9999 }, 1000)).resolves.toBeUndefined();
  });
});

describe('051 FR-015a — PtyAgentHost.forceEnd', () => {
  it("relays the agent's survivors", async () => {
    const pipe = await fakeAgent((cmd, reply) => {
      if (cmd.op === 'forceEnd') reply({ ev: 'forceEnded', reqId: cmd.reqId, survivors: [{ pid: 7, name: 'ping' }] });
    });
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    await expect(h.forceEnd(handle, 1000)).resolves.toEqual({ survivors: [{ pid: 7, name: 'ping' }] });
  });

  it('resolves with no survivors when the agent never answers', async () => {
    const pipe = await fakeAgent(() => {});
    const h = connectHost(pipe);
    const handle = h.start(startOpts);
    await expect(h.forceEnd(handle, 100)).resolves.toEqual({ survivors: [] });
  });
});
