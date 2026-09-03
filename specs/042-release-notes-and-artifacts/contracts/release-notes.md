# Contract: `CHANGELOG.md` and `scripts/release-notes.mjs`

**Feature**: 042 | Consumed by `.github/workflows/release.yml`, `scripts/publish-gates.mjs`, and by
whoever writes the notes.

## Part 1 — the `CHANGELOG.md` format the parser accepts

Deliberately close to Keep-a-Changelog, because it is a format contributors already recognise, and
deliberately narrower, because the parser has to be able to refuse (FR-005).

```markdown
# Changelog

<!-- Sections for 1.0.0-alpha1 … alpha3 were reconstructed after those releases shipped. -->

## 1.0.0 — 2026-09-14

### Added
- Portable and archive downloads, so throng can run without being installed.

### Fixed
- Terminal scrolling stopped working after switching project (#290).

### Changed
- The Settings label for destroying a tab now says "Destroy a tab" (#329).

### Known issues
- The preferences window can take a second to appear on a cold start.

## 1.0.0-alpha3 — 2026-08-30
…
```

### Rules the parser enforces

| Rule | Why |
|---|---|
| A version section is an `##` heading whose first token is the exact version string. | The binding in FR-005. `## 1.0.0` does not satisfy a publish of `1.0.1`. |
| Recognised subsection headings are `Added`, `Fixed`, `Changed`, `Removed`, `Known issues`. | FR-001 asks for grouping a reader can skim. An unrecognised heading is passed through in place rather than dropped — losing content silently is worse than rendering a heading nobody planned for. |
| Entries are `-` list items, one line each. | Keeps the body composable and the size cap (FR-010) predictable. |
| A version section containing **only** the literal line `- No user-visible changes in this release.` sets `isEmptyByDeclaration`. | FR-009's deliberate statement. Any *other* empty section is a missing section. |
| The `# Changelog` title and any HTML comments are ignored. | The retrospective-sections note from research D6 lives in a comment and must not reach a release body. |

### What the parser must NOT do

- **Must not fall back.** No section for the version being published is a refusal, never the previous
  version's notes and never generated text. A fallback that produces a plausible body is how an
  unreviewed release ships, and it is the specific failure FR-005 exists to prevent.
- **Must not repair.** A malformed section is a refusal naming what is malformed.

## Part 2 — `scripts/release-notes.mjs`

### `render --version <v> [--out <file>] [--artifacts <json>] [--sha <commit>]`

Composes the complete release body and writes it to `--out` (default: stdout).

- **Exit 0** — body written.
- **Exit 2** — `no-section-for-version`. Message: which version was looked for.
- **Exit 3** — `section-empty`. Message: the section exists but declares nothing and does not declare
  emptiness.
- **Exit 4** — `version-mismatch`. Message: what the section is headed with versus what was asked
  for.

`--artifacts` takes the JSON from `artifact-set.mjs list --json`, with each artifact's `sha256`
filled in. The notes CLI does **not** hash anything itself: 020 FR-042a requires the checksum to be
computed as the last step that reads an artifact's bytes, and that step is `checksum.mjs` at publish
time. Passing the digests in keeps that ordering intact and keeps this CLI pure enough to unit-test.

### The composed body, in order

1. The notes sections, as parsed.
2. `---`
3. The unrecognised-app warning and how to proceed past it (fixed text; 020 FR-043).
4. How to verify a download against its checksum (fixed text).
5. The checksum table — **one row per artifact**: label, filename, SHA-256.
6. `Built from <commit sha>.`

Parts 2–6 are the **invariant footer**. They are always present, always last, always in this order.

### The size cap (FR-010)

If the composed body would exceed the platform limit, part 1 is truncated at a section boundary and a
line is appended pointing at `CHANGELOG.md` for the remainder. The footer is never touched. The
truncation is deterministic and unit-tested against a synthetic oversized changelog — this is
precisely the kind of edge nobody will meet until the release where it matters.

## Part 3 — where this is called

| Caller | When | Purpose |
|---|---|---|
| `publish-gates.mjs` | Before the gated publish job | Supplies `notesBindToVersion` (research D5). A refusal here happens before a human is asked to approve. |
| `release.yml` verify job | On every build, including a non-publishing dispatch | FR-006 — renders the body and uploads it, so the approver reads what will actually be published, and so a dispatch rehearses the composition without releasing. |
| `release.yml` publish job | After the gates pass | Produces the `--notes-file` handed to `gh release create`. |

The verify job and the publish job MUST compose from the same inputs and produce the same bytes.
Rendering twice and publishing the second is only safe because both are pure functions of
(changelog, artifact set, sha) — which is why the hashing stays outside this CLI.
