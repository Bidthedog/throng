# Quickstart: validating 048

Prerequisites: the worktree bootstrapped (`npm install`), `npm run build`. Automated layers follow the
`throng-testing` skill; the full gate runs on CI (`gh workflow run gate.yml --ref <branch>`).

## Automated

```sh
npx vitest run --project unit packages/core/tests/unit/workspace-operations-048.test.ts
npx vitest run --project unit packages/core/tests/unit/panel-title-migration.test.ts
npx vitest run --project component packages/ui/tests/component/split-mode.test.ts
npx vitest run --project component packages/ui/tests/component/panel-split-menu.test.ts
npx vitest run --project component packages/ui/tests/component/drag-cancel.test.ts
npx vitest run --project component packages/ui/tests/component/preview-remount-place.test.ts
npx playwright test panel-split outer-edge-drop drag-ghost split-mode --workers=1
```

(File names are the plan's; `tasks.md` is authoritative.)

## By hand (maps to spec user stories)

1. **US1** — 2x2 layout; bottom-left **+** → each split in turn (undo between): new panel on the chosen
   side inside the quadrant, focused; other three untouched.
2. **US2** — header menu and a right-click in content: **Split ▸** with four directions and chords.
3. **US3** — terminal focused: `Ctrl+Shift+Alt+End` → border pulses, status text; `↓` (modifiers held or
   released) splits below; repeat with Escape → nothing changes, shell received nothing.
4. **US4** — 2x2 + a fifth panel; drag it to the far left band: preview spans full height at a third;
   release → full-height column; restart → same layout.
5. **US5** — no Rename / Reset Name in any menu; double-click and F2 do nothing to a panel; an alpha8 layout
   with custom titles loads with derived titles.
6. **US6** — start a panel drag, press Escape, release: ghost and highlights gone at once, layout unchanged;
   drag a preview across another tab and back: same scroll place.
7. **#275** — in a sub-workspace window, split mode and `focus.*` work; `Ctrl+Shift+Alt+PageDown` shows
   "not available in a sub-workspace window".
