/**
 * 044 FR-024 and FR-107 — what a preview keeps IN VIEW: across a live update of the document it is
 * following, and across Back and Forward (research R11, R22).
 *
 * ══ WHY THIS IS AN E2E (`@reserve:layout`) ══
 *
 * The anchor's arithmetic is a pure function (`unit/scroll-anchor.test.ts`, with rects supplied by
 * hand) and main's history hands a body the place to restore (`integration/navigation-history-*`).
 * What neither can say is where a real layout puts the reader afterwards: jsdom reports every rect as
 * 0x0, so "the same heading is still where it was" has no meaning below a running Chromium.
 *
 * ══ HOW "IN VIEW" IS MEASURED ══
 *
 * A heading's top relative to the preview's scroll host, read only once two consecutive reads agree
 * (the same "stopped moving" condition `geom` uses). Each test also asserts that the host's
 * `scrollTop` really MOVED by about the height of what was inserted or navigated through — without
 * that, a heading that merely never moved (content inserted off-screen, or a restore that did nothing
 * to a view that was never left) would pass for the wrong reason.
 *
 * ══ O7 ══
 *
 * SC-002's latency is recorded, never asserted (plan, *Deliberately not E2E*): a wall-clock bound on a
 * shared runner is a flake by construction. The first test annotates the time from the last keystroke
 * to the preview showing it.
 *
 * ══ TIER ══
 *
 * The second and third tests open the Files & Folders context menu (Open In → Preview) and every test
 * presses keys into a focused app, so the file is in `parallel-plan.json`'s serial tier as FOCUS.
 *
 * The third test (044 T183) is not about what stays in view: it is a real mouse drag selecting text,
 * `@reserve:input`, kept here to share this file's app and preview helpers. Its own comment says why.
 *
 * The fourth (044 T237) is two-way scroll sync (FR-121) and its toggle (FR-122), in a real layout. Its
 * own comment says why it is here.
 */
import { cpSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { openApp, runApp, createProject as newProject, firstPanelId, focusEditor, cleanupTemp, settle, type OpenApp } from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';
import { openGotoLine } from './helpers/navigation.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** The ids of every preview panel on screen. */
async function previewIds(win: Page): Promise<string[]> {
  return win
    .locator('[data-testid^="preview-body-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('preview-body-', '')));
}

/** Wait for a preview panel that was not there before, and return its id. */
async function newPreviewId(win: Page, before: readonly string[]): Promise<string> {
  let added: string | undefined;
  await expect
    .poll(async () => {
      added = (await previewIds(win)).find((id) => !before.includes(id));
      return added !== undefined;
    })
    .toBe(true);
  return added as string;
}

/**
 * Where a heading sits in the preview: its top relative to the scroll host's top, and the host's
 * `scrollTop` — read until two consecutive reads agree.
 */
async function headingPlace(win: Page, previewId: string, heading: string): Promise<{ top: number; scrollTop: number }> {
  const read = (): Promise<{ top: number; scrollTop: number } | null> =>
    win.evaluate(
      ({ id, text }) => {
        const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${id}"]`);
        if (host === null) return null;
        const h = [...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) => el.textContent?.trim() === text);
        if (h === undefined) return null;
        return { top: h.getBoundingClientRect().top - host.getBoundingClientRect().top, scrollTop: host.scrollTop };
      },
      { id: previewId, text: heading },
    );
  let previous: { top: number; scrollTop: number } | null = null;
  let settled: { top: number; scrollTop: number } | null = null;
  await expect
    .poll(
      async () => {
        const current = await read();
        const still =
          current !== null &&
          previous !== null &&
          Math.abs(current.top - previous.top) < 0.5 &&
          current.scrollTop === previous.scrollTop;
        previous = current;
        if (still) settled = current;
        return still;
      },
      { timeout: 10_000, intervals: [50, 100, 100, 200] },
    )
    .toBe(true);
  return settled as unknown as { top: number; scrollTop: number };
}

/** Scroll the preview so `heading` sits `offset` pixels below the host's top edge. */
async function scrollHeadingTo(win: Page, previewId: string, heading: string, offset: number): Promise<void> {
  await win.evaluate(
    ({ id, text, px }) => {
      const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${id}"]`)!;
      const h = [...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) => el.textContent?.trim() === text)!;
      host.scrollTop += h.getBoundingClientRect().top - host.getBoundingClientRect().top - px;
    },
    { id: previewId, text: heading, px: offset },
  );
}

/** Turn the first panel into an editor and return its id. */
async function editorPanel(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const PLACE_TOLERANCE_PX = 2;

/*
 * WHY THIS ONE TEST HAS ITS OWN APP, WITH SCROLL SYNC OFF (iteration 2026-09-15)
 *
 * FR-113 ships scroll sync ON: a parented preview follows its editor's top line. This test's update is
 * typed into the editor at the TOP of a 1000-line file, which scrolls the EDITOR — so sync then moves the
 * preview to the editor's new top line, and Section 10 is nowhere near where the reader left it. The
 * product is right and the test no longer isolates FR-024: what it measures is sync, which
 * `preview-scroll-sync.test.ts` already owns.
 *
 * No edit that inserts enough text above the reader to prove the anchor compensated can also leave the
 * editor's viewport untouched — the caret moves with the insertion, and the editor follows the caret — so
 * the setting is turned off instead, seeded in this test's own config root BEFORE its app starts. Written
 * rather than hot-reloaded deliberately: a hot reload would race the first keystroke, and a race that
 * fails only sometimes is exactly what a reserve-tagged layout test must not carry.
 */
test('a live update of a parented preview keeps the heading the reader was looking at in place (FR-024)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-scroll-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-preview-scroll-cfg-'));
  writeSettingsAtomic(cfgRoot, { editor: { previews: { syncScroll: false } } });
  cpSync(join(FIXTURES, 'long-1000.md'), join(root, 'long-1000.md'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'PreviewScroll', root);
      const editorId = await editorPanel(win);
      await win.getByTestId('file-explorer-tree').getByText('long-1000.md', { exact: true }).click();
      await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText('Section 1', { timeout: 8000 });

      const before = await previewIds(win);
      await win.getByTestId(`editor-preview-${editorId}`).click();
      const previewId = await newPreviewId(win, before);
      const preview = win.getByTestId(`preview-markdown-${previewId}`);
      await expect(preview.getByRole('heading', { name: 'Section 20', exact: true })).toBeAttached();

      // Halfway: Section 10 of 20, 120px below the top of the preview.
      await scrollHeadingTo(win, previewId, 'Section 10', 120);
      const placed = await headingPlace(win, previewId, 'Section 10');
      expect(placed.scrollTop, 'the preview must really be scrolled, or there is no place to keep').toBeGreaterThan(0);
      expect(Math.abs(placed.top - 120)).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);

      // Type at the TOP of the editor: a block tall enough that an update which merely kept `scrollTop`
      // would push Section 10 a long way down.
      await focusEditor(win, editorId);
      await win.keyboard.press('Control+Home');
      const inserted = ['# Inserted above', '', ...Array.from({ length: 40 }, (_, i) => `Inserted line ${i + 1}.`), '', ''].join('\n');
      await win.keyboard.insertText(inserted);
      await win.keyboard.type('Typed at the top', { delay: 20 });
      const lastKey = Date.now();
      await expect(preview).toContainText('Typed at the top', { timeout: 10_000 });
      const o7 = `last keystroke to the preview showing it: ${Date.now() - lastKey} ms (long-1000.md, parented)`;
      test.info().annotations.push({ type: 'O7 (recorded, not asserted)', description: o7 });
      // Printed as well: the list reporter a developer runs locally does not show annotations.
      console.log(`[O7] ${o7}`);

      const after = await headingPlace(win, previewId, 'Section 10');
      expect(
        Math.abs(after.top - placed.top),
        `Section 10 moved from ${placed.top}px to ${after.top}px below the top of the preview`,
      ).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);
      // The anchor did the work: the host scrolled down by the inserted block's height. A body that kept
      // `scrollTop` would read the same number here — and fail the assertion above.
      expect(after.scrollTop - placed.scrollTop, 'the inserted block must have been compensated for').toBeGreaterThan(200);
    }, { env: { THRONG_CONFIG_ROOT: cfgRoot } });
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});

test('Back twice then Forward once returns a preview to the place the reader left it (FR-107, US7 scenario 3)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-history-'));
  cpSync(join(FIXTURES, 'links'), root, { recursive: true });
  try {
    await createProject(win, 'PreviewHistory', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('README.md', { exact: true })).toBeVisible();

    // A standalone preview of README, from Files & Folders.
    const before = await previewIds(win);
    await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
    await win.getByTestId('menu-item-Open In').click();
    await win.getByTestId('menu-item-Preview').click();
    const previewId = await newPreviewId(win, before);
    const preview = win.getByTestId(`preview-markdown-${previewId}`);
    await expect(preview).toContainText('Links fixture');

    // README → setup.
    await preview.getByText('Setup', { exact: true }).click({ modifiers: ['Control'] });
    await expect(preview).toContainText('Setup fixture');

    // Halfway down setup, then on to install from the link that sits there.
    await scrollHeadingTo(win, previewId, 'Halfway', 100);
    const left = await headingPlace(win, previewId, 'Halfway');
    expect(left.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(left.top - 100)).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);
    await preview.getByText('Install section', { exact: true }).click({ modifiers: ['Control'] });
    await expect(preview).toContainText('Install instructions for the fixture project.');
    await expect(preview).not.toContainText('Setup fixture');

    // The keyboard lands in the preview: a plain click on text does nothing but focus it.
    await preview.getByText('Install instructions for the fixture project.').click();

    // Alt+Left: install → setup, at the place it was left.
    await win.keyboard.press('Alt+ArrowLeft');
    await expect(preview).toContainText('Setup fixture');
    const back = await headingPlace(win, previewId, 'Halfway');
    expect(Math.abs(back.top - left.top), `Back put Halfway at ${back.top}px, left at ${left.top}px`).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);

    // Alt+Left: setup → README, from its top.
    await win.keyboard.press('Alt+ArrowLeft');
    await expect(preview).toContainText('Links fixture');
    await expect(preview).not.toContainText('Setup fixture');

    // Alt+Right: README → setup, at the same place again.
    await win.keyboard.press('Alt+ArrowRight');
    await expect(preview).toContainText('Setup fixture');
    const forward = await headingPlace(win, previewId, 'Halfway');
    expect(
      Math.abs(forward.top - left.top),
      `Forward put Halfway at ${forward.top}px, left at ${left.top}px`,
    ).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);
    // Not merely "somewhere near the top by coincidence": the host is scrolled as far as it was left.
    expect(Math.abs(forward.scrollTop - left.scrollTop)).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);

    /*
     * US2's covered-not-hidden body, in real Chromium: the file vanishes, the notice covers the body,
     * the file comes back — and the reader is where they were. `display: none` would have reset the
     * offset; `visibility: hidden` + `inert` must not.
     */
    renameSync(join(root, 'docs', 'setup.md'), join(root, 'docs', 'setup.md.away'));
    await expect(win.getByTestId(`panel-failure-${previewId}`)).toBeVisible({ timeout: 15_000 });
    renameSync(join(root, 'docs', 'setup.md.away'), join(root, 'docs', 'setup.md'));
    await expect(win.getByTestId(`panel-failure-${previewId}`)).toHaveCount(0, { timeout: 15_000 });
    await expect(preview).toContainText('Setup fixture');
    const returned = await headingPlace(win, previewId, 'Halfway');
    expect(
      Math.abs(returned.top - left.top),
      `after the notice came and went, Halfway sat at ${returned.top}px; it was left at ${left.top}px`,
    ).toBeLessThanOrEqual(PLACE_TOLERANCE_PX);
  } finally {
    cleanupTemp(root);
  }
});

/** The page's selection, as text. */
const selectionText = (win: Page): Promise<string> => win.evaluate(() => window.getSelection()?.toString() ?? '');

/*
 * 044 T183 (iteration 2026-09-15, Request 2) — text in a preview could not be selected with the mouse.
 *
 * ══ WHY THIS IS AN E2E (`@reserve:input`) ══
 *
 * Whether a pointer drag starts a selection is decided by the engine's input handling against the
 * cascaded `user-select`. jsdom applies no stylesheet, and the Range API (`addRange`, which every
 * component copy test selects with) ignores `user-select` entirely — so no substitute can hold "a drag
 * selects". `unit/preview-text-selection-css.test.ts` pins the cause; only a real drag shows the effect.
 *
 * The Ctrl+drag stays INSIDE the link on purpose: Chromium fires `click` on the nearest common ancestor
 * of mousedown and mouseup, so a drag that ends inside the link is exactly the gesture that reaches the
 * body's follow handler. Following is then refused only because the drag left a selection (FR-094).
 * Starting ON the link is the other half: Chromium starts no selection from a press on a focusable
 * element, and every followable link is `tabindex=0` (FR-096b). Measured while writing this: with the
 * CSS re-enable alone, step (1) passed and this step selected nothing and followed the link.
 * The closing Ctrl+click is the control: the link IS followable by that gesture here, so "nothing was
 * followed" above was not true merely because links never follow.
 */
test('a mouse drag selects preview text across paragraphs, and a Ctrl+drag on a link selects instead of following it (FR-035, FR-094)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-select-'));
  cpSync(join(FIXTURES, 'text-selection'), root, { recursive: true });
  try {
    await createProject(win, 'PreviewSelect', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('selection.md', { exact: true })).toBeVisible();

    const before = await previewIds(win);
    await tree.getByText('selection.md', { exact: true }).click({ button: 'right' });
    await win.getByTestId('menu-item-Open In').click();
    await win.getByTestId('menu-item-Preview').click();
    const previewId = await newPreviewId(win, before);
    const preview = win.getByTestId(`preview-markdown-${previewId}`);
    await expect(preview).toContainText('Charlie paragraph');

    // (1) A plain drag from the start of Alpha into Bravo.
    const alpha = await preview.locator('p', { hasText: 'Alpha paragraph' }).boundingBox();
    const bravo = await preview.locator('p', { hasText: 'Bravo paragraph' }).boundingBox();
    expect(alpha, 'the Alpha paragraph is laid out').not.toBeNull();
    expect(bravo, 'the Bravo paragraph is laid out').not.toBeNull();
    await win.mouse.move(alpha!.x + 2, alpha!.y + 8);
    await win.mouse.down();
    await win.mouse.move(bravo!.x + 80, bravo!.y + 8, { steps: 12 });
    await win.mouse.up();
    const dragged = await selectionText(win);
    expect(dragged, 'a drag across two paragraphs selected nothing').not.toBe('');
    expect(dragged).toContain('opens the selection fixture');
    expect(dragged).toContain('Bravo');

    // (2) Ctrl held, a drag that starts and ends on the link.
    const link = preview.getByText('the target link', { exact: true });
    const box = await link.boundingBox();
    expect(box, 'the link is laid out').not.toBeNull();
    await win.mouse.move(box!.x + 2, box!.y + box!.height / 2);
    await win.keyboard.down('Control');
    try {
      await win.mouse.down();
      await win.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, { steps: 8 });
      await win.mouse.up();
    } finally {
      await win.keyboard.up('Control');
    }
    const onLink = await selectionText(win);
    expect(onLink,'a Ctrl+drag on a link selected nothing').not.toBe('');
    expect('the target link').toContain(onLink.trim());
    await expect(preview).toContainText('Charlie paragraph');
    await expect(preview).not.toContainText('Reaching this document');
    await expect(win.getByTestId(`preview-link-notice-${previewId}`)).toHaveCount(0);

    // Control: once the selection is gone, the same link DOES follow on Ctrl+click.
    await preview.getByText('Alpha paragraph', { exact: false }).click();
    await expect.poll(() => selectionText(win)).toBe('');
    await link.click({ modifiers: ['Control'] });
    await expect(preview).toContainText('Reaching this document means a link was followed.');
  } finally {
    cleanupTemp(root);
  }
});

/** What two-way sync is measured by: both panels' top lines and both scrollers' offsets. */
interface SyncState {
  /** The editor's top line (0-based): the gutter row under the scroller's top edge, where the relay reads it. */
  editorTop: number;
  /** The preview's top block's `data-source-line`, chosen as `topBlockLine` chooses it — {@link previewSeen}. */
  previewTop: number;
  /** The block the editor's top line falls in (`blockLineFor`, else the first block). */
  editorBlock: number;
  /**
   * The block the READER sees at the preview's top: the first whose bottom is below the top edge, where a block
   * showing less than a pixel does not count and one starting less than a pixel below the edge does. Measured
   * independently of the product, and the rule `topBlockLine` follows.
   */
  previewSeen: number;
  /** How far {@link previewSeen}'s top is below the top edge, in px (negative: it straddles the edge). */
  previewSeenTop: number;
  /** The preview is scrolled as far down as it goes, so no later block can reach its top. */
  previewAtBottom: boolean;
  editorScrollTop: number;
  previewScrollTop: number;
}

/** One read of {@link SyncState}, in page. */
function readSync(win: Page, editorId: string, previewId: string): Promise<SyncState> {
  return win.evaluate(
    ({ eid, pid }) => {
      const editor = document.querySelector<HTMLElement>(`[data-testid="editor-${eid}"]`)!;
      const scroller = editor.querySelector<HTMLElement>('.cm-scroller')!;
      const y = scroller.getBoundingClientRect().top + 1;
      // The NEAREST row at or below that point, as `posAtCoords(…, false)` answers: at the very top the point
      // falls in the content's padding, where no row is drawn at all.
      let row: HTMLElement | undefined;
      let rowTop = Infinity;
      for (const el of editor.querySelectorAll<HTMLElement>('.cm-gutters .cm-lineNumbers .cm-gutterElement')) {
        if (getComputedStyle(el).visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > y && r.top < rowTop) {
          row = el;
          rowTop = r.top;
        }
      }
      const editorTop = row === undefined ? -1 : Number((row.textContent ?? '').trim()) - 1;
      const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${pid}"]`)!;
      const hostTop = host.getBoundingClientRect().top;
      const blocks = [...host.querySelectorAll<HTMLElement>('[data-source-line]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { line: Number(el.getAttribute('data-source-line')), top: r.top - hostTop, height: r.height };
      });
      // What the reader sees: the deepest block straddling the edge (within a pixel), else the nearest one below
      // it, else — scrolled past every block — the last that started above.
      let seen: (typeof blocks)[number] | undefined;
      for (const b of blocks) if (b.top <= 1 && b.top + b.height > 1) seen = b;
      if (seen === undefined) for (const b of blocks) if (b.top > 1 && (seen === undefined || b.top <= seen.top)) seen = b;
      if (seen === undefined) for (const b of blocks) if (b.top <= 0) seen = b;
      const previewTop = (seen ?? blocks[0])?.line ?? -1;
      let editorBlock = blocks[0]?.line ?? -1;
      for (const b of blocks) if (b.line <= editorTop && b.line > editorBlock) editorBlock = b.line;

      return {
        editorTop,
        previewTop,
        editorBlock,
        previewSeen: seen?.line ?? -1,
        previewSeenTop: seen === undefined ? 0 : Math.round(seen.top * 10) / 10,
        previewAtBottom: host.scrollTop + host.clientHeight >= host.scrollHeight - 1,
        editorScrollTop: scroller.scrollTop,
        previewScrollTop: host.scrollTop,
      };
    },
    { eid: editorId, pid: previewId },
  );
}

/** {@link readSync}, once two consecutive reads agree — both panels have stopped moving. */
async function settledSync(win: Page, editorId: string, previewId: string): Promise<SyncState> {
  let previous: SyncState | null = null;
  let settled: SyncState | null = null;
  await expect
    .poll(
      async () => {
        const current = await readSync(win, editorId, previewId);
        const still = previous !== null && JSON.stringify(previous) === JSON.stringify(current);
        previous = current;
        if (still) settled = current;
        return still;
      },
      { timeout: 10_000, intervals: [100, 150, 200, 250] },
    )
    .toBe(true);
  return settled as unknown as SyncState;
}

/** Both scrollers' `scrollTop` on each of `frames` consecutive animation frames. */
function scrollTopsPerFrame(win: Page, editorId: string, previewId: string, frames: number): Promise<string[]> {
  return win.evaluate(
    ({ eid, pid, n }) =>
      new Promise<string[]>((resolve) => {
        const scroller = document.querySelector<HTMLElement>(`[data-testid="editor-${eid}"] .cm-scroller`)!;
        const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${pid}"]`)!;
        const seen: string[] = [];
        const tick = (): void => {
          seen.push(`editor ${scroller.scrollTop} / preview ${host.scrollTop}`);
          if (seen.length >= n) resolve(seen);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { eid: editorId, pid: previewId, n: frames },
  );
}

/** FR-121g — nothing oscillates: five consecutive frames read the same two offsets. */
async function expectNoOscillation(win: Page, editorId: string, previewId: string, after: string): Promise<void> {
  const frames = await scrollTopsPerFrame(win, editorId, previewId, 5);
  expect(new Set(frames).size, `after ${after}, the scrollers moved across five frames: ${frames.join(' | ')}`).toBe(1);
}

/** A heading's box relative to the preview's scroll host, read until two consecutive reads agree. */
async function headingBox(win: Page, previewId: string, heading: string): Promise<{ top: number; height: number }> {
  const read = (): Promise<{ top: number; height: number } | null> =>
    win.evaluate(
      ({ id, text }) => {
        const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${id}"]`);
        const h = host === null ? undefined : [...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) => el.textContent?.trim() === text);
        if (host === null || h === undefined) return null;
        const r = h.getBoundingClientRect();
        return { top: r.top - host.getBoundingClientRect().top, height: r.height };
      },
      { id: previewId, text: heading },
    );
  let previous: { top: number; height: number } | null = null;
  let settled: { top: number; height: number } | null = null;
  await expect
    .poll(
      async () => {
        const current = await read();
        const still = current !== null && previous !== null && Math.abs(current.top - previous.top) < 0.5;
        previous = current;
        if (still) settled = current;
        return still;
      },
      { timeout: 10_000, intervals: [100, 150, 200, 250] },
    )
    .toBe(true);
  return settled as unknown as { top: number; height: number };
}

/**
 * Turn the mouse wheel over the preview until `heading` straddles its top edge — the reader's gesture, not a
 * `scrollTop` write. Corrective steps, because how many pixels a wheel delta scrolls is the engine's business.
 */
async function wheelHeadingToTop(win: Page, previewId: string, heading: string): Promise<void> {
  const box = await win.getByTestId(`preview-body-${previewId}`).boundingBox();
  expect(box, 'the preview is laid out').not.toBeNull();
  await win.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let step = 0; step < 12; step += 1) {
    const h = await headingBox(win, previewId, heading);
    if (h.top <= 0 && h.top + h.height > 0) return;
    await win.mouse.wheel(0, Math.round(h.top + h.height / 2));
  }
  const h = await headingBox(win, previewId, heading);
  throw new Error(`the wheel never brought ${heading} to the preview's top: it sits at ${h.top}px (height ${h.height}px)`);
}

/**
 * Turn the mouse wheel over the preview until `heading`'s top sits 2–8px BELOW the preview's top edge, in the
 * margin above it, with the block before it wholly scrolled away. A wheel gesture, as {@link wheelHeadingToTop}.
 */
async function wheelHeadingJustBelowTop(win: Page, previewId: string, heading: string): Promise<void> {
  const box = await win.getByTestId(`preview-body-${previewId}`).boundingBox();
  expect(box, 'the preview is laid out').not.toBeNull();
  await win.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let step = 0; step < 12; step += 1) {
    const h = await headingBox(win, previewId, heading);
    if (h.top >= 2 && h.top <= 8) {
      const above = await win.evaluate(
        ({ id, text }) => {
          const host = document.querySelector<HTMLElement>(`[data-testid="preview-body-${id}"]`)!;
          const blocks = [...host.querySelectorAll<HTMLElement>('[data-source-line]')];
          const at = blocks.findIndex((el) => el.textContent?.trim() === text);
          return blocks[at - 1]!.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
        },
        { id: previewId, text: heading },
      );
      expect(above, `the block before ${heading} must be wholly above the preview's top edge`).toBeLessThanOrEqual(0);
      return;
    }
    await win.mouse.wheel(0, Math.round(h.top - 5));
  }
  const h = await headingBox(win, previewId, heading);
  throw new Error(`the wheel never brought ${heading} just below the preview's top: it sits at ${h.top}px`);
}

/** Put the keyboard in the editor with a click on a line already on screen, so nothing scrolls. */
async function clickVisibleEditorLine(win: Page, editorId: string): Promise<void> {
  const editor = win.getByTestId(`editor-${editorId}`);
  const box = await editor.locator('.cm-scroller').boundingBox();
  expect(box, 'the editor is laid out').not.toBeNull();
  await win.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

/** Let `n` animation frames pass — long enough for a report, a request and the editor's measure pass. */
const frames = (win: Page, n: number): Promise<void> =>
  win.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );

/*
 * 044 T237 (iteration 2026-09-16, FR-121, FR-122; analyze I1) — two-way scroll sync, and its toggle.
 *
 * ══ WHY THIS IS AN E2E (`@reserve:layout`) ══
 *
 * Every decision is pinned below: the policy in `unit/scroll-sync-policy.test.ts`, the relay's echo mark in
 * `unit/editor-scroll-relay.test.ts`, the body's reports in `component/preview-scroll-sync.test.ts`. What they
 * cannot hold is whether those marks agree with the real engines. jsdom lays nothing out and fires no `scroll`
 * event for a `scrollTop` write, so where a wheel leaves the preview's top block, where CodeMirror's
 * `scrollIntoView` puts a line, and whether Chromium's and CodeMirror's real event order lets the two sides
 * settle instead of chasing each other, exist only here.
 *
 * ══ WHAT IS MEASURED ══
 *
 * The editor's top line is the gutter row under the scroller's top edge — where the relay's `posAtCoords`
 * reads it — and the preview's top block is chosen exactly as `topBlockLine` chooses it. After each step both
 * are read until they stop moving, and then five consecutive animation frames must show the same two offsets.
 * The toggle's negative half waits thirty frames — a report, a request and CodeMirror's measure pass each
 * take one — and is only meaningful because the same gestures moved the other side while sync was on.
 *
 * The toggle is the editor's status-bar button off and the preview's back on, so both buttons are seen to
 * flip the one setting; the four menu items are component-tested. The shared app ends with sync on again.
 */
test('scrolling either side of a parented preview moves the other, a caret move moves the preview, and Synchronise Scrolling off stops both (FR-121, FR-122)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-sync-'));
  cpSync(join(FIXTURES, 'sync-two-way.md'), join(root, 'sync-two-way.md'));
  try {
    await settle(win);
    await createProject(win, 'PreviewSync', root);
    const editorId = await editorPanel(win);
    await win.getByTestId('file-explorer-tree').getByText('sync-two-way.md', { exact: true }).click();
    const editor = win.getByTestId(`editor-${editorId}`);
    await expect(editor.locator('.cm-content')).toContainText('Two-way scroll sync', { timeout: 8000 });

    // Sync at its shipped value, on — seen on the button rather than assumed.
    const editorToggle = win.getByTestId(`editor-sync-scroll-${editorId}`);
    await expect(editorToggle).toHaveAttribute('aria-pressed', 'true');

    const before = await previewIds(win);
    await win.getByTestId(`editor-preview-${editorId}`).click();
    const previewId = await newPreviewId(win, before);
    const preview = win.getByTestId(`preview-markdown-${previewId}`);
    await expect(preview.getByRole('heading', { name: 'Echo', exact: true })).toBeAttached();
    const previewToggle = win.getByTestId(`preview-sync-scroll-${previewId}`);
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true');

    const opened = await settledSync(win, editorId, previewId);
    expect(opened.editorTop, 'the editor opens at its top').toBe(0);
    // The caret's Ln/Col, by their accessible names — which survive a width-driven change of label form, and
    // leave out the document metrics that arrive later on their own.
    const caretReadout = async (): Promise<string> =>
      `${await win.getByTestId(`editor-status-line-${editorId}`).getAttribute('aria-label')}, ${await win
        .getByTestId(`editor-status-column-${editorId}`)
        .getAttribute('aria-label')}`;
    const caretBefore = await caretReadout();
    expect(caretBefore).toBe('line 1, column 1');

    // (1) The reader wheels the PREVIEW to Bravo: the editor's top line becomes Bravo's source line, and the
    //     caret stays where it was (FR-121b).
    await wheelHeadingToTop(win, previewId, 'Bravo');
    const wheeled = await settledSync(win, editorId, previewId);
    const bravoLine = Number(await preview.getByRole('heading', { name: 'Bravo', exact: true }).getAttribute('data-source-line'));
    expect(wheeled.previewTop, 'the wheel left Bravo at the preview top').toBe(bravoLine);
    // Measured red before T246: 65, with Bravo's row 4.2px below the edge — CodeMirror's default scroll margin.
    expect(wheeled.editorTop, `the editor's top line after the preview was wheeled to Bravo (line ${bravoLine})`).toBe(bravoLine);
    expect(await caretReadout(), 'driving the editor moved its caret').toBe(caretBefore);
    await expectNoOscillation(win, editorId, previewId, 'the wheel');

    // (1b) Off by one (hands-on report 2026-09-16). The reader stops with Bravo a few pixels BELOW the preview's
    //      top edge, in the margin above it, and the paragraph before it wholly scrolled away. Bravo is still the
    //      block at the top, so the editor's top line stays Bravo's.
    await wheelHeadingJustBelowTop(win, previewId, 'Bravo');
    const inMargin = await settledSync(win, editorId, previewId);
    expect(inMargin.previewSeen, 'the wheel left Bravo as the block the reader sees at the top').toBe(bravoLine);
    expect(
      inMargin.editorTop,
      `the editor's top line with Bravo ${inMargin.previewSeenTop}px below the preview's top edge (Bravo is line ${bravoLine})`,
    ).toBe(bravoLine);
    await expectNoOscillation(win, editorId, previewId, 'the wheel into the margin');

    // (1c) The other way (same report). Wheel the EDITOR a line at a time until the preview, following, leaves its
    //      top block a fraction of a pixel below its edge — where the engine's rounding of `scrollTop` puts it.
    //      That block is the editor's, and a live update that changes nothing above it moves nothing.
    const editorBox = await editor.locator('.cm-scroller').boundingBox();
    expect(editorBox, 'the editor is laid out').not.toBeNull();
    await win.mouse.move(editorBox!.x + editorBox!.width / 2, editorBox!.y + editorBox!.height / 2);
    let subPixel: SyncState | null = null;
    const landings: string[] = [];
    for (let step = 0; step < 24 && subPixel === null; step += 1) {
      await win.mouse.wheel(0, 23);
      const s = await settledSync(win, editorId, previewId);
      landings.push(`${s.previewSeen}@${s.previewSeenTop}`);
      if (s.previewSeenTop > 0 && s.previewSeenTop < 1) subPixel = s;
    }
    expect(subPixel, `no follow left the preview's block a fraction of a pixel below its edge: ${landings.join(', ')}`).not.toBeNull();
    const landed = subPixel!;
    expect(landed.previewSeen, `the preview followed the editor's block (editor top line ${landed.editorTop})`).toBe(landed.editorBlock);
    await clickVisibleEditorLine(win, editorId);
    for (const key of ['Q', 'Backspace']) {
      await win.keyboard.press(key);
      if (key === 'Q') await expect(preview).toContainText('Q', { timeout: 5000 });
      else await expect(preview).not.toContainText('Q', { timeout: 5000 });
      await frames(win, 30);
      const typed = await settledSync(win, editorId, previewId);
      expect(
        typed.previewScrollTop,
        `after typing ${key} mid-screen, the preview moved (its top block ${landed.previewSeen} was ${landed.previewSeenTop}px below the edge)`,
      ).toBe(landed.previewScrollTop);
      expect(typed.editorTop, `after typing ${key} mid-screen, the editor's top line moved`).toBe(landed.editorTop);
    }

    // (2) A caret move in the EDITOR — Go to Line, far below, into the tall code block — moves the preview's
    //     top block to the block the editor's top line is in (FR-121, analyze I1).
    await clickVisibleEditorLine(win, editorId);
    await openGotoLine(win);
    await win.keyboard.type('300');
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('gotoline')).toHaveCount(0);
    const jumped = await settledSync(win, editorId, previewId);
    const codeLine = Number(await preview.locator('pre', { hasText: 'code line 001' }).first().getAttribute('data-source-line'));
    expect(jumped.editorTop, 'Go to Line 300 left the editor inside the tall code block').toBeGreaterThan(codeLine);
    expect(jumped.editorBlock).toBe(codeLine);
    expect(jumped.previewTop, `the preview's top block after Go to Line (editor top line ${jumped.editorTop})`).toBe(codeLine);
    await expectNoOscillation(win, editorId, previewId, 'Go to Line');

    // …and Ctrl+End: the preview follows to the block of the editor's new top line, or as near as its own
    //    end allows.
    await win.keyboard.press('Control+End');
    await expect.poll(async () => (await readSync(win, editorId, previewId)).editorTop).toBeGreaterThan(jumped.editorTop);
    const ended = await settledSync(win, editorId, previewId);
    expect(
      ended.previewTop === ended.editorBlock || ended.previewAtBottom,
      `after Ctrl+End the preview's top block is ${ended.previewTop}, the editor's is ${ended.editorBlock}, and the preview is not at its end`,
    ).toBe(true);
    expect(ended.previewScrollTop).toBeGreaterThan(jumped.previewScrollTop);
    await expectNoOscillation(win, editorId, previewId, 'Ctrl+End');

    // …and typing there moves neither side (FR-121c, FR-121g; review round 2, I1). Where the preview stopped at
    //    its own end short of the editor's block, each live update used to send the editor up to the preview's
    //    top block. The character is typed, then removed, and the file saved, so the shared app ends clean.
    // Printed on every run: whether this run reached the state I1 lives in, rather than the in-sync one.
    console.log(
      `[T237 typing at the end] preview at its end: ${ended.previewAtBottom}; preview top block ${ended.previewTop}, editor's ${ended.editorBlock}`,
    );
    // The file ends with a line break: step back onto the last paragraph's line, which is on screen.
    await win.keyboard.press('ArrowLeft');
    for (const key of ['x', 'Backspace']) {
      await win.keyboard.press(key);
      if (key === 'x') await expect(editor.locator('.cm-content')).toContainText('scroll.x', { timeout: 5000 });
      else await expect(editor.locator('.cm-content')).not.toContainText('scroll.x', { timeout: 5000 });
      // Wait for the live update itself — the preview drawing the edit after the update delay — then give the
      // report, the request and CodeMirror's measure pass their frames.
      if (key === 'x') await expect(preview).toContainText('scroll.x', { timeout: 5000 });
      else await expect(preview).not.toContainText('scroll.x', { timeout: 5000 });
      await frames(win, 30);
      const typed = await settledSync(win, editorId, previewId);
      expect(typed.editorTop, `after typing ${key} at the end, the editor's top line moved`).toBe(ended.editorTop);
      expect(typed.previewScrollTop, `after typing ${key} at the end, the preview moved`).toBe(ended.previewScrollTop);
    }

    // …and writing new LINES there never sends the editor up (hands-on report 2026-09-17: typing below the last
    //    heading of a long file, with the preview at its own end, scrolled the editor up to that heading). Each
    //    line grows the document, so the editor may scroll down to keep its caret in view; it must never go up.
    let floor = ended.editorTop;
    for (let n = 1; n <= 3; n += 1) {
      const words = `typed line ${n}`;
      await win.keyboard.press('Enter');
      await win.keyboard.type(words);
      await expect(preview).toContainText(words, { timeout: 5000 });
      await frames(win, 30);
      const wrote = await settledSync(win, editorId, previewId);
      expect(
        wrote.editorTop,
        `after writing line ${n} at the end, the editor's top line went up from ${floor} (preview at its end: ${wrote.previewAtBottom}, preview top block ${wrote.previewTop})`,
      ).toBeGreaterThanOrEqual(floor);
      floor = wrote.editorTop;
    }
    for (let n = 3; n >= 1; n -= 1) {
      for (let c = 0; c <= `typed line ${n}`.length; c += 1) await win.keyboard.press('Backspace');
    }
    await expect(editor.locator('.cm-content')).not.toContainText('typed line', { timeout: 5000 });
    await win.keyboard.press('Control+s');
    await frames(win, 30);

    // (3) Synchronise Scrolling OFF, from the editor's status bar: both buttons flip.
    await editorToggle.click();
    await expect(editorToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'false');

    // The editor moves; the preview does not.
    await clickVisibleEditorLine(win, editorId);
    await win.keyboard.press('Control+Home');
    await expect.poll(async () => (await readSync(win, editorId, previewId)).editorScrollTop).toBe(0);
    await frames(win, 30);
    const editorMoved = await settledSync(win, editorId, previewId);
    expect(editorMoved.previewScrollTop, 'with sync off, Ctrl+Home in the editor moved the preview').toBe(ended.previewScrollTop);

    // The preview moves; the editor does not.
    await wheelHeadingToTop(win, previewId, 'Charlie');
    await frames(win, 30);
    const previewMoved = await settledSync(win, editorId, previewId);
    expect(previewMoved.previewScrollTop, 'the wheel really moved the preview').not.toBe(ended.previewScrollTop);
    expect(previewMoved.editorScrollTop, 'with sync off, wheeling the preview moved the editor').toBe(0);
    expect(previewMoved.editorTop).toBe(0);

    // (4) Back ON, from the preview's status bar — which also leaves the shared app as it was found.
    await previewToggle.click();
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(editorToggle).toHaveAttribute('aria-pressed', 'true');
  } finally {
    cleanupTemp(root);
  }
});
