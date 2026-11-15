import {
  NoCommandLineInstall,
  NoForegroundHandoff,
  NoInstalledVersion,
  WINDOWS_HOST_TRAITS,
  configureHostTraits,
  type HostTraits,
  type ICommandLineInstall,
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
  type IProcessIdentity,
  type IProcessMetrics,
  type IPtyHost,
  type IRefusedUriSchemes,
  type IShellDetection,
  type ITrashRestore,
  type IUserDirectories,
  type IVolumeRoots,
} from '@throng/core';
import {
  MACOS_SHELL_SEARCH_DIRS,
  NoDeElevatedLauncher as PosixNoDeElevatedLauncher,
  NodeUserContext,
  PosixDirectoryLock,
  PosixElevation,
  PosixPathForms,
  PosixShellDetection,
  posixLookupHolder,
} from '@throng/platform-node';
import {
  MacosCommandLineInstall,
  MacosExecutableExtensions,
  MacosFileAccessInfo,
  MacosFileAttributes,
  MacosFileListCodec,
  MacosInstalledVersion,
  MacosFileManagerRegistration,
  MacosFontEnumeration,
  MacosOrphanProcesses,
  MacosOsPropertiesDialog,
  MacosPlatformInfo,
  MacosProcessCwd,
  MacosProcessIdentity,
  MacosProcessMetrics,
  MacosPtyHost,
  MacosRefusedUriSchemes,
  MacosTrash,
  MacosUserDirectories,
  MacosVolumeRoots,
  macosTraitsForThisProcess,
  startupRefusal as macosStartupRefusal,
} from '@throng/platform-macos';
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
  LinuxProcessIdentity,
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
  readonly processIdentity: () => IProcessIdentity;
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
  /**
   * The `BrowserWindow` options that give a window this platform's frame (070 FR-026, R16): throng draws its own title
   * bar everywhere; on macOS the native traffic lights sit in it, so main never branches on the OS.
   */
  readonly windowChrome: () => BrowserWindowChromeOptions;
  /**
   * Folders the OS withholds until the user grants access, under `home` (070 FR-025, R14). A listing refused under one
   * of these is the OS's privacy rule, not a permissions fault. Empty where the OS has no such rule.
   */
  readonly privacyProtectedRoots: (home: string) => string[];
  /** The `throng` command on the user's PATH (070 FR-024a, R20). Unavailable where the installer already owns it. */
  readonly commandLineInstall: (opts: { execPath: string }) => ICommandLineInstall;
}

/** The subset of Electron's `BrowserWindowConstructorOptions` a platform's frame sets. */
export interface BrowserWindowChromeOptions {
  readonly frame?: boolean;
  readonly titleBarStyle?: 'hidden';
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
}

/** Windows and Linux: no OS frame at all; throng's title bar carries its own window controls. */
const FRAMELESS: BrowserWindowChromeOptions = { frame: false };

/**
 * macOS: the title bar hidden and the traffic lights kept, centred in throng's 34 px title bar (12 px lights, so 11 px
 * above; 12 px in from the left edge, as Finder places them).
 */
const MACOS_CHROME: BrowserWindowChromeOptions = { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } };

/** The command ships with the Windows installer and the Linux packages, so there is nothing for throng to install. */
const INSTALLER_OWNS_COMMAND = 'The installer already puts the throng command on your PATH.';


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
  // Windows reports no argv or start marker beyond the process table's; the resolver splits the command line (068 FR-043).
  processIdentity: () => ({ argv: async () => undefined, startMarker: async () => undefined }),
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
  windowChrome: () => FRAMELESS,
  privacyProtectedRoots: () => [],
  commandLineInstall: () => new NoCommandLineInstall(INSTALLER_OWNS_COMMAND),
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
  processIdentity: () => new LinuxProcessIdentity(),
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
  windowChrome: () => FRAMELESS,
  privacyProtectedRoots: () => [],
  commandLineInstall: () => new NoCommandLineInstall(INSTALLER_OWNS_COMMAND),
};

/**
 * macOS (070 contracts/platform-services-macos.md): its own classes where the OS differs, the shared POSIX ones from
 * `@throng/platform-node` where it does not, and a stated absence where macOS has no such concept (FR-013).
 */
const MACOS: PlatformServices = {
  traits: () => macosTraitsForThisProcess(),
  platformInfo: () => new MacosPlatformInfo(),
  userDirectories: () => new MacosUserDirectories(),
  shellDetection: () => new PosixShellDetection({ extraSearchDirs: MACOS_SHELL_SEARCH_DIRS }),
  ptyHost: () => new MacosPtyHost(),
  directoryLock: () => new PosixDirectoryLock(),
  elevation: () => new PosixElevation(),
  deElevatedLauncher: () => new PosixNoDeElevatedLauncher(),
  processCwd: () => new MacosProcessCwd(),
  processIdentity: () => new MacosProcessIdentity(),
  processMetrics: () => new MacosProcessMetrics(),
  orphanProcesses: () => new MacosOrphanProcesses(),
  foregroundHandoff: () => new NoForegroundHandoff(),
  fontEnumeration: () => new MacosFontEnumeration(),
  pathForms: () => new PosixPathForms(),
  executableExtensions: () => new MacosExecutableExtensions(),
  refusedUriSchemes: () => new MacosRefusedUriSchemes(),
  trashRestore: () => new MacosTrash(),
  hasTaskbarOverlay: false,
  volumeRoots: () => new MacosVolumeRoots(),
  // Chromium on macOS has one display backend; there is nothing to choose.
  displaySwitches: () => [],
  lookupHolder: posixLookupHolder,
  startupRefusal: () => macosStartupRefusal(),
  installedVersion: (execPath) => new MacosInstalledVersion(execPath),
  // 063 FR-013: a daemon ends once its bundle is gone and nothing needs it.
  exitWhenEntryRemoved: true,
  fileListCodec: () => new MacosFileListCodec(),
  fileAttributes: () => new MacosFileAttributes(),
  osPropertiesDialog: () => new MacosOsPropertiesDialog(),
  fileAccessInfo: () => new MacosFileAccessInfo(),
  fileManagerRegistration: () => new MacosFileManagerRegistration(),
  windowChrome: () => MACOS_CHROME,
  privacyProtectedRoots: (home) => macosPrivacyProtectedRoots(home),
  commandLineInstall: ({ execPath }) => new MacosCommandLineInstall({ execPath }),
};

/**
 * The folders macOS's privacy rules (TCC) withhold until the user grants access (070 FR-025, R14): Desktop,
 * Documents, Downloads, iCloud Drive, and every other mounted volume.
 */
export function macosPrivacyProtectedRoots(home: string): string[] {
  const base = home.replace(/\/+$/, '');
  return [
    `${base}/Desktop`,
    `${base}/Documents`,
    `${base}/Downloads`,
    `${base}/Library/Mobile Documents/com~apple~CloudDocs`,
    '/Volumes',
  ];
}

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
    case 'darwin':
      return MACOS;
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
// 068 — the anonymised diagnostic log: keyed hash, per-install salt, machine identity.
export { createProcessAnonymiser, hmacHash, readOrCreateSalt, registerMachineIdentity } from '@throng/platform-node';
export type { MachineIdentityOptions, ProcessAnonymiserOptions } from '@throng/platform-node';
