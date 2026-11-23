import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import {
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type OpenApp,
} from './harness.js';

/*
 * The one remaining test seeds state and restarts the app, so it launches its own through `runOwnApp`;
 * there is no shared app. `createProject` appends a counter so project names stay unique.
 */

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// 016 US5 (FR-010/FR-011/FR-005a/FR-005b) — see the language, and correct it.
//
// The status strip is the ONLY way a user can observe what US1 decided, and the picker is the only
// way to correct it. Without them, an undetectable file has no path back.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-lang-'));
  writeFileSync(join(root, 'main.rs'), 'fn main() {\n    let x = 1;\n}\n');
  // No extension at all: detection cannot help, so the strip must say Plain Text and the picker
  // must be the way out.
  writeFileSync(join(root, 'scriptfile'), 'echo "hello"\n');
  return root;
}

async function openEditorOn(win: Page, file: string, contains: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(contains, {
    timeout: 8000,
  });
  return pid;
}

/** Wait until PROJECT's layout in the daemon's SQLite store satisfies `predicate`. */
async function expectLayoutSaved(
  dataDir: string,
  projectName: string,
  predicate: (layoutJson: string) => boolean,
): Promise<void> {
  await expect
    .poll(
      () => {
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
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" was never persisted` },
    )
    .toBe(true);
}

const tokenColours = (win: Page, pid: string): Promise<number> =>
  win.evaluate((id) => {
    const spans = document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`);
    const colours = new Set<string>();
    spans.forEach((s) => colours.add(getComputedStyle(s).color));
    return colours.size;
  }, pid);

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:129` "the strip shows the detected language, and an extension-less file reads Plain Text" →
 * `packages/ui/tests/component/editor-language-strip.test.ts`.
 *
 * Detection is `@throng/core`'s `resolveLanguage` and is thoroughly covered there.
 * `editor-language.ts` is the renderer's side — the resolution store, the precedence chain and the
 * hook the strip reads — and it had NO test at any layer. So this test was the only thing saying the
 * strip shows what detection decided rather than, say, the extension upper-cased.
 *
 * The second assertion is the one worth having, and the replacement keeps it: a file detection
 * cannot place says so plainly rather than guessing. A strip that kept the PREVIOUS file's language
 * — the failure a shared panel makes easy — is wrong in a way the user only discovers when their
 * colouring is silently another language's.
 *
 * Four cases came down with it that this test could not reach, because it drove one panel with no
 * override: an override outranks the extension (FR-005a), an override applies to an unsaved document
 * too (the SQL scratchpad), two panels resolve INDEPENDENTLY, and a strip mounted before its editor
 * has resolved reads plain text rather than another panel's answer. A store keyed globally instead
 * of per panel would have passed everything here and been wrong the moment two editors were open.
 *
 * ── WHAT STAYS ──
 *
 * That opening a file in a real editor causes `setPanelLanguage` to be called at all — the load
 * path in `useEditor` — plus everything in this file about computed colours and the themed control,
 * which is layout.
 */

test('two clicks reach and change the language, it re-highlights at once, and it SURVIVES A RESTART (SC-004a)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-lang-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-lang-user-'));
  try {
    // Session 1: correct the language by hand.
    await runOwnApp(
      async (_app, win) => {
        // Captured BEFORE the call: the shared counter is incremented inside createProject, so
        // this is the exact suffixed name the project ends up with — needed to poll its own row.
        const projectName = `LangProj-${projectSeq + 1}`;
        await createProject(win, 'LangProj', root);
        const pid = await openEditorOn(win, 'scriptfile', 'echo');
        await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Plain Text');
        expect(
          await tokenColours(win, pid),
          'plain text must not be highlighted',
        ).toBeLessThanOrEqual(1);

        // Click 1: the indicator. Click 2: the language. SC-004a puts a NUMBER on that journey —
        // "at most two clicks" — so it is COUNTED here, not merely exercised.
        await win.getByTestId(`editor-language-${pid}`).click();
        await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();
        await win.getByTestId(`language-filter-${pid}`).fill('shell');
        await win.getByTestId('language-option-shell').click();

        // Applied IMMEDIATELY — no reopen, no OK button to forget to press.
        await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Shell');
        await expect.poll(() => tokenColours(win, pid), { timeout: 8000 }).toBeGreaterThan(1);

        // Let the debounced workspace-layout write reach the store, so session 2 restores the
        // panel rather than opening on an empty workspace.
        // The panel's FILE, not merely "an editor": the empty editor panel is saved before the file opens in it,
        // and on hosted macOS session 2 then restored an editor with nothing in it.
        await expectLayoutSaved(dataDir, projectName, (json) => json.includes('scriptfile'));
      },
      { dataDir, userDataDir },
    );

    // Session 2, same store: the override is DOCUMENT state, so the panel that opens the file
    // ADOPTS it rather than re-detecting and overruling the user. This is the assertion the whole
    // SQLite table exists for — a layout blob keyed by panel could not answer it.
    await runOwnApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'LangProj' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10_000 });
        await expect(editor.locator('.cm-content')).toContainText('echo', { timeout: 10_000 });

        await expect(win.locator('.editor-status-strip__language').first()).toHaveText('Shell', {
          timeout: 10_000,
        });
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
    cleanupTemp(root);
  }
});

/*
 * MOVED DOWN (test-suite audit) — "the strip truncates in a narrow panel and never collapses the text
 * area (FR-010c)". The label's `overflow: hidden`, `text-overflow: ellipsis` and `white-space: nowrap`
 * are declared keywords on a plain class, so `component/status-strip-declared-css.test.ts` ("the
 * language label truncates, and the strip does not clip (FR-010c)") reads them from the application's
 * own stylesheet — red with `text-overflow` changed to `clip`, and red with `overflow: hidden` on the
 * strip. The text area's height staying put as the bar changes is measured in
 * `editor-status-bar.e2e.ts`.
 */

/*
 * The themed-control claims (constitution — NON-NEGOTIABLE) that used to be their own declaration —
 * "the language indicator is a themed control with a hover title" — are folded into this one (test-suite
 * audit): both open the same file in a real editor and read the same strip, so they share its setup.
 */
/*
 * MOVED DOWN (044 T163b): "a persisted language this build no longer knows opens as plain text,
 * WITHOUT error, and is preserved (FR-005b)". A precedence decision and a persisted value, neither
 * of which needs a window. Each claim was observed failing below against a broken implementation
 * before this declaration was deleted:
 *
 *   - falls through to detection — `core/tests/unit/language-precedence.test.ts` and
 *     `ui/tests/unit/language-detect.test.ts` (resolveLanguage accepting any
 *     override);
 *   - opens WITHOUT error — `ui/tests/unit/language-loaders.test.ts` (loadLanguage throwing for an
 *     unknown id);
 *   - the store keeps the id — `daemon/tests/integration/document-ipc.integration.test.ts`
 *     (setState refusing the id);
 *   - opening the file does not rewrite it — `ui/tests/unit/language-override-load.test.ts`, written
 *     for this move (loadDocumentOverride clearing a stale override on load).
 */

/*
 * MOVED to `packages/ui/tests/component/status-strip-picker-dismissal.test.ts` (034 FR-045)
 * — one test, four component tests in its place.
 *
 * It launched Electron, started a daemon, made a real temp project and opened a real CodeMirror
 * document in order to assert three facts about `useState` and one `document.addEventListener`.
 * The subject is `status-strip.tsx:117-125`: a `mousedown` listener, in capture, asking whether
 * the event landed inside the STRIP. No layout is measured and no OS focus moves between panels.
 * `.cm-content` was only ever "somewhere plainly not the menu"; a sibling <div> is the same click.
 *
 * VERIFIED NOT ALREADY COVERED (FR-046a): `packages/ui/tests/component/picker.test.ts:168` is a
 * different component (`common/picker.tsx`, the Quick Open typeahead) and a different gesture
 * (Escape). The language picker has its own Escape handler at `language-picker.tsx:151`, and
 * nothing below E2E touched the outside-click at all.
 *
 * THE REPLACEMENTS ASSERT MORE THAN THIS TEST DID:
 *   - the toggle claim is stated as its own failure — a listener watching only the MENU closes
 *     on the button’s `mousedown` and lets the button’s `click` reopen it, so the control looks
 *     inert. "The second click leaves it closed" is what separates the two.
 *   - the click INSIDE the picker is asserted as part of the same mechanism rather than after a
 *     re-open, and the filter is proved to still filter — so "still open" cannot be true of a
 *     picker that had stopped responding.
 *
 * WHAT STAYS, AND WHY: the other six tests in this file. Five assert a computed colour, a
 * computed background, or truncation at a real width — Principle V’s real-layout-and-text-
 * rendering reserve, and FR-049 forbids `getComputedStyle` at the component layer outright. The
 * sixth survives a real restart.
 *
 * ANTI-VACUITY CONTROL for the replacement file: drop the `ServicesProvider` wrapper from its
 * `mount()`. `LanguagePicker` calls `useServices()` on its first render and every test opens the
 * picker, so ALL FOUR fail. Each test also asserts the picker PRESENT before asserting anything
 * about it going away, so an empty document satisfies none of them.
 */
