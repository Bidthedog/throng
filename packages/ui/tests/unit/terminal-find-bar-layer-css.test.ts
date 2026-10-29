import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The terminal's find bar sits above everything xterm draws.
 *
 * xterm stacks its own layers inside its element — link decorations at 6 and 7, the overview ruler
 * at 8, the visible scrollbar at 11 — and the find bar, a sibling of that element, is at 5. With no
 * stacking context of its own the terminal's layers competed with the bar, and a link's underline
 * was drawn over it. Isolating the xterm host keeps every one of them below its siblings, whatever
 * numbers a later xterm picks.
 *
 * Layer: unit — jsdom applies no stylesheet and computes no stacking, so the rule is read from
 * source as `find-bar-highlight-css.test.ts` reads its own.
 */
const TERMINAL_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/terminal/terminal.css', import.meta.url)),
  'utf8',
);

function declarationsOf(css: string, selector: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    const declarations = new Map<string, string>();
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    return declarations;
  }
  throw new Error(`no rule for ${selector}`);
}

describe('the terminal find bar’s layer', () => {
  it('isolates the xterm host, so nothing xterm draws can rise above the find bar', () => {
    expect(declarationsOf(TERMINAL_CSS, '.terminal-panel').get('isolation')).toBe('isolate');
  });
});
