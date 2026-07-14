import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 018 / FR-013 — every FLOATING SURFACE flips and clamps.
 *
 * The requirement says this in as many words, and says exactly why the obvious guard would be useless:
 *
 *   "The guard enforcing this requirement MUST DISCOVER floating surfaces rather than checking two
 *    known class names — a guard that enumerates two of three implementations reports green while this
 *    requirement is false."
 *
 * That is not a hypothetical. The feature began by naming two bespoke floating lists; there were three.
 * The third — the font typeahead — opened straight downward with no measurement at all, so on the last
 * row of a short window it opened off the bottom of the screen. Nobody had listed it, so nobody checked
 * it, and a guard written around the two that WERE listed would have passed.
 *
 * So this guard finds them: it walks every renderer stylesheet, and a rule that positions itself out of
 * the flow AND lifts itself above the page is a floating surface, whatever it is called. Each one must
 * be REGISTERED below with where its flip and its clamp live. A new one fails this test until someone
 * has answered the question — which is the whole point.
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
 * The floating surfaces, and where each one's flip and clamp live.
 *
 * Registered, not merely listed: the value is the ANSWER to "does this flip and clamp, and where?".
 */
const REGISTERED: Readonly<Record<string, string>> = {
  '.context-menu':
    'workspace/context-menu.tsx — measures and flips X/Y against the viewport; submenus flip too',
  '.ctl__font-list':
    'preferences/pickers.tsx — flips above its field when it would open off the bottom; max-height + scroll clamps it',
  // Not anchored to anything, so there is no edge to flip away from: these are centred or corner-pinned
  // overlays that cover the window by design, and clamping is the browser's job.
  '.modal-overlay': 'a full-viewport scrim — centred, nothing to flip away from',
  '.notices': 'corner-pinned toast stack — max-width clamped; nothing to flip away from',
  '.drag-ghost': 'follows the pointer by design — it is meant to leave the window',
  '.colour-picker':
    'common/colour-picker.tsx — flips above its swatch when it would open off the bottom (found BY this guard)',
  '.language-picker':
    'editor/language-picker.tsx — CLAMPS its height to the room above its strip; it opens upward from the bottom of its panel, so there is nothing below to flip to (found BY this guard, in 016)',
  '.capture-overlay': 'a full-viewport scrim over the key-capture dialog — nothing to flip away from',

  // Everything below is CHROME, not a popup: fixed furniture with a z-index, anchored to nothing, so
  // there is no edge for it to flip away from. Registered rather than pattern-matched away, because the
  // question "is this a floating surface?" is the one a human has to answer — and answering it for a
  // handful of chrome elements is the price of a guard that cannot miss the next real popup.
  '.title-bar': 'chrome — pinned to the top of the window',
  '.throng-status-bar': 'chrome — pinned to the bottom of the window',
  '.find-bar': 'chrome — pinned inside its panel, clamped by the panel',
  '.pane-collapse': 'chrome — a rail button pinned to its pane',
  '.resize-handle': 'chrome — a drag edge pinned to its pane',
  '.resize-handle--leading': 'chrome — the same drag edge, leading side',
  '.pane-explorer__body--active': 'chrome — an active-pane highlight, not a surface',
  '.terminal-panel__starting': 'chrome — a status overlay filling its own panel',
  '.project-insert': 'a drag INSERTION MARKER inside its list — a line, not a surface',
  '.subworkspace-insert': 'a drag insertion marker inside its list',
  '.tab-insert': 'a drag insertion marker inside the tab strip',
};

/** A rule that leaves the flow AND lifts above the page is a floating surface, whatever it is called. */
function floatingSelectors(css: string): string[] {
  const found = new Set<string>();
  // Crude but honest block splitting: selectors up to `{`, declarations up to `}`.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selector.startsWith('@') || selector.includes('%')) continue; // at-rules, keyframes
    const positioned = /position:\s*(absolute|fixed)/.test(body);
    const lifted = /z-index:\s*-?\d+/.test(body);
    if (!positioned || !lifted) continue;
    for (const part of selector.split(',')) {
      // The first class in the selector is the surface; `.a .b:hover` is a part of `.a`'s surface.
      const cls = part.trim().match(/\.[a-zA-Z0-9_-]+/);
      if (cls) found.add(cls[0]);
    }
  }
  return [...found];
}

describe('FR-013 — floating surfaces are discovered, not enumerated', () => {
  it('every floating surface in the renderer is registered with its flip and clamp', () => {
    const surfaces = new Set<string>();
    for (const file of walk(RENDERER, /\.css$/)) {
      for (const s of floatingSelectors(readFileSync(file, 'utf8'))) surfaces.add(s);
    }

    // The guard must actually be finding things — a discovering guard that discovers nothing is a
    // guard that passes because its regex broke, which is the failure mode it exists to prevent.
    expect(surfaces.size).toBeGreaterThan(2);

    const unregistered = [...surfaces].filter((s) => !(s in REGISTERED)).sort();
    expect(
      unregistered,
      'these float above the page and nobody has said whether they flip and clamp.\n' +
        'Register each in REGISTERED with where its flip and clamp live — or give it one:\n' +
        unregistered.join('\n'),
    ).toEqual([]);
  });
});
