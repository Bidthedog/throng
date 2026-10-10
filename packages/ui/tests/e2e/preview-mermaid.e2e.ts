/**
 * 054 T068 — Mermaid diagrams in a real window: a ```mermaid fence in a Markdown preview draws a themed SVG
 * under the shipped dark theme, a standalone `.mmd` file draws through its own provider, and a source that
 * does not parse shows the inline notice (FR-040, FR-042, FR-044, FR-046; research R5).
 *
 * ══ WHY THIS IS AN E2E (`@reserve:layout`) ══
 *
 * Everything around the drawing is pinned lower down, against a fake mermaid: the block registry and the
 * renderer's call order (`unit/block-renderers`, `unit/mermaid-renderer`), the SVG profile
 * (`unit/diagram-svg-sanitise`, `component/preview-diagram-hostile`), the frame and the notice
 * (`component/preview-diagram-frame`, `component/preview-diagram-block`) and the standalone body
 * (`component/preview-mermaid-standalone`). jsdom cannot lay out SVG, so none of them runs the real
 * library: whether mermaid 12, loaded through the lazy `diagram` chunk under the app's real CSP, actually
 * produces a drawing — and paints it in the theme's colours rather than its own light defaults — is only
 * visible in a running renderer.
 *
 * One shared app: nothing here is seeded before launch, and each test opens its own preview.
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';

const FLOW = 'graph TD\n  Start[Begin here] --> Finish[Done]\n';

let shared: OpenApp | undefined;
let root = '';
let editorId = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-preview-mermaid-'));
  writeFileSync(join(root, 'diagram.md'), `# Diagram doc\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n`);
  writeFileSync(join(root, 'flow.mmd'), FLOW);
  writeFileSync(join(root, 'broken.mmd'), 'graph TD\n  A -->\n');
  // MT-05: the maintainer's file, byte for byte, under a folder whose name has a space and capitals.
  mkdirSync(join(root, 'UPPER TEST'));
  copyFileSync(fileURLToPath(new URL('./fixtures/mermaid-order-platform.mmd', import.meta.url)), join(root, 'UPPER TEST', 'test.mmd'));
  shared = await openApp();
  await createProject(shared.win, 'PreviewMermaid', root);
  editorId = await firstPanelId(shared.win);
  await shared.win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await shared.win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await expect(shared.win.getByTestId(`editor-${editorId}`)).toBeVisible();
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Click a file in the tree into the editor, then open its preview from the status bar; the new panel's id. */
async function previewFromEditor(win: Page, file: string, text: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText(text, { timeout: 8000 });
  const button = win.getByTestId(`editor-preview-${editorId}`);
  await expect(button).toBeEnabled();
  const body = win.locator('[data-testid^="preview-body-"]');
  const before = new Set(await body.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))));
  await button.click();
  await expect.poll(async () => (await body.count()) > before.size).toBe(true);
  const ids = await body.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  const added = ids.find((id) => !before.has(id));
  if (!added) throw new Error(`previewFromEditor(${file}): no new preview panel appeared`);
  return added.replace('preview-body-', '');
}

/**
 * Click a Mermaid file in the tree: its default open action ships as Preview (054 MT-04), so the click
 * itself opens the preview. Under Last Active a later file reuses the earlier Mermaid preview, so the
 * panel is found by its title rather than as a newly added body. Returns the panel's id.
 */
async function previewFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const title = `${file.replace(/\.[^.]+$/, '')} - Preview`;
  const heading = win.locator('[data-testid^="panel-title-"]').filter({ hasText: new RegExp(`^${title}$`) }).first();
  await expect(heading).toBeVisible({ timeout: 8000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`previewFromTree(${file}): no preview panel titled ${title}`);
  return testId.replace('panel-title-', '');
}

/** A theme token as the renderer resolves it, in the `rgb(…)` form `getComputedStyle` reports. */
async function resolvedToken(win: Page, token: string): Promise<string> {
  return win.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--throng-colour-${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

test('a mermaid fence in a Markdown preview draws an SVG in the dark theme’s colours', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromEditor(win, 'diagram.md', 'Diagram doc');
  const frame = win.getByTestId(`diagram-frame-${id}-diagram-0`);
  const svg = frame.locator('svg').first();
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await expect(svg).toContainText('Begin here');
  await expect(svg).toContainText('Done');
  // Its view controls are the frame's.
  await expect(frame.getByTitle('Fit diagram')).toBeVisible();

  // Themed: a node is painted with the theme's surface token, never mermaid's own light default.
  const surface = await resolvedToken(win, 'surfaceActive');
  const nodeFill = await svg.locator('.node rect, .node polygon, .node path').first().evaluate((el) => getComputedStyle(el).fill);
  expect(nodeFill).toBe(surface);
  expect(nodeFill).not.toBe('rgb(236, 236, 255)');
});

test('a standalone .mmd file previews as one diagram through the Mermaid provider', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromTree(win, 'flow.mmd');
  await expect(win.getByTestId(`preview-mermaid-${id}`)).toBeVisible();
  const svg = win.getByTestId(`diagram-frame-${id}-diagram-0`).locator('svg').first();
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await expect(svg).toContainText('Begin here');
  await expect(win.getByTestId(`panel-title-${id}`)).toHaveText('flow - Preview'); // 044 FR-031, as Markdown
});

test('MT-05: a large real-world flowchart in a folder with a space and capitals previews as a drawing', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  await win.getByTestId('file-explorer-tree').getByTestId('tree-twisty-UPPER TEST').click(); // the name only selects (#121)
  const id = await previewFromTree(win, 'test.mmd');
  await expect(win.getByTestId(`preview-mermaid-${id}`)).toBeVisible();
  const svg = win.getByTestId(`diagram-frame-${id}-diagram-0`).locator('svg').first();
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await expect(svg).toContainText('Catalog Service');
  await expect(win.getByTestId(`diagram-notice-${id}-diagram-0`)).toHaveCount(0);
});

test('a Mermaid source that does not parse shows the inline notice instead of a drawing', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromTree(win, 'broken.mmd');
  const notice = win.getByTestId(`diagram-notice-${id}-diagram-0`);
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('This diagram could not be drawn');
  // Never drawn, so there is no last good diagram to keep beneath it.
  await expect(win.getByTestId(`diagram-frame-${id}-diagram-0`)).toHaveCount(0);
});
