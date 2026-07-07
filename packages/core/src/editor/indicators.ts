/**
 * Unsaved-indicator aggregation (006 Phase C, US8). Pure. A single themeable red
 * dot is shown on a Panel, its Tab, and its project when it/they hold unsaved
 * editor changes; these predicates roll a document's `dirty` flag up each level.
 * No OS/DOM.
 */
import type { EditorDocument } from './document.js';

/** The Panel's editor has unsaved changes. */
export function panelUnsaved(doc: EditorDocument | undefined): boolean {
  return doc?.dirty === true;
}

/** Any editor in the Tab has unsaved changes. */
export function tabUnsaved(tabEditors: readonly EditorDocument[]): boolean {
  return tabEditors.some((d) => d.dirty);
}

/** Any editor in the project (across its tabs) has unsaved changes. */
export function projectUnsaved(projectEditors: readonly EditorDocument[]): boolean {
  return projectEditors.some((d) => d.dirty);
}
