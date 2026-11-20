import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_KEYS } from '@throng/core';
import { stripComments } from './helpers/strip-comments.js';

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
 *
 * `IconButton` takes the same `token` and resolves it the same way, so it is checked too: 059's View
 * Whitespace button named a token no theme defined and rendered empty while this walk saw only `<Icon`.
 */
const STATIC_TOKEN = /<(?:Icon|IconButton)\b[^>]*?\btoken="([^"]+)"/g;

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
  const known = new Set<string>(ICON_KEYS);

  it('the icon key vocabulary is non-empty (guards against a vacuous pass)', () => {
    // Without this, an empty or renamed `ICON_KEYS` would make every assertion below trivially true.
    expect(known.size).toBeGreaterThan(10);
  });

  it('every statically-named token is an icon key (069 FR-010, FR-011)', () => {
    const unknown: string[] = [];
    for (const file of files) {
      const src = code(file);
      for (const [, token] of src.matchAll(STATIC_TOKEN)) {
        if (!known.has(token)) unknown.push(`${file.slice(RENDERER.length + 1)}: token="${token}"`);
      }
    }
    expect(
      unknown,
      'these Icon tokens are not icon keys in `ICON_KEYS`, so they render as NOTHING — an ' +
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
 * 069 FR-010, FR-011 — the key vocabulary and the call sites agree in BOTH directions.
 *
 * Layer: unit — a question about every file and every key, which no single rendered tree can answer.
 *
 * A key with no render site is a row in the icon grid nobody can see drawn (`notifications` was one,
 * until it was retired); a site naming a key the vocabulary lacks draws nothing. A site is either a
 * static `token="…"`, or a quoted key in a renderer file or in the core files that hand the renderer
 * an icon key (the panel-type registry, the notice entry look). The second direction also covers a
 * key written as `icon: '…'` in a menu builder, which the static-attribute guard above cannot see.
 */
describe('every icon key has a render site, and every render site names a key (069 FR-010, FR-011)', () => {
  const CORE_SITES = [
    'notice/entry-look.ts',
    'panel-type/default-registry.ts',
    'find-in-files/panel-type.ts',
    // 076 — the terminal status-bar toggles' icons, drawn by `terminal-status-bar.tsx` from this table.
    'terminal/panel-toggles.ts',
    // 074 FR-103 — each shipped preview type's own preview icon, drawn through `previewIconOf` wherever that
    // type's preview is named.
    'preview/providers/markdown.ts',
    'preview/providers/mermaid.ts',
    'preview/providers/image.ts',
    'preview/providers/svg.ts',
    'preview/providers/pdf.ts',
    'preview/providers/html.ts',
    'preview/providers/csv.ts',
    'preview/providers/spreadsheet.ts',
    // 075 FR-024 — the callout registry hands the Markdown body each type's icon key.
    'preview/callouts.ts',
  ].map((rel) => fileURLToPath(new URL(`../../../core/src/${rel}`, import.meta.url)));
  const known = new Set<string>(ICON_KEYS);
  const siteSources = [...walk(RENDERER), ...CORE_SITES].map((f) => code(f));
  const all = siteSources.join('\n');

  it('every key is written, quoted, at some render site', () => {
    const unused = ICON_KEYS.filter((key) => !new RegExp(`['"\`]${key}['"\`]`).test(all));
    expect(
      unused,
      'these icon keys have no render site, so no control draws them — draw them where they belong ' +
        'or retire them from `ICON_KEYS`:\n  ' +
        unused.join('\n  '),
    ).toEqual([]);
  });

  it('every `icon: \'…\'` a menu or descriptor names is a key', () => {
    const unknown: string[] = [];
    for (const src of siteSources) {
      for (const [, token] of src.matchAll(/\bicon:\s*'([A-Za-z0-9]+)'/g)) {
        if (!known.has(token!)) unknown.push(token!);
      }
    }
    expect(unknown, `these \`icon:\` values are not icon keys: ${unknown.join(', ')}`).toEqual([]);
  });

  it('finds the sites it claims to check', () => {
    const total = siteSources.reduce((n, src) => n + [...src.matchAll(/\bicon:\s*'([A-Za-z0-9]+)'/g)].length, 0);
    expect(total).toBeGreaterThan(30);
  });
});
