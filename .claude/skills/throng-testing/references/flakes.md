# The flaky-test gate, and how to reproduce a flake

Read when a test passes on retry, when deciding whether to raise retries, or before stress-testing one spec.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## A flaky test FAILS the run

**A green run means every test passed on its FIRST attempt.** `failOnFlakyTests` is set in
`playwright.config.ts`, so a test that fails and then passes on retry turns the run **red**.

`retries` still default to **2** — but for their *diagnostic* value, not their absolving value. A
retry captures the first failure's assertion, diff and trace, which is genuinely useful. What it may
never do is convert a failure into a pass.

This reverses the old policy, which said retries should *absorb* load-transient failures. That policy
was measurably wrong: a run with retries disabled found **ten** tests failing on their first attempt
and being reported green. A suite that retries until it passes does not produce a green suite — it
produces a green *run*, of a suite that is still broken, and somebody will trust that bar.

The constitution (Principle V, v3.14.0) already said so: a test that fails and then passes with no
code change is *"flaky, not fixed"* and must never be *"absorbed into a green bar by repetition"*.
Nothing enforced it until feature 017.

The accepted cost: a genuinely transient infrastructure fault now fails a run. The remedy is to fix
the test or quarantine it — never to relax the gate.

Set `THRONG_E2E_RETRIES=0` to see raw first-run results with no diagnostic retry at all.

## Reproducing a flake: separate invocations, never `--repeat-each`

The rule says stress the one test until it fails on demand. **How you stress it decides whether
the answer means anything**, and the obvious tool is the wrong one.

`--repeat-each=N` replays a test N times **inside one worker, against whatever state the previous
repeat left**. The suite never does that: it runs each test once, with its own app and its own config
root. So for any spec about state that persists — `preferences-reset.e2e.ts` most of all, which is a
file about config writes landing — `--repeat-each` manufactures failures that do not exist.

Measured, 2026-08-27, chasing the flakes in [#341](https://github.com/Bidthedog/throng/issues/341):

- With `--repeat-each=5`, `preferences-reset.e2e.ts:265` failed waiting for `binding-reset-zoom.in`
  to become enabled. The button was **disabled**, titled *"Zoom in is already at its default value"* —
  the previous repeat's *reset-all* still in effect. A perfect-looking reproduction of a defect that
  was not there, and it sent the investigation at the diff rather than at the harness.
- Re-run as separate invocations, that test passed **4 of 4** rounds, and the real flake surfaced
  somewhere else entirely: `theme-flash.e2e.ts:199`, `Error: no new window was created`.

So: **one round is one `npx playwright test <spec> --workers=1 --retries=0` process**, repeated by a
loop *outside* Playwright, with the pass/fail of each round recorded. It is slower per sample, and it
is the only sampling that shares the suite's conditions.

**And run the same rounds on `origin/master` before attributing anything.** The same session's
measurements — branch 1 failure in 4 rounds, master **2 in 6** — are what turned "my branch broke the
preferences specs" into "this family flakes on master too", and the two sides failed *different*
tests, which no single-sided run could have shown.
