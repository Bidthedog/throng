[throng](../README.md) › [Docs](README.md) › Installation

# Installing throng

Everything you need to get throng onto a Windows machine and running: a packaged download for
using it, or a source checkout for running a revision that has no release yet. Once it is running,
the [quick start](quick-start.md) takes it from there.

## Before you start

- **Windows 11 (x64).** throng is Windows-only today; macOS
  ([#22](https://github.com/Bidthedog/throng/issues/22)) and Linux
  ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.
- **No prerequisites.** You do **not** need Node.js, a compiler, or any runtime — the installer bundles
  everything the app needs.
- **Administrator rights only if you want them.** Installing for yourself never asks for an
  administrator password. Installing for everyone on the machine does, once.

## 1. Choose who it is for, and the download

**Just you, or everyone on this computer?** Installing *just for you* puts throng in your own profile and
needs no administrator rights — the default, and the right choice on a machine that is yours.
Installing *for everyone* puts one copy where every account on the machine can run it, and needs an
administrator to approve it once. Either way, each person who uses throng keeps their own projects and
settings, and runs their own background service.

From the [Releases page](https://github.com/Bidthedog/throng/releases), pick **one** of four downloads.
They are the same throng; they differ only in how it gets onto your machine.

| Download | Choose it when | Just you / everyone |
|---|---|---|
| `throng-setup-<version>.exe` | **You want throng properly installed.** Take this one if you are not sure. | Both. The setup asks; *just you* is the default. |
| `throng-<version>.msi` | You are an administrator deploying throng with Intune, SCCM, Group Policy or a script. | Both. Run unattended as an administrator it installs for everyone; run by anyone else, just for them. |
| `throng-portable-<version>.exe` | You cannot install software, or you are trying throng out. One file; double-click and it runs. It unpacks itself each time, so it opens more slowly. | Neither — nothing is installed, and no rights are ever needed. |
| `throng-<version>.zip` | You want throng in a folder you choose — a USB stick, a tools directory. Extract it and run `throng.exe`. | Neither — nothing is installed, and no rights are ever needed. |

Your projects, settings, themes and layouts live in your user profile rather than beside the
application, so every download — and every copy you install — opens the same work.

The release notes for that version list a **SHA-256 checksum for every download**, against its own
filename, and repeat the guidance below.

## 2. Verify the download (recommended)

throng is unsigned (see [why](#the-unrecognised-app-warning)), so the checksum is how you confirm the file
you got is exactly the file that was released — untampered and uncorrupted. In PowerShell, using the
filename you actually downloaded:

```powershell
Get-FileHash .\throng-setup-<version>.exe -Algorithm SHA256
```

Compare the printed hash with the **SHA-256** value in that release's notes. If they match, the download is
intact. If they **don't**, do not run it — delete it and download again.

## The unrecognised-app warning

Because throng's downloads are **not code-signed**, Windows will show a **"Windows protected your PC" /
unrecognised-app** warning (SmartScreen) when you run one. This applies to the setup, the MSI and the
portable build alike, and to `throng.exe` the first time you run it from an extracted archive. It is
expected for an unsigned app and does not mean anything is wrong with the file — you already confirmed it
with the checksum in step 2.

To proceed: click **More info**, then **Run anyway**.

- **Never** turn off SmartScreen or any other security feature to install throng. If a guide tells you to,
  it is wrong.
- On some Windows 11 setups, a stricter **reputation-based protection** may **block** an unsigned,
  no-reputation file outright rather than offering "Run anyway". throng cannot defeat this, and you should
  not work around it by disabling protection — it is a known limitation of shipping unsigned. The checksum
  in step 2 remains your assurance the file is genuine.

## 3. Install

### The setup

Run it, and choose **Only for me** or **Anyone who uses this computer**.

| | Only for me (default) | Anyone who uses this computer |
|---|---|---|
| Installs to | `%LOCALAPPDATA%\Programs\throng` | `%ProgramFiles%\throng` |
| Administrator prompt | never | once, when you choose it |
| Start-menu shortcut | `throng (per-user)`, for you | `throng (all users)`, for every account |
| *Installed apps* entry | `throng <version> (per-user)` | `throng <version> (all users)` |

If you choose *Anyone who uses this computer* and decline the administrator prompt, nothing is installed:
the setup says so and returns you to the choice, so you can pick *Only for me* or try again.

### The MSI

Double-click it for the same choice, or deploy it unattended (below). It installs to its own folder —
`%LOCALAPPDATA%\Programs\throng MSI` for one user, `%ProgramFiles%\throng MSI` for everyone — with its own
Start-menu shortcut and *Installed apps* entry labelled `MSI`, so it never collides with the setup.

### The portable build and the archive

There is nothing to install. Double-click `throng-portable-<version>.exe`, or extract the archive to any
folder you can write to and run `throng.exe`. Neither creates a shortcut or an *Installed apps* entry, and
neither ever needs administrator rights, for whoever runs it. To remove one, delete the file or folder.

## Installing unattended

Every installer can be scripted. **An unattended install never asks for anything**: without the rights
it needs, it fails with a message and a non-success exit code, and it never quietly installs a
different way instead.

| Intent | Command | Notes |
|---|---|---|
| Setup, just for you | `throng-setup-<version>.exe /S` | Never needs elevation. Add `/currentuser` to say so explicitly. |
| Setup, everyone | `throng-setup-<version>.exe /S /allusers` | From an **elevated** prompt. Without elevation it prints why and exits `740`, installing nothing. |
| MSI, managed deployment | `msiexec /i throng-<version>.msi /qn` | Run as an administrator or SYSTEM (as Intune and SCCM do), it installs for everyone. |
| MSI, a standard user | `msiexec /i throng-<version>.msi /qn MSIINSTALLPERUSER=1` | Installs for that user alone, with no prompt. Without `MSIINSTALLPERUSER=1` an unattended run asks Windows Installer for everyone and fails with `1625`, installing nothing. |
| MSI, choose explicitly | `... /qn ALLUSERS=1` or `... /qn MSIINSTALLPERUSER=1` | The standard Windows Installer properties: `ALLUSERS=1` for everyone, `MSIINSTALLPERUSER=1` for just that account, even from an elevated prompt. Machine-wide still needs an elevated prompt. |

Exit codes: `0` success; `3010` success, finishing at the next restart (see
[upgrading](#upgrading)) — the MSI never restarts the computer itself, so `3010` means it is waiting
for one (pass `REBOOT=Force` to have it restart); `740` the setup was asked for everyone without elevation; `2` the setup refused
(a downgrade, or throng in use — below); `1603` the MSI failed, including a refused downgrade.

## 4. First launch

Launch throng — from the Start-menu shortcut, the portable file, or `throng.exe` in the extracted folder.
Create a project and spawn a terminal; everything works with nothing else installed. See the
[quick start](quick-start.md) for the tour.

Your data — projects, layouts, settings, keybindings, custom themes, the edit list — is stored in your
**profile** (`%APPDATA%\throng` and `%USERPROFILE%\.throng`), **outside** the install folder. That is why
upgrading and uninstalling never disturb your work.

## More than one copy

You can have as many copies of throng as you like — the setup and the MSI, for you and for everyone, an
older archive in a tools folder. Installing one never removes, refuses or warns about another, and
upgrading or uninstalling one leaves the rest alone.

One limit comes from Windows Installer itself: **the MSI counts as one product**, so an account that
already has it installed for itself, or can see it installed for everyone, gets that copy repaired
rather than a second one if it runs the MSI in the other scope. Use the setup for the second copy.

**Only one runs at a time.** Every copy opens the same projects and settings, so starting a second copy
while throng is open brings the running one to the front instead; if you started a *different* copy, the
running window says which copy is open and that you need to close it first to open the other. Copies of the
same version share your running terminals; starting a copy of a **different** version replaces throng's
background service, which ends any terminals still running.

## Finding your version

Open **the application menu → Help → About throng**. The About dialog shows the product **version** and
build id as selectable text (copy them into a bug report), a copyright notice, and the full licence.

## Upgrading

Run the newer setup (or MSI) the same way you installed: it upgrades **that** copy in place, preserving all
your data and replacing the previous version's files cleanly. A different copy is not touched.

If throng is **running with a live terminal** when you upgrade your own copy, you are warned and offered the
same three choices throng gives when you close it with live terminals — **leave them running**,
**terminate all**, or **cancel and review** — and no terminal is left orphaned whichever you choose.

**For an everyone-install, someone else may be using it.** Run interactively, the upgrade then refuses and
names the accounts still using throng, changing nothing; ask them to close it and try again. Run
unattended, it never closes anyone's throng: the files in use are replaced at the next restart, the
installer exits `3010`, and until then those accounts keep the version they started.

## Downgrading

Installing an **older** version over a newer copy is **refused** — the installer detects it and tells you to
uninstall that copy first. This is deliberate: a newer version may have written settings or layout an older
one cannot read, so throng will not risk your data with an in-place downgrade. To run an older version,
[uninstall](#uninstalling) first (keep your data) and install the older one — or keep both, as
[separate copies](#more-than-one-copy).

## Uninstalling

Uninstall from **Settings → Apps → Installed apps**, choosing the entry for the copy you want to remove, or
via that copy's uninstaller. Unattended: `"<install folder>\Uninstall throng.exe" /S` (add `/allusers`,
elevated, for an everyone-install), or `msiexec /x throng-<version>.msi /qn`.

**Your projects and settings are kept by default.** The uninstaller offers a checkbox —
**"also delete my projects and settings"** — that is **unticked** by default. Ticking it removes only **your
own** data, never another account's, and an unattended uninstall never deletes anyone's. Because every copy
you have shares that data, deleting it affects them all.

The uninstall removes every installed component of that copy and leaves **no throng process from it
running** and no shortcut behind. An everyone-install still in use by another account is handled as in
[upgrading](#upgrading).

## Several users on one machine

Each Windows account runs throng — its own background service, its own projects, settings and terminals —
whether from its own per-user copy or a single everyone-install. Accounts can run throng at the same time,
fully isolated: neither account's terminals, projects, or settings are visible to, or disturbed by, the
other.

## Running from source

To run a revision that has no release yet, or to work on throng itself:

- **Node.js 22.12 or later** and **Windows 11**. The native modules (`better-sqlite3`, `node-pty`) ship
  prebuilt binaries, so no compiler toolchain is needed.
- From a clone of the repository:

  ```bash
  npm install
  npm start            # builds everything, then opens the app
  ```

  After a build, `npm run start:ui` opens the app without rebuilding (it starts its own background
  service), and `npm run start:daemon` runs the background service alone.

A source run is a separate **dev instance**: it keeps its own data, config and background service, and is
not counted by the one-running-copy rule, so it can run beside an installed throng without touching it.
Where each lives, and the variables that move them, are in [environment](environment.md). Contributing
changes back is covered in [CONTRIBUTING.md](../CONTRIBUTING.md), and how the packaged downloads are built
in [releasing](releasing.md).
