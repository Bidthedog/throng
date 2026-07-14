import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 018 / SC-002 — ZERO icons in the application draw from an inline vector, and no surface paints
 * itself with a hard-coded colour.
 *
 * SC-002 says the criterion must be verified by a guard that DISCOVERS, "not by a hand-written list
 * of files, which is how these four were missed in the first place". That is not rhetoric. Every
 * hand count in this feature was wrong:
 *
 *   - the `--danger` count was "4"; it was 13, across a file nobody had named
 *   - the pane token had TWO alias names; it had three, and the third carried most of the call sites
 *   - the `surfaceActive` audit found three sites; there were ten
 *   - the window-control glyphs were deferred as "not action controls", which would have made THIS
 *     criterion false on the day it shipped
 *
 * So this guard walks the tree.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Blank out comments while PRESERVING LINE COUNT.
 *
 * Collapsing a multi-line comment to a single space shifts every line number after it, so the guard
 * reports a violation at a line that contains something else entirely — and the first person to
 * chase one of those wrong line numbers stops trusting the guard. Keep the newlines.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/**
 * The ONE component allowed to draw its own vector, with the reason stated.
 *
 * The throng brand mark is the application's IDENTITY, not an action control and not a themeable
 * icon. It is deliberately inlined so it can take its colour from the active theme (it is drawn as a
 * frame around a body the colour of the app background — shipped as a fixed asset it would erase its
 * own frame on the Light theme). Putting it in the theme's icon pack would let a theme replace
 * throng's logo, which is not a theming concern.
 */
const BRAND_MARK = 'title-bar/throng-mark.tsx';

describe('SC-002 — no inline vector artwork', () => {
  it('no component draws an inline <svg>, except the brand mark', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER, /\.tsx$/)) {
      const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
      if (rel === BRAND_MARK) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/<svg[\s>]|<path[\s>]/.test(src)) offenders.push(rel);
    }
    expect(
      offenders.sort(),
      `these draw inline vector artwork instead of resolving a theme icon token:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('exactly one shipped SVG icon set — no black/white variants (FR-028)', () => {
    // The obvious remedy for illegible icons on light themes is to ship a black set and a white
    // set. It is the wrong one: the artwork already inherits its colour, so the two sets would be
    // the same art twice, and would STILL be wrong for every theme that suits neither pure black nor
    // pure white. One set with an overridable colour is the answer (FR-027).
    const packs = fileURLToPath(new URL('../../src/main/icon-pack-service.ts', import.meta.url));
    const src = stripComments(readFileSync(packs, 'utf8'));
    // The seeded packs are the object literals in the first-run seeder, each `{ name: '…', files }`.
    const seeded = [...src.matchAll(/name:\s*'([\w-]+)'\s*,\s*\n?\s*files:/g)].map((m) => m[1]!);
    const svgPacks = seeded.filter((n) => n.includes('svg'));
    expect(
      svgPacks,
      `expected exactly one SVG pack; seeded packs are: ${seeded.join(', ')}`,
    ).toHaveLength(1);
  });
});

describe('SC-002 — no hard-coded colour literal in value position', () => {
  /**
   * The predicate is precise, and the precision is load-bearing.
   *
   * A CSS `var(--token, #literal)` fallback is DEAD: the emitter merges every theme over the
   * built-in defaults, so the property is always defined and the fallback can never fire. ~120 of
   * the tree's literals are these. Banning them would fail on lines nobody is scheduled to touch,
   * and the guard would be deleted by the first person it annoyed.
   *
   * A literal that actually PAINTS is the one that escapes the theme. Those are banned.
   *
   * `box-shadow`/`text-shadow` are allow-listed: a drop shadow is an occlusion effect rendered over
   * whatever is beneath it, black-at-low-alpha in every theme — not a surface taking a colour from
   * the theme. FR-014 withdraws that charge on the record rather than silently tolerating it.
   */
  it('no CSS rule paints with a literal outside a var() fallback', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER, /\.css$/)) {
      const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
      // tokens.css IS the token definition block — its literals are the values themselves.
      if (rel.endsWith('theme/tokens.css')) continue;

      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      // The colour picker RENDERS THE COLOUR SPACE ITSELF. A hue slider is a rainbow by definition
      // and a saturation square is white-to-transparent by definition — those gradients are not
      // themed surfaces, they are the thing the user is choosing FROM. Theming them would make the
      // picker lie about the colours it is offering. Scoped to the picker's own rules, and stated.
      let inColourSpace = false;

      lines.forEach((line, i) => {
        if (/^\.colour-picker__(sv|hue)/.test(line)) inColourSpace = true;
        else if (/^\S/.test(line) && !/^\s/.test(line) && line.includes('{')) inColourSpace = false;
        if (inColourSpace) return;

        if (/^\s*--[\w-]+\s*:/.test(line)) return; // a custom-property DEFINITION
        if (/box-shadow|text-shadow/.test(line)) return; // occlusion, not a themed surface

        // Strip every var(...) — including its fallback arm — then look for what is left.
        let painted = line.replace(/var\([^)]*\)/g, '');
        // A SCRIM is pure black (or white) at low alpha, dimming whatever sits beneath a modal or a
        // drag ghost. Like a shadow, it is an occlusion effect rather than a surface taking a colour
        // from the theme — it is black in every theme by definition, and a `scrimColour` token would
        // exist only to say "black, faintly" in fifteen palettes.
        painted = painted.replace(/rgba?\(\s*(0\s*,\s*0\s*,\s*0|0\s+0\s+0)\s*[,/][^)]*\)/g, '');
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(painted)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `these paint with a hard-coded colour instead of a theme token:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * 018 / T129 (SC-002) — the artwork the guard could not see.
 *
 * The two checks above walk `.tsx` for inline vectors and `.css` for literals that paint. Between them
 * sits a blind spot the size of the renderer's TypeScript: a colour handed to a canvas, to xterm, to a
 * decoration API — anything painted from `.ts` rather than declared in a stylesheet — was INVISIBLE to a
 * guard that claims "zero surfaces escape the theme".
 *
 * It was not hypothetical. The terminal's search decorations carried three hard-coded hexes while the
 * theme shipped `searchMatch*` tokens for exactly that job; they were copies of the base theme's values,
 * so they looked right and would have drifted the first time anyone changed one.
 *
 * A guard shaped like the change would have kept scanning the two file types it was born scanning. This
 * one is shaped like the requirement: NO surface, in NO language.
 */
describe('SC-002 — colours painted from TypeScript are themed too', () => {
  it('no renderer .ts module paints with a hard-coded colour literal', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER, /\.ts$/)) {
      const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
      // The ambient bridge types declare no colours; `.d.ts` paints nothing.
      if (rel.endsWith('.d.ts')) continue;

      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        // A test id, a data attribute or a CSS-variable NAME is not a colour.
        if (/data-testid|--throng-/.test(line)) return;
        if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `these paint a colour from TypeScript instead of from a theme token:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
