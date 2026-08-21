import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonClient } from '../../src/main/daemon-client.js';
import { createSerializer } from '../../src/main/attach-serializer.js';

/**
 * #300 — keystrokes must reach the daemon in the order they were typed.
 *
 * ── THE MECHANISM ──
 *
 * `DaemonClient.call` opens a SHORT-LIVED PIPE CONNECTION PER CALL and writes its payload only once
 * that socket emits `connect`. Two keystrokes typed in quick succession therefore race two
 * independent connection handshakes, and whichever completes first is written first. Nothing in the
 * path preserves submission order — not the renderer (`use-terminal.ts` fires
 * `void bridge.write(...)` per keystroke), not the IPC handler, not the client.
 *
 * The observed symptom is exactly what that predicts: `throng-focus-WindowsPowerShell` arriving as
 * `throng-focui-WsndowsPowerShell`, two characters exchanged with the ones between them untouched.
 *
 * ── WHY CONNECT LATENCY IS THE RIGHT LEVER ──
 *
 * The defect IS "delivery order is decided by connect latency", so varying connect latency is not a
 * contrivance — it is the shortest statement of the bug. The server below accepts the first
 * connection slowly and the rest immediately, which is what a loaded machine does to one handshake
 * among many, and what makes this show up under CI load and almost never on an idle developer box.
 */

let server: Server | undefined;
const pipeName = `\\\\.\\pipe\\throng-write-order-${process.pid}`;

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s !== undefined) await new Promise<void>((res) => s.close(() => res()));
});

/** Records the `data` of every `terminal.write` in ARRIVAL order; stalls the first connection. */
function startServer(arrivals: string[], stallFirstMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let seen = 0;
    server = createServer((socket: Socket) => {
      const delay = seen === 0 ? stallFirstMs : 0;
      seen += 1;
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id: number; method: string; params: { data: string } };
          const reply = (): void => {
            arrivals.push(msg.params.data);
            socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } })}\n`);
          };
          if (delay > 0) setTimeout(reply, delay);
          else reply();
        }
      });
      socket.on('error', () => undefined);
    });
    server.listen(pipeName, () => resolve());
  });
}

function newClient(): DaemonClient {
  return new DaemonClient({
    pipeName,
    window: { width: 1, height: 1 },
    pingTimeoutMs: 5000,
    attachTimeoutMs: 15000,
  });
}

const CHARS = ['t', 'h', 'r', 'o', 'n', 'g'];

describe('#300 — terminal writes reach the daemon in typed order', () => {
  it('REPRODUCES the defect: unserialised writes arrive out of order', async () => {
    const arrivals: string[] = [];
    await startServer(arrivals, 40);

    const client = newClient();
    // Exactly what the renderer does today: fire and forget, one call per keystroke.
    await Promise.all(
      CHARS.map((c) => client.call('terminal.write', { panelId: 'p1', data: c }).catch(() => undefined)),
    );

    // The control: this is the behaviour being reported as a bug, so it must actually happen —
    // a green here with the fix absent would mean the test proves nothing.
    console.log('[300] typed:', CHARS.join(''), ' arrived:', arrivals.join(''));
    expect(arrivals).not.toEqual(CHARS);
  });

  it('a per-panel serializer restores typed order', async () => {
    const arrivals: string[] = [];
    await startServer(arrivals, 40);

    const client = newClient();
    const serialize = createSerializer();
    await Promise.all(
      CHARS.map((c) =>
        serialize(() => client.call('terminal.write', { panelId: 'p1', data: c })).catch(
          () => undefined,
        ),
      ),
    );

    expect(arrivals).toEqual(CHARS);
  });
});
