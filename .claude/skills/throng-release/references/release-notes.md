# Release notes — where the text comes from

That the notes come from `CHANGELOG.md` and are reviewed before the tag is stated in
[`docs/releasing.md`](../../../../docs/releasing.md#release-notes). How to write the section is
[`SKILL.md`](../SKILL.md) step 3. This file holds how the body is composed and why it refuses rather
than falls back.

## Composed, never written

Entries accumulate in `CHANGELOG.md`'s `## Unreleased` section as work merges; at release-preparation
time that heading is renamed to the version and committed. The pipeline reads only what was
committed and composes the release body from it — it never writes prose of its own, and it **never
falls back** to another version's notes. That is the whole point: a fallback that produces a
plausible body is how an unreviewed release ships.

## Notes, then a fixed footer

The body is always *notes, then a fixed footer* — the unrecognised-app warning, how to verify a
download, one **SHA-256 row per artifact against its own filename**, and the source revision. New
content goes above the footer, never in place of it, including when the body has to be shortened to
fit: the notes are the half with a fallback, the footer is the half without.

## Refusal, with no override

Publication is refused when the notes are missing, empty, or headed with a different version. A
release that genuinely has nothing user-visible in it publishes by saying so, in exactly one line —
`- No user-visible changes in this release.` Anything else empty is a refusal, so an unwritten
changelog cannot pass as an uneventful release.

```bash
node scripts/release-notes.mjs render --version <v> --artifacts "$(node scripts/artifact-set.mjs checksums)"
```

Its exit codes are listed in [`SKILL.md`](../SKILL.md) step 7. The source revision comes from
`--sha`, else `GITHUB_SHA`.

## The approver reads the exact body

The verify job renders the **exact body** publication will use and uploads it as
`release-body-preview.md`, before the gated job runs — so the person giving the sign-off approves the
text that actually ships, and a non-publishing `workflow_dispatch` rehearses the whole composition
without releasing anything.

## Requirements behind it

[`specs/042-release-notes-and-artifacts/`](../../../../specs/042-release-notes-and-artifacts/).
