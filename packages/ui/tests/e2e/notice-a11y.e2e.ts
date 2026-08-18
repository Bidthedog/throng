/**
 * 030 US3 (#235) / T041 — A GROWING NOTICE MUST NOT RE-READ ITSELF.
 *
 * ══ THE DEFECT THIS PREVENTS ══
 *
 * The consolidated notice lives inside `aria-live="polite"`, which is what makes a failure audible
 * at all. But it GROWS: visiting a tab adds rows to a notice already on screen. A live region
 * re-reads its changed subtree, so a forty-row list gains one row and a screen-reader user hears the
 * entire list again — every time they change tab, for as long as the notice stands. That is worse
 * than silence, and it is a defect only an assertion can catch, because the DOM looks perfect.
 *
 * FR-032a's answer is two regions rather than one: the notice body announces ONCE and then goes
 * `aria-live="off"`, and a separate visually-hidden region announces only the DELTA — the panels that
 * just joined. What the user hears on growth is "2 more panels…", not the list.
 *
 * FR-032b adds the other half: a bounded, scrollable list has to be reachable by keyboard or its
 * lower rows are unreadable without a mouse — and reaching it must not trap focus inside it.
 *
 * ══ TIER: SERIAL (T042) ══
 *
 * Registered in `parallel-plan.json`'s serial list. It opens no Preferences window, drives no
 * context menu and starts no shell — the display modes it relies on are the SHIPPED defaults
 * (`error` is *Dismiss only*, so the notice stands still for the assertions) and are seeded nowhere
 * at all. What makes it serial is the two-launch dance below: each launch spawns its own daemon
 * against a shared database, and a pair of them starves at high worker counts.
 */
import { existsSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { addPanels, cleanupTemp, createProject, panelIds, runApp, settle } from './harness.js';

function layoutJson(dataDir: string, projectName: string): string {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dataDir, 'throng.db'), { readonly: true });
    const row = db
      .prepare(
        `SELECT w.layout_json AS json
           FROM workspace_layout w
           JOIN projects p ON p.id = w.project_id
          WHERE p.name = ?`,
      )
      .get(projectName) as { json?: string } | undefined;
    return row?.json ?? '';
  } catch {
    return '';
  } finally {
    db?.close();
  }
}

async function persisted(dataDir: string, project: string, fragment: string): Promise<void> {
  await expect
    .poll(() => layoutJson(dataDir, project).includes(fragment), {
      timeout: 30_000,
      message: `the layout for ${project} never persisted ${fragment}`,
    })
    .toBe(true);
}

async function renameWhenReleased(from: string, to: string): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          renameSync(from, to);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000, message: `could not rename ${from} → ${to}` },
    )
    .toBe(true);
}

async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 30_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Name a panel through its header.
 *
 * Not cosmetic: panel titles are numbered PER TAB, so an unnamed workspace has a `Panel 1` in every
 * tab — and the assertion below ("the delta did not re-announce a panel already reported") would
 * then fail on a name collision rather than on the behaviour it is about.
 */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

async function editorOn(win: Page, panelId: string, file: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expect(win.getByTestId(`editor-${panelId}`)).toBeVisible({ timeout: 20_000 });
  await win.getByTestId(`editor-${panelId}`).click();
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).first().click();
  await expect(win.getByTestId(`editor-${panelId}`).locator('.cm-content')).toContainText(
    file.replace('.txt', '').toUpperCase(),
    { timeout: 20_000 },
  );
}

test('a growing notice announces only the panels that joined, and its list takes focus without trapping it', { tag: ['@extended', '@failure'] }, async () => {
  test.setTimeout(420_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-a11y-root-'));
  const moved = `${root}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-a11y-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-a11y-ud-'));
  writeFileSync(join(root, 'one.txt'), 'ONE\n');
  writeFileSync(join(root, 'two.txt'), 'TWO\n');
  writeFileSync(join(root, 'three.txt'), 'THREE\n');

  try {
    await runApp(
      async (_app, win) => {
        await settle(win);
        await createProject(win, 'A11y', root);
        const [first] = await panelIds(win);
        await editorOn(win, first!, 'one.txt');
        await renamePanel(win, first!, 'Alpha');
        await addPanels(win, 1);
        const ids = await panelIds(win);
        const second = ids.find((id) => id !== first)!;
        await editorOn(win, second, 'two.txt');
        await renamePanel(win, second, 'Bravo');

        // A second tab, left unvisited on restore — the growth this spec is about.
        await win.getByTestId('tab-add').click();
        const rename = win.locator('[data-testid^="tab-rename-input-"]');
        await expect(rename).toBeVisible();
        await rename.fill('Later');
        await rename.press('Enter');
        await expect(rename).toHaveCount(0);
        const [third] = await panelIds(win);
        await editorOn(win, third!, 'three.txt');
        await renamePanel(win, third!, 'Charlie');
        await win.locator('.tab-chip').first().click();
        await persisted(dataDir, 'A11y', 'three.txt');
      },
      { dataDir, userDataDir },
    );

    await renameWhenReleased(root, moved);

    await runApp(
      async (_app, win) => {
        await settle(win);
        await enterProject(win, 'A11y');

        const notice = win.getByTestId('panel-failure-notice');
        await expect(notice).toBeVisible({ timeout: 90_000 });
        const body = notice.getByTestId('notice-body');
        const rows = notice.getByTestId('notice-affected-row');
        await expect(rows).toHaveCount(2, { timeout: 30_000 });

        // ═══ FIRST ANNOUNCEMENT, THEN SILENCE (FR-032a). ═══
        //
        // The body is inside the notices' polite region, so it is read when it arrives. Once it has
        // been, it opts OUT — otherwise every later row appended to it re-reads the whole notice.
        await expect(body).toHaveAttribute('aria-live', 'off', { timeout: 15_000 });

        // The delta region exists, is polite, and is invisible to the eye.
        //
        // It is NOT asserted empty here. The two panels in this tab report a beat apart, so the
        // second has already grown the notice the first raised — which is the mechanism working, on
        // a growth this test is not about. What matters is what the NEXT growth says.
        const delta = win.getByTestId('notice-growth-live');
        await expect(delta).toHaveAttribute('aria-live', 'polite');
        const box = await delta.boundingBox();
        expect(box === null || box.width <= 1 || box.height <= 1).toBe(true);
        const before = (await delta.textContent()) ?? '';

        // ═══ GROWTH ANNOUNCES THE DELTA, AND ONLY THE DELTA. ═══
        await win.locator('.tab-chip', { hasText: 'Later' }).first().click();
        await expect(rows).toHaveCount(3, { timeout: 30_000 });
        await expect
          .poll(async () => (await delta.textContent()) ?? '', {
            timeout: 15_000,
            message: 'the growth announced nothing at all',
          })
          .not.toBe(before);

        const announced = (await delta.textContent()) ?? '';
        // The panel that joined is named, and so is the tab it joined under…
        expect(announced).toContain('Charlie');
        expect(announced).toContain('Later');
        // …and the two the user was already told about are NOT re-read. This is the assertion the
        // whole requirement exists for: the delta region is not a second copy of the list.
        expect(announced, 'the delta region re-announced a panel already reported').not.toContain(
          'Alpha',
        );
        expect(announced, 'the delta region re-announced a panel already reported').not.toContain(
          'Bravo',
        );

        // ═══ FR-032b — the list is reachable, and lets go. ═══
        const list = notice.getByTestId('notice-affected');
        await expect(list).toHaveAttribute('tabindex', '0');
        await list.focus();
        expect(
          await win.evaluate(
            () => document.activeElement?.getAttribute('data-testid') ?? '(none)',
          ),
        ).toBe('notice-affected');
        // Tab leaves. A bounded scroll region that swallowed focus would strand a keyboard user in
        // a toast they cannot dismiss.
        await win.keyboard.press('Tab');
        expect(
          await win.evaluate(
            () => document.activeElement?.getAttribute('data-testid') ?? '(none)',
          ),
          'focus is trapped inside the affected list',
        ).not.toBe('notice-affected');
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(existsSync(moved) ? moved : root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
