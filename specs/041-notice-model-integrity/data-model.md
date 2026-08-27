# Phase 1 Data Model: Notice-Model Integrity

**Feature**: 041 · **Date**: 2026-08-26 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

This feature adds **no new entity**. It widens one — the list a notice carries — and makes explicit an
identity that was previously implicit in a panel id. Everything here is a delta against 030's model,
stated as the change rather than as a fresh description.

---

## 1. `Casualty` — the widened row

**Today** (`packages/core/src/notice/affected.ts`), a row is an `AffectedPanel`: a panel, its tab, and
both orderings, all required, de-duplicated on `panelId`.

**After FR-007b**, a row is a casualty whose panel is *optional*.

**A union of two forms, not one shape with everything optional** (FR-007e). Today's rows carry
neither `subject` nor `reason`, and **six** call sites construct them — `panel-failure-notice.ts:140`,
`affected.ts` itself, and four test files. Making the pair required breaks all six at compile time,
including the tests whose job is to prove the old behaviour survived, and a widening that has to edit
those tests can no longer prove anything about them.

```ts
type AffectedCasualty =
  // The PANELLED form — byte-identical to today's AffectedPanel, plus two optional fields.
  | { panelId: string; panelName: string; tabId: string; tabName: string;
      tabOrder: number; panelOrder: number;
      subject?: string; reason?: string; displayPath?: string; detail?: string }
  // The PANEL-LESS form — a refused open (FR-013). Cannot omit its identity.
  | { panelId?: undefined; subject: string; reason: string;
      displayPath?: string; detail?: string };
```

The union does the enforcing: a panel-less row **cannot** omit `subject` and `reason`, and a panelled
row is unchanged. `AffectedPanel` stays exported as the first member.

| Field | Today | After |
|---|---|---|
| `panelId` + `panelName` + `tabId` / `tabName` / `tabOrder` / `panelOrder` | required | required **in the panelled form**, absent in the other |
| `subject` / `reason` | — | **required in the panel-less form**, optional in the panelled one (FR-007e) |
| `displayPath` | — | **new, optional** — FR-018's project-relative path. Rendered |
| `detail` | optional | unchanged — absolute path and raw error. Copy and log only (FR-018c). **Never rendered** |

### Identity

```
casualtyKey = panelId ?? `${subject}\0${reason}`
```

**A fallback, not a composite** (FR-007aa). The panel *supersedes* the pair rather than joining it,
and that is what the surrounding rules already require rather than a shortcut: a notice consolidates
one cause or one operation (030 FR-035/036), within one of those **a given panel fails once**, so
`reason` can never separate two rows sharing a panel. Folding it in would buy nothing and would undo
030 FR-037a's "a panel appears once, however many times its failure is reported".

The apparent counter-example — the same panel defeated by a *different* cause — is settled one level
up, by `groupKey`: a different cause is a different **notice** (FR-006, US2 scenario 4), never a
second row in this one. Row identity is only ever asked *within* a notice, where the cause is fixed.

The panel wins where there is one, so **every existing row keeps exactly the identity it has today**
and no currently-passing de-duplication changes behaviour. The composite is the fallback, and it is
the only key a refused open can have.

> **The symbols keep their panel names, deliberately.** The spec renames "affected-panel list" to
> "casualty list", but `mergeAffected`, `joinedPanels` and `affectedDetails` are not renamed — so
> `joinedPanels` will, after this feature, report casualties that are not panels. That reads as drift
> and is a choice: renaming them touches every existing caller and every existing test, which would
> break Phase 2's acceptance criterion that **no pre-existing test is edited**. A rename is a
> mechanical follow-up available at any time; smuggling one inside a behavioural change is how a
> "no observable change" phase stops being provable. The doc comments are updated to speak of
> casualties so a future reader meets the decision rather than inferring an oversight.

`\0` as the separator is deliberate: a subject may contain any character a path may contain, and a
printable separator lets a contrived subject collide with a different `(subject, reason)` pair.

> **Implementation note.** The NUL is built with `String.fromCharCode(0)` or a `\0` escape *in
> source*, never typed as a literal byte — a raw NUL makes git classify the file as binary, which
> silently removes it from every diff and every ripgrep sweep.

### Ordering (FR-007c, FR-007d)

Unchanged for panel rows: tab in `tabOrder`, panel in `panelOrder`, ties on ids (`groupAffected`).

Panel-less rows form **one ungrouped section rendered after every tab group**, ordered by
`casualtyKey` — deterministic, and explicitly not arrival order, for the reason 030 FR-031a already
gives about racing failures.

### The emitted shape — widened too, and easy to miss

`groupAffected` does not return casualties; it returns `AffectedTabGroup[]`, whose `AffectedRow`
requires `panelId: string`. **That is what the renderer consumes**, so widening the input without
widening the output leaves panel-less rows with nowhere to land:

| Type | Today | After |
|---|---|---|
| `AffectedRow.panelId` | `string` | **optional** — a panel-less row has none |
| `AffectedRow.displayPath` | — | **new, optional** — what such a row renders |
| `groupAffected` | `readonly AffectedTabGroup[]` | **unchanged** — still the panelled rows, still grouped by tab |
| `ungroupedAffected` | — | **new sibling** — the panel-less rows, ordered by `casualtyKey` |

**A sibling rather than a wider return**, because `groupAffected` has four consumers — including
`affectedDetails` *inside `affected.ts` itself* — and five destructuring sites in `affected.test.ts`.
Changing its shape breaks all nine and collides with the rule that no pre-existing test is edited. It
is also the truer decomposition: grouping rows by tab and listing rows that have no tab are two
operations.

Panel-less rows are **not** smuggled into a synthetic tab group with a blank label either. A
blank-labelled group already **means something else** — `affected.test.ts` asserts that a tab whose
name is blank keeps its rows under an empty heading — so reusing it would make two different things
indistinguishable to both the renderer and that test.

The renderer keys panelled rows on `panelId` as today, and panel-less rows on `casualtyKey`.

**`affectedDetails` must project both.** It flat-maps `groupAffected` alone today, so a panel-less
casualty's absolute path would never reach the diagnostics log — a silent breach of FR-005a, and the
quietest one available, since the value that disappears is never rendered anywhere.

### Rendering (FR-007c, FR-018, FR-018a)

| Row has | Renders |
|---|---|
| a panel | `formatSubject({ kind: 'panel', … })` — unchanged, under its tab heading |
| no panel | `displayPath`, through the same formatter and the same per-part truncation, in the ungrouped section after every tab group |

`displayPath` is the subject relative to the project root the notice already names (030 FR-031).
Where the subject lies outside that root, no relative path exists and the existing display-path
formatter is used instead (FR-018a) — same truncation, so the height bound of 030 FR-032 holds either
way.

---

## 2. `Flash` — not an entity, a transition

FR-008a defines it as exactly two effects on an existing notice, and it stores nothing:

| Effect | Where it lives today |
|---|---|
| pulse the notice card | a transient CSS class on the notice element, cleared on animation end |
| restart the dismissal timer | `timers.current` in `notification.tsx` — already per-notice-id |

**No repeat count is stored or rendered** (FR-008d). A notice that has flashed is byte-identical in
state to one that has not, apart from its timer's deadline.

**Absorption (FR-008e)**: a repeat arriving while a pulse is running restarts the timer but does not
queue a second pulse. The pulse's in-flight-ness is the only state this adds, and it is per notice id
and transient.

---

## 3. The refusal is a third `OpenDecision` — not a new probe

FR-013 needs an answer to *"would opening this path produce a document?"* **before** a panel exists.
That question is already asked, on every open path, as `editor.openInto`:

```ts
export type OpenDecision =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' }
  | { action: 'refuse'; reason: RefusalReason };   // NEW
```

| Situation | `action` |
|---|---|
| a text file within the project | `open` |
| already open elsewhere | `focus` |
| **a missing file** | **`open`** |
| binary / too-large / out-of-tree / folder | `refuse` |

A separate `probeOpenable` call was the first design and is rejected: every caller already awaits
`openInto`, so a probe would make an *accepted* file cost two round-trips to save a *refused* one a
panel. Adding a variant also means **a caller that ignores the refusal fails to compile**, which is
what makes FR-013a ("every entry point") cheap to hold rather than a convention to remember.

**A missing file returns `open`.** Its recovery path — a panel holding a recovered buffer that can be
saved back — is unchanged (FR-015). Flipping that one branch destroys something 018 shipped.

`NOT_A_MISSING_FILE` **moves to `@throng/core`** (`editor/refusal.ts`), re-exported from
`editor-missing-notice.ts` so no caller changes. It is a pure domain decision with consumers in two
processes, and main cannot import a renderer module — Constitution II's test, exactly.

---

## 4. `RemovalCause` — made explicit, not new

FR-003a already names the unit: *a removed folder whose parent survives*. The model this implies:

| Field | Notes |
|---|---|
| `path` | the removed folder |
| `suppressed` | `true` when an ancestor inside the project root is also absent (FR-003c) |

`suppressed` is **derived per event, from the path and the filesystem**, and is never stored across
events. That is the whole content of FR-003c: no buffer, no wait, no dependence on having seen the
ancestor's own event, and therefore identical behaviour under every arrival order.

The upward walk is bounded at the project root — beyond it, absence says nothing about this project,
and the project root itself vanishing is the FR-002 fallback case (name the highest thing nameable).

---

## 5. What does **not** change

Stated because a widening invites collateral edits, and 030's suites assert all of it:

- `NoticeSeverity`, `DisplayMode`, `NotificationSettings` — untouched. *Never display* still
  suppresses entirely and still logs; *Dismiss only* still has no timer (FR-008c).
- `groupKey` (`grouping.ts`) — operation outranks cause, unchanged. This feature changes which
  casualties are *reported*, never which notices they group into.
- `noticeLogRecord` and `affectedDetails` — the log keeps every casualty, including suppressed ones,
  at the cause's own level (FR-005a, FR-005b). Suppression is a presentation rule.
- A panel that already exists and whose file becomes unopenable — its banner is unchanged (FR-016,
  030 FR-038).
- The `focus.cycle` ring — notices are not in it (FR-020c).

---

## 6. Invariants worth a guard

Each maps to a Group 5 requirement (FR-028 – FR-030b) and is decidable below an Electron launch.

| # | Invariant | Layer |
|---|---|---|
| I1 | One removal with N expanded descendants yields exactly one notice, for N ∈ {1,3,5} | unit |
| I2 | I1 holds under **every permutation** of event arrival order (FR-003c, SC-006f) | unit |
| I3 | Three independent sibling removals yield three notices (FR-003a, SC-006c) | unit |
| I4 | No raw system error string is rendered on any notice; the same string is in Copy and the log | component + unit |
| I5 | Ten repeats of one casualty yield one row — measured with **and** without a panel (SC-003a) | unit |
| I6 | Utterances equal pulses: rapid repeats → one of each; spaced repeats → N of each (SC-006e) | component |
| I7 | A refused open creates zero panels at 0, 1 and 3 existing editors (SC-004) | integration |
| I8 | Suppressed casualties still reach the log, at the cause's level (SC-006a) | unit |
| I9 | `focus.notice` is idempotent across three live notices (FR-020d) | component |
| I10 | Escape returns to the pre-binding element, even after tabbing on (FR-022a) | component |
| I11 | A panel failure banner prints its path exactly once — both panel types (FR-019, FR-019a) | component |
| I12 | `openInto` returns `open` for a **missing** file and `refuse` for each not-a-missing-file reason (FR-015) | integration |
