# Data model: One default icon set, drawn from Lucide

**Feature**: 069 · [spec.md](spec.md) · [research.md](research.md)

## IconKey (core, `icons/icon-keys.ts`)

| Field | Type | Rule |
|---|---|---|
| key | `IconKey`, a member of `ICON_KEYS` | camelCase, unique. Also the file stem a user set overrides it with (`<key>.svg`). |
| description | `string` (`ICON_KEY_DESCRIPTIONS[key]`) | One short sentence (FR-012). Shown in Preferences and listed in `README.txt`. |

- `ICON_KEYS` = today's 110 keys − `notifications` (retired, FR-011) + `dragHandle`, `menuChecked`
  and `overrideIcon` (R3).
- Every key has at least one render site (FR-011, asserted by `icon-call-sites.test.ts`).

## DefaultIconSet (core, generated)

| Field | Type | Rule |
|---|---|---|
| `DEFAULT_ICON_SET` | `Readonly<Record<IconKey, string>>` | Sanitised SVG markup for **every** key (FR-004). 24×24 viewBox, `stroke="currentColor"`, no `<text>`, no colour literal (FR-005, FR-006). |
| `ICON_SETS_README` | `string` | The text of `icon-sets-README.txt` (FR-023). |
| name | constant `'throng'` | Reserved: no user set may take it (FR-025). |

Its source, `default-set/SOURCES.json`, holds `{ lucideVersion, keys: Record<IconKey, {lucide: string} | {throng: string}> }`
and is the token-to-art mapping (FR-008, FR-031).

## UserIconSet (main, `IconSetService`)

The folder `<configRoot>/icon-packs/<name>/`.

| Field | Type | Rule |
|---|---|---|
| name | `string` | The folder name. Valid per `validateIconSetName` (FR-025). A folder ending `.bak` or `.bak.<n>` is not a set and is never listed (FR-037). |
| overrides | `Record<IconKey, string>` | Sanitised markup for each `<key>.svg` present (FR-026). The file's presence alone is the override (FR-027). |
| failures | `Record<IconKey, string>` | The reason a present `<key>.svg` could not be used: unreadable, not SVG, rejected by the sanitiser. That key falls back to the default set. |
| unrecognised | `string[]` | Files that are not `<IconKey>.svg` (FR-027). |
| error | `string?` | The whole set could not be read: the folder is gone, or permission is denied. The theme then falls back to the default set, and the picker shows the set as unavailable (FR-016). |

Lifecycle: loaded at startup → served from memory → re-read only on Reload the icon sets from disk, on selection, or at
the next start (FR-029). Created by Copy (FR-024) and modified by Override this icon (FR-032, FR-033).
Everything else happens outside throng.

## IconSetPayload (main → renderer, in `ConfigPayload`)

`{ sets: Array<{ name, overrides, failures, unrecognised, error? }> }`. It replaces
`iconPacks: LoadedIconPack[]` in the config payload (`config-watcher.ts:38`). The default set never
crosses IPC: the renderer imports it from `@throng/core`.

## Theme (core, `config/theme.ts`), changed

| Field | Change |
|---|---|
| `icons` | **Removed** from the type, `THRONG_THEME`, the default themes and `theme-metadata` (`icons.*` descriptors). Dropped on read by `migrateTheme` and on disk by the v34 upgrade. |
| `iconOverrides` | **Removed**, the same way. |
| `iconPack?` | **Kept**, under its existing JSON key. Absent, `throng`, or the name of an unavailable set all mean the default set. Otherwise it names a user set (FR-014). |
| `colours.iconColour?`, `sizes.iconPx` | Unchanged (018 FR-027 to FR-031). |

`IconValue`, `IconAsset`, `LoadedIconPack`, `parseIconPack`, `resolveIconValue` and `resolveIconAsset` are
removed. Their replacement is `resolveIcon(theme, sets, key): string`, the markup to draw.

## IconSetUpgradeState (main, `<configRoot>/icon-sets-upgrade.json`)

| Field | Type | Rule |
|---|---|---|
| pending | `string[]` | The folder names, and `README.md`, captured on the first attempt. Only these are ever acted on (FR-020). |
| done | `boolean` | Written once every pending item has succeeded. Once set, the step never runs again. |

Per pending item:

```
throng | throng-svg  ── matches seeded history (FR-036) ──► delete
                     └─ customised ──────────────────────► rename to backup
other folder ────────────────────────────────────────────► rename to <name>.bak | <name>.bak.<n> (first free n)
README.md ───────────────────────────────────────────────► delete
any failure ─────────────────────────────────────────────► logCaught; stays pending; retried next start
```

## SeededIconHistory (core, generated, frozen)

`SEEDED_ICON_HISTORY: Readonly<Record<'throng' | 'throng-svg', readonly SeededVersion[]>>`, where a
`SeededVersion` is `{ tags: readonly string[]; files: Readonly<Record<string /* file name */, string /* sha256 hex */>> }`:
one entry per distinct set of files some release seeded, with the tags that wrote exactly it. A seeded
folder is **uncustomised** when its files match one entry as a whole — the same file names, each with
that entry's hash (FR-036). Per-file hash lists would accept a mix of files from different releases,
which no release ever wrote.

## Notice action (core, `notice/notification-entries.ts`), extended

`NotificationActionDescriptor` gains `{ kind: 'openIconSetsFolder' }` beside `goToPanel`, `openFile` and
`openPreferences`.
