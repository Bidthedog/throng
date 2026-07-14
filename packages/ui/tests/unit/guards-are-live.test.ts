import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 018 / T126 — the guards this feature adds are actually RUNNING.
 *
 * The SC-002 guard was deliberately quarantined during construction: it bans the inline artwork that
 * US2 is the story removing, so it could not pass until US2 landed, and a `describe.skip` held it back.
 *
 * That quarantine is exactly the failure mode it exists to prevent. If US2 had slipped, or been
 * descoped, or the un-skip simply forgotten, a SKIPPED TEST WOULD HAVE SHIPPED — and SC-002 would read
 * as enforced while being enforced by nothing at all. A skipped test is not a passing test; it is a
 * passing test's silhouette.
 *
 * So the guards get a guard. This one is trivial and it is the reason the others can be trusted.
 */

const UNIT = fileURLToPath(new URL('.', import.meta.url));
const CORE_UNIT = fileURLToPath(new URL('../../../core/tests/unit/', import.meta.url));

/** Every source guard 018 introduced. Named explicitly: a glob would quietly cover a deletion. */
const GUARDS: readonly { dir: string; file: string }[] = [
  { dir: UNIT, file: 'no-inline-artwork.test.ts' }, // SC-002 — the quarantined one
  { dir: UNIT, file: 'css-variables-defined.test.ts' }, // FR-008 — no variable read but never defined
  { dir: UNIT, file: 'surface-token-roles.test.ts' }, // FR-001 — the surface split holds
  { dir: UNIT, file: 'notice-models.test.ts' }, // SC-009 — exactly two notice models
  { dir: CORE_UNIT, file: 'slider-descriptors.test.ts' }, // FR-016 — every slider has a sane step
  { dir: CORE_UNIT, file: 'project-scope-isolation.test.ts' }, // FR-045 — project scope stays out
  { dir: CORE_UNIT, file: 'drop-confinement.test.ts' }, // SC-011/012 — read scope equals write scope
];

describe('T126 — no guard this feature added is skipped', () => {
  for (const { dir, file } of GUARDS) {
    it(`${file} runs`, () => {
      // Reading the source is the only way to see a skip: a skipped suite reports success, and vitest
      // will not tell a sibling test that it was skipped.
      const src = readFileSync(join(dir, file), 'utf8');
      const skips = [...src.matchAll(/\b(describe|it|test)\s*\.\s*(skip|todo|only)\b/g)].map(
        (m) => `${m[1]}.${m[2]}`,
      );
      expect(skips, `${file} contains ${skips.join(', ')} — it is not guarding anything`).toEqual([]);
    });
  }
});
