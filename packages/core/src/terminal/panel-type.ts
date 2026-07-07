/**
 * The Terminal panel type (005). A `PanelTypeDescriptor` registered into the
 * panel-type registry: it declares the Flavour dropdown + Startup Params inputs,
 * defaults them (first flavour + its default params), validates (a known flavour
 * must be chosen and a project root must exist — FR-005 / no-project edge), and
 * builds the persisted `TerminalPanelConfig`.
 *
 * Flavours are read from the form context: a stub list in Phase A, the real
 * machine-detected ∪ user-defined union in Phase B. The descriptor itself is
 * flavour-source agnostic.
 */
import type {
  PanelTypeContext,
  PanelTypeDescriptor,
  ValidationResult,
} from '../panel-type/descriptor.js';

/** The Terminal panel type's id. */
export const TERMINAL_KIND = 'terminal';

/** Configuration captured on Confirm of a Terminal Panel (persisted in Panel.config).
 *  A type alias (not an interface) so it is assignable to the open `PanelConfig`
 *  record the registry stores. */
export type TerminalPanelConfig = {
  flavourId: string;
  /** The chosen flavour's display label, captured for the Panel header. */
  flavourLabel?: string;
  /** User-edited Startup Params at confirm time. */
  params: string;
  /** Run this terminal elevated ("as administrator") — one flag per Panel (FR-025). */
  runAsAdmin?: boolean;
};

/**
 * The Terminal type's form values. All values are strings (the generic form is
 * string-keyed); `runAsAdmin` rides as the string `'true'`/`'false'` and is
 * converted to a boolean in {@link TerminalPanelConfig} by `buildConfig`.
 */
export interface TerminalValues {
  flavourId: string;
  params: string;
  /** `'true'`/`'false'` — converted to boolean in the built config. */
  runAsAdmin: string;
  [key: string]: string;
}

export const terminalPanelType: PanelTypeDescriptor<TerminalValues> = {
  id: TERMINAL_KIND,
  label: 'Terminal',
  inputs: [
    {
      key: 'flavourId',
      label: 'Flavour',
      control: 'dropdown',
      required: true,
      options: (ctx) => ctx.flavours.map((f) => ({ value: f.value, label: f.label })),
    },
    { key: 'params', label: 'Startup Params', control: 'text' },
  ],
  defaults: (ctx: PanelTypeContext): TerminalValues => {
    const first = ctx.flavours[0];
    return { flavourId: first?.value ?? '', params: first?.defaultParams ?? '', runAsAdmin: 'false' };
  },
  validate: (values: TerminalValues, ctx: PanelTypeContext): ValidationResult => {
    const errors: Record<string, string> = {};
    if (!values.flavourId) {
      errors.flavourId = 'Choose a flavour';
    } else if (!ctx.flavours.some((f) => f.value === values.flavourId)) {
      errors.flavourId = 'That flavour is not available on this machine';
    }
    // A sub-workspace-owned Panel (rootless) has no project; its terminal launches
    // at the user's home directory, so a null root is allowed there (FR-028).
    if (ctx.projectRoot === null && !ctx.rootless) {
      errors._root = 'No active project to start the terminal in';
    }
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
  },
  buildConfig: (values: TerminalValues, ctx: PanelTypeContext): TerminalPanelConfig => ({
    flavourId: values.flavourId,
    flavourLabel: ctx.flavours.find((f) => f.value === values.flavourId)?.label,
    params: values.params,
    runAsAdmin: values.runAsAdmin === 'true',
  }),
};
