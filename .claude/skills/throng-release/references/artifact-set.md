# The artifact set and what ships inside it

The three roles, their filenames and what each one is are listed in
[`docs/releasing.md`](../../../../docs/releasing.md#the-artifact-set) — that is their home. This file
holds how the set is declared and enforced, and what every artifact contains. Packaging constraints
(`npmRebuild: false`, `asar: false`, the bundled host-Node runtime) are the `throng-build-release`
agent's, in [`.claude/agents/throng-build-release.md`](../../../agents/throng-build-release.md).

## Declared, not discovered

All three artifacts are per-user and none needs elevation. Machine-wide installation is **not**
offered — that is [#361](https://github.com/Bidthedog/throng/issues/361), which will supersede spec
020's FR-040 and FR-012 and add a fourth role when it lands.

**The declaration is `packages/core/src/config/release-artifacts.ts`, and it is the contract.** Every
step of the pipeline — the upload, the verification, the publish gates, the checksum table in the
release body — resolves an artifact by its **role**, never by a wildcard, a file extension, or the
order a directory happens to list its contents. `portable` and `nsis` both produce a `.exe`, which is
precisely why that rule is not optional, and why `ls dist/installer/*.exe | head -n1` was removed
from three places in `release.yml`.

```bash
node scripts/artifact-set.mjs list        # role, filename, label
node scripts/artifact-set.mjs resolve setup   # the one path for that role
node scripts/artifact-set.mjs reconcile   # what was built == what was declared?
node scripts/artifact-set.mjs checksums   # the set, with each SHA-256 filled in
```

## Reconcile fails in both directions

`reconcile` runs immediately after `npm run package` and **fails the build in both directions** — a
declared artifact that was not produced, and an artifact produced that nobody declared. The second
half matters as much as the first: a build whose output is not understood must not be published
from.

`npm run package` therefore empties `dist/installer` first (`prepackage` →
`scripts/clean-dist.mjs`), because a stale artifact from a previous release otherwise fails a
perfectly good build on a developer machine. CI never sees this — a runner starts empty.

If `reconcile` reports an unexpected filename after a real build, fix it at
`electron-builder.yml`'s `artifactName` rather than by loosening the declaration.

## What ships inside

Every artifact carries the same contents; only the delivery differs. One install root holds:

| Component | Why it's bundled |
|---|---|
| The Electron app (main, preload, renderer) | The UI shell. |
| The daemon (`packages/daemon/dist`) + its native modules | Owns the terminals; runs detached. |
| A **pinned Node.js runtime** (`node.exe`) | The daemon's native modules (`better-sqlite3`, `node-pty`, `koffi`) are built against the **host-Node ABI**, not Electron's — so the daemon runs under this bundled runtime, never Electron. This is why nothing needs installing on the user's machine. |
| The product icon | Applied to the executable and the Start-menu shortcut. |
| The `LICENSE` text | AGPL-3.0 travels with the app; the About dialog shows it. |

At runtime **nothing is written under the install root** — all state lives in the user's profile
(`%APPDATA%\throng`, `%USERPROFILE%\.throng`), so an upgrade or uninstall never touches the user's
data.

```bash
npm run build      # tsc + renderer + BUILD_ID + generated version constant
npm run package    # electron-builder → dist/installer/, one file per declared role
```

The setup installer refuses a **downgrade** in place: installing an older version over a newer one
is blocked with a message telling the user to uninstall first (the user's side is
[Installation → Downgrading](../../../../docs/installation.md#downgrading)).

## Requirements behind it

[`specs/020-application-packaging/`](../../../../specs/020-application-packaging/),
[`specs/042-release-notes-and-artifacts/`](../../../../specs/042-release-notes-and-artifacts/).
