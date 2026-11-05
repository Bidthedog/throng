# Implementation Plan: Website and Package Repositories

**Branch**: `feature/S064-I554-website-and-package-repos` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Two signed package repositories served from one GitHub Pages deployment on `throng-ide.com`. The package files stay on
GitHub Releases. Each release carries a signed bundle of its indexes, and every deployment lays those bundles beside the
static files, so a change to a static file needs no key. The website is deferred (spec, Clarifications).

## Technical Context

- **Language**: Node `.mjs` with built-ins only.
- **Dependencies**: None added. The pipeline uses `gpg`, `dpkg-deb` and `createrepo_c` from the distributions.
- **Testing**: unit (channel rules, index contents, assembly, workflow shape, channel files), and the release pipeline's
  clean-machine route check, which is also run locally in containers against real packages.
- **Target**: apt 2.4+ and supported Fedora, as 063.

## Constitution Check

| Principle | How this holds |
|---|---|
| II Platform abstraction | No application code changes. Both Linux package families ship together |
| V Testing | Rules at unit, the route on a clean machine in the pipeline |
| VIII YAGNI | One version per channel, no generator framework, no package hosting |

No violation needs justifying.

## Complexity Tracking

| Deferral | Tracked by | Why |
|---|---|---|
| The website: User Story 1, FR-001 to FR-003 | [#554](https://github.com/Bidthedog/throng/issues/554), which stays open | The maintainer set the first version aside at review, and asked for the repositories first |

## Structure

```text
site/                               the channel files and the public key
scripts/package-repo.mjs            builds, signs and bundles a release's indexes
scripts/site.mjs                    assembles the site from bundles
scripts/verify-package-repo.mjs     the clean-machine route check
scripts/repo-signing-key.sh         creates the signing key and stores it
.github/workflows/pages.yml         deploys the assembled site
.github/workflows/release.yml       verify-repositories, sign-index, deploy-repositories
```

## Windows stays as it is (FR-014)

The new jobs are Linux jobs. `publish` gains one `needs` entry, so a failed route check blocks it. The declared artifact
set does not change.
