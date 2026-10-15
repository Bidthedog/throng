import { createServer, type Server, type Socket } from 'node:net';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { encodeLine, type AgentCommand, type AgentEvent } from '../../src/pty-agent-protocol.js';

/**
 * 055 T101 — an agent-hosted terminal's roster entry names its console host, so the monitor labels it
 * "Console host — <panel>" under Helpers rather than leaving it under the agent unnamed (FR-020).
 * The "agent" is an in-process pipe server, as in `pty-agent-end.test.ts`.
 */

let server: Server | undefined;
let host: PtyAgentHost | undefined;

afterEach(async () => {
  await host?.dispose?.();
  host = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function fakeAgent(onCommand: (cmd: AgentCommand, reply: (ev: AgentEvent) => void) => void): Promise<string> {
  const pipeName = `\\\\.\\pipe\\throng-agent-roster-${process.pid}-${Date.now()}`;
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

const startOpts = { file: 'cmd.exe', args: [], cwd: '.', cols: 80, rows: 24 };

describe('055 — PtyAgentHost roster entries', () => {
  it('names the console host the agent reports for a terminal, and forgets it when the terminal exits', async () => {
    let exit: (() => void) | undefined;
    const pipe = await fakeAgent((cmd, reply) => {
      if (cmd.op === 'start') {
        reply({ ev: 'started', key: cmd.key, pid: 4321 });
        reply({ ev: 'conhost', key: cmd.key, pid: 4400 });
        exit = () => reply({ ev: 'exit', key: cmd.key, code: 0 });
      }
    });
    host = new PtyAgentHost(pipe, () => {}, { connectMs: 5000, readyMs: 5000 });
    const handle = host.start(startOpts);
    const h = host;
    await expect.poll(() => h.rosterEntries().find((e) => e.handlePid === handle.pid)?.conhostPid, { timeout: 5000 }).toBe(4400);
    expect(h.rosterEntries()).toEqual([{ handlePid: handle.pid, osPid: 4321, conhostPid: 4400 }]);
    exit!();
    await expect.poll(() => h.rosterEntries(), { timeout: 5000 }).toEqual([]);
  });
});
