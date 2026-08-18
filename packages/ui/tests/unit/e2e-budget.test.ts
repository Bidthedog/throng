import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The E2E suite stays at or below its declared budget, and the budget only ever goes DOWN
 * (034 FR-060 / SC-020, constitution v5.0.0 Principle V).
 *
 * ══ WHY A BUDGET EXISTS AT ALL ══
 *
 * Principle V used to require an E2E for every user-facing UI change, forbid marking UI work done on
 * lower-layer evidence, and require uncovered UI to be backfilled. A one-way ratchet with no
 * ceiling. It produced 235 spec files and 46.9 measured minutes against 250 unit files — an inverted
 * pyramid, paid for by every contributor on every push. The rule was written in good faith; what it
 * lacked was any number anyone could exceed.
 *
 * So this is the number. It is deliberately the crudest possible measure — a count — because a
 * sophisticated one would be arguable, and the failure mode being prevented is an argument won test
 * by test over a year.
 *
 * ══ WHY UNDER-BUDGET IS ALSO A FAILURE ══
 *
 * A ratchet that only fires in one direction is not a ratchet. If the suite shrinks and the budget
 * does not, the slack is silently available to the next feature, and the ceiling drifts back up to
 * wherever it was. Lower the number in the same commit that removes the tests — the guard tells you
 * exactly what to write.
 */
const E2E_DIR = join(process.cwd(), 'packages', 'ui', 'tests', 'e2e');
const BUDGET = join(E2E_DIR, 'e2e-budget.json');

interface Budget {
  total: number;
  core: number;
  byCategory: Record<string, number>;
}

/**
 * Count tests by their tags. Deliberately a separate implementation from `e2e-tags.test.ts`'s —
 * that one is about SHAPE (does every test carry the right kind of tag), this one is about SIZE.
 * Sharing a parser would make one bug hide both.
 */
function measure(): Budget {
  const counts: Budget = { total: 0, core: 0, byCategory: {} };
  for (const file of readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'))) {
    for (const line of readFileSync(join(E2E_DIR, file), 'utf8').split('\n')) {
      /*
       * TOTAL counts every `test(` declaration, tagged or not.
       *
       * It used to count only TAGGED ones, and the difference is not academic — it was caught by
       * rebasing onto a master that had gained 93 untagged tests. The tag guard went red, correctly;
       * this one stayed GREEN, because 93 tests it could not see are 93 tests it did not count. The
       * budget was being kept against a number that shrank whenever the suite grew in the one way a
       * budget exists to notice.
       *
       * The pair was still sound overall — nothing merges while the tag guard is red — but a guard
       * that is only correct because a different guard is also correct is a guard with an unstated
       * dependency, and unstated dependencies are what this whole feature is about.
       */
      if (/^\s*test\(/.test(line)) counts.total += 1;

      const m = /^\s*test\(\s*(?:'|"|`)[\s\S]*?(?:'|"|`)\s*,\s*\{ tag: \[([^\]]*)\] \}/.exec(line);
      if (!m) continue;
      const tags = [...m[1].matchAll(/'(@[a-z]+)'/g)].map((x) => x[1] as string);
      if (tags.includes('@core')) counts.core += 1;
      for (const t of tags) {
        if (['@core', '@extended', '@admin', '@quarantine'].includes(t)) continue;
        counts.byCategory[t] = (counts.byCategory[t] ?? 0) + 1;
      }
    }
  }
  // The `adminTest` declarations tag through the helper in `admin.ts` rather than inline, so the
  // line-based count above cannot see them. Three, all @terminal — asserted, not assumed.
  const adminCount = readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.e2e.ts'))
    .reduce(
      (n, f) => n + (readFileSync(join(E2E_DIR, f), 'utf8').match(/^\s*adminTest\(/gm) ?? []).length,
      0,
    );
  counts.total += adminCount;
  counts.byCategory['@terminal'] = (counts.byCategory['@terminal'] ?? 0) + adminCount;
  return counts;
}

const budget = JSON.parse(readFileSync(BUDGET, 'utf8')) as Budget;
const actual = measure();

const overMessage = (what: string, is: number, cap: number): string =>
  `The E2E suite holds ${is} ${what} against a budget of ${cap}. Before raising the budget: what ` +
  `can this test assert that a unit, component or integration test cannot? If you can answer that ` +
  `in one sentence, raise it deliberately in packages/ui/tests/e2e/e2e-budget.json and say why in ` +
  `the commit message.`;

const underMessage = (what: string, is: number, cap: number): string =>
  `The E2E suite holds ${is} ${what} against a budget of ${cap}. Lower the budget to ${is} — a ` +
  `ratchet that is never tightened is not a ratchet, it is a ceiling nobody is holding.`;

describe('E2E budget', () => {
  it('stays at or under the total', () => {
    expect(actual.total, overMessage('tests', actual.total, budget.total)).toBeLessThanOrEqual(
      budget.total,
    );
  });

  it('tightens the total when the suite shrinks', () => {
    expect(actual.total, underMessage('tests', actual.total, budget.total)).toBeGreaterThanOrEqual(
      budget.total,
    );
  });

  it('keeps the critical lane within its budgeted size', () => {
    expect(actual.core, overMessage('@core tests', actual.core, budget.core)).toBeLessThanOrEqual(
      budget.core,
    );
    expect(actual.core, underMessage('@core tests', actual.core, budget.core)).toBeGreaterThanOrEqual(
      budget.core,
    );
  });

  it('holds every category to its budget, in both directions', () => {
    const over: string[] = [];
    const under: string[] = [];
    for (const [cat, cap] of Object.entries(budget.byCategory)) {
      const is = actual.byCategory[cat] ?? 0;
      if (is > cap) over.push(overMessage(`${cat} tests`, is, cap));
      if (is < cap) under.push(underMessage(`${cat} tests`, is, cap));
    }
    expect(over, over.join('\n')).toEqual([]);
    expect(under, under.join('\n')).toEqual([]);
  });

  it('budgets every category that exists', () => {
    const unbudgeted = Object.keys(actual.byCategory).filter((c) => !(c in budget.byCategory));
    expect(
      unbudgeted,
      `these categories have tests but no budget entry, so they could grow without limit:\n  ${unbudgeted.join('\n  ')}`,
    ).toEqual([]);
  });
});
