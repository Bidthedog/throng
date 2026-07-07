/**
 * The Editor panel type (006). A `PanelTypeDescriptor` registered into the shared
 * panel-type registry alongside `terminalPanelType` — the single new-type seam.
 * Unlike Terminal it declares **no** configuration inputs: confirming creates a
 * new, empty, in-memory document (no `filePath`) that is not written to disk until
 * saved (FR-002). It validates whenever the Panel has a context to own the
 * document — a project root or a sub-workspace (`rootless`) — and never reverts to
 * the type-selection form (FR-006; `clearPanelType` is not wired for editors).
 *
 * Pure — no OS/DOM. Plugs into the 005 form with no change to the shared
 * select/confirm/clear flow beyond one additive `'editor'` branch (SC-016).
 */
import type {
  PanelTypeContext,
  PanelTypeDescriptor,
  ValidationResult,
} from '../panel-type/descriptor.js';
import type { EditorPanelConfig } from '../workspace/model.js';

/** The Editor panel type's id. */
export const EDITOR_KIND = 'editor';

/** The Editor type's form values — none (no configuration inputs). */
export type EditorValues = Record<string, never>;

export const editorPanelType: PanelTypeDescriptor<EditorValues> = {
  id: EDITOR_KIND,
  label: 'Editor Panel',
  inputs: [],
  defaults: (): EditorValues => ({}),
  validate: (_values: EditorValues, ctx: PanelTypeContext): ValidationResult =>
    ctx.projectRoot !== null || ctx.rootless === true ? { ok: true } : { ok: false, errors: {} },
  // A new, empty, unpathed document: no filePath until the user saves.
  buildConfig: (): EditorPanelConfig => ({}),
};
