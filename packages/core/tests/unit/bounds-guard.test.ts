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
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
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
