# Quickstart / Validation Guide: Preferences Editor (feature 007)

A phased **run-and-verify** guide. Each phase lands green (unit + integration + **Playwright-Electron E2E**)
before the next begins (Principle V; Incremental Delivery). Details live in `plan.md`, `data-model.md`, and
`contracts/`.

## Prerequisites

- Repo bootstrapped per `CONTRIBUTING.md` (npm workspaces; `npm install` at root).
- Config root: `%USERPROFILE%\.throng` (override `THRONG_CONFIG_ROOT`); app-data: `%APPDATA%\throng`
  (Electron `userData`). E2E uses a temp config/app-data root so it never touches the real profile.

## Commands

```bash
# unit + contract + integration (all packages)
npm test
# core only (metadata completeness, chord capture, font typeahead, icon packs, reset, default themes)
npm --prefix packages/core test
# platform contract (IFontEnumeration vs WindowsFontEnumeration)
npm --prefix packages/platform-windows test
# E2E (per-phase specs live under packages/ui/tests/e2e)
npm --prefix packages/ui run test:e2e
# run the app
npm run dev
```

## Phase A — Title bar + chrome + preferences shell (US1, US8)

**Run** `npm run dev`. **Verify**:
- A full-width application bar spans the top, **above** the Projects/Tabs/Files bar, matching its height;
  **no OS title bar** in addition.
- Min / maximize(restore) / close work; dragging an empty region moves the window; double-click toggles
  maximise.
- The **cog** (main window only) opens a menu with exactly **Settings / Key Bindings / Themes**; each opens
  the **single** preferences window on the matching tab; reopening focuses that one window.
- While preferences is open the main + sub-workspace windows are **non-interactive**, but the preferences
  window is **movable** to reveal them.
- Detach a sub-workspace: its bar shows the sub-workspace name/colour + controls and **no cog**, no OS bar.

**E2E**: `titlebar-chrome.e2e.ts`, `subworkspace-titlebar.e2e.ts`.

## Phase B — Settings editor + immediate apply (US2)

**Verify**: open Settings; settings appear grouped with label + description + a type-matched control. Change
one of each control type (number, dropdown, text, toggle, multi-select, array) → the file under
`%USERPROFILE%\.throng\settings.json` updates and the app reflects it **live, no restart**; enums offer only
allowed values; an invalid entry is **not** applied and is surfaced, last valid kept. Restart → change
persists. **Core**: the completeness test fails if any settings key lacks a descriptor.

**E2E**: `preferences-settings.e2e.ts`.

## Phase C — Global UI⇄JSON toggle (US5)

**Verify**: the mode toggle flips **all three** tabs between the visual form and the JSON editor; it stays
visible/usable at the window's **minimum** size. Edit valid JSON → applies + persists; invalid JSON → not
applied + surfaced, last valid kept. Each tab's JSON is independent of the others and of any editor elsewhere
in the app.

**E2E**: `preferences-json.e2e.ts`.

## Phase D — Key Bindings editor (US3)

**Verify**: bindings are grouped with description + current chord. Double-click → capture modal; the chord
builds live as keys go down. A **bare key or lone modifier is rejected**; a valid **modifier+key** replaces
the action's chord on key-up, saves, and applies. Capturing a chord already bound elsewhere **warns** and
offers **Reassign** (removes it from the other action) or **Cancel** — never a silent duplicate/steal.

**E2E**: `preferences-keybindings.e2e.ts`.

## Phase E — Themes editor + fonts + defaults (US4, US7)

**Verify**: selector + rename + delete + "restore default themes" above grouped token controls. Editing a
colour uses a colour picker; font uses a **typeahead** that narrows by multi-token substring (`ar es`);
size/number/enum use the matching control; each applies **live**. **Selecting** a theme **activates** it
(whole app repaints). Rename to an existing name is **rejected** inline; delete asks a **single**
confirmation; restore re-creates missing built-ins. All **14** default themes are present, visually distinct,
and survive delete→restore. In JSON mode the Themes tab edits the **selected theme's file**. Startup is
**not** delayed by font enumeration (font list may populate slightly after open; the picker still works).

**E2E**: `preferences-themes.e2e.ts`.

## Phase F — Icon packs (US4 icons)

**Verify**: selecting an icon **pack** re-skins all tokens; overriding one token changes only it; dropping a
folder with a `pack.json` under `%USERPROFILE%\.throng\icon-packs\` makes it selectable and its icons render
at **24px** (glyph or SVG/PNG); a token missing from the pack falls back to the default `throng` glyph. The
bundled `icon-packs\README` documents the format.

**E2E**: `icon-packs.e2e.ts`.

## Phase G — Reset (US6)

**Verify**: "reset this editor to default" (confirm) restores the current tab's defaults — **disabled for a
user theme**, enabled for a built-in (reverts it to its installed default). "reset all" (confirm) reverts
Settings, Key Bindings, and **every theme file edited this session** to their on-entry contents and
re-activates the on-entry theme. Cancelling either changes nothing.

**E2E**: `preferences-reset.e2e.ts`.

## Definition of done (per phase)

Unit + contract + integration green; the phase's E2E observed passing against the running app; temp
artifacts self-cleaned; docs reconciled at feature close (README/ROADMAP/CONTRIBUTING) per the
Documentation-currency rule. The **FR-048 constitution amendment** (editors-stay-in-sync governance) is
scheduled in Phase B.

---

## Delta validation — 2026-07-08 refinements (H1–H6)

- **H1 Window** — open preferences; it floats above the throng window but NOT above another app; minimise
  throng → prefs minimises too; close prefs → the throng window is refocused (no other app left on top).
- **H2 Key bindings** — double-click a binding (no text highlights); bind a single key (e.g. `F7`, an
  unbound key — an already-bound key like `F2` instead surfaces the reassign/conflict flow); `Space`
  is rejected; capture a second chord → BOTH show as pills; click a pill `×` (or context-menu Remove) →
  that chord is removed.
- **H3 Reset + cog** — the reset controls are icons with hover titles "Reset to Defaults" / "Revert All";
  the title-bar cog is a standard gear.
- **H4 Fonts** — a font control shows a dropdown on click + typeahead; pick two families → two pills → the
  theme file stores the comma-separated stack; delete a pill; every typography section has the control.
- **H5 Buttons** — the Themes editor exposes button background/text/hover colours + a button font; changing
  them restyles the app's buttons live; every default theme styles them.
- **H6 Icon packs** — a fresh install lists ≥2 packs incl. `throng` (glyphs) and the SVG pack; selecting the
  SVG pack renders its images at 24px.

## Delta validation — 2026-07-09 settings search (I1)

- **I1 Settings search** — open Settings; the search field sits above the first group. Type `theme` → only
  the Theme row remains and other groups vanish. Type `dwell` (a word from a *description*) → the tab
  hover-activate setting is found. Type `600` (a *value*) → the same setting is found. Type `theme globs`
  → **both** matching settings show (any word matches — words widen). Type gibberish → a "no settings
  match" message. Click the `×` inside the field → the full grouped list returns and the `×` disappears.
  Typing is never laggy: characters appear immediately while the list settles a moment later.

## Convergence validation — 2026-07-09 (Phase 14)

- **FR-041, dirty buffer** — open Settings, toggle to **JSON**, and start an edit you do not finish (e.g.
  delete the closing braces) so the document is invalid and therefore unapplied. Now edit
  `%USERPROFILE%\.throng\settings.json` in another program and save. The tab surfaces **"This file changed
  on disk while you were editing it"** with **Reload** and **Keep editing**. *Reload* adopts the on-disk
  document and clears the invalid banner, and the abandoned edit is never written back. *Keep editing*
  dismisses the notice, leaves your buffer untouched, and your next valid edit overwrites the file. Neither
  side is ever silently discarded.
