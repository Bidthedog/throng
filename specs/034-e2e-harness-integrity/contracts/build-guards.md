# Contracts: the build guards

**Feature**: 034 · **Phase**: 1 · **Date**: 2026-08-16

This feature exposes no API. Its interfaces are the **guards that fail the build**, and they are
contracts in the meaningful sense: each states a property, what violates it, who it speaks to, and
what they read when it fires.

A guard whose message does not tell a developer what to *do* has failed at the only moment it
matters, so each contract below fixes the message as well as the property. The precedent is
`shard-plan.test.ts:32-35`, whose failure text names the file to edit.

All five live in the **unit** project so they cost seconds and gate everything.

---

## G1 — Every E2E test carries exactly one significance marking

**File**: `packages/ui/tests/unit/e2e-tags.test.ts` · **Requirements**: FR-052, FR-053

**Property**: for every `test()` declared under `packages/ui/tests/e2e/`, the set of markings it
carries intersects `{@core, @extended}` in exactly one element.

**Violations and messages**

| Violation | Message |
|---|---|
| Zero | `<file>:<line> "<title>" carries no significance tag, so it runs in neither lane and nobody would notice. Add @core (a critical journey, gates CI) or @extended (runs at release).` |
| Two | `<file>:<line> "<title>" carries both @core and @extended. It would run twice at release and be counted twice. Pick one.` |

**Note on discovery**: the guard must **discover** the tests rather than check a list. A guard that
reads an enumeration is a guard that passes while an untagged file sits beside the enumeration —
the exact failure `shard-plan.test.ts:30-37` exists to prevent for a different property.

---

## G2 — The critical selection is capped

**File**: `packages/ui/tests/unit/e2e-tags.test.ts` · **Requirements**: FR-054, SC-018

**Property**: the count of tests carrying `@core` is ≤ 50.

**Message**: `@core holds <n> tests, over the cap of 50. The critical selection gates every push; a
test earns a place in it by what breaking it costs a user, not by what running it costs a machine.
Demote the weakest to @extended.`

---

## G3 — The suite is at or below its budget

**File**: `packages/ui/tests/unit/e2e-budget.test.ts` · **Requirements**: FR-060, SC-020

**Property**: measured counts ≤ the numbers in `packages/ui/tests/e2e/e2e-budget.json`, for `total`,
`core`, and each entry in `byCategory`.

**Violations and messages**

| Violation | Message |
|---|---|
| Over budget | `The E2E suite holds <n> tests against a budget of <m>. Before raising the budget: what can this test assert that a unit, component or integration test cannot? If you can answer that, raise it deliberately in packages/ui/tests/e2e/e2e-budget.json and say why in the commit.` |
| Under budget | `The E2E suite holds <n> tests against a budget of <m>. Lower the budget to <n> — a ratchet that is not tightened is not a ratchet.` |

**Direction**: the under-budget case **fails**. A ratchet that only fires upward drifts to a ceiling
nobody is holding.

---

## G4 — Tier membership stays correct

**File**: `packages/ui/tests/unit/shard-plan.test.ts` (retained assertions) · **Requirements**: FR-055

**Property**, unchanged from today except in where it reads the universe of spec files: every spec is
in exactly one tier; `parallel-plan.json` names nothing that no longer exists; no spec whose source
matches `/openPrefs|cog-menu-|getByTestId\('context-menu'\)|button: 'right'/` sits in the parallel
tier.

**Change**: the universe comes from `readdirSync` of the E2E directory, not from `shard-plan.json`.

**The three shard assertions are deleted**, along with the hand-kept `['1','2','3']` group check.

---

## G5 — The category vocabulary is closed

**File**: `packages/ui/tests/unit/e2e-tags.test.ts` · **Requirements**: FR-053, FR-059

**Property**: every category marking is one of `@boot @terminal @editor @explorer @prefs @window
@persistence @failure`, and every test carries at least one.

**Message**: `<file>:<line> "<title>" carries the category <tag>, which is not in the vocabulary. An
open vocabulary is one typo away from a category nobody ever selects. Use one of: <list>.`

---

## Lane contracts

Two commands, each with a fixed meaning. These are what CI, the release workflow and a developer all
resolve to, and they must not diverge.

| Lane | Selects | Invoked by |
|---|---|---|
| **Critical** | `--grep @core` | `npm run test:e2e`, `npm run gate`, `ci.yml`'s e2e job |
| **Full** | no significance grep — everything not excluded by `grepInvert` | `npm run test:e2e:full`, `npm run gate:full`, `release.yml`'s e2e-full job |

**Invariants**

- `grepInvert` continues to exclude `@admin` and `@quarantine` in **both** lanes, each behind its own
  independent flag. The comment at `playwright.config.ts:155-172` records why folding them into one
  ternary silently defeats itself; that reasoning is unchanged by the lane split.
- The elevated `@admin` job selects on `@admin` and is unaffected by which lane is running.
- A CLI `--grep` does not clear a config `grepInvert` — the two compose, which is what makes the lane
  selection a one-line change rather than a new plan file.

---

## What each guard replaces

| New guard | Replaces |
|---|---|
| G1 | The shard-plan "lists every spec file that exists" assertion — same property (nothing runs nowhere silently), now per test rather than per file |
| G3 | Nothing. There was no budget, which is the defect. |
| G4 | Itself, minus the shard half |
| G2, G5 | Nothing — new properties introduced with the markings |
