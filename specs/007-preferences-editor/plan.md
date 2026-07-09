# Implementation Plan: Preferences Editor — Title Bar, Settings, Key Bindings & Themes

**Branch**: `007-preferences-editor` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-preferences-editor/spec.md`

## Summary

Replace the OS window chrome with an **application-drawn full-width title bar** (window-identity + window
controls, plus a **cog** on the main window only) and ship a **single shared, always-on-top, movable
preferences window** with three tabs — **Settings**, **Key Bindings**, **Themes** — each offering a **visual
editor** and a **global UI⇄JSON toggle**, **immediate-apply** (no Save), **reset-to-default** and
**reset-all**, plus **14 new bundled default themes**. Everything edits the user's existing config files
(`%USERPROFILE%\.throng\{settings.json, keybindings.json, themes\<name>.json}`) and rides the **existing
config watcher** so an applied edit and the running app reacting to the file change are the *same path*.

**Headline decision — the whole feature is UI-main + renderer; the daemon and SQLite are untouched.** The
config layer already lives in `@throng/core` (pure: `app-settings.ts`, `keybindings.ts`, `theme.ts`) with a
UI-main `FileConfigStore` (atomic write) and a UI-main live `config-watcher`. Today the renderer can only
**read** config (`config.get` + `config.onChange`). This feature adds a **renderer→main config write path**
(a new `config.write` bridge), a **custom title-bar + window-controls** chrome (frameless windows), a
**second renderer entry** (the preferences window, launched like a sub-workspace window via a URL flag), and
one **new OS seam — `IFontEnumeration`** (Principle II, contract-tested) — for the font-family picker. No
daemon RPC, **no `ipc-contract` change, no SQLite migration** (config is file-based; `user_version` stays
6). This mirrors 004/006's "UI-main owns the OS seam, renderer stays sandboxed behind a preload bridge".

**Editor-metadata registry (FR-025a, the governance backbone).** The visual editors render from a **single
declarative metadata registry in `@throng/core`** — one descriptor per setting / keybinding action / theme
token (label, description, group, control type, allowed values, numeric/format constraints). The UI is a
**generic descriptor-driven form**; a **completeness test asserts every configurable key has a descriptor**,
which is exactly how FR-047/FR-048 ("editors expose every option, stay in sync") become enforceable.

**JSON mode reuses the 006 CodeMirror editor in a new standalone mode.** The 006 editor is currently
**tightly coupled to a `Panel` + the UI-main editor coordinator** (buffer registry, dirty lock, recovery,
cross-window mirror — all keyed by `panel.id`). This feature extracts a **buffer-only CodeMirror view**
(plain text, no project file, no coordinator) that the three JSON tabs each mount independently (FR-021 — no
shared buffer, independent of every other editor in the app).

Delivery is **strictly phased, each phase independently visible and E2E-verified before the next**
(Incremental Delivery rule; Principle V "every user-facing UI change ships passing E2E"). The phases are
lettered A–G by concern; the **dependency-topological build order** the tasks follow is
**A → B → D → E → F → C → G** (then the US8 sub-workspace-parity slice of A): **Phase C (UI⇄JSON) is built
after Phase E** because its Themes-tab JSON binds to the Phase E theme selector (FR-022a), and **Phase G
(reset)** follows the default-theme source seeded alongside Phase E. The letters below describe *what* each
phase delivers; `tasks.md` sequences them in that build order.

- **Phase A — Custom title bar + window chrome + preferences-window shell** (US1, US8). Frameless windows;
  the application-drawn title bar on **every** window (identity text + min/max/close), with the **cog on the
  main window only**; window-identity migrated off `win.setTitle` into the bar; the cog menu (Settings / Key
  Bindings / Themes); the **single shared** preferences window (a frameless, always-on-top, movable
  `BrowserWindow`) with three (initially empty) tabs, tab switching, app-modal non-interactivity of the
  main + sub-workspace windows (they can't be interacted with; the prefs window stays movable), and the
  reset-all **on-entry snapshot** scaffold. Sub-workspace bars carry identity + controls, **no cog**.
- **Phase B — Settings editor + immediate-apply pipeline + metadata registry** (US2). The declarative
  metadata registry (core) + the **generic descriptor-driven form**; the **renderer→main `config.write`**
  path; **immediate-apply** (valid-change / blur / close → write → watcher rebroadcast → live apply, no
  restart); invalid-value surfacing (not applied, last valid kept). Establishes the apply pipeline reused by
  every tab.
- **Phase C — Global UI⇄JSON toggle + standalone editor** (US5). Extract a **buffer-only CodeMirror**
  component from the 006 editor; the **global** mode toggle (all three tabs switch together), **always
  visible** at the window's minimum size; independent JSON buffers per tab; JSON validity → apply, invalid →
  surface + keep last valid.
- **Phase D — Key Bindings editor** (US3). Keybindings metadata + grouped list with current chords; the
  **capture modal** (live chord on key-down); the **modifier+key minimum-chord** rule (FR-033a);
  **replace** semantics on key-up (FR-033); the **conflict warn → Reassign / Cancel** flow (FR-034); reserved
  OS-combo handling.
- **Phase E — Themes editor: pickers, fonts, select=activate, rename/delete/restore + 14 default themes**
  (US4 core, US7). Theme-token metadata + colour / font-family / px-size / number / enum controls; the new
  **`IFontEnumeration`** seam (background enumeration at startup, `%APPDATA%\throng` cache, restart-to-
  refresh) + the **typeahead partial-match** helper (pure); the theme **selector = activate** (updates
  `appearance.theme`, live repaint); **rename** (reject name collision, FR-036a); **delete** (single
  confirm, FR-036); **restore default themes** (FR-037); the **14 bundled default themes** + installed
  default source (FR-044/045); the Themes-tab **JSON edits the selected theme's file** (FR-022a, on Phase C).
  *(Build-order note: Phase E is delivered in two task slices — the **US4 slice** lands the editor, pickers,
  fonts, select=activate, rename/delete and the seed/restore **mechanism** with only the `throng` theme
  present; the **US7 slice** lands the 14 default-theme **data** and its E2E gate, T069a. So "all 14 present &
  distinct" is verified in the US7 slice, not the US4 one — see tasks.md US4 checkpoint.)*
- **Phase F — Icon packs** (US4 icons). The pure **icon-pack model** (folder-per-pack + `pack.json`
  manifest, FR-040), discovery via `IFileSystem` under `%USERPROFILE%\.throng\icon-packs\`, the bundled
  `icon-packs\README` (FR-040a), the theme's **pack reference + per-token overrides** (FR-039), 24px
  render (glyph **or** image) with default-`throng`-glyph fallback.
- **Phase G — Reset** (US6). **Reset current editor** (Settings/Key Bindings → the file's defaults; Themes →
  the selected theme, **enabled only for built-in themes**, FR-023) and **reset all** (revert to the
  **on-entry snapshot** of every file touched this session, FR-024), each behind an explicit confirmation.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell; UI-main owns config I/O, window chrome, the preferences
window, and the new `IFontEnumeration` seam); React 18 + Vite; **CodeMirror 6** (`@codemirror/state`,
`@codemirror/view`, `@codemirror/commands` — **already a dependency** from 006; reused for JSON mode in a
new standalone buffer-only wrapper); InversifyJS + reflect-metadata (UI-main DI); Vitest (unit / contract /
integration); Playwright-Electron (E2E). **The daemon, `ipc-contract`, node-pty/xterm.js, and better-sqlite3
are untouched.**

**Storage**:
- **No schema change; SQLite stays at `user_version 6`.** This feature edits **file-based** user config,
  not the project DB.
- **User config (`%USERPROFILE%\.throng`, `THRONG_CONFIG_ROOT` override):** `settings.json`,
  `keybindings.json`, and `themes\<name>.json` — the existing `FileConfigStore` files. New:
  `icon-packs\<pack>\pack.json` (+ image assets + a bundled `README`).
- **App-data (`%APPDATA%\throng`, Electron `userData`):** a new **installed default-theme source**
  (`default-themes\<name>.json`, seeded on first run) so themes can be restored after deletion (FR-045);
  and the **installed-fonts cache** (`fonts.json`, written by the background enumerator, read at startup,
  refreshed only on restart — FR-038a).
- **Preferences-window state is in-memory** in its renderer + a UI-main slice: the **on-entry snapshot**
  (settings + keybindings + every theme file edited this session + the on-entry active theme) used by
  reset-all (FR-024); the current tab and the global UI/JSON mode.
- Applied edits are written through the **atomic `FileConfigStore.write`**; the **existing config watcher**
  re-reads and rebroadcasts `throng:config` to all windows — this *is* the immediate-apply mechanism.

**Testing**: Vitest unit (core: the metadata registry + **completeness test** that every settings key /
action / theme token has a descriptor; per-descriptor control-type resolution; chord capture — token build,
`modifier+key` minimum, reserved-combo denylist (`isReservedChord`, FR-032a), conflict detection, replace;
theme-name collision; reset-current/reset-all snapshot
logic; font typeahead partial-match tokenising; icon-pack manifest parse + token resolution + 24px
glyph/image/fallback; select=activate → `appearance.theme` mutation). Vitest contract (**`IFontEnumeration`**
suite vs the Windows impl — returns installed families, tolerates absence). Vitest integration (UI-main
`config.write` round-trips each file atomically and the watcher rebroadcasts; reset-all reverts multi-file
theme edits; font cache write/read under a temp `%APPDATA%`; restore-default-themes re-creates from the
installed source). Playwright-Electron **E2E per phase** (A: title bar renders full-width above the panes
bar, min/max/close + drag/double-click, cog menu three items, prefs window opens on the right tab, main +
sub windows non-interactive while movable, sub-workspace bar has **no cog**; B: each control type edits +
applies live + persists, invalid not applied; C: global toggle flips all three tabs + stays visible at min
size + JSON applies/rejects; D: capture rebind, min-chord rejected, conflict → Reassign/Cancel; E: colour/
font/size/enum apply live, font typeahead narrows, select=activate repaints, rename-collision rejected,
delete confirm, restore defaults, all 14 themes present & distinct, Themes-JSON edits the selected file; F:
pick pack, override a token, custom pack at 24px, missing token falls back; G: reset-current defaults,
reset-all reverts the session incl. multi-theme edits, cancel is a no-op). **Every user-facing UI change
ships passing E2E**; each phase lands green before the next. RGR mandatory; generated temp files self-clean.

**Target Platform**: Windows 11 desktop (first supported). The window-controls chrome and the new
`IFontEnumeration` seam sit behind platform abstractions so macOS/Linux conventions can be added later
without reworking the core.

**Project Type**: Desktop application (Electron UI client + headless plain-Node daemon), npm-workspaces
monorepo (extends 001–006). **This feature touches `core`, `platform-windows`, and `ui` only; the daemon,
`ipc-contract`, and `persistence` are not modified** (a test asserts `user_version` stays 6).

**Performance Goals**: Opening the preferences window and applying an edit are effectively instant (SC-001,
no restart). **Font enumeration never blocks startup (SC-010)** — it runs in the background in UI main and
writes the `%APPDATA%\throng\fonts.json` cache; the picker is fully usable (cached list or curated fallback)
whether or not enumeration has finished. Immediate-apply settles JSON/text edits via a short debounce
(consistent with the editor's existing auto-save debounce) before validity is evaluated; form controls apply
on valid-change / blur.

**Constraints**: No Docker; npm scripts only. `@throng/core` keeps **zero OS/DOM imports** (guarded) — the
metadata registry, chord logic, theme-name rules, reset snapshot logic, font typeahead matching, icon-pack
model, and the `IFontEnumeration` **abstraction** are all pure; the font **implementation** and all file
I/O live behind seams in UI main / `platform-windows`. The renderer is **sandboxed** (no `fs`) — the
preferences window reads/writes config only through the preload `config.*` bridge → UI main. **One IoC
composition root per process** (daemon, UI main, UI renderer = 3, unchanged in count) — `IFontEnumeration`
bound in the **UI main** root. Editing is **confined to the per-user config directory** (FR-042):
`config.write` refuses any doc id outside the `FileConfigStore` roots. Configuration injected via typed
settings (Principle X).

**Scale/Scope**: Single user, single machine, local-only. One preferences window per app instance
(re-invoking the cog focuses it, FR-010). A handful to dozens of settings / actions / theme tokens rendered
from descriptors; up to ~15 themes; a few icon packs; hundreds of installed fonts in the typeahead.
Packages touched: `core` (metadata registry + completeness test; chord-capture logic; theme-name rules;
reset-snapshot logic; `IFontEnumeration` abstraction + contract suite; font typeahead helper; icon-pack
model; theme model extension for pack ref + overrides; the 14 default themes as data), `platform-windows`
(new `WindowsFontEnumeration`), `ui` (main: `config.write` ipc + confinement, window-controls ipc, the
preferences `BrowserWindow` + app-modal enforcement, font-enumeration wiring + cache, default-theme seeding
+ restore, icon-pack discovery; renderer: the title-bar chrome, the preferences app + three tabs + generic
form + capture modal + pickers + JSON toggle + reset, sub-workspace title bar). **No** daemon change, **no**
`ipc-contract` change, **no** SQLite migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.10.1** (Principle V: **every user-facing UI
change MUST ship passing E2E** — honoured per phase; v3.10.0 **Documentation-currency** merge gate —
README/ROADMAP/CONTRIBUTING reconciled at close, the ROADMAP "out-of-the-box themes" + preferences editor
items advanced to delivered).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS (N/A-ish) | Configuration is **user-scoped**, not project-scoped; the feature does not touch project/terminal isolation. Editing is **confined to the per-user config directory** (FR-042) — `config.write` refuses any path outside the `FileConfigStore` roots. |
| II | Platform-Abstracted Core | ✅ PASS | One new OS seam — **`IFontEnumeration`** (`listInstalledFamilies()`), **contract-tested**, Windows impl `WindowsFontEnumeration`. Window min/max/close is expressed as a small UI-main window-controls surface (Electron `BrowserWindow` calls in main only). All decision logic (metadata registry, chords, theme rules, reset, typeahead, icon packs) is **pure** in core. Core stays OS/DOM-free (guard test). |
| III | Detached/Persistent Terminals | ✅ PASS (N/A) | The daemon/terminal layer is not touched. |
| IV | Native Terminal Support & Auto-Detection | ✅ PASS (N/A) | No shells involved. |
| V | Test-First Quality Discipline | ✅ PASS | Unit + contract (`IFontEnumeration`) + integration (`config.write`/watcher, reset-all, font cache, restore-defaults) + **E2E for every UI change, observed green per phase** (A–G). The FR-047/048 **completeness test** is a first-class unit test. RGR per task; temp files self-clean (v3.9.0). |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | A discoverable cog → preferences window; visual editors with labels + descriptions per setting; live preview (select=activate); standard window controls + drag/double-click; a JSON escape hatch; themed via tokens; the active project/sub-workspace colour still dominant in the new bar. |
| VII | Change Review & Approval | ✅ PASS (N/A) | Config editing is not the project edit-list; unaffected. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | **Reuse** the pure config models + `FileConfigStore` + the live watcher (immediate-apply is literally the existing reload path); **reuse** CodeMirror (extract a buffer-only view — DRY) for JSON mode; **one generic descriptor-driven form** instead of per-setting components (DRY, open/closed — new config = new descriptor, not new UI). **YAGNI**: no daemon/`ipc-contract`/SQLite surface; no per-project overrides; brand themes are approximations, SUBNET a placeholder. Pure logic segregated in core (SRP). |
| IX | DI & Composition Root | ✅ PASS | Still three roots. `IFontEnumeration` (+ the font-cache path and default-theme-source path) are **constructor-injected** in the **UI main** root (`composition-root.ts` / `tokens.ts`); the preferences renderer reaches config only via the preload bridge. No new process, no shared container. The preferences window is a second **renderer instance** of the existing UI-renderer boundary (same bundle, its own React service graph), not a new boundary. |
| X | Externalised Configuration | ✅ PASS | The feature **is** the externalised-config surface. New injected settings/paths: the font-cache location, the installed default-theme source, the icon-packs directory, and the immediate-apply debounce — all injected, nothing hardcoded in logic. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | The new title bar sits **above** the Panes bar and does not alter the Pane/Tab/Panel docking model; sub-workspace windows keep their focus/raise-group + independent-minimise behaviour, now under the custom bar (identity + controls, no cog). |

**Architecture constraints**: daemon single SQLite writer **unchanged** ✅ (no migration, no daemon code —
config is file-based); per-user local storage ✅ (config under `%USERPROFILE%\.throng`; font cache +
default-theme source + recovery under `%APPDATA%\throng`); renderer sandbox preserved (config write via
`config.write` bridge → UI main; no `fs` in renderer) ✅; single instance unaffected ✅; the preferences
window is one shared instance (FR-010) ✅; Electron+TS baseline, **reuse-not-fork** (reuse CodeMirror &
config layer) ✅; agents remain a future layer ✅.

**Gate result: PASS — no violations.** Deliberate, compliant decisions recorded under
[Complexity Tracking](#complexity-tracking): the custom-chrome frameless windows, the second (preferences)
renderer entry, the renderer→main `config.write` path, the new UI-main `IFontEnumeration` seam, and the
generic descriptor-driven form.

**Governance follow-up (FR-048):** the requirement that the configuration editors stay in sync with all
configurable options MUST be recorded in the constitution as an ongoing rule. This is a **separate
`/speckit-constitution` amendment** (a governance MINOR bump), tracked as a Phase-B task; the plan encodes
the *mechanism* (FR-025a registry + completeness test) so the rule is enforceable the moment it is ratified.

## Phased Delivery

Each phase is an independently shippable, **independently E2E-verified** increment (Incremental Delivery
rule). The user reviews the running result of each phase before the next starts.

| Phase | Delivers (verify point) | Touches | New deps/seams | E2E gate |
|------|--------------------------|---------|----------------|----------|
| **A — Title bar + chrome + prefs shell** | frameless windows; custom title bar on all windows (identity + min/max/close); cog (main only) → menu (Settings/Key Bindings/Themes); single shared prefs `BrowserWindow` (frameless, always-on-top, movable) with 3 empty tabs + switching; app-modal non-interactivity of main + sub windows; on-entry snapshot scaffold; window-identity moved off `win.setTitle`. | `ui` main (`createMainWindow`/`createSubWorkspaceWindow` → `frame:false`; window-controls ipc; prefs window create + app-modal; cog→open ipc), renderer (`title-bar/*`, cog menu, `preferences/*` shell, sub-workspace bar) | — (window-controls ipc) | Bar spans full width above panes bar, matches height, no OS bar; min/max(restore)/close work; drag moves, double-click maximises; cog shows exactly 3 items; each opens prefs on the matching tab; reopening focuses the one window; main+sub non-interactive yet prefs movable; **sub-workspace bar shows identity + controls, no cog**. |
| **B — Settings editor + apply pipeline** | declarative **metadata registry** (core) + **completeness test**; **generic descriptor-driven form** (grouped, per-type controls); renderer→main **`config.write`** + confinement; **immediate-apply** (valid-change/blur/close → write → watcher → live); invalid not applied. | `core/config` (metadata registry + test), `ui` main (`config.write` ipc + confinement), renderer (`preferences/settings-tab`, generic form controls, config write client) | — (`config.write` ipc) | Each control type (number/dropdown/text/toggle/multi-select/array) edits → writes file → app reflects live, survives restart; enum shows only allowed values; invalid entry not applied, last valid kept, invalidity surfaced. |
| **C — Global UI⇄JSON toggle + standalone editor** *(built after E — depends on the E theme selector for FR-022a)* | buffer-only **CodeMirror** view (extracted from 006); **global** toggle (all tabs), **always visible at min size**; independent JSON buffers; JSON valid → apply, invalid → surface + keep last valid; a malformed file opens as raw text for repair (FR-043 JSON side). | `ui` renderer (`editor/standalone-editor.tsx` extracted; `preferences/json-tab`, mode toggle), (006 `use-editor` refactor to share the mount) | — | Toggle flips all 3 tabs together; visible/usable at minimum window size; editing valid JSON applies + persists; invalid JSON not applied + surfaced; each tab's JSON independent of the others and of app editors; malformed file shows raw text. |
| **D — Key Bindings editor** | keybindings **metadata** + grouped list w/ current chords; **capture modal** (live chord key-down); **modifier+key** minimum (FR-033a); **replace** on key-up (FR-033); **conflict → Reassign/Cancel** (FR-034); reserved-combo handling. | `core/config` (keybindings metadata + capture/conflict logic), renderer (`preferences/keybindings-tab`, capture modal) | — | Double-click → capture; chord builds live; bare key/lone modifier rejected; key-up replaces + saves + applies; conflict warns → Reassign removes from other action / Cancel no-ops; reserved combo surfaced not saved. |
| **E — Themes editor + fonts + defaults** | theme-token metadata + colour/font/px-size/number/enum controls; **`IFontEnumeration`** seam + bg enumeration + `%APPDATA%` cache + **typeahead partial match**; **select=activate**; **rename** (reject collision); **delete** (single confirm); **restore defaults**; **14 bundled default themes** + installed source; Themes-JSON edits the selected theme file. | `core` (theme metadata; font typeahead; `IFontEnumeration` abstraction + contract; 14 themes as data; select=activate rule), `platform-windows` (`WindowsFontEnumeration`), `ui` main (font enum + cache, default-theme seed + restore ipc, theme rename/delete ipc), renderer (`preferences/themes-tab`, pickers, font typeahead, selector) | **`IFontEnumeration`** | Colour/font/size/enum apply live + persist; font typeahead narrows by multi-token substring; startup not blocked by enumeration; select=activate repaints app + updates `appearance.theme`; rename-to-existing rejected; delete → single confirm; restore re-creates missing defaults; all 14 themes present, distinct, survive delete→restore; Themes-JSON edits the selected theme's file. |
| **F — Icon packs** | pure **icon-pack model** (folder + `pack.json`, FR-040); discovery under `icon-packs\`; bundled `icon-packs\README` (FR-040a); theme **pack ref + per-token overrides** (FR-039); 24px render (glyph or image) + default-`throng` fallback. | `core/config` (icon-pack model + theme icon-resolution extension), `ui` main (icon-pack discovery via `IFileSystem`; README seed), renderer (icon section UI; 24px glyph/image renderer) | — | Selecting a pack re-skins all tokens; overriding one token changes only it; a user pack dropped under `icon-packs\` becomes selectable + renders at 24px; a token missing from the pack falls back to the `throng` glyph. |
| **G — Reset** | **reset current** (Settings/KB → file defaults; Themes → selected theme, **built-in only**, FR-023); **reset all** → on-entry snapshot revert of every file touched this session (FR-024); explicit confirmations. | `core/config` (reset/snapshot logic), renderer (reset controls + confirm), `ui` main (write reverts) | — | Reset-current restores defaults (disabled for user themes); reset-all reverts settings + keybindings + every theme edited this session + re-activates on-entry theme; cancel changes nothing. |

## Project Structure

### Documentation (this feature)

```text
specs/007-preferences-editor/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D13 (chrome, prefs window, write path, registry, JSON reuse, fonts, icon packs, defaults, reset)
├── data-model.md        # Phase 1 — metadata registry, config-write, chord/capture, theme+icon-pack model, font cache, snapshot (no SQL)
├── quickstart.md        # Phase 1 — phased validation/run guide (A → G)
├── contracts/           # Phase 1
│   ├── metadata-registry.md   # core editor-metadata registry (descriptors; completeness test; control-type resolution)
│   ├── config-bridge.md       # preload config.* additions (write/list-themes/restore-defaults/list-icon-packs) — NO daemon RPC
│   ├── window-controls.md     # preload window.* (minimize/maximize/close/isMaximized/onMaximizeChange) + cog→openPreferences
│   ├── font-enumeration.md     # IFontEnumeration seam contract (installed families; absence-tolerant; cache shape)
│   ├── theme-and-icon-packs.md # theme model extension (iconPack + iconOverrides) + icon-pack manifest + 24px resolution
│   └── keybinding-capture.md   # chord capture: token build, modifier+key minimum, conflict + replace/reassign
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`. Phase tags
`[A]…[G]` show when each lands.

```text
packages/
├── core/
│   ├── src/
│   │   ├── abstractions/
│   │   │   └── font-enumeration.ts       # (new)[E] IFontEnumeration — listInstalledFamilies(): Promise<string[]>
│   │   ├── config/
│   │   │   ├── app-settings.ts           # (ext)[B] descriptors reference existing sections; no schema change needed
│   │   │   ├── keybindings.ts            # (ext)[D] reuse eventToToken/normalizeToken; add capture/conflict pure helpers
│   │   │   ├── theme.ts                  # (ext)[E/F] add iconPack?: string + iconOverrides?: Record<string,IconValue>; icon resolution (glyph|image); keep unsavedDot etc.
│   │   │   ├── settings-metadata.ts      # (new)[B] descriptor per AppSettings leaf (label/description/group/control/allowed/constraints)
│   │   │   ├── keybindings-metadata.ts   # (new)[D] descriptor per ActionId (label/description/group; control:'chord')
│   │   │   ├── theme-metadata.ts         # (new)[E] descriptor per theme token (colour/font/size/enum/icon groups)
│   │   │   ├── metadata.ts               # (new)[B] shared descriptor types + control-type kinds + completeness helpers
│   │   │   ├── chord-capture.ts          # (new)[D] captureChord(event)→token; isBindableChord (modifier+key); isReservedChord (OS-combo denylist, FR-032a); findConflict; replaceBinding/reassign
│   │   │   ├── font-typeahead.ts         # (new)[E] matchFamilies(query, families): every whitespace token is a case-insensitive substring
│   │   │   ├── settings-search.ts       # (new)[I1] searchTokens/fieldHaystack/matchesQuery/filterFields — ANY token matches key|label|description|value
│   │   │   ├── icon-pack.ts              # (new)[F] IconPackManifest, parseIconPack, resolveIconValue(theme, packs, token) → glyph|image|throng-fallback
│   │   │   ├── theme-reset.ts            # (new)[G] reset-current (built-in only) + reset-all snapshot revert logic (pure)
│   │   │   └── default-themes/           # (new)[E] the 14 bundled default theme docs as data (Light, Snake, Gothic, Windows Terminal, Bash, SUBNET(placeholder), VSCode, VI/VIM, English Garden, Matrix, Cyberpunk, Claude, Debian, Ubuntu)
│   │   │       └── index.ts              #   DEFAULT_THEMES: Record<string, Theme>
│   │   └── testing/
│   │       └── font-enumeration-contract.ts # (new)[E] reusable IFontEnumeration contract suite
│   └── tests/unit/                        # (ext) metadata completeness (every key/action/token has a descriptor); control-type resolution; chord capture/min/conflict; font typeahead; icon-pack parse/resolve; theme-name collision; reset snapshot; select=activate
│
├── platform-windows/
│   ├── src/
│   │   ├── windows-font-enumeration.ts   # (new)[E] IFontEnumeration via OS font list; absence-tolerant
│   │   └── index.ts                      # (ext)[E] export WindowsFontEnumeration
│   └── tests/contract/                    # (ext)[E] run font-enumeration contract suite vs WindowsFontEnumeration
│
└── ui/
    ├── src/
    │   ├── main/
    │   │   ├── main.ts                   # (ext)[A/E] createMainWindow/createSubWorkspaceWindow → frame:false; register window-controls + cog + config.write ipc; kick off bg font enumeration; seed default-theme source + icon-packs README on first run
    │   │   ├── preferences-window.ts     # (new)[A] create/focus the single shared frameless always-on-top movable prefs BrowserWindow; app-modal enable/disable of other windows; capture on-entry snapshot
    │   │   ├── window-controls-ipc.ts    # (new)[A] ipcMain: throng:window:minimize/maximize/close/isMaximized (targets sender window)
    │   │   ├── config-write-ipc.ts       # (new)[B] ipcMain: throng:config:write({kind,name?}, json) → FileConfigStore.write (confined); list/restore themes; list icon packs
    │   │   ├── config-store.ts           # (ext)[B/E] reuse pathOf/write; add listThemes()/deleteTheme()/renameTheme()/restoreDefaultThemes(source)
    │   │   ├── font-cache.ts             # (new)[E] write/read %APPDATA%\throng\fonts.json; background populate via IFontEnumeration (non-blocking)
    │   │   ├── icon-pack-service.ts      # (new)[F] discover icon-packs\ dirs, parse manifests, resolve image asset paths for the renderer
    │   │   ├── composition-root.ts       # (ext)[E] bind IFontEnumeration (WindowsFontEnumeration) + font-cache/default-theme-source/icon-packs paths
    │   │   ├── tokens.ts                  # (ext)[E] FontEnumeration + path tokens
    │   │   └── config-watcher.ts         # (ext)[E] watch themes\ dir set (already recursive) — prefs window reflects external change (FR-041)
    │   ├── preload/preload.cts           # (ext)[A/B/E/F] add window.*, config.write/listThemes/renameTheme/deleteTheme/restoreDefaultThemes/listFonts/listIconPacks, openPreferences
    │   └── renderer/
    │       ├── title-bar/                 # (new)[A] the custom chrome
    │       │   ├── title-bar.tsx         #   full-width bar: identity (left) + extensible action area + window controls (right); drag region; double-click maximise
    │       │   ├── window-controls.tsx   #   min / max-restore / close (glyph tokens); onMaximizeChange
    │       │   ├── cog-menu.tsx          #   cog (main window only) → Settings/Key Bindings/Themes → openPreferences(tab)
    │       │   └── title-bar.css         #   var(--throng-*) theming; height matches panes bar
    │       ├── preferences/               # (new) the preferences window app
    │       │   ├── preferences-app.tsx   #   entry for ?prefs route; tab header (Settings/KB/Themes) + global mode toggle + reset controls; on-entry snapshot [A/C/G]
    │       │   ├── settings-tab.tsx      #   descriptor-driven form (grouped sections) [B]
    │       │   ├── form-controls.tsx     #   number/dropdown/text/toggle/multi-select/array editors by control type [B]
    │       │   ├── keybindings-tab.tsx   #   grouped bindings + capture modal orchestration [D]
    │       │   ├── capture-modal.tsx     #   live chord capture; min-chord; conflict → Reassign/Cancel [D]
    │       │   ├── themes-tab.tsx        #   selector(=activate)/rename/delete/restore + grouped token controls [E]
    │       │   ├── pickers.tsx           #   colour picker; font-family typeahead; px-size; number; enum [E]
    │       │   ├── icon-section.tsx      #   pack selector + per-token overrides; 24px glyph/image render [F]
    │       │   ├── json-tab.tsx          #   standalone CodeMirror per tab; Themes-JSON = selected theme file [C/E]
    │       │   ├── apply-client.ts       #   valid-change/blur/close → config.write; debounce; invalid surfacing [B]
    │       │   └── preferences.css       #   theming
    │       ├── editor/
    │       │   ├── standalone-editor.tsx # (new)[C] buffer-only CodeMirror (plain text; no Panel/coordinator) reused by json-tab
    │       │   └── use-editor.ts         # (ext)[C] extract the CM mount into a shared helper used by standalone + panel editors (DRY)
    │       ├── app.tsx                    # (ext)[A] render <TitleBar/> above the panes; drop the OS-title TitleManager (identity now in-bar)
    │       ├── subworkspace-app.tsx      # (ext)[A] render <TitleBar/> (identity, NO cog) above the sub-workspace layout
    │       ├── main.tsx                   # (ext)[A] route ?prefs → <PreferencesApp/>
    │       └── config/config-store.tsx   # (ext)[B/E] expose a write helper + theme list/active-theme for the prefs app
    ├── tests/unit/                        # (ext) form controls, capture modal, typeahead UI, icon render, reset UI
    ├── tests/integration/                 # (ext)[B/E] config.write round-trip + watcher rebroadcast; reset-all multi-theme; font cache; restore defaults
    └── tests/e2e/                         # (ext) titlebar-chrome.e2e.ts [A], preferences-settings.e2e.ts [B], preferences-json.e2e.ts [C],
                                           #       preferences-keybindings.e2e.ts [D], preferences-themes.e2e.ts [E], default-themes.e2e.ts [E-data/US7],
                                           #       icon-packs.e2e.ts [F], preferences-reset.e2e.ts [G], subworkspace-titlebar.e2e.ts [A]
```

**Structure Decision**: Extend the 001–006 monorepo. **All decision logic is pure in `@throng/core`** — the
declarative **editor-metadata registry** (the FR-047/048 backbone), chord capture/conflict rules, the theme
model extension (icon pack ref + overrides) and icon-pack manifest model, the font typeahead matcher, the
reset/snapshot logic, the 14 default themes as data, and the **`IFontEnumeration` abstraction + contract
suite**. **File I/O, window chrome, the preferences window, and font enumeration are UI-main-owned OS
seams** — reusing the existing `FileConfigStore` + config watcher (immediate-apply *is* the existing reload
path) and adding a renderer→main **`config.write`** bridge, a **window-controls** surface, and the
`WindowsFontEnumeration` impl. The **renderer stays sandboxed**; the **preferences window is a second
renderer instance** of the same UI bundle (launched by a URL flag like sub-workspace windows), reusing
CodeMirror in a new **standalone buffer-only** mode for JSON. **No daemon, `ipc-contract`, or SQLite
surface** is added; `user_version` stays 6.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for reviewer
> scrutiny (Dev Workflow gate). This feature **advances** the ROADMAP "out-of-the-box themes" item
> (delivered: 14 default themes + a full theme editor) and delivers the preferences/settings editor.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **Whole feature is UI-main + renderer; daemon/SQLite untouched** | Config already lives in `@throng/core` + a UI-main `FileConfigStore` + live watcher; immediate-apply is literally the existing reload path. Editing config needs no daemon RPC or DB table. | **A daemon-owned config service / settings table** — rejected (YAGNI): duplicates the file-based config layer and its watcher for zero benefit; would add an `ipc-contract` surface and a migration. |
| **Custom title bar on frameless windows (replaces OS chrome)** | FR-001/002/003: application-drawn full-width bar hosting identity + min/max/close, no OS title bar; extensible action area for the cog (and future actions). | **Keep the OS title bar + a separate app toolbar** — rejected: the spec requires *replacing* the OS chrome and moving window identity into the app bar; two bars is exactly what FR-002 forbids. |
| **Second renderer entry for the preferences window** (URL-flag launched, like sub-workspaces) | FR-010/013/014: a single shared, always-on-top, **movable** window that renders the same React/theme stack; a separate `BrowserWindow` is the natural always-on-top + app-modal + movable unit. | **An in-app modal overlay inside the main window** — rejected: cannot float above *sub-workspace* windows, and "movable to reveal the windows beneath" implies a real OS window; the existing `?sw=` pattern makes a second entry cheap. |
| **Renderer→main `config.write` bridge + confinement** | The renderer is sandboxed (read-only config today); immediate-apply needs a write path. Confining writes to the `FileConfigStore` roots enforces FR-042. | **Let the renderer write files directly** — rejected: breaks the sandbox (no `fs` in renderer) and the OS-seam boundary. |
| **Generic descriptor-driven form from a core metadata registry** (FR-025a) | One authoritative source of field metadata makes FR-047/048 ("expose every option, stay in sync") **testable** via a completeness assertion; the UI becomes open/closed (new config = new descriptor). | **Per-setting hand-authored components** — rejected (DRY/governance): no single source of truth, and "every option exposed" can't be enforced by a test. |
| **New UI-main OS seam `IFontEnumeration` + `WindowsFontEnumeration`, background + cached** (FR-038a) | The font-family picker must list installed OS fonts; enumeration is OS-specific (Principle II) and can be slow, so it runs in the background and is cached under `%APPDATA%\throng` (restart to refresh) to never block startup (SC-010). | **A fixed curated font list** — rejected by clarification (user wants installed fonts). **Enumerate synchronously on open** — rejected: risks blocking/jank; a cache + background populate is the clarified design. |
| **Icons extended from glyph-strings to icon packs (folder + manifest) with per-token overrides** (FR-039/040) | The theme editor must let users assign an icon **pack** (glyph **or** image per token, 24px) and override tokens, incl. user-supplied packs — today `theme.icons` is only glyph strings. | **Keep glyphs only** — rejected: FR-039/040 require image tokens + packs. **Inline image data in the theme file** — rejected: a folder-per-pack + `README` is discoverable and keeps assets out of the theme JSON. |
| **No SQLite migration; config stays file-based; `user_version` 6** | The edited documents are the existing `FileConfigStore` files; the installed default-theme source + font cache are app-data files. | **A settings/themes DB** — rejected (YAGNI): the file-based config layer + watcher already satisfies persistence + hot reload. |

> **ROADMAP ledger:** "out-of-the-box themes" and the preferences/settings editor advance to **delivered**
> (14 default themes + full Settings/Key Bindings/Themes editors with JSON mode and reset). Brand-derived
> themes are best-effort approximations; **SUBNET remains a tracked placeholder** pending branding. No new
> deferrals introduced beyond the FR-048 constitution amendment (scheduled in Phase B).

---

## Delta Plan — 2026-07-08 Refinements

Phases A–G above are **delivered and merged-ready**. This delta covers the post-delivery refinements
captured in the **2026-07-08 Clarifications** session (spec.md). Several **reverse** earlier decisions, so
the delta MODIFIES shipped code (with its tests) rather than adding greenfield modules. It touches
`core`, `platform-windows` (none), and `ui` only — **no daemon / `ipc-contract` / SQLite change**
(`user_version` stays 6). Everything continues to ride the existing `config.write` → watcher → live-apply
pipeline; no new OS seam is introduced.

**Constitution re-check (v3.11.0):** ✅ PASS, no new violations.
- **II Platform-Abstracted Core** — no new OS seam; the secondary icon pack ships **static SVG assets**
  (not an OS call). Chord rules, font-stack parse/serialise, button tokens stay **pure in core**.
- **V Test-First** — each slice is RGR with unit changes + **updated E2E** (the existing keybindings/themes
  E2E already assert the old replace/modifier-minimum behaviour and MUST be updated to the new rules).
- **X Externalised Config / FR-047 + v3.11.0 governance** — the new **button** theme tokens
  (`buttonBg/buttonText/buttonHoverBg/buttonHoverText` + a `button` typography role) and the **per-role
  font-family** tokens are configurable → they MUST have metadata descriptors and be covered by the
  completeness test. Because `THEME_METADATA` is **derived from `tokensOf(THRONG_THEME)`**, adding the
  button tokens/role to `THRONG_THEME` auto-covers them; the completeness test enforces it.
- **VIII SOLID/DRY, IX DI** — reuse existing modules; the prefs-window parenting reuses the existing
  create-or-focus path; the font-stack helper is a single pure module consumed by the pill control.

### Delta slices (each independently E2E-verified, per Incremental Delivery)

| Slice | Delivers | Touches | E2E gate |
|------|----------|---------|----------|
| **H1 — Window layering (FR-013/013a)** | Prefs window floats **above throng's own windows only** (Electron `parent: mainWindow`, drop global `alwaysOnTop`), **minimises/restores with the main window**, and on **close** the main window is refocused to the foreground. App-modal (others `setEnabled(false)`) unchanged. | `ui/main/preferences-window.ts` (parent + focus-main-on-close), `ui/main/main.ts` (pass the main `BrowserWindow` into `openPreferences` deps) | prefs not above other OS apps; minimises with main; main refocused on close; still app-modal + movable |
| **H2 — Key bindings: add / single-key / remove (FR-030/031/033/033a/033b)** | Capture **adds** a chord (multiple per action; identical = no-op) instead of replacing; **any single key** bindable **except** Esc/Space/Shift/Ctrl/Enter/CapsLock/Tab/NumLock, lone modifiers, and the FR-032a reserved combos; each chord a **deletable pill (×)** + **context-menu Remove**; row double-click no text-select. | `core/config/chord-capture.ts` (`EXCLUDED_KEYS`, rewrite `isBindableChord`, add `applyAdd`/`applyRemove`; keep `applyReassign`), `ui/renderer/preferences/capture-modal.tsx` (add semantics), `keybindings-tab.tsx` (pills + context menu + `user-select:none`) | double-click no highlight; single key `F2` binds; `Space` rejected; second chord ADDS (both shown); pill × removes one; conflict → Reassign |
| **H3 — Reset controls + cog (FR-005/023/024)** | Reset controls become **icon buttons** with title-hover tooltips labelled **"Reset to Defaults"** / **"Revert All"**; the title-bar cog uses a **standard, uniform** gear glyph. | `ui/renderer/preferences/preferences-app.tsx` (icon reset controls + titles), `title-bar/cog-menu.tsx` (uniform cog), `preferences.css` / `title-bar.css` | reset controls show as icons with `title`; behaviour unchanged (defaults / session-revert) |
| **H4 — Font pill editor + per-role font (FR-038/038b)** | The font control is a **multi-select pill editor**: click → short default-list dropdown; typeahead filter; each choice a **deletable pill appended at end**; pills serialise to the **comma-separated CSS stack** saved to the theme and parse back on load. **Every typography role** exposes the font control. | `core/config/font-stack.ts` **(new, pure)** `parseFontStack`/`serializeFontStack`; `core/config/theme-metadata.ts` (emit a `font-family` descriptor for **every** typography role, not only those pinning a family); `ui/renderer/preferences/pickers.tsx` (pill control) | pick two families → two pills → comma-stack saved; delete a pill; existing stack loads as pills; every typography section has the control |
| **H5 — Button style tokens (FR-046a)** | New theme tokens `colours.buttonBg/buttonText/buttonHoverBg/buttonHoverText` + a **`button` typography role**; emitted as `--throng-*` vars; the app's buttons consume them; **all 14 default themes** populate them; metadata auto-covers (completeness test). | `core/config/theme.ts` (`THRONG_THEME` + `toCssVariables`), `core/config/default-themes/index.ts` (`makeTheme` populates button tokens), app button CSS (`theme.css` + component CSS), completeness tests | button colour + font tokens appear in the Themes editor and apply live; every default theme styles them; completeness test passes |
| **H6 — Two bundled icon packs (FR-040b)** | Seed **two bundled packs** under `icon-packs/` on first run: a **`throng` glyph pack** (from `THRONG_THEME.icons`) selected by default, and a **secondary SVG image pack** (author ~22 SVG assets for the icon tokens). Both discoverable + selectable via the existing pack picker. | `ui/main/icon-pack-service.ts` / `main.ts` (seed both packs on first run, like the README/default-themes), new bundled SVG assets, default `iconPack` set to `throng` | fresh install lists ≥2 packs incl. `throng` (glyphs) + the SVG pack; selecting the SVG pack renders its images at 24px |

### Design-artifact deltas

- **data-model.md** — Theme gains `colours.button*` + `typography.button`; `chord-capture` gains
  `EXCLUDED_KEYS`, `applyAdd`, `applyRemove` (replace `applyReplace`'s modal role, keep for JSON parity);
  new `font-stack.ts` (`parseFontStack`/`serializeFontStack`); two bundled icon packs listed.
- **contracts/keybinding-capture.md** — capture is **additive**; `isBindableChord` → excluded-key rule;
  add `applyAdd`/`applyRemove`.
- **contracts/theme-and-icon-packs.md** — button tokens + `button` role; font-family value is a CSS stack
  edited via pills; the two bundled packs.
- **quickstart.md** — add a Delta section (H1–H6 validation steps).

### Complexity notes (delta)

| Decision | Why | Alternative rejected |
|----------|-----|----------------------|
| Prefs window `parent: mainWindow` (drop global `alwaysOnTop`) | FR-013/013a: float above throng only + minimise-with-main + refocus-on-close are exactly Electron's parent/child window semantics. | Manual z-order tracking — rejected: reimplements what `parent` gives for free and is race-prone. |
| Additive bindings + single-key (reverses FR-033/033a) | Direct user requirement; multi-chord already the on-disk shape (`string[]`). | Keep replace/JSON-only multi — rejected: the user wants UI-managed multiple bindings. |
| Secondary icon pack ships **SVG assets** | FR-040b wants a visually distinct image pack; SVGs are theme-able (currentColor) + crisp at 24px and need no OS/runtime. | Second glyph pack — rejected: not visually distinct enough; the user asked for an image pack. |
| Button tokens added to `THRONG_THEME` (auto-covered by generated metadata) | Keeps FR-047 completeness structural (no hand-authored descriptor to forget). | Hand-author button descriptors — rejected (DRY): the theme metadata is generated from tokens. |

---

## Delta Plan — 2026-07-09 Settings Typeahead Search

A single additive slice from the **2026-07-09 Clarifications** session (spec.md). It adds **FR-049** — a
debounced typeahead with an inline reset control at the top of the Settings tab, matching a setting when
**any** typed word appears in its name, description, or current value. Nothing is reversed; the slice is
**purely additive** to the shipped Settings form.

**Constitution re-check (v3.11.0):** ✅ PASS, no new violations.
- **II Platform-Abstracted Core** — the matcher is a **pure core module** (`config/settings-search.ts`), zero
  OS/DOM, mirroring `font-typeahead.ts`. The renderer only binds it to an input.
- **V Test-First** — RGR: core unit tests for the matcher, then **E2E** for the user-facing filter, the
  debounce, and the reset control (a mutation check confirms the debounce assertion is not vacuous).
- **VIII SOLID/DRY** — reuses the existing `debounce` helper (`renderer/config/write-config.ts`) rather than
  adding a second one, and reuses `SETTINGS_METADATA` + `getAtPath` (the descriptors *are* the search index,
  so a new setting becomes searchable for free — no parallel list to keep in sync).
- **X Externalised Config** — the debounce interval is a named constant overridable via a
  `searchDebounceMs` prop rather than a magic number buried in the handler.
- **FR-047/048 governance** — the search **filters** the descriptor-driven form; it neither hides a setting
  permanently nor introduces a config key, so the completeness test is unaffected (an empty query shows
  every setting).

### Delta slice

| Slice | Delivers | Touches | E2E gate |
|------|----------|---------|----------|
| **I1 — Settings typeahead search (FR-049)** | A search field at the **top of the Settings section**: query split on whitespace, a setting shown when **any** word is a case-insensitive substring of its **name / description / value** (OR — words widen); filtering **debounced** (typing stays instant); an inline **reset (×)** button, shown only while a query is present, clears immediately (never debounced); empty groups hidden; no-match → explicit empty state. | `core/config/settings-search.ts` **(new, pure)** + `core/src/index.ts` export; `ui/renderer/preferences/settings-tab.tsx` (search field, debounced `applied` query, filtered groups, empty state); `preferences.css` | search box sits above the first group; a name / description / value word each filter correctly; several words widen (OR); non-matching groups unmounted; no-match shows the empty state; typed text lands instantly while the filter provably waits (debounce); the × clears and restores every row and hides itself when empty |

### Design-artifact deltas

- **data-model.md** — new pure module `settings-search.ts`: `SearchableField {key,label,description}`,
  `searchTokens`, `fieldHaystack`, `matchesQuery`, `filterFields(query, fields, valueOf)`. No config-schema
  change (the search is view state, never persisted).
- **contracts/metadata-registry.md** — the registry doubles as the **search index**: `key`, `label` and
  `description` are the searched text, and the field's live value is supplied by the caller via `valueOf`.
- **quickstart.md** — add an I1 validation step.

### Complexity notes (delta)

| Decision | Why | Alternative rejected |
|----------|-----|----------------------|
| **OR** (any-token) semantics, unlike the font typeahead's **AND** | FR-049 / user requirement: the user is *recalling* a setting from half-remembered words, so extra words must widen the net. Font picking filters a known list, where narrowing is right. | Reuse `matchFamilies` (AND) — rejected: two extra words would silently empty the list, the opposite of the requested behaviour. |
| Search covers **key + label + description + value** | "Name" is ambiguous between the display label and the dotted key; indexing both lets `appearance.theme` be found by "appearance" *and* "Theme". Value search finds a setting by what it is currently set to. | Label-only — rejected: misses `excludeGlobs`-style keys and the requested value match. |
| Debounce state split (`query` renders, `applied` filters) | Keeps the controlled input at keystroke latency while the (larger) form re-render settles once — and makes the debounce **observable/testable** rather than an invisible timing detail. | Debounce the input's own value — rejected: makes typing feel laggy and is untestable without timing races. |
| Non-matching rows **unmounted**, not hidden with CSS | Groups must disappear (FR-049) and the E2E asserts absence; unmounting also drops the control subtree cost. | `display:none` — rejected: leaves the rows focusable/queryable and keeps stale controls mounted. |
