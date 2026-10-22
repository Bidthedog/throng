# Contract: the verification matrix and the publish gate

**Feature**: 058 | Extends 042's `contracts/artifact-set.md` and `contracts/verification-verdict.md`.
Consumed by `.github/workflows/release.yml`, `scripts/artifact-set.mjs`,
`scripts/verify-installer.mjs`, `scripts/publish-gates.mjs`.

## `artifact-set.mjs` additions

### `list --combinations [--json]`

One line per verification combination: `<id>\t<role>\t<scope|->\t<verdictFile>`. `--json` emits the
`VerificationCombination[]`. Exit `0` always. This is the single source the workflow's matrix and the
publish gate both read; neither writes the list out.

### `list` (existing)

Gains the `msi` role. Output shape unchanged: `<role>\t<filename>\t<label>`.

## `verify-installer.mjs`

```
node scripts/verify-installer.mjs <artifact> --role <role> [--scope per-user|machine]
     --expected-version <v> --verdict-out verification-verdict-<id>.json
node scripts/verify-installer.mjs --coexistence --dir dist/installer
     --expected-version <v> --verdict-out verification-verdict-coexistence.json
```

- `--scope` is required for a role with scopes and refused for one without (exit `2`, naming the
  role's valid scopes).
- Every launch the harness makes sets `THRONG_PIPE_NAME`, `THRONG_CONFIG_ROOT`,
  `THRONG_DATABASE_PATH` and `--user-data-dir` to throwaway values **except** the coexistence run's
  `same-data-folder` and `second-launch-refused` steps, which must use the real per-user namespace
  and data folder to prove anything — and which therefore run only on a clean runner (refused on a
  machine with `%APPDATA%\throng` present unless `--allow-dirty-profile` is passed, with a warning).
- The second account is created with a random password, used, and deleted in a `finally`; its
  profile folder is removed. A run that cannot create it records `second-account` /
  `standard-account-install` as `failed` with the reason, never `unproven` — creating a local account
  is within an administrator's rights on the runner, so failing to is a defect.

## Steps, per combination

| Step | Proves | Setup | MSI | Portable / archive |
|---|---|---|---|---|
| (042 steps) | install … residue-scan | per 042 | per 042 setup's list | per 042 |
| `install-labels` | entry + shortcut carry scope and installer (FR-017b) | both scopes | both scopes | — |
| `standard-account-install` | per-user install as a real standard account, silently, succeeds (FR-006) | per-user | per-user | — |
| `second-account` | standard account launches the shared install: own daemon, own pipe, medium integrity, terminal works, isolation both ways (FR-012, FR-013, FR-029) | machine | machine | — |
| `in-use-upgrade` | with the second account running throng, an unattended reinstall exits `3010`, terminates nothing, registers pending replacements (FR-016a) | machine | machine | — |
| `not-elevated-launch` | the app started by the elevated installer runs at medium integrity (FR-007) | machine | machine | — |
| `silent-elevation-refused` | `/S /allusers` as the standard account exits `740`, installs nothing (FR-010) | machine | — | — |
| `no-write` | nothing writes to the install root at run time (FR-014) | both | both | — |

## Publish gate

`publish-gates.mjs` reads `THRONG_VERDICT_FILES`, which the workflow derives from
`list --combinations` plus `verification-verdict-coexistence.json`. Refusal messages:

| Condition | Message names |
|---|---|
| A combination's verdict file is missing | the combination id (FR-030) |
| A combination's step failed | the combination id and the step |
| A step outside `RUNNER_LIMITED_STEPS` reports `unproven` | the combination id and the step (treated as failed) |
| The coexistence verdict is missing or any step failed | `coexistence` and the step |

`unproven` on a runner-limited step does not refuse publication — the spec's Assumption on the second
account allows exactly that gap, provided it is reported on every run (data-model.md, `StepOutcome`); it is listed in the release-body
preview's verification summary and in the job summary.
