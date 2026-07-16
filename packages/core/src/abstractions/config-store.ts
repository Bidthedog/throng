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

/**
 * Outcome of a config write (issue #75).
 *
 * A write used to resolve `void`, which left its callers unable to tell a persisted edit from
 * a lost one — so the IPC layer reported every write as successful and a preference could
 * vanish silently while the UI showed the new value. The store still never throws; it reports.
 */
export type WriteOutcome = { ok: true } | { ok: false; error: string };

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

  /**
   * Persist the document (atomic, pretty JSON). Never throws — a failure is REPORTED via the
   * returned {@link WriteOutcome} so the caller can surface it, rather than being swallowed
   * and mistaken for success (issue #75).
   */
  write<T>(doc: ConfigDocId, value: T): Promise<WriteOutcome>;

  /** Absolute path of a config document (diagnostics / watcher wiring). */
  pathOf(doc: ConfigDocId): string;
}
