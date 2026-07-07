/**
 * IConfigStore (Principle II / X) — reads and writes the user-scoped application
 * configuration documents (settings, keybindings, themes). The store performs
 * I/O only; parsing / validation / default-merge is delegated to the pure
 * `@throng/core/config` schema functions passed in by the caller.
 *
 * No OS/process calls here — this is the abstract contract. The concrete
 * implementation (JSON files under the user profile) lives in the UI main
 * process; see contracts/os-config-store.md.
 */

/** Identifies which config document to read/write. */
export type ConfigDocId =
  | { kind: 'settings' }
  | { kind: 'keybindings' }
  | { kind: 'theme'; name: string };

export interface ConfigReadOptions {
  /**
   * Create the backing file from `defaults` when it is absent (default true).
   * Pass false for documents that may legitimately not exist (e.g. a theme named
   * by settings that the user never created) — those resolve to `defaults`
   * WITHOUT writing a stray file.
   */
  create?: boolean;
}

export interface IConfigStore {
  /**
   * Return the validated document, creating it from `defaults` if the backing
   * file is absent (unless `options.create === false`). A malformed file resolves
   * to `defaults` (never throws); `validate` maps raw parsed JSON to the typed
   * shape (merging defaults).
   */
  read<T>(
    doc: ConfigDocId,
    defaults: T,
    validate: (raw: unknown) => T,
    options?: ConfigReadOptions,
  ): Promise<T>;

  /** Persist the document (atomic, pretty JSON). Best-effort; surfaces failure without crashing. */
  write<T>(doc: ConfigDocId, value: T): Promise<void>;

  /** Absolute path of a config document (diagnostics / watcher wiring). */
  pathOf(doc: ConfigDocId): string;
}
