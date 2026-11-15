# Quickstart: Validating macOS Support

There is no Mac for this project. Everything below runs on GitHub-hosted macOS runners; nothing is a manual step on a Mac.

## Prerequisites

- The branch pushed, PR ready (CI runs only on a ready PR), or `gate.yml` / `release.yml` dispatched by the maintainer.
- `.github/macos-runners.json` names two labels that exist (first run proves it).

## 1. Pull-request CI

Mark the PR ready and watch the run (`gh run watch <id> --exit-status`, verdict from `gh run view`).

Expected: `macos-fast`, `macos-test` and `macos-e2e` green on both labels, beside unchanged Windows and Linux jobs.
`macos-e2e` runs `@core` and every `@macos` spec against the app built on that runner.

## 2. Gate

`gh workflow run gate.yml --ref feature/S070-I22-macos-support`.

Expected: `gate-macos` green on both labels; its log carries a `MEASURE {…echoP95Ms…}` line at or under 100 ms.

## 3. Release dry run

`gh workflow run release.yml --ref feature/S070-I22-macos-support`.

Expected: `build-macos` produces both artifacts with every Mach-O arm64 and signed; `verify-macos` writes one verdict per
role per runner with every step passed except `gatekeeper-first-launch`, recorded unproven; `render-body`'s preview lists
the macOS downloads, the Open Anyway step and `shasum -a 256`.

## 4. Failure drills (automated, in the suites)

| Drill | Where it is proved |
|---|---|
| A broken macOS implementation fails CI | contract suites on `macos-test` (SC-009) |
| A translocated launch starts nothing | `startup-refusal` unit + verify step |
| A binary that is not arm64 or not signed fails the build | `after-sign.cjs` exit code, `build-macos` |
| A failed verify step blocks publication | `publish-gates.mjs` unit tests with a macOS verdict |

See [contracts/ci-lanes-macos.md](contracts/ci-lanes-macos.md) and
[contracts/packaging-and-release-macos.md](contracts/packaging-and-release-macos.md) for the exact jobs and steps.
