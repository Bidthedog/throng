# Data Model: Find in Files Polish

All in memory; nothing new is persisted beyond one added preference value.

## Grouping (core `Grouping`, config `FindInFilesGrouping`)

| Value | Label (Preferences) | Shape |
|---|---|---|
| `file` | File | file headings → rows (unchanged) |
| `fileAndFolder` | Folder, then file | folder headings → file headings → rows (unchanged) |
| `folderTree` | Folder structure | folder heading per level → … → file headings → rows (new) |

- `FIND_IN_FILES_GROUPINGS` gains `folderTree`. `search.inFiles.defaultGrouping` still defaults to
  `file`. An unknown stored value falls back to the default (existing parser behaviour).
- The remembered grouping (043 FR-033b/c) stores any of the three, in memory, per project.

## ResultGroup (unchanged type, new instances)

Under `folderTree`:

| Field | Value |
|---|---|
| `key` | root-relative directory for a folder (`''` never appears: the scope root is not a heading); `relPath` for a file |
| `kind` | `'folder'` or `'file'` |
| `matchCount` | matches at and below |
| `stale` | `false` for folders; FR-045a's flag for files |
| `rows` | `[]` for folders; the file's rows for files |
| `children` | sub-folders then files, ordered by `sortNodes` with `explorer.sortOrder` |

Invariant (carried from 043 FR-073): every group that holds rows is a file group.

## Selection (ResultsList state)

| Field | Meaning |
|---|---|
| `selectedKey: string \| null` | the flattened item key — `g:<groupKey>` for a heading, `<relPath>:<from>` for a row |

Transitions:

- click row / heading label → that key
- arrow keys, Home, End → neighbour's key
- regroup → same key if present; a vanished heading → its first descendant row; else `null`
- rows appended (same generation) → unchanged
- new generation → `null`
- collapse hiding the selected row → the collapsed heading

## Results (find-in-files-store)

| Field | Change |
|---|---|
| `status: 'cancelled'` | now keeps `rows`, `staleFiles`, counts (was: emptied) |
| `capped` | unchanged |
| derived `partial` | `capped \|\| (status === 'cancelled' && rows.length > 0)` → one notice |

## Theme token

| Token | Glyph | Parent (fallback) | Role |
|---|---|---|---|
| `busy` | `◌` | `refresh` | "work in progress" indicator on the cancel control |
| `groupFolderTree` | `🗂` | `folderOpen` | the Folder structure grouping control |
