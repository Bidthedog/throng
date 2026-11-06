# Feature Specification: Linux Packaging

**Feature Branch**: `feature/S063-I550-linux-packaging` (stacked on `feature/S062-I23-linux-dev-mode`, at the maintainer's choice)

**Created**: 2026-11-03

**Status**: Draft

**Input**: Issue [#550](https://github.com/Bidthedog/throng/issues/550). "Linux packaging for throng. A Linux user can download a released build of throng, install it, launch it from their desktop, upgrade it and remove it, without a source checkout or a compiler. Formats: .deb, .rpm and .tar.gz, x64 only, attached to GitHub Releases alongside the existing Windows artifacts, built and verified by the release pipeline. The Chromium sandbox stays on. Windows artifacts and verification must not change."

## Requirements this feature supersedes

Spec 020 was written when Windows was the only platform, and spec 058 has already superseded its per-user-only rule. These change here, for Linux packages only. Every Windows requirement stands as it is.

| Requirement | What it says | What replaces it on Linux, and why |
|---|---|---|
| 020 FR-038 | The product produces an installer for Windows 11, the only platform throng runs on | The product also produces Linux packages (FR-001). Spec 062 made Linux a supported platform, and 020 FR-039 kept this door open |
| 020 FR-012 | Installation needs no administrator elevation | Installing a system package needs administrator rights (FR-004). That is how Linux package managers work, and the sandbox profile can only be installed that way. The archive still needs none to extract |
| 020 FR-021 | Uninstalling offers an unticked checkbox to delete personal data | No checkbox exists (FR-012). A system package is removed for the whole machine by a tool with no such prompt, and it cannot know every account's data. Personal data is always kept, which is the default that requirement protects |
| 020 FR-018 | The user is informed when an upgrade or uninstall starts while the application runs | The package manager's run carries no dialog, so the informing happens in throng (FR-010). The rule that nothing is left partially replaced stands |

## Clarifications

### Session 2026-11-03

- Q: Which formats? → A: `.deb`, `.rpm` and `.tar.gz`, compared with AppImage, Flatpak and Snap. AppImage has no fixed path for a sandbox profile, and Flatpak would run shells inside its own sandbox. x64 only.
- Q: Are package repositories part of this? → A: No. They are [#554](https://github.com/Bidthedog/throng/issues/554), with the website, and they need a domain and a signing key. Users download these packages from GitHub Releases.
- Q: Is this delivered on its own branch? → A: Yes, on a branch stacked on the Linux dev-mode branch, with its own PR. PR 552 goes to master first, so its gate and merge are not disturbed by this work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install from a package and start working (Priority: P1)

A person on a supported Linux desktop downloads the package for their distribution from a throng release, installs it with their usual tools, finds throng among their applications, and opens a terminal in it. They never install a compiler, a language runtime or anything else by hand.

**Why this priority**: This is the whole point of the feature. Today, running throng on Linux means cloning the repository and building it.

**Independent Test**: On a clean supported machine with no developer tools, install the package, launch throng from the desktop's application list, and run a command in a terminal.

**Acceptance Scenarios**:

1. **Given** a clean Ubuntu machine with no developer tools, **When** the user installs the `.deb`, **Then** the install succeeds and pulls in any system libraries it needs.
2. **Given** a clean Fedora machine with no developer tools, **When** the user installs the `.rpm`, **Then** the install succeeds in the same way.
3. **Given** throng is installed, **When** the user opens their desktop's application list, **Then** throng appears with its name and icon, and opening it shows the throng window.
4. **Given** throng is installed, **When** the user types `throng` in a shell, **Then** throng opens.
5. **Given** throng is running from a package, **When** the user adds a terminal and runs a command, **Then** it runs in one of the shells on their machine, and the terminal's output appears.
6. **Given** an Ubuntu machine that restricts unprivileged user namespaces, **When** throng starts from a package, **Then** it starts with the browser sandbox on, with no flag or manual step.

---

### User Story 2 - Upgrade without losing anything (Priority: P1)

A person with throng installed installs a newer release's package. Their projects, settings and layouts are all still there, and any terminals that were running behave as throng already promises.

**Why this priority**: An installation that cannot be upgraded safely would strand every user on their first version.

**Independent Test**: Install a version, create a project and change a setting, install a newer package over it, then confirm the project and setting survive and the new version runs.

**Acceptance Scenarios**:

1. **Given** throng is closed and holds the user's projects and settings, **When** a newer package is installed, **Then** the next launch reports the new version with all of them intact.
2. **Given** throng is open, **When** a newer package is installed, **Then** the upgrade completes and the running copy keeps working, with its terminals still alive, until the user chooses to restart it.
3. **Given** the running copy is older than the installed one, **When** the user next looks at throng, **Then** it tells them that a restart will start the new version and what that means for their running terminals.
4. **Given** a newer version is installed, **When** the user tries to install an older package over it with the ordinary install command, **Then** that is refused, and the existing installation and data are untouched.

---

### User Story 3 - Remove it cleanly (Priority: P2)

A person removes throng with their package manager. The application and everything the package installed are gone, and their own data is still there in case they return.

**Why this priority**: Clean removal is what makes it safe to try throng. It matters less often than installing and upgrading.

**Independent Test**: Install, run once, remove the package, then confirm the application is gone from the desktop and the disk, and the user's data remains.

**Acceptance Scenarios**:

1. **Given** throng is installed and closed, **When** the user removes the package, **Then** the application, its desktop entry, its command and its sandbox profile are gone.
2. **Given** throng has been removed, **When** the user looks in their home folder, **Then** their projects and settings are still there, and the docs name the folders to delete if they want them gone.
3. **Given** throng is running, **When** the package is removed, **Then** no process from that installation is left running once the user closes it, and nothing is restarted.
4. **Given** throng was removed and data was kept, **When** it is installed again, **Then** it finds the user's projects and settings.

---

### User Story 4 - Run without installing (Priority: P2)

A person who cannot or does not want to install system packages extracts the archive into a folder and runs throng from there. Deleting the folder removes it.

**Why this priority**: It serves distributions with no `.deb` or `.rpm` route and people without administrator rights, matching the Windows archive.

**Independent Test**: Extract the archive on a clean machine, run throng from the folder, open a terminal, then delete the folder and confirm nothing of the application remains running.

**Acceptance Scenarios**:

1. **Given** a machine where the browser sandbox works without extra setup, **When** the user extracts the archive and starts throng, **Then** it runs with the sandbox on.
2. **Given** a machine that restricts unprivileged user namespaces, **When** the user starts throng from the archive, **Then** they see what is wrong and the exact steps to fix it, and throng does not run with the sandbox off.
3. **Given** throng ran from the archive, **When** it is closed and the folder is deleted, **Then** none of its processes remain and its data is still in the user's home folder.

---

### User Story 5 - Every Linux package is proved before it ships (Priority: P1)

A maintainer cuts a release. The pipeline builds the Linux packages beside the Windows ones, installs each on a clean machine, and refuses to publish if any step fails. Nothing about the Windows set changes.

**Why this priority**: Throng's release rule is that nothing unverified publishes, and a Linux package that was only ever built would break it on the first bad build.

**Independent Test**: Rehearse the release pipeline with publishing off, and read one verdict per Linux package alongside the unchanged Windows verdicts. Break one Linux package on purpose and confirm the gate refuses.

**Acceptance Scenarios**:

1. **Given** a release run, **When** packaging finishes, **Then** exactly the declared Linux and Windows artifacts exist, and a missing or undeclared file fails the run.
2. **Given** a built Linux package, **When** it is verified on a clean machine, **Then** a verdict records each step of its lifecycle, and an absent verdict is a refusal.
3. **Given** a release is published, **When** a reader opens it, **Then** every Linux package is attached with its own checksum, and the notes say which one to choose.
4. **Given** the change is complete, **When** the Windows artifacts are built and verified, **Then** their names, contents and verification steps are as they were.

### Edge Cases

- **A package installed while a throng run from the archive or from source is open.** Each copy keeps its own files, and dev-mode data stays separate (062 FR-005). Copies of the same namespace follow the existing one-running-instance rule.
- **Upgrading while another account on the machine has throng open.** That account's copy keeps running, and is told about the restart as in User Story 2.
- **A machine with no AppArmor.** The profile step does nothing and the install still succeeds. The sandbox works through whichever route that machine offers.
- **An AppArmor version too old for the profile.** The install succeeds, skips the profile and says so.
- **A machine with neither working user namespaces nor a usable sandbox helper.** Throng reports it and does not start with the sandbox off.
- **A distribution too old for the build.** The package manager refuses on its declared dependencies, or throng reports the missing library, rather than crashing silently. Docs state what is supported.
- **Files replaced under a running daemon.** The running copy must not fail later because a file it loads on demand changed version (FR-009).
- **Removing a package while a terminal is running.** The running shell is the user's and is not killed by the removal.
- **Extracting the archive to a path containing spaces.** It runs normally. Where the machine restricts user namespaces, throng has to use its sandbox helper, which Chromium cannot start from such a path, so throng says to move the folder and does not start with the sandbox off.
- **An interrupted install or removal.** The package manager's own recovery leaves a state the next install can repair.

## Requirements *(mandatory)*

### Functional Requirements

**The packages**

- **FR-001**: Each release MUST produce a `.deb` package, an `.rpm` package and a `.tar.gz` archive for 64-bit x86 Linux, with the product version in each filename.
- **FR-002**: Each MUST be self-contained under 020 FR-009: every runtime and native component throng needs is inside it, and nothing is compiled or fetched at install or first run. System libraries the desktop provides MAY be declared as package dependencies, so the package manager installs them.
- **FR-003**: The `.deb` and `.rpm` MUST register throng with the desktop, with an application entry and icon, and put a `throng` command on the user's path. They install to one fixed location for the whole machine, so every account can run the same copy with its own data.
- **FR-004**: Installing the `.deb` or `.rpm` MUST need nothing beyond what the system's package tools already ask for, including their usual administrator rights. Extracting and running the archive MUST need no administrator rights where the sandbox works without them.
- **FR-005**: Nothing MUST be written under the install location at runtime (020 FR-008). All user data stays in the user's folders (062 FR-013).

**The sandbox**

- **FR-006**: Throng MUST run with the browser sandbox on from every Linux package, and no package, launcher or desktop entry MAY disable it.
- **FR-007**: The `.deb` and `.rpm` MUST leave the sandbox working on a machine that restricts unprivileged user namespaces, with no manual step, by installing what that machine needs for the fixed install location only. Removing the package MUST remove it, and it MUST change no system-wide setting.
- **FR-008**: When throng from the archive cannot start its sandbox, the user MUST see what is wrong and the exact steps to fix it, and throng MUST NOT start without the sandbox. This MUST reach the user even if the failure comes before throng's own window can open.

**Upgrade and removal**

- **FR-009**: Upgrading while throng runs MUST leave the running copy working, with its terminals alive, until the user restarts it. It MUST NOT fail later because the installed files changed under it.
- **FR-010**: A running copy MUST tell the user when the installed version no longer matches it, as one notice with a restart action, saying what restarting does to running terminals (*One condition, one notice*).
- **FR-011**: An upgrade MUST keep all per-user data, and the ordinary install command MUST refuse to install an older version over a newer one, leaving the installation and data untouched (020 FR-016a). A deliberate downgrade means removing the current version first.
- **FR-012**: Removing a package MUST remove everything the package installed and MUST NOT touch any user's data. `docs/installation.md` MUST name the folders that hold it.
- **FR-013**: Removing a package MUST NOT kill running processes. Once the user closes a copy whose files were removed, none of its processes remain (Principle III).

**Separation**

- **FR-014**: A packaged copy MUST use the installed-build data locations and never dev-mode's (062 FR-005), and MUST run alongside a source checkout without interfering with it.
- **FR-015**: Linux-specific behaviour MUST stay behind the platform abstractions (Principle II). Packaged-runtime code that differs by platform MUST go through those seams, and the Linux and Windows halves ship together.

**The release pipeline**

- **FR-016**: The Linux packages MUST join the declared artifact set (042), resolved by role like the Windows ones, with the same two-way reconcile. A build MUST only be held to the artifacts its platform can produce.
- **FR-017**: Each Linux package MUST be verified on its own clean machine, with its own verdict, through install, launch, version match, self-containment, core journey, reattach, checksum, removal and residue scan. The `.rpm` MUST be verified on an rpm-based distribution. Steps that do not apply are recorded `not-applicable`, and an absent verdict is a refusal (020 FR-027).
- **FR-018**: A step a hosted runner cannot exercise MUST be recorded `unproven` with its reason and listed in the release body (058), never passed. Which steps may be `unproven` MUST be named, not open-ended.
- **FR-019**: The publish gate, the checksums and the release body MUST cover the Linux artifacts with the same conditions as the Windows ones, and the body MUST say who each one is for.
- **FR-020**: Native components MUST be built so the packages run on every supported distribution, not only the one that built them.
- **FR-021**: The names, contents and verification steps of the Windows artifacts MUST NOT change, and the human QA sign-off MUST remain the only route to publication. *(Second clause superseded by 065 FR-002 and FR-003.)*

**Documentation**

- **FR-022**: `docs/installation.md` MUST cover installing, upgrading, downgrading and removing on Linux for each package, and which distributions are supported. `docs/releasing.md` MUST list the new artifacts, and the `throng-release` skill MUST move with the pipeline.

### Key Entities

- **Linux artifact**: One published file in the declared set, with its role, filename, label, audience and verification steps.
- **Verification verdict**: One per artifact, recording an outcome for every step, and read by the publish gate.
- **Install location**: The fixed machine-wide folder for the `.deb` and `.rpm`, or whichever folder the archive was extracted to. It holds no user data.
- **Sandbox profile**: What the `.deb` and `.rpm` install so the sandbox works under a namespace restriction, scoped to that install location and removed with the package.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean Ubuntu or Fedora machine with no developer tools, a person goes from download to a working terminal in throng in under 5 minutes.
- **SC-002**: Every Linux package passes its clean-machine verdict before any release publishes, and a deliberately broken package is refused by the gate every time.
- **SC-003**: After an upgrade, 100% of the user's projects, settings and layouts are present, and terminals open during the upgrade are still alive until the user restarts throng.
- **SC-004**: After removal, nothing the package installed remains on disk, no throng process remains once closed, and all user data is intact.
- **SC-005**: Throng never runs with its sandbox off from a Linux package, on any tested distribution.
- **SC-006**: A comparison of the Windows artifact list and verification steps before and after this feature shows no difference.

## Assumptions

- Supported distributions are Ubuntu 22.04 and later and Fedora's currently supported releases, with Debian-based and rpm-based relatives expected to work but not verified. The plan may adjust the oldest versions once the build's library needs are measured.
- x64 only. arm64 waits until someone asks.
- GNOME on Ubuntu is the reference desktop (062). Other desktops get the standard application entry with no specific testing.
- No automatic update in this feature (020 FR-041, #119). Repositories that bring upgrades through `apt` and `dnf` are #554.
- Checksums stand in for signatures, as on Windows. The packages themselves are unsigned, and #118 owns code signing.
- Installed builds run under XWayland by default with the same opt-in as dev mode (062).
- Hosted Linux runners are close enough to a clean machine for verification, using an X server as the Linux gate does. A real desktop's application list and icon are checked by hand in the manual test plan.
- This is stacked on the Linux dev-mode branch and has its code available. Its own PR closes this issue, after PR 552 merges.

## Out of Scope

- AppImage, Flatpak and Snap.
- Package repositories and the website ([#554](https://github.com/Bidthedog/throng/issues/554)).
- Submission to Debian, Ubuntu or Fedora's own repositories.
- macOS ([#22](https://github.com/Bidthedog/throng/issues/22)) and arm64.
- Package and code signing ([#118](https://github.com/Bidthedog/throng/issues/118)) and automatic update ([#119](https://github.com/Bidthedog/throng/issues/119)).
