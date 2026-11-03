# Contract: Platform Services

`selectPlatform(nodePlatform: string): PlatformServices`

| Input | Result |
|---|---|
| `win32` | Today's Windows classes. Same constructors, same arguments. |
| `linux` | `platform-linux` classes. |
| anything else | Throws `UnsupportedPlatformError` naming the platform (FR-050). Never another platform's set. |

## Rules

- Composition roots import `@throng/platform` for selection. Nothing else in `packages/daemon/src` or `packages/ui/src` imports a concrete platform package.
- A capability a platform lacks is expressed by the interface: `NoForegroundHandoff`, `passthroughDeElevator`, `isElevated() === false`, `conhostPid: null`, `Unavailable` metrics.
- Every factory on Linux passes the same shared contract suite in `packages/core/src/testing` as Windows, where one exists; each new seam (`IUserDirectories`, `ITrashRestore`, `IOrphanSnapshot`) gets a suite written in behaviour terms (FR-049).

## Linux behaviours beyond the shared suites

| Service | Must |
|---|---|
| `ptyHost.end` | End the whole tree within the limit, with survivors reported; never touch a process it did not start. |
| `ptyHost` start as root | Unreachable: main refuses first (FR-019). |
| `shellDetection` | Only real, executable files; login shell first; no duplicates through `/bin` → `/usr/bin` symlinks. |
| `processCwd.read` | A gone or foreign process is absent from the map, never an error. |
| `directoryLock` | Advisory only. Linux has no equivalent of a held directory handle blocking removal; `acquire` succeeds and records the path. |
| `trashRestore.restore` | Restores across filesystems; rejects with a plain reason when not found or when the original path is occupied. |
| `processMetrics.terminate` | Checks start time; `gone` if the process was replaced. |
