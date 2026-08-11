# Implementation Plan: Failure Presentation

**Branch**: `feature/S030-failure-presentation` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/030-failure-presentation/spec.md`

## Summary

Everything throng does to tell a user that something failed, brought into one shape — five issues
(#224, #195, #235, #236, #238) specified and built as one feature because each depends on the one
before it.

The technical approach, in one line per story:

1. **#224** — a `notifications` section on `AppSettings` holding a display mode and timeout per
   severity; `NotificationProvider` reads it instead of the `severity !== 'error'` branch and
   `AUTO_DISMISS_MS`. A new renderer→main log channel makes every notice durable, which is what lets
   *Never display* hide an event without losing it.
2. **#195** — a `NoticeSubject` becomes a required field of `NoticeInput` (`subject | 'none'`), so a
   call site cannot omit it; one formatter renders it, and `noticeHeading()` presents it.
3. **#235** — notices gain an affected-panel list keyed by `(groupKey, projectId)`, where `groupKey`
   is 029's `causeKey` when the failure was classified and an operation id when it was not. The
   provider mutates a live notice rather than raising a second one.
4. **#236** — one `PanelFailureBanner` component replaces `UnloadableBanner` and the terminal's
   **start-failure** strip, gaining Clear panel type on the editor. The terminal's other two
   `terminal-panel__starting` states — still-starting and the cwd fallback — are not failures and
   stay as they are (FR-039a).
5. **#238** — `noticeToText()` is rebuilt to derive from the rendered model rather than a field list,
   and the banner gains the same copy control.

## Technical Context

**Language/Version**: TypeScript 5.9, Node ≥20, React 18.3, Electron 43 — verified against
`package.json` (`react: ^18.3.1`, `node: >=20`, `electron: ^43.0.0`, `typescript: ^5.9.3`), not
assumed. 029's plan claims React 19 and Node 22; that is wrong and this feature does not inherit it.

**Primary Dependencies**: React 18 (renderer), Electron (main + preload bridge), xterm.js (terminals),
better-sqlite3 (daemon), vitest (unit/integration/contract), Playwright-Electron (E2E)

**Storage**: `settings.json` under the app's user-data directory, read and merged by
`packages/core/src/config`. No schema migration — tolerant merge against `DEFAULT_APP_SETTINGS`.

**Testing**: vitest projects `unit`, `integration`, `contract`; Playwright-Electron for E2E in two
local tiers and three CI shards. Every user-facing change needs E2E coverage (Constitution V).

**Target Platform**: Windows 11 desktop (Electron). Core stays OS-agnostic (Principle II).

**Project Type**: Desktop application, npm workspaces monorepo — `@throng/core`,
`@throng/platform-windows`, `@throng/daemon`, `@throng/ui`.

**Performance Goals**: A notice must not cost a frame. The affected-panel list is bounded and
virtual-free — the bound (below) keeps the DOM small rather than requiring virtualisation.

**Constraints**: The renderer imports no Node builtin; anything touching the filesystem crosses the
preload bridge. Notice rendering must not regress 029's cause suppression or notice stacking.

**Scale/Scope**: 12 `notify()` call sites today (was 11 when #224 was filed — #218 added one), 2
failure banners, 4 severities, ~40 affected panels as the design point for the list.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design.*

All eleven principles, plus the three non-negotiable workflow gates. Evaluating only the ones that
look relevant is how two of this feature's constitution problems were missed on the first pass.

| Principle | Bearing on this feature | Verdict |
|---|---|---|
| **I. Project-first context isolation** | Notices and banners are per window; the consolidated notice is keyed by project (FR-029), so one project's failure cannot appear under another. | **Pass** |
| **II. Platform-abstracted core** | Display modes, subject formatting and grouping keys are pure decisions — they belong in `@throng/core`, not the renderer. The log *sink* is already platform-side; only the decision to log moves. | **Pass** — new pure modules in core; no Node builtin in the renderer. |
| **III. Detached, tagged, persistent terminals** | The terminal banner's Cancel keeps 029 FR-004a semantics (FR-044); nothing changes when a terminal's process survives. | **Pass** — no change to session lifetime. |
| **IV. Native terminal support & auto-detection** | Terminal failures name their flavour (FR-026); detection is untouched. | **Pass** |
| **V. Test-first (non-negotiable)** | Every story is user-facing, so each needs E2E as well as unit coverage. | **Pass** — task list is Red-first per story; E2E specs named in `tasks.md`. |
| **VI. Simple, modern, discoverable UX** | One banner idiom instead of two; one notice per cause instead of three. **Every discrete panel command needs a menu item** — that is all three of the banner's commands, Retry, Copy and Cancel, not just the two that are obviously new; FR-042c binds all of them and FR-042d fixes the labels to the ones 029 already ships. FR-032a/032b add the keyboard and screen-reader half. | **Pass** — with FR-042c/042d added. The first draft bound only Retry and Cancel, which was the same miss one layer down. |
| **VII. Change review & approval** | All five issues carry maintainer agreement; the spec records 13 clarifications. | **Pass** |
| **VIII. SOLID / DRY / YAGNI** | The subject formatter and the grouping key each exist once (FR-021, FR-029a). Rejected: a second "sameness" notion beside 029's cause. | **Pass** |
| **IX. DI & composition root** | `NotificationProvider` must not reach for settings or the log directly; both arrive as props/context from the composition root, and the IPC handler is registered there (T024). | **Pass** |
| **X. Externalised configuration** | `AUTO_DISMISS_MS` is the exact anti-pattern this principle names. It goes. | **Pass** — the whole point of #224. |
| **XI. Dockable workspace** | Panels, tabs and projects are named with the workspace's own vocabulary (FR-024) and the list is ordered by layout position (FR-031a). | **Pass** |

### Workflow gates (all non-negotiable)

| Gate | Bearing | Verdict |
|---|---|---|
| **Documentation currency** | `README.md:141–145` describes notices as "transient, non-blocking, dismissable" — which *Dismiss only* and *Never display* contradict. | **Pass** — with T075 made unconditional and naming that passage. |
| **Configuration-editor completeness** | Eight new configurable leaves, each needing exactly one `SETTINGS_METADATA` descriptor or the build fails. | **Pass** — T019. |
| **Themeable icon controls with hover titles** | The banner's Retry / Copy / Cancel must resolve through theme icon tokens (`retry`, `copy`, `dismiss`), not literal glyphs. | **Pass** — with FR-042b added; the first draft specified literal glyphs and was a violation. |

**No unjustified violations remain.** Three were found by analysis and fixed in the artifacts rather
than left for implementation: the editor menu item (FR-042c), themeable icon controls (FR-042b), and
rendering the raw system error in the notice, which contradicted 029 FR-016 (FR-034, now aligned).
The one remaining judgement call — a new renderer→main IPC channel — is in *Complexity tracking*.

## Project Structure

### Documentation (this feature)

```text
specs/030-failure-presentation/
├── plan.md              # This file
├── research.md          # Phase 0 — the six decisions the spec left to planning
├── data-model.md        # Phase 1 — settings shape, subject, notice, banner
├── quickstart.md        # Phase 1 — how to prove it works by hand
├── contracts/           # Phase 1 — settings, notice API, IPC, component
│   ├── notification-settings.md
│   ├── notice-api.md
│   ├── log-channel.md
│   └── panel-failure-banner.md
├── checklists/
│   └── requirements.md
├── notice-inventory.md  # started by T027a (US1), completed by T073 (US6)
└── tasks.md             # Phase 2 — /speckit-tasks, not this command
```

### Source code

```text
packages/core/src/
├── config/
│   ├── app-settings.ts            # + NotificationSettings, DEFAULT_APP_SETTINGS entries
│   └── settings-metadata.ts       # + group: 'Notifications' descriptors (8 leaves)
├── notice/                        # NEW — pure decisions, no DOM, no Node
│   ├── display-mode.ts            # DisplayMode, parse/merge, bounds (1500–60000)
│   ├── log-level.ts               # noticeLogLevel(severity) — the mapping, once
│   ├── subject.ts                 # NoticeSubject, formatSubject, context elision
│   ├── grouping.ts                # groupKey(cause | operation, projectId)
│   └── index.ts                   # + NoticeLogRecord
└── failure/cause.ts               # unchanged — closed set stays closed (FR-029b)

packages/platform-windows/src/
└── node-file-log.ts               # + logAlways() — the threshold bypass FR-006b needs

packages/ui/src/main/
├── diagnostics.ts                 # + logAlways on UiDiagnostics
└── notice-log.ts                  # NEW — IPC handler writing notices to the log

packages/ui/src/preload/preload.cts # + throng.notices.log(record)

packages/ui/src/main/main.ts       # + registers the notice-log IPC handler (composition root)

packages/ui/src/renderer/
├── preferences/settings-tab.tsx   # + sibling-disabled control, + confirm-before-commit
├── workspace/                     # + operation-id minting on project open (T049)
├── common/
│   ├── notification.tsx           # provider reads settings; grows a live notice; a11y
│   ├── notice-text.ts             # NEW — copy text derived from the rendered model
│   └── panel-failure-banner.tsx   # NEW — the one banner (#236)
├── editor/
│   ├── unloadable-banner.tsx      # DELETED — call site uses the shared banner
│   ├── editor-missing-notice.ts   # per-tab batching REMOVED (FR-035)
│   ├── editor-notice-store.ts     # UNCHANGED — file-changed-notice still routes through it
│   ├── editor-notice-dialog.tsx   # UNCHANGED — testIds preserved (T051b)
│   └── file-changed-notice.ts     # UNCHANGED — out of this feature's scope
└── terminal/terminal-panel.tsx    # start-failure strip → shared banner
```

**Structure Decision**: The existing workspace layout is kept. The only new directory is
`packages/core/src/notice/`, which exists because three of this feature's decisions — what a display
mode is, how a subject is written, what groups a failure — are pure and must be unit-testable without
a DOM (Principle II, and the reason `failure/` already lives there).

## Phasing

The six stories are strictly ordered by the spec's dependency graph, and the plan does not reorder
them. Each is independently shippable and independently testable:

| Phase | Story | Lands |
|---|---|---|
| A | US1 (#224) | settings + provider + log channel |
| B | US2 (#195) | subject on every notice, one formatter |
| C | US3 (#235) | consolidated notice, grouping, growth |
| D | US4 (#236) | shared banner, editor Cancel |
| E | US5 (#238) | copy from notice and banner |
| F | US6 | inventory, phrase check, docs |

## Complexity Tracking

| Decision | Why needed | Simpler alternative rejected because |
|---|---|---|
| New renderer→main IPC channel for notice logging (FR-006) | The log is written by main (`ui-main`); the renderer raises notices and imports no Node builtin. There is no existing bridge for it — verified: `preload.cts` exposes no log surface. | *Log from the renderer directly* — violates Principle II and the renderer has no filesystem. *Reuse an existing channel* — none carries diagnostics. *Don't log* — removes the guarantee that makes **Never display** safe. |
| `packages/core/src/notice/` as a new module | Three pure decisions need a home outside the renderer so they are unit-testable and reusable by main when it logs. | *Put them in the renderer* — untestable without a DOM, and main needs `formatSubject` for the log record. |
| A notice becomes mutable (grows) | FR-037/FR-037a: a live notice gains panels as tabs are visited. | *Immutable notices* — forces a second notice per tab, which is the storm #235 removes. |
| Two hard-coded presentation constants: the 48-character per-part truncation bound and the list's `max-height: 12rem` | Principle X governs *business* limits — timeouts, paths, endpoints, feature flags — and this feature removes the one that mattered (`AUTO_DISMISS_MS`). These two are presentation geometry: a user has no more reason to tune a truncation bound than a line height, and exposing them would add two settings nobody asked for (YAGNI). Reasoning recorded in `research.md` §6. | *Make them settings* — two more leaves, two more descriptors, two more merge cases, for a value whose only correct answer is "whatever fits the toast". Revisit if a user ever asks. |
| Notice log records bypass `diagnostics.logLevel` (FR-006b) | A configured threshold of `error` would silently drop a silenced `warning`, so the user would have consented to "these reach only the log" and got nothing. The guarantee is the point of the confirmation. | *Honour the threshold* — makes FR-008's confirmation text false and SC-003 untestable. *Force the level up* — misreports a warning as an error in the log. |
