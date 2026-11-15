/**
 * The macOS implementation set (070 contracts/platform-services-macos.md). Shared POSIX code comes from
 * `@throng/platform-node`; what is macOS's own lives here, behind the same `@throng/core` seams Windows and Linux fill.
 */
export { findCaseSensitiveRoots, macosIpcDirectory, macosTraitsForThisProcess, mountedVolumes, type VolumeCaseProbe } from './macos-host.js';
export { MacosUserDirectories } from './macos-user-directories.js';
export { MacosPtyHost, type MacosPtyHostDeps } from './macos-pty-host.js';
export { MacosOrphanProcesses, MacosProcessCwd, MacosProcessIdentity } from './macos-process-services.js';
export {
  MacosTrash,
  PUT_BACK_HINT,
  outcomeOf as trashOutcomeOf,
  type MacosTrashDeps,
  type TrashOutcome,
} from './macos-trash.js';
export { MacosFileListCodec } from './macos-file-list-codec.js';
export { MACOS_GPU_UNAVAILABLE, MACOS_NETWORK_UNAVAILABLE, MacosProcessMetrics, type MacosProcessMetricsDeps } from './macos-process-metrics.js';
export { macosRelevantProcesses } from './macos-relevant-processes.js';
export {
  DEFAULT_LINK_PATH,
  MacosCommandLineInstall,
  appleScriptString,
  bundleOf,
  shQuote,
  type MacosCommandLineInstallOptions,
  type PrivilegedRunner,
} from './macos-command-line-install.js';
export { MacosInstalledVersion, THRONG_BUNDLE_ID, plistString } from './macos-installed-version.js';
export { MacosVolumeRoots, parseMountOutput, type MacosMount } from './macos-volume-roots.js';
export { MacosFileAccessInfo, MacosFileAttributes, UF_HIDDEN, groupNameOf, type RunTool } from './macos-file-info.js';
export {
  isLiveMacosRow,
  readMacosArgv,
  readMacosCwd,
  readMacosMetrics,
  readMacosProcRow,
  readMacosProcTable,
  type MacosProcMetrics,
  type MacosProcRow,
} from './macos-proc-table.js';
export {
  FONT_FAMILIES_JXA,
  MacosExecutableExtensions,
  MacosFileManagerRegistration,
  MacosFontEnumeration,
  MacosOsPropertiesDialog,
  MacosPlatformInfo,
  MacosRefusedUriSchemes,
  TRANSLOCATION_REFUSAL,
  macosStartupRefusal,
  parseFontFamilies,
  startupRefusal,
  type MacosStartupFacts,
} from './macos-simple-services.js';
