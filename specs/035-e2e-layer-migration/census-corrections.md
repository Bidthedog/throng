# Census corrections — what changed once both sides were actually read

**This file is the record FR-022 requires**: every census verdict ends applied, or declined with a
reason. It exists because the first three verdicts checked in depth each needed correcting, in three
different ways — which is a finding about the census, not about these three tests.

## Why this file is not a list of mistakes

The census read 229 files and 688 tests with five assessors, and its **classification** has held up:
every verdict below was pointing at something real. What did not hold up is the **confidence attached
to the citation.** An assessor reading an E2E test and a candidate covering test can see that they
are about the same subject; whether one *subsumes* the other is a different question, and it is only
answerable by reading both sets of assertions and asking what each can and cannot prove.

That is exactly what FR-005 and FR-020 were written to force, and the record below is the evidence
they were worth writing.

---

## 1. `config-files.e2e.ts:11` → APPLIED, with a correction the census missed

**Verdict**: DELETE-DUPLICATE of `shipped-defaults-startup.e2e.ts:70`. **Correct.** The deleted test
asserted three files exist and that `settings.json` carries two named properties; the covering test
asserts settings and keybindings **byte-for-byte** against the shipped record, plus the version
marker and the exact theme set. A byte-for-byte assertion strictly subsumes an existence-and-property
one.

**What the census missed**: the deleted test was `@core` and its replacement was `@extended`.
Deleting it as written would have silently dropped first-run coverage out of the lane that gates
every push — and a broken first run is not a thing to discover at release. The covering test was
**promoted to `@core`** in the same commit. `@core` stays at 35 of its cap of 50.

**Lesson**: a duplicate is only a duplicate if the covering test runs in at least the same lane. The
census compared assertions and never looked at tags.

---

## 2. `new-project-folder.e2e.ts` ×4 → APPLIED, but the citation was wrong

**Verdict**: DELETE-DUPLICATE of `core/tests/unit/starting-folder.test.ts`. **Survived, but not for
the stated reason.**

`resolveStartingFolder` is pure and returns a candidate **list**. Its own documentation says
existence "is verified in UI-main". Two of the four E2E tests turn on precisely that existence step —
"an unresolvable override cascades to the last-viewed folder" is a claim the ordering test provably
cannot make, because ordering is all it knows.

The verdict survives only because a **second** unit test exists that the census never cited:
`ui/tests/unit/pick-folder.test.ts:21` ("cascades a candidate list, using the FIRST that exists as a
directory") and `:32` (falls back to home when none resolve). The correct citation is two files.

**And a third thing was true of neither**: that the candidates reach the resolver and the resolver's
answer is what the dialog actually opens at. A handler that resolved correctly and then opened
somewhere else satisfies every unit test above. That wiring had no home below E2E, so the handler
body was extracted from `main.ts` into `pick-folder.ts` behind injected dependencies and covered by
`pick-folder-ipc.contract.test.ts` — red-proven by resolving correctly and opening at home anyway
(3 of 6 fail; the 3 that pass are the cases where home *is* the right answer, so they genuinely
cannot distinguish).

**Lesson**: "the logic is unit-tested" and "the feature is covered" are different claims, and the gap
between them is the wiring. This is the spec's central thesis meeting its first real case.

---

## 3. `notice-subjects.e2e.ts:297` → DECLINED

**Verdict**: DELETE-DUPLICATE of `core/tests/unit/notice/subject.test.ts:285`. **Overstated.**

The unit test asserts that `formatSubject` renders from subject **values** rather than from how a
call site spelled them — it calls one function twice with differently-padded but equivalent input.
That proves the formatter is deterministic and whitespace-insensitive.

The E2E asserts something the unit test does not reach: that **two different real failure paths** in
the running explorer — rename-to-existing and rename-to-an-invalid-name — produce two notices whose
messages differ and whose titles are character-for-character identical. One function called twice
inside a test is not two call sites agreeing in production.

There may well be a cheaper home for it than E2E — a component or integration test driving both
failure paths against a fake bridge is plausible. But that is a **different migration** from the one
the census recorded, and applying the recorded verdict would have deleted coverage that nothing else
holds.

**Status**: left as-is. Not a KEEP-forever judgement — a decline of *this* verdict, pending an
assessment of the component route.

---

## 4. `status-bar.e2e.ts` (both tests) → APPLIED as MOVE-COMPONENT

Every assertion in the file was presence, absence or text — no geometry, no computed style, no
second window. `StatusBar` reads one value and renders a span. Replaced by
`component/status-bar-content.test.ts`, red-proven by making the component render the project
**name** instead of its root folder (2 of 3 fail).

**Two things the migration exposed that the E2E had hidden:**

- The E2E carried a warning in capitals — *"ORDER IS LOAD-BEARING, and nothing enforces it"* —
  because under one shared app its first test asserted a **startup** condition and only the first
  test in the file could make it. At component layer there is no shared startup to be first in: "no
  project" is a value passed in, not a moment in time. The hazard does not need mitigating; it stops
  existing.
- `activeProject` does **not** come from the `isActive` flag on the project row. It is derived from
  `openedId` — per-**window** renderer state that only `switchProject` sets — because which project
  the database considers active and which one *this window* is looking at are different questions,
  and a second window is why. The E2E never had to know: `createProject()` switched as a side
  effect. Seeding `isActive: true` and expecting a path is the mistake that shape invites, and it
  failed here rather than passing for the wrong reason.

**And one fixture bug of my own, worth recording** because it is the failure mode this whole spec is
about. I first wrote the project root as `D:/work/Bartholomew` — a path containing the project name —
which makes "the bar does not show the name" impossible to satisfy while the path is displayed. The
E2E avoided it by accident, its root being a `mkdtemp` path. A fixture bug that looks exactly like a
product bug, caught by one red run.

---

## 5. Phase 0 — the eleven unresolved items, settled by reading both sides

The census's own low-confidence list. **Nine of the eleven resolve to KEEP-E2E**, and three of the
citations were simply wrong:

| Item | Outcome | What reading found |
|---|---|---|
| `active-panel.e2e.ts:53,74` | KEEP | The unit test is a pure reducer over in-memory layouts — no click, no rendered class, no tab switch. **The suspicion was filename-driven**, exactly as feared. |
| `preferences-themes.e2e.ts` ×4 | KEEP | `mountLive()` stubs only `write` — no `get`/`onChange` — so `ConfigProvider` never adopts and nothing repaints. Its own header says it "stubs only the process boundary". |
| `preferences-settings.e2e.ts:112` | KEEP | Same shape; no live write-and-adopt harness exists. |
| `explorer-live-sync.e2e.ts:113,145` | KEEP, **citation wrong** | Two different bugs live in one file. `:69`/`:92` are the debounce fence as claimed; `:113`/`:145` cover a still-uncovered defect (`remove()` never calls `reloadDirs`). The cited test covers a different component at a different layer. |
| `editor-move-repoint.e2e.ts:239` | SPLIT | The disk half is proven **more strongly** at integration under a harder race. The UI dirty-badge half is E2E-only. |
| `preferences-map-control.e2e.ts:152` | **citation wrong** | The cited file is about concurrency and corrupt documents. The real cover is `reset-ipc.test.ts:211`, whose whole-document deep-equal already subsumes both maps. |
| `theme-sweep:113`, `icon-colour:145` | KEEP | Both turn on **stale custom-property leakage across a live theme switch** — a cascade behaviour no lower layer sees. |
| `fileop-lock-cause.e2e.ts:209` | KEEP, not yet deletable | `TerminalService` *can* stand up without a full daemon (proven by an existing harness), so a replacement is feasible — but nobody has written it, and the rule forbids deleting before it exists and fails. |
| `projects.e2e.ts:273` | KEEP | `isActive` really is SQLite-persisted, so a cheap durability test is possible — but it would not cover the UI restoration the E2E also proves. |
| `editor-stranded-recovery.e2e.ts:185` | KEEP | A **deliberately** split pair; the integration sibling's header says so in as many words. |
| `quick-open.e2e.ts:386` / `:549` / `menu-keyboard.e2e.ts:145` | KEEP / MOVE / KEEP | `:549` is a straightforward move — the exclusion mechanism is already proven at component layer and the test needs no Quick Open at all. |

**Two movable out of eleven.** The census flagged these precisely because its confidence was low, and
low confidence turned out to correlate with *irreducible*, not with *unexamined*.

---

## The pattern, stated plainly

Three verdicts examined in depth; three corrections:

| | Verdict | Outcome | What was wrong |
|---|---|---|---|
| 1 | DELETE-DUPLICATE | applied | lane loss unnoticed — `@core` → `@extended` |
| 2 | DELETE-DUPLICATE | applied | citation incomplete; a whole wiring span uncovered |
| 3 | DELETE-DUPLICATE | **declined** | covering test proves a weaker claim than assumed |

**None of the three was safe to apply as written.** That is not an argument against the census — it
found and classified all 688 tests, which is what made any of this possible. It is an argument for
the rule the spec already carries: *a verdict is a hypothesis until both sides have been read*, and
the reading is where the actual engineering is.

It also means the projected count in SC-001a should be read as an upper bound on removals rather than
a target. If a meaningful share of DELETE-DUPLICATE verdicts turn out to be SPLIT or KEEP on
inspection, the suite lands higher than ~500 — and that will be reported as the finding it is, not
absorbed.

## 6. How reproducible is a reserve tag? Measured, by accident

One group of 44 files was read **twice, independently** — the first reader's results were nearly lost
to a messaging failure, so a second was dispatched with the same brief and no knowledge of the first.
That accident produced the one measurement nobody had thought to take: **do two careful readers agree
on why a test is irreducible?**

Across ~137 comparable declarations they agree on roughly **85%**. That is high enough for the tag to
be worth having and low enough that "a reviewer can check the claim" matters more than it sounds.

**The disagreements are not scattered — they are almost all the same disagreement.**

| | first read | second read |
|---|---:|---:|
| `@reserve:runtime` | 8 | ~24 |
| `MOVABLE:integration` | 16 | 2 |

Nearly every conflict is one reader writing `@reserve:runtime` where the other wrote
`MOVABLE:integration`, over the same class of test: a settings write that hot-reloads into a running
window, a name claimed through the daemon and broadcast back, a persisted value surviving a store
round trip. `tab-name-limit.e2e.ts` alone accounts for five of them.

The second reader stated its reasoning unprompted, and it is a fair argument: *"those tests' claim is
a real settings/DB write reaching the running app through its real watcher or daemon IPC."*

### Why this is the most useful thing the tagging produced

That is **the spec's central question**, arriving from a direction nobody arranged. The census's
largest keep-at-E2E bucket was "the wiring is live", and 035 rejected it as an entry on the grounds
that wiring decomposes into spans that already have homes. Two careful readers, given the finished
vocabulary and no argument about it, split on exactly that seam.

So the boundary is genuinely contested by people acting in good faith — which is worth knowing before
anyone treats a `@reserve:runtime` tag as settled.

**And the branch has one data point on which side wins in practice.** `new-project-folder.e2e.ts`
was four tests of precisely this shape — a real cascade resolved against a real filesystem, reached
through the running app. It read as irreducible for two releases, and it stopped being irreducible
the moment the handler grew a seam: the contract test drives the real resolver against a real temp
directory with no window at all. The obstacle was never "a real filesystem". It was that the code had
no seam, which is a fact about the code rather than about the layer.

That is one case, not a law. But it points the same way as the rest of this file: **when a
`@reserve:runtime` claim is examined closely, it tends to become a missing seam.**

### What follows for the tag

`@reserve:runtime` should be read as the least settled entry in the vocabulary, and a test carrying
it is the best candidate for a second look rather than the worst. The other entries did not behave
this way — `@reserve:pty`, `@reserve:layout`, `@reserve:window` and `@reserve:input` agreed almost
perfectly across the two reads, because what makes a test need a real shell, a real cascade, a real
second window or a real keystroke is not a matter of opinion.

---

## Where the number is actually heading

Phase 0 is the first sample large enough to say something. Eleven items examined, **two movable** —
and those eleven were the census's *own* low-confidence list, so if anything they were the tests most
likely to move.

Set against the five assessors' consistent ~70% KEEP, that points the same way from a second
direction: **~500 is optimistic.** A more honest reading of the evidence so far is that the suite
lands somewhere in the 550–620 range on migration alone, and that the substantial reduction has to
come from Phase B — building the contract layer so the wiring justifications stop being true —
rather than from applying census verdicts one at a time.

That is not a retreat from the spec's goal. It is the spec's own thesis arriving earlier than
expected: **the migrations were never where the tests were hiding.** `pick-folder` is the worked
example — four E2E tests did not come down because someone finally read them carefully, they came
down because the code grew a seam and a contract test could then hold what only a window could hold
before.
