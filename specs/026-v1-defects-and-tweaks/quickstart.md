# Quickstart: validating v1.0.0 Defects & Tweaks

How to prove this feature works — automated first, then by hand. The automated half is unusually
decisive here because the acceptance tests were written and observed failing *before* any fix.

## Prerequisites

```bash
npm install          # in the worktree; workspace links must resolve
npm run build        # E2E runs against dist/, not source
```

## The one-line proof

The feature is done when the 16 committed red tests are green and the 13 green ones still are.

```bash
npx vitest run --project unit --project integration --project contract
npx playwright test
```

Baseline before the work (measured 2026-07-30): unit **5 failed / 1595 passed**, integration+contract
**4 failed / 423 passed** — all 9 failures being this feature's own red tests. Anything else failing is
pre-existing and named in the report, not caused here.

## Targeted runs, per issue

```bash
# 194 — case-only rename
npx vitest run --project integration packages/ui/tests/integration/rename-case-only.integration.test.ts

# 186 — watcher liveness under churn, and recovery from a runtime error
npx vitest run --project integration packages/ui/tests/integration/file-watcher-liveness.integration.test.ts
npx vitest run --project unit packages/ui/tests/unit/file-watcher-error-recovery.test.ts
npx playwright test packages/ui/tests/e2e/explorer-live-sync.e2e.ts

# 161 — stranded editor
npx playwright test packages/ui/tests/e2e/editor-stranded-recovery.e2e.ts

# 197 — re-entry after a rename
npx playwright test packages/ui/tests/e2e/explorer-rename-reentry.e2e.ts

# 166 / 165 — status bar, pane chords
npx playwright test packages/ui/tests/e2e/status-bar-deduped.e2e.ts
npx vitest run --project unit packages/core/tests/unit/pane-toggle-defaults.test.ts

# fences that must stay green (#198 deferred — link routing untouched)
npx playwright test packages/ui/tests/e2e/terminal-link-once.e2e.ts
```

**Capture the full output once** (Constitution Principle V) — the E2E suite runs for minutes and a run
whose detail was piped away must be paid for twice.

## Running the app

```bash
npm start
```

## Manual validation

Each scenario names the requirement it proves, so a failure points at a requirement rather than a
vibe. Detailed click-by-click steps are in the final delivery report; this is the checklist.

| # | Scenario | Proves | Expected |
|---|---|---|---|
| 1 | Rename a folder `job specs` → `Job Specs` | FR-001 | Succeeds; tree shows the new casing at once |
| 2 | Rename a file `readme.md` → `README.md` | FR-001 | Succeeds |
| 3 | Confirm a rename without changing a character | FR-002 | Nothing happens, no error |
| 4 | Rename `one.txt` → `TWO.TXT` where `two.txt` exists | FR-003 | Refused, "already exists" |
| 5 | Run the churn loop below in the project root, then create a file elsewhere in the project while it is still running | FR-006 | The new file appears within a second, *while the loop is still going* |
| 6 | Delete a file from the tree | FR-009 | Node disappears immediately |
| 7 | Delete a file that is locked by another program | FR-009a | Node comes **back**, and an error says why |
| 8 | Close throng, rename a folder containing an open file, reopen | FR-013 | Editor shows a banner naming the path; text still visible |
| 9 | With that banner up, press Ctrl+S | FR-013a | Asked to confirm first — not blocked, not silently redirected |
| 10 | Rename the folder back while throng is open | FR-014 | Banner clears, current content loads, same panel |
| 11 | Right-click the editor's panel header | FR-018 | **Reload from disk** is there, beside Revert |
| 12 | Expand a folder, rename it, switch project, switch back | FR-020/021 | Still expanded, under its new name, no error |
| 13 | Look at the status bar | FR-024/025 | Root folder path only — no dot, name, `Tab · Panel` or ADMIN pill |
| 14 | Press `Ctrl+Alt+B` and `Ctrl+Alt+N` | FR-028 | Panes toggle |
| 15 | Press `Ctrl+B` in a focused terminal | FR-028 | The **shell** gets it; no pane toggles |

### The churn loop (scenario 5)

"Churn" means *anything writing files faster than the coalescing window* — a build, an install, a git
operation. The defect was that the refresh timer restarted on every change and so never fired at all,
so the rate is the whole point: one file every few seconds proves nothing, because that always worked.

```powershell
# Run IN the project root. Ctrl+C to stop.
for ($i = 0; $i -lt 2000; $i++) { Set-Content "noise$($i % 50).tmp" $i }
```

While it runs, create a file in another folder of the project. Before the fix the tree froze for the
whole loop and caught up only afterwards; now the file appears within a second.

## Negative cases worth trying

These are the ones a green suite can still miss:

- **Revert must still refuse** when the file is gone (FR-017) — it is not Reload from disk.
- **A stale restore must be silent** (FR-021), but a folder you actually click into and cannot read
  must still report (FR-022).
- **Terminal links** must still open exactly once on Ctrl+click, and nothing on a plain click
  (FR-032/034) — #198 is deferred, so any change here is a regression.
- **Your own saved keybindings** must be untouched by the upgrade (FR-030).

## Diagnostics

Two behaviours are deliberately invisible to the user and must still leave evidence (FR-010b, FR-021,
SC-013). After exercising scenarios 5 and 12, the diagnostic log should contain the discarded stale
paths and any watch retry — check it before believing the silence is correct.
