# Data Model: the markings, the budget, and the record of what moved

**Feature**: 034 · **Phase**: 1 · **Date**: 2026-08-16

Stories 1-5 have no data model worth writing down — their entities are files and durations, and
[baseline.md](./baseline.md) already holds them. This document covers Stories 6-8, where the build
starts enforcing properties that until now nobody wrote down.

Everything here is **data the build reads**. If a rule below is not checkable by a test, it is in the
wrong document.

---

## 1. Significance marking

**What it is**: which of the two lanes a test belongs to.

| Value | Meaning | Where it runs |
|---|---|---|
| `@core` | A critical journey — breaking it makes the product unusable | Every push and pull request, **and** at release |
| `@extended` | Real-window behaviour that no lower layer can observe, but whose breakage is not immediately fatal | Release only |

**Cardinality**: exactly one per test. Not per file — a file may hold both, and several will.

**Rules**

- A test with **no** significance marking fails the build. It would otherwise run in neither lane and
  disappear silently, which is the failure mode `shard-plan.test.ts` was written to prevent for
  shards and which the markings now inherit.
- A test with **two** fails the build. It would run twice at release and the count would lie.
- `@core` is capped at **50** across the whole suite (FR-054). The cap is a ceiling, not a target;
  the aim is 30-40.
- Significance is chosen by **consequence, not cost**. A slow test is not thereby `@extended`.

**Relationship to the environment markings**: orthogonal. `@admin` and `@quarantine` say *where a
test can run*; significance says *which lane wants it*. An `@admin` test still carries a significance
marking, and still runs only in the elevated job — the elevated runner selects on `@admin`, not on
the lane.

---

## 2. Category marking

**What it is**: the area a test covers, so an area can be run without naming files (FR-059).

`@boot`, `@terminal`, `@editor`, `@explorer`, `@prefs`, `@window`, `@persistence`, `@failure`.

**Cardinality**: one or more per test. A test that genuinely spans two areas carries both; that is
information, not a smell.

**Rules**

- A test with no category marking fails the build.
- The vocabulary is closed. A test carrying a category outside the list fails the build, because an
  open vocabulary is one typo away from a category nobody ever selects.
- Categories are **not** a second significance axis and carry no scheduling meaning.

---

## 3. Budget record — `packages/ui/tests/e2e/e2e-budget.json`

**What it is**: the declared ceiling on the suite's size, and the mechanism that stops it regrowing.

Modelled on the existing `sleep-budget.json`, which already works this way and is understood.

```
{
  "note":  "<why this file exists, in prose>",
  "total": <integer>,                  // every executed E2E test, all lanes, all markings
  "core":  <integer>,                  // must be <= 50
  "byCategory": { "<category>": <integer>, ... }
}
```

**Rules**

- The build fails when the measured count **exceeds** any recorded number.
- A measured count **below** a recorded number is not a failure — it is the signal to lower the
  record, and the guard says so in its message.
- The numbers may only move **down** across commits. A raise is a deliberate act requiring the
  reviewer to see it in the diff, which is the whole point: the previous rule failed because growth
  was invisible.
- `core` duplicates a number the `@core` cap already enforces. That is intentional — the cap is the
  constitutional limit, the budget entry is the current commitment, and they answer different
  questions ("is this legal" versus "did we grow").

---

## 4. Classification record

**What it is**: the evidence for FR-047 — every deleted E2E names the test that replaced it.

**Where it lives**: in the commit that does the deleting, not in a tracked file. A per-batch table in
the commit message, one row per deleted test:

| deleted | assertions it made | replaced by | observed failing |
|---|---|---|---|

**Rules**

- Every assertion of a deleted test appears in exactly one replacement row. A replacement covering
  part of what was deleted is not a replacement (FR-047).
- "Observed failing" records the commit or the run in which the replacement was seen red against a
  deliberately broken implementation. Without it, the row is a claim rather than evidence (FR-046).
- A deletion with no replacement is permitted only for a test that asserted **nothing that was not
  already asserted elsewhere** — a genuine duplicate — and the row names the existing test instead.

**Why not a tracked file**: it would need maintaining forever to stay true, and its readership is
the reviewer of one commit. Git already stores exactly that.

---

## 5. Tier membership — `parallel-plan.json` (existing, unchanged in shape)

Retained. It answers a different question from significance: **can this spec share a machine with
others**, decided by focus contention, processor contention, or an owned timing assertion.

**Rules that survive verbatim** (FR-055): absence from `serial` means parallel; every spec is in
exactly one tier; a spec whose source matches the focus-stealing pattern may not sit in the parallel
tier.

**One rule changes**: the universe of spec files was enumerated from `shard-plan.json`
(`playwright.config.ts:134`). With that file gone, the universe is read from the directory.

---

## 6. What is deleted

| Entity | Why it goes |
|---|---|
| `shard-plan.json` | 235 hand-maintained filenames existing solely to split the layer across three machines (FR-057) |
| Shard group selection (`THRONG_E2E_GROUP`, `THRONG_E2E_SHARDS`) | Nothing selects a group any more |
| Blob report naming (`THRONG_E2E_BLOB_OUT`, `blob-report-naming.test.ts`) | Existed because three shards wrote one filename (#216). One job, one report. |
| The three shard assertions in `shard-plan.test.ts` | The property they guarded — "a spec in no group runs nowhere, silently" — is now guarded by the significance marking |

The fourth assertion (`['1','2','3']`, hand-kept in step with `ci.yml`) goes with them, and with it
the coupling that had to be maintained by hand.
