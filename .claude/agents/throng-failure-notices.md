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
- `packages/core/src/notice/` — the pure notice model 030 added, and the first place to look before
  writing anything about what a notice *says*: `display-mode.ts` (the three modes, the 3000–30000 ms
  bounds and the total `parseNotificationSettings`), `subject.ts` (`NoticeSubject` and the one
  `formatSubject` every rendered name goes through), `grouping.ts` (which failures are one notice),
  `affected.ts` (the panels a cause defeated, ordered and de-duplicated), `severity.ts`,
  `log-level.ts`, `log-record.ts`.
- `packages/ui/src/renderer/common/` — `notification.tsx`, `notice-suppression.ts`,
  `notice-text.ts` (the ONE ordered part list that both the render and the clipboard walk),
  `panel-failure-banner.tsx` + `.css`, `panel-retry.ts`, `clipboard-copy.ts`,
  `use-hover-suppression.ts`.
- `packages/ui/src/renderer/workspace/panel-failure-notice.ts` — where a defeated panel is reported;
  it is what turns one panel into a row of a consolidated notice.
- Panel-level surfaces — every panel type's failure state IS the shared banner (030 US4), so there is
  no per-type banner component any more; `unloadable-banner.tsx` was deleted with the markup it
  named. What remains is the editor's `editor-notice-store.ts` / `editor-notice-dialog.tsx` (kept
  deliberately — 030 FR-035 removed the *missing-file* path from the dialog, not the dialog) /
  `file-changed-notice.ts` / `editor-missing-notice.ts`, and the terminal's exit notices.
- `packages/ui/src/main/diagnostics.ts` and `packages/core/src/diagnostics/`
  (`log-format`, `log-level`, `rotation`), driven by `THRONG_LOG_DIR` / `THRONG_LOG_LEVEL` /
  `THRONG_LOG_MAX_KB` / `THRONG_LOG_KEEP`.

Tests that pin the behaviour. The pure model is proven at the unit layer, in
`packages/core/tests/unit/notice/` — `subject`, `display-mode`, `grouping`, `affected`, `log-level`,
`log-record` — because by the time a notice reaches the renderer there is nothing left to decide
about it but which elements to emit. The renderer's own: `notice-models`, `notice-suppression`,
`notice-subject-required` (the FR-058 source guard), `exit-notice-severity`, `exit-store`,
`file-changed-notice`, `panel-retry`. E2E: `daemon-death-notice`, `notice-stacking`,
`notice-consolidation`, `notice-logging`, `notice-a11y`, `panel-failure-banner`, `failure-copy`,
`notification-prefs`.

## Rules

- **A failure is never silent.** An unexpected terminal exit shows its output and exit code
  (Principle III); a dead daemon is reported **once**, not as a cascade of unrelated errors; a
  partially-failed batch reports per item.
- **De-duplicate by cause key**, not by message text.
- Wording is part of the model, not the call site — if two places phrase the same failure
  differently, the cause is the thing to fix.
- A notice is UI: it needs coverage at the lowest layer that can prove it (Principle V). What it
  renders, how it stacks, what it announces and where focus goes inside it is a **component test**;
  that it was written to the diagnostics log is an **integration test**. Reserve E2E for a notice
  whose behaviour needs a real window — and if such a spec is clickable or focus-stealing, check the
  parallel-plan rules with `throng-e2e-harness`.
- **Never dump a raw thrown string into a notice** as a shortcut. That is the exact defect 029 was
  written to close. The raw error still reaches the user — through Copy and the diagnostics log
  (030 FR-034/FR-048a) — but never through the rendered text.
- **A notice names what it is about, and the name goes through `formatSubject`** (030 FR-058). A
  source guard enforces it: `notice-subject-required.test.ts` compiles fixtures with `tsc` and fails
  the build on a raise that names no subject, or on a placeholder phrase like "this item". Truncation
  lives in `subject.ts` and nowhere else, so a row rendering `panelName` straight to the DOM bypasses
  the 48-character bound and breaks the notice's height.
- **The shared banner declares no literal colour**, and `default-themes.e2e.ts` proves it by reading
  the rendered element's own class list and auditing every stylesheet rule that mentions one. A
  hard-coded hex here fails the build — and so does a rule that matches nothing.

## Not yours

The filesystem operations that produce causes → `throng-explorer-fileops`. Terminal exit mechanics →
`throng-terminal-pty`. Daemon reachability and reconnection → `throng-daemon-persistence`. Notice
*visual* design and theming → `throng-renderer-ui`.
