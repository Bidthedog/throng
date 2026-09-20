import { resolveAgainst, separatorOf } from '../preview/path-resolve.js';

/**
 * 045 FR-167, FR-167a (round four) — the status-bar readout's target: the link's FIRST reading as
 * the grammar resolves it, never its visible text.
 *
 * | Reading | Result |
 * |---|---|
 * | already absolute (a drive path, a UNC location) | itself |
 * | relative, with a base (a terminal's cwd, an editor's file folder, else the project root) | resolved against it |
 * | relative, with no base at all | the text as written |
 *
 * Reuses the SAME join `resolveAgainst` (`..`/`.` resolution, a drive/UNC-aware split) the Markdown
 * preview's own links already go through, rather than a second copy of that arithmetic (Principle
 * VIII). An OSC 8 hyperlink's DECLARED target is not this function's business — it is already
 * absolute-or-not by construction and the caller (`hoveredLinkReadoutText`) shows it verbatim.
 */
export function linkReadoutTarget(text: string, base: string | null | undefined): string {
  if (isAbsoluteByName(text)) return text;
  if (base === null || base === undefined || base.length === 0) return text;
  const resolved = resolveAgainst(base, text, separatorOf(base));
  return resolved ?? text;
}

/** A drive-rooted or UNC location, by spelling alone — no disk, no platform (FR-155's kin). */
function isAbsoluteByName(text: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(text) || /^[\\/]{2}[^\\/]/.test(text);
}
