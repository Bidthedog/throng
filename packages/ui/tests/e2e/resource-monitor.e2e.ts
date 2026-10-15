import { mkdtempSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, openApp, runTypedCommand, TERMINAL_OUTPUT_TIMEOUT_MS } from './harness.js';
import type { OpenApp } from './harness.js';
import { expectWithinSla, noteSlaNotMeasured, slaMeasurable } from './helpers/sla.js';

/**
 * The Resource Monitor in a real window (055): the status-bar totals (US1), the modal and its drill-down
 * (US2), and the cost of having it open (SC-003).
 *
 * Layer: E2E, because each claim is about a real process tree and a real window — the figures come from
 * the OS, the busy loop is a real `node.exe` under a real shell under a real ConPTY, and "no input waits"
 * is Chromium's own event timing. Everything the figures are MADE of (roll-up, bands, ordering, estimates)
 * is pinned below this layer in core unit and component tests; this holds only what cannot be composed
 * there. One app is shared by the file (serial): a project, one terminal.
 *
 * Run it: `npx playwright test packages/ui/tests/e2e/resource-monitor.e2e.ts --workers=1`
 */
test.describe.configure({ mode: 'serial' });

let h: OpenApp;
let root: string;
let panelId: string;

const term = (win: Page): Locator => win.getByTestId(`terminal-${panelId}`);

/** A "12.3%"-shaped figure as a number. Under 100, so no digit grouping can be in the way. */
const percent = (text: string): number => Number.parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));

async function cpuFigure(win: Page): Promise<number> {
  return percent(await win.getByTestId('status-resources-cpu').innerText());
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-resmon-'));
  h = await openApp();
  const { win } = h;
  await createProject(win, 'Monitor', root);
  panelId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(term(win)).toBeVisible();
  // A live shell, proved by an answer the command line itself does not contain.
  await runTypedCommand(win, term(win), 'set /a 40+2', { echoed: 'set /a 40+2', output: '42' });
});

test.afterAll(async () => {
  await h.close();
  cleanupTemp(root);
});

test('the status bar shows numeric CPU and memory within 5 s, and a busy loop in a terminal raises CPU', { tag: ['@core', '@window', '@reserve:process'] }, async () => {
  const { win } = h;
  const cpu = win.getByTestId('status-resources-cpu');
  const memory = win.getByTestId('status-resources-memory');
  await expect(cpu).toHaveText(/\d/, { timeout: 5000 });
  await expect(memory).toHaveText(/\d/, { timeout: 5000 });

  // not-a-clock: 100 bounds a percentage-of-machine figure to a valid reading, not a duration.
  // Let a reading or two settle so "before" is the idle shell, not the first sample's noise.
  await expect.poll(() => cpuFigure(win), { timeout: 10_000 }).toBeLessThan(100);
  const before = await cpuFigure(win);

  // One core spinning is 100 / logicalProcessors percent of the machine; half of that is unmistakable.
  const cores = cpus().length;
  const floor = Math.max(before + 50 / cores, 0.5);

  await runTypedCommand(win, term(win), 'node -e "for(;;){}"', { echoed: 'for(;;)', output: 'for(;;)' });
  // "Within two intervals" at the shipped 2 s is 4 s; the first reading after a spawn is a rate from one
  // sample, so allow for the interval to elapse twice and then some on a loaded machine.
  await expect.poll(() => cpuFigure(win), { timeout: 20_000, message: `CPU stayed under ${floor}% with a busy loop running` }).toBeGreaterThan(floor);

  // End the loop so the later tests measure a quiet machine.
  await term(win).click();
  await win.keyboard.press('Control+C');
  await expect.poll(() => cpuFigure(win), { timeout: 20_000 }).toBeLessThan(floor);
});

/** The node's own figure plus its children's rolled figures must be its rolled figure (SC-006). */
type Value = number | { kind: string };
interface Node {
  id: string;
  label: string;
  own: Record<string, Value>;
  rolled: Record<string, Value>;
  children: Node[];
}

function rollUpMismatches(node: Node, out: string[] = []): string[] {
  for (const metric of ['cpu', 'memory', 'gpu', 'ioRead', 'ioWrite']) {
    const own = node.own[metric];
    const rolled = node.rolled[metric];
    const parts = node.children.map((c) => c.rolled[metric]);
    if (typeof own !== 'number' || typeof rolled !== 'number' || !parts.every((p) => typeof p === 'number')) continue;
    const sum = (own as number) + (parts as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - rolled) > Math.max(1e-6, Math.abs(rolled) * 1e-9)) {
      out.push(`${node.id} ${metric}: rolled ${rolled} !== own + children ${sum}`);
    }
  }
  for (const c of node.children) rollUpMismatches(c, out);
  return out;
}

test('Ctrl+Shift+Alt+R opens the monitor; Projects to the busy process is four clicks from the status bar, every level adds up, and Esc closes', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const { win } = h;
  const dialog = win.getByTestId('monitor-dialog');

  // A process to find: an idle node under the terminal's shell.
  await runTypedCommand(win, term(win), 'node -e "setInterval(function(){},1000)"', { echoed: 'setInterval', output: 'setInterval' });

  // The chord opens it, with the first reading in (FR-051).
  await win.keyboard.press('Control+Shift+Alt+R');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  // Esc closes it, and the keyboard goes back to where it was.
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // SC-005: click 1 — the status-bar item.
  await win.getByTestId('status-resources').click();
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });

  // First view carries both halves (FR-020b): throng's own components and the user's projects.
  await expect(win.getByTestId('breakdown-section-components')).toBeVisible();
  const projects = win.getByTestId('breakdown-section-projects');
  await expect(projects).toBeVisible();

  // Clicks 2, 3 and 4: the project, its tab, its panel.
  await projects.locator('[data-testid^="treemap-tile-p:"]').first().click();
  await win.locator('[data-testid^="treemap-tile-t:"]').first().click();
  await win.locator('[data-testid^="treemap-tile-n:"]').first().click();

  // Four clicks in, the panel's processes are listed: the shell and the node under it.
  const nodeRow = win.locator('[data-testid^="breakdown-row-x:"]', { hasText: 'node.exe' }).first();
  await expect(nodeRow).toBeVisible({ timeout: 15_000 });
  await expect(win.getByTestId('breadcrumb')).toContainText('Monitor');

  // SC-006, on a real hierarchy: a second subscription takes one frame as the app produced it.
  const frame = await win.evaluate(
    () =>
      new Promise<{ hierarchy: unknown }>((resolve) => {
        const api = (window as unknown as { throng: { resources: { subscribeDetail: () => Promise<{ subscriptionId: number }>; unsubscribeDetail: (id: number) => Promise<void>; onDetail: (cb: (f: { hierarchy: unknown }) => void) => () => void } } }).throng.resources;
        let id: number | null = null;
        let off: () => void = () => {};
        off = api.onDetail((f) => {
          off();
          if (id !== null) void api.unsubscribeDetail(id);
          resolve(f);
        });
        void api.subscribeDetail().then((s) => {
          id = s.subscriptionId;
        });
      }),
  );
  expect(rollUpMismatches(frame.hierarchy as Node)).toEqual([]);

  // Esc closes the dialog again.
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await term(win).click();
  await win.keyboard.press('Control+C');
});

/** Echo latencies for `n` keystrokes into `terminal`, each from the page's own keydown to the glyph's paint. */
async function echoLatencies(win: Page, terminal: Locator, n: number): Promise<number[]> {
  await terminal.click();
  await win.evaluate(() => {
    const w = window as unknown as { __echo?: { down: number[]; seen: { at: number; count: number }[]; stop: () => void } };
    const host = document.querySelector('.xterm-rows') ?? document.body;
    const count = (): number => (host.textContent?.match(/x/g) ?? []).length;
    const state = { down: [] as number[], seen: [] as { at: number; count: number }[], stop: () => {} };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'x') state.down.push(performance.now());
    };
    const mo = new MutationObserver(() => state.seen.push({ at: performance.now(), count: count() }));
    mo.observe(host, { subtree: true, childList: true, characterData: true });
    document.addEventListener('keydown', onKey, true);
    state.stop = () => {
      mo.disconnect();
      document.removeEventListener('keydown', onKey, true);
    };
    w.__echo = state;
  });
  for (let i = 0; i < n; i += 1) {
    await win.keyboard.press('x');
    // One keystroke's echo is over before the next is sent: the claim is per keystroke, not throughput.
    await win.waitForFunction(
      (want) => (window as unknown as { __echo: { seen: { count: number }[] } }).__echo.seen.some((s) => s.count >= want),
      i + 1,
      { timeout: TERMINAL_OUTPUT_TIMEOUT_MS },
    );
  }
  const result = await win.evaluate(() => {
    const w = window as unknown as { __echo: { down: number[]; seen: { at: number; count: number }[]; stop: () => void } };
    w.__echo.stop();
    return { down: w.__echo.down, seen: w.__echo.seen };
  });
  // Erase what was typed.
  await win.keyboard.press('Control+C');
  return result.down.map((d, i) => {
    const echo = result.seen.find((s) => s.at >= d && s.count >= i + 1);
    return echo === undefined ? Number.NaN : echo.at - d;
  });
}

const median = (xs: number[]): number => {
  const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

test('having the monitor open does not slow typing: terminal echo is within 5% of its median with detail collection on, and no keystroke in the monitor waits over 50 ms', { tag: ['@extended', '@terminal', '@reserve:input'] }, async (_args, testInfo) => {
  const { win } = h;
  test.setTimeout(120_000);

  // Baseline: the terminal's echo with nothing collecting beyond the status bar's totals.
  const baseline = median(await echoLatencies(win, term(win), 30));

  // Detail collection ON — the collector walking and describing every process each tick, frames flowing
  // to this window — with the terminal still the thing being typed into.
  await win.evaluate(async () => {
    const api = (window as unknown as { throng: { resources: { subscribeDetail: () => Promise<{ subscriptionId: number }> } } }).throng.resources;
    const { subscriptionId } = await api.subscribeDetail();
    (window as unknown as { __detailSub: number }).__detailSub = subscriptionId;
  });
  const withDetail = median(await echoLatencies(win, term(win), 30));
  await win.evaluate(async () => {
    const w = window as unknown as { __detailSub: number; throng: { resources: { unsubscribeDetail: (id: number) => Promise<void> } } };
    await w.throng.resources.unsubscribeDetail(w.__detailSub);
  });

  expect(Number.isNaN(baseline) || Number.isNaN(withDetail), 'an echo was never observed').toBe(false);
  expectWithinSla(testInfo, {
    what: 'median terminal echo with detail collection on, against its median with it off',
    requirement: '055 SC-003',
    // 5% over the baseline, as the success criterion says.
    elapsedMs: Math.round(withDetail * 100) / 100,
    budgetMs: Math.round(baseline * 1.05 * 100) / 100 + 0.01,
  });

  // With the dialog itself open and frames arriving, typing in it must never wait over 50 ms: Chromium's
  // own event timing for the keydowns, which covers input delay, handlers and the next paint.
  await win.keyboard.press('Control+Shift+Alt+R');
  await expect(win.getByTestId('monitor-dialog')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await win.evaluate(() => {
    const w = window as unknown as { __events: number[]; __eventObserver: PerformanceObserver };
    w.__events = [];
    w.__eventObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'keydown') w.__events.push(e.duration);
    });
    w.__eventObserver.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    const f = window as unknown as { __frames: number; __framesOff: () => void; throng: { resources: { onDetail: (cb: () => void) => () => void } } };
    f.__frames = 0;
    f.__framesOff = f.throng.resources.onDetail(() => void (f.__frames += 1));
  });
  const frames = () => win.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await win.getByTestId('monitor-filter').click();
  // Typing interleaved with real frame renders: every fourth keystroke waits for the next detail frame.
  for (let i = 0; i < 24; i += 1) {
    await win.keyboard.type(i % 2 === 0 ? 'n' : 'o', { delay: 0 });
    if (i % 4 === 3) {
      const before = await frames();
      await win.waitForFunction((n) => (window as unknown as { __frames: number }).__frames > n, before, { timeout: 10_000 });
    }
  }
  await win.evaluate(() => (window as unknown as { __framesOff: () => void }).__framesOff());
  const longest = await win.evaluate(() => {
    const w = window as unknown as { __events: number[]; __eventObserver: PerformanceObserver };
    w.__eventObserver.disconnect();
    return Math.max(0, ...w.__events);
  });
  if (slaMeasurable(testInfo)) {
    expectWithinSla(testInfo, { what: 'the longest keydown in the open monitor', requirement: '055 SC-003', elapsedMs: longest, budgetMs: 50 });
  } else {
    noteSlaNotMeasured(testInfo, { what: 'the longest keydown in the open monitor', requirement: '055 SC-003', observed: `${longest} ms` });
  }
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('monitor-dialog')).toHaveCount(0);
});
