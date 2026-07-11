/**
 * Panel-type descriptor types (005 Phase A — pure, no OS/DOM). A descriptor is
 * the single extension seam: it declares a type's id, label, declarative inputs,
 * default values, validation (gates Confirm, FR-005) and how confirmed values
 * become the persisted `PanelConfig`. The renderer form is generic over `inputs`
 * so a future type plugs in with no change to the selection/confirm/clear flow
 * (SC-010).
 */
import type { PanelConfig, PanelKind } from '../workspace/model.js';

/**
 * A single flavour-like option offered to a dropdown input. Kept generic so the
 * `panel-type/` module stays decoupled from the `terminal/` domain — the renderer
 * maps concrete terminal flavours (Phase B) into this shape when building context.
 */
export interface FlavourOption {
  value: string;
  label: string;
  /** Default startup params pre-filled when this option is chosen (terminal). */
  defaultParams: string;
}

/**
 * Context passed to a descriptor's `defaults`/`validate`/`buildConfig`. Carries
 * the active project's root (null when no project is active — blocks confirming a
 * Terminal, FR no-project edge) and the available flavour options (stub in Phase
 * A, machine-detected ∪ user-defined in Phase B).
 */
export interface PanelTypeContext {
  projectRoot: string | null;
  flavours: readonly FlavourOption[];
  /**
   * The Panel has no owning project and its content should default to the user's
   * home directory (a sub-workspace-owned Panel — FR-028). When set, a null
   * `projectRoot` no longer blocks confirming a Terminal.
   */
  rootless?: boolean;
}

/** Outcome of a descriptor's validation: ok, or per-input error messages. */
export type ValidationResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** A declarative form input the renderer renders generically. */
export interface PanelTypeInputSpec {
  key: string;
  label: string;
  control: 'dropdown' | 'text';
  required?: boolean;
  /** Dropdown option source (e.g. flavours), resolved from context. */
  options?: (ctx: PanelTypeContext) => Array<{ value: string; label: string }>;
}

/** Map of input keys to their current string values in the form. */
export type PanelTypeValues = Record<string, string>;

/**
 * The registrable description of a Panel type (the open extension point, FR-002).
 * `V` is the type's form-values shape (defaults to a string keymap).
 */
export interface PanelTypeDescriptor<V extends PanelTypeValues = PanelTypeValues> {
  id: PanelKind;
  label: string;
  /** Theme icon token marking this panel type in its header (012). Optional so a
   *  future type can omit it; the renderer falls back to no icon. */
  icon?: string;
  inputs: PanelTypeInputSpec[];
  defaults(ctx: PanelTypeContext): V;
  validate(values: V, ctx: PanelTypeContext): ValidationResult;
  buildConfig(values: V, ctx: PanelTypeContext): PanelConfig;
}
