/**
 * Count `new RegExp(...)` constructions while a block of code runs.
 *
 * Two test files ask the same question of two different scopes — `picker-compile-query.test.ts` of
 * `compileQuery` alone, `quick-open-budget.test.ts` of the whole keystroke pipeline — and the
 * mechanism is subtle enough that having one copy of it matters:
 *
 * Regular-expression LITERALS use the intrinsic %RegExp% and are unaffected by swapping the global,
 * so `query.split(/\s+/u)` and an escaping `.replace()` are invisible here. What remains visible is
 * exactly the compilation a caller chose to perform — which is what makes the number meaningful.
 *
 * Unlike a wall-clock measurement, this counts WORK, so it says the same thing on a loaded machine
 * as on an idle one.
 */
export function countRegExpConstructions(run: () => void): number {
  const Original = globalThis.RegExp;
  let count = 0;
  class Counting extends Original {
    constructor(pattern: string | RegExp, flags?: string) {
      count += 1;
      super(pattern as string, flags);
    }
  }
  (globalThis as { RegExp: unknown }).RegExp = Counting;
  try {
    run();
  } finally {
    (globalThis as { RegExp: unknown }).RegExp = Original;
  }
  return count;
}
