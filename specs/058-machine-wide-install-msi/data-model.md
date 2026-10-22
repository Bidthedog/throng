# Data Model: Machine-Wide Installation & the MSI

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

Nothing here is persisted by the application. These are the shapes the release tooling and the
instance guard pass around. The spec's Key Entities map onto them as noted.

---

## Release tooling (`@throng/core`, `packages/core/src/config/`)

### `InstallScope` — spec entity *Install scope*

```ts
type InstallScope = 'per-user' | 'machine';
```

### `ReleaseArtifactRole` — extended

```ts
type ReleaseArtifactRole = 'setup' | 'msi' | 'portable' | 'archive';
```

### `ReleaseArtifact` — spec entity *Artifact*, extended

| Field | Type | New? | Rule |
|---|---|---|---|
| `role` | `ReleaseArtifactRole` | — | unique within a set |
| `filename` | `string` | — | MSI: `throng-<version>.msi` |
| `label` | `string` | — | MSI: `Installer (MSI, for managed deployment)` |
| `audience` | `string` | **new** | one line: who should download this (FR-033, research D12) |
| `scopes` | `readonly InstallScope[]` | **new** | `['per-user','machine']` for `setup` and `msi`; `[]` for `portable` and `archive` (FR-003) |
| `applicableSteps` | `readonly VerificationStep[]` | — | the format's own steps; scope adds steps per `VerificationCombination` |
| `sha256` | `string \| null` | — | one per file, whatever its scope count (FR-032) |

### `VerificationCombination` — spec entity *Verification combination*

Derived, never declared by hand: `combinationsOf(set)` yields one per `(artifact, scope)` for an
artifact with scopes, and one per artifact for an artifact without.

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | `<role>-<user\|machine>` or `<role>` — e.g. `msi-machine`, `portable`. Unique. |
| `role` | `ReleaseArtifactRole` | the artifact it verifies |
| `scope` | `InstallScope \| null` | `null` for an artifact without scopes |
| `applicableSteps` | `readonly VerificationStep[]` | the artifact's steps ∪ the scope's steps (below) |
| `verdictFile` | `string` | `verification-verdict-<id>.json` |

Scope steps (research D11):

| Scope | Added steps |
|---|---|
| `per-user` | `standard-account-install` |
| `machine` | `second-account`, `in-use-upgrade`, `not-elevated-launch`, plus `silent-elevation-refused` for `setup` |

### `VerificationStep` — extended

New members: `standard-account-install`, `second-account`, `in-use-upgrade`,
`not-elevated-launch`, `silent-elevation-refused`, `install-labels` (the registered entry and
shortcut carry the copy's scope and installer — FR-017b; applies to `setup` and `msi`).

### `StepOutcome` — extended

```ts
type StepOutcome = 'passed' | 'failed' | 'not-applicable' | 'unproven';
```

`unproven` means the step applies but the environment could not exercise it, with a reason. It exists
for the cases the spec names: its Assumption that if the hosted runner cannot exercise a
genuine second account, *"that gap is reported on every run … rather than assumed covered"*. FR-030's
"every combination's verdict passed" is read with that Assumption: a combination whose only gap is
that named one has passed, and the gap is reported. Only steps
listed in `RUNNER_LIMITED_STEPS` (`second-account`'s GUI half, research D11, and `not-elevated-launch` while the runner's desktop is above medium) may record
it. Any other step reporting `unproven` is treated as `failed`. A verdict carrying `unproven` passes
the gate, but every `unproven` is listed by name in the rendered release-body preview and in the
verification job summary, so the gap is reported on every run and never assumed covered.

### `VerificationVerdict` — per combination

Unchanged in shape apart from `combination: string` (the combination id) replacing the role as its
identity. `isVerdictPassingForSet` becomes `isVerdictPassingForCombinations`: every combination must
have a verdict (absence is failure, 020 FR-027), every applicable step must be `passed` (or `unproven`
where allowed), and no applicable step may be `not-applicable`.

### `CoexistenceVerdict` — FR-031

| Field | Type | Rule |
|---|---|---|
| `copies` | `{ id: string; installRoot: string; version: string }[]` | every installer × scope plus the archive (five copies) |
| `steps` | record of `all-installed`, `each-launches-own-version`, `second-launch-refused`, `same-data-folder`, `reattach-across-copies` (FR-021), `reinstall-one-leaves-others`, `uninstall-one-leaves-others` → `StepOutcome` | all must be `passed` |

Verdict file `verification-verdict-coexistence.json`, required by the publish gate alongside the
combinations.

### `InstallInUse` — research D9

Input: the process list (`{ pid, executablePath, ownerSid, ownerName }[]`), the install root, the
performing account's SID. Output:

| Field | Type | Meaning |
|---|---|---|
| `own` | `number[]` | pids of the performing account's processes from this install root |
| `others` | `{ account: string; pids: number[] }[]` | other accounts using this install root, one entry each |
| `decision` | `'free' \| 'own-only' \| 'others'` | drives the installer's branch |
| `message` | `string \| null` | the interactive refusal text naming each account, `null` unless `decision === 'others'` |

A process whose executable is under a **different** copy's install root is not in the output: another
copy running never blocks this one (FR-017).

### `MsiProjectTransform` — research D1

`transformMsiProject(wxs: string, options): string` — pure text transform over the electron-builder
template output. Each transform is idempotent and throws if its anchor is missing, so a template
change upstream fails the build loudly instead of silently skipping a transform.

---

## Instance guard (`@throng/core` pure parts, `packages/ui/src/main` boundary)

### `InstanceNamespace`

The daemon pipe name this process resolved (`instancePipeName`). Two processes are in the same
namespace exactly when they resolved the same pipe name. The instance lock pipe is
`<namespace>.instance`.

### `CopyIdentity` — spec entity *Copy*

| Field | Type | Rule |
|---|---|---|
| `installRoot` | `string` | the folder holding the executable (`dirname(process.execPath)`) |
| `version` | `string` | the product version |

`isSameCopy(a, b)` compares `installRoot` case-insensitively with separators normalised.

### `LaunchMessage` — the instance pipe protocol

One line of JSON, sent by the losing launch: `{ "execPath": string, "version": string | null }`.
`version` is `null` when the launch arrived through Electron's `second-instance` event from a pre-058
copy, which sends no data — its `argv[0]` supplies `execPath`.

### `RunningInstance` — spec entity *Running instance*

The process holding the instance pipe for a namespace. At most one per namespace (FR-018). State:
`starting` → `primary` (pipe and legacy lock held) → released on quit. A launch is `secondary` when it
cannot listen on the pipe, and `yields-to-legacy` when it holds the pipe but not Electron's lock
(research D5).

### `DifferentCopyNotice` — research D5a

`{ runningRoot, runningVersion, launchedRoot }` → one inline notice in the main window. While it is
showing, a further different-copy launch re-flashes it instead of raising another.

### `DaemonHealth` — extended

`health.ping` gains `packaged: boolean` (research D7). Absent → treated as packaged.

---

## State transitions — a machine-wide upgrade or uninstall (FR-016a)

```
start
  └─ query in-use (helper) ──► free ─────────────► proceed
                         ├──► own-only ─────────► 020 FR-019 three-choice prompt → proceed / cancel
                         └──► others ─┬─ interactive ─► refuse, name accounts, change nothing
                                      └─ unattended ──► proceed; in-use files replaced/removed at
                                                        restart; exit 3010; no process terminated
```
