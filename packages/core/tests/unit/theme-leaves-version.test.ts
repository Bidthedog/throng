import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_DEFAULTS_VERSION, buildShippedDefaults } from '../../src/config/shipped-defaults.js';

/**
 * A theme leaf added or removed moves `SHIPPED_DEFAULTS_VERSION` (constitution: every theme setting is
 * stored with its theme; 069 FR-070).
 *
 * Theme files on disk take a new token ONLY through the additive upgrade that version gates. 069 added
 * `fileIconOther` to every shipped theme after version 34 was already on disk, and an install at 34 then
 * drew no Other File Icons colour of its own in any theme: the colour stayed put across a switch.
 * `integration/shipped-defaults-seed-upgrade.test.ts` ("a theme setting follows its theme") is that
 * reproduction; this is the guard that stops the next token doing the same.
 *
 * `fixtures/theme-leaves-by-version.json` records every leaf path a shipped theme carries: a base, then
 * one entry per version that changed the set. To add or remove a theme token, bump the version and
 * APPEND an entry for it. Editing an existing entry, or appending one under a version that already has
 * one, fails here: the set may only change with the version.
 *
 * Layer: unit — the record and a committed file; no install needed.
 */

interface Fixture {
  base: { version: number; leaves: string[] };
  changes: Array<{ version: number; added: string[]; removed: string[] }>;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'theme-leaves-by-version.json'), 'utf8'),
) as Fixture;

function shippedLeaves(): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const leaves = new Set<string>();
  const walk = (v: unknown, path: string): void => {
    if (isObj(v)) for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k);
    else leaves.add(path);
  };
  for (const theme of Object.values(buildShippedDefaults().themes)) {
    for (const [k, v] of Object.entries(theme)) if (k !== 'name') walk(v, k);
  }
  return [...leaves].sort();
}

function recordedLeaves(): string[] {
  const set = new Set(fixture.base.leaves);
  for (const change of fixture.changes) {
    for (const leaf of change.added) set.add(leaf);
    for (const leaf of change.removed) set.delete(leaf);
  }
  return [...set].sort();
}

describe('the shipped themes change shape only with SHIPPED_DEFAULTS_VERSION (069 FR-070)', () => {
  it('carries exactly the leaves the fixture records', () => {
    const current = shippedLeaves();
    const recorded = recordedLeaves();
    const added = current.filter((l) => !recorded.includes(l));
    const removed = recorded.filter((l) => !current.includes(l));
    expect(
      { added, removed },
      'A theme leaf was added or removed. Bump SHIPPED_DEFAULTS_VERSION, so existing theme files receive it, and append ' +
        '{ version: <new version>, added, removed } to fixtures/theme-leaves-by-version.json.',
    ).toEqual({ added: [], removed: [] });
  });

  it('records each change under a version of its own, none ahead of the record', () => {
    const versions = [fixture.base.version, ...fixture.changes.map((c) => c.version)];
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i], `entry ${i} reuses or precedes version ${versions[i - 1]}: bump SHIPPED_DEFAULTS_VERSION`).toBeGreaterThan(
        versions[i - 1]!,
      );
    }
    expect(versions[versions.length - 1]).toBeLessThanOrEqual(SHIPPED_DEFAULTS_VERSION);
  });

  it('records no empty change', () => {
    for (const change of fixture.changes) expect(change.added.length + change.removed.length).toBeGreaterThan(0);
  });
});
