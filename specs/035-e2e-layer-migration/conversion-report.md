# The conversion, measured (T066, FR-021)

**689 → 617 E2E declarations. 72 removed, and 272 written below E2E to replace them.**

Every number here comes from counting declarations in the files as git holds them, at the branch's
merge-base (`3d0803a6`) and at `HEAD` — not from adding up what the commit messages claimed.

## By layer

| layer | at merge-base | now | change |
|---|---:|---:|---:|
| unit | 2444 | 2513 | **+69** |
| component | 390 | 576 | **+186** |
| integration | 474 | 478 | **+4** |
| contract | 83 | 96 | **+13** |
| **below E2E, total** | **3391** | **3663** | **+272** |
| **E2E** | **689** | **617** | **−72** |

E2E spec **files**: 229 → 214. Fifteen files went entirely.

## What the ratio means, and what it does not

**272 replacing 72 is not inflation.** Three things produce it, and only the first is a
straight swap:

1. **One E2E test is usually several claims.** `terminal-title-persist.e2e.ts` was one declaration
   and became eight, because the store it was about has a cap, a clear-on-empty rule, a
   per-panel rule and a disposal rule that the E2E never touched — it could only afford to assert
   the one path a real shell had walked it down.
2. **The red step kept finding holes behind true citations.** Several replacements are not
   migrations at all but coverage that never existed, written because the migration could not
   honestly proceed without them. See below.
3. **A few migrations are narrowings, not moves** — the combinatorics go down, one witness stays.
   Those subtract from neither column.

## Where the component tier came from

**+186 of the +272 is component**, and that is the single clearest result of the spec. Three
components had been written off as unmountable and all three mount in jsdom:

| component | what it actually needs |
|---|---|
| `PanelPlaceholder` | six providers; only `useProjects` throws without one |
| `TabGroup` | the same six; no props, brings its own `DndContext` |
| `PreferencesApp` | **none at all** — it is the window's root and mounts its own six |

One of those judgements had been written into a test header as though it were measured. Re-testing
it reopened roughly seventy verdicts.

## The holes found on the way

These are the ones where a verdict named a covering test, the citation was TRUE, and the seam
between the two halves was untested anyway. Each was measured, not suspected:

| what | the measurement |
|---|---|
| the config store ADOPTING a written document (#50's consumer half) | deleting it left **all 37 tests** across the two ordering files and the settings-search file green |
| `panel-name-adjusted` — the notice, the FR-023 wording, and the broadcast carrying the granted name | the testid appeared in exactly two places in the repository: the component that raises it, and the E2E |
| `useFileIndex` — every rule in its own comments | the hook had no test file at all; both sides of it were well covered |
| `DaemonClient` ↔ `isTransportFailure` | the unit test asserted `'ENOENT'` as *"what a dead pipe produces"* — an assumption about a real dependency, written down as fact and never measured |

**Three of those four came from a citation that was accurate.** "Both halves are tested" did not
once imply the seam between them was.

## Two tests that were written and then deleted by their own red step

Recorded because the count above would otherwise flatter itself:

- a picker test for an opener removed mid-flight — **both** guards it covered turn out to be
  unobservable in jsdom (`.focus()` on a detached element and on `body` are each a silent no-op), so
  it passed under its own mutations;
- earlier in the branch, six more were caught the same way and narrowed rather than removed.

## Against the projection

The spec projected roughly **500** surviving E2E declarations. The suite is at **617**, so this is a
**shortfall of about 117**, and FR-021 asks for it to be named rather than rounded.

The shortfall is almost exactly the backlog that is still live: **119 verdicts still point at a test
declaration that exists** (58 component, 61 integration). They are enumerated in
`movable-backlog.md`; none has been silently dropped.

Two things are worth saying about why they are still there rather than done.

**The rate was deliberate.** Every migration in this session was red-proven, and that step changed
the outcome — it found four untested seams, deleted two of my own vacuous tests, and corrected three
mutations that looked like evidence and were not. A faster pass would have hit the projection and
would have been worth less.

**The remaining integration verdicts are the contested ones.** `census-corrections.md` records that
two careful readers agreed on ~85% of reserve justifications and that nearly every disagreement was
the same disagreement — `@reserve:runtime` where the other read `MOVABLE:integration`. The channel
derivation settled the general question (the wiring is covered) and this session then demonstrated
three times that the general answer does not license a per-test conclusion. Declining 61 verdicts on
the strength of an argument I had just watched fail three times would have been the wrong call.
