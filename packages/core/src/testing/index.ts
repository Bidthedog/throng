export { runTrashRestoreContract, runUserDirectoriesContract, type TrashRestoreContractEnv } from './platform-seams-contract.js';
export { withHostTraits } from './with-host-traits.js';
export { FakeFileManagerRegistration } from './fake-file-manager-registration.js';
export { FakeFileAttributes, FakeOsPropertiesDialog, FakeFileAccessInfo } from './fake-properties.js';
export { isLinuxHost, isMacosHost, isWindowsHost, skipOnMacos, skipOnWindows, skipUnlessLinux, skipUnlessMacos, skipUnlessWindows } from './platform-guards.js';
// Test-only surface of @throng/core, exposed via the "@throng/core/testing"
// subpath export so the production entry point (".") stays free of test
// utilities. Consumed by test layers across packages.
export { runPlatformInfoContract } from './platform-info-contract.js';
export { runUserContextContract } from './user-context-contract.js';
export { runDisplayInfoContract } from './display-info-contract.js';
export { runConfigStoreContract } from './config-store-contract.js';
export type { ConfigStoreHarness } from './config-store-contract.js';
export { runFileWatcherContract } from './file-watcher-contract.js';
export { watchStarted } from './watch-started.js';
export type { FileWatcherHarness } from './file-watcher-contract.js';
export { runFileSystemContract } from './file-system-contract.js';
export type { FileSystemHarness } from './file-system-contract.js';
export {
  runShellIntegrationContract,
  runShellIntegrationDeElevationContract,
} from './shell-integration-contract.js';
export type {
  ShellIntegrationHarness,
  DeElevationHarness,
} from './shell-integration-contract.js';
export { runShellDetectionContract } from './shell-detection-contract.js';
export { runPtyHostContract, type PtyHostContractEnv } from './pty-host-contract.js';
export {
  runDirectoryLockContract,
  type DirectoryLockContractEnv,
} from './directory-lock-contract.js';
export { runElevationContract } from './elevation-contract.js';
export { runDeElevatorContract } from './de-elevator-contract.js';
export { runFontEnumerationContract } from './font-enumeration-contract.js';
export { runClipboardContract, runClipboardFileListContract, runClipboardRichContract } from './clipboard-contract.js';
export type { ClipboardRichHarness } from './clipboard-contract.js';
// 045 — the two ports clickable file links added (#394).
export { runPathFormsContract } from './path-forms-contract.js';
export type { PathFormsGitFixture } from './path-forms-contract.js';
export { runExecutableExtensionsContract } from './executable-extensions-contract.js';
export { runRefusedUriSchemesContract } from './refused-uri-schemes-contract.js';
// 055 — the resource monitor's process seam.
export { runProcessMetricsContract, type ProcessMetricsContractEnv } from './process-metrics-contract.js';
export { FakeProcessMetrics } from './fake-process-metrics.js';
export { runFileListCodecContract } from './file-list-codec-contract.js';
// 070 — the seams that had no contract before macOS needed one; Windows and Linux run them too.
export { runProcessCwdContract, type ProcessCwdContractEnv, type StartedInFolder } from './process-cwd-contract.js';
export { runProcessIdentityContract, type ProcessIdentityContractEnv, type StartedWithArgv } from './process-identity-contract.js';
export { runOrphanProcessesContract, type OrphanProcessesContractEnv, type StartedProcess } from './orphan-processes-contract.js';
export { runVolumeRootsContract, type VolumeRootsContractEnv } from './volume-roots-contract.js';
export { runFileAttributesContract, type FileAttributesContractEnv } from './file-attributes-contract.js';
export { runFileAccessInfoContract, type FileAccessInfoContractEnv } from './file-access-info-contract.js';
export { runCommandLineInstallContract, type CommandLineInstallHarness } from './command-line-install-contract.js';
