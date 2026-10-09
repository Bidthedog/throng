# Feature Specification: The Terminal Service Never Stops Answering

**Feature Branch**: `feature/S051-S052-I468-I190-I193-I397-I111-nonblocking-calls-follow-moves` (shared with 052)

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Group 1 of the terminal-notification backlog plan: #468 (switching project
straight after unloading one fails with an RPC timeout), #190 (descendant-process lookup blocks the daemon
on a synchronous full process-table scan) and #193 (command memory cannot see a process the shell did not
parent), plus two guards against regression — a build-failing ban on blocking process calls in the
terminal service, and a test that the service keeps answering while terminals end. For #468 the user must
not be made to wait or retry after an unload: either the switch waits for the unload, or it goes ahead
anyway. For #193, the remembered running command must clear when nothing runs any more, however the
process ended."

Tracked as [#468](https://github.com/Bidthedog/throng/issues/468),
[#190](https://github.com/Bidthedog/throng/issues/190) and
[#193](https://github.com/Bidthedog/throng/issues/193).

This feature builds on **005** (terminal panels: FR-015e app-close choices, FR-017 unexpected exit, FR-018
destroy), **025** (command memory and its shared observation: FR-019a–g, FR-022, FR-022a) and **046**
(Unload: FR-034, FR-036, FR-086). Every requirement in those specs not named below as superseded or
extended stands unchanged.

**Why one feature.** All three issues are one defect seen from three places. The terminal service is a
single process serving every terminal and every request from every window. Wherever it asks the operating
system something about processes — "end this one", "what is running under this shell", "which console
hosts are mine" — it currently stops and waits for the answer, and while it waits nothing else is served:
no terminal output, no keystrokes, no project switch. #468 is what that looks like after an Unload, #190 is
what it looks like on close and spawn, and #193 is the same process-observation seam answering the wrong
question. 025 already proved the non-blocking route for its own observation (FR-019b); this feature brings
every other process call onto it.

**Supersession (conditional on User Story 4).** 025 FR-022a fixes the candidate set for "what is running in
this terminal" as *exactly the shell's direct children*. FR-040 widens that to every process attached to the
terminal, with the shell's children as the fallback. FR-022's other guarantees — derivable from operating
system observation alone, no shell-integration marks, no per-flavour cooperation, identical for a
user-defined flavour — are kept. If User Story 4 does not ship (FR-045), 025 FR-022/FR-022a stand
unchanged.

**Supersession (2026-10-08).** 025 FR-017 leaves the saved Startup Command "exactly as it was" when a
terminal ends with nothing running. FR-046 replaces it: with command memory on, that end clears the saved
command, so a command the user stopped never runs again on the next start. 025 FR-016, FR-018 and FR-026c
are unchanged.

## Clarifications

### Session 2026-10-05

- Q: After an Unload with End Terminals, should switching to another project wait for the unload, tell the
  user to wait, or go ahead? → A: **Go ahead, with no wait.** The Unload already releases the project from
  the workspace before it ends any terminal (046), so nothing the switch needs depends on the terminals
  having ended. The switch failed only because the terminal service stopped answering while it ended them.
  A "please wait" indicator would hide the cause rather than remove it. (FR-001–FR-004)
- Q: Should the terminal service become multi-threaded? → A: **No.** The service is not short of computing
  power; it is waiting on other programs. Asking without waiting removes the stall with no change to the
  service's shape, and the service already does so for 025's observation. (Assumptions)
- Q: Should #193 be part of this feature? → A: **Yes, as the last story, gated on a measurement.** It
  shares the process-observation seam. If the measurement shows the operating system cannot attribute a
  re-parented command to its terminal, the story is withdrawn and its findings go on #193. (FR-045)
- Q: For #193, what about a command that has ended? → A: **The remembered running command MUST clear once
  nothing runs, however the process ended** — normal exit, interrupt, termination, or a kill from outside
  throng. (FR-042)
- Q: When an end throng asked for fails or times out, what happens to that terminal? → A: **It is no longer
  "ending": it reattaches on the next load like any surviving terminal**, and the Unload's single notice
  says so once the outcome is known. FR-004 holds only while an end is in flight. (FR-002, FR-004, FR-005)
- Q: Must every request in the responsiveness test answer within 100 ms? → A: **Every request ≤ 100 ms
  locally; a looser bound on CI only** — 500 ms, still far below the one-to-several-second stall this
  feature removes, so hosted-runner noise does not turn the guard into a source of iteration. (FR-021)
- Q: How long is #193's measurement time box? → A: **Two hours of work, an absolute maximum.** An
  inconclusive result at the limit counts as negative and withdraws User Story 4. (FR-045)

### Session 2026-10-06

- Q: How long should throng wait for the operating system to end a terminal before it treats that end as
  failed? → A: **5 seconds, held in one named constant** so it can be changed in a single place. It is not
  a user preference. (FR-013a)
- Q: If throng is closing and ending a terminal times out, what happens to that terminal's processes? →
  A: **Escalate to a forced kill of the terminal's whole process tree**, waiting at most one more time limit
  (FR-013a); any process that still survives is written to the log. FR-005's "stays running and
  reattaches" applies to an Unload only, never to shutdown. (FR-015, FR-015a)

### Session 2026-10-07

- Q: node-pty starts a terminal in one synchronous native call, measured at 43–95 ms, so a request that
  arrives while a terminal starts waits for it. Hold starts to FR-021's 100 ms anyway (start terminals off
  the service's thread), or allow starts that measured cost? → A: **Allow it.** The end and busy phases keep
  the 100 ms bound exactly; a request made while terminals start may take up to 100 ms more. (FR-021)

### Session 2026-10-08

- Q: A command stopped with Ctrl+C before its terminal ends still runs again on the next start, because
  025 FR-017 keeps the saved Startup Command when nothing is running. Clear only a command throng
  captured, always clear, or keep FR-017? → A: **Always clear.** With command memory on, a terminal that
  ends with nothing running clears its saved Startup Command, a typed one included. (FR-046)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch project straight after unloading one (Priority: P1)

A user tidies their project list. They unload the active project, choosing to end its terminals, and
immediately click another project. The switch happens at once. The unloaded project's terminals end in the
background.

**Why this priority**: This is the reported defect (#468). Today the switch fails with a raw error and is
reverted, every time the user moves on quickly, and more often the more terminals the project had.

**Independent Test**: Open projects A and B, with four terminals running in A. With A active, choose
**Unload Project and End Terminals**, then click B straight away. B opens with no error. A's terminals are
gone within a few seconds.

**Acceptance Scenarios**:

1. **Given** project A has several running terminals and is active, **When** the user unloads A with End
   Terminals and immediately switches to B, **Then** B becomes active with no error and no reverted switch.
2. **Given** the same, **When** B is already loaded, **Then** the switch is just as immediate.
3. **Given** A's terminals are still ending, **When** the user loads A again, **Then** A opens with fresh
   terminals; no panel reattaches to a terminal that was being ended (FR-004).
4. **Given** a terminal of A cannot be ended, **When** the Unload finishes, **Then** the single existing
   Unload notice reports it (046) once the outcome is known, saying it is still running and will reattach
   when A is opened again (FR-005), and nothing about the switch to B is affected.

---

### User Story 2 - Other terminals keep working while terminals end or start (Priority: P1)

A user has a Claude Code session streaming in one project and closes a panel, unloads a project, or opens
three new terminals in another. The streaming terminal never stutters, and what they type into any
terminal echoes as normal.

**Why this priority**: The stall behind #468 is not specific to Unload. Every end, every start and every
close decision freezes every terminal and every window for as long as the operating system takes to answer
(#190) — one to several seconds on a busy machine.

**Independent Test**: Run a command that prints a line every 50 ms in terminal X. In another project, open
five terminals, then unload that project with End Terminals. Terminal X's output shows no gap longer than a
fraction of a second throughout.

**Acceptance Scenarios**:

1. **Given** a terminal printing continuously, **When** other terminals are ended (panel close, Unload,
   project delete), **Then** its output keeps flowing without a visible pause.
2. **Given** the same, **When** new terminals start, **Then** its output keeps flowing without a visible
   pause.
3. **Given** the user types into a terminal, **When** other terminals end or start at the same moment,
   **Then** the keystrokes echo without a visible delay.
4. **Given** a terminal's process exits on its own, **When** throng tidies up after it, **Then** no other
   terminal pauses.

---

### User Story 3 - Closing with many terminals does not freeze (Priority: P2)

A user closes throng with ten terminals open and chooses **Terminate all**, or closes a panel whose
terminal is busy. throng responds at once, and every terminal still ends with nothing left behind.

**Why this priority**: The same stall, at the moments the user is already waiting for throng. The decision
"is this terminal busy?" is today asked one terminal at a time, each costing a full scan of the machine's
processes (#190).

**Independent Test**: Open ten terminals, five of them running a long command. Close throng and choose
Terminate all. The window closes promptly, and no shell, console host or command from those terminals is
left running.

**Acceptance Scenarios**:

1. **Given** many terminals, **When** throng decides which are busy (app close, panel destroy, Unload),
   **Then** it asks the operating system once for all of them, not once per terminal.
2. **Given** a busy-check that fails or times out, **When** throng decides, **Then** the terminal counts as
   busy, as today (046).
3. **Given** Terminate all, **When** throng closes, **Then** every terminal, its running command and its
   console host have ended — nothing is left behind (005 FR-015e, Principle III).

---

### User Story 4 - Command memory sees a command started through a launcher (Priority: P3)

A user runs `docker run …` in a Git Bash terminal with command memory on. The terminal's running command
is remembered, as it already is in cmd and PowerShell. When the container stops — normally, by Ctrl+C, or
killed from outside — the running command clears.

**Why this priority**: #193. Today a command handed off through a launcher (a wrapper script, a
service-brokered CLI, `start`) is invisible, because throng only looks at the shell's own children. It
matters more once #4's "command finished" signal depends on the same observation.

**Independent Test**: In a Git Bash terminal with command memory on, run a long-lived `docker run`
command. Close throng with Terminate all, reopen the project, and check that the panel's startup command
is the `docker run` command. Then run it again, press Ctrl+C, and check that the panel no longer reports a
running command within one observation interval.

**Acceptance Scenarios**:

1. **Given** a command whose process the shell did not start directly but which runs in the terminal,
   **When** command memory observes the terminal, **Then** it is the terminal's running command.
2. **Given** that command ends, by any route, **When** the next observation runs, **Then** the terminal
   reports nothing running (FR-042).
3. **Given** an observation that fails, **When** it runs, **Then** the last known value stands (025
   FR-019e) — a failed look is never read as "nothing running".
4. **Given** cmd, Windows PowerShell and pwsh, **When** the same command runs, **Then** it is remembered
   exactly as before this feature.

---

### Edge Cases

- **Ending a terminal that is already exiting.** Asking to end a terminal whose process is exiting on its
  own does nothing harmful, raises no error and produces one exit, not two.
- **The operating system never answers.** Every request to it has a time limit. A request that times out
  is reported like a failure of that one terminal; it never holds up another terminal or request.
- **An end requested within moments of a start.** The terminal ends, and its console host with it. No host
  process is left behind because the end arrived before throng had identified it.
- **A burst of ends.** Unloading a project with twenty terminals sends twenty ends at once; the service
  keeps answering throughout, and each exit is reported as it happens.
- **App close while ends are in flight.** throng waits for the ends it has started before the terminal
  service stops, so nothing outlives it (Principle III). An end that fails or times out then is escalated
  to a forced kill of the terminal's process tree (FR-015a).
- **Reload during an end.** See User Story 1, scenario 3.
- **A launcher that stays attached.** If the launcher itself stays running alongside the command it
  started, the most recently started process of the two is the running command, per 025 FR-022's
  tie-break.
- **Helpers throng starts.** Processes throng itself starts to ask the operating system questions are never
  reported as the terminal's running command.

## Requirements *(mandatory)*

### Functional Requirements

#### A. Switching after an Unload (#468)

- **FR-001**: Switching project MUST NOT fail, be reverted, or be delayed because another project is being
  unloaded, whatever the Unload's terminal action and however many terminals it ends.
- **FR-002**: Ending a project's terminals (046 FR-034 End Terminals) MUST complete in the background. The
  Unload reports any failure through its existing single notice (046), and the user is never asked to wait
  or retry.
- **FR-003**: A request to end a terminal MUST be acknowledged without waiting for the terminal to finish
  ending. Its exit is reported when it happens, as today.
- **FR-004**: A terminal throng has been asked to end MUST NOT be reattached to any panel while its end is
  in flight. Loading its project again starts fresh terminals in its place, as it does today after an End
  Terminals Unload.
- **FR-005**: When an end fails or exceeds its time limit outside shutdown (shutdown is FR-015a), the
  terminal MUST stop being an ending terminal:
  it stays running and reattaches on the next load of its project, like any terminal that was never asked
  to end. The Unload's single notice (FR-002) MUST be raised once that outcome is known and say the
  terminal is still running and will reattach.

#### B. The terminal service stays responsive (#190, #468)

- **FR-010**: Every request the terminal service makes of the operating system about processes — ending a
  process, listing processes, identifying a terminal's console host — MUST be made without stopping the
  service. While one is outstanding, every terminal's input and output and every other request MUST
  continue to be served. This extends 025 FR-019b from command tracking to every process request.
- **FR-011**: Deciding which terminals are busy MUST ask the operating system once for all the terminals
  being decided together, not once per terminal (extending 025 FR-019a to the busy decision).
- **FR-012**: A busy decision that fails or times out MUST count the terminal as busy (unchanged from 046).
- **FR-013**: Every request to the operating system MUST have a time limit, and a request that exceeds it
  MUST be treated as that request's failure only.
- **FR-013a**: The time limit for ending a terminal MUST be 5 seconds, defined once as a single named
  constant that every end request and FR-015's shutdown wait read, so changing it is a one-line edit. It is
  not exposed as a user preference.
- **FR-014**: Ending a terminal MUST still end its running command and its console host (005 FR-018,
  Principle III), including when the end arrives before throng has identified the host.
- **FR-015**: When the terminal service shuts down, it MUST wait for the ends it has started, within their
  time limits, so no terminal process outlives throng (Principle III).
- **FR-015a**: When an end fails or exceeds its time limit during shutdown, throng MUST escalate to a forced
  kill of that terminal's whole process tree — shell, running command and console host — and wait for it at
  most one further time limit (FR-013a). Any process still running after that MUST be recorded in the log
  by process id and name. FR-005's fallback (stay running, reattach on next load) MUST NOT apply at
  shutdown.
- **FR-016**: An exit throng caused MUST still be reported as user-initiated, not unexpected (005 FR-017).
  This feature MUST NOT add a process observation to any end path; the order in which an end and the
  remembered command are settled stays as it is today (research R13: 025 FR-019g's final observation is
  not taken by the daemon today, and adding it is outside this feature). The observation meant is command
  memory's: an end's own bounded read of the processes attached to the terminal's console, to know what
  to end (FR-014), settles no remembered command and is not one.
- **FR-017**: Requests made only while the terminal service starts, before it serves any window, MAY wait
  for their answer, and MUST be listed by name as the only exceptions to FR-010 (FR-020).

#### C. Guards against regression

- **FR-020**: The build MUST fail when code in the terminal service, or in the platform layer it uses to
  manage processes, makes a process request that stops the service while it waits. The exceptions in
  FR-017 MUST each be marked at the call with the reason it is allowed.
- **FR-021**: An automated test MUST start several terminals, end them together, and fail if, while they
  end, the terminal service takes longer than 100 ms to answer any unrelated request. On CI the bound
  for every request is 500 ms instead. The same test MUST cover a busy decision across those terminals
  and the start of new terminals; a request made while terminals start is allowed a further 100 ms, the
  measured cost of node-pty's synchronous start (Clarifications, 2026-10-07).
- **FR-022**: An automated test MUST reproduce #468 — Unload with End Terminals on a project with several
  running terminals, then an immediate switch — and fail if the switch errors, is reverted, or takes more
  than one second.

#### D. Command memory sees launched commands (#193, conditional)

- **FR-040**: The running command of a terminal MUST be chosen from every process attached to that
  terminal, not only the shell's direct children. Where the operating system cannot say which processes
  are attached, the shell's direct children MUST be used, exactly as 025 FR-022 defines. This supersedes 025
  FR-022a's candidate set (see Supersession, above).
- **FR-041**: Observing attached processes MUST keep 025 FR-019a: one shared observation covering every
  terminal, whose cost does not grow with the number of terminals. It MUST keep FR-010 and 025 FR-019b.
- **FR-042**: When no process other than the shell remains attached to a terminal, the next observation
  MUST report nothing running, however the command ended: normal exit, interrupt, termination by signal, or
  a kill from outside throng. A failed observation MUST leave the last value in place (025 FR-019e).
- **FR-043**: The shell itself, throng's own helper processes and the terminal's console host MUST never be
  reported as the running command.
- **FR-044**: For any command the shell starts directly, the result MUST be the same as before this
  feature, in every shell flavour.
- **FR-045**: Before FR-040–FR-044 are built, a measurement MUST establish that the operating system
  reliably reports a re-parented command (the `docker run` case in #193) as attached to its terminal,
  across repeated samples while the command is running. The measurement is limited to two hours of work,
  an absolute maximum. If it does not establish this, or is still inconclusive at the limit, User Story 4
  and FR-040–FR-044 are withdrawn from this feature, 025 FR-022/FR-022a stand unchanged, and the measurement is recorded on #193.
- **FR-046**: With command memory on, a terminal that ends with nothing running MUST clear its Panel's
  saved Startup Command, whichever path ended it — including an end throng only learns of on the next
  start (an Unload, a crash), where the last observation was "nothing running". Supersedes 025 FR-017.

### Key Entities

- **Process request**: anything the terminal service asks the operating system about processes: end one,
  list them, find a terminal's console host, list what is attached to a terminal. Has a time limit, and
  never stops the service while outstanding.
- **Ending terminal**: a terminal throng has been asked to end and whose exit has not yet been seen. It
  cannot be reattached, and its exit is user-initiated. It stops being an ending terminal when it exits,
  or when its end fails or times out (FR-005), after which it is an ordinary running terminal again.
- **Attached process** (User Story 4): a process the operating system reports as running in a terminal's
  console, whoever started it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Following #468's steps — unload a project with End Terminals, then switch straight away —
  succeeds every time, in 20 consecutive attempts with four or more terminals in the unloaded project.
- **SC-002**: While ten terminals are ended together, or five are started together, a terminal printing
  every 50 ms shows no gap over 100 ms beyond its own interval.
- **SC-003**: While terminals end, start or are checked for busy, keystrokes in any other terminal echo
  within 100 ms. SC-002 and SC-003 are measured on a developer machine; on CI, FR-021's 500 ms bound
  applies.
- **SC-004**: Closing throng with Terminate all and ten terminals open leaves zero shell, command or
  console-host processes from those terminals running.
- **SC-005**: The time to decide which of ten terminals are busy is no more than the time to decide for one,
  within measurement noise.
- **SC-006**: Introducing a blocking process request into the terminal service fails the build.
- **SC-007** *(User Story 4)*: A `docker run` command in Git Bash is remembered as the running command in 10
  of 10 attempts, and clears within one observation interval of being interrupted in 10 of 10 attempts.

## Assumptions

- **No multi-threading.** The stall comes from waiting on other programs, not from computation, so asking
  without waiting is enough. Running terminals across threads would also require sharing terminal state
  between them, at a cost this feature does not need to pay. Revisit only if a measured stall remains after
  this feature that is caused by the service's own work.
- **No wait indicator after Unload.** With the terminal service always answering, a switch has nothing to
  wait for. The existing failure notice for an unanswered request (#182's territory) is unchanged.
- Startup-only process requests in the terminal service (elevation check, orphan sweep at service start)
  remain waiting calls under FR-017, because nothing is being served yet. Shell detection runs in the UI's
  main process, not in the terminal service, so FR-010 and FR-020 do not govern it.
- The de-elevated terminal host process is held to the same rules as the terminal service, because it
  hosts terminals in its place.
- Windows 11 is the v1.0.0 platform. The requirements are stated behind the OS abstraction (Principle II),
  so another platform supplies its own non-waiting equivalents.
- #193's measurement is time-boxed to two hours (FR-045). A negative or inconclusive result is a complete outcome for that story, not a failure
  of this feature.
- #4 (attention marks) depends on the observation this feature hardens; it is a separate feature and a
  separate spec.
