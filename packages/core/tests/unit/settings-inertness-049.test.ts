import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 049 T036 — the one setting this spec adds, which core itself does not consume (Principle X). Its readers
 * are the editor's occurrence extension and the preview's occurrence painter (T038, T040), so this guard is
 * EXPECTED TO STAY RED until the first of them lands. `settings-inertness-047.test.ts` is the pattern
 * (including why a bare identifier mention is not a read) and is not re-explained here.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const CONFIG_LAYER = ['app-settings.ts', 'settings-metadata.ts', 'metadata.ts', 'shipped-defaults.ts'];

const KEY = 'editor.highlightOccurrences';
const GOVERNS = 'whether a selection tints its other occurrences in editors and Markdown previews (FR-019)';
const SECTION = /\boccurrences?\b/i;

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry) && !CONFIG_LAYER.some((c) => p.endsWith(c))) {
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

describe('049 adds no inert setting (T036)', () => {
  it('renders a control for the key', () => {
    expect(SETTINGS_METADATA.map((d) => d.key)).toContain(KEY);
  });

  it('has production code reading it', () => {
    const propertyRead = /\.\s*highlightOccurrences\b/;
    const destructured = /\{[^}]*\bhighlightOccurrences\b[^}]*\}\s*=/;
    const readers = productionSources().filter(
      ({ text }) => SECTION.test(text) && (propertyRead.test(text) || destructured.test(text)),
    );
    expect(readers.length, `${KEY} is a live control nothing reads (should govern ${GOVERNS})`).toBeGreaterThan(0);
  });
});
