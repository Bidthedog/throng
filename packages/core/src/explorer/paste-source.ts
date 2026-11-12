import type { FileListSnapshot } from '../abstractions/clipboard.js';
import { normaliseForCompare } from '../fs/path-id.js';

/** Where a tree Paste takes its items from (067 research D3). */
export type PasteSource = 'internal' | 'os' | 'stale' | 'none';

/**
 * 016 FR-015c widened to file lists (FR-006): the OS clipboard is the authority on what was copied last.
 *
 * `placed` is the list throng put on the OS for its internal record, or null when it has placed none.
 */
export function decidePasteSource(
  hasInternal: boolean,
  placed: FileListSnapshot | null,
  os: FileListSnapshot | null,
): PasteSource {
  if (os !== null) return hasInternal && placed !== null && sameList(placed, os) ? 'internal' : 'os';
  if (!hasInternal) return 'none';
  return placed === null ? 'internal' : 'stale';
}

function sameList(a: FileListSnapshot, b: FileListSnapshot): boolean {
  if (a.intent !== b.intent || a.paths.length !== b.paths.length) return false;
  const key = (paths: readonly string[]): string => paths.map(normaliseForCompare).sort().join('\n');
  return key(a.paths) === key(b.paths);
}
