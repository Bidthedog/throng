import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

/**
 * 054 T058 — every setting this spec adds has a descriptor and a production reader (Principle X, FR-060).
 *
 * `settings-inertness-047.test.ts` is the pattern, and its header explains the three read shapes and why
 * a bare mention is not a read. Two leaves are new:
 *
 * - `editor.previews.providers.<id>.openTarget`, one per text provider (FR-051). Its leaf collides with
 *   the unrelated `editor.openTarget`, so the read that counts is a call to `previewOpenTargetFor`, the
 *   one function that resolves it for a path — defined in the config layer, so it is the CALL outside
 *   that layer which proves the setting moves something.
 * - `editor.previews.providers.markdown.renderMermaid` (FR-041), read by the Markdown body's block pass.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const CONFIG_LAYER = ['app-settings.ts', 'settings-metadata.ts', 'metadata.ts', 'shipped-defaults.ts', 'preview-settings.ts'];

const PREVIEW_SECTION = /\b(?:previews?|providers?)\b/;

const textProviders = SHIPPED_PREVIEW_PROVIDERS.list().filter((p) => p.kind === 'text');

const NEW_KEYS: readonly { key: string; governs: string; read: RegExp }[] = [
  ...textProviders.map((p) => ({
    key: `editor.previews.providers.${p.id}.openTarget`,
    governs: `where a standalone ${p.displayName} preview opens (FR-051)`,
    read: /\bpreviewOpenTargetFor\(/,
  })),
  {
    key: 'editor.previews.providers.markdown.renderMermaid',
    governs: 'whether a mermaid block in a Markdown preview draws as a diagram (FR-041)',
    read: /\.\s*renderMermaid\b|\{[^}]*\brenderMermaid\b[^}]*\}\s*=/,
  },
];

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

describe('054 adds no inert setting (T058)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('describes every new leaf', () => {
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  it('has production code reading every one of them', () => {
    const sources = productionSources();
    const inert = NEW_KEYS.filter(
      ({ read }) => !sources.some(({ text }) => PREVIEW_SECTION.test(text) && read.test(text)),
    ).map(({ key, governs }) => `${key} (should govern ${governs})`);
    expect(inert, `Rendered as live controls but read by nothing: ${inert.join('; ')}`).toEqual([]);
  });
});
