/**
 * Pure state machine for the panel type-selection form (005 / US1). Kept free of
 * React/DOM so it is unit-testable directly (the component is a thin shell over
 * it). Drives: which type is selected, the current per-type input values, whether
 * Confirm is enabled (descriptor validation, FR-005), and the config produced on
 * Confirm. The generic shape means a future panel type plugs in unchanged (SC-010).
 */
import type {
  PanelConfig,
  PanelKind,
  PanelTypeContext,
  PanelTypeRegistry,
  PanelTypeValues,
} from '@throng/core';

export interface FormState {
  /** The chosen panel type, or `null` while nothing is selected. */
  selectedKind: PanelKind | null;
  /** Current input values for the selected type (empty before a selection). */
  values: PanelTypeValues;
}

export interface FormDeps {
  registry: PanelTypeRegistry;
  ctx: PanelTypeContext;
}

/** The initial empty form: no type selected, no values. */
export function initialFormState(): FormState {
  return { selectedKind: null, values: {} };
}

/**
 * Select a panel type, seeding its descriptor defaults (FR-003). Selecting an
 * unknown type is ignored (returns the prior state).
 */
export function selectKind(state: FormState, kind: PanelKind, deps: FormDeps): FormState {
  const descriptor = deps.registry.get(kind);
  if (!descriptor) return state;
  return { selectedKind: kind, values: descriptor.defaults(deps.ctx) };
}

/** Update one input value. */
export function setValue(state: FormState, key: string, value: string): FormState {
  return { ...state, values: { ...state.values, [key]: value } };
}

/** Reset the form to its initial empty state (the Clear button — FR-004). */
export function clearForm(): FormState {
  return initialFormState();
}

/** Whether Confirm is enabled: a valid type with valid required inputs (FR-005). */
export function canConfirm(state: FormState, deps: FormDeps): boolean {
  if (state.selectedKind === null) return false;
  const descriptor = deps.registry.get(state.selectedKind);
  if (!descriptor) return false;
  return descriptor.validate(state.values, deps.ctx).ok;
}

/**
 * The `{ kind, config }` to assign on Confirm, or `null` when not confirmable.
 * `config` is produced by the descriptor's `buildConfig` (runs only when valid).
 */
export function confirmConfig(
  state: FormState,
  deps: FormDeps,
): { kind: PanelKind; config: PanelConfig } | null {
  if (state.selectedKind === null) return null;
  const descriptor = deps.registry.get(state.selectedKind);
  if (!descriptor || !descriptor.validate(state.values, deps.ctx).ok) return null;
  return { kind: state.selectedKind, config: descriptor.buildConfig(state.values, deps.ctx) };
}
