# Contract — `IConfigStore` & `IFileWatcher` (OS seams)

Two new abstractions in `@throng/core/abstractions` (Principle II). Concrete impls live in UI main
/ `platform-windows`; both have contract tests any impl must pass.

## IConfigStore

Reads/writes the user config documents (data-model §2–§4). Pure-ish: I/O is the impl's job; parsing
/ validation / default-merge is delegated to the pure `@throng/core/config` schema functions.

```
interface IConfigStore {
  // Returns the validated document, creating it from defaults if the file is absent.
  // A malformed file resolves to the supplied defaults (never throws).
  read<T>(doc: ConfigDocId, defaults: T, validate: (raw: unknown) => T): Promise<T>;

  // Atomically writes the document (pretty JSON). Best-effort; surfaces failure without crashing.
  write<T>(doc: ConfigDocId, value: T): Promise<void>;

  // Absolute path of a config document (for diagnostics / watcher wiring).
  pathOf(doc: ConfigDocId): string;
}

type ConfigDocId = { kind: "settings" } | { kind: "keybindings" } | { kind: "theme"; name: string };
```

**Contract tests**: absent file → defaults written & returned; malformed file → defaults returned,
file left intact for the user; round-trip write→read is stable; `pathOf` is under the configured
config root.

## IFileWatcher

Watches the config directory and reports changes (drives hot-reload, D3).

```
interface IFileWatcher {
  // Begin watching `dir`; `onChange(path)` fires (debounced) on create/modify/delete within it.
  watch(dir: string, onChange: (path: string) => void): Disposable;
}
```

**Contract tests** (against the chokidar impl in `platform-windows`): a modify fires `onChange`
with the file path; rapid successive writes are coalesced (debounced); `dispose()` stops further
callbacks. Filesystem-touching tests run as integration (temp dir), not pure unit.

## Wiring

UI main composition root binds `IConfigStore` (JSON under `%USERPROFILE%\.throng\`) and
`IFileWatcher` (chokidar). `config-watcher.ts` calls `watch(configRoot, …)` → re-reads the changed
doc via `IConfigStore` → pushes to renderers over the preload bridge. The renderer applies it. The
config root path is an injected setting (Principle X), overridable for tests.
