import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createProject,
  openApp,
  cleanupTemp,
  stayedAbsent,
  type AppOptions,
  type OpenApp,
} from './harness.js';

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

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Two temp roots, and the two projects are now named APART
 * (both were "Demo") so an accumulating sidebar cannot make `.project-item` ambiguous — the row
 * renders its ROOT PATH beside the name and Playwright's hasText is a substring match.
 *
 * The leftover state, named: test 1 ends with a.txt open in an editor whose content it has just
 * asserted is unchanged, and test 2 makes its own project. `editorPanelId` reads
 * `[data-testid^="editor-"]` WINDOW-WIDE and still sees only test 2's panels, because an
 * inactive project's workspace is not rendered at all. The two a.txt paths differ, so the
 * one-buffer registry (keyed on the ABSOLUTE path) cannot collide either.
 *
 * The roots are deleted in `afterAll`, NOT per test.
 */
const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
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

test('a dropped file is NEVER pasted into the editor as text (the content-injection bug)', { tag: ['@extended', '@explorer', '@reserve:osdrag'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DropInject', projectRoot);
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

      // The fence: `evil.txt` is a synthetic in-memory File with no real OS path, so once
      // CodeMirror's own handler above hands the (still-bubbling) event off, `PanelDropTarget`
      // resolves zero paths and raises its own "no file on disk" refusal — the proof that the
      // whole drop has finished being decided, one way or the other.
      await stayedAbsent(
        () => expect(win.getByTestId('os-drop-error-no-path')).toBeVisible(),
        async () =>
          ((await win.getByTestId(`editor-${panelId}`).textContent()) ?? '').includes(
            'CONTENT-INJECTED',
          )
            ? 1
            : 0,
        "CONTENT-INJECTED text landing in the editor via CodeMirror's own drop handler",
      );
      await expect(win.getByTestId(`editor-${panelId}`)).toContainText('alpha');
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});

/*
 * ONE TEST REMOVED (035 FR-007) — "a drop opens the file in the panel UNDER THE CURSOR, not the
 * active one".
 *
 * It dispatched `throng:os-drop` CustomEvents by hand — twice — rather than driving a drag, so the
 * OS was never in it. What it asserted is `openFileInPanel` preferring the panel it was aimed at
 * over the tab's last active editor, and that is
 * `component/editor-open-routing.test.ts:349`, which makes the distinction more sharply than any
 * E2E can: it puts the last-active editor somewhere ELSE and asserts the dropped-on panel's
 * `openFile` fired while the last-active panel's did not.
 *
 * The E2E could not make that distinction, and its own setup shows why — it spent fifteen lines
 * arming the trap (create a second editor by a drop, then click the first to make it last-active
 * again) to reach a state the component test reaches in one call. An `openFileInPanel` that simply
 * delegated to `openFileInTab` would still pass every OTHER drop test in the suite, because in all
 * of them the dropped-on panel IS the last active one.
 *
 * The test above it stays. It builds a real `DataTransfer` and drops onto CodeMirror's own handler,
 * which is the content-injection path and is not reproducible without a real drag.
 */
