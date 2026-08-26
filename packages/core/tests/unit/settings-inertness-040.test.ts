import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 040 FR-052 — every setting this feature adds does something, and no existing one was made inert.
 *
 * ══ WHAT AN INERT SETTING IS, AND WHY IT IS A DEFECT RATHER THAN AN OVERSIGHT ══
 *
 * A setting is inert when it is declared, defaulted, persisted, rendered as a live control in the
 * Settings editor — and read by nothing. The user changes it, the app writes it to `settings.json`,
 * and nothing happens. That is #95's `explorer.openMode`, which shipped that way for a year, and
 * #108 is the fleet-wide guard being written to catch the class. FR-052's whole content is that
 * this feature must hand that guard nothing new to find.
 *
 * ══ THE SHAPE OF THE ASSERTION ══
 *
 * This is `settings-open-on-click-single-owner.test.ts`'s second test, aimed at three specific
 * keys: a key that appears in `SETTINGS_METADATA` (so a control is rendered for it) must be READ
 * somewhere outside the config layer. A mention in `app-settings.ts` or `settings-metadata.ts`
 * proves the setting EXISTS; it never proves anything acts on it, which is exactly how an inert
 * setting hides.
 *
 * ══ WHY THIS IS A UNIT TEST AND NOT A COMPONENT ONE ══
 *
 * The claim is about the whole repository's source, not about a rendered form — the component tier
 * can prove a checkbox is drawn and toggled, which is the half that was never in doubt. What no
 * rendered component can show is that NOTHING ANYWHERE reads the value, because the evidence for
 * that is an absence across every file. This tier can read every file.
 *
 * A reader here is not proof the effect is CORRECT — that is what
 * `packages/ui/tests/component/status-strip-settings.test.ts`, `gutter-compartment.test.ts` and the
 * gutter E2E are for. It is proof the wire exists at all, which is the only thing an inertness
 * guard can honestly claim.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The config layer: where a setting is declared, parsed, defaulted, shipped and persisted. Every
 * one of these files names every key by construction, so a match here is worth nothing.
 */
const CONFIG_LAYER = [
  'app-settings.ts',
  'settings-metadata.ts',
  'metadata.ts',
  'shipped-defaults.ts',
];

/** The three keys 040 adds, with the surface each is supposed to move. */
const NEW_KEYS = [
  { key: 'editor.statusBar.showCursorPosition', governs: 'the line and column readouts (FR-030)' },
  { key: 'editor.statusBar.showCounts', governs: 'all three counts (FR-031)' },
  { key: 'editor.showGutter', governs: 'the line-number gutter in both editors (FR-040)' },
] as const;

/**
 * Existing settings this feature stood next to, rewired or re-grouped — the ones a change of this
 * shape could plausibly have unplugged.
 *
 * `editor.showStatusBar` is the sharpest of them: 040 gave the bar two new preferences and FR-033
 * says this one still hides the WHOLE bar, overriding both. A refactor that made the strip consult
 * only the new pair would leave this key rendered, stored, and dead.
 *
 * (`showStatusBar` is also `terminals.showStatusBar`'s leaf name. The match below is by leaf, so it
 * cannot tell the two apart — which is acceptable for a liveness check and is why this list is a
 * backstop rather than the feature's own coverage. `status-strip-settings.test.ts` asserts what the
 * editor's flag actually does.)
 */
const NEIGHBOURS = ['editor.showStatusBar', 'editor.defaultWordWrap', 'editor.persistUndoHistory'];

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
 * Files that READ the leaf of `key`. Deliberately idiom-broad, because this codebase reads settings
 * several ways and the requirement is about the value being consumed at all, not about how:
 *
 *   `useAppSettings().editor.showGutter`, `settings.showGutter`     → `.leaf`
 *   `const { showCounts } = readoutPrefs`                           → destructure
 *
 * A bare mention of the identifier is NOT enough, and that is the point: `draw(showGutter)` merely
 * names a PARAMETER, which is precisely how #95 hid — the caller passed a different setting into it.
 */
function readersOf(key: string, sources: { file: string; text: string }[]): string[] {
  const leaf = key.split('.').pop() as string;
  const propertyRead = new RegExp(`\\.\\s*${leaf}\\b`);
  const destructured = new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
  return sources
    .filter(({ text }) => propertyRead.test(text) || destructured.test(text))
    .map(({ file }) => file.slice(REPO_ROOT.length).replace(/\\/g, '/'));
}

describe('040 adds no inert setting (FR-052)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all three keys', () => {
    // The premise of the test below. A key with no descriptor is not inert — it is invisible, which
    // is a different defect and one `settings-metadata-040.test.ts` and the completeness gate own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  it('has production code reading every one of them', () => {
    const sources = productionSources();
    const inert = NEW_KEYS.filter(({ key }) => readersOf(key, sources).length === 0).map(
      ({ key, governs }) => `${key} (should govern ${governs})`,
    );
    expect(
      inert,
      `These settings are rendered as live controls in Preferences but nothing outside the config ` +
        `layer reads them, so changing them does nothing: ${inert.join('; ')}`,
    ).toEqual([]);
  });

  it('names where each one is read, so the wire can be checked by eye', () => {
    // Not a stronger assertion than the one above — a REPORT. An inertness guard that only ever
    // says "fine" teaches a later reader nothing about where to look when it stops saying so.
    const sources = productionSources();
    for (const { key } of NEW_KEYS) {
      const readers = readersOf(key, sources);
      expect(readers.length, `${key} is read in: ${readers.join(', ')}`).toBeGreaterThan(0);
    }
  });
});

describe('040 made no existing setting inert (FR-052)', () => {
  it('leaves its neighbours in the Editor section still being read', () => {
    /*
     * The other half of FR-052, and the half a feature is likeliest to break by accident: the bar
     * was rebuilt around two new preferences, and a strip that consulted only those would silently
     * unplug `editor.showStatusBar` while every new test passed.
     */
    const sources = productionSources();
    const unplugged = NEIGHBOURS.filter((key) => readersOf(key, sources).length === 0);
    expect(
      unplugged,
      `040 left these existing settings with no reader outside the config layer: ` +
        `${unplugged.join(', ')}. FR-052 forbids making an existing setting inert.`,
    ).toEqual([]);
  });
});
