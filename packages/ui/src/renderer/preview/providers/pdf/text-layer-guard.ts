/**
 * 074 FR-068a / FR-086c — at most one text layer streams into a page's text container at a time.
 *
 * A page's selectable text is laid out by two callers: the paint (at the scale just drawn) and Find's background
 * build (for pages not drawn yet). PDF.js appends spans as its text stream arrives, so two layers running into the
 * same container interleave their spans — doubled text on Copy, doubled matches in Find. Each new layer stops the one
 * still running in its container BEFORE it starts, and is registered before it is awaited, so a third caller can stop
 * it in turn.
 */

/** A text layer as PDF.js shapes it: `render()` streams spans into its container; `cancel()` stops the stream. */
export interface CancellableLayer {
  render(): Promise<unknown>;
  cancel(): void;
}

const running = new WeakMap<HTMLElement, CancellableLayer>();

/** Lay `create()`'s layer into `container`, stopping and clearing whatever layer was still running there. */
export async function exclusiveTextLayer(container: HTMLElement, create: () => CancellableLayer): Promise<() => void> {
  running.get(container)?.cancel();
  container.replaceChildren();
  const layer = create();
  running.set(container, layer);
  try {
    await layer.render();
  } finally {
    if (running.get(container) === layer) running.delete(container);
  }
  return () => layer.cancel();
}
