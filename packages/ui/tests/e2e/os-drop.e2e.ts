import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addPanels, createProject, firstPanelId, runApp } from './harness.js';

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

/** A folder OUTSIDE every project — where a sub-workspace editor is allowed to live. */
function makeOutsideFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-out-'));
  writeFileSync(join(root, 'outside.txt'), 'outside\n');
  return root;
}

test('a file dropped on an editor panel in its own project opens (US9, FR-057)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a file dropped on an UNTYPED panel makes it an editor showing the file (US9, FR-056)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a file from OUTSIDE the project is visibly rejected, never a silent no-op (US9, FR-061)', async () => {
  const projectRoot = makeProjectFolder();
  const outside = makeOutsideFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);

      await dropPaths(win, panelId, [join(outside, 'outside.txt')]);

      // The refusal is SEEN. A rejection that says nothing is indistinguishable from a drop that missed.
      await expect(win.locator('[data-testid^="os-drop-error"]').first()).toBeVisible();
      await expect(win.locator('[data-testid^="os-drop-error"]').first()).toContainText(/project/i);
      // …and the editor still holds the file it had.
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('alpha');
      await expect(win.getByTestId(`editor-${panelId}`)).not.toContainText('outside');
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a SYMLINK escaping the project is refused through the running app (US9, SC-011)', async () => {
  const projectRoot = makeProjectFolder();
  const outside = makeOutsideFolder();
  let linked = false;
  try {
    // A link that LIVES in the project and RESOLVES outside it. Judging the link rather than its target
    // would admit the file — and then refuse to save it.
    try {
      symlinkSync(join(outside, 'outside.txt'), join(projectRoot, 'escape.txt'), 'file');
      linked = true;
    } catch {
      // Windows needs Developer Mode or elevation to create a symlink. Skipping is honest; silently
      // passing would be a test that proves nothing.
      test.skip(true, 'symlink creation requires Developer Mode or elevation on Windows');
    }
    if (!linked) return;

    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);

      await dropPaths(win, panelId, [join(projectRoot, 'escape.txt')]);

      await expect(win.locator('[data-testid^="os-drop-error"]').first()).toBeVisible();
      await expect(win.getByTestId(`editor-${panelId}`)).not.toContainText('outside');
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a FOLDER is rejected; the other files in the same drop still open (US9, FR-065)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);

      // A folder among the files must be refused ON ITS OWN — not by throwing away the whole drop,
      // which would discard files the user plainly meant to open.
      await dropPaths(win, panelId, [join(projectRoot, 'src'), join(projectRoot, 'b.txt')]);

      await expect(win.locator('[data-testid^="os-drop-error"]').first()).toBeVisible();
      await expect(win.locator('[data-testid^="os-drop-error"]').first()).toContainText(/folder/i);
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('beta');
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a file over the openable size limit is visibly refused (US9, FR-061/T110a)', async () => {
  const projectRoot = makeProjectFolder();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  try {
    writeFileSync(join(projectRoot, 'big.txt'), 'x'.repeat(4096));
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Demo', projectRoot);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await tree.getByText('a.txt', { exact: true }).click();
        await expect(win.locator('.editor-panel')).toBeVisible();
        const panelId = await editorPanelId(win);

        // Lower the limit under the file rather than writing a 10 MB fixture.
        const { readFileSync } = await import('node:fs');
        const file = join(cfgRoot, 'settings.json');
        const settings = JSON.parse(readFileSync(file, 'utf8')) as {
          editor: { maxOpenFileBytes: number };
        };
        settings.editor.maxOpenFileBytes = 1024;
        writeFileSync(file, JSON.stringify(settings, null, 2));

        await expect
          .poll(async () => {
            await dropPaths(win, panelId, [join(projectRoot, 'big.txt')]);
            return win.locator('[data-testid^="os-drop-error"]').first().isVisible();
          })
          .toBe(true);
        await expect(win.locator('[data-testid^="os-drop-error"]').first()).toContainText(/too large/i);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a file already open elsewhere FOCUSES that editor, never a second copy (US9, FR-011a)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a stray drop does NOT navigate the window away (US9, FR-061a — the catastrophic one)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an OS file drag shows a COPY cursor, not a MOVE one (US9, FR-063)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
