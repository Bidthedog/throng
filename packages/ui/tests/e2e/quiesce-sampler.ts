/**
 * The decision behind `quiesced()`: has this surface stopped changing?
 *
 * Split out from `harness.ts` so it can be proven at the unit layer, which is the rule spec 034
 * exists to enforce — a helper that decides whether the whole terminal half of the suite waits
 * correctly should not be provable only by launching Electron.
 *
 * The off-by-one is the whole risk and it is worth naming. The FIRST sample can never be quiescent:
 * there is nothing to compare it against, and treating it as settled would make the helper return
 * instantly on every call, replacing a three-second sleep with no wait at all. Every assertion that
 * followed would then read a surface mid-redraw and pass or fail by luck — a failure mode strictly
 * worse than the sleep it replaced, because it looks like a condition.
 */
export interface QuiesceSampler {
  /** Feed the next read. Returns true once two consecutive reads have agreed. */
  sample(current: string): boolean;
  /** The text that was settled, or null if it never was. */
  settled(): string | null;
}

export function quiesceSampler(): QuiesceSampler {
  let previous: string | null = null;
  let settledText: string | null = null;

  return {
    sample(current: string): boolean {
      const still = previous !== null && current === previous;
      previous = current;
      if (still) settledText = current;
      return still;
    },
    settled(): string | null {
      return settledText;
    },
  };
}
