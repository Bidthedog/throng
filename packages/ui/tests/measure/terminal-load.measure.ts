import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, openApp, switchProject, TEST_SHELL } from '../e2e/harness.js';

/**
 * 061 FR-060 — what a window pays for terminals it is not showing.
 *
 * A measurement, not a test: it prints numbers and asserts only that the setup happened. It lives
 * outside `tests/e2e` so the lanes, tags and budget never see it. Run it through its own config:
 *
 *   THRONG_MEASURE_BUSY=20 npx playwright test -c packages/ui/tests/measure/playwright.measure.config.ts
 *
 * Output: one JSON line starting `MEASURE `.
 */

const BUSY = Number(process.env.THRONG_MEASURE_BUSY ?? 1);
const SAMPLE_MS = Number(process.env.THRONG_MEASURE_SAMPLE_MS ?? 30_000);
const ECHO_SAMPLES = Number(process.env.THRONG_MEASURE_ECHOES ?? 200);
/** Run a fast emitter in the visible terminal: what batching is for (US3). Echo cannot be read over it. */
const VISIBLE_BUSY = process.env.THRONG_MEASURE_VISIBLE_BUSY === '1';
/** Time how long returning to a terminal that kept 10,000 lines holds the window (Principle XII). */
const REPLAY = process.env.THRONG_MEASURE_REPLAY === '1';

/** Prints numbered lines forever at a steady rate; node, so it behaves the same on every shell. */
const EMITTER = `let n = 0;
setInterval(() => {
  let out = '';
  for (let i = 0; i < 20; i += 1) out += 'busy line ' + (n += 1) + ' ' + 'x'.repeat(60) + '\\n';
  process.stdout.write(out);
}, 20);
`;

/** Read from xterm's buffer, not the DOM: a GPU renderer draws to a canvas, which has no text. */
async function expectTerminalText(win: Page, panelId: string, text: string, timeout = 20_000): Promise<void> {
  await expect
    .poll(() => win.evaluate((id) => window.__throngTerminalLines?.(id).join('\n') ?? '', panelId), { timeout })
    .toContain(text);
}

async function makeShell(win: Page, panelId: string, marker: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expectTerminalText(win, panelId, marker);
}

/** Count output messages main sends to each window. */
async function countSends(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { __sends: number };
    g.__sends = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      const send = w.webContents.send.bind(w.webContents);
      w.webContents.send = (channel: string, ...args: unknown[]): void => {
        if (channel === 'throng:terminal:output') g.__sends += 1;
        send(channel, ...args);
      };
    }
  });
}

async function readSends(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __sends: number }).__sends);
}

/** Percent CPU per process type, averaged across one reading a second. */
async function sampleCpu(app: ElectronApplication, ms: number): Promise<{ main: number; window: number }> {
  return app.evaluate(async ({ app: electronApp }, duration) => {
    electronApp.getAppMetrics(); // the first reading has no interval behind it
    const main: number[] = [];
    const renderer: number[] = [];
    const end = Date.now() + duration;
    while (Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const metrics = electronApp.getAppMetrics();
      main.push(metrics.find((m) => m.type === 'Browser')?.cpu.percentCPUUsage ?? 0);
      renderer.push(metrics.find((m) => m.type === 'Tab')?.cpu.percentCPUUsage ?? 0);
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    return { main: mean(main), window: mean(renderer) };
  }, ms);
}

/** Time from a key press to the character appearing in the terminal's rows, per character. */
async function echoLatencies(win: Page, panelId: string): Promise<number[]> {
  const term = win.getByTestId(`terminal-${panelId}`);
  await term.click();
  const out: number[] = [];
  for (let i = 0; i < ECHO_SAMPLES; i += 1) {
    const before = await term.innerText();
    const started = Date.now();
    await win.keyboard.type('q');
    await expect.poll(async () => (await term.innerText()) !== before, { intervals: [1], timeout: 5000 }).toBe(true);
    out.push(Date.now() - started);
    // sleep-justified: typing cadence. A key in a sustained stream of echoes joins a batch; a person's next key does not.
    await win.waitForTimeout(60);
  }
  await win.keyboard.press('Control+U');
  return out;
}

/** A chunk a millisecond: far more chunks than a display has frames. */
const FAST_EMITTER = "let n = 0; setInterval(() => console.log('fast line ' + (n += 1)), 1);\n";

/** Prints 20,000 lines and stops. */
const LONG_PRINT = "for (let i = 1; i <= 20000; i += 1) console.log('kept line ' + i + ' ' + 'x'.repeat(60));\n";

/** Longest main-thread task while returning to a project holding a full buffer. */
async function worstReplayTask(win: Page, root: string): Promise<number> {
  const dir = join(root, 'replay');
  mkdirSync(dir);
  writeFileSync(join(dir, 'print.cjs'), LONG_PRINT);
  await createProject(win, 'Replay', dir);
  const panelId = await firstPanelId(win);
  await makeShell(win, panelId, basename(dir));
  await win.getByTestId(`terminal-${panelId}`).click();
  await win.keyboard.type('node print.cjs');
  await win.keyboard.press('Enter');
  await expectTerminalText(win, panelId, 'kept line 20000', 60_000);
  await switchProject(win, 'Visible');
  await win.evaluate(() => {
    const g = globalThis as unknown as { __longest: number };
    g.__longest = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) g.__longest = Math.max(g.__longest, entry.duration);
    }).observe({ entryTypes: ['longtask'] });
  });
  await switchProject(win, 'Replay');
  await expectTerminalText(win, panelId, 'kept line 20000', 30_000);
  // sleep-justified: MEASUREMENT WINDOW, so the observer reports the replay's last task.
  await win.waitForTimeout(1500);
  return win.evaluate(() => (globalThis as unknown as { __longest: number }).__longest);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

test('terminal load', async () => {
  test.setTimeout(30 * 60_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-measure-'));
  const h = await openApp();
  try {
    const { app, win } = h;
    for (let i = 0; i < BUSY; i += 1) {
      const dir = join(root, `busy-${i}`);
      mkdirSync(dir);
      writeFileSync(join(dir, 'emit.cjs'), EMITTER);
      await createProject(win, `Busy${i}`, dir);
      const panelId = await firstPanelId(win);
      await makeShell(win, panelId, basename(dir));
      await win.getByTestId(`terminal-${panelId}`).click();
      await win.keyboard.type('node emit.cjs');
      await win.keyboard.press('Enter');
      await expectTerminalText(win, panelId, 'busy line');
    }

    const visibleDir = join(root, 'visible');
    mkdirSync(visibleDir);
    await createProject(win, 'Visible', visibleDir);
    const visible = await firstPanelId(win);
    await makeShell(win, visible, basename(visibleDir));
    if (VISIBLE_BUSY) {
      writeFileSync(join(visibleDir, 'fast.cjs'), FAST_EMITTER);
      await win.getByTestId(`terminal-${visible}`).click();
      await win.keyboard.type('node fast.cjs');
      await win.keyboard.press('Enter');
      await expectTerminalText(win, visible, 'fast line');
    }

    await countSends(app);
    const cpu = await sampleCpu(app, SAMPLE_MS);
    const sends = await readSends(app);
    const echoes = VISIBLE_BUSY ? [] : await echoLatencies(win, visible);
    const replayLongestTaskMs = REPLAY ? Math.round(await worstReplayTask(win, root)) : undefined;

    let failures = 0;
    for (let i = 0; i < Math.min(BUSY, 10); i += 1) {
      await switchProject(win, `Busy${i}`).catch(() => {
        failures += 1;
      });
      await switchProject(win, 'Visible').catch(() => {
        failures += 1;
      });
    }

    console.log(
      `MEASURE ${JSON.stringify({
        busy: BUSY,
        sampleMs: SAMPLE_MS,
        windowMessagesPerSecond: Math.round((sends / SAMPLE_MS) * 1000),
        mainCpuPercent: Number(cpu.main.toFixed(1)),
        windowCpuPercent: Number(cpu.window.toFixed(1)),
        echoP50Ms: percentile(echoes, 50),
        echoP95Ms: percentile(echoes, 95),
        projectSwitchFailures: failures,
        visibleBusy: VISIBLE_BUSY,
        replayLongestTaskMs,
      })}`,
    );
  } finally {
    await h.close();
    cleanupTemp(root);
  }
});
