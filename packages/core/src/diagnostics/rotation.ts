/**
 * Log rotation and retention, decided purely (#123).
 *
 * The daemon outlives the UI and can run for days, so an unbounded log is not a tidiness problem
 * but a disk-filling one — and the process it would fill the disk of is the user's, in the
 * background, with no console to warn them. The policy is injected (Constitution Principle X) and
 * the DECISIONS are here, separate from the file operations, so both halves can be tested: one
 * without a disk, the other against a real directory.
 */

export interface RotationPolicy {
  /** Rotate once a file would exceed this many bytes. */
  maxBytes: number;
  /** How many files to keep in total, INCLUDING the live one. Below 1 is meaningless. */
  keep: number;
}

/** A megabyte a file, five files: enough history to see a startup and the failure after it,
 *  bounded well under anything a user would notice. */
export const DEFAULT_ROTATION: RotationPolicy = { maxBytes: 1_048_576, keep: 5 };

/** Clamp a configured policy into one that cannot misbehave (a `keep` of 0 would delete the file
 *  it is writing; a negative size would rotate on every line). */
export function normaliseRotation(policy: Partial<RotationPolicy> | undefined): RotationPolicy {
  const maxBytes = Math.max(1024, Math.floor(policy?.maxBytes ?? DEFAULT_ROTATION.maxBytes));
  const keep = Math.max(1, Math.floor(policy?.keep ?? DEFAULT_ROTATION.keep));
  return { maxBytes, keep };
}

/**
 * Whether writing `incomingBytes` to a file already `currentBytes` long should rotate FIRST.
 *
 * Checked before the write, not after, so a single enormous record cannot leave a file over the
 * limit until the next one happens along. A record larger than the whole budget still gets written
 * (truncating a stack trace to satisfy a size cap would defeat the point of keeping it) — it simply
 * lands in a freshly rotated file of its own.
 */
export function shouldRotate(
  currentBytes: number,
  incomingBytes: number,
  policy: RotationPolicy,
): boolean {
  return currentBytes > 0 && currentBytes + incomingBytes > policy.maxBytes;
}

/** The generation-suffixed name of a rotated file: `main.log` → `main.1.log`. */
export function rotatedName(baseName: string, generation: number): string {
  const dot = baseName.lastIndexOf('.');
  return dot <= 0
    ? `${baseName}.${generation}`
    : `${baseName.slice(0, dot)}.${generation}${baseName.slice(dot)}`;
}

export interface RotationPlan {
  /** Applied IN ORDER: oldest generation first, so no rename overwrites a file still needed. */
  renames: readonly { from: string; to: string }[];
  /** Files that fall off the end of the retention window. */
  remove: readonly string[];
}

/**
 * What to move and what to delete, to make room for a fresh live file.
 *
 * `keep` counts the live file, so `keep: 3` leaves `main.log`, `main.1.log`, `main.2.log` and
 * removes anything older. The renames run oldest-first for the obvious reason: renaming `.1` to
 * `.2` before `.2` has moved out of the way would destroy the older of the two.
 */
export function rotationPlan(baseName: string, policy: RotationPolicy): RotationPlan {
  const { keep } = normaliseRotation(policy);
  const renames: { from: string; to: string }[] = [];
  // The oldest generation we may keep is `keep - 1` (the live file is generation 0); anything at or
  // beyond it is dropped rather than shifted along.
  for (let generation = keep - 1; generation >= 1; generation -= 1) {
    renames.push({
      from: generation === 1 ? baseName : rotatedName(baseName, generation - 1),
      to: rotatedName(baseName, generation),
    });
  }
  return { renames, remove: [rotatedName(baseName, keep)] };
}
