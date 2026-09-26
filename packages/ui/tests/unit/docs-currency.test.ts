/**
 * The documentation set stays linked, indexed and complete (the maintainer's documentation rules,
 * 2026-09-27; the `throng-docs` skill owns them — this file is the part of its audit a machine can do).
 *
 * - Every page under docs/ opens with its breadcrumb, and docs/README.md indexes every page.
 * - Every relative link in README.md, CONTRIBUTING.md and docs/ resolves, anchors included.
 * - Every default key binding, every configurable setting and every THRONG_* variable the code
 *   reads is documented in its one home: key-bindings.md, preferences.md, environment.md.
 * - README.md stays an entry point, not a manual.
 *
 * A red run here is fixed in the docs, never by loosening the list: a new binding, setting or
 * variable ships with its line in the right file.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEYBINDINGS_METADATA, settingsLeaves } from '@throng/core';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const read = (p: string): string => readFileSync(p, 'utf8');

const docPages = (): string[] =>
  readdirSync(DOCS)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => join(DOCS, f));

/** The files whose links are checked: the entry points and every docs page. */
const linkedFiles = (): string[] => [join(ROOT, 'README.md'), join(ROOT, 'CONTRIBUTING.md'), ...docPages()];

/** GitHub's heading anchor: lower-cased, punctuation dropped (hyphens kept), spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Every anchor a markdown file offers, with GitHub's -1, -2 suffixes for repeated headings. */
function anchorsOf(file: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of read(file).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1] as string);
    const n = seen.get(base) ?? 0;
    anchors.add(n === 0 ? base : `${base}-${n}`);
    seen.set(base, n + 1);
  }
  for (const m of read(file).matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(m[1] as string);
  return anchors;
}

/** Relative markdown links outside code fences and inline code. */
function linksOf(file: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of read(file).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    if (inFence) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1] as string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
      out.push(target);
    }
  }
  return out;
}

describe('docs pages carry their breadcrumb and are indexed', () => {
  it('every page under docs/ opens with a breadcrumb back to the README and the docs index', () => {
    for (const page of docPages()) {
      const first = read(page).split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
      const isIndex = page.toLowerCase().endsWith(join('docs', 'readme.md'));
      const expected = isIndex ? '[throng](../README.md) › Docs' : '[throng](../README.md) › [Docs](README.md) › ';
      expect(first.startsWith(expected), `${relative(ROOT, page)} starts with "${first}"`).toBe(true);
    }
  });

  it('docs/README.md links every page under docs/', () => {
    const index = join(DOCS, 'README.md');
    const linked = new Set(linksOf(index).map((l) => l.split('#')[0]?.toLowerCase()));
    for (const page of docPages()) {
      const name = relative(DOCS, page);
      if (name.toLowerCase() === 'readme.md') continue;
      expect(linked.has(name.toLowerCase()), `docs/README.md does not link ${name}`).toBe(true);
    }
  });
});

describe('every relative link resolves', () => {
  it('points at a file that exists, and at an anchor that file has', () => {
    const broken: string[] = [];
    for (const file of linkedFiles()) {
      for (const link of linksOf(file)) {
        const [path, anchor] = link.split('#') as [string, string | undefined];
        const target = path === '' ? file : resolve(dirname(file), decodeURIComponent(path));
        if (!existsSync(target)) {
          broken.push(`${relative(ROOT, file)} → ${link} (no such file)`);
          continue;
        }
        if (anchor && statSync(target).isFile() && target.toLowerCase().endsWith('.md') && !anchorsOf(target).has(anchor)) {
          broken.push(`${relative(ROOT, file)} → ${link} (no such anchor)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('every binding, setting and variable is documented in its one home', () => {
  it('docs/key-bindings.md names every action in the Key Bindings editor, by id', () => {
    const doc = read(join(DOCS, 'key-bindings.md'));
    const missing = KEYBINDINGS_METADATA.map((d) => d.key).filter((id) => !doc.includes(`\`${id}\``));
    expect(missing).toEqual([]);
  });

  it('docs/preferences.md names every configurable setting, by key', () => {
    const doc = read(join(DOCS, 'preferences.md'));
    const missing = settingsLeaves().filter((key) => !doc.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });

  it('docs/environment.md names every THRONG_* variable the app, scripts or E2E harness reads', () => {
    const doc = read(join(DOCS, 'environment.md'));
    const roots = [
      ...readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p, 'src')),
      join(ROOT, 'scripts'),
      join(ROOT, 'packages', 'ui', 'tests', 'e2e'),
    ].filter((d) => existsSync(d));
    const names = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== 'node_modules' && entry !== 'dist') walk(p);
        } else if (/\.(m?[jt]sx?)$/.test(entry)) {
          for (const m of read(p).matchAll(/process\.env(?:\.|\[['"])(THRONG_[A-Z0-9_]+)/g)) names.add(m[1] as string);
        }
      }
    };
    roots.forEach(walk);
    const missing = [...names].sort().filter((n) => !doc.includes(`\`${n}\``));
    expect(names.size, 'the scan found no THRONG_* variables at all').toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('README.md stays an entry point', () => {
  it('is short, and links down to installation, quick start, the docs index and CONTRIBUTING', () => {
    const readme = read(join(ROOT, 'README.md'));
    expect(readme.split(/\r?\n/).length, 'README.md has grown past an entry point').toBeLessThanOrEqual(150);
    for (const target of ['docs/installation.md', 'docs/quick-start.md', 'docs/README.md', 'CONTRIBUTING.md']) {
      expect(readme.includes(`(${target}`), `README.md does not link ${target}`).toBe(true);
    }
  });
});
