/**
 * 051 — ending, starting and closing terminals never stalls the rest of throng (MT-01, MT-02, MT-03, MT-05 of the
 * branch's manual test plan, automated at the maintainer's request).
 *
 * - MT-01 (FR-001, FR-002, FR-004, FR-005, SC-001, #468): Unload with End Terminals, then an immediate switch,
 *   twenty times in a row with four running terminals.
 * - MT-02 (FR-010, FR-021, SC-002, SC-003): a printing terminal and a typing terminal keep flowing while ten
 *   terminals end and five start.
 * - MT-03 (FR-014, FR-015, FR-015a, SC-004): Terminate all on close leaves no shell, command or console host
 *   behind, and the next launch starts every terminal fresh.
 * - MT-05 (FR-014): ending a terminal ends a command its launcher left running in the background.
 *
 * Layer: E2E — @reserve:process and @reserve:pty. The daemon's non-blocking process calls are pinned in daemon
 * integration tests (FR-021's latency guard among them); none of them composes a real ConPTY, real shells and
 * commands, the renderer's unload-then-switch, and the app's close handshake, and none can see an OS process
 * outlive its terminal.
 *
 * Every command targets its own 127.0.0.x address, so the OS process table can be asked about exactly the
 * commands this file started — whether or not the daemon runs terminals through the de-elevated agent.
 *
 * Wall-clock ceilings (FR-022, SC-002, SC-003, SC-004) go through `expectWithinSla`: asserted on a reference machine, recorded on
 * CI (see helpers/sla.ts). The behaviour — output keeps arriving, keystrokes echo — is asserted everywhere.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import {
  runApp,
  runTypedCommand,
  createProject,
  switchProject,
  firstPanelId,
  panelIds,
  splitPanelViaMenu,
  commitTabRename,
  daemonPid,
  cleanupTemp,
  APP_CLOSE_TIMEOUT_MS,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';
import { expectWithinSla } from './helpers/sla.js';
import { processTable, pings, expectPingCount, type Proc } from './helpers/processes.js';

// ── Terminals ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Turn panel `pid` into a cmd terminal, optionally with a startup command. */
async function makeTerminal(win: Page, pid: string, startup?: string): Promise<Locator> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  if (startup !== undefined) await win.getByTestId('terminal-startup-command').fill(startup);
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  return term;
}

/**
 * `n` cmd terminals in the active project, two to a tab (the first in the tab already showing), each running
 * `startup`. Two to a tab keeps every panel wide enough to be a usable terminal.
 */
async function makeTerminals(win: Page, n: number, startup: string): Promise<string[]> {
  const made: string[] = [];
  for (let i = 0; i < n; i += 1) {
    let pid: string;
    if (i === 0) {
      pid = await firstPanelId(win);
    } else if (i % 2 === 1) {
      const before = await panelIds(win);
      await splitPanelViaMenu(win, before[before.length - 1]!, 'right');
      await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
      pid = (await panelIds(win)).find((id) => !before.includes(id))!;
    } else {
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      pid = await firstPanelId(win);
    }
    await makeTerminal(win, pid, startup);
    made.push(pid);
  }
  return made;
}

const projectRow = (win: Page, name: string) => win.locator('.project-item', { hasText: name });

async function unloadEndingTerminals(win: Page, name: string): Promise<void> {
  await projectRow(win, name).click({ button: 'right' });
  await win.getByTestId('menu-item-Unload Project and End Terminals').click();
}

/** Negative: no error notice of any kind is standing. */
async function expectNoErrorNotice(win: Page): Promise<void> {
  const errors = win.getByTestId('notices').locator('.notice--error');
  const said = (await errors.count()) > 0 ? await errors.allInnerTexts() : [];
  await expect(errors, `an error notice was raised: ${said.join(' | ')}`).toHaveCount(0);
}

// ── Output and echo, measured in the page ──────────────────────────────────────────────────────────────────────────

/**
 * Record, every animation frame, when `panelId`'s visible terminal text changes. A terminal printing once a second
 * changes its rows once a second; a stall shows as a long gap between changes.
 */
async function startOutputWatch(win: Page, panelId: string): Promise<void> {
  await win.evaluate((pid) => {
    const w = window as unknown as { __outWatch?: { changes: number[]; stop: boolean } };
    const watch = { changes: [] as number[], stop: false };
    w.__outWatch = watch;
    let last = '';
    const tick = (): void => {
      if (watch.stop) return;
      const rows = document.querySelector(`[data-testid="terminal-${pid}"] .xterm-rows`);
      const text = rows?.textContent ?? '';
      if (text !== last) {
        last = text;
        watch.changes.push(performance.now());
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, panelId);
}

/** Stop the watch; the number of changes seen and the longest gap between two of them, in ms. */
async function stopOutputWatch(win: Page): Promise<{ changes: number; longestGapMs: number }> {
  return win.evaluate(() => {
    const w = window as unknown as { __outWatch?: { changes: number[]; stop: boolean } };
    const watch = w.__outWatch!;
    watch.stop = true;
    let longest = 0;
    for (let i = 1; i < watch.changes.length; i += 1) longest = Math.max(longest, watch.changes[i]! - watch.changes[i - 1]!);
    return { changes: watch.changes.length, longestGapMs: Math.round(longest) };
  });
}

/**
 * Type `text` one key at a time into the focused terminal `panelId`, timing each key from its keydown IN THE PAGE
 * to the frame its echo is first on screen — so the test runner's own round trips are not in the reading. Returns
 * the slowest echo, in ms.
 */
async function typeTimingEchoes(win: Page, panelId: string, text: string): Promise<number> {
  await win.evaluate(() => {
    const w = window as unknown as { __keyAt?: number; __keyWatch?: boolean };
    if (w.__keyWatch) return;
    w.__keyWatch = true;
    window.addEventListener('keydown', () => (w.__keyAt = performance.now()), { capture: true });
  });
  let slowest = 0;
  let typed = '';
  for (const ch of text) {
    typed += ch;
    await win.keyboard.type(ch);
    const latency = await win.evaluate(
      ({ pid, needle }) =>
        new Promise<number>((resolve) => {
          const w = window as unknown as { __keyAt?: number };
          const deadline = performance.now() + 10_000;
          const tick = (): void => {
            const rows = document.querySelector(`[data-testid="terminal-${pid}"] .xterm-rows`);
            const now = performance.now();
            if ((rows?.textContent ?? '').includes(needle) || now > deadline) resolve(now - (w.__keyAt ?? now));
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      { pid: panelId, needle: typed },
    );
    slowest = Math.max(slowest, latency);
  }
  await expect(win.getByTestId(`terminal-${panelId}`)).toContainText(text);
  return Math.round(slowest);
}

// ── MT-01 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Unload with End Terminals then an immediate switch succeeds twenty times running (#468, SC-001)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(900_000);
  const TARGET = '127.0.0.71';
  const rootA = mkdtempSync(join(tmpdir(), 'throng-468-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-468-b-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Lifecycle468B', rootB);
      await createProject(win, 'Lifecycle468A', rootA);
      // Four terminals in A, each starting the same long ping — so every reload of A runs four again.
      const first = await firstPanelId(win);
      await makeTerminal(win, first, `ping -n 120 ${TARGET}`);
      for (let i = 0; i < 3; i += 1) {
        const before = await panelIds(win);
        await splitPanelViaMenu(win, before[before.length - 1]!, 'right');
        await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
        const pid = (await panelIds(win)).find((id) => !before.includes(id))!;
        await makeTerminal(win, pid, `ping -n 120 ${TARGET}`);
      }

      for (let attempt = 1; attempt <= 20; attempt += 1) {
        await test.step(`attempt ${attempt}`, async () => {
          if (attempt > 1) await switchProject(win, 'Lifecycle468A');
          await expectPingCount(TARGET, 4);

          // Unload A with End Terminals, then click B at once.
          const started = Date.now();
          await unloadEndingTerminals(win, 'Lifecycle468A');
          await projectRow(win, 'Lifecycle468B').click();
          await expect(projectRow(win, 'Lifecycle468B')).toHaveAttribute('data-active', 'true');
          const switchedMs = Date.now() - started;

          // The fence: A's commands are gone, so the unload has finished — and B is STILL the active project.
          await expectPingCount(TARGET, 0);
          await expect(projectRow(win, 'Lifecycle468B')).toHaveAttribute('data-active', 'true');
          await expect(projectRow(win, 'Lifecycle468A')).not.toHaveAttribute('data-active', 'true');
          await expectNoErrorNotice(win);
          await expect(win.getByTestId('notices').locator('.notice')).toHaveCount(0);
          expectWithinSla(test.info(), {
            what: `the switch straight after Unload with End Terminals (attempt ${attempt})`,
            requirement: '051 FR-022',
            elapsedMs: switchedMs,
            budgetMs: 1000,
          });
        });
      }

      // Step 4: A loads again with fresh shells — the pings now running are new processes, not the old ones.
      const old = new Set(pings(TARGET).map((p) => p.pid));
      expect(old.size).toBe(0);
      await switchProject(win, 'Lifecycle468A');
      await expectPingCount(TARGET, 4);
      await expect(win.locator('.xterm')).toHaveCount(4);
      await expect(win.locator('[data-testid^="panel-type-select-"]')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(rootA);
    cleanupTemp(rootB);
  }
});

// ── MT-02 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a printing terminal and a typing terminal keep flowing while ten terminals end and five start (SC-002, SC-003)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(600_000);
  const LIVE = '127.0.0.72';
  const ENDING = '127.0.0.73';
  const rootA = mkdtempSync(join(tmpdir(), 'throng-flow-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-flow-b-'));
  try {
    await runApp(async (_app, win) => {
      // B: one terminal printing every second, one to type in.
      await createProject(win, 'FlowB', rootB);
      const printer = await firstPanelId(win);
      await makeTerminal(win, printer, `ping -t ${LIVE}`);
      await splitPanelViaMenu(win, printer, 'right');
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const typer = (await panelIds(win)).find((id) => id !== printer)!;
      const typerTerm = await makeTerminal(win, typer);
      await expect(win.getByTestId(`terminal-${printer}`)).toContainText(`Reply from ${LIVE}`, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      // cmd drops the caret, so the output is text the typed line does not contain.
      await runTypedCommand(win, typerTerm, 'echo rea^dy41', { echoed: 'rea^dy41', output: 'ready41' });

      // A: ten terminals each running a ping that would last two minutes.
      await createProject(win, 'FlowA', rootA);
      await makeTerminals(win, 10, `ping -n 120 ${ENDING}`);
      await expectPingCount(ENDING, 10, 60_000);

      // Back to B; unload A with End Terminals while watching B's output and typing in B.
      await switchProject(win, 'FlowB');
      await expect(win.getByTestId(`terminal-${printer}`)).toContainText(`Reply from ${LIVE}`, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      // Control: the same echo with nothing ending or starting — the baseline the readings below are read against.
      await typerTerm.click();
      const quietEcho = await typeTimingEchoes(win, typer, 'rem qu^iet40');
      await win.keyboard.press('Enter');
      console.log(`[051 MT-02] control: slowest echo ${quietEcho} ms with nothing else happening`);
      await startOutputWatch(win, printer);
      await unloadEndingTerminals(win, 'FlowA');
      await typerTerm.click();
      const slowestEcho = await typeTimingEchoes(win, typer, 'echo hel^lo42');
      await expectPingCount(ENDING, 0);
      const ending = await stopOutputWatch(win);
      console.log(`[051 MT-02] while ten ended: ${ending.changes} output changes, longest gap ${ending.longestGapMs} ms, slowest echo ${slowestEcho} ms`);
      expect(ending.changes, 'the printing terminal stopped printing while terminals ended').toBeGreaterThan(1);
      expectWithinSla(test.info(), { what: 'longest output gap while ten terminals end (1 s ping interval + 100 ms)', requirement: '051 SC-002', elapsedMs: ending.longestGapMs, budgetMs: 1100 });
      expectWithinSla(test.info(), { what: 'slowest keystroke echo while ten terminals end', requirement: '051 SC-003', elapsedMs: slowestEcho, budgetMs: 100 });
      await win.keyboard.press('Enter');
      await expect(typerTerm).toContainText('hello42');

      // Step 4: five new terminals in B in quick succession (in a new tab — two to a tab keeps them usable), then
      // straight back to the first tab to watch the ping and type while they come up.
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      await makeTerminals(win, 5, `ping -n 120 ${ENDING}`);
      await win.locator('.tab-chip').first().click();
      await expect(win.getByTestId(`terminal-${printer}`)).toBeVisible();
      await startOutputWatch(win, printer);
      await typerTerm.click();
      const slowestEcho2 = await typeTimingEchoes(win, typer, 'echo aga^in43');
      await expectPingCount(ENDING, 5, 60_000);
      // Watch for at least two ping intervals: the starts can finish inside one, and a window shorter than the
      // printer's own one-second interval cannot tell a stall from silence.
      await expect.poll(() => win.evaluate(() => {
        const w = window as unknown as { __outWatch?: { changes: number[] } };
        return w.__outWatch?.changes.length ?? 0;
      }), { timeout: 10_000 }).toBeGreaterThan(2);
      const starting = await stopOutputWatch(win);
      console.log(`[051 MT-02] while five started: ${starting.changes} output changes, longest gap ${starting.longestGapMs} ms, slowest echo ${slowestEcho2} ms`);
      // FR-021 (Clarifications, 2026-10-07): while terminals start, a further 100 ms — node-pty's synchronous start.
      expectWithinSla(test.info(), { what: 'slowest keystroke echo while five terminals start', requirement: '051 SC-003, FR-021', elapsedMs: slowestEcho2, budgetMs: 200 });
      expect(starting.changes, 'the printing terminal stopped printing while terminals started').toBeGreaterThan(1);
      await win.keyboard.press('Enter');
      await expect(typerTerm).toContainText('again43');
      await expectNoErrorNotice(win);
    });
  } finally {
    cleanupTemp(rootA);
    cleanupTemp(rootB);
  }
});

// ── MT-03 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function requestClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test('Terminate all on close leaves no shell, command or console host behind, and the next launch starts every terminal fresh (SC-004)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(600_000);
  const TARGET = '127.0.0.74';
  const rootA = mkdtempSync(join(tmpdir(), 'throng-term-all-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-term-all-b-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-term-all-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-term-all-ud-'));
  const session = { dataDir, userDataDir };
  try {
    let ours: Proc[] = [];
    await runApp(async (app, win, { pipeName }) => {
      // Ten terminals across two projects, each running a ping.
      await createProject(win, 'TermAllA', rootA);
      await makeTerminals(win, 5, `ping -n 120 ${TARGET}`);
      await createProject(win, 'TermAllB', rootB);
      await makeTerminals(win, 5, `ping -n 120 ${TARGET}`);
      await expectPingCount(TARGET, 10, 60_000);

      // What those terminals are, in the OS: each ping, its shell, and the console hosts under the daemon or the
      // agent it runs terminals through.
      const daemon = await daemonPid(pipeName);
      const table = processTable();
      const mine = pings(TARGET, table);
      const shells = table.filter((p) => mine.some((m) => m.parent === p.pid));
      const hostParents = new Set([daemon, ...table.filter((p) => p.parent === daemon).map((p) => p.pid)]);
      const hosts = table.filter((p) => /^conhost\.exe$/i.test(p.name) && hostParents.has(p.parent));
      ours = [...mine, ...shells, ...hosts];
      expect(shells.length, 'every ping should have a shell').toBe(10);
      expect(hosts.length, 'every terminal should have a console host').toBeGreaterThanOrEqual(10);

      // Negative: no "Terminal exited" notice while throng closes — reported out of the page as it happens.
      const exited: string[] = [];
      win.on('console', (msg) => {
        if (msg.text().startsWith('[mt03-notice]')) exited.push(msg.text());
      });
      await win.evaluate(() => {
        new MutationObserver(() => {
          const text = document.querySelector('[data-testid="notices"]')?.textContent ?? '';
          if (/exited/i.test(text)) console.log(`[mt03-notice] ${text}`);
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
      });

      await requestClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10_000 });
      const started = Date.now();
      const closed = app.waitForEvent('close', { timeout: APP_CLOSE_TIMEOUT_MS });
      await win.getByTestId('app-close-terminate').click();
      await closed;
      const closeMs = Date.now() - started;
      console.log(`[051 MT-03] Terminate all closed throng in ${closeMs} ms`);
      expect(exited, 'a "Terminal exited" notice appeared while throng closed').toEqual([]);
      expectWithinSla(test.info(), { what: 'closing throng with Terminate all and ten terminals', requirement: '051 SC-004', elapsedMs: closeMs, budgetMs: 5000 });
    }, session);

    // None of the ten terminals' processes remain.
    const ids = new Set(ours.map((p) => p.pid));
    await expect
      .poll(() => processTable().filter((p) => ids.has(p.pid) && ours.some((o) => o.pid === p.pid && o.name === p.name)).map((p) => `${p.name}:${p.pid}`), {
        timeout: 20_000,
        message: 'processes from the terminated terminals are still running',
      })
      .toEqual([]);

    // Step 5: the next launch starts every terminal panel fresh — none is an empty type picker.
    await runApp(async (_app, win) => {
      for (const project of ['TermAllA', 'TermAllB']) {
        await switchProject(win, project);
        const tabs = await win.locator('.tab-chip').count();
        expect(tabs).toBe(3);
        for (let t = 0; t < tabs; t += 1) {
          await win.locator('.tab-chip').nth(t).click();
          await expect(win.locator('.xterm').first()).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
          await expect(win.locator('[data-testid^="panel-type-select-"]')).toHaveCount(0);
        }
      }
      await expectPingCount(TARGET, 10, 60_000);
    }, session);
  } finally {
    cleanupTemp(rootA);
    cleanupTemp(rootB);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

// ── MT-05 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Click through however many confirmations a panel destroy asks for. */
async function acceptConfirmations(win: Page): Promise<void> {
  const dialog = win.getByTestId('confirm-dialog');
  for (let i = 0; i < 3; i += 1) {
    const appeared = await dialog
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) break;
    await win.getByTestId('confirm-accept').click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

test('ending a terminal ends a command its launcher left running in the background (FR-014)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(180_000);
  const TARGET = '127.0.0.79';
  const root = mkdtempSync(join(tmpdir(), 'throng-launcher-left-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LauncherLeft', root);
      const pid = await firstPanelId(win);
      await splitPanelViaMenu(win, pid, 'right'); // a second panel, so this one may be destroyed
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const term = await makeTerminal(win, pid);
      // The process, not the screen: in a half-width panel the ping's own line wraps across rows.
      await expect(term).toContainText('>', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await term.click();
      await win.keyboard.type(`cmd /c start /b ping -n 120 ${TARGET}`);
      await win.keyboard.press('Enter');
      await expectPingCount(TARGET, 1);

      await win.getByTestId(`panel-close-${pid}`).click();
      await acceptConfirmations(win);
      await expect(win.getByTestId(`terminal-${pid}`)).toHaveCount(0);
      await expectPingCount(TARGET, 0);
      await expectNoErrorNotice(win);
    });
  } finally {
    cleanupTemp(root);
  }
});
