import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { applyDeclaredBounds } from '../../src/config/bounds-guard.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 045 FR-060, FR-080b, and the 2026-09-18 amendment FR-112, FR-113, FR-120 — the settings leaves
 * (`contracts/settings-and-environment.md` §1 and §6.1).
 *
 * Each leaf needs FOUR edits in `app-settings.ts`, and the fourth is the one that fails silently:
 * a field in the interface, the defaults and the tolerant parse but NOT in the section's `clone…`
 * compiles, ships, and is dropped on every write — the user's value comes back as the default and
 * nothing anywhere says so (`app-settings.ts:1017-1019`, 039's own note). So the round-trip cases
 * below are not belt-and-braces; they are the only thing that catches that edit being missed.
 *
 * ══ SUPERSEDED 2026-09-18 (T143) ══
 *
 * `editor.links.defaultAction` is RETIRED (FR-112): there is no leaf, no value array and no
 * descriptor. A persisted value is dropped by the tolerant parse — `linkSettings` rebuilds the block
 * from the leaves it knows — and the next ordinary write leaves it out, which is 019 FR-023's
 * mechanism for `explorer.openMode` (FR-113). The cases that pinned FR-050's five values were
 * rewritten here as the supersession permits; nothing else in this file changed meaning.
 */

/** Read a dotted path out of a plain object. */
function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

/** The five values FR-050 shipped, as a user's settings.json may still hold them. */
const RETIRED_VALUES = ['throng', 'editor', 'preview', 'osExplorer', 'osDefaultProgram'] as const;

describe('editor.links — the link settings after the amendment (FR-060, FR-112, FR-120)', () => {
  it('ships both detection switches ON and a 2000 ms existence-check timeout, and NO default action', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links).toEqual({
      detectInEditors: true,
      detectInTerminals: true,
      existenceCheckTimeoutMs: 2000,
    });
    expect('defaultAction' in DEFAULT_APP_SETTINGS.editor.links).toBe(false);
  });

  it('falls back for a wrong type, per leaf', () => {
    for (const bad of [null, 0, 'true', 'yes', [], {}]) {
      const s = parseAppSettings({
        editor: { links: { detectInEditors: bad, detectInTerminals: bad } },
      });
      expect(s.editor.links.detectInEditors, String(bad)).toBe(true);
      expect(s.editor.links.detectInTerminals, String(bad)).toBe(true);
    }
    for (const bad of [null, '', '3000', [], {}, true]) {
      expect(
        parseAppSettings({ editor: { links: { existenceCheckTimeoutMs: bad } } }).editor.links
          .existenceCheckTimeoutMs,
        String(bad),
      ).toBe(2000);
    }
  });

  it('parses an in-range timeout', () => {
    expect(
      parseAppSettings({ editor: { links: { existenceCheckTimeoutMs: 5000 } } }).editor.links
        .existenceCheckTimeoutMs,
    ).toBe(5000);
  });

  it('a bad leaf does not take its siblings down with it', () => {
    const s = parseAppSettings({
      editor: { links: { existenceCheckTimeoutMs: 'nonsense', detectInTerminals: false } },
    });
    expect(s.editor.links.existenceCheckTimeoutMs).toBe(2000);
    expect(s.editor.links.detectInTerminals).toBe(false);
    expect(s.editor.links.detectInEditors).toBe(true);
  });

  it('a missing or malformed links block falls back whole', () => {
    expect(parseAppSettings({ editor: {} }).editor.links).toEqual(DEFAULT_APP_SETTINGS.editor.links);
    expect(parseAppSettings({ editor: { links: 'off' } }).editor.links).toEqual(
      DEFAULT_APP_SETTINGS.editor.links,
    );
  });

  it('ROUND-TRIP: a non-default value of every leaf survives a parse of a parsed document', () => {
    const once = parseAppSettings({
      editor: {
        links: { detectInEditors: false, detectInTerminals: false, existenceCheckTimeoutMs: 7500 },
      },
    });
    const twice = parseAppSettings(once);
    expect(twice.editor.links).toEqual({
      detectInEditors: false,
      detectInTerminals: false,
      existenceCheckTimeoutMs: 7500,
    });
  });

  it('the parsed block is never the shipped defaults object itself', () => {
    // A shared reference lets one reader's mutation edit the shipped defaults for the whole process.
    expect(parseAppSettings({}).editor.links).not.toBe(DEFAULT_APP_SETTINGS.editor.links);
    expect(parseAppSettings({}).editor.links).not.toBe(parseAppSettings({}).editor.links);
  });
});

describe('editor.links.existenceCheckTimeoutMs is bounded 250 – 30,000 (FR-120)', () => {
  it('the declared bounds hold an out-of-range value inside 250 – 30,000', () => {
    for (const raw of [0, 1, 249, 30_001, 999_999]) {
      const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
      (at(doc, 'editor.links') as Record<string, unknown>).existenceCheckTimeoutMs = raw;
      const { value } = applyDeclaredBounds(doc, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      const got = at(value, 'editor.links.existenceCheckTimeoutMs');
      expect(typeof got, String(raw)).toBe('number');
      expect(got as number, String(raw)).toBeGreaterThanOrEqual(250);
      expect(got as number, String(raw)).toBeLessThanOrEqual(30_000);
    }
  });

  it('an in-range value passes the bounds unchanged', () => {
    for (const raw of [250, 2000, 30_000]) {
      const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
      (at(doc, 'editor.links') as Record<string, unknown>).existenceCheckTimeoutMs = raw;
      const { value } = applyDeclaredBounds(doc, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(value, 'editor.links.existenceCheckTimeoutMs'), String(raw)).toBe(raw);
    }
  });
});

describe('editor.links.defaultAction is RETIRED — a persisted value is dropped (FR-112, FR-113)', () => {
  it('each of the five retired values, and a junk one, parses to no defaultAction and leaves the rest intact', () => {
    for (const retired of [...RETIRED_VALUES, 'nonsense']) {
      const s = parseAppSettings({
        editor: {
          links: {
            defaultAction: retired,
            detectInEditors: false,
            detectInTerminals: false,
            existenceCheckTimeoutMs: 4000,
          },
        },
      });
      expect('defaultAction' in s.editor.links, retired).toBe(false);
      expect(s.editor.links, retired).toEqual({
        detectInEditors: false,
        detectInTerminals: false,
        existenceCheckTimeoutMs: 4000,
      });
    }
  });

  it('parse → serialise → parse → serialise is a fixed point — the idempotent re-run (FR-113)', () => {
    for (const retired of [...RETIRED_VALUES, 'nonsense']) {
      const persisted = {
        editor: { links: { defaultAction: retired, detectInTerminals: false } },
      };
      const firstWrite = JSON.stringify(parseAppSettings(persisted));
      const secondWrite = JSON.stringify(parseAppSettings(JSON.parse(firstWrite)));
      expect(secondWrite, retired).toBe(firstWrite);
      expect(firstWrite, retired).not.toContain('defaultAction');
    }
  });
});

describe('terminals.advertiseHyperlinks (FR-080b)', () => {
  it('ships ON', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.advertiseHyperlinks).toBe(true);
  });

  it('parses a boolean and falls back for anything else', () => {
    expect(
      parseAppSettings({ terminals: { advertiseHyperlinks: false } }).terminals.advertiseHyperlinks,
    ).toBe(false);
    for (const bad of [null, 0, 'false', 'off', [], {}]) {
      expect(
        parseAppSettings({ terminals: { advertiseHyperlinks: bad } }).terminals.advertiseHyperlinks,
        String(bad),
      ).toBe(true);
    }
  });

  it('ROUND-TRIP: an OFF value survives a parse of a parsed document', () => {
    const once = parseAppSettings({ terminals: { advertiseHyperlinks: false } });
    expect(parseAppSettings(once).terminals.advertiseHyperlinks).toBe(false);
  });

  it('it does not disturb its neighbours in the terminal section', () => {
    const s = parseAppSettings({
      terminals: { advertiseHyperlinks: false, shellIntegration: false, linkHoverDelayMs: 900 },
    });
    expect(s.terminals.advertiseHyperlinks).toBe(false);
    expect(s.terminals.shellIntegration).toBe(false);
    expect(s.terminals.linkHoverDelayMs).toBe(900);
  });
});
