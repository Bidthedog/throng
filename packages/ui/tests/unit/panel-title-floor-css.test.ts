/**
 * 067 FR-069b — a narrow panel keeps its title (the maintainer's ruling, 2026-11-21). The title holds a minimum share
 * of the header, ellipsised, at every panel width; the owner text gives way only once the title is at that floor.
 * The width the title is actually drawn at is `panel-header-narrow.e2e.ts`'s reading; this pins the rules it rests on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/renderer/theme.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The first rule written for exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('a panel title in a narrow header (FR-069b)', () => {
  it('keeps a minimum share of the header, ellipsised', () => {
    const title = rule('.panel-box__title');
    expect(title).toMatch(/min-width:\s*min\(4em,\s*50%\)/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/overflow:\s*hidden/);
  });

  it('lets the owner text give way, ellipsised, only after the title', () => {
    const owner = rule('.panel-box__project');
    expect(owner).toMatch(/flex:\s*0 0\.001 auto/);
    expect(owner).toMatch(/min-width:\s*0/);
    expect(owner).toMatch(/text-overflow:\s*ellipsis/);
  });
});
