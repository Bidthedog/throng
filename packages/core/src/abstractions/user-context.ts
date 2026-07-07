/**
 * OS-abstraction contract (Principle II / research D6/D8). `core` defines only
 * the interface and contains no OS calls; the concrete implementation
 * (`NodeUserContext`) lives in `@throng/platform-windows` and is verified
 * against the shared contract suite in `../testing/user-context-contract`.
 *
 * The current OS user identifies the owner of all persisted records (the
 * `owner_user` key), satisfying the constitution's per-user local-storage
 * constraint and pre-shaping for future multi-user + import/export.
 */
export interface CurrentUser {
  /** Stable identity used as the `owner_user` persistence key. */
  userId: string;
  /** Friendly display name of the current OS user. */
  userName: string;
}

export interface IUserContext {
  /** Stable identity of the current OS user. */
  currentUser(): CurrentUser;
}
