import { describe, it, expect } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import process from 'node:process';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { encodeLine, type AgentCommand } from '../../src/pty-agent-protocol.js';

/**
 * Issue #94 — "Elevated throng hangs when opening a non-elevated terminal panel".
 *
 * An unchecked (non-admin) terminal on an ELEVATED daemon is routed to the
 * de-elevated PTY agent (terminal-service.ts:182-187 `hostFor`, composition-root.ts:142-148).
 * The de-elevated launch is FIRE-AND-FORGET and its failures are unobservable:
 * `WindowsDeElevatedLauncher.launch` spawns the PowerShell/CreateProcessWithTokenW shim
 * with `stdio: 'ignore'` and `.unref()`s it (windows-de-elevated-launcher.ts:31-34),
 * returning `void` — if the shim throws, nobody learns.
 *
 * `PtyAgentHost` then connects DOWN to the agent's pipe with a retry loop bounded by a
 * 15s deadline (pty-agent-host.ts:36, 65). When that deadline expires the retry simply
 * STOPS (pty-agent-host.ts:67-74): no callback fires, no error is published, nothing is
 * torn down. Meanwhile `start()` is optimistic — it mints a synthetic handle and queues
 * the command in `this.outbox` (pty-agent-host.ts:93-97, 139-152) — so `TerminalService.attach`
 * returns `{ status: 'running' }` immediately and the panel clears its "still starting"
 * state (use-terminal.ts:361). The result is a panel that believes it is running, forever,
 * with no prompt and no error: the reported hang.
 *
 * These tests pin the requirement stated in the issue:
 *
 *   "Whatever the cause, the panel needs a timeout/failure path so a stuck launch
 *    surfaces as an error rather than an indefinite hang."
 *
 * They are asserted at the `PtyAgentHost` seam because that is the layer that already
 * owns the panel-visible failure path: its `ev: 'error'` branch (pty-agent-host.ts:123-129)
 * and `failAllLive` (pty-agent-host.ts:78-84) both surface a message on `onData` + a
 * non-zero `onExit`, which `TerminalService` publishes as `terminal.output` +
 * `terminal.exit` and the panel renders as a visible error (FR-019/FR-020). A stuck
 * launch MUST reach that same path.
 *
 * NOTE ON ELEVATION: these tests need NO elevation. They substitute the launch seam,
 * so they reproduce the *silence* — the absence of any timeout/failure path — which is
 * the testable half of #94 and the half the fix must satisfy. The live end-to-end repro
 * (elevated throng → non-elevated panel) requires an elevated host and is covered by the
 * @admin E2E in packages/ui/tests/e2e/terminal-de-elevation-hang.e2e.ts.
 *
 * EXPECTED TO FAIL until #94 is fixed.
 */

let seq = 0;
function uniquePipe(): string {
  seq += 1;
  return `\\\\.\\pipe\\throng-test-hang-${process.pid}-${Date.now()}-${seq}`;
}

function startOpts() {
  return { file: 'cmd.exe', args: [] as string[], cwd: 'C:\\', cols: 80, rows: 24 };
}

/**
 * The ONLY launch/readiness budget that exists anywhere in the de-elevated path today:
 * the connect-retry deadline in `PtyAgentHost` (pty-agent-host.ts:36). Nothing observes
 * its expiry, which is precisely the defect. Tests wait past it plus a grace, so a
 * failure here cannot be "it just needed longer".
 */
const CONNECT_DEADLINE_MS = 15_000;
const GRACE_MS = 3_000;

/**
 * A deliberately short readiness budget for the slow-shell scenario, injected at the host's
 * constructor seam (Principle X — the host never reads the environment itself; production
 * binds these from `IDaemonSettings` in the daemon's composition root). Waiting out the real
 * 15s default would prove the same thing at 7x the cost.
 */
const SHORT_READY_MS = 2_000;

/**
 * A deliberately short CONNECT budget, injected at the same seam, for the scenarios that must
 * wait for the deadline to lapse *before* they do anything. Waiting out the real 15s would
 * prove the same thing at 30x the cost.
 */
const SHORT_CONNECT_MS = 500;

/** The two lapse routes' messages, which MUST stay distinguishable (C7). */
const CONNECT_LAPSE = /de-elevated terminal agent never started/;
const READY_LAPSE = /\[throng\] the terminal never started/;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What the panel would actually see: output chunks and/or an exit. */
interface PanelSignals {
  readonly chunks: string[];
  readonly exits: Array<{ code: number | null }>;
}

/** Resolves as soon as the host surfaces ANYTHING panel-visible, else after `ms`. */
function waitForSignal(signals: PanelSignals, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (signals.chunks.length > 0 || signals.exits.length > 0 || Date.now() - started >= ms) {
        clearInterval(tick);
        resolve();
      }
    }, 50);
  });
}

describe('#94 — a stuck de-elevated launch must surface an error, not hang forever', () => {
  it(
    'surfaces a failure when the de-elevated agent never connects',
    async () => {
      // No pipe server is ever created and `launch` does nothing — exactly the
      // production shape of a de-elevated launch that silently failed, because
      // WindowsDeElevatedLauncher.launch is fire-and-forget over `stdio: 'ignore'`
      // (windows-de-elevated-launcher.ts:31-34) and cannot report a failed
      // CreateProcessWithTokenW back to the daemon.
      const pipe = uniquePipe();
      let launches = 0;
      const host = new PtyAgentHost(pipe, () => {
        launches += 1;
      });
      expect(launches, 'the host must have attempted the de-elevated launch').toBe(1);

      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      // Wait past the host's own 15s connect deadline. Once it lapses, the retry loop
      // stops (pty-agent-host.ts:71-74) and the host has *conclusively established*
      // that the agent will never arrive — it must not keep this to itself.
      await waitForSignal(signals, CONNECT_DEADLINE_MS + GRACE_MS);

      // TODAY: both are empty. The start command sits in `outbox` forever, the panel
      // shows a blank terminal with no prompt and no error — issue #94's hang.
      expect(
        signals.exits.length,
        'a terminal whose agent never connected must be reported as exited, so the panel reverts (FR-020) instead of hanging',
      ).toBeGreaterThan(0);
      // The exit CODE is the whole point of C27/C28: `code: null` renders "Terminal exited
      // (code —)" (terminal-panel.tsx:158), the shape of an ordinary end. FR-012 demands a
      // VISIBLE, actionable failure, so this route — and only this route — passes 1.
      expect(
        signals.exits,
        "the connect lapse must exit NON-ZERO (C27/C28), so the panel renders a failure and not an ordinary end",
      ).toEqual([{ code: 1 }]);
      expect(
        signals.chunks.join(''),
        'the panel must be told, in the terminal, why the launch failed (FR-019)',
      ).toMatch(/throng/i);
      // Distinct per route (C7): /throng/i matches BOTH lapse messages, so it cannot tell a
      // connect lapse from a readiness lapse — and a readiness timer armed at start() would
      // sail through this test while destroying C7 ("readiness starts at CONNECT").
      expect(
        signals.chunks.join(''),
        'an agent that never CONNECTED is the connect lapse — not the readiness lapse (C7)',
      ).toMatch(CONNECT_LAPSE);
      expect(signals.chunks.join('')).not.toMatch(READY_LAPSE);

      host.dispose();
    },
    CONNECT_DEADLINE_MS + GRACE_MS + 7_000,
  );

  it(
    'surfaces a failure when the agent connects but never reports the terminal started',
    async () => {
      // The other hypothesis in the issue: the handoff *does* produce a live agent, but
      // the terminal never becomes usable (no output is ever pumped back). The protocol
      // already defines the readiness ack for exactly this — `{ ev: 'started'; key; pid }`
      // (pty-agent-protocol.ts:26) — but PtyAgentHost DISCARDS it unhandled
      // (pty-agent-host.ts:133-135) and nothing waits for it. So an agent that accepts a
      // `start` and then goes quiet hangs the panel just as hard.
      const pipe = uniquePipe();
      const received: AgentCommand[] = [];
      const sockets: Socket[] = [];
      const server: Server = createServer((sock) => {
        sockets.push(sock);
        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line) received.push(JSON.parse(line) as AgentCommand);
          }
        });
        sock.on('error', () => {
          /* peer reset — ignore */
        });
        // Deliberately never reply: no 'started', no 'data', no 'exit'. The agent is
        // alive (so the 'close' → failAllLive path never triggers) but the terminal
        // behind it never comes up.
      });
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(pipe, resolve);
      });

      const host = new PtyAgentHost(pipe, () => {});
      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      await waitForSignal(signals, CONNECT_DEADLINE_MS + GRACE_MS);

      // Sanity: this scenario really is "connected but never ready" — not a repeat of
      // the first test. The start DID reach the agent.
      expect(
        received.some((c) => c.op === 'start'),
        'the start command must have reached the (live) agent',
      ).toBe(true);

      // TODAY: nothing fires. There is no readiness budget on a start, so a terminal
      // that never comes up is indistinguishable from one that is merely idle.
      expect(
        signals.exits.length,
        'a start that is never acknowledged (no `started` ack, no output) must time out into a visible failure, not hang',
      ).toBeGreaterThan(0);
      expect(
        signals.exits,
        'the readiness lapse must exit NON-ZERO, matching the `ev:"error"` branch it borrows its shape from',
      ).toEqual([{ code: 1 }]);
      expect(
        signals.chunks.join(''),
        'the panel must be told, in the terminal, that the terminal never started (FR-019)',
      ).toMatch(/throng/i);
      // Distinct per route: an agent that CONNECTED and then went quiet is the readiness
      // lapse, never the connect lapse.
      expect(
        signals.chunks.join(''),
        'a connected-but-silent agent is the readiness lapse — not the connect lapse (C7)',
      ).toMatch(READY_LAPSE);
      expect(signals.chunks.join('')).not.toMatch(CONNECT_LAPSE);

      host.dispose();
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    CONNECT_DEADLINE_MS + GRACE_MS + 7_000,
  );

  it(
    'surfaces a failure on a terminal started AFTER the connect deadline has already lapsed',
    async () => {
      // PRODUCTION'S ORDERING, which the two tests above invert. `new PtyAgentHost(...)` is
      // constructed EAGERLY in `createDaemonContainer()` (composition-root.ts:151), which
      // `main()` calls at daemon BOOT (main.ts:16) — so the connect deadline starts ticking at
      // boot, long before any terminal exists. The user adds a de-elevated Terminal minutes
      // later. The tests above call `start()` in the same tick as the constructor, so the key
      // is live for the whole connect budget and the lapse finds it; production's lapse fires
      // into an EMPTY `liveKeys`/`dataCbs`/`exitCbs` and does nothing at all. Because
      // `deElevatedPty` is a process-lifetime singleton, that is permanent for the session:
      // every terminal opened from then on hangs forever. That is #94, verbatim.
      const pipe = uniquePipe();
      const host = new PtyAgentHost(pipe, () => {}, {
        connectMs: SHORT_CONNECT_MS,
        readyMs: SHORT_READY_MS,
      });

      // Boot → lapse, with NO terminal live. Nothing is watching; nothing may be lost.
      await delay(SHORT_CONNECT_MS + GRACE_MS);

      // ...and only NOW does the user add a terminal. FR-012 must hold for a terminal opened
      // at ANY time after the lapse, not merely one that happened to be live at that instant.
      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      await waitForSignal(signals, SHORT_READY_MS * 3);

      expect(
        signals.exits,
        'a terminal started after the host gave up on the agent must fail visibly (FR-012), not hang forever',
      ).toEqual([{ code: 1 }]);
      expect(
        signals.chunks.join(''),
        'the panel must be told why: the agent never arrived, so this is the connect lapse',
      ).toMatch(CONNECT_LAPSE);

      host.dispose();
    },
    SHORT_CONNECT_MS + GRACE_MS + SHORT_READY_MS * 3 + 7_000,
  );

  it(
    'still surfaces a launch reason that arrives AFTER the deadline lapsed (FR-015)',
    async () => {
      // `launchReason` is written ASYNCHRONOUSLY, from the launcher's `child.on('exit')` — and
      // the de-elevated shim must `Add-Type`-compile its C# before it can fail (the contract
      // test budgets 30s for exactly that). Read the field once, at the lapse instant, and a
      // reason that lands a moment late is silently discarded: a quieter `stdio: 'ignore'`,
      // which is the very thing FR-015 exists to end. CI injects
      // THRONG_AGENT_CONNECT_TIMEOUT_MS=8000, so the run designed to expose this is the run
      // most likely to drop it.
      const pipe = uniquePipe();
      let report: ((reason: string) => void) | undefined;
      const host = new PtyAgentHost(
        pipe,
        (_pipe, r) => {
          report = r;
        },
        { connectMs: SHORT_CONNECT_MS, readyMs: SHORT_READY_MS },
      );

      // The deadline lapses while the shim is still compiling: no reason exists yet.
      await delay(SHORT_CONNECT_MS + GRACE_MS);
      // The shim finally dies and says why — too late for the lapse, in time for the user.
      report?.('CreateProcessWithTokenW failed: 1314');

      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      await waitForSignal(signals, SHORT_READY_MS * 3);

      expect(
        signals.chunks.join(''),
        'a late-arriving launch reason must still reach the user (FR-015) — it is the only thing that says WHY',
      ).toMatch(/CreateProcessWithTokenW failed: 1314/);

      host.dispose();
    },
    SHORT_CONNECT_MS + GRACE_MS + SHORT_READY_MS * 3 + 7_000,
  );

  it(
    'does not attribute a previous launch attempt’s reason to a later lapse',
    async () => {
      // The crash path relaunches (C8 permits it: a *crashed* agent may come back). If launch
      // #1's reason is still in the field, launch #2's lapse message quotes a failure that
      // belongs to a different process — a confidently wrong explanation, worse than none.
      const pipe = uniquePipe();
      const sockets: Socket[] = [];
      const server: Server = createServer((sock) => {
        sockets.push(sock);
        sock.setEncoding('utf8');
        sock.on('error', () => {
          /* peer reset — ignore */
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(pipe, resolve);
      });

      const reports: Array<(reason: string) => void> = [];
      const host = new PtyAgentHost(
        pipe,
        (_pipe, r) => {
          reports.push(r);
        },
        { connectMs: SHORT_CONNECT_MS, readyMs: SHORT_READY_MS },
      );
      // Launch #1 connects, then reports a failure of its own (e.g. a stray shim exit).
      await delay(SHORT_CONNECT_MS);
      reports[0]?.('launch #1 died: exit 5');

      // The agent's connection drops → the host relaunches (C8). Launch #2 reports NOTHING,
      // and no server is listening any more, so its connect budget lapses in silence.
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await delay(SHORT_CONNECT_MS + GRACE_MS);

      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      await waitForSignal(signals, SHORT_READY_MS * 3);

      expect(
        signals.chunks.join(''),
        "launch #2's lapse must not quote launch #1's reason",
      ).not.toMatch(/launch #1 died/);
      expect(
        signals.chunks.join(''),
        'the lapse must still be reported — just without a borrowed explanation',
      ).toMatch(CONNECT_LAPSE);

      host.dispose();
      for (const s of sockets) s.destroy();
    },
    SHORT_CONNECT_MS * 2 + GRACE_MS + SHORT_READY_MS * 3 + 7_000,
  );

  it(
    'does NOT kill a terminal that acked `started` and has simply produced no output yet (AC4)',
    async () => {
      // The prohibition that bounds the two tests above. A readiness budget is only safe if
      // it waits for the ACK the protocol defines (`{ev:'started'}`, pty-agent-protocol.ts:26)
      // rather than for FIRST OUTPUT: a legitimately slow shell that has printed nothing is
      // still starting, and killing it would trade #94's hang for a worse bug — terminals
      // that die on their own users. So: ack, then total silence for well past the readiness
      // budget, and nothing may happen.
      const pipe = uniquePipe();
      const sockets: Socket[] = [];
      const server: Server = createServer((sock) => {
        sockets.push(sock);
        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const cmd = JSON.parse(line) as AgentCommand;
            // Ack the start — the ConPTY is up — and then say NOTHING. No data, no exit.
            if (cmd.op === 'start') sock.write(encodeLine({ ev: 'started', key: cmd.key, pid: 4242 }));
          }
        });
        sock.on('error', () => {
          /* peer reset — ignore */
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(pipe, resolve);
      });

      // A SHORT readiness budget, injected: this scenario costs ~2s rather than 15, and the
      // budget it must not fire is unambiguously lapsed by the time we assert.
      const host = new PtyAgentHost(pipe, () => {}, { connectMs: 5_000, readyMs: SHORT_READY_MS });
      const handle = host.start(startOpts());
      const signals: PanelSignals = { chunks: [], exits: [] };
      host.onData(handle, (chunk) => signals.chunks.push(chunk));
      host.onExit(handle, (e) => signals.exits.push(e));

      // Wait well past the readiness budget. `waitForSignal` returns EARLY on any signal, so
      // a violation is caught immediately rather than after the full wait.
      await waitForSignal(signals, SHORT_READY_MS * 3);

      expect(
        signals.exits,
        'an acked terminal that is merely slow to print must NOT be exited — readiness is the ack, never first output',
      ).toEqual([]);
      expect(
        signals.chunks.join(''),
        'an acked terminal that is merely slow to print must NOT have an error painted into it',
      ).not.toMatch(/throng/i);

      host.dispose();
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    SHORT_READY_MS * 3 + 7_000,
  );
});
