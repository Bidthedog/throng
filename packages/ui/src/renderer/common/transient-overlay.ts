/**
 * The window's ONE transient-overlay slot (033 FR-071, FR-071a; plan D1).
 *
 * ══ WHAT A TRANSIENT OVERLAY IS ══
 *
 * A surface drawn OVER the window that can be dismissed without consequence — Quick Open, Go To
 * Line, the tab picker, the editor status strip's language picker. Both halves of that sentence
 * are load-bearing. `workspace/panel-rename.ts` is deliberately NOT one: it swaps a panel header's
 * title for an inline `<input>` in place, occludes nothing, and holds text the user has typed, so
 * dismissing it on a chord would be a data-loss behaviour rather than a tidiness one.
 *
 * ══ WHY A REGISTRY OF DISMISS CALLBACKS, AND NOT A STORE OF "WHICH OVERLAY IS OPEN" ══
 *
 * FR-071a: a feature that has to import another feature's store to know whether to close is the
 * coupling this module exists to avoid. Here an overlay declares exactly two things about itself —
 * *I am open now*, and *here is how to close me* — and learns nothing about any other overlay.
 * Quick Open does not know the tab picker exists, the tab picker does not know Quick Open exists,
 * and the next overlay added costs one line at its own call site and no edit anywhere else.
 *
 * A shared "which overlay is open" store would instead have to be ADOPTED by each overlay, which
 * means lifting the tab picker's local flag out of `tab-group.tsx` into a global — a change to
 * shipped 031 behaviour with no user-visible gain, for a flag nothing outside that component has
 * any business reading.
 *
 * ══ CLAIM BEFORE DISMISS, AND IDENTITY ON RELEASE ══
 *
 * These two rules are the whole of the correctness here, and both are needed.
 *
 * An incumbent's `dismiss` is almost always a `setState(false)`, whose effect cleanup then runs the
 * `release` it was handed. A `release` that cleared the slot unconditionally would clear *the new
 * claimant's* entry, so the next overlay would find an empty slot and dismiss nothing — a bug that
 * appears only on the second overlay in a chain and looks exactly like the one being fixed. So:
 *
 *   1. the claim is written BEFORE the incumbent is dismissed, so a synchronous re-entrant release
 *      is already a no-op by the time it runs; and
 *   2. `release` is checked against a per-claim token, so a LATE release — React mounts the new
 *      tree before cleaning up the old one — cannot disarm the newer overlay.
 *
 * Ownership-checking also makes release idempotent, which is what makes unmount safe to handle by
 * simply calling it from an effect cleanup.
 *
 * ══ ONE REALM, ONE SLOT ══
 *
 * This is module state, so it is per renderer realm — which is precisely FR-071's "in a window". A
 * sub-workspace window is a separate realm with its own React root and gets its own slot, so a
 * modal opened in one window never dismisses one in another. Same reason `navigate/navigation-store.ts`
 * and `workspace/tab-picker.ts`'s opener are module-level.
 */
import { useEffect, useRef } from 'react';

let current: { token: object; dismiss: () => void } | null = null;

/**
 * The class that paints the scrim, on `<body>` rather than on each overlay's own element.
 *
 * ══ WHY THE SCRIM CANNOT BELONG TO THE OVERLAY ══
 *
 * It used to: every overlay rendered its own `.modal-overlay`, each carrying the 50% black. That is
 * fine for a single dialog and wrong for a HAND-OFF. Cycling between overlays that live in different
 * component trees — the tab picker is inside `tab-group.tsx`, Quick Open and Go To Line inside the
 * navigation chrome — lets React commit the outgoing unmount and the incoming mount in SEPARATE
 * frames. For that one frame no scrim exists anywhere, and the whole window jumps to full brightness
 * and back: a flash, intermittent, and only ever on a cross-tree swap, which is exactly what a user
 * reported after living with it.
 *
 * The slot above is already continuous across a hand-off — the claim is written before the incumbent
 * is dismissed — so hanging the scrim on the SLOT rather than on the overlays removes the gap by
 * construction instead of racing it. There is exactly one scrim while any overlay is up, and it does
 * not blink when one replaces another.
 *
 * `.modal-overlay` keeps its own background for the dialogs that are NOT in this registry — confirm,
 * project settings, the app-close prompt. Those are one-at-a-time by nature and never hand off.
 */
const listeners = new Set<() => void>();

function syncScrim(): void {
  for (const listen of listeners) listen();
}

/**
 * Subscribe to "is an overlay holding the slot", for the one component that paints the scrim.
 *
 * ══ WHY THIS IS NOT A CLASS ON <body> ══
 *
 * It was, for about ten minutes, and it dimmed the modals as well as the app. A `<body>` pseudo-
 * element sits in the ROOT stacking context, and the overlays do not: the window's zoom wrapper
 * establishes a stacking context of its own, so every overlay inside it — z-index 2000 and all — is
 * composited as part of that one subtree. A scrim outside it therefore paints above the lot,
 * however large its z-index looks next to theirs. Comparing the two numbers is meaningless when
 * they are not in the same context, which is exactly the trap that makes this bug look impossible
 * on paper.
 *
 * Painting the scrim from INSIDE the app tree puts it back in the same stacking context as the
 * overlays, where 1999 versus 2000 means what it appears to mean.
 */
export function subscribeTransientOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Claim the window's one overlay slot, dismissing whichever overlay held it.
 *
 * Returns the release to call when this overlay closes or unmounts. Calling it more than once, or
 * after another overlay has taken the slot, is a no-op.
 */
export function claimTransientOverlay(dismiss: () => void): () => void {
  const token = {};
  const incumbent = current;
  current = { token, dismiss };
  syncScrim();
  if (incumbent) {
    try {
      incumbent.dismiss();
    } catch {
      /*
       * An overlay tearing down badly must not be able to stop the new one opening. The claim is
       * already recorded above, so swallowing here leaves the registry consistent: the incumbent is
       * off the books whether or not its own teardown finished.
       */
    }
  }
  return () => {
    if (current?.token !== token) return;
    current = null;
    syncScrim();
  };
}

/**
 * The React seam every overlay uses — one line at the call site, no state moved anywhere.
 *
 * The effect is keyed on `open` ALONE. `dismiss` is nearly always an inline arrow, so a fresh
 * identity on every render; in the dependency list it would re-run the effect on every render,
 * releasing and re-claiming the slot each time — and a re-claim dismisses the incumbent, which for
 * two overlays racing each other's renders is an endless mutual dismissal. Reading it through a ref
 * keeps the claim stable for as long as the overlay is open while still calling the LATEST closure,
 * which matters because the dismissal usually closes over current props.
 */
export function useTransientOverlay(open: boolean, dismiss: () => void): void {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!open) return undefined;
    // Unmount is handled by this cleanup: an overlay whose component goes away — window closed, tab
    // group unmounted, panel destroyed — leaves no callback behind for the next open to call into.
    return claimTransientOverlay(() => latest.current());
  }, [open]);
}

/**
 * Is a transient overlay holding this window right now?
 *
 * Asked by `keybindings/scope.ts`, and by nothing else. The keyboard guard that keeps a panel's
 * find bar in possession of its own keys (FR-017f) reads "an `<input>` has focus" — and while an
 * overlay is up, the `<input>` with focus is the OVERLAY'S filter box, which is not a panel surface
 * at all. Without this fact, `Ctrl+Alt+T` and `Ctrl+G` were dead the moment any overlay had the
 * caret, so four of SC-017's six orderings could not be driven by hand: the chord resolved to
 * nothing and the user saw a keystroke do nothing.
 */
export function transientOverlayOpen(): boolean {
  return current !== null;
}

/** Test-only: drop whatever holds the slot, so a unit test starts from a known state. */
export function __resetTransientOverlayForTests(): void {
  current = null;
}
