/**
 * The window's layout-save drain (019 FR-010, issue #86).
 *
 * The peer of `write-config.ts`'s `settleConfigWrites` for the OTHER deferred write — the
 * layout blob (split structure AND per-panel zoom) behind `workspace-store`'s 400ms debounce,
 * the write #86 is actually about. Lives apart from the store so the drain is the MODULE's
 * property rather than React's: it has no provider to mount, no `client` to fake and no DOM, so
 * both of its halves can be driven directly.
 *
 * A drain has two halves and needs both, exactly as the config side does:
 *
 *  - ARMED — a debounce timer that has not fired. {@link registerLayoutFlusher}'s flushers fire
 *    it now and hand back the promise.
 *  - IN FLIGHT — a save whose timer ALREADY fired and which is now on the wire.
 *    {@link trackLayoutSave} keeps it, because nothing else does: the store's debounce drops its
 *    promise (`void client.save(…)`), and once it has fired the flusher has nothing pending to
 *    report — it returns immediately and the drain acks having settled a write that is still in
 *    the air. `workspace.save` is not one hop either: a sub-workspace window's save is TWO
 *    round-trips (`subworkspace-window-client.ts`), and the terminate/leave exit closes the
 *    window the instant the drain acks, with no beat behind it. That is the write lost, by a
 *    drain that reported success — which is #86 wearing the fix's own clothes.
 */

/**
 * Every mounted provider's `flushSave`, so the shutdown drain can settle the layout write
 * without reaching into React.
 *
 * The drain runs from the renderer entry point, in EVERY window, and must name none of them:
 * a window that hosts no provider settles immediately because this set is empty, which is
 * correct rather than a special case. The main window and each detached sub-workspace window
 * (C6) register through the same door.
 */
const layoutFlushers = new Set<() => Promise<void>>();

/**
 * Every layout save currently on the wire, whether or not its caller kept the promise.
 *
 * The peer of `write-config.ts`'s `writeChains` — and it exists for the same reason that map
 * does: the module, not the writer, is the only place that can know. A save is added when it is
 * STARTED and dropped when it lands.
 */
const inFlightSaves = new Set<Promise<unknown>>();

/** Join this window's drain for as long as the provider is mounted. Returns the un-register. */
export function registerLayoutFlusher(flush: () => Promise<void>): () => void {
  layoutFlushers.add(flush);
  return () => {
    layoutFlushers.delete(flush);
  };
}

/**
 * Track a `workspace.save` from the moment it is STARTED, so the drain can await one whose
 * debounce has already fired.
 *
 * Returns a promise that resolves — never rejects — when the save settles: a write that cannot
 * land must not wedge the close, and its failure is surfaced through the existing reload path
 * exactly as before.
 */
export function trackLayoutSave(save: Promise<unknown>): Promise<void> {
  const settled = save.then(
    () => undefined,
    () => undefined,
  );
  inFlightSaves.add(settled);
  void settled.then(() => {
    inFlightSaves.delete(settled);
  });
  return settled;
}

/**
 * Settle every pending `workspace.save` this window owns (019 FR-010): fire what is armed, then
 * await what is in flight — the same two halves, in the same order, as `settleConfigWrites`.
 *
 * Both halves are load-bearing. Firing the armed ones without awaiting the in-flight ones acks
 * a write that is still travelling; awaiting the in-flight ones without firing the armed ones
 * misses the write entirely. `flushSave` reports the first half and can only report the first
 * half — by the time the timer has fired it has nothing pending left to tell anyone about.
 */
export async function settleLayoutSaves(): Promise<void> {
  await Promise.all([...layoutFlushers].map((flush) => flush()));
  await Promise.all([...inFlightSaves]);
}
