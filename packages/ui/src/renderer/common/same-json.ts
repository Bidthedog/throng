/**
 * Structural equality over JSON values, ignoring key order (044 US7b fix round 2, item 4).
 *
 * A structured clone need not keep key order, and IPC structured-clones every payload — so two
 * values that arrived by different routes (a push and a reply carrying the same content, say) can be
 * `!==` and still describe the same thing. This was copy-pasted identically in
 * `navigation/history-mirror-sync.tsx` and `preview/preview-store.ts`; both import it from here now.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  if (keys.length !== Object.keys(bRecord).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && sameJson(aRecord[key], bRecord[key]));
}
