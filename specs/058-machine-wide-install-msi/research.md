# Research: Machine-Wide Installation & the MSI

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-10-20

Every decision below names what was chosen, why, and what was rejected. Source citations are to the
repository at the plan's base commit and to `app-builder-lib` 26.17.0 (electron-builder's packaging
library, the version `package-lock.json` pins).

---

## D1 — The MSI is built by electron-builder's `msi` target, customised through `msiProjectCreated`

**Decision.** Add `msi` to `win.target` with an `msi:` block (`oneClick: false`, `perMachine: false`,
`artifactName: throng-${version}.${ext}` → `throng-<version>.msi`, `upgradeCode` fixed and recorded).
The WiX project electron-builder generates is then rewritten by a build hook,
`msiProjectCreated: packaging/msi-project.cjs`, which applies the throng-specific changes D2, D4,
D9 and D10 need. The transforms live in a pure module (`packages/core/src/config/msi-project.ts`)
that takes the generated `.wxs` text and returns the rewritten text, so each transform is unit-tested
against a captured copy of the template's output rather than proved only by building an MSI.

**Why.**

- `app-builder-lib/templates/msi/template.xml` with `oneClick: false` already authors a
  **dual-purpose package**: `ALLUSERS=2`, `MSIINSTALLPERUSER=1`, the `WixUI_InstallDir` dialog set
  with an `InstallScopeDlg`, `WixPerUserFolder` / `WixPerMachineFolder`, and the
  `FindRelatedProducts` re-run after a scope change. That is the Windows 7+ single-package-authoring
  mechanism, and it is exactly what FR-003a asks for.
- The hook is a supported extension point (`configuration.d.ts:462`, emitted at `MsiTarget.js` before
  `candle.exe` runs), so nothing in `node_modules` is edited and `npm ci` cannot undo it.
- It keeps one file harvest. electron-builder walks the unpacked app into `<Component>`s; a second
  toolchain would harvest the same tree a second way, and the two would drift.

**FR-003a's stop-and-ask is not triggered.** The per-user MSI scope installs into the user's profile
without elevation: with `MSIINSTALLPERUSER=1` and `ALLUSERS=2`, Windows Installer installs per-user
and never requests elevation. The verification matrix proves it with a genuine standard account
(D11), not by inference.

**Rejected.**

- *A hand-authored WiX project built outside electron-builder.* A second toolchain to install on the
  runner, a second harvest of `win-unpacked`, and nothing gained over a hook that edits the generated
  project.
- *`msiWrapped`.* Ruled out by the spec (it wraps the NSIS setup and adds nothing).
- *`perMachine: true`.* Removes the per-user scope, which FR-003a requires.

---

## D2 — The MSI's default scope when none is chosen (FR-003a, clarified 2026-10-20)

**Decision (revised after the first rehearsal).** The scope is Windows Installer's own, with no
private switch. The package stays `ALLUSERS=2` with `MSIINSTALLPERUSER` absent from the Property
table, so a run with administrator rights is machine-wide and any other run is per-user, natively.
The documented switches are the standard properties passed on the command line: `ALLUSERS=1` for
machine-wide, `MSIINSTALLPERUSER=1` for per-user.

**What this supersedes.** The first design was a public `THRONG_SCOPE` property (`user` | `machine`)
that execute-sequence type-51 actions turned into those properties. A rehearsal measured that
`msiexec /i throng.msi /qn THRONG_SCOPE=user`, run elevated, installed to `C:\Program Files\throng
MSI`: Windows Installer fixes the install context from the command line or the UI sequence, so an
action that changes `ALLUSERS` or `MSIINSTALLPERUSER` later in the execute sequence is too late.
`THRONG_SCOPE` and its `ThrongScope*` actions are gone; the scope page's relaunch passes `ALLUSERS=1`.

**Why `MsiRunningElevated` and not `Privileged` or `AdminUser`.** Both of those are true for an
administrator's *unelevated* filtered token under UAC, so an administrator double-clicking the MSI
would get a machine-wide default and an elevation prompt — the opposite of FR-002 for an
interactive non-elevated run. `MsiRunningElevated` is set only when the installing process actually
holds an elevated token, which is the condition managed deployment (SYSTEM, an elevated script)
creates.

**Rejected.** A per-machine-only MSI (#351's 2026-09-02 position, superseded by FR-003a); a separate
"machine-wide MSI" artifact (two files for one format, and the per-user default would still need
this rule).

---

## D3 — The setup: electron-builder's NSIS template, with four of its behaviours replaced

**Decision.** Keep the `nsis` target, set `allowElevation: true` (so the template's install-mode
page offers *Anyone who uses this computer* with an elevation shield), and **shadow** two template
files — `installSection.nsh` and `multiUserUi.nsh` — with throng's modified copies in
`packaging/nsis/`. `packaging/installer.nsh` (still `nsis.include`) adds the template directory with
`!addincludedir` and then `!cd`s into `packaging/nsis/`; makensis resolves a relative `!include`
against the current directory first, so the template's own `!include installSection.nsh` and
`!include multiUserUi.nsh` pick up the vendored copies in both passes (installer and uninstaller),
and every other include falls through to the template directory.

*Why not `nsis.script`* (the first plan): when `nsis.script` names a file, electron-builder skips the
uninstaller-building pass entirely (`NsisTarget.js:354-362`), so no `Uninstall throng.exe` is
produced. Found during implementation. `installer.nsi` itself is the stdin script and cannot be
shadowed; the two behaviours of it this spec must change (the silent per-machine auto-elevate block,
and defaulting to per-machine when an `HKLM` entry exists) are neutralised from `customInit`. A guard test
(`packages/ui/tests/unit/nsis-vendored-templates.test.ts`) pins the `app-builder-lib` version, the
SHA-256 of each upstream file the vendored copies were taken from (and of `installer.nsi`, whose
behaviour `customInit` relies on), and the presence of the `!addincludedir` / `!cd` lines, and fails when either moves, so
an electron-builder upgrade forces the vendored files to be re-reviewed rather than silently
diverging.

**Why it cannot be done with `nsis.include` alone.** Four template behaviours contradict this spec,
and none has a hook:

| Template behaviour | Where | Contradicts |
|---|---|---|
| An all-users install runs the **per-user copy's uninstaller** first | `installSection.nsh:55-58` (`uninstallOldVersion HKEY_CURRENT_USER` when `$installMode == "all"`) | FR-017 — installing one copy must not remove another |
| Declining the elevation prompt returns to the scope page **with no explanation** (the message is commented out) | `multiUserUi.nsh`, leave handler, `${Case} 1223` | FR-010a — "say why" |
| `/S /allusers` from a non-elevated prompt **raises the elevation prompt** (UAC plugin) | `multiUserUi.nsh` / `multiUser.nsh` | FR-010 — fail with a non-success code, never prompt in a silent run |
| The running-app check terminates `throng.exe` processes on a silent install | `allowOnlyOneInstallerInstance.nsh` (`customCheckAppRunning` is the hook; the default kills) | FR-015 / FR-016a — never terminate another account's processes |

The fourth *does* have a hook (`customCheckAppRunning`), and `packaging/installer.nsh` defines it
rather than vendoring that file.

**What the vendored copies change, and nothing else:**

1. `installSection.nsh` — the `HKEY_CURRENT_USER` uninstall block is removed (FR-017); in-use file
   operations use `/REBOOTOK` and set the reboot flag on the machine-wide path (FR-016a, D9).
2. `multiUserUi.nsh` — on a declined or failed elevation, a message says that installing for every
   user needs administrator approval, nothing was installed, and the user can choose *Only for me* or
   try again; the page stays (FR-010a). In a silent run with `/allusers` and no elevation, it writes
   the message to the attached console and exits `740` (`ERROR_ELEVATION_REQUIRED`) without prompting
   (FR-010).

**Rejected.**

- *Two setup executables, one per scope.* FR-001 requires the choice inside one installer.
- *Patching `node_modules`.* No patch mechanism exists in this repo and `npm ci` would undo it.
- *Leaving the cross-scope uninstall and documenting it.* It is a direct breach of FR-017, which the
  user locked in.

---

## D4 — Install folders, entries and labels (FR-017a, FR-017b)

**Decision.**

| Copy | Install folder | Apps-list entry (DisplayName) | Start-menu shortcut |
|---|---|---|---|
| Setup, per-user | `%LOCALAPPDATA%\Programs\throng` (unchanged) | `throng <version> (per-user)` | `throng (per-user)` |
| Setup, machine-wide | `%ProgramFiles%\throng` | `throng <version> (all users)` | `throng (all users)` |
| MSI, per-user | `%LOCALAPPDATA%\Programs\throng MSI` | `throng (MSI, per-user)` | `throng MSI (per-user)` |
| MSI, machine-wide | `%ProgramFiles%\throng MSI` | `throng (MSI, all users)` | `throng MSI (all users)` |
| Portable / archive | wherever the user put it | none | none |

- The setup's two scopes already land in different hives (`HKCU` vs `HKLM`) under one
  `UNINSTALL_REGISTRY_KEY`, so they are separate entries; the vendored `installSection.nsh` writes the
  scope into `DisplayName` and the shortcut name at run time from `$installMode`.
- The MSI has its own `UpgradeCode`, so Windows Installer never treats it as related to the setup.
  Per-user and per-machine MSI installs are separate products to Windows Installer (major-upgrade
  detection is per installation context), so each scope's copy upgrades only itself.
- The MSI's product name is set per scope by a type-51 custom action on `ProductName` before
  `CostInitialize`, so the two MSI entries differ. Verification asserts the registered `DisplayName`
  of every combination, so if this mechanism does not register, the matrix goes red rather than the
  labels quietly colliding.

**Why rename the per-user setup's shortcut.** FR-017b requires every copy's shortcut to carry its
install scope. Pinned taskbar items survive the rename, because they resolve through the application's
user model id, not the shortcut name; the upgrade replaces the old `throng` shortcut.

---

## D5 — One running throng per user: an instance pipe, plus the lock older releases hold (FR-018, FR-018b)

**Decision.** A new main-process guard, run before `app.whenReady()`:

1. **The instance lock is a named pipe**, `<daemon pipe>.instance` — derived from the same per-user
   name the daemon uses (`defaultPipeName`, 020 FR-013), so it follows the daemon namespace exactly
   (D8). The first launch listens on it; libuv creates the first pipe instance exclusively, so a
   second `listen` fails with `EADDRINUSE` atomically, and two simultaneous launches cannot both win.
2. **A launch that loses** connects to the pipe, sends one JSON line — `{ execPath, version }` — and
   quits. The primary brings its window forward (the existing focus-and-recover code), and if
   `execPath`'s install root differs from its own, raises the different-copy notice (D5a).
3. **A launch that wins also calls `app.requestSingleInstanceLock()`** — Electron's lock, keyed to the
   userData folder, which is the only lock releases before this feature hold. If it fails, a
   pre-058 copy is running: release the pipe and quit (the older copy brings its own window forward;
   it cannot show the notice — FR-018b). If an older copy is launched while a new one runs, the older
   copy loses Electron's lock and the new copy receives `second-instance` with that launch's `argv`,
   whose first element is the older copy's executable — treated exactly like a pipe message.

**Why a pipe rather than Electron's lock alone.** Electron's lock is keyed to the userData folder,
so `--user-data-dir` (or `app.setPath('userData')`) creates a second, independent lock — the very
hole FR-018 closes ("whatever switches it was launched with"). A per-user pipe is independent of
userData, and it carries the launching copy's identity, which the notice needs.

**Rejected.** A Windows named mutex (needs a native call — koffi or a C++ addon — from Electron's
main, for no gain over a pipe Node creates natively, and it cannot carry the launch's identity); a
lock file under `%APPDATA%\throng` (stale after a crash; a pipe disappears with its process).

### D5a — The different-copy notice

Raised in the running instance's main window, inline (the repo rule: one condition, one notice; inline
for anything with a remedy). It names the running copy's location and version and says to close it
first to open the other copy. A second different-copy launch while it is showing re-flashes the same
notice rather than raising another. "Different copy" means a different install root: the folder
containing the launched executable, compared case-insensitively with separators normalised (the same
comparison `daemon-lifecycle.ts` `sameEntry` uses).

---

## D6 — The portable build joins the user's namespace

**Decision.** Remove `PORTABLE_PIPE_SUFFIX` and `isPortableLaunch`'s effect on the pipe name
(`instance-paths.ts:60-85`), so a portable copy uses the user's one daemon and one instance lock
(FR-018, FR-021).

**Why it is safe.** The suffix was #429's fix: the portable launcher deletes its unpack folder, the
detached daemon outlived it, and the next installed launch adopted an orphan that could not load
`conpty.node`. `ensureDaemon` has since gained an orphan check (`daemon-lifecycle.ts:229`: a daemon
whose own entry is gone from disk is retired), which handles that case on any pipe. An integration
test re-creates #429's shape — a daemon whose entry file is deleted, then a launch on the same pipe —
and asserts it is replaced.

---

## D7 — A daemon of a different build, on the user's namespace, is replaced (FR-021a)

**Decision.** `ensureDaemon`'s #192 guard (`daemon-lifecycle.ts:250` — never retire a daemon whose
entry is not ours) is narrowed: it still protects a daemon started from a **development tree**, and no
longer protects a daemon started from **another installed or extracted copy**. The daemon reports
whether it is packaged in its `health.ping` answer (`packaged: boolean`, alongside the existing
`buildId`, `daemonEntry`, `elevated`); a stale build from a packaged copy is retired exactly as a
stale build of our own is today. A daemon that predates the field reports nothing and is treated as
packaged, which is what every pre-058 release daemon is.

**Why.** FR-021a: starting a copy of a different build replaces the user's daemon, ending its
terminals, with no prompt. Under #192 as written, a different copy's daemon would be "foreign" and
left alone, and the new copy could not start its own on the same pipe — a hang rather than a
replacement. #192 exists to protect a developer's installed throng from a dev build (and the
reverse); D8 keeps those in separate namespaces, and the narrowed guard is the second line of
defence it always was.

---

## D8 — Development and test runs keep their own namespace (FR-018a)

**Decision.** No new mechanism. A namespace is the daemon pipe name, and the rules that already
separate them stay: an unpackaged run appends `.dev` (`instance-paths.ts:83`), and
`THRONG_PIPE_NAME` overrides the name outright (every E2E spec and `verify-installer.mjs` already set
one). The instance lock (D5) and the daemon both derive from the namespace, so a dev build or a test
run never meets the installed copy's lock or daemon. `verify-installer.mjs` sets `THRONG_PIPE_NAME`,
`THRONG_CONFIG_ROOT` and `THRONG_DATABASE_PATH` on every launch it makes, so verification on a
developer machine cannot collide with the developer's own throng.

`--user-data-dir` alone no longer creates an independent instance for a packaged copy (D5). That is
FR-018's intent: it remains a development and test switch (FR-020), and the harnesses that use it set
`THRONG_PIPE_NAME` with it.

---

## D9 — A machine-wide upgrade or uninstall that finds another account using throng (FR-015, FR-016a)

**Decision.** One helper decides, for both installers: `packaging/in-use.mjs`, run with the
**existing** installation's bundled runtime (`<install root>\resources\runtime\node.exe`), lists
every process whose executable lies under the install root, with its owning account, and prints a
JSON verdict. The classification is a pure function in `@throng/core`
(`packages/core/src/config/install-in-use.ts`): own-account processes, other-account processes, and
the names to show. The OS query is the script's (`Win32_Process` via PowerShell CIM, `GetOwner` per
process).

| Situation | Interactive | Unattended |
|---|---|---|
| Only the performing account uses it | 020 FR-019's three-choice prompt, as today | as today |
| Another account uses it | Refuse before changing anything, naming each account; retry once closed | Proceed without terminating anything: files in use are replaced or removed at the next restart, exit `3010` |

- **Setup**: the vendored `installSection.nsh` (D3) uses `Delete /REBOOTOK` / `RMDir /r /REBOOTOK`
  and `SetRebootFlag`; `customCheckAppRunning` (D3) replaces the template's kill with the helper's
  verdict, and is scoped to **this copy's** install root, so another copy running never blocks
  (FR-017).
- **MSI**: `MSIRESTARTMANAGERCONTROL=Disable` is set (so Restart Manager never shuts down another
  account's throng), and a custom action in the UI sequence runs the helper and refuses with a
  message when another account is found. Unattended, Windows Installer's own in-use handling
  schedules the replacement and returns `3010`.

**What cannot be proved on a hosted runner.** The runner cannot reboot mid-job, so "after the restart
the installation is wholly the new version" is proved by hand on a VM (quickstart, *By hand*). The
runner **can** prove everything up to the restart: exit `3010`, the other account's process still
alive, and the pending replacements registered in `PendingFileRenameOperations`.

**Rejected.** Terminating other accounts' processes (forbidden by FR-015); refusing unattended runs
(the 2026-10-19 clarification chose restart-completion for unattended).

---

## D10 — The application started at the end of an elevated install is not elevated (FR-007)

**Decision.**

- **Setup**: electron-builder's finish page launches with `StdUtils::ExecShellAsUser` when the
  installer is elevated, which starts the app through the shell at the desktop user's privilege
  level. Verification asserts the launched process's integrity level is not High.
- **MSI**: the `runAfterFinish` custom action is replaced by one that launches through
  `explorer.exe`, which starts the target at the shell's (unelevated) integrity level. This matters
  because the elevation relaunch below makes the whole MSI client elevated.

### D10a — Declining elevation in the MSI returns to the scope choice (FR-010a)

Windows Installer raises its elevation prompt at the *Install* button, after the dialog sequence,
and a declined prompt ends the session — it cannot return to a dialog. So the MSI elevates **at the
scope choice instead**: choosing *for all users* in the non-elevated UI runs a custom action that
relaunches `msiexec` for the same package with `ALLUSERS=1` through `ShellExecute`'s
`runas` verb. If it starts, the non-elevated session ends and the elevated one carries on from the
scope choice. If it is declined (`ERROR_CANCELLED`) or fails, the custom action sets a property, and
the dialog shows the FR-010a explanation and stays on the scope choice. This is the same pattern
electron-builder's NSIS page uses (`UAC_RunElevated`, D3).

**If the relaunch cannot be made to work in the MSI UI, implementation stops and puts it to the
user**, as FR-003a requires for the analogous MSI finding, rather than shipping an MSI that ends the
session on a declined prompt.

---

## D11 — The verification matrix: every artifact, every scope, each on a clean runner

**Decision.** `verify-installer` becomes a **matrix job**, one runner per combination, so each starts
from a clean machine (FR-028):

| Combination id | Artifact role | Scope | Steps beyond the format's own |
|---|---|---|---|
| `setup-user` | setup | per-user | `standard-account-install` |
| `setup-machine` | setup | machine-wide | `second-account`, `in-use-upgrade`, `not-elevated-launch`, `silent-elevation-refused` |
| `msi-user` | msi | per-user | `standard-account-install` |
| `msi-machine` | msi | machine-wide | `second-account`, `in-use-upgrade`, `not-elevated-launch` |
| `portable` | portable | — | — |
| `archive` | archive | — | — |

**The second, standard account.** Each runner creates a local standard (non-administrator) account
with a random password and runs processes as it with `Start-Process -Credential`
(`CreateProcessWithLogonW`), which grants the new process access to the interactive window station
and desktop. This gives the matrix a **genuine** non-administrator token on a runner where the
default account is an administrator with UAC disabled:

- `standard-account-install` (per-user combinations) installs **as that account**, silently. A
  per-user path that requested elevation would fail outright, with nobody to approve it, so a pass is
  a real proof of FR-006 rather than an inference from a manifest.
- `second-account` (machine-wide combinations) launches the shared installation as that account and
  proves FR-029: the app starts, its daemon runs under that account (process owner) from the bundled
  runtime, at medium integrity, on that account's own pipe, a terminal works, and neither account's
  daemon or data is visible to the other.
- `silent-elevation-refused` runs the setup's silent machine-wide switch **as the standard account**
  and expects exit `740`, nothing installed (FR-010).

**If `Start-Process -Credential` cannot start the GUI on the hosted runner**, the step falls back to
driving that account's daemon headless from the shared install root (the self-contained,
own-pipe, own-data and terminal proofs still hold), and the verdict records the GUI half as
`unproven` with its reason — reported on every run, exactly as `admin-reminder.reporter.ts` reports
the `skipIfElevated()` gap. It is never recorded as `passed`.

**The coexistence run (FR-031)** is a seventh job, after the matrix: one runner installs the setup
in both scopes, the MSI in both scopes and extracts the archive, then proves every copy launches at its
own version, a second launch of any copy starts no second instance, every copy logs the same data
folder, and reinstalling and then uninstalling one copy leaves the other four installed and
launchable. "Upgrade" here is a same-version reinstall of that copy in place: no earlier release
carries an MSI, so a cross-version upgrade of every format cannot be exercised until the next
release; quickstart records the by-hand upgrade check for this release.

**Rejected.** One runner verifying every combination in sequence (today's shape): with machine-wide
installs in the mix, a residue left by one combination becomes the next combination's starting
state, which FR-028's "each on a clean environment" forbids.

---

## D12 — What the release body tells each reader (FR-033)

**Decision.** The declared set gains an `audience` line per artifact, rendered into the release
body's download table: *setup* — "Most people: installs for you, or for everyone on the machine";
*MSI* — "Administrators deploying with Intune, SCCM or Group Policy"; *portable* — "Run without
installing"; *archive* — "Extract and run anywhere". The unsigned-application warning stays in the
invariant footer, unchanged (020 FR-043).

---

## D13 — Runtime of the release pipeline

The matrix runs its six combinations in parallel, so wall-clock grows by roughly the slowest
combination (machine-wide, with a second account and the in-use step) rather than by six. The
measured figure is recorded in the runbook from the first rehearsal (`release.yml` with
`publish: false`), as the spec's Assumptions require; it is not estimated here.
