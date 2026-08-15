/**
 * The key-scoped configuration patch (032, FR-001/FR-002). Pure — no OS, no DOM, no filesystem.
 *
 * ══ WHY THIS EXISTS ══
 *
 * Every configuration write in this application used to carry the WHOLE document, already
 * serialised. A caller wanting to change one key had to rebuild the entire document from whatever
 * copy it happened to hold — and when two windows hold independent copies, the second write reverts
 * every key the first one changed, because the second writer's copy predates it and has no way to
 * know.
 *
 * A patch removes the ability to make that mistake. The caller says what changed; it never assembles
 * a document, so it can never assemble a stale one.
 *
 * ══ WHY `path` IS AN ARRAY OF SEGMENTS ══
 *
 * A dotted string cannot address a key that itself contains a dot, and this repository has them:
 * `keybindings.bindings` is keyed by action ids such as `tabs.openPicker`. Keybindings are out of
 * scope today, but a representation that becomes ambiguous the moment scope widens is the wrong one
 * to choose now, and a segment array costs nothing.
 *
 * ══ ALL OR NOTHING ══
 *
 * A patch with one bad change applies none of it (G4). A partially applied patch is a document
 * nobody asked for, and the caller has no way to discover which half landed.
 */

/** One key-scoped change: the path to the leaf, and what to put there. */
export interface ConfigChange {
  /** Path segments from the document root. Never dotted — see the module header. */
  path: readonly string[];
  /** The value to write. Any JSON value, including an object to replace a whole subtree. */
  value: unknown;
}

export type PatchError = 'empty-patch' | 'invalid-path' | 'not-an-object';

export type PatchOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: PatchError };

/**
 * Segments that must never be written, however they arrive.
 *
 * `__proto__` is the prototype-pollution classic; `constructor` and `prototype` are the two routes
 * to the same place through a different door. The renderer is sandboxed and these paths come from
 * our own code today, but "the current callers are trustworthy" is a property of the callers, not of
 * the function, and this function is what a future caller will reach for.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True iff every segment is a non-empty string that is safe to write. */
function isValidPath(path: readonly string[]): boolean {
  if (!Array.isArray(path) || path.length === 0) return false;
  return path.every(
    (segment) =>
      typeof segment === 'string' && segment.length > 0 && !FORBIDDEN_SEGMENTS.has(segment),
  );
}

/**
 * Apply `changes` to `base`, returning a new document.
 *
 * Validation happens **before** any change is applied, so a rejected patch leaves nothing behind —
 * neither in the returned value (there isn't one) nor in `base`, which is never mutated.
 */
export function applyConfigPatch(base: unknown, changes: readonly ConfigChange[]): PatchOutcome {
  if (!isRecord(base)) return { ok: false, error: 'not-an-object' };
  if (!Array.isArray(changes) || changes.length === 0) return { ok: false, error: 'empty-patch' };

  // Validate EVERY change first. Applying as we go and bailing on the third would leave the first
  // two written — a partial application, which G4 forbids.
  for (const change of changes) {
    if (!change || !isValidPath(change.path)) return { ok: false, error: 'invalid-path' };
  }

  const value = structuredClone(base);

  for (const change of changes) {
    const segments = change.path;
    const last = segments[segments.length - 1];
    let cursor: Record<string, unknown> = value;

    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      /*
       * A non-object standing where an intermediate is needed is REPLACED, not refused.
       *
       * The caller naming `a.b` is a statement that `a` is an object. If the document has `a` as a
       * string — a hand edit, or a shape that changed between releases — refusing would strand the
       * user with a setting they cannot change from the UI at all, fixable only by editing the file
       * they already got wrong. Replacing loses `a`'s old scalar, which was not a valid value for
       * that path anyway.
       */
      if (isRecord(next)) {
        cursor = next;
      } else {
        const created: Record<string, unknown> = {};
        cursor[segment] = created;
        cursor = created;
      }
    }

    cursor[last] = change.value;
  }

  return { ok: true, value };
}
