import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { applyDeclaredBounds } from '../../src/config/bounds-guard.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { resetSettingValue } from '../../src/config/shipped-defaults.js';
import { KNOWN_FILE_EXTENSIONS } from '../../src/links/known-extensions.js';
import { protocolAllowlistSet } from '../../src/links/protocol-uri.js';

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
 *
 * ══ SUPERSEDED AGAIN — round five (#408) ══
 *
 * `editor.links.knownFileExtensions` inverted from round four's `{ added, removed }` delta into the
 * one list a user actually edits (shipped as `KNOWN_FILE_EXTENSIONS` itself), and
 * `terminals.linkHoverDelayMs` is RETIRED — its own describe block, at the foot of this file, follows
 * `defaultAction`'s pattern above exactly.
 */

/** Read a dotted path out of a plain object. */
function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

/**
 * 045 T246 (FR-159; data-model §16.4) — the round-four leaf that survives round five unchanged.
 * Spread into the whole-block expectations below, which were written before it existed.
 */
const ROUND_FOUR_DEFAULTS = {
  protocolAllowlist: ['mailto', 'tel', 'slack'],
};

/** The five values FR-050 shipped, as a user's settings.json may still hold them. */
const RETIRED_VALUES = ['throng', 'editor', 'preview', 'osExplorer', 'osDefaultProgram'] as const;

describe('editor.links — the link settings after the amendment (FR-060, FR-112, FR-120)', () => {
  it('ships both detection switches ON, a 2000 ms resolution timeout, and NO default action', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links).toEqual({
      detectInEditors: true,
      detectInTerminals: true,
      existenceCheckTimeoutMs: 2000,
      ...ROUND_FOUR_DEFAULTS,
      knownFileExtensions: [...KNOWN_FILE_EXTENSIONS],
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
      ...ROUND_FOUR_DEFAULTS,
      knownFileExtensions: [...KNOWN_FILE_EXTENSIONS],
    });
  });

  it('the parsed block is never the shipped defaults object itself', () => {
    // A shared reference lets one reader's mutation edit the shipped defaults for the whole process.
    expect(parseAppSettings({}).editor.links).not.toBe(DEFAULT_APP_SETTINGS.editor.links);
    expect(parseAppSettings({}).editor.links).not.toBe(parseAppSettings({}).editor.links);
  });
});

describe('editor.links.existenceCheckTimeoutMs is bounded 250 – 25,000 (FR-120)', () => {
  it('the declared bounds hold an out-of-range value inside 250 – 25,000', () => {
    for (const raw of [0, 1, 249, 30_001, 999_999]) {
      const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
      (at(doc, 'editor.links') as Record<string, unknown>).existenceCheckTimeoutMs = raw;
      const { value } = applyDeclaredBounds(doc, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      const got = at(value, 'editor.links.existenceCheckTimeoutMs');
      expect(typeof got, String(raw)).toBe('number');
      expect(got as number, String(raw)).toBeGreaterThanOrEqual(250);
      expect(got as number, String(raw)).toBeLessThanOrEqual(25_000);
    }
  });

  it('an in-range value passes the bounds unchanged', () => {
    for (const raw of [250, 2000, 25_000]) {
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
        ...ROUND_FOUR_DEFAULTS,
        knownFileExtensions: [...KNOWN_FILE_EXTENSIONS],
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

/*
 * 045 T246 (FR-159; data-model §16.4) — the round-four leaf that round five leaves untouched.
 *
 * Tolerant parse: a non-array leaf falls back to its own default; a non-string item is dropped. The
 * strings themselves are kept AS TYPED — the preferences list commits every keystroke and adds a row as
 * `''`, so a parse that trimmed or dropped empties would delete the row being typed into. FR-159b's
 * normalisation happens where the values are COMPARED (`protocolAllowlistSet`).
 */
describe('editor.links.protocolAllowlist — defaults and tolerant parse (FR-159)', () => {
  it('ships the allowlist as mailto, tel, slack', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links.protocolAllowlist).toEqual(['mailto', 'tel', 'slack']);
  });

  it('a non-array leaf falls back to its own default', () => {
    for (const bad of [null, 0, 'mailto', true, {}]) {
      const s = parseAppSettings({ editor: { links: { protocolAllowlist: bad } } });
      expect(s.editor.links.protocolAllowlist, String(bad)).toEqual(['mailto', 'tel', 'slack']);
    }
  });

  it('non-string items are dropped; strings are kept as typed, empties included', () => {
    const s = parseAppSettings({
      editor: { links: { protocolAllowlist: ['mailto', 3, null, ' Slack ', ''] } },
    });
    expect(s.editor.links.protocolAllowlist).toEqual(['mailto', ' Slack ', '']);
  });

  it('an explicit empty list is honoured — not replaced by the default', () => {
    const s = parseAppSettings({ editor: { links: { protocolAllowlist: [] } } });
    expect(s.editor.links.protocolAllowlist).toEqual([]);
  });

  it('ROUND-TRIP: a non-default value survives a parse of a parsed document', () => {
    const once = parseAppSettings({ editor: { links: { protocolAllowlist: ['zoommtg'] } } });
    const twice = parseAppSettings(once);
    expect(twice.editor.links.protocolAllowlist).toEqual(['zoommtg']);
  });

  it('the parsed list is never the shipped defaults’ own array', () => {
    const a = parseAppSettings({});
    const b = parseAppSettings({});
    expect(a.editor.links.protocolAllowlist).not.toBe(DEFAULT_APP_SETTINGS.editor.links.protocolAllowlist);
    expect(a.editor.links.protocolAllowlist).not.toBe(b.editor.links.protocolAllowlist);
  });
});

describe('FR-159b — allowlist entries are normalised where they are compared', () => {
  it('`slack:`, ` Slack ` and `zoommtg://` normalise to slack / zoommtg; an empty entry is ignored', () => {
    const s = parseAppSettings({
      editor: { links: { protocolAllowlist: ['slack:', ' Slack ', 'zoommtg://', '', '   '] } },
    });
    expect([...protocolAllowlistSet(s.editor.links.protocolAllowlist)].sort()).toEqual(['slack', 'zoommtg']);
  });
});

describe('Reset to Defaults restores the shipped allowlist', () => {
  it('restores mailto, tel, slack', () => {
    const customised = parseAppSettings({ editor: { links: { protocolAllowlist: [] } } });
    const reset = resetSettingValue(customised, 'editor.links.protocolAllowlist');
    expect(reset!.editor.links.protocolAllowlist).toEqual(['mailto', 'tel', 'slack']);
  });
});

/*
 * 045 round five (#408) — `editor.links.knownFileExtensions` inverted from a two-list delta into the
 * one list a user actually edits: the WHOLE effective set, shipped as `KNOWN_FILE_EXTENSIONS` itself.
 *
 * A plain array is the current shape and is honoured AS TYPED, exactly as `protocolAllowlist` is — an
 * explicit `[]` means no extension ever ends a spaced path, not "use the shipped list". A document
 * still holding round four's `{ added, removed }` shape is migrated ONCE, on read, reusing
 * `resolveKnownExtensions` so the migration's normalisation (leading dot optional, case-insensitive)
 * is the same function that used to compute the effective set — not a re-implementation of it.
 */
describe('editor.links.knownFileExtensions — round five: one list, not a delta (#408)', () => {
  it('ships the shipped extension list itself', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links.knownFileExtensions).toEqual([...KNOWN_FILE_EXTENSIONS]);
  });

  it('a plain array is honoured as typed, non-string items dropped', () => {
    const s = parseAppSettings({
      editor: { links: { knownFileExtensions: ['FOO', 3, null, ' .Bar ', ''] } },
    });
    expect(s.editor.links.knownFileExtensions).toEqual(['FOO', ' .Bar ', '']);
  });

  it('an explicit empty list is honoured — no extension ever ends a spaced path', () => {
    const s = parseAppSettings({ editor: { links: { knownFileExtensions: [] } } });
    expect(s.editor.links.knownFileExtensions).toEqual([]);
  });

  it('a non-array, non-edit value falls back to the shipped list', () => {
    for (const bad of [null, 0, 'md', true]) {
      const s = parseAppSettings({ editor: { links: { knownFileExtensions: bad } } });
      expect(s.editor.links.knownFileExtensions, String(bad)).toEqual([...KNOWN_FILE_EXTENSIONS]);
    }
  });

  it('a bad leaf does not take its siblings down', () => {
    const s = parseAppSettings({
      editor: { links: { protocolAllowlist: 'x', knownFileExtensions: ['foo'] } },
    });
    expect(s.editor.links.protocolAllowlist).toEqual(['mailto', 'tel', 'slack']);
    expect(s.editor.links.knownFileExtensions).toEqual(['foo']);
  });

  it('ROUND-TRIP: a non-default value survives a parse of a parsed document', () => {
    const once = parseAppSettings({ editor: { links: { knownFileExtensions: ['foo', 'bar'] } } });
    const twice = parseAppSettings(once);
    expect(twice.editor.links.knownFileExtensions).toEqual(['foo', 'bar']);
  });

  it('the parsed list is never the shipped defaults’ own array', () => {
    const a = parseAppSettings({});
    const b = parseAppSettings({});
    expect(a.editor.links.knownFileExtensions).not.toBe(DEFAULT_APP_SETTINGS.editor.links.knownFileExtensions);
    expect(a.editor.links.knownFileExtensions).not.toBe(b.editor.links.knownFileExtensions);
  });

  it('Reset to Defaults restores the shipped list', () => {
    const customised = parseAppSettings({ editor: { links: { knownFileExtensions: ['foo'] } } });
    const reset = resetSettingValue(customised, 'editor.links.knownFileExtensions');
    expect(reset!.editor.links.knownFileExtensions).toEqual([...KNOWN_FILE_EXTENSIONS]);
  });

  describe('migrating round four’s `{ added, removed }` shape, once, on read', () => {
    it('no edits migrates to the shipped list', () => {
      const s = parseAppSettings({
        editor: { links: { knownFileExtensions: { added: [], removed: [] } } },
      });
      expect([...s.editor.links.knownFileExtensions].sort()).toEqual([...KNOWN_FILE_EXTENSIONS].sort());
    });

    it('added and removed apply, normalised (leading dot optional, case-insensitive)', () => {
      const s = parseAppSettings({
        editor: { links: { knownFileExtensions: { added: ['.FOO'], removed: [' log '] } } },
      });
      const set = new Set(s.editor.links.knownFileExtensions);
      expect(set.has('foo')).toBe(true);
      expect(set.has('log')).toBe(false);
      expect(set.has('md')).toBe(true);
    });

    it('`*` in removed empties the shipped half; an addition still survives it', () => {
      const s = parseAppSettings({
        editor: { links: { knownFileExtensions: { added: ['foo'], removed: ['*'] } } },
      });
      expect(s.editor.links.knownFileExtensions).toEqual(['foo']);
    });

    it('the migrated value is not written back until the next ordinary write — re-parsing it is a no-op', () => {
      const migrated = parseAppSettings({
        editor: { links: { knownFileExtensions: { added: ['foo'], removed: ['log'] } } },
      });
      const reparsed = parseAppSettings(migrated);
      expect(reparsed.editor.links.knownFileExtensions).toEqual(migrated.editor.links.knownFileExtensions);
      expect(JSON.stringify(migrated)).not.toContain('"added"');
      expect(JSON.stringify(migrated)).not.toContain('"removed"');
    });

    it('a malformed edits object (neither list an array) falls back to the shipped list', () => {
      const s = parseAppSettings({
        editor: { links: { knownFileExtensions: { added: 'foo', removed: 7 } } },
      });
      expect(s.editor.links.knownFileExtensions).toEqual([...KNOWN_FILE_EXTENSIONS]);
    });
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
      terminals: { advertiseHyperlinks: false, shellIntegration: false, commandPollMs: 900 },
    });
    expect(s.terminals.advertiseHyperlinks).toBe(false);
    expect(s.terminals.shellIntegration).toBe(false);
    expect(s.terminals.commandPollMs).toBe(900);
  });
});

/**
 * 045 round five (#408) — `terminals.linkHoverDelayMs` is RETIRED. The terminal's custom hover
 * tooltip is replaced by a native HTML `title`, whose delay belongs to the OS and cannot be
 * configured. Same pattern as `editor.links.defaultAction` above: no leaf, no descriptor, a
 * persisted value dropped by the tolerant parse, the next ordinary write leaves it out.
 */
describe('terminals.linkHoverDelayMs is RETIRED — a persisted value is dropped (round five, #408)', () => {
  it('has no field on the shipped defaults', () => {
    expect('linkHoverDelayMs' in DEFAULT_APP_SETTINGS.terminals).toBe(false);
  });

  it('a persisted value parses to no linkHoverDelayMs and leaves the rest of the section intact', () => {
    const s = parseAppSettings({
      terminals: { linkHoverDelayMs: 900, shellIntegration: false, commandPollMs: 750 },
    });
    expect('linkHoverDelayMs' in s.terminals).toBe(false);
    expect(s.terminals.shellIntegration).toBe(false);
    expect(s.terminals.commandPollMs).toBe(750);
  });

  it('parse → serialise → parse → serialise is a fixed point — the idempotent re-run', () => {
    const persisted = { terminals: { linkHoverDelayMs: 250, shellIntegration: false } };
    const firstWrite = JSON.stringify(parseAppSettings(persisted));
    const secondWrite = JSON.stringify(parseAppSettings(JSON.parse(firstWrite)));
    expect(secondWrite).toBe(firstWrite);
    expect(firstWrite).not.toContain('linkHoverDelayMs');
  });

  it('has no descriptor', () => {
    expect(SETTINGS_METADATA.find((d) => d.key === 'terminals.linkHoverDelayMs')).toBeUndefined();
  });
});
