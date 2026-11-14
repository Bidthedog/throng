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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  // 068 MT-01: a note whose diagrams and embeds sit BELOW its heading, reached through a vault link.
  // The maintainer's shape: a short head, the heading EARLY, and every diagram and embed BELOW it — so before they
  // draw the document is too short for the heading to reach the top, and a jump made then clamps and lands short.
  const head = '# Platform\n\n| | |\n|---|---|\n| **Status** | Draft |\n| **Owner** | Platform |\n\n## 1. Summary\n\nThe platform takes an order from checkout to delivery.\n\n- Checkout p99 under 400 ms\n- No lost orders\n\n';
  // Large real diagrams (the maintainer's fixture): they take real time to lay out and draw, as theirs do.
  const large = readFileSync(fileURLToPath(new URL('./fixtures/mermaid-order-platform.mmd', import.meta.url)), 'utf8');
  const fence = (_n: number): string => `\`\`\`mermaid\n${large}\n\`\`\`\n`;
  writeFileSync(join(root, 'sysctx.md'), `${head}## 2. System Context\n\n${fence(1)}\n${fence(2)}\n${fence(3)}\n![[flow.mmd|300]]\n\n![Flow](flow.mmd)\n\n![[missing.mmd]]\n`);
  writeFileSync(join(root, 'nav.md'), '# Nav\n\n[[sysctx#2. System Context]]\n');
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
  const title = `${file} - Preview`; // 054 FR-005a: the full file name
  const heading = win.locator('[data-testid^="panel-title-"]').filter({ hasText: new RegExp(`^${title.replace(/\./g, '\\.')}$`) }).first();
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
  await expect(win.getByTestId(`panel-title-${id}`)).toHaveText('flow.mmd - Preview'); // 054 FR-005a, as Markdown
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

test('MT-01: a followed #heading below drawing diagrams ends at the top of the body once they have drawn', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromEditor(win, 'nav.md', 'Nav');
  const body = win.getByTestId(`preview-body-${id}`);
  await body.locator('a').first().click({ modifiers: ['Control'] }); // the note's one link: [[sysctx#2. System Context]]
  const heading = body.locator('h2', { hasText: 'System Context' });
  await expect(heading).toBeVisible({ timeout: 10_000 });
  // Every diagram has drawn: three fences and two embeds.
  for (let n = 0; n < 5; n += 1) await expect(win.getByTestId(`diagram-frame-${id}-diagram-${n}`).locator('svg').first()).toBeVisible({ timeout: 15_000 });
  const offset = (): Promise<number> => win.evaluate(
    ([bodyId]) => {
      const host = document.querySelector(`[data-testid="${bodyId}"]`)!;
      const h = [...host.querySelectorAll('h2')].find((el) => el.textContent?.includes('System Context'))!;
      return h.getBoundingClientRect().top - host.getBoundingClientRect().top;
    },
    [`preview-body-${id}`],
  );
  // Let layout from the late draws settle, then measure; the numbers are printed on every run.
  const samples: number[] = [];
  for (let n = 0; n < 15; n += 1) {
    await win.evaluate(() => new Promise<void>((done) => setTimeout(done, 200)));
    samples.push(await offset());
  }
  const measured = samples[samples.length - 1]!;
  console.log(`MT-01 heading offset from the body's top, every 200ms after the last diagram drew: ${samples.map((s) => s.toFixed(1)).join(' ')} px`);
  expect(Math.abs(measured)).toBeLessThanOrEqual(2);
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
