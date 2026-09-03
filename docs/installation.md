# Installing throng

Downloading, verifying, installing, upgrading, and removing throng on Windows.

> **Status.** The installer described here comes from **feature 020 — Application Packaging**
> ([#21](https://github.com/Bidthedog/throng/issues/21)). To run a revision that has no release yet, use a
> developer checkout instead — `npm install && npm run build && npm start` (see the
> [quick start](quick-start.md)).

## Before you start

- **Windows 11 (x64).** throng is Windows-only today; macOS
  ([#22](https://github.com/Bidthedog/throng/issues/22)) and Linux
  ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.
- **No prerequisites.** You do **not** need Node.js, a compiler, or any runtime — the installer bundles
  everything the app needs.
- **No administrator rights.** throng installs **per user**, into your own profile. You are never asked for
  an admin password.

## 1. Download

From the [Releases page](https://github.com/Bidthedog/throng/releases), pick **one** of three downloads.
They are the same throng; they differ only in how it gets onto your machine.

| Download | Choose it when | What it does |
|---|---|---|
| `throng-setup-<version>.exe` | **You want throng properly installed.** This is the one to take if you are not sure. | A setup wizard. Installs into your own profile, adds a Start-menu shortcut, and appears in *Apps & features* so it can be removed the usual way. No administrator rights. |
| `throng-portable-<version>.exe` | You cannot install software, or you are trying throng out. | One file. Double-click it and throng runs — nothing is installed and no shortcut is created. It unpacks itself to a temporary folder each time it starts, so it takes longer to open than an installed copy. |
| `throng-<version>.zip` | You want to keep throng in a folder you choose — a USB stick, a tools directory, a second machine. | An ordinary archive. Extract it anywhere and run `throng.exe` from inside. Deleting the folder removes it. |

All three install **per user** and none of them asks for an administrator password. There is no
machine-wide install today; that is tracked as
[#361](https://github.com/Bidthedog/throng/issues/361).

Whichever you take, your projects, settings, themes and layouts live in your user profile rather than
beside the application — so you can move between these downloads without losing anything.

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
unrecognised-app** warning (SmartScreen) when you run one. This applies to the setup installer and the
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

**If you took the setup installer**, run it. Because it is per-user:

- it installs to `%LOCALAPPDATA%\Programs\throng` — no admin prompt;
- it creates a **Start-menu shortcut**, with throng's icon;
- it registers throng in **Settings → Apps → Installed apps**, where you can later remove it.

**If you took the portable build**, there is nothing to install: double-click
`throng-portable-<version>.exe` and throng starts. It has no Start-menu shortcut and does not appear in
*Installed apps*. To remove it, delete the file.

**If you took the archive**, extract it to any folder you can write to and run `throng.exe` from inside
it. To remove it, delete the folder.

## 4. First launch

Launch throng — from the Start-menu shortcut, the portable file, or `throng.exe` in the extracted folder.
Create a project and spawn a terminal; everything works with nothing else installed. See the
[quick start](quick-start.md) for the tour.

Your data — projects, layouts, settings, keybindings, custom themes, the edit list — is stored in your
**profile** (`%APPDATA%\throng` and `%USERPROFILE%\.throng`), **outside** the install folder. That is why
upgrading and uninstalling never disturb your work.

## Finding your version

Open **the application menu → Help → About throng**. The About dialog shows the product **version** and
build id as selectable text (copy them into a bug report), a copyright notice, and the full licence.

## Upgrading

Download the newer `throng-setup-<version>.exe` and run it over your existing install. All your data is
preserved and throng reports the new version; the previous version's files are replaced cleanly.

If throng is **running with a live terminal** when you upgrade, you are warned and offered the same three
choices throng gives when you close it with live terminals — **leave them running**, **terminate all**, or
**cancel and review** — and no terminal is left orphaned whichever you choose.

## Downgrading

Installing an **older** version over a newer one is **refused** — the installer detects it and tells you to
uninstall the current version first. This is deliberate: a newer version may have written settings or layout
an older one cannot read, so throng will not risk your data with an in-place downgrade. To run an older
version, [uninstall](#uninstalling) first (keep your data), then install the older version.

## Uninstalling

Uninstall from **Settings → Apps → Installed apps → throng → Uninstall**, or via throng's uninstaller.

**Your projects and settings are kept by default.** The uninstaller offers a checkbox —
**"also delete my projects and settings"** — that is **unticked** by default. Leave it unticked and a later
reinstall restores your world; tick it only if you want throng to remove your personal data too. Nothing is
deleted without that explicit tick.

Either way, the uninstall removes every installed component and leaves **no throng process running** and no
shortcut behind.

## Two users on one machine

Each Windows account installs and runs its **own** per-user copy of throng. Two accounts can run throng —
with live terminals — at the same time, fully isolated: neither account's terminals, projects, or settings
are visible to, or disturbed by, the other.

---

**See also:** [Quick start](quick-start.md) (using throng once it's installed) ·
[Versioning, packaging & releasing](releasing.md) (how these builds are made) ·
[README](../README.md).
