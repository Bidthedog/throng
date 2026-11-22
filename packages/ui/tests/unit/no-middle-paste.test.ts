/**
 * 073 FR-008g — the middle mouse button never pastes anywhere in throng. The guard's decisions, with the clock held by
 * the test; where it is installed is pinned below, and what it does to real elements in
 * `tests/component/no-middle-paste.test.ts`.
 *
 * Layer: unit — pure decisions over event-shaped objects, and the entry file read as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIDDLE_PASTE_WINDOW_MS, createMiddlePasteGuard } from '../../src/renderer/common/no-middle-paste.js';

const mouse = (button: number) => {
  const e = { button, prevented: false, preventDefault: () => void (e.prevented = true) };
  return e;
};
const paste = () => {
  const e = { prevented: false, stopped: false, preventDefault: () => void (e.prevented = true), stopImmediatePropagation: () => void (e.stopped = true) };
  return e;
};

describe('the middle-paste guard (073 FR-008g)', () => {
  it('cancels the default of a middle press, release or auxclick, and nothing else', () => {
    const g = createMiddlePasteGuard(() => 0);
    const middle = mouse(1);
    const left = mouse(0);
    const right = mouse(2);
    g.mouse(middle);
    g.mouse(left);
    g.mouse(right);
    expect([middle.prevented, left.prevented, right.prevented]).toEqual([true, false, false]);
  });

  it('drops a paste inside the window after a middle click, before anything inside hears it', () => {
    let t = 1000;
    const g = createMiddlePasteGuard(() => t);
    g.mouse(mouse(1));
    t += MIDDLE_PASTE_WINDOW_MS - 1;
    const p = paste();
    g.paste(p);
    expect([p.prevented, p.stopped]).toEqual([true, true]);
  });

  it('lets a paste through once the window has passed, or with no middle click at all', () => {
    let t = 1000;
    const g = createMiddlePasteGuard(() => t);
    const none = paste();
    g.paste(none);
    g.mouse(mouse(1));
    t += MIDDLE_PASTE_WINDOW_MS;
    const late = paste();
    g.paste(late);
    expect([none.prevented, late.prevented]).toEqual([false, false]);
  });

  it('a key ends the window: the reader\'s own Ctrl+V straight after a middle click pastes', () => {
    const g = createMiddlePasteGuard(() => 0);
    g.mouse(mouse(1));
    g.key();
    const p = paste();
    g.paste(p);
    expect(p.prevented).toBe(false);
  });
});

describe('where the guard is installed', () => {
  const RENDERER = join(__dirname, '../../src/renderer');

  it('every window: the one renderer entry installs it at module scope, before any window kind is chosen', () => {
    const entry = readFileSync(join(RENDERER, 'main.tsx'), 'utf8');
    const install = entry.search(/^installNoMiddlePaste\(window\);$/m);
    expect(install).toBeGreaterThan(-1);
    // Before the first branch on the window's kind, so preferences, print preview, monitor, about and sub-workspace
    // windows all have it.
    expect(install).toBeLessThan(entry.indexOf('function loadWindowApp'));
    expect(readFileSync(join(RENDERER, 'index.html'), 'utf8')).toMatch(/src="\.\/main\.tsx"/);
  });

  it('an HTML Preview\'s page, whose events never reach the window', () => {
    const frame = readFileSync(join(RENDERER, 'preview/providers/html/frame-input.ts'), 'utf8');
    expect(frame).toMatch(/installNoMiddlePaste\(doc\)/);
  });
});
