import { createRequire } from 'node:module';
import { test } from '@playwright/test';

/**
 * Does THIS machine's console host forward a program's KITTY KEYBOARD NEGOTIATION?
 *
 * A kitty-aware program announces itself by writing `CSI > 1 u` (`\x1b[>1u`) on startup. throng
 * sends the distinct CSI-u encodings for modified keys ONLY to a program it has seen do that —
 * which is correct, because a program that never negotiated must keep receiving the legacy bytes.
 *
 * Whether those bytes reach throng at all is decided by the system ConPTY, not by the program that
 * wrote them. docs/testing.md records the same mechanism for DEC private modes: measured on one
 * machine, under `cmd` the mouse-reporting modes never arrive while 1049 and 1015 do, and the
 * surviving set tracks the host Windows build (#298 — throng uses the SYSTEM ConPTY on purpose, so
 * terminal behaviour follows the OS).
 *
 * Where the negotiation does not survive, throng behaves CORRECTLY by sending legacy encodings, and
 * a test asserting the CSI-u form fails while nothing is wrong with throng. Measured on the gate
 * runner: `terminal-modified-enter`'s win32-input probe passes there, so modified keys ARE
 * delivered — and both kitty specs still capture nothing for a chord, which is the negotiation
 * going missing rather than the keyboard.
 *
 * ── Why a probe rather than a build number ─────────────────────────────────────────────────────
 *
 * `negotiatesWin32Input` in terminal-modified-enter.e2e.ts makes the same argument for the same
 * reason, and it is worth repeating: gating on an OS build would model the cause instead of
 * measuring it, and would keep the test skipped on the day the platform gains the capability. This
 * measures the thing the assertion actually depends on and starts running by itself when it works.
 *
 * node-pty is a plain-Node native module and this is a plain-Node process, so requiring it here is
 * safe — Electron's main process must not.
 */
export async function forwardsKittyNegotiation(): Promise<boolean> {
  const pty = createRequire(import.meta.url)('node-pty') as {
    spawn(
      file: string,
      args: string[],
      opts: Record<string, unknown>,
    ): { onData(cb: (d: string) => void): void; onExit(cb: () => void): void };
  };

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };

    // A one-shot writer that EXITS ON ITS OWN. Deliberately not a shell: nothing has to be killed
    // afterwards, which sidesteps node-pty 1.1.0's Windows kill() reaping a recycled pid (#240) —
    // the failure mode the sibling probe needs a whole `reapProbe` helper to avoid.
    const child = pty.spawn(process.execPath, ['-e', 'process.stdout.write("\\u001b[>1u")'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 20,
      cwd: process.cwd(),
    });

    // 10s: this is one process start and one write, so a host that is going to forward it has done
    // so long before. Timing out means absent, which is the safe answer — it skips a test rather
    // than asserting against a capability the machine does not have.
    const timer = setTimeout(() => done(false), 10_000);

    // Matched WITHOUT the leading ESC: ConPTY may re-emit the sequence with its own framing, and
    // the question is whether the parameterised body survives at all, not whether it is byte-identical.
    const NEGOTIATION = '[>1u';

    let seen = '';
    child.onData((d) => {
      seen += d;
      if (seen.includes(NEGOTIATION)) done(true);
    });
    child.onExit(() => setTimeout(() => done(seen.includes(NEGOTIATION)), 250));
  });
}

/**
 * Skip when this console host swallows the kitty negotiation.
 *
 * The message names what is missing and why the test cannot mean anything here, so a skipped run
 * reads as a capability gap rather than as coverage quietly disappearing.
 */
export async function skipIfConsoleHidesKittyNegotiation(): Promise<void> {
  test.skip(
    !(await forwardsKittyNegotiation()),
    "this console host does not forward a program's kitty keyboard negotiation (CSI > 1 u), so throng never learns the program wants CSI-u encodings and correctly keeps sending the legacy bytes — the distinct sequence this test asserts is not available here to observe; see docs/testing.md on ConPTY and #298",
  );
}
