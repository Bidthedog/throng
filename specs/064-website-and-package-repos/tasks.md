# Tasks: Website and Package Repositories

Tests come first in each group.

## Repositories

- [x] T001 Channel rules and highest-version selection (FR-007)
- [x] T002 `package-repo.mjs`: apt index and `Release`, rpm metadata pointing at release assets, signing, bundle (FR-004, FR-005, FR-006)
- [x] T003 `verify-package-repo.mjs`: install, upgrade, channels, tampered and unsigned refusal (FR-012, FR-013)
- [x] T004 Run the route check in containers against real `.deb` and `.rpm` packages (SC-002, SC-003, SC-005)

## Site

- [x] T005 `site.mjs`: assembly, fail on a missing bundle (FR-008, SC-004)
- [x] T006 The channel files (FR-011)

## Pipeline

- [x] T007 `pages.yml` and the `release.yml` jobs, with a test of who can reach the key and what depends on publication (FR-009, FR-010, FR-013, FR-014)
- [x] T008 `repo-signing-key.sh` (FR-009)
- [x] T009 Rehearse with `publish=false skip_e2e=true`; read `verify-repositories`

## Docs

- [x] T010 `docs/install-linux.md`, `docs/releasing.md`, `throng-release` skill, CHANGELOG (FR-015)

## Live, by the maintainer's go-ahead

- [x] T012 Create the signing key; create the Pages site; set its custom domain; confirm HTTPS
- [ ] T013 First real release: GitHub's redirects over HTTPS with throng's own assets, and how many approvals it asks for (research D3)

## Deferred

- [ ] T014 The website, with its preview and manual test plan (FR-001, FR-002, FR-003)
