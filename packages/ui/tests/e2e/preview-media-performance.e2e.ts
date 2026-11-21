/**
 * 074 SC-003, SC-004, SC-005 — how fast the media previews appear, and that a long PDF never freezes the window.
 *
 * - SC-003: a 10 MB image appears within 1 second of opening, and a 5 MB SVG within 1.5 seconds with the loading
 *   spinner shown meanwhile (the maintainer's ruling, 2026-11-21); a parented HTML or SVG preview shows an edit
 *   within the configured update delay plus 250 ms.
 * - SC-004: a 500-page PDF shows its first page within 2 seconds of opening, and scrolling through it never freezes
 *   the window for more than 100 ms at a time.
 * - SC-005: a file over its preview's size limit shows the size notice within 200 ms of opening.
 *
 * ══ WHERE THESE ARE ADJUDICATED ══
 *
 * Through `expectWithinSla`: asserted at one worker on reference hardware, recorded as an `sla-not-measured` reading
 * everywhere else, CI included (performance-sla.md). The spec is in the serial tier as TIMING for that reason. Take
 * the reading with `npx playwright test packages/ui/tests/e2e/preview-media-performance.e2e.ts --workers=1`.
 *
 * The fixtures are generated into the test's temp root (`helpers/media-fixtures.ts`): none is committed.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, runApp, createProject, cleanupTemp, firstPanelId, focusEditor, type OpenApp } from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';
import { expectWithinSla } from './helpers/sla.js';
import { heavySvg, longPdf, noisePng } from './helpers/media-fixtures.js';

test.describe.configure({ mode: 'serial' });

/** 074 FR-104 — the type a preview of `file` is titled with. */
const PREVIEW_TYPE: Record<string, string> = { png: 'Image', jpg: 'Image', gif: 'Image', svg: 'SVG', pdf: 'PDF', html: 'HTML', htm: 'HTML', md: 'Markdown', mmd: 'Mermaid' };
const previewType = (file: string): string => PREVIEW_TYPE[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? '';

let shared: OpenApp | undefined;
let root = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-preview-perf-'));
  writeFileSync(join(root, 'big.png'), noisePng(1600)); // ~10 MB
  writeFileSync(join(root, 'heavy.svg'), heavySvg(5 * 1024 * 1024));
  writeFileSync(join(root, 'long-500.pdf'), longPdf(500));
  shared = await openApp();
  await createProject(shared.win, 'PreviewPerf', root);
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Click `file` in the tree and return the preview panel's id once it exists. */
async function openFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const heading = win.locator('[data-testid^="panel-title-"]').filter({ hasText: new RegExp(`^${file.replace(/\./g, '\\.')} - ${previewType(file)} Preview$`) }).first();
  await expect(heading).toBeAttached({ timeout: 10_000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`openFromTree(${file}): no preview panel`);
  return testId.replace('panel-title-', '');
}

test('a 10 MB image appears within a second of opening (SC-003)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const started = Date.now();
  const id = await openFromTree(win, 'big.png');
  // The readout names the decoded size: the picture has been read and decoded, not merely requested.
  await expect(win.getByTestId(`preview-status-readout-${id}`)).toContainText('1,600 × 1,600 pixels', { timeout: 20_000 });
  await expect(win.getByTestId(`diagram-frame-${id}-diagram-0`).locator('svg[data-throng-picture] image')).toBeVisible();
  expectWithinSla(test.info(), { what: 'a 10 MB image, click to drawn', requirement: '074 SC-003', elapsedMs: Date.now() - started, budgetMs: 1000 });
});

test('a 5 MB SVG appears within 1.5 seconds of opening (SC-003)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const started = Date.now();
  const id = await openFromTree(win, 'heavy.svg');
  const image = win.getByTestId(`diagram-frame-${id}-diagram-0`).locator('svg[data-throng-picture] image');
  await expect(image).toHaveAttribute('href', /^blob:/, { timeout: 20_000 });
  await expect(image).toBeVisible();
  // The maintainer's ruling (2026-11-21): up to 1.5 s, with the loading spinner shown meanwhile (picture-previews-074).
  expectWithinSla(test.info(), { what: 'a 5 MB SVG, click to drawn', requirement: '074 SC-003', elapsedMs: Date.now() - started, budgetMs: 1500 });
});

test('a 500-page PDF shows its first page within 2 seconds, and scrolling it never freezes the window over 100 ms (SC-004)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  // Long tasks from here on: every main-thread stall over 50 ms the renderer reports.
  await win.evaluate(() => {
    const g = window as unknown as { __longTasks?: number[] };
    g.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) g.__longTasks?.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  const started = Date.now();
  const id = await openFromTree(win, 'long-500.pdf');
  await expect(win.getByTestId(`pdf-text-${id}-1`)).toContainText('Page 1 of', { timeout: 20_000 });
  expectWithinSla(test.info(), { what: 'a 500-page PDF, click to first page', requirement: '074 SC-004', elapsedMs: Date.now() - started, budgetMs: 2000 });

  // Scroll to the end a screen at a time, a frame between steps, as a reader dragging the scrollbar would.
  await win.getByTestId(`preview-pdf-${id}`).evaluate(async (el) => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    while (el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
      el.scrollTop += el.clientHeight;
      await frame();
      await frame();
    }
  });
  await expect(win.getByTestId(`pdf-text-${id}-500`)).toContainText('Page 500 of', { timeout: 20_000 });
  const longest = await win.evaluate(() => Math.max(0, ...((window as unknown as { __longTasks?: number[] }).__longTasks ?? [])));
  expectWithinSla(test.info(), { what: 'the longest main-thread stall scrolling a 500-page PDF', requirement: '074 SC-004', elapsedMs: Math.round(longest), budgetMs: 100 });
});

/*
 * Its own app: HTML ships Open in Preview, and this test needs the page in an EDITOR with its preview beside it, so the
 * open action is seeded in the config root before the app starts rather than hot-reloaded under the first click.
 */
test('a parented HTML preview shows an edit within the update delay plus 250 ms (SC-003)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const htmlRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-html-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-cfg-'));
  writeSettingsAtomic(cfgRoot, { editor: { previews: { providers: { html: { defaultOpenAction: 'editor' } } } } });
  writeFileSync(join(htmlRoot, 'page.html'), '<!doctype html><html><body><h1>Title</h1><p>Body text.</p></body></html>');
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'PreviewPerfHtml', htmlRoot);
        const editorId = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${editorId}`).click();
        await win.getByTestId('file-explorer-tree').getByText('page.html', { exact: true }).click();
        await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText('Body text.', { timeout: 8000 });
        const before = await win.locator('[data-testid^="preview-html-frame-"]').count();
        await win.getByTestId(`editor-preview-${editorId}`).click();
        await expect(win.locator('[data-testid^="preview-html-frame-"]')).toHaveCount(before + 1);
        const frame = win.frameLocator('[data-testid^="preview-html-frame-"]').last();
        await expect(frame.locator('body')).toContainText('Body text.', { timeout: 10_000 });

        await focusEditor(win, editorId);
        await win.keyboard.press('ControlOrMeta+End');
        await win.keyboard.type('Z', { delay: 0 });
        const lastKey = Date.now();
        await expect(frame.locator('body')).toContainText('Z', { timeout: 10_000 });
        const delay = 300; // the shipped Preview update delay (044 FR-060)
        expectWithinSla(test.info(), {
          what: 'last keystroke to the parented HTML preview showing it',
          requirement: '074 SC-003',
          elapsedMs: Date.now() - lastKey,
          budgetMs: delay + 250,
        });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(htmlRoot);
    cleanupTemp(cfgRoot);
  }
});

/*
 * 074 convergence T068 — the same reading for a parented SVG preview. The edit is a space after the root element (still
 * well-formed), and "showing it" is the picture's href moving to the new drawing.
 */
test('a parented SVG preview shows an edit within the update delay plus 250 ms (SC-003)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const svgRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-svg-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-cfg-'));
  writeSettingsAtomic(cfgRoot, { editor: { previews: { providers: { svg: { defaultOpenAction: 'editor' } } } } });
  writeFileSync(join(svgRoot, 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="teal"/></svg>');
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'PreviewPerfSvg', svgRoot);
        const editorId = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${editorId}`).click();
        await win.getByTestId('file-explorer-tree').getByText('shape.svg', { exact: true }).click();
        await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText('teal', { timeout: 8000 });
        await win.getByTestId(`editor-preview-${editorId}`).click();
        const image = win.locator('[data-testid^="diagram-frame-"] svg[data-throng-picture] image').last();
        await expect(image).toHaveAttribute('href', /.+/, { timeout: 10_000 });
        const before = (await image.getAttribute('href')) ?? '';

        // Timed IN the page: \`expect\` polls at 100, 250 and 500 ms steps, which would make the reading the next poll after
        // the redraw rather than the redraw. The observer stamps the first moment the picture names another drawing.
        await win.evaluate((was) => {
          const g = window as unknown as { __svgRedrawnAt?: number };
          g.__svgRedrawnAt = 0;
          const pictures = (): string[] =>
            [...document.querySelectorAll('[data-testid^="diagram-frame-"] svg[data-throng-picture] image')].map((el) => el.getAttribute('href') ?? '');
          new MutationObserver((_records, observer) => {
            if (pictures().some((href) => href !== '' && href !== was)) {
              g.__svgRedrawnAt = Date.now();
              observer.disconnect();
            }
          }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
        }, before);

        await focusEditor(win, editorId);
        await win.keyboard.press('ControlOrMeta+End');
        await win.keyboard.type(' ', { delay: 0 });
        const lastKey = Date.now();
        await expect.poll(() => win.evaluate(() => (window as unknown as { __svgRedrawnAt?: number }).__svgRedrawnAt ?? 0), { timeout: 10_000 }).toBeGreaterThan(0);
        const redrawnAt = await win.evaluate(() => (window as unknown as { __svgRedrawnAt?: number }).__svgRedrawnAt ?? 0);
        // The reading, on every run: a pass records no number otherwise.
        console.log(`[SC-003] parented SVG preview: ${redrawnAt - lastKey} ms from the last keystroke`);
        const delay = 300; // the shipped Preview update delay (044 FR-060)
        expectWithinSla(test.info(), {
          what: 'last keystroke to the parented SVG preview showing it',
          requirement: '074 SC-003',
          elapsedMs: redrawnAt - lastKey,
          budgetMs: delay + 250,
        });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(svgRoot);
    cleanupTemp(cfgRoot);
  }
});

/*
 * 074 convergence T079 — SC-005: opening a file over its preview's size limit shows the size notice within 200 ms. Its
 * own app, with Images' Maximum file size seeded at 1 MB (inside its hard bounds) and a picture of about 2.5 MB. The
 * notice's arrival is stamped in the page, as the SVG reading's redraw is.
 */
test('a file over its size limit shows the size notice within 200 ms (SC-005)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const bigRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-limit-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-preview-perf-cfg-'));
  writeSettingsAtomic(cfgRoot, { editor: { previews: { providers: { image: { maxFileBytes: 1024 * 1024 } } } } });
  writeFileSync(join(bigRoot, 'over.png'), noisePng(800)); // ~2.5 MB
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'PreviewPerfLimit', bigRoot);
        await win.evaluate(() => {
          const g = window as unknown as { __noticeAt?: number };
          g.__noticeAt = 0;
          new MutationObserver((_records, observer) => {
            if ((document.body.textContent ?? '').includes('too large to preview')) {
              g.__noticeAt = Date.now();
              observer.disconnect();
            }
          }).observe(document.body, { subtree: true, childList: true, characterData: true });
        });
        const started = Date.now();
        await win.getByTestId('file-explorer-tree').getByText('over.png', { exact: true }).click();
        await expect.poll(() => win.evaluate(() => (window as unknown as { __noticeAt?: number }).__noticeAt ?? 0), { timeout: 10_000 }).toBeGreaterThan(0);
        const shownAt = await win.evaluate(() => (window as unknown as { __noticeAt?: number }).__noticeAt ?? 0);
        // The reading, on every run: a pass records no number otherwise.
        console.log(`[SC-005] over-limit image: notice ${shownAt - started} ms from the click`);
        expectWithinSla(test.info(), { what: 'an over-limit image, click to its size notice', requirement: '074 SC-005', elapsedMs: shownAt - started, budgetMs: 200 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(bigRoot);
    cleanupTemp(cfgRoot);
  }
});
