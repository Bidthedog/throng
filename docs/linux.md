[throng](../README.md) › [Docs](README.md) › Linux

# throng on Linux

throng runs from source on Linux. There is no Linux package yet ([#550](https://github.com/Bidthedog/throng/issues/550)).
Ubuntu 26.04 with GNOME is the reference desktop, and CI runs on Ubuntu 24.04. To set it up, see
[running from source](installation.md#running-from-source).

This page is the one list of what differs from Windows. Anything not listed here behaves the same.

## Display

The window runs through XWayland by default, where dragging a tab out and placing windows work as they do elsewhere.
[`window.nativeWayland`](preferences.md) runs it directly on Wayland instead. `npm start` reads that setting and picks the display backend, so a window started any other way uses Electron's own choice.

## Key bindings

The defaults are the same as on Windows. GNOME keeps `Ctrl+Shift+Alt` with the arrow keys, so move focus between panels with the keypad instead: `Ctrl+Shift+Alt` with 8, 2, 4 or 6, for up, down, left or right. The preferences list these as `Ctrl+Shift+Alt+ArrowUp` and so on, because that is what those keys report. A keyboard with no keypad needs [its own chords](key-bindings.md).

The keypad's `+` and `-` do nothing with `Ctrl+Alt`, because those presses never reach throng. Zoom a panel with `Ctrl+Alt+=` and `Ctrl+Alt+-` on the main row, or `Ctrl+wheel`.

## Terminals

- Every shell in `/etc/shells` or on `PATH` that throng knows is offered: bash, zsh, fish, sh, dash, ksh, tcsh, pwsh and nu.
  Your login shell comes first.
- A terminal's folder is read from the system, so no shell integration is needed for it.
- Terminals have no elevated mode. throng refuses to start as root, and `sudo` inside a terminal works as usual.

## Files

- Names are case-sensitive, so `README.md` and `readme.md` are two files. A backslash is an ordinary character in a name.
- Deleted files go to the Trash. Undo restores them from your home Trash or the Trash of the disk they were on.
- An open folder is not protected from being renamed or deleted by another program, because Linux has no way to hold one.
  throng notices and reports it instead.
- A project past the machine's limit on watched folders stops updating live, and the notice says so. To raise the limit:
  `sudo sysctl fs.inotify.max_user_watches=524288`.
- A file is treated as a program by its extension, as on Windows, so running a file with no extension is not warned about.

## Resource Monitor

- CPU, memory, disk and process details come from the system. Disk figures for another user's processes read as zero.
- Memory is what a process holds itself, without the shared libraries it has mapped, so it reads lower than the `RES` column in `top`.
- GPU use appears where the graphics driver publishes it, and otherwise says why it cannot.
- Per-process network use is unavailable, because Linux needs administrator rights to measure it.

## Not available

The taskbar and foreground hand-off features have no Linux equivalent yet, and their controls do not appear.

## The sandbox

throng keeps Electron's sandbox on. Ubuntu restricts the system feature that sandbox needs, so each checkout is allowed
once by a small AppArmor profile; see [running from source](installation.md#running-from-source). The profile limits
nothing else, so throng can open any folder you can, including other Git repositories anywhere on the disk.
