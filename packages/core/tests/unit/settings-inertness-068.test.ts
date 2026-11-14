import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 068 — every setting this spec adds has a descriptor and a production reader (Principle X: nothing
 * inert). `settings-inertness-057.test.ts` is the pattern. The config layer is excluded, since it only
 * declares, parses and clones the values: a read is code OUTSIDE it that makes a decision from one.
 *
 * Layer: unit — a source scan, no app.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_LAYER = ['packages', 'core', 'src', 'config'].join(sep);

const NEW_KEYS = [
  {
    key: 'notifications.toastDurationMs',
    governs: 'how long every toast stays before it leaves (FR-021c)',
    read: (t: string) => /\.toastDurationMs\b/.test(t),
  },
  {
    key: 'notifications.toastWidthPx',
    governs: 'how wide every toast is (FR-076)',
    read: (t: string) => /\.toastWidthPx\b/.test(t),
  },
  {
    key: 'notifications.confirmDismissAll',
    governs: 'whether Dismiss all asks first (FR-026c)',
    read: (t: string) => /\bconfirmDismissAll\b/.test(t) && /confirm\(/.test(t),
  },
  {
    key: 'notifications.panelLimit',
    governs: 'how many entries the Notifications panel keeps before dropping the oldest (FR-031d)',
    read: (t: string) => /\.panelLimit\b/.test(t),
  },
] as const;

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (p.includes(CONFIG_LAYER)) continue;
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push({ file: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) {
    const src = join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

describe('068 adds no inert setting', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);
  const sources = productionSources();

  it.each(NEW_KEYS)('$key has a descriptor', ({ key }) => {
    expect(declared).toContain(key);
  });

  it.each(NEW_KEYS)('$key is read by production code: it governs $governs', ({ key, read }) => {
    const readers = sources.filter((s) => read(s.text));
    expect(readers.map((r) => r.file), `${key} is declared and parsed but nothing reads it`).not.toEqual([]);
  });
});
