import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 017 / #54 — structural guards for the icon system.
 *
 * There is no jsdom/component-test layer in this repo, so a React component's rendered output
 * cannot be asserted in a unit test. What CAN be asserted, cheaply and exhaustively, is the shape
 * of the source — and for these two requirements that is actually the stronger test.
 *
 * The first guard is the highest-value test in the feature. #54 survived precisely because a
 * pack-aware resolver existed and *almost nothing called it*: one screen did, and thirteen other
 * call sites across eight modules quietly used the pack-blind one. A guard that checked "the files
 * I remembered to change" would have passed while the bug was still there. So this guard is shaped
 * like the REQUIREMENT, not like the change: it walks the whole renderer tree and fails on any file
 * that reaches for the banned resolver — including the one nobody remembered.
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

const rendererSources = walk(RENDERER, /\.tsx?$/);

/**
 * Strip comments before matching.
 *
 * The guard polices CODE, not prose. `icon.tsx` explains at length why `resolveIcon` was deleted —
 * naming it, necessarily — and a guard that failed on the documentation of its own rule would be
 * one nobody could satisfy, and would train the next author to delete the explanation rather than
 * keep the rule.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no renderer module may bypass the shared <Icon> component (FR-002)', () => {
  it('scans a non-trivial number of files (the guard must not pass by finding nothing)', () => {
    // A guard that silently scanned zero files would be green and worthless.
    expect(rendererSources.length).toBeGreaterThan(20);
  });

  it('no renderer file references resolveIcon', () => {
    /*
     * WORD-BOUNDED, and this matters: `resolveIcon` is a SUBSTRING of `resolveIconValue`, which is
     * the resolver <Icon> is required to use. A naive `.includes('resolveIcon')` would fail on the
     * very component this feature introduces, making the guard unsatisfiable.
     */
    const banned = /\bresolveIcon\b(?!Value)/;
    const offenders = rendererSources.filter((f) => banned.test(code(f)));

    expect(
      offenders.map((f) => f.slice(RENDERER.length + 1).replace(/\\/g, '/')),
      'These files still resolve icons themselves instead of rendering <Icon>, so the user\'s ' +
        'icon-pack choice is ignored there (#54).',
    ).toEqual([]);
  });
});

describe('<Icon> renders synchronously, from memory (FR-006b / SC-009)', () => {
  const iconSource = (): string => code(join(RENDERER, 'common', 'icon.tsx'));

  it('exists', () => {
    expect(() => iconSource()).not.toThrow();
  });

  it('never reaches the disk or the network on the render path', () => {
    /*
     * The explorer resolves an icon PER ROW. If drawing an icon could read a file, painting a large
     * tree would cost hundreds of reads for a single frame — and the icons would pop in after the
     * rows that contain them.
     *
     * This is asserted structurally rather than with a stopwatch because the design's claim IS
     * structural: a component that cannot reach the disk cannot be slow because of the disk. There
     * is no perf budget to argue about.
     */
    const source = iconSource();
    expect(source, 'an icon must not be fetched at render time').not.toMatch(/\bfetch\s*\(/);
    expect(source, 'an icon must not be loaded on mount — it would pop in').not.toMatch(
      /\buseEffect\b/,
    );
    expect(source, 'the renderer must never construct a file:// URL').not.toContain('file://');
  });

  it('is decorative to assistive technology (FR-006c)', () => {
    // The accessible name comes from the ENCLOSING control, which the constitution already
    // requires to carry a hover title naming its action. An icon that announced itself as well
    // would be read out twice.
    const source = iconSource();
    expect(source).toContain('aria-hidden');
  });
});
