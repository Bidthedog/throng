# Data Model: Linux Support in Dev Mode

No database schema change. Windows data is untouched. The entities are runtime values.

## HostTraits (core, one per process)

| Field | Windows (default) | Linux | Notes |
|---|---|---|---|
| `os` | `windows` | `linux` | `OsName` |
| `paths.caseSensitive` | `false` | `true` | |
| `paths.backslashIsSeparator` | `true` | `false` | |
| `ipc.kind` | `pipe` | `socket` | |
| `ipc.dir` | n/a | runtime directory | Absent until configured |

Set once by each process's composition root before any other throng module reads it. A second configuration with different values throws; the same values are a no-op.

## PlatformServices (`@throng/platform`)

One factory per core interface: `platformInfo`, `userContext`, `shellDetection`, `ptyHost`, `directoryLock`, `elevation`, `deElevatedLauncher`, `processCwd`, `processMetrics`, `gpuReader`, `networkReader`, `foregroundHandoff`, `fontEnumeration`, `pathForms`, `executableExtensions`, `refusedUriSchemes`, `userDirectories`, `trashRestore`, `orphanSnapshot`, `holderLookup`, plus `traits`.

## UserDirectories

| Method | Windows | Linux |
|---|---|---|
| `configRoot(dev)` | `~/.throng[-dev]` | `${XDG_CONFIG_HOME:-~/.config}/throng[-dev]` |
| `dataDir(dev)` | `%APPDATA%/throng[-dev]` | `${XDG_DATA_HOME:-~/.local/share}/throng[-dev]` |

`THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` and `--user-data-dir` take precedence. Linux folders are created `0700`, and the database file `0600`.

## DetectedShell additions

`id` values `bash zsh fish sh dash ksh tcsh nu` join the existing ones, and `pwsh` stays valid on both. A saved terminal naming a shell that is no longer present reports that per FR edge case; nothing migrates.

## TrashEntry (`platform-linux`, in memory)

`infoPath`, `filesPath`, `originalPath`, `deletedAtMs`. Parsed from `.trashinfo`; one with an unreadable or absent `Path` is skipped, never guessed.

## New setting

`window.nativeWayland: boolean`, default `false`, with editor metadata. Takes effect at the next start. Hidden from the editor on non-Linux platforms; present in the file on every platform with no effect there.
