/**
 * 051 User Story 4 — command memory remembers a command started through a launcher, and forgets one the user
 * stopped (FR-040 – FR-044, FR-046, SC-007, #193). MT-04 of the branch's manual test plan, automated at the
 * maintainer's request.
 *
 * Each case runs through the real pipeline: a real shell, a real command, the daemon's attached-process
 * observation, the renderer's command store, the persisted layout, and an Unload with End Terminals followed by a
 * reload that must start (or not start) the command again. `terminal-command-memory.e2e.ts` holds 025's rows for
 * commands the shell starts directly; this file holds what 051 changed:
 *
 * - Git Bash runs a native command through MSYS, so the command is not the shell's direct child — it is
 *   remembered and runs again (FR-040);
 * - Ctrl+C, then an end, clears the saved Startup Command (FR-042, FR-046);
 * - cmd's own `ping -t` is unchanged (FR-044);
 * - `npm run` is remembered as npm, never as the node process under it, and runs again in cmd (FR-043, FR-044);
 * - the literal `docker run` of #193, where Linux containers are available (SC-007).
 *
 * Layer: E2E, @reserve:process. `command-capture` and the attached-process query are pinned in core and
 * platform-windows unit and integration tests; none composes a real shell's process tree with the daemon's
 * observation and a reload that acts on what was saved.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { runApp, createProject, switchProject, firstPanelId, cleanupTemp, stayedAbsent, TERMINAL_OUTPUT_TIMEOUT_MS } from './harness.js';
import { expectPingCount, pings, processesMatching } from './helpers/processes.js';

function layoutJson(dataDir: string, project: string): string {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dataDir, 'throng.db'), { readonly: true });
    const row = db
      .prepare(`SELECT w.layout_json AS json FROM workspace_layout w JOIN projects p ON p.id = w.project_id WHERE p.name = ?`)
      .get(project) as { json?: string } | undefined;
    return row?.json ?? '';
  } catch {
    return '';
  } finally {
    db?.close();
  }
}

/** Every value `field` holds anywhere in the project's persisted layout (`null` included). */
function recorded(dataDir: string, project: string, field: 'observedCommand' | 'startupCommand'): Array<string | null> {
  const values: Array<string | null> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (k === field && (typeof child === 'string' || child === null)) values.push(child);
        else walk(child);
      }
    }
  };
  try {
    walk(JSON.parse(layoutJson(dataDir, project) || 'null'));
  } catch {
    // a read of a mid-write row: nothing recorded yet
  }
  return values;
}

/** Wait until `field` satisfies `ok`; on failure, say what the layout does record. */
async function expectRecorded(
  dataDir: string,
  project: string,
  field: 'observedCommand' | 'startupCommand',
  ok: (values: Array<string | null>) => boolean,
  message: string,
): Promise<void> {
  try {
    await expect.poll(() => ok(recorded(dataDir, project, field)), { timeout: 30_000 }).toBe(true);
  } catch (cause) {
    throw new Error(`${message}; ${field} is ${JSON.stringify(recorded(dataDir, project, field))}`, { cause });
  }
}

const lacks = (needle: string) => (values: Array<string | null>) => !values.some((v) => v !== null && v.includes(needle));
const has = (needle: string) => (values: Array<string | null>) => values.some((v) => v !== null && v.includes(needle));
const nothingRunning = (values: Array<string | null>) => values.length > 0 && values.every((v) => v === null || v === '');

/** A terminal of `flavour` with command memory ON, in a fresh project. */
async function memoryTerminal(win: Page, project: string, root: string, flavour: string): Promise<Locator> {
  await createProject(win, project, root);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  await win.getByTestId('terminal-remember-command').check();
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expectPrompt(term, flavour);
  return term;
}

/**
 * Wait for the shell's prompt. Keys typed before it is drawn are lost — measured: Git Bash answered a ping typed
 * during its start-up with a screen of bare prompts and never ran it.
 */
async function expectPrompt(term: Locator, flavour: string): Promise<void> {
  // Git Bash's prompt names its MSYS2 environment, which is the installer's choice — MINGW64 here, UCRT64 on the
  // hosted runner — so any of them is a prompt.
  await expect(term).toContainText(flavour === 'git-bash' ? /MINGW(?:32|64)|UCRT64|CLANG(?:32|64|ARM64)|MSYS/ : '>', {
    timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
  });
}

/** Type a command and wait for its output. */
async function run(win: Page, term: Locator, line: string, evidence: string): Promise<void> {
  await term.click();
  await win.keyboard.type(line);
  await win.keyboard.press('Enter');
  await expect(term).toContainText(evidence, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
}

async function unloadEndingTerminals(win: Page, project: string): Promise<void> {
  await win.locator('.project-item', { hasText: project }).click({ button: 'right' });
  await win.getByTestId('menu-item-Unload Project and End Terminals').click();
  await expect(win.locator('.project-item', { hasText: project })).not.toHaveAttribute('data-active', 'true');
}

/**
 * The panel's Startup Command as the user sees it: end the shell with `exit`, and the panel returns to its empty
 * state — which is its edit screen, pre-filled from what it remembers (025 FR-007a, FR-007b). It must be empty
 * (051 FR-046).
 */
async function expectStartupFieldEmpty(win: Page, term: Locator): Promise<void> {
  const pid = ((await term.getAttribute('data-testid')) ?? '').replace(/^terminal-/, '');
  await term.click();
  await win.keyboard.type('exit');
  await win.keyboard.press('Enter');
  const form = win.getByTestId(`panel-type-select-${pid}`);
  await expect(form).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  await form.selectOption('terminal');
  const field = win.getByTestId('terminal-startup-command');
  await expect(field).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  await expect(field, "the panel's Startup Command still holds the stopped command (FR-046)").toHaveValue('');
}

/** Interrupt until `stopped()` holds — a single Ctrl+C into a streaming terminal is occasionally lost. */
async function interruptUntil(win: Page, term: Locator, stopped: () => boolean): Promise<void> {
  await expect
    .poll(
      async () => {
        if (stopped()) return true;
        await term.click();
        await win.keyboard.press('Control+c');
        return false;
      },
      { timeout: 30_000, message: 'the interrupt never stopped the command' },
    )
    .toBe(true);
}

test('Git Bash: a command the shell starts through MSYS is remembered and runs again; Ctrl+C then an end forgets it (FR-040, FR-042, FR-046)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(240_000);
  const TARGET = '127.0.0.75';
  const root = mkdtempSync(join(tmpdir(), 'throng-launch-bash-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-launch-bash-data-'));
  try {
    await runApp(async (_app, win) => {
      let term = await memoryTerminal(win, 'LaunchBash', root, 'git-bash');
      await run(win, term, `ping -n 600 ${TARGET}`, `Reply from ${TARGET}`);
      await expectRecorded(dataDir, 'LaunchBash', 'observedCommand', has(TARGET), 'the running ping was never observed');

      // Unload with End Terminals, open again: the terminal starts the ping on its own.
      await unloadEndingTerminals(win, 'LaunchBash');
      await expectPingCount(TARGET, 0);
      await switchProject(win, 'LaunchBash');
      term = win.locator('[data-testid^="terminal-"]').filter({ has: win.locator('.xterm') }).first();
      await expectPingCount(TARGET, 1);
      await expect(term).toContainText(`Reply from ${TARGET}`, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await expectRecorded(dataDir, 'LaunchBash', 'startupCommand', has(`-n 600 ${TARGET}`), 'the ping was not saved as the Startup Command');

      // Ctrl+C, then Unload with End Terminals and open again: a bare prompt, and the Startup Command is empty.
      await interruptUntil(win, term, () => pings(TARGET).length === 0);
      await expectRecorded(dataDir, 'LaunchBash', 'observedCommand', nothingRunning, 'the stopped ping was still recorded as running');
      await unloadEndingTerminals(win, 'LaunchBash');
      await switchProject(win, 'LaunchBash');
      term = win.locator('[data-testid^="terminal-"]').filter({ has: win.locator('.xterm') }).first();
      await expectPrompt(term, 'git-bash');
      await stayedAbsent(
        // The fence: the restarted shell has answered a command typed after it came up.
        () => run(win, term, 'echo fe""nce44', 'fence44'),
        async () => pings(TARGET).length,
        'the stopped ping running again on reload',
      );
      // FR-046 — the panel's Startup Command is empty: end the shell, and the panel's form shows what it remembers.
      await expectStartupFieldEmpty(win, term);
    }, { dataDir });
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
  }
});

test('cmd: ping -t is remembered and runs again, as before 051 (FR-044)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(180_000);
  const TARGET = '127.0.0.76';
  const root = mkdtempSync(join(tmpdir(), 'throng-launch-cmd-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-launch-cmd-data-'));
  try {
    await runApp(async (_app, win) => {
      const term = await memoryTerminal(win, 'LaunchCmd', root, 'cmd');
      await run(win, term, `ping -t ${TARGET}`, `Reply from ${TARGET}`);
      await expectRecorded(dataDir, 'LaunchCmd', 'observedCommand', has(`ping -t ${TARGET}`), 'the running ping was never observed');
      await unloadEndingTerminals(win, 'LaunchCmd');
      await expectPingCount(TARGET, 0);
      await switchProject(win, 'LaunchCmd');
      await expectPingCount(TARGET, 1);
      await expectRecorded(dataDir, 'LaunchCmd', 'startupCommand', has(`ping -t ${TARGET}`), 'the ping was not saved as the Startup Command');
    }, { dataDir });
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
  }
});

test('cmd: npm run is remembered as typed, never as the node process under it (FR-043, FR-044)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(180_000);
  const MARK = 'mt04spinmark';
  const root = mkdtempSync(join(tmpdir(), 'throng-launch-npm-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-launch-npm-data-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'mt04', private: true, scripts: { spin: `node -e "setInterval(() => {}, 1000)" ${MARK}` } }, null, 2),
  );
  /*
   * cmd runs `npm.cmd` itself, so the first real process under it is npm's own node: `node …\\npm-cli.js run spin`.
   * That is what is saved, and it replays as `npm run spin`. What must never be saved is the node process the
   * script starts — the one carrying MARK.
   */
  const isNpmRunSpin = (values: Array<string | null>): boolean =>
    values.some((v) => v !== null && /(^npm run spin$|npm-cli\.js" run spin$)/.test(v)) && lacks(MARK)(values);
  try {
    await runApp(async (_app, win) => {
      const term = await memoryTerminal(win, 'LaunchNpm', root, 'cmd');
      await term.click();
      await win.keyboard.type('npm run spin');
      await win.keyboard.press('Enter');
      await expect.poll(() => processesMatching('node.exe', MARK).length, { timeout: 60_000 }).toBeGreaterThan(0);
      await expectRecorded(dataDir, 'LaunchNpm', 'observedCommand', isNpmRunSpin, 'npm run spin was not observed as npm');

      await unloadEndingTerminals(win, 'LaunchNpm');
      await expect.poll(() => processesMatching('node.exe', MARK).length, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toBe(0);
      await switchProject(win, 'LaunchNpm');
      await expect.poll(() => processesMatching('node.exe', MARK).length, { timeout: 60_000 }).toBeGreaterThan(0);
      await expectRecorded(dataDir, 'LaunchNpm', 'startupCommand', isNpmRunSpin, 'npm run spin was not saved as npm');
    }, { dataDir });
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
  }
});

/** Whether this machine can run a Linux container — the literal #193 case needs one. */
function linuxContainers(): boolean {
  try {
    return execFileSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim() === 'linux';
  } catch {
    return false;
  }
}

test('Git Bash: docker run is remembered and runs again; Ctrl+C then an end forgets it (#193, SC-007)', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.skip(!linuxContainers(), 'needs Docker with Linux containers; the Git Bash case above covers the same route without it');
  test.setTimeout(300_000);
  const LINE = 'docker run --rm --init alpine sleep 600';
  const root = mkdtempSync(join(tmpdir(), 'throng-launch-docker-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-launch-docker-data-'));
  const dockers = (): number => processesMatching('docker.exe', 'alpine sleep 600').length;
  try {
    await runApp(async (_app, win) => {
      let term = await memoryTerminal(win, 'LaunchDocker', root, 'git-bash');
      await term.click();
      await win.keyboard.type(LINE);
      await win.keyboard.press('Enter');
      await expect.poll(dockers, { timeout: 120_000 }).toBeGreaterThan(0);
      await expectRecorded(dataDir, 'LaunchDocker', 'observedCommand', has('alpine sleep 600'), 'docker run was never observed');

      await unloadEndingTerminals(win, 'LaunchDocker');
      await expect.poll(dockers, { timeout: 60_000 }).toBe(0);
      await switchProject(win, 'LaunchDocker');
      await expect.poll(dockers, { timeout: 120_000 }).toBeGreaterThan(0);
      await expectRecorded(dataDir, 'LaunchDocker', 'startupCommand', has('alpine sleep 600'), 'docker run was not saved as the Startup Command');

      term = win.locator('[data-testid^="terminal-"]').filter({ has: win.locator('.xterm') }).first();
      await interruptUntil(win, term, () => dockers() === 0);
      await expectRecorded(dataDir, 'LaunchDocker', 'observedCommand', nothingRunning, 'the stopped docker run was still recorded');
      await unloadEndingTerminals(win, 'LaunchDocker');
      await switchProject(win, 'LaunchDocker');
      term = win.locator('[data-testid^="terminal-"]').filter({ has: win.locator('.xterm') }).first();
      await expectPrompt(term, 'git-bash');
      await stayedAbsent(
        () => run(win, term, 'echo fe""nce45', 'fence45'),
        async () => dockers(),
        'the stopped docker run running again on reload',
      );
      await expectStartupFieldEmpty(win, term);
    }, { dataDir });
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
  }
});
