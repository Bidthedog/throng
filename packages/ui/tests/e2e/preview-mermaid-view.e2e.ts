/**
 * 054 MT-04 defects B1–B3 — how a diagram's view controls LAY OUT in a real window. These were written
 * RED, before any fix, from the maintainer's hand test (replicating-bugs): each asserts the behaviour the
 * maintainer asked for, so each fails today for the reason they reported.
 *
 * ══ WHY THIS IS AN E2E (`@reserve:layout`) ══
 *
 * Every claim below is about measured geometry or paint order: whether a scrollbar appears, how tall a
 * laid-out box is, which element is on top at a point. jsdom reports
 * every rect as 0×0 and has no hit-testing, so `preview-diagram-frame.test.ts` can pin the classes and the
 * transform but not a pixel of the above. (B5, the resize lag, is countable without layout and lives in
 * `component/diagram-resize-work.test.ts`. B4, the zoom icons looking right-aligned, could not be reproduced:
 * every control's icon box is centred in its button to the pixel and the glyph ink is within 1px of it.)
 *
 * One shared app: nothing is seeded before launch, and each test opens its own preview.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';

const FLOW = 'graph TD\n  Start[Begin here] --> Finish[Done]\n';
/** Twelve long labels in a row: far wider than any panel, so Fit must shrink it below the readable floor. */
const WIDE = `graph LR\n${Array.from({ length: 12 }, (_, i) => `  N${i}[Service number ${i} of the long chain] --> N${i + 1}[Service number ${i + 1} of the long chain]`).join('\n')}\n`;

let shared: OpenApp | undefined;
let root = '';
let editorId = '';
/** The previews this test opened, closed after it so the next one gets the tab's width back. */
const opened: string[] = [];

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-preview-mermaid-view-'));
  writeFileSync(join(root, 'diagram.md'), `# Diagram doc\n\nSome words to find.\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n`);
  writeFileSync(join(root, 'flow.mmd'), FLOW);
  writeFileSync(join(root, 'max.md'), `# Max doc\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n`);
  writeFileSync(join(root, 'status.md'), `# Status doc\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n`);
  writeFileSync(join(root, 'folded.md'), `# Folded doc\n\nIntro.\n\n## Section\n\nInside words.\n\n\`\`\`mermaid\n${FLOW}\`\`\`\n`);
  writeFileSync(join(root, 'wide.mmd'), WIDE);
  shared = await openApp();
  await createProject(shared.win, 'PreviewMermaidView', root);
  editorId = await firstPanelId(shared.win);
  await shared.win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await shared.win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await expect(shared.win.getByTestId(`editor-${editorId}`)).toBeVisible();
});

test.afterEach(async () => {
  const win = shared?.win;
  if (!win) return;
  // A test that failed mid-way may have left a diagram maximised: put it back before closing anything.
  while ((await win.getByTestId('maximise-layer').count()) > 0) await win.keyboard.press('Escape');
  for (const id of opened.splice(0)) {
    const close = win.getByTestId(`panel-close-${id}`);
    if ((await close.count()) > 0) await close.click();
    await expect(win.getByTestId(`panel-${id}`)).toHaveCount(0);
  }
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Click a file into the editor, then open its preview from the status bar; the new panel's id. */
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
  const id = added.replace('preview-body-', '');
  opened.push(id);
  return id;
}

/** Click a Mermaid file in the tree (its default open action is Preview); the preview panel's id. */
async function previewFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const title = `${file} - Preview`; // 054 FR-005a: the full file name
  const heading = win.locator('[data-testid^="panel-title-"]').filter({ hasText: new RegExp(`^${title.replace(/\./g, '\\.')}$`) }).first();
  await expect(heading).toBeVisible({ timeout: 8000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`previewFromTree(${file}): no preview panel titled ${title}`);
  const id = testId.replace('panel-title-', '');
  opened.push(id);
  return id;
}

async function drawnFrame(win: Page, id: string): Promise<Locator> {
  const frame = win.getByTestId(`diagram-frame-${id}-diagram-0`);
  await expect(frame.locator('svg').first()).toBeVisible({ timeout: 15_000 });
  return frame;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

test('B1: Fit on a wide diagram fits both extents inside the viewport, with no horizontal scrollbar', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromTree(win, 'wide.mmd');
  const frame = await drawnFrame(win, id);
  await frame.getByTitle('Fit diagram').click();
  await expect(frame).toHaveAttribute('data-mode', 'fit');

  const m = await frame.evaluate((el) => {
    const rect = (e: Element): Box => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const viewport = el.querySelector('.preview-diagram-frame__viewport')!;
    const svg = el.querySelector('.preview-diagram-frame__layer svg')!;
    const body = el.closest('.preview-panel__body')!;
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
      scale: el.getAttribute('data-scale'),
      viewport: rect(viewport),
      svg: rect(svg),
      body: rect(body),
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
    };
  });
  // FR-046a (manual test change request, 2026-10-13) — a .mmd preview's diagram fills the panel's body, and the
  // body has nothing left to scroll: no vertical scrollbar.
  expect(m.bodyScrollHeight, 'preview body scrollHeight vs clientHeight').toBeLessThanOrEqual(m.bodyClientHeight);
  expect(m.viewport.height, 'the viewport against the preview body').toBeGreaterThanOrEqual(m.body.height - 2);
  // No horizontal scrollbar: the box does not scroll sideways…
  expect(m.scrollWidth, `frame scrollWidth vs clientWidth (overflow-x ${m.overflowX}, scale ${m.scale})`).toBeLessThanOrEqual(m.clientWidth);
  // …because the whole drawing is inside the viewport, horizontally and vertically.
  expect(m.svg.left).toBeGreaterThanOrEqual(m.viewport.left - 1);
  expect(m.svg.right, 'the drawing’s right edge against the viewport’s').toBeLessThanOrEqual(m.viewport.right + 1);
  expect(m.svg.top).toBeGreaterThanOrEqual(m.viewport.top - 1);
  expect(m.svg.bottom, 'the drawing’s bottom edge against the viewport’s').toBeLessThanOrEqual(m.viewport.bottom + 1);
});

test('B2: a maximised diagram fills the whole middle section, as a layer above every panel in the tab', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  // An inline diagram: a standalone `.mmd` maximises from its panel header only.
  const id = await previewFromEditor(win, 'max.md', 'Max doc');
  const frame = await drawnFrame(win, id);
  await frame.getByTitle('Maximise').click();

  const layer = win.getByTestId('maximise-layer');
  await expect(layer).toBeVisible();
  const m = await layer.evaluate((el) => {
    const rect = (e: Element | null): Box | null => {
      if (e === null) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      layer: rect(el),
      body: rect(el.closest('.tab-body')),
      inPane: rect(el.querySelector('.preview-diagram-frame--in-pane')),
      viewport: rect(el.querySelector('.preview-diagram-frame__viewport')),
      svg: rect(el.querySelector('.preview-diagram-frame__layer svg')),
    };
  });
  const { layer: l, body, inPane, viewport, svg } = m;
  expect(l && body && inPane && viewport && svg, 'the layer, the tab body, the pane frame, its viewport and the drawing all exist').toBeTruthy();
  // The layer covers the tab's middle section…
  expect(l!.height, 'maximise layer height vs the tab body’s').toBeGreaterThanOrEqual(body!.height - 20);
  // …and the diagram’s frame and viewport fill THE LAYER, not the top part of it.
  expect(inPane!.height, 'pane frame height vs the layer’s').toBeGreaterThanOrEqual(l!.height - 8);
  expect(viewport!.height, 'pane viewport height vs the layer’s').toBeGreaterThanOrEqual(l!.height - 8);
  // The whole drawing is shown (not its top half).
  expect(svg!.bottom, 'the drawing’s bottom against the viewport’s').toBeLessThanOrEqual(viewport!.bottom + 1);

  await layer.getByTitle('Minimise').click();
  await expect(layer).toHaveCount(0);
});

test('B3: a maximised diagram sits above an open find bar, which stays open', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromEditor(win, 'diagram.md', 'Diagram doc');
  const frame = await drawnFrame(win, id);
  await win.getByTestId(`preview-markdown-${id}`).getByText('Some words to find.').click();
  await win.keyboard.press('Control+f');
  const bar = win.getByTestId(`find-bar-${id}`);
  await expect(bar).toBeVisible();

  await frame.getByTitle('Maximise').click();
  const layer = win.getByTestId('maximise-layer');
  await expect(layer).toBeVisible();

  // Open, not closed…
  await expect(bar).toHaveCount(1);
  // …but behind: the topmost element at the bar’s centre belongs to the layer, not to the bar.
  const bar0 = await bar.boundingBox();
  const panelBox = await bar.locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " panel-box ")][1]').boundingBox();
  expect(bar0 && panelBox, 'the find bar and its panel are laid out').toBeTruthy();
  // The bar's VISIBLE part: in a narrow panel its box runs past the panel's clipped edge (over the sidebar).
  const left = Math.max(bar0!.x, panelBox!.x);
  const right = Math.min(bar0!.x + bar0!.width, panelBox!.x + panelBox!.width);
  const box = { x: left, y: bar0!.y, width: Math.max(0, right - left), height: bar0!.height };
  expect(box.width, 'part of the find bar is inside its panel').toBeGreaterThan(0);
  const top = await win.evaluate(({ x, y }) => {
    // Hit-testing skips `inert` subtrees, and the panel under a maximised section is one: lift that for the
    // read, so the answer is PAINT order — what the reader sees — rather than "what a click would reach".
    for (const el of document.querySelectorAll('[inert]')) el.removeAttribute('inert');
    const el = document.elementFromPoint(x, y);
    const owner = el?.closest('[data-testid]')?.getAttribute('data-testid') ?? 'none';
    const what = el === null ? 'nothing' : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} in ${owner}`;
    return { inBar: el?.closest('.find-bar') != null, inLayer: el?.closest('[data-testid="maximise-layer"]') != null, what };
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(top.inBar, `the find bar is the topmost element at its own centre (topmost: ${top.what})`).toBe(false);
  expect(top.inLayer, `the maximised diagram’s layer is the topmost element there (topmost: ${top.what})`).toBe(true);

  await layer.getByTitle('Minimise').click();
  await win.keyboard.press('Escape');
});

/** Which of `selector` / the maximise layer is topmost at `box`'s centre, read as paint order (see B3). */
async function topmostAt(win: Page, box: { x: number; y: number; width: number; height: number }, selector: string): Promise<{ inTarget: boolean; inLayer: boolean }> {
  return win.evaluate(({ x, y, selector }) => {
    for (const el of document.querySelectorAll('[inert]')) el.removeAttribute('inert');
    const el = document.elementFromPoint(x, y);
    return { inTarget: el?.closest(selector) != null, inLayer: el?.closest('[data-testid="maximise-layer"]') != null };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2, selector });
}

test('B6: a maximised inline diagram covers its preview’s status bar', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromEditor(win, 'status.md', 'Status doc');
  const frame = await drawnFrame(win, id);
  const strip = win.getByTestId(`preview-status-bar-${id}`);
  await expect(strip).toBeVisible();

  await frame.getByTitle('Maximise').click();
  const layer = win.getByTestId('maximise-layer');
  await expect(layer).toBeVisible();
  const box = await strip.boundingBox();
  expect(box, 'the status bar is laid out').not.toBeNull();
  const top = await topmostAt(win, box!, '.preview-status-bar');
  expect(top.inTarget, 'the preview’s status bar is the topmost element at its own centre').toBe(false);
  expect(top.inLayer, 'the maximised diagram’s layer is the topmost element there').toBe(true);

  await layer.getByTitle('Minimise').click();
});

test('B7: collapsing a heading hides the diagram in its region with the rest of it', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const id = await previewFromEditor(win, 'folded.md', 'Folded doc');
  const frame = await drawnFrame(win, id);
  const body = win.getByTestId(`preview-markdown-${id}`);
  const inside = body.getByText('Inside words.');
  await expect(inside).toBeVisible();

  await body.getByRole('heading', { name: 'Section' }).locator('.preview-fold-toggle').click();

  await expect(inside, 'the region’s paragraph is folded away').toBeHidden();
  await expect(frame, 'the region’s diagram is folded away with it').toBeHidden();
});

/**
 * The colour actually PAINTED at a window point, through Electron's own capture — paint order made visible.
 * A focus ring is an outline and outlines are never hit-tested, so `elementFromPoint` cannot say whether the
 * ring or the diagram is on top; only the pixel can.
 */
async function pixelAt(app: OpenApp['app'], x: number, y: number): Promise<[number, number, number]> {
  return app.evaluate(async ({ BrowserWindow }, at) => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    if (window === undefined) throw new Error('pixelAt: no visible window');
    const bitmap = (await window.webContents.capturePage({ x: Math.floor(at.x), y: Math.floor(at.y), width: 1, height: 1 })).toBitmap();
    return [bitmap[2]!, bitmap[1]!, bitmap[0]!] as [number, number, number]; // BGRA
  }, { x, y });
}

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 24);

/**
 * How many of the first eight pixels in from a panel's left edge, at window height `y`, are painted in the panel's
 * ring colour: the ring's thickness there, plus any second ring drawn just inside it.
 */
async function ringPixelsAt(app: OpenApp['app'], panel: Locator, y: number): Promise<{ count: number; painted: string }> {
  const ring = ((await panel.evaluate((el) => getComputedStyle(el).outlineColor)).match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const box = await panel.boundingBox();
  const run: [number, number, number][] = [];
  for (let dx = 0; dx < 8; dx += 1) run.push(await pixelAt(app, box!.x + dx + 0.5, y));
  return { count: run.filter((px) => near(px, ring)).length, painted: run.map((px) => px.join(',')).join(' | ') };
}

/** The ring's thickness beside the panel's title and beside the middle of its body. */
async function ringThickness(app: OpenApp['app'], panel: Locator, panelId: string): Promise<{ title: number; body: number; detail: string }> {
  // A file opened from the File Explorer flashes its panel's border in the accent for a moment (047 FR-083); the
  // flash is not the ring, and sampled mid-fade it reads as a second one.
  await expect(panel.getByTestId(`panel-flash-${panelId}`)).toHaveCount(0);
  const title = await panel.getByTestId(`panel-title-${panelId}`).boundingBox();
  const body = await panel.getByTestId(`panel-body-${panelId}`).boundingBox();
  const atTitle = await ringPixelsAt(app, panel, title!.y + title!.height / 2);
  const atBody = await ringPixelsAt(app, panel, body!.y + body!.height / 2);
  return { title: atTitle.count, body: atBody.count, detail: `title: ${atTitle.painted}; body: ${atBody.painted}` };
}

/**
 * Zoom a diagram in and middle-drag its first node onto the left edge of `edgeOf`, so a drawn element lies
 * under whatever border runs down that edge; the node's centre line, in window coordinates.
 */
async function nodeOntoLeftEdge(win: Page, frame: Locator, edgeOf: Locator): Promise<number> {
  for (let i = 0; i < 3; i += 1) await frame.getByTitle('Zoom in').first().click();
  const node = frame.locator('svg .node').first();
  const n = await node.boundingBox();
  const edge = await edgeOf.boundingBox();
  const viewport = await frame.locator('.preview-diagram-frame__viewport').first().boundingBox();
  expect(n && edge && viewport, 'the node, the edge and the viewport are laid out').toBeTruthy();
  const from = { x: viewport!.x + viewport!.width / 2, y: viewport!.y + viewport!.height / 2 };
  await win.mouse.move(from.x, from.y);
  await win.mouse.down({ button: 'middle' });
  await win.mouse.move(from.x + (edge!.x - (n!.x + n!.width / 2)), from.y, { steps: 4 });
  await win.mouse.up({ button: 'middle' });
  const moved = await node.boundingBox();
  expect(moved!.x, 'the node now spans the left edge').toBeLessThan(edge!.x + 2);
  expect(moved!.x + moved!.width, 'the node now spans the left edge').toBeGreaterThan(edge!.x + 4);
  return moved!.y + moved!.height / 2;
}

test('B8: focus borders paint above a zoomed diagram — a .mmd preview’s panel, and a diagram in Focus Mode (2026-10-13)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const { app, win } = shared!;

  // MT-04 retest (2026-10-13): an active panel's ring is as thick beside its body as beside its title — an
  // editor's, and a .mmd preview's whether its title or its diagram was clicked, the diagram adding no ring.
  const editorPanel = win.getByTestId(`panel-${editorId}`);
  await editorPanel.getByTestId(`panel-title-${editorId}`).click();
  await expect(editorPanel).toHaveClass(/panel-box--active/);
  const editorRing = await ringThickness(app, editorPanel, editorId);
  expect(editorRing.body, `an editor's ring beside its body matches its title's — ${editorRing.detail}`).toBe(editorRing.title);

  // A .mmd preview: its diagram fills the panel, so a node panned to the left edge lies under the panel's ring.
  const id = await previewFromTree(win, 'flow.mmd');
  const frame = await drawnFrame(win, id);
  const panel = win.getByTestId(`panel-${id}`);
  await panel.getByTestId(`panel-title-${id}`).click();
  await expect(panel).toHaveClass(/panel-box--active/);
  const byTitle = await ringThickness(app, panel, id);
  expect(byTitle.body, `a .mmd preview's ring beside its body matches its title's — ${byTitle.detail}`).toBe(byTitle.title);
  await frame.locator('.preview-diagram-frame__viewport').click();
  const byDiagram = await ringThickness(app, panel, id);
  expect(byDiagram.body, `with its diagram clicked, still one ring — ${byDiagram.detail}`).toBe(byDiagram.title);
  const panelRing = await panel.evaluate((el) => getComputedStyle(el).outlineColor);
  const [r, g, b] = (panelRing.match(/\d+/g) ?? []).map(Number);
  const y = await nodeOntoLeftEdge(win, frame, frame);
  const box = await panel.boundingBox();
  // The panel's ring, its border and the pixel inside it, with no drawn node in it. Before the fix the node's
  // fill was painted at the ring's inner pixel. The diagram draws no ring of its own: it is selected with its
  // panel (MT-04 retest, 2026-10-13).
  const band: [number, number, number][] = [];
  for (let dx = 0; dx <= 1; dx += 1) band.push(await pixelAt(app, box!.x + dx + 0.5, y));
  expect(
    band.every((px) => near(px, [r!, g!, b!])),
    `the focus ring band at the panel's left edge, x ${box!.x}..+2: painted ${band.map((p) => p.join(',')).join(' | ')}, ring ${panelRing}`,
  ).toBe(true);

  // An inline diagram in Focus Mode: its own focus ring, inside the maximise layer, in its panel's colour — the
  // project's (MT-04 retest, 2026-10-13: it took the theme's default).
  const mdId = await previewFromEditor(win, 'max.md', 'Max doc');
  const mdFrame = await drawnFrame(win, mdId);
  await mdFrame.locator('.preview-diagram-frame__viewport').click();
  const panelColour = (
    (await win.getByTestId(`panel-${mdId}`).evaluate((el) => getComputedStyle(el).outlineColor)).match(/\d+/g) ?? []
  )
    .slice(0, 3)
    .map(Number) as [number, number, number];
  await mdFrame.getByTitle('Maximise').click();
  const pane = win.getByTestId('maximise-layer').locator('.preview-diagram-frame--in-pane');
  await expect(pane.locator('svg').first()).toBeVisible();
  const paneY = await nodeOntoLeftEdge(win, pane, pane);
  const paneBox = await pane.boundingBox();
  const ring = panelColour;
  const paneBand: [number, number, number][] = [];
  for (let dx = 0; dx <= 1; dx += 1) paneBand.push(await pixelAt(app, paneBox!.x + dx + 0.5, paneY));
  expect(
    paneBand.every((px) => near(px, ring)),
    `the Focus Mode diagram's ring at its left edge: painted ${paneBand.map((p) => p.join(',')).join(' | ')}, ring ${ring}`,
  ).toBe(true);
  await win.keyboard.press('Escape');
});

test('B9: Ctrl+middle-click on a diagram resets it to Fit and never starts a pan (2026-10-13)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  for (const open of [() => previewFromTree(win, 'flow.mmd'), () => previewFromEditor(win, 'diagram.md', 'Diagram doc')]) {
    const frame = await drawnFrame(win, await open());
    const viewport = frame.locator('.preview-diagram-frame__viewport');
    await viewport.click();
    await frame.getByTitle('Zoom in').click();
    await frame.getByTitle('Zoom in').click();
    await expect(frame).toHaveAttribute('data-mode', 'zoom');
    const v = await viewport.boundingBox();
    await win.keyboard.down('Control');
    await win.mouse.move(v!.x + v!.width / 2, v!.y + v!.height / 2);
    await win.mouse.down({ button: 'middle' });
    await expect(viewport, 'no pan starts: no move cursor').not.toHaveClass(/preview-diagram-frame__viewport--panning/);
    await win.mouse.up({ button: 'middle' });
    await win.keyboard.up('Control');
    // The diagram's default view, Fit — not 1:1 (manual test change request, 2026-10-13).
    await expect(frame).toHaveAttribute('data-mode', 'fit');
  }
});
