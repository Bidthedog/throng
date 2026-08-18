# Quickstart: verifying feature 034

**Feature**: 034 · **Phase**: 1 · **Date**: 2026-08-16

How to prove each story landed. Every step is one a person can actually perform — no stopwatches, no
races to win by hand. Where a check genuinely needs sub-second precision or a hundred repetitions, it
is written as a script and the step is "run the script and read the number".

Prerequisites: a built tree (`npm run build`), and nothing else running on the machine — the E2E
steps saturate every core.

---

## Story 6 — the cheapest layer that can prove it

### The component layer exists and runs

```bash
npm run test:component
```

Expect: a passing run in **seconds**, not minutes. If this takes minutes, the layer has picked up
something that launches an application and the layer boundary has already leaked.

### Nothing at the E2E layer asserts what a lower layer could

There is no automated check for this — judgement is the instrument, which is why the guards enforce
the countable properties instead. The reviewable evidence is the per-batch commit table (see
[data-model.md](./data-model.md#4-classification-record)):

```bash
git log --grep "^test(034)" --format="%H %s"        # one commit per migration batch
git show <sha>                                       # read its deleted/replaced-by table
```

Read three rows at random and confirm each names a replacement and where it was observed failing.

### Every replacement was observed failing first

```bash
git log --format="%H %s" --grep "observed failing"
```

Each migration commit's message carries the evidence. Spot-check one by reverting its production
change locally and running the replacement:

```bash
git stash list                                       # ensure nothing of yours is at risk first
```

---

## Story 7 — two lanes

### The critical selection is small, and everything is tagged

```bash
npx playwright test --list --grep @core | tail -1
```

Expect: `Total: <n> tests`, with **n ≤ 50**.

```bash
npx playwright test --list --grep-invert "@core|@extended" | tail -1
```

Expect: **zero tests**. Anything listed here runs in neither lane.

### One area can be run without naming files

```bash
npx playwright test --list --grep @editor | tail -1
```

Expect: a non-zero count, and every file in it an editor spec.

### The guards actually fire

Each of these should FAIL, and the message should tell you what to do. Undo each afterwards.

1. Remove the significance tag from any one test → `npm run test:unit` fails naming that file, line
   and title.
2. Add `@core` to a test that already has `@extended` → fails saying it would run twice.
3. Lower `total` in `packages/ui/tests/e2e/e2e-budget.json` by one → fails over budget.
4. Raise `total` by one → fails **under** budget, telling you to lower it. This is the direction
   people expect to be legal, and it is the one that matters.
5. Add a category tag that is not in the vocabulary → fails listing the valid ones.

### The lanes cost what they claim

```bash
npm run test:e2e                 # critical lane
npm run test:e2e:full            # everything
```

Say which machine and quote both figures. `docs/testing.md` must name the same measurement.

---

## Story 8 — the rules cannot regrow the suite

### No instruction source mandates E2E for what a lower layer can prove

```bash
grep -rn "E2E" .claude/agents/ .claude/skills/throng-testing/ | grep -i "mandat\|must\|every UI"
```

Expect: nothing asserting an E2E is required for a UI change. What should appear instead is the
lowest-layer rule and the reservation list.

```bash
grep -n "LOWEST layer\|RESERVED for behaviour" .specify/memory/constitution.md
```

### A reported bug starts at the cheapest layer that reproduces it

Not automatable — it is a rule about what you do next. The check is that the rule is written where
the person doing it will read it: `~/.claude/CLAUDE.md`, the `running-tests` skill, and the
PreToolUse reminder that fires on a test command.

---

## Stories 1-5 — unchanged verification

### The suite is honest

```bash
npm run test:e2e:full > "$TMP/full-1.log" 2>&1; echo "exit=$?"
npm run test:e2e:full > "$TMP/full-2.log" 2>&1; echo "exit=$?"
```

Expect **zero failed and zero flaky, twice consecutively** (SC-001). `failOnFlakyTests` is on, so a
single flake reddens the run — a green here is a real green.

Cost: state it before starting. Two full runs saturate the machine for the duration.

Then the same for the **critical** lane, which is a different claim about a different set and is not
evidenced by the run above (SC-018, SC-025):

```bash
npm run test:e2e > "$TMP/core-1.log" 2>&1; echo "exit=$?"
npm run test:e2e > "$TMP/core-2.log" 2>&1; echo "exit=$?"
```

### The CI figure comes from CI

SC-016 is a claim about **runner minutes**, and nothing local measures those. Read it off a real
Actions run and quote the run id — a local timing is not evidence for it, however carefully taken.

### No test measures with a clock it does not own

```bash
npm run test:unit                # the sleep-budget ratchet and the wait declarations
```

### Every figure names its measurement

```bash
grep -n "measured\|Measured" docs/testing.md | head -20
```

Read three at random; each should name the run and the suite size it was taken at.

---

## The gate

```bash
npm run gate
```

Eight stages now — lint → typecheck → build → unit → **component** → integration → contract → e2e
(critical lane). Fail-fast, and it clears the processes a run leaves behind.

```bash
npm run gate:full
```

The same, with the full E2E lane. This is the pre-release gate, not the everyday one.

---

## CI and release

1. Push a commit. Confirm the Actions run shows **one** E2E job, no `1/3` matrix, and no
   `merge-e2e`. Confirm `E2E (@admin, elevated)` still runs.
2. Put `[ci-admin-only]` in a commit subject and confirm the E2E job is skipped while the admin job
   still runs.
3. Dispatch `release.yml` manually. Confirm `e2e-full` runs the whole remaining suite and that
   `build-installer` does not start until it passes.
