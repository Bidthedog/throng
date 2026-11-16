import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip-comments.js';

/**
 * 017 / #54 — structural guards for the icon system.
 *
 * What can be asserted here, cheaply and exhaustively, is the shape of the SOURCE — and for these
 * requirements that is the stronger test, because they are claims about every file rather than
 * about any rendered tree.
 *
 * ══ ONE SENTENCE OF THIS HEADER WAS TRUE AND IS NOT (035) ══
 *
 * It used to open *"There is no jsdom/component-test layer in this repo, so a React component's
 * rendered output cannot be asserted in a unit test."* Spec 034 added that layer, and it now holds
 * 48 files. Left standing, the sentence tells the next author that a whole layer does not exist —
 * and the layer it denies is the one most of these tests belong at, so the sentence would keep
 * pushing coverage up to E2E, which is the drift 035 exists to reverse.
 *
 * The source guards below still earn their place, and the reason is not the missing layer: a
 * component test renders ONE tree, and these ask about EVERY file. `:97` in particular asserts that
 * `<Icon>` is decorative by reading the source; `component/icon-button.test.ts` now asserts the same
 * property on a real rendered node. Neither replaces the other — one proves the rule holds where it
 * is written, the other that it survives being rendered.
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
 *
 * The stripping used to be two regexes here, which guarded the `//` in a URL with an `[^:]` and
 * nothing else — so a `//` in a UNC path or any other string would have eaten the rest of its line,
 * and the guard would have stopped reading real code without saying so. It is now the shared
 * scanner (#379), which knows the difference between code, a string, a template and a regex
 * literal; `strip-comments.test.ts` holds it to that.
 */
function code(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

describe('no renderer module may bypass the shared <Icon> component (FR-002)', () => {
  it('scans a non-trivial number of files (the guard must not pass by finding nothing)', () => {
    // A guard that silently scanned zero files would be green and worthless.
    expect(rendererSources.length).toBeGreaterThan(20);
  });

  it('only the sanctioned sites call resolveIcon', () => {
    /*
     * `resolveIcon` (069) is the one resolver, and it returns svg markup. The shared <Icon> calls it
     * for React; the two CodeMirror / DOM-pipeline hosts that cannot render a component (the editor's
     * fold gutter and the Markdown preview's) call it to build markup they inject. Any other renderer
     * file calling it is drawing an icon without <Icon>, so it would bypass the IconButton / title
     * contract that makes every control themeable.
     */
    const SANCTIONED = new Set([
      'common/icon.tsx',
      'editor/use-editor.ts',
      'preview/providers/markdown/markdown-body.tsx',
    ]);
    const banned = /\bresolveIcon\b/;
    const offenders = rendererSources
      .map((f) => f.slice(RENDERER.length + 1).replace(/\\/g, '/'))
      .filter((rel, i) => banned.test(code(rendererSources[i]!)) && !SANCTIONED.has(rel));

    expect(
      offenders,
      'These files resolve icons themselves instead of rendering <Icon>, so the selected icon ' +
        "set's art is not drawn through the one component (#54, 069).",
    ).toEqual([]);
  });

  it('every sanctioned site still calls it (the allow-list is not stale)', () => {
    for (const rel of ['common/icon.tsx', 'editor/use-editor.ts', 'preview/providers/markdown/markdown-body.tsx']) {
      expect(code(join(RENDERER, rel)), rel).toMatch(/\bresolveIcon\b/);
    }
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
    //
    // This is a source grep and would pass on a file that merely MENTIONED `aria-hidden` in a
    // comment. It is kept as a cheap tripwire beside the guard above — the real assertion is
    // `packages/ui/tests/component/icon.test.ts`, which renders the component on both branches and
    // reads the attribute off the element (034 FR-045). Together with the call-site guard above,
    // those two say what the E2E sweep of a running window used to say, and say it about branches
    // no single window could have shown at once.
    const source = iconSource();
    expect(source).toContain('aria-hidden');
  });
});
