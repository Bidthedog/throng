# Versioning, packaging & releasing

How a throng build becomes a versioned, packaged, verified, published release — end to end. For
maintainers and contributors.

> **Status.** This is the process introduced by **feature 020 — Application Packaging**
> ([#21](https://github.com/Bidthedog/throng/issues/21)) for **v1.0.0**, being implemented on the
> `worktree-21-app-packaging` branch. The design is complete (see
> [`specs/020-application-packaging/`](../specs/020-application-packaging/)); the parts that build a real
> installer, verify it on a clean machine, and publish a real release run in CI and are still landing.
> Until it ships, throng runs from a developer checkout — see the [quick start](quick-start.md). This guide
> describes the target end-to-end process so it is understood before it is switched on.

## The shape of it

```
bump version  →  build  →  package  →  verify (clean machine)  →  human QA sign-off  →  publish
   (1 edit)      (tsc+vite)  (installer)   (install→…→uninstall)     (a person approves)   (GitHub Release
                                                                                             + checksum)
```

Publishing is **refused** unless three things are true at once — a real version, a passed verification, and
a recorded human sign-off — and every refusal names the condition that failed. Nothing about a release is
done by hand copying files around.

## 1. Versioning

**There is one authoritative version: the `version` field in the root [`package.json`](../package.json).**
Everything else derives from it.

- It follows **SemVer** (`MAJOR.MINOR.PATCH`), so any two versions can be ordered — which is what lets an
  installer decide upgrade vs. downgrade.
- **Bumping is a single edit.** Change the root `package.json` `version`; the build regenerates everything
  that carries the version. A guard test fails the build if any workspace package disagrees with the root.
- The running app reads it **from the root `package.json`** in the main process (the About dialog reads
  that file directly rather than `app.getVersion()`, which returns Electron's own version when the app runs
  unpackaged), from a build-generated constant in the daemon, and through the preload bridge in the renderer
  — never a second hand-maintained copy.
- It is **distinct from `BUILD_ID`.** `BUILD_ID` (see [`scripts/stamp-build.mjs`](../scripts/stamp-build.mjs))
  is a *content hash* used to detect and retire a stale daemon; the product version identifies a *release*.
  Two builds of one version differ in `BUILD_ID` but share the version. Do not conflate them.

Today every package is `0.0.0` — a placeholder that the publish gate refuses. The first real release is
`1.0.0`.

## 2. Packaging

The installer is produced by **electron-builder** with the **NSIS** target, configured **per-user**
(`perMachine: false`) so it installs without administrator rights into `%LOCALAPPDATA%\Programs\throng`.

What ships inside one install root:

| Component | Why it's bundled |
|---|---|
| The Electron app (main, preload, renderer) | The UI shell. |
| The daemon (`packages/daemon/dist`) + its native modules | Owns your terminals; runs detached. |
| A **pinned Node.js runtime** (`node.exe`) | The daemon's native modules (`better-sqlite3`, `node-pty`, `koffi`) are built against the **host-Node ABI**, not Electron's — so the daemon runs under this bundled runtime, never Electron. This is why nothing needs to be installed on the user's machine. |
| The product icon | Applied to the executable and the Start-menu shortcut. |
| The `LICENSE` text | AGPL-3.0 travels with the app; the About dialog shows it. |

At runtime **nothing is written under the install root** — all state lives in the user's profile
(`%APPDATA%\throng`, `%USERPROFILE%\.throng`), so an upgrade or uninstall never touches your data.

```bash
npm run build      # tsc + renderer + BUILD_ID + generated version constant
npm run package    # electron-builder → dist/throng-setup-<version>.exe  (per-user, self-contained)
```

The installer refuses a **downgrade** in place: installing an older version over a newer one is blocked with
a message telling the user to uninstall first (see [Installation](installation.md#downgrading)).

## 3. Verification — proving the installer before anyone ships it

Before a build can be released it is exercised **end-to-end on a clean environment, automatically** — a
fresh CI runner, so no developer state can leak a false pass. The verification:

1. installs the package silently, per-user (`throng-setup-<version>.exe /S`);
2. launches the app and confirms it reports the **expected version**;
3. runs a **core journey** — create a project, spawn a terminal, and (to prove Principle III survives
   packaging) close and reopen with a live terminal and confirm it reattaches;
4. confirms the **checksum matches** the artifact's bytes;
5. uninstalls silently and confirms **no process or component is left behind**, and that the install root
   was never written to.

The result is a **verdict** bound to the exact package (`{version, installerSha256}`) and recorded as a CI
artifact. A **missing verdict is treated as a failure**, never as a pass. A broken installer fails
verification and the failure **names the step** that broke.

## 4. QA sign-off & publishing

Publishing runs only from the reviewed default branch, and is gated on three conditions with **no override
path**:

1. **A real version** — a placeholder (`0.0.0`) is refused.
2. **Verification passed** — the publish job depends on the verify job; a red or absent verdict blocks it.
3. **Human QA sign-off** — a person approves the release through a **GitHub Environment with required
   reviewers**. This cannot be satisfied by automation, a default, or the passage of time; it is a
   deliberate human act that the build is fit to release.

When all three hold, publication:

- computes the installer's **SHA-256 checksum as the last step that reads its bytes**, so the checksum and
  the artifact can never disagree;
- creates a **GitHub Release** for the version carrying the installer **and its checksum in the release
  notes**, records the **exact source revision** it was built from, and **refuses to re-publish** a version
  that already exists (a published artifact is immutable);
- requires **no manual copying, renaming, or uploading** of anything.

## Reproducibility (SC-008)

A release records the two inputs that pin what it built: the **exact source revision** (the commit SHA,
written into the GitHub Release notes by the publish job) and the **exact bundled-runtime version**
(`resources/runtime/RUNTIME_VERSION.json`, stamped by `scripts/stage-runtime.mjs` from the Node build that
ran the packaging). A rebuild from that revision, on that runtime, produces the same installed component
set. This is a *component-set* reproducibility claim exercised as a CI / real-hardware boundary — not a
byte-for-byte determinism guarantee (installer timestamps and compression differ run to run).

## 5. Signing — why there is a checksum instead

throng's release artifacts are **not code-signed**. Code signing was considered and dropped for a solo
open-source project: it needs a paid, identity-validated publisher certificate held in hardware, and (for
the affordable automatable route) admits individual developers only in a limited set of countries. See the
decision record in [`spec.md`](../specs/020-application-packaging/spec.md) and
[research D7](../specs/020-application-packaging/research.md).

In its place, every release publishes a **SHA-256 checksum** so a downloader can confirm the file arrived
intact. A checksum proves **integrity**, not **identity** — and, unlike a signature, it does **not** remove
the operating system's "unrecognised app" warning, which will appear on every download. The release notes
therefore **explain that warning and how to verify against the checksum**, and never tell anyone to disable
a security feature. What the user sees, and what to do about it, is covered in
[Installation → the unrecognised-app warning](installation.md#the-unrecognised-app-warning).

## What runs where

| Step | Where it runs |
|---|---|
| Bump version, build, package | Locally or in CI (`npm run build`, `npm run package`). |
| Installer verification (clean machine) | **CI only** — a fresh `windows-2022` runner. |
| QA sign-off | A human, via the GitHub `release` Environment. |
| Publish the GitHub Release | **CI only**, gated as above. |

---

**See also:** [Installation](installation.md) (the user's side of this) ·
[Contributing](../CONTRIBUTING.md) · [Testing](testing.md) ·
[feature 020 spec & plan](../specs/020-application-packaging/).
