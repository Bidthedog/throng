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
  TerminalPanelDefaults,
  ValidationResult,
} from '../panel-type/descriptor.js';

export type { TerminalPanelDefaults };

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
  /**
   * Where this terminal was asked to START, absolute (033 FR-033, B5). Set only when the Panel was
   * created from a tree node — Open In → Terminal on a folder, or on a file's parent folder — and
   * absent for every Panel typed through the picker, which starts at the project root as before.
   *
   * Persisted rather than used once and forgotten so a RESTORED panel restarts where it was
   * created: without it, reopening the app silently moves the shell back to the root, and the
   * directory the user chose survives only as long as the process does.
   *
   * It is a REQUEST, not a decision. `terminal-ipc.ts` hands it to the shipped
   * `resolveStartDirectory`, so containment in the project root and the existence check apply to it
   * exactly as they do to a remembered directory (FR-032, FR-034) — nothing here is trusted.
   */
  startDirectory?: string;
};

/**
 * Read a persisted Terminal config, migrating the pre-025 `params` key to
 * `shellArguments` (FR-002d). Read-side only: nothing is rewritten on disk, so a
 * failed config write cannot lose the original value (FR-002e), and re-reading an
 * already-migrated config never sees the old key, which makes it idempotent.
 */
/**
 * What a clean config ships (039 FR-002), duplicated here as the last-resort fallback for a
 * context that cannot reach the settings. It must stay in step with `DEFAULT_APP_SETTINGS.terminals`
 * — `panel-type-defaults-match-settings.test.ts` fails the build if it drifts, which is the same
 * class of divergence #307 is about.
 */
export const SHIPPED_TERMINAL_PANEL_DEFAULTS: TerminalPanelDefaults = {
  rememberCommand: false,
  rememberDirectory: true,
  runAsAdmin: false,
};

/** A form value is a string; `undefined` memory means "not remembered", so take the seed. */
function boolValue(remembered: boolean | undefined, seed: boolean): string {
  return (typeof remembered === 'boolean' ? remembered : seed) ? 'true' : 'false';
}

export function readTerminalPanelConfig(
  raw: Record<string, unknown> | undefined,
  defaults: TerminalPanelDefaults,
): {
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
    /*
     * 039 FR-005a. An absent value resolves to the GLOBAL PREFERENCE; an explicit boolean is the
     * Panel's own answer and still wins (FR-005).
     *
     * This replaces `raw?.rememberCommand !== false`, which resolved absent to a hard-coded `true`.
     * That literal contradicted 025 FR-015 ("a per-Panel OPT-IN control … MUST default to off") for
     * two releases, and 025 FR-047a leans on FR-015 by name as one of exactly two safeguards that
     * make a captured command re-running with no prompt acceptable. The old comment here argued the
     * change was right because an opt-in a user must discover on a per-panel form silently does
     * nothing — a fair objection, which 039 answers by making the default a visible preference
     * (`terminals.defaultRememberCommand`) rather than by leaving the requirement unhonoured.
     *
     * The directory beside it is NOT the same case: 025 FR-027b really does specify absent-means-on
     * for the directory, and its preference ships `true`, so nothing observable changes there. The
     * two differ deliberately — a remembered directory cannot execute anything, and a remembered
     * command can. Losing that distinction is the most likely account of how the drift happened.
     *
     * A non-boolean is not an explicit value, so it resolves to the preference too rather than
     * being coerced to "on" by a `!== false` test.
     */
    rememberCommand:
      typeof raw?.rememberCommand === 'boolean' ? raw.rememberCommand : defaults.rememberCommand,
    rememberDirectory:
      typeof raw?.rememberDirectory === 'boolean'
        ? raw.rememberDirectory
        : defaults.rememberDirectory,
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
    // 039 FR-004. A context that cannot reach the settings falls back to what a clean config
    // SHIPS — never to the pre-039 literals, so a missed call site yields the correct default
    // rather than quietly reinstating the behaviour this feature exists to fix.
    const seeds = ctx.terminalDefaults ?? SHIPPED_TERMINAL_PANEL_DEFAULTS;
    // 025 FR-007a: a Panel whose terminal has been closed pre-fills from what it remembered,
    // so the empty state doubles as the edit screen. With no memory this is today's behaviour.
    const memory = ctx.terminalMemory;
    const flavourId = memory?.flavourId ?? first?.value ?? '';
    const chosen = ctx.flavours.find((f) => f.value === flavourId) ?? first;
    return {
      flavourId,
      shellArguments: memory?.shellArguments ?? chosen?.defaultShellArguments ?? '',
      startupCommand: memory?.startupCommand ?? '',
      /*
       * 039 FR-004/FR-005. The three seeds come from the preferences; what the Panel REMEMBERED
       * still wins (025 FR-007a — the empty state doubles as the edit screen).
       *
       * These lines previously read `memory?.x === false ? 'false' : 'true'`, i.e. a hard-coded
       * literal for a fresh Panel. The `rememberCommand` literal was `'true'`, which is what
       * contradicted 025 FR-015; its comment cited `parseTerminalConfig`, a function that does not
       * exist in this repository and never appears in any spec. See 039's Supersessions, and #307
       * for the governance gap that let a stale citation stand in for an amendment.
       */
      rememberCommand: boolValue(memory?.rememberCommand, seeds.rememberCommand),
      rememberDirectory: boolValue(memory?.rememberDirectory, seeds.rememberDirectory),
      runAsAdmin: boolValue(undefined, seeds.runAsAdmin),
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
    rememberCommand: values.rememberCommand !== 'false',
    rememberDirectory: values.rememberDirectory !== 'false',
    runAsAdmin: values.runAsAdmin === 'true',
  }),
};
