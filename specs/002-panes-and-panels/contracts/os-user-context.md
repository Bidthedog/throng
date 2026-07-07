# Contract: `IUserContext` OS abstraction

**Interface** (`@throng/core/src/abstractions/user-context.ts`) — process-agnostic, no OS imports:

```ts
export interface IUserContext {
  /** Stable identity of the current OS user; drives the `owner_user` persistence key. */
  currentUser(): { userId: string; userName: string };
}
```

**Implementation**: `NodeUserContext` in `@throng/platform-windows` (uses Node `os.userInfo()`;
cross-platform Node API, injected through this abstraction for testability — research D6/D8).

**Contract suite** (`@throng/core/src/testing/user-context-contract.ts`, run against every impl;
extends the 001 [Gap A] pattern):

1. `currentUser()` returns non-empty `userId` and `userName`.
2. `currentUser()` is **stable** within a process run (same value on repeated calls).
3. `userId` contains no path separators or whitespace-only values (safe as a storage key).

Bound once per process at each composition root; never called ad-hoc in business logic.
