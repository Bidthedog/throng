// Test-only surface of @throng/core, exposed via the "@throng/core/testing"
// subpath export so the production entry point (".") stays free of test
// utilities. Consumed by test layers across packages.
export { runPlatformInfoContract } from './platform-info-contract.js';
export { runUserContextContract } from './user-context-contract.js';
export { runDisplayInfoContract } from './display-info-contract.js';
export { runConfigStoreContract } from './config-store-contract.js';
export type { ConfigStoreHarness } from './config-store-contract.js';
export { runFileWatcherContract } from './file-watcher-contract.js';
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
export { runClipboardContract, runClipboardRichContract } from './clipboard-contract.js';
export type { ClipboardRichHarness } from './clipboard-contract.js';
// 045 — the two ports clickable file links added (#394).
export { runPathFormsContract } from './path-forms-contract.js';
export type { PathFormsGitFixture } from './path-forms-contract.js';
export { runExecutableExtensionsContract } from './executable-extensions-contract.js';
