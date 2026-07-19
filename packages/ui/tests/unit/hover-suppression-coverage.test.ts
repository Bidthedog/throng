import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every `.css` file under a directory, recursively. */
function cssFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * 021 / FR-035 (US10) — the stranded-hover fix must be **app-wide**, not curated.
 *
 * Every `:hover` rule that paints a background with the HOVER surface token is strandable: if the
 * pointer is left over the element when the window blurs (a child window such as Preferences opens,
 * or focus leaves), the CSS `:hover` persists and the element keeps its hover tint until the mouse
 * moves. The fix gates such rules behind `:where(body:not([data-window-blurred]))`, which the
 * renderer toggles on blur/child-open and clears on focus + the first pointermove.
 *
 * This guard DISCOVERS the rules rather than checking a hand-picked list (the failure mode the code
 * review caught): it scans every renderer stylesheet, finds each rule whose selector contains
 * `:hover` and whose body sets a `background`/`background-color` to `--throng-colour-hoverSurface`,
 * and fails naming any that is not gated. A newly-added ungated hover-surface rule fails the build.
 *
 * Scope note: button HOVER backgrounds (`--throng-colour-*ButtonHoverBg`) are deliberately NOT in
 * scope — those live on text buttons inside focused modals/forms, not on strandable row/icon hovers,
 * and use their own button-type token, never `hoverSurface`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(here, '../../src/renderer');

const GATE = 'body:not([data-window-blurred])';

function ungatedHoverSurfaceRules(): string[] {
  const files = cssFilesUnder(rendererRoot);
  const offenders: string[] = [];
  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    // Match each `selector { body }` rule (no nested braces in this codebase's CSS).
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const selector = m[1];
      const body = m[2];
      const paintsHoverSurface = /background(-color)?\s*:[^;]*--throng-colour-hoverSurface/.test(body);
      if (selector.includes(':hover') && paintsHoverSurface && !selector.includes(GATE)) {
        const line = css.slice(0, m.index).split('\n').length;
        offenders.push(`${relative(rendererRoot, file).replace(/\\/g, '/')}:${line}  ${selector.trim().split('\n').pop()?.trim()}`);
      }
    }
  }
  return offenders;
}

describe('hover-suppression coverage (021/FR-035)', () => {
  it('every :hover rule that paints the hover-surface token is gated on window focus', () => {
    const offenders = ungatedHoverSurfaceRules();
    expect(
      offenders,
      `these :hover rules paint --throng-colour-hoverSurface but are NOT gated behind ` +
        `\`${GATE}\` — a stranded hover will linger on them when the window blurs (FR-035):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
