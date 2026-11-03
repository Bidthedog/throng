# Research: Linux Support in Dev Mode

Facts marked *measured* were observed on the reference machine on 2026-11-02 or 2026-11-03.

## R1. Sandbox and AppArmor

- **Decision**: `scripts/linux/apparmor-profile.sh install|status|remove` writes `/etc/apparmor.d/throng-dev-electron`, a profile with
  `flags=(unconfined)` and `userns,` attached to `<checkout>/node_modules/electron/dist/electron` and
  `<checkout>/.claude/worktrees/*/node_modules/electron/dist/electron`, then loads it with `apparmor_parser -r`. Needs `sudo` once.
- **Rationale**: *measured* `kernel.apparmor_restrict_unprivileged_userns = 1`, and `electron` aborts on the sandbox helper. A profile granting
  user namespaces is Ubuntu's own documented route and changes nothing system-wide. `unconfined` means it cannot limit which folders open (FR-002).
- **Alternatives**: `sysctl` off (system-wide, FR-002); setuid `chrome-sandbox` (root-owned file inside `node_modules`, lost on every `npm ci`); `--no-sandbox` (FR-003).
- **Local verification limit**: the implementing session has no `sudo` (*measured*), so the profile cannot be installed unattended, and starting Electron without its sandbox was refused by the session's permission classifier. Anything needing a window is therefore proved on CI, which installs the profile and runs the sandbox on, and on the reference machine by the manual test plan once the maintainer has run the install step.

## R2. Preflight

- **Decision**: `npm run start:ui` runs `scripts/preflight-start.mjs`, which on Linux checks the restriction, the profile and a display, prints what is wrong and
  what to run, and exits non-zero; otherwise it hands over to Electron. On Windows it hands straight over.
- **Rationale**: the abort happens in native code before any JavaScript, so the app's failure model cannot report it (FR-004).

## R3. Display mode

- **Decision**: unset `ELECTRON_OZONE_PLATFORM_HINT` behaviour: main calls `app.commandLine.appendSwitch('ozone-platform', 'x11')` before `ready` unless
  `window.nativeWayland` is true, in which case `wayland`. Read synchronously from settings.json, as the daemon reads its one value.
- **Rationale**: tear-off depends on positioning windows, which Wayland refuses; clarified in the spec.

## R4. Platform package layout

- **Decision**: `platform-node` (leaf), `platform-linux`, `platform`. `selectPlatform(nodePlatform)` returns a `PlatformServices` record of factories, and throws
  `UnsupportedPlatformError` on anything but `win32` and `linux`. koffi and DLL loads in `platform-windows` are already inside constructors (*measured*), so importing it on Linux is safe.
- **Moved to `platform-node`, re-exported from `platform-windows`**: `NodeUserContext`, `createFileLog`, `writeCrashReport`, `off-loop-exec`, `process-tree`.
  Existing imports and tests keep working. `electron-builder.yml`, `stamp-build.mjs`, `tsconfig.json`, `vitest.config.ts` and package manifests gain the new packages.

## R5. IPC endpoints

- **Decision**: core keeps building logical names. `resolveIpcAddress(name)` in host traits maps them: identity on Windows; on Linux an absolute path stays,
  a `\\.\pipe\` prefix is stripped, and anything else becomes `<ipcDir>/<sanitised>.sock`, hashing when the full path would pass 100 bytes (`sun_path` is 108).
  `ipcDir` is `$XDG_RUNTIME_DIR/throng`, else `/tmp/throng-<uid>`, created `0700` and refused if owned by another user.
- **Stale sockets**: a listener on `EADDRINUSE` connects first; refused means stale, so it unlinks and listens again.
- **Rationale**: every `listen` and `connect` site keeps its shape, `THRONG_PIPE_NAME` keeps working, including in tests, and the address no longer depends on checkout depth (FR-011).

## R6. Terminals

- **Decision**: `LinuxPtyHost` over node-pty. `conhostPid` is null. End: `SIGHUP` to the process group, then `SIGTERM`, then `SIGKILL` to the group and to `/proc` descendants within the limit; only processes started by that shell are candidates (pid plus start-time checked against reuse).
- **Shells**: `LinuxShellDetection` reads `/etc/shells`, keeps files that exist and are executable, de-duplicates by real path, ids `bash zsh fish sh dash ksh tcsh pwsh nu`, and orders `$SHELL` (else the passwd entry) first.
- **Process facts**: `/proc/<pid>/{stat,cmdline,exe,cwd,status,io}`; start time from field 22 and boot time.
- **Recipes**: bash takes git-bash's prompt recipe; zsh `precmd`; fish `--init-command`; sh and dash `PS1` only, with no history lever. Windows-only `win32-input-mode` code is inert because no Linux program enables it.

## R7. Path identity

- **Decision**: `normaliseForCompare` and siblings read `hostTraits().paths`. Linux: exact case, `\` stays a character. Windows default: unchanged.
- **Rationale**: see plan Complexity Tracking.

## R8. Trash

- **Decision**: delete keeps `shell.trashItem`. `LinuxTrash.restore(originalPath, deletedAt)` scans the home trash and each `$topdir/.Trash-$uid` and `$topdir/.Trash/$uid`, parses `.trashinfo` (`Path` percent-decoded, relative to topdir for volume trash), picks the closest at or before `deletedAt`, renames back and removes the info file. *measured*: `/data/storage` is a separate filesystem, so volume trash is a real case on the reference machine.
- **Unavailable**: a rejected `trashItem` reaches the existing permanent-delete confirmation.
- **Wording**: a core helper `trashTerm(os)` gives "Recycle Bin" or "Trash"; the setting metadata keeps its meaning (FR-025).

## R9. Data folders

- **Decision**: a `IUserDirectories` port: Windows returns today's values; Linux returns XDG values with `-dev` variants, creating them `0700`. `THRONG_*` overrides still win. The daemon receives paths from UI main as today, and has its own fallback through the same port.

## R10. Key bindings

*measured* from `gsettings` on the reference desktop, against the shipped table:

| Chord | Desktop use | Windows action | Linux default |
|---|---|---|---|
| `Ctrl+Shift+Alt+ArrowUp` | move window to workspace up | `focus.up` | `Ctrl+Shift+Alt+U` |
| `Ctrl+Shift+Alt+ArrowDown` | move window to workspace down | `focus.down` | `Ctrl+Shift+Alt+D` |
| `Ctrl+Shift+Alt+R` | screen recording UI | `view.resourceMonitor` | `Ctrl+Shift+Alt+Y` |

All three stay in the three-modifier family outside both Principle IV tiers. T031's test checks the whole table against the desktop list and fails on any further overlap.

- **Decision**: `LINUX_BINDINGS = { ...WINDOWS_BINDINGS, overrides }`, with `DESKTOP_RESERVED_CHORDS.linux` as data and a unit test that no Linux default is reserved and exactly the overrides differ.
- `AltGr` on X11 and Wayland arrives as `AltGraph`, not `Ctrl+Alt`, so the Windows disambiguation stays dormant; a unit test pins it (FR-035).

## R11. Resource Monitor

- **Decision**: `LinuxProcessMetrics` over `/proc`: CPU from `stat` deltas, memory from `status` `VmRSS`, I/O from `io`, which needs same-user access. GPU from `/proc/<pid>/fdinfo` `drm-engine-*` where the driver publishes it, else `Unavailable` with the reason. Per-process network has no unprivileged source, so it is `Unavailable` with that reason (055 FR-011, never zero).
- **Terminate**: pid plus start time, so reuse cannot end the wrong process.

## R12. Fonts

- **Decision**: `fc-list : family`; fontconfig missing yields an empty list, which the picker already handles. Default font stacks fall back through `monospace`.

## R13. CI

- **Decision**: `ubuntu-24.04`; `xvfb` at 1920x1080 with `xfwm4` as window manager; `zsh fish` installed so flavours run for real; AppArmor profile installed by the repo script. Jobs: unit and component, integration and contract, E2E `@core|@linux`. `gate.yml` gains a `gate-linux` job. See [contracts/ci-lanes.md](contracts/ci-lanes.md).
- **No-headless rule**: Xvfb is a real X server with real, mapped windows, and the app paints as usual, so the rule's reason holds (`references/no-headless.md`).
- **Alternatives**: `ubuntu-26.04` image, not known to exist yet on hosted runners; re-pin when it does.
- **Risk**: 24.04 is not the reference version, so a green lane does not prove 26.04. The reference machine's manual plan covers the gap.

## R14. Windows-only tests

- **Decision**: a helper `windowsOnly(reason)` wraps `describe.skipIf`/`test.skip`, requiring a reason (FR-042). `describe` blocks asserting `conhost`, ConPTY, integrity, drive forms, registry or PowerShell take it. Neutral tests that hard-code `C:\` or `powershell` get a portable fixture (FR-043). Assertions about Windows are not edited (SC-007).
- **E2E**: the harness's `conhost` helpers become no-op answers on Linux with `expectNoOrphans` reading `/proc`; tests naming a Windows shell take a shell from a `defaultTestShell()` helper.

## macOS readiness of the new seams (T047, SC-011)

Reviewed against what macOS would need; none names a Linux or Windows concept in its signature.

| Seam | macOS would supply |
|---|---|
| `IUserDirectories` | `~/Library/Application Support/throng[-dev]` |
| `ITrashRestore` | Restore from `~/.Trash`, whose records differ, behind the same two-argument call |
| `IOrphanProcesses` | `ps` for the table; the same "no parent is -1" rule (launchd adopts as pid 1) |
| `IVolumeRoots` | `getmntinfo` or `/Volumes`, same two questions |
| `HostTraits` | Separator traits as Linux; a case-folding flag, since APFS is usually case-insensitive, which `PathTraits` already carries |
| `displaySwitches` | Empty, as Windows |
| `selectPlatform` | A `darwin` case; until then `UnsupportedPlatformError` names it |
