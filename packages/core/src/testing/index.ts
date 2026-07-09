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
export { runShellIntegrationContract } from './shell-integration-contract.js';
export type { ShellIntegrationHarness } from './shell-integration-contract.js';
export { runShellDetectionContract } from './shell-detection-contract.js';
export { runPtyHostContract, type PtyHostContractEnv } from './pty-host-contract.js';
export {
  runDirectoryLockContract,
  type DirectoryLockContractEnv,
} from './directory-lock-contract.js';
export { runElevationContract } from './elevation-contract.js';
export { runDeElevatorContract } from './de-elevator-contract.js';
export { runFontEnumerationContract } from './font-enumeration-contract.js';
