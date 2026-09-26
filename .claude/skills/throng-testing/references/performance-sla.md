# Where a performance SLA is measured

Read before writing or changing any wall-clock assertion in an E2E, or when an `sla-not-measured` annotation appears in a report.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Where a performance SLA is measured

**A wall-clock SLA is asserted only where the reading means something, and skipped — never relaxed —
everywhere else.**

A performance ceiling compares the product against a requirement, and it can only do that on
hardware the requirement describes. 001 SC-001 says so in as many words: *"in under 5 seconds on a
typical modern Windows machine."* Asked on a contended runner or a deliberately slow test VM, the
same assertion does not report a slow product. It reports a slow computer, in the shape of a test
failure, and nothing downstream can tell those apart.

`expectWithinSla` (`packages/ui/tests/e2e/helpers/sla.ts`) asserts when all three hold:

| condition | why |
|---|---|
| `workers === 1` | Six Electron apps at once measures the rig, not the app |
| not `CI` | A shared hosted runner is contended by construction |
| not `THRONG_NON_REFERENCE_HARDWARE` | The machine must be one the requirement is about |

Otherwise it records an **`sla-not-measured` annotation carrying the number it would have asserted**,
so the measurement still appears in the report and is simply not adjudicated there. A silently
absent assertion is indistinguishable from one that passed, which is how a suite comes to believe it
checks something it stopped checking.

**Relaxing was tried and is worse.** `app-shell` used to fall back to a 20 s ceiling under
contention — wide enough to pass essentially anything, so it defended nothing while looking like it
did. Two budgets for one requirement also means nobody can say which one the requirement made.

The seven SLAs currently under this rule: **NFR-002** (shell opens), **001 SC-001** (launch to
painted panel), **SC-002** (daemon-death notice), **SC-003** (first highlight), **SC-007** (find on a
10k-line file), **SC-012** (main-thread stall switching to a tab of four terminals), and **FR-008**
(keystroke into a 10 MiB document, and no long task at all).

**Every one of them lives in the SERIAL tier, and that is a requirement rather than an accident.**
`workers === 1` is one of the three conditions above, so an SLA spec in the parallel tier asserts
nothing in any run — not on a reference machine, not anywhere — while still reading like a test.
`app-shell`, `performance` and `terminal-activation-cost` were exactly that for one branch, which is
why `parallel-plan.json` carries a TIMING mechanism: a wall-clock ceiling and a concurrent tier are
mutually exclusive by construction.

**The consequence, which is the point rather than a side effect:** if the full suite only ever runs
on non-reference hardware, these seven are never adjudicated. Taking the reading is therefore a
deliberate act on a reference machine:

```bash
npx playwright test packages/ui/tests/e2e/performance.e2e.ts --workers=1
```

with `CI` and `THRONG_NON_REFERENCE_HARDWARE` both unset. Any host that is not a reference machine
should set `THRONG_NON_REFERENCE_HARDWARE=1` at machine **and user** scope — on Windows the User
value overrides the Machine one, so setting only the latter has no effect on a logged-in session.

Requirement citations are enforced by `SlaReading.requirement`, a required field, rather than by the
comment scanner in `wall-clock-declared.test.ts`. That scanner still governs every raw
`toBeLessThan` in the E2E specs — the bounds that are *not* durations, and the validity-bounds that
separate two outcomes rather than asserting a speed.
