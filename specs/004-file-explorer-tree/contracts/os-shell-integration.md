# Contract — `IShellIntegration` (OS seam)

New abstraction in `@throng/core/abstractions` (Principle II) for OS file-manager integration ("Open
in file explorer", FR-035). Concrete `ElectronShellIntegration` lives in **UI main** using Electron's
built-in `shell` module; a reusable contract suite (`core/testing/shell-integration-contract.ts`)
verifies the impl. The renderer calls it only through the preload bridge (`files.reveal`).

## IShellIntegration

```
interface IShellIntegration {
  // Open the OS file manager with `path` SELECTED in its parent folder. Used for FILES (FR-035).
  // On Windows → shell.showItemInFolder(path).
  revealInFileManager(path: string): Promise<void>;

  // Open `path` (a folder) so the manager shows ITS CONTENTS. Used for FOLDERS and the root (FR-035).
  // On Windows → shell.openPath(path).
  openFolder(path: string): Promise<void>;
}
```

- Both reject **non-fatally** if the target no longer exists; the caller surfaces a non-fatal notice
  and leaves the tree unchanged (FR-035 edge case).
- The renderer decides which to call from the node kind (file → `revealInFileManager`; folder/root →
  `openFolder`); the seam itself is kind-agnostic.

**Contract tests** (against a fake `shell` double): `revealInFileManager` invokes the OS
"reveal/select" call with the exact path; `openFolder` invokes the OS "open path" call; a missing
path yields a rejected promise (non-fatal), not a throw that crashes the process. The impl test stubs
Electron's `shell` so no real window opens in CI.

## Wiring

UI-main composition root binds `IShellIntegration` → `ElectronShellIntegration`. The `files.reveal`
ipc handler resolves the node's absolute path (within the project root), then calls
`revealInFileManager` or `openFolder` per kind. Allowed on **every** node including the root
(FR-035) — reveal is read-only and not subject to the root-immutability rule.
