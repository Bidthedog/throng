import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip-comments.js';

/**
 * 069 FR-010 — no icon is drawn as a text glyph.
 *
 * Layer: unit — it asks a question about EVERY renderer file, which a component test of one tree
 * cannot. It discovers, like `no-inline-artwork.test.ts`, rather than checking files someone listed.
 *
 * Two shapes are refused:
 *
 *  1. A JSX element whose only content is a lone non-alphanumeric glyph (`<button>✕</button>`,
 *     `<span>⠿</span>`). That is an icon drawn outside the key system, so no icon set can restyle it.
 *     The fix is an `IconButton` / `Icon` naming a key.
 *  2. A `✓` (or `✔`) in a string: a checked state written into a menu label. The fix is the menu
 *     item's `checked` flag, which draws the `menuChecked` key in the icon slot.
 *
 * Typography that is not an icon is allowed, each with its reason (research R3, *Not icons*).
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Glyphs that are typography inside text, not controls or images (research R3, *Not icons*). */
const TYPOGRAPHY = new Set(['×', '…', '›', '•', '·', '→', '⏎', '—', '–', '‹', '«', '»', '±', '°']);

/** Non-ASCII JSX text of one or two code points, between a tag's `>` and the next `<`. */
const LONE_GLYPH = />\s*(\P{ASCII}{1,2})\s*</gu;

const CHECK_MARK = /[✓✔]/;

const sources = walk(RENDERER).map((file) => ({
  rel: file.slice(RENDERER.length + 1).replace(/\\/g, '/'),
  code: stripComments(readFileSync(file, 'utf8')),
}));

describe('no icon is drawn as a text glyph (069 FR-010)', () => {
  it('scans a non-trivial number of files (the guard must not pass by finding nothing)', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('no JSX element holds a lone glyph as its content', () => {
    const offenders: string[] = [];
    for (const { rel, code } of sources) {
      if (!rel.endsWith('.tsx')) continue;
      for (const match of code.matchAll(LONE_GLYPH)) {
        const glyph = match[1]!;
        if (TYPOGRAPHY.has(glyph.trim())) continue;
        offenders.push(`${rel}: ${glyph}`);
      }
    }
    expect(
      offenders.sort(),
      'these draw an icon as a text glyph, outside the icon key system — use an IconButton or Icon ' +
        'naming a key:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('no string carries a check mark — a checked state is the item\'s `checked` flag', () => {
    const offenders: string[] = [];
    for (const { rel, code } of sources) {
      code.split('\n').forEach((line, i) => {
        if (CHECK_MARK.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      'these write a checked state into a label — set `checked` so the menu draws `menuChecked`:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the matcher still sees a glyph button (it is not vacuous)', () => {
    expect([...'<button>✕</button>'.matchAll(LONE_GLYPH)]).toHaveLength(1);
    expect([...'<span>⠿</span>'.matchAll(LONE_GLYPH)]).toHaveLength(1);
    expect([...'<span>Close</span>'.matchAll(LONE_GLYPH)]).toHaveLength(0);
  });
});
