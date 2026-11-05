# Feature Specification: Website and Package Repositories

**Feature Branch**: `feature/S064-I554-website-and-package-repos`

**Created**: 2026-11-04

**Status**: Draft

**Input**: Issue [#554](https://github.com/Bidthedog/throng/issues/554). "GitHub Pages site with a website and apt/rpm repositories, on `throng-ide.com`, so a person can learn what throng is and how to get it, and a Linux user can add throng's repository once, install with `apt` or `dnf`, and receive upgrades through normal system updates."

## Requirements this feature changes

Nothing is superseded. 020 FR-041 stands: throng itself still makes no update check and no network call, because upgrades here come from the system's package manager. 063's assumption that repositories are this issue's work is what this delivers. 042 FR-017 stands: every declared artifact is still attached, and the index bundle (FR-006) is added beside them as an undeclared file nobody installs.

## Clarifications

### Session 2026-11-04

- Q: Where do the packages live? → A: The maintainer's decision on #554: they stay as release assets. None goes in the repository or on the site.
- Q: How does apt reach a release asset, when a full URL in `Filename` fails and a static site cannot redirect (measured on #554)? → A: Through apt's mirror transport. The source line names a mirror list on `throng-ide.com`, which sends index requests to the site and package requests to GitHub. Measured on Ubuntu 22.04 and 24.04 and Debian 12 against a real GitHub release, signed (research D1). The source line names the final URL, as the issue requires, so the decision the #554 comment left open does not arise.
- Q: How do prereleases stay apart? → A: Two channels, `stable` and `prerelease`, each its own index, and the user's source names one.
- Q: Does the website ship with the repositories? → A: No. The maintainer reviewed the first version of the page, said it is not right, and asked to set it aside and deliver the repositories first. User Story 1 and FR-001 to FR-003 are deferred, and #554 stays open for them. Until then the site root serves nothing, and `/apt`, `/rpm` and the key are all that is on the site.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Learn what throng is and how to get it (Priority: P1, deferred)

A person visits `https://throng-ide.com`, understands what throng is and how it behaves when its window closes, and finds how to install it on their system.

**Independent Test**: Open the site on a phone-width and a desktop-width window, and reach the install commands for Windows, Ubuntu and Fedora.

**Acceptance Scenarios**:

1. **Given** the site is deployed, **When** a person opens the root address, **Then** they see what throng is and how to get it.
2. **Given** a person on any supported system, **When** they read the install section, **Then** it gives them the commands or download for that system, and says which channel holds what.
3. **Given** a person using only a keyboard, or one who asks for reduced motion, **When** they use the page, **Then** everything is reachable and nothing moves unasked.

---

### User Story 2 - Install and upgrade through the package manager (Priority: P1)

A Linux user adds throng's repository once, installs with `apt` or `dnf`, and a later release arrives with their normal system updates.

**Independent Test**: On a clean Ubuntu and a clean Fedora machine, add the repository, install, publish a newer index, and run the ordinary upgrade.

**Acceptance Scenarios**:

1. **Given** a clean Ubuntu machine, **When** the user adds the repository and runs `apt install throng`, **Then** throng installs.
2. **Given** a clean Fedora machine, **When** the user adds the repository and runs `dnf install throng`, **Then** throng installs.
3. **Given** throng was installed from the repository and a newer release has published, **When** the user runs `apt upgrade` or `dnf upgrade`, **Then** the newer version installs.

---

### User Story 3 - A repository that cannot be tampered with or reached early (Priority: P1)

The package manager refuses an index that was not signed by throng's key, a release that has not passed QA sign-off never reaches a repository, and a prerelease never reaches the stable channel.

**Independent Test**: Tamper with each signed file and remove each signature, and confirm refusal. Read the pipeline's dependencies, and build an index for a prerelease.

**Acceptance Scenarios**:

1. **Given** a changed index or signature file, **When** the package manager reads it, **Then** it refuses.
2. **Given** an index with no signature, **When** the package manager reads it, **Then** it refuses.
3. **Given** a signed index naming a package whose bytes differ, **When** it is downloaded, **Then** it is refused.
4. **Given** a release run whose QA sign-off was not given, **When** the run ends, **Then** no repository changed and the signing key was never available to it.
5. **Given** a prerelease publishes, **When** a stable-channel user runs an upgrade, **Then** nothing is offered.
6. **Given** a stable release publishes, **When** a prerelease-channel user runs an upgrade, **Then** it is offered.

---

### User Story 4 - Change the site without touching the repositories (Priority: P2)

A maintainer changes a static file and deploys the site, and the repositories still serve what they served.

**Independent Test**: Assemble the site twice, with a change to a static file between, and confirm the repository files are byte-identical.

**Acceptance Scenarios**:

1. **Given** published indexes, **When** the site is deployed, **Then** the repositories are present and their signatures still verify, with no signing key used.
2. **Given** an index cannot be fetched during a deployment, **When** the deployment runs, **Then** it fails and the live site stays as it was.

### Edge Cases

- **No stable release yet.** The stable channel has no index until 1.0.0, so `apt update` reports a missing file for it. The docs say to use the prerelease channel until then.
- **A patch release published after a newer minor.** Each channel serves its highest version, not its most recent publication.
- **A user's index is older than the site's.** The version it names is still a release asset, so the install still works.
- **Signing fails after a release publishes.** The repositories stay on the previous version, and the failed run says so. Re-running that job repairs it.
- **A package installed by hand, then the repository is added.** It is the same package name, so the next upgrade takes over.
- **The signing key must be replaced.** Every user re-adds the key. There is no silent route, and the docs say how.
- **A distribution older than apt 1.6 has no mirror transport.** It is outside the supported list (063 Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**The website** (deferred, see Clarifications)

- **FR-001**: The site MUST serve a website at its root on `https://throng-ide.com`, saying what throng is, what it does and how to install it on each supported system, in text that matches the README's claims.
- **FR-002**: The website MUST work with a keyboard, at phone width, with reduced motion, and without third-party requests.
- **FR-003**: A maintainer MUST be able to preview the assembled site locally with one command, publishing nothing.

**The repositories**

- **FR-004**: The site MUST serve signed apt and rpm repositories at `/apt` and `/rpm`, in two channels, `stable` and `prerelease`.
- **FR-005**: No package file MAY be stored in the repository or on the site. Each index MUST point at the release's own assets, and the package manager MUST check each download against the index's hash.
- **FR-006**: Each published release MUST carry a signed bundle of its indexes as a release asset, so a deployment rebuilds the repositories without the signing key.
- **FR-007**: A channel MUST serve its highest version. A stable release MUST update both channels. A prerelease MUST update only `prerelease`, and building a stable index from a prerelease version MUST be refused.
- **FR-008**: Every deployment MUST assemble the static files and the repositories into one site. A failure to fetch a bundle MUST fail the deployment.

**Trust**

- **FR-009**: The private signing key MUST be held only as a `release` Environment secret, so only a job behind the human QA sign-off can use it. No other job or workflow MAY reference it.
- **FR-010**: The repositories MUST change only after the release has published, by a job that depends on publication.
- **FR-011**: The public key MUST be served from the site. The instructions MUST scope trust in it to throng's source alone, and MUST NOT add it to a system-wide keyring.
- **FR-012**: The package manager MUST refuse a tampered or unsigned index, as configured by the published instructions and repo file.

**Verification**

- **FR-013**: The release pipeline MUST prove each package's repository route on a clean machine before publishing: install from an index, upgrade through a newer one, channel separation, and refusal of tampered and unsigned indexes. A failure MUST block publication.
- **FR-014**: The Windows artifacts, the declared artifact set and the existing verification steps MUST NOT change.

**Documentation**

- **FR-015**: `docs/install-linux.md` MUST cover adding the repository, choosing a channel, upgrading, and removing the repository. `docs/releasing.md` and the `throng-release` skill MUST move with the pipeline.

### Key Entities

- **Channel**: `stable` or `prerelease`; a user's source names one.
- **Index bundle**: A signed archive of one release's indexes, attached to that release.
- **Mirror list**: A static file telling apt where indexes and packages each live.
- **Repository signing key**: The key that signs every index. It says who published the index, and is separate from code signing (#118).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean Ubuntu or Fedora machine, a person goes from the install instructions to a running throng in under 5 minutes.
- **SC-002**: A release's upgrade reaches a repository user through one ordinary system-update command, with no download by hand.
- **SC-003**: 100% of tampered or unsigned indexes tried are refused, and none installs anything.
- **SC-004**: Changes to the site's static files leave 100% of the repository files byte-identical.
- **SC-005**: Across every run, no prerelease version appears in the stable channel.

## Assumptions

- The DNS records and the domain's verification are in place (#554). `www.throng-ide.com` redirects through GitHub's own handling of an apex custom domain.
- Packages stay unsigned, and #118 owns that. On rpm this means repository metadata is signed and the package's digest comes from it, with package-level signature checks off.
- An index lists one version per channel. Going back to an older one is by its release's package, as `docs/install-linux.md` already says.

## Out of Scope

- Building the packages (#550).
- Submitting to Debian, Ubuntu or Fedora's own repositories.
- Package and code signing (#118), automatic update (#119).
- arm64.
