# Versioning

Why throng's version works the way it does. The procedure for choosing and bumping one is in
[`SKILL.md`](../SKILL.md) (*Settle the version first*, step 4).

## One authoritative version

**The `version` field in the root [`package.json`](../../../../package.json) is the only source.**
Everything else derives from it.

- It follows **SemVer** (`MAJOR.MINOR.PATCH`), so any two versions can be ordered — which is what
  lets an installer decide upgrade vs. downgrade.
- **Bumping is a single decision.** Change the root `version`; the build regenerates everything that
  carries it. `packages/core/tests/contract/product-version.contract.test.ts` fails the build if any
  workspace package disagrees with the root, so the root and every workspace carry the same version
  together.
- The running app reads it **from the root `package.json`** in the main process (the About dialog
  reads that file directly rather than `app.getVersion()`, which returns Electron's own version when
  the app runs unpackaged), from a build-generated constant in the daemon (`scripts/generate-version`),
  and through the preload bridge in the renderer — never a second hand-maintained copy.
- `0.0.0` is a placeholder, and the publish gate refuses it.

## Not `BUILD_ID`

`BUILD_ID` (see [`scripts/stamp-build.mjs`](../../../../scripts/stamp-build.mjs)) is a *content hash*
used to detect and retire a stale daemon; the product version identifies a *release*. Two builds of
one version differ in `BUILD_ID` but share the version. Do not conflate them.

## Prereleases

Prereleases use a SemVer prerelease suffix — `1.0.0-alpha1`, `1.0.0-rc.2` — and are published as
**GitHub prereleases**, so they never appear as the repository's latest release.

The suffix is part of the version's identity: the four-way match at publish time (installer
filename, package version, the version the installed app reports, the tag) compares it exactly, so a
stable build cannot be published under a prerelease tag or the reverse. It does **not** affect
upgrade/downgrade ordering, which compares the `MAJOR.MINOR.PATCH` core only.

## Requirements behind it

[`specs/020-application-packaging/`](../../../../specs/020-application-packaging/).
