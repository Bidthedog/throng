# Feature Specification: Terminal Reload, Reconnect and Defaults

**Feature Branch**: `feature/S039-I293-terminal-reload-and-defaults`

**Created**: 2026-08-22

**Status**: Draft

**Issues**: closes #293 (preference: reload terminals automatically or on demand), #223 (preferences
for the New Panel terminal defaults), #237 (terminals reconnect by themselves when their path comes
back). Related but explicitly out of scope: #67 (terminal flavour settings have no fitting control
type), #290 / #279 / #280 (spec 038's terminal defect sweep, which shares this code), #161 (the
editor auto-recovery contract #237 is measured against), #204 (the fix that preserved the panel
configuration #237 reuses).

**Input**: Three v1.0.0 backlog issues grouped as one branch's work by a backlog planning pass on
2026-08-22, on the grounds that all three change **when a terminal starts and what it starts with**,
and all three add settings to the same `Terminal` preferences group. The grouping is the input; the
three issue bodies are the requirements.

---

## Why this spec exists

Three separate complaints turn out to be the same question asked at three moments in a terminal's
life.

- **Before it exists** (#223) — the New Panel dialog's three checkboxes start from values baked into
  the panel-type descriptor, so a user who always wants the opposite re-ticks the same box forever.
- **When a project opens** (#293) — every terminal in every tab reloads at once, and there is no way
  to say "bring these back when I ask for them".
- **After it has failed** (#237) — a terminal whose working directory went missing stays failed until
  the user finds every one of them and clicks ↻, while the editors beside it heal themselves.

Grouping them is not a filing convenience. #293 and #223 both add settings to the `Terminal` group in
`packages/core/src/config/settings-metadata.ts`; #293 and #237 both decide whether a terminal starts
when a project opens, and the interaction between them (below, FR-036) is a rule neither issue could
have stated alone.

## Two findings that changed this spec's shape

Both were established by reading the code and the shipped specs before any requirement was written,
per the repository's rule that a requirement changing existing behaviour must first find the
requirement that already governs it.

### Finding 1 — the command-memory default already had a governing requirement, and the code contradicts it

#223 asks that "Remember the last running command" ship **off**. That is not a new decision. It is
what **025 FR-015** already requires, in those words:

> **FR-015**: A Terminal Panel MUST offer a per-Panel **opt-in** control on the empty-panel setup
> form governing whether its saved Startup Command updates itself. It MUST default to **off**.

**025 FR-047a** then leans on it. It permits a captured command to re-run on the next cold start with
no prompt and no distinction from a typed one, and names exactly two safeguards that make that
acceptable — the first being *"FR-015 (memory is opt-in per Panel and defaults off)"*.
`specs/025-terminal-startup-commands/data-model.md:18` records the same: *"opt-in memory, default
`false` (FR-015)"*.

The code does the opposite:

| Site | Code | Effect |
|---|---|---|
| `packages/core/src/terminal/panel-type.ts:85` | `rememberCommand: raw?.rememberCommand !== false` | absent means **on** |
| `packages/core/src/terminal/panel-type.ts:140` | `memory?.rememberCommand === false ? 'false' : 'true'` | the form pre-ticks **on** |
| `packages/core/tests/unit/terminal-memory.test.ts:152` | `readTerminalPanelConfig({ rememberCommand: 'no' }).rememberCommand` is `true` | the drift is pinned by a test |

This was deliberate. `panel-type.ts:82-84` carries the reasoning:

> Defaults ON, like the directory beside it. Reported from real use: a command that takes over a
> terminal is the one you want back next launch, and an opt-in a user has to discover first means the
> feature silently does nothing for everyone who never found the checkbox.

But **025 was never amended**, so the shipped spec still states the opposite, and FR-047a still cites
a safeguard that is not in force. Two details make it a drift rather than a decision: the comment
directs the reader to `parseTerminalConfig`, **a function that no longer exists anywhere in the
repository**; and the only "absent means on" any spec actually states is **FR-027b**, which governs
**directory** memory — the field immediately beside it — and was itself an explicit amendment
recorded in 025's clarifications. The most likely history is that FR-027b's amendment was applied to
the neighbouring field as well.

**This spec does not pick a winner, because it does not have to.** The code comment's objection is
that an opt-in a user must *discover on a per-panel form* silently does nothing. #223 removes that
objection by making the default a **preference, visible in Preferences → Terminal**. Discoverable and
off is a position both the requirement and the comment can hold at once. See *Supersessions*.

### Finding 2 — there is no shared path-availability signal for #237 to hang off

#237 requires that recovery *"hang off the same path-availability signal that drives editor recovery,
not a per-panel timer"*. That signal does not exist as a single subscribable event. Editor recovery
(027 / #161) is **two per-document mechanisms** converging on one private method in
`packages/ui/src/main/editor-coordinator.ts`:

| Mechanism | Site | Kind | Fires when |
|---|---|---|---|
| `verifyPath(panelId)` | `:711`, called from `editor-ipc.ts:201` | **pull** | a view mounts / a tab is activated |
| `onDiskChange(...)` | `:1124`, armed at `:1110` via `fileWatcher.watch(dirname(target), …)` | **push** | the document's **containing directory** changes |
| `pathCameBack(doc, res)` | `:666` | — | the recovery both routes call |

There is nothing project-wide. This matters for one acceptance criterion specifically: #237 requires
recovery across *"every tab in the project, including tabs that have never been rendered in this
session"*. The **pull** half cannot satisfy that by construction — it fires on mount. Only a **push**
mechanism can.

So the faithful reading of #237 is *"a watch, armed by the failure, exactly as the editors do it"* —
not *"subscribe to the existing project signal"*, because there is none.

**Stated plainly, because the next reader will otherwise design against a fiction: throng has no
project-level path-availability event, and this feature does not add one.** #237's phrase *"one
path-availability event"* describes what the **user observes** — several terminals coming back
together — not the mechanism underneath. Under this spec it is **N watches, one per failed terminal,
firing at the same moment** because they are watching the same directory reappear. The acceptance
criteria are met exactly; the singular event is not real and the wording is deliberately not
reproduced anywhere in the requirements below.

Building the shared watch instead — one project-root availability signal that terminals *and*
editors consume — is the better architecture and is **deliberately deferred**, for a scheduling
reason rather than a technical one: it requires retrofitting the editors, which means editing #161's
code while spec 037 is live in the editor recovery path. Two concurrent restructurings of one
subsystem produce a merge nobody can review. It is filed as a follow-up (see *Follow-ups filed*),
cross-referenced to #272, which is the same consolidation for the explorer and file-index watches and
is where this eventually belongs.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My New Panel checkboxes start where I want them (Priority: P1)

A user who never wants a terminal to re-run whatever it was last doing opens Preferences → Terminal
once and turns "Remember the last running command" off. Every terminal they create from then on
starts with that box clear. They stop re-ticking it, and they stop discovering, a week later, that a
panel quietly restarted a long-running command they had finished with.

**Why this priority**: It is the smallest slice that stands alone and delivers value on its own, and
it establishes the contract the other two stories reuse — *a preference seeds panel creation; a
panel's own memory still wins*. It also restores a safeguard 025 FR-047a depends on and which is
currently not in force (Finding 1), so it carries the most correctness per line of the three.

**Independent Test**: Set each of the three preferences, open New Panel → Terminal with no prior
terminal memory, and confirm the three checkboxes match. Fully testable with no reference to reload
behaviour or recovery.

**Acceptance Scenarios**:

1. **Given** a clean config, **When** the user opens Preferences → Terminal, **Then** three toggles
   are present — "Remember the last running command", "Reopen in the last directory" and "Run as
   administrator" — reading **off**, **on** and **off** respectively.
2. **Given** the shipped defaults, **When** the user opens New Panel → Terminal in a Panel with no
   terminal memory, **Then** the three checkboxes match those preferences.
3. **Given** the user has turned "Remember the last running command" on, **When** they open New Panel
   → Terminal in a Panel with no memory, **Then** that checkbox is ticked.
4. **Given** a Panel that remembers its own values, **When** its empty state pre-fills the form,
   **Then** it pre-fills from **its own memory**, not from the preferences (025 FR-007a is unchanged).
5. **Given** two different flavours, **When** New Panel → Terminal is opened for each, **Then** the
   three defaults are identical — these are global, not per-flavour.
6. **Given** the daemon is **not** elevated and "Run as administrator" is preferred **on**, **When**
   New Panel → Terminal is opened, **Then** the admin control is still disabled and a launched
   terminal is **not** elevated.
7. **Given** an already-open New Panel dialog, **When** a preference is changed in another window,
   **Then** the open dialog is **not** required to update live.

---

### User Story 2 - Twenty terminals, and I reload the two I need (Priority: P2)

A user opens a project with twenty terminals across six tabs. Today all twenty shells start at once.
With the reload preference set to **Manual**, none of them start: each terminal panel shows a dormant
placeholder naming the panel and offering **Reload**. The user reloads the two they came for, works,
and leaves the other eighteen dormant — no shells, no CPU, no startup wait.

**Why this priority**: the loudest of the three complaints and the largest visible win, but it
depends on the preferences plumbing Story 1 establishes and it introduces a new panel state that
Story 3 must then reason about.

**Independent Test**: Set the preference to Manual, open a project with several terminals, and
confirm no shell starts and every panel offers Reload; click one and confirm it behaves exactly like
an automatically reloaded terminal.

**Acceptance Scenarios**:

1. **Given** the preference is **Automatic** (the shipped default), **When** a project is opened,
   **Then** every terminal reloads exactly as it does today — no observable change whatsoever.
2. **Given** the preference is **Manual**, **When** a project is opened, **Then** **no** terminal
   starts, and each terminal panel shows a dormant placeholder naming the panel and offering a
   **Reload** action.
3. **Given** a dormant terminal, **When** the user activates **Reload**, **Then** it starts and is
   thereafter indistinguishable from an automatically reloaded terminal.
4. **Given** a project opened in Manual mode, **When** its dormant terminals are inspected, **Then**
   none of them holds a PTY, a shell process or a `conhost`.
5. **Given** a dormant terminal, **When** the user looks for the reload action, **Then** it is
   reachable from a **menu item** as well as the panel affordance.
6. **Given** the preference is changed, **When** the next project is opened, **Then** the new value
   applies — without an application restart.
7. **Given** dormant terminals, **When** the application is restarted, **Then** each keeps its name,
   its type and its position in the layout, and is still dormant.
8. **Given** terminals the user deliberately left dormant, **When** the project is switched away and
   back in Manual mode, **Then** they are **not** silently reloaded.

---

### User Story 3 - I put the folder back and throng caught up (Priority: P3)

A user's project folder is renamed away while throng is running. Four terminals across two tabs fail
to start. The user renames the folder back. Without touching anything, all four terminals start, in
the directories they were configured for — the same thing the editors beside them already do.

**Why this priority**: the narrowest audience of the three (it needs a path to have gone away and
come back), and the only one whose mechanism has to be built rather than configured. It also has to
respect the dormant state Story 2 introduces, so it is last.

**Independent Test**: With a terminal failed on an unresolvable working directory, restore the path
and confirm the terminal starts by itself, in the right directory, with no user action and no
per-panel notice.

**Acceptance Scenarios**:

1. **Given** a terminal whose start failed because its working directory could not be resolved,
   **When** that path exists again, **Then** the terminal starts by itself, with no user action.
2. **Given** such a recovery, **When** the terminal comes up, **Then** it is in the directory it was
   configured for — not a fallback root.
3. **Given** four affected terminals across two tabs, **When** the path returns, **Then** all four
   recover, **including those in tabs that have never been rendered in this session**.
4. **Given** several terminals recovering at once, **When** they succeed, **Then** **no** per-panel
   notice is raised.
5. **Given** a recovered terminal, **When** it starts, **Then** it uses the Panel's remembered type
   and configuration (no regression to #204 / 029 FR-004a).
6. **Given** a terminal that failed for a reason unrelated to its path — a missing shell binary,
   permission denied — **When** anything changes on disk, **Then** it does **not** enter a retry loop.
7. **Given** two open projects, **When** a path-availability event fires in one, **Then** the other
   project's terminals are untouched.
8. **Given** a recovered terminal, **When** it starts, **Then** its failure banner disappears, by the
   same rule the editor's does.
9. **Given** a failed terminal, **When** the user clicks ↻ Retry, **Then** it behaves exactly as it
   does today — the manual route is unchanged.

---

### Edge Cases

- **A dormant terminal is not a failed terminal.** Manual mode must not route dormancy through the
  failure or notice surfaces; it is a designed state, and the repository's *one condition, one
  notice* rule makes reporting it as a failure a defect rather than a nicety.
- **Manual mode meets auto-reconnect.** A terminal that never started because the user chose Manual
  has not failed on a path, so a path-availability event must not wake it. FR-036.
- **The project root itself is what went missing.** Every terminal in the project is affected at
  once; the watch must be armed somewhere that still exists (the nearest existing ancestor), or there
  is nothing to watch.
- **The path comes back, and goes away again** before the reconnect completes. The start fails the
  ordinary way and the panel returns to the failed state it was already in — recovery is not
  privileged.
- **The path comes back while the project is closed**, or while the application is not running. There
  is no event to hear; the next ordinary open starts the terminal normally.
- **A remembered directory that returns as a *file*, or outside the project root.** 025 FR-030
  already governs this: fall back to the project root without an error dialog. Recovery does not
  change it.
- **"Run as administrator" preferred on, daemon unelevated.** The elevation gate (`canRunAsAdmin()`)
  still decides; a preference must never force, imply or appear to grant elevation.
- **An existing Panel's stored `rememberCommand`.** Changing the shipped default must not rewrite
  what existing Panels already persisted — their own value still wins (FR-005).
- **A rootless sub-workspace Panel** has no project root. It launches at the user's home directory
  (025 FR-028); neither the reload preference nor recovery may assume a project root exists.

---

## Requirements *(mandatory)*

### A. New Panel terminal defaults (#223)

- **FR-001**: Three global settings MUST exist in the existing **Terminal** preferences group, each
  `control: 'toggle'`, with a description: **Remember the last running command**, **Reopen in the
  last directory**, and **Run as administrator**.
- **FR-002**: Their shipped defaults MUST be **off**, **on** and **off** respectively.
- **FR-003**: They MUST apply to every terminal flavour. There MUST NOT be a per-flavour override.
- **FR-004**: The terminal panel-type descriptor's `defaults()` MUST read these settings rather than
  hard-coding literals.
- **FR-005**: Precedence for a *reopened* Panel MUST be unchanged: what the Panel itself remembered
  wins over the preference, which wins over nothing. The preference is the seed for a **fresh** Panel
  and the fallback when there is no memory (025 FR-007a is not modified).
- **FR-005a**: An **absent** per-Panel value MUST resolve to the **global preference**, not to a
  hard-coded literal. An absent key is not something the Panel remembered, so FR-005's "the Panel's
  own value wins" does not apply to it.

  **This changes behaviour for existing installs, and is the only requirement here that does.** Today
  an absent `rememberCommand` reads as **on** (`panel-type.ts:85`). Under FR-002 it resolves to the
  new default, **off**, so a Panel that never had the key stops re-running its last command. The
  alternative — freezing absent-means-on for pre-existing Panels — was rejected because it creates two
  eras of Panels that behave differently forever, and a user who wants the old behaviour recovers it
  by flipping one preference once rather than ticking a box on every Panel they own. Recorded here
  rather than left to fall out of the refactor, because a rule this consequential should be a
  sentence someone can disagree with.
- **FR-006**: A preference change MUST NOT migrate or rewrite the stored configuration of Panels that
  already exist. FR-005a is a **read-side** resolution: nothing is written back, and a Panel that
  holds an explicit `true` or `false` keeps it.
- **FR-007**: An already-open New Panel dialog is **not** required to reflect a preference changed
  after it opened.
- **FR-008**: A "Run as administrator" preference of **on** MUST NOT force, imply, or appear to grant
  elevation. `canRunAsAdmin()` remains the sole gate; with the daemon unelevated the control stays
  disabled and the terminal launches unelevated.

### B. Reload mode (#293)

- **FR-020**: One global setting MUST exist in the **Terminal** preferences group offering
  **Automatic** and **Manual**, shipping as **Automatic**.
- **FR-021**: With **Automatic**, opening a project MUST reload every terminal exactly as it does
  today. This is a no-op path and MUST be observably identical.
- **FR-022**: With **Manual**, opening a project MUST start **no** terminal.
- **FR-023**: A terminal that has not been reloaded MUST present a **dormant placeholder** that names
  the panel and offers a **Reload** action on the panel itself.
- **FR-024**: The reload action MUST also be reachable from a **menu item** — the repository's rule
  that every panel action has a menu item.
- **FR-025**: Reloading a dormant terminal MUST go through the same path an automatic reload uses. A
  reloaded terminal MUST be indistinguishable from an automatically reloaded one.
- **FR-026**: A dormant terminal MUST hold **no** PTY, **no** shell process and **no** `conhost`.

  **This is satisfied by construction, and the construction is not an accident — do not "simplify"
  it away.** `TerminalPanel` calls `useTerminal()` unconditionally, and React forbids a conditional
  hook, so "render the panel but start no shell" cannot be expressed *inside* `TerminalPanel`
  without restructuring it. A dormant Panel therefore renders a **different component**, chosen one
  level up in `panel-body.tsx`'s existing `panel.kind === 'terminal'` branch, before
  `<TerminalPanel>` is ever constructed. The code that starts a terminal is never mounted, so no PTY
  can leak even if someone later adds a new start path inside `TerminalPanel`. Folding the dormant
  check back into `TerminalPanel` would replace a guarantee with a gate that a future edit can
  quietly break.
- **FR-027**: A dormant Panel MUST keep its name, its type and its place in the layout, and MUST keep
  them across an application restart.
- **FR-028**: In Manual mode, switching a project away and back MUST NOT reload a terminal the user
  left dormant.
- **FR-029**: Dormancy is a **state, not a failure**. It MUST NOT be reported through the failure,
  banner or notification surfaces.
- **FR-029a**: A change to this preference MUST take effect on the next project open, without an
  application restart.

### C. Reconnect when the path returns (#237)

- **FR-030**: A terminal whose start failed because its working directory could not be resolved MUST
  arm a **watch** on that directory — or, when it does not exist, on its nearest existing ancestor —
  and retry **once** when the directory appears. The watch is armed by the **failure**, not by the
  panel rendering, which is what allows a never-rendered tab to recover. It MUST NOT be a timer or a
  poll. *(See Finding 2: this mirrors the editors' `onDiskChange` push mechanism rather than
  subscribing to a shared signal, because no shared signal exists.)*
- **FR-031**: A recovered terminal MUST start in the directory it was configured for, subject to the
  existing fallback rule (025 FR-030).
- **FR-032**: Every affected terminal in the project MUST recover, across every tab, including tabs
  never rendered in this session.
- **FR-033**: Recovery MUST NOT raise a notice per recovered panel.
- **FR-034**: Recovery MUST reuse the Panel's remembered type and configuration (029 FR-004a / #204).
- **FR-035**: A start that failed for a reason **unrelated** to the path MUST NOT arm a watch and
  MUST NOT retry.
- **FR-036**: A terminal that is **dormant** under FR-022 has not failed, and a path-availability
  event MUST NOT start it. Manual mode is the user's decision and outranks recovery.
- **FR-037**: A path-availability event in one project MUST NOT start any other project's terminals
  (Principle I).
- **FR-038**: The panel's failure banner MUST clear when the terminal recovers, by the same rule the
  editor's does.
- **FR-039**: ↻ Retry MUST remain available and unchanged as the manual route.
- **FR-040**: Recovery MUST NOT restore scrollback, a running process or shell history. It is a fresh
  shell in a directory that came back. Where that is not self-evident to the user, the UI MUST say so.
- **FR-041**: Recovery MUST NOT bypass the daemon boundary — the reconnect is driven exactly as a
  start is.
- **FR-042**: A watch MUST be disposed when the Panel is destroyed, when the terminal starts by any
  route, or when the project closes. A dormant or destroyed Panel MUST NOT leave a watch behind.

### D. Cross-cutting

- **FR-050**: All four new settings MUST have descriptors in
  `packages/core/src/config/settings-metadata.ts` with a shipped default, so that no setting is
  reachable only by hand-editing a file (Principle X).
- **FR-051**: No setting introduced here may be **inert** — each MUST have a reader outside the
  config layer. (#108 proposes a fleet-wide guard for this; this spec does not depend on it, but must
  not add a counter-example to it.)

### Key Entities

- **Terminal reload mode** — a global preference with two values, Automatic and Manual, read when a
  project is opened. It is not persisted per project or per panel.
- **Dormant terminal panel** — a Panel of terminal type, present in the layout with its name, type
  and position intact, holding no PTY and no shell, offering a Reload action. Distinct from a
  **failed** terminal, which holds a failure banner and a ↻ Retry.
- **Terminal default seeds** — three global preferences read when a *fresh* terminal Panel's setup
  form is populated, below the Panel's own remembered configuration in precedence.
- **Path-availability watch** — a watch armed on a failed terminal's unresolvable working directory
  (or nearest existing ancestor), disposed on start, destruction or project close, which fires at
  most one retry.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean config, Preferences → Terminal shows the four new controls, and the three
  #223 toggles read off / on / off.
- **SC-002**: With Automatic selected, opening a project with N terminals starts N shells — byte-for-byte
  today's behaviour, with no test in the existing suite changing its expectations.
- **SC-003**: With Manual selected, opening a project with N terminals starts **zero** shells and
  zero `conhost` processes, and presents N dormant placeholders.
- **SC-004**: A user can open a project with twenty terminals, reload two, and leave eighteen
  dormant, in two clicks after the project opens.
- **SC-005**: A terminal failed on a missing working directory starts by itself within one filesystem
  event of the directory reappearing, with no user action.
- **SC-006**: Four terminals across two tabs — at least one tab never rendered in the session — all
  recover from one restoration of the path, raising zero notices.
- **SC-007**: A terminal failed for a non-path reason performs exactly one start attempt and never
  retries.
- **SC-008**: A terminal Panel holding an **explicit** `rememberCommand`, `rememberDirectory` or
  `runAsAdmin` value keeps that value and its behaviour on upgrade, and nothing is rewritten on disk.
- **SC-009**: A terminal Panel with **no** `rememberCommand` key stops remembering its last command
  on upgrade (FR-005a), and turning the preference on restores the old behaviour for **every** such
  Panel in one action.

---

## Supersessions

Stated explicitly rather than left to be discovered, per the repository's rule that an older
requirement which genuinely should change is a supersession naming what it replaces and why.

- **025 FR-015 is RESTORED, not superseded.** It requires command memory to default **off**; the code
  has shipped it **on** since an undocumented change (Finding 1). FR-002 of this spec puts the
  shipped default back to **off** and FR-001 makes it discoverable in Preferences, which answers the
  objection the code change was made for. 025 FR-047a's safeguard is in force again as a result.
- **This spec supersedes the undocumented code-level default at `panel-type.ts:85` and `:140`**, and
  the tests that pin it: `packages/core/tests/unit/terminal-memory.test.ts:152`,
  `packages/core/tests/unit/panel-type-descriptor.test.ts` (lines 44, 55, 111, 119) and
  `packages/ui/tests/unit/panel-type-form.test.ts` (lines 46, 63, 89). Those tests are correct today
  and MUST change with FR-002 — they are not collateral, they are the record of the behaviour being
  changed.
- **025 FR-027b is NOT superseded.** Directory memory continues to default **on**, and "absent means
  on" remains correct **for that field only**. FR-002 keeps it on. The two fields' defaults differ
  deliberately: a remembered directory cannot execute anything, and a remembered command can — which
  is the distinction 025's own clarification of 2026-07-27 drew and which the code lost.
- **A stale citation MUST be corrected**: the comment at `panel-type.ts:83` directs the reader to
  `parseTerminalConfig`, which no longer exists in the repository. Whatever the comment becomes, it
  must not point at a function that is not there.

---

## Assumptions

- The user forking this work is the maintainer, and their selection of this group is the scope
  agreement the three issue templates ask for. **The `Agreed by maintainer` checkbox is unticked on
  all three issues (#293, #223, #237)** and should be ticked to make that explicit.
- **#223's stated defaults are the decision.** The issue names off / on / off, and Finding 1 shows
  that agrees with 025 FR-015. This spec proceeds on it rather than re-opening it.
- **The reload preference is global.** Per-project and per-panel overrides are out of scope by #293's
  own scoping, and this spec does not design for them.
- Manual mode changes only *when* a reload happens, never *what* a reload does.
- Spec 038 (#290, #279, #280) is the earlier branch and lands first. This spec's implementation
  rebases onto it. #290 in particular — terminal scrolling dying after a project switch — lives in
  the reload path FR-021 and FR-025 depend on, so its fix is a prerequisite for trusting them.
- Editor panels and the explorer are untouched by all three stories.

---

## Decisions taken

- **D-1 — FR-030's mechanism: the per-failure watch, not a shared signal.** Referred and **ruled**.
  Finding 2 established that no shared path-availability signal exists. The per-failure watch is
  taken because it meets every acceptance criterion — including the hard one, recovery in
  never-rendered tabs, which it meets precisely because the watch is armed by the **start failing**
  rather than by the panel rendering — and because it costs what the editors already pay per
  document, adding no shared infrastructure. Building the shared watch was rejected on scheduling,
  not merit: see Finding 2 and *Follow-ups filed*.
- **D-2 — FR-005a: an absent per-Panel value resolves to the global preference.** Ruled deliberately
  rather than allowed to fall out of the implementation. It is the one change here that alters
  behaviour for an existing install, and the reasoning is recorded at FR-005a so it can be reversed
  cheaply if the maintainer disagrees.
- **D-3 — the 025 FR-015 conflict is a supersession stated from this spec, not an in-place amendment
  of 025.** Amending 025 would erase the fact that it was contradicted for two releases; that fact is
  worth keeping. See *Supersessions*.
- **D-4 — the reload mode is a `select`, not a toggle.** `control: 'select'` with
  `allowedValues: ['automatic', 'manual']`. Taken because it **names both states**, which a toggle
  labelled "Reload terminals automatically" does not — and the dormant placeholder's wording has to
  agree with whatever the preference is called. It is also the established pattern rather than a new
  one: `select` is used 15 times in `settings-metadata.ts` against 12 toggles, several with an
  explicit `allowedValues` list.
- **D-5 — dormancy persists across a restart, and is re-evaluated on the next project open.** FR-027
  requires a dormant Panel to keep its name, type and position across a restart, and to still be
  dormant. The two candidate rules — "dormancy is persisted" and "dormancy is session-local, with the
  preference re-applied from scratch" — agree for as long as the preference stays Manual, and differ
  the moment it is switched back to Automatic. Persisted dormancy is taken because the alternative
  silently starts twenty shells the user had deliberately left dormant, the moment they flip a
  preference for an unrelated reason. FR-029a covers the switch back: the new mode applies at the
  **next project open**, which is where a dormant Panel gets its chance to start.

## Follow-ups filed

Work this spec deliberately does **not** do, filed so the reasoning survives:

- **#306** — [Tweak] Consolidate the terminal and editor path-availability watches onto one project
  watch (`area:terminal`, `area:infra`, vNext). The architecture Finding 2 describes and D-1 defers.
  Cross-referenced to **#272**, which proposes the same consolidation for the explorer and file-index
  watches; the two belong together and should be visible to each other.
- **#307** — [Enhancement] Nothing detects a functional requirement that production code has stopped
  honouring (`area:infra`, `area:preferences`, vNext). Production code contradicted 025 FR-015 for two
  releases with no amendment, and left a citation pointing at a function (`parseTerminalConfig`) that
  no longer exists. Filed independently of #223 so the record survives even if #223 changes course.
  Cross-referenced to **#108**, whose "a control that governs nothing must not ship" is the same class
  of defect as "a requirement nothing honours".

## Open Questions

None outstanding. All five decisions are recorded above.
