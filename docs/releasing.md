[throng](../README.md) › [Docs](README.md) › Releasing

# Releasing

How a throng build becomes a versioned, verified, published release. For maintainers.

**To cut one, use the `throng-release` skill** —
[`.claude/skills/throng-release/SKILL.md`](../.claude/skills/throng-release/SKILL.md). It is the
procedure: the running order, the commands, and what every past failure turned out to be. Its
[`references/`](../.claude/skills/throng-release/references/) folder holds the detail behind each
stage. This page is the overview.

A release is cut by pushing a `v*` tag on `master`.
[`release.yml`](../.github/workflows/release.yml) then builds every artifact, verifies each one on a
clean runner, and publishes the GitHub Release once a person has signed it off.

```
version  →  release notes  →  build & package  →  verify every artifact  →  QA sign-off  →  publish
```

Nothing about a release is done by hand copying files around, and no step has an override.

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
| `setup` | `throng-setup-<version>.exe` | The per-user installer wizard. No administrator rights; installs into `%LOCALAPPDATA%\Programs\throng`. |
| `portable` | `throng-portable-<version>.exe` | A single self-extracting executable. Unpacks to a temporary folder and runs; installs nothing. |
| `archive` | `throng-<version>.zip` | An ordinary archive, extracted and run from wherever the user puts it. |

All three are per-user, carry the same contents and bundle their own Node.js runtime, so nothing
else needs installing. Which one a user should pick is covered in [Installation](installation.md).
Detail — how the set is declared and reconciled, and what ships inside:
[artifact set](../.claude/skills/throng-release/references/artifact-set.md).

## Release notes

The notes come from [`CHANGELOG.md`](../CHANGELOG.md). Entries collect under `## Unreleased` as work
merges; before the tag, that section is renamed to the version and committed, so the notes are
**reviewed as a diff** in the release PR. The pipeline composes the release body from that section
plus a fixed footer (the unrecognised-app warning, one SHA-256 per artifact, the source revision). It
never writes prose and never falls back to another version's notes. The person giving the QA
sign-off reads the exact rendered body before approving it. Detail:
[release notes](../.claude/skills/throng-release/references/release-notes.md).

## Verification

Every artifact is installed (or extracted, or unpacked), launched, checked for the right version,
driven through a core journey — project, terminal, close, reopen, reattach — checksummed, and removed
again, on a fresh CI runner. Each artifact gets its own verdict. A missing verdict is a failure, and
a set of verdicts covering only some of the artifacts is a refusal, not a partial pass. Detail:
[verification](../.claude/skills/throng-release/references/verification.md).

## What fails a release

Publication is refused, with no override, unless all five hold:

1. **A real version** — the `0.0.0` placeholder is refused.
2. **The artifact set reconciles** — what was built is exactly what was declared, in both directions.
3. **Verification passed** — for every artifact.
4. **The release notes bind to this version** — not missing, not empty, not headed with another
   version.
5. **Human QA sign-off** — a required reviewer approves the release on the GitHub `release`
   Environment. No automation, default or timeout can satisfy it.

The first four are checked before the person is asked, so a release that could never publish does
not use up an approval. Detail: [publishing](../.claude/skills/throng-release/references/publishing.md).

## Publishing

Publication runs in CI only. It computes each artifact's SHA-256 as the last step that reads its
bytes, creates the GitHub Release with every artifact and the composed notes, and refuses to
re-publish a version that already exists — a published release is immutable.

Releases are **not code-signed**; each one publishes a SHA-256 checksum instead, which proves
integrity but not identity. That is a deliberate choice, explained with the reproducibility claim in
[signing and reproducibility](../.claude/skills/throng-release/references/signing-and-reproducibility.md).
What the user sees is [Installation → the unrecognised-app warning](installation.md#the-unrecognised-app-warning).

---

**See also:** [Installation](installation.md) (the user's side of this) ·
[Testing](testing.md) · [Contributing](../CONTRIBUTING.md) ·
[spec 020 — packaging](../specs/020-application-packaging/) ·
[spec 042 — release notes and artifacts](../specs/042-release-notes-and-artifacts/).
