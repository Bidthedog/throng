# Quickstart: validating spec 081

Run from the worktree root. Unit and component locally; E2E on CI via `pipeline.yml`.

| Story | Check | Expected |
|---|---|---|
| US1 | `npx vitest run --project integration packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts` under `stress-ng --cpu $(nproc)`, 20 loops | 20/20 pass |
| US1 | `pipeline.yml` dispatch `-f stages=e2e -f e2e_filter=FR-000a -f stress_rounds=20` on Linux | green |
| US2 | `rm f; sleep 0.2; printf 'x\n' > f` on a file open in an editor and a Markdown preview | no notice, new content shown |
| US2 | same with `sleep 1` | one missing notice |
| US3 | collapse a Markdown preview, rewrite its file, expand | tables match a fresh open; handles drag normally |
| US4 | the #733 table fixture with Synchronise Scrolling on | highlighted row keeps its geometry; every stop marks a line |
| US5 | editor and preview title bars | `[Open in OS Default Program] [Find in File Explorer] |` at the head |
| US6 | right-click a file link in a terminal | Open In ▸ equals the File Explorer's for that file |
| US7 | toggle Follow the active preview; activate a preview | tree reveals the source only when on |
| US8 | a git project with `node_modules/` ignored | faded; edit `.gitignore` → updates |
| US9 | open a CSV in the CSV Preview Editor, type in the last row | one new line, one undo step |
| US10 | Focus Mode on a terminal with the status bar on | highlighted strip with label and exit chord |

Contracts: [ignore-oracle](contracts/ignore-oracle.md), [open-in-rows](contracts/open-in-rows.md),
[settle-window](contracts/settle-window.md). Data: [data-model](data-model.md).
