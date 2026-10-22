# Feature Specification: Machine-Wide Installation & the MSI

**Feature Branch**: `feature/S058-I361-I351-machine-wide-install-msi`

**Created**: 2026-10-19

**Status**: Draft

**Input**: GitHub issues #361 (offer machine-wide installation as a choice, across every installer
format) and the remaining MSI half of #351 (additional installer formats — its portable and archive
half shipped in spec 042). They are specified together because the MSI was always the artifact
machine-wide installation exists for: managed deployment through Intune, SCCM or Group Policy
consumes MSI packages and installs for the machine. The user additionally required that the work be
carried through the release packaging pipeline and its runbook in the same change.

---

## What this feature is, and what it is not

**throng can only be installed for the person running the installer.** All three published
downloads — the per-user setup, the portable build and the archive — install or run inside the
invoking user's own profile. There is no way to install throng once so that everyone who logs into a
machine has it, and nothing an administrator can push through the tooling an organisation uses to put
software on the machines it manages.

That is not an oversight. Spec 020 decided it deliberately (FR-040, FR-012), and recorded why: a
per-machine install needs administrator rights, and offering both scopes *"would roughly double the
install/upgrade test matrix while requiring a rule for what happens when both are present"*. This
feature reverses that decision in the open and pays both costs: it doubles the verification matrix
for every format that installs, and it states the rule for a machine carrying more than one copy.

**The rule is deliberately simple: install as many copies as you like; run one.** Any number of
copies of throng — any format, any scope, any version — may sit on a machine side by side, and no
installer refuses because another copy exists. What is limited is what *runs*: one throng per
signed-in user, whichever copy started it — and every copy uses that user's one data folder. The
constitution already requires a single instance per user; this feature makes that hold across
copies, which it does not today.

**What this feature is not:**

- **Not a machine-wide daemon.** Installing the application for every user of a machine shares the
  *files*; it shares nothing that runs. Each user's background component stays per-user,
  session-scoped and at that user's own privilege level (020 FR-010, FR-011, FR-013), and it is never
  a Windows service.
- **Not a new release process.** Spec 020 and spec 042 already govern packaging, verification and
  publication, and spec 042 made the pipeline resolve every artifact by role from a declared set.
  This feature adds one artifact and one install dimension to that machinery; it does not add a new
  kind of gate.
- **Not code signing.** No signer has been chosen (#118). Every artifact this feature adds ships
  unsigned with a published checksum, exactly as the existing ones do (020 FR-042, FR-043).

### Requirements this feature supersedes

Stated explicitly, per the rule that an older requirement which should change is a supersession and
never a silent contradiction.

- **020 FR-040** — *"The installer MUST install per user only, into a location within the invoking
  user's own profile. It MUST NOT offer or require a machine-wide installation."* **Superseded** by
  FR-001–FR-004 below. A user installing throng may now choose per-user **or** machine-wide. The
  per-user path keeps every property FR-040 gave it — the same location inside the user's own
  profile, and it remains the default. What is withdrawn is the prohibition on offering the other
  scope. *Why:* managed deployment is a real audience that the per-user-only rule excludes entirely,
  and the cost 020 named — a doubled test matrix and a rule for coexistence — is one this feature
  pays rather than avoids.
- **020 FR-012** — *"Installation MUST NOT require administrator elevation."* **Superseded, for the
  machine-wide path only**, by FR-005 and FR-006 below. A machine-wide installation requires
  administrator rights, because it writes to a location every user can read and none may modify. The
  **per-user path keeps FR-012 in full**: a user installing throng for themselves is never asked for
  an administrator password, by any format.
- **003 FR-034** — a second launch *"silently exits (no new window, no focus change)"*.
  **Superseded** by FR-018 below. A second launch now brings the running throng to the front, and
  when it was a different copy the running throng says so. *Why:* with several copies, a launch that
  silently does nothing leaves the user unable to tell why the copy they asked for did not open. (The shipped code already focuses the
  running window, so this also retires a drift between 003 and the code.)
- **The data-folder-scoped single-instance lock.** Today the lock is keyed on the data folder, so a
  copy launched with Electron's `--user-data-dir` starts a second throng. That is not a written
  requirement; FR-018 replaces it for every installed or extracted copy.
- **042 FR-019** — *"Every artifact this feature adds MUST install or run without administrator
  elevation."* **Unaffected, stated for clarity.** It binds the portable and archive artifacts spec
  042 added. The MSI is added by *this* feature and is governed by FR-005 and FR-006 here.

**Left standing, and binding on everything this feature adds:** 020 FR-008 (nothing writes to the
install root at run time), FR-009 (self-contained), FR-010 and FR-011 (per-user, session-scoped,
non-service daemon), FR-013 (account isolation), FR-016 and FR-016a (upgrade preserves data;
downgrade refused), FR-017–FR-022 (clean upgrade, running-app and live-terminal handling, clean
uninstall, data retained by default, no half-install), FR-023–FR-027 (verification), FR-028–FR-037
(gates and publication), FR-041 (no auto-update), FR-042–FR-043 (checksums, unsigned warning), and
042 FR-011–FR-017 (declared artifact set, resolution by role, every artifact verified). The
constitution's *Single instance* and *Per-user local storage* rules are satisfied, not amended.

---

## Clarifications

### Session 2026-10-19

- Q: Where does #351's MSI belong now that its portable and archive half has shipped? → A: In this
  spec, together with #361, because the MSI is the format machine-wide installation exists for.
  (Recorded on both issues, 2026-10-19.)
- Q: Is the release packaging pipeline in scope? → A: Yes. The user required that the new artifact
  and the new install scope be built, verified and published by the release pipeline, and that the
  release runbook and release docs move in the same change.
- Q: Which install scopes does the MSI offer — per-machine only (as #351 settled on 2026-09-02), or
  both? → A: **Every installer offers both scopes, where possible** — the MSI included. This
  supersedes #351's 2026-09-02 per-machine-only decision. If the plan's research shows an MSI cannot
  offer the per-user scope while meeting FR-006 (no elevation), that is reported back as a finding
  for the user to decide, not resolved silently. (FR-003a.)
- Q: Should spec 058 also publish throng through package managers (winget, Scoop, Chocolatey)? → A:
  **No.** None are in this spec; each viable package manager is its own vNext issue — winget #509,
  Scoop #510, Chocolatey #511. The other Windows formats the packaging tooling can build were judged
  not viable: MSIX/AppX (needs signing, #118, and its AppData redirection and process model conflict
  with 020 FR-010/FR-011), Squirrel (duplicates the per-user setup and is built for auto-update, which
  020 FR-041 excludes), the wrapped MSI (adds nothing over the MSI), the web installer (downloads at
  install time, against 020 FR-009), and further archive formats (same audience as the zip).
- Q: When an administrator upgrades or uninstalls a machine-wide throng while another account still
  has throng open, should the installer refuse, or replace the files at the next restart? → A:
  **Interactive runs refuse and name the accounts still using it; unattended runs complete at the
  next restart** — files in use are replaced or removed on restart, the installer exits with the
  platform's standard "restart required" code, and no account's processes are terminated.
  (FR-015, FR-016, FR-016a.)
- Q: How many copies of throng may a machine carry, and what stops them interfering? → A: **As many
  as a user or administrator wants, in any combination of format, scope and version; only one throng
  instance may run per signed-in user at any time.** Locked in by the user, replacing an earlier answer the
  same session that refused a second copy for one account, and making the follow-up question about
  mixing the setup and the MSI moot. (FR-017–FR-022.)
- Q: May a user point throng at a data folder other than their own? → A: **No.** Each user has
  exactly one data folder, every copy uses it, and there is no option to choose another. This
  withdraws a command-line data-folder option and per-folder background components that were briefly
  specified the same session. (FR-019–FR-021.)
- Q: If one copy still has terminals running and the user starts a copy of a different version, what
  happens? → A: **The new copy replaces the background component, ending its terminals, with no
  prompt** — the same as a stale build today. Running two different copies is the user's choice, and
  so is the loss. (FR-021a.)
- Q: Should a development build run from source, and the automated tests, be allowed to run while an
  installed throng is open? → A: **Yes, without compromise.** Running a development copy and a
  production copy side by side is fundamental; development and test runs keep their own isolated
  data and background component and are never counted by the one-instance rule. (FR-018a.)

### Session 2026-10-20

- Q: When the MSI is run unattended without choosing a scope, should it install per-user or
  machine-wide when the person running it is an administrator? → A: **Machine-wide when the runner is
  elevated (including SYSTEM), per-user otherwise.** Managed-deployment tools run the MSI elevated
  with only the silent switch, and a per-user install into the SYSTEM profile would reach no user.
  FR-002's per-user default is narrowed to the setup, and to the MSI run by a standard user.
  (FR-002, FR-003a.)
- Q: If someone picks "install for everyone" interactively and then declines or cannot pass the
  administrator prompt, what should the installer do? → A: **Install nothing, say why, and return to
  the scope choice** so they can pick per-user or try again. Never a silent per-user fallback.
  (FR-010a.)
- Q: Should the one-running-throng rule also hold against copies of releases from before this
  feature? → A: **Yes.** Every new copy MUST also hold the lock older releases use, so an old and a
  new copy never run together; only a new copy can show the "different copy" notice. (FR-018b.)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install throng for everyone on a machine (Priority: P1)

A person with administrator rights on a shared Windows machine — a lab, a family PC, a build host, a
developer workstation with several accounts — wants throng installed once, so that every account on
the machine can launch it without installing their own copy. They run the setup, choose to install
for everyone, approve the administrator prompt, and throng is available to every account.

**Why this priority**: It is the capability #361 exists for and the one every other story builds on.
Without a working machine-wide scope, the MSI has nothing to install.

**Independent Test**: On a clean machine with two standard user accounts, install machine-wide from
the setup as an administrator, then sign in as each account in turn and launch throng, open a project
and a working terminal. Delivers a usable shared install with no MSI built at all.

**Acceptance Scenarios**:

1. **Given** a clean machine, **When** an administrator runs the setup and chooses to install for
   everyone, **Then** they are asked for administrator approval once, throng installs into a location
   outside every user's profile, and a Start-menu shortcut appears for every account.
2. **Given** a machine-wide install, **When** a second, standard (non-administrator) account signs in
   and launches throng, **Then** throng starts, reports the installed version, spawns that account's
   own background component at that account's own privilege level, and opens a working terminal.
3. **Given** a machine-wide install with both accounts running throng at once, **When** either
   account works, **Then** neither can see or disturb the other's background component, terminals,
   projects, settings, themes, layouts or edit list.
4. **Given** the setup is run without changing the default, **When** it completes, **Then** throng is
   installed for the current user only, in the same location as today, and no administrator prompt
   appeared at any point.

---

### User Story 2 - Deploy throng through managed tooling with an MSI (Priority: P2)

An administrator responsible for a fleet of managed machines wants to push throng through Intune,
SCCM or Group Policy. Those systems consume MSI packages and run them unattended. They download the
MSI from a release, deploy it silently, and every targeted machine has throng for every user, with no
wizard and no person at the keyboard.

**Why this priority**: It is the audience #351's MSI was for, and it is the strongest reason to ship
machine-wide installation at all — but it depends on Story 1's scope existing first.

**Independent Test**: On a clean machine, install the MSI from an elevated command line with the
standard silent switches, then confirm as a second standard account that throng launches, spawns its
own background component and opens a working terminal; then uninstall silently and confirm nothing
is left running or installed.

**Acceptance Scenarios**:

1. **Given** a clean machine and a release's MSI, **When** an administrator installs it from a
   command line with the standard unattended switches and no scope, **Then** it completes with no
   window, no prompt and a success exit code, and throng is installed for every user (FR-003a).
2. **Given** an MSI install, **When** it is upgraded silently with a newer release's MSI, **Then** the
   upgrade replaces the previous version cleanly and every user's data survives.
3. **Given** an MSI install, **When** it is uninstalled silently, **Then** the application is removed
   for every user, no throng process belonging to that install is left running, and no user's
   personal data is deleted.
4. **Given** an MSI for an older version than the one installed, **When** it is installed over that
   copy, **Then** it is refused and the existing copy and all data are left untouched.
5. **Given** a standard (non-administrator) user and the MSI, **When** they install it without
   choosing a scope, **Then** it installs per-user into their own profile with no administrator
   prompt, exactly as the setup does (FR-003a).

---

### User Story 3 - Script a machine-wide install from the setup (Priority: P2)

An administrator without MSI tooling — a script, a provisioning step, a dotfiles bootstrap — wants to
install throng machine-wide from the setup they already know, without clicking through a wizard.

**Why this priority**: #361 requires that the machine-wide path be scriptable from **every** format
that installs, not only from the MSI; an install an administrator cannot script is not deployable.

**Independent Test**: From an elevated command line, run the setup with its documented silent
machine-wide switch on a clean machine and confirm the same end state as Story 1.

**Acceptance Scenarios**:

1. **Given** an elevated command line, **When** the setup is run with its documented silent
   machine-wide switch, **Then** it installs machine-wide with no wizard and exits successfully.
2. **Given** a non-elevated command line, **When** the setup is run with the silent machine-wide
   switch, **Then** it fails with a clear message and a non-success exit code, and installs nothing —
   it never silently falls back to a per-user install.
3. **Given** any command line, **When** the setup is run with its silent switch and no scope, **Then**
   it installs per-user exactly as it does today, with no administrator prompt.

---

### User Story 4 - Many copies installed, one throng running (Priority: P2)

A user has throng installed for themselves, an administrator has also installed it machine-wide, and
there is an extracted archive of an older release in a tools folder. Every one of them installs and
stays installed without complaint. Whichever the user starts, they get their own projects and
settings. If one throng is already running and they start another copy, they are taken to the one
that is running and told it is already open, rather than getting a second window over the same data.

**Why this priority**: Spec 020 named the absence of a coexistence rule as one of its two reasons
for refusing to offer both scopes; this is that rule. It ranks P2 because machine-wide installation
alone (Story 1) already creates a second copy on any machine where a user had installed their own.

**Independent Test**: On one machine, install the per-user setup, the machine-wide setup and the
per-user MSI, and extract the archive. Launch each in turn and confirm each opens the same projects;
with one running, launch another and confirm no second throng starts and the running one says why.

**Acceptance Scenarios**:

1. **Given** a machine with any combination of copies installed, **When** another copy is installed
   in any format and scope, **Then** it installs without refusing or warning because the others
   exist, and every copy remains installed, launchable and at its own version.
2. **Given** several installed copies, **When** a user looks at the Start menu and the list of
   installed applications, **Then** every copy has its own entry, labelled so the user can tell
   which copy and scope it is.
3. **Given** throng running for a user, **When** the user launches the same copy again, **Then** no
   second throng starts and the running window comes to the front.
4. **Given** throng running for a user, **When** the user launches a **different** copy, **Then** no
   second throng starts, the running window comes to the front, and it shows a notice naming the copy
   that is running and saying to close it first to open the other.
5. **Given** no throng running, **When** the user starts any copy, **Then** it opens the user's data
   folder — the same projects, settings, layouts and terminals whichever copy it is.
6. **Given** a background component from one copy is still running live terminals, **When** the user
   starts a copy of a **different** build, **Then** the new copy replaces the background component and
   those terminals end, with no prompt.
7. **Given** several copies, **When** one is upgraded or uninstalled, **Then** every other copy is left
   installed, launchable and at its own version, and no user's data is touched.

---

### User Story 5 - Every format and scope is verified before a release publishes (Priority: P1)

The maintainer cuts a release. The pipeline builds the MSI alongside the existing artifacts, verifies
every artifact in every scope it supports on a clean machine, publishes a checksum per artifact, and
refuses to publish if any single combination is unverified. The release runbook the maintainer
follows describes exactly what the pipeline now does.

**Why this priority**: Shipping a machine-wide install or an MSI that was never verified would be
worse than not shipping it — the existing per-user installer is held to a full lifecycle proof, and
a new scope without one is the failure 020 FR-027 forbids. The user required this pipeline work as
part of the feature.

**Independent Test**: Run the release pipeline in rehearsal mode (no publication) on the feature
branch and confirm it produces the MSI, a verdict for every artifact and scope combination, and a
rendered release body with one checksum row per artifact; then remove one verdict and confirm the
publish gate refuses, naming what is missing.

**Acceptance Scenarios**:

1. **Given** a release build, **When** packaging completes, **Then** the MSI is among the produced
   artifacts under its declared name, and packaging fails if it is missing or if anything undeclared
   was produced.
2. **Given** a packaged release, **When** verification runs, **Then** every artifact is verified in
   every install scope it supports, each to the full lifecycle end state, and each combination
   records its own verdict.
3. **Given** verification where any one artifact-and-scope combination failed or did not run,
   **When** publication is attempted, **Then** it is refused and the refusal names the combination.
4. **Given** a published release, **When** a reader opens its notes, **Then** every artifact,
   including the MSI, has its own SHA-256 row against its own filename, and the notes say which
   download suits which reader, including the administrator deploying machine-wide.
5. **Given** the feature has merged, **When** the maintainer follows the release runbook, **Then**
   its artifact table, job list, verification shape and failure table match what the pipeline
   actually does.

---

### Edge Cases

- **A machine-wide install is uninstalled while other users are signed in with throng running.**
  Their background components hold files in the shared install root. Interactively it refuses and
  names them; unattended it completes at the next restart without killing their terminals
  (FR-016a). Either way it never leaves a partially removed install that some user can still
  half-launch.
- **An administrator installs machine-wide and launches throng from the final page of the setup.**
  The setup ran elevated; the throng it launches must not inherit that elevation, or the
  administrator's first terminal would be silently elevated (FR-007).
- **An elevated administrator account launches a machine-wide throng normally** (from the Start menu,
  under UAC). It behaves exactly as a per-user install does for that account today — elevation
  follows how the application was launched, not where it was installed.
- **Two installers would put a copy in the same folder** — the per-user setup and the per-user MSI
  both defaulting to one location. Each installer's copy has its own install folder (FR-017a), so
  they never overwrite each other.
- **One account wants the MSI in both scopes.** Windows Installer treats one MSI package as one
  product, so an account that can see the MSI installed in one scope gets maintenance of that copy,
  not a second copy, when it runs the other scope. That is a platform limit FR-017 cannot override:
  an account can hold the MSI per-user *or* see it machine-wide, and gets any other combination by
  using the setup for the second copy. Found in implementation (2026-10-20); verification installs the
  per-user MSI as a different account from the machine-wide one.
- **The same installer is run again in the same scope.** That is an upgrade, repair or reinstall of
  that installer's copy in that scope, not a new copy, and downgrade refusal applies to it.
- **An older copy is installed alongside a newer one** (a different installer or scope, or an older
  archive extracted elsewhere). Allowed: it is a separate copy, and downgrade refusal only governs
  replacing a copy in place (FR-022). If the older copy is run against data a newer version wrote,
  the existing data-compatibility behaviour applies, unchanged by this feature.
- **A user's data was written by one copy, and they start using another.** Every copy reads the
  user's one data folder, so nothing is lost and nothing needs migrating (FR-019).
- **The machine-wide uninstaller's "also delete my projects and settings" checkbox.** It can only
  ever mean the data of the account running the uninstall. It never deletes another account's data,
  and an unattended uninstall never deletes anyone's (FR-016). Because every copy shares that one
  data folder, deleting it removes the data every other copy that user has installed would open.
- **A silent machine-wide install is attempted without administrator rights.** It fails loudly and
  installs nothing (Story 3, scenario 2).
- **The administrator prompt is declined during an interactive machine-wide install.** Nothing is
  installed; the installer says why and returns to the scope choice (FR-010a).
- **A copy from a release before this feature is on the machine** — an old archive, say. It still
  shares the one-running-throng rule with every newer copy, but it cannot show the "different copy"
  notice; when it is the one running, a newer launch just exits and the old window comes forward
  (FR-018b).
- **The portable or archive build is run while an installed copy is running.** It is one more copy:
  FR-018 applies, and it brings the running throng to the front with a notice.
- **Developing throng, and its automated tests.** A development build run from source and the
  automated test harness keep their own isolated namespace and are not counted by FR-018, so a
  developer can run a development build beside their installed throng and a test run can start many
  isolated app instances (FR-018a).

---

## Requirements *(mandatory)*

### Functional Requirements — install scope

- **FR-001**: Every installer format throng ships MUST let the person installing it choose between
  installing **for the current user only** (per-user) and **for every user of the machine**
  (machine-wide), subject to FR-003. *(Supersedes 020 FR-040's prohibition.)*
- **FR-002**: Per-user MUST remain the default wherever a choice is presented, and an install that
  makes no choice — interactive or unattended — MUST be per-user, in the same location 020 FR-040
  specified. **One exception:** an MSI run **elevated** (an administrator or SYSTEM) with no scope
  chosen installs machine-wide (FR-003a). *(Clarified 2026-10-20.)*
- **FR-003**: The per-user / machine-wide choice applies to formats that **install**: the setup and
  the MSI. The portable build and the archive install nothing — they run from wherever the user put
  them, register nothing and create no shortcut — so install scope does not apply to them, and they
  MUST continue to run without administrator rights for whoever runs them (042 FR-019). The
  documentation MUST say so rather than leave it implied.
- **FR-003a**: The MSI MUST offer **both** scopes, like the setup: per-user without elevation
  (FR-006) and machine-wide with it (FR-005), selectable interactively and through its unattended
  switches. When no scope is chosen, the MSI MUST install machine-wide if it is run elevated
  (an administrator or SYSTEM, as managed-deployment tools run it) and per-user otherwise, so the
  standard silent switch alone deploys for every user under Intune, SCCM or Group Policy, and a
  standard user never sees an administrator prompt. *(Clarified 2026-10-19: "every installer offers
  both options, if possible"; supersedes #351's 2026-09-02 per-machine-only decision. Default
  clarified 2026-10-20.)* *Platform limit, found in verification 2026-10-20:* Windows Installer
  fixes the install context before any package action runs under `/qn`, so the "per-user otherwise"
  half holds for an interactive run (the scope dialog sets it) but not for an **unattended** run by a
  standard account with no scope: that run asks for machine-wide and fails (`1625`), installing
  nothing — never a different scope, per FR-010. An unattended per-user install states
  `MSIINSTALLPERUSER=1`. The elevated default, the one managed deployment depends on, is unaffected.
  If the plan's
  research establishes that the MSI cannot offer the per-user scope while meeting FR-006, the plan
  MUST stop and put that finding to the user before falling back to a machine-wide-only MSI.
- **FR-004**: A machine-wide installation MUST place the application in a location outside every
  user's profile that every user of the machine can read and execute and that standard users cannot
  modify, and MUST give every account on the machine a launch shortcut and a single entry in the
  machine's list of installed applications.

### Functional Requirements — elevation

- **FR-005**: The machine-wide path MAY require administrator elevation, and MUST ask for it at most
  once per install, upgrade or uninstall. *(Supersedes 020 FR-012 for this path only.)*
- **FR-006**: The per-user path MUST NOT require or request administrator elevation in any format, at
  install, upgrade or uninstall. *(020 FR-012, retained for this path.)*
- **FR-007**: The application launched from a machine-wide installation MUST run at the privilege
  level it was launched with, exactly as a per-user installation does. In particular, an application
  started by the installer at the end of an elevated machine-wide install MUST NOT inherit the
  installer's elevation.

### Functional Requirements — unattended installation

- **FR-008**: The machine-wide path MUST be drivable non-interactively from a command line, with no
  window and no prompt, for both the setup and the MSI, and MUST exit with a success code on success
  and a non-success code on failure.
- **FR-009**: The MSI MUST honour the standard unattended install, upgrade and uninstall switches the
  managed-deployment tools use, so it can be deployed by them without a wrapper.
- **FR-010**: An unattended machine-wide install attempted without administrator rights MUST fail with
  a clear message and a non-success exit code, and MUST NOT fall back to a per-user install.
- **FR-010a**: When a person choosing the machine-wide scope **interactively**, in the setup or the
  MSI, declines the administrator prompt or cannot satisfy it, the installer MUST install nothing,
  say why the machine-wide install did not proceed, and return them to the scope choice so they can
  choose per-user or try again. It MUST NOT fall back to a per-user install on its own.
  *(Clarified 2026-10-20.)*
- **FR-011**: The silent switches for each format and scope MUST be documented in
  `docs/installation.md`.

### Functional Requirements — the background component on a shared install

- **FR-012**: A machine-wide installation MUST NOT install, register or start anything that runs for
  the machine rather than for a user: no service, no scheduled task, no machine-wide background
  process. Each user's background component is started on demand by that user's application, in that
  user's session, at that user's privilege level. *(020 FR-010, FR-011 — restated because a shared
  install root is the condition under which they are easiest to break.)*
- **FR-013**: Two accounts using one machine-wide installation at the same time MUST be fully
  isolated from each other — neither account's background component, terminals, projects, settings,
  themes, layouts or edit list visible to or disturbed by the other — and each account's personal data
  MUST live in that account's own profile. *(020 FR-013, proved for a shared install root.)*
- **FR-014**: Nothing MUST write to a machine-wide install root at run time. *(020 FR-008 — the
  install root is read-only to standard users, so a write would fail outright for every one of them.)*

### Functional Requirements — upgrade and removal

- **FR-015**: Upgrading a machine-wide installation MUST meet 020 FR-016–FR-019 and FR-022 for every
  user of the machine: every user's data preserved, nothing of the previous version left behind, a
  downgrade refused, and a running application or a live terminal handled without a partially
  replaced install. When the running application or live terminals belong to an account other than
  the one performing the upgrade, FR-016a governs; another account's processes MUST never be
  terminated.
- **FR-016**: Uninstalling a machine-wide installation MUST remove the application for every user and
  leave no process belonging to that installation running, and MUST NOT delete any user's personal
  data by default. The opt-in "also delete my projects and settings" choice (020 FR-021) MUST apply
  only to the data folder of the account performing the uninstall, and an unattended
  uninstall MUST NOT delete any user's personal data.
- **FR-016a**: When a machine-wide upgrade or uninstall finds the installation in use by an account
  **other than** the one performing it — a running application, background component or terminal:
  - **interactive**, it MUST refuse before changing anything, naming each account still using
    throng and saying to retry once they have closed it;
  - **unattended**, it MUST complete without terminating any process: files in use are replaced or
    removed at the next restart, the installer exits with the platform's standard "restart required"
    code, and until that restart the accounts still running throng keep running the version they
    started. After the restart the installation is wholly the new version (or wholly gone) — never a
    mix (020 FR-018, FR-022).
  The account performing the operation still gets 020 FR-019's three choices for its **own** live
  terminals.

### Functional Requirements — many copies, one running throng

- **FR-017**: A machine MAY carry any number of copies of throng, in any combination of format, install
  scope and version. No installer MUST refuse, warn or prompt because another copy exists, and no
  install, upgrade or uninstall of one copy MUST change, overwrite or remove another.
  *(Clarified 2026-10-19, locked in by the user.)*
- **FR-017a**: Each installer MUST give its copy, in each scope, an install folder and an entry in the
  list of installed applications of its own, so two installers never write to the same folder or
  share an entry. Running the same installer again in the same scope MUST upgrade, repair or
  reinstall that copy rather than add another.
- **FR-017b**: Every installed copy's shortcut and its entry in the list of installed applications
  MUST be labelled so a user can tell copies apart — at least its install scope, and which installer
  put it there where two copies would otherwise read the same.
- **FR-018**: Only **one** throng instance MAY run per signed-in user at any time, across every copy,
  whatever switches it was launched with. When a user starts throng while it is already running for
  them:
  - no second instance starts, and the running instance's window comes to the front;
  - if the launch was of a **different copy**, the running instance MUST show a notice — inline, in
    its own window — naming the copy that is running (its location and version) and saying to close
    it first to open the other;
  - a launch of the same copy only brings the window forward.
  *(Supersedes 003 FR-034's silent exit.)*
- **FR-018b**: FR-018 MUST also hold against copies of releases from before this feature. Every copy
  from this release onwards MUST additionally hold the single-instance lock those older releases
  use, so an older copy and a newer one never run at the same time for one user, whichever started
  first. When the running throng is an older copy, the new launch exits and the older copy behaves as
  it always has (it brings its window forward, with no notice); the "different copy" notice is only
  ever shown by a copy that implements this feature. *(Clarified 2026-10-20.)*
- **FR-018a**: A development build run from source and the automated test harness MUST keep their own
  isolated namespace, separate from every installed or extracted copy, and are not counted by FR-018.
  A developer MUST be able to run a development build while their installed throng is running, and
  the test harness MUST be able to run its isolated app instances in parallel. Neither MUST ever
  replace, connect to or end the installed copy's background component or terminals, nor the reverse.
  *(Clarified 2026-10-19: non-negotiable.)*
- **FR-019**: Each user has exactly **one data folder** — the same per-user locations throng uses
  today — and every copy MUST use it, so every copy a user starts shows the same projects, settings,
  layouts and terminals, and moving between copies needs no migration.
- **FR-020**: No copy MUST offer a user-facing way to use a different data folder. The existing
  overrides — Electron's `--user-data-dir` and the `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` and
  `THRONG_PIPE_NAME` variables — remain for development and the test harness only (FR-018a), and the
  documentation MUST describe them as such.
- **FR-021**: Each user has one background component, shared by every copy they run (020 FR-010,
  FR-013). Terminals started from one copy MUST be there to reattach to from any other copy of the
  same build.
- **FR-021a**: When a user starts a copy whose build differs from the background component already
  running for them, the new copy MUST replace that background component with its own, exactly as a
  stale build is replaced today, ending any live terminals without a prompt. The new copy MUST NOT
  connect to a background component of a different build. *(Clarified 2026-10-19: running two
  different copies is the user's choice, and so is the loss.)* *(Clarified 2026-10-21: this binds
  copies built from this feature on. A copy from before it, such as `v1.0.0-alpha10`, which cannot be
  changed, attaches to a newer copy's background component instead of replacing it, because its own
  rule (#192) never retires a component it did not start from its own folder; the newer copy's
  terminals are left running.)*
- **FR-022**: Downgrade refusal (020 FR-016a) governs replacing a copy **in place** only. Installing an
  older version as a separate copy — another installer, another scope, or an archive extracted
  elsewhere — MUST be allowed.

### Functional Requirements — the MSI artifact

- **FR-023**: A release MUST publish an MSI in addition to the per-user setup, the portable build and
  the archive.
- **FR-024**: The MSI MUST preserve the packaging layout every other artifact preserves — not
  archive-packed, the workspace packages shipped as they are, and the bundled host runtime that runs
  the background component (020 FR-009, 042 FR-020). An MSI that installs and then fails to start its
  background component is the failure this requirement exists to prevent.
- **FR-025**: The MSI MUST carry the product version internally, MUST be named for the version, and
  MUST support upgrade from an earlier MSI and refuse a downgrade of the copy it replaces
  (020 FR-004, FR-016a; FR-022).

### Functional Requirements — the release packaging pipeline

- **FR-026**: The MSI MUST be a role in the declared artifact set, and every pipeline step — packaging,
  reconciliation, verification, the publish gates and the release body — MUST resolve it by that role,
  never by wildcard, extension or position (042 FR-011, FR-012).
- **FR-027**: Packaging MUST fail when the MSI is not produced under its declared name, and when
  anything undeclared is produced (042 FR-013).
- **FR-028**: Verification MUST run for **every combination** of artifact and install scope that
  artifact supports, each on a clean environment, each to the full lifecycle end state 020 FR-024 and
  042 FR-014 require: install, launch, reported version, background component from the bundled
  runtime, a working terminal, reattach, uninstall, no residue.
- **FR-029**: Each machine-wide verification MUST additionally prove FR-012 and FR-013 with a second,
  standard (non-administrator) account: that account launches the shared installation, gets its own
  background component at its own privilege level, opens a working terminal, and does not see or
  disturb the first account's.
- **FR-030**: Each artifact-and-scope combination MUST record its own verdict, and an absent verdict
  for any combination MUST be treated as a failure (020 FR-027). Publication MUST be refused unless
  every combination's verdict passed, and the refusal MUST name the combination that did not
  (020 FR-031, 042 FR-016).
- **FR-031**: Before publication, verification MUST also prove the coexistence rule on one machine
  carrying a copy from every installer in every scope plus the archive: every copy installs without
  refusal and stays launchable at its own version (FR-017); upgrading and uninstalling one leaves the
  others intact (FR-017, FR-017a); a second launch of any copy starts no second instance (FR-018);
  and every copy opens the same data (FR-019).
- **FR-032**: The published release MUST carry the MSI as a downloadable artifact with its own SHA-256
  row against its own filename in the release body (020 FR-042, FR-042a, 042 FR-017). An artifact
  verified in two scopes is still one file with one checksum.
- **FR-033**: The release body MUST tell a reader which download suits them, including the
  administrator deploying machine-wide, and MUST keep stating the unsigned-application warning for
  every artifact (020 FR-043).
- **FR-034**: Nothing in this feature MAY assume a signed artifact. If a signer is later chosen
  (#118), the MSI is one more artifact for it to sign; it introduces no signing step here.

### Functional Requirements — documentation and runbook

- **FR-035**: `docs/installation.md` MUST tell a reader which install scope and which download they
  want, how to install, upgrade and uninstall machine-wide interactively and unattended, what an
  administrator prompt means for each path, that any number of copies may be installed but one
  throng runs at a time, and that every copy shares the user's one data folder. Its statement that there is
  no machine-wide install MUST be removed.
- **FR-036**: `docs/releasing.md` MUST document the widened artifact set and the artifact-by-scope
  verification matrix.
- **FR-037**: The release runbook (the `throng-release` skill and its `references/`) MUST be updated in
  the same change: the artifact table, the job list, what a passing verdict looks like per role and
  scope, the publish-gate refusals, any new way for a release to fail, and the list of open work that
  will change it (#351 and #361 removed once this lands).
- **FR-038**: `CHANGELOG.md`'s `## Unreleased` section MUST gain entries for machine-wide installation,
  the MSI, and side-by-side copies with one running instance.

### Key Entities

- **Install scope**: per-user or machine-wide. A property of one installed copy, chosen at install
  time; per-user is the default.
- **Copy**: one installed or extracted throng — its format, scope, install folder, version, shortcut
  and entry in the list of installed applications. A machine may carry any number.
- **Data folder**: the per-user locations holding all of a user's personal data. Exactly one per
  user, shared by every copy.
- **Running instance**: the one throng running for a signed-in user — one copy, at a time.
- **Artifact**: a downloadable file in a release, identified by its role in the declared artifact
  set. New role: the MSI. One file, one checksum, regardless of how many scopes it supports.
- **Verification combination**: one artifact verified in one install scope, with its own verdict.
  The publish gate requires every combination's verdict to have passed.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can install throng for every user of a clean machine, interactively or
  unattended, with exactly one administrator approval and no other prompt.
- **SC-002**: After a machine-wide install, a second standard account can launch throng and open a
  working terminal without installing anything, on the first attempt.
- **SC-003**: Managed-deployment tooling can install, upgrade and remove the MSI with no person at the
  machine, with a success exit code each time.
- **SC-004**: A user installing throng for themselves is asked for an administrator password **zero**
  times, in every format.
- **SC-005**: On a machine carrying a copy from every installer and scope, **zero** installs are
  refused because another copy exists, and in **zero** cases does installing, upgrading or removing
  one copy change another.
- **SC-006**: However many copies are installed, a user can never have more than **one** throng
  running at once, and every refused second launch of a different copy tells them which copy is open.
- **SC-007**: Every copy a user starts shows the **same** projects, settings and terminals.
- **SC-008**: **Every** artifact-and-scope combination carries a passing verdict before any release
  publishes; a release with one missing or failed combination publishes **zero** artifacts. The two
  gaps the Assumptions allow — a second-account check, and the not-elevated launch check, that the
  hosted runner cannot exercise — are a pass only while each is reported by name on every run.
- **SC-009**: Every published artifact, including the MSI, has exactly one SHA-256 row in its
  release's notes, against its own filename.
- **SC-010**: Two accounts working concurrently on one machine-wide install see **none** of each
  other's projects, settings or terminals.
- **SC-011**: A release cut by following the runbook after this feature lands needs no step the
  runbook does not describe.

---

## Assumptions

- **The data folder is unchanged.** It is the per-user locations throng already uses
  (`%APPDATA%\throng` and `%USERPROFILE%\.throng`), for every copy and every scope, so existing users
  need no migration.
- **"Per signed-in user" means per account**, matching the constitution's single-instance rule. An
  account signed into two sessions at once is still one user.
- **The machine-wide install location is the platform's standard location for applications installed
  for all users.** The plan names it, and the per-installer folder separation of FR-017a.
- **The development and test overrides keep working.** The test harness depends on `--user-data-dir`
  and the `THRONG_*` variables to run isolated app instances; the plan decides how FR-018's lock tells
  those runs apart from an installed or extracted copy launched with the same switches (FR-018a,
  FR-020).
- **Managed deployment means the MSI's standard unattended switches.** No vendor-specific deployment
  package (an Intune `.intunewin`, an SCCM application definition) is produced; administrators wrap
  the MSI with their own tooling.
- **Verification can create a second standard account on the clean environment** to prove FR-029. The
  hosted release runners are administrators with UAC disabled, so the plan must establish how a
  genuinely non-administrator second account is exercised there; if it cannot be, that gap is
  reported on every run, as the `skipIfElevated()` gap already is, rather than assumed covered.
  The same runner property limits FR-007's check: with UAC disabled the desktop itself is high
  integrity, so "the launched app runs at medium" cannot be shown there. That step is the second
  allowed gap — reported by name on every run, and only while the runner's desktop is above medium
  (found in the first rehearsal, 2026-10-20).
- **A machine-wide upgrade or uninstall never terminates another account's live terminals**, because
  that destroys work the administrator cannot see. The three-choice prompt only makes sense for the
  performing account's own terminals; everyone else is covered by FR-016a's refuse-or-restart rule.
  The restart path cannot be exercised on a hosted runner, which cannot reboot mid-job; the plan says
  how it is proved.
- **Release-pipeline runtime grows.** Verification gains three combinations (setup machine-wide, MSI
  per-user, MSI machine-wide) and the coexistence run. The existing release run is ~45 minutes from
  tag to approval gate; the plan measures the new figure rather than estimating it.
- **The release runbook comment on #351 and #361 names `.claude/agents/throng-build-release.md`.** That
  agent no longer exists — area agents were converted to repo-local skills on 2026-09-28 — so the
  runbook obligation falls on the `throng-release` skill alone.

---

## Scope

**In scope**: both install scopes for the setup and the MSI; the per-user default retained;
unattended machine-wide install, upgrade and uninstall; the MSI artifact; side-by-side copies with one
running instance per user and one shared data folder; per-user background-component isolation
proved on a shared install root; the release
pipeline (declared artifact set, packaging, reconciliation, verification matrix, publish gates,
release body); `docs/installation.md`, `docs/environment.md`, `docs/releasing.md`, the
`throng-release` runbook and `CHANGELOG.md`.

**Out of scope**: code signing (#118) — nothing here assumes a signature; automatic update (#119),
whose behaviour will differ by scope; macOS (#22) and Linux (#23); Microsoft Store / MSIX; package
managers — winget (#509), Scoop (#510) and Chocolatey (#511); Squirrel, the wrapped MSI, the web
installer and further archive formats (see Clarifications); vendor-specific deployment packages;
machine-wide *configuration* (policy-managed settings) — this feature shares the application, not
any user's preferences; any user-facing way to choose a different data folder;
changes to the portable or archive artifacts beyond what FR-018–FR-021 require of every copy.

---

## Dependencies

- **Spec 020** (application packaging) — the requirements this feature supersedes and the ones it
  must keep.
- **Spec 042** (release notes and multi-artifact publication) — the declared artifact set and
  role-based resolution this feature extends with one role and one dimension.
- **Spec 003** (layout and app tweaks) — FR-034, the single-instance behaviour this feature
  supersedes.
- **#118** (code signing) — independent; it will sign whatever artifact set exists when it lands.
- **#119** (automatic update) — will need to respect install scope and side-by-side copies: an update
  of a machine-wide copy changes the application for every user and needs elevation, and an update
  of one copy must not touch another.
