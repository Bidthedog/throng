/**
 * 035 T061 — the `DaemonClient` ↔ `isTransportFailure` contract.
 *
 * ══ THE GAP THIS FILLS ══
 *
 * `isTransportFailure` decides whether a raw failure string is the TRANSPORT failing rather than a
 * real error about a real thing. Get it wrong in one direction and the user is shown `ENOENT` for a
 * named pipe — the same code a missing FILE produces, so they go hunting for a file that was never
 * involved. Get it wrong in the other and every failure raised while the daemon happens to be down
 * is relabelled "throng's daemon has stopped", including `FilesService` messages that need no daemon
 * at all (FR-011b).
 *
 * `failure-cause-message.test.ts` tests that function thoroughly — against strings the test itself
 * writes down. Its first case is `'ENOENT'`, annotated *"a bare errno, which is what a dead pipe
 * produces"*, and that annotation is an **assumption about a real dependency, stated as fact and
 * never measured**. Nothing anywhere asserted that a real `DaemonClient`, against a real absent
 * pipe, actually rejects with a string the classifier recognises.
 *
 * So the two halves could drift apart silently and the whole suite would stay green:
 *
 *   - Node changes what `connect()` reports for a missing pipe, or reports it on a different
 *     property, and `error.code` arrives `undefined`;
 *   - somebody improves the rejection to a friendly sentence — the kindest-looking change in this
 *     file, and the one that makes the classifier return `false` and put raw text in front of a
 *     user.
 *
 * The unit test keeps passing in both cases, because it never asks the client anything. This asks.
 *
 * ══ WHY IT IS A CONTRACT TEST AND NOT AN E2E ══
 *
 * The claim is "a real socket against a real absent pipe produces a string this rule matches". That
 * needs a real `connect()` — and nothing else. No window, no Electron, no daemon process, no app.
 * `daemon-death-notice.e2e.ts` reaches the same seam by killing a real daemon PROCESS TREE, which is
 * the right way to prove the process half and a very expensive way to prove this half.
 */
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isTransportFailure } from '@throng/core';
import { DaemonClient } from '../../src/main/daemon-client.js';

/**
 * A pipe name nothing is listening on. Unique per test file so a parallel run of another suite
 * cannot accidentally be serving it — which would turn a real failure into a silent pass.
 */
const ABSENT_PIPE = `\\\\.\\pipe\\throng-contract-absent-${process.pid}`;

/** The settings surface `DaemonClient` actually reads, and nothing else. */
function clientFor(pipeName: string, pingTimeoutMs = 2_000): DaemonClient {
  return new DaemonClient({
    pipeName,
    window: { width: 1, height: 1 },
    pingTimeoutMs,
    attachTimeoutMs: pingTimeoutMs,
  } as never);
}

const servers: Server[] = [];

/** A real pipe server that answers every request with `respond(line)`, or never answers if null. */
async function serving(
  pipeName: string,
  respond: ((request: string) => string) | null,
): Promise<void> {
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (respond) socket.write(respond(chunk));
    });
    socket.on('error', () => {
      /* the client destroys its socket on settle; that is not a server fault */
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(pipeName, resolve));
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** The rejection's message, or a marker that makes a wrong-shaped result obvious in the diff. */
async function messageFromCall(client: DaemonClient, method = 'health.ping'): Promise<string> {
  try {
    await client.call(method);
    return '(the call RESOLVED — there was nothing to classify)';
  } catch (error) {
    return error instanceof Error ? error.message : `(rejected with a non-Error: ${String(error)})`;
  }
}

describe('a pipe that is not there', () => {
  it('rejects with a BARE errno — the exact string the unit test assumes', async () => {
    /*
     * The whole point of this file. `failure-cause-message.test.ts` writes `'ENOENT'` down by hand
     * and calls it "what a dead pipe produces"; this is the measurement behind that sentence.
     *
     * Asserted as a SHAPE rather than the literal `ENOENT`, because the errno is the operating
     * system's to choose (a pipe can fail `ENOENT`, and under some conditions `ECONNREFUSED`) and
     * pinning one code would make this a test of Windows rather than of throng. The shape is what
     * `isTransportFailure`'s third rule keys off, and it is what must hold.
     */
    const message = await messageFromCall(clientFor(ABSENT_PIPE));
    expect(message).toMatch(/^E[A-Z]{3,}$/);
  });

  it('produces a message the classifier recognises — the two halves, joined', async () => {
    /*
     * The contract itself. Either half can be changed on its own without this failing; only the
     * PAIR failing to agree fails here, which is exactly the drift that would otherwise show up as
     * a raw errno in front of a user.
     */
    const message = await messageFromCall(clientFor(ABSENT_PIPE));
    expect(isTransportFailure(message)).toBe(true);
  });

  it('does not dress it up as an RPC error, which would carry a code the caller trusts', async () => {
    /*
     * `DaemonRpcError` means the daemon ANSWERED and said no — it has a JSON-RPC code, and callers
     * are entitled to branch on it. A transport failure must never arrive wearing that type, or a
     * caller reads `code` off a daemon that was never reached.
     */
    let caught: unknown;
    try {
      await clientFor(ABSENT_PIPE).call('health.ping');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { name?: string }).name).toBe('Error');
  });
});

describe('a pipe that is there but answers with something else', () => {
  const GARBLED_PIPE = `\\\\.\\pipe\\throng-contract-garbled-${process.pid}`;

  it('reports invalid-response for a reply that is not JSON, and that is a transport failure', async () => {
    /*
     * The other string the classifier knows by name. It is reachable without any daemon at all — a
     * half-written reply, a truncated line — so it belongs beside the absent-pipe case rather than
     * behind a killed process.
     */
    await serving(GARBLED_PIPE, () => 'not json at all\n');

    const message = await messageFromCall(clientFor(GARBLED_PIPE));

    expect(message).toBe('invalid-response');
    expect(isTransportFailure(message)).toBe(true);
  });

  it('reports invalid-response for well-formed JSON carrying neither result nor error', async () => {
    await serving(GARBLED_PIPE, () => `${JSON.stringify({ jsonrpc: '2.0', id: 1 })}\n`);

    const message = await messageFromCall(clientFor(GARBLED_PIPE));

    expect(message).toBe('invalid-response');
    expect(isTransportFailure(message)).toBe(true);
  });

  it('leaves a REAL daemon error alone — it answered, so it is not the transport', async () => {
    /*
     * The anti-vacuity control, and the direction that actually costs the user something. A rule
     * that returned `true` for everything would satisfy every assertion above while relabelling
     * every real refusal as "the daemon has stopped".
     */
    await serving(
      GARBLED_PIPE,
      () =>
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32_000, message: 'A file or folder with this name already exists.' },
        })}\n`,
    );

    const message = await messageFromCall(clientFor(GARBLED_PIPE));

    expect(message).toBe('A file or folder with this name already exists.');
    expect(isTransportFailure(message)).toBe(false);
  });
});

describe('a pipe that is there and never answers', () => {
  const SILENT_PIPE = `\\\\.\\pipe\\throng-contract-silent-${process.pid}`;

  it('times out as its own error type, NOT as a transport failure', async () => {
    /*
     * 008 FR-005: a timeout is deliberately distinct, because the attach path treats an exceeded
     * budget as "the shell is still starting" rather than a hard error — the session may well be
     * coming up. Classifying it as a transport failure would tear down a terminal that was fine.
     */
    await serving(SILENT_PIPE, null);

    let caught: unknown;
    try {
      await clientFor(SILENT_PIPE, 150).call('health.ping');
    } catch (error) {
      caught = error;
    }

    expect((caught as { name?: string }).name).toBe('RpcTimeoutError');
    expect((caught as { timedOut?: boolean }).timedOut).toBe(true);
    expect(isTransportFailure((caught as Error).message)).toBe(false);
  });
});
