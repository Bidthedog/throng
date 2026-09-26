# No headless mode

Read before proposing hidden, off-screen or `show: false` E2E windows.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## No headless mode

The E2E app runs with **real, on-screen windows** — there is no headless mode, and no
`show: false` seam exists to make one. Runs still work unattended on CI (the runner has a virtual
desktop) and locally; expect windows to appear while a run is in progress.

**Terminals are the reason usually given, and they are the weakest one.** The inline **xterm.js
terminals only mount and drive their ConPTY in a genuinely visible, painting window** — a hidden
(`show: false`), off-screen, or transparent (`opacity: 0`) window blanks them, so the terminal never
spawns its PTY and the spec fails. True, but it only covers the specs that drive a terminal: **36 of
145 spec files (25%)** as of 2026-07-17. On its own it invites the obvious question — *why not run
the other 75% hidden?* — so here are the reasons that actually carry the weight:

- **The terminal-free set is not paint-free.** 23 spec files call `boundingBox()`, 13 drive
  `page.mouse.*`, one takes a screenshot, one uses `geom()`. Hidden-mode eligibility is a property of
  **what a spec asserts**, not of which file it lives in — so it cannot be derived, only hand-tagged.
- **A hand-applied tag rots silently.** The first `boundingBox()` added to a "hidden-safe" spec breaks
  it, and because `failOnFlakyTests` is armed ([flakes.md](flakes.md)), that rot arrives as a **red run**.
- **The drag ghost is a real OS window.** `drag-ghost.e2e.ts` asserts `w.isVisible()` on it and reads
  its painted style, and `ghost-window.ts` positions it off the **real cursor** via
  `screen.getCursorScreenPoint()` — which Playwright's synthetic mouse never moves.
- **The cost is launch, not paint.** A run performs **382 Electron launches** — measured 2026-08-18
  at 229 spec files / 640 declarations by `node scripts/count-e2e-launches.mjs`, down from 592 on
  the pre-034 baseline `d55054b` — against a ~5s launch budget (001 SC-001, asserted by
  `performance.e2e.ts`); the worker benchmark below concludes the constraint is
  per-worker Electron + daemon **processes**, and CI's floor is a ~3–4 min `npm ci` + build toll
  *before a test runs* (#103 — paid three times, once per shard, until spec 034 deleted sharding and
  made it one). **Nothing in this repo measures compositing cost at all** — so hiding windows targets
  a cost that has never been shown to exist.

The trade being refused is therefore: **maintain a second harness, plus a production `show: false`
branch that only test runs take, to speed up a minority slice of a suite whose cost is process
startup — and never again be able to answer "does the hidden path test the same thing the headed one
does?" without running both.**

This was reasoned through on **#75** (answered "don't", 2026-07-16) and is out of scope on **#103**.
Both are worth reading before re-opening it — but note that neither ever *measured* anything, and
#103's "51% of specs drive terminals" is not reproducible (25% is; the figure appears to come from a
case-insensitive `pty` grep also matching "empty"). **#117 re-opens the question empirically**, and is
where the evidence should land.
