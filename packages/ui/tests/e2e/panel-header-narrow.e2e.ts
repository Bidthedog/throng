/**
 * 067 FR-069b — a narrow panel keeps its title (the maintainer's ruling, 2026-11-21).
 *
 * At about 150 px the header's controls took the whole width and the title shrank to nothing — 0 px, not an
 * ellipsis. The title keeps a minimum share, ellipsised, at every width down to the split's 60 px floor
 * (`MIN_CELL_PX`); the header controls give way instead, and every one stays on the header's menu (component
 * test: `panel-header-save-icons.test.ts`). jsdom has no layout, so the width the title is actually drawn at
 * can only be read here.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanupTemp, createProject, openApp, panelIds, splitPanelViaMenu, type OpenApp } from './harness.js';

let shared: OpenApp;
let root: string;
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-narrow-'));
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(root);
});

test('a narrow panel keeps its title, ellipsised, down to the narrowest a panel can be (067 FR-069b)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const { win } = shared;
  await createProject(win, 'Narrow', root);
  const first = (await panelIds(win))[0];
  await splitPanelViaMenu(win, first);
  await expect(win.locator('.split--row')).toHaveCount(1);

  const cell = win.getByTestId(`panel-${first}`);
  const title = win.getByTestId(`panel-title-${first}`);
  const divider = win.locator('[data-testid^="split-divider-"]').first();

  /** Drag the divider so the first panel is about `width` px wide (the split clamps it at its floor). */
  const narrowTo = async (width: number): Promise<void> => {
    const panelBox = await cell.boundingBox();
    const box = await divider.boundingBox();
    if (!panelBox || !box) throw new Error('panel or divider has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(panelBox.x + width, box.y + box.height / 2, { steps: 8 });
    await win.mouse.up();
  };
  const reading = (): Promise<{ panel: number; title: number; clipped: boolean; ellipsis: string; parts: string }> =>
    title.evaluate((el) => ({
      panel: Math.round(el.closest('.panel-box')!.getBoundingClientRect().width),
      title: Math.round(el.getBoundingClientRect().width),
      clipped: el.scrollWidth > el.clientWidth,
      ellipsis: getComputedStyle(el).textOverflow,
      // What else the header draws, and how wide: the reading that says where the width went.
      parts: [...(el.parentElement?.querySelectorAll(':scope > *, .panel-box__actions > *') ?? [])]
        .map((c) => `${c.getAttribute('data-testid') ?? c.className}:${Math.round(c.getBoundingClientRect().width)}`)
        .join(' '),
    }));

  for (const target of [150, 0]) {
    await narrowTo(target);
    const r = await reading();
    console.log(`[FR-069b] panel ${r.panel} px: title ${r.title} px, clipped ${r.clipped}; ${r.parts}`);
    // Room for a character and its ellipsis, whatever the theme's panel font.
    expect(r.title, `the title vanished in a ${r.panel} px panel`).toBeGreaterThanOrEqual(14);
    expect(r.ellipsis).toBe('ellipsis');
  }
});
