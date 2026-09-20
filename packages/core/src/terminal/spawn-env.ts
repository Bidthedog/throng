/**
 * Environment hygiene for daemon-spawned terminal shells.
 *
 * The daemon runs with `THRONG_*` variables that name THIS instance — `THRONG_PIPE_NAME`
 * (its daemon endpoint), `THRONG_DATABASE_PATH` (its store), `THRONG_CONFIG_ROOT`, plus
 * internal knobs — and it spawns every terminal inheriting its own `process.env`. If those
 * reach the shell, the shell (and anything launched from it) inherits the parent throng's
 * identity: `npm start` from a terminal inside the packaged app would resolve `THRONG_PIPE_NAME`
 * to the packaged daemon's pipe, hit a build-id mismatch in `ensureDaemon`, and RETIRE the
 * packaged daemon — killing the very terminals it was launched from.
 *
 * A spawned shell must instead start from the same clean slate a bare OS shell has, so that
 * `npm start` always resolves to the default dev instance regardless of where it was launched,
 * and packaged / dev / each E2E instance keep fully independent spaces. This drops every
 * `THRONG_`-prefixed key (case-insensitively — Windows env names fold case) and returns a new
 * object, leaving the caller's `process.env` untouched.
 */
export function sanitizeSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('THRONG_')) continue;
    clean[key] = env[key];
  }
  return clean;
}

/** The one variable throng is allowed to add on this account (FR-080, FR-080d). */
const FORCE_HYPERLINK = 'FORCE_HYPERLINK';

/**
 * What to ADD to a terminal's environment so the programs it runs know throng renders OSC 8
 * hyperlinks (045 FR-080 – FR-080d, E1–E7). `undefined` means "add nothing".
 *
 * ══ IT CANNOT RETURN A SECOND KEY, AND THAT IS THE POINT ══
 *
 * FR-080d forbids throng from setting `WT_SESSION` or a `TERM_PROGRAM` that names another terminal,
 * because a program reads those as a promise of that terminal's OTHER behaviour and will then use
 * capabilities throng does not have. Stating that as a rule leaves it to be re-obeyed by every
 * future edit. Stating it as a SHAPE — this function returns at most one key, and it is
 * `FORCE_HYPERLINK` — means there is no version of it that could break the rule without being
 * rewritten into a different function.
 *
 * ══ THE USER'S OWN VALUE IS NEVER TOUCHED, IN EITHER DIRECTION ══
 *
 * Not only their `0`. A user who set `FORCE_HYPERLINK=1` themselves keeps THEIR value rather than
 * an identical one of throng's, because the two differ in what happens next: a value throng set is
 * a value throng may stop setting. "Set" means present, whatever it holds — an empty string is a
 * deliberate empty string. The key is matched without case, because Windows environment names fold
 * case and a `force_hyperlink` in a user's profile IS the same variable.
 *
 * Merged into `LaunchSpec.env` rather than into the base environment (R11): a de-elevated terminal
 * never receives the base, and `launch.env` layers on top of it in any case.
 */
export function hyperlinkAdvertisementEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  advertise: boolean,
): Record<string, string> | undefined {
  // E6: off means throng neither sets nor UNSETS. An empty value here would be throng deleting
  // something it did not create.
  if (!advertise) return undefined;
  for (const key of Object.keys(baseEnv)) {
    if (key.toUpperCase() !== FORCE_HYPERLINK) continue;
    if (baseEnv[key] === undefined) continue; // absent, reported as a key; not a user choice
    return undefined;
  }
  return { [FORCE_HYPERLINK]: '1' };
}
