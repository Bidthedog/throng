/**
 * The navigation modals' state — ONE slot, per window (033, contracts/navigation-modals.md §2,
 * data-model.md §§6–7).
 *
 * ══ WHY ONE SLOT AND NOT TWO PIECES OF STATE ══
 *
 * Quick Open and Go To Line are both centred modals over the whole window. Held as two independent
 * booleans they can both be true, and then the app draws two scrims, two focus traps fighting over
 * the caret, and an Escape that dismisses whichever one happened to mount second. FR-066 forbids
 * that, and the cheapest way to keep a promise like "exactly one" is to make the other state
 * unrepresentable: opening either modal REPLACES whatever the slot held, and opening one that is
 * already open writes the same value back.
 *
 * ══ WHY THE OPENER IS REGISTERED RATHER THAN CALLED ══
 *
 * The chord is resolved by the window-level capture listener in `app.tsx`, which has no route into a
 * component's state — the same problem `workspace/tab-picker.tsx` and `workspace/panel-rename.ts`
 * already solve this way. It matters more here than there, because opening Quick Open is CONDITIONAL
 * on this window having a project root (FR-018, A5, R6), and the root is known to `NavigationChrome`
 * and to nothing in `app.tsx`. So the chrome registers how to open, and the listener asks.
 *
 * **Nothing here is persisted.** The remembered inputs below live for the running application only
 * and never cross a process boundary (FR-062).
 */
import { useSyncExternalStore } from 'react';

/** Which modal is on screen, if any. `invokedFrom` decides whether the target control is drawn. */
export type NavigationModal =
  | { kind: 'quickOpen'; invokedFrom: { editorPanelId: string } | null }
  | { kind: 'gotoLine'; panelId: string }
  | null;

/**
 * What each modal accepted last (data-model.md §6).
 *
 * A module-level `let` in the renderer bundle, which IS "per window, for the running application
 * only" (FR-062): a sub-workspace window is its own renderer realm with its own copy of this module,
 * and nothing here is written through `window.throng`, so it cannot reach disk or another process
 * even by accident. There is no persistence to opt out of — the requirement is met by there being
 * no code that could meet the opposite one.
 */
export interface RememberedInput {
  /** The last query that OPENED a file. Never a query abandoned with Escape (FR-061). */
  quickOpenQuery: string | null;
  /** The last number that was GONE TO (FR-061). */
  gotoLineNumber: number | null;
}

let modal: NavigationModal = null;
let remembered: RememberedInput = { quickOpenQuery: null, gotoLineNumber: null };
/**
 * The project root `quickOpenQuery` was accepted against (FR-062).
 *
 * Held beside the query rather than derived, because "the active project changed" is a comparison
 * and there is nothing else to compare against. A query describes a candidate set, and a candidate
 * set belongs to exactly one root.
 */
let quickOpenRoot: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The modal currently on screen — the one piece of state a component renders from. */
export function useNavigationModal(): NavigationModal {
  return useSyncExternalStore(subscribe, () => modal);
}

/**
 * What the slot holds right now, read OUTSIDE React.
 *
 * `useNavigationModal` is the way a component renders from this state; this is for the one thing a
 * hook cannot answer — an unmount cleanup asking "am I going away because I was closed, or because
 * something else took the slot?". The two need opposite behaviour and are otherwise identical from
 * inside the component that is being removed (FR-065, FR-071).
 */
export function navigationModal(): NavigationModal {
  return modal;
}

/** Open (or replace) the modal in the slot. S1 and S2 are this function being the only way in. */
export function setNavigationModal(next: NavigationModal): void {
  if (modal === next) return;
  modal = next;
  emit();
}

/** Close whatever is open. A no-op when nothing is. */
export function closeNavigationModal(): void {
  setNavigationModal(null);
}

/**
 * What the modals accepted last (FR-060) — read at OPEN time and at no other moment.
 *
 * Deliberately not a hook. Nothing re-renders when this changes: the value is consumed once, as the
 * modal mounts, to seed an input the user then owns. A subscription would re-render the picker's
 * whole list every time a query was accepted, for a value that is by then no longer being read.
 */
export function rememberedInput(): RememberedInput {
  return remembered;
}

/**
 * Record the query Quick Open ACCEPTED, with the root it was accepted against (FR-061, FR-062).
 *
 * "Accepted" is concrete: the user chose a row and the file was routed to the opener. A query that
 * was typed and then abandoned with Escape never reaches here, because dismissal has no path to
 * this function at all — which is a stronger guarantee than a flag saying it was a dismissal.
 */
export function rememberQuickOpenQuery(query: string, root: string | null): void {
  remembered = { ...remembered, quickOpenQuery: query };
  quickOpenRoot = root;
}

/**
 * Record the line Go To Line ACCEPTED (FR-061).
 *
 * The RESOLVED line, not the typed text. A user who asks for line 99999 in a 300-line file goes to
 * line 300, and 300 is where they went — reopening with `99999` would show them a number that names
 * nothing in the document they are looking at.
 */
export function rememberGotoLineNumber(line: number): void {
  remembered = { ...remembered, gotoLineNumber: line };
}

/**
 * FR-062 — Quick Open's remembered query is discarded when the ACTIVE PROJECT changes.
 *
 * Its candidate set was project-scoped, so a query carried across describes nothing: at best it
 * matches a different file, at worst it matches none and looks broken.
 *
 * A `null` root is NOT a project change. A window can be momentarily without one (a rootless
 * sub-workspace panel taking focus, a project still resolving), and treating that as a switch would
 * discard the query on a transition the user never made — while Quick Open cannot open without a
 * root anyway (A5), so nothing is surfaced in the meantime either way.
 */
export function noteActiveProjectRoot(root: string | null): void {
  if (root === null || root === '') return;
  if (quickOpenRoot === null || quickOpenRoot === root) {
    quickOpenRoot = root;
    return;
  }
  remembered = { ...remembered, quickOpenQuery: null };
  quickOpenRoot = root;
}

/**
 * FR-063 — a setting that is OFF holds nothing.
 *
 * Called with the live settings, so turning one off discards what it held rather than merely hiding
 * it. Hiding would be the wrong shape: the value would come straight back the moment the user
 * switched the setting on again, presenting something from before the switch-off as if it were the
 * last thing they did.
 *
 * Idempotent, because it is driven by an effect that re-runs on any settings change.
 */
export function applyRememberSettings(on: {
  quickOpenQuery: boolean;
  gotoLineNumber: boolean;
}): void {
  if (!on.quickOpenQuery && remembered.quickOpenQuery !== null) {
    remembered = { ...remembered, quickOpenQuery: null };
    quickOpenRoot = null;
  }
  if (!on.gotoLineNumber && remembered.gotoLineNumber !== null) {
    remembered = { ...remembered, gotoLineNumber: null };
  }
}

/** Test seam only — drops everything this window remembers. Never called by application code. */
export function resetRememberedInput(): void {
  remembered = { quickOpenQuery: null, gotoLineNumber: null };
  quickOpenRoot = null;
}

/*
 * The chord's route in. One registration per window realm, held by `NavigationChrome`.
 */
let quickOpenOpener: (() => boolean) | null = null;

/** Register (or clear, with `null`) how Quick Open opens. */
export function registerQuickOpen(open: (() => boolean) | null): void {
  quickOpenOpener = open;
}

/**
 * Ask for Quick Open. Returns whether it actually opened — `false` when no chrome is mounted, and
 * `false` when this window has no project root, which is FR-018's "the chord opens nothing".
 */
export function requestQuickOpen(): boolean {
  return quickOpenOpener?.() ?? false;
}
