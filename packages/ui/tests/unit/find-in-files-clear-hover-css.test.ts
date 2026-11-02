/**
 * MOVED DOWN from `component/find-in-files-clear.test.ts` (pass 2): the clear control's hover rule is read
 * off `find-in-files.css` as text and renders nothing (043 T196).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = resolve(process.cwd(), 'packages/ui/src/renderer/find-in-files/find-in-files.css');

/* ────────────────────────────────────────────────────────────────────────── *
 * The clear inside a field draws no hover box (maintainer, #391 follow-up)
 *
 * The clear sits INSIDE the input, over its right-hand edge. It inherited `.fif-btn`'s hover — a
 * filled background and a border — and with the input focused that box was drawn on top of the
 * input's own focus border. The hover cue for a control inside a field is its glyph's colour alone.
 * ────────────────────────────────────────────────────────────────────────── */

describe('the clear inside a field draws no hover box', () => {
  const hoverBody = (): string => {
    const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) =>
      /\.fif-btn--clear:hover/.test(selector),
    );
    expect(rule, 'no hover rule for .fif-btn--clear, so it inherits .fif-btn:hover').toBeDefined();
    return (rule as RegExpMatchArray)[2];
  };

  it('keeps its background and its border transparent on hover', () => {
    const body = hoverBody();
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/border-color:\s*transparent/);
  });

  it('out-ranks the generic hover, so it is the rule that applies', () => {
    // `.fif-btn:hover:not(:disabled)` is behind the same `:where(...)` window-focus gate. The clear's
    // rule must match that shape (same specificity) and come later, or the generic box still wins.
    const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const generic = css.indexOf('.fif-btn:hover:not(:disabled)');
    const clear = css.indexOf('.fif-btn--clear:hover:not(:disabled)');
    expect(clear, 'the clear hover rule must mirror .fif-btn:hover:not(:disabled)').toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(generic);
  });
});
