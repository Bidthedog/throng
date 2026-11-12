# Data model

| Entity | Fields | Where | Rules |
|---|---|---|---|
| `FileListSnapshot` | `paths: string[]` (absolute), `intent: 'copy' \| 'cut'` | `core/abstractions/clipboard.ts` | Empty lists are `null`. No OS format name appears in it (FR-013). |
| Internal clipboard record | existing `FileClipboard`, plus the `FileListSnapshot` last placed on the OS | `ui/main/file-clipboard.ts` | Compared on normalised paths at Paste (FR-006). Memory only. |
| `LaunchMessage.folder` | absolute path, optional | `core` | Resolved in the launching process (FR-023). A malformed value is dropped with the message. |
| `OpenFolderDecision` | `add` / `select(projectId)` / `refuse-contains(projectName)` / `refuse-invalid(reason)` | `core/projects` | Pure, from the path, its kind and the project list (FR-026, FR-027). |
| `FileManagerRegistration` | `state: 'on' \| 'off' \| 'machine-wide' \| 'unavailable'`, `reason?` | `core/abstractions` | `machine-wide` cannot be changed by the preference (FR-034). |
| `ShutdownTask` | `id`, `summary`, `expectedMs`, `state: pending \| current \| done \| cancelled` | `core/workspace/shutdown-run.ts` | At most one `current`. Order fixed at start (FR-043). |
| `ShutdownView` | `tasks`, `remainingMs`, `cancelling` | pushed to the renderer | `remainingMs` rises by at most 25% per update unless the current task has overrun (FR-042). |
| `ItemProperties` | `name`, `path`, `type`, `linkTarget?`, `sizeBytes`, `attributes`, `created`, `modified`, `accessed`, `gone?` | `core/explorer/properties.ts` | Timestamps in ms since the epoch. |
| `FolderTally` | `sizeBytes`, `files`, `folders`, `skipped`, `done` | as above | Grows monotonically. Links never followed; unreadable folders count in `skipped` (FR-051). |
| `WorkspaceLayout.sidePanes` | `{ projects: boolean; files: boolean }`, optional | `core/workspace/model.ts` | Absent means both expanded (FR-057). Only user toggles write it (FR-058). |
| `FormHistoryFile` | `{ version: 1, entries: Record<flavourId, { startupCommand: string[]; shellArguments: string[] }> }` | user data, `terminal-form-history.json` | Newest first, distinct, no empties, trimmed to `maxEntries` (FR-061, FR-063, FR-065). |

"Flavour" is the code's name for what the spec calls a terminal type.

## New settings

| Key | Type | Default | Requirement |
|---|---|---|---|
| `explorer.showOpenInOsDefaultProgram` | boolean | `true` | FR-021 |
| `projects.openFromOutside` | `'switch' \| 'load'` | `'switch'` | FR-035 |
| `terminals.formHistory.enabled` | boolean | `true` | FR-064a |
| `terminals.formHistory.maxEntries` | integer 1 to 50 | `10` | FR-064 |
| `explorer.openUnsupportedInOs` | boolean | `true` | FR-116 |

The file-manager item (FR-034) is no setting: the OS registration is the state, read and written through `IFileManagerRegistration`.

## New key binding

| Action | Default | Scope |
|---|---|---|
| `tabs.rename` | `Ctrl+Shift+Alt+F2` | window |

## New theme tokens

Icon tokens `save`, `saveAs`, `dragOut` (`dragOut` went with the grip, T030 superseded by FR-114; no call site uses it). Shutdown blocks use the existing `border`, `accent` and `success` colours.
