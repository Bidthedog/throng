---
name: throng-failure-notices
description: Use for how failures reach the user — the shared failure-cause model, notifications and notices, panel banners, exit notices and terminal exit codes, daemon-death reporting, notice suppression and de-duplication, and diagnostics logging. Triggers include a raw error string appearing in the UI, a failure that vanishes silently, duplicate or stacked notifications, "what should this say", an operation that half-fails, and log rotation or log level work.
---

# throng — failure presentation and diagnostics

Spec **029 (failure-path-integrity)** established the model; spec **030 (failure-presentation)**
builds on it. Read `packages/core/src/failure/cause.ts` first — its header explains the whole design
in twenty lines.

## The failure-cause model

A failure deep in the stack must not reach the user as whatever raw string was thrown. A **cause** is
a *reason* derived from the error, distinct from the error:

- The set of kinds is **CLOSED** — `held`, `path-missing`, `permission-denied`, `not-empty`,
  `daemon-stopped`. Closed is the design: it has a completion signal and can be tested to
  exhaustion. Anything unmatched keeps today's raw message **exactly**, so a classifier that declines
  to guess cannot make anything worse.
- The operation kind disambiguates errno: `lock` (rename/move/delete → HELD is the likely meaning)
  versus `access` (read/list/create → an ACL refusal).
- The cause **owns the wording** and supplies the **suppression key**, so the same object settles both
  the copy and the de-duplication.
- It lives in `core` because the daemon classifies, main classifies and reports, and the renderer
  renders. It is pure — errno strings are data here, not platform calls, which is what keeps
  Principle II satisfied.

Do not add a sixth kind casually; widening a closed set is a spec-level decision.

## Where presentation lives

- `packages/core/src/failure/` — `cause.ts`, `daemon-state.ts`.
- `packages/ui/src/renderer/common/` — `notification.tsx`, `notice-suppression.ts`,
  `use-hover-suppression.ts`.
- Panel-level surfaces — the editor's `editor-notice-store.ts` / `editor-notice-dialog.tsx` /
  `unloadable-banner.tsx` / `file-changed-notice.ts` / `editor-missing-notice.ts`, and the terminal's
  exit notices.
- `packages/ui/src/main/diagnostics.ts` and `packages/core/src/diagnostics/`
  (`log-format`, `log-level`, `rotation`), driven by `THRONG_LOG_DIR` / `THRONG_LOG_LEVEL` /
  `THRONG_LOG_MAX_KB` / `THRONG_LOG_KEEP`.

Tests that pin the behaviour: `notice-models`, `notice-suppression`, `exit-notice-severity`,
`exit-store`, `file-changed-notice` (unit); `daemon-death-notice.e2e.ts`, `notice-stacking.e2e.ts`
(E2E).

## Rules

- **A failure is never silent.** An unexpected terminal exit shows its output and exit code
  (Principle III); a dead daemon is reported **once**, not as a cascade of unrelated errors; a
  partially-failed batch reports per item.
- **De-duplicate by cause key**, not by message text.
- Wording is part of the model, not the call site — if two places phrase the same failure
  differently, the cause is the thing to fix.
- A notice is UI: it needs E2E coverage (Principle V), and if it is clickable or focus-stealing,
  check the parallel-plan rules with `throng-e2e-harness`.
- **Never dump a raw thrown string into a notice** as a shortcut. That is the exact defect 029 was
  written to close.

## Not yours

The filesystem operations that produce causes → `throng-explorer-fileops`. Terminal exit mechanics →
`throng-terminal-pty`. Daemon reachability and reconnection → `throng-daemon-persistence`. Notice
*visual* design and theming → `throng-renderer-ui`.
