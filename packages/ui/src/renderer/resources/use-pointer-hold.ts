/**
 * Hold what is drawn while the pointer is over it (055 FR-095).
 *
 * A list that changes under a resting pointer cannot be clicked, and a native tooltip whose text changes
 * is closed by the browser: so a region the pointer is over draws from the snapshot taken when the pointer
 * ENTERED, and catches up to the latest the moment it leaves. `live` is what the region would draw now;
 * `snapshot` copies anything in it that is mutated in place (the session's set of ended processes is).
 */
import { useState, type MouseEventHandler } from 'react';
import { useCatchUpEpoch } from './monitor-session.js';

const NOT_ARMED = Symbol('not armed');

interface Frozen<T> {
  readonly value: T;
  /** The catch-up epoch this snapshot has answered. */
  readonly epoch: number;
  /** Which capture `live` was when a catch-up was asked for; the snapshot is retaken once it changes. */
  readonly armedAt: unknown;
}

export interface PointerHold<T> {
  /** What to draw: the snapshot while the pointer is over the region, otherwise `live`. */
  readonly value: T;
  /** Whether the pointer is over the region, so what is drawn is a snapshot. */
  readonly held: boolean;
  readonly bind: { readonly onMouseEnter: MouseEventHandler; readonly onMouseLeave: MouseEventHandler };
}

/**
 * `keyOf` names WHICH capture `live` is — by default `live` itself; a caller that builds `live` afresh
 * each render passes something stable, such as the session's version.
 */
export function usePointerHold<T>(
  live: T,
  snapshot: (live: T) => T = (v) => v,
  keyOf: (live: T) => unknown = (v) => v,
): PointerHold<T> {
  const [frozen, setFrozen] = useState<Frozen<T> | null>(null);
  /*
   * An action the user took asks held regions to take the next captures (`requestCatchUp`). The epoch
   * moves in the render the capture ARRIVES in, but `live` may be a deferred value that still shows the
   * capture before — so the catch-up is armed with the `live` it saw, and the snapshot is retaken in the
   * first render where `live` has moved on. Both are React's adjust-state-during-render pattern.
   */
  const epoch = useCatchUpEpoch();
  const key = keyOf(live);
  if (frozen !== null && frozen.epoch !== epoch) setFrozen({ ...frozen, epoch, armedAt: key });
  else if (frozen !== null && frozen.armedAt !== NOT_ARMED && frozen.armedAt !== key) {
    setFrozen({ value: snapshot(live), epoch, armedAt: NOT_ARMED });
  }
  return {
    value: frozen === null ? live : frozen.value,
    held: frozen !== null,
    bind: {
      onMouseEnter: () => setFrozen({ value: snapshot(live), epoch, armedAt: NOT_ARMED }),
      onMouseLeave: () => setFrozen(null),
    },
  };
}
