# Quickstart: validating Find in Files Polish

## Automated

```bash
npx vitest run --project unit packages/core/tests/unit/file-search-folder-tree.test.ts packages/core/tests/unit/path-label.test.ts
npx vitest run --project unit packages/ui/tests/unit/find-in-files-menu.test.ts
npx vitest run --project component packages/ui/tests/component/find-in-files-*.test.ts
```

The gate (`gate.yml`, see `CLAUDE.md`) is the done-ness proof; the commands above are the inner loop.

## By hand

Open a project with matches in several folders (`npm run dev`), press `Ctrl+Shift+F`, search a common
word. The manual test plan for this branch (`planning-manual-tests`) lists the groups; the
[contract](contracts/results-list-ui.md) names what each surface should show. In short:

1. While the scan runs, the cancel control animates; clicking a listed row selects it, double-click opens.
2. Cancel mid-scan: rows stay, the notice bar says the list is partial.
3. Switch to Folder structure: the tree mirrors the explorer; the selected row stays selected.
4. Right-click a row in a deep file: no Run / Cancel / Change scope; replace labels are short.
5. Switch theme: matches look the same as in the editor's find bar.
