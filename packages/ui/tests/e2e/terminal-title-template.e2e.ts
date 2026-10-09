/**
 * 053 — every terminal names its running command, shell and directory (FR-001, FR-002, FR-004, FR-009 – FR-012,
 * FR-016, SC-001, SC-002). MT-11 of the branch's manual test plan, automated at the maintainer's request.
 *
 * Under the default template a terminal reads `<shell> (<directory>)` at a prompt, `<command> | <shell> (…)` while a
 * command runs, and `<app>: <title> | <shell> (…)` while a program that titles itself runs — here a small node
 * script standing in for claude, which sets its window title the same way (OSC 0) and is not something CI can run.
 *
 * The full name is read from the header's hover text (`panel-handle-*`'s `title`): the header's own text is cut to
 * the panel-name length, which is a different requirement.
 *
 * Layer: E2E, @reserve:pty. The template, the placeholders and every shortening rule are pinned in core unit tests;
 * the title and command stores in component tests; the daemon's title scan in daemon tests. None composes a real
 * shell's command line, its window-title sequences through a real ConPTY, the daemon's observation and a reload.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  switchProject,
  firstPanelId,
  panelIds,
  splitPanelViaMenu,
  cleanupTemp,
  APP_CLOSE_TIMEOUT_MS,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';
import Database from 'better-sqlite3';
import { expectPingCount } from './helpers/processes.js';

const TARGET = '127.0.0.77';

/** The flavours this machine offers, as `{ id, label }`. */
async function flavours(win: Page, pid: string): Promise<Array<{ id: string; label: string }>> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  return win
    .getByTestId('terminal-flavour')
    .locator('option')
    .evaluateAll((opts) =>
      opts
        .map((o) => ({ id: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() }))
        .filter((f) => f.id !== ''),
    );
}

async function makeTerminal(win: Page, pid: string, flavour: string, remember = false): Promise<Locator> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  if (remember) await win.getByTestId('terminal-remember-command').check();
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  return term;
}

/** The panel's full name — the header's hover text. */
const fullName = (win: Page, pid: string): Promise<string> =>
  win.getByTestId(`panel-handle-${pid}`).evaluate((el) => el.getAttribute('title') ?? '');

async function expectName(win: Page, pid: string, pattern: RegExp, timeout = 15_000): Promise<string> {
  let seen = '';
  try {
    await expect
      .poll(async () => {
        seen = await fullName(win, pid);
        return pattern.test(seen);
      }, { timeout })
      .toBe(true);
  } catch (cause) {
    const header = await win.getByTestId(`panel-handle-${pid}`).innerText().catch(() => '(no header)');
    const handles = await win.locator('[data-testid^="panel-handle-"]').count();
    throw new Error(
      `the name never matched ${pattern}; its hover text reads ${JSON.stringify(seen)}, its header ${JSON.stringify(header)} (${handles} panel header(s))`,
      { cause },
    );
  }
  return seen;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `<shell> (<…folder>)` — the directory may be shortened in the middle, never at its last folder. */
const atPrompt = (shell: string, folder: string): RegExp => new RegExp(`^${esc(shell)} \\(.*${esc(folder)}\\)$`);
const running = (command: string, shell: string, folder: string): RegExp =>
  new RegExp(`^${esc(command)} \\| ${esc(shell)} \\(.*${esc(folder)}\\)$`);

/** Negative: no name shows an executable's path or a shell's own title. */
function expectNoForeignTitle(name: string): void {
  expect(name, 'an executable path in a terminal name').not.toMatch(/[A-Za-z]:\\[^ ]*\.exe/i);
  expect(name, "Git Bash's own title in a terminal name").not.toMatch(/MINGW(32|64):/);
  expect(name, "cmd's own title in a terminal name").not.toMatch(/(^|\| )cmd - /);
}

/** Negative: the directory appears once in the header. */
async function expectDirectoryOnce(win: Page, pid: string, folder: string): Promise<void> {
  const header = await win.getByTestId(`panel-handle-${pid}`).innerText();
  expect(header.split(folder).length - 1, `the header shows ${folder} more than once: ${header}`).toBeLessThanOrEqual(1);
}

async function typeLine(win: Page, term: Locator, line: string): Promise<void> {
  await term.click();
  await win.keyboard.type(line);
  await win.keyboard.press('Enter');
}

/** Interrupt until the name returns to its at-prompt form — a single Ctrl+C into a streaming terminal is occasionally lost. */
async function interruptUntil(win: Page, term: Locator, pid: string, pattern: RegExp): Promise<void> {
  await expect
    .poll(
      async () => {
        if (pattern.test(await fullName(win, pid))) return true;
        await term.click();
        await win.keyboard.press('Control+c');
        return false;
      },
      { timeout: 30_000, message: `the name never returned to ${pattern}` },
    )
    .toBe(true);
}

test('every shell names its running command, shell and directory, and drops the command when it stops (FR-001, FR-002, FR-009, SC-001)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(300_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-titles-'));
  const folder = basename(root);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TitleShells', root);
      const first = await firstPanelId(win);
      const shells = (await flavours(win, first)).filter((f) => ['cmd', 'pwsh', 'windows-powershell', 'git-bash'].includes(f.id));
      expect(shells.length, 'no built-in shell detected').toBeGreaterThan(0);

      // Step 1: one terminal per shell — `<shell> (<project folder>)`.
      const pids: string[] = [first];
      for (let i = 1; i < shells.length; i += 1) {
        const before = await panelIds(win);
        await splitPanelViaMenu(win, before[before.length - 1]!, 'right');
        await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
        pids.push((await panelIds(win)).find((id) => !before.includes(id))!);
      }
      const terms: Locator[] = [];
      for (const [i, shell] of shells.entries()) terms.push(await makeTerminal(win, pids[i]!, shell.id));
      for (const [i, shell] of shells.entries()) {
        expectNoForeignTitle(await expectName(win, pids[i]!, atPrompt(shell.label, folder), TERMINAL_OUTPUT_TIMEOUT_MS));
        await expectDirectoryOnce(win, pids[i]!, folder);
      }

      // Step 2: a running ping names itself in every terminal; the tab strip's panel list says the same.
      for (const term of terms) await typeLine(win, term, `ping ${TARGET} -t`);
      await expectPingCount(TARGET, shells.length);
      for (const [i, shell] of shells.entries()) {
        expectNoForeignTitle(await expectName(win, pids[i]!, running(`ping ${TARGET} -t`, shell.label, folder)));
        await expectDirectoryOnce(win, pids[i]!, folder);
      }
      await win.locator('.tab-chip').first().hover();
      await expect(win.getByTestId('tabstrip-popover-panels')).toContainText(`ping ${TARGET} -t`);
      await win.mouse.move(0, 0);

      // Step 3: Ctrl+C — each name returns to `<shell> (<folder>)`.
      for (const [i, shell] of shells.entries()) await interruptUntil(win, terms[i]!, pids[i]!, atPrompt(shell.label, folder));
      await expectPingCount(TARGET, 0);

      // Step 5: a command over 40 characters is cut with `…` after about 40 of them.
      const longLine = `ping ${TARGET} -t -l 100 -w 2000 -i 64 -4`;
      await typeLine(win, terms[0]!, longLine);
      const long = await expectName(win, pids[0]!, new RegExp(`^${esc(longLine.slice(0, 30))}.*… \\| ${esc(shells[0]!.label)} \\(`));
      expect(long.split(' | ')[0]!.length, `the command is cut at about 40 characters: ${long}`).toBeLessThanOrEqual(41);
      await interruptUntil(win, terms[0]!, pids[0]!, atPrompt(shells[0]!.label, folder));
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a deep directory keeps its drive and last folder and shortens the middle (FR-004, FR-012)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-titles-deep-'));
  mkdirSync(join(root, 'alpha', 'bravo', 'charlie', 'delta', 'echofold'), { recursive: true });
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TitleDeep', root);
      const pid = await firstPanelId(win);
      const shell = (await flavours(win, pid)).find((f) => f.id === 'cmd')!;
      const term = await makeTerminal(win, pid, 'cmd');
      await expectName(win, pid, atPrompt(shell.label, basename(root)), TERMINAL_OUTPUT_TIMEOUT_MS);
      await typeLine(win, term, 'cd alpha\\bravo\\charlie\\delta\\echofold');
      const name = await expectName(win, pid, new RegExp(`^${esc(shell.label)} \\([A-Za-z]:\\\\.*….*echofold\\)$`));
      expectNoForeignTitle(name);
      expect(name, 'the shortened directory still names the temp folders above the project').not.toContain(basename(root));
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a reloaded terminal does not name the command its previous shell was running (FR-016)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-titles-reload-'));
  const folder = basename(root);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TitleReload', root);
      const pid = await firstPanelId(win);
      const shell = (await flavours(win, pid)).find((f) => f.id === 'cmd')!;
      const term = await makeTerminal(win, pid, 'cmd');
      await expectName(win, pid, atPrompt(shell.label, folder), TERMINAL_OUTPUT_TIMEOUT_MS);
      await typeLine(win, term, `ping ${TARGET} -t`);
      await expectName(win, pid, running(`ping ${TARGET} -t`, shell.label, folder));

      await win.locator('.project-item', { hasText: 'TitleReload' }).click({ button: 'right' });
      await win.getByTestId('menu-item-Unload Project and End Terminals').click();
      await expectPingCount(TARGET, 0);
      await switchProject(win, 'TitleReload');

      // From the first moment the panel is named until its new shell has answered, it never names the old ping.
      const reloaded = win.getByTestId(`terminal-${pid}`);
      const names: string[] = [];
      await expect
        .poll(async () => {
          names.push(await fullName(win, pid));
          return (await reloaded.innerText().catch(() => '')).includes('>');
        }, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS })
        .toBe(true);
      names.push(await fullName(win, pid));
      expect(names.filter((n) => n.includes('ping')), 'the reloaded panel named the old ping').toEqual([]);
      await expectName(win, pid, atPrompt(shell.label, folder));
    });
  } finally {
    cleanupTemp(root);
  }
});

// ── Steps 7–9: a program that titles itself ────────────────────────────────────────────────────────────────────────

const PROGRAM_TITLE = 'writing the tests';

/** Stands in for claude: sets its window title once, then keeps running. */
const TITLER = `process.stdout.write('\\u001b]0;${PROGRAM_TITLE}\\u0007');\nprocess.stdout.write('titler running\\n');\nsetInterval(() => {}, 1000);\n`;

/** Wait until `project`'s saved layout records `needle` as a running command — what a restart recovers from. */
async function expectObservedSaved(dataDir: string, project: string, needle: string): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(`SELECT w.layout_json AS json FROM workspace_layout w JOIN projects p ON p.id = w.project_id WHERE p.name = ?`)
            .get(project) as { json?: string } | undefined;
          const seen: string[] = [];
          const walk = (v: unknown): void => {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') {
              for (const [k, child] of Object.entries(v)) {
                if (k === 'observedCommand' && typeof child === 'string') seen.push(child);
                else walk(child);
              }
            }
          };
          walk(JSON.parse(row?.json ?? 'null'));
          return seen.some((c) => c.includes(needle));
        } catch {
          return false;
        } finally {
          db?.close();
        }
      },
      { timeout: 20_000, message: `the running ${needle} was never saved as observed` },
    )
    .toBe(true);
}

async function requestClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test('a program that titles itself is named `app: title`, across a project switch, an unload and a restart (FR-003, FR-010, FR-011)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(300_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-titles-app-'));
  const other = mkdtempSync(join(tmpdir(), 'throng-titles-other-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-titles-app-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-titles-app-ud-'));
  const session = { dataDir, userDataDir };
  const folder = basename(root);
  writeFileSync(join(root, 'titler.js'), TITLER);
  let shellLabel = '';
  const titled = (): RegExp => running(`node: ${PROGRAM_TITLE}`, shellLabel, folder);
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'TitleOther', other);
      await createProject(win, 'TitleApp', root);
      const pid = await firstPanelId(win);
      const offered = await flavours(win, pid);
      const shell = offered.find((f) => f.id === 'pwsh') ?? offered.find((f) => f.id === 'windows-powershell')!;
      shellLabel = shell.label;
      const term = await makeTerminal(win, pid, shell.id, true);
      await expectName(win, pid, atPrompt(shellLabel, folder), TERMINAL_OUTPUT_TIMEOUT_MS);

      // Step 7: the program titles itself — `node: <its title> | <shell> (<folder>)`.
      await typeLine(win, term, 'node titler.js');
      await expect(term).toContainText('titler running', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      expectNoForeignTitle(await expectName(win, pid, titled()));

      // Step 8: switch to another project and back — still titled.
      await switchProject(win, 'TitleOther');
      await switchProject(win, 'TitleApp');
      await expectName(win, pid, titled());

      // Step 9: Unload with End Terminals and load again — the remembered command restarts and is titled again,
      // never left at `node | …`.
      await win.locator('.project-item', { hasText: 'TitleApp' }).click({ button: 'right' });
      await win.getByTestId('menu-item-Unload Project and End Terminals').click();
      await switchProject(win, 'TitleApp');
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText('titler running', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await expectName(win, pid, titled());

      // Close throng, terminating everything — once the running program has been saved as observed, which is what
      // the next launch recovers it from.
      await expectObservedSaved(dataDir, 'TitleApp', 'titler.js');
      await requestClose(app);
      await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10_000 });
      const closed = app.waitForEvent('close', { timeout: APP_CLOSE_TIMEOUT_MS });
      await win.getByTestId('app-close-terminate').click();
      await closed;
    }, session);
    // …and after reopening throng.
    await runApp(async (_app, win) => {
      await switchProject(win, 'TitleApp');
      const pid = await firstPanelId(win);
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText('titler running', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await expectName(win, pid, titled());

      // When the program exits, the name returns to `<shell> (<folder>)`.
      await interruptUntil(win, term, pid, atPrompt(shellLabel, folder));
    }, session);
  } finally {
    cleanupTemp(root);
    cleanupTemp(other);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
