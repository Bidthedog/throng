/**
 * The Editor panel type (006). A `PanelTypeDescriptor` registered into the shared
 * panel-type registry alongside `terminalPanelType` — the single new-type seam.
 * Unlike Terminal it declares **no** configuration inputs: confirming creates a
 * new, empty, in-memory document (no `filePath`) that is not written to disk until
 * saved (FR-002). It validates whenever the Panel has a context to own the
 * document — a project root or a sub-workspace (`rootless`).
 *
 * An editor does not revert to the type-selection form BY ITSELF (FR-006) — unlike a terminal,
 * whose content ending reverts the Panel. What changed with 030 US4 (#236, FR-043) is that the user
 * can now ask for it: an editor whose file cannot be read shows the shared failure banner, and its
 * *Clear panel type* control returns the Panel to the selection form with its position and title
 * intact. Before that this comment read "`clearPanelType` is not wired for editors", and the only
 * way out of a stranded editor was to destroy the Panel and lose both. The wiring lives in the
 * renderer (`ui/src/renderer/editor/clear-editor-panel-type.ts`), because disposing the document —
 * its dirty-file lock and its recovery snapshot — is not this layer's business; the layout operation
 * it ends with is the same `clearPanelType` the terminal has always used.
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
  icon: 'editorPanel',
  inputs: [],
  defaults: (): EditorValues => ({}),
  validate: (_values: EditorValues, ctx: PanelTypeContext): ValidationResult =>
    ctx.projectRoot !== null || ctx.rootless === true ? { ok: true } : { ok: false, errors: {} },
  // A new, empty, unpathed document: no filePath until the user saves.
  buildConfig: (): EditorPanelConfig => ({}),
};
