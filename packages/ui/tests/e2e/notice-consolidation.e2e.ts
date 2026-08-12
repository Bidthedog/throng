/**
 * 030 US3 (#235) — ONE NOTICE PER CAUSE, LISTING EVERY PANEL IT DEFEATED.
 *
 * ══ THE DEFECT ══
 *
 * Rename a project's root folder with editors and terminals open, and every casualty reports
 * separately. Measured on master: one absent folder produced an explorer notice, a per-tab
 * "Cannot open 2 files" dialog, and a badge on each terminal — a storm in three vocabularies, none
 * of which said how many other things were broken or which. The user is left counting.
 *
 * FR-029 makes it ONE notice per cause per project, naming the cause and the project once and
 * listing the affected panels grouped by tab. FR-030/FR-037 make that list GROW as the user visits
 * tabs whose panels had not yet mounted, and FR-037a makes a dismissed notice free its group so the
 * next discovery raises a fresh one — listing only what is new, never re-reporting what the user has
 * already read and dismissed.
 *
 * ══ TIER: SERIAL, DELIBERATELY (T042) ══
 *
 * Registered in `parallel-plan.json`'s serial list because the first test drives a REAL `cmd`
 * terminal through a failed start, and a real shell starves at high worker counts — the same reason
 * `notice-subjects.e2e.ts` is serial. Display modes are seeded through the CONFIG ROOT where they
 * are needed at all, never through the Preferences window, and nothing here opens a context menu:
 * focus theft is not the reason; the shell is.
 *
 * ══ HOW THE FAILURE IS PRODUCED ══
 *
 * The two-launch dance `terminal-start-failure-controls.e2e.ts` established: build the workspace
 * against a real folder, let it persist, rename the folder away, and launch again against the same
 * database. The second launch is a genuine project open over a root that is no longer there — every
 * editor's file is gone and every terminal's working directory is gone, from one cause, with no
 * mocking anywhere and no lock holder to arrange.
 */
import { existsSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { addPanels, cleanupTemp, createProject, panelIds, runApp, settle } from './harness.js';

/** The consolidated notice raised for panels one action defeated. */
function consolidated(win: Page): Locator {
  return win.getByTestId('panel-failure-notice');
}

function rows(win: Page): Locator {
  return consolidated(win).getByTestId('notice-affected-row');
}

/** The persisted layout blob for `projectName`, or '' if there isn't one yet. */
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
    return ''; // the daemon may hold the file mid-write; the poll will come back
  } finally {
    db?.close();
  }
}

/** Wait until the layout the next launch will restore actually contains `fragment`. */
async function persisted(dataDir: string, project: string, fragment: string): Promise<void> {
  await expect
    .poll(() => layoutJson(dataDir, project).includes(fragment), {
      timeout: 30_000,
      message: `the layout for ${project} never persisted ${fragment}`,
    })
    .toBe(true);
}

/**
 * Rename `from` to `to`, waiting out the directory lock rather than assuming it has dropped.
 *
 * The daemon holds a project root for as long as a terminal is open, and that helper exits a beat
 * AFTER teardown returns — so renaming immediately races the OS releasing the handle.
 */
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
      { timeout: 30_000, message: `could not rename ${from} → ${to} (directory lock never released?)` },
    )
    .toBe(true);
  expect(existsSync(to)).toBe(true);
}

/** Reopen a project from the sidebar. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 30_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 30_000 });
}

/** Turn the first unconfigured panel into an editor showing `file`. */
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

/**
 * A new tab, NAMED — `tab-add` opens it in rename mode, so the title is typed into the input that
 * mount opens rather than through a context menu this spec must not touch.
 */
async function newTab(win: Page, title: string): Promise<void> {
  await win.getByTestId('tab-add').click();
  const input = win.locator('[data-testid^="tab-rename-input-"]');
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** Click a tab chip by its visible title. */
async function openTab(win: Page, title: string): Promise<void> {
  await win.locator('.tab-chip', { hasText: title }).first().click();
}

/** Click the first tab chip — the one `createProject` made, whatever it ended up called. */
async function openFirstTab(win: Page): Promise<void> {
  await win.locator('.tab-chip').first().click();
}

/**
 * Name a panel through its header — no context menu, so this spec's serial listing stays about the
 * shell and nothing else.
 *
 * The names matter: a panel's default title is `Panel 1`, which tells a reader of this spec nothing
 * about whether the row they are looking at is the editor or the terminal. Naming them is what makes
 * "editors and terminals in the same list" an assertion rather than a count.
 */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/**
 * T037 / T037a / T040 — the consolidated notice, everything about it, in one restored session.
 *
 * Deliberately one test rather than four. Every assertion below describes the SAME restored
 * workspace, and rebuilding it four times would cost four two-launch dances (~4 minutes) to observe
 * four facets of one state. What each block is proving is stated where it sits.
 */
test('one cause across several tabs is one notice, listing every panel it defeated', async () => {
  test.setTimeout(420_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-consol-root-'));
  const moved = `${root}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-consol-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-consol-ud-'));
  for (const name of ['one', 'two', 'three']) {
    writeFileSync(join(root, `${name}.txt`), `${name.toUpperCase()}\n`);
  }

  try {
    // ── Launch 1: a workspace worth breaking. Three tabs, editors and one real terminal. ──────
    await runApp(
      async (_app, win) => {
        await settle(win);
        await createProject(win, 'Consol', root);
        const [first] = await panelIds(win);
        await editorOn(win, first!, 'one.txt');
        await renamePanel(win, first!, 'Docs');

        // A REAL terminal beside it, in the same tab: FR-029 requires editors and terminals to land
        // in one list, and two panel types reporting through one notice is the whole claim.
        await addPanels(win, 1);
        const ids = await panelIds(win);
        const term = ids.find((id) => id !== first)!;
        await win.getByTestId(`panel-type-select-${term}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${term}`).click();
        await expect(win.getByTestId(`terminal-${term}`)).toContainText(basename(root), {
          timeout: 30_000,
        });
        await renamePanel(win, term, 'Shell');

        await newTab(win, 'Second');
        const [secondPanel] = await panelIds(win);
        await editorOn(win, secondPanel!, 'two.txt');
        await renamePanel(win, secondPanel!, 'Notes');

        await newTab(win, 'Third');
        const [thirdPanel] = await panelIds(win);
        await editorOn(win, thirdPanel!, 'three.txt');
        await renamePanel(win, thirdPanel!, 'Scratch');

        // Back to the first tab, so the restored session opens there and tabs two and three are
        // genuinely UNRENDERED — which is what makes growth observable at all.
        await openFirstTab(win);
        await persisted(dataDir, 'Consol', 'three.txt');
        await persisted(dataDir, 'Consol', '"kind":"terminal"');
      },
      { dataDir, userDataDir },
    );

    // The one cause: the project's root folder is no longer where the project says it is.
    await renameWhenReleased(root, moved);

    // ── Launch 2: the project open that everything fails during. ──────────────────────────────
    await runApp(
      async (_app, win) => {
        await settle(win);
        await enterProject(win, 'Consol');

        // ═══ T037 — ONE notice, not one per casualty. ═══
        const notice = consolidated(win);
        await expect(notice).toBeVisible({ timeout: 90_000 });
        // Settle: the editor's mount, the tab-open watcher's 300ms scan and the terminal's attach
        // all report at different moments, and "one notice" is a claim about the end state.
        await win.waitForTimeout(3000);
        await expect(notice, 'one cause raised more than one consolidated notice').toHaveCount(1);

        // The per-tab dialog is GONE OUTRIGHT (FR-035) — not narrowed, not merely unused here.
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
        expect(await win.getByTestId('notices').innerText()).not.toMatch(/Cannot open/i);

        // ═══ The project is named ONCE, in the heading, and never on a row (FR-031). ═══
        await expect(notice.locator('.notice__title')).toContainText('Consol');
        const rowText = (await rows(win).allInnerTexts()).join('\n');
        expect(rowText, 'a row repeats the project the heading already names').not.toContain('Consol');

        // ═══ Editors AND terminals, in the same list. ═══
        await expect(rows(win)).toHaveCount(2);
        expect(rowText, 'the editor panel is missing from the list').toContain('Docs');
        expect(rowText, 'the terminal panel is missing from the list').toContain('Shell');

        // ═══ THE RAW SYSTEM ERROR IS NOT RENDERED (FR-034, 029 FR-016/FR-018a). ═══
        //
        // The single most important negative assertion in this spec: 029 demoted the errno to Copy
        // and the log precisely so it could never be the headline again, and a consolidated notice
        // built by pasting each casualty's own error together is the obvious way to undo that.
        const visible = await notice.innerText();
        expect(visible, 'the notice renders a raw system error').not.toMatch(
          /ENOENT|EPERM|EBUSY|EACCES|Cannot lock|Internal error/i,
        );
        // …and not the absolute path the errno carries, either.
        expect(visible).not.toMatch(/[A-Za-z]:\\/);

        // ═══ T037a — consolidation changes the notice COUNT and nothing else (FR-038). ═══
        //
        // EVERY listed panel still says, in place, that it is the one that is broken. A notice that
        // replaced the per-panel statement would leave the user with a list and no way to see which
        // panel on screen each row meant — so the rows are matched back to their own banners by id
        // rather than counted, which would pass on any two banners at all.
        const listed = await rows(win).evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-panel-id') ?? ''),
        );
        expect(listed.filter(Boolean)).toHaveLength(2);
        for (const id of listed) {
          await expect(
            win.locator(
              `[data-testid="editor-unloadable-${id}"], [data-testid="terminal-start-failed-${id}"]`,
            ),
            `panel ${id} is listed in the notice but shows no failure of its own`,
          ).toHaveCount(1);
        }

        // ═══ T040 — the list is READ, not operated, and it is bounded. ═══
        const list = notice.getByTestId('notice-affected');
        const style = await list.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
        });
        expect(style.overflowY, 'the list cannot scroll').toMatch(/auto|scroll/);
        expect(parseFloat(style.maxHeight), 'the list has no height bound (FR-032)').toBeGreaterThan(0);
        expect(await list.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
          parseFloat(style.maxHeight) + 1,
        );
        // Nothing in the list offers itself as a control: no role, no tab stop, no pointer cursor.
        for (const part of ['notice-affected-row', 'notice-affected-tab']) {
          const items = notice.getByTestId(part);
          expect(await items.count()).toBeGreaterThan(0);
          for (const item of await items.all()) {
            expect(await item.getAttribute('role')).toBeNull();
            expect(await item.getAttribute('tabindex')).toBeNull();
            expect(await item.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
          }
        }
        // …and the notice still fits its container, as every other notice does (FR-028).
        const noticeBox = (await notice.boundingBox())!;
        const stack = (await win.getByTestId('notices').boundingBox())!;
        expect(noticeBox.y).toBeGreaterThanOrEqual(stack.y - 1);
        expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(stack.y + stack.height + 1);

        // ═══ T038 — VISITING AN UNRENDERED TAB GROWS THE LIVE NOTICE. ═══
        //
        // The panels in tabs two and three have never mounted, so their failures are not yet known
        // to anything. Discovering them must join the notice the user is already reading rather than
        // starting a second one about the same absent folder.
        await openTab(win, 'Second');
        await expect(rows(win)).toHaveCount(3, { timeout: 30_000 });
        await expect(consolidated(win), 'visiting a tab raised a second notice').toHaveCount(1);
        // The tab it joined under is named, once, above its row.
        await expect(notice.getByTestId('notice-affected-tab')).toHaveCount(2);
        await expect(notice).toContainText('Second');

        // ═══ …and a DISMISSED notice raises a fresh one for the NEW panels only (FR-037a). ═══
        await win.getByTestId('panel-failure-notice-dismiss').click();
        await expect(consolidated(win)).toHaveCount(0);

        await openTab(win, 'Third');
        await expect(consolidated(win)).toHaveCount(1, { timeout: 30_000 });
        // ONLY the newly discovered panel. Re-listing what the user has already dismissed would make
        // dismissal meaningless — the notice would come straight back, longer.
        await expect(rows(win)).toHaveCount(1);
        await expect(consolidated(win)).toContainText('Third');
        expect(await consolidated(win).innerText()).not.toContain('Second');
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(existsSync(moved) ? moved : root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

/**
 * T039 — grouped by the OPERATION where 029 identified no cause, and two operations are two notices.
 *
 * An editor that cannot load its file reports a `LoadResult` reason, not an errno: 029's classifier
 * never sees it and correctly declines to guess (FR-011b), so these failures carry no cause at all.
 * FR-029a says such failures group by the action that produced them — which is what makes the notice
 * possible without widening 029's closed `FailureKind` set (FR-029b).
 *
 * The second half is the one that keeps that from becoming "everything is one notice": two project
 * opens are two actions, and two actions are two notices, each speaking only for its own casualties.
 */
test('an unclassified multi-panel failure groups by operation, and two operations are two notices', async () => {
  test.setTimeout(420_000);
  const rootA = mkdtempSync(join(tmpdir(), 'throng-consol-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-consol-b-'));
  const movedA = `${rootA}-renamed`;
  const movedB = `${rootB}-renamed`;
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-consol2-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-consol2-ud-'));
  writeFileSync(join(rootA, 'one.txt'), 'ONE\n');
  writeFileSync(join(rootA, 'two.txt'), 'TWO\n');
  writeFileSync(join(rootB, 'three.txt'), 'THREE\n');

  try {
    await runApp(
      async (_app, win) => {
        await settle(win);
        await createProject(win, 'Alpha', rootA);
        const [a1] = await panelIds(win);
        await editorOn(win, a1!, 'one.txt');
        await addPanels(win, 1);
        const aIds = await panelIds(win);
        await editorOn(win, aIds.find((id) => id !== a1)!, 'two.txt');
        await persisted(dataDir, 'Alpha', 'two.txt');

        await createProject(win, 'Bravo', rootB);
        const [b1] = await panelIds(win);
        await editorOn(win, b1!, 'three.txt');
        await persisted(dataDir, 'Bravo', 'three.txt');
      },
      { dataDir, userDataDir },
    );

    await renameWhenReleased(rootA, movedA);
    await renameWhenReleased(rootB, movedB);

    await runApp(
      async (_app, win) => {
        await settle(win);
        await enterProject(win, 'Alpha');
        // ONE notice for two unclassified failures — grouped by the open, not by a cause neither
        // of them has.
        await expect(consolidated(win)).toHaveCount(1, { timeout: 90_000 });
        await expect(rows(win)).toHaveCount(2, { timeout: 30_000 });
        await expect(consolidated(win)).toContainText('Alpha');

        // A SECOND open is a second action, and its casualties are its own.
        await enterProject(win, 'Bravo');
        await expect(consolidated(win)).toHaveCount(2, { timeout: 90_000 });
        const texts = await consolidated(win).allInnerTexts();
        expect(texts.some((t) => t.includes('Bravo'))).toBe(true);
        expect(texts.some((t) => t.includes('Alpha'))).toBe(true);
        // …and neither has swallowed the other's panels.
        const bravo = texts.find((t) => t.includes('Bravo'))!;
        expect(bravo).not.toContain('one.txt');
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(existsSync(movedA) ? movedA : rootA);
    cleanupTemp(existsSync(movedB) ? movedB : rootB);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
