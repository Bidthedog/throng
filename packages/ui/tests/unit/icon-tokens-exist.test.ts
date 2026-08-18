import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';

/**
 * Every `<Icon token="…" />` in the renderer names a token the shipped theme actually defines.
 *
 * ══ WHY THIS EXISTS ══
 *
 * `Icon` takes `token: string`, because a theme's `icons` map is `Record<string, string>` and a
 * custom theme may legitimately add its own. So a typo is not a type error — and an unresolved token
 * renders NOTHING, silently. There is no warning, no fallback glyph, no failing test: the control is
 * simply invisible, and only a human looking at that exact surface will ever notice.
 *
 * That is not hypothetical. 029 shipped a Clear control with `token="close"` — the registry calls it
 * `dismiss` — and a daemon indicator with `token="error"`, which does not exist at all. Both rendered
 * as empty buttons. The reporter found the first by eye; the second would have reached a release,
 * because no automated check in the repository could see it.
 *
 * A source walk is the only thing that can catch this, and it is the established pattern here
 * (`notice-models.test.ts` walks the renderer, `tier-plan.test.ts` walks the E2E directory). It
 * DISCOVERS the usages rather than checking the files someone remembered to list, which is what makes
 * it hold as the renderer grows.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Only STATIC tokens are checked — `token="retry"`, not `token={expr}`.
 *
 * A computed token cannot be resolved without running the app, and demanding they be literals would
 * be a real constraint imposed for a test's convenience. Static usages are the overwhelming majority
 * and are where typos live.
 */
const STATIC_TOKEN = /<Icon\b[^>]*?\btoken="([^"]+)"/g;

describe('Icon tokens', () => {
  const files = walk(RENDERER);
  const known = new Set(Object.keys(THRONG_THEME.icons));

  it('the shipped theme defines some icons (guards against a vacuous pass)', () => {
    // Without this, an empty or renamed `icons` map would make every assertion below trivially true.
    expect(known.size).toBeGreaterThan(10);
  });

  it('every statically-named token resolves in the shipped theme', () => {
    const unknown: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const [, token] of src.matchAll(STATIC_TOKEN)) {
        if (!known.has(token)) unknown.push(`${file.slice(RENDERER.length + 1)}: token="${token}"`);
      }
    }
    expect(
      unknown,
      'these Icon tokens are not defined by the shipped theme, so they render as NOTHING — an ' +
        'invisible control, with no error anywhere:\n  ' +
        unknown.join('\n  '),
    ).toEqual([]);
  });

  it('finds the usages it claims to check', () => {
    // A regex that silently stopped matching would make this suite pass while checking nothing —
    // the same vacuous-guard trap the assertion above closes from the other side.
    const total = files.reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(STATIC_TOKEN)].length,
      0,
    );
    expect(total).toBeGreaterThan(10);
  });
});
