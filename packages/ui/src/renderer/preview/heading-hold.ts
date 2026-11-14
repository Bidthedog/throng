/**
 * 068 US1 (MT-01, 044 FR-090b) — land a followed `#heading` at the top of the preview, and keep it there.
 *
 * Whatever sits ABOVE the heading and has not reached its real size when the body reports the file drawn — an
 * image still loading, a Mermaid block or embed not yet read and drawn — grows afterwards and pushes the
 * heading down, so a jump made at once leaves the reader short of it ("a little above it", the maintainer's
 * second report). So:
 *
 * 1. WAIT: a body that is not settled ({@link bodySettled}) is not scrolled yet. The jump goes the moment it
 *    settles. The wait is state — never a clock (throng-testing, "A fixed delay that decides is a deadline").
 * 2. HOLD: from the jump on, every size change realigns the heading to the top. The hold does NOT end on
 *    "settled": a late layout shift is exactly what lands the reader short.
 *
 * What ends it (during the wait, that cancels the jump) is the reader, or the caller: the wheel, a pointer on the
 * scrollbar, a touch or a key on the body, or any scroll nobody here wrote — scroll-sync's own write is exactly
 * that, and is left alone rather than fought; and the caller's `end()` (a newer jump, another file, a live edit,
 * the panel unmounting).
 *
 * It writes `scrollTop` only. It records no navigation entry: the jump that started it already did (FR-115).
 */
import { DIAGRAM_PENDING_ATTRIBUTE } from './diagram/diagram-host.js';
import { findHeading } from './link-dom.js';

/** Held-embed and blocked-image markers the Markdown body leaves (`sanitise.ts`, `embeds.ts`). */
const HELD_IMAGE = 'img[data-throng-wiki-index]:not([src]):not([data-throng-alt])';

/**
 * Whether nothing in `host` can still change its size for want of a resource: no image with a `src` that has
 * not finished (or failed), no image embed still waiting for main to say which file it is, and no diagram or
 * embed placeholder still pending.
 */
export function bodySettled(host: HTMLElement): boolean {
  for (const img of host.querySelectorAll<HTMLImageElement>('img')) {
    if (img.hasAttribute('src') && !img.complete) return false;
  }
  return host.querySelector(`${HELD_IMAGE}, [${DIAGRAM_PENDING_ATTRIBUTE}]`) === null;
}

/** An active hold; `end()` is idempotent. */
export interface HeadingHold {
  /** Whether the heading has been scrolled to yet — `false` while the jump waits for the body to settle. */
  readonly jumped: boolean;
  end(): void;
}

/**
 * Jump to the heading `fragment` names in `host` (the scrolling body element) — now when the body is settled,
 * else once it is — and hold it at the top until the reader scrolls or `end()` is called. The heading is looked
 * up afresh each time, so a body that redraws its nodes is still followed.
 */
export function holdHeading(host: HTMLElement, fragment: string, onEnd?: () => void): HeadingHold {
  let ended = false;
  let jumped = false;
  /** The `scrollTop` this hold last wrote, as read back (the engine rounds and clamps). */
  let written = host.scrollTop;
  const observed = new Set<Element>();
  const cleanups: (() => void)[] = [];

  const align = (): void => {
    const heading = findHeading(host, fragment);
    if (heading === null) return;
    const delta = heading.getBoundingClientRect().top - host.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) {
      host.scrollTop += delta;
      written = host.scrollTop;
    }
    jumped = true;
  };

  const end = (): void => {
    if (ended) return;
    ended = true;
    for (const cleanup of cleanups) cleanup();
    onEnd?.();
  };

  /** A size change, an image settling or a DOM change: jump if the wait is over, else realign. */
  const changed = (): void => {
    if (ended) return;
    if (jumped || bodySettled(host)) align();
  };

  const listen = (type: string, handler: EventListener, capture = false): void => {
    host.addEventListener(type, handler, { capture, passive: true });
    cleanups.push(() => host.removeEventListener(type, handler, { capture }));
  };

  // The reader's input.
  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) listen(type, end);
  // A scroll this hold did not write: a dragged scrollbar, scroll-sync, anything else — theirs, not ours.
  listen('scroll', () => {
    if (Math.abs(host.scrollTop - written) >= 1) end();
  });
  // An image finishing or failing (these do not bubble, so the capture phase).
  listen('load', changed, true);
  listen('error', changed, true);

  if (typeof ResizeObserver !== 'undefined') {
    const resize = new ResizeObserver(changed);
    const watch = (): void => {
      for (const child of host.children) {
        if (observed.has(child)) continue;
        observed.add(child);
        resize.observe(child);
      }
    };
    watch();
    cleanups.push(() => resize.disconnect());
    // A diagram or embed replacing its placeholder changes the DOM and its sizes at once.
    if (typeof MutationObserver !== 'undefined') {
      const mutated = new MutationObserver(() => {
        watch();
        changed();
      });
      mutated.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', DIAGRAM_PENDING_ATTRIBUTE] });
      cleanups.push(() => mutated.disconnect());
    }
  }

  changed(); // settled already: jump now
  return {
    get jumped() {
      return jumped;
    },
    end,
  };
}
