# Phase 0 Research: Settings Write Integrity

**Feature**: 032-settings-write-integrity | **Date**: 2026-08-14

Everything below was established by reading the code and running the suite, not by inference. Where
something is still a hypothesis it says so, because the constitution forbids asserting a root cause
without a reproducing test or an instrumented probe.

## R1. What actually happens — established

`writeConfig(id, json)` (`packages/ui/src/renderer/config/write-config.ts`) is the single chokepoint
for every configuration write, and its parameter is **the whole document, already serialised**. Both
of the writers implicated in the reported bugs therefore rebuild the entire settings document from a
copy they hold locally:

| Writer | Location | What it serialises |
|---|---|---|
| Preferences apply-client | `preferences/apply-client.ts:31` | `applyNow(value)` — documented as "Apply a whole document immediately" |
| Main window, project create | `sidebar/projects-panel.tsx:207` (`writeConfig` at :210) | `{ ...settings, newProject: { ...} }` — the whole doc, to change one key |

`write-config.ts` already solves this **within one window**. Issue #50 was the same defect, and its
fix is still there: writes are chained per document so they cannot land out of order, and every
successful write is republished to `onConfigWritten` so the window's own store adopts it at once
rather than waiting for the filesystem. The module comment states the problem in the exact terms of
this spec — "an edit made inside that window used to be computed from the PRE-edit copy and would
silently revert the edit before it".

**`onConfigWritten` is a module-scoped `Set`.** Each window loads its own instance of the module, so
that republication never crosses a window boundary. Another window learns only when the config
watcher re-reads the file and broadcasts — the ~45 ms measured in #249, longer under load. #249 names
this correctly: it is "the cross-window shape of #50".

Nothing in the main process closes the gap either. `writeConfigDoc`
(`packages/ui/src/main/config-write-ipc.ts`) validates, confines and persists atomically, and then
returns. It notifies no window. Propagation is left entirely to `startConfigWatcher`
(`packages/ui/src/main/config-watcher.ts`), which re-reads and broadcasts only when the watcher
fires.

## R2. Why #260 leaves the setting at its *default* — hypothesis, not yet proven

`startConfigWatcher` re-reads via `readConfigPayload`, which calls
`store.read({kind:'settings'}, DEFAULT_APP_SETTINGS, parseSettingsGuarded)`. The guarded parser
*corrects* a bad document rather than reporting that it could not read one. So a read that catches a
**partially written** file plausibly yields `DEFAULT_APP_SETTINGS` and broadcasts those as if they
were the user's settings.

Two things make that fit #260 unusually well: the reported symptom is specifically "leaving the
setting at its **default**" rather than at its previous value, and `startConfigWatcher` re-reads
**only** when the watcher fires again — so a single bad read strands every window on that payload
indefinitely. #253 records the same shape from the test side: "the event is lost, not late", and
"nothing then re-reads".

**Status: CONFIRMED by instrumented probe** — `packages/ui/tests/integration/config-watcher-partial-read.test.ts`,
run against HEAD on 2026-08-14. It is no longer a hypothesis, and the constitution's bar for calling
something a cause is now actually met.

What the probe observed, deterministically and in 7 ms:

```
the user's real settings are replaced by the DEFAULTS when the read catches a partial write
AssertionError: expected 'dismiss' to be 'never'
```

A settings file holding `notifications.error.mode: "never"` is caught mid-rewrite; `readConfigPayload`
returns the **shipped default** `dismiss`, reports nothing, and offers the caller no way to tell that
from a document that genuinely says `dismiss`. Four partial states behave identically — empty,
truncated mid-object, truncated mid-string, whitespace-only — while an *absent* file and a merely
*corrected* one correctly do not report unreadable, so the signal is specific rather than a blanket
failure.

This is a stronger result than the E2E reproduction and worth noting as such: it is deterministic,
where the cross-window clobber depends on winning a ~45 ms race. #260's reported symptom — the
setting sitting at its **default** rather than at its previous value — is explained exactly.

## R3. Decision — how to stop a write clobbering another key

**Decision: send what changed, not the whole document.** Add a patch-shaped write to the IPC contract
(`{ kind, changes: [{path, value}] }`). The main process reads the document's current persisted
content, applies the patch to *that*, and writes the result atomically. The renderer stops being the
place where a document is assembled.

**Rationale**: it removes the defect by construction rather than narrowing it. Every alternative
below leaves a window in which a stale copy can still win; this one has none, because the caller
never supplies the keys it did not change. It also matches the spec's recorded assumption exactly —
a conflict is scoped to the key, and two writers touching different keys stop being a conflict at all.

**Alternatives considered:**

- *Broadcast the written document to every window immediately on success (extend #50 across
  windows).* Rejected as the primary fix, adopted as a **secondary** improvement. It shrinks the
  gap from a watcher debounce (~45 ms) to an IPC round trip (~1 ms), which is a real improvement for
  UI freshness, but it does not close it: a write computed inside that smaller window still clobbers.
  A fix that makes a race rarer is the fix that makes it a Heisenbug. Worth doing for freshness;
  not worth pretending it is a fix. **Status: no task implements it.** It is either done or filed as
  an explicit deferral under the Incremental Delivery rule — T048 forces that decision rather than
  letting "adopted as a secondary improvement" quietly mean "forgotten". FR-004's 100 ms bound may
  depend on it, which is the reason the decision cannot simply be dropped.
- *Optimistic concurrency — stamp a version, reject a stale write, retry.* Correct, and rejected as
  disproportionate. It adds a version to every document and a retry loop to every caller, to solve a
  problem the patch shape does not have. It would also surface conflicts the user has no way to act
  on.
- *Serialise all writes through a main-process queue.* Already effectively true — writes are
  serialised per document — and it does not help: ordering was never the problem. Both writes land,
  in order, and the second one is built from stale input.

**Scope note.** The whole-document write is **kept for exactly one settings caller**: the preferences
JSON tab, where the user is editing the raw file by hand. Last-write-wins is the correct semantic
there, and forcing a patch shape onto it would be a lie about what the user did. FR-001 carves it out
in the requirement rather than leaving it as an unstated exception.

Two writers were initially kept on this reasoning and should not have been. **Revert All** restores a
snapshot of the preference *editors*, but the settings document also carries main-window state, so
replacing it wholesale discards a project folder chosen after Preferences opened (FR-001a). And the
main process's **`resetSetting`** was never examined at all — the first two audits grepped only the
renderer, and it has the same read-modify-write shape plus a defaults fallback that makes a reset
against a corrupt file replace every other setting (FR-001b). "Retained by design" is a claim that
has to be earned per writer, not applied to a category.

## R4. Decision — recovering from an unreadable read

**Decision: distinguish "parsed as defaults" from "could not be parsed", and re-read on the latter.**
The guarded parser must be able to report that it corrected an unparseable document, and the watcher
must retry a bounded number of times rather than broadcasting the correction.

**Rationale**: FR-008 requires recovery without a further write. Today recovery depends on somebody
touching the file again, which is exactly the condition that does not hold — the writer has finished.

**Alternatives considered:** *always re-read once after a debounce* — cheaper to write, but it doubles
every legitimate read and still guesses; *hold the last good payload and ignore a defaults-shaped
one* — silently wrong the first time a user genuinely resets everything to defaults.

## R5. Decision — the test-side atomic write

**Decision: hoist the atomic write already proven in `helpers/tab-settings.ts` (fixed under #243)
into one shared helper, and convert `preferences-json.e2e.ts` (lines 122 and 151).** Include the
bounded rename retry: on Windows a replace-rename fails with EPERM/EACCES/EBUSY while the app under
test holds the target, so without the retry this trades a lost-event flake for an EBUSY flake.
`renameWithRetry` at `packages/ui/src/main/config-store.ts:43` solved the identical problem under #75
and is the model.

**Correction — #253 is wrong about one of its two call sites.** The issue names
`preferences-settings.e2e.ts:378` as a non-atomic write to a running app. It is not: the write is a
`writeFileSync` **before** `runApp`, under the comment "Seed a malformed file before launch". No
application is running, no watcher exists, and no race is possible. Line 324 is the same shape. So
the only genuine running-app writes in the repository are the two in `preferences-json.e2e.ts`, and
converting the pre-launch seeds would be work with no subject (Principle VIII). The issue is to be
corrected rather than silently worked around — T034.

## R6. #250 — method, not a fix

The cause is unknown and this plan does not pretend otherwise. Measured this session: the 15
preferences/notification specs run together, one worker, retries off, gave **94 passed, 0 failed, 0
flaky in 5.1 minutes**.

What that measurement supports is exactly one claim: **it does not reproduce in the preferences
subset.** It does *not* establish that the full 116-spec serial tier is required — "the perturbing
spec is elsewhere in the tier" and "it does not currently reproduce at all" are equally consistent
with 94/94 green. An earlier draft asserted the first as fact. T041 is what distinguishes them.

The method is a group-level bisect: halve the serial tier scheduled alongside `preferences-reset`
until the perturbing spec is identified. #211 is the precedent — "the app-shell startup test times
out once per full E2E run, and the cause is outside the test" — diagnosed and closed rather than
papered over.

A retry, a longer timeout or an added wait are all excluded in advance. They would remove the symptom
without touching the cause and leave the real defect free to surface elsewhere.

**Plausible convergence, not assumed:** if the perturbing spec turns out to be one that writes
settings, R3's fix may resolve #250 outright. The task ordering puts the bisect after the R3 work so
that possibility is cheap to check, but the bisect runs either way.

## R7. Where the failure notice must be mounted

`useConfigWriteFailureNotices()` is mounted only in the Preferences window, so a write issued from
the main window reports its failure to nobody. This is recorded as G-09 in spec 030's FR-017 audit
and named in #249's body.

**Decision: mount the subscriber wherever a window can issue a write. No cross-window
de-duplication, because none is needed.**

An earlier draft required "one notice, not one per window" and proposed reusing spec 030's
`notice-suppression.ts` and `subjectOf()`. Both halves were wrong. `subjectOf` is a **private,
unexported** function in the *main-process* module `packages/ui/src/main/files-service.ts:557` and
cannot be imported from a renderer at all. And the requirement was solving a problem that does not
arise: each window is a separate renderer process with its own module-scoped listener set, so
`writeConfig`'s failure publication reaches only the window that issued the write. One failed write
already yields exactly one notice, by construction. Cross-process dedup is neither implementable in
this architecture nor necessary — FR-011 was rewritten to say what is actually true.

## R6a. #250 — measured, and it does not reproduce in the serial tier

Two attempts so far, both against HEAD with retries off. Recorded here because a negative result that
is not written down gets re-derived.

| Attempt | Condition | Result |
|---|---|---|
| baseline | 15 preferences/notification specs, 1 worker | **94 passed, 0 failed** (5.1m) |
| 1 | **Full serial tier**, 117 spec files, 1 worker | **463 passed, 0 failed** (26.6m) |

`preferences-reset.e2e.ts:77` — the exact spec and line #250 names — passed in **2.6 s** in attempt 1,
scheduled alongside the whole serial tier. So the co-scheduling hypothesis, as far as the serial tier
can express it, is **not** supported.

**What was ruled out.** A tempting explanation was that spec 031 moved the spec into the serial tier
and thereby fixed it. It does not hold: `git log -S` shows `preferences-reset.e2e.ts` was added to
`parallel-plan.json`'s serial list in **2c55596 (spec 028)**, well before #250 was filed against the
031 branch. It was already serial when the failure was reported.

**What attempt 1 skipped, and why attempt 2 exists.** A real `npm run test:e2e` runs the **parallel
tier first at six workers**, then the serial tier. Attempt 1 ran the serial tier *alone*, so it
excluded every effect the parallel tier leaves behind — machine load, lingering handles, temp-dir
pressure, orphaned processes. #250 says "fails during a full suite run", and a full run is both tiers
back to back. Attempt 2 reproduces that ordering exactly.

**Attempt 2 result: `preferences-reset` passed all ten of its tests.** #250 does not reproduce in any
of the three conditions tried.

| Attempt | Condition | `preferences-reset` | Run total |
|---|---|---|---|
| baseline | 15 preferences specs, 1 worker | pass | 94 passed, 0 failed |
| 1 | serial tier alone, 1 worker | pass (2.6 s) | 463 passed, 0 failed |
| 2 | **parallel@6 → serial@1**, a real full run | pass, 10/10 (2.6–3.0 s) | 291+462 passed, 3 failed |

**But the phenomenon #250 describes is real, and attempt 2 caught it — in a different spec.**

`editor-missing-aggregate.e2e.ts:155` **passed** in attempt 1 (serial tier alone) and **failed** in
attempt 2 (the same serial tier, run immediately after the parallel tier). Same spec, same worker
count, same machine; the only variable is what ran before it. That differential is precisely #250's
signature — "fails during a full suite run, passes in isolation, so the cause is outside the test" —
and it is now attached to evidence rather than to a hypothesis.

The other two failures were both in the parallel tier and both already tracked: `terminal-reattach`
(#251, and on the known-failing list) and `terminal-scrollback-nav` (the #252 family). No preferences
spec failed anywhere, and no product code has been changed on this branch, so none of the three is
attributable to this work.

**The honest conclusion for #250 is "cannot reproduce", with the counts, not "fixed".** Nothing was
changed to make it pass. Two specs merged since it was filed (S030, S031) touched the preferences and
notification paths and either may have removed the perturbation, but that is a guess and the issue
should say so. What *is* established is that cross-run scheduling interference still exists in this
suite and now shows up in `editor-missing-aggregate` — which deserves its own issue rather than being
folded into #250's, since it is a different spec with a different cause.

## R7a. The live-writer audit — #253 named three sites, and got one right in two

Enumerated 2026-08-14 by classifying every config-document write in the E2E tree as **before** launch
(a seed, no watcher, no race) or **during** a running app, using brace depth relative to the
enclosing `runApp`/`openApp` call rather than by eye.

**36 config-document writes. 32 are pre-launch seeds. Four are live.**

| Site | Document | Status vs #253 |
|---|---|---|
| `preferences-json.e2e.ts:122` | settings | named, correct |
| `preferences-json.e2e.ts:151` | settings | named, correct |
| `keybindings.e2e.ts:36` | keybindings | **not named — missed** |
| `terminal-flavours.e2e.ts:62` | settings | **not named — missed** |
| `preferences-settings.e2e.ts:378` | settings | named, **wrong** — pre-launch seed |

Both missed sites are the identical pattern: a plain `writeFileSync` into the watched config root of
a running app, followed by `await win.waitForTimeout(500)` for the hot-reload. They are doubly
fragile — the write can be caught mid-flight *and* the wait is a fixed sleep rather than a condition,
so a slow machine fails them for a second, unrelated reason.

`keybindings.e2e.ts:36` matters beyond FR-013: it writes `keybindings.json` while the app runs, which
is one more reason the "single-window document" claim was wrong. The document has a renderer writer, a
main-process writer, and a test writer.

The correction is posted on #253. The number to carry forward is **four**, not two, and the
enumeration is scripted rather than remembered so it can be re-run when a spec is added.

## R8. Docs currency — assessed, and the answer is "yes, one file"

The NON-NEGOTIABLE docs-currency gate requires README, `docs/` and CONTRIBUTING to be assessed in the
same change, with a recorded finding either way. Assessed 2026-08-14:

| Document | Verdict |
|---|---|
| `README.md` | **No change.** Its Preferences bullet says "immediate apply", which stays true. |
| `CONTRIBUTING.md` | **No change.** No claim about configuration behaviour. |
| `docs/installation.md`, `docs/releasing.md` | **No change.** |
| `docs/testing.md` | **Change** — the shared atomic config-write helper and the rule that no spec writes a running app's config root directly (T045). |
| `docs/quick-start.md` | **Change** — see below. |

`quick-start.md:281–292` describes hand-editing a config file: that it hot-reloads, and that an
out-of-range value is corrected and written back. It is silent on the adjacent case this feature
changes — a file that cannot be **parsed** at all. Today that silently loads the shipped defaults and
stays there; afterwards it is retried, and a persistently unreadable file surfaces rather than being
quietly replaced.

That is exactly the paragraph a user reads before hand-editing, and the difference between "your
settings were corrected" and "your settings were replaced" is one they would want stated. Recorded as
a required doc change rather than a nice-to-have.

The main-window write-failure notice (US3) needs no doc change: notices are described generically and
the feature makes an existing promise true in one more place rather than adding a surface.

## Baseline recorded before any change

| Gate | Result |
|---|---|
| lint | pass |
| typecheck | pass |
| build | pass |
| unit | 2200 passed |
| integration | 417 passed |
| contract | 69 passed |
| E2E — 15 preferences/notification specs, 1 worker, retries off | 94 passed, 0 failed, 0 flaky (5.1m) |

**The reported bugs do not reproduce today.** #249's clobber is covered by no test. The nearest thing
is `appliedInMainWindow()` — a local, unexported helper in `notification-prefs.e2e.ts:90`, used by
five tests in that one file — which polls until the main window has *adopted* the new settings before
driving it. Its own docstring names `persistLastProjectFolder` and the stale copy outright, so the
workaround was written with full knowledge of the defect and hides it by construction.

That helper is also the reproduction's blueprint, inverted: doing deliberately what it exists to
prevent is what makes the race happen. So the first implementation task is to *construct* a failing
reproduction, which is FR-016, and no production code is touched until that reproduction has been
shown to the developer and confirmed.

## R9. The write-site audit, completed against the code (T020)

The definitive enumeration, made by grepping `writeConfig`, `applyNow`, `scheduleWrite` and
`writeFilesAtomic` across `packages/ui/src/renderer`, `packages/ui/src/main` **and**
`packages/daemon/src` — not by category, and not by file.

| Site | Document | Disposition |
|---|---|---|
| `preferences/apply-client.ts` | settings | → `writePatch` (used by the Settings tab) |
| `sidebar/projects-panel.tsx` | settings | → `writePatch` (`newProject.lastProjectFolder`) |
| `preferences/preferences-app.tsx` (Revert All) | settings + others | → `planRevertAll`: patch for settings, documents for the rest |
| **`preferences/themes-tab.tsx` ×4** | **settings** | **→ `writePatch` — MISSED BY THE EARLIER AUDIT, see below** |
| `preferences/json-tab.tsx` | any | whole-document, retained — the user typed the document by hand |
| `preferences/keybindings-tab.tsx` | keybindings | whole-document, retained — no reported defect |
| `preferences/themes-tab.tsx` ×2 | theme | whole-document, retained — no reported defect |
| `main/shipped-defaults-service.ts` `resetSetting` | settings | one-key patch on the raw document, under the lock |
| `main/shipped-defaults-service.ts` `resetBinding` | keybindings | one-key patch on the raw document, under the lock |
| `main/shipped-defaults-service.ts` `resetSettings` / `resetKeybindings` / `resetEverything` / `restoreTheme` / `restoreAllThemes` | various | wholesale **by definition** — they write the shipped record and read nothing — but under the lock |
| `main/shipped-defaults-service.ts` `seed` / `upgrade` | various | under the lock; `upgrade` is a genuine read-modify-write |
| `main/config-write-ipc.ts` `writeConfigDoc` | any | whole-document channel, under the lock |
| `packages/daemon/src` | — | **no writers.** The daemon corrects but never writes, by an asserted invariant |

### The fifth instance of the pattern, found during implementation

The round-three audit enumerated `themes-tab.tsx:316` and `:441` as retained whole-**theme** writers,
which they are — and stopped there. It did not notice that the same file writes **settings** four
separate times, through `applySettings.applyNow(activateTheme(settings, name))`: selecting a theme,
deleting the active one, cloning, and following a rename. Every one of those rebuilt the whole
settings document from the Preferences window's copy, so activating a theme reverted whatever the
main window had changed since the last broadcast — #249 exactly, in a file the audit had cleared.

Same shape as the four before it: **a claim about a file standing in for a check of its call sites.**
The audit asked "is this file a retained whole-document writer?" and answered correctly for the
question it asked. The question it needed to ask was "what does each call site in this file write?"

### And one found by a test asserting something else

`config-write-serialisation.test.ts` put a hand-written key in `settings.json` and checked it survived
a concurrent reset. It did not — and the cause had nothing to do with concurrency. `resetSetting` and
`resetBinding` computed the next document through `guardedSettingsValidator` / `parseKeybindings`,
which **rebuild from a fixed shape** and drop every key the schema does not model. Writing that back
erased anything the user had hand-added, on a button whose entire promise is that it changes one
setting. The typed view now only computes the new leaf value; the value is applied to the raw
document as a one-key patch.

## R10. T048 — the deferred cross-window write broadcast, decided

R3 adopted a cross-window broadcast on write as a "secondary improvement" for freshness, and no task
implemented it. The Incremental Delivery rule requires this to be either built or explicitly
deferred, with a reason.

**Decision: not needed. Recorded as closed rather than deferred.**

T024a measured the thing the broadcast was proposed to improve, and there is nothing left to improve.
A completed write is observable through the existing watcher path in **well under FR-004's 100 ms
bound**, ten times consecutively — so a second delivery channel would add a second ordering to
reason about, and a second way for two windows to disagree, in exchange for latency the measurement
says is already inside the requirement.

The renderer-side half that DID matter is built: `onConfigPatched` adopts a key-scoped change locally
the instant it is applied, so the control the user just changed does not show its old value while the
broadcast completes its round trip through the filesystem. That closes the visible gap without
introducing a second source of truth — and unlike #50's whole-document adoption it is holding up
responsiveness only, not correctness, because a patch caller never assembles a document from its own
copy in the first place.
