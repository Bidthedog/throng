# Budgets — the six clocks

Read before raising any E2E timeout, or when a red looks like starvation rather than a defect.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Budgets — the six clocks, and why each is where it is

A test suite that runs several Electron apps at once creates its own load, and every
timeout in it is really a claim about how slow things are allowed to get under that
load.

| Budget | Value | Derived from |
| --- | ---: | --- |
| test timeout (`playwright.config.ts`) | **60 s** | longest legitimate journey observed at six workers ~38 s |
| assertion timeout (`expect.timeout`) | **15 s** | the failures that remained at a 10 s assertion budget were 10.0 s exactly |
| app close (`APP_CLOSE_TIMEOUT_MS`) | **30 s** | `shutdownApp`'s own allowance: 15 s graceful + 10 s `taskkill` = ~25 s, plus margin |
| daemon ready (`DAEMON_READY_TIMEOUT_MS`) | **30 s** | a cold Node start + pipe bind + SQLite open on a saturated box |
| terminal output (`TERMINAL_OUTPUT_TIMEOUT_MS`) | **30 s** | a 200-iteration `cmd` loop painting through a ConPTY under contention |
| new window (`NEW_WINDOW_TIMEOUT_MS`) | **30 s** | a whole second Electron window — renderer, preload and first paint — on a box that has been busy for a long run |

Two rules keep this from becoming a habit of enlarging numbers:

- **A timeout here is a HANG DETECTOR, not a performance assertion.** If a test means
  to measure how fast something is, it says so and names the requirement it defends —
  that is what `performance.e2e.ts` is for. A test that fails because the machine was
  busy was never measuring the product.
- **If a spec needs more than these, it is doing too much work for a parallel worker,
  and the tier mechanism applies to it.** Raise the tier, not the number. That is
  how `terminal-find` and `terminal-scrollback-nav` ended up in the serial tier.

### Filesystem polls use `FILE_OP_TIMEOUT_MS`

A poll whose predicate calls a `read*(…)` helper — waiting on a real `rename` on a real disk with a
watcher waking up behind it — passes `{ timeout: FILE_OP_TIMEOUT_MS }` instead of inheriting the
assertion budget. A poll on a locator or on in-memory state is a different question and keeps the
default.

**A bimodal poll is not a budget problem.** If a poll either passes quickly or exhausts the whole
budget, raising the budget only moves the failure later (issue #284, `preferences-reset.e2e.ts`).
Find what it is actually waiting on.

### Window waits use `NEW_WINDOW_TIMEOUT_MS`

`app.waitForEvent('window', …)` passes `NEW_WINDOW_TIMEOUT_MS` or no timeout at all — never a tighter
round number. Load late in a long serial run is *cumulative*, not concurrent, so a window wait that
passes on a quiet box at any worker count can still fail there. A window that never opens still
fails, inside the 60 s test budget, saying "no window appeared".

### Mechanism identifies candidates; measurement decides which need the tier

Classifying every spec by mechanism (real shell, focus) names the specs that *could* need the serial
tier. Only a run showing them fail under parallel load says which ones *do* — moving every real-shell
spec to a smaller tier is slower overall, because most of them run fine in parallel once the budgets
above are right.
