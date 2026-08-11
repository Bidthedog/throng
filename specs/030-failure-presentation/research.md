# Research: Failure Presentation

Phase 0. Six questions the spec deliberately left to planning, each answered against what the
codebase already does rather than from first principles.

---

## 1. How does a renderer-raised notice reach the diagnostic log? (FR-006)

**Decision**: A new one-way IPC channel, `throng.notices.log(record)`, exposed by `preload.cts` and
handled in a new `packages/ui/src/main/notice-log.ts`, which writes through a **new**
`UiDiagnostics.logAlways` — *not* the existing `UiDiagnostics.log`.

**Corrected during analysis.** This section originally said `UiDiagnostics.log`, which cannot work:
every write in `createFileLog` opens `if (!passesThreshold(threshold, level)) return;`
(`packages/platform-windows/src/node-file-log.ts:129`) and `DiagnosticLog` exposes only `setLevel`.
Under `diagnostics.logLevel: 'error'` a silenced `warning` would reach nowhere — the exact outcome
FR-006b forbids, and silently. `logAlways` is that same write minus the threshold check.

**Rationale**: Verified by reading the code — `packages/ui/src/main/diagnostics.ts` owns the only log
sink, its component tag is `ui-main`, and `preload.cts` exposes no logging surface at all. The
renderer cannot write files (Principle II) and there is no channel to borrow. The record is small
(severity, message, subject, cause key, timestamp), so the channel is fire-and-forget with no reply.

**Alternatives considered**:

- *Log from the renderer* — impossible without a Node builtin in the renderer; violates Principle II.
- *Have main raise every notice instead* — inverts the model; notices originate from user actions in
  the renderer, and routing all of them through main to come back adds a round trip to every toast.
- *Pipe renderer `console` to the log* — `diagnostics.ts` already tags a `renderer` component for
  crash paths, but console text is unstructured; FR-007 needs severity, message and subject as
  fields, and a console line cannot carry the level mapping FR-006 specifies.

**Consequence for the log level**: the record's level is derived in core (`severity → LogLevel`), so
main does not re-derive it and the mapping exists once.

---

## 2. What is the grouping key, in code? (FR-029, FR-029a)

**Decision**: `groupKey = causeKey(cause) ?? operationId`, paired with the project id:
`` `${groupKey}::${projectId ?? 'none'}` ``.

**Rationale**: 029 already computes `causeKey(cause)` as `` `${cause.kind}:${cause.subject}` ``
(`packages/core/src/failure/cause.ts:172`) and deliberately returns `null` for anything outside its
closed set of five kinds. The spec forbids widening that set (FR-029b), so the fallback has to come
from somewhere the failure already knows: the operation that produced it. An operation id is minted
at the top of a user- or system-initiated action (project open, tab restore, bulk delete) and passed
down with the work, exactly as a correlation id.

**Alternatives considered**:

- *Group by identical raw error text* — rejected in clarification: per-file failures carry different
  paths, so it degenerates to no grouping precisely when grouping is most needed.
- *Widen the classified set* — explicitly forbidden by FR-029b; 029's closed set has a completion
  signal, and re-opening it is the endless sweep 029 refused.
- *Group by time window* — forbidden by FR-036, and it makes the notice non-deterministic to test.

---

## 3. Where does the subject formatter live, and what shape is a subject?

**Decision**: `packages/core/src/notice/subject.ts`, exporting a discriminated
`NoticeSubject` and a single `formatSubject(subject, context)` that elides the parts the context
already supplies (FR-022a).

**Rationale**: Both the renderer (rendering the heading) and main (writing the log record) need to
render a subject identically, so it cannot live in the renderer. Making it a discriminated union —
`file` | `folder` | `project` | `pane` | `tab` | `panel` | `panelType` | `terminal` | `subWorkspace` |
`none`, the full set `data-model.md` defines — is what makes FR-019's
"omission is not expressible" true at compile time: `NoticeInput.subject` is required, and `'none'`
is a value the author has to type deliberately.

**Alternatives considered**:

- *A formatted string on the notice* — a string cannot be elided by context (FR-022a), and it moves
  the formatting decision back to the call sites, which is the disagreement #195 exists to fix.
- *A formatter in the renderer with main duplicating it* — two copies of a rule that must not drift.

---

## 4. How does a notice grow without breaking notice identity? (FR-037)

**Decision**: `NotificationProvider` keys live notices by their `groupKey`. `notify()` with a
`groupKey` that matches a live notice merges the incoming affected panels into that notice's list
instead of appending a new notice; anything else appends as today.

**Rationale**: The provider already holds the live list in a ref (`live.current`) precisely so
`dismiss` can read it without a state read inside an updater — the same ref answers "is this cause
already on screen?". Growth is therefore a state update to one element, not a new architecture.
Dismissal already clears the timer and removes the notice, which gives FR-037a for free: once the
notice is gone, the next arrival finds no match and raises a fresh one.

**Interaction with 029's suppression** — `shouldSuppressForCause` currently *drops* a second notice
sharing a cause key. That is the same input this decision needs, but the outcome changes from "drop
it" to "merge it into the live one". The suppression call stays for causes carrying no panel list;
merging supersedes it where there is one.

**Alternatives considered**:

- *A separate store for consolidated notices* — two notice models, and the toast layout would have
  to render both.
- *Re-raise the whole notice on each addition* — the toast would re-enter and re-announce, which
  FR-032a forbids.

---

## 5. How is the growth announced without re-reading the notice? (FR-032a)

**Decision**: The notice container keeps `role="status" aria-live="polite"` for arrivals, and growth
is announced through a **separate, visually hidden live region** carrying only the delta sentence
("Tab 2: 2 more panels affected"). The notice body itself is marked `aria-live="off"` once it has
been announced.

**Rationale**: An `aria-live` region announces its whole subtree on mutation, so growing the list
in place re-reads every row — the failure FR-032a names. A dedicated delta region is the standard
resolution and costs one element. Today's markup already distinguishes `role="alert"` for errors
(`notification.tsx:271`), so per-notice ARIA differentiation is an established pattern here.

**Alternatives considered**:

- *`aria-relevant="additions"`* — poorly and inconsistently supported; the spec's requirement is
  behavioural, and this would leave it to the screen reader.
- *Announce nothing* — rejected in clarification (option C).

---

## 6. What bounds the affected-panel list? (FR-032)

**Decision**: `max-height: 12rem` with `overflow-y: auto`, giving roughly 8–10 rows before scrolling,
and no virtualisation.

**Rationale**: The spec requires only that a bound exists and the list scrolls within it. 12rem keeps
the tallest notice under a third of a 1080px window, which is the geometry the E2E suite runs at
(`ci.yml` sets 1920×1080). Virtualisation is rejected under YAGNI: 40 rows of text is not a
performance problem, and a virtualised list inside a live region would fight FR-032a by mutating on
scroll.

**Alternatives considered**:

- *A fixed row count* — breaks when a tab group heading changes the row height.
- *Unbounded with a page-level scroll* — the notice would cover the workspace it is describing.

---

## Open, deliberately deferred

- ~~**Where the FR-056 inventory lives.**~~ **Settled** during analysis: it is evidence the sweep was
  exhaustive, not a live guard — FR-057 is the guard. It lives at
  `specs/030-failure-presentation/notice-inventory.md`, is started by T027a in US1 (the audit of
  surfaces outside the notice model) and completed by T073 in US6. Generated once, not maintained.
- ~~**The operation id's lifetime.**~~ **Settled** during analysis — see `data-model.md`, *Operation
  id lifetime*: minted once per user- or system-initiated action and carried to every failure that
  action produces. Restoring a tab inside a project open does not mint a second, or two panels
  defeated by two different unclassified failures in one open would land in two notices, which the
  spec's Edge Cases forbid. It was never merely an implementation detail.
