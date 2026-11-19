/**
 * 057 — a bell in a terminal the user is not looking at marks it, announces it once, and clicking the
 * toast takes the user there (US1, US2, US3; SC-002).
 *
 * ══ WHAT ONLY THIS LAYER CAN SEE ══
 *
 * Everything is pinned lower: the scanner's grammar (core unit), the mark model and its clear delay
 * (core unit), the daemon's emission and ledger (daemon integration), the service's routing (ui unit),
 * every holder, the toast and the navigation (component). What none of them composes is the PATH: a real
 * shell writing a real BEL through ConPTY, the daemon recognising it in the output stream, main turning
 * it into a mark, every window being told, a project row in the sidebar drawing it, and the toast link
 * crossing a real project switch to land the keyboard in a real terminal. That is `@reserve:runtime`.
 *
 * ══ WHAT IT DOES NOT ASSERT ══
 *
 * OS delivery. A test cannot rely on the window being unfocused, and the OS notification and the taskbar
 * badge are not observable from Playwright; the recording fakes (`THRONG_E2E_ATTENTION_OS=record`) keep
 * the real ones from popping on the developer's desktop, and `attention-service.test.ts` plus the OS
 * port contract tests cover delivery.
 *
 * ══ HOW THE LATENCY IS MEASURED ══
 *
 * SC-002 says the row is marked within one second of the bell. The shell writes its own wall-clock time
 * to a file immediately before it emits the BEL, so the bell's moment is the shell's, not the test's
 * guess at when the wait ended. The measurement is printed on every run.
 *
 * One app for the file, serial: the tests share their projects and a real shell.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  settleOnActiveProject,
  cleanupTemp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  TEST_SHELL,
  TYPE_DELAY,
  type OpenApp,
} from './harness.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let rootA: string;
let rootB: string;
const nameA = 'AttnProjA';
const nameB = 'AttnProjB';

/**
 * The shell that rings: PowerShell on Windows, as this spec has always used, and {@link TEST_SHELL} elsewhere. The
 * subject is throng's attention path, not the shell, so each platform's own shell writes the time and the BEL.
 */
const ON_WINDOWS = process.platform === 'win32';

test.beforeAll(async () => {
  rootA = mkdtempSync(join(tmpdir(), 'throng-attn-a-'));
  rootB = mkdtempSync(join(tmpdir(), 'throng-attn-b-'));
  // The recording fakes: Electron's Notification and overlay icon cannot be observed here, and the real
  // ones would pop on the desktop of whoever runs this.
  shared = await openApp({ env: { THRONG_E2E_ATTENTION_OS: 'record' } });
});

test.afterAll(async () => {
  await shared?.close();
  if (rootA) cleanupTemp(rootA);
  if (rootB) cleanupTemp(rootB);
});

/** The latency SC-002 allows between the bell and the row being marked. */
const SC_002_MS = 1_000;
/** How long the whole path may take, from leaving the project to the row being marked. */
const MARK_TIMEOUT_MS = 24_000;

test('a delayed bell in project A, seen from project B, marks A’s row and raises one toast whose link lands on A’s terminal (US1, US3, SC-002)', { tag: ['@extended', '@terminal', '@reserve:runtime'] }, async () => {
  const { win } = shared;

  // ── Project A with a real shell, started at the prompt ──────────────────────────────────────────
  await createProject(win, nameA, rootA);
  const idA = await settleOnActiveProject(win, nameA);
  const panelA = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${panelA}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption(ON_WINDOWS ? 'windows-powershell' : TEST_SHELL);
  await win.getByTestId(`panel-type-confirm-${panelA}`).click();
  const termA = win.getByTestId(`terminal-${panelA}`);
  await expect(termA).toBeVisible();
  // Keys typed before the prompt is drawn are lost (see the command-launcher spec's `expectPrompt`). A POSIX
  // prompt's shape is the user's, so there it is the project folder the prompt names.
  await expect(termA).toContainText(ON_WINDOWS ? '>' : basename(rootA), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

  // Nothing is marked before anything happens.
  await expect(win.getByTestId(`attention-project-${idA}`)).toHaveCount(0);

  // ── Ask the shell to ring in a few seconds, writing the moment it does to a file ───────────────
  // The shell rings only once the test has left the project (a flag file it polls), so the bell can
  // never beat the switch however slow the machine is, and no fixed delay has to out-wait it.
  const flag = join(rootA, 'left-a.flag');
  const bellAtFile = join(rootA, 'bell-at.txt');
  // POSIX: node writes the time and the BEL in one process, so nothing runs between the two (BSD `date` has no ms).
  // It also does the waiting, and stays running after the bell, so the shell's foreground command is one process
  // from Enter to the end of the test. A shell loop (`while …; do sleep 0.1; done`) forks a child per iteration,
  // and Command finished is a process-snapshot signal (057 FR-065, 025 FR-022): a snapshot between two sleeps,
  // or the line ending a moment after the bell, raises it and replaces the bell's reason (FR-002) — correctly,
  // and nothing this test is about. PowerShell's loop runs in-process and its command line forks nothing.
  const command = ON_WINDOWS
    ? `while (-not (Test-Path -LiteralPath '${flag}')) { Start-Sleep -Milliseconds 100 }; Set-Content -NoNewline -LiteralPath '${bellAtFile}' ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Write([char]7)`
    : `node -e 'const fs = require("fs"); let rang = false; setInterval(() => { if (rang || !fs.existsSync(${JSON.stringify(flag)})) return; rang = true; fs.writeFileSync(${JSON.stringify(bellAtFile)}, String(Date.now())); process.stdout.write("\\x07"); }, 100)'`;
  await termA.click();
  await win.keyboard.type(command, { delay: TYPE_DELAY });
  await expect(termA).toContainText(ON_WINDOWS ? 'Start-Sleep' : 'node -e', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  await win.keyboard.press('Enter');

  // ── Leave: project B is now the one on screen, so A's terminal is not attended ─────────────────
  await createProject(win, nameB, rootB);
  await settleOnActiveProject(win, nameB);
  // When the row is marked, by the page's own wall clock — the same clock the shell's bell time is read from. A
  // test-side poll stamps the moment its round trip to the page came back, which on a loaded Windows runner added
  // a few hundred ms the user never waited (1288 ms measured once against SC-002's 1000).
  await win.evaluate((projectId) => {
    const selector = `[data-testid="attention-project-${projectId}"]`;
    const page = window as unknown as { __attentionMarkedAt?: number };
    page.__attentionMarkedAt = undefined;
    const observer = new MutationObserver(() => {
      if (page.__attentionMarkedAt === undefined && document.querySelector(selector)) {
        page.__attentionMarkedAt = Date.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }, idA);
  writeFileSync(flag, '1');

  // ── The row is marked, and when ─────────────────────────────────────────────────────────────────
  const rowMark = win.getByTestId(`attention-project-${idA}`);
  await expect
    .poll(async () => (await rowMark.count()) > 0, {
      timeout: MARK_TIMEOUT_MS,
      intervals: [50],
      message: 'the bell never marked project A’s row',
    })
    .toBe(true);
  const markedAt = await win.evaluate(() => (window as unknown as { __attentionMarkedAt?: number }).__attentionMarkedAt);
  expect(markedAt, 'the page saw the row’s mark appear').toBeDefined();
  // The mark names the panel and the reason (FR-015), not just that something happened.
  await expect(rowMark).toHaveAttribute('aria-label', /Wants your attention/); // FR-101

  const bellAt = Number(readFileSync(join(rootA, 'bell-at.txt'), 'utf8'));
  const latency = markedAt! - bellAt;
  process.stderr.write(`attention-marks: bell -> row marked ${latency} ms (SC-002 allows ${SC_002_MS})\n`);
  expect(latency, 'the shell’s own clock says when it rang; the row must be marked within SC-002 of that').toBeLessThanOrEqual(SC_002_MS);

  // ── One toast, not one per surface, and not a second for the same bell (FR-035) ────────────────
  const toasts = win.locator('.notice[data-testid^="attention-toast-"]');
  await expect(toasts).toHaveCount(1);
  await expect(win.getByTestId(`attention-toast-${panelA}`)).toBeVisible();

  // ── The card is the link (FR-124): it crosses the project switch and lands the keyboard in A's terminal
  await win.getByTestId(`attention-toast-${panelA}`).getByTestId('notice-body').click();
  await expect(win.getByTestId('workspace-pane')).toHaveAttribute('data-project', idA);
  await expect(termA.locator('textarea')).toBeFocused();

  // Looking at it clears it (FR-005): the row, the panel and the toast all go.
  await expect(win.getByTestId(`attention-project-${idA}`)).toHaveCount(0);
  await expect(win.getByTestId(`attention-panel-${panelA}`)).toHaveCount(0);
  await expect(win.getByTestId(`attention-toast-${panelA}`)).toHaveCount(0);

  // The POSIX command waits on after its bell; end it from the terminal the toast landed in.
  if (!ON_WINDOWS) await win.keyboard.press('Control+C');
});
