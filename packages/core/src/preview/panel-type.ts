/**
 * The Preview panel type (044) — REGISTERED but not OFFERED, on 043 FR-017's precedent.
 *
 * A preview is only ever created by opening one (the status-bar button, Open Preview, Open In →
 * Preview, a default open action of Preview), never chosen from the New Panel form. But the registry
 * is also where a panel's header label and icon resolve — `registry.get(panel.kind)` in
 * `panel-placeholder.tsx` and `use-panel-display-names.ts` — so leaving it unregistered would ship a
 * panel headed `preview` with no icon. `offered: false` gets both.
 *
 * `PREVIEW_KIND` lives here, beside the descriptor, following the convention every other panel type
 * already sets — `EDITOR_KIND` in `editor/panel-type.ts`, `TERMINAL_KIND` in `terminal/panel-type.ts`,
 * `FIND_IN_FILES_KIND` in `find-in-files/panel-type.ts`. The plan named a separate `preview/kind.ts`;
 * a second home for one kind constant would be the only one of its kind.
 *
 * Pure — no OS/DOM.
 */
import type {
  PanelTypeContext,
  PanelTypeDescriptor,
  ValidationResult,
} from '../panel-type/descriptor.js';
import type { PreviewPanelConfig } from '../workspace/model.js';
import { previewPathOf } from '../workspace/persisted-paths.js';
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from './provider.js';

/** The Preview panel type's id. */
export const PREVIEW_KIND = 'preview';

/** The Preview type's form values — none (no configuration inputs). */
export type PreviewValues = Record<string, never>;

export const previewPanelType: PanelTypeDescriptor<PreviewValues> = {
  id: PREVIEW_KIND,
  label: 'Preview',
  icon: 'preview',
  offered: false,
  inputs: [],
  defaults: (): PreviewValues => ({}),
  // A preview shows a file inside a project and may read nothing outside it (FR-004, FR-074); a
  // rootless context names no project to confine it to. Never reached through the form, which does
  // not offer the type — stated for any caller that validates a descriptor generically.
  validate: (_values: PreviewValues, ctx: PanelTypeContext): ValidationResult =>
    ctx.projectRoot !== null ? { ok: true } : { ok: false, errors: {} },
  // The file and the history are written by the preview as it opens and navigates, not by a form.
  buildConfig: (): PreviewPanelConfig => ({}),
};

/**
 * 054 FR-005 (research R2) — the panel type a preview IS, named after its provider: "Markdown Preview".
 * The persisted kind stays {@link PREVIEW_KIND}; the provider is the type's identity.
 */
export function previewPanelTypeLabel(provider: Pick<PreviewProviderDescriptor, 'displayName'>): string {
  return `${provider.displayName} Preview`;
}

/**
 * 054 FR-009 — which provider's panel type a preview is: its persisted `providerId` when a registered
 * provider answers to it, else the provider of the file it shows (`previewPathOf`'s precedence). A layout
 * written before 054 therefore restores as its file's type. Pure and read-only — it never writes the
 * derived id back, so restoring the same layout again changes nothing. `undefined` when no provider
 * claims the file; 044's restore filter then applies, unchanged.
 */
export function previewProviderIdOf(
  config: PreviewPanelConfig | undefined,
  registry: PreviewProviderRegistry,
): string | undefined {
  const persisted = config?.providerId;
  if (persisted !== undefined && registry.get(persisted) !== undefined) return persisted;
  const path = previewPathOf(config);
  return path === undefined ? undefined : registry.forPath(path)?.id;
}
