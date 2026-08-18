import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  addPanels,
  createProject,
  firstPanelId,
  openApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * 018 / US9 — a file dragged in from the operating system (FR-057 … FR-066a, SC-011/SC-012).
 *
 * HOW THESE TESTS DRIVE THE DROP, AND WHAT THEY DELIBERATELY DO NOT TEST.
 *
 * Electron 43 removed the non-standard `File.path`, so an OS file's path can only come from
 * `webUtils.getPathForFile` — and a File synthesised inside a renderer is NOT an OS file, so that call
 * correctly returns '' for one. A fabricated drop event therefore CANNOT exercise the real extraction,
 * and no test here pretends that it does. That single adapter is the only untested line in the feature,
 * and it is stated rather than hidden (FR-066a).
 *
 * Everything downstream of it is a pure, PATH-taking function, and that is what these tests drive —
 * through the same custom-event seam the explorer already uses to ask for a file to be opened. The
 * confinement rule, the rejections, the cursor and the navigation guard are all real here.
 */

function dropPaths(win: Page, panelId: string, paths: string[]): Promise<void> {
  return win.evaluate(
    ([id, list]) => {
      window.dispatchEvent(
        new CustomEvent('throng:os-drop', { detail: { panelId: id, paths: list } }),
      );
    },
    [panelId, paths] as const,
  );
}

/**
 * The id of the panel holding the editor.
 *
 * Opening a file from the tree creates a DEDICATED editor panel (FR-010) — it does not convert the
 * untyped panel that was already there — so the editor is never simply "the first panel".
 */
async function editorPanelId(win: Page): Promise<string> {
  const testId = await win.locator('[data-testid^="editor-"]').first().getAttribute('data-testid');
  return (testId ?? '').slice('editor-'.length);
}

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  writeFileSync(join(root, 'a.txt'), 'alpha\n');
  writeFileSync(join(root, 'b.txt'), 'beta\n');
  mkdirSync(join(root, 'src'));
  return root;
}


/*
 * ══ ONE app for all eight tests (034 FR-045, SC-027) — 8 launches -> 1 ══
 *
 * This file was written off as UNSAFE-RESOURCE because every test made a project on a real temp
 * root and deleted it in a `finally` while the explorer was still watching it. That is the right
 * hazard to name and the wrong conclusion to draw from it: the deletion is the problem, not the
 * sharing, and the deletion moves to `afterAll`. What actually flakes is a LATER test asserting
 * on watcher-generated notices, which is editor-basics' shape and is not this file's — nothing
 * here reads a notice it did not itself provoke.
 *
 * THE THREE THINGS THAT HAD TO CHANGE, each because it is read WINDOW-WIDE:
 *
 *  1. Every test made a project called "Demo". They are named apart now — a row renders its root
 *     path beside its name and Playwright's hasText is a substring match, so eight identical
 *     names in one sidebar is an ambiguity waiting for the first test that filters by name.
 *  2. `[data-testid^="os-drop-error"]`.first() is the whole file's rejection assertion, and the
 *     testid carries the refused path (drop-target.tsx:85) — so a refusal left standing by an
 *     earlier test can be the one `.first()` resolves to, and "the folder was refused" would
 *     then be asserted against the message about a file OUTSIDE the project. The `beforeEach`
 *     empties the notice stack through each notice's own dismiss control, which is the fix
 *     notice-subjects.e2e.ts:144 already ships.
 *  3. `editorPanelId` and `.editor-panel` are window-wide but see only the ACTIVE project's
 *     workspace, and every test creates its own project — so each starts on an empty one. The
 *     `toHaveCount(1)` in "already open elsewhere" is safe for exactly that reason.
 *
 * `sharedCfg` is NOT pre-launch seeding: it is empty at boot and exists so the size-limit test
 * can read the app's own settings.json back and lower a number in it THROUGH the running app,
 * which is what that test was always doing. It restores the limit afterwards.
 */
test.describe.configure({ mode: 'serial' });

const ownedRoots: string[] = [];
/** Register a temp directory for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

/** Write isolation the Node side can read back — nothing is in it when the app starts. */
const sharedCfg = own(mkdtempSync(join(tmpdir(), 'throng-cfg-')));
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

/**
 * Empty the notice stack, through each notice's own dismiss control.
 *
 * Scoped to `[data-testid="notices"]` so it can never reach a dismiss button belonging to
 * something else. Bounded, and loud if it does not converge — a stack that will not empty makes
 * the next test's `.first()` resolve to the wrong notice, which is a wrong PASS as easily as a
 * failure.
 */
async function dismissAllNotices(win: OpenApp['win']): Promise<void> {
  const buttons = win.getByTestId('notices').locator('[data-testid$="-dismiss"]');
  for (let i = 0; i < 25; i += 1) {
    const n = await buttons.count();
    if (n === 0) return;
    await buttons.first().click();
    // "Fewer than before" rather than "exactly one fewer": a timed notice may expire on its own
    // during the click, and this loop is cleanup, not an assertion about how many went.
    await expect.poll(() => buttons.count(), { timeout: 10_000 }).toBeLessThan(n);
  }
  throw new Error('dismissAllNotices: the notice stack did not empty after 25 dismissals');
}

test.beforeEach(async () => {
  await dismissAllNotices(shared.win);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('a file dropped on an editor panel in its own project opens (US9, FR-057)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropOpen', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      // Open a.txt so there IS an editor panel to drop onto.
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);

      await dropPaths(win, panelId, [join(projectRoot, 'b.txt')]);
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('beta');
    });
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});

test('a file dropped on an UNTYPED panel makes it an editor showing the file (US9, FR-056)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropUntyped', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      const panelId = await firstPanelId(win);
      // The panel starts untyped: the type-selection form, no editor.
      await expect(win.getByTestId(`panel-type-form-${panelId}`)).toBeVisible();

      await dropPaths(win, panelId, [join(projectRoot, 'a.txt')]);

      // It becomes an editor showing the file — with no detour through the type form.
      await expect(win.getByTestId(`editor-${panelId}`)).toBeVisible();
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('alpha');
      await expect(win.getByTestId(`panel-type-form-${panelId}`)).toHaveCount(0);
    });
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});

/*
 * MOVED to `packages/ui/tests/component/os-drop-refusal.test.ts` (034 FR-045) — two tests, and
 * the whole of what they proved is now made in three places instead of one.
 *
 * WHY THESE TWO WERE MOVABLE AND THE LAST TWO IN THIS FILE ARE NOT. This header already says the
 * file does not drive an OS drag: six of its eight tests dispatch a `throng:os-drop` CustomEvent
 * carrying paths, because a File synthesised in a renderer is not an OS file. A synthetic event
 * dispatched at a window is not the OS drag-and-drop Principle V reserves for E2E — it is this
 * component’s own documented seam (`drop-target.tsx:24`), and the component test drives the SAME
 * seam with the SAME event, one Electron process cheaper. The two that DO build a real
 * `DataTransfer` and dispatch real `DragEvent`s — the stray-drop navigation guard and the COPY
 * cursor — are untouched: jsdom implements neither constructor, and the cursor test’s method is
 * shadowing a `dropEffect` accessor Chromium refuses to honour on a hand-built transfer.
 *
 * THE SPLIT, WHICH IS WHERE THE CODE ALREADY PUT THE SEAM. `drop-target.tsx:18`: the renderer says
 * "this path was dropped on me" and MAIN resolves the symlinks and applies the confinement rule.
 *   WHICH VERDICT a real path gets → `tests/integration/drop-resolve.integration.test.ts`: `:93` a
 *     real directory is `reason: 'folder'`, `:113` a real file in a real outside folder is
 *     `'out-of-tree'`, `:99` a real oversized file is `'too-large'` — each asserting the REASON,
 *     which is strictly more than either test here could see. Both of them could only tell that A
 *     notice appeared, so a refusal for the WRONG reason passed them.
 *   THE WORDING of each verdict → `packages/core/tests/unit/drop-confinement.test.ts:87`.
 *   WHAT THE RENDERER DOES WITH IT → the component test.
 *
 * WHAT THE REPLACEMENT SAYS THAT NEITHER OF THESE DID:
 *   - the message on screen is MAIN’S OWN, verbatim. `toContainText(/project/i)` was satisfied by
 *     any sentence containing the word, including one the renderer invented.
 *   - each refused path gets its OWN notice. Notices de-duplicate by test id, so a shared id would
 *     show only the last refusal of a five-file drop — the defect `drop-target.tsx:74` names and
 *     that no test anywhere asserted.
 *   - THE PER-PATH LOOP, asserted as a loop. `resolveDrop` is a pure function of ONE path, so an
 *     implementation that abandoned the whole drop on its first refusal passes every unit and
 *     integration test above while discarding files the user plainly meant to open. That is the
 *     claim the folder test existed for, and the component test puts the folder FIRST so an early
 *     exit fails rather than passing by luck.
 *   - the ownership facts the panel forwards with each question — `ownerKind` derived from
 *     `rootless`, the owner root, the tab and every loaded root. Main’s rule is only as good as the
 *     context it is asked about, and nothing below E2E watched the renderer fill that in.
 *
 * ANTI-VACUITY CONTROL: in the component file’s `mount()`, replace `PanelDropTarget` with a plain
 * `div` — the subject is withheld and its window listener never registers. ALL EIGHT tests fail,
 * the four negatives included, because each of those dispatches a drop that must be IGNORED and
 * then a second drop that must LAND.
 *
 * WHAT DID NOT MOVE, and why. The size-limit test also lowers `editor.maxOpenFileBytes` in the
 * running app’s own settings.json and re-drops — a live config hot-reload reaching the drop
 * decision, which no fake bridge can stand in for (034 FR-047, a partial replacement is not a
 * replacement). The two panel-routing tests turn an UNTYPED panel into an editor and read
 * `.cm-content`, and "already open elsewhere" is the workspace’s editor-dedup, not this
 * component’s.
 */

/*
 * ══ ONE TEST LEFT THIS FILE (034 FR-045/FR-046a) ══
 *
 * REMOVED: test('a SYMLINK escaping the project is refused through the running app (US9, SC-011)').
 *
 * WHERE IT WENT. `packages/ui/tests/integration/drop-resolve.integration.test.ts:64` — "a link
 * INSIDE the project that points OUT of it is refused" — makes the same claim against a REAL
 * symlink on a REAL disk, through `EditorService.resolveEntry`, and asserts the reason is
 * `out-of-tree` rather than merely that something was refused. That is STRONGER than what was
 * here: this test could only see that a notice appeared, so a refusal for the wrong reason (a
 * folder check, a size check, a missing file) would have passed it.
 *
 * WHAT DID NOT MOVE, AND WHY THAT IS FINE. The removed test also asserted that the refusal is
 * RENDERED. That claim is unchanged and still made, two tests up, by "a file from OUTSIDE the
 * project is visibly rejected, never a silent no-op" — the identical `out-of-tree` decision
 * reaching the identical `refuse()` notice in drop-target.tsx. One rendering assertion for one
 * code path, not two.
 *
 * IT ALSO BARELY RAN. `symlinkSync` throws without Developer Mode or elevation, so on an ordinary
 * Windows developer machine this test `test.skip`ped itself and proved nothing at all.
 *
 * ══ WHY THE REST OF THIS FILE STAYS ══
 *
 * `tasks.md` T029 records an unconditional "delete os-drop.e2e.ts outright", on two grounds that
 * do not hold. (a) "It dispatches a synthetic event, its header says so" is true of seven tests
 * and FALSE of the last two, which build a real `DataTransfer`, add a real `File` and dispatch
 * real `DragEvent`s — the exact property T029 cites for KEEPING os-drop-defects.e2e.ts. (b)
 * "`drop-confinement.test.ts` already covers every rule it drives" is false: that file tests
 * `resolveDrop`, a pure function over an already-resolved path. It makes no claim about panel
 * routing, an untyped panel becoming an editor, a rendered refusal, the per-path loop, settings
 * reaching the decision, already-open focus, the navigation guard, or the drop cursor.
 *
 * ANTI-VACUITY CONTROL for the replacement: deleting the `await symlink(...)` calls in
 * drop-resolve.integration.test.ts's `beforeEach` makes `symlinksWork` false and the three
 * symlink tests return early — which is why that file asserts on a REASON and not on a boolean.
 */

test('a file over the openable size limit is visibly refused (US9, FR-061/T110a)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    writeFileSync(join(projectRoot, 'big.txt'), 'x'.repeat(4096));
    await runApp(
      async (_app, win) => {
        await createProject(win, 'DropTooLarge', projectRoot);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await tree.getByText('a.txt', { exact: true }).click();
        await expect(win.locator('.editor-panel')).toBeVisible();
        const panelId = await editorPanelId(win);

        // Lower the limit under the file rather than writing a 10 MB fixture.
        const { readFileSync } = await import('node:fs');
        const file = join(sharedCfg, 'settings.json');
        const settings = JSON.parse(readFileSync(file, 'utf8')) as {
          editor: { maxOpenFileBytes: number };
        };
        const shippedLimit = settings.editor.maxOpenFileBytes;
        settings.editor.maxOpenFileBytes = 1024;
        writeFileSync(file, JSON.stringify(settings, null, 2));

        try {
          await expect
            .poll(async () => {
              await dropPaths(win, panelId, [join(projectRoot, 'big.txt')]);
              return win.locator('[data-testid^="os-drop-error"]').first().isVisible();
            })
            .toBe(true);
          await expect(win.locator('[data-testid^="os-drop-error"]').first()).toContainText(
            /too large/i,
          );
        } finally {
          // Put the shipped limit back. It is the one setting this file lowers, the config root
          // now outlives the test, and a 1 KB ceiling left standing would silently refuse a file
          // any later test tried to open. In a `finally` because the state exists from the write
          // above onwards, whether the assertions pass or not.
          settings.editor.maxOpenFileBytes = shippedLimit;
          writeFileSync(file, JSON.stringify(settings, null, 2));
        }
      },
    );
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});

test('a file already open elsewhere FOCUSES that editor, never a second copy (US9, FR-011a)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropAlreadyOpen', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const first = await editorPanelId(win);

      // A second, untyped panel. Dropping the ALREADY-OPEN file on it must not make a second buffer.
      await addPanels(win, 1);
      const ids = await win.locator('[data-testid^="panel-"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid') ?? '').filter((t) => t.startsWith('panel-')),
      );
      expect(ids.length).toBeGreaterThan(1);

      await dropPaths(win, first, [join(projectRoot, 'a.txt')]);
      // One editor holds a.txt — not two.
      await expect(win.locator('.editor-panel')).toHaveCount(1);
    });
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});

test('a stray drop does NOT navigate the window away (US9, FR-061a — the catastrophic one)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropStray', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      const before = win.url();

      // Drop a file on the TITLE BAR — which is not a drop target. The browser engine's default is to
      // NAVIGATE TO IT, replacing the entire running workspace: every terminal, every unsaved buffer,
      // the whole layout, gone. Nothing prevented this before US9.
      //
      // ASSERT ON defaultPrevented, NOT ON THE URL. Chromium never navigates for an untrusted, script-
      // dispatched event, so "the URL did not change" is true whether the guard exists or not — an
      // assertion that passes with the feature deleted is not a test, it is a decoration. What the guard
      // actually does is call preventDefault, and that is observable.
      const prevented = await win.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'a.txt'));
        const target = document.querySelector('.title-bar') ?? document.body;
        const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(drop);
        const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(over);
        return { drop: drop.defaultPrevented, dragover: over.defaultPrevented };
      });
      expect(prevented.drop, 'a stray drop is not prevented — the window will navigate away').toBe(true);
      expect(prevented.dragover, 'a stray dragover is not prevented').toBe(true);

      // Still the app. Still the workspace.
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      expect(win.url()).toBe(before);
    });
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});

test('an OS file drag shows a COPY cursor, not a MOVE one (US9, FR-063)', { tag: ['@extended', '@explorer'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropCursor', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);

      // The explorer's window-level listener used to rewrite dropEffect on EVERY drag, with no check
      // for whether it was an OS file drag — and its default is `move`, which tells the user their file
      // is about to be taken out of the folder it lives in.
      // Chromium IGNORES a write to `dropEffect` on a DataTransfer that was built by hand rather than by
      // a real drag — the setter is a no-op, and reading it back would only ever return "none" however
      // the application behaved. So observe the WRITE, which is the requirement: what does Throng tell
      // the operating system to do with this file? Shadowing the accessor records exactly that, and it
      // records a later `move` from the explorer's window-level listener just as faithfully — which is
      // the regression this test exists to catch.
      const probe = await win.evaluate((id) => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'a.txt'));
        dt.effectAllowed = 'all';
        const writes: string[] = [];
        Object.defineProperty(dt, 'dropEffect', {
          configurable: true,
          get: () => writes[writes.length - 1] ?? 'none',
          set: (v: string) => void writes.push(v),
        });
        const target = document.querySelector(`[data-testid="drop-target-${id}"]`);
        if (!target) return { writes: ['NO-TARGET'], types: [] as string[] };
        target.dispatchEvent(
          new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
        return { writes, types: Array.from(dt.types) };
      }, panelId);
      expect(probe.types).toContain('Files');
      // Copy — and NOTHING afterwards rewrote it to `move`.
      expect(probe.writes).toEqual(['copy']);
    });
  } finally {
    // Every root is deleted in `afterAll`, once the shared app has CLOSED. Deleting one here
    // would remove a folder the explorer is still watching.
  }
});
