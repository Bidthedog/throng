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
} as const;
