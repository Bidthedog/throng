/**
 * Per-flavour **Startup Command** recipes (025 FR-010/FR-011).
 *
 * A shell needs telling two different things: how it is configured (Shell Arguments) and
 * what to *run* (a Startup Command). Every shell spells the second differently, and getting
 * it wrong is not cosmetic — `cmd /C` closes the terminal when the command finishes, and
 * `bash -c` exits outright, both of which violate FR-005 ("the shell MUST remain at a live
 * interactive prompt").
 *
 * A recipe is therefore an **argv template** with exactly one `{command}` placeholder, not a
 * per-flavour branch in code: FR-011 requires a *user-defined* flavour to declare its own,
 * which a code-level switch cannot satisfy.
 *
 * The catalogue below was **empirically proven**, not assumed (FR-013) — see research R1.
 * Each was spawned with a real argv array and stdin closed, confirming the command ran and an
 * interactive shell remained to read stdin.
 */
import type { TerminalFlavourConfig, TerminalSettings } from '../config/app-settings.js';

/** The placeholder a recipe substitutes the user's command into. */
export const COMMAND_PLACEHOLDER = '{command}';

/**
 * Built-in catalogue: flavour id → argv template.
 *
 * - `cmd` — `/K` runs the command and **keeps** the session; `/C` would terminate it.
 * - PowerShell (5 and 7) — `-NoExit` is what keeps the session after `-Command` completes.
 * - `git-bash` — `-c` runs the command, then `exec bash -i` **replaces** the command shell
 *   with a fresh interactive one. Without the re-exec, bash exits the instant the command
 *   finishes (proven in research R1) and the panel would look like it had crashed.
 *
 *   `trap : INT` is what makes Ctrl+C behave. A non-interactive `bash -c` script exits on
 *   SIGINT, so interrupting the startup command killed the whole terminal before it ever
 *   reached the re-exec: pressing Ctrl+C to stop a `ping` lost the terminal with it.
 *   Installing any handler stops bash treating SIGINT as fatal, and `:` is the no-op one. It
 *   must be a HANDLER rather than `trap '' INT` — an ignored signal is inherited by children,
 *   which would make the startup command itself un-interruptible. Measured across all four
 *   shells: cmd, PowerShell and pwsh already return to their prompt; only bash needed this.
 */
export const BUILTIN_FLAVOUR_COMMAND_RECIPES: Record<string, readonly string[]> = {
  'windows-powershell': ['-NoExit', '-Command', COMMAND_PLACEHOLDER],
  pwsh: ['-NoExit', '-Command', COMMAND_PLACEHOLDER],
  cmd: ['/K', COMMAND_PLACEHOLDER],
  'git-bash': ['-c', `trap : INT; ${COMMAND_PLACEHOLDER}; exec bash -i`],
};

/**
 * Whether `recipe` can actually carry a command. A template with no placeholder would
 * silently drop the user's command and launch a bare shell, so it is rejected rather than
 * half-applied.
 */
export function isValidCommandRecipe(recipe: readonly string[] | undefined): boolean {
  return recipe !== undefined && recipe.some((part) => part.includes(COMMAND_PLACEHOLDER));
}

/**
 * Expand a recipe into concrete argv by substituting `command` **inside** whichever element
 * holds the placeholder. The element count is unchanged, so the command stays a single argv
 * element however many spaces or quotes it contains — which is what keeps quoting the shell's
 * own business (FR-047) and sidesteps cmd.exe's non-standard quote handling (research R1a).
 */
export function expandCommandRecipe(recipe: readonly string[], command: string): string[] {
  return recipe.map((part) => part.split(COMMAND_PLACEHOLDER).join(command));
}

/**
 * Resolve the recipe for a flavour. Precedence mirrors `resolveDefaultShellArguments`, so the
 * two per-flavour settings behave the same way:
 *
 * `settings.commandRecipes[id]` → the user entry's own `commandRecipe` → the built-in
 * catalogue → `undefined` (the universal PTY-write fallback, FR-012).
 *
 * A configured-but-invalid recipe resolves to `undefined` rather than being used: falling back
 * to the fallback path still runs the user's command, where honouring a broken template would
 * silently drop it.
 */
export function resolveCommandRecipe(
  id: string,
  source: 'builtin' | 'user',
  userEntry: TerminalFlavourConfig | undefined,
  settings: TerminalSettings,
): readonly string[] | undefined {
  // Defensive: a settings object assembled before 025 (or by a test double) may lack the map
  // entirely. Launching a terminal must never throw over a missing recipe — the fallback works.
  const override = settings.commandRecipes?.[id];
  if (override !== undefined) return isValidCommandRecipe(override) ? override : undefined;
  if (source === 'user') {
    const own = userEntry?.commandRecipe;
    return isValidCommandRecipe(own) ? own : undefined;
  }
  const builtin = BUILTIN_FLAVOUR_COMMAND_RECIPES[id];
  return isValidCommandRecipe(builtin) ? builtin : undefined;
}

/**
 * Shell-integration snippets (025 follow-up) — how a shell is asked to REPORT its working
 * directory, for shells whose real directory throng cannot observe from outside.
 *
 * PowerShell's `Set-Location` moves its *provider* location, not the process working directory.
 * The PEB — the only thing an external observer can read — therefore never changes, so directory
 * memory is impossible for PowerShell without the shell's cooperation. Verified directly: after a
 * `cd`, cmd's PEB working directory follows and PowerShell's stays at its launch directory.
 *
 * The snippet installs a `prompt` function that emits **OSC 9;9** — the sequence Windows Terminal
 * uses for "set working directory" — and then defers to whatever prompt was already defined, so a
 * themed prompt (oh-my-posh, starship, a profile function) still renders. It is deliberately free
 * of double quotes and of literal escape characters so it survives being passed as one argv
 * element through node-pty.
 */
function powershellIntegration(): string {
  return [
    '$__throngPrior = $function:prompt;',
    'function global:prompt {',
    '$__o = if ($__throngPrior) { & $__throngPrior } else { $(Get-Location).Path + [char]62 + [char]32 };',
    '[char]27 + [char]93 + [char]57 + [char]59 + [char]57 + [char]59 + $(Get-Location).ProviderPath + [char]7 + $__o',
    '}',
  ].join(' ');
}


/**
 * Git Bash / MSYS. Its `cd` does not move the process working directory that throng can read from
 * outside either, so it reports through the same OSC 9;9 channel as PowerShell.
 *
 * Two details carry the weight:
 *  - `export`, not a plain assignment. The git-bash recipe ends in `exec bash -i`, which REPLACES
 *    the shell; only an exported variable survives that, and a plain PROMPT_COMMAND would vanish
 *    exactly when the interactive shell the user actually types into starts.
 *  - `cygpath -w`. Bash reports `/d/git/x`, but throng compares the remembered directory against a
 *    Windows project root, so the path is converted at the source rather than guessed at later.
 *    If cygpath is missing the raw path is sent, which simply fails the containment check and
 *    falls back to the project root — never an error.
 *
 * Any PROMPT_COMMAND already set is preserved and run after ours.
 */
/**
 * Git Bash / MSYS reports its directory through PROMPT_COMMAND — delivered as an ENVIRONMENT
 * VARIABLE, never spliced into argv.
 *
 * That is not a style choice. MSYS bash does its own command-line parsing and strips backslash
 * escapes, so a snippet passed as an argument arrived with `\033` flattened to `033`: bash then ran
 * `9` as a command and treated `%s007` as a job spec. Exactly the class of failure cmd has with
 * quotes, in a different shell and a different escape. An environment variable is not parsed by
 * anything on the way, so what throng writes is what bash reads.
 *
 * bash applies PROMPT_COMMAND from the environment, and it survives the recipe\'s `exec bash -i`
 * for the same reason -- which is what makes this simpler than the export it replaces, not just
 * safer. Any PROMPT_COMMAND the user already has is preserved and runs after ours.
 */
export const BASH_PROMPT_COMMAND =
  'printf "\\033]9;9;%s\\007" "$(cygpath -w "$PWD" 2>/dev/null || printf %s "$PWD")"';

/** Per-flavour integration snippets. A flavour absent here needs none. */
export const BUILTIN_SHELL_INTEGRATION: Record<string, string> = {
  'windows-powershell': powershellIntegration(),
  pwsh: powershellIntegration(),
};

/**
 * Environment applied at launch so a shell can report its directory, keyed by flavour id.
 * Preferred over a snippet wherever the shell supports it: nothing parses an environment variable
 * on the way in, so no escape can be eaten in transit.
 */
export const BUILTIN_SHELL_INTEGRATION_ENV: Record<string, Record<string, string>> = {
  'git-bash': { PROMPT_COMMAND: BASH_PROMPT_COMMAND },
};

/** The integration ENVIRONMENT for a flavour, or undefined when it needs none / it is off. */
export function resolveShellIntegrationEnv(
  id: string,
  enabled: boolean,
): Record<string, string> | undefined {
  if (!enabled) return undefined;
  return BUILTIN_SHELL_INTEGRATION_ENV[id];
}

/** The integration snippet for a flavour, or undefined when it needs none, or it is switched off. */
export function resolveShellIntegration(id: string, enabled: boolean): string | undefined {
  if (!enabled) return undefined;
  return BUILTIN_SHELL_INTEGRATION[id];
}

/**
 * Whether this flavour can report its working directory **as currently configured**.
 *
 * A shell absent from {@link BUILTIN_SHELL_INTEGRATION} moves its real working directory, so it is
 * observable from outside and always reports. One that is present cannot be observed at all, and
 * reports only while shell integration is on.
 *
 * This is what lets the panel form DISABLE "Reopen in the last directory" instead of offering a
 * control that silently does nothing — the same treatment "Run as administrator" gets when throng
 * is not elevated.
 */
export function flavourReportsDirectory(id: string, shellIntegrationEnabled: boolean): boolean {
  const needs =
    BUILTIN_SHELL_INTEGRATION[id] !== undefined || BUILTIN_SHELL_INTEGRATION_ENV[id] !== undefined;
  return !needs || shellIntegrationEnabled;
}

/** Flavours whose shell parses a leading quoted string as an EXPRESSION, not a command. */
const NEEDS_CALL_OPERATOR = new Set(['windows-powershell', 'pwsh']);

/**
 * Prepare a user's Startup Command for a particular shell (025 follow-up).
 *
 * PowerShell parses a leading quoted string as a string *expression*, so a perfectly ordinary
 * command written with a quoted executable path — `"C:\Windows\System32\PING.EXE" -t bbc.co.uk`,
 * exactly what you get from copying a path with spaces — fails to parse:
 *
 *     Unexpected token '-t' in expression or statement.
 *
 * The shell's own idiom for invoking it is the call operator `&`. cmd and bash have no such rule,
 * which is why the same command works there and only PowerShell breaks.
 *
 * This is NOT throng interpreting the command (FR-047). The text is untouched; it is prefixed with
 * the operator the shell requires to treat it as the invocation the user plainly meant. Anything
 * not starting with a quote is passed through exactly as typed.
 */
export function prepareStartupCommand(flavourId: string, command: string): string {
  const trimmed = command.trim();
  if (trimmed === '' || !NEEDS_CALL_OPERATOR.has(flavourId)) return command;
  const startsQuoted = trimmed.startsWith('"') || trimmed.startsWith("'");
  if (!startsQuoted) return command;
  // Already invoked explicitly — do not double it up.
  return trimmed.startsWith('& ') ? command : `& ${trimmed}`;
}

/**
 * Flavours that must be handed a VERBATIM command line rather than an argv array.
 *
 * `cmd.exe` does not parse its command line the way ordinary programs do: it takes the raw text and
 * never un-escapes the `\\"` that the argv-to-command-line conversion produces for a quoted
 * argument. So a Startup Command containing a quoted path arrives as `\\"C:\\...\\ping.exe\\"` and is
 * reported as not recognised. Every other shell here un-escapes it correctly.
 *
 * node-pty accepts a pre-escaped command line and appends it verbatim after the quoted executable,
 * which is the only way to give cmd exactly the text the user typed.
 */
export const NEEDS_VERBATIM_COMMAND_LINE = new Set(['cmd']);
