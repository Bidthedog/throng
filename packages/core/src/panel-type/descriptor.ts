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
  /** Default Shell Arguments pre-filled when this option is chosen (terminal). */
  defaultShellArguments: string;
  /** Whether this shell can report its working directory as configured (025 follow-up).
   *  False disables "Reopen in the last directory" rather than offering an inert control. */
  reportsDirectory?: boolean;
}

/**
 * What a Terminal Panel remembers across its own terminal ending (025). Lives on the
 * Panel, NOT in `Panel.config` — `clearPanelType` deletes the config when a terminal's
 * content ends, which is the exact moment this must survive (FR-007a). Kept here rather
 * than in `terminal/` so `panel-type/` stays decoupled from the terminal domain.
 */
export interface TerminalMemory {
  flavourId?: string;
  shellArguments?: string;
  startupCommand?: string;
  rememberCommand?: boolean;
  /** Reopen in the last directory (025 FR-027). Absent means on. */
  rememberDirectory?: boolean;
  /** Last working directory this Panel's terminal was pointed at (FR-027). */
  lastCwd?: string;
  /**
   * The command last OBSERVED holding this Panel's terminal, persisted as it changes (025 FR-019).
   *
   * Distinct from {@link startupCommand}, which is the decided, user-visible value. This is the
   * raw observation, and it exists so an abrupt end — an application crash, a daemon crash, a
   * machine restart — still captures (US2 scenario 7 / SC-004). Tracking live but only persisting
   * at teardown would defeat the whole reason FR-019 asks for continuous tracking.
   *
   * Cleared once it has been resolved into {@link startupCommand}, so its presence on startup is
   * exactly the signal "the previous terminal never got to end cleanly".
   */
  observedCommand?: string | null;
}

/**
 * The global preferences that seed a FRESH terminal Panel, and that an ABSENT per-Panel value
 * resolves to (039 FR-004/FR-005a). Mirrors `terminals.default*` in `TerminalSettings`.
 *
 * Kept here for the same reason {@link TerminalMemory} is — `panel-type/` stays decoupled from the
 * terminal domain, and this is the shape the generic context carries. It is deliberately three
 * booleans rather than the settings tree: the descriptor layer has no business reading anything
 * else, and a narrow shape is what stops it growing one.
 */
export interface TerminalPanelDefaults {
  rememberCommand: boolean;
  rememberDirectory: boolean;
  runAsAdmin: boolean;
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
  /** What this Panel remembered from its previous terminal, used to pre-fill the
   *  form so the empty state doubles as the edit screen (025 FR-007a). */
  terminalMemory?: TerminalMemory;
  /**
   * 039 FR-004 (#223) — the global preferences that seed a FRESH terminal Panel's checkboxes.
   * {@link terminalMemory} wins over these (FR-005); they win over nothing.
   *
   * Optional so a context with no access to the settings still typechecks, but a caller that omits
   * it gets `SHIPPED_TERMINAL_PANEL_DEFAULTS` rather than the user's actual preferences — so every
   * real call site should pass it. It is deliberately the narrow three-boolean shape rather than
   * the whole settings tree: the descriptor layer has no business reading anything else.
   */
  terminalDefaults?: TerminalPanelDefaults;
  /**
   * 039 FR-008a — whether the terminal-hosting daemon is running ELEVATED.
   *
   * Carried here for one reason: `terminalDefaults.runAsAdmin` is a SEED, and a seed may not
   * out-rank the elevation gate. Without this the descriptor hands the form `runAsAdmin: 'true'`
   * on an unelevated machine, the form renders it behind a disabled checkbox the user cannot
   * untick, and `buildConfig` writes that `true` into the Panel's persisted config — where it lies
   * dormant until the next elevated launch starts that shell as administrator.
   *
   * ══ WHY IT LIVES ON THE CONTEXT AND NOT AT THE CALL SITE ══
   *
   * The gate was already correct in `terminal-inputs.tsx` (the control is disabled) and in the
   * daemon (`shouldDeElevate` never elevates anything). What was missing was the gate on the VALUE,
   * and putting that in the renderer would leave the next caller of `defaults()` to remember it.
   * Here, every caller inherits it.
   *
   * **Absent means NOT elevated**, which is the safe reading and matches `useCapabilities`, whose
   * own default is `{ elevated: false }` until the daemon answers. A context that cannot establish
   * elevation must not seed an elevation request.
   */
  daemonElevated?: boolean;
}

/** Outcome of a descriptor's validation: ok, or per-input error messages. */
export type ValidationResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** A declarative form input the renderer renders generically. */
export interface PanelTypeInputSpec {
  key: string;
  label: string;
  control: 'dropdown' | 'text' | 'checkbox';
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
