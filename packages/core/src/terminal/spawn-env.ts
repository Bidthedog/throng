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
