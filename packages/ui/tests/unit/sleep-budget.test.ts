import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The hard-coded-sleep ratchet (spec 034, FR-020 / FR-021).
 *
 * A `waitForTimeout(n)` asserts that n milliseconds is always enough, on every machine, under every
 * load the suite happens to be creating at that moment. That assertion is false, and it is the
 * defect class behind three of the four issues spec 034 was opened for: #245 timed a window's death,
 * #246 slept past a write it then could not read, and #251's specs slept for an autosave. There were
 * 222 of them across 83 files when this was measured, totalling 322.8 seconds — five minutes of a
 * run spent deliberately doing nothing, and 137 of them carrying no comment to say why.
 *
 * Fixing all of them at once is not possible and pretending otherwise would produce 222 invented
 * justifications, which is worse than none: a register nobody believes is a register nobody reads.
 * So this is a RATCHET rather than an allowlist. Every file's current count is recorded, the numbers
 * may only go DOWN, and the build stops anyone adding to the debt without a conversation.
 *
 * Deliberately counts CALLS, not milliseconds. A spec that swaps one 3000ms sleep for six 500ms ones
 * has not improved anything, and a duration budget would let it. The unit that matters is "how many
 * places is this suite guessing at a duration".
 */

const E2E_DIR = fileURLToPath(new URL('../e2e', import.meta.url));
const BUDGET = join(E2E_DIR, 'sleep-budget.json');

interface Ratchet {
  total: number;
  files: Record<string, number>;
}

function sleepsIn(file: string): number {
  return (readFileSync(join(E2E_DIR, file), 'utf8').match(/waitForTimeout\(/g) ?? []).length;
}

describe('hard-coded sleep ratchet', () => {
  const ratchet = JSON.parse(readFileSync(BUDGET, 'utf8')) as Ratchet;
  const specs = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'));

  it('no spec exceeds its recorded sleep budget', () => {
    const over = specs
      .map((f) => ({ f, now: sleepsIn(f), allowed: ratchet.files[f] ?? 0 }))
      .filter((r) => r.now > r.allowed);

    expect(
      over,
      `These specs added hard-coded waits. A waitForTimeout asserts that N milliseconds is always ` +
        `enough, which is what #245, #246 and #251 were: wait for the CONDITION instead — the ` +
        `element, the value, the file's content — or, if genuinely nothing is observable, say so in ` +
        `a comment and raise the number in sleep-budget.json in this commit so the debt stays ` +
        `visible:\n` +
        over.map((r) => `  ${r.f}: ${r.now} now, ${r.allowed} allowed`).join('\n'),
    ).toEqual([]);
  });

  it('the ratchet does not name specs that are gone', () => {
    const stale = Object.keys(ratchet.files).filter((f) => !specs.includes(f));
    expect(
      stale,
      `sleep-budget.json names specs that no longer exist, so the budget is looser than it looks:\n` +
        stale.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('the ratchet has been tightened when sleeps were removed', () => {
    // The point of a ratchet: a number left too high is permission nobody asked for. This is a
    // WARNING-shaped assertion — it fails only when the gap is large enough to be an oversight
    // rather than a rounding of one edit in flight.
    const slack = Object.entries(ratchet.files)
      .map(([f, allowed]) => ({ f, allowed, now: specs.includes(f) ? sleepsIn(f) : 0 }))
      .filter((r) => r.allowed - r.now >= 3);

    expect(
      slack,
      `These specs now have materially fewer sleeps than sleep-budget.json allows. Lower the ` +
        `numbers so the ratchet keeps holding what was won:\n` +
        slack.map((r) => `  ${r.f}: ${r.now} now, ${r.allowed} allowed`).join('\n'),
    ).toEqual([]);
  });
});
