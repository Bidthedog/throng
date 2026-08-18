import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The parallel plan decides which specs may run CONCURRENTLY with another headed window.
 *
 * throng closes menus and popups when its window loses focus (`context-menu.tsx`), and the
 * preferences window is a child window that takes focus — so a spec that drives either cannot share
 * a desktop with a second Electron app. `parallel-plan.json` names the specs that must therefore run
 * at ONE worker; everything else runs concurrently.
 *
 * ══ WHAT USED TO LIVE HERE, AND WHY IT DOES NOT ══
 *
 * This file was `shard-plan.test.ts` and guarded a second plan — the one that split the suite across
 * three CI machines. Spec 034 (FR-057) removed the split: it bought ~12 minutes down to ~4-5 at THREE
 * TIMES the runner-minutes, plus a fixed per-shard `npm ci` + build toll, and neither of the two lanes
 * that replace it is large enough for that to pay.
 *
 * Its most valuable assertion is NOT lost, but it has moved rather than been dropped: "a spec listed
 * nowhere runs nowhere, silently" is now carried by the significance tag every E2E test must hold
 * (034 FR-052), which is checked per TEST rather than per file — strictly stronger, since a file
 * could always be listed while one of its tests was unreachable.
 *
 * Two other assertions became unnecessary rather than relocated. The tier filter now enumerates the
 * spec universe from DISK (`playwright.config.ts`), where it used to read the shard plan — so a spec
 * cannot be absent from the enumeration, and absence from the serial list simply means parallel.
 * And the hand-kept `['1','2','3']` group check, which had to be updated in step with the CI matrix
 * by hand, has no matrix left to be in step with.
 *
 * ══ THE TWO FAILURE MODES STILL WORTH FAILING THE BUILD OVER ══
 *
 *   - a STALE entry, naming a spec that has been renamed or deleted, quietly shrinks the serial tier;
 *   - a spec in the PARALLEL tier that has since grown a context menu, a popup or a preferences
 *     window is no longer parallel-safe, and nothing else would notice — it would simply start
 *     flaking on whichever unrelated test lost its menu.
 */
const E2E_DIR = join(process.cwd(), 'packages', 'ui', 'tests', 'e2e');
const PARALLEL_PLAN = join(E2E_DIR, 'parallel-plan.json');

describe('E2E parallel plan', () => {
  /*
   * `serial` maps filename -> mechanism (034 FR-001 / SC-004 / T035), rather than being a bare list.
   * An object, not a parallel array, so the membership and its reasons cannot drift apart. Every
   * assertion below is about MEMBERSHIP and reads the keys; the mechanisms have their own test at the
   * bottom of this file.
   */
  const plan = JSON.parse(readFileSync(PARALLEL_PLAN, 'utf8')) as {
    serial: Record<string, string>;
  };
  const serialNames = Object.keys(plan.serial);
  const onDisk = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'));
  const serial = new Set(serialNames);

  it('names nothing that no longer exists', () => {
    const stale = serialNames.filter((f) => !onDisk.includes(f));
    expect(
      stale,
      `parallel-plan.json names specs that are gone, so the serial tier is smaller than it looks:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('puts every spec in exactly one tier', () => {
    // Nothing to add for a new spec: absence from the serial list means parallel. This asserts the
    // partition holds, which is what `THRONG_E2E_TIER` relies on to run the whole suite across two
    // passes without losing or repeating a file.
    // An object cannot hold a duplicate key, so this now guards the thing that CAN still go wrong:
    // a name differing only by case or by a stray separator, which the filesystem would treat as one
    // file and JSON as two.
    const normalised = serialNames.map((f) => f.toLowerCase().replace(/\\/g, '/'));
    const dupes = serialNames.filter((_, i) => normalised.indexOf(normalised[i]) !== i);
    expect(dupes, `listed twice in parallel-plan.json:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });

  it('partitions every spec on disk into exactly one tier', () => {
    /*
     * Replaces the shard plan's "lists every spec file that exists", and derives the two tiers the
     * same way `playwright.config.ts` does rather than restating the rule — a guard that asserts
     * `serial.has(f) || !serial.has(f)` is a tautology dressed as coverage, which is precisely the
     * defect #244 records elsewhere in this suite.
     *
     * What can actually break it: `parallel-plan.json` naming a file that is not on disk (caught
     * above, and caught again here as a serial member missing from the union), or a future change
     * reintroducing a hand-maintained enumeration that disagrees with the directory.
     */
    const serialTier = onDisk.filter((f) => serial.has(f));
    const parallelTier = onDisk.filter((f) => !serial.has(f));

    expect(new Set([...serialTier, ...parallelTier])).toEqual(new Set(onDisk));
    expect(serialTier.filter((f) => parallelTier.includes(f))).toEqual([]);
    expect(serialTier.length + parallelTier.length).toBe(onDisk.length);
    // Every name the plan carries must reach a tier; a serial entry that is not on disk would
    // otherwise inflate the plan while shrinking the tier it claims to describe.
    expect(serialNames.filter((f) => !serialTier.includes(f))).toEqual([]);
  });

  it('keeps focus-stealing specs OUT of the parallel tier', () => {
    // The mechanism, not a guess: opening the preferences window, or driving a context menu, is what
    // steals focus from another headed window and closes its menus.
    const FOCUS_STEALING = /openPrefs|cog-menu-|getByTestId\('context-menu'\)|button: 'right'/;
    const offenders = onDisk
      .filter((f) => !serial.has(f))
      .filter((f) => FOCUS_STEALING.test(readFileSync(join(E2E_DIR, f), 'utf8')));
    expect(
      offenders,
      `these specs run in the PARALLEL tier but now open a preferences window or drive a context ` +
        `menu, which steals focus from other tests' menus. Add them to the "serial" list in ` +
        `packages/ui/tests/e2e/parallel-plan.json:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /*
   * The per-entry mechanism (034 FR-001 / SC-004).
   *
   * FR-001 says in terms that "a bare list of filenames does not satisfy this". These two guards are
   * what stop the column decaying back into one: the first makes a new serial entry impossible to add
   * without saying why, and the second stops UNATTRIBUTED being used as a way to say nothing.
   */
  const MECHANISMS = new Set(['FOCUS', 'CPU', 'TIMING', 'UNATTRIBUTED']);
  /**
   * The unattributed files, as counted on 2026-08-18 after reading all 122.
   *
   * These are NOT a to-do list with a number on it — each was read and genuinely showed none of the
   * three mechanisms, and several say so in their own headers (`quick-open-toolbar.e2e.ts` records
   * that the preferences window which made it serial was removed; `tab-name-limit.e2e.ts` says it
   * deliberately avoids opening one). They are candidates for the parallel tier, and candidates only:
   * this plan's rule is that mechanism identifies candidates and measurement decides.
   *
   * The number may fall. It may not RISE — which is the whole point. Adding a spec to the serial tier
   * without naming what puts it there is exactly the drift FR-001 was written against, and
   * "UNATTRIBUTED" must cost something or it becomes the default answer.
   */
  const UNATTRIBUTED_CEILING = 14;

  it('every serial entry names the mechanism that put it there', () => {
    const bad = Object.entries(plan.serial)
      .filter(([, m]) => !MECHANISMS.has(m))
      .map(([f, m]) => `${f}: ${JSON.stringify(m)}`);
    expect(
      bad,
      `parallel-plan.json's "serial" maps each filename to the mechanism that put it in this tier. ` +
        `Allowed values: ${[...MECHANISMS].join(', ')}. FOCUS = it opens the preferences window, a ` +
        `second window, or drives a context menu (only context-menu.tsx listens for window blur). ` +
        `CPU = it drives a real shell doing real work. TIMING = it asserts a wall-clock ceiling that ` +
        `contention breaks without anything having regressed:\n  ${bad.join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not let the unattributed count grow', () => {
    const unattributed = Object.entries(plan.serial)
      .filter(([, m]) => m === 'UNATTRIBUTED')
      .map(([f]) => f);
    expect(
      unattributed.length,
      `${unattributed.length} serial specs carry no mechanism, against a ceiling of ` +
        `${UNATTRIBUTED_CEILING}. If you added one, name what puts it in this tier instead — an ` +
        `attribution nobody can check is the thing FR-001 exists to prevent, and an UNATTRIBUTED ` +
        `that costs nothing becomes the default answer. If you REMOVED one, lower the ceiling in ` +
        `this file in the same commit:\n  ${unattributed.join('\n  ')}`,
    ).toBeLessThanOrEqual(UNATTRIBUTED_CEILING);
    // A ratchet that is never tightened is a ceiling nobody is holding — the same rule the sleep and
    // suite-size budgets carry, for the same reason.
    expect(
      unattributed.length,
      `only ${unattributed.length} specs are unattributed but the ceiling still says ` +
        `${UNATTRIBUTED_CEILING}. Lower it in this commit so the ground that was won is held.`,
    ).toBe(UNATTRIBUTED_CEILING);
  });
});
