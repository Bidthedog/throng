# Contract: macOS Platform Services

`selectPlatform('darwin')` returns `MACOS`. Every entry of `PlatformServices` has a macOS implementation, and each passes
the shared contract for its seam on a hosted macOS runner (FR-012). Any other unimplemented platform still throws
`UnsupportedPlatformError`.

| Entry | macOS implementation | Contract run on macOS | Research |
|---|---|---|---|
| `traits` | `macosHostTraits` | `host-traits` unit (macOS traits), `macos-host.integration` | R4 |
| `platformInfo` | `MacosPlatformInfo` (`osName() === 'macos'`) | `runPlatformInfoContract` | — |
| `userDirectories` | `MacosUserDirectories` | `runUserDirectoriesContract` | R5 |
| `shellDetection` | `PosixShellDetection` (shared) | `runShellDetectionContract` | R9 |
| `ptyHost` | `MacosPtyHost` | `runPtyHostContract` | R9 |
| `directoryLock` | `PosixDirectoryLock` (shared) | `runDirectoryLockContract` (hold off, as Linux) | R1 |
| `elevation` | `PosixElevation` (shared) | `runElevationContract` (gains a POSIX run) | R1 |
| `deElevatedLauncher` | `NoDeElevatedLauncher` | — | R1 |
| `processCwd` | `MacosProcessCwd` (`PROC_PIDVNODEPATHINFO`) | new `runProcessCwdContract` | R2 |
| `processIdentity` | `MacosProcessIdentity` (`KERN_PROCARGS2`, start time) | new `runProcessIdentityContract` | R2 |
| `processMetrics` | `MacosProcessMetrics` (libproc, rusage) | `runProcessMetricsContract` | R2, R3 |
| `orphanProcesses` | `MacosOrphanProcesses` | new `runOrphanProcessesContract` | R10 |
| `foregroundHandoff` | `NoForegroundHandoff` | — | — |
| `fontEnumeration` | `MacosFontEnumeration` (JXA) | `runFontEnumerationContract` | R8 |
| `pathForms` | `PosixPathForms` (shared) | `runPathFormsContract` | R1 |
| `executableExtensions` | `MacosExecutableExtensions` | `runExecutableExtensionsContract` | R13 |
| `refusedUriSchemes` | `MacosRefusedUriSchemes` | `runRefusedUriSchemesContract` | R13 |
| `trashRestore` | `MacosTrash` (resulting-URL restore) | `runTrashRestoreContract` | R6 |
| `hasTaskbarOverlay` | `false` | — | — |
| `volumeRoots` | `MacosVolumeRoots` | new `runVolumeRootsContract` | R11 |
| `displaySwitches` | `() => []` | — | — |
| `lookupHolder` | POSIX stub (shared) | — | — |
| `startupRefusal` | root refusal + translocation refusal | unit | R10, R15 |
| `installedVersion` | `MacosInstalledVersion` | unit + package verify | R12 |
| `exitWhenEntryRemoved` | `true` | package verify (uninstall) | R12 |
| `fileListCodec` | `MacosFileListCodec` | `runFileListCodecContract` | R7 |
| `fileAttributes` | `MacosFileAttributes` | new `runFileAttributesContract` | R11 |
| `osPropertiesDialog` | unavailable ("use Finder's Get Info") | — | R11 |
| `fileAccessInfo` | `MacosFileAccessInfo` | new `runFileAccessInfoContract` | R11 |
| `fileManagerRegistration` | unavailable (FR-024) | — | R11 |
| `windowChrome` *(new)* | hidden title bar + traffic lights | component + `@macos` E2E | R16 |
| `privacyProtectedRoots` *(new)* | Desktop, Documents, Downloads, iCloud Drive, `/Volumes` | unit | R14 |
| `commandLineInstall` *(new)* | `MacosCommandLineInstall` | new `runCommandLineInstallContract` | R20 |

New contracts are written in behaviour terms and also run against the Windows and Linux implementations where those
implement the seam (FR-012, 062 FR-049). The six seams that had no contract before (`processCwd`, `processIdentity`,
`orphanProcesses`, `volumeRoots`, `fileAttributes`, `fileAccessInfo`) gain one here because macOS needs one; Windows and
Linux run them too.

## Shared POSIX code (`@throng/platform-node/src/posix/`)

Moved from `platform-linux` without behaviour change: `PosixElevation`, `PosixDirectoryLock`, `posixStartupRefusal`,
`PosixPathForms`, `PosixShellDetection`, `ensureOwnerOnlyDir`, `NodePtyCore` (spawn, write, resize, data, exit) and
`escalateSignals` (SIGHUP+SIGCONT, grace, SIGKILL with start-time guard). `platform-linux` re-exports each under its old
name; every existing Linux test passes unchanged.
