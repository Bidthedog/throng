[throng](../README.md) › [Docs](README.md) › macOS

# throng on macOS

throng runs on Apple silicon Macs with the current or the previous macOS release, from the
[downloaded app](install-macos.md) or [from source](installation.md#running-from-source). Support is best endeavours:
the project has no Mac, so everything below is checked only by automated tests on hosted macOS machines. If something
looks or behaves wrong, please [open an issue](https://github.com/Bidthedog/throng/issues).

This page is the one list of what differs from Windows. Anything not listed here behaves the same.

## The window and the app

- Windows carry the standard macOS window buttons on the left of the title bar.
- The menu bar has throng's application menu (About, Settings…, Install 'throng' command, Hide, Quit), plus Edit,
  Window and Help.
- Closing the last window leaves throng running in the Dock, with your terminals and layout. Click the Dock icon to
  bring the window back. Quitting (Cmd+Q, the menu or the Dock) runs the usual closing steps.
- Opened straight from a download or the disk image, rather than from Applications, throng says so and starts nothing.
- throng refuses to start as root.
- The Windows taskbar and foreground hand-off features have no macOS equivalent, and their controls do not appear.

## Key bindings

Application shortcuts use Cmd where Windows uses Ctrl, so `Ctrl+Shift+T` is `Shift+Cmd+T`. Terminals still receive
Ctrl, so `Ctrl+C` and `Ctrl+R` reach your shell. Where macOS keeps a Cmd shortcut for itself, throng uses another one:
the list is in [key bindings](key-bindings.md#on-macos).

Option types the characters your keyboard layout puts on it. To make it the Meta key in terminals instead, turn on
[Use Option as Meta](preferences.md).

## Terminals

- Every shell in `/etc/shells` or on your path that throng knows is offered, including those installed with Homebrew.
  Your login shell, usually zsh, comes first.
- Terminals start as login shells, as Terminal.app's do, so they have your full environment even when throng was
  opened from the Dock.
- A terminal's folder is read from the system, so no shell integration is needed for it.
- Terminals have no elevated (run as administrator) mode; `sudo` inside a terminal works as usual.

## Files

- Paths follow the volume they are on: a normal Mac volume ignores case, a case-sensitive one does not. Renaming
  `readme.md` to `README.md` works on either.
- Deleted items go to the Trash, and undo puts them back. If macOS withholds the Trash from throng, the notice says the
  item is in the Trash and that Finder's **Put Back** restores it.
- macOS asks before an app reads Desktop, Documents, Downloads, iCloud Drive or a removable volume. If you declined, the
  File Explorer says which folder it cannot read and how to allow it in System Settings.
- There is no "Open as throng project" item in Finder's right-click menu. Drop a folder on throng's Dock icon, use
  **Open With → throng** in Finder, or the [`throng` command](install-macos.md#the-throng-command).
- The Properties panel has no button to open the system's own dialog; use Finder's **Get Info** instead.

## Resource Monitor

CPU, memory and disk figures are shown for every throng process. GPU and network use per process read "unavailable":
macOS does not report them for one process.

## Not checked by the automated tests

A hosted test machine cannot show these, so they rely on your reports:

- The first-launch **Open Anyway** step. Test machines do not mark downloads as coming from the internet.
- The privacy prompts for Desktop, Documents and the other protected folders. Test machines allow every folder.
- Whether undoing a delete needs Finder's Put Back on your Mac.
- Dragging files between Finder and the File Explorer, in either direction; a drag needs a real pointer.
- Pasting a Finder copy into the File Explorer in the running app. Copying from throng to the pasteboard is checked in
  the app, and decoding a Finder copy is checked against the real pasteboard, but not the two together.
- How the app looks and feels: fonts, spacing, the window buttons, the menu bar and the Dock.

## Coverage of the quick start

Each part of the [quick start](quick-start.md), and what proves it on macOS:

| Quick start section | Proved on macOS by |
|---|---|
| Before you start | [Installing on macOS](install-macos.md); the release checks of each download |
| First launch | `macos-smoke.e2e.ts`; the release checks (Open Anyway is [not checked](#not-checked-by-the-automated-tests)) |
| 1. Create a project | the `@core` lane on macOS |
| 2. Lay out the workspace | the `@core` lane on macOS; `macos-window.e2e.ts` |
| 3. Run a terminal | `macos-terminal.e2e.ts`; the terminal contract and soak tests on macOS |
| 4. Edit files | the `@core` lane on macOS; `macos-files.e2e.ts` |
| Files and your operating system | `macos-files.e2e.ts`; the trash and file-list pasteboard contract tests on macOS (Finder drag is [not checked](#not-checked-by-the-automated-tests)) |
| 5. Find things | the `@core` lane on macOS |
| 6. Tear off a sub-workspace | `macos-window.e2e.ts` |
| 7. Make it yours | the `@core` lane on macOS; the key bindings tests for macOS |
| 8. See what throng is using | the process metrics contract and accuracy tests on macOS |
| Getting help | nothing macOS-specific |
