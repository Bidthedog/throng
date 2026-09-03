# Contract: the verification verdict, once it covers a set

**Feature**: 042 | Produced by `scripts/verify-installer.mjs`, consumed by
`scripts/publish-gates.mjs` and `packages/core/src/config/verification-verdict.ts`.

## What changes

Today the verdict certifies **one** installer, binding to it by `version` + `installerSha256`. It
becomes a verdict over the **declared artifact set**, with one `ArtifactVerdict` per role. `passed`
is true only when every artifact passed. The shape is in
[data-model.md](../data-model.md#verificationverdict-extended).

## The three step states, and why there are three

A step is `passed`, `failed`, or `not-applicable`. The third state is the whole contract.

`verify-installer.mjs` runs a fixed thirteen-step list today, ending `uninstall` → `residue-scan`.
An archive has no install step and no uninstaller. Two wrong answers are available and both are
worse than the work of adding a state:

- **Run the list unchanged and let those steps fail.** The verdict then says the archive is broken,
  which is false, and the gate refuses a good release.
- **Mark them passed.** The verdict then asserts an uninstall succeeded that never ran. A verdict
  that lies about what it checked is worse than no verdict at all, and 020 FR-027 already takes the
  position that absence and success must never be conflated — an absent verdict is a failure, not a
  pass.

So: a format declares its `applicableSteps`, and anything outside that list is recorded as
`not-applicable`, explicitly, in the verdict a human can read.

## Applicability per role

| Step | `setup` | `portable` | `archive` |
|---|---|---|---|
| `interrupted-install` | ✅ | — | — |
| `install` | ✅ | — | — |
| `launch` | ✅ | ✅ | ✅ |
| `version-match` | ✅ | ✅ | ✅ |
| `self-contained` | ✅ | ✅ | ✅ |
| `shortcut` | ✅ | — | — |
| `no-service` | ✅ | ✅ | ✅ |
| `core-journey` | ✅ | ✅ | ✅ |
| `reattach` | ✅ | ✅ | ✅ |
| `checksum-match` | ✅ | ✅ | ✅ |
| `no-write` | ✅ | — | — |
| `uninstall` | ✅ | — | — |
| `residue-scan` | ✅ | ✅ | ✅ |

**The six that are ✅ in every column are the end state FR-015 holds every format to**: it launches,
it is the version it claims, it runs under the bundled runtime, it registers no service, its daemon
boots and reattaches, its bytes match, and it leaves nothing behind. How it got on disk varies; what
it must be once there does not.

**Two entries in that table deserve their reasons stated:**

- **`no-write` is `setup`-only.** It asserts nothing is written under the *install root* at runtime
  (020 FR-008), which is a property of an installed program in a shared location. A portable or
  extracted throng runs from a folder the user owns; the rule does not apply to it, and asserting it
  would be asserting something else.
- **`residue-scan` applies to all three, and is hardest for `portable`.** A self-extracting build
  unpacks itself somewhere that is *not* the folder the user deleted (research D4). The scan must be
  pointed at the unpack location, not only at the download folder, or it will pass while leaving a
  full copy of the application on disk. This is the single most likely way this feature ships a false
  green, and the verification task for `portable` is not done until the scan has been shown to fail
  when residue is deliberately left.

## Validation rule

A verdict is **invalid** — not merely failing — when it marks a step `not-applicable` for a role
whose `applicableSteps` contains it. That is a skipped check wearing an exemption's clothes, and the
core module rejects it rather than evaluating it.

## Verdict → gate

`isVerdictPassingFor(verdict, version, artifactSet)` replaces today's
`isVerdictPassingFor(verdict, version, sha)`. It returns true only when:

1. `verdict.version` equals the version being published, and
2. every role in the declared set has an `ArtifactVerdict`, and
3. each of those binds to the sha256 of that artifact's actual bytes, and
4. each of those passed.

Point 2 is what enforces FR-016: **the set that is published must be the set that was verified.** A
verdict that covers two of three artifacts is not a partial pass; it is a refusal, and the message
names the artifact with no verdict.
