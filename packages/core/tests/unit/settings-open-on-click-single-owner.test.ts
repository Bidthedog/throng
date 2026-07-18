/**
 * Regression guard for #95 — "Two settings claim to open files on click; the File
 * Explorer one (explorer.openMode) is inert".
 *
 * These tests encode the REQUIREMENT, not today's implementation:
 *
 *   1. No two controls rendered in Preferences may claim the same job. Exactly one
 *      setting governs which file-tree click opens a file.
 *   2. A setting rendered in Preferences must do something when changed — so the
 *      setting that claims that job must actually be read by production code
 *      outside the config layer that merely declares/parses/persists it.
 *
 * Both assertions are deliberately agnostic about WHICH way #95 is fixed. They pass
 * if `explorer.openMode` is removed and `editor.openOnClick` remains the single
 * owner; they equally pass if `explorer.openMode` is wired up and
 * `editor.openOnClick` retired. They fail only while BOTH are rendered, or while the
 * surviving owner is inert.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * The keys that claim the "which click opens a file from the tree" job. Both
 * descriptions in Preferences describe this one behaviour:
 *   explorer.openMode      "Whether a single or double click opens a file from the tree."
 *   editor.openOnClick     — the trigger 006 moved this behaviour to.
 * The requirement is that AT MOST ONE of these is a live control.
 */
const OPEN_ON_CLICK_CLAIMANTS = ['explorer.openMode', 'editor.openOnClick'] as const;

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The config layer: where a setting is declared, parsed, defaulted and persisted.
 * A mention here proves only that the setting EXISTS, never that anything acts on
 * it — so these files cannot count as consumers.
 */
const CONFIG_LAYER = ['app-settings.ts', 'settings-metadata.ts', 'metadata.ts'];

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

/**
 * Find production code that READS a settings leaf. Deliberately idiom-broad, because
 * this codebase reads settings several ways and the requirement is about the value
 * being consumed at all, not about how:
 *   - `useAppSettings().editor.openOnClick`, `settings.explorer.openMode` → `.leaf`
 *   - `explorerSettings.dragCopyModifier`, `e.openMode`                   → `.leaf`
 *   - `const { openMode } = settings.explorer`                            → destructure
 * A bare mention of the identifier is NOT enough: `decideClick(openMode, …)` merely
 * names a PARAMETER `openMode`, which is exactly how #95 hides — the tree calls that
 * parameter with `editor.openOnClick`, never with `explorer.openMode`.
 */
function readersOf(key: string, sources: { file: string; text: string }[]): string[] {
  const leaf = key.split('.').pop() as string;
  const propertyRead = new RegExp(`\\.\\s*${leaf}\\b`);
  const destructured = new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
  return sources
    .filter(({ text }) => propertyRead.test(text) || destructured.test(text))
    .map(({ file }) => file.slice(REPO_ROOT.length).replace(/\\/g, '/'));
}

describe('#95 — file-tree open-on-click has exactly one owner', () => {
  const rendered = SETTINGS_METADATA.map((d) => d.key);
  const renderedClaimants = OPEN_ON_CLICK_CLAIMANTS.filter((k) => rendered.includes(k));

  it('renders exactly one control claiming the open-on-click job', () => {
    // Two live controls for one behaviour is the bug: the user cannot tell which
    // one governs the click, and only one of them does.
    expect(
      renderedClaimants,
      `Preferences renders ${renderedClaimants.length} controls that all claim to govern ` +
        `which file-tree click opens a file. At most one setting may own a behaviour.`,
    ).toHaveLength(1);
  });

  it('every rendered open-on-click control is actually read by production code', () => {
    const sources = productionSources();
    const inert = renderedClaimants.filter((key) => readersOf(key, sources).length === 0);
    expect(
      inert,
      `These settings are rendered as live controls in Preferences but nothing outside the ` +
        `config layer ever reads them, so changing them does nothing: ${inert.join(', ')}`,
    ).toEqual([]);
  });
});
