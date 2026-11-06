# Feature Specification: Every failure leaves a trace in the diagnostic log

**Feature Branch**: `feature/S066-I543-failure-logging`

**Created**: 2026-11-06

**Status**: Draft

**Input**: Issue #543 — "Failures leave no trace in the diagnostic log: logging audit and constitution principle".

## Background

The diagnostic log is the only channel an installed build has for explaining a failure (#123): the user
opens the logs folder from the cog menu and sends what is there. throng keeps shipping processes and
failure paths that fail without writing anything to it, and each has been fixed locally after a user hit
it, so the next new process repeated the mistake:

| Process | What went silent | Fixed by |
|---|---|---|
| PTY agent | its start failure stopped with no callback or error (019) | a one-off agent log |
| Daemon | a failed start or a death said nothing | #123 |
| Resource collector | it died while loading, before any of its own code ran, and its exit was not recorded | #542 |

Nothing requires a new process or failure path to use the log. The constitution has no logging or
observability principle, which is why this recurs. This feature adds the rule and brings the codebase
into line with it.

## Clarifications

### Session 2026-11-06

- Q: When throng catches a failure the code expects in normal operation, should it still write it to the diagnostic log at debug level, or write nothing and just explain at the site why it's expected? → A: Log it at debug level with the stated reason; unexpected failures at warn/error. Every catch logs something. Add a **fatal** level for the crash of any component — a process, a window, or a panel; a panel that fails is fatal.
- Q: Should every process's own log, including the PTY agent's (today in the system temp folder as `throng-agent-<pid>.log`), move into the logs folder the cog menu opens? → A: Yes — every process writes its own log into that folder, nothing to temp. All logs roll over, and by default the sessions of the last 3 active days are kept.
- Q: Within the kept days, should the logs folder also have a total size cap that deletes the oldest files first once it is exceeded? → A: Yes — 100 MB by default, configurable in settings.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A failing part of an installed build is explained in the logs (Priority: P1)

A user of an installed build sees part of throng not working: a status-bar item that never appears, a
terminal that will not start, a background helper that keeps restarting. They open the logs folder from
the cog menu. Whatever failed has written what failed and why, with enough detail for a maintainer to act
without reproducing it on a developer machine.

**Why this priority**: This is the outcome the issue exists for. Every other story serves it.

**Independent Test**: Make a helper process throng starts fail in each way it can — fail to start, die
while loading, exit abnormally, report an error — and confirm the diagnostic log names the process, the
failure and the reason each time.

**Acceptance Scenarios**:

1. **Given** a helper process that dies while loading, before any of its own code runs, **When** throng
   starts it, **Then** the log records that the process failed, its exit code or signal, and what it
   printed on its error output.
2. **Given** a running helper process, **When** it exits when nothing asked it to, **Then** the log records
   the exit and its code or signal.
3. **Given** a helper process that reports an error to throng over its message channel, **When** the
   report arrives, **Then** the log records it.
4. **Given** a short-lived helper command throng runs to probe the system, **When** it cannot be started or
   exits with a failure, **Then** the log records the command, the failure and its error output.

---

### User Story 2 - A new process or failure path cannot ship silent (Priority: P2)

A contributor adds a new helper process, or a new place that catches an error. If it would fail without a
trace, the build tells them before review does.

**Why this priority**: Without enforcement the audit's fixes decay: each new feature has so far added one
new silent process.

**Independent Test**: Add a helper process whose error output is discarded and whose exit nobody records;
the build fails and names it. Add the same with its failure recorded; the build passes.

**Acceptance Scenarios**:

1. **Given** a new helper process started with its error output discarded and no recorded exit, **When**
   the build runs, **Then** it fails and names the file and line.
2. **Given** a new catch that swallows an error, **When** the build runs, **Then** it fails unless the catch
   logs the error — at debug with its stated reason if the failure is expected.
3. **Given** a process start whose discarded output is a deliberate exception, stated at the site, **When**
   the build runs, **Then** it passes.

---

### User Story 3 - The rule is part of the constitution (Priority: P3)

A maintainer reviewing any future plan can point to a principle that says failures must be logged, and
the Constitution Check gate asks every plan about it.

**Why this priority**: It is what makes the rule binding on future specs, but on its own it changes no
behaviour.

**Independent Test**: Read the constitution and a freshly generated plan; the principle is there, and the
plan's Constitution Check asks about it.

**Acceptance Scenarios**:

1. **Given** the amended constitution, **When** a plan is generated, **Then** its Constitution Check
   includes the logging principle.

---

### Edge Cases

- A process that fails before it can load any of its own code, including its logger: only its parent can
  record it, so the parent always records a child's abnormal exit and error output.
- A child that writes a great deal to its error output: the log keeps enough to explain the failure
  without growing without bound.
- A failure the code expects in normal operation (a probe for something that may legitimately be absent, a
  file that may already be gone, a best-effort cleanup during shutdown): it is not an error, and logging it
  as one would bury real failures. It is logged at debug level with the reason it is expected, so it is
  absent from a normal log and present when debug logging is switched on.
- A panel that throws while rendering: the panel's failure is fatal and logged as such, even though the rest
  of the window keeps running.
- A failure that repeats on a timer (a helper restarted every minute): it is recorded every time, but does
  not flood the log with identical lines.
- A process that exits cleanly because throng told it to: not a failure, not logged as one.
- A failure while the log itself is unavailable (its folder cannot be written): throng keeps running, and
  the failure still reaches the developer console.

## Requirements *(mandatory)*

### Functional Requirements

**The principle**

- **FR-001**: The constitution MUST carry a principle that requires every process throng starts to have its
  startup failure, its abnormal exit and the reason for both recorded in the diagnostic log — by the
  process itself where it can, and by its parent always.
- **FR-002**: The principle MUST require that an error reported by a child, or caught and not re-thrown, is
  logged — an expected failure at debug level with the reason it is expected, any other at warn or above —
  and that the crash of any component (a process, a window, a panel) is logged as fatal.
- **FR-003**: The principle MUST state that no feature may fail in a way that leaves the diagnostic log
  empty.
- **FR-004**: The amendment MUST follow the constitution's own amendment rules: the version bump argued,
  the sections changed listed, and the templates and artifacts reviewed for consistency.

**Processes throng starts**

- **FR-005**: For every long-lived process throng starts (the daemon, the PTY agent, the resource
  collector and any other), its parent MUST record a failure to start, an exit nothing asked for (with
  its code or signal) and the tail of its error output.
- **FR-006**: For every short-lived helper command throng runs, a failure to start or a failing exit MUST
  be recorded with the command, the failure and its error output — unless the failure is an expected
  outcome of the probe, stated at the site.
- **FR-007**: An error or status report a child sends to throng over a message channel MUST be logged, not
  dropped.
- **FR-008**: A process exit throng asked for MUST NOT be logged as a failure.

**Caught errors**

- **FR-009**: Every place that catches an error and does not re-throw it MUST log it. A failure the code
  expects in normal operation is logged at **debug** level with the reason it is expected, stated at the
  site; any other caught failure is logged at **warn** or **error**.
- **FR-009a**: The diagnostic log MUST have a **fatal** level, above error, and the crash of any component
  MUST be logged at it: a process throng starts, a window, or a panel. A panel that fails — throws while
  rendering, or is torn down by a failure rather than by the user — is fatal. Fatal records are written
  whatever log level is configured.
- **FR-010**: Every such site that exists when this feature starts MUST be classified as a bug, latent,
  hardening or not-a-bug candidate by the repository's bug-finding rules, and brought into line with
  FR-009. A reachable failure that is silent today is a bug this feature fixes by logging it; a defect in
  the failure itself, beyond its logging, is filed as its own issue.

**Enforcement**

- **FR-011**: The build MUST fail on a process start whose error output is discarded and whose failure is
  not recorded by its parent, naming the file and line.
- **FR-012**: The build MUST fail on a catch that swallows an error without logging it, naming the file and
  line. A catch that logs at debug level MUST carry its stated reason.
- **FR-013**: A deliberate exception to FR-011 MUST be stated at the site, in words a reviewer can read,
  and the build MUST accept it. FR-012 has one exception, stated at the site: the log writer's own last-resort
  write to stderr, which has nowhere left to report its own failure (FR-016). Every other expected failure is
  still logged, at debug.

**Log behaviour**

- **FR-014**: A child's error output recorded in the log MUST be bounded, so a child that writes without
  limit cannot fill the log.
- **FR-015**: A failure that repeats on a timer MUST be recorded without filling the log with identical
  lines; the log still shows that it is repeating and how often.
- **FR-016**: Logging a failure MUST NOT itself be able to crash or stall the process that is logging it.
- **FR-017**: Every process throng starts that writes a log of its own MUST write it into the diagnostic log
  folder the cog menu opens — nothing to the system temp folder. A process running as a different user (the
  de-elevated PTY agent) writes to that user's own throng log folder.
- **FR-018**: Every log MUST roll over: a file that reaches its size limit is closed and a new one started.
- **FR-019**: Retention MUST be by **active day**: a day on which throng ran. By default every session from
  the last **3** active days is kept, in every log, and anything older is deleted. Days on which throng did
  not run do not count, so a week away does not empty the folder. The number of days is a setting.
- **FR-019a**: The logs folder MUST also be capped in total size — **100 MB** by default, a setting. Over
  the cap, the oldest files are deleted first, whatever their day, and the log records that history was
  trimmed and how much. The file being written is never deleted.
- **FR-020** *(supersedes 031 FR-015's `diagnostics.keepFiles` row and the `diagnostics.keepFiles` setting
  it bounds)*: retention by a count of files per process is replaced by FR-019's active days; a count of
  files says nothing about how far back a log reaches, which is what a user sending it needs to know.

### Key Entities

- **Diagnostic log**: the per-user log files an installed build writes, in the one folder the cog menu
  opens — every process's log included. The only record of a failure a user can send.
- **Active day**: a calendar day on which throng ran; retention counts these, not elapsed days.
- **Process throng starts**: any child process — long-lived (daemon, PTY agent, resource collector) or a
  short-lived helper command (a probe, a cleanup).
- **Swallowed error**: a caught error that is neither re-thrown nor reported anywhere.
- **Expected failure**: a caught failure the code anticipates in normal operation, logged at debug level
  with a short stated reason.
- **Fatal failure**: the crash of a component — a process, a window or a panel — logged at the fatal level
  whatever log level is configured.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every process throng starts, a deliberately induced failure to start, death while
  loading and unasked-for exit each leave a log record naming the process, the failure and its reason —
  100% of processes, proven by automated tests.
- **SC-002**: Every caught-and-not-re-thrown error site in the shipped code logs: zero silent sites, and
  every debug-level one states why its failure is expected, checked by the build.
- **SC-003**: Introducing a new silent process start or a new silent catch fails the build on every
  attempt, and names where.
- **SC-004**: The audit of every site that existed at the start is recorded with each site's
  classification, so a reviewer can see none was skipped.
- **SC-005**: A helper failing on a timer for an hour leaves a log a person can read through in under a
  minute, while still showing every occurrence was counted.
- **SC-006**: A panel made to throw while rendering, and a window or process made to crash, each leave a
  fatal record naming it — under every configured log level.
- **SC-007**: After throng has run on 5 separate days with gaps between them, the logs folder holds the
  sessions of exactly the last 3 of those days, for every process, and nothing anywhere else.
- **SC-008**: A component that crash-loops for a full day leaves the logs folder at or under the size cap,
  with a record that older history was trimmed.

## Assumptions

- The diagnostic log infrastructure from #123 (per-user log files, rotation, levels, the crash hooks) is
  reused and extended (a fatal level, active-day retention); the only destination is the existing logs
  folder.
- "Session" means one run of the process that writes the log. A file's day is the day it was last written,
  so a long-running process's live file always counts as today and is never pruned while it is in use.
- "Fixed in passing" from the issue means a silent but harmless site is brought into line on this branch
  without its own issue; a reachable silent failure is also fixed here, since its silence is the defect
  this feature covers. Only a defect in the underlying failure itself gets a separate issue.
- The audit covers the shipped code under each package's source tree; tests, scripts and build tooling
  are out of scope.
- The constitution amendment is MINOR: it adds a principle without withdrawing any guarantee, though the
  codebase does not meet it on day one, which the constitution's own precedent treats as MINOR.
- The guard tests run in the existing unit layer, so they gate every pull request.
- #542, the resource collector's silent death, is already fixed; its case stays as one of this feature's
  regression scenarios.
