import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The shard plan must name every E2E spec exactly once.
 *
 * CI selects a group from `shard-plan.json` rather than using `--shard`, because Playwright's own
 * sharding splits by test COUNT in file order — which on this suite let the alphabet decide, putting
 * every `terminal-*` spec in one third. Measured: 3.7, 8.3 and 36 minutes, the last killed by a
 * 30-minute cap.
 *
 * The cost of choosing the split ourselves is that a spec missing from the plan runs NOWHERE, and
 * does so silently — a far worse failure than an unbalanced shard, and one nobody would notice for
 * months. Hence this test: add a spec without listing it and the unit suite fails immediately, with
 * the filename and the group sizes in front of you.
 */
const E2E_DIR = join(process.cwd(), 'packages', 'ui', 'tests', 'e2e');
const PLAN = join(E2E_DIR, 'shard-plan.json');

interface Plan {
  groups: Record<string, string[]>;
}

describe('E2E shard plan', () => {
  const plan = JSON.parse(readFileSync(PLAN, 'utf8')) as Plan;
  const listed = Object.values(plan.groups).flat();
  const onDisk = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'));

  it('lists every spec file that exists', () => {
    const missing = onDisk.filter((f) => !listed.includes(f));
    expect(
      missing,
      `these specs are in no shard group, so CI would never run them — add them to ` +
        `packages/ui/tests/e2e/shard-plan.json:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('lists nothing that no longer exists', () => {
    const stale = listed.filter((f) => !onDisk.includes(f));
    expect(stale, `shard-plan.json names specs that are gone:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('lists each spec exactly once', () => {
    const seen = new Set<string>();
    const dupes = listed.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(dupes, `these specs are in more than one group:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });

  it('has a group for every shard CI runs', () => {
    // Kept in step with the matrix in .github/workflows/ci.yml by hand; a mismatch means a group of
    // specs silently stops running, so it is asserted rather than assumed.
    expect(Object.keys(plan.groups).sort()).toEqual(['1', '2', '3']);
  });
});

/**
 * The parallel plan decides which specs may run CONCURRENTLY with another headed window.
 *
 * throng closes menus and popups when its window loses focus (`context-menu.tsx`), and the
 * preferences window is a child window that takes focus — so a spec that drives either cannot share
 * a desktop with a second Electron app. `parallel-plan.json` names the specs that must therefore run
 * at ONE worker; everything else runs concurrently.
 *
 * Two failure modes are worth failing the build over, and neither is visible at runtime:
 *
 *   - a STALE entry, naming a spec that has been renamed or deleted, quietly shrinks the serial tier;
 *   - a spec in NEITHER tier runs nowhere, exactly as a spec missing from the shard plan does.
 *
 * The third guard is the one that stops the boundary rotting: a spec in the PARALLEL tier that has
 * since grown a context menu, a popup or a preferences window is no longer parallel-safe, and nothing
 * else would notice — it would simply start flaking on whichever unrelated test lost its menu.
 */
const PARALLEL_PLAN = join(E2E_DIR, 'parallel-plan.json');

describe('E2E parallel plan', () => {
  const plan = JSON.parse(readFileSync(PARALLEL_PLAN, 'utf8')) as { serial: string[] };
  const onDisk = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'));
  const serial = new Set(plan.serial);

  it('names nothing that no longer exists', () => {
    const stale = plan.serial.filter((f) => !onDisk.includes(f));
    expect(
      stale,
      `parallel-plan.json names specs that are gone, so the serial tier is smaller than it looks:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('puts every spec in exactly one tier', () => {
    // Nothing to add for a new spec: absence from the serial list means parallel. This asserts the
    // partition holds, which is what `THRONG_E2E_TIER` relies on to run the whole suite across two
    // passes without losing or repeating a file.
    const dupes = plan.serial.filter((f, i) => plan.serial.indexOf(f) !== i);
    expect(dupes, `listed twice in parallel-plan.json:\n  ${dupes.join('\n  ')}`).toEqual([]);
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
});
