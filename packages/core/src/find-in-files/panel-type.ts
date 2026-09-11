/**
 * The Find in Files panel type (043, FR-017/FR-018, R17). A `PanelTypeDescriptor` registered into
 * the shared registry alongside Terminal and Editor — with one difference from both: it is
 * **registered but not offered**.
 *
 * That is not a contradiction, and the reason is worth stating where the flag is set. A panel of
 * this kind is only ever created by a command (`Ctrl+Shift+F`, the explorer toolbar, the folder
 * context menu), never chosen from the New Panel dropdown, which is what FR-017 asks for. But the
 * registry is ALSO the source of a panel's header label and icon — `panel-placeholder.tsx` and
 * `use-panel-display-names.ts` both resolve `registry.get(panel.kind)` and fall back to the raw
 * kind string. So "just don't register it" would satisfy FR-017 by shipping a panel headed
 * `findInFiles` with no icon. `offered: false` gets both.
 *
 * Like Editor, it declares no configuration inputs: there is no form. The query — term, match
 * modes, scope, replacement — is written by the panel itself into `FindInFilesPanelConfig` as the
 * user works, not decided up front.
 *
 * Pure — no OS/DOM.
 */
import type {
  PanelTypeContext,
  PanelTypeDescriptor,
  ValidationResult,
} from '../panel-type/descriptor.js';
import type { FindInFilesPanelConfig } from '../workspace/model.js';

/** The Find in Files panel type's id. */
export const FIND_IN_FILES_KIND = 'findInFiles';

/** The Find in Files type's form values — none (no configuration inputs). */
export type FindInFilesValues = Record<string, never>;

export const findInFilesPanelType: PanelTypeDescriptor<FindInFilesValues> = {
  id: FIND_IN_FILES_KIND,
  label: 'Find in Files',
  icon: 'findInFiles',
  // FR-017 — registered, so the header resolves; absent from the New Panel dialog.
  offered: false,
  inputs: [],
  defaults: (): FindInFilesValues => ({}),
  /*
   * An open PROJECT, and a `rootless` sub-workspace is deliberately not a substitute (FR-018).
   *
   * The Editor type accepts `rootless` because a sub-workspace can own a document. A search cannot:
   * FR-018 confines every scan to the active project's tree, and a rootless Panel names no tree to
   * confine it to. Accepting one would leave the panel with nowhere to search and no way to say so.
   */
  validate: (_values: FindInFilesValues, ctx: PanelTypeContext): ValidationResult =>
    ctx.projectRoot !== null ? { ok: true } : { ok: false, errors: {} },
  // The query is written by the panel as the user works, not built from a form.
  buildConfig: (): FindInFilesPanelConfig => ({}),
};
