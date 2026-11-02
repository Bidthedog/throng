/**
 * 050 T116 (FR-039, R24, SC-014) — the paste progress card's stylesheet rules, read as text from
 * `theme.css`. Moved from `component/paste-progress-notice.test.ts`: neither claim renders anything
 * (the card's DOM — bar, counts, the Cancel slot — stays in that file).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = (): string =>
  readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );
const rulesFor = (css: string, needle: string): string =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.includes(needle))
    .map((m) => m[2]!)
    .join('\n');

describe('the progress card’s stylesheet (050 T116, FR-039)', () => {
  it('draws only from theme tokens and stops animating under reduced motion', () => {
    const css = themeCss();
    const block = rulesFor(css, '.paste-progress');
    expect(block, 'no .paste-progress rules in theme.css').not.toBe('');
    expect(block).toContain('var(--throng-colour-accent)');
    expect(block).toContain('var(--throng-colour-border)');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1]!)
      .join('\n');
    expect(reduced).toMatch(/\.paste-progress__bar--indeterminate[^{]*\{[^}]*animation:\s*none/);
  });

  it('pushes the Cancel slot to the far end of the card (margin-left: auto)', () => {
    expect(rulesFor(themeCss(), '.paste-progress__cancel')).toMatch(/margin-left:\s*auto/);
  });
});
