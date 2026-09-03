# Contract: `scripts/artifact-set.mjs`

**Feature**: 042 | Consumed by `.github/workflows/release.yml` and by hand during a dry run.

A thin CLI over `packages/core/src/config/release-artifacts.ts`. It holds no decisions — it maps
argv and the filesystem onto the pure functions and turns their results into exit codes and
messages. This is the shape `scripts/publish-gates.mjs` already has, and the reason both are
testable without a release.

## Subcommands

### `list [--dir <path>] [--json]`

Prints the declared artifact set for the version in the root `package.json`.

- `--json` emits the `ReleaseArtifactSet` verbatim, for the workflow to consume.
- Default output is one line per artifact: `<role>  <filename>  <label>`.
- **Exit 0** always — a declaration cannot fail; it is data.

### `resolve <role> [--dir <path>]`

Prints the absolute path of the one artifact for `<role>`.

- **Exit 0** — prints the path, nothing else, so `$(node scripts/artifact-set.mjs resolve setup)`
  is safe to interpolate.
- **Exit 2** — the role is not in the declared set. Message names the role and lists the valid ones.
- **Exit 3** — the file for that role is not present in `--dir`. Message names the expected filename.

**This subcommand is what replaces `ls dist/installer/*.exe | head -n1` at `release.yml:178`, `:235`
and `:246`.** Each of those three sites names the role it means, so two artifacts sharing an
extension can no longer be confused, and a missing file fails loudly instead of resolving to a
neighbour.

### `reconcile [--dir <path>]`

Compares the declaration against what is actually in `--dir`.

- **Exit 0** — the found set is exactly the declared set.
- **Exit 4** — a discrepancy. stderr carries the single-sentence `reason` from `ReconcileResult`,
  then the `missing` and `unexpected` lists.

Called immediately after `npm run package`, so a build that produced the wrong set fails at the
build, not four jobs later at the checksum (FR-013).

## Defaults

- `--dir` defaults to `dist/installer`.
- The version always comes from the root `package.json` — the single authoritative declaration (020
  FR-001). There is no `--version` flag, deliberately: a flag would be a second place a version could
  come from.

## Exit-code summary

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Unknown role |
| 3 | Declared artifact missing from `--dir` |
| 4 | Set reconciliation failed |

Non-zero always writes a reason to stderr naming the artifact or role involved. A silent failure here
would reintroduce exactly the class of defect the feature removes.

## Testability

Every path is reachable from a unit test: point `--dir` at a temp directory, create or omit files,
assert the exit code and the message. No packaging, no network, no runner.
