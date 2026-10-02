# Quickstart: Match and Selection Highlighting

## Prerequisites

`npm ci`, `npm run build`. A Markdown file of a few hundred lines with several `##` sections, and a
10,000-line file for SC-005.

## Automated checks

```bash
npm run lint
npm run typecheck
npx vitest run packages/core/tests/unit/occurrence-model.test.ts packages/core/tests/unit/theme-syntax.test.ts
npm run test:unit
npm run test:component
```

The full gate runs on CI (`gh workflow run gate.yml --ref <branch>`); see `CLAUDE.md`.

## Scenarios

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | Preview: find a word with 5 matches, Next once; switch tab and back; Next | `2 of 5` with highlights on return; then `3 of 5` | US1, FR-001–FR-002 |
| 2 | Same in an editor | same | US1.3 |
| 3 | Preview: collapse a section; type a word found only inside it | section expands, match current | US2, FR-004 |
| 4 | Editor: fold a section; find a word inside it | range unfolds | FR-005 |
| 5 | Editor: Replace All with matches in a folded section | three-choice prompt; each outcome as [the contract](./contracts/surfaces-tokens-setting.md#replace-all-prompt-fr-007a) | FR-007a |
| 6 | Each bundled theme: run a search | match colours unchanged | US3, SC-003 |
| 7 | Editor and preview: select `id` | `-id`, `id.` tinted; `width`, `valid` not | US4, FR-015 |
| 8 | Turn off *Highlight other occurrences of the selection* | tints vanish in open panels | FR-019 |
| 9 | Select in a preview, click a terminal; click back, Copy | inactive colour while away; Copy gives the word | US5, SC-006 |
| 10 | Scroll an editor and a terminal, select in each; send both to a sub-workspace | same place and selection there | US6, SC-007 |
| 11 | Preview with find open at `2 of 5`; send it to a sub-workspace | `2 of 5` in the new window | US1.5 |
| 12 | 10,000-line file: select a common word | tints appear without a visible delay; typing unchanged | SC-005 |
