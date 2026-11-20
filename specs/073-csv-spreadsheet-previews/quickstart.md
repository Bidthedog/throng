# Quickstart: validating 073

## Automated

From the worktree root:

```bash
npx vitest run --project unit packages/core/tests/unit/csv-*.test.ts packages/core/tests/unit/grid-clipboard.test.ts packages/ui/tests/unit/spreadsheet-read.test.ts
npx vitest run --project component packages/ui/tests/component/data-grid*.test.ts packages/ui/tests/component/csv-body*.test.ts packages/ui/tests/component/spreadsheet-body*.test.ts
npx vitest run --project integration packages/ui/tests/integration/csv-grid-service.integration.test.ts packages/ui/tests/integration/preview-read-source.integration.test.ts
```

E2E runs only in `pipeline.yml`: `-f stages=e2e -f e2e_filter=csv-preview-editor`.

## By hand (fixtures under `packages/ui/tests/fixtures/073/`)

1. Open `quoted.csv` from Files & Folders. Expect `quoted.csv - CSV Preview` (074 FR-104), a grid, `a, b` and the
   two-line value each in one cell, `<img …>` shown as text.
2. Edit B2, press Enter. Expect the unsaved marker; the file on disk unchanged. Ctrl+Z reverts it;
   Ctrl+Y restores it; Ctrl+S writes it — compare with `quoted.after-b2.csv`: only that field differs.
3. With Auto Save on, an edit saves itself after the auto-save delay.
4. Close the panel with an unsaved edit: the editor's Save / Don't Save / Cancel prompt appears.
5. Open the same CSV in Throng Editor (Open In → Editor) while the grid is open: one document — an edit
   in either shows in the other.
6. Open `three-sheets.ods` and `.xlsx`: the switcher lists Data, Hidden (marked), Third; B5 shows 99.
7. Preferences → Editor → Previews: CSV and Spreadsheet subsections; Open CSVs in set to Default OS
   Program hands a CSV to the OS.
