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

  /*
   * 044 FR-032, amended (orchestrator decision, 2026-11-21) — a preview's title is its name and its type suffix
   * (" - CSV Preview"). The title's own ellipsis cut the suffix off with the name; the name now gives way first, and
   * the suffix only once the name is down to its ellipsis.
   */
  it('ellipsises a preview title’s name before its type suffix (044 FR-032)', () => {
    const title = rule('.panel-box__title--split');
    expect(title).toMatch(/display:\s*inline-flex/);
    /*
     * The weighting is in the shrink FACTORS, and the suffix's must be at least 1: once the name stops at its floor,
     * flexbox scales the space still to be found by the unfrozen items' factor sum when it is below 1, so a suffix at
     * 0.001 shrank 0.2 px of the 19 needed and the title box clipped it (walk-through MT-120b, 2026-11-21).
     */
    const name = rule('.panel-box__title-name');
    expect(name).toMatch(/flex:\s*0 1000 auto/);
    // Down to its ellipsis, never to nothing: a title reading " - CSV Preview" alone names nothing. 1em, not 1ch: at
    // 1ch (7 px) the "…" glyph did not fit, so the name was clipped to a bare first letter with no mark (MT-120b).
    expect(name).toMatch(/min-width:\s*1em/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    const suffix = rule('.panel-box__title-suffix');
    expect(suffix).toMatch(/flex:\s*0 1 auto/);
    expect(suffix).toMatch(/min-width:\s*0/);
    expect(suffix).toMatch(/white-space:\s*pre/);
  });

  it('lets the owner text give way, ellipsised, only after the title', () => {
    const owner = rule('.panel-box__project');
    expect(owner).toMatch(/flex:\s*0 0\.001 auto/);
    expect(owner).toMatch(/min-width:\s*0/);
    expect(owner).toMatch(/text-overflow:\s*ellipsis/);
  });
});
