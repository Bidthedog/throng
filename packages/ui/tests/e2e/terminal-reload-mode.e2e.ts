import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  cleanupTemp,
  conhostChildren,
  expectNoOrphanConhosts,
  createProject,
  daemonPid,
  firstPanelId,
  runApp as runOwnApp,
} from './harness.js';

/**
 * 039 US2 (#293) — Manual reload mode starts NO shell.
 *
 * ══ WHY THIS IS THE ONE E2E THIS STORY EARNS ══
 *
 * Everything else about Manual mode is decided by pure code and asserted far cheaper:
 *
 *   • the four project-open outcomes            `core/tests/unit/terminal-reload-mode.test.ts`
 *   • the placeholder's content and its Reload   `ui/tests/component/dormant-terminal.test.ts`
 *   • the menu item, and its distance from the
 *     failure items (FR-029)                     `ui/tests/unit/menu-sections.test.ts`
 *
 * What NONE of them can see is FR-026: that a dormant Panel holds no PTY, no shell process and no
 * `conhost`. That is a claim about the machine's process table, and a jsdom render asserting "the
 * placeholder is showing" would pass just as happily against an implementation that started the
 * shell anyway and drew a placeholder over the top of it. Only a real app with a real daemon can
 * tell those two apart — which is exactly the bar for reaching this layer.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * The Automatic half runs FIRST and asserts the terminal really does start and really does own a
 * conhost. Without it, the Manual assertion — "no conhosts appeared" — would pass on a machine
 * where terminals were broken for some unrelated reason, or where the flavour never launched. The
 * first half proves the measurement can see a shell; the second proves there is not one.
 *
 * Seeds `settings.json` before launch, so it takes its own app (`runOwnApp`) rather than sharing.
 */

const cfgRoots: string[] = [];
const roots: string[] = [];

function freshCfgRoot(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-reloadmode-cfg-'));
  cfgRoots.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), `${JSON.stringify(settings)}\n`, 'utf8');
  return dir;
}

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-reloadmode-'));
  roots.push(dir);
  return dir;
}

test.afterAll(() => {
  for (const d of cfgRoots.splice(0)) cleanupTemp(d);
  for (const d of roots.splice(0)) cleanupTemp(d);
});

/** Create a terminal Panel in the first slot and confirm it. */
async function makeTerminal(win: import('@playwright/test').Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await expect(win.getByTestId('terminal-flavour')).toBeVisible();
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  return pid;
}

/*
 * The title and tag stay on ONE line, and that is a requirement rather than a style choice.
 * `e2e-budget.test.ts`'s parser is line-based — `/^\s*test\(\s*(?:'|"|`)…\{ tag: \[([^\]]*)\] \}/` —
 * so a declaration split across lines is counted in the TOTAL but in no CATEGORY. The category
 * ratchet then silently under-counts, which is the one thing a ratchet must not do. Caught by the
 * gate: 99 @terminal against a budget of 101.
 */
test('Automatic starts a real shell — the control that proves this test can SEE one (039 FR-021)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    test.setTimeout(120_000);
    const cfg = freshCfgRoot({ terminals: { reloadMode: 'automatic' } });
    const root = freshRoot();
    await runOwnApp(
      async (_app, win, ctx) => {
        await createProject(win, 'AutoReload', root);
        const pid = await makeTerminal(win);

        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
        // A real shell, in the project's directory — not merely a rendered surface. `basename`
        // rather than the whole path, matching the idiom the other terminal specs use: the status
        // bar shows a display path, not necessarily the absolute one.
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), {
          timeout: 30_000,
        });

        // And the daemon owns a conhost for it. This is the measurement the Manual test relies on
        // being able to make; if it is ever zero here, that test's "no conhosts" proves nothing.
        const daemon = await daemonPid(ctx.pipeName);
        await expect
          .poll(() => conhostChildren(daemon).length, { timeout: 30_000 })
          .toBeGreaterThan(0);
      },
      { env: { ...process.env, THRONG_CONFIG_ROOT: cfg } },
    );
});

test('Manual starts NO shell and no conhost, and offers Reload on each panel (039 FR-022/FR-023/FR-026)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    test.setTimeout(120_000);
    const cfg = freshCfgRoot({ terminals: { reloadMode: 'manual' } });
    const root = freshRoot();
    const other = freshRoot();
    await runOwnApp(
      async (_app, win, ctx) => {
        await createProject(win, 'ManualReload', root);
        const pid = await makeTerminal(win);
        // Creating a terminal is a deliberate user action, so it starts even in Manual mode: the
        // preference governs RELOAD, not creation. Confirming that here is what makes the dormancy
        // below attributable to the project open rather than to the panel never having started.
        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

        const daemon = await daemonPid(ctx.pipeName);
        const baseline = conhostChildren(daemon);
        expect(baseline.length).toBeGreaterThan(0); // the shell we just started

        // ── Leave the project and come back. THAT is the project open the preference governs.
        await createProject(win, 'Elsewhere', other);
        await win.locator('.project-item').filter({ hasText: 'ManualReload' }).first().click();
        /*
         * Wait for it to be ACTIVE, not merely clicked — `createProject`'s own comment records that
         * reading a panel id before the swap completes cost four of six failures in one full-suite
         * run. The same hazard applies here: the dormant placeholder belongs to the project being
         * opened, and asserting on it too early can catch the outgoing project's panels instead.
         *
         * Keyed on `data-active` rather than the name, for the reason the harness gives: `hasText`
         * is a substring match over the whole row and can resolve to more than one project.
         */
        const active = win.locator('.project-item[data-active="true"]');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText('ManualReload');

        // The panel is dormant: it keeps its place and its type, says so, and offers Reload.
        await expect(win.getByTestId(`terminal-dormant-${pid}`)).toBeVisible({ timeout: 30_000 });
        await expect(win.getByTestId('terminal-dormant-reload')).toBeVisible();
        // Not a failure (FR-029) — dormancy must never reach the failure surfaces.
        await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);

        /*
         * ── FR-026, the reason this test exists at all. Opening the project started NO shell.
         *
         * Compared against the BASELINE PIDS rather than against zero, and the distinction is
         * deliberate. The claim under test is "the project open started nothing", not "the daemon
         * has no terminals" — a session held from before the switch is the daemon's business and
         * would make a `toBe(0)` assertion flaky for a reason that has nothing to do with this
         * feature. `expectNoOrphanConhosts` asks the right question: is there a conhost here that
         * was not here before?
         *
         * It also treats a FAILED probe as "not yet known" rather than as "nothing there", which
         * matters more here than usual: an assertion that exists to catch leaked OS processes must
         * never pass because the query broke.
         */
        await expectNoOrphanConhosts(daemon, baseline);

        // ── And Reload starts it, after which it is an ordinary terminal (FR-025).
        await win.getByTestId('terminal-dormant-reload').click();
        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 30_000 });
      },
      { env: { ...process.env, THRONG_CONFIG_ROOT: cfg } },
    );
});
