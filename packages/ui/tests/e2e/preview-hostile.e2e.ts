/**
 * 044 SC-004 — a hostile Markdown file executes nothing and requests nothing, and a remote image is not
 * requested once *Load remote images* is off (FR-081, FR-082, FR-092, FR-093; research R22).
 *
 * ══ WHY THIS IS AN E2E (`@reserve:runtime`) ══
 *
 * The sanitiser's OUTPUT is pinned in jsdom (`component/preview-sanitise.test.ts`) and the request
 * policy row by row in `core/tests/unit/renderer-request-policy.test.ts`. Neither can say what a real
 * Chromium DID with the document: jsdom fetches no image and enforces no CSP, so "nothing ran and nothing
 * was requested" is a property of the running renderer under the real CSP and the real main-process
 * filter, and the substitute cannot hold it.
 *
 * ══ WHAT IS RECORDED, AND WHERE ══
 *
 * - **Requests**, in MAIN, on the default session's `onCompleted` and `onErrorOccurred`. Not
 *   `onBeforeRequest`: Electron keeps ONE listener per event, and the app's Layer 4 filter is that
 *   listener — replacing it would test a session without the filter. Between them the two events see
 *   every renderer request that reached the network stack, whether it loaded, failed, or was cancelled
 *   by the filter. A request the CSP refused never gets that far, which is the point: it was not made.
 * - **Dialogs**, **console errors** and **page errors** on the window, and **navigations** both as the
 *   page saw them (`framenavigated`) and as main saw them attempted (`will-navigate`, before the guard
 *   prevents it).
 *
 * ══ EVERY ABSENCE HAS A FENCE ══
 *
 * "Nothing was requested" is only evidence once the document's own loads have demonstrably happened.
 * Both fixtures carry a RELATIVE image, which the sanitiser rewrites to `throng-preview://asset/…`: the
 * recorder seeing that request complete is the fence for the absences, and also proves the recorder
 * sees this preview's image loads at all — so an empty list cannot be a recorder that records nothing.
 *
 * ══ THE SETTING IS TURNED OFF ON DISK ══
 *
 * Through the config store's hot reload, never the preferences window, so this spec takes no focus and
 * belongs in the parallel tier (contracts/security-policy.md, the fixtures section). It waits for the
 * renderer to RECEIVE the change before opening the second preview: a preview drawn a moment early would
 * request the image legitimately, and the failure would blame the setting.
 */
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp as runOwnApp, createProject, firstPanelId, cleanupTemp } from './harness.js';
import { configRootSeeded } from './helpers/config-snapshot.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));
/** The directory every window's `index.html` loads from — the only `file:` a renderer may reach. */
const RENDERER_DIR_URL = pathToFileURL(fileURLToPath(new URL('../../dist/renderer', import.meta.url))).href.toLowerCase();

interface Recorded {
  url: string;
  outcome: string;
}

/** Start recording renderer requests and attempted navigations in main. Idempotent per app. */
async function installRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session, webContents }) => {
    const g = globalThis as unknown as { __previewE2E?: { requests: Recorded[]; navigations: string[] } };
    g.__previewE2E = { requests: [], navigations: [] };
    const rec = g.__previewE2E;
    const filter = { urls: ['<all_urls>'] };
    session.defaultSession.webRequest.onCompleted(filter, (d) => {
      if (d.webContentsId !== undefined) rec.requests.push({ url: d.url, outcome: `completed ${d.statusCode}` });
    });
    session.defaultSession.webRequest.onErrorOccurred(filter, (d) => {
      if (d.webContentsId !== undefined) rec.requests.push({ url: d.url, outcome: d.error });
    });
    for (const wc of webContents.getAllWebContents()) {
      wc.on('will-navigate', (e) => rec.navigations.push(e.url));
    }
  });
}

/** Forget what has been recorded so far, so the next assertions are about one preview. */
async function resetRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __previewE2E: { requests: Recorded[]; navigations: string[] } };
    g.__previewE2E.requests.length = 0;
    g.__previewE2E.navigations.length = 0;
  });
}

async function recorded(app: ElectronApplication): Promise<{ requests: Recorded[]; navigations: string[] }> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __previewE2E: { requests: Recorded[]; navigations: string[] } };
    return { requests: [...g.__previewE2E.requests], navigations: [...g.__previewE2E.navigations] };
  });
}

/** A request this preview is allowed to make: the app's own renderer assets, or the confined protocol. */
function allowed(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith('throng-preview:') || u.startsWith(`${RENDERER_DIR_URL}/`);
}

/** Click a Markdown file in the tree into the editor, then open its preview from the status bar. */
async function previewFromEditor(win: Page, editorId: string, file: string, heading: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText(heading, { timeout: 8000 });
  const button = win.getByTestId(`editor-preview-${editorId}`);
  await expect(button).toBeEnabled();
  const before = new Set(
    await win.locator('[data-testid^="preview-body-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))),
  );
  await button.click();
  const body = win.locator('[data-testid^="preview-body-"]');
  await expect.poll(async () => (await body.count()) > before.size).toBe(true);
  const ids = await body.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  const added = ids.find((id) => !before.has(id));
  if (!added) throw new Error(`previewFromEditor(${file}): no new preview panel appeared`);
  return added.replace('preview-body-', '');
}

test('a hostile Markdown file runs and requests nothing, and a remote image is not requested once turned off on disk', { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-hostile-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-preview-hostile-'));
  cpSync(join(FIXTURES, 'hostile.md'), join(root, 'hostile.md'));
  cpSync(join(FIXTURES, 'remote-images.md'), join(root, 'remote-images.md'));
  try {
    await runOwnApp(
      async (app, win) => {
        await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
        await installRecorder(app);

        const dialogs: string[] = [];
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const frameNavigations: string[] = [];
        win.on('dialog', (d) => {
          dialogs.push(`${d.type()}: ${d.message()}`);
          void d.dismiss();
        });
        win.on('console', (m) => {
          if (m.type() === 'error') consoleErrors.push(m.text());
        });
        win.on('pageerror', (e) => pageErrors.push(e.message));
        win.on('framenavigated', (f) => frameNavigations.push(f.url()));

        await createProject(win, 'PreviewHostile', root);
        const editorId = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${editorId}`).click();
        await expect(win.getByTestId(`editor-${editorId}`)).toBeVisible();

        /* ── (1) hostile.md with Load remote images at its shipped ON ─────────────────────────────── */

        const shipped = JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')) as {
          editor?: { previews?: { providers?: { markdown?: { loadRemoteImages?: boolean } } } };
        };
        expect(
          shipped.editor?.previews?.providers?.markdown?.loadRemoteImages,
          'the first half is about the SHIPPED setting, which must be on',
        ).toBe(true);

        await resetRecorder(app);
        dialogs.length = 0;
        consoleErrors.length = 0;
        pageErrors.length = 0;
        frameNavigations.length = 0;

        const hostileId = await previewFromEditor(win, editorId, 'hostile.md', 'Hostile fixture');
        const hostile = win.getByTestId(`preview-markdown-${hostileId}`);
        // Present before absent: the document drew, including what the sanitiser keeps.
        await expect(hostile).toContainText('Hostile fixture');
        await expect(hostile).toContainText('kept text');
        // The fence: `<img src="x" onerror=…>` keeps its image, rewritten to the confined protocol. Its
        // request finishing means the document's loads have run.
        await expect
          .poll(async () => (await recorded(app)).requests.some((r) => /^throng-preview:\/\/asset\/.+\/x$/i.test(r.url)), {
            timeout: 15_000,
          })
          .toBe(true);

        const afterHostile = await recorded(app);
        expect(dialogs, 'a dialog means script ran').toEqual([]);
        expect(pageErrors, 'an uncaught page error').toEqual([]);
        /*
         * Console errors FROM SCRIPT EXECUTION, not every console error. Chromium does log two kinds
         * here, measured on the first run, and neither is a script running:
         *   - "Setting the document's base URI to 'https://example.com/' violates … base-uri 'none'" —
         *     the fixture's `<base href>` refused by the CSP while the markup is parsed, before the
         *     sanitiser drops the element (Layer 3 doing its job; no `base` survives, asserted below);
         *   - "Failed to load resource … 415" — the fence image `x`, which the protocol answers as not
         *     an image.
         * What script execution leaves is a dialog, a page error, or a CSP refusal to RUN something —
         * an inline script, an inline handler, `eval`, a `javascript:` URL. Those are what is refused.
         */
        const scriptErrors = consoleErrors.filter((t) =>
          /refused to (execute|evaluate|run)|script-src|inline event handler|unsafe-eval|javascript:/i.test(t),
        );
        test.info().annotations.push({ type: 'console errors (hostile.md)', description: JSON.stringify(consoleErrors) });
        expect(scriptErrors, 'a console error from script execution while the hostile document was shown').toEqual([]);
        expect(afterHostile.navigations, 'a navigation was attempted').toEqual([]);
        expect(frameNavigations, 'the window navigated').toEqual([]);
        expect(
          afterHostile.requests.filter((r) => !allowed(r.url)),
          `only renderer assets under ${RENDERER_DIR_URL} and throng-preview: may be requested`,
        ).toEqual([]);
        // The sanitised `onerror`, `onload` and `javascript:` hrefs are what would have run; none can be
        // found in the DOM either, which is the component tier's claim restated only as a precondition.
        expect(await hostile.locator('script, iframe, object, embed, form, base, meta, link').count()).toBe(0);

        /* ── (2) turn Load remote images OFF on disk, then remote-images.md ────────────────────────── */

        // Listen for the change BEFORE writing it, in the renderer: the store's own listener was
        // registered first, so when this one fires the store already holds the new value.
        await win.evaluate(() => {
          const w = window as unknown as {
            __remoteImagesOff?: boolean;
            throng: { config: { onChange: (cb: (p: unknown) => void) => () => void } };
          };
          w.__remoteImagesOff = false;
          const off = w.throng.config.onChange((payload) => {
            const s = (payload as { settings?: { editor?: { previews?: { providers?: { markdown?: { loadRemoteImages?: unknown } } } } } })
              .settings;
            if (s?.editor?.previews?.providers?.markdown?.loadRemoteImages === false) {
              w.__remoteImagesOff = true;
              off();
            }
          });
        });
        const current = JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')) as Record<string, unknown>;
        const editor = (current.editor ?? {}) as Record<string, unknown>;
        const previews = (editor.previews ?? {}) as Record<string, unknown>;
        const providers = (previews.providers ?? {}) as Record<string, unknown>;
        const markdown = (providers.markdown ?? {}) as Record<string, unknown>;
        writeSettingsAtomic(cfgRoot, {
          ...current,
          editor: { ...editor, previews: { ...previews, providers: { ...providers, markdown: { ...markdown, loadRemoteImages: false } } } },
        });
        await expect
          .poll(() => win.evaluate(() => (window as unknown as { __remoteImagesOff?: boolean }).__remoteImagesOff === true), {
            timeout: 15_000,
          })
          .toBe(true);
        // …and main, whose filter reads the setting on every request.
        await expect
          .poll(
            () =>
              win.evaluate(async () => {
                const p = (await (window as unknown as { throng: { config: { get: () => Promise<unknown> } } }).throng.config.get()) as {
                  settings?: { editor?: { previews?: { providers?: { markdown?: { loadRemoteImages?: unknown } } } } };
                };
                return p.settings?.editor?.previews?.providers?.markdown?.loadRemoteImages;
              }),
            { timeout: 15_000 },
          )
          .toBe(false);

        await resetRecorder(app);
        const remoteId = await previewFromEditor(win, editorId, 'remote-images.md', 'Build status');
        const remote = win.getByTestId(`preview-markdown-${remoteId}`);
        // The badge shows as its alternative text…
        await expect(remote.locator('.preview-markdown__alt', { hasText: 'Build status' })).toBeVisible();
        // …the fence: the relative image beside it was requested through the protocol…
        await expect
          .poll(async () => (await recorded(app)).requests.some((r) => /^throng-preview:\/\/asset\/.+\/image\.png$/i.test(r.url)), {
            timeout: 15_000,
          })
          .toBe(true);
        // …and the https image was not requested at all — not loaded, not failed, not cancelled.
        const afterRemote = await recorded(app);
        expect(afterRemote.requests.filter((r) => /^https?:/i.test(r.url))).toEqual([]);
        expect(await remote.locator('img[src^="https:"]').count()).toBe(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
