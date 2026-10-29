# UI Contract: Find in Files results and menu

The observable surface tests assert against. Existing test ids are unchanged unless listed.

## Toolbar

| Element | Test id | Contract |
|---|---|---|
| Grouping control ×3 | `fif-grouping-{file\|fileAndFolder\|folderTree}-<panel>` | `aria-pressed` on the active one; titles `Group by file`, `Group by folder and file`, `Group by folder structure` |
| Run | `fif-run-<panel>` | shown while not running (unchanged) |
| Cancel | `fif-cancel-<panel>` | shown while running; `data-busy="true"`; icon `busy` rotating (`dismiss` on hover/focus); `title="Cancel search"` |
| Replace All | `fif-replace-all-<panel>` | disabled while running (unchanged) |

## Results list

| Element | Test id / attribute | Contract |
|---|---|---|
| List | `fif-results-<panel>` | `aria-busy="true"` while running |
| Heading | `fif-group-header-<key>` | `data-group-kind`, `data-depth`; `title` = full path; `data-current="true"` when selected |
| Heading label | `.fif-group__key` | base name (file), last segment (folder in `folderTree`), directory path (folder in `fileAndFolder`) |
| Heading folder (file grouping only) | `fif-group-dir-<key>` | muted directory; absent for a root file |
| Row | `fif-row-<relPath>-<from>` | no `aria-disabled` while running; `data-current="true"` when selected; children in order: snippet, then position |
| Row position | `.fif-row__pos` | `(L:C)`, digit-grouped, after the snippet |
| Match | `<mark class="fif-match throng-search-match">` | styled by the shared rule |

## Notice bar

| Notice | Test id | Text |
|---|---|---|
| Partial (cap or cancel) | `fif-partial-notice-<panel>` (replaces `fif-capped-notice-<panel>`) | names the cause; ends "Replace All acts only on the results listed below." |

## Panel menu (`findInFilesContentMenu`)

- **Absent**: `Run search`, `Cancel search`, `Change scope`.
- **Present** in `viewState`, in order: Replace ✓, Group by file ✓, Group by folder and file ✓,
  **Group by folder structure ✓**, Collapse all, Expand all.
- `Replace in <label>` / `Replace Match in <label>`: `<label>` = `leftTruncatePath(relPath)`; disabled
  while running.
