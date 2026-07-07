/**
 * Pure resize math for split dividers (FR-011/038): move `deltaFraction` between
 * the two adjacent cells (`index`, `index+1`) while keeping each ≥ `minFraction`,
 * preserving their combined size. Extracted from the divider so the minimum-size
 * rule is unit-testable without a DOM.
 */
export function clampAdjacent(
  sizes: number[],
  index: number,
  deltaFraction: number,
  minFraction: number,
): number[] {
  const pairSum = sizes[index] + sizes[index + 1];
  // If the pair can't even hold two minimums, split it evenly.
  if (pairSum <= minFraction * 2) {
    const next = [...sizes];
    next[index] = pairSum / 2;
    next[index + 1] = pairSum / 2;
    return next;
  }
  const maxA = pairSum - minFraction;
  const a = Math.max(minFraction, Math.min(sizes[index] + deltaFraction, maxA));
  const next = [...sizes];
  next[index] = a;
  next[index + 1] = pairSum - a;
  return next;
}
