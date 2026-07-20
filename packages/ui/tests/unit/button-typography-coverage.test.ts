import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 021 / US7 (base-only) — button TYPOGRAPHY must reach EVERY button, enforced from the CSS side.
 *
 * The defect this guards: each button call site hand-wired only `font-family` + `font-weight` from the
 * `button` role, so the role's SIZE, casing (`transform`), italic (`style`) and under/strike
 * (`decoration`) reached no button at all — the theme's button font controls looked dead. The fix
 * declares the full role ONCE on the `button` element; this proves it stays that way, and that an
 * icon-only button's GLYPH is shielded from a casing/underline theme (a glyph is not prose).
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

interface Rule {
  selectors: string[];
  body: string;
}

function rules(): Rule[] {
  const out: Rule[] = [];
  for (const file of cssFilesUnder(rendererRoot)) {
    const css = stripComments(readFileSync(file, 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (m[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '' && !s.startsWith('@') && !s.includes(':root'));
      if (selectors.length > 0) out.push({ selectors, body: m[2] ?? '' });
    }
  }
  return out;
}

/** The declared property names in a rule body. */
function props(body: string): Set<string> {
  const set = new Set<string>();
  for (const m of body.matchAll(/(^|[;{])\s*([a-z-]+)\s*:/g)) set.add(m[2] ?? '');
  return set;
}

describe('button typography coverage (021 / US7)', () => {
  it('a TEXT-button rule consumes ALL six shared button font tokens', () => {
    // family + size + weight + transform (casing) + style (italic) + decoration (under/strike). Wiring
    // only family + weight — the old state — is exactly why size / casing / italic / decoration were dead.
    // The rule is scoped to text-only dialog buttons (`.modal__buttons button` is the canonical one).
    const textRule = rules().find((r) => r.selectors.includes('.modal__buttons button'));
    expect(textRule, 'no text-button rule carries the shared button typography').toBeDefined();
    const body = textRule?.body ?? '';
    const expectVar = (property: string, token: string): void => {
      const re = new RegExp(`${property}\\s*:\\s*var\\(\\s*--throng-font-button-${token}`);
      expect(re.test(body), `text-button rule must set ${property} from --throng-font-button-${token}`).toBe(true);
    };
    expectVar('font-family', 'family');
    expectVar('font-size', 'size');
    expectVar('font-weight', 'weight');
    expectVar('text-transform', 'transform');
    expectVar('font-style', 'style');
    expectVar('text-decoration', 'decoration');
  });

  it('NEVER puts button typography on a broad `button` selector (the leak regression)', () => {
    // A bare `button { … --throng-font-button-* }` reaches EVERY clickable control — tabs, project rows,
    // menu/picker items, icon buttons — and `text-decoration` propagates unstoppably onto their children
    // (icon glyphs, count spans), which is the exact leak this pass fixed. Button typography must live on
    // the specific text-button selectors, never on `button` alone.
    const offenders: string[] = [];
    for (const rule of rules()) {
      const usesButtonFont = /--throng-font-button-/.test(rule.body);
      if (!usesButtonFont) continue;
      for (const sel of rule.selectors) {
        // A selector that is exactly `button` (optionally with a pseudo) — i.e. not scoped by a class.
        if (/^button(\b|:|\[|$)/.test(sel) && !sel.includes('.') && !sel.includes(' ')) {
          offenders.push(sel);
        }
      }
    }
    expect(offenders, `button typography on a broad selector leaks onto non-buttons:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('`.icon` neutralises casing / italic so an inherited text style never mangles a glyph', () => {
    const iconRule = rules().find((r) => r.selectors.includes('.icon'));
    expect(iconRule, 'no `.icon` rule found').toBeDefined();
    const p = props(iconRule?.body ?? '');
    // NB: text-decoration is deliberately NOT reset — it propagates and cannot be cancelled on a child;
    // the fix is to keep decoration off icon-bearing elements entirely (see the leak-regression test).
    for (const property of ['text-transform', 'font-style']) {
      expect(p.has(property), `.icon must reset ${property} (a glyph is not prose)`).toBe(true);
    }
  });

  it('no primary button hard-codes `font-weight` — the Bold toggle owns weight uniformly', () => {
    // A hard `font-weight: 600` on Confirm made the Bold toggle dead for it while it worked elsewhere.
    const offenders: string[] = [];
    for (const rule of rules()) {
      if (!/font-weight\s*:\s*(600|500|bold)\b/.test(rule.body)) continue;
      for (const sel of rule.selectors) {
        if (/(button\[type='submit'\]|__confirm|__btn|folder-picker__browse|find-bar-btn)/.test(sel)) {
          offenders.push(sel);
        }
      }
    }
    expect(
      offenders.sort(),
      `these buttons hard-code font-weight, defeating the button Bold token:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
