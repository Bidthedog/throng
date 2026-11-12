# IPC and port contracts

The renderer works against these names and shapes. Every handler shape-checks its payload and answers with an envelope; a malformed call changes nothing.

## Ports (`packages/core/src/abstractions`)

```ts
// clipboard.ts: added to IClipboard
writeFileList(list: FileListSnapshot): Promise<void>;
readFileList(): Promise<FileListSnapshot | null>; // never rejects

// file-manager-registration.ts
interface IFileManagerRegistration {
  status(): Promise<FileManagerRegistration>;
  setEnabled(on: boolean): Promise<FileManagerRegistration>;
}

// file-attributes.ts
interface IFileAttributes { read(path: string): Promise<FileAttributes>; }

// os-properties-dialog.ts
interface IOsPropertiesDialog {
  readonly available: boolean;
  readonly unavailableReason?: string;
  show(path: string): Promise<ShellActionResult>;
}
```

The OS file-format strings live only in `platform-windows` and `platform-linux`.

## File transfer (`window.throng.transfer`, `window.throng.fileClipboard`)

| Call | Shape |
|---|---|
| `fileClipboard.osFiles()` | `Promise<boolean>`: whether Paste has an OS file list to act on |
| `transfer.pasteAuto(targetRelDir)` | replaces the renderer's `paste` route; main picks internal or OS per research D3. Answers `{ jobId }` or `{ error, cause? }` |
| `transfer.dropInbound(absPaths, targetRelDir, mode)` | `mode: 'copy' \| 'cut'`. Answers a `TransferResult` or `{ error, cause? }` |
| `files.startOsDrag(relPaths)` | `ipcRenderer.send`, from the grip's `dragstart`; main calls `webContents.startDrag` with the resolved paths |
| `editor.getPathForFile(file)` | existing; now also read by the tree's inbound drop |

## Open a folder (`window.throng.openFolder`)

| Call | Shape |
|---|---|
| `onRequest(cb)` | `cb({ absPath, kind: 'folder' \| 'file' \| 'missing' })`, in arrival order, once the renderer has announced `ready()` |
| `ready()` | sent once by the main window's renderer |
| `reportOutcome(notice)` | none: the renderer raises its own notice |

## Closing (`window.throng`)

| Call | Shape |
|---|---|
| `onAppCloseProgress(cb)` | `cb(ShutdownView)`, on every change |
| `onAppCloseCancelled(cb)` | `cb()`: Cancel finished; the overlay closes |
| `appCloseCancel()` | `send`; ignored once past the point of no return |

## Properties (`window.throng.properties`)

| Call | Shape |
|---|---|
| `open(relPaths)` | `Promise<{ requestId, items: ItemProperties[], osProperties: { available: boolean; reason?: string } }>`, immediately (FR-048) |
| `onTally(cb)` | `cb({ requestId, tally: FolderTally })` |
| `close(requestId)` | `send`; stops the walk (FR-049) |
| `showOsProperties(absPath)` | `Promise<{ ok: true } \| { error: string }>` |

## Terminal form history (`window.throng.formHistory`)

| Call | Shape |
|---|---|
| `get(flavourId)` | `Promise<{ startupCommand: string[]; shellArguments: string[] }>` |
| `record(flavourId, { startupCommand?, shellArguments? })` | `send`; ignored when the history is off |
| `clearField(flavourId, field)` | `send` |
| `clearFlavour(flavourId)` | `send` |
| `clearAll()` | `send` |
| `removeValue(flavourId, field, value)` | `send`; forgets one value of one field for one terminal type, then raises `onChanged({ flavourId })`. Added 2026-11-12 for FR-133. |
| `onChanged(cb)` | `cb({ flavourId?: string })`, sent to every window after any clear or removal (`flavourId` absent for a clear-all); returns an unsubscribe. Added 2026-11-10 for FR-064b and FR-066: an open form re-reads on it. |

## File-manager item (`window.throng.fileManagerItem`)

| Call | Shape |
|---|---|
| `status()` | `Promise<FileManagerRegistration>` |
| `setEnabled(on)` | `Promise<FileManagerRegistration>` |

## Daemon RPC

| Method | Shape |
|---|---|
| `subworkspace.create` | `{}` → the new sub-workspace's list entry (`SubWorkspaceMeta`), unloaded |
| `terminal.killAll` | gains optional `projectId`; absent means every session, as before |

## Open-in-program

`files.openInDefaultProgram(relPath)` for the tree, and the existing panel route for panels; both end in `IShellIntegration.openWithDefaultProgram`.
