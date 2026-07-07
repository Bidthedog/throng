/**
 * Launch-spec resolution (005 Phase C). Combines a flavour's executable + base
 * args with the user's free-text Startup Params and the project root to produce
 * the concrete `{ file, args, cwd }` the daemon spawns (FR-013). The cwd is always
 * the project root; a null root (no active project) is refused.
 */

/** What the daemon needs to spawn a PTY (cwd = project root). Never persisted. */
export interface LaunchSpec {
  file: string;
  args: string[];
  cwd: string;
}

/** A flavour's launchable parts (subset of TerminalFlavour). */
export interface LaunchFlavour {
  file: string;
  args: string[];
}

/**
 * Split a free-text params string into argv tokens, honouring double quotes so a
 * quoted value stays one argument (e.g. `--title "My Shell"` → two args). Good
 * enough for Startup Params; not a full shell parser.
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
 * Resolve a flavour + Startup Params + project root into a `LaunchSpec`. Args are
 * the flavour's base args followed by the tokenised params; cwd is the project
 * root. Throws when `projectRoot` is null (a Terminal cannot start without one).
 */
export function resolveLaunchSpec(
  flavour: LaunchFlavour,
  params: string,
  projectRoot: string | null,
): LaunchSpec {
  if (projectRoot === null) {
    throw new Error('Cannot resolve a terminal launch spec without a project root');
  }
  return {
    file: flavour.file,
    args: [...flavour.args, ...tokenizeParams(params)],
    cwd: projectRoot,
  };
}
