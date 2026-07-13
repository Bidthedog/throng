# E2E Audit — what was fixed, what was not, and why

**Feature**: 017 | **Date**: 2026-07-12 | Satisfies **FR-013a**, **FR-013b**, **SC-008**

FR-013a requires that anything left unfixed be **visible rather than silent**. This is that record.

---

## 1. The baseline, and what it actually found

A full E2E run with **retries disabled**, taken before a line of code was written, found **10 tests
failing on their first attempt** — all of them reported green under `retries: 2`.

That is the entire thesis of this feature, measured: the suite was not green, it was *retried* green.
`panes.e2e.ts` — the test #66 is nominally about — happened to **pass** on that particular run, which
is exactly what a flake does. Its fix is justified by the race in its code, not by a reproduction.

## 2. Disposition of the ten

| Test | Root cause | Disposition |
|---|---|---|
| `context-menu:105` click-outside closes | Daemon RPC exceeded its 2s budget under worker contention → the *user action itself* failed | **Fixed** (harness RPC budget, §4) |
| `destroy-cascade:83` mirrored terminal panel | `workspace.loadSubWorkspaces` RPC timed out → app showed "Couldn't create the sub-workspace" → **no window ever opened** → 30s `waitForEvent` timeout. Plus a stray-Enter race. | **Fixed** |
| `performance:72` launch budget | `waitForTimeout(800)` awaiting a layout write **that never happens**, plus RPC timeouts | **Fixed** |
| `persistence-restore:87` per-project layout | Unconditional 800ms sleep standing in for a debounced save | **Fixed** — now polls the SQLite row |
| `persistence-restore:137` corrupt layout | Same sleep — and it corrupted a row that **might never have been written**, so the test could pass for the wrong reason | **Fixed** |
| `phase9:107` panel count | Stray-Enter race: `Enter` before the rename input's `autoFocus` lands re-fires the **add** button | **Fixed** |
| `phase9:136` reorder by grip | RPC budget | **Fixed** |
| `projects:144` edit + delete | RPC budget (surfaced as a 60s hang) | **Fixed** |
| `terminal-slow-start:20` | 400ms attach budget too tight for the *retry*, masked by a vacuous `toHaveCount(0)` | **Fixed** |
| **`terminal-altscreen-parity:104`** | **A PTY resize never reaches the process inside it** | **QUARANTINED — see §3** |

Verification: **45/45** (each fixed test ×5, `THRONG_E2E_RETRIES=0`), then **40/40** running those
files in full (×2) to check for sibling regressions.

An **eleventh** flake was found that was not on the list: `context-menu.e2e.ts` failed in an
`afterEach` with `EPERM` deleting Electron's userData dir — every assertion green, the *cleanup*
failing. Any file using `registerTempCleanup()` could hit it. Fixed in `temp-file-helpers.ts`.

---

## 3. Quarantined: exactly one — and it is a REAL BUG, not a flake

### `terminal-altscreen-parity.e2e.ts` — "a full-screen (alt-screen) program renders identically in two different-sized views"

**Tagged `@quarantine`.** Enumerable at any time:

```bash
THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
```

**Justification.** This test is **not flaky and was never being rescued by retries**. It fails on
*every* attempt — 9/9 across every configuration tried, in isolation and under load, including all
three attempts under `retries: 2`. Arming the gate does not expose it; it was always red. What hid
it is subtler and worse: **a red test inside a suite nobody could trust reads as noise.**

It cannot be made deterministic by any test-side change, because the behaviour it waits for genuinely
does not occur. The test waits for the full-screen program to repaint after the shared grid shrinks
(`toContainText('L1|')`). A program only repaints when the PTY tells it its size changed — and that
is precisely what is broken (§5, bug 1).

**Why the assertion was not weakened to make it pass:** doing so would erase the only coverage of
feature 008's alt-screen invariant *while the defect underneath it survived* — which is how a bug
gets permanently forgotten. Quarantine here is an admission of a real defect, not a timing gap. **It
must be fixed**, and until it is, the lost coverage stays countable rather than invisible.

Note the 008 parity invariant itself still holds: both views were measured at 25×35 rendering
byte-identically. It is the **resize path** that is broken, not parity.

---

## 3a. The long tail — what arming the gate exposed

Arming `failOnFlakyTests` on a suite that had never had a flake gate is a *loop-until-dry* exercise:
each full run surfaces whatever the previous green-by-retry bar was hiding. The first armed run
turned up **four more** tests that failed on their first attempt and recovered on retry —
`app-shell:33`, `editor-indicators:25`, `editor-find:100`, `titlebar-chrome:143`.

Triage found only **one** was a test-level defect. The other three were robust as written, and all
three shared a **single harness cause**:

- **`runApp`'s teardown did an unguarded `rmSync`** of the userData / data / config dirs
  (`harness.ts`). Electron releases its userData lock *asynchronously* after the process exits; under
  worker contention it can still hold the lock when the retries run out, so `rmSync` throws `EPERM` —
  reddening the test on its **first attempt, after every assertion had already passed**. This is the
  same EPERM class §2 records for `context-menu`, but the fix there only landed in
  `temp-file-helpers.ts` (for non-`runApp` specs). `runApp` backs **~40 specs** and never got the
  swallow, so it was a latent flake source for the whole cohort. **Fixed**: best-effort teardown,
  matching the blessed pattern. Nothing leaks — `globalTeardown` removes the per-run folder.

- **`app-shell:33`** (the NFR-002 launch SLA) is a genuinely **load-sensitive budget**, the same class
  as `performance:72` (§5.4). Its hard 5-second wall-clock budget presumes an *unloaded* machine, but
  the suite defaults to six workers, so six Electron apps cold-start at once and the budget times the
  rig, not the app (5.3–6.0s observed). **Fixed without quarantine**: the strict 5s now applies only
  to an *uncontended* run (single worker, not CI) — the sole condition under which the measurement is
  valid, and the canonical way to take the NFR-002 reading (`--workers=1`). A contended or CI run
  keeps generous headroom that still catches a gross regression. This narrows *when* the SLA is
  checked to when it is meaningful; it does not weaken the SLA.

**Flagged, not yet actioned** (it did not flake in the run that surfaced the four, so quarantining it
now would forfeit coverage without cause): `titlebar-chrome:89` ("the cog dropdown menu follows the
active theme") can lose its themed `:hover` if another window steals OS focus under contention — a
class (d) OS-focus sensitivity. A quarantine candidate **if it recurs**.

## 4. The dominant root cause: a liveness budget used as a work budget

Six of the ten failures shared one cause. Every non-attach RPC — `workspace.*`, `projects.*`,
`subworkspace.*` — shares `DEFAULT_PING_TIMEOUT_MS` = **2000ms** (`ui-settings.ts:13`). That is a
*liveness* budget, and it is ample for one app talking to one daemon. The suite runs **six** Electron
apps and six daemons at once, where a round-trip routinely exceeds it. When it does, the RPC rejects
and the app reports a **user-facing failure** for an action that was never broken:

```
Couldn't create the sub-workspace: RPC "workspace.loadSubWorkspaces" timed out
```

…and the spec then fails for a reason unrelated to the behaviour it asserts.

**Fix applied**: the harness raises the budget **for the test environment only**, through the existing
documented seam (`THRONG_PING_TIMEOUT_MS`, `scripts/playwright-global-setup.mjs`). It is overridable,
so a test that wants to exercise the timeout still can.

**This is not a fix for the product concern**, and it is deliberately not pretending to be — see §5,
bug 2. It removes the *harness's own contention* from the tests' results. Six concurrent Electron
apps is a property of the test rig, not of a user's machine.

---

## 5. Product defects found while doing this — reported, NOT papered over

These were surfaced by the triage. **None is fixed by this feature**; all need triage. They are
recorded here because a defect found and silently worked around is worse than one never found.

1. **A PTY resize never reaches the process inside it.** `NodePtyHost.resize()` is called, finds its
   session, and `proc.resize()` returns without throwing — yet the hosted program's
   `getWindowSize()` never changes. Reproducible with **one window, no mirroring**: shrink a terminal
   panel and xterm conforms to the new grid while the program keeps painting for the old one. On the
   normal buffer xterm reflows and hides it; on the **alternate screen** it is exactly the
   "offset lines" symptom feature 008 exists to prevent. Two silent `catch {}` blocks
   (`terminal-service.ts:385-390`, `node-pty-host.ts:151-157`) would swallow any failure here.
   *(node-pty 1.1.0 / Node 24 / Win10 19045.)* **This is what §3's quarantined test is red about.**

2. **The ping budget is being used as a work budget.** 2s for *every* `workspace.*` / `projects.*`
   RPC. Exceeding it fails a **user action** with an error banner. This is the same conflation
   feature 008 already fixed for *attach* — "reusing the ping budget for attach is what made a slow
   shell report a spurious connection timeout" — and it survives for everything else. A user on a
   slow or loaded machine would see the same spurious failures the test rig does.

3. **`TerminalOutputGate` is never released on a failed attach** (`use-terminal.ts:344-355`). A view
   that reports "still starting" buffers every live output chunk **forever** — the terminal is
   permanently blank and deaf even once the session is healthy. Only the retry button, which remounts
   with a fresh gate, recovers it.

4. **`performance:72` does not test what its name says.** No `workspace_layout` row is ever written
   for an unmutated project, so the relaunch restores a **default** workspace, not a saved one. Its
   5s budget also remains genuinely load-sensitive. A finding, not something adjusted away.

---

## 6. Sleeps deliberately left in the suite

FR-013a(c) requires a sleep to be replaced wherever a deterministic condition exists, and **reported**
where one does not.

| Location | Why it stays |
|---|---|
| `destroy-cascade.e2e.ts` — `waitForTimeout(1000)` | It is waiting to observe that **nothing happens** (an unwanted exit→revert does *not* occur). There is no condition to poll for the *absence* of an event; the only honest test is to wait and look. Annotated in place. |
| `destroy-cascade.e2e.ts` — `waitForTimeout(1200)` after a terminal kill, in teardown | Same shape: awaiting OS-level process teardown with no observable condition exposed to the test. Annotated in place. |

Both are waits on the **non-occurrence** of an event, which is the one case a condition cannot express.

The broader sweep (106 `waitForTimeout` occurrences across 39 files at baseline) was triaged by the
rule in `contracts/e2e-harness.md` §3: sleeps standing in for a real condition were replaced; sleeps
awaiting output from a spawned PTY/shell, where no condition is observable, were kept and annotated.

---

## 7. The gate

`failOnFlakyTests: true` in `playwright.config.ts` — in the **config**, not the npm script, because
`test:e2e:admin` and any bare `npx playwright test` bypass the script entirely, and FR-014a permits no
environment in which a flake is tolerated.

**A green run now means every test passed on its first attempt.**

Verified mechanically (T003b):

| Property | Result |
|---|---|
| A `@quarantine` test is excluded from the default run | ✅ 0 listed |
| It does **not** leak into the elevated runner (`THRONG_E2E_INCLUDE_ADMIN=1`) | ✅ 0 listed |
| It is **enumerable** on demand | ✅ 1 listed |
| `@admin` is still opted back in for the elevated runner | ✅ 1 listed |

The second row is the one that matters: folding `@quarantine` into the existing `@admin` ternary —
the obvious implementation — would have set `grepInvert` to `undefined` in the elevated runner, so
quarantined tests would have run there and reddened it.
