import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 021 / #130 — the scrollbar WIDTH must be able to reach every scrollbar, enforced from the CSS side.
 *
 * Two mutually-exclusive machineries style a scrollbar and Chromium honours only ONE per element: the
 * STANDARD `scrollbar-color`/`scrollbar-width` properties, or the legacy `::-webkit-scrollbar-*`
 * pseudo-elements. The standard `scrollbar-width` accepts only `auto | thin | none` — it cannot take a
 * px measurement — so the theme's px width can ONLY apply through the webkit pseudo-elements. But the
 * moment `scrollbar-color` is set to a real colour on an element, its `::-webkit-scrollbar` rules are
 * IGNORED and it renders a standard overlay bar with no layout width. A single `* { scrollbar-color }`
 * therefore silences the width for the ENTIRE application — which is exactly the #130 defect.
 *
 * So the invariant this guard defends: NO stylesheet sets `scrollbar-color` to anything but `auto`.
 * `auto` is the one safe value — it does NOT flip the element into standard mode — and is used once, on
 * the terminal viewport, as a defensive opt-in to the webkit bar its layout depends on. Any real colour
 * anywhere reintroduces #130 for its subtree; a global one reintroduces it everywhere.
 *
 * This DISCOVERS the offenders rather than checking a hand-picked list, and it guards-the-guard: it
 * proves the theme's `--throng-size-scrollbar` is actually consumed by a `::-webkit-scrollbar` width.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(here, '../../src/renderer');

function cssFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('scrollbar width coverage (021 / #130)', () => {
  it('never sets `scrollbar-color` to a real colour — the app styles scrollbars via the webkit path', () => {
    const offenders: string[] = [];
    for (const file of cssFilesUnder(rendererRoot)) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const m of css.matchAll(/scrollbar-color\s*:\s*([^;}]+)/g)) {
        const value = (m[1] ?? '').trim();
        if (value !== 'auto') {
          const line = css.slice(0, m.index).split('\n').length;
          offenders.push(`${relative(rendererRoot, file).replace(/\\/g, '/')}:${line}  scrollbar-color: ${value}`);
        }
      }
    }
    expect(
      offenders,
      `these rules set a real \`scrollbar-color\`, which flips Chromium to standard overlay bars and ` +
        `makes the theme's \`::-webkit-scrollbar\` WIDTH inert (reintroducing #130) — colour scrollbars ` +
        `via \`::-webkit-scrollbar-thumb\`/\`-track\` instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('guard-the-guard: the theme scrollbar-width token IS consumed by a ::-webkit-scrollbar width', () => {
    const consumed = cssFilesUnder(rendererRoot).some((file) => {
      const css = stripComments(readFileSync(file, 'utf8'));
      return /::-webkit-scrollbar\b[^{}]*\{[^{}]*width\s*:[^;}]*--throng-size-scrollbar/.test(css);
    });
    expect(consumed, 'no ::-webkit-scrollbar rule consumes --throng-size-scrollbar for its width').toBe(true);
  });
});
