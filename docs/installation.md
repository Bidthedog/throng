[throng](../README.md) › [Docs](README.md) › Installation

# Installing throng

Pick your system. No Node.js, compiler or other runtime is needed for any download.

| System | Guide |
|---|---|
| Windows 11 (x64) | [Installing on Windows](install-windows.md) |
| 64-bit Linux | [Installing on Linux](install-linux.md), with `apt` and `dnf` repositories that bring upgrades with your system updates |

macOS ([#22](https://github.com/Bidthedog/throng/issues/22)) is planned. Once it is running, the
[quick start](quick-start.md) takes it from there. Each guide also covers opening a folder as a project from your file
manager, or with `throng <path>`.

## Running from source

To run a revision that has no release yet, or to work on throng itself:

- **Node.js 22.12 or later**, and **Windows 11** or **Linux**. On Windows the native modules (`better-sqlite3`,
  `node-pty`) ship prebuilt binaries, so no compiler toolchain is needed. On Linux, install `build-essential` and
  `python3`, and if a font list or the Trash is missing, `fontconfig` and `gvfs`.
- From a clone of the repository:

  ```bash
  npm install
  npm start            # builds everything, then opens the app
  ```

- **On Ubuntu 23.10 or later, once per clone:** Ubuntu restricts the system feature Electron's sandbox needs, and throng
  keeps that sandbox on. This allows it for this checkout and its worktrees, and changes nothing else. `npm run start:ui`
  prints the same command if you have not run it.

  ```bash
  sudo scripts/linux/apparmor-profile.sh install
  ```

  After a build, `npm run start:ui` opens the app without rebuilding (it starts its own background
  service), and `npm run start:daemon` runs the background service alone.

A source run is a separate **dev instance**: it keeps its own data, config and background service, and is
not counted by the one-running-copy rule, so it can run beside an installed throng without touching it.
Where each lives, and the variables that move them, are in [environment](environment.md). What differs on
Linux is listed in [Linux](linux.md). Contributing
changes back is covered in [CONTRIBUTING.md](../CONTRIBUTING.md), and how the packaged downloads are built
in [releasing](releasing.md).
