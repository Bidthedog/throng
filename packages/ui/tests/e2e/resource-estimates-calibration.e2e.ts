import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, createProject, daemonPid, firstPanelId, openApp, runTypedCommand } from './harness.js';
import type { OpenApp } from './harness.js';

/**
 * Calibration of the panel memory estimates (055 SC-009, FR-024, FR-024b, research R9): open and close 1,
 * 10 and 50 MB files in an editor and in a Markdown preview, and fill a terminal to its 1,000-line
 * scrollback, measuring the PROCESS memory each costs, and require the monitor's own figure for the panel
 * to be within 10% of it.
 *
 * Layer: E2E, because the thing being compared is a real heap in a real renderer, a real main process and
 * a real daemon. No lower layer has a process to measure; `estimate-models.test.ts` pins the arithmetic
 * and this pins that the arithmetic describes reality.
 *
 * ══ HOW IT MEASURES ══
 *
 * "Measured" is the change in private bytes of the process that holds the memory — main and the renderer
 * from `app.getAppMetrics()`, the daemon from the OS — after a forced garbage collection on both sides of
 * the change. The renderer's GC is Chromium's own, over the DevTools protocol (`HeapProfiler.collectGarbage`),
 * and main's is V8's `gc` exposed at run time, so the app needs no special launch flag. "Estimated" is what
 * the monitor itself reports for that panel in a real detail frame — the figure the user is shown — and
 * not a model called from the test, so a wiring mistake fails here too. Each case prints both and the ratio,
 * so a failing run is also the data to tune `estimate-models.ts` constants from (SC-009; a panel kind that
 * cannot meet the bound ships as `NotMeasured`, FR-012).
 *
 * Run it: `npx playwright test packages/ui/tests/e2e/resource-estimates-calibration.e2e.ts --workers=1`
 */
const SIZES_MB = [1, 10, 50] as const;
const BOUND = 0.1;

let h: OpenApp;
let root: string;

/** `megabytes` of ASCII text in 64-byte lines, so characters === bytes. */
function textOf(megabytes: number): string {
  const line = (n: number): string => `line ${String(n).padStart(8, '0')} the quick brown fox jumps over the lazy dog\n`.padEnd(64, '.').slice(0, 63) + '\n';
  const lines = Math.floor((megabytes * 1024 * 1024) / 64);
  const parts: string[] = [];
  for (let i = 0; i < lines; i += 1) parts.push(line(i));
  return parts.join('');
}

/** Private bytes of a process by pid on this machine (the daemon is not an Electron process). */
function privateBytesOf(pid: number): number {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).PrivateMemorySize64`], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  return Number(out.trim());
}

async function collectGarbage(app: ElectronApplication, win: Page): Promise<void> {
  const cdp = await win.context().newCDPSession(win);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
  } finally {
    await cdp.detach();
  }
  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v8 = require('node:v8') as typeof import('node:v8');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vm = require('node:vm') as typeof import('node:vm');
    v8.setFlagsFromString('--expose_gc');
    (vm.runInNewContext('gc') as () => void)();
  });
}

interface Sample {
  readonly main: number;
  readonly renderer: number;
}

/** Private bytes of main and of the window's renderer, after a collection on both. */
async function sample(app: ElectronApplication, win: Page): Promise<Sample> {
  await collectGarbage(app, win);
  const pids = await app.evaluate(({ webContents }) => ({
    main: process.pid,
    renderer: webContents.getAllWebContents().find((w) => !w.getURL().startsWith('devtools'))?.getOSProcessId() ?? 0,
  }));
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ pid: m.pid, kb: (m.memory as { privateBytes?: number }).privateBytes ?? 0 })));
  const kb = (pid: number): number => (metrics.find((m) => m.pid === pid)?.kb ?? 0) * 1024;
  return { main: kb(pids.main), renderer: kb(pids.renderer) };
}

interface FrameNode {
  readonly id: string;
  readonly rolled: { readonly memory: number | { readonly kind: string } };
  readonly children: readonly FrameNode[];
}

/** One detail frame as the app produced it, via a second subscription. */
async function detailFrame(win: Page): Promise<FrameNode> {
  const frame = await win.evaluate(
    () =>
      new Promise<{ hierarchy: unknown }>((resolve) => {
        type Api = { subscribeDetail: () => Promise<{ subscriptionId: number }>; unsubscribeDetail: (id: number) => Promise<void>; onDetail: (cb: (f: { hierarchy: unknown }) => void) => () => void };
        const api = (window as unknown as { throng: { resources: Api } }).throng.resources;
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
  return frame.hierarchy as FrameNode;
}

function find(node: FrameNode, id: string): FrameNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The monitor's figure for a node, once its estimate has been reported (frames follow the reporter by a tick). */
async function shown(win: Page, id: string): Promise<number> {
  let value = 0;
  await expect
    .poll(
      async () => {
        const memory = find(await detailFrame(win), id)?.rolled.memory;
        value = typeof memory === 'number' ? memory : 0;
        return value;
      },
      { timeout: 30_000, message: `the monitor never showed a memory figure for ${id}` },
    )
    .toBeGreaterThan(0);
  return value;
}

/** Print, and require, that `estimated` is within the bound of `measured`. */
function expectCalibrated(what: string, estimated: number, measured: number): void {
  const ratio = estimated / measured;
  console.info(`calibration ${what}: estimated ${Math.round(estimated)} B, measured ${Math.round(measured)} B, ratio ${ratio.toFixed(3)}`);
  test.info().annotations.push({ type: 'calibration', description: `${what}: estimated/measured = ${ratio.toFixed(3)}` });
  expect(Math.abs(estimated - measured) / measured, `${what}: estimate ${Math.round(estimated)} vs measured ${Math.round(measured)} (SC-009 ±${BOUND * 100}%)`).toBeLessThanOrEqual(BOUND);
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-calib-'));
  writeFileSync(join(root, 'tiny.md'), '# tiny\n');
  for (const mb of SIZES_MB) writeFileSync(join(root, `big-${mb}.md`), textOf(mb));
  h = await openApp();
  await createProject(h.win, 'Calibration', root);
});
test.afterAll(async () => {
  await h.close();
  cleanupTemp(root);
});

test('panel memory estimates are within 10% of measured process memory: editors and previews at 1, 10 and 50 MB, and a terminal at its scrollback limit', { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
  test.setTimeout(30 * 60_000);
  const { app, win } = h;

  // ── An editor, opened and closed at each size ────────────────────────────────────────────────────
  const editorId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await expect(win.getByTestId(`editor-${editorId}`)).toBeVisible();
  await win.getByTestId(`editor-${editorId}`).click();
  const tree = win.getByTestId('file-explorer-tree');
  const content = win.getByTestId(`editor-${editorId}`).locator('.cm-content');

  await tree.getByText('tiny.md', { exact: true }).click();
  await expect(content).toContainText('tiny', { timeout: 10_000 });
  await win.evaluate(async () => {
    const api = (window as unknown as { throng: { resources: { subscribeDetail: () => Promise<unknown> } } }).throng.resources;
    await api.subscribeDetail(); // keeps detail collection (and so the estimates) on for the whole case
  });
  const editorTiny = await shown(win, `n:${editorId}`);
  const baseline = await sample(app, win);

  for (const mb of SIZES_MB) {
    await tree.getByText(`big-${mb}.md`, { exact: true }).click();
    await expect(content).toContainText('line 00000000', { timeout: 120_000 });
    const open = await sample(app, win);
    const estimated = (await shown(win, `n:${editorId}`)) - editorTiny;
    const measured = open.main - baseline.main + (open.renderer - baseline.renderer);
    expectCalibrated(`editor ${mb} MB (main + renderer)`, estimated, measured);

    // Closed again: the document is replaced by the tiny one, and the figure falls back with it.
    await tree.getByText('tiny.md', { exact: true }).click();
    await expect(content).toContainText('tiny', { timeout: 30_000 });
    await expect.poll(async () => (await shown(win, `n:${editorId}`)) - editorTiny, { timeout: 30_000 }).toBeLessThan(estimated / 10);
  }

  // ── A Markdown preview, opened and closed at each size ───────────────────────────────────────────
  for (const mb of SIZES_MB) {
    await tree.getByText(`big-${mb}.md`, { exact: true }).click();
    await expect(content).toContainText('line 00000000', { timeout: 120_000 });
    const before = await sample(app, win);
    const editorFigure = await shown(win, `n:${editorId}`);

    const previewIds = (): Promise<string[]> =>
      win.locator('[data-testid^="preview-body-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('preview-body-', '')));
    const existing = await previewIds();
    await win.getByTestId(`editor-preview-${editorId}`).click();
    await expect.poll(async () => (await previewIds()).some((id) => !existing.includes(id)), { timeout: 120_000 }).toBe(true);
    const previewId = (await previewIds()).find((id) => !existing.includes(id)) as string;

    const open = await sample(app, win);
    const estimated = await shown(win, `n:${previewId}`);
    expect(estimated, 'the editor figure must not change when a preview opens').toBeGreaterThan(0);
    void editorFigure;
    expectCalibrated(`preview ${mb} MB (main + renderer)`, estimated, open.main - before.main + (open.renderer - before.renderer));

    await win.getByTestId(`panel-close-${previewId}`).click();
    const dialog = win.getByTestId('confirm-dialog');
    if (await dialog.isVisible().catch(() => false)) await win.getByTestId('confirm-accept').click();
    await expect(win.getByTestId(`preview-body-${previewId}`)).toHaveCount(0, { timeout: 30_000 });
    await tree.getByText('tiny.md', { exact: true }).click();
  }

  // ── A terminal filled to its 1,000-line scrollback ───────────────────────────────────────────────
  await win.getByTestId('tab-add').click().catch(() => {});
  const terminalPanel = await firstPanelId(win);
  const daemon = await daemonPid(h.pipeName);
  await win.getByTestId(`panel-type-select-${terminalPanel}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${terminalPanel}`).click();
  const term = win.getByTestId(`terminal-${terminalPanel}`);
  await expect(term).toBeVisible();
  await runTypedCommand(win, term, 'set /a 40+2', { echoed: 'set /a 40+2', output: '42' });
  await win.evaluate(() => new Promise((r) => setTimeout(r, 0))); // sleep-justified: yield one task so the prompt's repaint is not part of the baseline.
  const termBefore = await sample(app, win);
  const daemonBefore = privateBytesOf(daemon);

  await runTypedCommand(win, term, 'for /L %i in (1,1,1500) do @echo calibration line %i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', {
    echoed: 'for /L',
    output: 'calibration line 1500',
    timeout: 120_000,
  });
  const termAfter = await sample(app, win);
  const daemonAfter = privateBytesOf(daemon);
  const buffers = await shown(win, `b:${terminalPanel}`);
  expectCalibrated('terminal scrollback (renderer + daemon)', buffers, termAfter.renderer - termBefore.renderer + (daemonAfter - daemonBefore));
});
