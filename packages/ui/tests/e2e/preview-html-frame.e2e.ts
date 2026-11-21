/**
 * 074 FR-071b, FR-072a, FR-074a, FR-085a, FR-086b, FR-093a (2026-11-20) — the same-origin, script-less HTML frame in
 * the real engine: an edit updates the page in place with the reader's scroll kept, Find highlights inside the page,
 * the page's right-click menu copies rich text, and only a safe source reaches the network while a script from one
 * still never runs.
 *
 * ══ WHY THIS IS AN E2E ══
 *
 * jsdom honours no `sandbox`, lays nothing out, scrolls nothing, paints no `::highlight()`, fetches nothing and has
 * no main-process request filter: the component tests (`html-preview.test.ts`, `preview-find-frame.test.ts`,
 * `html-frame-input.test.ts`) prove what throng hands the frame, and only Chromium can show what the frame did with
 * it. It is in the serial tier (FOCUS): it drives a context menu, which throng closes when its window loses focus.
 *
 * The safe source is `https://safe.invalid`: a request to it is let through by every layer and then fails at name
 * resolution, so the test sees the filter allow it without the suite depending on the network.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp, createProject, cleanupTemp, firstPanelId, focusEditor, type OpenApp } from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp | undefined;
let root = '';
let cfgRoot = '';
let editorId = '';

const LONG_PAGE = `<!doctype html><html><body><h1>Top</h1>${Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i + 1}.</p>`).join('')}<p id="tail">The <b>needle</b> is here, and a second needle.</p></body></html>`;

const SAFE_PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="https://safe.invalid/site.css">
<script src="https://safe.invalid/app.js"></script>
<script>parent.__htmlFrameScriptRan = true;</script>
<style>@font-face { font-family: Local; src: url("fonts/local.woff2"); } body { font-family: Local, sans-serif; }</style>
</head><body onload="parent.__htmlFrameScriptRan = true">
<p>Safe sources page.</p>
<img alt="unlisted" src="https://unlisted.invalid/b.png">
</body></html>`;

interface Recorded {
  url: string;
  outcome: string;
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-html-frame-'));
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-html-frame-cfg-'));
  writeFileSync(join(root, 'long.html'), LONG_PAGE);
  writeFileSync(join(root, 'safe.html'), SAFE_PAGE);
  mkdirSync(join(root, 'fonts'));
  writeFileSync(join(root, 'fonts', 'local.woff2'), Buffer.from('wOF2'));
  // HTML opens in an editor here, so each page has its preview parented beside it; the safe source is seeded before
  // the app starts rather than hot-reloaded under the first request.
  writeSettingsAtomic(cfgRoot, {
    editor: { previews: { providers: { html: { defaultOpenAction: 'editor', safeSources: ['https://safe.invalid'] } } } },
  });
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await createProject(shared.win, 'HtmlFrame', root);
  await installRecorder(shared.app);
  editorId = await firstPanelId(shared.win);
  await shared.win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await shared.win.getByTestId(`panel-type-confirm-${editorId}`).click();
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
  if (cfgRoot) cleanupTemp(cfgRoot);
});

async function installRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    const g = globalThis as unknown as { __htmlFrameE2E?: Recorded[] };
    g.__htmlFrameE2E = [];
    const rec = g.__htmlFrameE2E;
    const filter = { urls: ['<all_urls>'] };
    session.defaultSession.webRequest.onCompleted(filter, (d) => void rec.push({ url: d.url, outcome: `completed ${d.statusCode}` }));
    session.defaultSession.webRequest.onErrorOccurred(filter, (d) => void rec.push({ url: d.url, outcome: d.error }));
  });
}

const recorded = (app: ElectronApplication): Promise<Recorded[]> =>
  app.evaluate(() => (globalThis as unknown as { __htmlFrameE2E?: Recorded[] }).__htmlFrameE2E ?? []);

/** Open `file` in the editor, then its preview beside it; return the preview's panel id. */
async function openWithPreview(win: Page, file: string, text: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText(text, { timeout: 8000 });
  const frames = win.locator('[data-testid^="preview-html-frame-"]');
  const before = await frames.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  await win.getByTestId(`editor-preview-${editorId}`).click();
  let id = '';
  await expect
    .poll(async () => {
      const now = await frames.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
      id = (now.find((t) => !before.includes(t)) ?? now.at(-1) ?? '').replace('preview-html-frame-', '');
      return id !== '' && (await win.frameLocator(`[data-testid="preview-html-frame-${id}"]`).locator('body').textContent())?.includes(text);
    }, { timeout: 15_000 })
    .toBe(true);
  return id;
}

const frameDoc = (win: Page, id: string) =>
  win.locator(`[data-testid="preview-html-frame-${id}"]`);

test('an edit updates the HTML page in place, in the same frame, keeping where the reader was scrolled (FR-071b)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await openWithPreview(win, 'long.html', 'Paragraph 1.');
  const frame = frameDoc(win, id);
  // Mark the frame ELEMENT: an update that replaced the frame would lose the mark.
  await frame.evaluate((el) => {
    (el as HTMLElement).dataset.e2eMark = 'kept';
    const doc = (el as HTMLIFrameElement).contentDocument!;
    doc.scrollingElement!.scrollTop = 1500;
  });
  await expect.poll(() => frame.evaluate((el) => (el as HTMLIFrameElement).contentDocument!.scrollingElement!.scrollTop)).toBe(1500);

  await focusEditor(win, editorId);
  await win.keyboard.press('ControlOrMeta+End');
  await win.keyboard.type('<p>Appended by an edit.</p>', { delay: 0 });
  await expect(win.frameLocator(`[data-testid="preview-html-frame-${id}"]`).locator('body')).toContainText('Appended by an edit.', { timeout: 10_000 });

  expect(await frame.getAttribute('data-e2e-mark'), 'the update replaced the frame instead of updating it').toBe('kept');
  const top = await frame.evaluate((el) => (el as HTMLIFrameElement).contentDocument!.scrollingElement!.scrollTop);
  expect(Math.abs(top - 1500), `the reader was at 1500px and is now at ${top}px`).toBeLessThanOrEqual(2);

  // Saved, so the next test's file from the tree can open into this editor: one with unsaved edits is not replaced.
  await focusEditor(win, editorId);
  await win.keyboard.press('ControlOrMeta+S');
  await expect.poll(() => readFileSync(join(root, 'long.html'), 'utf8'), { timeout: 10_000 }).toContain('Appended by an edit.');
});

test('Find searches the HTML page: every match highlighted in the page, the count shown, Next scrolls to it (FR-086b)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await openWithPreview(win, 'long.html', 'Paragraph 1.');
  const frame = frameDoc(win, id);
  await frame.click({ position: { x: 20, y: 20 } });
  await win.keyboard.press('ControlOrMeta+F');
  const bar = win.getByTestId(`find-bar-${id}`);
  await expect(bar).toBeVisible();
  await bar.getByTestId('find-input').fill('needle');
  await expect(bar.getByTestId('find-count')).toContainText('2');
  await expect(bar.getByTestId('find-toggle-replace')).toHaveCount(0);
  // The highlights are painted in the PAGE's own registry: Chromium, not jsdom, is the only judge of that.
  await expect
    .poll(() => frame.evaluate((el) => {
      const w = (el as HTMLIFrameElement).contentWindow as unknown as { CSS: { highlights: Map<string, { size: number }> } };
      let n = 0;
      for (const h of w.CSS.highlights.values()) n += h.size;
      return n;
    }))
    .toBeGreaterThanOrEqual(2);
  await bar.getByTestId('find-next').click();
  await expect
    .poll(() => frame.evaluate((el) => {
      const doc = (el as HTMLIFrameElement).contentDocument!;
      const tail = doc.getElementById('tail')!.getBoundingClientRect();
      return tail.top >= 0 && tail.bottom <= doc.documentElement.clientHeight;
    }))
    .toBe(true);
});

/*
 * The clipboard is not observable from this harness (a write through the app's own bridge reads back empty in
 * main), so what Copy as Rich Text puts there — HTML plus plain text — is pinned by `html-preview.test.ts`. What only
 * the engine can show is that a right-click INSIDE the page reaches the panel at all, with the selection the page
 * holds, and that the menu's rows act on the page.
 */
test('a right-click in the HTML page opens the body menu for the selection there, and its Select All selects the page (FR-085a)', { tag: ['@extended', '@editor', '@reserve:native'] }, async () => {
  const win = shared!.win;
  const id = await openWithPreview(win, 'long.html', 'Paragraph 1.');
  const frame = frameDoc(win, id);
  // Select the tail paragraph and scroll it into view.
  const point = await frame.evaluate((el) => {
    const doc = (el as HTMLIFrameElement).contentDocument!;
    const tail = doc.getElementById('tail')!;
    tail.scrollIntoView({ block: 'center' });
    const range = doc.createRange();
    range.selectNodeContents(tail);
    const sel = doc.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const r = tail.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + r.height / 2 };
  });
  await frame.click({ button: 'right', position: point });
  for (const label of ['Find…', 'Copy', 'Copy as Rich Text', 'Copy as Plain Text', 'Select All', 'Split']) {
    await expect(win.getByTestId(`menu-item-${label}`), label).toBeVisible();
  }
  // A selection in the page reached the panel: the copy rows are live, not the empty-selection state.
  await expect(win.getByTestId('menu-item-Copy as Rich Text')).toHaveAttribute('aria-disabled', 'false');
  await win.getByTestId('menu-item-Select All').click();
  // The whole page, first element to last — whatever an earlier test in this shared app appended to it (the
  // in-place update test types a paragraph into long.html's editor), so the text's last line is not pinned.
  await expect
    .poll(() =>
      frame.evaluate((el) => {
        const doc = (el as HTMLIFrameElement).contentDocument!;
        const flat = (t: string | null | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim();
        const text = flat(doc.getSelection()!.toString());
        // The first and last elements that hold text: the edit can leave an empty paragraph at the end.
        const texts = [...doc.body.children].map((c) => flat(c.textContent)).filter((t) => t !== '');
        const first = texts[0];
        const last = texts.at(-1);
        return first !== undefined && last !== undefined && text.startsWith(first) && text.endsWith(last);
      }),
    )
    .toBe(true);
  expect(await frame.evaluate((el) => (el as HTMLIFrameElement).contentDocument!.getSelection()!.toString())).toMatch(
    /^\s*Top[\s\S]*Paragraph 200\.[\s\S]*second needle\./,
  );
});

test('only a safe source reaches the network, a script from one never runs, and the rest is listed once with Allow this source (FR-072a, FR-093a, FR-090)', { tag: ['@extended', '@failure', '@reserve:runtime'] }, async () => {
  const { app, win } = shared!;
  const id = await openWithPreview(win, 'safe.html', 'Safe sources page.');

  // The safe stylesheet was let through by every layer: it was attempted and failed at name resolution, not blocked.
  await expect
    .poll(async () => (await recorded(app)).find((r) => r.url.startsWith('https://safe.invalid/site.css'))?.outcome ?? '', { timeout: 15_000 })
    .toMatch(/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_CONNECTION/);
  // A relative @font-face loads through the asset route (FR-072).
  await expect
    .poll(async () => (await recorded(app)).some((r) => /^throng-preview:\/\/asset\/.+fonts\/local\.woff2$/i.test(r.url)), { timeout: 15_000 })
    .toBe(true);
  const requests = await recorded(app);
  expect(requests.filter((r) => r.url.includes('app.js')), 'a script from a safe source was requested').toEqual([]);
  expect(requests.filter((r) => r.url.includes('unlisted.invalid')), 'an unlisted source was requested').toEqual([]);
  expect(await win.evaluate(() => (window as unknown as { __htmlFrameScriptRan?: boolean }).__htmlFrameScriptRan)).toBeUndefined();

  // One notice, the unlisted image under its source, with Allow this source; the script listed without it.
  const notice = win.getByTestId(`preview-html-blocked-${id}`);
  await expect(notice).toHaveCount(1);
  const unlisted = notice.locator('[data-source="https://unlisted.invalid"]');
  await expect(unlisted).toContainText('https://unlisted.invalid/b.png');
  const safeScript = notice.locator('[data-source="https://safe.invalid"]');
  await expect(safeScript).toContainText('app.js');
  await expect(safeScript.getByTestId(`preview-html-blocked-allow-${id}`)).toHaveCount(0);

  await unlisted.getByTestId(`preview-html-blocked-allow-${id}`).click();
  // Allowed for this project: the page reloads and the image is now requested — and let through.
  await expect
    .poll(async () => (await recorded(app)).find((r) => r.url.startsWith('https://unlisted.invalid/b.png'))?.outcome ?? '', { timeout: 15_000 })
    .toMatch(/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_CONNECTION/);
  await expect(notice.locator('[data-source="https://unlisted.invalid"]')).toHaveCount(0);
});
