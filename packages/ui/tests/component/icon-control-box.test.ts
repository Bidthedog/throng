/**
 * #381 — an icon control's box must hold its glyph at every `sizes.iconPx`.
 *
 * `.icon` sizes itself from `--throng-size-icon`, so the glyph is exactly the token at every value
 * of the Themes editor's `sizes.iconPx`. Three controls froze their box at the token's DEFAULT
 * resolved by hand, so raising the setting grows the glyph inside a box that does not grow with it:
 *
 *   - `.find-bar-btn` clips from 17 (24px box less a 1px border and 3px padding each side = 16);
 *   - `.pane-collapse` overflows onto the pane header from 21 (22px less a 1px border = 20);
 *   - `.terminal-panel__retry` overflows from 23 (22px, no border, no vertical padding).
 *
 * ══ THE ARITHMETIC, NOT THE VOCABULARY ══
 *
 * A rule can name `--throng-size-icon` and still be short a term — `.fif-btn` did exactly that once,
 * forgetting the border `border-box` spends. So the check substitutes each icon size into the rule's
 * own declarations and requires the CONTENT box (declared size less border and padding on both sides)
 * to hold the glyph. `* { box-sizing: border-box }` is global (`theme.css`), so that subtraction is
 * what the browser does.
 *
 * jsdom resolves no `var()` through the cascade, so the sheets are read as text — the same instrument
 * `find-in-files-results.test.ts` uses for `.fif-btn`, which is included here as the control that
 * shows this check passes a box that is right.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ICON_SIZES = [16, 17, 21, 23, 24, 32];

const sheet = (rel: string): string => {
  const path = resolve(process.cwd(), 'packages/ui/src/renderer', rel);
  expect(existsSync(path), `${rel} was not found at ${path}`).toBe(true);
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
};

/** One rule's declaration block, comments already stripped. */
const ruleFor = (rel: string, selector: string): string => {
  const css = sheet(rel);
  const at = css.search(new RegExp(`(^|[\\s}])${selector.replace(/[.]/g, '\\.')}\\s*\\{`));
  expect(at, `${selector} has no rule in ${rel}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

const declared = (block: string, property: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`).exec(block)?.[1].trim() ?? null;

/** Resolve an expression over px terms, `var()`s and `calc()` to a number, at one icon size. */
const evaluate = (expr: string, vars: Map<string, string>, iconPx: number): number => {
  let e = expr.replace(/var\(--throng-size-icon(?:,[^)]*)?\)/g, `${iconPx}px`);
  for (let i = 0; i < 4; i++) for (const [name, value] of vars) e = e.replaceAll(`var(${name})`, value);
  e = e.replace(/calc\(/g, '(').replace(/px/g, '');
  expect(e, `left something unresolved: ${expr}`).toMatch(/^[\d\s.+\-*/()]+$/);
  // Digits, whitespace and arithmetic only reach here, so nothing can name an identifier.
  return Number(new Function(`return ${e};`)());
};

/** The box's content extent on one axis, at one icon size — or null when the axis is not fixed. */
const contentOn = (block: string, axis: 'width' | 'height', iconPx: number): number | null => {
  const vars = new Map(
    [...block.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]),
  );
  const size = declared(block, axis);
  // `min-width` alone yields to its content, so an axis with no fixed size cannot clip or overflow.
  if (size === null) return null;
  const box = evaluate(size, vars, iconPx);

  const borderDecl = declared(block, 'border');
  const border =
    borderDecl === null || /^none\b/.test(borderDecl)
      ? 0
      : evaluate(borderDecl.split(/\s+/)[0], vars, iconPx);

  const paddingDecl = declared(block, 'padding');
  const parts = paddingDecl === null ? ['0'] : paddingDecl.split(/\s+(?![^(]*\))/);
  const padding = evaluate(axis === 'height' ? parts[0] : (parts[1] ?? parts[0]), vars, iconPx);

  return box - border * 2 - padding * 2;
};

const CONTROLS: readonly { rel: string; selector: string }[] = [
  { rel: 'search/find-bar.css', selector: '.find-bar-btn' },
  { rel: 'panes/panes.css', selector: '.pane-collapse' },
  { rel: 'terminal/terminal.css', selector: '.terminal-panel__retry' },
  // The control: already derived correctly by 043, so this row must pass before and after.
  { rel: 'find-in-files/find-in-files.css', selector: '.fif-btn' },
];

describe('an icon control holds its glyph at every sizes.iconPx (#381)', () => {
  for (const { rel, selector } of CONTROLS) {
    it(`${selector} (${rel})`, () => {
      const block = ruleFor(rel, selector);
      const short: string[] = [];
      for (const iconPx of ICON_SIZES) {
        for (const axis of ['width', 'height'] as const) {
          const content = contentOn(block, axis, iconPx);
          if (content !== null && content < iconPx) {
            short.push(`at ${iconPx}px the content ${axis} is ${content}px`);
          }
        }
      }
      expect(short, `${selector} is too small for its glyph`).toEqual([]);
    });
  }
});
