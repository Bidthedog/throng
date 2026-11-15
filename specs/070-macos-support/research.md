# Research: macOS Support

Every decision below is verified on hosted macOS runners by the test named with it. Nothing here was tried on a Mac by
hand. Where a fact about macOS could only be confirmed on a runner, the decision says what proves it and what happens if
it is wrong.

## R1. Package shape

- **Decision**: new `@throng/platform-macos`, classes `Macos*`. POSIX code Linux already has and macOS can use as-is moves to
  `@throng/platform-node/src/posix/` with neutral names (`PosixElevation`, `PosixDirectoryLock`, `posixStartupRefusal`,
  `PosixPathForms`, `PosixShellDetection`, `ensureOwnerOnlyDir`, the node-pty spawn/write/resize half and
  `escalateSignals`). `platform-linux` re-exports each under its old `Linux*` name, so Linux imports and tests do not move.
- **Rationale**: Principle II keeps platforms apart; VIII forbids copying.
- **Alternatives**: a `platform-posix` package (one more package for code that has no third consumer); copying Linux files
  (DRY).

## R2. Process facts without `/proc`

- **Decision**: `macos-proc-table.ts` reads through koffi from `/usr/lib/libproc.dylib` and `libSystem`:
  `proc_listallpids`; `proc_pidinfo(PROC_PIDTBSDINFO)` for ppid, uid, `pbi_comm` and start time
  (`pbi_start_tvsec`/`usec`); `proc_pidinfo(PROC_PIDTASKINFO)` for CPU time (Mach absolute units scaled by
  `mach_timebase_info`) and resident size; `proc_pid_rusage(RUSAGE_INFO_V4)` for `ri_phys_footprint` (private memory) and
  `ri_diskio_bytesread`/`written`; `proc_pidpath` for the executable; `sysctl(KERN_PROCARGS2)` for argv;
  `proc_pidinfo(PROC_PIDVNODEPATHINFO)` for cwd. It returns the same `ProcRow` shape `proc-table.ts` does, so core's
  `descendantsOf` and `escalationTargets` and the reap rule are reused.
- **Rationale**: one call per fact, synchronous and cheap (microseconds), within 055's collector budget. A pid-reuse check
  compares start times exactly as Linux does.
- **Proof**: `macos-proc-table.integration.test.ts` spawns a known tree and checks ppid, start time, argv, cwd and exe
  against `ps -o` output on the runner. Struct offsets are named constants with a test that checks
  `proc_pidinfo`'s returned size equals the declared struct size, so a wrong layout fails loudly instead of reading garbage.
- **Alternatives**: spawning `ps`/`lsof` per sample (too slow); a native addon (compiler and signing).

## R3. GPU and network figures

- **Decision**: GPU per process is `unavailable` with the reason "macOS does not report GPU use per process". Network is
  `unavailable`, as on Linux.
- **Rationale**: no public API exposes per-process GPU time; `powermetrics` needs root.

## R4. Host traits on macOS

- **Decision**: `macosHostTraits(ipcDir, caseSensitiveRoots)` gives `os: 'macos'`, `paths: { caseSensitive: false,
  backslashIsSeparator: false, caseSensitiveRoots, unicodeForm: 'NFC' }`, `ipc: { kind: 'socket', dir }`. `PathTraits`
  gains two optional fields; absent means today's behaviour, so Windows and Linux results are unchanged by construction.
  `pathCompareKey` NFC-normalises when `unicodeForm` is set, and treats a path under any `caseSensitiveRoots` entry as
  case-sensitive. The roots are found at startup: `/` and each `/Volumes/*` mount, asked `pathconf(_PC_CASE_SENSITIVE)`
  through koffi. The preload exposes the whole traits object, not only `osName`, and `configure-host.ts` configures from it.
- **IPC**: `ipcDir` is `$TMPDIR/throng` (per-user under `/var/folders`, created `0700` with the owner check from R1). The
  existing 100-byte cap stays under macOS's 104-byte `sun_path`.
- **Proof**: unit tests with `withHostTraits(macos)` over `path-id`; `macos-host.integration.test.ts` creates a
  case-sensitive APFS disk image with `hdiutil create -fs "Case-sensitive APFS"`, mounts it, and checks it is listed.
- **Alternatives**: one process-wide case rule (fails FR-020 on case-sensitive volumes); probing per path (filesystem
  access inside pure core).

## R5. Folders

- **Decision**: data `~/Library/Application Support/throng[-dev]`, settings `…/throng[-dev]/settings`, logs
  `~/Library/Logs/throng[-dev]`. `IUserDirectories` gains optional `logDir(dev)`; Windows and Linux return today's
  `<data>/logs`, so nothing moves there. `THRONG_*` overrides keep working.
- **Rationale**: Apple's per-user locations, so Console.app shows the logs.

## R6. Trash and restore

- **Decision**: `MacosTrash` moves an item with `NSFileManager trashItemAtURL:resultingItemURL:error:`, called in
  process through the Objective-C runtime and `koffi` (`foundation-trash.ts`), records the resulting path in the existing undo record, and restores by moving that path back.
  `files-service` keeps calling `fs.trash`; on macOS the composition root binds the trash function to `MacosTrash.trash`
  rather than `shell.trashItem`, which discards the resulting URL. A restore that fails with `EPERM`/`EACCES` (macOS
  protects `~/.Trash` behind Full Disk Access) raises one notice: the item is in the Trash, and Finder's **Put Back**
  restores it.
- **Proof**: the shared trash contract on the runner. **Known risk**: hosted runners grant broad privacy access, so CI
  cannot show the protected-Trash case; the fallback notice is covered by a unit test with an injected `EPERM`, and the
  known differences list says undo may need Put Back.
- **Revised in implementation**: the call first ran as JXA under `osascript -l JavaScript`. On the hosted runners
  osascript was killed by SIGSEGV, sometimes after moving the item and sometimes before, launched from Electron and
  from plain Node alike, so a delete that succeeded reported failure and left nothing to undo. The runtime call has
  no child process to crash.
- **Alternatives**: scanning `~/.Trash` for the name (protected, and Finder renames duplicates); Finder AppleScript
  (Automation permission prompt per use).

## R7. File-list clipboard

- **Decision**: `MacosFileListCodec` writes and reads `NSFilenamesPboardType` (an XML plist array of paths) plus
  `public.file-url` for the first file; reads either.
- **Revised in implementation**: macOS 27 no longer adds `NSFilenamesPboardType` to a copy of several file URLs, and
  Electron reads a raw type for the first pasteboard item only. With no plist, the codec reads every item's
  `public.file-url` from `NSPasteboard` through the Objective-C runtime (`pasteboard-file-urls.ts`), trusted only when
  the first matches the payload Electron read.
- **Proof**: the shared `file-list-codec` contract (pure), plus an `@macos` E2E that copies in the explorer and reads the
  pasteboard back through `osascript`.

## R8. Fonts

- **Decision**: `NSFontManager.sharedFontManager.availableFontFamilies` through `osascript -l JavaScript`, off the event
  loop, cached for the process. Default fonts include `Menlo` and `SF Mono` when present.
- **Proof**: the shared font-enumeration contract on the runner.

## R9. PTY host, shells and login environment

- **Decision**: `MacosPtyHost` reuses the node-pty half from R1 and the R2 proc table for tree end, children and start
  times (SIGHUP+SIGCONT, 400 ms grace, SIGKILL, as Linux). Shell detection is the shared POSIX class (`/etc/shells`,
  `$SHELL`, `getpwuid` through `os.userInfo().shell`, PATH including `/opt/homebrew/bin` and `/usr/local/bin`). On macOS a
  shell starts as a login shell (`-l`), as Terminal.app does, so a terminal has the user's login environment when throng
  was launched from the Dock (FR-017).
- **Proof**: the shared pty-host and shell-detection contracts on the runner; an integration test that starts throng's
  daemon with a stripped `PATH` and checks a terminal sees the login shell's `PATH`.

## R10. Orphans and root

- **Decision**: `MacosOrphanProcesses` uses the R2 table; launchd (pid 1) is the adopter, as systemd/pid 1 is on Linux.
  Root refusal is the shared POSIX refusal (`getuid() === 0`).

## R11. Volumes, attributes, access info, properties dialog, file-manager item

- **Volumes**: `/` plus each `/Volumes/*` entry that is a mount point and not the boot volume's alias.
- **Attributes**: hidden is a leading dot or the `UF_HIDDEN` flag, read with `stat -f %Xf` off the loop (Node's `stat` has
  no `st_flags`); read-only is the write bit, as on Linux.
- **Access info**: owner and group names through `id -nu <uid>` and `dscacheutil -q group -a gid <gid>`, cached; numbers
  when lookup fails.
- **OS properties dialog**: unavailable with the reason "use Finder's Get Info". Linux already returns unavailable, so the
  control hides on both.
- **File-manager item**: unavailable on macOS with the reason in the known differences (FR-024); folders open through the
  Dock and Open With instead (R19).

## R12. Installed version and upgrade notice

- **Decision**: `MacosInstalledVersion(execPath)` reads `CFBundleShortVersionString` from the running bundle's
  `Contents/Info.plist` on disk (an XML plist; read with a small parser). When the user replaces the app in
  Applications, the on-disk version differs from the running one and the 063 FR-010 notice appears.
  `installed-copy.ts` gains a darwin branch: a copy under `/Applications` or `~/Applications` is installed.
  `exitWhenEntryRemoved: true`, so a daemon ends once the bundle is gone and nothing needs it (FR-005, 063 FR-013).
- **Proof**: `verify-macos-package.mjs`'s in-use-upgrade and uninstall steps.

## R13. Refused URI schemes and executable extensions

- **Refused schemes**: `x-apple.systempreferences`, `x-apple-helpbasic`, `applescript`, `itms-services`, `macappstore`,
  `ms-settings` excluded by the shared list. Same contract as Windows and Linux.
- **Executable extensions**: the execute bit, plus `.app`, `.command`, `.pkg`, `.mpkg`, `.workflow`, `.terminal`, `.tool`.

## R14. Privacy-protected folders (FR-025)

- **Decision**: a new `PlatformServices.privacyProtectedRoots(home)`: macOS returns Desktop, Documents, Downloads, iCloud
  Drive and `/Volumes`; Windows and Linux return `[]`. A listing failing with `EPERM` under one of them is classified by
  core's failure cause as "macOS withheld access" and raises one notice naming the folder and the System Settings route.
- **Proof**: unit test of the classifier; component test of the notice. CI cannot trigger the real prompt (runners grant
  access), listed as a known limit.

## R15. Translocation (FR-007)

- **Decision**: `startupRefusal()` on macOS also refuses when `process.execPath` contains `/AppTranslocation/`, with the
  text "Quit throng, drag it to Applications, then open it again." It runs where the root refusal already runs (UI main,
  before the daemon starts), so nothing else starts and quitting leaves no process.
- **Proof**: unit test of the predicate; `verify-macos-package.mjs` launches with a translocated-looking path through a
  test seam and checks no daemon starts.

## R16. Window chrome

- **Decision**: on macOS, `BrowserWindow` uses `titleBarStyle: 'hidden'` with `trafficLightPosition` aligned to throng's
  title bar, instead of `frame: false`. The renderer hides `WindowControls` and reserves the traffic-light inset on the
  left when `hostTraits().os === 'macos'`. Sub-workspace, Preferences, Resource Monitor and About windows get the same
  treatment; About keeps only the close light (`minimizable`/`maximizable` false). A new `windowChrome()` entry in
  `PlatformServices` returns the options, so `main.ts` does not branch on the OS.
- **Proof**: component tests (controls hidden, inset present); `@macos` E2E checks the window has native buttons through
  `BrowserWindow` state and that double-click on the title bar zooms.

## R17. Application menu

- **Decision**: on macOS `buildAppMenu` builds: the app menu (About, Settings… opening Preferences, Install/Uninstall
  'throng' command, Hide, Hide Others, Show All, Quit), Edit (role items), Window (role items) and Help. Settings… is shown with its accelerator but `registerAccelerator: false`; the Edit roles register
  theirs, because macOS routes text commands to fields only through a registered Edit menu. Every other item that
  duplicates a throng binding is shown with its accelerator but `registerAccelerator: false`, so the keystroke reaches the
  renderer and throng's binding layer, which the user can rebind. Only the macOS-reserved items register their
  accelerators (Cmd+Q, Cmd+H, Cmd+Option+H, Cmd+M). Windows and Linux keep today's Help-only menu.
- **Proof**: unit test of the template per platform; `@macos` E2E clicks each app-menu item through Electron's `Menu` API.

## R18. Close and quit (FR-028)

- **Decision**: on macOS, the main window's `close`, when no quit is in progress, hides the window (the renderer and its
  state stay alive) and does not run the quit flow. `activate` shows it again, so no second main window is ever created
  and the close/shutdown wiring stays bound to the one window. `before-quit` (Cmd+Q, menu, Dock, logout) prevents the quit
  and runs the existing shutdown driver (closing progress, terminals prompt, cancel); when it finishes it sets
  `allowClose` and calls `app.quit()` again. Windows and Linux keep the window-close path.
- **Proof**: unit tests of a small `mac-lifecycle.ts` state machine; `@macos` E2E: close the window, the process stays,
  activate restores the layout; Cmd+Q shows closing progress and the app exits.

## R19. Opening folders from the Dock, Finder and the command line

- **Decision**: `Info.plist` declares `CFBundleDocumentTypes` with `LSItemContentTypes: [public.folder]`, role `Viewer`, so
  a folder can be dropped on the Dock icon or opened with Open With. `app.on('open-file')`, registered before `ready`,
  pushes a directory into the existing `OpenFolderQueue`; a file is ignored. The command line keeps 067's
  `parseLaunchFolder`.
- **Proof**: `@macos` E2E calls `open -a <bundle> <folder>` against the packaged app in `verify-macos-package.mjs`'s core
  journey, and an E2E emits `open-file` through the main process seam for the dev build.

## R20. Install 'throng' command (FR-024a)

- **Decision**: new seam `ICommandLineInstall { available; status(); install(); uninstall() }`. macOS: the bundle carries
  `Contents/Resources/bin/throng`, a POSIX `sh` script that turns each argument into an absolute path and starts the
  bundle's executable with them, detached. Install links `/usr/local/bin/throng` to that script with
  `osascript -e 'do shell script "…" with administrator privileges'` (the system's own prompt), creating `/usr/local/bin`
  when absent. A link pointing at another target asks before replacing. Status reads the link: absent, ours, ours-broken
  (bundle moved), other. On start, ours-broken raises one notice with an Install action. Windows and Linux return
  `available: false` (their installers put `throng` on the path), so the actions do not appear there.
- **Proof**: unit tests of status and the script's path handling; integration test of install/uninstall into a temporary
  prefix with the privilege step injected; `verify-macos-package.mjs` runs the CLI script against the installed bundle.

## R21. Key bindings

- **Decision**:
  - `KeyEvent` gains `meta`; `eventToToken` emits `Meta`. Tokens render as `Cmd` in the UI on macOS.
  - `MACOS_BINDINGS` is derived from `WINDOWS_BINDINGS` by replacing `Ctrl` with `Meta` in every application chord, then
    applying `MACOS_BINDING_OVERRIDES` for each chord whose Cmd form macOS reserves. The reserved list
    (`MACOS_RESERVED_CHORDS`) is Cmd+Tab, Cmd+Space, Cmd+H, Cmd+Option+H, Cmd+M, Cmd+Q, Cmd+`, Cmd+Option+Esc,
    Cmd+Shift+3/4/5, Cmd+Ctrl+Q, Cmd+Ctrl+F, Cmd+Option+D, Ctrl+Arrow keys and Ctrl+Space. Each override is chosen so it
    collides with neither reserved tier nor another default, and is listed in `docs/key-bindings.md`.
  - Terminal reserved chords stay Ctrl (`RESERVED_TERMINAL_CHORDS` unchanged), so the shell keeps Ctrl+C, Ctrl+R and the
    rest.
  - The renderer resolvers stop declining `metaKey` when the host is macOS. On Windows and Linux they keep declining it.
    This supersedes **046 FR-104's** tier-1 Meta clause on macOS only; the Office-key case it protects does not exist on
    a Mac.
  - `keybindings-platform.test.ts`'s "no macOS chord is guessed" (016 FR-017e) is replaced by assertions on the derived
    table.
  - Editor: `use-editor.ts` and `link-decorations.ts` read `hostTraits().os`, not `DEFAULT_BINDING_PLATFORM`; the macOS
    column-select modifier is Option (016 FR-017e). Mouse zoom uses the platform's primary modifier.
  - The DevTools toggle in dev uses `input.meta` on macOS.
- **Proof**: unit tests over the derived table (every action has a working chord, none on a reserved chord, no
  duplicates); resolver unit tests under macOS traits; `@macos` E2E fires a sample of Cmd chords and one terminal Ctrl
  chord.

## R22. Option as Meta (FR-031)

- **Decision**: setting `terminals.macOptionIsMeta`, default `false`, `onlyOn: 'macos'`, passed to xterm's
  `macOptionIsMeta`. Default false lets Option type the layout's characters.
- **Proof**: settings completeness, reset and inertness tests; a component test that the option reaches xterm.

## R23. Packaging and signing

- **Decision**:
  - `electron-builder.yml` gains `mac` (targets `dmg` and `zip`, `arch: arm64`, `identity: "-"`,
    `hardenedRuntime: false`, `gatekeeperAssess: false`, `extendInfo` with `CFBundleDocumentTypes` (R19)) and `dmg`
    (Applications link layout). `artifactName: throng-${version}-mac-arm64.${ext}`.
  - Native prebuild filters stay in the shared `files` list and keep only `${platform}-${arch}`, which electron-builder
    expands per build (`darwin-arm64` for mac). Moving them into `win.files`, `linux.files` and `mac.files` was tried
    first and packed the whole repository into all three: a platform's `files` list replaces the shared one, and a
    list of exclusions alone means everything. Windows and Linux also drop prebuilds they never loaded.
  - `packaging/macos/after-sign.cjs` ad-hoc signs (`codesign --force -s -`) the bundled Node runtime, every `.node`
    addon, node-pty's `spawn-helper` and koffi's dylib, then runs `codesign --verify --deep --strict` on the whole bundle.
    A non-zero exit fails the build (FR-044).
  - `stage-runtime.mjs` copies the runner's arm64 `node` (setup-node's official build) into `runtime/node`.
  - An entitlements file is added only if the E2E proves the bundled runtime needs one (koffi without hardened runtime
    needs none).
- **Proof**: the build job runs `codesign --verify` and `lipo -archs` on every Mach-O, failing on any non-arm64 or unsigned
  binary; the release verify steps launch the result.

## R24. Artifact set

- **Decision**: `ArtifactPlatform` gains `'darwin'`; roles `dmg` (`throng-V-mac-arm64.dmg`) and `macarchive`
  (`throng-V-mac-arm64.zip`). `MACOS_PACKAGE_STEPS`: install, launch, version-match, self-contained, core-journey,
  reattach, in-use-upgrade, checksum-match, no-write, uninstall, residue-scan, cli-command, gatekeeper-first-launch.
  `gatekeeper-first-launch` joins `RUNNER_LIMITED_STEPS` with the reason "a hosted runner cannot click Open Anyway".
  `artifact-set.mjs` accepts `--platform darwin`.

## R25. Runners, named once (FR-037)

- **Decision**: `.github/macos-runners.json` holds `{ "current": "<label>", "previous": "<label>" }`, today
  `{ "current": "xcode-27", "previous": "macos-26" }`: GitHub now labels its macOS 27 image by Xcode version. Every
  macOS job reads it through one `macos-runners` job whose output feeds `runs-on` and matrices. Moving the range forward
  is editing that file.
- **Proof**: a unit test fails if any workflow file names a macOS label directly; the first CI run on the branch
  confirms both labels resolve (recorded in the PR).

## R26. Release verification

- **Decision**: `scripts/verify-macos-package.mjs`, the macOS counterpart of `verify-linux-package.mjs`, sharing its RPC
  journey helpers through a new `scripts/verify-package-lib.mjs`:
  - **dmg**: `hdiutil attach -nobrowse`, copy the `.app` into a fresh `Applications` folder, detach.
  - **zip**: `ditto -x -k` into a fresh folder.
  - Then launch, version match (Info.plist and About), self-contained (the daemon's executable is
    `Contents/Resources/runtime/node`, from `proc_pidpath`), core journey, reattach, in-use upgrade (an older fixture
    replaced by the new bundle while running; the notice appears), no-write (mtime snapshot of the bundle), CLI command
    (the bundle's script opens a folder), uninstall (delete the bundle while running; the daemon ends), residue scan,
    checksum. Gatekeeper first launch is recorded unproven.
  - Runs on both runners in `.github/macos-runners.json`.

## R27. CI and gate jobs

- **Decision**:
  - `ci.yml` adds `macos-fast` (unit, component), `macos-test` (build, integration, contract) and `macos-e2e` (build,
    `npx playwright test --grep '@core|@macos'`), each a matrix over both runners. `scripts/ci-macos-setup.sh` installs
    fish through Homebrew, writes the zsh compinit guard as Linux does, and prints the display size. No display server is
    needed: hosted macOS runners have a logged-in desktop session.
  - `gate.yml` adds `gate-macos` (matrix, `npm run gate` with E2E `@core|@macos`, as Linux's gate runs
    `@core|@linux`, because the rest of the suite still assumes Windows shells), and the FR-050 latency step.
    `report-failure` needs it.
  - `.github/actions/install-electron` caches `~/Library/Caches/electron`.
  - Clean-up: `clear-dev-state.mjs`, `helpers/processes.ts` and the Playwright global setup list processes with BSD
    two BSD `ps` calls joined on pid on darwin (`comm` is a full path that can hold spaces, so one line cannot be split).
  - `vitest.config.ts`'s off-platform filter becomes three-way; `platform-guards.ts` gains `skipUnlessMacos` and
    `isMacosHost`.
  - `@macos` joins `e2e-tags.test.ts`'s allowed set and gets an `e2e-budget.json` entry.
- **Risk**: the runner's display may be smaller than 1920×1080. `ci-macos-setup.sh` prints it on the first run, and specs
  that need a size set the window size through the harness, as the Linux lane does.

## R28. Typing latency in CI (FR-050)

- **Decision**: `terminal-load.measure.ts` gains `THRONG_MEASURE_ASSERT_P95_MS`; when set, the spec fails if `echoP95Ms`
  exceeds it, and prints the `MEASURE` line either way. The macOS gate lane runs it with `THRONG_MEASURE_BUSY=10` and
  `THRONG_MEASURE_ASSERT_P95_MS=100` on both runners. `docs/testing.md`'s rule that SLAs are asserted only on reference
  hardware gains the macOS exception and its reason: there is no macOS reference hardware.

## R29. Constitution amendment (FR-002)

- **Decision**: Principle II: "Windows, Linux and macOS are the supported targets"; the per-OS delivery rule names all
  three; the macOS side is proved by CI only, and no feature may require a manual test on a Mac. The "macOS
  implementations are not required" sentence goes. **MINOR, 6.5.0 → 6.6.0**: an additive obligation within an existing
  principle; no previously stated guarantee is withdrawn. The SYNC IMPACT REPORT lists the templates reviewed.
- **Known violation at adoption**: none after this feature, since it delivers every seam; the amendment lands first on the
  branch and the feature closes it before merge.

## R30. Docs

- **Decision**: `docs/install-macos.md` (download, drag to Applications, Open Anyway per supported release, the command,
  upgrade, removal, data folders, best-endeavours statement), `docs/macos.md` (known differences, matching `linux.md`).
  `installation.md` table row, `README.md` badge and one line, `docs-currency.test.ts` platform list,
  `quick-start.md`, `CONTRIBUTING.md` (building on a Mac, the bug-report ask), `architecture.md`, `key-bindings.md`,
  `preferences.md`, `environment.md`, `testing.md` (macOS lanes), `releasing.md` (artifacts, moving the runner range).

## R31. Website (FR-048)

- **Decision**: the website is #554's, still open, and not built (064 deferred it). The release body carries the macOS
  download and statement now (`release-notes.ts` footer: Gatekeeper step, `shasum -a 256`). The website's install section
  gets macOS when #554 builds it; a comment on #554 records the requirement.

## R32. Misrouted darwin branches fixed

`configure-host.ts` (Windows traits for macOS), `installed-copy.ts` (Windows check), `daemon/composition-root.ts:381`,
`machine-identity.ts:148`, `anonymise.ts:44`, `claude-session-resolver.ts:26` (binary `windows|linux` types),
`select-platform.test.ts` (asserts darwin refuses), `use-terminal.ts:483` (`navigator.platform` sniffing replaced by host
traits), `file-tree.tsx:407` (same).
