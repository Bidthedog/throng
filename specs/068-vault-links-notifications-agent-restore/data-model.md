# Data model: Vault links, a notifications panel and agent session restore

## Wikilink target (FR-001 to FR-006, FR-011)

| Field | Type | Rule |
|---|---|---|
| `path` | string | as written, leading `/` removed |
| `rooted` | boolean | the target began with `/` |
| `fragment` | string \| undefined | text after `#` |
| `alias` | string \| undefined | text after `\|` |

**Candidates** (`wikiCandidates(target, docDir, projectRoot)`): rooted → the 047 FR-052c suffixes from `projectRoot` only; not rooted → the suffixes from `docDir`, then from `projectRoot` (when not null), duplicates removed. The first candidate that exists, by main's answer, is the link's one target. No candidate exists → unresolved, and the provisional candidate 0 is kept for the notice.

**Display text** (`wikiDisplayText(target)`): `('/' if rooted) + path + ('#' + fragment if present)`. No scheme, no percent-escapes.

## Image embed reference (FR-010 to FR-015)

`isImageEmbedRef(path)`: the extension is in `PREVIEW_IMAGE_EXTENSIONS` = `.png .jpg .jpeg .gif .webp .avif .bmp .ico .svg` (the one list the asset protocol also uses). Alt text = alias verbatim, else the file name with its extension.

## Notification settings (FR-021a to FR-021d, FR-026c, FR-031d)

`AppSettings.notifications`:

| Key | Type | Default | Range |
|---|---|---|---|
| `error.mode`, `warning.mode` | `'never' \| 'toast' \| 'panel'` | `panel` | — |
| `info.mode`, `success.mode`, `attention.mode` | same | `toast` | — |
| `<type>.os` | boolean | unchanged | — |
| `os` | boolean | unchanged | — |
| `toastDurationMs` | integer | 3000 | 3000–30000, step 500 |
| `confirmDismissAll` | boolean | true | — |
| `panelLimit` | integer | 100 | 20–500, step 10 |

`search.inFiles.summaryNoticeMode`: same tokens, default `panel`; `summaryNoticeTimeoutMs` removed.

**Upgrade** (raw document, before the bounds guard): mode `dismiss` → `panel`, `timed` → `toast`, `never` → `never`; any `timeoutMs` under `notifications.<type>` and `search.inFiles.summaryNoticeTimeoutMs` removed. Idempotent: an upgraded document is returned unchanged.

## Notice (renderer, changes only)

| Field | Change |
|---|---|
| `sticky?: boolean` | new; true exempts the toast from the duration timer (research D4) |
| `onExpire?: () => void` | new; runs when the timer ends the toast. `onDismiss` now runs only on a user's dismissal |
| `display?` | carries `{ mode }` only; the per-notice timeout goes |
| `panelActions?: NotificationActionDescriptor[]` | new; serialisable actions an entry can offer |

## Notification entry (FR-024 to FR-031c, FR-039b)

Stored by main in `userData/notifications.json`.

| Field | Type | Rule |
|---|---|---|
| `id` | string | uuid, assigned by main |
| `key` | string | dedupe key: group key, else a content key of severity + message + title + subject |
| `severity` | `'error' \| 'warning' \| 'info' \| 'success' \| 'attention'` | |
| `title`, `message`, `action` | string \| undefined | as the notice |
| `subject` | string \| undefined | formatted subject text |
| `details` | string[] | |
| `copyText` | string | what Copy puts on the clipboard; equals the toast's copy text |
| `affected` | `{ panelId?: string; label: string }[]` | |
| `actions` | `NotificationActionDescriptor[]` | |
| `raisedAt` | number (ms) | first raise; a repeat does not change it |
| `repeatCount` | number | bumped on a repeat (the entry flashes) |
| `pending` | boolean | *Retired 2026-11-13 (FR-059): no longer written; a stored value loads and is ignored.* |
| `origin` | `{ panelId?: string; projectId?: string }` \| undefined | what the notice relates to (FR-061); a `panelId` makes the entry a link to that panel (FR-063) |
| `place` | `{ project?: string; tab?: string; panel?: string }` \| undefined | the names resolved when the notice was raised, shown as `Project › Tab › Panel` and kept across a restart (FR-061); never written to the diagnostic log (FR-034b) |

`NotificationActionDescriptor`: `{ kind: 'goToPanel'; panelId: string; label: string }` \| `{ kind: 'openFile'; projectId: string; relPath: string; label: string }` \| `{ kind: 'openPreferences'; section: string; label: string }`. A descriptor whose target no longer exists is hidden (FR-031a). *2026-11-13 (FR-063): a `goToPanel` descriptor is no longer rendered as a control; the entry's `origin` is its link.*

**Store document**:

```json
{ "version": 1, "order": "oldest", "limitWarningDismissed": false, "limitWarningShown": false, "entries": [ … ] }
```

`order`: `'oldest' | 'newest' | 'priority-oldest' | 'priority-newest'` (FR-028). Priority: error, warning, attention, info, success. `version` is 1; a document with another or no version is parsed as an empty version-1 document after setting the old file aside (FR-031c).

**Transitions**: add (dedupe → flash, else append; trim oldest past the limit, logging each drop) · dismiss(id) · dismissAll · clearPending *(retired 2026-11-13, FR-059)* · setOrder · applyLimit(n) · dismissLimitWarning. Reaching the limit with `limitWarningShown` false sets it and reports `limitReached` to the main window; `limitWarningShown` resets when the count falls below the limit and `limitWarningDismissed` is false.

## Side-panel layout state (FR-035 to FR-038a)

Renderer `localStorage`, global:

| Key | Value |
|---|---|
| `throng.sidebarPanelSizes` | existing; heights `[projects, subworkspaces]` |
| `throng.sidebarPanelMinimised` | `[false, boolean]` |
| `throng.explorerPanelSizes` | heights `[explorer, notifications]`; notifications default 160 px |
| `throng.explorerPanelMinimised` | `[false, boolean]` |

A minimised panel keeps its last height in the sizes array; restore returns to it (FR-037).

## Claude session record (read only, FR-049)

`<CLAUDE_CONFIG_DIR or ~/.claude>/sessions/<pid>.json` — fields read: `pid` (number), `sessionId` (uuid string), `procStart` (string, Linux clock ticks) and `startedAt` (epoch ms, compared on Windows within 15 s). Nothing else is read; `*.key` files and `projects/` are never opened.

## Terminal command notification (FR-040 to FR-047)

`TerminalCommandNotification` gains `memoryCommand?: string` — present only when the foreground process is Claude Code with an identified session, holding `claude --resume <sessionId> <kept args>`. The renderer persists `memoryCommand ?? command` as `TerminalMemory.observedCommand`.

## Anonymiser (FR-034a to FR-034f)

Registered values: `{ kind: 'projectRoot' | 'projectName' | 'home' | 'userData' | 'install' | 'user' | 'host' | 'path'; value: string; id?: string }`. Tokens: `<project:ID>` for a project; `<install>` for the install folder; otherwise `<kind-xxxxxxxx>` where `xxxxxxxx` is the first 8 hex digits of HMAC-SHA256(salt, normalised value). Salt: 32 random bytes, hex, in `<logs>/.anon-salt`, created once.

## Project (FR-034e)

`projects.id` must be a non-empty string. A row read with a null or empty id gets a new UUID, saved by `rowid`.
