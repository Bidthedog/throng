/**
 * 074 — the four media preview types in the real engine: each opens from Files & Folders into its own panel type
 * (FR-001, FR-016: every one ships Throng Preview), and each type's hostile fixture runs nothing, requests nothing
 * off the machine, opens no window and does not navigate (FR-090, SC-002).
 *
 * ══ WHY THIS IS AN E2E ══
 *
 * The lower layers pin what throng HANDS the engine: the picture wrapper (`picture-blocks.test.ts`), the HTML
 * sanitiser's output (`html-sanitise.test.ts`), the PDF body against a fake PDF.js (`pdf-preview.test.ts`), the
 * request policy row by row and the CSP string (`renderer-csp.test.ts`). None of them can say what Chromium DID:
 * jsdom decodes no image, runs no SVG in image mode, honours no `sandbox` or CSP and starts no PDF.js worker. Only
 * the running renderer under the real CSP and the real main-process filter can show that a page in the sandboxed
 * frame loaded its stylesheet and nothing else, that the `srcdoc` frame loads under `frame-src`, and that the PDF
 * worker starts.
 *
 * ══ WHAT IS RECORDED ══
 *
 * As in `preview-hostile.e2e.ts`: requests in MAIN on `onCompleted` / `onErrorOccurred` (the app's own filter keeps
 * `onBeforeRequest`), attempted navigations (`will-navigate`, `will-frame-navigate`), new windows, dialogs and page
 * errors. Each absence has a fence: the hostile HTML page's relative stylesheet is requested through the protocol,
 * which proves the recorder sees this frame's loads at all.
 */
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp, createProject, cleanupTemp, geom, HOST_OS, type OpenApp } from './harness.js';

/**
 * The app's primary modifier for input sent through Electron's own input path: macOS binds Cmd where the others bind
 * Ctrl (070 FR-029), so a chord sent with Ctrl there reaches nothing. Playwright's own keyboard says `ControlOrMeta`.
 */
const PRIMARY = HOST_OS === 'macos' ? ('meta' as const) : ('control' as const);
import { byTitle } from './helpers/titles.js';
import { longPdf } from './helpers/media-fixtures.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));
const RENDERER_DIR_URL = pathToFileURL(fileURLToPath(new URL('../../dist/renderer', import.meta.url))).href.toLowerCase();

interface Recorded {
  url: string;
  outcome: string;
}
interface Recorder {
  requests: Recorded[];
  navigations: string[];
  windows: number;
}

/** 074 FR-104 — the type a preview of `file` is titled with. */
const PREVIEW_TYPE: Record<string, string> = { png: 'Image', jpg: 'Image', gif: 'Image', svg: 'SVG', pdf: 'PDF', html: 'HTML', htm: 'HTML', md: 'Markdown', mmd: 'Mermaid' };
const previewType = (file: string): string => PREVIEW_TYPE[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? '';

let shared: OpenApp | undefined;
let root = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-preview-media-'));
  for (const name of ['picture.png', 'polyglot.png', 'hostile.svg', 'pages-3.pdf', 'hostile.pdf', 'hostile.html', 'hostile-style.css']) {
    cpSync(join(FIXTURES, name), join(root, name));
  }
  writeFileSync(join(root, 'pages-40.pdf'), longPdf(40));
  shared = await openApp();
  await createProject(shared.win, 'PreviewMedia', root);
  await installRecorder(shared.app);
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

async function installRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session, webContents, app: electronApp }) => {
    const g = globalThis as unknown as { __mediaE2E?: Recorder };
    g.__mediaE2E = { requests: [], navigations: [], windows: 0 };
    const rec = g.__mediaE2E;
    const filter = { urls: ['<all_urls>'] };
    session.defaultSession.webRequest.onCompleted(filter, (d) => {
      if (d.webContentsId !== undefined) rec.requests.push({ url: d.url, outcome: `completed ${d.statusCode}` });
    });
    session.defaultSession.webRequest.onErrorOccurred(filter, (d) => {
      if (d.webContentsId !== undefined) rec.requests.push({ url: d.url, outcome: d.error });
    });
    for (const wc of webContents.getAllWebContents()) {
      wc.on('will-navigate', (e) => rec.navigations.push(e.url));
      wc.on('will-frame-navigate', (e) => {
        // A plain click on a link in the HTML page navigates the frame to the follow route, which answers 204
        // and is never committed (research R6); anything else is a navigation.
        if (!e.url.startsWith('throng-preview://follow/')) rec.navigations.push(e.url);
      });
    }
    electronApp.on('browser-window-created', () => {
      rec.windows += 1;
    });
  });
}

async function recorded(app: ElectronApplication): Promise<Recorder> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __mediaE2E: Recorder };
    return { requests: [...g.__mediaE2E.requests], navigations: [...g.__mediaE2E.navigations], windows: g.__mediaE2E.windows };
  });
}

function allowed(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith('throng-preview:') || u.startsWith(`${RENDERER_DIR_URL}/`) || u.startsWith('blob:') || u.startsWith('data:');
}

/**
 * App zoom back to 1, and the Explorer it folded back too, before the next test in this app reaches for the tree. At app
 * zoom 1.33 the 1280px window is under the Explorer's auto-collapse width, and the pane restores itself on widening.
 * On macOS CI the next test twice found no tree rows (a-zoomed.svg, polyglot.png). If the pane does not come back,
 * this fails here, naming that, not as a missing file in a later test.
 */
async function restoreAppZoom(app: ElectronApplication, win: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  await expect(
    win.getByTestId('file-explorer-tree').getByText('picture.png', { exact: true }),
    'the Explorer came back after app zoom returned to 1',
  ).toBeVisible({ timeout: 10_000 });
}

/** Click a file in the tree (it ships Open … in: Throng Preview), and return the preview panel's id by its title. */
async function previewFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const title = `${file} - ${previewType(file)} Preview`;
  const heading = win.locator('[data-testid^="panel-title-"]').filter({ hasText: new RegExp(`^${title.replace(/\./g, '\\.')}$`) }).first();
  // Attached, not visible: each type opens its own panel beside the last, and by the fourth the panels are ~160px
  // wide, so the header's controls leave a title no width at all (measured 2026-11-19). The title is the panel's id.
  await expect(heading).toBeAttached({ timeout: 10_000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`previewFromTree(${file}): no preview panel titled ${title}`);
  return testId.replace('panel-title-', '');
}

test('an image, an SVG, a PDF and an HTML file each open from the tree into their own preview type', { tag: ['@core', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;

  const image = await previewFromTree(win, 'picture.png');
  const picture = win.getByTestId(`diagram-frame-${image}-diagram-0`).locator('svg[data-throng-picture] image');
  await expect(picture).toHaveAttribute('href', /^throng-preview:\/\/source\//, { timeout: 15_000 });
  await expect(win.getByTestId(`preview-status-readout-${image}`)).toContainText('4 × 2 pixels');
  // FR-031 (2026-11-19) — the picture's viewport fills its panel's body in the real layout; the fill rules once named
  // Mermaid alone, and an image's viewport sat at its 36px floor with the toolbar clipped (`diagram-declared-css.test.ts`).
  const viewport = await win.getByTestId(`diagram-frame-${image}-diagram-0`).locator('.preview-diagram-frame__viewport').boundingBox();
  const body = await win.getByTestId(`preview-image-${image}`).boundingBox();
  expect(viewport!.height).toBeGreaterThan(body!.height - 4);

  const svg = await previewFromTree(win, 'hostile.svg');
  await expect(win.getByTestId(`diagram-frame-${svg}-diagram-0`).locator('svg[data-throng-picture] image')).toHaveAttribute('href', /^blob:/, {
    timeout: 15_000,
  });

  const pdf = await previewFromTree(win, 'pages-3.pdf');
  await expect(win.getByTestId(`preview-pdf-${pdf}`).locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(win.getByTestId(`preview-status-readout-${pdf}`)).toContainText('of 3');
  // FR-068a (2026-11-19) — the real PDF.js text layer lays page one's text over its canvas, to be selected.
  await expect(win.getByTestId(`pdf-text-${pdf}-1`)).toContainText('Page one', { timeout: 20_000 });

  const html = await previewFromTree(win, 'hostile.html');
  await expect(win.getByTestId(`preview-html-frame-${html}`)).toBeVisible({ timeout: 15_000 });
  // FR-072 (2026-11-19) — the page's own linked stylesheet APPLIES, not merely gets requested: the `srcdoc` frame
  // inherits the renderer's CSP, so its `style-src` must admit the asset route (`renderer-csp.test.ts`).
  const page = win.frameLocator(`[data-testid="preview-html-frame-${html}"]`);
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(200, 0, 0)', { timeout: 15_000 });
  // FR-070 (2026-11-19) — the page is DRAWN, not merely parsed: a computed colour holds even for a document that was
  // never laid out, which is what a second navigation of the frame left (measured: every box 0 × 0, a blank panel).
  await expect.poll(async () => (await page.locator('h1').boundingBox())?.height ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('a long PDF zoomed in, scrolled to its end and fitted again has no pages wider than its panel, in each page layout', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  // 2026-11-19 — a horizontal scrollbar where every page fits: a page painted at a larger zoom and since left outside
  // the painted range kept that zoom's text layer, which PDF.js sizes itself, wider than the page.
  const win = shared!.win;
  const pdf = await previewFromTree(win, 'pages-40.pdf');
  const scroller = win.getByTestId(`preview-pdf-${pdf}`);
  await expect(win.getByTestId(`pdf-text-${pdf}-1`)).toContainText('Page 1 of', { timeout: 20_000 });
  for (let i = 0; i < 4; i += 1) await win.getByTestId(`pdf-zoom-in-${pdf}`).click();
  await expect(win.getByTestId(`pdf-text-${pdf}-1`)).toContainText('Page 1 of', { timeout: 10_000 });
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(win.getByTestId(`pdf-text-${pdf}-40`)).toContainText('Page 40 of', { timeout: 10_000 });
  await win.getByTestId(`pdf-fit-${pdf}`).click();
  // macOS CI twice held a 27px overflow here for the whole wait, and Linux has not reproduced it (10/10 locally). So a
  // failure names what sticks out past the scroller, and by how much, for the next run to say where it comes from.
  try {
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 10_000 })
      .toBeLessThanOrEqual(0);
  } catch (error) {
    const offenders = await scroller.evaluate((el) => {
      const edge = el.getBoundingClientRect().left + el.clientWidth;
      const out: string[] = [];
      for (const d of el.querySelectorAll<HTMLElement>('*')) {
        const over = d.getBoundingClientRect().right - edge;
        if (over > 0.5) out.push(`${d.tagName.toLowerCase()}.${d.className} ${d.dataset.pdfPage ?? d.dataset.testid ?? ''} +${Math.round(over)}px w=${Math.round(d.getBoundingClientRect().width)}`);
      }
      return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, offenders: out.slice(0, 10) };
    });
    throw new Error(`${(error as Error).message}\nafter Fit, past the scroller's edge: ${JSON.stringify(offenders)}`, { cause: error });
  }

  // FR-062c — the layouts in a real layout: Two Pages puts pages 1 and 2 on one row and, fitted, still fits across;
  // Side by Side, zoomed out, holds more than one page to a row.
  const top = (n: number): Promise<number> => win.locator(`[data-testid="preview-pdf-${pdf}"] [data-pdf-page="${n}"]`).evaluate((el) => el.getBoundingClientRect().top);
  // A panel of a reader's width: this is the fourth panel in its tab (~114px), narrower than two pages at the 10% floor.
  await scroller.focus();
  await win.keyboard.press('Shift+Alt+Enter');
  await expect.poll(() => scroller.evaluate((el) => el.clientWidth), { timeout: 10_000 }).toBeGreaterThan(400);
  await win.getByTestId(`pdf-layout-two-${pdf}`).click();
  await expect.poll(async () => (await top(2)) - (await top(1)), { timeout: 10_000 }).toBe(0);
  expect(await top(3)).toBeGreaterThan(await top(1));
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 10_000 })
    .toBeLessThanOrEqual(0);
  await win.getByTestId(`pdf-layout-wrap-${pdf}`).click();
  for (let i = 0; i < 6; i += 1) await win.getByTestId(`pdf-zoom-out-${pdf}`).click();
  await expect.poll(async () => (await top(2)) - (await top(1)), { timeout: 10_000 }).toBe(0);
  // Out of Focus Mode again, so the tree is back for the next test in this app.
  await scroller.focus();
  await win.keyboard.press('Shift+Alt+Enter');
  await expect(win.getByTestId('file-explorer-tree')).toBeVisible({ timeout: 10_000 });
});


test('a click inside an HTML page activates its panel undimmed, and the zoom chord, Ctrl+wheel and Ctrl+middle-click there zoom and reset the page, which fills its panel', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  // 2026-11-19 — the page is a sandboxed document of its own: nothing pressed or wheeled inside it reached the app,
  // so the panel did not activate on a click, and neither the panel zoom chord nor Ctrl+wheel zoomed it. Input is sent
  // through Electron's own input path (`sendInputEvent`), as a real keyboard and mouse are; Playwright's synthesised
  // input bypasses the main-process events the relay reads.
  const { app, win } = shared!;
  const html = await previewFromTree(win, 'hostile.html');
  const frame = win.getByTestId(`preview-html-frame-${html}`);
  await expect(frame).toBeVisible({ timeout: 15_000 });
  const host = win.locator(`[data-panel-host="${html}"]`);
  // Another panel active first, so the click is what activates this one.
  await win.locator('[data-panel-host]').filter({ hasNot: frame }).first().click({ position: { x: 5, y: 5 } });
  await expect(host).toHaveAttribute('data-active', 'false');
  const box = (await frame.boundingBox())!;
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(host).toHaveAttribute('data-active', 'true');
  // …and shows it as the foreground window's active panel, not dimmed: focus went into the page, not out of the window.
  await expect(host).toHaveAttribute('data-active-dimmed', 'false');

  const zoom = (): Promise<string | null> => host.getAttribute('data-zoom');
  const before = await zoom();
  await app.evaluate(({ BrowserWindow }, mod) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: [mod, 'alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: [mod, 'alt'] });
  }, PRIMARY);
  await expect.poll(zoom, { timeout: 10_000 }).not.toBe(before);
  const afterChord = await zoom();
  await app.evaluate(({ BrowserWindow }, pt) => {
    BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({ type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: [pt.mod] });
  }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), mod: PRIMARY });
  await expect.poll(zoom, { timeout: 10_000 }).not.toBe(afterChord);

  // FR-083 — zoomed, the frame still covers the whole space under the notice: its right edge is the body's.
  const edges = await frame.evaluate((f) => {
    const stage = f.parentElement!.getBoundingClientRect();
    const r = f.getBoundingClientRect();
    return { right: Math.abs(r.right - stage.right), bottom: Math.abs(r.bottom - stage.bottom) };
  });
  expect(edges.right).toBeLessThan(1.5);
  expect(edges.bottom).toBeLessThan(1.5);

  // A Ctrl+middle-click on the page, the reset gesture, puts the panel back as it was — and leaves the next test an
  // unzoomed page, which Playwright's own clicks into a frame need (they aim without the frame's scale).
  await app.evaluate(({ BrowserWindow }, pt) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'middle', clickCount: 1, modifiers: [pt.mod] });
    wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'middle', clickCount: 1, modifiers: [pt.mod] });
  }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), mod: PRIMARY });
  await expect.poll(zoom, { timeout: 10_000 }).toBe(before);
});


test('a fitted SVG holds still at an app zoom whose rounding overflows it, and raises no scrollbar', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  // 2026-11-19 — measured: at app zoom 1.33 and 0.9 a fitted picture's stage overflowed its viewport by under a pixel,
  // both scrollbars appeared, the narrower viewport fitted smaller, the scrollbars went, and the picture refitted —
  // for as long as the panel was open. Only a real layout rounds, so only a real window shows it.
  const { app, win } = shared!;
  writeFileSync(join(root, 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#48c"/></svg>');
  await win.getByTestId('file-explorer-tree').getByText('wide.svg', { exact: true }).waitFor({ timeout: 10_000 });
  const id = await previewFromTree(win, 'wide.svg');
  const frame = win.locator(`[data-panel-host="${id}"] [data-testid^="diagram-frame-"]`).first();
  await frame.waitFor({ timeout: 15_000 });
  try {
    for (const factor of [1.33, 0.9]) {
      await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(f), factor);
      // The zoom's relayout has settled — the viewport's outer box, which a scrollbar does not move — so a scale that
      // still changes in the sampling window below is the picture refitting itself, never the relayout.
      await geom(frame.locator('.preview-diagram-frame__viewport'));
      // The box can read still twice before the zoom's relayout even begins (setZoomFactor returns first). And at 1.33 the
      // 1280px window is 962 CSS px, under the Explorer's auto-collapse width (~1,060), so the Explorer folds to its rail
      // and the workspace widens: CI sampled that one refit as two scales about 2x apart (0.03125 then 0.066875, never
      // back). So wait for the picture's scale and its viewport's width to hold together for 600 ms. A picture that
      // refits without end never holds, and fails here instead.
      await expect
        .poll(
          () =>
            frame.evaluate(async (f) => {
              const vp = f.querySelector('.preview-diagram-frame__viewport') as HTMLElement;
              const read = (): string => `${f.getAttribute('data-scale')} ${vp.getBoundingClientRect().width}`;
              const first = read();
              await new Promise((r) => setTimeout(r, 600));
              return !first.startsWith('null') && read() === first;
            }),
          { timeout: 10_000 },
        )
        .toBe(true);
      const seen = await frame.evaluate(async (f) => {
        const vp = f.querySelector('.preview-diagram-frame__viewport') as HTMLElement;
        const states = new Set<string>();
        for (let i = 0; i < 20; i++) {
          states.add(`${f.getAttribute('data-scale')} ${vp.offsetWidth - vp.clientWidth}x${vp.offsetHeight - vp.clientHeight}`);
          await new Promise((r) => setTimeout(r, 40));
        }
        return [...states];
      });
      expect(seen, `app zoom ${factor}: one scale, no scrollbar`).toHaveLength(1);
      expect(seen[0], `app zoom ${factor}: no scrollbar`).toMatch(/ 0x0$/);
    }
  } finally {
    await restoreAppZoom(app, win);
  }
});

test('a zoomed SVG holds still at every step zoomed out from 100%, and the zoom reset returns it to its opening view', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  // 2026-11-20 — zoomed out from 100% at a fractional app zoom, a picture no larger than its viewport lost and regained
  // its scrollbars without end: the stage was sized from the measured viewport, whose whole-pixel width lags a
  // scrollbar by a frame and rounds past the real one. Measured at app zoom 1.33 and 0.9 with the picture sized so the
  // third step out lands on the viewport: 24 of 24 sizes juddered; at 1, 1.1 and 1.25, 0 of 36.
  const { app, win } = shared!;
  const path = join(root, 'a-zoomed.svg');
  const svgOf = (w: number, h: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#4a8"/></svg>`;
  writeFileSync(path, svgOf(10, 10));
  await win.getByTestId('file-explorer-tree').getByText('a-zoomed.svg', { exact: true }).waitFor({ timeout: 10_000 });
  const id = await previewFromTree(win, 'a-zoomed.svg');
  const frame = win.locator(`[data-panel-host="${id}"] [data-testid^="diagram-frame-"]`).first();
  await frame.waitFor({ timeout: 15_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.33));
  try {
    await geom(frame.locator('.preview-diagram-frame__viewport'));
    const vp = await frame.evaluate((f) => (f.querySelector('.preview-diagram-frame__viewport') as HTMLElement).getBoundingClientRect().toJSON() as DOMRect);
    // Three steps out from 100% (×0.512) lands the picture on the viewport; the steps after it are inside it.
    const w = Math.round(vp.width / 0.512);
    const h = Math.round(vp.height / 0.512);
    writeFileSync(path, svgOf(w, h));
    await expect
      .poll(() => frame.evaluate((f) => f.querySelector('svg[data-throng-picture]')?.getAttribute('viewBox') ?? ''), { timeout: 10_000 })
      .toBe(`0 0 ${w} ${h}`);
    const opening = await frame.getAttribute('data-scale');
    await byTitle(frame, 'Zoom 100%').click();
    for (let step = 1; step <= 5; step++) {
      const from = await frame.getAttribute('data-scale');
      await byTitle(frame, 'Zoom out').click();
      await expect(frame).not.toHaveAttribute('data-scale', from!);
      const seen = await frame.evaluate(async (f) => {
        const v = f.querySelector('.preview-diagram-frame__viewport') as HTMLElement;
        const states = new Set<string>();
        for (let i = 0; i < 15; i++) {
          states.add(`${v.offsetWidth - v.clientWidth}x${v.offsetHeight - v.clientHeight}`);
          await new Promise((r) => setTimeout(r, 30));
        }
        return [...states];
      });
      expect(seen, `step ${step} out from 100%: the scrollbars hold still`).toHaveLength(1);
    }
    // FR-020a — the reset chord returns the opening view (Fit, for a picture larger than its panel), not 100%.
    await frame.locator('.preview-diagram-frame__viewport').focus();
    await win.keyboard.press('ControlOrMeta+Alt+0');
    await expect(frame).toHaveAttribute('data-mode', 'open');
    await expect(frame).toHaveAttribute('data-scale', opening!);
  } finally {
    await restoreAppZoom(app, win);
  }
});












test('the hostile image, SVG, PDF and HTML fixtures run nothing, fetch nothing off the machine and navigate nowhere', { tag: ['@extended', '@failure', '@reserve:runtime'] }, async () => {
  const { app, win } = shared!;
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  win.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await previewFromTree(win, 'polyglot.png');
  await previewFromTree(win, 'hostile.svg');
  const pdf = await previewFromTree(win, 'hostile.pdf');
  await expect(win.getByTestId(`preview-pdf-${pdf}`)).toBeVisible({ timeout: 20_000 });
  const html = await previewFromTree(win, 'hostile.html');
  await expect(win.getByTestId(`preview-html-scripts-${html}`)).toBeVisible({ timeout: 15_000 });

  // The fence: the page's own relative stylesheet was requested through the protocol.
  await expect
    .poll(async () => (await recorded(app)).requests.some((r) => /^throng-preview:\/\/asset\/.+hostile-style\.css$/i.test(r.url)), { timeout: 15_000 })
    .toBe(true);
  // A plain click on the page's remote link follows nothing.
  const frame = win.frameLocator(`[data-testid="preview-html-frame-${html}"]`);
  await frame.locator('a').first().click();

  const after = await recorded(app);
  expect(after.requests.filter((r) => !allowed(r.url)), 'only renderer assets, blob: and throng-preview: may be requested').toEqual([]);
  expect(after.navigations, 'a navigation was attempted').toEqual([]);
  expect(after.windows, 'a window was opened').toBe(0);
  expect(dialogs, 'a dialog was raised').toEqual([]);
  expect(pageErrors.filter((m) => /throngHostile/.test(m))).toEqual([]);
  const flags = await win.evaluate(() =>
    Object.keys(window).filter((k) => k.startsWith('__throngHostile')),
  );
  expect(flags, 'a hostile script ran in the renderer').toEqual([]);
  await expect(frame.locator('script, iframe, object, embed, base, meta[http-equiv="refresh"]')).toHaveCount(0);
});
