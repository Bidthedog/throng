/**
 * The user guide's screenshots (080 FR-023, FR-031; research R24).
 *
 * NOT a test of throng: a generator that drives the real app through the E2E harness, sets up a demo project
 * the way a user would have it, and writes `site/guide/images/<page>/<task>.png`. Re-running it refreshes every image,
 * so a UI change never leaves a stale picture behind. It lives outside `tests/e2e`, so the E2E suite's tags,
 * budget and tier plans do not apply and CI never runs it.
 *
 *   npm run build && npm run guide:screenshots
 *
 * Each shot is independent: one that cannot be taken is reported at the end and the rest are still written.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  TEST_SHELL,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  createProject,
  firstPanelId,
  openApp,
  panelIds,
  pressAction,
  splitPanelViaMenu,
} from '../e2e/harness.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const IMAGES = join(REPO, 'site', 'guide', 'images');
const WIDTH = 1440;
const HEIGHT = 900;

/** The demo project: enough of a real repository that every page has something to show. */
function demoProject(): string {
  // A fixed, neutral path: it shows in the title bar, the Projects pane and the prompt.
  const parent = join(tmpdir(), 'throng-guide');
  rmSync(parent, { recursive: true, force: true });
  const root = join(parent, 'acme-web');
  const files: Record<string, string> = {
    'README.md': [
      '# acme-web',
      '',
      'The storefront for **Acme Widgets**: a small web app with a REST API behind it.',
      '',
      '## Getting started',
      '',
      '1. Install the dependencies: `npm install`',
      '2. Start the dev server: `npm run dev`',
      '3. Open <http://localhost:5173>',
      '',
      '| Script | What it does |',
      '|---|---|',
      '| `dev` | Starts the dev server with hot reload |',
      '| `test` | Runs the unit tests |',
      '| `build` | Builds for production |',
      '',
    ].join('\n'),
    'package.json': JSON.stringify(
      { name: 'acme-web', version: '1.4.2', scripts: { dev: 'vite', test: 'vitest', build: 'vite build' } },
      null,
      2,
    ),
    'src/main.ts': [
      "import { createApp } from './app';",
      "import { loadCatalogue } from './catalogue';",
      '',
      'const app = createApp();',
      '',
      'async function start(): Promise<void> {',
      '  const catalogue = await loadCatalogue();',
      '  app.render(catalogue);',
      "  console.log(`Loaded ${catalogue.length} widgets`);",
      '}',
      '',
      'start().catch((error) => {',
      "  console.error('Could not start the storefront', error);",
      '});',
      '',
    ].join('\n'),
    'src/app.ts': [
      "import type { Widget } from './catalogue';",
      '',
      'export function createApp() {',
      '  return {',
      '    render(widgets: Widget[]) {',
      "      const list = document.querySelector('#widgets');",
      '      if (!list) return;',
      "      list.innerHTML = widgets.map((w) => `<li>${w.name} — £${w.price}</li>`).join('');",
      '    },',
      '  };',
      '}',
      '',
    ].join('\n'),
    'src/catalogue.ts': [
      'export interface Widget {',
      '  id: string;',
      '  name: string;',
      '  price: number;',
      '}',
      '',
      'export async function loadCatalogue(): Promise<Widget[]> {',
      "  const response = await fetch('/api/widgets');",
      '  return (await response.json()) as Widget[];',
      '}',
      '',
    ].join('\n'),
    'data/widgets.csv': [
      'id,name,colour,price,stock',
      'w-001,Sprocket,Red,4.99,120',
      'w-002,Flange,Blue,7.50,64',
      'w-003,Grommet,Green,1.25,980',
      'w-004,Doohickey,Yellow,12.00,15',
      'w-005,Thingamajig,Purple,19.99,8',
      'w-006,Whatsit,Orange,3.40,230',
      '',
    ].join('\n'),
    'docs/notes.md': '# Release notes\n\n- Basket totals round to the penny\n- The catalogue loads in one request\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  cpSync(join(REPO, 'site', 'assets', 'logo.svg'), join(root, 'assets', 'logo.svg'));
  return root;
}

async function sizeWindows(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isMaximized()) w.unmaximize();
        w.setSize(size.w, size.h);
      }
    },
    { w: WIDTH, h: HEIGHT },
  );
}

function out(page: string, task: string): string {
  const file = join(IMAGES, page, `${task}.png`);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

async function settled(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

/**
 * A whole window, written to its page's folder. Every guide screenshot is landscape and fills the page's column
 * (FR-037): a shot of one panel is taken with that panel filling the window (see focusShot), never as a tall crop,
 * so a portrait capture stops the run here rather than reaching the guide.
 */
async function snap(window: Page, page: string, task: string): Promise<void> {
  await settled(window);
  const png = await window.screenshot({ path: out(page, task) });
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (height >= width) throw new Error(`${page}/${task}.png is ${width}×${height}: guide screenshots are landscape`);
}

/** The newest panel in Focus Mode, filling its tab, then back out of it. */
async function focusShot(win: Page, page: string, task: string, panelId?: string): Promise<void> {
  const ids = await panelIds(win);
  const id = panelId ?? (ids[ids.length - 1] as string);
  await win.getByTestId(`panel-handle-${id}`).click();
  await win.keyboard.press('Shift+Alt+Enter');
  await win.waitForTimeout(800);
  await snap(win, page, task);
  await win.keyboard.press('Shift+Alt+Enter');
  await win.waitForTimeout(500);
}

async function openPrefs(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId(`cog-menu-${tab}`).click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await sizeWindows(app);
  await prefs.waitForTimeout(800);
  return prefs;
}

async function openWindowFromCog(app: ElectronApplication, win: Page, testId: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [other] = await Promise.all([app.waitForEvent('window'), win.getByTestId(testId).click()]);
  await other.waitForLoadState('domcontentloaded');
  await other.waitForTimeout(1200);
  return other;
}

test('guide screenshots', async () => {
  test.setTimeout(10 * 60_000);
  const root = demoProject();
  const { app, win, close } = await openApp();
  const failures: string[] = [];
  const shot = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`);
      await win.keyboard.press('Escape').catch(() => undefined);
    }
  };

  try {
    await sizeWindows(app);

    await shot('projects/add-a-project', async () => {
      await win.getByTestId('project-new').click();
      await expect(win.getByTestId('project-form')).toBeVisible();
      await win.getByTestId('project-root-input').fill(root);
      await win.getByTestId('project-name-input').fill('acme-web');
      await snap(win, 'projects', 'add-a-project');
      await win.keyboard.press('Escape');
    });

    await createProject(win, 'acme-web', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree).toContainText('src');
    await tree.getByText('src', { exact: true }).dblclick();
    await tree.getByText('docs', { exact: true }).dblclick();

    // An editor on the left, a terminal on the right: the window most people work in.
    const first = await firstPanelId(win);
    await shot('layout/split-the-workspace', async () => {
      await win.getByTestId(`panel-add-${first}`).click();
      await expect(win.getByTestId('menu-item-Split Right')).toBeVisible();
      await snap(win, 'layout', 'split-the-workspace');
      await win.keyboard.press('Escape');
    });
    await splitPanelViaMenu(win, first, 'right');
    const [left, right] = await panelIds(win);

    await shot('editing/open-a-file', async () => {
      await win.getByTestId(`panel-type-select-${left}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${left}`).click();
      await tree.getByText('main.ts', { exact: true }).click();
      await expect(win.getByTestId(`editor-${left}`).locator('.cm-content')).toContainText('loadCatalogue', {
        timeout: 10_000,
      });
      await focusShot(win, 'editing', 'open-a-file', left);
    });

    await shot('terminals/open-a-terminal', async () => {
      await win.getByTestId(`panel-type-select-${right}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
      await snap(win, 'terminals', 'choose-your-shell');
      await win.getByTestId(`panel-type-confirm-${right}`).click();
      const term = win.getByTestId(`terminal-${right}`);
      await expect(term).toContainText('acme-web', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      await term.click();
      // A neutral prompt: no user or machine name in a published picture.
      if (process.platform !== 'win32') await win.keyboard.type("PS1='\\W \\$ '; clear\r", { delay: 20 });
      await win.keyboard.type(process.platform === 'win32' ? 'dir /b\r' : 'ls -1\r', { delay: 30 });
      await win.waitForTimeout(1200);
      await focusShot(win, 'terminals', 'open-a-terminal', right);
    });

    await shot('quick-start/find-your-way-around-the-window', async () => {
      await snap(win, 'quick-start', 'find-your-way-around-the-window');
    });

    await shot('files/browse-your-project', async () => {
      await snap(win, 'files', 'browse-your-project');
    });

    await shot('files/right-click', async () => {
      await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
      await win.waitForTimeout(300);
      await snap(win, 'files', 'right-click-a-file');
      await win.keyboard.press('Escape');
    });

    await shot('markdown/preview-markdown', async () => {
      await tree.getByText('README.md', { exact: true }).click();
      await win.waitForTimeout(1500);
      // The file beside its rendered preview: the editor, the terminal and the new preview.
      await snap(win, 'previews', 'open-a-preview');
      await focusShot(win, 'markdown', 'preview-markdown');
    });

    await shot('csv-and-spreadsheets/preview-a-csv', async () => {
      await tree.getByText('data', { exact: true }).dblclick();
      await tree.getByText('widgets.csv', { exact: true }).click();
      await win.waitForTimeout(1500);
      await focusShot(win, 'csv-and-spreadsheets', 'preview-a-csv');
    });

    await shot('images-pdfs-svg-html/preview-an-image', async () => {
      await tree.getByText('assets', { exact: true }).dblclick();
      await tree.getByText('logo.svg', { exact: true }).click();
      await win.waitForTimeout(1500);
      await focusShot(win, 'images-pdfs-svg-html', 'preview-an-image');
    });

    await shot('finding/search-the-whole-project', async () => {
      await win.getByTestId(`editor-${left}`).click().catch(() => undefined);
      await pressAction(win, 'search.findInFiles');
      await win.waitForTimeout(600);
      await win.keyboard.type('catalogue', { delay: 30 });
      await win.keyboard.press('Enter');
      await win.waitForTimeout(1500);
      await focusShot(win, 'finding', 'search-the-whole-project');
      await win.keyboard.press('Escape');
    });

    await shot('attention/attention', async () => {
      const term = win.getByTestId(`terminal-${right}`);
      await term.click();
      await win.keyboard.type(process.platform === 'win32' ? 'echo \x07\r' : "printf '\\a'\r", { delay: 30 });
      await win.waitForTimeout(1500);
      await win.getByTestId(`editor-${left}`).click();
      await win.waitForTimeout(800);
      await snap(win, 'attention', 'see-what-needs-you');
    });

    await shot('sub-workspaces/panel-menu', async () => {
      await win.getByTestId(`panel-handle-${right}`).click({ button: 'right' });
      await win.waitForTimeout(400);
      await snap(win, 'sub-workspaces', 'move-panels-to-another-window');
      await win.keyboard.press('Escape');
    });

    for (const [tab, page, task] of [
      ['settings', 'preferences', 'change-a-setting'],
      ['keybindings', 'key-bindings', 'change-a-key-binding'],
      ['themes', 'themes-and-icons', 'choose-a-theme'],
    ] as const) {
      await shot(`${page}/${task}`, async () => {
        const prefs = await openPrefs(app, win, tab);
        await snap(prefs, page, task);
        await prefs.close();
      });
    }

    await shot('resources/resource-monitor', async () => {
      const monitor = await openWindowFromCog(app, win, 'cog-resource-monitor');
      await monitor.waitForTimeout(2500);
      await snap(monitor, 'resources', 'see-what-throng-is-using');
      await monitor.close();
    });

    await shot('troubleshooting/about', async () => {
      const about = await openWindowFromCog(app, win, 'cog-menu-about');
      await snap(about, 'troubleshooting', 'find-your-version');
      await about.close();
    });
  } finally {
    await close();
  }
  expect(failures, 'shots that could not be taken').toEqual([]);
});
