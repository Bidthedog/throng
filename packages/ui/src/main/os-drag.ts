import { join } from 'node:path';
import { isWithinRoot } from '@throng/core';

/**
 * Start a drag of real files out to the OS (067 FR-005, research D4), confined to the active project. A copy on every
 * OS: Electron's file drag offers copy and link only. Returns whether a drag started.
 */
export function startOsDrag(
  relPaths: readonly string[],
  activeRoot: string | null,
  start: (absPaths: string[]) => void,
): boolean {
  if (activeRoot === null || relPaths.length === 0 || relPaths.includes('')) return false;
  const absPaths = relPaths.map((rel) => join(activeRoot, rel));
  if (!absPaths.every((abs) => isWithinRoot(activeRoot, abs))) return false;
  start(absPaths);
  return true;
}
