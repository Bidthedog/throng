# Contract — Config & Theme Additions (003 schemas extended)

Additive changes to the 003 user-config documents under `%USERPROFILE%\.throng\` (UI-main-owned,
hot-reloaded, validated by pure `@throng/core/config` code). Existing sections/keys are unchanged;
unknown keys are preserved on rewrite where feasible; absent keys are defaulted.

## settings.json — new `explorer` section

```json
{
  "version": 1,
  "appearance": { "...": "(003, unchanged)" },
  "confirmations": { "...": "(003, unchanged)" },
  "panes": { "...": "(003, unchanged)" },
  "behaviour": { "...": "(003, unchanged)" },
  "explorer": {
    "openMode": "single",
    "deleteMode": "recycle",
    "excludeGlobs": ["**/.git", "**/.svn", "**/.hg", "**/CVS", "**/.DS_Store", "**/Thumbs.db"]
  }
}
```

- `openMode` ∈ {`single`,`double`} — default **`single`** (FR-027). Single-click vs double-click to
  raise the open-file intent.
- `deleteMode` ∈ {`recycle`,`permanent`} — default **`recycle`** (FR-018). `permanent` is confirmed
  before deleting.
- `excludeGlobs` — string[] of globs (matched with `picomatch`) hiding entries by root-relative path;
  default = the **VS Code `files.exclude` defaults**. User-editable; hot-reload reveals/hides live
  (FR-005a). Invalid entries are ignored (validation tolerates a bad glob without crashing).
- `parseAppSettings` merges defaults, validates the enums, and coerces a non-array/garbage
  `excludeGlobs` back to the default.

## keybindings.json — new `file.*` actions

```json
{
  "version": 1,
  "bindings": {
    "...": "(003 zoom/view bindings unchanged)",
    "file.rename": ["F2"],
    "file.cut":    ["Ctrl+X"],
    "file.copy":   ["Ctrl+C"],
    "file.paste":  ["Ctrl+V"],
    "file.delete": ["Delete"]
  }
}
```

- New `ActionId`s: `file.rename | file.cut | file.copy | file.paste | file.delete` (FR-021).
- Resolved by the existing `resolveAction`, **scoped to File Explorer Pane focus** so clipboard chords
  act on the tree only when focused (research D8). Unknown action ids ignored; hot-reloaded.

## themes/*.json — new `icons` tokens

```json
{
  "name": "throng",
  "colours": { "...": "(003, reused: surface, surfaceActive, text, textMuted, accent, border, ...)" },
  "fonts":   { "...": "(003, reused)" },
  "icons": {
    "...": "(003 tokens unchanged)",
    "folder": "...", "folderOpen": "...", "chevron": "...",
    "file": "...",
    "fileCode": "...", "fileJson": "...", "fileMarkdown": "...", "fileImage": "...", "fileText": "...",
    "symlink": "...",
    "expandAll": "...", "collapseAll": "...", "newFolder": "..."
  }
}
```

- Renderer maps a file's extension → a by-type token in `tree-icons.ts`; unknown extension → `file`;
  folder → `folder`/`folderOpen` by expansion state; chevron via `chevron` (or 003's
  `expand`/`collapse`). Toolbar buttons use `expandAll`/`collapseAll`/`newFolder`. Missing theme token
  → throng default via `resolveIcon` (FR-005/FR-006/FR-031). All icons render in a fixed-size box so
  dimensions are uniform.

## Validation / defaults

- All three documents keep the 003 behaviour: **missing → created from defaults**; **malformed →
  last-good/defaults, never crash**; **hot-reload** applies changes within ~500 ms.
- `@throng/core` owns the schema/defaults/validation (pure); UI main owns the files + push.
