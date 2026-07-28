/**
 * The Terminal panel type (005). A `PanelTypeDescriptor` registered into the
 * panel-type registry: it declares the Flavour dropdown + Shell Arguments / Startup Command inputs,
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
  /** User-edited **Shell Arguments** at confirm time — the arguments handed to the shell
   *  itself (025 FR-002c; was `params`). */
  shellArguments: string;
  /** A command the shell RUNS on cold start, leaving an interactive prompt behind
   *  (025 FR-001). Distinct from {@link shellArguments}: that configures the shell,
   *  this is a command the shell executes. */
  startupCommand?: string;
  /** Opt-in: keep {@link startupCommand} up to date from whatever command held the
   *  terminal when it ended (025 FR-015). Defaults to off. */
  rememberCommand?: boolean;
  /** Reopen this terminal in the directory it was last working in (025 FR-027).
   *  Defaults to ON — a remembered directory cannot execute anything, and Principle III
   *  makes the working-directory tag mandatory. Absent means on. */
  rememberDirectory?: boolean;
  /** Run this terminal elevated ("as administrator") — one flag per Panel (FR-025). */
  runAsAdmin?: boolean;
};

/**
 * Read a persisted Terminal config, migrating the pre-025 `params` key to
 * `shellArguments` (FR-002d). Read-side only: nothing is rewritten on disk, so a
 * failed config write cannot lose the original value (FR-002e), and re-reading an
 * already-migrated config never sees the old key, which makes it idempotent.
 */
export function readTerminalPanelConfig(raw: Record<string, unknown> | undefined): {
  shellArguments: string;
  startupCommand: string;
  rememberCommand: boolean;
  rememberDirectory: boolean;
} {
  const shellArguments =
    typeof raw?.shellArguments === 'string'
      ? raw.shellArguments
      : typeof raw?.params === 'string'
        ? raw.params
        : '';
  return {
    shellArguments,
    startupCommand: typeof raw?.startupCommand === 'string' ? raw.startupCommand : '',
    rememberCommand: raw?.rememberCommand === true,
    // Defaults ON: absent (a pre-025 panel, or one confirmed before this control existed) means
    // remember. Only an explicit `false` turns it off.
    rememberDirectory: raw?.rememberDirectory !== false,
  };
}

/**
 * The Terminal type's form values. All values are strings (the generic form is
 * string-keyed); `runAsAdmin` and `rememberCommand` ride as the strings
 * `'true'`/`'false'` and are converted to booleans in {@link TerminalPanelConfig}
 * by `buildConfig`.
 */
export interface TerminalValues {
  flavourId: string;
  shellArguments: string;
  startupCommand: string;
  /** `'true'`/`'false'` — converted to boolean in the built config. */
  rememberCommand: string;
  /** `'true'`/`'false'` — converted to boolean in the built config. */
  rememberDirectory: string;
  /** `'true'`/`'false'` — converted to boolean in the built config. */
  runAsAdmin: string;
  [key: string]: string;
}

export const terminalPanelType: PanelTypeDescriptor<TerminalValues> = {
  id: TERMINAL_KIND,
  label: 'Terminal',
  icon: 'terminal',
  inputs: [
    {
      key: 'flavourId',
      label: 'Flavour',
      control: 'dropdown',
      required: true,
      options: (ctx) => ctx.flavours.map((f) => ({ value: f.value, label: f.label })),
    },
    { key: 'shellArguments', label: 'Shell Arguments', control: 'text' },
    { key: 'startupCommand', label: 'Startup Command', control: 'text' },
    { key: 'rememberCommand', label: 'Remember the last running command', control: 'checkbox' },
    { key: 'rememberDirectory', label: 'Reopen in the last directory', control: 'checkbox' },
  ],
  defaults: (ctx: PanelTypeContext): TerminalValues => {
    const first = ctx.flavours[0];
    // 025 FR-007a: a Panel whose terminal has been closed pre-fills from what it remembered,
    // so the empty state doubles as the edit screen. With no memory this is today's behaviour.
    const memory = ctx.terminalMemory;
    const flavourId = memory?.flavourId ?? first?.value ?? '';
    const chosen = ctx.flavours.find((f) => f.value === flavourId) ?? first;
    return {
      flavourId,
      shellArguments: memory?.shellArguments ?? chosen?.defaultShellArguments ?? '',
      startupCommand: memory?.startupCommand ?? '',
      // FR-015: opt-in, defaults OFF — a Panel never rewrites its own configuration unasked.
      rememberCommand: memory?.rememberCommand === true ? 'true' : 'false',
      // Defaults ON (FR-027a): only an explicit false turns it off.
      rememberDirectory: memory?.rememberDirectory === false ? 'false' : 'true',
      runAsAdmin: 'false',
    };
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
    shellArguments: values.shellArguments,
    startupCommand: values.startupCommand,
    rememberCommand: values.rememberCommand === 'true',
    rememberDirectory: values.rememberDirectory !== 'false',
    runAsAdmin: values.runAsAdmin === 'true',
  }),
};
