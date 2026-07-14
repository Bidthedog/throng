import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addPanels, createProject, runApp } from './harness.js';

/**
 * 018 follow-up — the drop defects found by actually dragging files at the application.
 *
 * These are DOM-level tests, deliberately. The existing os-drop suite drives the path-taking seam with
 * a custom event, which is right for the confinement rule — but it also means CodeMirror never sees a
 * drop event, and CodeMirror turns out to be the whole problem.
 */

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  writeFileSync(join(root, 'a.txt'), 'alpha\n');
  writeFileSync(join(root, 'b.txt'), 'beta\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'seed.txt'), 'seed');
  return root;
}

/** The id of the panel holding an editor (opening from the tree makes a dedicated one). */
async function editorPanelId(win: Page): Promise<string> {
  const id = await win.locator('[data-testid^="editor-"]').first().getAttribute('data-testid');
  return (id ?? '').slice('editor-'.length);
}

/** Dispatch a REAL DOM drop of an OS-style file onto an element. */
async function domDrop(win: Page, selector: string, name: string, content: string): Promise<void> {
  await win.evaluate(
    ([sel, fileName, text]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], fileName, { type: 'text/plain' }));
      const target = document.querySelector(sel);
      if (!target) throw new Error(`no element for ${sel}`);
      // CodeMirror maps the drop to a document position from the POINTER COORDINATES, and bails if they
      // fall outside it — so an event at (0,0) never reaches the code that does the damage.
      const r = target.getBoundingClientRect();
      target.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: Math.floor(r.left + r.width / 2),
          clientY: Math.floor(r.top + r.height / 2),
        }),
      );
    },
    [selector, name, content] as const,
  );
}

test('a dropped file is NEVER pasted into the editor as text (the content-injection bug)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const panelId = await editorPanelId(win);
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('alpha');

      // CodeMirror handles `drop` ITSELF: it reads the dropped files and inserts their text straight
      // into the document. So a file the confinement rule REFUSES still had its entire contents poured
      // into the editor — and then synced to every other window holding that buffer. The refusal
      // notice appeared, correctly, on top of the damage it had failed to prevent.
      await domDrop(win, `[data-testid="editor-${panelId}"] .cm-content`, 'evil.txt', 'CONTENT-INJECTED');

      await win.waitForTimeout(600);
      await expect(win.getByTestId(`editor-${panelId}`)).not.toContainText('CONTENT-INJECTED');
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('alpha');
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a drop opens the file in the panel UNDER THE CURSOR, not the active one', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Two editors: a.txt in the first, and a second, empty one.
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(win.locator('.editor-panel')).toBeVisible();
      const first = await editorPanelId(win);

      // A SECOND editor panel, made an editor via a drop of its own, then left alone. `first` stays
      // the tab's last-active editor, which is exactly the trap: the drop below aims at `second`.
      await addPanels(win, 1);
      const untyped = await win
        .locator('[data-testid^="panel-type-form-"]')
        .first()
        .getAttribute('data-testid');
      const second = (untyped ?? '').slice('panel-type-form-'.length);
      expect(second).not.toBe('');
      expect(second).not.toBe(first);
      await win.evaluate(
        ([id, path]) => {
          window.dispatchEvent(
            new CustomEvent('throng:os-drop', { detail: { panelId: id, paths: [path] } }),
          );
        },
        [second, join(projectRoot, 'src', 'seed.txt')] as const,
      );
      // Let it FINISH becoming an editor before aiming the next drop at it.
      await expect(win.getByTestId(`editor-${second}`)).toContainText('seed');
      // The FIRST panel is the tab's last-active editor again — click it, so the trap is armed.
      await win.getByTestId(`editor-${first}`).click();

      // Drop b.txt on the SECOND panel. It must open THERE — the drop is a gesture at a place, and
      // routing it to whichever editor happened to be active last ignores where the user aimed.
      await win.evaluate(
        ([id, path]) => {
          window.dispatchEvent(
            new CustomEvent('throng:os-drop', { detail: { panelId: id, paths: [path] } }),
          );
        },
        [second, join(projectRoot, 'b.txt')] as const,
      );

      await expect(win.getByTestId(`editor-${second}`)).toBeVisible();
      await expect(win.getByTestId(`editor-${second}`)).toContainText('beta');
      // …and the first editor is untouched.
      await expect(win.getByTestId(`editor-${first}`)).toContainText('alpha');
      await expect(win.getByTestId(`editor-${first}`)).not.toContainText('beta');
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
