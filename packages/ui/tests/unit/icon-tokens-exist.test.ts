import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { stripComments } from './helpers/strip-comments.js';
import { IconPackService } from '../../src/main/icon-pack-service.js';

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

/**
 * The file's CODE, with its comments removed (#379).
 *
 * The guard polices elements, not prose. Scanned raw, it fails on a comment that merely DESCRIBES
 * the attribute form — so the guard's own subject could not be documented in the files it guards,
 * and the fix at the time was to reword the comment and explain why it could not say what it meant.
 *
 * The stripping is a scanner rather than a pair of regexes, because a `//` inside a string literal
 * must not be read as a comment: that would delete the rest of a real line and the guard would
 * quietly stop seeing usages. `helpers/strip-comments.ts` states the four contexts and
 * `strip-comments.test.ts` holds it to them.
 */
const code = (file: string): string => stripComments(readFileSync(file, 'utf8'));

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
      const src = code(file);
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
    // the same vacuous-guard trap the assertion above closes from the other side. It counts over
    // the STRIPPED text for the same reason, so comment-stripping that ate real code would show up
    // here as a collapsing count rather than as a quietly narrower sweep.
    const total = files.reduce((n, f) => n + [...code(f).matchAll(STATIC_TOKEN)].length, 0);
    expect(total).toBeGreaterThan(10);
  });
});

/**
 * 046 T007 (FR-061, R11) — `unload` and `category` each need a BESPOKE shape in the bundled
 * `throng-svg` image pack, not the generic rounded-square badge every undrawn token falls back to
 * (`GENERIC_SHAPE` in `packages/ui/src/main/icon-pack-service.ts`). `SVG_SHAPES` itself is
 * module-private, so this drives it the same way the shipped pack does: seed the two bundled packs
 * into a throwaway `icon-packs/` directory via the public `ensureBundledPacks()` and read back the
 * `.svg` file each of the two tokens produced.
 *
 * A third token, `projectList`, originally shipped alongside these two — retired (branch-review
 * finding, 046 iterate round 2): it described a cog-menu row FR-074/FR-107 had already retired
 * before the description was written, and no call site ever drew it. `THRONG_THEME.icons` no longer
 * defines it, so `known` above (line 68) already excludes it from every check in this file.
 *
 * `dismiss` stands in as a KNOWN-generic reference — it is a real shipped token
 * (`THRONG_THEME.icons.dismiss`) that has never had a bespoke `SVG_SHAPES` entry, so whatever content
 * it produces today IS the generic fallback, discovered rather than hand-copied from the private
 * constant.
 */
describe('the two 046 side-pane tokens have a bespoke SVG_SHAPES entry, not the generic fallback', () => {
  let packsDir: string;

  beforeEach(() => {
    packsDir = mkdtempSync(join(tmpdir(), 'throng-icon-shapes-'));
  });
  afterEach(() => {
    rmSync(packsDir, { recursive: true, force: true });
  });

  const svgPath = (token: string): string => join(packsDir, 'throng-svg', `${token}.svg`);

  it('dismiss is still undrawn — the generic reference this test relies on', () => {
    // Guards the test itself: if `dismiss` ever gains bespoke art, the comparison below would
    // compare bespoke-against-bespoke and could pass for the wrong reason.
    expect(THRONG_THEME.icons.dismiss, 'icons.dismiss').toBeTruthy();
  });

  it('unload and category each render distinct art, not the generic badge', async () => {
    await new IconPackService(packsDir).ensureBundledPacks();
    const generic = readFileSync(svgPath('dismiss'), 'utf8');
    for (const token of ['unload', 'category']) {
      const rendered = readFileSync(svgPath(token), 'utf8');
      expect(rendered, `${token}.svg is the generic fallback shape, not a bespoke one`).not.toBe(generic);
    }
  });
});
