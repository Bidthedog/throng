[throng](../README.md) › [Docs](README.md) › Releasing

# Releasing

How a throng build becomes a versioned, verified, published release. For maintainers.

**To cut one, use the `throng-release` skill** —
[`.claude/skills/throng-release/SKILL.md`](../.claude/skills/throng-release/SKILL.md). It is the
procedure: the running order, the commands, and what every past failure turned out to be. Its
[`references/`](../.claude/skills/throng-release/references/) folder holds the detail behind each
stage. This page is the overview.

A release runs **unattended**: the maintainer asks for one, naming a version or taking the next on the
current prerelease track, and the next thing they see is a published release or a report of why there
is none. The skill sweeps the dependencies, writes the notes, runs the full gate, fixes what breaks
through its own pull requests, and pushes a `v*` tag on `master`.
[`release.yml`](../.github/workflows/release.yml) then builds every artifact, verifies each one on a
clean runner, and publishes the GitHub Release. Nobody approves it.

```
dependencies  →  version  →  release notes  →  full gate  →  tag  →  build & package  →  verify every artifact  →  publish
```

Nothing about a release is done by hand copying files around, and no step has an override. What
stands in for a person's review is that a release can only come from a commit already on `master`,
so it went through a pull request and its required checks. Why: [spec 065](../specs/065-unattended-releases/spec.md).

## Versions

There is one authoritative version: `version` in the root [`package.json`](../package.json). Every
workspace, the installer filename, the version the app reports and the tag all follow it, and they
must match exactly at publish time. Versions are SemVer; prereleases carry a suffix
(`1.0.0-alpha5`, `1.0.0-rc.2`) and publish as GitHub prereleases, never as the latest release.
Detail: [versioning](../.claude/skills/throng-release/references/versioning.md).

## The artifact set

A release is a **declared** set of artifacts, not whatever a build happens to produce. The
declaration is `packages/core/src/config/release-artifacts.ts`, and every step finds an artifact by
its role:

| Role | Filename | What it is |
|---|---|---|
| `setup` | `throng-setup-<version>.exe` | The installer wizard. Per-user (no administrator rights) or machine-wide (one prompt). |
| `msi` | `throng-<version>.msi` | The same two scopes as an MSI, for managed deployment; machine-wide by default when run elevated. |
| `portable` | `throng-portable-<version>.exe` | A single self-extracting executable. Unpacks to a temporary folder and runs; installs nothing. |
| `archive` | `throng-<version>.zip` | An ordinary archive, extracted and run from wherever the user puts it. |
| `deb` | `throng-<version>-amd64.deb` | The Linux package for Ubuntu, Debian and their relatives, for the whole machine. |
| `rpm` | `throng-<version>-x86_64.rpm` | The Linux package for Fedora and its relatives, for the whole machine. |
| `tarball` | `throng-<version>-linux-x64.tar.gz` | The Linux archive, extracted and run from wherever the user puts it. |

All of them bundle their own Node.js runtime, so nothing else needs installing. The two Windows installers each
support two **install scopes**; the others have none. Which one a user should pick is covered in [Installation](installation.md).
Detail — how the set is declared and reconciled, and what ships inside:
[artifact set](../.claude/skills/throng-release/references/artifact-set.md).

## Release notes

The notes come from [`CHANGELOG.md`](../CHANGELOG.md). Entries collect under `## Unreleased` as work
merges; before the tag, that section is renamed to the version and committed, so the notes are
**reviewed as a diff** in the release PR. The pipeline composes the release body from that section
plus a fixed footer (the unrecognised-app warning, one SHA-256 per artifact, the source revision). It
never writes prose and never falls back to another version's notes. The exact body is rendered and
checked before anything is signed, so a release whose body cannot be composed stops there. Detail:
[release notes](../.claude/skills/throng-release/references/release-notes.md).

## Verification

Every **combination** of artifact and install scope — nine today: the setup and the MSI each per-user
and machine-wide, the portable build, the archive, and the three Linux artifacts — is installed (or extracted, or unpacked),
launched, checked for the right version, driven through a core journey — project, terminal, close,
reopen, reattach — checksummed, and removed again, each on its own fresh CI runner. Machine-wide
combinations also prove a second, standard account gets its own background service and terminals,
and that an upgrade in use by that account finishes at a restart without closing anything. A seventh
job installs every copy side by side and proves they coexist: one runs at a time, all open the same
data. Each combination, and the coexistence run, gets its own verdict. A missing verdict is a
failure, and a set of verdicts covering only some combinations is a refusal, not a partial pass. The
one gap allowed — a second-account check a hosted runner cannot exercise — is named on every run. The Linux
packages also prove an older copy left open survives the upgrade, and that an older package is refused; the `.rpm` is
verified in a Fedora container, because no hosted runner is rpm-based. Detail:
[verification](../.claude/skills/throng-release/references/verification.md).

## What fails a release

Publication is refused, with no override, unless all five hold:

1. **A real version** — the `0.0.0` placeholder is refused.
2. **The artifact set reconciles** — what was built is exactly what was declared, in both directions.
3. **Verification passed** — for every artifact-and-scope combination, and for the coexistence run;
   a refusal names the combination that did not.
4. **The release notes bind to this version** — not missing, not empty, not headed with another
   version.
5. **The tag is on `master`** — the tagged commit must already be on `master`. A tag anywhere else is
   refused before the signing key is read. A dispatched run never publishes.

The first four are checked when the body is rendered, before anything is signed. Detail:
[publishing](../.claude/skills/throng-release/references/publishing.md).

## Publishing

Publication runs in CI only. It computes each artifact's SHA-256 as the last step that reads its
bytes, creates the GitHub Release with every artifact and the composed notes, and refuses to
re-publish a version that already exists — a published release is immutable.

Releases are **not code-signed**; each one publishes a SHA-256 checksum instead, which proves
integrity but not identity. That is a deliberate choice, explained with the reproducibility claim in
[signing and reproducibility](../.claude/skills/throng-release/references/signing-and-reproducibility.md).
What the user sees is [Installing on Windows → the unrecognised-app warning](install-windows.md#the-unrecognised-app-warning).

## The package repositories

`throng-ide.com` is one GitHub Pages deployment: the static files from `site/`, and the
[apt and rpm repositories](install-linux.md#the-package-repository) at `/apt` and `/rpm`. No package file is on the site or
in the repository. Each index points at its release's assets.

- **A release updates them.** `sign-index` signs that release's indexes with the private key, the `REPO_SIGNING_KEY`
  secret on the `release` Environment, before `publish` runs. The Environment accepts only `v*` tags, and the job makes
  the same on-`master` check as `publish` before reading the key. `publish` attaches the signed bundle as
  `throng-repo-index-<version>.tar.gz` when it creates the release, because a published release is immutable. Once the
  release is out, `deploy-repositories` deploys the site. A full release updates both channels, and a prerelease updates
  only `prerelease`.
- **A change under `site/`** deploys on merge with no key, because each deployment reads the signed bundles back from the
  releases.

`verify-repositories` proves the route before publication: install, upgrade through a newer index, channel separation, and
refusal of tampered and unsigned indexes. `scripts/repo-signing-key.sh` creates the key, once. Replacing it means every
repository user adds the new one by hand. Why it is built this way:
[spec 064's research](../specs/064-website-and-package-repos/research.md).

---

**See also:** [Installation](installation.md) (the user's side of this) ·
[Testing](testing.md) · [Contributing](../CONTRIBUTING.md) ·
[spec 020 — packaging](../specs/020-application-packaging/) ·
[spec 042 — release notes and artifacts](../specs/042-release-notes-and-artifacts/) ·
[spec 058 — machine-wide installation and the MSI](../specs/058-machine-wide-install-msi/) ·
[spec 065 — unattended releases](../specs/065-unattended-releases/).
