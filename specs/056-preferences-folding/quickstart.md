# Quickstart: validating 056

## Automated

```bash
npx vitest run --project unit packages/ui/tests/unit/preferences-folds.test.ts
npx vitest run --project component packages/ui/tests/component/preferences-fold
npx vitest run --project component packages/ui/tests/component/settings-tab-subgroups.test.ts \
  packages/ui/tests/component/keybindings-tab-subgroups.test.ts \
  packages/ui/tests/component/themes-tab-subgroups.test.ts
npm run lint && npm run typecheck
```

Expected: all green; the 040 "is not collapsible" case now asserts the opposite.

## By hand (`npm start`, open Preferences)

1. Settings tab: click **Editor** — its rows and subsections hide, the heading shows its count. Click again —
   back as before.
2. Fold **Editor → Previews** only — Markdown inside it hides, the rest of Editor stays.
3. Tab to a heading, press Enter, then Space — folds, unfolds.
4. Fold **Editor**, type `wrap` in search — Editor shows unfolded with its match, the count reads `N of M`.
   Clear the search — Editor is folded again.
5. Type an invalid value into a number setting, fold its section — the heading shows the warning marker.
   Unfold — the invalid entry is still there.
6. Click **Collapse All**, close Preferences, restart throng, reopen Preferences — still collapsed. Key
   Bindings and Themes are unaffected. **Expand All** opens everything.
7. Repeat 1, 4 and 6 on Key Bindings and Themes (including the Icons section).

Contracts: [contracts/folding.md](contracts/folding.md). Model: [data-model.md](data-model.md).
