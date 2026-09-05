import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, TYPE_DELAY } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * #199 — a window opened by a command running in a terminal must come to the FRONT.
 *
 * ══ Why this is E2E, and cannot be anything cheaper ══
 *
 * The assertion is "which top-level window does Windows put in front", which needs a real window, a
 * real desktop foreground, and a real process chain: throng's UI → daemon → conhost → the shell →
 * the command → its window. No layer below this one has a foreground to lose, and the thing under
 * test is precisely whether the OS honours a handoff ACROSS that chain.
 * `packages/core/tests/unit/foreground-handoff.test.ts` pins the part that needs no OS — when throng
 * asks, and what a platform without the concept does — and is deliberately not duplicated here.
 *
 * ══ A titled PowerShell window rather than `az login`, or notepad ══
 *
 * The issue reports `az login`, which needs the Azure CLI installed and a live sign-in. What the bug
 * is actually about is a top-level window created several processes below throng, so any program
 * that opens one reproduces the chain.
 *
 * `notepad` was the obvious choice and does NOT work here, which is worth recording so nobody
 * spends the run rediscovering it: on Windows 11 Notepad is a packaged Store app launched through an
 * app execution alias, and `Start-Process notepad` leaves **no `notepad` process at all** —
 * `Get-Process notepad` finds nothing, so a test watching for one waits out its timeout and reports
 * "the handoff failed" when nothing was ever launched to hand off to.
 *
 * A second `powershell.exe` carrying a known window title has none of those problems: it is
 * guaranteed present (the panel is already running one), its process name is stable, and the title
 * identifies OUR window unambiguously among the several PowerShells a test run has going — which
 * matters, because the panel's own shell is also `powershell.exe`.
 *
 * ══ The grant is off by default under the harness ══
 *
 * `THRONG_E2E_FOREGROUND_HANDOFF=1` turns it on for this spec alone. It is off for every other spec
 * because the grant lets any process take the foreground for a moment, and a suite running several
 * Electron windows would have them stealing focus from one another — throng closes menus on blur, so
 * that is a way to make an unrelated test flake rather than merely a noisy one. This spec is in the
 * SERIAL tier for the same reason, and is the most focus-stealing test in the suite by design: it
 * raises a window over everything on the desktop.
 *
 * ══ What a failure here means, and what it does NOT ══
 *
 * A red does NOT necessarily mean throng is wrong. Windows may simply refuse the handoff — that is
 * the documented risk on the issue, and the reason it was filed as "likely we can't fix this". If
 * this is ever made to run and stays red, the finding is that `AllowSetForegroundWindow` does not
 * survive the chain, and #199's fallback (tell the user a window is waiting) becomes the remaining
 * option. Record the measurement either way; do not delete the test to make the suite green.
 *
 * ══ VERIFIED BY HAND — `az login` opens IN FRONT (2026-09-05) ══
 *
 * The maintainer ran the real case on an interactive desktop and reported the sign-in prompt
 * arriving in front of throng, which is the outcome #199 was filed to get. The handoff works.
 *
 * ══ Why an automated run here may still SKIP, and why that is not a regression ══
 *
 * This spec's first run went red, and the obvious reading — "the handoff does not work" — was
 * WRONG, as the manual verification then proved. Instrumenting it showed `GetForegroundWindow`
 * returning **0 for the entire test, before throng was even launched**: the run had no interactive
 * desktop, so there was no foreground for anything to win, and every assertion would have failed
 * identically whether the grant worked perfectly or was never made.
 *
 * So the skip guard stays, and it is load-bearing rather than an excuse. CI runs this suite
 * elevated and headless; a workstation running the gate unattended may be locked. In all of those
 * the reading is invalid, and a red would report a broken environment while looking exactly like a
 * broken product. On a real desktop the guard passes and the assertion below is live.
 *
 * A SKIP here therefore means "not measured", never "failed" — and after 2026-09-05 it also does
 * not mean "unverified", because a human has measured it once. If this ever goes RED on a machine
 * with a genuine foreground, that IS a regression and the handoff has stopped working.
 */

test.describe.configure({ mode: 'serial' });

/** The window title the launched window carries, so it can be told from the panel's own shell. */
const MARKER = 'THRONG_FG_HANDOFF';

/** What the user types into the terminal panel: open a window, title it, and keep it up. */
const LAUNCH = `Start-Process powershell -ArgumentList '-NoExit','-Command','$Host.UI.RawUI.WindowTitle=''${MARKER}''; Start-Sleep 600'`;

function powershell(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
    timeout: 20_000,
  });
}

/** The pid that owns the foreground window right now, via user32. */
function foregroundPid(): number | null {
  const script = [
    'Add-Type @"',
    'using System;using System.Runtime.InteropServices;',
    'public class FG {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);',
    '}',
    '"@',
    '$h=[FG]::GetForegroundWindow(); $p=0; [void][FG]::GetWindowThreadProcessId($h,[ref]$p); $p',
  ].join('\n');
  try {
    const pid = Number.parseInt(powershell(script).trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Whether this desktop HAS a foreground at all.
 *
 * `GetForegroundWindow` returns NULL when no window holds the foreground — a locked workstation, a
 * disconnected RDP session, or a run whose session is not the interactive one. Measured here on
 * 2026-09-05: a background CI-style run reports pid 0 for the whole test, before throng even starts.
 *
 * That reading cannot adjudicate anything. Every assertion below would fail identically whether the
 * handoff worked perfectly or was never attempted, so the test SKIPS rather than going red — the
 * same rule #365 applies to the performance SLAs, and for the same reason: an assertion made where
 * the reading is invalid does not report a broken product, it reports a broken environment, and
 * nothing downstream can tell those apart.
 */
function hasInteractiveForeground(): boolean {
  const pid = foregroundPid();
  return pid !== null && pid > 0;
}

/** Every pid whose main window carries our marker title. */
function markedPids(): number[] {
  try {
    return powershell(
      `Get-Process | Where-Object { $_.MainWindowTitle -eq '${MARKER}' } | Select-Object -ExpandProperty Id`,
    )
      .split(/\r?\n/)
      .map((l) => Number.parseInt(l.trim(), 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function killMarked(): void {
  for (const pid of markedPids()) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], { timeout: 10_000, stdio: 'ignore' });
    } catch {
      // already gone — the point is that none survives this file, not that we killed it
    }
  }
}

/** Open a PowerShell terminal in the first panel and wait for its prompt. */
async function openTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(root.split(/[\\/]/).pop()!, { timeout: 25_000 });
  await term.click();
  return pid;
}

// One line, deliberately: the budget counter reads the name and the tags with a PER-LINE regex, so a
// wrapped declaration is counted in the total while belonging to no category at all (see
// `wrappedDeclarations` in e2e-budget.json).
// prettier-ignore
test('a window opened by a terminal command comes to the front, not behind throng', { tag: ['@extended', '@terminal', '@window', '@reserve:pty'] }, async () => {
    // An elevated daemon routes terminals through the de-elevated agent, which creates the window at
    // a different integrity level — a different chain from the one this assertion describes, and one
    // the issue calls out separately.
    skipIfElevated();
    // See hasInteractiveForeground: with no foreground on the desktop this test cannot take a valid
    // reading, and a red here would say "throng failed" when it means "nobody was looking".
    test.skip(
      !hasInteractiveForeground(),
      'no interactive foreground on this desktop (locked, disconnected, or a non-interactive session) — the reading would be invalid',
    );
    const root = mkdtempSync(join(tmpdir(), 'throng-fg-'));
    killMarked(); // a window left by an interrupted earlier run must not satisfy the assertion
    try {
      await runApp(
        async (_app, win) => {
          await createProject(win, 'ForegroundHandoff', root);
          const panelId = await openTerminal(win, root);

          /*
           * TYPE_DELAY, not the default. At zero delay the keystrokes race the PTY and arrive out of
           * ORDER — `terminal-link-once.e2e.ts` measured `LINKFENCE1` echoed as `KNFILENCE1` — and a
           * scrambled command opens no window at all, which then reads here as "the handoff failed"
           * rather than "the test typed rubbish". It cost one run of this spec to rediscover.
           */
          await win.keyboard.type(LAUNCH, { delay: TYPE_DELAY });
          // Prove the shell RECEIVED the command before pressing Enter, so a typing race fails as
          // itself rather than as a missing window twenty seconds later.
          await expect(win.getByTestId(`terminal-${panelId}`)).toContainText('Start-Process powershell', {
            timeout: 20_000,
          });
          await win.keyboard.press('Enter');

          // The window exists before anything is claimed about the foreground.
          await expect.poll(() => markedPids().length, { timeout: 30_000 }).toBeGreaterThan(0);
          const opened = markedPids();

          /*
           * The claim: the foreground now belongs to the window the command opened, NOT to throng.
           * Polled because Windows raises it asynchronously, some time after the process exists.
           */
          await expect
            .poll(
              () => {
                const fg = foregroundPid();
                return fg !== null && opened.includes(fg) ? 'the-opened-window' : 'something-else';
              },
              { timeout: 20_000 },
            )
            .toBe('the-opened-window');
        },
        { env: { THRONG_E2E_FOREGROUND_HANDOFF: '1' } },
      );
    } finally {
      killMarked();
      cleanupTemp(root);
    }
});
