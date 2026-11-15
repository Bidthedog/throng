import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA, descriptorsForThisPlatform } from '../../src/config/settings-metadata.js';
import { linuxHostTraits, macosHostTraits } from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

/**
 * 070 — the one setting this spec adds, `terminals.macOptionIsMeta` (FR-031, research R22): a descriptor, a default
 * that lets Option type the layout's characters, a parse that keeps a boolean and nothing else, offered on macOS
 * only, and a production reader (Principle X: nothing inert). `settings-inertness-068.test.ts` is the pattern.
 *
 * Layer: unit — the model plus a source scan, no app.
 */

const KEY = 'terminals.macOptionIsMeta';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_LAYER = ['packages', 'core', 'src', 'config'].join(sep);

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

const keysShown = (): string[] => descriptorsForThisPlatform(SETTINGS_METADATA).map((d) => d.key);

describe('terminals.macOptionIsMeta (070 FR-031)', () => {
  it('ships off, so Option types the characters the keyboard layout puts on it', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.macOptionIsMeta).toBe(false);
  });

  it('honours a boolean and replaces anything else with the default', () => {
    expect(parseAppSettings({ terminals: { macOptionIsMeta: true } }).terminals.macOptionIsMeta).toBe(true);
    expect(parseAppSettings({ terminals: { macOptionIsMeta: 'yes' } }).terminals.macOptionIsMeta).toBe(false);
    expect(parseAppSettings({}).terminals.macOptionIsMeta).toBe(false);
  });

  it('survives a re-read of what was written, and a malformed section falls back to the default', () => {
    const on = parseAppSettings({ terminals: { macOptionIsMeta: true } });
    expect(parseAppSettings(JSON.parse(JSON.stringify(on))).terminals.macOptionIsMeta).toBe(true);
    expect(parseAppSettings({ terminals: 'x' }).terminals.macOptionIsMeta).toBe(false);
  });

  it('is a toggle under Terminal, offered on macOS and nowhere else', () => {
    const d = SETTINGS_METADATA.find((x) => x.key === KEY);
    expect(d?.control).toBe('toggle');
    expect(d?.group).toBe('Terminal');
    expect(d?.onlyOn).toBe('macos');
    expect(keysShown()).not.toContain(KEY);
    withHostTraits(linuxHostTraits('/run/x'), () => expect(keysShown()).not.toContain(KEY));
    withHostTraits(macosHostTraits('/tmp/throng', []), () => expect(keysShown()).toContain(KEY));
  });

  it('is read by production code: it decides whether Option sends Meta to a terminal', () => {
    const readers = productionSources().filter((s) => /\.macOptionIsMeta\b/.test(s.text) && /macOptionIsMeta:/.test(s.text));
    expect(readers.map((r) => r.file), `${KEY} is declared and parsed but nothing reads it`).not.toEqual([]);
  });
});
