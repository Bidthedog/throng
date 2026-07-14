import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OPTIONAL_THEME_COLOUR_TOKENS, THRONG_THEME, toCssVariables } from '@throng/core';

/**
 * 018 / FR-051b — every CSS custom property the renderer READS must actually be DEFINED.
 *
 * This guard exists because `--danger` was referenced in the stylesheets and defined nowhere, so
 * every `var(--danger, #e5534b)` silently rendered its literal fallback. The preferences notice
 * strip was *always* #e5534b whatever the theme; the themes error strip rendered --accent, so a
 * failure read exactly like a success, directly contradicting the comment sitting above it.
 *
 * Nobody noticed for two features. That is the whole argument for the guard: an undefined variable
 * does not throw, it does not warn, and it does not look wrong in the source — it just quietly
 * stops being themeable.
 *
 * The count is deliberately not hard-coded here. Phase 0 said "4 references"; a later pass counted
 * 13, across a third file the first count never named — and that 13 came from a CSS-only search
 * that could not see the .tsx references. Every hand count of this codebase has been wrong. The
 * guard walks the tree; the tree is the answer.
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
 * Strip comments before scanning. A comment mentioning `var(--throng-colour-editor*)` is prose,
 * not a read, and a guard that cannot tell the difference cries wolf until someone deletes it.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const optionalNames = new Set(
  OPTIONAL_THEME_COLOUR_TOKENS.map((t) => `--throng-colour-${t}`),
);

function definedNames(): Set<string> {
  const defined = new Set<string>();

  // Everything the theme emits: --throng-colour-*, --throng-font-*, per-role typography.
  for (const name of Object.keys(toCssVariables(THRONG_THEME))) defined.add(name);

  // The OPTIONAL tokens are part of the token system but are deliberately NOT emitted when unset —
  // their absence is their meaning (an unset `iconColour` means "icons inherit their host's colour").
  // They are therefore legitimately absent at runtime, not undefined. The separate assertion below
  // holds them to the rule that follows from that: a read of one MUST carry a fallback.
  for (const name of optionalNames) defined.add(name);

  // Everything a renderer stylesheet DECLARES. The declaration must open a rule body or follow a
  // semicolon — matching a bare `--name:` anywhere would also match the SELECTOR
  // `.modal__confirm--danger:hover`, which is precisely how an earlier draft of this guard
  // concluded that `--danger` was defined. It is not. The guard hunting the dead variable was
  // fooled by a class name containing its name.
  for (const file of walk(RENDERER, /\.css$/)) {
    const css = stripComments(readFileSync(file, 'utf8'));
    for (const [, name] of css.matchAll(/(?:^|[{;])\s*(--[a-zA-Z0-9-]+)\s*:/gm)) defined.add(name);
  }

  // Custom properties set at runtime from TypeScript — via setProperty(), or as an inline style
  // object key. Discovered, not hard-coded: a hand-kept allow-list is the thing this guard exists
  // to replace.
  for (const file of walk(RENDERER, /\.(ts|tsx)$/)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const [, name] of src.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)['"]/g)) {
      defined.add(name);
    }
    for (const [, name] of src.matchAll(/\[?\s*['"](--[a-zA-Z0-9-]+)['"]\s*\]?\s*:/g)) {
      defined.add(name);
    }
  }
  return defined;
}

/**
 * A property name COMPOSED from a prefix and an interpolated argument, e.g.
 *
 *   const v = (token: string): string => `var(--throng-colour-${token})`;
 *   … v('syntaxKeyword') …
 *
 * These must be resolved, not skipped. Read literally, the template says a property called
 * `--throng-colour-` is read — which nothing does — while the thirty names it ACTUALLY composes go
 * unchecked. So the guard would simultaneously report a name that does not exist and miss every name
 * that does, which is the worst of both: a false alarm covering for a blind spot. `v('syntaxKeyworrd')`
 * is exactly the typo this guard exists to catch, and until now it could not see it.
 *
 * Resolution is deliberately narrow — a one-line arrow whose body is a single `var()` template, called
 * with a string literal in the same file. Anything cleverer than that is not statically knowable, and a
 * guard that pretends otherwise is lying about its own coverage.
 */
function composedReferences(src: string, rel: string): { name: string; where: string }[] {
  const refs: { name: string; where: string }[] = [];
  const composers = [
    ...src.matchAll(/const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]*?)?=>\s*`var\((--[a-zA-Z0-9-]+)\$\{/g),
  ];
  for (const [, fn, prefix] of composers) {
    if (!fn || !prefix) continue;
    const calls = src.matchAll(new RegExp(`\\b${fn}\\(\\s*['"\`]([a-zA-Z0-9_-]+)['"\`]\\s*\\)`, 'g'));
    for (const call of calls) {
      const token = call[1];
      if (!token) continue;
      const line = src.slice(0, call.index).split('\n').length;
      refs.push({ name: `${prefix}${token}`, where: `${rel}:${line}` });
    }
  }
  return refs;
}

/** Every `var(--name)` read, wherever it appears — stylesheets AND TypeScript. */
function references(): { name: string; where: string }[] {
  const refs: { name: string; where: string }[] = [];
  for (const file of walk(RENDERER, /\.(css|ts|tsx)$/)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
    src.split('\n').forEach((line, i) => {
      for (const [, name] of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        // A name butting straight up against a `${` is a PREFIX, not a property — the composed
        // names it stands for are resolved below.
        if (new RegExp(`var\\(\\s*${name}\\$\\{`).test(line)) continue;
        refs.push({ name, where: `${rel}:${i + 1}` });
      }
    });
    refs.push(...composedReferences(src, rel));
  }
  return refs;
}

describe('CSS custom properties (FR-051b)', () => {
  it('every custom property the renderer reads is defined somewhere', () => {
    const defined = definedNames();
    const undefinedRefs = references().filter((r) => !defined.has(r.name));

    const report = undefinedRefs.map((r) => `${r.name} at ${r.where}`).sort();
    expect(report, `undefined custom properties are read here:\n${report.join('\n')}`).toEqual([]);
  });

  it('reads an OPTIONAL token only with a fallback — its absence is a legitimate state', () => {
    // An optional token is genuinely undefined at runtime whenever a theme leaves it unset, which is
    // the default. So every read of one must supply the fallback that expresses what "unset" MEANS —
    // for `iconColour`, that is `inherit`, which is exactly what makes FR-029 true (no bundled theme
    // changes appearance the day the token lands). A bare `var(--throng-colour-iconColour)` would
    // resolve to nothing and every icon in the application would lose its colour.
    const bare: string[] = [];
    for (const file of walk(RENDERER, /\.(css|ts|tsx)$/)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
      src.split('\n').forEach((line, i) => {
        for (const name of optionalNames) {
          if (new RegExp(`var\\(\\s*${name}\\s*\\)`).test(line)) bare.push(`${name} at ${rel}:${i + 1}`);
        }
      });
    }
    expect(bare, `optional tokens read without a fallback:\n${bare.join('\n')}`).toEqual([]);
  });

  it('walks TypeScript as well as CSS, because var() is read from both', () => {
    // Guard the guard: a CSS-only walk would miss these, and that narrowness is exactly the
    // failure mode this feature exists to indict. If the renderer stops reading var() from .tsx
    // this can go — but it must never be narrowed silently.
    const fromTs = references().filter((r) => /\.tsx?:/.test(r.where));
    expect(fromTs.length).toBeGreaterThan(0);
  });
});
