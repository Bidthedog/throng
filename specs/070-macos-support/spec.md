# Feature Specification: macOS Support

**Feature Branch**: `feature/S070-I22-macos-support`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: issues [#22](https://github.com/Bidthedog/throng/issues/22) (macOS support: macOS platform
implementations behind the existing OS seams, plus macOS builds) and
[#551](https://github.com/Bidthedog/throng/issues/551) (Resource Monitor on macOS). "Let's move macOS support into
v1.0.0. … I say we run this on best endeavours, and hope the community reports issues. As long as the CI can spin the
app up and run E2E tests against a mac build, that's enough for now." (Maintainer, 2026-11-15.)

## Background

throng runs on Windows 11 and Linux. Principle II has kept every seam able to take a macOS implementation, and spec 062
FR-049 prepared the seams, but nothing implements them for macOS. Today, selecting implementations on macOS reports the
platform as unsupported (062 FR-050), so throng does not start there.

### What "best endeavours" means here

The project has no macOS hardware and will not buy any. Nobody tests throng by hand on a Mac.

- **Automated proof is the bar.** On hosted macOS machines in CI, throng is built, started, and put through the
  automated suites, end-to-end tests included. When those pass, macOS is done for this feature.
- **No manual test plan is written for macOS behaviour.** How it looks, how it feels, the Cmd chords in daily use, the
  menu bar and Finder integration are left to community bug reports.
- **The docs say this plainly** wherever macOS is offered, so no user mistakes it for the Windows and Linux level of
  support.

### Reference environment

Hosted CI machines on Apple silicon, running the current and previous macOS releases (27 and 26 in November 2026).
Everything runs on both. Intel Macs are not supported.

## Clarifications

### Session 2026-11-15

- Q: Is macOS in v1.0.0? → A: **Yes.** #22 and #551 joined the milestone, and the milestone's macOS exclusion was
  removed. (Maintainer.)
- Q: How is macOS verified without a Mac? → A: **On hosted macOS CI machines only.** CI builds the app, starts it and
  runs E2E against that build. Nobody tests by hand on a Mac, and community reports cover the rest. (Maintainer.)
- Q: Are macOS builds signed and notarised? → A: **No.** Code signing (#118) is not in v1.0.0, so users get past
  Gatekeeper once with **Open Anyway**, and the docs describe that step. (Maintainer.)
- Q: How should later features treat macOS under Principle II? → A: **Ship all three.** A feature with per-OS code
  ships its Windows, Linux and macOS implementations together, with macOS proved by CI only. → FR-002. (Maintainer.)
- Q: What should macOS's default key bindings be? → A: **Cmd for every application chord** that uses Ctrl elsewhere.
  Terminals keep receiving Ctrl chords, and chords macOS reserves get different defaults, listed in the docs. → FR-029.
  (Maintainer.)
- Q: What happens to a release when a macOS copy fails its pre-release check? → A: **The whole release is blocked
  until it is fixed**, as for Windows and Linux. → FR-010. (Maintainer.)
- Q: Which macOS versions and chips does throng support? → A: **The current and previous macOS releases, on Apple
  silicon only, both tested in CI. No Intel build.** The range moves forward with each macOS release, by bumping one
  runner label a year. → FR-003, FR-006, FR-036, FR-037. (Maintainer, choosing the least maintenance after weighing
  Intel's shrinking share.)
- Q: What happens when throng is opened without being moved to Applications? → A: **One notice saying to quit, drag
  it to Applications and reopen. Nothing else starts.** → FR-007. (Maintainer.)
- Q: How do Mac users get the `throng` command? → A: **An in-app Install 'throng' command action**, like VS Code's,
  which may ask for an administrator password. → FR-024a. (Maintainer.)
- Q: Should macOS CI enforce the typing-latency bar Linux has? → A: **Yes.** With 10 terminals running, typing latency
  in the visible terminal over 100 ms at the 95th percentile fails the run. → FR-050, SC-012. (Maintainer.)
- Q: What happens when the last window closes on macOS? → A: **throng stays in the Dock**, and Cmd+Q runs the usual quit
  flow. → FR-028. (Maintainer.)
- Q: How do Mac users open a folder as a project from Finder? → A: **Drop it on the Dock icon, or use Open With. No
  right-click entry**, because CI cannot exercise one. → FR-024. (Maintainer.)
- The maintainer directed that this spec also cover the macOS builds, binaries and CI/CD steps. → User Story 8, FR-042
  to FR-049.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download, open and start working on a Mac (Priority: P1)

A Mac user downloads throng from the release page, drags it into Applications and opens it. macOS blocks the first
launch because the app is not notarised. Following the installation docs, they allow it once in System Settings, and
throng opens to its first-run state.

**Why this priority**: Every other story depends on this one. A macOS build nobody can open is not macOS support.

**Independent Test**: In CI, build the macOS app, copy it to the Applications folder of a clean hosted machine, launch
it, and confirm the window opens and reports the expected version.

**Acceptance Scenarios**:

1. **Given** a Mac on Apple silicon, **When** the user opens the downloaded image and drags throng to Applications,
   **Then** throng is installed with no other step and no administrator prompt.
2. **Given** a first launch blocked by Gatekeeper, **When** the user follows the installation docs, **Then** throng
   opens, and later launches are not blocked.
3. **Given** an Intel Mac, **When** the user reads the installation docs or the release page, **Then** they are told
   plainly that Intel Macs are not supported.
4. **Given** throng running, **When** the user opens About, **Then** it shows the same version as the downloaded file.

---

### User Story 2 - Real terminals that survive the window (Priority: P1)

A Mac user opens terminals in a project. Their login shell starts with their own environment, including tools installed
through a package manager. They close the window or quit throng, reopen it, and the terminals are still running, as they
are on Windows and Linux.

**Why this priority**: Terminals that outlive the window are throng's core promise (Principle III).

**Independent Test**: E2E on a hosted macOS machine: open a terminal, start a long-running program, quit and relaunch,
and confirm the program and its screen are intact.

**Acceptance Scenarios**:

1. **Given** a user whose login shell is zsh, **When** they open a terminal, **Then** zsh starts with the environment
   their login session would give it.
2. **Given** throng started from the Dock or Finder, **When** a terminal runs a tool on the user's own path, **Then**
   it is found.
3. **Given** a running full-screen program, **When** the user quits throng and starts it again, **Then** the program
   and its screen are intact.
4. **Given** terminals open, **When** the user closes a terminal or tells throng to end them, **Then** the whole process
   tree ends.

---

### User Story 3 - Projects, editors, explorer and search (Priority: P1)

A Mac user opens a project folder, edits files, moves and deletes files in the explorer, undoes a delete, searches
across files, and copies or drags files to and from Finder.

**Why this priority**: These are the everyday features the Windows and Linux quick-start covers.

**Independent Test**: The existing E2E suites for editors, the explorer and search pass on a hosted macOS machine.

**Acceptance Scenarios**:

1. **Given** a project on the default macOS volume, **When** the user renames `readme.md` to `README.md`, **Then** the
   file is renamed and every view shows the new name.
2. **Given** a deleted file, **When** the user undoes the delete, **Then** the file comes back from the macOS Trash to
   where it was.
3. **Given** files in Finder, **When** the user copies them and pastes into the explorer, or drags them in, **Then**
   they are copied into the project. The reverse direction works too.
4. **Given** a file the user has open, **When** they choose to reveal it or open it with its default application,
   **Then** Finder or the registered application handles it.

---

### User Story 4 - The app behaves like a Mac app (Priority: P2)

The window carries the standard macOS window controls. The menu bar has an application menu with About, Settings,
Hide and Quit. Commands use the macOS modifier conventions, and closing the last window leaves throng running in the
Dock.

**Why this priority**: Without this throng works but feels foreign. CI can prove that controls, menus and chords exist
and fire, but not how they feel, which is left to community reports.

**Independent Test**: macOS-only E2E: the application menu items exist and run, the window controls work, and every
default binding fires its action.

**Acceptance Scenarios**:

1. **Given** throng running, **When** the user presses the platform's quit chord, **Then** throng quits under the same
   rules as quitting on other platforms (closing progress, terminals kept).
2. **Given** throng running, **When** the user opens the application menu, **Then** About, Settings (opening
   Preferences), Hide, Hide Others and Quit are there and work.
3. **Given** the default bindings, **When** each action's chord is pressed, **Then** the action fires, except where
   the binding is documented as differing on macOS. No action is left without a working chord.
4. **Given** a terminal with focus, **When** the user presses a chord the shell needs, **Then** the shell receives it.

---

### User Story 5 - See what throng is using on a Mac (Priority: P2)

The status bar and the Resource Monitor show throng's CPU, memory and I/O per process on macOS. GPU figures appear
where macOS exposes them, and "unavailable", with the reason, where it does not. The daemon and lock manager lists
throng's processes and what they hold. (#551.)

**Why this priority**: The Resource Monitor (#5) and lock manager (#133) are v1.0.0 features. On macOS they would
otherwise show nothing.

**Independent Test**: The macOS process-metrics implementation passes the shared process-metrics contract on a hosted
macOS machine. Its CPU and memory figures for a known process agree with the system's own tools within the monitor's
accuracy bar.

**Acceptance Scenarios**:

1. **Given** throng running with terminals open, **When** the user opens the Resource Monitor, **Then** every throng
   process is listed with CPU, memory and I/O figures.
2. **Given** a figure macOS does not expose, **When** it is shown, **Then** it reads "unavailable" with the reason. It
   is never blank and never zero.

---

### User Story 6 - Every change is proved on macOS before it merges (Priority: P1)

A contributor opens a pull request. CI runs the unit, component, integration and contract layers and the end-to-end
lanes on a hosted macOS machine, against a build made on that machine. A failure there fails the PR.

**Why this priority**: CI is the only proof this project has on macOS. Without it, macOS support decays with every
change.

**Independent Test**: Push a branch that breaks a macOS-only implementation and confirm the macOS job fails the PR.

**Acceptance Scenarios**:

1. **Given** a ready pull request, **When** CI runs, **Then** the macOS jobs run alongside the Windows and Linux ones,
   and their failure fails the run.
2. **Given** the gate is dispatched, **When** it runs, **Then** it includes a macOS lane with the same stages.
3. **Given** a release, **When** the pipeline builds the macOS copies, **Then** each is checked on its own clean hosted
   machine before publication, and every step a hosted machine cannot exercise is recorded as unproven with its reason.

---

### User Story 7 - Windows and Linux stay exactly as they are (Priority: P1)

Users on Windows and Linux see no change in behaviour, and no test there is removed or weakened.

**Why this priority**: A third platform must not cost the two that are fully supported.

**Independent Test**: The Windows and Linux gate lanes pass at the final commit with no test removed and none changed in
what it asserts about those platforms.

**Acceptance Scenarios**:

1. **Given** the final commit, **When** the gate runs, **Then** the Windows and Linux lanes pass unchanged.

---

### User Story 8 - Every release ships working macOS downloads (Priority: P1)

The maintainer tags a release. The unattended pipeline builds the macOS copies on a hosted Apple silicon machine,
including every native component and the bundled runtime, checks each copy on each supported macOS release, and
publishes it beside the Windows and Linux artifacts with checksums. The release notes offer it with the support
statement. The maintainer does nothing macOS-specific.

**Why this priority**: Without a build in the release, macOS users have nothing to download. The project has no Mac,
so the pipeline must do the whole job.

**Independent Test**: Dispatch the release pipeline against a test tag and confirm the macOS artifacts are built,
checked on both supported releases, listed with checksums, and that a deliberately broken macOS copy blocks
publication.

**Acceptance Scenarios**:

1. **Given** a release tag, **When** the pipeline runs, **Then** it produces the macOS artifacts with no step done by
   hand.
2. **Given** the artifacts are built, **When** they are inspected, **Then** every executable and native library in them
   is an Apple silicon binary that macOS will run.
3. **Given** a published release, **When** a user reads its notes, **Then** the macOS
   download is offered with the support level, the supported releases rule and the first-launch step.

---

### Edge Cases

- **App Translocation**: the user opens throng straight from the disk image or Downloads, without moving it to
  Applications. macOS runs the quarantined app from a random read-only location. throng must still start its
  background service and terminals. throng shows one notice telling the user to move it to Applications, and starts
  nothing else (FR-007).
- **A case-sensitive volume**: APFS is case-insensitive by default, but a user may create a case-sensitive volume.
  Path identity follows the volume holding the path.
- **Unicode normalisation**: a filename with accents may come back from the file system in a different Unicode form
  from the one the user typed. The same file must not appear twice, and opening it must not fail.
- **Socket path length**: macOS limits local socket paths to about 104 bytes, and long home-folder paths go over it.
  The channel to the background service must still be reachable.
- **Started from the Dock**: an app launched from Finder or the Dock does not inherit the user's shell path. Terminals
  still get the user's login environment.
- **Last window closed**: throng stays running in the Dock. Reopening from the Dock restores the window. The background
  service and terminals keep running either way.
- **An Intel Mac**: macOS itself refuses to open the Apple silicon app. The docs and release page say so before the
  user downloads it.
- **Running as root**: refuse to start, as on Linux (062 FR-019).
- **Full Disk Access and privacy prompts**: macOS asks before an app reads Desktop, Documents, Downloads or removable
  volumes. A denied prompt must surface as one plain notice naming the folder, never as a silent empty tree.
- **Upgrading while running**: the user replaces the app in Applications while it runs. The running copy keeps working
  until restarted, and tells the user the installed version has changed (063 FR-009, FR-010).
- **No GPU figures**: where macOS exposes no per-process GPU use, the figure is "unavailable" with the reason.
- **Option key in a terminal**: the default must let a user type characters that need Option, such as `#` or `€` on
  many layouts.

## Requirements *(mandatory)*

### Functional Requirements

**Support level and governance**

- **FR-001**: macOS MUST be a supported platform at a **best-endeavours** level: verified only by automated suites on
  hosted macOS CI machines, with no manual test pass on a Mac. That level MUST be stated in `docs/install-macos.md` (the
  macOS guide `docs/installation.md` links to, as it links the Windows and Linux guides), `README.md` and the release body wherever macOS downloads are offered.
- **FR-002**: Principle II MUST be amended so that macOS is a supported target and a feature that needs distinct
  per-OS code ships its Windows, Linux and macOS implementations together, each passing the same shared contract. The
  macOS side is proved by CI on hosted macOS machines only, and no feature MAY require a manual test on a Mac. The
  amendment MUST argue its version bump against the constitution's own test.

**Builds and installation**

- **FR-003**: Each release MUST produce a macOS disk image and archive for Apple silicon, with the product version and
  architecture in each filename. No Intel copy is produced.
- **FR-003a**: The supported macOS releases MUST be the current and the previous one, on Apple silicon. The docs MUST
  state this as a rule rather than as a list of version numbers, and MUST say that older releases may work but are not
  supported and that Intel Macs are not supported.
- **FR-004**: Each macOS copy MUST be self-contained (020 FR-009). Every runtime, native component and bundled helper
  throng needs is inside the app, and every executable in it MUST run on its architecture without the user signing,
  compiling or downloading anything.
- **FR-005**: Installing MUST be dragging the app into Applications, with no installer and no administrator rights.
  Nothing MAY be written inside the app at runtime (020 FR-008). Removing the app from Applications MUST remove
  everything installed, and `docs/install-macos.md` MUST name the folders that hold user data.
- **FR-006**: Builds are not signed with a developer identity and not notarised. `docs/install-macos.md` MUST give the
  exact steps to open throng the first time on each supported macOS release (FR-003a), and say why they are needed.
- **FR-007**: When throng is run from a translocated location, it MUST show one notice saying to quit, drag throng to
  Applications and open it again, and MUST start nothing else: no background service, no terminal host and no project.
  Quitting from the notice MUST leave no throng process running.
- **FR-008**: Upgrading MUST be replacing the app. The running copy MUST keep working until it is restarted, and MUST
  raise the installed-version-changed notice (063 FR-010) when the installed copy no longer matches it. An upgrade MUST
  keep all per-user data. Automatic background updating is not offered on macOS, because it needs signed builds.
- **FR-009**: The macOS copies MUST join the declared artifact set (042), with checksums, the publish gate and the
  release body covering them under the same conditions as the Windows and Linux artifacts.
- **FR-010**: Each macOS copy MUST be checked on a clean hosted machine for each supported macOS release before
  publication: install, launch, version match, self-containment, a core journey, reattach, checksum, removal and residue
  scan (063 FR-017). Steps a hosted machine cannot exercise, such as the Gatekeeper first-launch block, MUST be recorded as `unproven` with their reason and listed in the release body (063 FR-018). Which steps may
  be unproven MUST be named. A step that fails, as opposed to one that is unproven, MUST block publication of the whole
  release, as a failed Windows or Linux check does.

**Platform implementations**

- **FR-011**: Every operating-system service throng uses MUST have a macOS implementation behind the existing seams,
  bound once at startup (062 FR-007). Core logic MUST NOT change to admit them.
- **FR-012**: Each macOS implementation MUST pass the shared contract suite for its seam on a hosted macOS machine, or
  gain one if none exists (062 FR-044).
- **FR-013**: Where a concept has no macOS counterpart, the seam MUST report it as absent and its control MUST NOT
  appear. Each such absence MUST be listed in the known platform differences (062 FR-048).
- **FR-014**: Settings and data MUST live in the macOS per-user application-support location, logs in the per-user
  logs location, with `-dev` variants for dev mode (062 FR-005). Dev, test and worktree isolation MUST hold as on the
  other platforms.

**Background service and terminals**

- **FR-015**: The background service and terminal host MUST run, survive the window closing and throng quitting, and
  reattach on the next start, as on the other platforms (Principle III).
- **FR-016**: The channel to the background service MUST be reachable only by the same user, and MUST work whatever the
  length of the user's home-folder path.
- **FR-017**: Shell detection MUST find the shells installed on the machine, including those from common package
  managers, and default to the user's login shell. Terminals MUST start with the user's login environment however throng
  was launched.
- **FR-018**: Terminal features that work on Linux MUST work on macOS: startup commands, shell arguments, presets,
  titles, the current directory read from the operating system, and ending the whole process tree on close, quit and
  orphan clean-up.
- **FR-019**: Started as root, throng MUST refuse to start with the same message as on Linux (062 FR-019).

**Files and paths**

- **FR-020**: Path identity MUST follow the case sensitivity of the volume that holds the path: case-insensitive and
  case-preserving on a default volume, case-sensitive on a case-sensitive one. Renaming a file to a different case of
  its own name MUST work.
- **FR-021**: Paths that differ only in Unicode normalisation MUST be treated as the same file.
- **FR-022**: Delete MUST use the macOS Trash, and undoing a delete MUST restore the item to where it was. User-visible
  copy MUST use the platform's term (062 FR-025).
- **FR-023**: Reveal in file manager, open with default application, open with a registered application (#606), file
  and folder Properties (#485), and cut, copy, paste and drag with Finder (#8) MUST work on macOS through the platform's
  own handlers.
- **FR-024**: Opening a folder as a throng project (#607) MUST work on macOS from the command line (FR-024a), by dropping
  the folder on throng's Dock icon, and through Finder's Open With on a folder, whether or not throng is running. There
  is no right-click Finder entry on macOS, and the known platform differences list MUST say so (FR-041).
- **FR-024a**: throng MUST offer an **Install 'throng' command** action, reachable from the application menu and the
  key bindings list, that puts the `throng` command on the user's path, asking for administrator approval through the
  system's own prompt when the location needs it. A matching **Uninstall 'throng' command** action MUST remove it.
  Installing over a `throng` command that points somewhere else MUST ask before replacing it. A declined approval or a
  failure MUST raise one notice saying what went wrong, and success MUST say where the command now is. Upgrading or
  moving the app MUST NOT break an installed command, and where it cannot be kept working, throng MUST say so once on
  the next start.
- **FR-025**: A folder macOS withholds behind a privacy prompt the user declined MUST raise one notice naming the folder
  and how to grant access. It MUST NOT show as an empty tree.

**Window, menus and key bindings**

- **FR-026**: throng's windows MUST show the standard macOS window controls in place of throng's own, and tear-off windows,
  sub-workspaces, saved geometry and full screen MUST work.
- **FR-027**: The menu bar MUST carry an application menu with About, Settings (opening Preferences), Hide, Hide Others,
  Show All and Quit, plus the standard Edit and Window menus so system text commands and window cycling work.
- **FR-028**: Closing the last window MUST leave throng running in the Dock without running the quit flow, and
  activating it from the Dock MUST restore the window with its layout. Quitting (Cmd+Q, the application menu or the Dock
  menu) MUST run the same quit flow as closing the window does on Windows and Linux, closing progress included (#521).
- **FR-029**: macOS MUST have its own shipped default bindings, with the same action ids as the other platforms, built
  as follows. Every application chord that uses Ctrl on Windows and Linux MUST use Cmd on macOS, and terminals MUST still
  receive Ctrl chords. Where the Cmd form is a chord macOS reserves for itself (such as Cmd+H, Cmd+M, Cmd+Q, Cmd+Tab and
  Cmd+Space), that action MUST get a different macOS default. Every macOS default that is not the plain Ctrl-to-Cmd form
  MUST be listed in the key bindings docs.
- **FR-030**: The editor's platform-keyed chords (016 FR-017e) MUST gain macOS values, and terminal link activation MUST
  use Cmd+click (024 FR-019c).
- **FR-031**: The terminal's reserved-chord tiers MUST hold on macOS, and the default MUST let Option type the
  characters the keyboard layout puts on it. A setting MUST let the user make Option act as Meta instead.

**Resource Monitor (#551)**

- **FR-032**: The status bar and Resource Monitor MUST show real per-process CPU, memory and I/O figures on macOS, and
  GPU where the platform exposes it. Any figure that cannot be read MUST show "unavailable" with the reason (055 FR-010,
  062 FR-038).
- **FR-033**: The daemon and lock manager (#133) MUST list throng's processes and what they hold on macOS, or report a
  part as absent per FR-013.
- **FR-034**: The macOS process-metrics implementation MUST pass the shared process-metrics contract, and its CPU and
  memory figures MUST agree with the system's own tools within the monitor's accuracy bar (055 FR-012).

**Development and CI**

- **FR-035**: throng MUST install, build and start from a source checkout on macOS using the repository's existing
  commands. Every developer script the repository documents MUST run on macOS or say it does not (062 FR-039).
- **FR-036**: Unit, component, integration and contract layers, the `@core` E2E lane and a macOS-only E2E suite tagged
  `@macos` MUST run in pull-request CI on hosted Apple silicon machines, one for each supported macOS release
  (FR-003a). The same layers and E2E lanes MUST run in the gate on the same
  releases. E2E MUST run against the app as built on that machine. A failure in any of them MUST fail the run.
- **FR-037**: Moving the supported range forward when a new macOS ships MUST take one change in one place, which names
  the CI machines for both releases. Nothing else in CI or the release pipeline MAY name a macOS version, and the docs
  MAY name one only where the first-launch steps differ between releases.
- **FR-038**: Tests that assert Windows-only or Linux-only behaviour MUST be skipped on macOS with their reason, and
  tests MUST NOT depend on another platform's shell, path form or tool unless they test it (062 FR-042, FR-043).
- **FR-039**: The Windows and Linux lanes MUST keep running unchanged, and no Windows or Linux code, test or
  capability MAY be removed.

**Documentation**

- **FR-040**: `docs/install-macos.md` MUST cover installing, first launch, upgrading and removing on macOS, and building
  from source, and `docs/installation.md` MUST link it and stop describing macOS as planned. `README.md`, `docs/quick-start.md` and `CONTRIBUTING.md` MUST state macOS's best-endeavours level and
  ask for bug reports. `docs/architecture.md` MUST describe the macOS implementations, and the key bindings docs MUST
  list the macOS defaults.
- **FR-041**: The known platform differences list (062 FR-048) MUST cover macOS.

**Builds, binaries and CI/CD**

- **FR-042**: The repository's existing package command MUST produce the macOS artifacts (FR-003) on an Apple silicon
  machine, with no extra step, as it does on Windows and Linux.
- **FR-043**: Every native component throng loads, including the terminal host, the database and the foreign-function
  bridge, and the bundled runtime the background service runs on MUST ship as Apple silicon binaries built for the
  runtime that loads each one (020 FR-009). Packaging MUST stop dropping the macOS native binaries it excludes today.
- **FR-044**: Every executable and native library in the app MUST carry the ad-hoc signature Apple silicon needs
  before it will run code, applied at build time. A build that contains a binary macOS would refuse to run MUST fail.
- **FR-045**: The release pipeline MUST, with no manual step, build the macOS artifacts on a hosted Apple silicon
  machine, run FR-010's checks on a clean machine for each supported release, add the artifacts and their checksums to
  the release, and hold them to the publish gate (FR-009). The unattended release (065) MUST treat a macOS failure
  through the same fix loop and stop conditions as any other platform.
- **FR-046**: Pull-request CI (`ci.yml`) MUST gain the macOS jobs FR-036 names, and the gate workflow (`gate.yml`) MUST
  gain a macOS lane that its scheduled runs include and whose failure is reported like the others'.
- **FR-047**: Each CI and release job on macOS MUST clear the processes and data folders it leaves behind, as the
  Windows and Linux jobs do, so a hosted machine reused within a run starts clean.
- **FR-048**: Every release body MUST offer the macOS download with the support level (FR-001), the supported-releases
  rule (FR-003a) and the first-launch step (FR-006). The website's install section must offer the same once it exists;
  that is [#554](https://github.com/Bidthedog/throng/issues/554)'s, which this feature comments on.
- **FR-049**: `docs/releasing.md` MUST describe the macOS build, its checks and its artifacts, and how to move the
  supported range forward when a new macOS ships (FR-037). `docs/testing.md` MUST describe the macOS lanes.

**Responsiveness**

- **FR-050**: macOS CI MUST measure typing latency in the visible terminal with 10 terminals running, on each supported
  release, and fail the run when the 95th percentile exceeds 100 ms (Principle XII). The measurement MUST run in the
  gate's macOS lane and report its figures whether it passes or fails.

### Out of Scope

- **Code signing and notarisation** ([#118](https://github.com/Bidthedog/throng/issues/118)), and automatic background
  updates, which depend on it.
- **Manual testing on a Mac.** No macOS groups are added to this branch's manual test plan.
- **The website's macOS download.** The website does not exist yet; [#554](https://github.com/Bidthedog/throng/issues/554)
  builds it and carries FR-048's website half.
- **Mac App Store and Homebrew distribution.** Homebrew no longer accepts casks that fail Gatekeeper.
- **Intel Macs.** No Intel copy is built. Apple's last release for them is macOS 26, and they are a small, shrinking
  share of Macs.
- **macOS releases older than the previous one.** They may work, within what the bundled runtime accepts, but are not
  tested or supported.
- **New features specific to macOS** that the other platforms do not have, beyond what FR-026 to FR-028 need to make
  throng a well-behaved Mac app.

### Supersessions

- **062 FR-050** ("macOS implementations MUST NOT be built here. Selecting implementations on an unimplemented platform
  MUST report that the platform is unsupported"): its first clause was scoped to 062 and is fulfilled. For macOS, FR-011
  replaces its second clause. Any other platform still reports unsupported.
- **Principle II's "Windows and Linux are the supported targets"** and **"macOS implementations are not required"**:
  amended by FR-002. macOS joins the rule that a feature with per-OS code delivers every supported platform together.
- **020 FR-039** ("MUST NOT foreclose adding macOS … installers later") and **042's exclusion of macOS packaging**:
  fulfilled for macOS by FR-003 to FR-010.
- **The packaging config's exclusion of the macOS database binaries** (`electron-builder.yml`, the `darwin-*`
  prebuild filter) is replaced by FR-043.
- **The v1.0.0 exclusion of macOS** was removed from the milestone at the maintainer's direction on 2026-11-15.

### Key Entities

- **Reference CI environment**: hosted Apple silicon machines on the current and previous macOS releases, where every
  test layer runs.
- **macOS implementation set**: the macOS services bound at startup, one per platform-neutral seam.
- **macOS default bindings**: shipped defaults for macOS, with the same action ids as Windows and Linux.
- **macOS artifacts**: one Apple silicon disk image and one Apple silicon archive, joined to the declared artifact set.
- **Support level**: best endeavours, a stated property of the macOS platform shown in docs and release notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean hosted Apple silicon machine, the macOS copy installs by copying to Applications, launches, and
  reports the release's version, in every release.
- **SC-002**: Unit, component, integration, contract and `@core` E2E pass on macOS in CI, with zero unexplained skips.
- **SC-003**: A long-running full-screen terminal program survives 20 consecutive quit-and-relaunch cycles on a hosted
  macOS machine with its process and screen intact.
- **SC-004**: After 20 cycles of opening terminals, closing them and quitting, no process throng started remains that
  the user did not ask to keep.
- **SC-005**: Every action in the key bindings list fires on macOS with its default binding in automated tests, or has
  a documented macOS difference. None is silently dead.
- **SC-006**: Resource Monitor CPU and memory figures on a hosted macOS machine agree with the system's own tools within
  the monitor's accuracy bar.
- **SC-007**: Every user-facing feature in `docs/quick-start.md` is covered on macOS by an automated test, or appears in
  the known platform differences list.
- **SC-008**: The Windows and Linux gate lanes pass at the final commit, no test there is removed, and none changes
  what it asserts.
- **SC-009**: A pull request that breaks a macOS implementation fails CI before it can merge.
- **SC-010**: A release needs no macOS-specific action from the maintainer. From tag to published macOS download, every
  step runs in the pipeline.
- **SC-011**: Moving the supported macOS range forward is a one-line change.
- **SC-012**: On each supported macOS release in CI, with 10 terminals running, 95% of characters typed in the visible
  terminal appear within 100 ms.

## Assumptions

- **Hosted macOS CI machines are free for this public repository** and provide a logged-in desktop session, so real
  windows run there under the repository's no-headless rule.
- **Apple silicon is the only architecture.** On Valve's Steam survey, about 18–20% of Macs were Intel in 2025, and the
  share falls every month. throng's developer audience is expected to sit below that.
- **The toolchain stays**: the existing Node and Electron requirements, plus the platform's developer command-line
  tools for any native module without a prebuilt binary.
- **The macOS platform services are a new implementation alongside the Windows and Linux ones**, sharing with the Linux
  implementation wherever POSIX behaviour is the same. The plan decides their exact shape.
- **Best endeavours covers judgement, not function.** CI proves controls, menus, chords and figures exist and work.
  Whether they look and feel right on a real Mac comes from community reports.
- **This branch stays spec-only until planned.** #22 and #551 are claimed on this branch.
