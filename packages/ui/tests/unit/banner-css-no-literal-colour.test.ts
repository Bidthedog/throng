/**
 * 030 US4 (T056d) / FR-047 — the shared failure banner's stylesheet declares NO literal colour.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/default-themes.e2e.ts:208` (test-suite audit, pass 1) — the "TOKENISED"
 * leg of "the shared failure banner takes its colours from every shipped theme, and carries none of its own".
 *
 * Layer: unit. The leg read the rendered element's class list and then every `document.styleSheets` rule whose
 * selector mentioned one of those classes — a fact about the CSS SOURCE, which needs no window. The two legs that
 * stay in the E2E are the ones that do: the banner's text is legible against what is really behind it in each of
 * the fifteen shipped themes (computed colours through the cascade), and the effective colours MOVE across them.
 *
 * Same rules, same matching: every rule of every renderer stylesheet whose selector mentions `.panel-failure`
 * (a substring match, as before, so `.panel-failure__text`, `--flash` and the rest are all audited). `var(--…)`,
 * `transparent`, `inherit` and `currentColor` are fine; a hex, `rgb()`/`rgba()` or `hsl()`/`hsla()` literal is not.
 *
 * ANTI-VACUITY: a selector that matched nothing would report an empty offender list and pass — a stylesheet that
 * hard-codes every colour it has would sail through. So the matched-rule count is asserted, the base `.panel-failure`
 * rule must be among them, and the detector is run against a literal it must flag.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RENDERER_SRC = fileURLToPath(new URL('../../src/renderer/', import.meta.url));
const BANNER_CLASS = '.panel-failure';

function stylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...stylesheets(p));
    else if (entry.endsWith('.css')) out.push(p);
  }
  return out;
}

interface Audit {
  matched: string[];
  offenders: string[];
}

/** Every declaration block whose selector mentions `needle`, and those among them that hard-code a colour. */
function audit(css: string, needle: string): Audit {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matched: string[] = [];
  const offenders: string[] = [];
  for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? '').trim();
    const body = (rule[2] ?? '').trim();
    if (!selector.includes(needle)) continue;
    matched.push(selector);
    const stripped = body.replace(/var\([^)]*\)/g, '');
    if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(stripped)) offenders.push(`${selector} { ${body} }`);
  }
  return { matched, offenders };
}

describe('the shared failure banner carries no colour of its own (FR-047)', () => {
  it('the detector flags a literal colour and ignores tokens (control)', () => {
    const result = audit(
      '.panel-failure { color: #c33; } .panel-failure__text { color: var(--throng-colour-errorText); border-color: transparent; }' +
        ' .panel-failure__x { background: rgba(0, 0, 0, 0.5); }',
      BANNER_CLASS,
    );
    expect(result.matched).toHaveLength(3);
    expect(result.offenders.map((o) => o.split(' ')[0])).toEqual(['.panel-failure', '.panel-failure__x']);
  });

  it('no rule mentioning .panel-failure, in any renderer stylesheet, declares a literal colour', () => {
    const found = stylesheets(RENDERER_SRC).map((file) => audit(readFileSync(file, 'utf8'), BANNER_CLASS));
    const matched = found.flatMap((f) => f.matched);
    const offenders = found.flatMap((f) => f.offenders);

    expect(
      matched,
      'no stylesheet rule mentions the banner class — the colour audit would have had nothing to look at',
    ).toContain(BANNER_CLASS);
    expect(matched.length).toBeGreaterThan(5);
    expect(offenders, 'the banner stylesheet hard-codes colours instead of using theme tokens').toEqual([]);
  });
});
