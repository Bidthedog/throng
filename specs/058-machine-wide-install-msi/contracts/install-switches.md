# Contract: install switches and exit codes

**Feature**: 058 | Consumed by administrators, managed-deployment tools, `verify-installer.mjs`, and
`docs/installation.md` (FR-011), which states it for readers.

The setup is `throng-setup-<version>.exe`; the MSI is `throng-<version>.msi`.

## The setup

| Intent | Command | Elevation | Result |
|---|---|---|---|
| Per-user, interactive | double-click | never | wizard; scope page defaults to *Only for me* (FR-002) |
| Machine-wide, interactive | double-click, choose *Anyone who uses this computer* | one prompt, at the scope page | declined → message, stays on the scope page, nothing installed (FR-010a) |
| Per-user, silent | `throng-setup-<v>.exe /S` | never | installs per-user; exit `0` |
| Per-user, silent, explicit | `throng-setup-<v>.exe /S /currentuser` | never | as above |
| Machine-wide, silent | `throng-setup-<v>.exe /S /allusers` from an **elevated** prompt | none further | installs machine-wide; exit `0` |
| Machine-wide, silent, not elevated | `throng-setup-<v>.exe /S /allusers` from a non-elevated prompt | **never prompts** | message on the attached console; nothing installed; exit `740` (FR-010) |
| Uninstall, silent | `"<install root>\Uninstall throng.exe" /S` (+ `/allusers` for machine-wide, elevated) | machine-wide only | data kept (020 FR-021, FR-016); exit `0` |

## The MSI

| Intent | Command | Result |
|---|---|---|
| Interactive | double-click | scope dialog; per-user default for a non-elevated run (FR-002); *for all users* elevates at the scope dialog, declined → message, stays (FR-010a, research D10a) |
| Managed deployment | `msiexec /i throng-<v>.msi /qn` run **elevated** (SYSTEM, an elevated script) | machine-wide (FR-003a); exit `0` |
| Standard user, silent | `msiexec /i throng-<v>.msi /qn MSIINSTALLPERUSER=1` | per-user, no prompt; exit `0` |
| Standard user, silent, no scope | `msiexec /i throng-<v>.msi /qn` | fails, nothing installed; exit `1625` — Windows Installer resolves no scope to machine-wide before the package runs (spec FR-003a, platform limit); never a different scope |
| Force per-user | `... /qn MSIINSTALLPERUSER=1` | per-user, even from an elevated prompt |
| Force machine-wide | `... /qn ALLUSERS=1` from an elevated prompt | machine-wide |
| Force machine-wide, not elevated | `... /qn ALLUSERS=1` from a non-elevated prompt | fails, nothing installed; exit `1625` or `1603` (Windows Installer's own codes); never falls back to per-user (FR-010) |
| Upgrade | `msiexec /i throng-<newer>.msi /qn` in the same scope | major upgrade of that copy only (FR-017a) |
| Downgrade | `msiexec /i throng-<older>.msi /qn` over a newer copy in the same scope | refused by `MajorUpgrade`'s downgrade check with its message; exit `1603`; nothing changed (FR-025) |
| Uninstall | `msiexec /x throng-<v>.msi /qn` (or by product code) | removed; data kept (FR-016) |

## Exit codes both installers share

| Code | Meaning |
|---|---|
| `0` | success |
| `3010` | success; files in use by another account are replaced or removed at the next restart (FR-016a) — unattended machine-wide upgrade or uninstall only |
| `740` | setup only: silent machine-wide install without elevation (FR-010) |
| `1602` | user cancelled (MSI) |
| `1603` | MSI: a fatal install error, including the downgrade refusal (its message names it) |
| `2` | setup: a refusal — a downgrade of this copy in place, or another account using the installation (interactive) |

## Interactive refusal text (FR-016a)

> throng is in use by other people signed in to this computer: **{account}, {account}**. Nothing has
> been changed. Ask them to close throng, then try again.

## Silent machine-wide without elevation (FR-010), setup, exit `740`

> throng: installing for every user of this computer needs administrator rights, and an unattended
> install never asks for them. Nothing has been installed. Run the installer from an elevated prompt,
> or leave out /allusers to install for the current user only.

A silent run that finds the performing account's own throng from this copy running exits `2`
(nothing changed), where it previously exited `0` having installed nothing.

## Elevation-declined text (FR-010a)

> Installing throng for everyone on this computer needs administrator approval, which was not given.
> Nothing has been installed. Choose *Only for me* to install for yourself, or try again.
