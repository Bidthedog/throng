import {
  NoForegroundHandoff,
  NoInstalledVersion,
  WINDOWS_HOST_TRAITS,
  configureHostTraits,
  type HostTraits,
  type Holder,
  type IDirectoryLock,
  type IElevationState,
  type IExecutableExtensions,
  type IFileListCodec,
  type IFileManagerRegistration,
  type IFileAttributes,
  type IOsPropertiesDialog,
  type IFileAccessInfo,
  type IFontEnumeration,
  type IForegroundHandoff,
  type IInstalledVersion,
  type IOrphanProcesses,
  type IPathForms,
  type IPlatformInfo,
  type IProcessCwd,
  type IProcessMetrics,
  type IPtyHost,
  type IRefusedUriSchemes,
  type IShellDetection,
  type ITrashRestore,
  type IUserDirectories,
  type IVolumeRoots,
} from '@throng/core';
import { NodeUserContext } from '@throng/platform-node';
import {
  LinuxDirectoryLock,
  LinuxElevation,
  LinuxExecutableExtensions,
  LinuxFileListCodec,
  LinuxFileManagerRegistration,
  LinuxFileAttributes,
  LinuxOsPropertiesDialog,
  LinuxFileAccessInfo,
  LinuxFontEnumeration,
  LinuxGpuUsage,
  LinuxInstalledVersion,
  LinuxOrphanProcesses,
  LinuxPathForms,
  LinuxPlatformInfo,
  LinuxProcessCwd,
  LinuxProcessMetrics,
  LinuxPtyHost,
  LinuxRefusedUriSchemes,
  LinuxShellDetection,
  LinuxTrash,
  LinuxUserDirectories,
  LinuxVolumeRoots,
  NoDeElevatedLauncher,
  linuxTraitsForThisProcess,
  lookupHolder as linuxLookupHolder,
  startupRefusal as linuxStartupRefusal,
} from '@throng/platform-linux';
import {
  NodePtyHost,
  WindowsDeElevatedLauncher,
  WindowsDirectoryLock,
  WindowsElevation,
  WindowsExecutableExtensions,
  WindowsFileListCodec,
  WindowsFileManagerRegistration,
  WindowsFileAttributes,
  WindowsOsPropertiesDialog,
  WindowsFileAccessInfo,
  REG_EXE,
  WindowsFontEnumeration,
  WindowsForegroundHandoff,
  WindowsGpuCounters,
  WindowsNetworkTrace,
  WindowsOrphanProcesses,
  WindowsPathForms,
  WindowsPlatformInfo,
  WindowsProcessCwd,
  WindowsProcessMetrics,
  WindowsRefusedUriSchemes,
  WindowsShellDetection,
  WindowsTrashRestore,
  WindowsUserDirectories,
  WindowsVolumeRoots,
  lookupHolder as windowsLookupHolder,
} from '@throng/platform-windows';

export interface DeElevatedLauncher {
  isAvailable(): boolean;
  launch(file: string, args: string[], report?: (reason: string) => void): void;
}

/** A pty host, plus what the detached agent asks of one (FR-008: Linux answers that it has none). */
export type PlatformPtyHost = IPtyHost & { conhostOf(pid: number): Promise<number | null>; dispose(): Promise<void> };

/**
 * One platform's implementation set (062 contracts/platform-services.md). Factories, so a process builds only what it
 * uses and DLL or `/proc` access happens when something asks.
 */
export interface PlatformServices {
  readonly traits: () => HostTraits;
  readonly platformInfo: () => IPlatformInfo;
  readonly userDirectories: () => IUserDirectories;
  readonly shellDetection: () => IShellDetection;
  readonly ptyHost: () => PlatformPtyHost;
  readonly directoryLock: () => IDirectoryLock;
  readonly elevation: () => IElevationState;
  readonly deElevatedLauncher: () => DeElevatedLauncher;
  readonly processCwd: () => IProcessCwd;
  readonly processMetrics: () => IProcessMetrics;
  readonly orphanProcesses: () => IOrphanProcesses;
  readonly foregroundHandoff: () => IForegroundHandoff;
  readonly fontEnumeration: () => IFontEnumeration;
  readonly pathForms: () => IPathForms;
  readonly executableExtensions: () => IExecutableExtensions;
  readonly refusedUriSchemes: () => IRefusedUriSchemes;
  /** `restoreFromRecycleBin` is the caller's on Windows (UI main owns that script); ignored elsewhere. */
  readonly trashRestore: (windowsRestore?: (originalPath: string) => Promise<void>) => ITrashRestore;
  /** Whether a window can carry a taskbar overlay. Electron documents `setOverlayIcon` for Windows only (062 FR-008). */
  readonly hasTaskbarOverlay: boolean;
  readonly volumeRoots: () => IVolumeRoots;
  /** Chromium switches for this process, given the user's display preference. Set before the app is ready. */
  readonly displaySwitches: (nativeWayland: boolean) => readonly (readonly [string, string])[];
  readonly lookupHolder: (absPath: string) => Promise<Holder | undefined>;
  /** Why this process must not start, in words for the user, or null. */
  readonly startupRefusal: () => string | null;
  /** What a package manager has installed, for the copy running from `execPath` to compare itself with (063 FR-010). */
  readonly installedVersion: (execPath: string) => IInstalledVersion;
  /**
   * Whether a daemon ends by itself once its package is gone and nothing needs it (063 FR-013). Windows has no such
   * case: an uninstall ends the daemon, and `ensureDaemon` retires a portable copy's orphan (#429).
   */
  readonly exitWhenEntryRemoved: boolean;
  /** This OS's file-list clipboard formats (067 FR-013). */
  readonly fileListCodec: () => IFileListCodec;
  readonly fileAttributes: () => IFileAttributes;
  readonly osPropertiesDialog: () => IOsPropertiesDialog;
  readonly fileAccessInfo: () => IFileAccessInfo;
  /** The "Open as throng project" item. `installed`: false for a portable or archive build (067 FR-036). */
  readonly fileManagerRegistration: (opts: { execPath: string; home: string; installed: boolean }) => IFileManagerRegistration;
}

const WINDOWS: PlatformServices = {
  traits: () => WINDOWS_HOST_TRAITS,
  platformInfo: () => new WindowsPlatformInfo(),
  userDirectories: () => new WindowsUserDirectories(),
  shellDetection: () => new WindowsShellDetection(),
  ptyHost: () => new NodePtyHost(),
  directoryLock: () => new WindowsDirectoryLock(),
  elevation: () => new WindowsElevation(),
  deElevatedLauncher: () => new WindowsDeElevatedLauncher(),
  processCwd: () => new WindowsProcessCwd(),
  processMetrics: () =>
    new WindowsProcessMetrics(new WindowsGpuCounters(), undefined, WindowsNetworkTrace.lazyReader()),
  orphanProcesses: () => new WindowsOrphanProcesses(),
  foregroundHandoff: () => new WindowsForegroundHandoff(),
  fontEnumeration: () => new WindowsFontEnumeration(),
  // FR-151: Git Bash's mount table needs Git's install root, which the shell detection already finds (005 FR-024).
  // A function, so that probe (a registry query at worst) runs on the first rooted path a link asks about.
  pathForms: () => {
    const git = new WindowsShellDetection();
    return new WindowsPathForms({ gitRoot: () => git.gitInstallRoot() });
  },
  executableExtensions: () => new WindowsExecutableExtensions(),
  refusedUriSchemes: () => new WindowsRefusedUriSchemes(),
  trashRestore: (windowsRestore) =>
    new WindowsTrashRestore(
      windowsRestore ?? (() => Promise.reject(new Error('restore-from-trash is not supported here'))),
    ),
  hasTaskbarOverlay: true,
  volumeRoots: () => new WindowsVolumeRoots(),
  displaySwitches: () => [],
  lookupHolder: windowsLookupHolder,
  startupRefusal: () => null,
  installedVersion: () => new NoInstalledVersion(),
  exitWhenEntryRemoved: false,
  fileListCodec: () => new WindowsFileListCodec(),
  fileAttributes: () => new WindowsFileAttributes(),
  osPropertiesDialog: () => new WindowsOsPropertiesDialog(),
  fileAccessInfo: () => new WindowsFileAccessInfo(),
  fileManagerRegistration: ({ execPath, installed }) => new WindowsFileManagerRegistration(REG_EXE, execPath, installed),
};

const LINUX: PlatformServices = {
  traits: () => linuxTraitsForThisProcess(),
  platformInfo: () => new LinuxPlatformInfo(),
  userDirectories: () => new LinuxUserDirectories(),
  shellDetection: () => new LinuxShellDetection(),
  ptyHost: () => new LinuxPtyHost(),
  directoryLock: () => new LinuxDirectoryLock(),
  elevation: () => new LinuxElevation(),
  deElevatedLauncher: () => new NoDeElevatedLauncher(),
  processCwd: () => new LinuxProcessCwd(),
  processMetrics: () => new LinuxProcessMetrics(new LinuxGpuUsage()),
  orphanProcesses: () => new LinuxOrphanProcesses(),
  foregroundHandoff: () => new NoForegroundHandoff(),
  fontEnumeration: () => new LinuxFontEnumeration(),
  pathForms: () => new LinuxPathForms(),
  executableExtensions: () => new LinuxExecutableExtensions(),
  refusedUriSchemes: () => new LinuxRefusedUriSchemes(),
  trashRestore: () => new LinuxTrash(),
  hasTaskbarOverlay: false,
  volumeRoots: () => new LinuxVolumeRoots(),
  // 062 FR-028: XWayland by default, where window placement and tear-off behave as on the other platforms.
  displaySwitches: (nativeWayland) => (nativeWayland ? [] : [['ozone-platform', 'x11']]),
  lookupHolder: linuxLookupHolder,
  startupRefusal: () => linuxStartupRefusal(),
  installedVersion: (execPath) => new LinuxInstalledVersion(execPath),
  exitWhenEntryRemoved: true,
  fileListCodec: () => new LinuxFileListCodec(),
  fileAttributes: () => new LinuxFileAttributes(),
  osPropertiesDialog: () => new LinuxOsPropertiesDialog(),
  fileAccessInfo: () => new LinuxFileAccessInfo(),
  fileManagerRegistration: ({ home, installed }) => new LinuxFileManagerRegistration(home, installed),
};

/** A platform with no implementation set. Never answered with another platform's (062 FR-050). */
export class UnsupportedPlatformError extends Error {
  constructor(readonly nodePlatform: string) {
    super(`throng does not support ${nodePlatform} yet.`);
    this.name = 'UnsupportedPlatformError';
  }
}

export function selectPlatform(nodePlatform: string): PlatformServices {
  switch (nodePlatform) {
    case 'win32':
      return WINDOWS;
    case 'linux':
      return LINUX;
    default:
      throw new UnsupportedPlatformError(nodePlatform);
  }
}

/** This process's set, with its host traits configured. The first thing every process entry does. */
export function startPlatform(nodePlatform: string = process.platform): PlatformServices {
  const services = selectPlatform(nodePlatform);
  configureHostTraits(services.traits());
  return services;
}

export { NodeUserContext };
export { CRASH_DIR_NAME, clearStaleSocket, createFileLog, writeCrashReport, execFileOffLoop } from '@throng/platform-node';
export type { DiagnosticLog, FileLogOptions } from '@throng/platform-node';
