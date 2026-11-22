/**
 * Launch-spec resolution (005 Phase C). Combines a flavour's executable + base
 * args with the user's free-text Shell Arguments and the project root to produce
 * the concrete `{ file, args, cwd }` the daemon spawns (FR-013). The cwd is always
 * the project root; a null root (no active project) is refused.
 */
import {
  BASH_ENTER_START_DIR,
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  COMMAND_PLACEHOLDER,
  LAUNCHER_HOLDS_START_DIR,
  START_DIR_ENV,
  expandCommandRecipe,
  isValidCommandRecipe,
  prepareStartupCommand,
  NEEDS_VERBATIM_COMMAND_LINE,
} from './command-recipe.js';
import { hostTraits } from '../platform/host-traits.js';

/** What the daemon needs to spawn a PTY (cwd = project root). Never persisted. */
export interface LaunchSpec {
  file: string;
  args: string[];
  /** The directory the terminal starts IN — what the panel, the lock and directory memory mean. */
  cwd: string;
  /**
   * Where to SPAWN the process, when that is not {@link cwd} (#387). Set only for a flavour whose
   * launcher never leaves its launch directory; the shell then enters `cwd` itself. The spawned
   * process's own working directory says nothing about the terminal's, so it is not observed.
   */
  spawnCwd?: string;
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
  const given = [...flavour.args, ...tokenizeParams(shellArguments)];
  const userCommand = prepareStartupCommand(flavour.id ?? '', startupCommand?.trim() ?? '');
  const integration = flavour.shellIntegration?.trim() ?? '';
  const historyOff = flavour.historySuppression?.trim() ?? '';

  // History suppression runs before EVERYTHING (#339). It is only ever set under test, and running
  // it first means not even throng's own integration snippet can be recorded — PSReadLine saves
  // incrementally, so a statement that ran before the suppression took effect would already be on
  // the developer's disk. Shell integration runs next, so the prompt is reporting before the user's
  // command produces any output — and so a long-running command never delays it. All three travel
  // through the same recipe: to the shell this is simply one script to run.
  //
  // #387 — a flavour whose launcher never leaves its launch directory is spawned in its own install
  // directory, and the shell enters the start directory itself: through the prompt hook, which needs
  // shell integration, and ahead of a Startup Command, which runs before any prompt. With integration
  // off nothing could move the shell, so it is spawned in the start directory as before.
  const spawnCwd =
    LAUNCHER_HOLDS_START_DIR.has(flavour.id ?? '') && flavour.shellIntegrationEnv !== undefined
      ? directoryOf(flavour.file)
      : undefined;
  const command = [historyOff, integration, spawnCwd && userCommand ? BASH_ENTER_START_DIR : '', userCommand]
    .filter((part) => part !== '')
    .join('; ');
  const args = [...loginSwitch(flavour.id, given, command !== ''), ...given];
  const finish = (spec: LaunchSpec): LaunchSpec => (spawnCwd ? { ...spec, spawnCwd } : spec);

  // Nothing to run → byte-for-byte today's behaviour (FR-006): no extra args, no PTY write.
  const hasEnv =
    flavour.shellIntegrationEnv !== undefined || flavour.historySuppressionEnv !== undefined;
  const env = hasEnv
    ? {
        ...flavour.shellIntegrationEnv,
        ...flavour.historySuppressionEnv,
        ...(spawnCwd ? { [START_DIR_ENV]: projectRoot } : {}),
      }
    : undefined;
  if (command === '') {
    return finish(
      env ? { file: flavour.file, args, cwd: projectRoot, env } : { file: flavour.file, args, cwd: projectRoot },
    );
  }

  // A recipe puts the command in argv. It goes LAST so the recipe's terminator (`/K`,
  // `-Command`, `-c`) still consumes the command rather than a user-supplied argument.
  if (isValidCommandRecipe(flavour.commandRecipe)) {
    const recipe = loginRecipe(flavour.id, flavour.commandRecipe!);
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
      // cmd's own rule for `/K <text>`: when the text starts with a quote and is not exactly one quoted program
      // name, it removes the first and the LAST quote on the line. A command that starts with a quoted program
      // path and quotes anything after it — `"C:\Program Files\nodejs\node.exe" "…npm-cli.js" run dev`, which is
      // what command memory saves for `npm run dev` — therefore ran as something else (051 MT-04). One more pair
      // of quotes around the whole command is cmd's documented way out: that is the pair it strips.
      const verbatim = [...withoutDuplicates, ...expandCommandRecipe(recipe, `"${command}"`)];
      return finish({
        file: flavour.file,
        args: expanded,
        commandLine: verbatim.join(' '),
        cwd: projectRoot,
        ...(env ? { env } : {}),
      });
    }
    return finish({ file: flavour.file, args: expanded, cwd: projectRoot, ...(env ? { env } : {}) });
  }

  // No recipe → the universal fallback (FR-012). Exactly one of the two paths carries the
  // command, so it can never run twice. The command is typed once the shell is READY, so the
  // prompt hook has already entered the start directory by then.
  return finish(
    userCommand === ''
      ? { file: flavour.file, args, cwd: projectRoot, ...(env ? { env } : {}) }
      : { file: flavour.file, args, cwd: projectRoot, writeOnReady: userCommand, ...(env ? { env } : {}) },
  );
}

/**
 * Shells that take `-l` alongside other flags to start as a login shell, by flavour id. pwsh takes it only as its
 * FIRST flag, where {@link loginSwitch} puts it, and then runs the POSIX login profiles through /bin/sh.
 */
const LOGIN_SWITCH_SHELLS: ReadonlySet<string> = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'pwsh']);
/** Compared lower-cased: pwsh's parameters are case-insensitive (`-Login`). */
const LOGIN_SWITCHES: ReadonlySet<string> = new Set(['-l', '--login', '-login']);
/** tcsh honours `-l` only as its sole flag (tcsh(1)), so it cannot be added beside `-c` or the user's own flags. */
const SOLE_FLAG_LOGIN_SHELL = 'tcsh';

/**
 * `['-l']` where a shell must start as a login shell, else nothing (070 FR-017, research R9). On macOS every terminal
 * app starts its shell that way, and throng launched from the Dock inherits launchd's short PATH, so without it a
 * terminal would not see the user's `~/.zprofile` (Homebrew's PATH lives there). First, so a recipe's `-c` still
 * takes the command; never twice, so a user's own `--login` is left as it is. tcsh gets it only when it would be the
 * one flag: with a command, its recipe's re-exec makes the login shell instead ({@link loginRecipe}).
 */
function loginSwitch(flavourId: string | undefined, given: readonly string[], hasCommand: boolean): string[] {
  if (hostTraits().os !== 'macos') return [];
  if (flavourId === SOLE_FLAG_LOGIN_SHELL) return given.length === 0 && !hasCommand ? ['-l'] : [];
  if (!LOGIN_SWITCH_SHELLS.has(flavourId ?? '')) return [];
  return given.some((arg) => LOGIN_SWITCHES.has(arg.toLowerCase())) ? [] : ['-l'];
}

/** A shipped recipe's closing re-exec, and the login form macOS uses instead. fish's recipe has no re-exec. */
const LOGIN_REEXEC: Readonly<Record<string, readonly [string, string]>> = {
  bash: ['exec bash -i', 'exec bash -il'],
  zsh: ['exec zsh -i', 'exec zsh -il'],
  sh: ['exec sh -i', 'exec sh -il'],
  dash: ['exec dash -i', 'exec dash -il'],
  ksh: ['exec ksh -i', 'exec ksh -il'],
  // A terminal is a tty, so `tcsh -l` is interactive without `-i`, which it would refuse beside `-l`.
  tcsh: ['exec tcsh -i', 'exec tcsh -l'],
};

/**
 * The recipe a macOS shell runs a Startup Command (or shell integration) through (070 FR-017). The shipped recipe ends
 * by re-executing an interactive shell, which replaced the login shell `-l` started with a non-login one, so bash never
 * read `~/.bash_profile`. On macOS the re-exec is a login shell too. A recipe the user wrote is theirs and runs as
 * written; Windows and Linux recipes are unchanged (FR-039).
 */
function loginRecipe(flavourId: string | undefined, recipe: readonly string[]): readonly string[] {
  const id = flavourId ?? '';
  const reexec = LOGIN_REEXEC[id];
  const shipped = BUILTIN_FLAVOUR_COMMAND_RECIPES[id];
  if (hostTraits().os !== 'macos' || !reexec || !shipped) return recipe;
  if (recipe.length !== shipped.length || recipe.some((part, i) => part !== shipped[i])) return recipe;
  const [from, to] = reexec;
  return recipe.map((part) => (part.endsWith(from) ? `${part.slice(0, -from.length)}${to}` : part));
}

/** The directory part of an absolute executable path, or undefined for a bare name. */
function directoryOf(file: string): string | undefined {
  const cut = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'));
  return cut > 0 ? file.slice(0, cut) : undefined;
}
