/**
 * Revealing text hidden by a Markdown section fold, through the fold authority (049 R5, FR-005 – FR-007a).
 *
 * Find lands on a match, or replaces one, inside a section the user collapsed. The view must show it — but
 * the fold is the DOCUMENT's state (Principle XI): `fold-state-store.ts` caches it, main holds it, every view
 * of the document follows it, and `syncFoldRanges` re-derives CodeMirror's ranges from it after every change.
 * A bare `unfoldEffect` on this view would be undone by the next sync and main would never hear of it, so a
 * reveal is a fold-STATE write — `setDocumentFoldState`, the same call a gutter click makes — followed by an
 * immediate `syncFoldRanges` so this view shows the match before the caller scrolls to it.
 *
 * Find never collapses (FR-006): only sections are OPENED here, and only the ones whose body hides the text.
 */
import type { EditorView } from '@codemirror/view';
import { isCollapsed, setSection, type FoldState } from '@throng/core';
import { documentFoldState, setDocumentFoldState } from './fold-state-store.js';
import { liveSections, syncFoldRanges, type EditorFoldSection } from './markdown-fold.js';

/** What a reveal reads and writes: the document's fold key, this panel (so main hears it), and the seed. */
export interface FoldRevealDeps {
  readonly docKey: () => string;
  readonly panelId: string;
  /** The state a never-before-seen document starts from — `editor.markdownSectionsOpen`. */
  readonly seedDefault: () => FoldState;
}

/**
 * The collapsed sections whose fold HIDES offset `pos`: those containing it, own or ancestor, other than where it
 * sits on a section's own heading line (the heading line is never folded away).
 */
export function hidingSections(
  sections: readonly EditorFoldSection[],
  view: EditorView,
  pos: number,
  state: FoldState,
): string[] {
  const line0 = view.state.doc.lineAt(pos).number - 1;
  return sections
    .filter((s) => s.startLine < line0 && line0 <= s.endLine && isCollapsed(state, s.slug))
    .map((s) => s.slug);
}

/** Open `slugs` in one authority write and bring this view's fold ranges in line with it. */
function open(view: EditorView, slugs: readonly string[], deps: FoldRevealDeps): void {
  const key = deps.docKey();
  const current = documentFoldState(key, deps.seedDefault());
  const next = slugs.reduce((state, slug) => setSection(state, slug, false), current);
  setDocumentFoldState(key, next, deps.panelId);
  syncFoldRanges(view, liveSections(view), next);
}

/**
 * Make `pos` visible. Opens every collapsed section hiding it (ancestors included) in ONE fold-state write and
 * returns `true`; returns `false` and writes nothing when `pos` is already visible, or there is no Markdown
 * section structure to fold.
 */
export function revealOffset(view: EditorView, pos: number, deps: FoldRevealDeps): boolean {
  const sections = liveSections(view);
  if (sections.length === 0) return false;
  const state = documentFoldState(deps.docKey(), deps.seedDefault());
  const hiding = hidingSections(sections, view, pos, state);
  if (hiding.length === 0) return false;
  open(view, hiding, deps);
  return true;
}

/** Open exactly `slugs` — Replace All's "Replace and unfold" (FR-007a) — in ONE write. No-op for an empty list. */
export function revealSections(view: EditorView, slugs: readonly string[], deps: FoldRevealDeps): void {
  if (slugs.length === 0) return;
  open(view, slugs, deps);
}
