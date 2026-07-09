# Phase 0 Research: Preferences Editor — Title Bar, Settings, Key Bindings & Themes

Decisions resolving the Technical Context. Each: **Decision / Rationale / Alternatives**. Grounded in the
existing codebase (file paths cited) and the spec's confirmed answers (four clarify sessions, 2026-07-07).

---

## D1 — Feature ownership: UI-main + renderer; daemon & SQLite untouched

**Decision**: The entire feature lives in **UI main + the sandboxed renderer**. The config domain is already
pure in `@throng/core` (`config/app-settings.ts`, `config/keybindings.ts`, `config/theme.ts`), the file I/O
is the UI-main `FileConfigStore` (`ui/src/main/config-store.ts`, atomic write), and live reload is the
UI-main `startConfigWatcher` (`ui/src/main/config-watcher.ts` + `node-file-watcher.ts`). This feature adds a
renderer→main **`config.write`** path, custom **window chrome**, the **preferences window**, and one new OS
seam (`IFontEnumeration`). **No daemon service, no `ipc-contract` change, no SQLite migration**
(`user_version` stays 6).

**Rationale**: Immediate-apply (FR-016/018) is *literally* the existing path — writing a config file already
triggers the watcher, which re-reads and broadcasts `throng:config` to every window (`config-watcher.ts`).
So "apply" = "write the file". Nothing here must outlive the UI or be shared across processes, so the daemon
adds only coupling. This mirrors 004/006's "UI-main owns the OS seam; renderer stays sandboxed behind a
preload bridge".

**Alternatives**: A **daemon-owned config service / settings table** — rejected (YAGNI, Principle VIII):
duplicates the file-based layer + watcher, adds an `ipc-contract` surface and a migration for zero benefit.

---

## D2 — Custom title bar on frameless windows (replace OS chrome)

**Decision**: Make the main and sub-workspace `BrowserWindow`s **frameless** (`frame: false` in
`createMainWindow` / `createSubWorkspaceWindow`, `ui/src/main/main.ts`) and draw an **application title bar**
(`renderer/title-bar/title-bar.tsx`) as the top full-width row, above the Panes bar and matching its height.
The bar hosts window identity (left), an **extensible action area**, and **min / max-restore / close** on the
right. Dragging an empty region moves the window (CSS `-webkit-app-region: drag`, controls marked
`no-drag`); double-click toggles maximise. Window controls call new UI-main IPC
(`throng:window:minimize/maximize/close`, targeting the sender window). `Menu.setApplicationMenu(null)` is
already set (`main.ts` L241), so no OS menu bar exists.

**Rationale**: FR-001/002/003/004 require replacing the OS chrome, hosting the three controls, moving window
identity into the bar, and standard drag/double-click. Today **all windows are OS-framed and there is no
custom title-bar component** — greenfield. The window-identity text currently pushed via `win.setTitle`
(`app.tsx TitleManager`, `subworkspace-app.tsx SubWorkspaceTitle`) moves into the bar; the OS `setTitle` may
be kept only for taskbar labelling, not for on-window chrome.

**Alternatives**: Keep the OS title bar plus an app toolbar — rejected: FR-002 forbids a second bar and
requires the identity to move into the app bar. Electron `titleBarStyle: 'hidden'` + `titleBarOverlay`
(Windows) — considered, but a fully app-drawn bar gives full control over identity + the cog + future actions
and stays theme-consistent; the Windows-11 **Snap Layouts** flyout on maximise-hover is a **best-effort**
native nicety (FR-002) obtained via the platform where available and otherwise omitted.

---

## D3 — The preferences window: a second renderer entry, always-on-top, app-modal, movable

**Decision**: The preferences window is a **separate frameless `BrowserWindow`** created by a new UI-main
`preferences-window.ts`, loading the existing `index.html` with a **`?prefs` URL flag** (mirroring the
sub-workspace `?sw=<id>` pattern in `main.ts createSubWorkspaceWindow` + `renderer/main.tsx` window-identity
parsing). It is **`alwaysOnTop: true`**, **movable**, and **single-instance** (re-invoking the cog focuses
the existing one — FR-010). While open, all other windows are made **non-interactive** by calling
`win.setEnabled(false)` on the main window and every registered sub-workspace window
(`window-manager.ts` tracks them), restored on close (FR-013). The preferences window itself stays movable
(FR-014).

**Rationale**: FR-010/013/014 need a single shared window that floats above **all** throng windows (main +
sub-workspaces), stays movable, and blocks interaction beneath. A real OS window is the only unit that can
float above sub-workspace windows and be dragged aside. Electron `modal: true` binds to a single `parent`
and can't cover multiple sibling windows, so **app-modal is enforced explicitly** via `setEnabled(false)`
across the tracked window group — the group is already centralised in `window-manager.ts`.

**Alternatives**: An in-app React modal overlay inside the main window — rejected: cannot float above
sub-workspace windows and contradicts "movable to reveal the windows beneath". A `modal:true` child of the
main window — rejected: doesn't block sub-workspace windows.

---

## D4 — Renderer→main `config.write` bridge + confinement

**Decision**: Add a **`config.write({ kind, name? }, json)`** preload method (peer of the existing read-only
`config.get`/`config.onChange` in `preload.cts`) → a new `config-write-ipc.ts` in UI main → the existing
`FileConfigStore.write`. Also add `config.listThemes`, `config.renameTheme`, `config.deleteTheme`,
`config.restoreDefaultThemes`, `config.listFonts`, `config.listIconPacks`. Every write is **confined**: the
doc id is resolved through `FileConfigStore.pathOf` and rejected if it escapes the config roots (FR-042).

**Rationale**: The renderer is sandboxed (no `fs`); config is read-only from it today (`preload.cts` config
namespace = `get` + `onChange`). Immediate-apply needs a write path, and confinement keeps the OS-seam
boundary honest. Writing atomically (temp + rename — already in `FileConfigStore.write`) plus the watcher's
rebroadcast gives immediate-apply for free (D1).

**Alternatives**: Direct `fs` writes from the renderer — rejected (sandbox + Principle II). A generic
"write any path" IPC — rejected (FR-042 confinement; a doc-id-typed API is safer).

---

## D5 — Declarative editor-metadata registry (FR-025a) drives the visual editors

**Decision**: A **pure metadata registry in `@throng/core`** — `config/metadata.ts` (shared descriptor
types + control kinds), `config/settings-metadata.ts` (one descriptor per `AppSettings` leaf),
`config/keybindings-metadata.ts` (per `ActionId`), `config/theme-metadata.ts` (per theme token). Each
descriptor carries `{ label, description, group, control, allowedValues?, min?, max?, … }`. The renderer's
**generic descriptor-driven form** renders controls from these; a **completeness unit test** asserts every
`AppSettings` leaf key, every `ActionId`, and every default-theme token has a descriptor (FR-047), so adding
config without a descriptor **fails the build**.

**Rationale**: FR-025a/047/048 demand a single source of truth that both the form and its validation read,
and a way to *enforce* "every option exposed". A declarative registry + completeness test is the minimal,
testable mechanism, and keeps the UI open/closed (new config → new descriptor, not new components — DRY).
`AppSettings` (`core/config/app-settings.ts`) and `ActionId` (`core/config/keybindings.ts`) already enumerate
the keys; descriptors annotate them.

**Alternatives**: Deriving from a runtime schema (Zod/JSON-Schema) — rejected for this pass: the config
model is hand-written TS interfaces with a tolerant parser, not a schema object; layering labels/descriptions
on a schema is more machinery than a descriptor map (YAGNI). Per-setting components — rejected (D5 rationale).

---

## D6 — JSON mode reuses CodeMirror in a new standalone buffer-only mode

**Decision**: Extract a **buffer-only** CodeMirror view — `renderer/editor/standalone-editor.tsx` — that
takes a plain-text `value` + `onChange` and mounts CodeMirror with the **same extension set** as the 006
editor (`@codemirror/{state,view,commands}`, already dependencies) but **no `Panel`, no editor coordinator,
no file I/O**. Refactor the CM mount currently inlined in `use-editor.ts` (006) into a shared helper so both
the panel editor and the standalone editor build the view identically (DRY). Each preferences JSON tab mounts
its **own** standalone instance (FR-021 — independent of one another and of every app editor).

**Rationale**: FR-021 requires the built-in code editor, independent buffers, no sharing. The 006 editor is
**tightly Panel/coordinator-coupled** (buffer registry, dirty lock, recovery, cross-window mirror keyed by
`panel.id`) — none of which JSON mode wants. A buffer-only wrapper reuses the component (constitution's
"reuse components, not the whole IDE") without dragging in the coordinator.

**Alternatives**: Mounting the full `EditorPanel` for JSON — rejected: pulls in the coordinator/recovery/one-
buffer machinery meant for project files. A plain `<textarea>` — rejected: FR-021 says the built-in code
editor.

---

## D7 — Global UI⇄JSON toggle; per-tab file mapping (incl. multi-file themes)

**Decision**: A **single global** mode toggle on the tab header (FR-019/020) flips **all three** tabs between
the visual form and the JSON editor; it is rendered in the always-visible header row so it survives the
minimum window size. In JSON mode each tab edits a file: Settings → `settings.json`, Key Bindings →
`keybindings.json`, **Themes → the currently-selected theme's file** (`themes\<name>.json`); changing the
selected theme reloads the Themes JSON buffer from that file (FR-022a). Toggling preserves the applied config
and reflects it in the newly shown mode (FR-022).

**Rationale**: Directly encodes FR-019–022a. The Themes tab is the only multi-file surface, so its JSON
buffer is keyed to the selection.

**Alternatives**: Per-tab independent toggles — rejected (FR-020 says global). A single combined JSON doc for
all config — rejected: the files are separate on disk and edited independently.

---

## D8 — `IFontEnumeration` seam: background enumeration + `%APPDATA%` cache + typeahead

**Decision**: A new core abstraction **`IFontEnumeration { listInstalledFamilies(): Promise<string[]> }`**
(`core/abstractions/font-enumeration.ts`) with a **contract suite** (`core/testing/font-enumeration-
contract.ts`) and a Windows impl **`WindowsFontEnumeration`** (`platform-windows`). At app start UI main
kicks off enumeration **in the background** (never awaited on the startup path — SC-010) and writes the
result to **`%APPDATA%\throng\fonts.json`** (`ui/src/main/font-cache.ts`). The renderer reads the cache via
`config.listFonts`; a **restart** refreshes it (FR-038a). The picker is a **typeahead** whose matcher is a
pure core helper — `font-typeahead.ts matchFamilies(query, families)`: split `query` on whitespace, keep a
family iff **every** token is a case-insensitive substring of the family name (order-independent) — e.g.
`ar es` matches "Ariales" and "Esarame". When the cache is absent/empty the picker falls back to a curated
common-family list and still accepts a typed name (unavailable families fall back at CSS render time).

**Rationale**: Encodes the D8 clarification exactly. Enumeration is OS-specific (Principle II) and can be
slow, so background + cache + restart-to-refresh keeps startup unblocked. `%APPDATA%\throng` is already
Electron `userData` (`main.ts` points userData there; recovery already lives under it), so the cache has a
natural home.

**Alternatives**: A fixed curated list — rejected by clarification (installed fonts wanted). Synchronous
enumeration on window open — rejected (jank/blocking risk). A live watcher for font installs — rejected
(YAGNI; restart-to-refresh is the chosen contract).

---

## D9 — Icon packs: folder + `pack.json` manifest, per-token overrides, 24px glyph|image

**Decision**: Extend the theme model (`core/config/theme.ts`) so a theme may reference an **icon pack**
(`iconPack?: string`) plus **per-token overrides** (`iconOverrides?: Record<string, IconValue>`), where
`IconValue = { glyph: string } | { image: string }`. An **icon pack** is a **folder** under
`%USERPROFILE%\.throng\icon-packs\<pack>\` containing a **`pack.json`** manifest mapping each token → a glyph
string **or** a relative image filename (SVG/PNG stored alongside), and packs may **mix** both (FR-040).
Discovery scans `icon-packs\` (UI-main `icon-pack-service.ts` via `IFileSystem`); a bundled
**`icon-packs\README`** documents the format + the full token list (FR-040a). Resolution
(`core/config/icon-pack.ts resolveIconValue`) is: per-token override → chosen pack's token → default `throng`
glyph fallback (FR-040). Icons render in a **24px** box (glyph as text, image via a `file://`/asset URL
supplied by main).

**Rationale**: Encodes the two icon-pack clarifications. Today `theme.icons` is only `Record<string,string>`
glyphs (`theme.ts` L113-139, with a comment anticipating icon sets) — the pack layer sits *over* that,
keeping the throng glyph defaults as the ultimate fallback.

**Alternatives**: Glyphs only — rejected (FR-039/040 require images). A single JSON file per pack with inline
data URIs — rejected (the folder + README is discoverable for user-authored packs; assets stay out of the
theme JSON).

---

## D10 — The 14 default themes: bundled data + installed source + restore

**Decision**: Ship the 14 themes (Light, Snake, Gothic, Windows Terminal, Bash, **SUBNET(placeholder)**,
VSCode, VI/VIM, English Garden, Matrix, Cyberpunk, Claude, Debian, Ubuntu) as **data in core**
(`core/config/default-themes/index.ts` → `DEFAULT_THEMES: Record<string, Theme>`), each styling the full
token set over `THRONG_THEME` (FR-046). On first run UI main seeds an **installed default-theme source**
under `%APPDATA%\throng\default-themes\<name>.json` and writes any missing themes into the user
`themes\` dir. **Restore default themes** (FR-037) re-creates missing/edited built-ins from that installed
source without touching user themes.

**Rationale**: FR-044/045/046/037. Keeping the themes as core data makes them testable (all 14 present,
distinct) and gives restore a deterministic source. Brand themes are **best-effort colour approximations**;
SUBNET is an explicit placeholder pending branding.

**Alternatives**: Generate themes at runtime — rejected (they're static content). Store only in the user dir
— rejected: deletion would make them unrecoverable (FR-045 needs an installed source).

---

## D11 — Key-binding capture: token build, modifier+key minimum, conflict, replace/reassign

**Decision**: Reuse `keybindings.ts eventToToken`/`normalizeToken` to build a chord token from the captured
key event. Add pure helpers (`core/config/chord-capture.ts`): `isBindableChord(token)` → **requires ≥1
modifier (Ctrl/Alt/Shift/Meta) + a non-modifier key** (FR-033a; bare keys and lone modifiers rejected);
`findConflict(bindings, token)` → the other `ActionId` already bound to that token, if any; `replace` sets
the action's chord(s) to `[token]` (FR-033), and **Reassign** removes the token from the conflicting action
first (FR-034). The capture modal shows the forming chord live on key-down and commits on key-up.

**Rationale**: The chord string format + `resolveAction` already exist (`keybindings.ts`); capture just adds
the validity/conflict/replace rules the clarifications pinned. Keeping them pure makes them unit-testable and
keeps the modal thin.

**Alternatives**: Accept any captured chord (incl. bare keys) — rejected by clarification (modifier+key
required for now). Silent duplicate/steal on conflict — rejected (FR-034 forbids both).

---

## D12 — Reset: current-editor defaults + reset-all on-entry snapshot

**Decision**: On preferences-window open, capture an **on-entry snapshot** in the prefs renderer/main —
the raw contents of `settings.json`, `keybindings.json`, and **every theme file that gets edited during the
session** (captured the first time each is touched), plus the on-entry active theme. **Reset current**
(FR-023) writes the metadata registry's defaults for the active tab's file (Settings/Key Bindings → the
document defaults; Themes → the **selected** theme, **enabled only for built-in themes**, reverting it to its
installed-default source; **disabled for user themes**). **Reset all** (FR-024) is a session **revert**:
re-write each snapshotted file to its on-entry content and re-activate the on-entry theme. Both require an
explicit confirmation (FR-025); a missing file is (re)created with defaults (edge case).

**Rationale**: Encodes the reset-all clarification (session-scoped revert across multi-file themes) and
FR-023's built-in-only rule. Pure snapshot/revert logic (`core/config/theme-reset.ts`) is unit-testable; the
write goes through `config.write`.

**Alternatives**: Reset-all reverts only the on-entry active theme — rejected by clarification (all files
touched this session). Reset-current enabled for user themes — rejected (FR-023: built-in only; user themes
use restore-defaults semantics, which don't apply).

---

## D13 — Immediate-apply, validity, and external-change reflection

**Decision**: Form controls apply on **valid-change or blur**; JSON/text edits settle via a **short debounce**
(consistent with the editor's existing auto-save debounce) before validity is evaluated (FR-016). Apply =
`config.write` → atomic file write → the existing watcher rebroadcasts `throng:config` → all windows
(including the prefs window) live-reload (FR-018). An **invalid** value/JSON is **not** written; the
invalidity is surfaced and the last valid document stays in effect (FR-017). Because the prefs window is also
a `throng:config` subscriber, an **external edit** to a config file while it is open reflects into the window
rather than being silently overwritten (FR-041); closing with invalid JSON persists nothing (edge case).

**Rationale**: Reuses the existing broadcast/reload loop (D1) for both apply and external-change reflection,
so there is one code path. Validity gating protects the file (FR-006/017).

**Alternatives**: An explicit Save button — rejected (FR-016 no-save). A separate "reload on external change"
mechanism — rejected: the window already receives `throng:config` pushes.

---

## Open items deferred to planning/implementation detail (not blocking)

- Exact colour-picker format (hex/rgba, alpha) and px-size/number ranges — carried by the theme-token
  **descriptors** (D5), decided when authoring `theme-metadata.ts`.
- Array-editor reorder affordance (drag vs up/down) — a `form-controls.tsx` detail.
- Whether the OS `setTitle` is retained for the taskbar label after identity moves into the bar — a small
  `main.ts` choice (retain for taskbar; on-window chrome comes from the bar).
- The Windows-11 Snap Layouts flyout on maximise-hover — best-effort (FR-002); implemented if the platform
  exposes it cheaply, else omitted.
