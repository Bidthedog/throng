/** Dependency-injection tokens for the daemon composition root (Principle IX). */
export const DAEMON_TYPES = {
  DaemonSettings: Symbol.for('throng:IDaemonSettings'),
  PersistenceSettings: Symbol.for('throng:IPersistenceSettings'),
  PlatformInfo: Symbol.for('throng:IPlatformInfo'),
  UserContext: Symbol.for('throng:IUserContext'),
  Database: Symbol.for('throng:ThrongDatabase'),
  ProjectStore: Symbol.for('throng:IProjectStore'),
  RpcRouter: Symbol.for('throng:RpcRouter'),
  IpcServer: Symbol.for('throng:IpcServer'),
  // Terminal layer (005 Phase C).
  PtyHost: Symbol.for('throng:IPtyHost'),
  DirectoryLock: Symbol.for('throng:IDirectoryLock'),
  TerminalEvents: Symbol.for('throng:TerminalEvents'),
  TerminalLockManager: Symbol.for('throng:TerminalLockManager'),
  TerminalService: Symbol.for('throng:TerminalService'),
} as const;
