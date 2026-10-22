# Vendored NSIS templates (spec 058, research D3)

Two files in this folder are modified copies of electron-builder's NSIS templates. This page records
exactly what they were taken from and what was changed, so an `app-builder-lib` upgrade is a review
and not a surprise. `packages/ui/tests/unit/nsis-vendored-templates.test.ts` reads the values below
and fails when the installed upstream no longer matches them.

Version: 26.17.0

Upstream is `node_modules/app-builder-lib/templates/nsis/`. SHA-256 of the upstream bytes:

| File | SHA-256 | Vendored here? |
|---|---|---|
| `installer.nsi` | `8811964416d122612c3e7601728af5d3f998d677918df829a4e8b4c739c8b9f8` | no -- watched only |
| `installSection.nsh` | `74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072` | yes |
| `multiUserUi.nsh` | `f7a4524244e68dc0782a759e076e5e55fadef0f22bbccf33100a4ab59d69c066` | yes |

## How the copies take effect

Not through `nsis.script`: when electron-builder is given a custom script it skips the uninstaller
pass entirely (`NsisTarget.js`, `computeScriptAndSignUninstaller`), so no `Uninstall throng.exe`
would be produced. `packaging/installer.nsh` (the `nsis.include`) instead adds the template directory
as an include directory and runs `!cd` into this folder; makensis looks in its working directory
before the include directories, so the template's own `!include installSection.nsh` and
`!include multiUserUi.nsh` open these copies, in the installer pass and the uninstaller pass alike.
`multiUser.nsh` in this folder is a one-line forwarding shim to the template's own file, not a copy:
NSIS searches its own `Include` directory (which has a different `MultiUser.nsh`) before any added
include directory, so after the `!cd` the template's `!include "multiUser.nsh"` would otherwise
resolve to NSIS's stock file. Any other template file whose name NSIS also ships needs the same shim.

`installer.nsi` is the script piped to makensis and cannot be shadowed, which is why it is pinned
but not copied: its behaviours that 058 must change are neutralised from `customInit` instead.

## What was changed

`installSection.nsh`

- The downgrade refusal (FR-015, FR-022) moved here from `customInit`: it needs the chosen scope's
  registry hive (`SHELL_CONTEXT`), which `customInit` runs too early to know. Refusal exits `2`.
- The `uninstallOldVersion HKEY_CURRENT_USER` block is removed: installing machine-wide must not
  uninstall the per-user copy (FR-017).
- The Apps entry (`DisplayName`) and the remembered shortcut name carry the scope, and the desktop
  and start-menu shortcuts are named from it (FR-017b, research D4).
- The running-app check runs in the elevated inner process too (the template skipped it there).

`multiUserUi.nsh`

- Declining or failing the administrator prompt shows the FR-010a message instead of silently
  returning to the page (`THRONG_MSG_ELEVATION_DECLINED`, defined in `installer.nsh`).
- A silent machine-wide install without administrator rights exits `740` with a console message
  instead of raising the elevation prompt (FR-010).

## Checked, not changed

- **Finish-page launch (FR-007, research D10, T020).** `assistedInstaller.nsh` `StartApp` and
  `common.nsh` `StartApp` both launch with `StdUtils::ExecShellAsUser`, which starts the application
  through the shell at the desktop user's privilege level. An elevated machine-wide install therefore
  does not hand its elevation to the application, and nothing here overrides it.

## Re-pinning after an upgrade

1. Diff the new upstream files against the hashes above and port each change into the two copies.
2. Re-run `npm run package` and read the NSIS output for warnings.
3. Update `Version:` and the hashes.
