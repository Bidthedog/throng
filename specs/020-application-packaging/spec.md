# Feature Specification: Application Packaging

**Feature Branch**: `worktree-21-app-packaging`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Create a new worktree and start on the application packaging issue #21. I want to be able to version the app, package it up, and install it. Publishing to github releases should only occur once the app is QA'd, and the installer is verified, and the package has been versioned. We need to outline and plan which components will be installed where, and how they will be installed (i.e. is the daemon a win service? Do we need installers for each OS?)."

**Tracking**: [#21 Application Packaging](https://github.com/Bidthedog/throng/issues/21) — milestone v1.0.0, `area:infra`. This feature is the `packageable and releasable MVP` that defines v1.0.0.

## Clarifications

### Session 2026-07-17

- Q: Where does the running application display its product version? → A: An **"About throng" dialog** reached from the application menu, showing the product version and build id (selectable text), a **copyright notice**, a **licence link**, and the **full licence text in a read-only, scrollable box**.
- Q: What does uninstalling do with the user's projects, settings and themes? → A: The uninstaller offers a **checkbox "also delete my projects and settings", defaulting to keep (unchecked)**. A plain uninstall retains all personal data; removal happens only if the user deliberately ticks the box.
- Q: Can we use Let's Encrypt for code signing? → A: Moot — **code signing is dropped entirely** (too restrictive: paid identity, business-day provisioning, eligibility limits, hardware-key custody). Released artifacts are unsigned; integrity is instead provided by a published checksum (FR-042). *(For the record, Let's Encrypt could not have signed regardless: it issues TLS certificates with the `serverAuth` extended key usage, not the `codeSigning` usage Authenticode requires, and its roots are not trusted by Windows for code signing.)*
- Q: Should an installed copy have diagnostics (logging / crash reports) so install and start-up failures are reportable? → A: Yes — **full structured logging (levels, rotation, retention) plus crash reports, but NO in-app log viewer.** Split out as its own issue on the v1.0.0 milestone (see Dependencies); not built inside this feature.

#### What "checksum, not signature" does and does not buy *(recorded so it is not re-litigated)*

A published checksum lets a downloader confirm the file arrived **intact and unmodified against the value we published**. It deliberately does **not**:

- prove **who** published the artifact (a checksum carries no publisher identity);
- suppress the operating system's unrecognised-application warning — an unsigned installer warns on every download, and reputation never accrues;
- defend against an attacker who can replace the artifact **and** the checksum beside it on the same release page.

What it defends against is **accidental corruption in transit** and **tampering on untrusted mirrors** — the file a user downloaded is byte-for-byte the file we released. This is an accepted trade for a solo open-source project; the warning (FR-043) is its price. This decision replaces an earlier draft that required code signing from v1.0.0; all signing requirements, the signing gate, and the signing issue were removed.

### Session 2026-07-18

- Q: When an older installer is run over a newer installed throng (a downgrade), what must happen? → A: **Refused.** In-place downgrade is not supported; to run an older version the user must uninstall the current version first. A refused downgrade leaves the existing (newer) installation and all per-user data untouched.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The build has a name (Priority: P1)

Every build of throng carries one unambiguous product version. A person looking at a running copy of throng, at the file they downloaded, and at the release it came from can tell — without guessing — that they are all the same thing. Today every part of the product reports version `0.0.0` and the running application shows no version at all, so a bug report cannot be tied to a build.

**Why this priority**: Nothing downstream works without it. A package cannot be named, an installer cannot decide whether it is an upgrade, a release cannot be tagged, and a bug report cannot be traced to a build. It is also the smallest slice that delivers standalone value: even with no installer at all, a version visible in the application makes defect reports actionable.

**Independent Test**: Build the product, open it, and read the version from the application's own interface. Confirm the value matches the single place the version is declared. Delivers traceability with no packaging work in place.

**Acceptance Scenarios**:

1. **Given** the product version is declared as some value, **When** the application is built and launched, **Then** the running application displays exactly that version to the user.
2. **Given** the product version is declared as some value, **When** any component of the product reports its version, **Then** every component reports the same value.
3. **Given** a build has been produced, **When** the version is changed and the product rebuilt, **Then** the application reports the new value with no other edit required anywhere in the product.
4. **Given** a running application, **When** the user opens the "About throng" dialog from the application menu, **Then** the product version and build id are shown as selectable text they can copy into a bug report, alongside a copyright notice, a licence link, and the full licence text in a read-only scrollable region.

---

### User Story 2 - Install throng on a clean machine and use it (Priority: P2)

A person who has never developed software downloads a single installer, runs it, and gets a working throng: a launchable application, its icon on the executable and in the taskbar, and working terminals. They do not install a language runtime, a compiler, or any other prerequisite, and they are not asked for an administrator password.

**Why this priority**: This is the feature's headline value and the substance of the v1.0.0 milestone — throng today is only runnable from a developer checkout. It is independently testable and independently valuable: an installer that installs a correct, working copy is shippable even before upgrade, uninstall, or automated publishing exist.

**Independent Test**: On a machine with no development tools, no compiler and no separately installed language runtime, run the installer and then launch throng from the shortcut it created. Create a project and spawn a terminal. Everything works.

**Acceptance Scenarios**:

1. **Given** a clean supported machine with no development tools installed, **When** the user runs the installer and launches throng, **Then** the application starts and a terminal can be spawned in a project.
2. **Given** a clean machine, **When** the user runs the installer, **Then** they are not prompted for administrator credentials at any point.
3. **Given** an installed throng, **When** the user closes the application while a terminal has a live process, **Then** that terminal keeps running and is reattached when throng is reopened — exactly as it behaves from a developer checkout.
4. **Given** an installed throng, **When** the user inspects the installation, **Then** every executable component the product needs is present within one install location, and no component requires anything to be fetched at first run.
5. **Given** an installed throng, **When** the application runs and the user changes settings, creates projects, and edits themes, **Then** none of that data is written inside the install location.
6. **Given** two different user accounts on one machine, **When** each installs and runs throng and each spawns terminals, **Then** neither user's terminals, projects, or settings are visible to, or disturbed by, the other.

---

### User Story 3 - Upgrade and remove throng without losing work or leaving debris (Priority: P3)

An existing throng user installs a newer version over their current one and finds all their projects, layouts, settings, themes and keybindings intact. A user who no longer wants throng uninstalls it, and nothing of throng's is left running or installed afterwards.

**Why this priority**: The first release only needs to install (US2); upgrade only matters once a second release exists. But it must be specified before the first release ships, because the first installer's decisions determine whether the second one can upgrade cleanly. Independently valuable and independently testable against any two builds.

**Independent Test**: Install version A, create projects and change settings, install version B over it, confirm all data survived and the application reports version B. Then uninstall and confirm nothing of throng's remains running or installed.

**Acceptance Scenarios**:

1. **Given** an installed throng with projects, layouts, settings, keybindings and custom themes, **When** a newer version is installed over it, **Then** all of that data is preserved and the application reports the new version.
2. **Given** an installed throng, **When** it is upgraded, **Then** no component of the previous version is left behind in the install location.
3. **Given** throng is running when an upgrade is started, **When** the upgrade proceeds, **Then** the user is told that throng is running and the upgrade either completes correctly or refuses cleanly — it never produces a half-replaced installation.
4. **Given** throng has terminals with live processes when an upgrade or uninstall is started, **When** the user proceeds, **Then** they are warned that live terminals are affected and given the same choices the application already offers when it is closed with live terminals — and no terminal process is left orphaned by whichever choice they make.
5. **Given** an installed throng, **When** the user uninstalls it, **Then** every executable component is removed, no throng process remains running, and the shortcut is gone.
6. **Given** the user runs the uninstaller and leaves the "also delete my projects and settings" checkbox unticked (its default), **When** the uninstall completes, **Then** their projects, settings, themes and other personal data are retained, so a reinstall restores their world.
7. **Given** the user runs the uninstaller and deliberately ticks "also delete my projects and settings", **When** the uninstall completes, **Then** their personal data is removed as well — and this removal happens only because of that explicit tick, never by default.

---

### User Story 4 - Prove the installer works before anyone ships it (Priority: P4)

Before a build can be considered releasable, the installer is exercised end-to-end on a clean machine automatically, not by someone remembering to try it. The result is a recorded, inspectable verdict attached to that specific versioned package.

**Why this priority**: This is the gate the user asked for, and it must exist before publishing is automated (US5) or the gate is decoration. It is independently valuable — a verified-installer signal has worth even while publishing stays manual — and independently testable by deliberately breaking an installer and confirming the verification catches it.

**Independent Test**: Take a known-good package, run the verification, observe a pass. Take a deliberately broken package (a missing component), run the same verification, observe a fail that names the problem.

**Acceptance Scenarios**:

1. **Given** a built package, **When** installer verification runs, **Then** it installs the package on a clean machine, launches the application, confirms it reports the expected version, exercises a core journey, uninstalls it, and confirms no process or component is left behind.
2. **Given** a package whose installer is broken in any of those respects, **When** verification runs, **Then** it fails and names which step failed.
3. **Given** verification has run, **When** anyone asks whether a specific versioned package is verified, **Then** the verdict is recorded against that exact package and can be inspected without re-running the verification.
4. **Given** a package that has not been verified, **When** anyone asks whether it is verified, **Then** the answer is a definite "no", never an absent or ambiguous result read as consent.

---

### User Story 5 - Publishing is gated, not permitted (Priority: P5)

A release reaches GitHub Releases only when every condition is true: the package carries a real version, the installer has been verified, and a human has signed off that the application has been QA'd. If any condition is unmet, publishing does not happen — and the refusal says which condition failed. Each published artifact carries a checksum in the release notes so downloaders can confirm integrity.

**Why this priority**: It depends on all four preceding stories to have anything to gate. It is independently testable by attempting to publish with each condition unmet in turn.

**Independent Test**: Attempt to publish with each condition unmet in turn, and confirm each attempt is refused with the specific reason. Then satisfy all of them and confirm the release publishes with the correct artifacts.

**Acceptance Scenarios**:

1. **Given** a versioned package, a verified installer and a recorded human QA sign-off, **When** publishing runs, **Then** a GitHub Release is created for that version carrying the installer and its checksum, and the release version matches the version inside the package.
2. **Given** a package with no recorded QA sign-off, **When** publishing is attempted, **Then** it is refused and the refusal states that QA sign-off is missing.
3. **Given** a package whose installer verification failed or never ran, **When** publishing is attempted, **Then** it is refused and the refusal states that the installer is not verified.
4. **Given** a package carrying a placeholder or absent version, **When** publishing is attempted, **Then** it is refused and the refusal states that the package is not versioned.
5. **Given** a version that has already been published, **When** publishing that same version is attempted again, **Then** it is refused rather than silently replacing the existing release.
6. **Given** a published release, **When** a user inspects it, **Then** they can identify the exact source the artifacts were built from, and the checksum of each downloadable artifact matches the artifact's actual bytes.
7. **Given** every condition is met, **When** publishing runs, **Then** no step of the release requires a person to copy, rename, or upload an artifact by hand.

---

### Edge Cases

- **Upgrading while terminals are live.** The background component holds the user's running terminal processes. Replacing it mid-session is exactly the situation Principle III protects against. The user MUST be warned and offered the same three choices the application already offers on close with live terminals (leave running / terminate all / cancel and review), and whichever they choose MUST NOT orphan a process or a terminal window.
- **Uninstalling while terminals are live.** As above. An uninstall that leaves a detached background process or a terminal host running has failed, even if the file removal succeeded.
- **Two installations of the same product on one machine** (two user accounts; or a user account and an elevated run). The background component's endpoint is currently machine-wide and would collide. Installing per user makes this reachable by ordinary users rather than only by developers.
- **The same version published twice.** Must be refused, not silently overwritten — a published artifact that changes under a fixed version destroys the traceability US1 exists to provide.
- **A downgrade** (installing an older version over a newer one). MUST be refused, never attempted in place — an in-place downgrade risks reading user data the newer version wrote in a format the older version cannot understand. To run an older version the user must uninstall the current version first (FR-016a). A refused downgrade MUST leave the existing installation and its data untouched; it MUST NOT produce a mixed installation.
- **The installer is interrupted** (cancelled, power loss, disk full). Must not leave a partially-installed product that launches and misbehaves.
- **The operating system's download protection challenges the installer.** Because artifacts are unsigned, the unrecognised-application warning appears on every download and reputation never accrues. An installer users cannot get past is an installer that does not install — so the warning must be anticipated and explained (FR-043) rather than discovered.
- **Reputation-based protection blocks the installer outright** rather than warning. On Windows 11, the stricter reputation-based protection available to users can block an unsigned, no-reputation file instead of offering a click-through. This is not something the product can defeat, and MUST NOT be worked around by telling users to disable a security feature; it is a known limitation of shipping unsigned (FR-042).
- **The published checksum and the published artifact disagree.** A downloader who verifies would get a false alarm, and one who trusts the checksum receives no protection. The checksum MUST be computed from the exact bytes that are published, as the last step that reads those bytes (FR-042a), so the two cannot drift.
- **The declared version and the artifact's filename disagree.** Must be impossible by construction or caught by verification, never shipped.
- **Publishing is attempted from something other than the reviewed, released source** (a local machine, a feature branch, a dirty tree). The gates must not be bypassable by changing where publishing is run from.
- **A QA sign-off recorded against a different build than the one being published.** Sign-off must bind to the exact package, or it certifies nothing.

## Requirements *(mandatory)*

### Functional Requirements

#### Versioning

- **FR-001**: The product MUST have exactly ONE authoritative declaration of its product version. Every component, artifact, and published release MUST derive its version from that single declaration; no component may declare its own.
- **FR-002**: The product version MUST follow a published, ordered numbering scheme such that any two versions can be compared to determine which is newer.
- **FR-003**: The running application MUST display its product version to the user through an **"About throng" dialog** reachable from the application menu. The dialog MUST show the product version and the internal build identifier (FR-006) as **selectable text** that can be copied into a bug report.
- **FR-003a**: The About dialog MUST also show a **copyright notice** for the product and a **link to the product's licence**, and MUST present the **full licence text in a read-only, scrollable region** within the dialog. *(The product is distributed under AGPL-3.0-only, which requires the licence to travel with the software; the About dialog is where a running copy makes it available.)*
- **FR-004**: Every built artifact MUST carry its product version internally, so that a copy separated from its filename can still be identified.
- **FR-005**: Changing the product version MUST require an edit in exactly one place; a build MUST NOT be able to succeed with the version disagreeing between any two components.
- **FR-006**: The product version MUST be distinct from, and MUST NOT replace, the existing internal build identifier used to detect a stale background component. Two builds of the same product version MUST still be distinguishable by that identifier.

#### Component placement & install model

- **FR-007**: All executable components MUST be installed beneath a single install root. No component may be placed outside it.
- **FR-008**: No component MAY write to the install root at run time. All state written while the application runs MUST go to the per-user data locations the product already uses.
- **FR-009**: The installation MUST be self-contained: every runtime, library, and native component the product needs MUST be present after install, with nothing fetched, compiled, or separately installed at first run. In particular, the product MUST NOT require the user to have a language runtime installed, and MUST NOT depend on one being discoverable on the system's search path.
- **FR-010**: The background component (the daemon) MUST run in the invoking user's own interactive desktop session, at the user's own privilege level, started on demand by the application, and MUST continue running after the application closes.
- **FR-011**: The background component MUST NOT be installed as a machine-wide, always-on operating-system service, and MUST NOT run under a different account or session from the user it serves. *(Rationale: a service runs outside the user's interactive session and at a privilege level of its own. Both are incompatible with the existing constitutional requirements that a terminal's elevation follows the application (Principle III) and that terminals are the user's own interactive processes. It would also start for users who never launch throng.)*
- **FR-012**: Installation MUST NOT require administrator elevation.
- **FR-013**: Two different user accounts on the same machine MUST each be able to install, run, and use throng — including live terminals — without either account's background component, terminals, projects, or settings being visible to or disturbed by the other. This requires the background component's endpoint to be scoped to the user rather than to the machine.
- **FR-014**: The installer MUST create a launch affordance (a shortcut) that starts the application, and the installed executable MUST carry the product's icon.
- **FR-015**: The installed product MUST be listed in the operating system's standard list of installed applications, from which it can be removed.

#### Installation, upgrade & removal

- **FR-016**: Installing a version over an existing installation MUST preserve all per-user data — projects, sub-workspaces, layouts, window state, settings, keybindings, custom themes, and the edit list — with no user action required.
- **FR-016a**: Installing a version **older** than the currently installed version (a downgrade) MUST be refused. The installer MUST detect the version ordering (FR-002) and MUST NOT replace a newer installation in place. In-place downgrade is not supported: to run an older version the user must uninstall the current version first. A refused downgrade MUST leave the existing installation and all per-user data untouched.
- **FR-017**: An upgrade MUST leave no component of the previous version behind in the install root.
- **FR-018**: When an upgrade or an uninstall is started while the application is running, the user MUST be informed, and the operation MUST either complete correctly or refuse cleanly. It MUST NOT produce a partially-replaced installation.
- **FR-019**: When an upgrade or an uninstall is started while one or more terminals have live processes, the user MUST be warned and offered the same three choices the application already offers when closed with live terminals: leave them running, terminate all, or cancel and review.
- **FR-020**: An uninstall MUST remove every installed executable component, leave no throng process running (including the background component, any detached helper, and any terminal host process), and remove the launch affordance. *(This is Principle III's resource-hygiene rule applied to removal: an uninstall that leaves a detached process running has failed.)*
- **FR-021**: An uninstall MUST NOT silently discard the user's personal data. The uninstaller MUST default to **retaining** all personal data, and MUST remove it only when the user has deliberately opted in via a **checkbox ("also delete my projects and settings") that is unticked by default**. A user who runs the uninstaller and accepts the defaults MUST keep all their data; personal data MUST NOT be removed without that explicit affirmative tick.
- **FR-022**: An interrupted or failed installation MUST NOT leave behind a partially-installed product that launches. It MUST either roll back or leave the previous installation intact.

#### Installer verification

- **FR-023**: Installer verification MUST run automatically against a built package on a clean environment, without a person choosing to run it.
- **FR-024**: Verification MUST exercise the full lifecycle end to end: install, launch, confirm the reported version matches the expected version, exercise at least one core user journey, uninstall, and confirm no component or process is left behind.
- **FR-024a**: Verification MUST confirm that the checksum recorded for each downloadable artifact **matches the actual bytes of that artifact** — this is the same value later published in the release notes (FR-042), computed once from the exact bytes (FR-042a); verification runs before publication, so it validates the recorded checksum, not a not-yet-published one. A missing checksum, or a checksum that does not match, MUST fail verification.
- **FR-025**: A verification failure MUST name which step failed.
- **FR-026**: The verification verdict MUST be recorded against the exact package it was run on, and MUST be inspectable afterwards without re-running it.
- **FR-027**: An absent verification result MUST be treated as a failure, never as a pass. *(Rationale: absence of evidence must not read as consent — see also the constitutional rule that a skipped privilege-gated test never implies coverage.)*

#### QA sign-off & publication gates

- **FR-028**: Publishing a release MUST be refused unless ALL of the following hold: (a) the package carries a real, non-placeholder product version; (b) installer verification passed for that exact package; (c) a human QA sign-off is recorded for that exact package.
- **FR-029**: The QA sign-off MUST be an explicit act by a person. It MUST NOT be satisfiable by an automated check, by a default, or by the passage of time.
- **FR-030**: A QA sign-off MUST bind to the exact package it certifies. A sign-off recorded against a different build MUST NOT satisfy the gate.
- **FR-031**: A refusal to publish MUST state which condition was unmet.
- **FR-032**: Publishing MUST create a GitHub Release for the product version, carrying the installer as a downloadable artifact, together with the checksum of that installer (FR-042).
- **FR-033**: The version of a published release MUST equal the version inside the package it carries. A mismatch MUST prevent publication.
- **FR-034**: Publishing a version that has already been published MUST be refused rather than replacing the existing release.
- **FR-035**: A published release MUST identify the exact source revision its artifacts were built from.
- **FR-036**: Once the gates are satisfied, publication MUST require no manual copying, renaming, or uploading of artifacts.
- **FR-037**: The publication gates MUST NOT be bypassable by running the publication from a different place (for example, from a developer machine or an unreviewed branch).

#### Platform scope

- **FR-038**: The product MUST produce an installer for Windows 11, the only platform on which throng currently runs.
- **FR-039**: The packaging design MUST NOT foreclose adding macOS or Linux installers later. Platform-specific packaging decisions MUST sit behind the same abstraction discipline the rest of the product follows (Principle II), so that adding a platform adds an implementation rather than reworking the versioning, verification, and publication gates. *(Only one installer per supported platform is needed; there is no second Windows installer format in scope.)*

#### Install scope, update behaviour & artifact integrity *(resolved 2026-07-17)*

- **FR-040**: The installer MUST install **per user only**, into a location within the invoking user's own profile. It MUST NOT offer or require a machine-wide installation. Each user account on a machine that wants throng installs their own copy. *(This is what makes FR-012's no-administrator rule achievable, and it matches the per-user, session-scoped background component of FR-010.)*
- **FR-041**: Automatic update is **OUT OF SCOPE** for this feature. A user upgrades by downloading and running the installer for a newer version (US3). The product MUST NOT check for, download, or install updates by itself, and this feature MUST NOT add any network call to the application. *(Tracked separately — see Dependencies. FR-039's platform-neutral gates and FR-004's internally-carried version are what a later auto-update feature will build on, so deferring it costs nothing here.)*
- **FR-042**: Released artifacts are **NOT code-signed**. Instead, for every downloadable artifact the publication process MUST compute a cryptographic checksum (a published, collision-resistant digest — SHA-256 or stronger) and publish it **alongside** the artifact in the GitHub Release notes, so a downloader can confirm the file they received is byte-for-byte the file that was released. The checksum MUST be generated automatically as part of publication, not by hand. *(A checksum proves integrity against the published value; it does not prove publisher identity and does not remove the operating system's unrecognised-application warning — see the Clarifications note and FR-043.)*
- **FR-042a**: Each published checksum MUST be computed from the **exact bytes of the artifact that is published** — the checksum and the artifact MUST NOT be able to disagree. The generation MUST be the last step that reads an artifact's bytes, after any renaming or repackaging.
- **FR-043**: Because artifacts are unsigned, the operating system will show an unrecognised-application warning on download, and reputation never accrues. The published release and the project's own documentation MUST state what warning the user will see and how to proceed past it, MUST NOT instruct the user to disable a security feature, and MUST explain how a user can verify the downloaded file against the published checksum if they wish. *(A user who meets an unexplained warning either abandons the install or learns to click through warnings blindly. Neither is acceptable.)*

### Key Entities

- **Product Version**: The single authoritative, ordered identifier for a build of throng. Declared in exactly one place; carried by every component, artifact and release; displayed to the user. Distinct from the internal build identifier that detects a stale background component.
- **About Dialog**: The application-menu-reachable surface that presents the running copy's identity — product version and build id as selectable text — plus a copyright notice, a licence link, and the full licence text in a read-only scrollable region. The single place a running copy makes its version and licence available to the user.
- **Distributable Package**: The single file a user downloads and runs to install throng. Carries a product version internally and in its name; contains the complete installed component set.
- **Installed Component Set**: Everything placed on disk by an install — the application, the background component, the native components, the runtime the background component needs, and the product icon — all beneath one install root, none of it written to at run time.
- **Per-User Data**: The user's projects, sub-workspaces, layouts, window state, settings, keybindings, custom themes, edit list and recovery data. Lives outside the install root; survives upgrade; retained by default on uninstall and removed only when the user ticks the uninstaller's opt-in checkbox (FR-021).
- **Verification Verdict**: The recorded, inspectable result of exercising a specific package's full install lifecycle on a clean environment. Bound to one package. Absent means failed.
- **QA Sign-off**: An explicit act by a person certifying that a specific package has been QA'd. Bound to one package. Not automatable, not defaultable.
- **Artifact Checksum**: A published cryptographic digest (SHA-256 or stronger) of a downloadable artifact, computed from the exact bytes that are published and shown in the release notes beside the artifact. Lets a downloader confirm integrity against the published value. Not a signature: it carries no publisher identity and does not affect the operating system's trust prompt.
- **Published Release**: A GitHub Release for one product version, carrying that version's package and the checksum of each downloadable artifact, identifying the source it was built from. Created only when version, verification verdict and QA sign-off are all satisfied. Immutable once published.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with no development tools on a clean Windows 11 machine can go from downloaded installer to a running throng with a live terminal in under 3 minutes, without being prompted for an administrator password and without installing any prerequisite. This includes passing the operating system's unrecognised-application warning, which an unsigned installer triggers on every download (FR-043); the user MUST be able to get past it using only what the release notes tell them, with no guesswork and no instruction to disable a security feature.
- **SC-001a**: 100% of published downloadable artifacts have a matching checksum published beside them in the release notes, generated automatically. A downloader computing the digest of the file they received obtains the published value for 100% of releases; a corrupted or altered download does not match.
- **SC-002**: The version displayed in the application, the version inside the package, the version in the package's filename, and the version of the published release are identical for 100% of published releases, verified automatically rather than by inspection.
- **SC-003**: Upgrading between any two releases preserves 100% of per-user data — projects, sub-workspaces, layouts, settings, keybindings, custom themes and the edit list — with zero user action.
- **SC-004**: After an uninstall, zero throng executable components remain in the install root and zero throng processes remain running, measured at the process level rather than from the interface.
- **SC-005**: Zero releases can be published without every gate satisfied — version, verification and QA sign-off. Every attempt with a gate unmet is refused and names the unmet gate.
- **SC-006**: Two user accounts on one machine can each run throng with live terminals concurrently, with zero cross-account interference in terminals, projects or settings.
- **SC-007**: 100% of installer verification runs exercise install, launch, version check, a core journey, uninstall and a no-residue check; a package with any one of those broken fails verification 100% of the time.
- **SC-008**: The artifacts of any published release can be rebuilt from the source revision that release identifies, producing the same installed component set.
- **SC-009**: Closing the application with a live terminal, then reopening it, reattaches that terminal in an installed copy exactly as it does from a developer checkout — the packaged product loses none of the behaviour guaranteed by Principle III.

## Assumptions

These are reasonable defaults chosen where the feature request did not specify. Each is a decision that can be revisited at planning time.

- **Windows 11 is the only packaged platform in this feature.** Answering the user's question directly: no, we do not need an installer for each operating system — we need one for each operating system throng *runs on*, and today that is Windows only. macOS and Linux are unchecked on the roadmap and have no platform implementation; there is nothing to package. FR-039 keeps that door open.
- **The daemon is not, and must not become, a Windows service.** Answering the user's other question directly: no. It is an on-demand, per-user, session-scoped background process that outlives the UI — which is what it already is. A service would run in a different session at a different privilege level, breaking the constitutional rule that a terminal's elevation follows the application, and would start for users who never launch throng. FR-010/FR-011 pin this.
- **The background component's runtime ships with the product.** The daemon currently requires a host language runtime found on the system's search path, and its native components are built against that runtime. A shipped desktop application cannot require its users to install a developer runtime, so the runtime becomes part of the installed component set (FR-009). This is the single largest technical consequence of packaging and will need a decision at planning time about how the two runtimes coexist.
- **The version is declared by the release process and bumped deliberately by a person**, not derived automatically from commit history. The current version everywhere is `0.0.0`; the first published version is expected to be the v1.0.0 milestone.
- **Publication is triggered from the reviewed default branch** through the project's existing continuous-integration system, which is where the gates can be enforced (FR-037).
- **"QA'd" means a human sign-off**, in addition to — not instead of — the automated gates. The automated suites and installer verification prove the build is sound; the sign-off is the person's statement that it is fit to release.
- **Installer verification runs on a clean environment provisioned per run**, so that a passing verification cannot depend on state left behind by a developer machine or a previous run.
- **Backup and restore of user data is out of scope**, and remains its own roadmap item. This feature only requires that an upgrade not destroy data and that an uninstall not discard it silently.
- **No telemetry, update check, or network call is added to the application** by this feature. With auto-update out of scope (FR-041), the installed product makes no outbound connection it does not make today.

### Why the three escalated decisions were resolved as they were *(2026-07-17)*

- **Per-user install (FR-040).** Chosen over per-machine and over offering both. It is the only scope that keeps FR-012's no-administrator rule, it mirrors the per-user session-scoped background component (FR-010), and offering both would roughly double the install/upgrade test matrix while requiring a rule for what happens when both are present. The cost is that FR-013's per-user endpoint scoping becomes mandatory rather than optional: the background component's endpoint is machine-wide today, so two users each running their own installed copy would collide. That is a real defect this feature must fix, not a future nicety.
- **Auto-update deferred (FR-041).** Issue #21's body names auto-update, but it is a capability of its own: an update feed, background download, signature trust, and — the genuinely hard part — a restart path that replaces the background component while it holds the user's live terminal processes, which Principle III forbids disturbing. Nothing in this feature forecloses it. Split into its own issue so the roadmap reflects what #21 actually delivers.
- **Checksum instead of signing (FR-042), resolved 2026-07-17.** An earlier draft required code signing from v1.0.0; that was reversed. Signing was dropped as too restrictive for a solo open-source project — it requires a paid publisher identity, business-day identity provisioning, a certificate-authority hardware-key custody regime, and (for the cheapest automatable route) admits individual developers only in a limited set of countries. In its place, publication generates and publishes a checksum for every downloadable artifact. The trade was made with eyes open: a checksum proves the download is intact against the published value but proves nothing about *who* published it, and — unlike a signature — buys no progress against the operating system's unrecognised-application warning, which will now appear on every release indefinitely (FR-043). For a solo OSS project that trade is acceptable; the warning is the price, and it is explained to users rather than hidden. (For completeness: the specific alternatives raised — Let's Encrypt, self-signed, sigstore, EV — could not have delivered a usable Windows signature anyway; see the Clarifications note. Dropping signing means none of that matters now.)

## Dependencies

- **Issue #21** — the tracking issue; milestone v1.0.0.
- **Issue #119 — Automatic update** (milestone vNext, sub-issue of #21). Split out of #21 and explicitly out of scope here (FR-041). Depends on this feature shipping first — there is nothing to update from until a release exists. Nothing here forecloses it.
- **Issue #123 — Diagnostics: logging & crash reports** (milestone v1.0.0, sub-issue of #21). An installed throng launched from a shortcut has no console, so the daemon's start-up output (currently discarded) would vanish; without diagnostics an install or start-up failure is unreportable, which directly undermines US1's purpose. Scoped as full structured logging (levels, rotation, retention) plus crash reports, with **no in-app log viewer**. Split out of this feature; tracked on the v1.0.0 milestone.
- The **existing build pipeline** produces the component set to be packaged; this feature packages its output rather than redesigning it.
- The **existing continuous-integration system** (Windows-only, per the platform scope above) is where verification and the publication gates run.
- The **existing product icon** is the icon applied to the installed executable and the shortcut.
- The **existing internal build identifier** (used to detect a stale background component) must keep working alongside the new product version (FR-006).
