# Phase 1 Data Model: Preferences Editor — Title Bar, Settings, Key Bindings & Themes

Entities, types, and config additions. **No SQL / no migration** (research D1): the edited documents are the
existing file-based config (`FileConfigStore`); new persisted artefacts (installed default-theme source,
font cache, icon packs) are app-data / config files. The preferences-window session state (on-entry
snapshot, current tab, UI/JSON mode) is **in-memory**. **No daemon and no `ipc-contract` involvement.**

---

## 1. Editor metadata registry (core — Phase B/D/E)

The single declarative source of truth the visual editors render from (FR-025a). Pure; zero OS/DOM.

```ts
// packages/core/src/config/metadata.ts
type ControlKind =
  | 'number' | 'text' | 'toggle'
  | 'select'        // single-choice from allowedValues
  | 'multiselect'   // subset of allowedValues
  | 'array'         // add/remove/reorder free entries
  | 'colour' | 'font-family' | 'font-size' | 'enum'
  | 'chord'         // keybinding chord (edited via the capture modal, not a generic control) (Phase D)
  | 'icon';         // icon token (pack-aware, Phase F)

interface FieldDescriptor {
  key: string;                 // dotted path into the document (e.g. 'behaviour.tabHoverActivateMs')
  label: string;               // human-readable (FR-027)
  description: string;         // what it changes and why (FR-027)
  group: string;               // labelled section (FR-026/030/038)
  control: ControlKind;        // matched to the value type (FR-028/029/038)
  allowedValues?: readonly (string | number)[];  // for select/multiselect/enum (FR-029)
  min?: number; max?: number; step?: number;      // for number/font-size
  itemControl?: ControlKind;   // element control for 'array'
}

type MetadataRegistry = readonly FieldDescriptor[];
```

- `settings-metadata.ts` → `SETTINGS_METADATA` — one descriptor per **leaf** of `AppSettings`
  (`core/config/app-settings.ts`: `appearance.theme`, `confirmations.*`, `panes.*.maxWidth`,
  `behaviour.*`, `explorer.*`, `terminals.*`, `editor.*`). Enumerated values (e.g. `ConfirmLevel`,
  `explorer.openMode`, `editor.saveAllScope`, `defaultLineEnding`) carry `allowedValues` → `select`/`enum`.
- `keybindings-metadata.ts` → `KEYBINDINGS_METADATA` — one descriptor per `ActionId`
  (`core/config/keybindings.ts` union); each carries `label`/`description`/`group` and `control:'chord'`
  (the `'chord'` `ControlKind` above), signalling that the value is edited via the capture modal rather than
  a generic form control. The descriptor's `key` is the `ActionId`.
- `theme-metadata.ts` → `THEME_METADATA` — one descriptor per theme token: colour tokens → `colour`; font
  family/size → `font-family`/`font-size`; typography-role fields → grouped; enumerated (`case`) → `enum`;
  icon tokens → `icon`.

**Completeness (FR-047, unit test):**

```ts
// every configurable key/action/token has exactly one descriptor
assertEveryKeyDescribed(leavesOf(DEFAULT_APP_SETTINGS), SETTINGS_METADATA);
assertEveryKeyDescribed(ACTION_IDS,                     KEYBINDINGS_METADATA);
assertEveryKeyDescribed(tokensOf(THRONG_THEME),         THEME_METADATA);
```

Adding a config key without a descriptor **fails this test** — the enforcement mechanism behind FR-047/048.

---

## 2. Config write + confinement (UI main — Phase B)

Reuses `FileConfigStore` (`ui/src/main/config-store.ts`). New renderer-reachable operations:

```ts
// doc identity reuses the existing ConfigDocId (core/abstractions/config-store.ts)
type ConfigDocId =
  | { kind: 'settings' }
  | { kind: 'keybindings' }
  | { kind: 'theme'; name: string };

// UI-main config-write-ipc.ts
writeConfig(id: ConfigDocId, json: string): Promise<{ ok: true } | { ok: false; error: string }>;
listThemes(): Promise<string[]>;                 // names in themes/ (+ installed source)
renameTheme(from: string, to: string): Promise<{ ok: boolean; error?: 'exists' | 'invalid' }>; // FR-036a reject on collision
deleteTheme(name: string): Promise<void>;        // caller confirmed (FR-036)
restoreDefaultThemes(): Promise<string[]>;       // re-create missing built-ins from installed source (FR-037)
```

- **Confinement (FR-042):** `writeConfig` resolves the path via `FileConfigStore.pathOf(id)` and refuses
  anything that would escape the config roots; `json` must parse (FR-017) or the write is rejected
  (`{ ok:false }`) and nothing is written.
- **Apply:** a successful write is atomic (temp+rename, existing behaviour) and the **existing watcher**
  rebroadcasts `throng:config`, live-applying to all windows (research D1/D13).

---

## 3. Window chrome & preferences window (UI main + renderer — Phase A)

```ts
// UI-main window-controls-ipc.ts (targets BrowserWindow.fromWebContents(sender))
'throng:window:minimize' | 'throng:window:maximize' | 'throng:window:close' | 'throng:window:isMaximized';
// push: 'throng:window:maximizeChanged' (boolean) on maximize/unmaximize

// UI-main preferences-window.ts
openPreferences(tab: 'settings' | 'keybindings' | 'themes'): void; // create-or-focus the single window (FR-010)
// on open: setEnabled(false) on main + all sub-workspace windows (FR-013); capture on-entry snapshot
// on close: setEnabled(true) restored
```

- **Window** creation flags: `frame:false`, `alwaysOnTop:true`, `movable:true`, reuse the sandboxed
  `webPreferences`; loaded as `index.html?prefs=<tab>` (renderer routes it to `<PreferencesApp/>`).
- **Title-bar identity**: main window shows `throng · <project or 'No project'> · <context>` (moved out of
  `app.tsx TitleManager`); sub-workspace shows its `{ name, colour }` (from `subworkspace-window-context`),
  **no cog** (FR-007).

**Preferences session state (in-memory, renderer + a UI-main slice):**

```ts
interface PreferencesSession {
  activeTab: 'settings' | 'keybindings' | 'themes';
  mode: 'ui' | 'json';                 // global (FR-020)
  onEntry: {                           // reset-all snapshot (FR-024)
    settings: string;                  // raw settings.json at open
    keybindings: string;               // raw keybindings.json at open
    themes: Record<string, string>;    // name → raw file, captured when first edited this session
    activeTheme: string;               // appearance.theme at open
  };
}
```

---

## 4. Theme model extension — icon packs (core — Phase E/F)

Extends the existing `Theme` (`core/config/theme.ts`) additively (back-compatible; existing themes omit the
new fields and behave as today):

```ts
type IconValue = { glyph: string } | { image: string };  // image = relative filename within the pack

interface Theme {
  name: string;
  colours: Record<string, string>;
  fonts: ThemeFonts;
  typography?: Partial<Record<TypographyRole, ThemeFontRole>>;
  icons: Record<string, string>;          // existing per-token glyph defaults (ultimate fallback base)
  iconPack?: string;                      // (new) name of the chosen pack (FR-039)
  iconOverrides?: Record<string, IconValue>; // (new) per-token overrides on top of the pack (FR-039)
}

// packages/core/src/config/icon-pack.ts
interface IconPackManifest { name: string; tokens: Record<string, IconValue>; }
parseIconPack(raw: unknown): IconPackManifest;               // tolerant
resolveIconValue(theme, packs: Record<string, IconPackManifest>, token: string): IconValue;
//   override → pack token → theme.icons[token] glyph → THRONG_THEME.icons[token] glyph (FR-040 fallback)
```

- **On disk:** `%USERPROFILE%\.throng\icon-packs\<pack>\pack.json` + SVG/PNG assets; a bundled
  `icon-packs\README` documents the format + token list (FR-040a).
- **Render:** 24px box; `{glyph}` as text, `{image}` via an asset URL resolved by UI-main
  `icon-pack-service.ts` (the renderer never touches `fs`).

---

## 5. Font enumeration + cache (core seam + UI main — Phase E)

```ts
// packages/core/src/abstractions/font-enumeration.ts
interface IFontEnumeration { listInstalledFamilies(): Promise<string[]>; }

// packages/core/src/config/font-typeahead.ts (pure)
matchFamilies(query: string, families: readonly string[]): string[];
//   split query on whitespace → keep family iff EVERY token is a case-insensitive substring (FR-038b)

// packages/core/src/config/settings-search.ts (pure) — FR-049
interface SearchableField { key: string; label: string; description: string; }
searchTokens(query: string): string[];                       // lowercase, whitespace-split, blanks dropped
fieldHaystack(field: SearchableField, value: unknown): string; // key + label + description + rendered value
matchesQuery(query: string, field: SearchableField, value: unknown): boolean;
filterFields<T extends SearchableField>(query, fields: readonly T[], valueOf: (f: T) => unknown): T[];
//   keep field iff ANY token is a case-insensitive substring of its haystack (OR — extra words WIDEN,
//   the inverse of matchFamilies' AND). Blank query → every field. View state only; never persisted.
```

- **Cache:** `%APPDATA%\throng\fonts.json` = `{ families: string[], generatedAtVersion?: string }`, written
  by a **background** populate at startup (never awaited — SC-010), read by `config.listFonts`. Restart
  refreshes it (FR-038a). Absent/empty → curated fallback + free typing.
- **Contract suite:** `core/testing/font-enumeration-contract.ts` — returns a string array (possibly empty),
  never throws; verified against `WindowsFontEnumeration`.

---

## 6. Default themes (core data — Phase E)

```ts
// packages/core/src/config/default-themes/index.ts
export const DEFAULT_THEMES: Record<string, Theme>; // 14 entries, each full-token over THRONG_THEME (FR-046)
// Light, Snake, Gothic, "Windows Terminal", Bash, SUBNET(placeholder), VSCode, "VI/VIM",
// "English Garden", Matrix, Cyberpunk, Claude, Debian, Ubuntu
```

- **Installed source:** seeded to `%APPDATA%\throng\default-themes\<name>.json` on first run; **restore**
  (FR-037) re-creates missing user themes from it. Brand themes are approximations; **SUBNET is a
  placeholder** (spec Assumptions). Unit test: all 14 present, names unique, every token resolvable, and
  **pairwise-distinct** (no two default themes are token-identical — not merely distinct from `throng`),
  per SC-007.

---

## 7. Key-binding capture (core — Phase D)

```ts
// packages/core/src/config/chord-capture.ts (pure; builds on keybindings.ts eventToToken/normalizeToken)
captureToken(ev: { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): string;
isBindableChord(token: string): boolean;           // ≥1 modifier + a non-modifier key (FR-033a)
isReservedChord(token: string): boolean;           // OS/window-control combo we cannot bind (FR-032a; see RESERVED_CHORDS)
findConflict(bindings: Record<string, string[]>, token: string, exceptAction: ActionId): ActionId | null;
applyReplace(bindings, action, token): Record<string, string[]>;   // FR-033 replace action's chord(s)
applyReassign(bindings, fromAction, toAction, token): Record<string, string[]>; // FR-034 remove then assign

// RESERVED_CHORDS — canonical tokens owned by the OS / window manager that the app cannot reliably
// intercept, so they must never be saved as a dead binding (FR-032a). A curated denylist (extensible):
//   Ctrl+Alt+Delete, Ctrl+Shift+Escape, Alt+F4, Alt+Tab, Alt+Escape, Alt+Space (system menu),
//   and any chord whose only modifier is Meta/Super (e.g. Meta+L, Meta+D, Meta+Tab) — the Windows key
//   is OS-owned. isReservedChord matches a captured canonical token against this set/rule.
```

Edited via the **capture modal** (renderer): a captured token that is **reserved** (`isReservedChord`) is
surfaced as unavailable and **not** saved (the modal stays open); otherwise the modal validates
`isBindableChord`/`findConflict` and writes the resulting `keybindings.json` via `config.write`
(immediate-apply).

---

## 8. Reset / snapshot (core — Phase G)

```ts
// packages/core/src/config/theme-reset.ts (pure)
resetCurrentSettings(): AppSettings;                 // DEFAULT_APP_SETTINGS (FR-023)
resetCurrentKeybindings(): Keybindings;              // DEFAULT_KEYBINDINGS (FR-023)
resetCurrentTheme(name: string, installedSource): Theme | null; // built-in only → installed default; null (disabled) for user themes (FR-023)
revertAll(snapshot: PreferencesSession['onEntry']): WritePlan; // re-write each snapshotted file + re-activate on-entry theme (FR-024)
```

`WritePlan` is a list of `{ id: ConfigDocId; json: string }` the renderer applies via `config.write` (each
confirmed — FR-025). A missing file on reset is re-created with defaults (edge case).

---

## 9. Preload bridge surface (renderer ↔ UI main — no daemon)

Additions to `window.throng` (`preload.cts`), peers of the existing read-only `config.*`:

| Namespace | Methods (new) | Phase |
|-----------|---------------|-------|
| `window.*` | `minimize()`, `maximize()`, `close()`, `isMaximized()`, `onMaximizeChange(cb)` | A |
| top-level | `openPreferences(tab)` | A |
| `config.*` | `write(id, json)`, `listThemes()`, `renameTheme(from,to)`, `deleteTheme(name)`, `restoreDefaultThemes()`, `listFonts()`, `listIconPacks()` | B/E/F |

The existing `config.get()` / `config.onChange(cb)` (read + hot-reload) are unchanged and carry
immediate-apply + external-change reflection (FR-041) for free.

---

## 10. What is explicitly NOT added

- **No SQLite migration** (`user_version` stays 6); a test asserts it.
- **No `ipc-contract` frame / daemon method** — everything is UI-main IPC + preload, like `files.*`.
- **No new `AppSettings` section** beyond descriptors describing the *existing* sections (research D5); the
  `editor`/`terminals`/`explorer`/… sections already exist in `app-settings.ts`.
- **No per-project or per-sub-workspace config** — configuration stays user-scoped (Out of Scope).

---

## Delta — 2026-07-08 Refinements

- **Theme (`core/config/theme.ts`)** — additive: `colours.buttonBg`, `colours.buttonText`,
  `colours.buttonHoverBg`, `colours.buttonHoverText`, and a `button` typography role
  (`typography.button: ThemeFontRole`). `toCssVariables` emits `--throng-colour-button*` and
  `--throng-font-button-*`. Absent in an old theme → falls back to generic button styling. Font-family
  token values are CSS fallback stacks (comma-separated) edited via the pill control.
- **Font stack (`core/config/font-stack.ts`, new, pure)**
  `parseFontStack(value: string): string[]` (split on commas, trim, strip matching quotes) and
  `serializeFontStack(families: string[]): string` (quote families containing spaces, join with `, `).
- **Chord capture (`core/config/chord-capture.ts`)** — `EXCLUDED_KEYS` set (Escape, ' '/Space, Shift,
  Control, Enter, CapsLock, Tab, NumLock + lone modifiers); `isBindableChord` → true for any non-excluded
  key/chord (single keys allowed) that is not `isReservedChord`; `applyAdd(bindings, action, token)`
  (append if absent, dedup) and `applyRemove(bindings, action, token)`; `applyReassign` retained for
  conflicts; `applyReplace` kept for JSON/programmatic use.
- **Bundled icon packs** — first-run seeding writes two packs under `icon-packs/`: `throng` (glyph map from
  `THRONG_THEME.icons`) and a secondary SVG-image pack (assets shipped with the app). Default
  `theme.iconPack` = `throng`.
