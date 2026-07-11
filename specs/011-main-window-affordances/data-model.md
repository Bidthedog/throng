# Phase 1 Data Model: Main Window Affordances

Config + UI state only. No SQLite, no daemon records.

## AppSettings additions (`packages/core/src/config/app-settings.ts`)

```
newProject: {
  startingFolder: 'profile' | 'lastViewed' | 'override'   // default 'lastViewed'
  overridePath: string                                    // default ''  (user-editable path)
  lastProjectFolder: string                               // default ''  (INTERNAL bookkeeping)
}
```

- **startingFolder** — user-facing. Descriptor: `select`, allowedValues `['profile','lastViewed','override']`, group "New Project".
- **overridePath** — user-facing. Descriptor: new `folder` control kind, group "New Project".
- **lastProjectFolder** — INTERNAL. Added to `SETTINGS_INTERNAL_KEYS`; NO descriptor; MUST NOT appear in the editor. Updated on each successful project creation.

Validation (tolerant parse, mirrors existing sections): unknown `startingFolder` -> `'lastViewed'`; non-string `overridePath`/`lastProjectFolder` -> `''`. Never throws.

## ControlKind addition (`packages/core/src/config/metadata.ts`)

Add `'folder'` to `ControlKind`. Renders the shared folder-picker component (editable path + browse icon). Covered by the metadata completeness audit; no change to `leavesOf`/`auditRegistry` logic.

## Starting-folder resolution (pure, `packages/core/src/config/starting-folder.ts`)

```
resolveStartingFolder(
  cfg: { startingFolder, overridePath, lastProjectFolder },
  ctx: { profileDir: string },
): string   // candidate path; existence is validated in UI-main, which falls back to profileDir
```

- `profile`   -> `ctx.profileDir`
- `lastViewed`-> `cfg.lastProjectFolder || ctx.profileDir`
- `override`  -> `cfg.overridePath || ctx.profileDir`

```
isOverrideResolvable(overridePath, exists: (p) => boolean): boolean   // for the 015 settings flag (FR-044)
```

## Removal-verb glossary (behavioural constants, not persisted)

Per spec Key Entities. Verb is a function of (target, location):

| target | location | verb |
|---|---|---|
| project-owned panel | main window | Destroy |
| project-owned panel | sub-workspace | Close |
| sub-workspace-owned panel | sub-workspace | Destroy |
| tab | main / sub-workspace | Destroy |
| sub-workspace | anywhere | Destroy |
| project | projects list | Remove (confirmation: no files deleted) |
| file/folder | explorer | Delete (unchanged) |

## Editor notice (file-changed) — existing model reused

`EditorNotice.files: NoticeFile[]` where `NoticeFile = { dir, name, note? }` (already defined in `editor-notice-store.ts`). The file-changed notice sets one entry: `{ dir, name }` from the full path, `note = "Panel: <title> - Tab: <tabTitle>"`. No model change.

## Terminal exit dismissal state (`terminal/exit-store.ts`)

Existing per-panel exit record (`getPanelExit`/`clearPanelExit`). Add a **dismissed** signal keyed by panelId so the notice can hide without clearing the record or the draft. `Clear` resets the draft only; `Confirm` clears the record (panel becomes typed); dismiss sets dismissed.

## Unsaved-dot animation (CSS only, `theme.css`)

No data. One `@keyframes throng-unsaved-pulse` (opacity 1 -> ~0.4 -> 1, ~1.5s, infinite) on `.throng-unsaved-dot`; reduced-motion media query pins static full opacity.
