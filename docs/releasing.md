# Versioning, packaging & releasing

How a throng build becomes a versioned, packaged, verified, published release — end to end. For
maintainers and contributors.

> **Status.** This is the process introduced by **feature 020 — Application Packaging**
> ([#21](https://github.com/Bidthedog/throng/issues/21)); see
> [`specs/020-application-packaging/`](../specs/020-application-packaging/) for the design. It is live:
> [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds the installer, verifies it
> on a clean runner, and publishes the GitHub Release behind the `release` Environment's required reviewers.
> A release is cut by pushing a `v*` tag on `master`.

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

`0.0.0` is a placeholder that the publish gate refuses. The root and every workspace package carry the same
version together, which the version guard test enforces.

**Prereleases** use a SemVer prerelease suffix — `1.0.0-alpha1`, `1.0.0-rc.2` — and are published as
**GitHub prereleases**, so they never appear as the repository's latest release. The suffix is part of the
version's identity: the four-way match (installer filename, package, reported, tag) compares it exactly, so
a stable build cannot be published under a prerelease tag or the reverse. It does **not** affect
upgrade/downgrade ordering, which compares the `MAJOR.MINOR.PATCH` core only.

## 2. Packaging

### The artifact set

A release publishes **three artifacts**, and the set is **declared** rather than discovered:

| Role | Filename | What it is |
|---|---|---|
| `setup` | `throng-setup-<version>.exe` | The per-user NSIS wizard (`perMachine: false`, no administrator rights, installs into `%LOCALAPPDATA%\Programs\throng`). |
| `portable` | `throng-portable-<version>.exe` | A single self-extracting executable. Unpacks to a temporary folder and runs; installs nothing. |
| `archive` | `throng-<version>.zip` | An ordinary archive, extracted and run from wherever the user puts it. |

All three are per-user and none needs elevation. Machine-wide installation is **not** offered — that is
[#361](https://github.com/Bidthedog/throng/issues/361), which will supersede spec 020's FR-040 and FR-012
when it lands.

**The declaration is `packages/core/src/config/release-artifacts.ts`, and it is the contract.** Every step
of the pipeline — the upload, the verification, the publish gates, the checksum table in the release body —
resolves an artifact by its **role**, never by a wildcard, a file extension, or the order a directory
happens to list its contents. `portable` and `nsis` both produce a `.exe`, which is precisely why that rule
is not optional.

```bash
node scripts/artifact-set.mjs list        # role, filename, label
node scripts/artifact-set.mjs resolve setup   # the one path for that role
node scripts/artifact-set.mjs reconcile   # what was built == what was declared?
node scripts/artifact-set.mjs checksums   # the set, with each SHA-256 filled in
```

`reconcile` runs immediately after `npm run package` and **fails the build in both directions** — a
declared artifact that was not produced, and an artifact produced that nobody declared. The second half
matters as much as the first: a build whose output is not understood must not be published from. `npm run
package` therefore empties `dist/installer` first (`prepackage` → `scripts/clean-dist.mjs`), because a
stale artifact from a previous release otherwise fails a perfectly good build on a developer machine. CI
never sees this — a runner starts empty.

If `reconcile` reports an unexpected filename after a real build, fix it at
`electron-builder.yml`'s `artifactName` rather than by loosening the declaration.

### What ships inside

Every artifact carries the same contents; only the delivery differs. What ships inside one install root:

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

**Every** artifact is verified before any of them is published, each on a fresh CI runner so no developer
state can leak a false pass. What is proved is the same for all three — only how the app gets on and off
disk differs:

1. it gets onto disk: the setup installer runs silently (`/S`), the archive is extracted, the portable
   build unpacks itself;
2. it **launches** and reports the **expected version**;
3. its daemon runs under the **bundled runtime**, and a **core journey** works — create a project, spawn a
   terminal, then close and reopen with a live terminal and confirm it **reattaches** (Principle III
   surviving packaging);
4. its **checksum matches** its own bytes;
5. it comes off disk — uninstalled, or its folder deleted — and **nothing is left behind**.

```bash
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve archive)" --role archive
```

### A step has three outcomes, not two

`passed`, `failed`, and **`not-applicable`**. An archive has no install step and no uninstaller, and both
of the two-state answers are wrong: running the installer's step list against it would fail a perfectly
good release, and marking those steps *passed* would make the verdict assert an uninstall that never ran.
Spec 020's FR-027 already refuses to conflate absence with success for a missing verdict; this says the
same thing about a step, in the verdict, where a human reading it can see which checks were actually run.

The rule has teeth in both directions. A verdict marking a step `not-applicable` for a role that **does**
declare it applicable is **invalid**, not merely failing — that is a skipped check wearing an exemption's
clothes. An applicable step with no result at all is a failure, not a skip.

The result is a **verdict per artifact**, bound to that artifact's exact bytes and recorded as a CI
artifact. A **missing verdict is treated as a failure**, never as a pass — and a verdict covering only
*some* of the declared set is a refusal, not a partial pass. A broken artifact fails verification and the
failure **names the step** and the artifact that broke.

### What each artifact costs to start

Measured 2026-09-03 on a developer workstation, from launch to a window on screen:

| Artifact | First run | Every run after |
|---|---|---|
| Setup installer | install, then ~2 s | ~2 s |
| **Portable** | **23.1 s** | **23.3 s** |
| **Archive** | 58.1 s to extract | **1.6 s** |

**The portable build pays its cost on every launch, not once.** throng is deliberately not
asar-packed (020 FR-009), so a self-extracting build unpacks a ~135 MB tree each time it starts —
and the warm figure being no better than the cold one is that fact measured rather than assumed.
The archive front-loads the same work: one 58-second extraction, then launches as fast as an
installed copy.

Both are comfortably inside SC-005's three-minute download-to-terminal bar, so this is a trade to
tell users about (`docs/installation.md` does), not a reason to drop either.

### Running it on a developer machine

Verification is a **clean-machine** activity and CI is where it counts, but it does run locally, with two
caveats worth knowing because both once looked like product bugs:

- **The launch probe uses its own Electron profile** (`--user-data-dir`). Electron keys its single-instance
  lock to `userData`, and a *packaged* throng does not isolate that — so with throng already open, a
  verification launch acquires no lock, quits immediately, and the probe reports "no window". That is the
  harness colliding with your session, not a broken package.
- **The residue scan attributes processes by path.** A throng running from somewhere else is a different
  installation, not this run's residue.

Neither caveat affects CI, where nothing else is ever running — which is precisely why both went unnoticed
until someone reproduced a CI verdict locally.

**Verifying the portable build is the awkward one**, and its three rules are worth knowing because
each was learned from a failure that looked like a broken package and was not:

- Its launcher unpacks to a directory it **deletes when it exits**, so the harness copies the tree
  before stopping the launcher and probes the copy.
- It copies only once the tree has **settled**. `throng.exe` appears early and the remaining ~135 MB
  lands behind it, so copying on first sight takes a torn read — which starts, attaches a debugger,
  and then hangs forever waiting for a file that was never copied.
- It passes **no** `PORTABLE_EXECUTABLE_*` variables. Supplying them — which looks obviously correct,
  since the launcher sets them — makes the app exit 1 the instant Playwright attaches. The archive
  is the same binary driven the same way without them, and passes.

You can prove the residue scan is capable of failing, which is the only thing that makes its green
worth anything:

```bash
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve portable)" \
  --role portable --keep-residue
```

The unpacked tree is left in place and `residue-scan` **must** come back `failed`. If it passes, the
scan is looking somewhere the app never was.

## 4. Release notes — where the text comes from

**`CHANGELOG.md` is the source, and it is written before the tag.**

Add to its `## Unreleased` section as work merges; at release-preparation time, rename that heading to the
version and commit it. The pipeline reads only what was committed and composes the release body from it —
it never writes prose of its own, and it **never falls back** to another version's notes. That is the whole
point: a fallback that produces a plausible body is how an unreviewed release ships.

The body is always *notes, then a fixed footer* — the unrecognised-app warning, how to verify a download,
one **SHA-256 row per artifact against its own filename**, and the source revision. New content goes above
the footer, never in place of it, including when the body has to be shortened to fit: the notes are the
half with a fallback, the footer is the half without.

**Publication is refused, with no override, when the notes are missing, empty, or headed with a different
version.** A release that genuinely has nothing user-visible in it publishes by saying so, in exactly one
line — `- No user-visible changes in this release.` Anything else empty is a refusal, so an unwritten
changelog cannot pass as an uneventful release.

```bash
node scripts/release-notes.mjs render --version <v> --artifacts "$(node scripts/artifact-set.mjs checksums)"
```

The verify job renders the **exact body** publication will use and uploads it as
`release-body-preview.md`, before the gated job runs — so the person giving the sign-off approves the text
that actually ships, and a non-publishing `workflow_dispatch` rehearses the whole composition without
releasing anything.

## 4b. QA sign-off & publishing

Publishing runs only from the reviewed default branch, and is gated on five conditions with **no override
path**:

1. **A real version** — a placeholder (`0.0.0`) is refused.
2. **The artifact set reconciles** — what was built is exactly what was declared, in both directions.
3. **Verification passed** — for *every* artifact; a red, absent or partial verdict blocks it.
4. **Release notes bind to this version** — see section 4 above.
5. **Human QA sign-off** — a person approves the release through a **GitHub Environment with required
   reviewers**. This cannot be satisfied by automation, a default, or the passage of time; it is a
   deliberate human act that the build is fit to release.

The four cheap, deterministic conditions are evaluated **before** the human one, so a release that was
never going to publish does not first consume an approval.

When all five hold, publication:

- computes **each artifact's SHA-256 as the last step that reads its bytes**, so a checksum and its
  artifact can never disagree;
- creates a **GitHub Release** for the version carrying **every** artifact and the composed notes, records
  the **exact source revision** it was built from, and **refuses to re-publish** a version that already
  exists (a published artifact is immutable);
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
| Write the release notes | A human, in `CHANGELOG.md`, **before the tag** — reviewed as a diff. |
| Bump version, build, package | Locally or in CI (`npm run build`, `npm run package`). |
| Reconcile the artifact set | Wherever packaging ran, immediately after it. |
| Artifact verification (clean machine) | **CI** — a fresh `windows-2022` runner. Runs locally too, with the two caveats in section 3. |
| Render the release body | CI, in the verify job, uploaded for the approver to read. |
| QA sign-off | A human, via the GitHub `release` Environment. |
| Publish the GitHub Release | **CI only**, gated as above. |

**One thing only a real release can prove.** The publish job runs on a version tag (or an explicit
dispatch), so the `gh release create` call itself, the Environment approval and the prerelease flag are not
reachable from an ordinary push. Everything upstream of them is — a `workflow_dispatch` with
`publish: false` builds, reconciles, verifies every artifact and renders the body. Use that as the
rehearsal; see [spec 042's plan](../specs/042-release-notes-and-artifacts/plan.md) for the full breakdown
of what each tier can and cannot establish.

---

**See also:** [Installation](installation.md) (the user's side of this) ·
[Contributing](../CONTRIBUTING.md) · [Testing](testing.md) ·
[feature 020 spec & plan](../specs/020-application-packaging/).
