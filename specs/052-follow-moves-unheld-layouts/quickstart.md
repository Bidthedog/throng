# Quickstart: Follow Moves Into Unheld Layouts

**Spec**: [spec.md](./spec.md). The behaviour each scenario checks is in [research.md](./research.md); the RPC and
editor shapes are in [contracts/](./contracts/).

## Prerequisites

`npm ci`, `npm run build`. A dev launch with a scratch config root: see the `throng-testing` skill, *hands-on
sessions*. Use a project containing `a.md`, `b.md` and `docs/x.md`.

## Automated

```bash
npx vitest run --project unit packages/core/tests/unit/moved-paths.test.ts
npx vitest run --project integration packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts
npx vitest run --project integration packages/ui/tests/integration/editor-one-buffer.integration.test.ts
npx vitest run --project component packages/ui/tests/component/editor-moved-path.test.ts
```

All green. The follow-moves integration file's 50-record case reports its duration under 100 ms.

## By hand

1. **Closed sub-workspace (US1)**: open `a.md` in a sub-workspace and close it. Rename `a.md` to `c.md` in the main
   window, then reopen the sub-workspace. Its editor shows `c.md`, clean, with no notice.
2. **Unloaded project (US1)**: in project P2, open a preview of `docs/x.md`, switch to P1, and unload P2. From a
   project containing the folder, move `docs` to `notes`. Load P2: the preview shows `notes/x.md`.
3. **Unseen tab (US2)**: restart with an editor on `a.md` in a background tab. Rename `a.md` without visiting the
   tab, then restart. The tab's editor opens the new name.
4. **Replace, clean (US3)**: open `a.md` and `b.md` in two panels. Cut `a.md`, paste onto `b.md` and choose
   Replace. Both panels show the moved content, and typing in one shows in the other. Undo: each panel shows its
   original file.
5. **Replace, dirty (US3)**: as step 4, with unsaved edits in `b.md`. B's panel keeps the edits and shows the
   replaced notice. Save As keeps them elsewhere; Ctrl+S does not overwrite.
