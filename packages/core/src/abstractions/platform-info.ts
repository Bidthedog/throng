/**
 * OS-abstraction contract (Principle II). `core` defines only the interface and
 * contains no OS calls; concrete implementations live in platform packages
 * (e.g. `@throng/platform-windows`) and are verified against the shared contract
 * suite in `../testing/platform-info-contract`.
 */
export type OsName = 'windows' | 'macos' | 'linux';

const OS_BY_NODE_PLATFORM: Readonly<Record<string, OsName>> = { win32: 'windows', linux: 'linux', darwin: 'macos' };

/**
 * The OS a Node `process.platform` value names (070 R32). Throws for one throng has no rules for, naming it, rather
 * than answering with another platform's (062 FR-050).
 */
export function osNameFor(nodePlatform: string): OsName {
  const os = OS_BY_NODE_PLATFORM[nodePlatform];
  if (os === undefined) throw new Error(`throng has no platform rules for ${nodePlatform}.`);
  return os;
}

export interface IPlatformInfo {
  /** Stable identifier of the host operating system. */
  osName(): OsName;
  /** The OS path separator ("\\" on Windows, "/" elsewhere). */
  pathSeparator(): string;
}

// EXTENSION POINT (FR-007): future OS abstractions — process spawning, shell
// detection, filesystem-change watching, and PTY reattachment (Principles II/IV)
// — are added here as new interfaces, each with a contract suite and a
// platform-* implementation. None are implemented in the bootstrap (YAGNI).
