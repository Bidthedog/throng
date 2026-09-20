/** Dependency-injection tokens for the UI main-process composition root. */
export const UI_TYPES = {
  UiSettings: Symbol.for('throng:IUiSettings'),
  DaemonClient: Symbol.for('throng:DaemonClient'),
  ConfigSettings: Symbol.for('throng:IConfigSettings'),
  ConfigStore: Symbol.for('throng:IConfigStore'),
  FileWatcher: Symbol.for('throng:IFileWatcher'),
  // 007: OS seam for installed-font enumeration (background-populated font cache).
  FontEnumeration: Symbol.for('throng:IFontEnumeration'),
  // 010: the immutable shipped-defaults record + the restore/seed/upgrade applier.
  ShippedDefaults: Symbol.for('throng:ShippedDefaults'),
  ShippedDefaultsService: Symbol.for('throng:ShippedDefaultsService'),
  // 016: the OS clipboard seam, and the app-global mode record that rides on it.
  Clipboard: Symbol.for('throng:IClipboard'),
  ClipboardService: Symbol.for('throng:ClipboardService'),
  // 032: how hard the config watcher retries an unreadable settings document before it believes
  // the defaults it is holding (FR-008). Bound here rather than passed at the call site because
  // Principle IX puts a boundary's bindings in one file — and the plan claims it is "injected at
  // the main composition root", which would otherwise simply not be true.
  ConfigWatchPolicy: Symbol.for('throng:ConfigWatchPolicy'),
  // #199: the OS seam that lets a window opened by a terminal command raise itself over throng.
  // Bound at this boundary because the permission may only be granted by the process that owns the
  // foreground, which is the one that owns the window — this one.
  ForegroundHandoff: Symbol.for('throng:IForegroundHandoff'),
  /*
   * 045 (#394) — the two path/extension seams a file link needs, and the filesystem it walks.
   *
   * `PathForms` and `ExecutableExtensions` are new, and bound here for the #199 reason: the
   * questions they answer are the OS's, and main is the process that asks them.
   *
   * `FileSystem` is NOT new — `NodeFileSystem` has been constructed by hand in `main.ts` since 004,
   * with no token at all. 043 recorded that as a named Principle IX exception; binding it here
   * closes that item rather than adding a third construction site for it.
   */
  PathForms: Symbol.for('throng:IPathForms'),
  ExecutableExtensions: Symbol.for('throng:IExecutableExtensions'),
  // 045 FR-159 (round four): the platform's half of the refused URI schemes, read by the two
  // `throng:linkUri:*` handlers (contracts platform-ports.md §7.1).
  RefusedUriSchemes: Symbol.for('throng:IRefusedUriSchemes'),
  FileSystem: Symbol.for('throng:IFileSystem'),
} as const;
