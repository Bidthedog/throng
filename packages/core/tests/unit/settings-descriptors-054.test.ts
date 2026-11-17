import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

/**
 * 054 T058 — every setting this spec adds has a descriptor (Principle X, FR-060). Two leaves are new:
 *
 * - `editor.previews.providers.<id>.openTarget`, one per text provider (FR-051).
 * - `editor.previews.providers.markdown.renderMermaid` (FR-041).
 *
 * This file used to be `settings-inertness-054.test.ts` and also checked, by matching source text,
 * that production code reads each leaf. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor check stays here.
 */

const textProviders = SHIPPED_PREVIEW_PROVIDERS.list().filter((p) => p.kind === 'text');

const NEW_KEYS: readonly { key: string; governs: string }[] = [
  ...textProviders.map((p) => ({
    key: `editor.previews.providers.${p.id}.openTarget`,
    governs: `where a standalone ${p.displayName} preview opens (FR-051)`,
  })),
  {
    key: 'editor.previews.providers.markdown.renderMermaid',
    governs: 'whether a mermaid block in a Markdown preview draws as a diagram (FR-041)',
  },
];

describe('054 describes every setting it adds (T058)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('describes every new leaf', () => {
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
