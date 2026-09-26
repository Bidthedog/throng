[throng](../README.md) › [Docs](README.md) › Environment variables

# Environment variables

Every environment variable throng, its daemon, its build scripts and its test harness read, grouped
by who would set it. None is needed for ordinary use: an installed throng runs on its own defaults,
and everything a user would reasonably want to change is a [preference](preferences.md) instead.

A variable is read when the process starts, so set it before launching throng — for example
`$env:THRONG_CONFIG_ROOT = 'D:\throng-config'` in PowerShell, then start the app from that shell.

**Terminals never inherit them.** Every `THRONG_*` variable is removed from the environment of the
shells throng starts, so a terminal inside throng — and anything run from it, `npm start` included —
never picks up the identity of the throng that hosts it.

## Running the app

| Variable | What it controls | Default |
|---|---|---|
| `THRONG_CONFIG_ROOT` | The folder holding `settings.json`, `keybindings.json`, `themes\` and `icon-packs\` — see [where the files live](preferences.md#where-the-files-live). | `%USERPROFILE%\.throng` (dev run: `%USERPROFILE%\.throng-dev`) |
| `THRONG_DATABASE_PATH` | The SQLite database holding projects, layouts and sub-workspaces. | `%APPDATA%\throng\throng.db` (dev run: `%APPDATA%\throng-dev\throng.db`) |
| `THRONG_PIPE_NAME` | The named pipe the app and its daemon talk over. Two throngs on different pipes are fully independent. | `\\.\pipe\throng.<user>.<hash>.daemon`; `….daemon.dev` for a dev run, `….daemon.portable` for the portable build |
| `THRONG_WINDOW_WIDTH` / `THRONG_WINDOW_HEIGHT` | The main window's starting size, in pixels. | `1280` × `800` |
| `THRONG_PING_TIMEOUT_MS` | How long the app waits for the daemon to answer a health-check ping. | `2000` |
| `THRONG_ATTACH_TIMEOUT_MS` | How long the app waits for a terminal to attach — sized for launching an interactive shell. | `15000` |
| `THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS` | On close, the longest the app waits for a window to confirm its pending writes are done, so an unresponsive window cannot hold the app open. | `5000` |
| `THRONG_STARTUP_TIMEOUT_MS` | The daemon's start-up budget. | `5000` |
| `THRONG_AGENT_CONNECT_TIMEOUT_MS` / `THRONG_AGENT_READY_TIMEOUT_MS` | How long an elevated daemon waits for its de-elevated terminal agent to connect, then to report ready. | `15000` / `15000` |

`--user-data-dir=<folder>` (a command-line switch, not a variable) moves Electron's user-data folder —
window state, editor recovery, font cache and logs — and, with it, the default database.

### Settings passed to throng's own processes

The app hands these to the daemon and its terminal agent so that both follow the app's settings.
They are set by throng; each only mirrors a preference, so change the preference instead.

| Variable | Mirrors |
|---|---|
| `THRONG_LOG_LEVEL` | [`diagnostics.logLevel`](preferences.md#logging) |
| `THRONG_LOG_MAX_KB` | [`diagnostics.maxFileSizeKb`](preferences.md#logging) |
| `THRONG_LOG_KEEP` | [`diagnostics.keepFiles`](preferences.md#logging) |
| `THRONG_LOG_DIR` | The [log folder](preferences.md#logging). A daemon started by hand without it logs nothing; the terminal agent falls back to `%TEMP%`. |
| `FORCE_HYPERLINK` | Set to `1` in each new terminal by [`terminals.advertiseHyperlinks`](preferences.md#terminal), unless the environment already carries it. |

### Set internally, never by you

| Variable | What it is |
|---|---|
| `THRONG_LOCK_DIR` | Tells the helper process that holds a project's root folder open which folder to hold. |
| `THRONG_RESTORE_TARGET` | The original path of a file being restored from the Recycle Bin by an undo. |
| `THRONG_START_DIR` | The start folder handed to a shell whose launcher cannot start in it directly (Git Bash); the shell moves there and unsets it. |
| `THRONG_VERSION` | The version recorded in a daemon crash report; `unknown` when unset. |
| `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE` | Set by the portable build's launcher; its presence is what gives the portable build its own pipe. |

## Running a dev build beside an installed throng

An **unpackaged** run (`npm start`, `npm run start:ui`) is a *dev instance*: it keeps its own data and
never touches the installed app's. Nothing to configure — the app decides from whether it is
packaged.

| | Installed (packaged) | Dev (`npm start`) |
|---|---|---|
| User data — window state, editor recovery, font cache, logs | `%APPDATA%\throng` | `%APPDATA%\throng-dev` |
| Config — settings, key bindings, themes, icon packs | `%USERPROFILE%\.throng` | `%USERPROFILE%\.throng-dev` |
| Database | `%APPDATA%\throng\throng.db` | `%APPDATA%\throng-dev\throng.db` |
| Daemon pipe | `\\.\pipe\throng.<user>.<hash>.daemon` | …`.daemon.dev` |

The separate pipe is the load-bearing one: an instance that finds a daemon running a *different*
build **retires it**, ending every terminal that daemon owns — so a shared pipe would mean a rebuild
destroys the terminals in the throng you are working in. Distinct pipes also give each instance its
own single-instance lock, so both can run at once. The overrides above (`THRONG_CONFIG_ROOT`,
`THRONG_DATABASE_PATH`, `THRONG_PIPE_NAME`, `--user-data-dir`) still win in both modes, and a dev
launch prints the three locations it resolved.

## Development

| Variable | What it controls | Default |
|---|---|---|
| `THRONG_HOTRELOAD_DEBOUNCE_MS` | How long the config watcher waits after a file changes before reloading it. Tests tighten it. | `150` |
| `THRONG_AUTOSAVE_DEBOUNCE_MS` | The layout autosave debounce. For one test only; real runs use 400 ms. | unset (400 ms) |
| `THRONG_ATTACH_DELAY_MS` | Delays a terminal's cold-start attach, to exercise the "still starting" retry. | `0` |
| `THRONG_FORCE_PTY_AGENT` | `1` routes every terminal through the de-elevated agent, so its plumbing can be checked without elevation. | unset |
| `THRONG_FAKE_ELEVATED` | `1` makes the app report its daemon as elevated, enabling the **Run as administrator** checkbox and the ADMIN pill without a real elevated run. | unset |
| `THRONG_NO_ORPHAN_REAP` | `1` stops a starting daemon sweeping up orphaned agent, ConPTY and folder-lock processes. The E2E harness sets it. | unset (sweep on) |
| `THRONG_DEELEVATE_FORCE` | `1` makes `scripts/run-deelevated.ps1` take its de-elevation path from a shell that is not elevated. See [elevation](../.claude/skills/throng-testing/references/elevation.md). | unset |
| `INKSCAPE` | The Inkscape executable `scripts/build-app-icons.mjs` renders the app icons with. | `inkscape` |

## Testing

One line each. The detail — what each does, why it exists and how to use it — is in the
`throng-testing` skill's [test environment variables](../.claude/skills/throng-testing/references/environment-variables.md)
reference; the [testing guide](testing.md) is the overview. The harness also sets several of the
[app variables](#running-the-app) and [development variables](#development) above for every app it
launches.

| Variable | What it controls | Default |
|---|---|---|
| `THRONG_E2E_TIER` | `parallel` or `serial`: run one local tier alone. See [tiers and workers](../.claude/skills/throng-testing/references/tiers-and-workers.md). | both tiers |
| `THRONG_E2E_WORKERS` | Playwright worker count. See [tiers and workers](../.claude/skills/throng-testing/references/tiers-and-workers.md). | `6` (2 on an elevated runner, 1 on CI); `npm run test:e2e` picks cores − 2, between 2 and 6 |
| `THRONG_E2E_RETRIES` | Retries per failing test; `0` shows raw first-attempt results. | `2` |
| `THRONG_E2E_FAIL_FAST` | `1` stops the E2E stage at its first failing test. `npm run gate` sets it. | unset |
| `THRONG_E2E_JSON_OUT` | Writes a JSON report to this path beside the list output. See [measuring durations](../.claude/skills/throng-testing/references/measuring-durations.md). | unset |
| `THRONG_E2E_TRACE` | Records a Playwright trace, kept only for a failing test. The release lane sets it. | unset |
| `THRONG_E2E_INCLUDE_ADMIN` | Opts the `@admin` specs back in; `npm run test:e2e:admin` sets it. See [elevation](../.claude/skills/throng-testing/references/elevation.md). | unset |
| `THRONG_E2E_INCLUDE_QUARANTINE` | Opts the `@quarantine` specs back in. See [quarantine](../.claude/skills/throng-testing/references/quarantine.md). | unset |
| `THRONG_E2E_IGNORE_ELEVATION_GUARD` | `1` runs the specs that normally skip on an elevated host. See [elevation](../.claude/skills/throng-testing/references/elevation.md). | unset |
| `THRONG_E2E_STEP_MS` | Pauses between the steps of a spec that opts in, so a run can be watched. | `0` |
| `THRONG_E2E_CLIPBOARD` | `memory` gives each app an in-memory clipboard; the harness sets it, and it also marks a run as a test run. See [global OS resources](../.claude/skills/throng-testing/references/global-os-resources.md). | unset |
| `THRONG_E2E_FOREGROUND_HANDOFF` | `1` re-enables the terminal foreground hand-off, which a test run otherwise turns off; set by the one spec that covers it. | unset |
| `THRONG_TEST_SHELL_HISTORY` | `off` makes every shell a test run opens keep no history; the harness sets it. See [global OS resources](../.claude/skills/throng-testing/references/global-os-resources.md). | unset |
| `THRONG_TEST_RUN_DIR` | The one scratch folder a test run and all its workers write into. See [temp files](../.claude/skills/throng-testing/references/temp-files.md). | created per run |
| `THRONG_TEST_RUN_OWNED_DIR` | Set by Playwright's global setup when it created the run folder, so teardown removes it. | set internally |
| `THRONG_NON_REFERENCE_HARDWARE` | Marks a machine whose timings are not representative, so wall-clock SLA ceilings are recorded rather than asserted. See [performance SLAs](../.claude/skills/throng-testing/references/performance-sla.md). | unset |
| `THRONG_NO_REENCODED_KEY_DELIVERY` | Declares the host cannot deliver CSI-u key sequences into a program, so those specs skip. | unset |
| `THRONG_CLAUDE_E2E` | `1` runs the specs that drive the real `claude` binary. Never on CI. | unset |
| `THRONG_CLAUDE_E2E_ROOT` | An existing project, with real Claude sessions, for those specs to use. | a temp folder |
| `THRONG_CLAUDE_PROJECT` | The project whose Claude session history the resume spec reads. | this repository |
| `THRONG_INPUT_SOAK` | `1` runs the keystroke soak. | unset |
| `THRONG_INPUT_SOAK_REPS` | Repetitions per shell in the soak. | `50` |
| `CI` / `GITHUB_ACTIONS` | Mark a CI run: skips the Claude and SLA specs, warms Electron once in global setup. | set by GitHub Actions |

## Release and CI

Inputs to `scripts/publish-gates.mjs` and the release scripts, set by `release.yml`. The detail is in
the `throng-release` skill's [publishing reference](../.claude/skills/throng-release/references/publishing.md).

| Variable | What it controls | Default |
|---|---|---|
| `THRONG_VERDICT_FILES` | Comma-separated verification verdicts, one per declared artifact. Absent or partial means verification failed. | unset |
| `THRONG_ARTIFACT_DIR` | Where the built artifacts are. | `dist/installer` |
| `THRONG_QA_SIGNED_OFF` | `1` only when a human approved the release in the GitHub `release` Environment. | unset |
| `THRONG_ALREADY_PUBLISHED` | `1` when a release for this version already exists. | unset |
| `THRONG_RELEASE_TAG` | The tag the artifacts are matched against. | `GITHUB_REF_NAME`, then `v<version>` |
| `GITHUB_REF_NAME` / `GITHUB_SHA` | Fallbacks for the release tag and the commit the release notes name. | set by GitHub Actions |

`scripts/verify-installer.mjs` also sets `THRONG_PIPE_NAME` for the app it probes, and `release.yml`
sets `THRONG_E2E_WORKERS`, `THRONG_E2E_RETRIES`, `THRONG_E2E_JSON_OUT` and `THRONG_E2E_TRACE` for
the full E2E lane.
