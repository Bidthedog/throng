/**
 * Launch-spec resolution (005 Phase C). Combines a flavour's executable + base
 * args with the user's free-text Shell Arguments and the project root to produce
 * the concrete `{ file, args, cwd }` the daemon spawns (FR-013). The cwd is always
 * the project root; a null root (no active project) is refused.
 */
import {
  COMMAND_PLACEHOLDER,
  expandCommandRecipe,
  isValidCommandRecipe,
  prepareStartupCommand,
  NEEDS_VERBATIM_COMMAND_LINE,
} from './command-recipe.js';

/** What the daemon needs to spawn a PTY (cwd = project root). Never persisted. */
export interface LaunchSpec {
  file: string;
  args: string[];
  cwd: string;
  /**
   * Environment applied at launch (025 follow-up) — how a shell that cannot be observed is asked
   * to report its directory, when the shell supports it. Nothing parses an environment variable on
   * the way in, so unlike an argv snippet no escape can be eaten in transit.
   */
  env?: Record<string, string>;
  /**
   * The environment the shell should be BUILT FROM, replacing the daemon's own (#209).
   *
   * The daemon is spawned detached to outlive the UI, and is REUSED whenever its build id still
   * matches — so it keeps the environment of whichever session first started it, potentially days
   * ago, and a process cannot re-read its parent's environment afterwards. Every terminal it spawns
   * inherited that snapshot.
   *
   * Measured: a 22-hour-old daemon, its launching console long gone, passing
   * `CLAUDE_CODE_CHILD_SESSION=1` into every new terminal — which silently turned off Claude Code's
   * transcript saving, and suppresses kitty keyboard negotiation by the same route. Silent in both
   * directions, which is what makes it worth carrying an environment across the RPC to fix.
   *
   * Supplied by UI main, which was launched by the user's CURRENT session. Absent (an older UI, or a
   * caller that does not set it) leaves the daemon's own environment in use, exactly as before.
   */
  baseEnv?: Record<string, string>;
  /**
   * A VERBATIM command line to use instead of {@link args} (025 follow-up). Set only for shells
   * that do not un-escape a quoted argument — see NEEDS_VERBATIM_COMMAND_LINE. Appended after the
   * quoted executable exactly as written, so the user's own quoting reaches the shell intact.
   */
  commandLine?: string;
  /**
   * Universal fallback for a flavour with no command recipe (025 FR-012): write this to the
   * PTY once the shell is ready, as though the user typed it. Mutually exclusive with the
   * command being present in {@link args} — setting both would run the command twice.
   */
  writeOnReady?: string;
}

/** A flavour's launchable parts (subset of TerminalFlavour). */
export interface LaunchFlavour {
  /** The flavour's id — some shells need their own preparation of a startup command. */
  id?: string;
  /**
   * Environment asking this shell to report its working directory (025 follow-up). Preferred
   * over a snippet wherever the shell supports it: nothing parses an environment variable on the
   * way in, so no escape can be eaten in transit and no command line can capture it.
   */
  shellIntegrationEnv?: Record<string, string>;
  file: string;
  args: string[];
  /** How this flavour is handed a Startup Command (025 FR-010). Absent → fallback. */
  commandRecipe?: readonly string[];
  /**
   * A snippet asking this shell to REPORT its working directory (025 follow-up). Needed only for
   * shells whose real directory cannot be observed from outside — PowerShell being the case that
   * forced it. Composed ahead of any Startup Command, through the same recipe.
   */
  shellIntegration?: string;
  /**
   * A statement asking this shell to persist NO history (#339) — set only under test.
   *
   * Composed FIRST, ahead of shell integration and the user's Startup Command, so that nothing
   * throng itself runs can be recorded either. Empty in a shipped app, where a terminal recording
   * history is the behaviour users depend on.
   */
  historySuppression?: string;
  /** Environment asking this shell to persist no history (#339) — bash's `HISTFILE`, and friends. */
  historySuppressionEnv?: Record<string, string>;
}

/**
 * Split a free-text params string into argv tokens, honouring double quotes so a
 * quoted value stays one argument (e.g. `--title "My Shell"` → two args). Good
 * enough for Shell Arguments; not a full shell parser.
 */
export function tokenizeParams(params: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(params)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return tokens;
}

/**
 * Resolve a flavour + Shell Arguments + optional Startup Command + project root into a `LaunchSpec`. Args are
 * the flavour's base args followed by the tokenised params; cwd is the project
 * root. Throws when `projectRoot` is null (a Terminal cannot start without one).
 */
export function resolveLaunchSpec(
  flavour: LaunchFlavour,
  shellArguments: string,
  projectRoot: string | null,
  startupCommand?: string,
): LaunchSpec {
  if (projectRoot === null) {
    throw new Error('Cannot resolve a terminal launch spec without a project root');
  }
  const args = [...flavour.args, ...tokenizeParams(shellArguments)];
  const userCommand = prepareStartupCommand(flavour.id ?? '', startupCommand?.trim() ?? '');
  const integration = flavour.shellIntegration?.trim() ?? '';
  const historyOff = flavour.historySuppression?.trim() ?? '';

  // History suppression runs before EVERYTHING (#339). It is only ever set under test, and running
  // it first means not even throng's own integration snippet can be recorded — PSReadLine saves
  // incrementally, so a statement that ran before the suppression took effect would already be on
  // the developer's disk. Shell integration runs next, so the prompt is reporting before the user's
  // command produces any output — and so a long-running command never delays it. All three travel
  // through the same recipe: to the shell this is simply one script to run.
  const command = [historyOff, integration, userCommand].filter((part) => part !== '').join('; ');

  // Nothing to run → byte-for-byte today's behaviour (FR-006): no extra args, no PTY write.
  const hasEnv =
    flavour.shellIntegrationEnv !== undefined || flavour.historySuppressionEnv !== undefined;
  const env = hasEnv
    ? { ...flavour.shellIntegrationEnv, ...flavour.historySuppressionEnv }
    : undefined;
  if (command === '') {
    return env ? { file: flavour.file, args, cwd: projectRoot, env } : { file: flavour.file, args, cwd: projectRoot };
  }

  // A recipe puts the command in argv. It goes LAST so the recipe's terminator (`/K`,
  // `-Command`, `-c`) still consumes the command rather than a user-supplied argument.
  if (isValidCommandRecipe(flavour.commandRecipe)) {
    const recipe = flavour.commandRecipe!;
    // FR-014: a flavour's Shell Arguments and its recipe must not contradict each other. They do
    // by default for `cmd`, whose shipped Shell Arguments are `/K` — the very switch its recipe
    // supplies. Passing both yields `cmd /K /K echo hi`, where cmd takes `/K echo hi` as the
    // command string and fails. So a shell argument the recipe already provides is dropped: the
    // recipe owns it, because only the recipe knows it must sit immediately before the command.
    const suppliedByRecipe = new Set(
      recipe.filter((part) => !part.includes(COMMAND_PLACEHOLDER)),
    );
    const withoutDuplicates = args.filter((a) => !suppliedByRecipe.has(a));
    const expanded = [...withoutDuplicates, ...expandCommandRecipe(recipe, command)];
    // cmd never un-escapes a quoted argument, so it is handed the line verbatim instead. Joining
    // with spaces is correct here precisely BECAUSE the parts keep their own quoting: the command
    // arrives exactly as the user wrote it rather than re-escaped into something cmd cannot read.
    if (NEEDS_VERBATIM_COMMAND_LINE.has(flavour.id ?? '')) {
      return {
        file: flavour.file,
        args: expanded,
        commandLine: expanded.join(' '),
        cwd: projectRoot,
        ...(env ? { env } : {}),
      };
    }
    return { file: flavour.file, args: expanded, cwd: projectRoot, ...(env ? { env } : {}) };
  }

  // No recipe → the universal fallback (FR-012). Exactly one of the two paths carries the
  // command, so it can never run twice.
  return userCommand === ''
    ? { file: flavour.file, args, cwd: projectRoot, ...(env ? { env } : {}) }
    : { file: flavour.file, args, cwd: projectRoot, writeOnReady: userCommand, ...(env ? { env } : {}) };
}
