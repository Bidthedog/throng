# Quickstart: validating the cross-project clipboard

**Spec**: [spec.md](./spec.md) · contracts: [transfer-ipc](./contracts/transfer-ipc.md),
[ui-surfaces](./contracts/ui-surfaces.md)

## Automated

```bash
npx vitest run packages/core/tests/unit/explorer/transfer-plan.test.ts packages/core/tests/unit/fileop-undo
npx vitest run --project integration packages/ui/tests/integration/transfer-service*.test.ts packages/ui/tests/integration/file-clipboard*.test.ts
npx vitest run --project component packages/ui/tests/component/clash-prompt.test.ts packages/ui/tests/component/paste-progress-notice.test.ts
npm run gate        # done-ness: dispatched to CI per CLAUDE.md, never run locally
```

## By hand

Setup: two projects, **A** and **B**, on separate folders (one on another drive to exercise FR-014).

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | In A select a file, Ctrl+C; switch to B, right-click a folder | Menu reads `Paste "<file>" from A`; pasting copies it, A untouched | US1, FR-025a |
| 2 | Open the file in an editor in A; Ctrl+X; switch to B and back | A's row still greyed | FR-004 |
| 3 | Paste it in B | File only in B; editor shows B's path, not dirty, no notice; pasted row selected | US2, FR-016, FR-025b |
| 4 | Ctrl+Z in A's explorer | File back in A, editor follows; B's Undo no longer offers it, Redo does | US3, FR-020 |
| 5 | Paste a set into a folder holding some of the same names | Prompt per clash with sizes, times, newer marked; Enter = Replace; tick *Apply to all* | FR-017, FR-018 |
| 6 | Ctrl+Z after a Replace | Replaced file back from the Recycle Bin, pasted one gone | FR-018b |
| 7 | Paste a large folder across drives; Cancel; Roll back | Progress after ~1 s; target as before, sources intact | FR-019, FR-019a, SC-007 |
| 8 | Start a paste, start a second | Second shows *Paste queued* and can be cancelled | FR-019d |
| 9 | Close throng mid-paste | *A paste is still running* — Wait / Cancel pastes; Escape keeps throng open | FR-019f |
| 10 | Click the root row, press Left arrow | Tree stays expanded | US4, FR-030 |
