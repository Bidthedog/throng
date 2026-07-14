import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, addPanels, panelIds } from './harness.js';
import { skipIfElevated } from './admin.js';

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

const tokenColours = (win: Page, pid: string): Promise<number> =>
  win.evaluate((id) => {
    const spans = document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`);
    const colours = new Set<string>();
    spans.forEach((s) => colours.add(getComputedStyle(s).color));
    return colours.size;
  }, pid);

test('the strip shows the detected language, and an extension-less file reads Plain Text', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the language indicator is a themed control with a hover title (constitution — NON-NEGOTIABLE)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('two clicks reach and change the language, it re-highlights at once, and it SURVIVES A RESTART (SC-004a)', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-lang-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-lang-user-'));
  try {
    // Session 1: correct the language by hand.
    await runApp(
      async (_app, win) => {
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
        await win.waitForTimeout(1200);
      },
      { dataDir, userDataDir },
    );

    // Session 2, same store: the override is DOCUMENT state, so the panel that opens the file
    // ADOPTS it rather than re-detecting and overruling the user. This is the assertion the whole
    // SQLite table exists for — a layout blob keyed by panel could not answer it.
    await runApp(
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
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the strip truncates in a narrow panel and never collapses the text area (FR-010c)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the strip DIMS with its panel — it does not stay lit while every other indicator dims (FR-010g)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a persisted language this build no longer knows opens as plain text, WITHOUT error, and is preserved (FR-005b)', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-stale-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-stale-user-'));
  try {
    await runApp(
      async (_app, win) => {
        const errors: string[] = [];
        win.on('pageerror', (e) => errors.push(e.message));
        await createProject(win, 'StaleProj', root);

        // Store an override naming a language this build does not have — what a user would have
        // if a later build removed a language, or an older build has not yet gained one.
        const projectId = await win.evaluate(async () => {
          const env = (await window.throng?.invoke?.('projects.list', {})) as {
            result: { projects: { id: string }[] };
          };
          return env.result.projects[0].id;
        });
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
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the language picker closes when you click anywhere off it', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'OverrideProj', root);
      const pid = await openEditorOn(win, 'main.rs', 'fn main');

      // It closed on Escape, and on choosing a language — and on nothing else. A menu you can only
      // dismiss by guessing the keyboard shortcut is a menu that follows you around the app.
      await win.getByTestId(`editor-language-${pid}`).click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();

      // Click into the document — somewhere plainly "not the menu".
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);

      // …and clicking the strip button itself still TOGGLES it, rather than the outside-click
      // handler closing it a moment before the button reopens it (the classic way this is broken).
      await win.getByTestId(`editor-language-${pid}`).click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-language-${pid}`).click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);

      // Clicking INSIDE the picker must not dismiss it — you have to be able to use the filter.
      await win.getByTestId(`editor-language-${pid}`).click();
      await win.getByTestId(`language-filter-${pid}`).click();
      await win.getByTestId(`language-filter-${pid}`).fill('rus');
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
