/**
 * The effective language of each open document (016, FR-002a/FR-004b/FR-005a).
 *
 * Two things live here: the CodeMirror COMPARTMENT that lets a grammar be swapped in place, and a
 * tiny reactive store of "what language is this panel showing?" — which is what the status strip
 * renders and the picker writes to.
 *
 * The compartment is why FR-004b's "without reopening" is achievable: remapping `.h` to C
 * reconfigures the language extension of a LIVE view, keeping its content, cursor, scroll position
 * and undo history exactly where they were. Rebuilding the view would lose all four.
 */
import { useSyncExternalStore } from 'react';
import { Compartment } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { PLAIN_TEXT_ID, resolveLanguage, type LanguageResolution } from '@throng/core';
import { loadLanguage } from './language-loaders.js';

/** The slot the active grammar occupies in every editor view. */
export const languageCompartment = new Compartment();

const resolutions = new Map<string, LanguageResolution>();
const listeners = new Set<() => void>();

/**
 * Which language request is the CURRENT one, per panel (FR-002a).
 *
 * Deciding a panel's language is asynchronous twice over — a database read for the override, then a
 * dynamic `import()` of the grammar chunk — and the requests overlap: clicking through the tree
 * starts the next before the last has finished, and opening a single file fires TWO (one when the
 * authority broadcasts the new content, one when the panel records the new path).
 *
 * Without this, the winner is whichever chunk ARRIVED last rather than whichever language was ASKED
 * for last, and chunk arrival is decided by Vite's cache: a cold grammar beats a warm one. That is
 * why the bug depended on which file you opened beforehand — a `.sql` opened after a `.ts` came up
 * wearing the TypeScript grammar, which still colours numbers and strings, so it read as "partially
 * highlighted" rather than plainly wrong. It is also why a plain-text file could keep the previous
 * file's colours while the status strip — written synchronously — correctly said "Plain Text".
 */
const generations = new Map<string, number>();

/**
 * Claim a panel's language slot. Returns a guard that is true only while this claim is the newest.
 *
 * Called SYNCHRONOUSLY at request time, so making a request is what makes every older one stale —
 * whatever order they finish in.
 */
export function claimLanguage(panelId: string): () => boolean {
  const generation = (generations.get(panelId) ?? 0) + 1;
  generations.set(panelId, generation);
  return () => generations.get(panelId) === generation;
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setPanelLanguage(panelId: string, resolution: LanguageResolution): void {
  const prev = resolutions.get(panelId);
  if (prev?.languageId === resolution.languageId && prev.source === resolution.source) return;
  resolutions.set(panelId, resolution);
  emit();
}

export function getPanelLanguage(panelId: string): LanguageResolution | undefined {
  return resolutions.get(panelId);
}

export function removePanelLanguage(panelId: string): void {
  generations.delete(panelId);
  if (resolutions.delete(panelId)) emit();
}

/** Subscribe to one panel's effective language (the status strip). */
export function usePanelLanguage(panelId: string): LanguageResolution | undefined {
  return useSyncExternalStore(
    subscribe,
    () => resolutions.get(panelId),
    () => resolutions.get(panelId),
  );
}

export interface EffectiveLanguageArgs {
  filePath: string | null;
  /** The document's persisted override (FR-005a — outranks detection). */
  override?: string | null;
  /** The user's extension remaps (`editor.languageByExtension`). */
  userMapping?: Readonly<Record<string, string>>;
}

/**
 * The language to render, by the precedence chain. An unpathed (never-saved) document has no
 * extension to detect from, so it is plain text — but an explicit override still applies to it,
 * which is what makes a scratch buffer usable as, say, a SQL scratchpad.
 */
export function effectiveLanguage(args: EffectiveLanguageArgs): LanguageResolution {
  if (!args.filePath) {
    return args.override
      ? resolveLanguage({ fileName: '', override: args.override })
      : { languageId: PLAIN_TEXT_ID, source: 'plaintext' };
  }
  return resolveLanguage({
    fileName: args.filePath,
    override: args.override ?? null,
    userMapping: args.userMapping,
  });
}

/**
 * Swap the grammar of a LIVE view (FR-004b). Plain text — and any id the registry no longer knows
 * (FR-005b) — reconfigures the compartment to nothing, which is the correct rendering for both:
 * unhighlighted, editable, no error.
 *
 * The load is asynchronous (grammars are lazily-imported chunks), so a view destroyed mid-load is
 * checked for before dispatching.
 */
export async function applyLanguage(
  view: EditorView,
  languageId: string,
  stillMounted: () => boolean = () => true,
): Promise<void> {
  let support = null;
  try {
    support = await loadLanguage(languageId);
  } catch (err) {
    // A grammar chunk that fails to load must not take the editor down with it — the document is
    // still perfectly editable as plain text. But it must not vanish silently either: an unspoken
    // failure here looks EXACTLY like "this language just isn't highlighted", which is how a broken
    // loader survives a whole test suite.
    console.error(`[throng] could not load the ${languageId} grammar; falling back to plain text`, err);
  }

  /**
   * Re-checked AFTER the await, not only before it (FR-002a).
   *
   * `loadLanguage` is a dynamic `import()`, so this function suspends for as long as the grammar's
   * chunk takes to arrive — and in that window the panel may have been pointed at a different file
   * entirely. Without this second check the LAST CHUNK TO ARRIVE wins rather than the last language
   * REQUESTED, and a cold chunk beats a warm one: open a `.ts` then a `.sql` and the SQL file gets
   * the TypeScript grammar, which still colours its numbers and strings and so reads as "partially
   * highlighted" instead of "wrong". Open a plain-text file after any highlighted one and it keeps
   * the previous grammar, while the status strip — set synchronously — correctly says Plain Text.
   *
   * The guard the caller passes is what makes "current" mean "the newest request", not merely "the
   * view still exists".
   */
  if (!stillMounted()) return;
  view.dispatch({
    effects: languageCompartment.reconfigure(support ? support : []),
  });
}
