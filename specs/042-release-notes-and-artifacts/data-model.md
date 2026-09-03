# Phase 1 Data Model: Release Notes & Multi-Artifact Publication

**Feature**: 042 | **Date**: 2026-09-02 | **Plan**: [plan.md](./plan.md)

Everything here is a **pure, serialisable shape in `@throng/core`**. Nothing in this file touches the
filesystem, spawns a process or reads an environment variable — those belong to the `scripts/*.mjs`
CLIs described in [contracts/](./contracts/).

---

## ReleaseArtifactRole

The stable identity by which every consumer asks for an artifact (D2). Not an extension, not a
filename, not a position in a directory listing.

```
'setup' | 'portable' | 'archive'
```

- **`setup`** — the per-user NSIS wizard that exists today.
- **`portable`** — the single self-extracting executable.
- **`archive`** — the zip, extracted to a folder.

Roles are closed and exhaustive **for this feature**. #361 adds one; the shape must not assume the
count is fixed, and no consumer may switch on "all three" in a way that fails to compile when a
fourth arrives.

## ReleaseArtifact

One member of the declared set.

| Field | Type | Meaning |
|---|---|---|
| `role` | `ReleaseArtifactRole` | The identity. Unique within a set. |
| `filename` | `string` | The exact expected filename, version already interpolated. Never a pattern at this point. |
| `label` | `string` | What the release body calls it, for a human choosing between them. |
| `applicableSteps` | `readonly VerificationStep[]` | Which verification steps mean something for this format (D3). A step not listed is **absent**, never passed. |
| `sha256` | `string \| null` | Filled once the bytes exist; `null` in a declaration. |

**Validation rules**:

- `filename` MUST contain the product version, so a file separated from its context is still
  identifiable (020 FR-004's principle applied to the artifact set).
- `applicableSteps` MUST be a subset of `VERIFICATION_STEPS` and MUST include `launch`,
  `version-match`, `self-contained`, `core-journey`, `checksum-match` and `residue-scan` — the six
  that constitute the end state FR-015 holds every format to.
- `sha256`, once set, MUST be the digest of the exact published bytes (020 FR-042a).

## ReleaseArtifactSet

| Field | Type | Meaning |
|---|---|---|
| `version` | `string` | The product version this set belongs to. |
| `artifacts` | `readonly ReleaseArtifact[]` | One per role, ordered as the release body should list them. |

**Validation rules**:

- Roles MUST be unique. A duplicate role is a programming error, not a runtime condition.
- Every `filename` MUST be unique — two artifacts that resolve to one file is the defect this feature
  removes.
- The set MUST be non-empty.

### Operations (pure)

| Operation | Shape | Behaviour |
|---|---|---|
| `declareArtifactSet(version)` | `(string) => ReleaseArtifactSet` | The single authoritative declaration. Interpolates the version into each filename. |
| `resolveArtifact(set, role)` | `(set, role) => ReleaseArtifact` | Returns the one artifact for that role, or throws naming the role. Never returns "the first match". |
| `reconcileArtifactSet(declared, foundFilenames)` | `(set, readonly string[]) => ReconcileResult` | Compares a declaration against what a build actually produced. |

### ReconcileResult

| Field | Type | Meaning |
|---|---|---|
| `matched` | `boolean` | True only when the found set is exactly the declared set. |
| `missing` | `readonly string[]` | Declared but not produced. |
| `unexpected` | `readonly string[]` | Produced but not declared. |
| `reason` | `string \| null` | A single sentence naming the discrepancy, for the refusal message (020 FR-031). `null` when matched. |

An **unexpected** artifact fails just as a missing one does. A build that produced a file nobody
declared is a build whose output is not understood, and publishing an artifact set that was never
verified is exactly what FR-016 forbids.

---

## ReleaseNotes

The parsed record for one version, from `CHANGELOG.md`.

| Field | Type | Meaning |
|---|---|---|
| `version` | `string` | The version the section is headed with. |
| `sections` | `readonly NotesSection[]` | The grouped content, in the order it will be rendered. |
| `isEmptyByDeclaration` | `boolean` | True when the section exists and explicitly states there is no user-visible change (FR-009). |

### NotesSection

| Field | Type | Meaning |
|---|---|---|
| `heading` | `string` | e.g. Added / Fixed / Changed / Known issues. |
| `entries` | `readonly string[]` | One line each, already plain text. |

**Validation rules**:

- A `ReleaseNotes` whose `version` does not equal the version being published MUST fail the gate
  (FR-005). This mirrors 020 FR-030's rule for a sign-off bound to a different build, and for the
  same reason.
- A section that is present but has no entries and does not declare emptiness is **absent** for
  FR-005's purposes. `isEmptyByDeclaration` is the only way to publish a release with no listed
  change, and it is a deliberate statement, not a fallback.

### NotesLookupResult

What the parser returns for a requested version, so the refusal can name which of the three states it
found.

```
{ found: ReleaseNotes }
| { found: null, cause: 'no-section-for-version' }
| { found: null, cause: 'section-empty' }
| { found: null, cause: 'version-mismatch', foundVersion: string }
```

---

## ReleaseBody

What is actually published. Composed, never authored at publish time.

| Part | Source | Rule |
|---|---|---|
| **Notes** | `ReleaseNotes` | FR-001. Skimmable groups, in declared order. |
| **Footer — warning** | Fixed text | FR-007, 020 FR-043. States the unrecognised-app warning and how to proceed; never tells anyone to disable a security feature. |
| **Footer — verification guidance** | Fixed text | FR-007. How to check a download against its checksum. |
| **Footer — checksum table** | `ReleaseArtifactSet` | FR-017. **One row per artifact**, each against its own filename, plus the label from D2 so a reader can tell which file they want (FR-023's counterpart in the body). |
| **Footer — source revision** | The commit SHA | FR-007, 020 FR-035. |

**Composition rules**:

- The footer is **invariant and always last**. New content is added above it, never in place of it —
  `docs/installation.md` promises the checksum is there, and 020 FR-043 makes the notes responsible
  for the warning.
- If the composed body would exceed the publishing platform's size limit, the **notes** are reduced
  (truncated with a pointer to the full CHANGELOG), never the footer, and publication still succeeds
  (FR-010). The footer is the load-bearing half; the notes are the half with a fallback.

---

## VerificationVerdict (extended)

Today the verdict binds to one installer via `version` + `installerSha256`. It becomes a verdict over
a **set**.

| Field | Type | Change |
|---|---|---|
| `version` | `string` | unchanged |
| `artifacts` | `readonly ArtifactVerdict[]` | **new** — one per artifact in the declared set |
| `passed` | `boolean` | now: true only when **every** artifact's verdict passed |
| `failedStep` | `VerificationStep \| null` | now qualified by which artifact failed it |

### ArtifactVerdict

| Field | Type | Meaning |
|---|---|---|
| `role` | `ReleaseArtifactRole` | Which artifact this covers. |
| `sha256` | `string` | Binds this verdict to those exact bytes (020 FR-024a). |
| `steps` | `Record<VerificationStep, 'passed' \| 'failed' \| 'not-applicable'>` | Three states, deliberately (D3). |
| `passed` | `boolean` | True when every applicable step passed and none failed. |

**Validation rule that carries the whole point of D3**: a step marked `not-applicable` MUST appear in
that artifact's `applicableSteps` complement. A verdict claiming `uninstall: not-applicable` for the
`setup` role is invalid — that is a format that *does* uninstall, so the step's absence would be a
skipped check dressed as an inapplicable one.
