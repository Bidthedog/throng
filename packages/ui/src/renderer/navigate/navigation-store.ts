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
 * Declared now and **not read until Phase 8** — the two `editor.navigation.remember*` settings that
 * surface these ship off (FR-058), and the modals open empty at the shipped defaults (M1). Declared
 * here rather than added later so the store has one shape, and so the fields are visibly per-window
 * and visibly not persisted, which is the requirement they exist to satisfy.
 */
export interface RememberedInput {
  /** The last query that OPENED a file. Never a query abandoned with Escape (FR-061). */
  quickOpenQuery: string | null;
  /** The last number that was GONE TO (FR-061). */
  gotoLineNumber: number | null;
}

let modal: NavigationModal = null;
let remembered: RememberedInput = { quickOpenQuery: null, gotoLineNumber: null };
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

/** What the modals accepted last (Phase 8). */
export function rememberedInput(): RememberedInput {
  return remembered;
}

/** Record a value a modal ACCEPTED, or `null` to discard what is held (FR-061, FR-063). */
export function remember(patch: Partial<RememberedInput>): void {
  remembered = { ...remembered, ...patch };
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
