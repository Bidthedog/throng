# Tasks: Linux Packaging

Tests come first in each group.

## Artifact set

- [x] T001 Declare `deb`, `rpm` and `tarball`, give every artifact a platform, and filter reconcile and combinations by platform (FR-001, FR-016)
- [x] T002 `artifact-set.mjs --platform` for `list` and `reconcile`, defaulting to the running OS

## Packages

- [x] T003 Launcher: sandbox check, the fix's wording, the display default, paths with spaces (FR-006, FR-008)
- [x] T004 `afterPack`: rename the binary, write the launcher; no-op off Linux
- [x] T005 Maintainer scripts: version folder, `current`, command, profile, setuid fallback, prune, downgrade refusal, removal (FR-003, FR-007, FR-009, FR-011, FR-012)
- [x] T006 `electron-builder.yml` Linux targets, desktop entry, dependencies; `stage-runtime.mjs` on Linux; `npm run package:linux` (FR-001 to FR-005)
- [x] T007 Bundled runtime resolves to `node` on Linux (FR-002)

## Running copy

- [x] T008 `IInstalledVersion` seam, Linux and Windows halves (FR-010, FR-015)
- [x] T009 One notice with a Restart action, asked on focus and each minute (FR-010)
- [x] T010 A removed copy's daemon ends once it has no client (FR-013)

## Pipeline

- [x] T011 `verify-linux-package.mjs` (FR-017, FR-018)
- [x] T012 `release.yml`: build-linux on 22.04, the fixture, verify-linux, Fedora container, gates and body read all of it (FR-016, FR-019, FR-020, FR-021)
- [x] T013 Rehearse with `publish=false skip_e2e=true`; read every verdict

## Docs and hand tests

- [x] T014 `docs/installation.md`, `docs/linux.md`, `docs/releasing.md`, `throng-release` skill, CHANGELOG (FR-022)
- [x] T015 Manual test plan: real desktop application list and icon, notice, Wayland opt-in
