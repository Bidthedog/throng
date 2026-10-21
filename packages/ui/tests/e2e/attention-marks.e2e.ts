/**
 * 057 — a bell in a terminal the user is not looking at marks it, announces it once, and the toast's
 * link takes the user there (US1, US2, US3; SC-002).
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
 * guess at when `Start-Sleep` ended. The measurement is printed on every run.
 *
 * One app for the file, serial: the tests share their projects and a real shell.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  settleOnActiveProject,
  cleanupTemp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  TYPE_DELAY,
  type OpenApp,
} from './harness.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let rootA: string;
let rootB: string;
const nameA = 'AttnProjA';
const nameB = 'AttnProjB';

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
/** How long the shell waits before ringing — long enough to leave the project, short of a slow test. */
const BELL_DELAY_S = 4;

test('a delayed bell in project A, seen from project B, marks A’s row and raises one toast whose link lands on A’s terminal (US1, US3, SC-002)', { tag: ['@extended', '@terminal', '@reserve:runtime'] }, async () => {
  const { win } = shared;

  // ── Project A with a real PowerShell, started at the prompt ─────────────────────────────────────
  await createProject(win, nameA, rootA);
  const idA = await settleOnActiveProject(win, nameA);
  const panelA = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${panelA}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  await win.getByTestId(`panel-type-confirm-${panelA}`).click();
  const termA = win.getByTestId(`terminal-${panelA}`);
  await expect(termA).toBeVisible();
  // Keys typed before the prompt is drawn are lost (see the command-launcher spec's `expectPrompt`).
  await expect(termA).toContainText('>', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

  // Nothing is marked before anything happens.
  await expect(win.getByTestId(`attention-project-${idA}`)).toHaveCount(0);

  // ── Ask the shell to ring in a few seconds, writing the moment it does to a file ───────────────
  const command = `Start-Sleep -Seconds ${BELL_DELAY_S}; Set-Content -NoNewline -LiteralPath '${join(rootA, 'bell-at.txt')}' ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Write([char]7)`;
  await termA.click();
  await win.keyboard.type(command, { delay: TYPE_DELAY });
  await expect(termA).toContainText('Start-Sleep', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  await win.keyboard.press('Enter');

  // ── Leave: project B is now the one on screen, so A's terminal is not attended ─────────────────
  await createProject(win, nameB, rootB);
  await settleOnActiveProject(win, nameB);

  // ── The row is marked, and when ─────────────────────────────────────────────────────────────────
  const rowMark = win.getByTestId(`attention-project-${idA}`);
  let markedAt = 0;
  await expect
    .poll(
      async () => {
        const present = (await rowMark.count()) > 0;
        if (present && markedAt === 0) markedAt = Date.now();
        return present;
      },
      { timeout: (BELL_DELAY_S + 20) * 1_000, intervals: [50], message: 'the bell never marked project A’s row' },
    )
    .toBe(true);
  // The mark names the panel and the reason (FR-015), not just that something happened.
  await expect(rowMark).toHaveAttribute('aria-label', /Wants your attention/); // FR-101

  const bellAt = Number(readFileSync(join(rootA, 'bell-at.txt'), 'utf8'));
  const latency = markedAt - bellAt;
  process.stderr.write(`attention-marks: bell -> row marked ${latency} ms (SC-002 allows ${SC_002_MS})\n`);
  expect(latency, 'the shell’s own clock says when it rang; the row must be marked within SC-002 of that').toBeLessThanOrEqual(SC_002_MS);

  // ── One toast, not one per surface, and not a second for the same bell (FR-035) ────────────────
  const toasts = win.locator('.notice[data-testid^="attention-toast-"]');
  await expect(toasts).toHaveCount(1);
  await expect(win.getByTestId(`attention-toast-${panelA}`)).toBeVisible();

  // ── The link crosses the project switch and lands the keyboard in A's terminal ────────────────
  await win.getByTestId(`attention-toast-goto-${panelA}`).click();
  await expect(win.getByTestId('workspace-pane')).toHaveAttribute('data-project', idA);
  await expect(termA.locator('textarea')).toBeFocused();

  // Looking at it clears it (FR-005): the row, the panel and the toast all go.
  await expect(win.getByTestId(`attention-project-${idA}`)).toHaveCount(0);
  await expect(win.getByTestId(`attention-panel-${panelA}`)).toHaveCount(0);
  await expect(win.getByTestId(`attention-toast-${panelA}`)).toHaveCount(0);
});
