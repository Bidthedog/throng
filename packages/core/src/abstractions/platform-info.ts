/**
 * OS-abstraction contract (Principle II). `core` defines only the interface and
 * contains no OS calls; concrete implementations live in platform packages
 * (e.g. `@throng/platform-windows`) and are verified against the shared contract
 * suite in `../testing/platform-info-contract`.
 */
export type OsName = 'windows' | 'macos' | 'linux';

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
