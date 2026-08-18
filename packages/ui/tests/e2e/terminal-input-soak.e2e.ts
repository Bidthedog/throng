import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/**
 * 028 T020 (FR-024a/024c, SC-003) — the soak, opt-in.
 *
 * `terminal-input-idle.e2e.ts` proves the mechanism in one press, which is what a fence run on every
 * push should cost. This is the other question: does it hold fifty times in a row, in every shell?
 * A dropped keystroke is a race, and a race that survives one attempt is not fixed — it is unobserved.
 *
 * Opt-in because fifty click-and-type rounds across four shells takes minutes, and a suite nobody
 * runs is worse than one that is honest about what it skips. The skip states its own reason, and the
 * run prints its repetition count and flavours so a green tick can never be mistaken for a soak that
 * silently did nothing.
 *
 *   THRONG_INPUT_SOAK=1 npx playwright test packages/ui/tests/e2e/terminal-input-soak.e2e.ts
 *   THRONG_INPUT_SOAK=1 THRONG_INPUT_SOAK_REPS=10 …    (a shorter run while iterating)
 */

const SOAK = process.env.THRONG_INPUT_SOAK === '1';
const REPS = Number(process.env.THRONG_INPUT_SOAK_REPS ?? 50);
const FLAVOURS = ['cmd', 'windows-powershell', 'pwsh', 'git-bash'] as const;

/** How each shell echoes a marker — `echo` is not universal across these four. */
const ECHO: Record<string, (text: string) => string> = {
  cmd: (t) => `echo ${t}`,
  'windows-powershell': (t) => `Write-Output ${t}`,
  pwsh: (t) => `Write-Output ${t}`,
  'git-bash': (t) => `echo ${t}`,
};

async function rows(win: Page, panelId: string): Promise<string[]> {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-testid="terminal-${id}"]`);
    return [...(el?.querySelectorAll('.xterm-rows > div') ?? [])]
      .map((r) => (r.textContent ?? '').trim())
      .filter(Boolean);
  }, panelId);
}

test.describe('terminal input soak (opt-in: THRONG_INPUT_SOAK=1)', () => {
  test.skip(!SOAK, 'long-running: set THRONG_INPUT_SOAK=1 to run it');

  for (const flavour of FLAVOURS) {
    test(`no keystroke is lost over ${REPS} click-and-type rounds (${flavour})`, { tag: ['@extended', '@terminal'] }, async () => {
      test.setTimeout(REPS * 8_000 + 120_000);
      const root = mkdtempSync(join(tmpdir(), `throng-soak-${flavour}-`));
      console.log(`[soak] ${flavour}: ${REPS} repetitions`);
      try {
        await runApp(async (_app, win) => {
          await createProject(win, `Soak-${flavour}`, root);
          const pid = await firstPanelId(win);
          await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
          await win.getByTestId('terminal-flavour').selectOption(flavour);
          await win.getByTestId(`panel-type-confirm-${pid}`).click();
          const term = win.getByTestId(`terminal-${pid}`);
          await expect(term).toBeVisible();
          await expect(term).toContainText(basename(root), { timeout: 40_000 });

          const lost: number[] = [];
          for (let i = 1; i <= REPS; i += 1) {
            // Idle the panel first — the defect needs a terminal that does not already hold focus.
            // Poll for focus having actually LEFT the terminal (not merely for the click having been
            // dispatched) — xterm's hidden textarea holds keyboard focus, so `document.activeElement`
            // no longer being inside the terminal element is the real condition.
            await win.getByTestId('project-list').click();
            await expect
              .poll(() =>
                win.evaluate((id) => {
                  const termEl = document.querySelector(`[data-testid="terminal-${id}"]`);
                  return !termEl?.contains(document.activeElement);
                }, pid),
              )
              .toBe(true);

            const box = await term.boundingBox();
            if (!box) throw new Error('terminal has no box');
            // Click and type with NO gap: the pointer-down must move focus before the keydown lands.
            await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            const marker = `SOAK${i}Z`;
            await win.keyboard.type(ECHO[flavour](marker), { delay: 0 });
            await win.keyboard.press('Enter');

            // The SHELL computes the answer: a lost leading character makes the command malformed,
            // so the marker never appears on a line of its own however the typed text looks.
            try {
              await expect
                .poll(async () => (await rows(win, pid)).some((l) => l === marker), {
                  timeout: 8_000,
                })
                .toBe(true);
            } catch {
              lost.push(i);
            }
          }

          console.log(`[soak] ${flavour}: ${REPS - lost.length}/${REPS} rounds delivered every character`);
          expect(lost, `rounds where a character was lost: ${lost.join(', ')}`).toEqual([]);
        });
      } finally {
        cleanupTemp(root);
      }
    });
  }
});
