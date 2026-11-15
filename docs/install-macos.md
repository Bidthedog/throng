[throng](../README.md) › [Docs](README.md) › Installing on macOS

# Installing throng on macOS

throng runs on Apple silicon Macs with the current or the previous release of macOS. Older releases may work but are
not supported, and there is no build for Intel Macs. No Node.js, compiler or other runtime is needed.

**macOS support is best endeavours.** The project has no Mac to test on, so every macOS build is checked only by
automated tests on hosted macOS machines. How throng looks and feels on a real Mac depends on your reports: if
something is wrong, please [open an issue](https://github.com/Bidthedog/throng/issues).

## Quick start

1. Download `throng-<version>-mac-arm64.dmg` from the
   [Releases page](https://github.com/Bidthedog/throng/releases).
2. Open it and drag **throng** into **Applications**.
3. Open throng from Applications. macOS blocks it the first time, because the build is not notarised by Apple.
4. Open **System Settings → Privacy & Security**, scroll to **Security**, and choose **Open Anyway** beside the message
   about throng. Confirm, and throng opens. macOS remembers the choice, so later launches open straight away.

Next, take the [tour](quick-start.md). What differs on macOS is listed in [macOS](macos.md).

## Why macOS asks

macOS opens without asking only apps signed with an Apple Developer ID and notarised by Apple. throng's builds are
signed, but not with a Developer ID, so macOS asks you once. Nothing else is needed: throng does not ask for an
administrator password to install, and changes no system setting.

## Downloading

Each release offers two macOS downloads, both for Apple silicon. Its notes list a SHA-256 checksum for each: compare it
with what `shasum -a 256 <file>` prints in Terminal, and if they differ, delete the file and download it again.

| Download | Choose it when |
|---|---|
| `throng-<version>-mac-arm64.dmg` | Usually. Open it and drag throng into Applications. |
| `throng-<version>-mac-arm64.zip` | You prefer an archive. Double-click it, then move throng into Applications. |

Always move throng into **Applications** before you open it. Opened straight from the download or the disk image, it
says so and starts nothing: quit, drag it into Applications, then open it again.

## The `throng` command

To open folders from Terminal with `throng <path>`, choose **throng → Install 'throng' command** from the menu bar.
macOS asks for your password, because the command goes in `/usr/local/bin`. **throng → Uninstall 'throng' command**
removes it. Both are also in the [key bindings list](key-bindings.md), with no default chord.

A folder also opens as a project when you drop it on throng's icon in the Dock, or choose **Open With → throng** on it in
Finder.

## Upgrading

Download the newer version and drag it into Applications, replacing the old copy. A copy that is running keeps working,
and tells you the installed version has changed; your terminals carry on when you restart it. Your projects and settings
are kept. throng itself never checks for updates or downloads them.

## Removing throng

Quit throng and drag it from Applications to the Trash. If you installed the `throng` command, uninstall it first from
the menu bar.

Your projects and settings stay behind in your own folders, ready for a reinstall. To remove them too, delete:

| Folder | Holds |
|---|---|
| `~/Library/Application Support/throng` | The database and your settings |
| `~/Library/Logs/throng` | Logs |

## Building from source

[Running from source](installation.md#running-from-source) works on macOS too. It needs the Xcode Command Line Tools
(`xcode-select --install`) only if a native module has no prebuilt binary for your Mac.
