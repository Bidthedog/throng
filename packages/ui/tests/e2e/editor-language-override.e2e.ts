import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
  addPanels,
  panelIds,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

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

test('the strip shows the detected language, and an extension-less file reads Plain Text', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LangProj', root);
      const pid = await openEditorOn(win, 'main.rs', 'fn main');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Rust', { timeout: 8000 });

      // …and a file detection cannot place says so, plainly, rather than guessing.
      await win.getByTestId('file-explorer-tree').getByText('scriptfile', { exact: true }).click();
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Plain Text', {
        timeout: 8000,
      });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the language indicator is a themed control with a hover title (constitution — NON-NEGOTIABLE)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LangProj', root);
      const pid = await openEditorOn(win, 'main.rs', 'fn main');
      const control = win.getByTestId(`editor-language-${pid}`);

      // It is an ACTION control, so it names its action on hover.
      await expect(control).toHaveAttribute('title', 'Set language');

      // Its colours resolve from THEME TOKENS — never a hardcoded value, and never an inline SVG.
      const styling = await win.evaluate((id) => {
        const el = document.querySelector(`[data-testid="editor-status-strip-${id}"]`)!;
        const strip = getComputedStyle(el);
        const tokenBg = getComputedStyle(document.documentElement)
          .getPropertyValue('--throng-colour-editorStatusStripBg')
          .trim();
        return {
          stripBg: strip.backgroundColor,
          tokenBg,
          inlineSvgs: el.querySelectorAll('svg').length,
        };
      }, pid);
      expect(styling.tokenBg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(styling.inlineSvgs, 'the strip must not carry an inline SVG').toBe(0);
      expect(styling.stripBg).not.toBe('rgba(0, 0, 0, 0)');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('two clicks reach and change the language, it re-highlights at once, and it SURVIVES A RESTART (SC-004a)', { tag: ['@extended', '@editor'] }, async () => {
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
        await expectLayoutSaved(dataDir, projectName, (json) => json.includes('editor'));
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

test('the strip truncates in a narrow panel and never collapses the text area (FR-010c)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LangProj', root);
      const pid = await openEditorOn(win, 'main.rs', 'fn main');

      const geometry = await win.evaluate((id) => {
        const strip = document.querySelector(`[data-testid="editor-status-strip-${id}"]`)!;
        const panel = document.querySelector(`[data-testid="editor-${id}"]`)!;
        const label = document.querySelector(`[data-testid="editor-language-${id}"]`)!;
        const labelStyle = getComputedStyle(label);
        return {
          stripHeight: strip.getBoundingClientRect().height,
          panelHeight: panel.getBoundingClientRect().height,
          labelOverflow: labelStyle.overflow,
          ellipsis: labelStyle.textOverflow,
          wrap: labelStyle.whiteSpace,
        };
      }, pid);

      // The text area still has real height — the strip sits BELOW it, it does not eat it.
      expect(geometry.panelHeight).toBeGreaterThan(50);
      expect(geometry.stripHeight).toBeGreaterThan(0);
      // The LABEL truncates. Clipping the STRIP would also clip the picker it opens — which is
      // exactly the bug this assertion originally had, and the E2E caught.
      expect(geometry.labelOverflow).toBe('hidden');
      expect(geometry.ellipsis).toBe('ellipsis');
      expect(geometry.wrap).toBe('nowrap');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the strip DIMS with its panel — it does not stay lit while every other indicator dims (FR-010g)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LangProj', root);
      const pid = await openEditorOn(win, 'main.rs', 'fn main');
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Rust');

      // The active panel's strip is fully lit.
      const litOpacity = await win.evaluate(
        (id) =>
          getComputedStyle(document.querySelector(`[data-testid="editor-status-strip-${id}"]`)!)
            .opacity,
        pid,
      );
      expect(Number(litOpacity)).toBe(1);

      // Add a second panel and make IT active. The editor's strip must now dim with its panel —
      // a strip left brightly lit while 012's own indicator dimmed would contradict the very
      // indicator it sits beside.
      await addPanels(win, 1);
      const ids = await panelIds(win);
      const other = ids.find((i) => i !== pid)!;
      await win.getByTestId(`panel-${other}`).click();

      await expect
        .poll(
          () =>
            win.evaluate(
              (id) =>
                Number(
                  getComputedStyle(
                    document.querySelector(`[data-testid="editor-status-strip-${id}"]`)!,
                  ).opacity,
                ),
              pid,
            ),
          { timeout: 6000 },
        )
        .toBeLessThan(1);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a persisted language this build no longer knows opens as plain text, WITHOUT error, and is preserved (FR-005b)', { tag: ['@extended', '@editor'] }, async () => {
  /*
   * JOINED THE SHARED APP (SC-027) — 4 launches -> 3.
   *
   * This kept its own app for a `{ dataDir, userDataDir }` pair that were both freshly
   * mkdtemp'd and EMPTY. That is write isolation, not pre-launch state: every fact this test
   * needs is written THROUGH the running app by `document.setState` below, and a shared
   * database holding other projects' rows cannot answer for this one.
   *
   * The one thing that did depend on isolation was `projects.list` -> `projects[0].id`, which
   * picks the FIRST project rather than this test's once the app has several. It now reads the
   * ACTIVE row, which `createProject` guarantees is the project it just made.
   */
  const root = makeProject();
  try {
    await runApp(
      async (_app, win) => {
        const errors: string[] = [];
        win.on('pageerror', (e) => errors.push(e.message));
        await createProject(win, 'StaleProj', root);

        // Store an override naming a language this build does not have — what a user would have
        // if a later build removed a language, or an older build has not yet gained one.
        const projectId = await win
          .locator('.project-item[data-active="true"]')
          .evaluate((el) => (el.getAttribute('data-testid') ?? '').replace('project-item-', ''));
        expect(projectId, 'no active project row to take an id from').not.toBe('');
        await win.evaluate(
          ({ id }) =>
            window.throng?.invoke?.('document.setState', {
              projectId: id,
              relPath: 'main.rs',
              languageId: 'elvish',
            }),
          { id: projectId },
        );

        const pid = await openEditorOn(win, 'main.rs', 'fn main');

        // It FALLS THROUGH to detection rather than failing: the file opens, as Rust, with no error.
        await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Rust', { timeout: 8000 });
        expect(errors, `a stale id must not raise an error: ${errors.join('; ')}`).toEqual([]);

        // …and the stored id is PRESERVED, not rewritten. A build that reintroduces the language
        // must find the user's choice still there — silently "repairing" it would destroy it.
        const stored = await win.evaluate(
          async ({ id }) => {
            const env = (await window.throng?.invoke?.('document.getState', {
              projectId: id,
              relPath: 'main.rs',
            })) as { result: { state: { languageId: string } | null } };
            return env.result.state?.languageId ?? null;
          },
          { id: projectId },
        );
        expect(stored).toBe('elvish');
      },
    );
  } finally {
    cleanupTemp(root);
  }
});

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
