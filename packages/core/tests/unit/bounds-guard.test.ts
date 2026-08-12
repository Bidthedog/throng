/**
 * 031 US2 (#227) — the generic bounds guard.
 *
 * The load-bearing test here is the FIRST one: it ENUMERATES `SETTINGS_METADATA` rather than listing
 * settings by hand. A test that named the three settings this feature adds would pass while a new
 * bounded setting went unguarded, which is precisely the failure #227 exists to prevent — and
 * precisely how `terminals.linkHoverDelayMs` came to declare 0–2000 and clamp 0–5000 unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { applyDeclaredBounds } from '../../src/config/bounds-guard.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { parseSettingsGuarded } from '../../src/config/settings-read.js';
import type { FieldDescriptor, MetadataRegistry } from '../../src/config/metadata.js';

/** Read a dotted path out of a plain object. */
function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

/** Write a dotted path into a fresh deep copy. */
function withValue<T>(base: T, path: string, value: unknown): T {
  const copy = structuredClone(base);
  const parts = path.split('.');
  const last = parts.pop()!;
  const parent = parts.reduce<Record<string, unknown>>(
    (o, k) => o[k] as Record<string, unknown>,
    copy as unknown as Record<string, unknown>,
  );
  parent[last] = value;
  return copy;
}

/** Every descriptor that declares a two-sided bound — discovered, never listed. */
const bounded = SETTINGS_METADATA.filter(
  (d): d is FieldDescriptor & { min: number; max: number } =>
    typeof d.min === 'number' && typeof d.max === 'number',
);

describe('applyDeclaredBounds — every declared bound, discovered from the registry', () => {
  it('finds bounded descriptors to check (guards the guard)', () => {
    // If this ever hits zero the enumerating tests below become vacuous and would pass forever.
    expect(bounded.length).toBeGreaterThan(10);
  });

  it('clamps a below-minimum value up to the enforced minimum, for EVERY bounded setting', () => {
    for (const d of bounded) {
      const floor = d.hardMin ?? d.min;
      const raw = withValue(DEFAULT_APP_SETTINGS, d.key, floor - 1000);
      const { value, corrected } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(value, d.key), `${d.key} should clamp up to ${floor}`).toBe(floor);
      expect(corrected, `${d.key} being clamped is a correction`).toBe(true);
    }
  });

  it('clamps an above-maximum value down to the enforced maximum, for EVERY bounded setting', () => {
    for (const d of bounded) {
      const ceiling = d.hardMax ?? d.max;
      const raw = withValue(DEFAULT_APP_SETTINGS, d.key, ceiling + 1000);
      const { value, corrected } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(value, d.key), `${d.key} should clamp down to ${ceiling}`).toBe(ceiling);
      expect(corrected, `${d.key} being clamped is a correction`).toBe(true);
    }
  });

  it('leaves a fully in-range document untouched and reports no correction', () => {
    const { value, corrected, corrections } = applyDeclaredBounds(
      structuredClone(DEFAULT_APP_SETTINGS),
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    expect(corrections).toEqual([]);
    expect(corrected, 'the shipped defaults are by definition in range').toBe(false);
    expect(value).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe('hard bounds — the control range is not always the enforced one (FR-015a-c)', () => {
  it('enforces hardMax where declared, so a deliberate wider bound survives', () => {
    // diagnostics.maxFileSizeKb declares min/max 64-4096 so its SLIDER stays aimable, while its
    // hard bound is 64 MB. A user's hand-set 64 MB log cap must not be rewritten to 4 MB.
    const raw = withValue(DEFAULT_APP_SETTINGS, 'diagnostics.maxFileSizeKb', 65_536);
    const { value, corrected } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(at(value, 'diagnostics.maxFileSizeKb')).toBe(65_536);
    expect(corrected).toBe(false);
  });

  it('still clamps beyond the hard bound', () => {
    const raw = withValue(DEFAULT_APP_SETTINGS, 'diagnostics.maxFileSizeKb', 999_999);
    const { value } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(at(value, 'diagnostics.maxFileSizeKb')).toBe(65_536);
  });

  it('uses min/max as the hard bound when no hardMin/hardMax is declared', () => {
    // The three settings that parsed wider than they declared with no stated reason (FR-015).
    for (const [key, max] of [
      ['terminals.linkHoverDelayMs', 2000],
      ['diagnostics.keepFiles', 20],
      ['search.asYouTypeDebounceMs', 1000],
    ] as const) {
      const raw = withValue(DEFAULT_APP_SETTINGS, key, max + 5000);
      const { value } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(value, key), `${key} resolves to its declared maximum`).toBe(max);
    }
  });
});

describe('wrong shapes fall back to the shipped default', () => {
  const key = 'panes.projects.maxWidth';
  for (const bad of ['300', null, undefined, NaN, Infinity, {}, []] as const) {
    it(`substitutes the default for ${JSON.stringify(bad) ?? String(bad)}`, () => {
      const raw = withValue(DEFAULT_APP_SETTINGS, key, bad);
      const { value } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(value, key)).toBe(at(DEFAULT_APP_SETTINGS, key));
    });
  }

  it('substitutes the default for a value outside a declared allowedValues set', () => {
    const raw = withValue(DEFAULT_APP_SETTINGS, 'confirmations.destroyTab', 'quintuple');
    const { value, corrected } = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(at(value, 'confirmations.destroyTab')).toBe(at(DEFAULT_APP_SETTINGS, 'confirmations.destroyTab'));
    expect(corrected).toBe(true);
  });
});

describe('never throws (FR-011)', () => {
  for (const raw of [null, undefined, 42, 'nonsense', [], { panes: 'not an object' }] as const) {
    it(`survives ${JSON.stringify(raw) ?? String(raw)}`, () => {
      expect(() => applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS)).not.toThrow();
    });
  }

  it('survives a cyclic structure', () => {
    const cyclic: Record<string, unknown> = { panes: {} };
    cyclic.self = cyclic;
    expect(() => applyDeclaredBounds(cyclic, SETTINGS_METADATA, DEFAULT_APP_SETTINGS)).not.toThrow();
  });

  it('handles a degenerate range where min equals max', () => {
    const registry: MetadataRegistry = [
      { key: 'a.b', label: 'x', description: 'x', group: 'g', control: 'slider', min: 5, max: 5, step: 1 },
    ];
    const { value } = applyDeclaredBounds({ a: { b: 99 } }, registry, { a: { b: 5 } });
    expect((value as { a: { b: number } }).a.b).toBe(5);
  });
});

describe('idempotence (FR-013d / G9)', () => {
  it('a second pass over a corrected document records nothing', () => {
    const raw = withValue(DEFAULT_APP_SETTINGS, 'panes.projects.maxWidth', 999_999);
    const once = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(once.corrected).toBe(true);
    const twice = applyDeclaredBounds(once.value, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(twice.corrections).toEqual([]);
    expect(twice.corrected).toBe(false);
  });
});

describe('a fault INSIDE a table still counts as a correction (G12 / FR-008e)', () => {
  it('sets `corrected` when a table cell is clamped, so the file is written back', () => {
    const raw = withValue(DEFAULT_APP_SETTINGS, 'editor.indentByLanguage', {
      python: { style: 'spaces', indentWidth: 500, tabWidth: 4 },
    });
    const out = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(out.corrected).toBe(true);
    expect(at(out.value, 'editor.indentByLanguage.python.indentWidth')).toBe(16);
    expect(out.corrections.some((c) => c.path === 'editor.indentByLanguage.python.indentWidth')).toBe(
      true,
    );
  });

  it('sets `corrected` when an unreadable entry is restored from the shipped default', () => {
    const shippedCsharp = DEFAULT_APP_SETTINGS.editor.indentByLanguage.csharp;
    expect(shippedCsharp, 'the fixture assumes csharp ships a profile').toBeDefined();
    const raw = withValue(DEFAULT_APP_SETTINGS, 'editor.indentByLanguage', { csharp: 'four' });
    const out = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
    expect(out.corrected).toBe(true);
    expect(out.corrections.map((c) => c.kind)).toContain('entry-restored');
    expect(at(out.value, 'editor.indentByLanguage.csharp')).toEqual(shippedCsharp);
  });
});

/**
 * 031 T033 / FR-015, FR-016 — the DECLARATION is the only range, and it is the narrower one.
 *
 * Four settings carried a hand-written clamp as well as a declared range, and three of the four
 * disagreed with their declaration. Removing the clamps is what makes the guard the single
 * mechanism (FR-009); the point of these tests is that the resulting ranges are the DECLARED ones
 * — narrower than what the parser used to accept, and deliberately so.
 */
describe('the declared range wins over the range the parser used to accept', () => {
  const declared = (key: string) => {
    const d = SETTINGS_METADATA.find((x) => x.key === key);
    expect(d, `no descriptor for ${key}`).toBeDefined();
    return d!;
  };

  const cases = [
    { key: 'terminals.linkHoverDelayMs', min: 0, max: 2000, wasAccepted: 5000 },
    { key: 'diagnostics.keepFiles', min: 1, max: 20, wasAccepted: 50 },
    { key: 'search.asYouTypeDebounceMs', min: 0, max: 1000, wasAccepted: 60_000 },
  ] as const;

  for (const c of cases) {
    it(`${c.key} resolves to its declared ${c.min}–${c.max}, not the wider parsed range`, () => {
      const d = declared(c.key);
      expect(d.min, `${c.key} min`).toBe(c.min);
      expect(d.max, `${c.key} max`).toBe(c.max);
      // No hard bound: nothing here has a stated reason for accepting more than the control offers.
      expect(d.hardMin, `${c.key} declares an undeclared-in-the-spec hardMin`).toBeUndefined();
      expect(d.hardMax, `${c.key} declares an undeclared-in-the-spec hardMax`).toBeUndefined();

      const raw = withValue(DEFAULT_APP_SETTINGS, c.key, c.wasAccepted);
      const out = applyDeclaredBounds(raw, SETTINGS_METADATA, DEFAULT_APP_SETTINGS);
      expect(at(out.value, c.key), `${c.key} was accepted at ${c.wasAccepted}`).toBe(c.max);
    });
  }

  it('leaves terminals.commandPollMs exactly where its (agreeing) clamp used to put it', () => {
    // FR-016: this one's clamp and declaration always agreed, so removing the clamp changes
    // nothing a user can observe. That is the assertion.
    const low = applyDeclaredBounds(
      withValue(DEFAULT_APP_SETTINGS, 'terminals.commandPollMs', 1),
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    const high = applyDeclaredBounds(
      withValue(DEFAULT_APP_SETTINGS, 'terminals.commandPollMs', 10_000),
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    expect(at(low.value, 'terminals.commandPollMs')).toBe(250);
    expect(at(high.value, 'terminals.commandPollMs')).toBe(5000);
  });

  it('does NOT narrow the two settings whose wider bound is declared (FR-015a)', () => {
    // The exception that proves the rule: these two carry hard bounds, so removing their clamps
    // must not cost a user the capability the clamp used to allow.
    const big = applyDeclaredBounds(
      withValue(DEFAULT_APP_SETTINGS, 'diagnostics.maxFileSizeKb', 65_536),
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    expect(at(big.value, 'diagnostics.maxFileSizeKb')).toBe(65_536);

    const small = applyDeclaredBounds(
      withValue(DEFAULT_APP_SETTINGS, 'editor.maxOpenFileBytes', 2048),
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    expect(at(small.value, 'editor.maxOpenFileBytes')).toBe(2048);
  });
});

/**
 * 031 T033 — and the clamps are GONE, not merely shadowed.
 *
 * The guard runs BEFORE the tolerant merge, so a surviving hand-written clamp is invisible through
 * the guarded path: the value has already been brought inside the declared range by the time the
 * parser sees it. The only way to assert the removal is to go at `parseAppSettings` directly and
 * find that it no longer clamps anything — that ranges live in exactly one place (FR-009).
 */
describe('parseAppSettings no longer enforces a range of its own (FR-009)', () => {
  it('passes an out-of-range value straight through — clamping is not its job', () => {
    const parsed = parseAppSettings({
      terminals: { commandPollMs: 1, linkHoverDelayMs: 99_999 },
      diagnostics: { keepFiles: 999, maxFileSizeKb: 1 },
      search: { asYouTypeDebounceMs: -5 },
    });
    expect(parsed.terminals.commandPollMs).toBe(1);
    expect(parsed.terminals.linkHoverDelayMs).toBe(99_999);
    expect(parsed.diagnostics.keepFiles).toBe(999);
    expect(parsed.diagnostics.maxFileSizeKb).toBe(1);
    expect(parsed.search.asYouTypeDebounceMs).toBe(-5);
  });

  it('still rejects values that are not numbers at all — TYPE tolerance is its job', () => {
    const parsed = parseAppSettings({
      terminals: { commandPollMs: 'often', linkHoverDelayMs: null },
      diagnostics: { keepFiles: {}, maxFileSizeKb: Number.NaN },
      search: { asYouTypeDebounceMs: 'soon' },
    });
    expect(parsed.terminals.commandPollMs).toBe(DEFAULT_APP_SETTINGS.terminals.commandPollMs);
    expect(parsed.terminals.linkHoverDelayMs).toBe(DEFAULT_APP_SETTINGS.terminals.linkHoverDelayMs);
    expect(parsed.diagnostics.keepFiles).toBe(DEFAULT_APP_SETTINGS.diagnostics.keepFiles);
    expect(parsed.diagnostics.maxFileSizeKb).toBe(DEFAULT_APP_SETTINGS.diagnostics.maxFileSizeKb);
    expect(parsed.search.asYouTypeDebounceMs).toBe(DEFAULT_APP_SETTINGS.search.asYouTypeDebounceMs);
  });

  it('and the guarded path puts every one of them back inside its declared range', () => {
    const { value } = parseSettingsGuarded({
      ...structuredClone(DEFAULT_APP_SETTINGS),
      terminals: { ...DEFAULT_APP_SETTINGS.terminals, commandPollMs: 1, linkHoverDelayMs: 99_999 },
      diagnostics: { ...DEFAULT_APP_SETTINGS.diagnostics, keepFiles: 999, maxFileSizeKb: 1 },
      search: { asYouTypeDebounceMs: -5 },
    });
    expect(value.terminals.commandPollMs).toBe(250);
    expect(value.terminals.linkHoverDelayMs).toBe(2000);
    expect(value.diagnostics.keepFiles).toBe(20);
    expect(value.diagnostics.maxFileSizeKb).toBe(64);
    expect(value.search.asYouTypeDebounceMs).toBe(0);
  });
});
