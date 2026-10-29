/**
 * 060 FR-001a / FR-001b — the busy glyph's box rotates about its own centre, and there is no other spinner.
 *
 * The glyph character is not centred in its em box, so rotating the glyph itself wobbles. The box is a
 * square (`--throng-size-icon` both ways, `line-height: 1`, flex-centred) and IT rotates about 50% 50%.
 * jsdom evaluates neither `@keyframes` nor `prefers-reduced-motion`, so the claims are read off the
 * stylesheet text, the way `find-in-files-busy-css.test.ts` did before it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

const css = strip(read('../../src/renderer/common/busy-glyph.css'));

function blockOf(source: string, prelude: string): string {
  const at = source.indexOf(`${prelude} {`);
  expect(at, `no \`${prelude} {\``).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = at + prelude.length + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at + prelude.length + 2, i);
    }
  }
  throw new Error(`unbalanced block for ${prelude}`);
}

describe('the busy glyph box', () => {
  const box = blockOf(css, '.busy-glyph');

  it('is a square of the icon size, centring its glyph', () => {
    expect(box).toMatch(/width:\s*var\(--throng-size-icon\)/);
    expect(box).toMatch(/height:\s*var\(--throng-size-icon\)/);
    expect(box).toMatch(/line-height:\s*1\s*;/);
    expect(box).toMatch(/display:\s*inline-flex/);
    expect(box).toMatch(/align-items:\s*center/);
    expect(box).toMatch(/justify-content:\s*center/);
  });

  it('turns the box about its centre, 1s linear forever, animating transform only', () => {
    expect(box).toMatch(/transform-origin:\s*50%\s+50%/);
    const name = /animation:\s*([\w-]+)\s+1s\s+linear\s+infinite/.exec(box)?.[1];
    expect(name, 'a named 1s linear infinite animation').toBeTruthy();
    const frames = blockOf(css, `@keyframes ${name}`);
    const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(['transform']));
  });

  it('stops under prefers-reduced-motion', () => {
    const reduced = blockOf(css, '@media (prefers-reduced-motion: reduce)');
    expect(reduced).toContain('.busy-glyph');
    expect(reduced).toMatch(/animation:\s*none/);
  });
});

describe('no CSS-drawn spinner remains', () => {
  const sheets = [
    '../../src/renderer/common/loading.css',
    '../../src/renderer/find-in-files/find-in-files.css',
    '../../src/renderer/theme.css',
  ];

  it.each(sheets)('%s has no spinner ring or spin keyframes', (rel) => {
    const text = strip(read(rel));
    expect(text).not.toMatch(/throng-spinner__ring|app-closing__spinner|\.fif-busy|@keyframes\s+(throng-spin|fif-busy-spin)\b/);
  });

  it('uses BusyGlyph at the three sites', () => {
    expect(read('../../src/renderer/common/loading.tsx')).toContain('<BusyGlyph');
    expect(read('../../src/renderer/app-close-prompt.tsx')).toContain('<BusyGlyph');
    expect(read('../../src/renderer/find-in-files/find-in-files-panel.tsx')).toContain('<BusyGlyph');
  });
});
