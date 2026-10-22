# The artifact set and what ships inside it

The four roles, their filenames and what each one is are listed in
[`docs/releasing.md`](../../../../docs/releasing.md#the-artifact-set) — that is their home. This file
holds how the set is declared and enforced, and what every artifact contains. Packaging constraints
(`npmRebuild: false`, `asar: false`, the bundled host-Node runtime) live in
[build-and-packaging.md](build-and-packaging.md).

## Declared, not discovered

Four roles: `setup`, `msi`, `portable`, `archive`. The two installers each carry two **install
scopes** (`per-user`, `machine`) — spec 058 superseded 020 FR-040 and, for the machine-wide path
only, FR-012 — and the declaration derives one **verification combination** per artifact and scope
(`combinationsOf`): `setup-user`, `setup-machine`, `msi-user`, `msi-machine`, `portable`, `archive`.
An artifact verified in two scopes is still one file with one checksum.

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
node scripts/artifact-set.mjs list --combinations   # id, role, scope, verdict file — the matrix's one source
```

## How the installers are customised

- **The setup** shadows two electron-builder NSIS templates — `installSection.nsh` and
  `multiUserUi.nsh` — with modified copies in `packaging/nsis/`, pulled in by `packaging/installer.nsh`
  with `!addincludedir` + `!cd`. Never `nsis.script`: it makes electron-builder skip the uninstaller
  pass. `packaging/nsis/multiUser.nsh` is a forwarding shim, because NSIS's own include dir has a
  `MultiUser.nsh` that otherwise wins. `nsis-vendored-templates.test.ts` pins the `app-builder-lib`
  version and upstream hashes (`packaging/nsis/UPSTREAM.md`): **an electron-builder upgrade fails it
  on purpose**, and the vendored copies are re-diffed against the new upstream before the pin moves.
- **The MSI** is electron-builder's `msi` target, its generated WiX project rewritten by
  `packaging/msi-project.cjs` (`msiProjectCreated`) through the pure transforms in
  `packages/core/src/config/msi-project.ts`. Each transform throws when its anchor is missing, so a
  template change upstream fails the build rather than silently dropping a transform; the fixture
  `msi-template-output.wxs` is re-captured when it does. `additionalWixArgs: -sw1077` is needed
  because property values carry PowerShell containing `[`. `InstallPrivileges="limited"` is what
  keeps a per-user double-click from prompting — the template alone requires elevation.
- **The in-use helper** (`packaging/in-use.mjs` + a standalone copy of `install-in-use.js`, staged by
  `stage-runtime.mjs` into `resources/in-use/`) answers "who is using this install root" for both
  installers, run with the installed copy's bundled `node.exe`.

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

Both installers refuse a **downgrade** of the copy they replace, in its own scope (setup: exit `2`;
MSI: `MajorUpgrade`, exit `1603`); installing an older version as a *separate* copy is allowed. The
message tells the user to uninstall first (the user's side is
[Installation → Downgrading](../../../../docs/installation.md#downgrading)).

## Requirements behind it

[`specs/020-application-packaging/`](../../../../specs/020-application-packaging/),
[`specs/042-release-notes-and-artifacts/`](../../../../specs/042-release-notes-and-artifacts/),
[`specs/058-machine-wide-install-msi/`](../../../../specs/058-machine-wide-install-msi/).
