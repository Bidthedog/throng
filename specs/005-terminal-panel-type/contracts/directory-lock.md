# Contract: IDirectoryLock (core abstraction — Phase C, FR-022)

OS seam that holds a folder so the operating system refuses to **delete or move** it while held. Interface in
`core/abstractions/directory-lock.ts`; Windows impl `WindowsDirectoryLock` in `@throng/platform-windows`,
consumed by the **daemon**. Reusable contract suite in `core/testing/directory-lock-contract.ts`.

## Interface

```ts
interface LockHandle { readonly path: string; }

interface IDirectoryLock {
  acquire(absPath: string): LockHandle;   // throws if the path does not exist / cannot be locked
  release(handle: LockHandle): void;       // idempotent
}
```

## Obligations (contract suite asserts, against a real temp dir)
- After `acquire(dir)`, attempts to **delete** or **rename/move** `dir` from another handle **fail** (the OS
  blocks it); after `release`, deletion/rename **succeeds** again.
- `acquire` on a non-existent path throws.
- `release` is **idempotent** (double release is safe); releasing an unknown handle is a safe no-op.
- Holding the lock does **not** block normal reads/writes of files *inside* the directory (terminals must
  still work in the folder).
- Multiple `acquire` calls on the same path return independent handles; the directory stays locked until all
  are released (the daemon ref-counts above this, but the seam tolerates re-entrancy).

## Windows impl notes (not part of the contract)
Open a directory handle (`CreateFile` with `FILE_FLAG_BACKUP_SEMANTICS`) **without** `FILE_SHARE_DELETE`, so
rename/delete is refused while open (opportunistic-lock-style hold). Keep the handle for the lock's lifetime.

## Daemon usage (FR-022)
A daemon **lock manager** ref-counts per project: `acquire` the project root on the **first** terminal,
`release` on the **last** terminal closing. The project-edit path separately refuses to change a project's
root while `openTerminals > 0`.

## Contract tests
- Unit: a compliant fake passes; fakes violating each obligation fail.
- Integration/contract: `runDirectoryLockContract(() => new WindowsDirectoryLock())` over a temp dir —
  delete-while-locked fails, delete-after-release succeeds, files inside remain writable.
