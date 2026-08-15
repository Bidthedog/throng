# Feature Specification: Settings Write Integrity

**Feature Branch**: `feature/S032-I249-I260-settings-write-integrity`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "For all the issues we have outlined." — issues #249, #260, #253, #250.

## Context

A setting the user changes can silently revert to its previous value, with nothing on screen to say
so. Four open issues describe this from four angles, and the leading hypothesis is that they share
one mechanism.

Every configuration write in the application goes through a single chokepoint that accepts **the
whole document, already serialised**. A caller wanting to change one key must therefore rebuild the
entire document from whatever copy it happens to hold, and write all of it. When two windows hold
independent copies — the main window and the Preferences window each keep their own — the second
write reverts every key the first one changed, because the second writer's copy predates it and it
has no way to know.

That mechanism is **present in the code** and is stated plainly by the code's own comments. What is
*not* yet established is that it is the cause of every symptom reported. #249 reports the gap as
roughly 45 ms; nothing has instrumented it in this repository, and the measured baseline for this
spec found that **none of the four issues currently reproduce**. The constitution forbids asserting
a root cause without a reproducing test or an instrumented probe, so this is written as the leading
hypothesis and FR-016's reproduction is what promotes it to a cause — or refutes it.

**Which document is at risk, and why only one.** The clobber requires two windows holding
independent copies of the same document. Only `settings.json` has that: `keybindings.json` and the
theme documents are written **exclusively from the Preferences window**, where the existing
per-document write chain and same-window republication (issue #50) already prevent a stale write.
Scope is therefore `settings` — see the Assumptions.

Two further issues are the same defect observed from the test suite, and they matter because they
are currently the only thing detecting it — badly. A test that writes a running app's settings file
non-atomically can have its own change eaten by the watcher, and a test that fails only when
scheduled beside other specs is the suite reporting cross-test interference it cannot localise.

| Issue | Angle |
|---|---|
| [#249](https://github.com/Bidthedog/throng/issues/249) | Creating a project in the main window reverts a Preferences change — the mechanism, diagnosed |
| [#260](https://github.com/Bidthedog/throng/issues/260) | A Preferences change is lost and never arrives — the same mechanism, writer unidentified |
| [#253](https://github.com/Bidthedog/throng/issues/253) | Two E2E specs write a running app's settings non-atomically, so the watcher can lose the change |
| [#250](https://github.com/Bidthedog/throng/issues/250) | `preferences-reset.e2e.ts:77` fails only under group scheduling, never in isolation |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A change I made stays made (Priority: P1)

A user opens Preferences, changes a setting, and goes back to the main window to carry on working —
creating a project, opening a folder, renaming a panel. The setting they changed is still changed,
now and after a restart. Nothing they do in one window quietly undoes what they did in another.

**Why this priority**: This is the only user-visible defect in the set, and it is a data-loss
defect: the user's choice is discarded without warning, in a product whose entire configuration
story is "immediate apply, no Save button". A user who cannot trust that a setting stuck cannot
trust the preferences system at all. Everything else in this spec exists to detect or prevent this.

**Independent Test**: Change a notification display mode in Preferences, immediately create a
project in the main window, then read the setting back. It reads as changed. Fully deliverable on
its own — the remaining stories only make the guarantee observable and enforced.

**Acceptance Scenarios**:

1. **Given** the Preferences window is open and the main window is showing a project list, **When**
   the user changes a setting in Preferences and creates a project in the main window within the
   same second, **Then** both the setting change and the new project's folder are persisted, and
   neither reverts.
2. **Given** a setting was changed in Preferences moments ago, **When** any other window writes the
   same document to change a *different* key, **Then** the earlier change is still present
   afterwards.
3. **Given** two windows change the *same* key at nearly the same moment, **When** both writes
   complete, **Then** the later change is the one that persists, and the outcome is the same on
   disk and in every open window.
4. **Given** a setting has been changed, **When** the application is restarted, **Then** the changed
   value is what loads.

---

### User Story 2 - The suite cannot lose the change it is testing (Priority: P2)

A test that sets a configuration value on a running app and then asserts the app honoured it must
observe either the complete change or no change at all. It must never be able to destroy the very
value it is about to assert on, and then fail describing a product defect that does not exist.

**Why this priority**: This is what makes User Story 1 verifiable. While the suite can lose its own
writes, a red run cannot be trusted to mean the product is broken and a green run cannot be trusted
to mean it works — which is precisely the state the four issues were filed from. It is P2 rather
than P1 only because it protects the guarantee rather than providing it.

**Independent Test**: Run the specs that write a running app's config root repeatedly under load
with retries off; they pass every time, and no run reports a value that never arrived.

**Acceptance Scenarios**:

1. **Given** an application is running and watching its configuration, **When** a test writes that
   configuration file, **Then** the application observes either the file's previous complete
   content or its new complete content, never a truncated or partial state.
2. *(Withdrawn — see FR-014.)* The call site this scenario was written for seeds a malformed file
   **before** the app launches, so there is no running application to read a truncated file and
   nothing to make atomic.
3. **Given** the file is momentarily held open by the running application, **When** a test's write
   is completed by replacing the file, **Then** the transient sharing failure is retried within a
   bounded window rather than failing the test.
4. **Given** a new E2E spec is added that writes a running app's config root, **When** the suite
   runs, **Then** it uses the shared atomic write helper rather than its own implementation.

---

### User Story 3 - A configuration failure is reported wherever it happens (Priority: P2)

When a configuration change cannot be written, the user is told: which document, and that nothing
was changed. This holds regardless of which window issued the write.

**Why this priority**: A silent failure is indistinguishable from the clobber in User Story 1 —
from the user's chair, both are "I changed it and it went back". Fixing the clobber without this
leaves the same symptom reachable by a different route. Named in #249: config writes issued from
the main window report their failures to nobody, because the failure-notice subscriber is mounted
only in the Preferences window.

**Independent Test**: Make a configuration write fail (an unwritable config root) from the main
window; a notice appears naming the document and stating nothing changed.

**Acceptance Scenarios**:

1. **Given** the configuration root cannot be written, **When** a write is issued from the main
   window, **Then** a notice names the document and states that nothing was changed.
2. **Given** the same failure, **When** the write is issued from the Preferences window, **Then** the
   user is told there, exactly as they already are.

   *(An earlier draft said "the Preferences window **or any sub-workspace window**". Checked:
   `subworkspace-app.tsx` issues no configuration write of any kind — the only writers are the
   Preferences tabs and the main window's project list. A sub-workspace window cannot have a config
   write fail, so mounting a failure subscriber there would be code that can never run. Exactly
   **two** windows write settings, and they are the two named in FR-001.)*
3. **Given** a write fails, **When** the user has set the relevant severity to *never display*,
   **Then** the failure is still recorded in the diagnostics log.

---

### User Story 4 - A spec's result does not depend on what else is running (Priority: P3)

The preferences reset spec gives the same answer whether it runs alone or scheduled alongside the
rest of its tier.

**Why this priority**: The lowest-value of the four to the user and the highest-uncertainty to
estimate — its cause is not yet known and must be found by bisecting the co-scheduled set. It is in
scope because it is the last remaining preferences-area failure that would keep the full gate red
after the others land, and because co-scheduling interference is the plausible sibling of the
cross-window interference in User Story 1.

**Independent Test**: Run the spec alone and inside a full-tier schedule, twenty times each, with
retries off. Both give the same result.

**Acceptance Scenarios**:

1. **Given** the full suite schedule, **When** the preferences reset spec runs alongside its tier,
   **Then** it passes, and passes identically when run alone.
2. **Given** the perturbing spec has been identified, **When** the fix is made, **Then** it is made
   at the cause — the spec that perturbs shared state — and not by adding a retry, a longer timeout
   or a wait to the spec that notices.

---

### Edge Cases

- Two windows change the **same** key inside the debounce window — the later write must win, with
  the same outcome everywhere; it must not produce a value neither window asked for.
- The configuration document is **unparseable** when the watcher reads it: the application must
  recover on its own. Today nothing re-reads, because re-reads are driven only by a further file
  change — so a single bad read strands every window on the old value indefinitely.
- The file is **locked by another process** at the moment a write completes by replacing it.
- A window **opens while a write is in flight** and must not initialise from the pre-write value.
  *(Covered by FR-002: a window that never assembles a document cannot write a stale one, and it
  reads its initial payload from the same broadcast as everyone else.)*
- The user **edits the configuration file by hand** while the application writes it.
- A write fails in a window that has **nothing mounted to report it** *(FR-010)*.
- The current persisted content **cannot be parsed** when a change arrives *(FR-006a)* — the change
  is refused rather than applied to an empty base.

*Removed from this list during analysis*: "a document reaches its size or shape limits and the write
is refused". Bounds and clamping are spec 031's (FR-013a), already shipped and already reported
through the correction path; restating it here would create a second owner for one behaviour.

## Clarifications

### Session 2026-08-15 — the JSON editor's edit lifecycle

Raised after hand-testing the write-integrity work. Answers marked *(derived)* were reasoned from
the code and existing requirements rather than confirmed by the user; they are the ones to challenge.

- Q: The JSON editor shows "this file changed on disk while you were editing it" milliseconds after
  a keystroke. Is the banner the problem? → A: **No — the background write is.** The banner is
  accurate; the file genuinely did change. It changed because throng wrote it. Nothing should be
  writing that document while the user is editing it.
- Q: What triggers an apply in the JSON editor, then? → A: **Leaving the editor.** Closing the JSON
  view, switching tab, or closing the Preferences window. **The 300 ms debounce is removed for this
  surface only.**
- Q: Does that contradict 007 FR-016's immediate-apply? → A: **Only its first clause, and only
  here.** FR-016 already names "when a form field loses focus, or when the preferences window is
  closed" as apply points; a whole JSON document has no per-field blur, so those two triggers are the
  natural fit and the "immediately when the value becomes valid" clause is the one that does not
  transfer. *(derived from FR-016's own wording; not confirmed by the user)*
- Q: Why does a half-typed value get written at all — is it not invalid? → A: **It is frequently
  VALID.** `10` on its way to `15` is `1` for a moment, which parses. It is then applied, and 031's
  bounds guard corrects it out of range and writes the correction back — which is the "changed on
  disk" event. *(derived from the code path; observed, not user-reported)*
- Q: Can the user leave with an invalid document? → A: **No.** Leaving JSON view, switching tab and
  closing Preferences are all blocked while the document does not parse or fails validation.
- Q: Does blocking window close risk trapping the user? → A: **Yes, so there is an escape.** A
  refusal to close offers *Discard changes and close*, which abandons the buffer and leaves the last
  valid document in effect. A window that cannot be closed at all is a worse defect than the one
  being fixed. *(derived; the user asked for the block and did not name an escape — flagged for
  challenge)*
- Q: What does the invalid notice say? → A: **What is wrong, per offending value** — the key, why it
  is rejected, and either its allowed options or its permitted range. `SETTINGS_METADATA` already
  carries `allowedValues` and bounds, so this reads the registry rather than inventing a second
  source of truth.
- Q: Are the intellisense-style enumeration dropdowns in scope here? → A: **No — separate issue.**
  It is a new editor capability rather than write integrity, it needs a CodeMirror completion source
  driven by the settings registry, and folding it in would hold the integrity fixes behind it.
  *(derived scoping decision — challenge this if you want it in the same run)* **Confirmed by the
  user and filed as [#266](https://github.com/Bidthedog/throng/issues/266), milestone vNext.**

### Session 2026-08-15 (later) — settled during implementation

Three questions the build answered that the clarification round had not thought to ask. Each is
recorded here rather than only in a commit, because each changed a requirement.

- Q: Should an **absent** settings key be reported as invalid? → A: **No, and this one nearly shipped
  wrong.** Because FR-018 blocks the user from leaving an invalid document, reporting absence would
  have locked them inside the JSON editor over a file the application is perfectly happy with — every
  settings file written before a release that adds a setting. Now FR-019b. *(settled by writing the
  test that enumerates the registry rather than listing keys by hand)*
- Q: What applies the buffer when the **whole application** closes with Preferences open? → A:
  **Nothing did, and that was a regression.** FR-017's three triggers do not include it, and the
  debounce FR-017 removed at least left an armed timer for the shutdown drain. Now FR-020. *(found by
  `terminate-all-drain.e2e.ts`, whose only discriminating proof of the drain rested on that debounce)*
- Q: Is an **empty** `settings.json` absent or unreadable? → A: **Unreadable.** It is the commonest
  state a partial write is visible in — truncate, then fill — so treating it as absent left the
  commonest instance of the defect unguarded. Now FR-008a. *(caught by the R2 probe, which is what a
  probe is for)*

## Requirements *(mandatory)*

### Functional Requirements

**Preserving the user's changes**

- **FR-001**: A write to the settings document that changes one key MUST NOT revert a change made to
  a different key of that document by another window. **One writer is carved out, explicitly**: the
  preferences **JSON tab**, where the user has typed a complete document by hand and replacing the
  file is the operation they asked for. That exception is stated here rather than left to the
  Assumptions, because an exception a requirement does not mention is a requirement that is quietly
  false.
- **FR-001a**: **Revert All Preferences MUST revert only the preference keys it captured**, not the
  whole settings document. Its snapshot is taken when the Preferences window opens, and the settings
  document also carries main-window state — `newProject.lastProjectFolder` is written by the project
  list. Restoring the document wholesale therefore discards a folder the user chose *after* opening
  Preferences, which is neither what "revert my preference edits" means nor something the
  confirmation warns about.
- **FR-001b**: A configuration write issued from the **main process** — every reset and restore path
  — MUST obey FR-001, FR-002, FR-002a and FR-006a exactly as a renderer write does. The rule is about
  the document, not about which process holds the pen.
- **FR-001c**: A **key-binding** reset MUST NOT replace bindings it was not asked to reset, and MUST
  be refused rather than applied against a defaults fallback when the current document cannot be
  parsed. `resetBinding` today reads with a `DEFAULT_KEYBINDINGS` fallback and writes the whole
  document, so resetting one action against a corrupt file silently replaces **every other binding**
  with its shipped value — the same shape as FR-006a, in the document an earlier draft of this spec
  called out of scope.
- **FR-002**: Every settings write MUST be applied to the document's current persisted content, not
  to a copy captured before an intervening change.
- **FR-002a**: For each configuration document, the **read → apply → write** cycle MUST be
  serialised, so that two concurrent writers cannot interleave as *read-A, read-B, write-A, write-B*.
  Every writer in the owning process MUST pass through the same serialisation point — the patch
  handler, the whole-document handler, and every reset path alike.

  This requirement exists because the fix would otherwise **relocate the defect rather than remove
  it**. Ordering the file replace is not enough: atomicity of the write says nothing about the gap
  between reading a document and writing it back, and that gap is exactly where the original bug
  lives. Today the only serialisation in the system is per-document and lives in a *renderer* module,
  so it orders one window's writes and nothing else.
- **FR-003**: When two writers change the same key, the later write MUST win, and the resulting
  value MUST be the same on disk and in every open window.
- **FR-004**: A configuration change the application has accepted MUST become observable on disk and
  in every open window **within 100 ms** under normal load.
- **FR-005**: Creating a project MUST persist the project and the folder last used for it without
  rewriting configuration keys it did not change.
- **FR-006**: A configuration change MUST survive an application restart.
- **FR-006a**: A settings write whose current persisted content **cannot be parsed** MUST be refused
  and MUST write nothing. Applying a change on top of an unreadable base would replace every setting
  the user has with the one key being written — the very loss this feature exists to prevent. This
  binds the main-process reset paths too, which today read with a **defaults fallback**: resetting
  one setting against a corrupt file currently replaces every other setting with its shipped value,
  silently. That is the same hole on the other side of the same boundary.

**Integrity of the file itself**

- **FR-007**: No writer — the application, a test helper, or any tool this project ships — MAY
  expose a partially written configuration file to the watcher.
- **FR-008**: A watcher that reads unparseable or incomplete configuration content MUST recover to
  the correct value without requiring a further write to occur.
- **FR-008a**: A settings file that **exists and is empty** MUST be treated as unreadable, not as
  absent. *(Added during implementation, after the R2 probe caught it.)* A plain `writeFileSync`
  truncates its target and then fills it, so the empty moment is the single most likely state to
  catch a partial write in — the exact window FR-008 exists to survive. An **absent** file is the
  opposite case and must NOT be retried: it is a first run, and retrying would delay every launch on
  a new install to learn something that was never going to change. The two are indistinguishable
  through the store's raw read, which returns `''` for both, so the distinction has to be made
  deliberately.
- **FR-009**: A write completed by replacing the target file MUST tolerate transient sharing
  violations with a bounded retry, and MUST report a definite outcome once the retries are spent.

**Telling the user**

- **FR-010**: A configuration write that cannot be completed MUST raise a notice that names the
  document and states that nothing was changed, from whichever window issued it.
- **FR-010a**: That notice MUST name the document **the user knows** — `settings.json` — and never
  throng's staging file. The atomic write renames `<name>.N.tmp` into place and the operating
  system's error quotes the staging path first, so a reader that lifts the first quoted path names a
  file the user has never seen and cannot act on.
- **FR-010b**: The stated cause MUST be **accurate**, not merely plausible. `EPERM` is ambiguous on
  Windows — a held handle, a permissions refusal, and a directory standing where the file should be
  all produce it — so a cause inferred from the errno alone can be confidently wrong. Where the
  writer can determine the real cause it MUST say it; where it genuinely cannot, it MUST name the
  possibilities rather than assert one. *A specifically wrong explanation is worse than a vague one:
  it sends the user to look for something that does not exist.*
- **FR-010c**: The raw system error MUST remain available in the notice's Copy and in the
  diagnostics log. It is what a bug report is reconstructed from; it simply is not the sentence.
- **FR-011**: The notice MUST be raised by the window that **issued** the write, and only by that
  window. Each window is a separate renderer process with its own module state, so a failure is
  published only where it originated; no cross-process de-duplication is required, and none is
  built. *(Revised: an earlier draft required "one notice, not one per window", which implied a
  cross-process dedup that is not implementable in this architecture and would have been solving a
  problem that does not arise.)*
- **FR-012**: A suppressed severity MUST NOT suppress the diagnostics-log record of a failed
  configuration write.

**The suite that proves it**

- **FR-013**: Every test that writes into the configuration root of an **already-running**
  application MUST do so atomically, through one shared helper rather than a per-spec
  implementation.
- **FR-014**: *(Withdrawn.)* An earlier draft required that a test writing deliberately invalid
  content deliver it atomically, on the strength of #253 naming `preferences-settings.e2e.ts:378`.
  That call site was checked: it writes **before** `runApp`, under the comment "Seed a malformed
  file before launch". No application is running, no watcher exists, and no race is possible, so
  the requirement had no subject. The only genuine running-app writes are in
  `preferences-json.e2e.ts`. **#253 is inaccurate on this point and must be corrected.**
- **FR-015**: The preferences reset spec MUST produce the same result in isolation and under group
  scheduling, with the fix made at the perturbing cause rather than by retry, timeout or wait.
- **FR-016**: The behaviour in FR-001 through FR-003 MUST be covered by a test that fails against
  today's code, so the guarantee cannot silently regress. If that test cannot be made to fail, the
  hypothesis in the Context is refuted and the design MUST be re-argued before any code is written
  — see the Assumptions.

**The JSON editor's edit lifecycle** *(added 2026-08-15)*

- **FR-017**: The preferences JSON editor MUST NOT apply or persist its buffer while the user is
  editing it. It applies when the user **leaves** — closing the JSON view, switching tab, or closing
  the Preferences window.

  *Supersedes, for this surface only, the "immediately when the value becomes valid" clause of
  **007 FR-016**. FR-016's other two triggers — losing focus, and closing the window — are retained
  and are what this requirement builds on; a whole JSON document has no per-field blur, so they are
  the natural fit. Every other editor keeps immediate-apply unchanged.*

  *Rationale: a half-typed value is frequently still valid JSON. It is applied, 031's bounds guard
  finds it out of range, corrects it and writes the correction back — so the user's own typing pulls
  the document out from under their cursor. Nothing that writes the file mid-edit can avoid this.*

- **FR-017a**: While the JSON buffer is **valid**, the editor MUST show a standing **warning** in the
  same slot the invalidity notice occupies, stating when the file will be saved and naming the
  document. *(Added after hand-testing.)*

  > This file will not be saved until you switch back to the UI, switch tab, or close preferences.
  > Editing **settings.json** directly whilst in JSON editing mode here may result in data loss.

  *FR-017 is the least discoverable thing about this surface: nothing is written while the user
  types, and there is no moment where the application appears to save. A user who does not know the
  rule reads the silence as lost work — which is not hypothetical, because the behaviour was
  reported as a defect by the person who had asked for it. The rule is therefore stated before it
  matters rather than left to be inferred afterwards.*

  *It shares the invalidity notice's slot rather than stacking with it: a user reading about a broken
  document does not also need the general rule, and two strips would push the editor up for nothing.
  Amber rather than red — nothing has gone wrong.*

  *The second sentence is the one that earns its place. Because the buffer is written only on
  leaving, a change made to the file by anything else is overwritten when the user leaves. FR-020a's
  dirty-buffer branch catches that when it happens; this says so beforehand.*

- **FR-018**: While the JSON buffer is invalid **and the user has edited it**, they MUST NOT be able
  to close the JSON view, switch preferences tab, or close the Preferences window. The attempt MUST
  be refused visibly, not silently ignored.
- **FR-018c**: A buffer the user has **not edited** MUST NEVER block an exit, whatever it contains.
  *(Added after a reported trap with no way out.)*

  *FR-018 exists to stop the user losing EDITS. An untouched buffer holds none: its content is
  exactly what is on disk, leaving it writes nothing, and blocking achieves nothing except keeping
  the user where they are.*

  *That is not a refinement, it is the fix for a defect with no escape. The Themes tab's JSON
  document is the **active theme's file**, so an active theme with no file behind it opens that
  editor on an empty, unparseable buffer nobody typed into — and every exit refused, including
  **Discard** (which restores the same empty baseline) and **Discard and close** (refused by the
  close gate for the same reason). Reported as "the user is stuck on the Themes page forever. The
  only way out is closing throng entirely."*

  *FR-018a promised the window could always be closed. It could not, because it assumed the baseline
  was always something valid to fall back to. A theme file deleted or corrupted by anything else
  reaches the same place, so FR-019c alone would not have been enough.*

- **FR-019c**: `appearance.theme` MUST be validated against the themes that **actually exist**, and a
  name that names nothing MUST be refused. *(Added after the same report.)*

  *It is the one settings value whose valid set is genuinely dynamic — the registry declares no
  `allowedValues` for it, correctly, because the options are "the themes on disk (populated at
  runtime)". That left it the only setting checked by nothing at all.*

  *The user cannot create a theme from this editor, only select one that exists, so refusing an
  unknown name withdraws no capability. Where the theme list is not yet known — it arrives over IPC
  after the editor mounts — nothing is checked, because reporting a theme as unknown while the set of
  known themes is empty would report a problem that does not exist.*
- **FR-018a**: A refusal to close the window MUST offer **Discard and close**, abandoning the buffer
  and leaving the last valid document in effect. A window that cannot be closed at all is a worse
  defect than the one FR-018 fixes.
- **FR-018b**: There MUST be **exactly one** notice for an invalid document, and it MUST be
  **inline** rather than a toast. *(Added after hand-testing — the first implementation produced
  three.)*

  *An invalid document raised an inline banner, a toast when a tab switch was refused, and a strip at
  the top of the window when a close was refused: one condition, three wordings, appearing at three
  different places on screen. Two of them told the user they could not leave, which was **untrue** —
  Discard was a few pixels away the whole time.*

  *The notice MUST therefore: appear the moment the document becomes invalid; carry **Discard**,
  **Discard and close** and **Copy**; say what is WRONG rather than what the user may not do; and
  **flash** when an exit is refused rather than raising anything further. A refused exit adds no
  information — the notice is already on screen and already says why — so what it needs is emphasis,
  not repetition.*

- **FR-019**: The invalidity notice MUST say **what is wrong, per offending value**: the setting's
  key, why it was rejected, and either the allowed options or the permitted range. It MUST read this
  from the existing settings registry rather than a second source of truth.
- **FR-019b**: Each offending value MUST read
  **`"<label>" (<key>) must be one of: a, b, c. Found "x".`** — the label quoted because it is the
  prose the user recognises from the form, the key set apart because it is what they must find in the
  file, the options unquoted and the found value quoted so the two cannot be confused at a glance.
  The notice MUST be copyable, in that same wording.
- **FR-019a**: An unparseable document (not merely an out-of-range value) MUST be reported as such,
  with the position of the parse failure where the parser supplies one.

  *"Where the parser supplies one" is load-bearing rather than defensive, and the implementation
  confirmed it: V8 reports a position for most syntax errors and **none at all** for "Unexpected end
  of JSON input" — which is what a half-typed or emptied document looks like, so it is the case a
  user in this editor hits most. Inventing a position for it would point at a character that is not
  the problem. Both branches are asserted.*

- **FR-019b**: An **absent** key MUST NOT be reported as invalid. *(Added during implementation.)*
  Every key a settings document omits takes its shipped default and the application runs correctly,
  so reporting absence would make every settings file written before a release that adds a setting
  "invalid" — and because FR-018 blocks the user from leaving an invalid document, that would lock
  them inside the JSON editor over a file that works perfectly. `{}` is a valid settings document.
  So is one carrying a hand-added key the schema does not model, which the write path preserves.

- **FR-020a**: An **external change** to the document being edited MUST be handled by whether the
  buffer has been edited, and by nothing else. *(Added after hand-testing — the first implementation
  was inconsistent with its own notice.)*

  - **Buffer unchanged** → the editor follows the file **immediately and silently**. There is nothing
    of the user's to protect, so showing the file is simply showing the truth, and a notice would
    report an event with no consequence. This is also what 015 FR-013b needs: a reset pressed from
    the toolbar refreshes the visible document, and pressing a button is not typing.
  - **Buffer edited** → the buffer is **left alone**, and the notice reads
    **`<file name> has changed on disk.`** with two buttons: **Reload From Disk** and **Overwrite
    With These Changes**.

  *Two distinct actions, each named for what it does to the document rather than for which side
  wins. Overwriting the buffer loses work the user can see; overwriting the file loses work they
  cannot — and only they know which they meant. The first implementation announced "your version
  here will be saved when you leave this editor", which chose for them and then described the
  choice.*

- **FR-020**: Closing the **application** while the JSON editor holds a valid, un-applied buffer MUST
  apply it. *(Added during implementation.)* FR-017 names three apply triggers — closing the JSON
  view, switching tab, closing the Preferences window — and the app-close path fires none of them: it
  tears the renderer down directly. Without this the buffer is silently discarded, which is the exact
  failure class this feature exists to remove, and it would be a **regression**, because the debounce
  FR-017 removed at least left an armed timer for the existing shutdown drain to fire.

  An **invalid** buffer at application close is abandoned rather than written. The drain cannot ask
  the user anything, and writing a document that does not parse would put the application into the
  state FR-018 stops the user reaching deliberately.

**Window layering** *(added during implementation, after the reported z-order defect)*

- **FR-021**: The Preferences window MUST render above every other **throng** window — the main
  window and any sub-workspace — and MUST NOT render above windows belonging to other applications.

  *Supersedes the mechanism, not the promise, of **007 FR-013**. That requirement said "not globally
  always-on-top", which was a statement about the implementation: parenting kept Preferences above
  its parent, and `alwaysOnTop` was avoided because it is OS-global.*

  *Parenting only ever covered the MAIN window. A sub-workspace is a separate top-level window with
  no parent relationship to Preferences, so nothing ordered the two. The gap was invisible while
  sub-workspaces opened disabled — a window that cannot be focused cannot be raised — and removing
  that (#263) revealed that the layering had never been implemented.*

  *`moveTop()` on the other window's focus event does not work, structurally rather than by tuning:
  the OS raises the clicked window as part of the same interaction, after the handler runs. So
  `alwaysOnTop` is held and **scoped to throng having focus** — true while any throng window is
  focused, false the instant none is. That expresses FR-013's actual promise directly rather than
  approximating it, and `titlebar-chrome.e2e.ts` now asserts the flag's scoped value rather than a
  blanket `false`.*

- **FR-022**: The Preferences and About windows MUST open centred on the **main window**, not on the
  primary display. *(Added during implementation.)* With no explicit position Electron centres on the
  primary monitor, so a user running throng on a second screen clicked the cog on one display and
  the window appeared on another. Parenting does not help: it governs stacking and minimise/restore,
  never placement.

**Explicitly out of scope, recorded so it is not lost**: intellisense-style completion offering the
valid options as a dropdown while typing an enumerated value. It is a new editor capability rather
than write integrity, it needs a CodeMirror completion source driven by the settings registry, and
folding it in would hold these fixes behind it. To be filed as its own Enhancement.

### Key Entities

- **Configuration document**: One user-editable unit of configuration — settings, key bindings, a
  theme, an icon pack. It is the unit that is written, watched and broadcast, and the unit a
  conflict is scoped to.
- **Configuration write**: One window's request to change a document, carrying what changed. Has a
  definite outcome: applied, refused with a reason, or failed.
- **Configuration broadcast**: The notification that a document changed, delivered to every window
  so each can update its own copy. The gap between a write completing and a broadcast arriving is
  where the defect lives.
- **Window copy**: A window's local view of a document, used to render and to build the next write.
  Its staleness relative to disk is the root cause under investigation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

Each criterion names the task that measures it, because a success criterion nothing runs is a wish.

- **SC-001**: A setting changed in one window immediately before an unrelated change in another
  window survives **20 out of 20** consecutive trials of the reproduction scenario. *(T022)*
- **SC-002**: A user changing any setting and continuing to work in the main window never observes
  it revert — zero occurrences across the manual pass in `quickstart.md`. *(T050)*
- **SC-003**: `preferences-reset.e2e.ts` passes **20 runs out of 20** under full-tier group
  scheduling with retries disabled, and 20 out of 20 in isolation. *(T044)*
- **SC-004**: No settings change is lost across **1,000 interleaved writes** from two concurrent
  writers, measured at the integration layer rather than through the app. *(T009)*
- **SC-005**: A settings write that cannot complete produces a user-visible message naming the
  document, from the main window and from a sub-workspace window. *(T035, T036)*
- **SC-006**: `npm run gate` completes green, including its end-to-end stage — which it cannot do
  today. *(T049)*
- **SC-007**: Exactly **one** atomic config-write implementation exists in the E2E tree, asserted by
  a test rather than by a grep anyone can forget to run. *(T047)*
- **SC-008**: A configuration change is observable in every open window within the FR-004 bound,
  measured rather than asserted. *(T024a)*

*Every ID above was checked against `tasks.md` after the task list was renumbered. The first draft of
this block cited seven IDs and **all seven were wrong**, five of them naming real tasks that do
something else — traceability that points at the wrong task is worse than none, because it reads as
verified.*

## Assumptions

- **Conflict scope is the key, not the document.** Two windows changing different keys is a false
  conflict created by whole-document writes and must simply stop happening; two windows changing the
  *same* key is a real conflict, resolved last-write-wins. No merge UI, no conflict prompt — those
  would be disproportionate for a preferences store where simultaneous same-key edits are vanishingly
  rare and either answer is defensible.
- **Recovery is automatic and silent.** A write that has to be retried because the document moved
  underneath it is retried without telling the user; only a write that ultimately fails is reported.
  A notice for every benign retry would train the user to ignore notices.
- **The key-scoped write is scoped to `settings`; the serialisation and refuse-on-unreadable rules
  are not.** Three earlier drafts justified this by calling keybindings and themes "single-window
  documents". **That is false**, and the way it was false is worth recording because the same error
  produced three separate defects: *window* was being substituted for *writer*. The main process is a
  writer, holds its own copy, and is not a window — so a rule expressed in windows cannot see it.
  `shipped-defaults-service.ts` writes keybindings and every theme wholesale, and its `resetBinding`
  reads with a defaults fallback exactly as `resetSetting` does, while `keybindings-tab.tsx` holds an
  independent renderer copy of the same document.

  The honest scope is narrower and rests on different ground: **no defect has been reported against
  keybindings or themes**, and extending a key-scoped write to them would need a path representation
  that survives dotted keys (`keybindings.bindings` is keyed by action ids like `tabs.openPicker`).
  So they keep whole-document writes — but FR-001b, FR-001c and FR-002a bind their main-process
  writers, because those are data-loss paths regardless of which document they touch. Project layout,
  workspace state and the database are out of scope entirely; they have their own persistence path.
- **One whole-document writer is retained deliberately**: the preferences **JSON tab**, where the
  user is editing the raw document by hand and last-write-wins is exactly what they mean. It is
  carved out of FR-001 in the requirement itself.

  An earlier draft retained **Revert All Preferences** on the same reasoning and that was wrong.
  "Restoring a captured snapshot" sounds like whole-document semantics but is not: the snapshot is
  of the *preference editors*, while the settings document also carries main-window state, so a
  wholesale restore discards a project folder the user chose after opening Preferences. FR-001a
  converts it.

  A third case was missed entirely until the second analysis pass: the **main-process reset paths**
  (`resetSetting`, and its per-editor siblings) read the whole settings document with a defaults
  fallback and write it back. Same race, worse failure mode — a reset against a corrupt file
  replaces every other setting with its shipped value. FR-001b and FR-006a bind them.
- **If the reproduction cannot be made to fail, the premise is refused, not worked around.** The
  measured baseline found none of the four issues reproducing. If FR-016's test comes back green
  against today's code, that falsifies the Context's hypothesis; the correct response is to stop,
  report it, and re-argue the design from whatever the probe *did* show — not to build the fix
  anyway on the strength of a mechanism that is present in the code but not demonstrated to bite.
- **#250's cause is unknown and must be found before it is fixed.** The spec commits to identifying
  the perturbing spec by bisecting the co-scheduled set, not to a predetermined fix. If the bisect
  shows the cause is the same stale-copy mechanism as User Story 1, that story's fix may resolve it,
  and this is the outcome the ordering anticipates.
- **User Story 3 is drawn from #249's own body**, which records a second finding in the same file:
  main-window config writes report their failures to nobody. It is included because it produces the
  identical symptom to User Story 1 by a different route, and fixing one without the other would
  leave the complaint reproducible.
- **No new user-facing configuration surface.** This spec changes how existing writes behave, not
  what the user can configure. No new settings, no new preferences controls.
- **The existing atomic write in the application's own configuration store is correct** and is the
  model the test helpers should follow; it has always written via a temporary file and a rename, and
  `packages/ui/tests/integration/config-store-atomic.test.ts` is the evidence rather than the
  assertion.
