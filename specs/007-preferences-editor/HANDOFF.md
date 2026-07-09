# Feature 007 — Delta Implementation Handoff (2026-07-08)

This note lets a **brand-new agent continue the 2026-07-08 refinement delta standalone**. The original
feature (Phases A–G, T001–T089) is **delivered and green**. This handoff is only about the **delta**
(Phase 12, **H1–H6**, T090–T120) planned in `plan.md` → *Delta Plan* and tasked in `tasks.md` → *Phase 12*.

## How to continue (bridge context)

This runs under the **Spec Kit → Superpowers bridge** (`/speckit-superpowers-bridge`). The handoff state is
`.specify/superpowers-handoff.json` (currently **`executing`**). Discipline: TDD (test-first, RGR),
per-slice E2E, then `superpowers:requesting-code-review` + `superpowers:finishing-a-development-branch`, then
set the handoff to `complete` via
`.specify/extensions/speckit-superpowers-bridge/scripts/powershell/update-handoff.ps1 -Status complete -Actor claude`.
**Do not push** — the user always pushes manually. Commit locally per slice.

## Commands

- Build (needed before any E2E): `npm run build`
- Unit: `npx vitest run --project unit <path/to.test.ts>` (or no path for all)
- Integration: `npx vitest run --project integration <path>`
- Contract: `npx vitest run --project contract <path>`
- E2E (Playwright/Electron, build first): `npx playwright test <path.e2e.ts> --reporter=list`
- The `BUILD_ID` printed by `npm run build` only hashes the **renderer**; a **main-process** (`src/main/*`)
  change can leave it unchanged — that is normal, the main TS still recompiled via `tsc -b`.

## Status by slice

| Slice | State | Notes |
|------|-------|-------|
| **H1** window layering (T090–T092) | ✅ **DONE, green, committed** | Prefs window `parent: mainWindow` (above throng only, not `alwaysOnTop`), native minimise-with-main, refocus main on close. `getMainWindow` dep added to `preferences-window.ts` + `main.ts`. |
| **H2** key bindings (T093–T098) | ⚠️ **CODE COMPLETE + unit-green; E2E authored but NOT yet built+run** | **Next action: `npm run build` then run `preferences-keybindings.e2e.ts` + `titlebar-chrome.e2e.ts`; fix any failures; then tick T098.** |
| **H3** reset icons + cog (T099–T101) | ⬜ not started | |
| **H4** font pill editor + per-role font (T102–T108) | ⬜ not started | |
| **H5** button style tokens (T109–T114) | ⬜ not started | |
| **H6** two bundled icon packs (T115–T118) | ⬜ not started | Includes authoring ~22 SVG assets for the secondary pack. |
| polish (T119–T120) | ⬜ not started | Docs currency + full-suite run + `/speckit-analyze` clean. |

## H2 — exactly what was changed (so you can verify/finish it)

Core (`packages/core/src/config/chord-capture.ts`, **unit tests green — 19 passing**):
- `EXCLUDED_KEYS` = {Escape, Space, Shift, Control, Enter, CapsLock, Tab, NumLock}.
- `isBindableChord` **reversed**: any non-modifier key is bindable (single keys OK); rejects a lone modifier
  and — only when bound **alone** — an excluded key. `Ctrl+Space` etc. remain bindable.
- `applyAdd` (append + dedup) and `applyRemove` (drop one) added; **`applyReassign` is now additive**
  (keeps the target action's existing chords). `applyReplace` kept for JSON/programmatic use.
- All exported from `@throng/core` (`packages/core/src/index.ts`).

UI (compiles clean; **E2E not yet run**):
- `capture-modal.tsx`: commits via `applyAdd` (not `applyReplace`); new not-bindable error copy.
- `keybindings-tab.tsx`: each chord is a deletable **pill** (`binding-<action>-pill-<i>` with an `×`
  `binding-<action>-remove-<i>`) + a right-click **context menu** (`binding-context-menu` →
  `binding-context-remove`); `.keybinding-row` gets `user-select: none` (no text highlight on dbl-click).
- `preferences.css`: `.kb-pill`, `.kb-pill__x`, `.kb-ctx-menu` styles.
- `preferences-keybindings.e2e.ts`: rewritten to assert additive add (`['Ctrl+B','Ctrl+K']`), single-key
  bind (`F2`) + `user-select:none`, Space rejected, pill-`×` removal. **Run these.**

Likely-fine but VERIFY in the E2E run: the synthetic `sendChord(prefs, ' ')` for Space (captureToken maps
`' '`→`'Space'`), and that the pill `×` click isn't swallowed by the row's dblclick handler
(`e.stopPropagation()` is already on the `×`).

## H3–H6 — the plan is authoritative

Follow `plan.md` → **Delta slices** table (touched files + E2E gate per slice) and `tasks.md` Phase 12
(T099–T120). Key design decisions already fixed with the user (see spec.md *Clarifications → Session
2026-07-08*):
- **H3**: reset controls are **icon buttons** with `title` tooltips "Reset to Defaults" / "Revert All";
  cog → a standard, uniform gear glyph (`cog-menu.tsx`).
- **H4**: new pure `packages/core/src/config/font-stack.ts` (`parseFontStack`/`serializeFontStack`);
  `theme-metadata.ts` must emit a `font-family` descriptor for **every** typography role; `pickers.tsx`
  becomes a **multi-select pill** editor (dropdown-on-click + typeahead + deletable pills → comma stack).
- **H5**: add `colours.buttonBg/buttonText/buttonHoverBg/buttonHoverText` + a `button` typography role to
  `THRONG_THEME` (auto-covered by the generated `THEME_METADATA` completeness test); populate them in all
  14 default themes (`default-themes/index.ts` `makeTheme`); emit `--throng-*` vars; consume in app button CSS.
- **H6**: seed **two** bundled icon packs on first run — a `throng` glyph pack (from `THRONG_THEME.icons`)
  set as the default `theme.iconPack`, and a secondary **SVG** pack (author the assets). Mirror the existing
  README/default-theme seeding in `icon-pack-service.ts` / `main.ts`.

## Gotchas learned this session

- `git` prints harmless `LF will be replaced by CRLF` warnings on commit (Windows autocrlf) — ignore.
- The Playwright/Electron harness can't reliably drive **minimise/restore of an app-modal (disabled)**
  window; H1's minimise-with-main is delivered by native parenting and verified **structurally**
  (`getParentWindow()`), not via an OS window-state round-trip.
- One unrelated pre-existing E2E flake exists: `terminal-clipboard.e2e.ts` (005 OSC-52 vs the shared OS
  clipboard) — not part of 007.
- Theme metadata is **generated** from `tokensOf(THRONG_THEME)`, so adding tokens (H5 button tokens)
  auto-covers them in the completeness test — no hand-authored descriptor needed.
