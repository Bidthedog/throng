# Contract: Gated Publish + Checksum

**Traces**: FR-028–FR-037, FR-042, FR-042a, FR-043; SC-001a, SC-002, SC-005, SC-008.

## Gate logic (`scripts/publish-gates.mjs`, unit-tested) + `release.yml` workflow

Publishing is refused unless **all three** hold, with **no override path**:

1. **Real version** — `!isPlaceholderVersion(version)` (FR-028 (a), FR-033).
2. **Verification passed** — a `VerificationVerdict` for `{version, installerSha256}` with `passed:true`
   exists; absent or red → refuse (FR-028 (b), FR-027).
3. **Human QA sign-off** — a GitHub **Environment (`release`) with required reviewers** approved this run;
   not satisfiable by automation, default, or elapsed time (FR-028 (c), FR-029, FR-030).

Each refusal names the unmet condition (FR-031).

## Checksum (`scripts/checksum.mjs`)

```ts
/** SHA-256 hex of the exact file bytes. MUST be the last step that reads the artifact. */
export function sha256OfFile(path: string): Promise<string>;
```

- Computed **after** any renaming/repackaging, as the final byte-reading step (FR-042a).
- Published in the GitHub Release notes **beside** the artifact (FR-032, FR-042).

## Publish behaviour

- **B1** All gates satisfied → a GitHub Release is created for the version, carrying the installer + its
  checksum, with the release version equal to the package's internal version (FR-032/033).
- **B2** Any gate unmet → refused, naming the condition (FR-028/031); no partial publish.
- **B3** Re-publishing an already-published version is refused, not overwritten (FR-034).
- **B4** The release records the exact **source revision** built from (FR-035); artifacts are rebuildable
  from it (SC-008).
- **B5** No step requires a human to copy/rename/upload an artifact by hand (FR-036).
- **B6** The gates cannot be bypassed by running from a developer machine or unreviewed branch — enforced by
  the Environment + branch protection (FR-037).
- **B7** The release notes state the unsigned-app warning and how to verify against the checksum, and never
  instruct disabling a security feature (FR-043).

## Tests (test-first)

- **unit** — the gate evaluator: real+verified+signed → allow; each single unmet condition → refuse naming
  it; an already-published version → refuse. `sha256OfFile` matches a known vector and re-computes
  identically for identical bytes (FR-042a).
- **CI (D7)** — the workflow with the Environment reviewer gate; the *actual publish* runs only against a
  real tag with a human approver (authored here, executed in CI).
