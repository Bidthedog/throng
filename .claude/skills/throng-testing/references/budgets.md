# Budgets — the six clocks

Read before raising any E2E timeout, or when a red looks like starvation rather than a defect.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Budgets — the six clocks, and why each is where it is

A test suite that runs six Electron apps at once creates its own load, and every
timeout in it is really a claim about how slow things are allowed to get under that
load. Spec 034 found **five** such budgets, each sized when the suite was smaller and
quieter, and each only visible once the one above it was fixed.

| Budget | Was | Is | Derived from |
| --- | ---: | ---: | --- |
| test timeout (`playwright.config.ts`) | 30 s | **60 s** | longest legitimate journey observed at six workers ~38 s |
| assertion timeout (`expect.timeout`) | 10 s | **15 s** | the failures that remained after the test timeout moved were 10.0 s exactly |
| app close (`APP_CLOSE_TIMEOUT_MS`) | 10–20 s | **30 s** | `shutdownApp`'s own allowance: 15 s graceful + 10 s `taskkill` = ~25 s, plus margin |
| daemon ready (`DAEMON_READY_TIMEOUT_MS`) | 10 s | **30 s** | a cold Node start + pipe bind + SQLite open on a saturated box |
| terminal output (`TERMINAL_OUTPUT_TIMEOUT_MS`) | 20 s | **30 s** | a 200-iteration `cmd` loop painting through a ConPTY under contention |
| new window (`NEW_WINDOW_TIMEOUT_MS`) | 15 s | **30 s** | a whole second Electron window — renderer, preload and first paint — on a box that has been busy for a quarter of an hour |

Two rules keep this from becoming a habit of enlarging numbers:

- **A timeout here is a HANG DETECTOR, not a performance assertion.** If a test means
  to measure how fast something is, it says so and names the requirement it defends —
  that is what `performance.e2e.ts` is for. A test that fails because the machine was
  busy was never measuring the product.
- **If a spec needs more than these, it is doing too much work for a parallel worker,
  and the tier mechanism applies to it.** Raise the tier, not the number. That is
  exactly how `terminal-find` and `terminal-scrollback-nav` ended up in the serial
  tier: they still failed at a 30 s terminal-output budget, so they stopped running at
  six workers instead of earning a fourth increase.

**The measured effect**, on the sixteen files that were failing, at six workers with
retries off: **20 passed / 14 failed** before, **38 / 0** after.

### The filesystem-poll sweep FILE_OP_TIMEOUT_MS asked for (spec 035)

`FILE_OP_TIMEOUT_MS`'s own docblock deferred a sweep and predicted its consequence:

> roughly a dozen other spec files poll for a filesystem effect on the same 10s budget. They did not
> flake in this run, which is not the same as being right.

One of them then flaked. **32 polls across 13 spec files** now pass `{ timeout: FILE_OP_TIMEOUT_MS }`
instead of inheriting the 15 s assertion budget. Only polls whose predicate calls a `read*(…)` helper
were touched — a poll on a locator or on in-memory state is a different question and was left alone.

**It fixes nothing on its own, and that is stated rather than discovered later.** The spec that
prompted it, `preferences-reset.e2e.ts:187`, is issue #284, and the measurement there is what
matters: it passes in **~760 ms** or exhausts the whole budget. A poll that is bimodal is not waiting
on a slow disk, so the budget was never its problem — raising it changed the failure from 15 s to
30 s and nothing else.

The sweep is kept because it is right for the case the budget exists for — a real `rename` on a real
disk with a watcher waking up behind it — not because it made a red go green.

### The sixth clock, and the route the first five did not cover (spec 035)

034 sized its five against **concurrency** — six Electron apps at once. The sixth was found by a
different failure: `theme-flash.e2e.ts:92` failed a full-gate SERIAL tier, at one worker, on
`app.waitForEvent('window', { timeout: 15_000 })`, and passed on retry.

Measured with retries off, in isolation: **0 failures in 6 runs at one worker, and 0 in 6 at six.**
It does not fail on a quiet box at any worker count. It failed once, seventeen minutes into a serial
tier, on a machine that had already run the parallel tier — so the load that broke it was not
concurrent, it was *cumulative*.

The number itself had no derivation. Sixty-eight `waitForEvent('window')` calls in this suite pass
no timeout and inherit the config's; **eight** pass one, and all eight pin 15 seconds — making them
stricter than the suite's own default, and stricter than its 15 s assertion budget, for the single
most expensive thing a test can ask for. A round number, copied across three files.

Thirty seconds is the same answer `DAEMON_READY_TIMEOUT_MS` gives to the same question, and it is a
hang detector on the same terms: a window that never opens still fails, still inside the 60 s test
budget, and still says "no window appeared".

### Mechanism identifies candidates; measurement decides which need the tier

Worth stating because the obvious inference from the above is wrong and was tried.
Classifying every spec by mechanism gives 88 parallel / 49 real-shell / 98 focus, and
moving all 49 real-shell specs to a two-worker tier was **modelled at ~45.4 minutes
against ~40.3** for the current arrangement — slower, because 28 of the 41 real-shell
specs in the parallel tier run perfectly well at six workers. Only 13 ever failed, and
right-sizing the budgets fixed 11 of those.

This is the other half of the rule already stated above about not drawing the line
from observed failures alone. The mechanism tells you which specs *could* need the
tier. Only measurement tells you which ones *do*.
