/**
 * config-write-lock — one critical section at a time, per configuration document (032, FR-002a).
 *
 * ══ WHY THIS EXISTS ══
 *
 * `FileConfigStore` has always written atomically, and that was never the property in question. An
 * atomic write makes the file REPLACE all-or-nothing; it says nothing about the gap between reading
 * a document and writing the modified version back. Every writer in this codebase does exactly that:
 * read the whole document, change one thing, write all of it.
 *
 * With an `await` in that gap and no lock, two writers interleave:
 *
 *     A: read {x:1, y:1}          B: read {x:1, y:1}
 *     A: write {x:2, y:1}
 *                                 B: write {x:1, y:2}   ← A's change is gone
 *
 * Both writes were atomic. The user's edit is still lost. That is #249 and #260, and it is why the
 * fix could not be "write atomically" — it already was.
 *
 * ══ WHY IT LIVES IN MAIN, AND WHY IN-PROCESS IS ENOUGH ══
 *
 * UI-main is the ONLY process that writes these files, and that is an existing, deliberate,
 * asserted invariant rather than a convenient assumption. `packages/daemon/src/composition-root.ts`
 * records it: the daemon "CORRECTS but never WRITES, and that asymmetry is deliberate… Write-back
 * happens in UI-main ALONE: two processes writing one config file is how a config file gets
 * truncated."
 *
 * So a promise chain in this process is sufficient. A file lock would be defending against a writer
 * that the architecture already forbids, at the cost of a lock file to leak and a stale-lock
 * recovery path to get wrong.
 *
 * Two writers do sit outside it, and both are fine by construction: the E2E helper (which writes
 * atomically itself, so the watcher sees a whole file either way) and a user hand-editing the
 * document, which is a supported thing to do and is what the watcher's re-read exists for.
 *
 * ══ WHY PER DOCUMENT ══
 *
 * A theme write has no reason to wait behind a settings write. A global lock would serialise the
 * whole configuration subsystem to prevent a collision that cannot happen — different files.
 *
 * ══ RELATIONSHIP TO write-config.ts's CHAIN ══
 *
 * The renderer has a per-document chain of its own (`writeChains`, issue #50). That one orders a
 * single window's writes before they cross IPC. This one orders every write once they arrive,
 * whichever window sent them and whichever channel they came in on — including the main-process
 * reset paths, which never touch the renderer at all. They solve adjacent problems and neither
 * replaces the other.
 */
import type { ConfigDocId } from '@throng/core';

/**
 * The tail of the in-flight critical section per document.
 *
 * Deliberately the same shape as `write-config.ts`'s `writeChains`: a map from document key to the
 * promise that must settle before the next section may start. That pattern is already proven here
 * and a second, cleverer one would be a second thing to get right.
 */
const chains = new Map<string, Promise<unknown>>();

/** Stable key for a document. A theme is keyed by NAME, so two themes never block each other. */
function docKey(id: ConfigDocId): string {
  return id.kind === 'theme' ? `theme:${id.name}` : id.kind;
}

/**
 * Run `section` with exclusive access to `id`'s document, for the whole of its read → modify →
 * write cycle.
 *
 * The lock is released when the section settles, **including when it throws**. A lock that survived
 * a failure would wedge every later write to that document for the life of the process, and the
 * symptom the user reports is "preferences stopped saving" with nothing in the log — a strictly
 * worse bug than the one this file fixes.
 *
 * Sections run in call order, so a later call is a later write. Callers reason about "last write
 * wins" and that has to mean the last CALLER, not whichever promise the scheduler resumed first.
 */
export function withDocumentLock<T>(id: ConfigDocId, section: () => Promise<T>): Promise<T> {
  return withDocumentsLock([id], section);
}

/**
 * The same guarantee across SEVERAL documents at once, for an operation that spans them.
 *
 * `resetEverything` and `restoreAllThemes` write settings, key bindings and every built-in theme as
 * one all-or-nothing operation. Taking a single-document lock for those would leave the other
 * documents unprotected for the duration — the operation would be atomic on disk and still racing
 * every other writer, which is the exact confusion this feature exists to remove.
 *
 * **No deadlock is possible**, and not by careful ordering — by construction. A caller never holds
 * one lock while waiting for another: it takes a snapshot of every relevant tail, waits for all of
 * them together, and only then runs. There is no hold-and-wait, so the cycle that deadlock requires
 * cannot form. (Sorting the keys is therefore not load-bearing; it is kept only so the map is
 * updated in a predictable order when reading a trace.)
 */
export async function withDocumentsLock<T>(
  ids: readonly ConfigDocId[],
  section: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(ids.map(docKey))].sort();

  // Snapshot every tail, then wait for all of them. A failed predecessor must not sink the sections
  // queued behind it — they are unrelated writes that happen to share a file.
  const previous = Promise.all(
    keys.map((k) => (chains.get(k) ?? Promise.resolve()).catch(() => undefined)),
  );
  const result = previous.then(section);

  for (const key of keys) chains.set(key, result);
  try {
    return await result;
  } finally {
    // Drain each key this section still owns, so a long-lived process does not accumulate one
    // settled promise per document it ever wrote.
    for (const key of keys) if (chains.get(key) === result) chains.delete(key);
  }
}
