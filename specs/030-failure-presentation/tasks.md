# Tasks: Failure Presentation

**Feature**: `specs/030-failure-presentation` | **Branch**: `feature/S030-failure-presentation`

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [data-model.md](./data-model.md) ·
[research.md](./research.md) · [contracts/](./contracts/)

## Test layers in this repository

Written against the layers that actually exist, not a generic pyramid:

| Layer | Command | Where |
|---|---|---|
| unit | `npm run test:unit` | `packages/*/tests/unit/` |
| integration | `npm run test:integration` | `packages/ui/tests/integration/` |
| contract | `npm run test:contract` | `packages/*/tests/contract/` |
| E2E | `npm run test:e2e` | `packages/ui/tests/e2e/*.e2e.ts` |

There is **no component-test stack** — no jsdom render harness for React. Renderer behaviour is
proven at the E2E layer, and pure decisions are proven at the unit layer in `@throng/core`. Tasks are
shaped to that split.

**Every new `*.e2e.ts` file must be added to `packages/ui/tests/e2e/shard-plan.json`, and to
`parallel-plan.json` if it opens Preferences or drives a context menu** — `shard-plan.test.ts` fails
the build otherwise.

Constitution V is non-negotiable here: each behaviour gets its failing test first, observed failing
for the right reason, before the code that satisfies it.

---

## Phase 1: Setup

- [ ] T001 Create `packages/core/src/notice/` with an `index.ts` barrel, exported from `packages/core/src/index.ts`
- [ ] T002 Create `packages/core/tests/unit/notice/` for the foundational unit tests. Each E2E spec file is created by the task that writes its first test, not up front — an empty `.e2e.ts` registered in no shard group fails `shard-plan.test.ts`

---

## Phase 2: Foundational (blocks every story)

**Blocking**: nothing in Phase 3+ may start until these are done — every story renders a subject or
reads a display mode.

- [ ] T003 Write failing unit tests for `DisplayMode` parsing and bounds in `packages/core/tests/unit/notice/display-mode.test.ts` — covers the whole table in `contracts/notification-settings.md` (absent section, absent severity, unrecognised mode, out-of-range/NaN/negative timeout, unknown severity key)
- [ ] T004 Implement `DisplayMode`, `SeverityNotificationSettings`, `parseNotificationSettings` and `TIMEOUT_MIN_MS`/`TIMEOUT_MAX_MS` (1500/60000) in `packages/core/src/notice/display-mode.ts`
- [ ] T005 [P] Write failing unit tests for severity→`LogLevel` mapping in `packages/core/tests/unit/notice/log-level.test.ts` (error→error, warning→warn, info→info, success→info)
- [ ] T006 [P] Implement `noticeLogLevel(severity)` in `packages/core/src/notice/log-level.ts`
- [ ] T007 [P] Write failing unit tests for `NoticeSubject` formatting in `packages/core/tests/unit/notice/subject.test.ts` — every union member **including `pane`**, `Project — Tab — Panel` for a full panel, omission of absent parts with no dangling separators, context elision (FR-022a), truncation at 48 characters per part with a trailing `…` applied per part and never to the joined string, `{ kind: 'none' }` → empty string
- [ ] T008 [P] Implement `NoticeSubject`, `SubjectContext` and `formatSubject` in `packages/core/src/notice/subject.ts`
- [ ] T009 Write failing unit tests for `groupKey` in `packages/core/tests/unit/notice/grouping.test.ts` — classified cause, unclassified with operation id, neither, and the project id participating in the key so two projects yield two keys
- [ ] T010 Implement `groupKey` in `packages/core/src/notice/grouping.ts`, reusing `causeKey` from `packages/core/src/failure/cause.ts` without widening its closed set

---

## Phase 3: US1 — Decide whether and how long a notice appears (P1) 🎯 MVP

**Goal**: a user can set any severity to Never display / Display for N / Dismiss only, and every
notice reaches the log whatever the mode.

**Independent test**: set a severity to each of the three modes in turn and confirm the toast
behaves accordingly, and that the event is in `logs/main.log` in all three.

### Tests first

- [ ] T011 [P] [US1] Write failing contract test for `notifications` merge in `packages/core/tests/contract/notification-settings.contract.test.ts` — an older `settings.json` with no `notifications` section resolves to the shipped defaults and the rest of the file survives
- [ ] T012 [P] [US1] Extend the existing `packages/core/tests/unit/settings-metadata.test.ts` with the notification leaves' **bounds** (min 1500 / max 60000) — its one-descriptor-per-leaf completeness assertion already covers the count, so do not add a second bespoke test file
- [ ] T013 [US1] Write failing E2E `packages/ui/tests/e2e/notification-prefs.e2e.ts` — the Notifications category exists with four rows; Dismiss only persists past any timeout; **Display for N leaves after N, asserted on `error` specifically** (the one severity hard-coded to persist today at `notification.tsx:225` — a test using `info` would pass while the exemption survived, which is FR-012/US1 AC6's entire point); Never display shows nothing; the timeout control is inert unless the mode is Display for; a value below 1500 or above 60000 cannot be committed
- [ ] T014 [US1] Write failing E2E in the same spec — choosing Never display for `error` asks to confirm and declining leaves the mode unchanged; choosing it for `info` does not ask
- [ ] T014a [US1] Assert explicitly that a preference change applies to the **next notice raised in the same session**, with no restart (FR-016) — T013 exercises this incidentally, which is not the same as asserting it
- [ ] T015 [US1] Write failing E2E `packages/ui/tests/e2e/notice-logging.e2e.ts` — a notice of each severity appears in `logs/main.log` at the mapped level, including one whose severity is set to Never display, and each record carries the **severity, message and subject** (FR-007, not just the level)
- [ ] T015a [US1] Assert in the same spec that a notice suppressed as a duplicate or by cause writes **no** record, and that a growing notice writes a further record naming the panels that joined (FR-006a) — the growth half can only be asserted once US3 lands, so mark it `test.fixme` here and enable it in T038
- [ ] T015b [US1] Assert with `diagnostics.logLevel: 'error'` seeded that an `info` and a `warning` notice **still reach the log** (FR-006b). Without this case the threshold silently swallows them and the suite stays green while FR-008's consent text is false
- [ ] T015c [US1] Assert that raising the **same** event twice under a **Never display** severity writes **one** record, not two — the dedup a displayed notice gets for free (SC-003's "exactly as often as when displayed")
- [ ] T015d [US1] Assert the other half of that parity: a silenced notice reporting a **panel not yet reported** for its group key **does** write a record (FR-005c). The duplicate key contains nothing that changes when new panels are discovered, so without this the silenced path records the first batch and nothing after it. Mark `test.fixme` here and enable in T038 alongside T015a
- [ ] T015e [US1] Assert the record carries the raw system error (`detail`) — FR-034. For a silenced severity the log is the *only* route to it, since there is no toast to copy from
- [ ] T015f [US1] Assert a notice with **per-panel** errors writes one further line per panel (FR-048a). `affected` does not exist on `NoticeInput` until T044, so no US1 test can construct such a notice: mark `test.fixme` and enable in T038
- [ ] T016 [US1] Register both new specs in `packages/ui/tests/e2e/shard-plan.json`. `notification-prefs.e2e.ts` also goes in `parallel-plan.json`'s serial list — it opens Preferences. `notice-logging.e2e.ts` seeds its modes through the config root instead, so it stays parallel; say so in its header, because the serial list already holds 103 entries and needless serialisation costs suite time

### Implementation

- [ ] T017 [US1] Add `NotificationSettings` to `AppSettings` and the shipped defaults to `DEFAULT_APP_SETTINGS` in `packages/core/src/config/app-settings.ts`
- [ ] T018 [US1] Wire `parseNotificationSettings` into the settings merge path in `packages/core/src/config/` so a malformed value resolves per-value without discarding the file
- [ ] T019 [US1] Add the eight `group: 'Notifications'` descriptors to `packages/core/src/config/settings-metadata.ts`, with `min: 1500` / `max: 60000` on the timeouts
- [ ] T020 [US1] Make the timeout control inert when the sibling mode is not `timed`, in the generic settings renderer `packages/ui/src/renderer/preferences/settings-tab.tsx`
- [ ] T021 [US1] Add the confirmation on choosing `never` for `error`/`warning` in `packages/ui/src/renderer/preferences/settings-tab.tsx`, reusing the existing confirmation affordance
- [ ] T022 [US1] Add `NoticeLogRecord` and `noticeLogRecord()` to `packages/core/src/notice/index.ts`
- [ ] T023 [US1] Expose `throng.notices.log(record)` in `packages/ui/src/preload/preload.cts`
- [ ] T023a [US1] Add `logAlways(level, message)` to `DiagnosticLog` in `packages/platform-windows/src/node-file-log.ts` — the existing `write` minus the `passesThreshold` guard at line 127, rotation and formatting unchanged — and surface it on `UiDiagnostics` in `packages/ui/src/main/diagnostics.ts`. Without this FR-006b is unimplementable: every write is threshold-filtered and there is no bypass
- [ ] T024 [US1] Add the IPC handler writing through `UiDiagnostics.logAlways` with component `renderer-notice` in `packages/ui/src/main/notice-log.ts`, and register it from the composition root in `packages/ui/src/main/main.ts`
- [ ] T025 [US1] Replace the `severity !== 'error'` branch and `AUTO_DISMISS_MS` in `packages/ui/src/renderer/common/notification.tsx` with the per-severity mode; a `never` notice is logged and never enters the rendered list
- [ ] T025a [US1] Add the `silencedRecently` map per `data-model.md` so a silenced notice is de-duplicated exactly as a displayed one is (FR-005b) — keyed by the notice's `groupKey` where it has one and the duplicate-check tuple only where it does not — never `causeKey` alone, which drops the project and operation dimensions the key exists to carry — expiring after that severity's `timeoutMs`, pruned lazily on the next `notify`. Without it a repeating watcher failure writes one record per repeat and SC-003 is false
- [ ] T025b [US1] Carry the `reported` panel-id set on each entry so the shadow suppresses only a notice reporting nothing new (FR-005c) — the mirror of FR-006a's growth record. Without it the shadow swallows every record after the first for a cause that keeps claiming panels
- [ ] T025c [US1] Populate `detail` on the record from the notice's `copyDetail`, and have the handler write one further line per entry in `affectedDetails` (FR-034, FR-048a). The `affectedDetails` **population** lands with T044/T050, when `affected` exists at all; this task builds the handler's ability to write them
- [ ] T026 [US1] Delete `AUTO_DISMISS_MS` and update every reference — including the cross-package one, a doc comment in `packages/core/src/failure/daemon-state.ts:34` citing it as precedent (its absence is an acceptance criterion of #224)
- [ ] T027 [US1] Rewrite the doc comment at `notification.tsx:17–51` — it currently states as deliberate design that severity governs persistence, which this feature reverses (FR-059)
- [ ] T027a [US1] Audit every user-facing report of an event that sits **outside** the notice model — dialogs, inline strips, status-bar states — and record each as brought in or deliberately excluded, in `specs/030-failure-presentation/notice-inventory.md`. FR-017's second half and the only evidence for SC-002 ("100% of notices governed")

**Checkpoint**: US1 ships alone. Notices are configurable and durable.

---

## Phase 4: US2 — Know what a notice is about (P2)

**Goal**: every notice states its subject; one formatter renders it; omission is not expressible.

**Independent test**: trigger a rename collision on a named file in a named project — the notice
names both, and never says "this item".

### Tests first

- [ ] T028 [P] [US2] Write failing unit tests for `noticeHeading` with a subject in `packages/ui/tests/unit/notice-heading.test.ts` — the table in `contracts/notice-api.md` (title wins; subject+action; subject alone; none+action+error; nothing)
- [ ] T029 [US2] Write failing E2E `packages/ui/tests/e2e/notice-subjects.e2e.ts` — a file failure names the file; a panel failure names `Project — Tab — Panel`; a terminal failure names its flavour; two failures about one subject name it identically
- [ ] T029a [US2] Assert in the same spec that a subject long enough to need truncation does not overflow the toast or change its layout, and that stacking, colours and dismissal are unchanged (FR-028, which T043 only covers for stacking)
- [ ] T030 [US2] Register the spec in `shard-plan.json`, **and in `parallel-plan.json`'s serial list** — T029 drives a real terminal failure, the same test T042 applies to `notice-consolidation.e2e.ts`. State the reason in the spec header

### Implementation

- [ ] T031pre [US2] Write the observation for the structural guard first: a `@ts-expect-error` case in `packages/ui/tests/unit/notice-subject-required.test.ts` proving a `notify()` call without a subject does not compile. FR-057 currently rests on `tsc` failing with nothing watching it fail, and SC-013 claims both halves are rejected by the project's own checks
- [ ] T031 [US2] Make `subject: NoticeSubject` a required field of `NoticeInput` in `packages/ui/src/renderer/common/notification.tsx` — this breaks the build at every call site, which is the point
- [ ] T032 [US2] Present the subject in `noticeHeading()`; the message renders below and must not restate it
- [ ] T033 [P] [US2] Give every one of the 12 `notify()` call sites a real subject or an explicit `{ kind: 'none' }`, one file at a time: `config/config-write-notices.ts`, `common/notification.tsx` (the failure path), `panel-type/panel-type-form.tsx`, `statusbar/daemon-indicator.tsx` (×2), `preferences/themes-tab.tsx`, `preferences/reset-notice.tsx`, `workspace/panel-placeholder.tsx`, `terminal/terminal-panel.tsx`, `editor/drop-target.tsx` (×2), `editor/editor-notice-dialog.tsx`
- [ ] T033a [US2] **The 12 literal `notify()` calls are not 12 subjects.** One of them — `common/notification.tsx:466`, inside the shared `useErrorNotice` hook — cannot know its own subject, and it is the raiser for *every* explorer file/folder failure and every project and sub-workspace failure: precisely the "this item" path FR-025 exists to fix. Give the hook a `subject` parameter and thread it from its four callers — `app.tsx:422`, `explorer/file-tree.tsx:132`, `sidebar/projects-panel.tsx:133`, `sidebar/subworkspaces-panel.tsx:52` — fed by `use-explorer-data.ts`, `projects-store.tsx` and `subworkspaces-store.tsx`, which already thread `errorAction` and `errorCause` and can carry `errorSubject` the same way. Without this an implementer satisfies T033 and the type guard by passing `{ kind: 'none' }` at the shared raiser, everything compiles, and the single most important surface in #195 is left anonymous
- [ ] T034 [US2] Replace generic stand-ins in those messages ("this item", "this file") with wording that leans on the presented subject (FR-025)
- [ ] T035 [US2] Confirm no notice's message restates its subject (FR-023), adjusting wording where it does

**Checkpoint**: US2 ships on top of US1. Notices are actionable.

---

## Phase 5: US3 — One notice per cause, listing every panel it affected (P3)

**Goal**: one notice per cause per project, listing affected panels grouped by tab, growing as tabs
are visited.

**Independent test**: open a project whose root folder has been renamed, with editors and terminals
across two tabs — exactly one notice; switching tabs grows it.

### Tests first

- [ ] T036 [P] [US3] Write failing unit tests for list ordering and de-duplication in `packages/core/tests/unit/notice/affected.test.ts` — grouped by tab, tabs in `tabOrder`, panels in `panelOrder`, a repeated `panelId` appearing once, and every rendered name coming back through `formatSubject` (a 60-character panel name arrives truncated)
- [ ] T037 [US3] Write failing E2E `packages/ui/tests/e2e/notice-consolidation.e2e.ts` — one notice for a missing project root across two tabs; the project named once and never per row; editors and terminals in the same list; **the raw system error not rendered anywhere in the notice** (029 FR-016, FR-034); no "Cannot open N files" notice anywhere
- [ ] T037a [US3] Assert in the same spec that every listed panel still shows its own failure banner — consolidation changes the notice count and nothing else (FR-038)
- [ ] T038 [US3] Write failing E2E in the same spec — visiting an unrendered tab grows the live notice; dismissing first makes the next visit raise a fresh notice listing only the new panels. **Enable every `test.fixme` left by US1** here, by name — **T015a** (growth writes a further record), **T015d** (a silenced notice reporting a newly discovered panel writes one), **T015f** (per-panel error lines). All three were unreachable until `affected` existed; a fixme nobody is told to enable stays disabled silently, which is the failure `shard-plan.test.ts` guards against one layer up
- [ ] T039 [US3] Write failing E2E in the same spec — an unclassified multi-panel failure still raises one notice grouped by operation, **and two different operations raise two notices** (FR-036's second half)
- [ ] T040 [US3] Write failing E2E in the same spec — rows and tab headings are not clickable, and the list scrolls within its bound
- [ ] T041 [US3] Write failing E2E for accessibility in `packages/ui/tests/e2e/notice-a11y.e2e.ts` — growth announces only the delta region; the list is keyboard-reachable and does not trap focus
- [ ] T042 [US3] Register both specs in `shard-plan.json`, **and in `parallel-plan.json`'s serial list** — `notice-consolidation.e2e.ts` drives real terminals and `notice-a11y.e2e.ts` seeds a display mode; state in the spec header whether the mode is seeded via config (no Preferences window) or through Preferences
- [ ] T043 [US3] Update `packages/ui/tests/e2e/notice-stacking.e2e.ts` — it asserts two notices for two failures, which stays true, but its fixtures now need subjects; note in the spec file why it was touched

### Implementation

- [ ] T044 [US3] Add `AffectedPanel`, `groupKey` and `affected` to the notice model in `packages/ui/src/renderer/common/notification.tsx`
- [ ] T045 [US3] Merge on matching `groupKey` against the live list (de-duplicated by `panelId`) instead of appending, in `notification.tsx`; leave 029's `shouldSuppressForCause` in place for notices with no `affected`
- [ ] T046 [US3] Render the list grouped by tab with a bounded `max-height: 12rem` scroll region, in `notification.tsx` and its stylesheet. Row and heading names go through `formatSubject` with `{ project, tab }` context (FR-031b) — never raw `panelName`/`tabName`, which would bypass truncation and let one long name break the bound
- [ ] T047 [US3] Add the visually hidden delta live region and set the notice body `aria-live="off"` after first announcement (FR-032a)
- [ ] T048 [US3] Make the list keyboard-reachable and non-trapping (FR-032b)
- [ ] T049 [US3] Mint an operation id at the project-open path and thread it to the failures it produces, in `packages/ui/src/renderer/workspace/`
- [ ] T050 [US3] Raise the consolidated notice from the project-load failure path, carrying tab/panel order from the workspace model
- [ ] T051 [US3] Remove per-tab batching from `packages/ui/src/renderer/editor/editor-missing-notice.ts` entirely — no caller may batch by tab (FR-035). Its callers are `use-editor.ts` and `missing-file-watcher.tsx`
- [ ] T051a [US3] Decide and record the fate of the surrounding machinery, which is **not** a plain toast: `editor-notice-store.ts` (the store), `editor-notice-dialog.tsx` (the adapter that calls `notify()` with a structured `body` file list), and the `NoticeFile` type. `file-changed-notice.ts` also routes through the store and is **not** in this feature's scope — so the store survives; what changes is that the missing-files path stops feeding it. Write the decision into the file's doc comment
- [ ] T051b [US3] Preserve the `testIds` the adapter passes through (`editor-notice-message`, `editor-notice-ok`, `editor-notice-dialog`, `editor-notice-files`) — three spec files drive them across six assertions — editor-basics, editor-feedback and editor-file-deleted — and dropping them turns one behaviour change into a three-file test migration
- [ ] T052 [US3] Repoint the E2E specs that assert the old per-tab notices, named rather than swept: `editor-missing-aggregate.e2e.ts` (asserts the aggregate structurally — `editor-notice-dialog`, `editor-notice-files`, two `.editor-notice__file` rows — rather than the literal string; the literal "Cannot open" appears only in `editor-cross-project-restore` and `editor-file-deleted`), `editor-basics.e2e.ts`, `editor-feedback.e2e.ts`, `editor-file-deleted.e2e.ts`, `editor-move-repoint.e2e.ts`, `editor-cross-project-restore.e2e.ts`, `editor-external-change-named.e2e.ts`. Each either asserts the consolidated notice instead or is left alone with a note saying why it was unaffected

**Checkpoint**: US3 ships. The storm is gone.

---

## Phase 6: US4 — The same failure banner in every panel (P4)

**Goal**: one banner component, both panel types, with Retry and Cancel — and Cancel on an editor is
new.

**Independent test**: break an editor's file and a terminal's shell; the two banners are the same
shape; ✕ on the editor returns it to panel-type selection with the panel intact.

### Tests first

- [ ] T053 [US4] Write failing E2E `packages/ui/tests/e2e/panel-failure-banner.e2e.ts` — both panel types render the same banner with **Retry and Cancel** in the same order and the same accessible names, each drawn from a theme icon token rather than a literal glyph. The copy control arrives in US5 (T069a), so do not assert three controls here or US4's checkpoint cannot be green
- [ ] T054 [US4] Write failing E2E in the same spec — Cancel on an editor returns to panel-type selection keeping panel, position and title; Cancel on a terminal behaves as Clear panel type (no regression to 029 FR-004a)
- [ ] T055 [US4] Write failing E2E in the same spec — Retry clears the banner on success and reports failure on failure; the banner cannot be dismissed while the condition holds; and a condition that clears while the panel is **not visible** takes the banner with it (FR-046's untested second half)
- [ ] T056 [US4] Write failing E2E in the same spec — the banner appears with every severity set to Never display, seeded through the config root rather than the Preferences window
- [ ] T056a [US4] Write failing E2E in the same spec — Retry and Cancel are reachable and operable by keyboard, in displayed order (FR-042a, the banner half of SC-009a)
- [ ] T056b [US4] Write failing E2E in the same spec — Try again and Clear panel type are present as commands in the panel's own menu, for both panel types (FR-042c); Copy details joins them in T069b
- [ ] T056f [US4] Write failing E2E in `panel-failure-banner.e2e.ts` asserting the banner's **pointer sentence** — the transitional `Details are in the diagnostic log.` — in both panel types. FR-040 requires the wording and FR-041 constrains it; user-facing text with no test is the same defect the second pass fixed for FR-055
- [ ] T056e [US4] Repoint `packages/ui/tests/e2e/terminal-start-failure-controls.e2e.ts` — it asserts `terminal-start-failed-{pid}`, `terminal-retry-{pid}`, `terminal-clear-{pid}` and the menu items `Try again` / `Clear panel type`. The labels and menu items survive unchanged (FR-042d); the test ids move to the shared banner's `panel-failure-{panelId}` root, so name which assertions change and which do not
- [ ] T056c [US4] Write failing E2E in the same spec — an editor's banner still names the path it could not read (FR-040a, 027/#161 FR-011)
- [ ] T056d [US4] Extend `packages/ui/tests/e2e/default-themes.e2e.ts` to render the banner under each shipped theme and assert it takes its colours from the theme (FR-047, US4 AC10)
- [ ] T057 [US4] Register the spec in `shard-plan.json`, and in `parallel-plan.json`'s serial list — it drives the terminal panel's context menu (T056b)

### Implementation

- [ ] T058 [US4] Create `packages/ui/src/renderer/common/panel-failure-banner.tsx` per `contracts/panel-failure-banner.md`, with controls as `IconButton`s resolving the `retry` and `dismiss` theme tokens with hover titles (FR-042b) — never a literal glyph
- [ ] T059 [US4] Add its styles using theme tokens only, no literal colours
- [ ] T060 [US4] Repoint the editor call site to the shared banner and delete `packages/ui/src/renderer/editor/unloadable-banner.tsx`, **keeping the visible path** it renders today (FR-040a)
- [ ] T060a [US4] Repoint the specs that assert the editor banner's test id, which T060 orphans — the editor's counterpart to T056e. `editor-unloadable-{panelId}` becomes `panel-failure-{panelId}` in `editor-stranded-recovery.e2e.ts:206`, `editor-stranded-restart.e2e.ts:140` and `editor-cross-project-restore.e2e.ts:157,221`. **Two of those are `toHaveCount(0)` and would pass vacuously against a test id that no longer exists** — a silent false green, exactly the class of defect T013 was written to prevent. Also remove the now-dead `.editor-unloadable` rules from `editor.css`. Coordination note: two tests in `editor-stranded-recovery.e2e.ts` are `test.fixme` owned by open issue **#161** — leave their fixme state alone
- [ ] T061 [US4] Implement editor Cancel — return the panel to panel-type selection without destroying it — in `packages/ui/src/renderer/editor/`. `core/src/editor/panel-type.ts` currently records that `clearPanelType` is not wired for editors; that note goes with the wiring
- [ ] T061a [US4] Add Retry and Cancel to the panel menu for both panel types (FR-042c), mirroring how `terminal-panel.tsx` already contributes `Clear panel type`
- [ ] T062 [US4] Repoint the terminal's `terminal-panel__starting` failure strip to the shared banner in `packages/ui/src/renderer/terminal/terminal-panel.tsx`, preserving Clear panel type semantics
- [ ] T062a [US4] Record in `terminal-panel.tsx` that the other two `terminal-panel__starting` states — still-starting and the remembered-cwd fallback — stay as they are, citing FR-039a: they report progress and a substitution, not failures, and offer no Retry, Cancel or cause. This is documentation of a settled decision, not a decision to make; SC-009 already counts failure banners only
- [ ] T063 [US4] Use the **transitional** pointer sentence — `Details are in the diagnostic log.` — because the copy control does not exist until US5. A banner advertising a control it does not have would make US4's independently-shippable claim false; T069b switches it to the final sentence

**Checkpoint**: US4 ships. One idiom, and a stranded editor has a way out.

---

## Phase 7: US5 — Copy the whole of any error (P5)

**Goal**: everything visible about a failure reaches the clipboard, from the notice or the panel.

**Independent test**: copy the consolidated notice while scrolled, paste, and compare against the
screen; then dismiss it and copy from a banner.

### Tests first

- [ ] T064 [P] [US5] Write failing unit tests for `noticeToText` in `packages/ui/tests/unit/notice-text.test.ts` — heading, message, tab-grouped list, **`body`**, details, copyDetail, in reading order. The `body` case is the one today's implementation drops
- [ ] T064a [P] [US5] Write failing unit tests for the two copied-but-never-rendered parts, which T065's DOM comparison is structurally incapable of catching: `n.copyDetail`, and **`AffectedPanel.detail`** appearing beside its own row (FR-048a)
- [ ] T065 [US5] Write failing E2E `packages/ui/tests/e2e/failure-copy.e2e.ts` comparing copied text against the rendered DOM text of the notice, so a future rendered part cannot be silently omitted (FR-049), accounting for `copyDetail` as the one deliberate copied-but-never-rendered part
- [ ] T065a [US5] Assert in the same spec that pasting the copied text into an editor panel reproduces it unchanged — the round trip FR-054 and US5 AC7 actually claim
- [ ] T066 [US5] Write failing E2E in the same spec — banner copy with no notice on screen, including with the severity set to Never display; and the copied list complete while scrolled. Assert the copied **content** too, not just that copying works: message, the subject as `Project — Tab — Panel`, the path, and the system error (FR-052)
- [ ] T067 [US5] Register the spec in `shard-plan.json`, and in `parallel-plan.json`'s serial list — it drives a real editor panel for the paste round trip

### Implementation

> Ordered test-first throughout — every `…pre` task precedes the task that satisfies it. Two were the
> wrong way round after pass 3, the same defect passes 2 and 3 each corrected once.

- [ ] T068 [US5] Rewrite `noticeToText` in `packages/ui/src/renderer/common/notice-text.ts` so it walks what the notice **renders**, in render order, including `body` — not an enumeration of known fields, which is the defect FR-049 exists to prevent. Re-export from `notification.tsx`
- [ ] T068a [US5] Emit each affected row's own `detail` beside its row in the copy text (FR-048a) — the only route by which a per-panel raw error reaches a user, since FR-034 forbids rendering it
- [ ] T069apre [US5] Write the failing assertion first: `panel-failure-banner.e2e.ts` asserts all **three** controls in order, and re-runs the keyboard traversal across all three (T056a could only cover two, and FR-042a/SC-009a name the copy control explicitly)
- [ ] T069bpre [US5] Write the failing assertion first: **Copy details** is present in the panel menu for both panel types (FR-042c) — the assertion T056b deliberately deferred
- [ ] T069pre [US5] Write the failing assertion first: the banner's **final** pointer sentence `Copy the details here, or see the notification.`, asserted with the relevant severity set to Never display so FR-041's "must not promise a notice that may not exist" is actually exercised rather than assumed
- [ ] T069 [US5] Add the copy control to `panel-failure-banner.tsx` using the `copy` theme token (FR-042b) with the text from `contracts/panel-failure-banner.md`
- [ ] T069b [US5] Add Copy details to the panel menu for both panel types, and switch the banner's pointer to the final sentence
- [ ] T070pre [US5] Write the failing test for a clipboard failure first — a unit test over the copy path asserting the failure is reported through the notice model (FR-055). Test-first is non-negotiable and this requirement had implementation without one
- [ ] T070 [US5] Report a clipboard failure through the notice model (FR-055)

**Checkpoint**: US5 ships. Nothing on screen has to be retyped.

---

## Phase 8: US6 — Keep it true after this change (P6)

**Goal**: the sweep is evidenced, and the wording net is automatic.

**Independent test**: add a notice whose text says "this item" and watch the checks reject it.

- [ ] T071 [US6] Write failing test for the generic-stand-in check in `packages/ui/tests/unit/notice-phrases.test.ts` — scans notice message literals for "this item", "the item", "this file"
- [ ] T072 [US6] Implement the check so it discovers notice call sites rather than listing the files this feature happened to touch
- [ ] T073 [US6] Complete `specs/030-failure-presentation/notice-inventory.md` — every user-facing notice and banner string, whether it names its subject, and why not where it does not. T027a already started the file with the surfaces outside the notice model
- [ ] T074 [US6] Sweep for any remaining statement that severity governs persistence (FR-059). Nothing under `docs/` carries it — grep is clean — so after T027 (the `notification.tsx` comment) and T075 (README) this is expected to be a **no-op**; say so rather than manufacturing an edit

---

## Phase 9: Polish & cross-cutting

- [ ] T075 Update **two** README passages. `README.md:141–145` describes notices as "transient, non-blocking, dismissable" **and says a success or a warning clears itself** — *Dismiss only*, *Never display*, and `warning` defaulting to Dismiss only (FR-013) contradict every one of those claims. `README.md:166` claims a reset failure "never fails quietly: a dismissable message names the operation", which *Never display* weakens. Documentation currency is a non-negotiable workflow gate, so this is unconditional
- [ ] T076 Run the full local gate — `npm run lint`, `npm run typecheck`, `npm test` — and capture the output once
- [ ] T077 Re-run only what failed until green, then one full run as the evidence
- [ ] T078 Settle the two pre-existing `terminal-clipboard.e2e.ts` failures before the PR leaves draft. They are the regression tests for **#142** (closed: "Ctrl+V does not paste and right-click can paste twice"), so either that bug has returned or the specs are focus-sensitive and were measured on a machine running throng. Determine which — a clean-desktop run is enough — then file a Bug citing #142 if it is real, or fix the focus assumption if it is not. Constitution V's evidence is a full green run, so "known red" is a bounded, tracked exception or it is not an exception at all
- [ ] T078a Note that `terminal-start-failure-controls.e2e.ts` (repointed by T056e) already has an open Bug against it — **#246**, "reads the layout after a fixed sleep, not after the write". Coordinate rather than fixing it here: that spec belongs to whoever is working #246

---

## Dependencies

```
Setup (T001–T002)
   ↓
Foundational (T003–T010)             ← blocks everything
   ↓
US1 (T011–T027a)  ← MVP, independent
   ↓
US2 (T028–T035)   ← needs nothing from US1, but ships after it
   ↓
US3 (T036–T052)   ← needs US2's subject format
   ↓
US4 (T053–T063)   ← needs US3's notice to point at
   ↓
US5 (T064–T070)   ← needs US3's list and US4's component
   ↓
US6 (T071–T074)   ← needs the notices to be final
   ↓
Polish (T075–T078a)
```

**112 tasks** after six analysis passes (78 original, then additions for what each pass found),
counted from the file with `grep -c '^- \[ \] T'` rather than by arithmetic. The lettered suffixes
keep the original numbering stable rather than renumbering everything downstream.

**Seven** new `*.e2e.ts` files are created across five registration tasks (T016, T030, T042, T057,
T067): `notification-prefs`, `notice-logging`, `notice-subjects`, `notice-consolidation`,
`notice-a11y`, `panel-failure-banner`, `failure-copy`.

## Parallel opportunities

- **Foundational**: T005/T006 (log level) run alongside T007/T008 (subject) — different files.
- **US1**: T011 and T012 are different test files; T017–T019 touch core config while T023/T024 touch
  main — two tracks.
- **US2**: T033's 12 call sites span 10 files (drop-target.tsx and daemon-indicator.tsx have two each), all independent once T031 lands.
- **US5**: T064 (unit) alongside T065/T066 (E2E) — different layers.

## Implementation strategy

**MVP is US1 alone** — configurable, durable notices. It is the only story that ships value with no
message text changed, and it is what makes every later story usable.

Then strictly in order. The dependency chain is real, not preference: US3 renders US2's format, US4
points at US3's notice, US5 copies US3's list from US4's component.

**Do not batch the E2E registration tasks** (T016, T030, T042, T057, T067). A spec added to no group
runs nowhere and does so silently; `shard-plan.test.ts` catches it, but only if the spec is added in
the same change as the file. Every one of the five new specs goes in **both** plans unless it can
genuinely avoid opening Preferences, driving a context menu, or running a real shell — say which in
the spec's header rather than leaving the next reader to work it out.
