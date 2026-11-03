# Feature Specification: Linux Support in Dev Mode

**Feature Branch**: `feature/S062-I23-linux-dev-mode`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: issue [#23](https://github.com/Bidthedog/throng/issues/23) (Linux support).
"Convert this application to be compatible with Linux. Get it working with local development first, then
consider Linux packaging options. Packaging should be a separate issue to handle after it works in dev
mode." Packaging is [#550](https://github.com/Bidthedog/throng/issues/550).

## Background

throng runs on Windows 11 only. The constitution has always kept the door open, and since v6.1.0 Principle
II makes Linux a supported target and requires every feature with per-OS code to deliver both sides. This
feature is the closing work that rule names: no operating-system service has a Linux implementation today.

Observed on Ubuntu 26.04 with GNOME on Wayland, at `992f0635`, 2026-11-02:

| Step | Result |
|---|---|
| Installing dependencies from the lockfile | Works. The native modules build or download for Linux. |
| Building the application | Works. |
| Starting the application shell | **Aborts immediately.** The browser sandbox helper "is not configured correctly" and the runtime refuses to run. |

Nothing past that point has been run, so what follows the abort is known from reading the code, not from
watching it fail:

| Area | Today |
|---|---|
| Talking to the background service | Addressed by Windows-format channel names throughout. |
| Where data lives | The service's database location falls back to a Windows-shaped folder under home. |
| Terminals | Shell discovery knows only Windows shells, and the process model assumes a console host per shell. |
| Elevation | Assumes the Windows administrator model. |
| Paths | Compared case-insensitively everywhere, and Windows drive and UNC forms are assumed in places. |
| File operations | Undoing a delete restores through a Windows-only mechanism. Interface copy says "Recycle Bin". |
| Key bindings | Only Windows defaults exist, and other platforms fall back to them. Several defaults use `Ctrl+Alt`. |
| Process and system facts | Working directory, resource figures, font lists and orphan cleanup use Windows-only mechanisms. |
| Developer tooling | Test clean-up, process checks and several scripts call Windows tools. |
| Continuous integration | Every gating job runs on Windows. |

### What "dev mode" means here

Running throng from a source checkout with the repository's existing commands: install, build, start. No
installed package exists on Linux and none is added here. Everything that only an installed build does is
[#550](https://github.com/Bidthedog/throng/issues/550)'s.

## Clarifications

### Session 2026-11-02

- Q: Is Linux packaging part of this feature? → A: **No.** It is a separate issue, handled after dev mode
  works. Both are in the v1.0.0 milestone. (Maintainer.)
- Q: How should a developer get past the sandbox check that stops Electron starting on Ubuntu? → A: **A one-time,
  scripted and documented machine step: an AppArmor profile that allows only this checkout's Electron to use its
  sandbox.** It covers the checkout's worktrees; a separate clone elsewhere repeats the step. → FR-002. (Maintainer.)
- Q: Should throng run as a native Wayland app on Ubuntu, or through XWayland? → A: **Through XWayland by default for
  now, with native Wayland available as an opt-in setting.** → FR-028, FR-029. (Maintainer.)
- Q: Where should throng keep its settings and data on Linux? → A: **The Linux standard: settings in
  `~/.config/throng`, the database and other data in `~/.local/share/throng`, with `-dev` variants for dev mode.** →
  FR-005, FR-013. (Maintainer.)
- Q: How different should throng's default key bindings be on Linux from Windows? → A: **Keep every Windows default,
  and change only the chords the reference desktop reserves, each listed in the key bindings docs.** → FR-033, FR-034,
  FR-036. (Maintainer.)
- Q: What should throng do when someone starts it as root? → A: **Refuse to start, with a plain message saying to run
  as your normal user and use `sudo` inside a terminal when needed.** → FR-019. (Maintainer.)
- Q: Does Linux dev mode include real Resource Monitor figures? → A: **Yes — build them here.** The Linux half of #499
  is part of this feature; #499 now covers Linux only, and the macOS half is split out to #551 for later. → FR-037.
- Q: What must not be lost, and what should be prepared? → A: **No existing Windows code, test or support is lost,
  and the seams needed for Windows, Linux and macOS are prepared now.** macOS implementations are not built. →
  FR-009, FR-049, FR-050. (Maintainer.)
- Q: How much must run on Linux in CI and the gate? → A: **Every lower layer plus the `@core` E2E lane.** → FR-046.
  (Maintainer.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start throng from source on Linux (Priority: P1)

A developer on a Linux desktop clones the repository, follows the documented steps, and has a throng window
open, without changing their system's security settings.

**Why this priority**: Nothing else can be seen until the window opens, and today it does not.

**Independent Test**: On a clean supported machine, follow only the documented steps. The main window appears
and stays open.

**Acceptance Scenarios**:

1. **Given** a clean supported machine with the documented prerequisites, **When** the developer installs,
   builds and starts throng, **Then** the main window opens with no manual step the documentation does not
   describe.
2. **Given** a prerequisite is missing, **When** the developer starts throng, **Then** they are told which one
   and what to do, not left with a raw crash.
3. **Given** throng started once, **When** the developer starts it again, **Then** it reaches the same state
   with no leftover-state error.

---

### User Story 2 - Use real terminals (Priority: P1)

The developer opens terminal panels running the shells installed on their machine, and those terminals keep
running when the window closes, as they do on Windows.

**Why this priority**: Terminals are the product. Principle III (detached, persistent terminals) and Principle
IV (native shells, auto-detected) are what throng is for.

**Independent Test**: Open a terminal, run a long-lived full-screen program, close the window, reopen it. The
program is still running and its screen is intact.

**Acceptance Scenarios**:

1. **Given** bash is installed, **When** the developer adds a terminal, **Then** the shell choices list the
   shells actually installed, with the user's login shell as the default.
2. **Given** a running terminal, **When** the developer types, resizes the panel and runs a full-screen program,
   **Then** input, wrapping and redraw behave as they do on Windows.
3. **Given** a running terminal, **When** the window closes and reopens, **Then** the terminal reattaches with
   its process and scrollback intact.
4. **Given** the background service was stopped or crashed, **When** throng starts, **Then** nothing is left
   running that the user cannot see or stop, and the failure is reported as it is on Windows.
5. **Given** a terminal whose shell changed directory, **When** a feature needs that directory, **Then** it gets
   the shell's actual current directory.

---

### User Story 3 - Work on projects: editors, explorer, search, layout (Priority: P1)

The developer manages projects, edits files, moves them around and searches them, with their layout and data
surviving a restart.

**Why this priority**: With terminals, this is the daily work. It is also where Windows assumptions can damage
a user's files rather than merely fail.

**Independent Test**: In a project containing `README.md` and `readme.md`, open both, edit each, save, restart.
Each file keeps its own content and tab.

**Acceptance Scenarios**:

1. **Given** two files whose names differ only by case, **When** the developer opens, edits, renames or moves
   either, **Then** throng treats them as two files and never acts on the wrong one.
2. **Given** a file with execute permission, **When** throng saves, moves or copies it, **Then** the permission
   survives.
3. **Given** a file or folder is deleted in the explorer, **When** the developer looks in the desktop's trash,
   **Then** it is there, and undoing the delete restores it. The interface uses the platform's word for the
   trash.
4. **Given** a saved layout and project list, **When** throng restarts, **Then** they return as they were.
5. **Given** a path printed in a terminal in Linux form, including `~/…`, **When** the developer follows the link,
   **Then** it opens.

---

### User Story 4 - Windows, focus and key bindings that fit the desktop (Priority: P2)

The custom title bar, torn-off windows and default key bindings all work on the Linux desktop, and a default
binding the desktop intercepts is not silently dead.

**Why this priority**: Everything is reachable without this by menu, but it is what makes daily use comfortable.

**Independent Test**: On the reference desktop, drag, maximise, minimise and close the window from the title bar,
tear a panel off into a new window, and walk the key bindings list checking each default fires or is flagged.

**Acceptance Scenarios**:

1. **Given** the main window, **When** the developer uses the title bar, **Then** drag, maximise, minimise and
   close work.
2. **Given** a panel, **When** it is torn off and dragged back under the default XWayland mode, **Then** the
   sub-workspace behaves as on Windows. Under opt-in native Wayland, where the desktop refuses a window's own
   positioning, the window still opens usable and nothing is lost.
3. **Given** a default binding the reference desktop reserves, **When** throng ships its Linux defaults, **Then**
   that action has a default that reaches throng.
4. **Given** a binding a user's own desktop has taken, **When** the user opens Key Bindings, **Then** they can
   rebind it as on any other platform.

---

### User Story 5 - Develop throng itself on Linux (Priority: P2)

A contributor runs the repository's checks and tooling from Linux and gets true results.

**Why this priority**: Without it, Linux support regresses the first time someone changes the code on Windows,
and Linux contributors cannot verify their own work.

**Independent Test**: On a Linux checkout, run each test layer in scope and each developer script. Each one runs
and reports honestly, with none failing because a Windows tool is absent.

**Acceptance Scenarios**:

1. **Given** a Linux checkout, **When** a contributor runs a test layer, **Then** every test runs, or is skipped
   with a stated reason because it covers Windows-only behaviour.
2. **Given** a test run ends or is interrupted, **When** the contributor checks, **Then** no application, service
   or shell process it started is left running.
3. **Given** a change that breaks Linux, **When** it is proposed, **Then** the automated checks show it, to the
   extent FR-046 sets.

---

### User Story 6 - Windows stays exactly as it is (Priority: P1)

A Windows user notices no change from this work.

**Why this priority**: Windows is the shipped product. This feature adds a platform; it does not trade one.

**Independent Test**: The gate passes on Windows at the feature's final commit, and existing Windows data opens
unchanged.

**Acceptance Scenarios**:

1. **Given** an existing Windows install's data and settings, **When** a build with this feature runs, **Then**
   nothing migrates, moves or changes meaning.
2. **Given** Windows paths that differ only by case, **When** throng compares them, **Then** they still count as
   the same path.

---

### User Story 7 - See what throng is using on Linux (Priority: P3)

The developer reads throng's CPU, memory and I/O per process in the status bar and the Resource Monitor, as on
Windows.

**Why this priority**: It is useful but nothing else depends on it, so it can land after the daily work.

**Independent Test**: Open the Resource Monitor while a terminal runs a known CPU-heavy program. Its figures agree
with the system's own tools, and any figure Linux cannot supply shows as unavailable with its reason.

**Acceptance Scenarios**:

1. **Given** throng is running, **When** the developer opens the Resource Monitor, **Then** each throng process and
   terminal is listed with live CPU, memory and I/O figures.
2. **Given** a metric the machine cannot supply, **When** it is displayed, **Then** it reads as unavailable with its
   reason, never zero.
3. **Given** a process listed in the monitor, **When** the developer ends it from there, **Then** that process ends and
   no other does.

### Edge Cases

- **A name legal on Linux but not Windows.** A filename containing `\`, `:`, `?`, a trailing dot or a trailing
  space is one ordinary file. A `\` in a name is never read as a path separator.
- **Non-UTF-8 filenames.** Linux names are bytes. One that is not valid text still lists, opens and deletes, or
  is reported per item, and is never silently renamed.
- **Symlinks.** A symlinked file or project root opens. A symlink cycle does not hang the explorer or search.
  Deleting a symlink removes the link, not its target.
- **Dotfiles.** Hidden means what it means on Linux, and exclusion rules apply as configured.
- **File-watch limits.** On a project larger than the system's watch limit, the user is told the explorer may
  miss changes and how to raise the limit, rather than the watcher failing silently.
- **Long checkout paths.** A deep worktree path must not break the connection to the background service, whose
  address length the platform limits.
- **Stale service address after a crash.** A previous crash leaves nothing that stops the next start.
- **Another user on the same machine.** No other local user can connect to the background service or read its
  database.
- **Running as root.** throng refuses to start and says why (FR-019). `sudo` run by the user inside a terminal is
  unaffected.
- **A permission error on a project folder.** Reported per item through the existing failure model, with the
  operating system's meaning in plain words.
- **Trash unavailable.** On a filesystem with no usable trash, deleting asks before it deletes permanently.
- **A program that ignores polite termination.** Closing a terminal still ends its process and children, as
  "no orphans" requires on Windows.
- **A shell listed as installed but no longer present.** A terminal saved with it reports that, not a raw error.
- **Windows-form settings.** A settings file or project list carried over from Windows, naming `C:\…` paths, is
  reported as unavailable per item and is never rewritten or dropped silently.

## Requirements *(mandatory)*

### Functional Requirements

**Starting**

- **FR-001**: throng MUST install, build and start from a source checkout on the reference platform using the
  repository's existing commands.
- **FR-002**: Starting MUST NOT require the developer to weaken a system-wide security setting. Where the machine
  restricts Electron's sandbox, one scripted step MUST install an AppArmor profile that applies only to this checkout's
  Electron, including its worktrees, and is documented with what it does, why, and how to remove it. It MUST NOT limit
  which folders throng can open as projects. Starting without the profile MUST say which step to run (FR-004).
- **FR-003**: The browser sandbox MUST remain enabled. Disabling it is not an acceptable way to satisfy FR-001.
- **FR-004**: A missing prerequisite or an unsupported environment MUST be reported as a plain statement of what is
  wrong and what to do, through the existing failure model.
- **FR-005**: Dev-mode data MUST stay separate from installed-build data, as it does on Windows, so #550 can add
  installed builds without a migration.

**Platform services**

- **FR-006**: Every operating-system service throng uses MUST have a Linux implementation behind the existing
  platform-neutral interfaces, passing the same shared contract suite as the Windows one wherever that suite exists
  (Principle II, Principle IX).
- **FR-007**: The running platform MUST select the implementations once, at startup. Core logic MUST NOT gain
  operating-system branches.
- **FR-008**: Where a Windows concept has no Linux counterpart (console hosts, integrity levels, foreground
  hand-off, taskbar overlay), the interface MUST express the capability as absent. Code outside the implementation
  MUST NOT hold Linux or Windows knowledge about it.
- **FR-009**: The shipped behaviour on Windows MUST NOT change, and no Windows code, test or capability may be removed
  or weakened to make Linux work. Windows code may move or be restructured only if its behaviour and its tests' assertions
  stay the same. Every requirement here that differs by platform applies to Linux only.

**Background service**

- **FR-010**: The background service and its terminal host MUST run and survive the window closing, as Principle
  III requires.
- **FR-011**: The channel to the background service MUST be reachable only by the same user, MUST NOT be defeated
  by a stale address from a crash, and MUST work from any supported checkout depth.
- **FR-012**: The rules that keep one instance per data folder, and that keep dev, test and worktree instances from
  colliding, MUST hold on Linux.
- **FR-013**: Settings MUST live in `~/.config/throng` and the database and other data in `~/.local/share/throng`,
  with `-dev` variants of both in dev mode. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` MUST move those bases when set, and
  throng's own environment overrides MUST work as they do on Windows and take precedence. Files holding user data MUST
  be readable only by their owner.

**Terminals**

- **FR-014**: Shell detection MUST find the shells installed on the machine, and default to the user's login shell.
  At minimum: bash, zsh, fish and POSIX sh, where installed.
- **FR-015**: Terminal features that work on Windows MUST work with those shells: startup commands, shell arguments,
  history and command memory, title templates, links, attention marks, find and scrollback.
- **FR-016**: Features specific to a Windows shell MUST NOT appear for a shell they do not apply to.
- **FR-017**: A shell's current directory MUST be read from the operating system.
- **FR-018**: Closing a terminal, quitting and clean-up of orphans MUST end the terminal's whole process tree, and
  MUST NOT touch any process throng did not start.
- **FR-019**: Started as root, throng MUST refuse to start and say to run as the normal user and use `sudo` inside a
  terminal when needed. It MUST NOT start terminals with privileges other than the user's, and elevation controls
  MUST NOT be offered on Linux.

**Paths and files**

- **FR-020**: Path comparison and identity MUST follow the platform: case-sensitive on Linux, unchanged on Windows.
  This covers open tabs, the explorer, recents, undo history, layout references, links and instance identity.
- **FR-021**: `\` MUST be an ordinary filename character on Linux, and Windows drive and UNC handling MUST NOT
  misread a Linux path.
- **FR-022**: Terminal and editor links MUST resolve Linux absolute, relative and `~/` paths.
- **FR-023**: Saving, moving and copying MUST preserve permissions, and atomic saves MUST NOT turn a symlink into a
  regular file.
- **FR-024**: Delete MUST use the desktop's trash, and undoing a delete MUST restore the item, including its original
  location. If trash is unavailable, the user MUST be asked before a permanent delete.
- **FR-025**: User-visible copy naming the Recycle Bin MUST use the platform's term on Linux. This extends 050
  FR-018f's setting label; the setting's meaning does not change.
- **FR-026**: The existing default line-ending setting and the handling of existing files MUST NOT change. The Copy Path
  submenu (023 FR-031) MUST offer forms that make sense on Linux.
- **FR-027**: Reveal in file manager and open with default application MUST use the desktop's handlers.

**Windows and desktop**

- **FR-028**: throng MUST run through XWayland by default on a Wayland desktop, and native Wayland MUST be available as
  an opt-in setting. The custom title bar (007 FR-002, FR-004) MUST work in both.
- **FR-029**: Under XWayland, tear-off windows, sub-workspaces, the drag ghost, saved window geometry and focus changes
  MUST behave as on Windows. Under opt-in native Wayland they MUST degrade without losing a window, its content or its
  layout where the protocol refuses, and the degradations MUST be listed in the docs. Only XWayland is verified on the
  reference platform; native Wayland is verified to start and to lose nothing.
- **FR-030**: Clipboard and drag-and-drop MUST work on Linux as they do on Windows. Cutting, copying and dragging files
  between throng and the OS file manager is [#8](https://github.com/Bidthedog/throng/issues/8) and stays out of scope.
- **FR-031**: Font lists MUST come from the fonts installed on the machine, and default fonts MUST exist on the
  reference platform or fall back cleanly.
- **FR-032**: The application icon and window identity MUST appear correctly in the desktop's window switcher in dev
  mode, as far as dev mode allows.

**Key bindings**

- **FR-033**: Linux MUST have its own shipped default bindings. The fallback to Windows defaults MUST stop being how
  Linux gets its bindings.
- **FR-034**: Each Linux default MUST equal its Windows default unless the reference desktop reserves that chord. A
  reserved chord MUST be given a different Linux default, and no other default may differ. The change MUST NOT alter
  Windows defaults.
- **FR-034a** *(manual test, 2026-11-03; amends FR-034)*: A chord is the same on every platform wherever it can be. A chord
  a desktop reserves MAY stay the default where the keypad still reaches it, which is how the four focus moves work on
  Linux. `view.resourceMonitor` moves to `Ctrl+Shift+Alt+Y` on Windows as well as Linux, through the guarded upgrade, so
  an install that kept the old default moves and a customised one does not.
- **FR-035**: The terminal's reserved-chord tiers and the handling of `AltGr`, which on Windows arrives as `Ctrl+Alt`,
  MUST be correct for Linux keyboards.
- **FR-036**: Key bindings docs MUST state each platform's defaults and list every chord that differs on Linux, and
  `docs-currency.test.ts` MUST keep passing.

**Resource Monitor**

- **FR-037**: The status bar and Resource Monitor MUST show real per-process CPU, memory and I/O figures on Linux, with
  GPU where the platform exposes it, through the seam 055 FR-010 defines (#499).
- **FR-038**: The resource collector MUST start on Linux without error, and any figure it cannot read MUST be shown as
  unavailable with its reason (055 FR-011, FR-107), never as zero.

**Developer tooling and tests**

- **FR-039**: Every developer script the repository documents MUST run on Linux or say clearly that it is Windows-only.
  Clean-up of leftover processes MUST work on Linux.
- **FR-040**: The worktree preparation and teardown manifest MUST work on Linux and on Windows.
- **FR-041**: Spec Kit's feature workflow MUST be usable from a Linux checkout, with no PowerShell assumed. Its bash scripts,
  in since `4639d61c`, meet this.
- **FR-042**: Tests that assert Windows behaviour MUST run only on Windows, and each such skip MUST state its reason.
  Tests of platform-neutral behaviour MUST NOT be skipped on Linux to make a run pass.
- **FR-043**: Tests MUST NOT depend on a Windows shell, path form or tool unless they are testing that.
- **FR-044**: Each new Linux implementation MUST pass the shared contract suite, or gain one if none exists.
- **FR-045**: Unit, component, integration and contract layers MUST pass on the reference platform.
- **FR-046**: Unit, component, integration, contract, the `@core` E2E lane and a Linux-only E2E suite tagged `@linux` MUST run
  on Linux in pull-request CI and in the gate, and a failure there MUST fail the run. The Windows lanes MUST keep running
  unchanged. (Maintainer, 2026-11-02: "a Linux specific suite of tests and ci".)

**Documentation**

- **FR-047**: `docs/installation.md` MUST carry Linux source-build prerequisites and steps, `README.md`,
  `docs/quick-start.md` and `CONTRIBUTING.md` MUST stop saying Windows-only and state accurately what Linux supports,
  and `docs/architecture.md` MUST describe the Linux implementations. The docs MUST say that Linux has no installer yet.
- **FR-048**: Docs MUST list known platform differences and degradations in one place.

**Seams for all three platforms**

- **FR-049**: Every seam this feature adds or changes MUST be defined so Windows, Linux and macOS can each supply an
  implementation without changing core logic or the code that uses the seam. Each new seam MUST have a shared contract
  suite written in terms of behaviour, not of one platform's spellings.
- **FR-050**: macOS implementations MUST NOT be built here. Selecting implementations on an unimplemented platform MUST
  report that the platform is unsupported rather than silently using another platform's implementation.

### Out of Scope

- **Linux packaging, installers, auto-update, desktop entries and the release pipeline**:
  [#550](https://github.com/Bidthedog/throng/issues/550).
- **macOS implementations** ([#22](https://github.com/Bidthedog/throng/issues/22), and
  [#551](https://github.com/Bidthedog/throng/issues/551) for its Resource Monitor). The seams they will need are in scope
  (FR-049).
- **WSL support** ([#13](https://github.com/Bidthedog/throng/issues/13)).
- **Distributions beyond the reference platform** as a supported target. Nothing may deliberately exclude them.
- **New terminal features for Linux** that Windows does not have.

### Supersessions

- **055 FR-056's chord**: `Ctrl+Shift+Alt+R` becomes `Ctrl+Shift+Alt+Y` by FR-034a, because GNOME reserves R and the
  maintainer wants one chord across platforms. FR-034's "MUST NOT alter Windows defaults" gives way for this one row.
- **The key bindings fallback in `packages/core/src/config/keybindings.ts`**: shipped defaults on an unpopulated platform
  falling back to Windows, a stopgap by its own description, is replaced for Linux by FR-033.
- **055 Assumptions, "Windows only in this feature"**: superseded for Linux by FR-037. 055 FR-010 and FR-011 stand and are
  what this feature builds on.
- **020 FR-038's clause** "the only platform on which throng currently runs" stops being true of dev mode. The
  requirement it carries, a Windows installer, is unchanged. #550 owns any change to packaging requirements.
- **The v1.0.0 exclusion of Linux** was removed from the milestone at the maintainer's direction on 2026-11-02.

### Key Entities

- **Reference platform**: the one environment this feature is verified on: Ubuntu 26.04 LTS, GNOME on Wayland with throng running
  through XWayland, x86-64.
- **Platform implementation set**: the Linux services bound at startup, one per existing platform-neutral interface.
- **Platform capability**: whether a concept exists on this platform, so that the interface can report it as absent.
- **Linux default bindings**: shipped defaults for Linux, separate from Windows, with the same action ids.
- **Known differences list**: the documented places Linux differs from Windows, and why.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer on a clean reference machine goes from clone to an open throng window in under 15 minutes
  using only the documentation, without changing a system-wide security setting.
- **SC-002**: A long-running full-screen terminal program survives 20 consecutive window close-and-reopen cycles with
  its process and screen intact.
- **SC-003**: After 20 cycles of opening terminals, closing them and quitting the application, no process started by
  throng remains that the user did not ask to keep.
- **SC-004**: In a project with files differing only by case, 100% of open, edit, rename, move, delete and undo actions
  act on the file the user chose.
- **SC-005**: Every action in the key bindings list either fires on the reference desktop with its default binding, or
  has been given a different Linux default. None is silently dead.
- **SC-006**: On the reference platform, with 10 terminals running, a character typed in the visible terminal appears
  with no perceptible delay (under 100 ms).
- **SC-007**: Windows: the gate passes at the final commit, no Windows test is removed, and none changes what it asserts
  about Windows behaviour.
- **SC-008**: Unit, component, integration, contract and `@core` E2E pass on Linux in CI with zero unexplained skips.
- **SC-010**: Resource Monitor CPU and memory figures on the reference platform agree with the system's own tools within
  the monitor's accuracy bar (055 FR-012).
- **SC-011**: A macOS implementation of any seam this feature adds could be written without changing core logic or the
  shared contract suite, shown by review of each seam.
- **SC-009**: Every user-facing feature in `docs/quick-start.md` works on the reference platform, or appears in the known
  differences list.

## Assumptions

- **The reference platform is the maintainer's machine**: Ubuntu 26.04 LTS, GNOME on Wayland, x86-64. Other desktops,
  other distributions and arm64 are not verified, but nothing may deliberately exclude them.
- **The toolchain stays**: the repository's existing Node and Electron requirements. C and C++ build tools are a stated
  Linux prerequisite if a native module has no prebuilt binary.
- **The Linux platform services are a new implementation alongside the Windows ones.** Their exact shape is the plan's
  decision.
- **Windows-only features are absent rather than emulated.** Where Linux has an equivalent, the feature works; where it
  has none, the control does not appear.
- **E2E needs real windows**, by the repository's no-headless rule. How that applies on a Linux CI runner is the plan's
  decision.
- **This branch stays spec-only until planned.** Issues #23 and #499 are claimed on this branch; #550 is blocked by #23.
