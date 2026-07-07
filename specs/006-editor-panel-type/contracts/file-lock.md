# Contract: IFileLock seam (core abstraction — Phase A)

New OS seam `@throng/core/abstractions/file-lock.ts`; Windows impl `WindowsFileLock`
(`@throng/platform-windows`). The **file-granularity analogue** of 005's `IDirectoryLock`. Instantiated in
**UI main** and driven by the editor coordinator. Implements FR-028 (prevent external modification of a
dirty file).

## Interface

```ts
interface IFileLock {
  acquire(absPath: string): LockHandle;   // hold the file so external processes cannot modify/delete it
  release(handle: LockHandle): void;      // release (idempotent)
}
type LockHandle = { readonly path: string };
```

## Obligations
- While a handle is held, another process **cannot modify or delete** `absPath` (Windows: a file handle
  opened **without** share-write / share-delete). Reads by other processes MAY still be allowed.
- `acquire` is taken when a document becomes **dirty and has a real path**; `release` on **save (clean)**
  or **Panel destroy/close**. A **clean** or **unpathed** document takes **no** lock.
- `acquire` on an already-locked path (same holder) is a safe no-op / returns the existing handle
  deterministically; `release` of an unknown/released handle is a safe no-op.
- If the file cannot be locked (e.g. already locked by another process at first dirty), the editor surfaces
  that state rather than corrupting the buffer (edge case) — it does not silently proceed as if locked.
- Behind the OS abstraction (Principle II); macOS/Linux use their own advisory lock later.

## Contract suite (`core/testing/file-lock-contract.ts`, run vs `WindowsFileLock`)
- acquire → an external write to the path **fails**; external delete/rename **fails**.
- release → the same external write/delete now **succeeds**.
- double-acquire same path is safe; release is idempotent.
- lock does not corrupt or truncate the file; reads still succeed.
- (self-cleaning: the suite creates and removes its own temp file, per constitution v3.9.0).
