# Implementation Plan: Linux Packaging

**Branch**: `feature/S063-I550-linux-packaging` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Add `.deb`, `.rpm` and `.tar.gz` to the release set, built by electron-builder on `ubuntu-22.04` and verified on clean
runners. A running copy runs from a version folder of hard links that an upgrade leaves intact, and a shell launcher
reports a sandbox failure Electron cannot.

## Technical Context

- **Language**: TypeScript, Node `.mjs` tooling, POSIX shell for what runs before Electron or as root.
- **Dependencies**: electron-builder 26 (already present). No new package.
- **Testing**: unit (artifact set, notice text, launcher and package scripts run against temp folders), component
  (notice), contract (`IInstalledVersion`), and the release pipeline's clean-machine verdicts.
- **Target**: x64 Ubuntu 22.04+ and supported Fedora.

## Constitution Check

| Principle | How this holds |
|---|---|
| II Platform abstraction | `IInstalledVersion` and a host trait carry the differences; both OS halves ship together |
| III Terminals | Removal and upgrade kill nothing. Only a removed copy's own daemon ends, after its last client leaves |
| V Testing | Each decision is proven at the lowest layer that can show it; the lifecycle only in the pipeline |
| IX DI | The seam is wired through `@throng/platform` |

No violation needs justifying.

## Structure

```text
packaging/linux/            launcher.sh, after-pack.cjs, apparmor-profile.tpl, and the maintainer scripts
scripts/stage-runtime.mjs   stages `node` on Linux, and fills @VERSION@ into the maintainer scripts
scripts/verify-linux-package.mjs   the clean-machine harness
packages/core/src/config/release-artifacts.ts   three roles and a platform on every artifact
packages/core/src/config/installed-version.ts   the seam and the notice's text
packages/platform-linux/src/linux-installed-version.ts
packages/ui/src/renderer/common/installed-version-notice.tsx
.github/workflows/release.yml   build-linux and verify-linux jobs
```

## Windows stays as it is (FR-021, SC-006)

The Windows matrix, upload list and reconcile are filtered to `platform: win32`, so they read the same as before. No
step is added to the vocabulary. The `afterPack` hook returns at once off Linux. `stage-runtime.mjs` stages the same
Windows files.
