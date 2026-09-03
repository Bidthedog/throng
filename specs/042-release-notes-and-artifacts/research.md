# Phase 0 Research: Release Notes & Multi-Artifact Publication

**Feature**: 042 | **Date**: 2026-09-02 | **Plan**: [plan.md](./plan.md)

---

## D1 — Where release notes come from

**Decision**: `CHANGELOG.md` at the repository root is the authoritative source. It carries one
section per released version. Notes for a version are compiled at release-preparation time and
**committed before the tag**; the pipeline reads only what was committed and never composes text
itself.

**Rationale**:

- **It puts the review where a review already happens.** FR-003 asks for notes to be reviewable
  before the tag, and FR-004 forbids adding a manual step at publication (020 FR-036). A file in the
  repository is reviewed as a diff, by the same mechanism as every other change. Nothing new has to
  be invented for a human to correct it.
- **It makes the failure mode loud.** FR-005 requires publication to be refused when notes are
  absent, empty or bound to another version. A missing section for `1.0.0` is a trivially detectable,
  unambiguous state. A generated body has no equivalent — it always produces *something*.
- **It matches what the release process already does.** Notes are already compiled from the work
  between two refs and committed before tagging; this makes that artifact a requirement of the
  pipeline rather than a habit that survives only as long as whoever does it remembers.

**Alternatives considered**:

| Alternative | Why rejected |
|---|---|
| **Derive at publish time from issues closed between the tags** | An issue closes for many reasons — duplicate, won't-fix, superseded, closed by a PR that was reverted — so the set of issues closed between two tags is *not* the set of changes in the release. A milestone is not a release either: v1.0.0 holds 22 open issues across an unknown number of releases. It would also violate FR-003, since nothing exists to review until the moment of publication. |
| **Derive at publish time from PR titles** | A PR title summarises a change for a reviewer, not for a user: "fix(terminal): guard the wheel route against a null viewport" tells a downloader nothing. It also inherits the same FR-003 problem. |
| **Generate a draft into the GitHub Release and let a human edit it before publishing** | Splits the source of truth: the edited text exists only on GitHub, so the repository no longer records what was said about a release, and a re-publish or a mistake has nothing to recover from. It also makes the human edit a *manual publication step*, which 020 FR-036 forbids. |

**Consequence to accept**: releasing now requires the CHANGELOG section to exist. That is the point —
it is the enforcement FR-005 asks for — but it does mean a release cannot be cut from a tag alone.
`docs/releasing.md` must say so (FR-024).

---

## D2 — How an artifact is identified

**Decision**: by a stable **role** (`setup`, `portable`, `archive`), never by extension, glob or
filesystem ordering. The declaration binds each role to an exact filename with the version
interpolated, following the pattern already in `electron-builder.yml`
(`throng-setup-${version}.${ext}`). Every consumer asks for a role and gets one artifact or an error.

**Rationale**: the defect this feature exists to prevent is three call sites independently resolving
"the installer" and potentially disagreeing. A role is the only identifier that cannot collide:
`portable` and `setup` are both `.exe`, both live in `dist/installer/`, and their alphabetical order
is an implementation detail of nothing in particular.

**Alternatives considered**:

- **Keep globbing but sort deterministically.** Rejected: it makes the wrong answer *stable* rather
  than making the right answer *explicit*, and it silently re-breaks the moment a fourth artifact is
  added — which #361 will do.
- **Let electron-builder's own output metadata be the source.** Rejected as the *primary* source: it
  describes what was built, which is exactly what FR-013 needs to reconcile *against* a declaration.
  A source that always agrees with the build cannot detect a build that produced the wrong set. It is
  useful as the **found** side of that comparison, and is used that way.

---

## D3 — How a format with no installer is verified

**Decision**: verification steps become **per-format applicable**. A format declares which of the
verdict's steps apply to it; a step that cannot apply is recorded as **absent**, never as passed. The
verdict passes only when every *applicable* step passed.

**Rationale**: `verify-installer.mjs` currently runs a fixed 13-step list ending in `uninstall` and
`residue-scan`. An archive has no `install` step and no uninstaller, so running the list unchanged
would either fail honestly on steps that do not exist, or — far worse — be "fixed" by marking them
passed, which would make the verdict lie about the artifact it certifies. 020 FR-027's rule that an
absent verdict is a failure has the same shape and the same reason: absence and success must never
be conflated.

**What stays constant across formats** is the end state, which is what FR-015 actually requires: the
app launches, reports the expected version, runs under the bundled runtime with no PATH Node,
registers no service, opens a working terminal, reattaches its daemon, matches its checksum, and
leaves no process or component behind. Only the *how it gets on and off disk* varies.

---

## D4 — `portable` and `zip` are both needed, and they are not the same thing

**Decision**: ship both.

- **`portable`** — electron-builder's single self-extracting `.exe`. Download one file, double-click,
  throng runs.
- **`zip`** — an ordinary archive extracted to a folder the user chooses.

**Rationale**: they serve the same audience differently, and the difference matters for throng
specifically.

**Two risks the `portable` target carries that `zip` does not, both of which verification must
settle rather than assume:**

1. **It extracts on every launch.** A self-extracting build unpacks itself to a temporary location
   before running. throng is deliberately **not** asar-packed (020 FR-009): it ships its workspace
   `packages/*` tree verbatim plus a bundled host-Node runtime under `resources/runtime`. That is a
   large tree to unpack, and the cost is paid at every start, not once. SC-005's three-minute
   download-to-terminal bar is the check on this.
2. **"Leaves nothing behind" is not automatic.** FR-021 requires that removing a portable throng
   leaves no component behind. A self-extracting build's unpack location is *not* the folder the user
   deleted, so residue is a real possibility rather than a theoretical one. `scripts/residue-scan.mjs`
   already exists and is the right instrument; the portable format's verification must actually point
   it at the unpack location, not only at the download folder.

**`zip` has neither risk**, which is precisely why it is worth shipping alongside rather than instead
of: if `portable` turns out to pay badly on either count, `zip` already covers the audience and
`portable` can be dropped without leaving anyone stranded. That is the reason both are in scope
rather than one — not thoroughness.

**Alternatives considered**: `appx` and `msi-wrapped` were named in #351 as candidates and are
excluded — neither has an audience the other three do not already serve, and every target added is a
row in the verification matrix.

---

## D5 — What the publish gate gains

**Decision**: `evaluatePublishGate` takes two new inputs — `artifactSetReconciles` and
`notesBindToVersion` — evaluated in that order, after the existing version checks and before the
sign-off check.

**Rationale**: the gate is already the single place a refusal is decided, and 020 FR-031 requires a
refusal to name the unmet condition. Adding the two new conditions there rather than as separate
early-exits in the workflow keeps one refusal path, one message format, and one set of unit tests.
The ordering puts the cheap, deterministic checks before the human one so a refusal never wastes an
approval.

**Alternative considered**: check notes and artifacts in the workflow before calling the gate.
Rejected — it puts two of the five refusal reasons somewhere no unit test can reach them, which is
the exact failure mode *Provability* in the plan is written to avoid.

---

## D6 — Seeding `CHANGELOG.md` for versions already published

**Decision**: seed it with sections for the already-published versions (`1.0.0-alpha1`, `alpha2`,
`alpha3`), compiled from the actual work between those tags, and mark plainly that they were written
retrospectively.

**Rationale**: a changelog that begins at the next version implies the earlier releases had no
changes worth recording, and leaves the first reader of the file unable to answer the question it
exists to answer. Writing them retrospectively is honest and cheap; pretending they do not exist is
neither.

**Constraint**: the retrospective sections must not be presented as if they had been reviewed at the
time. A one-line note at the top of the file saying which sections were reconstructed after the fact
is sufficient and is the truthful framing.
