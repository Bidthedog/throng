/** Dependency-injection tokens for the UI main-process composition root. */
export const UI_TYPES = {
  UiSettings: Symbol.for('throng:IUiSettings'),
  DaemonClient: Symbol.for('throng:DaemonClient'),
  ConfigSettings: Symbol.for('throng:IConfigSettings'),
  ConfigStore: Symbol.for('throng:IConfigStore'),
  FileWatcher: Symbol.for('throng:IFileWatcher'),
  // 007: OS seam for installed-font enumeration (background-populated font cache).
  FontEnumeration: Symbol.for('throng:IFontEnumeration'),
} as const;
