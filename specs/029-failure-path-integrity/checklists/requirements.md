# Specification Quality Checklist: Failure-Path Integrity

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### Deliberate deviation: the Context section is technical

"No implementation details" is satisfied in **User Scenarios**, **Requirements** and **Success
Criteria** — none of them names a file, a class, an error code or a platform API. The **Context**
section deliberately does, because it records what the replication measured and where the four issue
reports were found to be wrong. Three of the four needed correcting, and two of those corrections
make the fix smaller than the issue asks for. Dropping them to satisfy a checklist would send
planning back to the uncorrected reports.

This matches the house style established by `specs/028-terminal-render-input-fidelity/spec.md`, whose
"Why these five together" section does the same thing for the same reason.

### Clarification session 2026-08-07 — five questions, five answers

Asked and integrated after the spec was drafted. Four confirmed the recommendation; one did not.

| # | Question | Answer | Where it landed |
|---|---|---|---|
| 1 | How does a user get rid of a panel stuck as a failed terminal? | Clear control in the failure state | FR-004a, FR-004b, US1 scenario 5 |
| 2 | How to collapse one cause's many failures into one notice? | Report the cause once, suppress the casualties | FR-019, FR-019a, FR-019b |
| 3 | Where does the demoted raw error text go? | Copy payload **and** diagnostics log | FR-018, FR-018a |
| 4 | Canonical term — "background service" or "daemon"? | **"Daemon" everywhere**, including user-facing text | Terminology note, FR-006–FR-010, US2, SC-002, Key Entities |
| 5 | Where does the daemon restart control live? | The status-bar indicator IS the control | FR-008, FR-009a, FR-009b, US2 scenarios 4–5 |

**Q4 went against the recommendation**, which was to say "background service" to users and keep
"daemon" in code. The decision is one word everywhere: what the notice says is what the log says is
what the issue says, so a user reading a log line can match it to what they were told. The spec was
normalised accordingly — no occurrence of "background service" survives outside the clarification
record itself.

Q1 and Q5 both surfaced an affordance the original spec had not accounted for, and both are now
bound to the Constitution's icon-only rule (Principle VI) rather than left to the plan.

### Clarification session 2026-08-07, second pass — five more questions

A second `/speckit-clarify` run against the already-clarified spec. All five recommendations were
accepted. Both sessions' bullets live under one `### Session 2026-08-07` heading, in order.

| # | Question | Answer | Where it landed |
|---|---|---|---|
| 6 | How long does FR-019 suppression last? | While that cause's notice is live; dismissal re-arms it | FR-019c, FR-019d, Edge Cases |
| 7 | Disable daemon-dependent controls, or let them fail? | Let them fail, naming the daemon; disable nothing | FR-010, FR-010a, FR-010b, Edge Cases |
| 8 | What number and mechanism behind SC-002's "within seconds"? | Connection loss, not polling; 2-second ceiling | FR-006a, FR-006b, SC-002, Edge Cases |
| 9 | How far does throng-holder attribution go across windows? | Name the panel **and** its window | FR-013, FR-013a, FR-013b, Edge Cases |
| 10 | Which failure classes does FR-011 classify? | A closed set of five; everything else passes through unchanged | FR-011a, FR-011b, FR-011c, Key Entities |

This pass closed both items the first pass had deferred — the closed set of failure causes (Q10) and
the detection latency (Q8) — and added one scope boundary the spec had been silent on: **a daemon
that is running but wedged is explicitly not covered** (FR-006b), rather than left to be discovered
during implementation.

Requirements grew 20 → 27 → **38**. Every addition is a consequence of an answer; none is padding.
Four Edge Cases that were phrased as open questions now state their resolution and cite the
requirement that settles them.

### Clarification session 2026-08-07, third pass — three questions, then stopped

Ran to a genuine scan, not to the quota. Three material ambiguities were found and asked; the
remaining candidates were either derivable from what the second pass settled or were placement
details for planning, so the loop stopped at three rather than manufacturing two more.

| # | Question | Answer | Where it landed |
|---|---|---|---|
| 11 | Whose wording does a notice use when two failures race to report one cause? | The **cause** owns the wording; the reporter supplies only the subject | FR-019e |
| 12 | What if the remembered working directory is still gone after the root returns? | Start in the project root and say so — never fail twice | FR-005a, FR-005b, Edge Cases |
| 13 | Should one action retry every failed panel? | No — retry stays per-panel; reopening the project is the bulk path | FR-004c |

**Q11 is the most consequential of all thirteen.** Without it, FR-019's first-wins rule made the
message the user sees depend on a race between the file tree and a terminal — the same fault reading
differently run to run, and FR-015's "entering the project failed" impossible to guarantee. Binding
the wording to the cause makes the copy deterministic and gives the feature five messages to write
and test instead of one per call site.

**Q12 closed a dead loop.** A vanished remembered directory would have failed the terminal a second
time, on something Try again could never fix, leaving Clear as the only exit.

**Q13 and FR-004c are a decision NOT to build something** — no retry-all control, no automatic
cascade. Recorded as a requirement rather than left unstated, so it does not get added back as an
obvious-looking improvement during planning.

The candidate that was considered and dropped: FR-016/FR-017's scope ("the paths covered here")
looked loose, but FR-011a's closed cause set now defines it — those requirements apply wherever a
classified cause can arise. Derivable, so not worth a question.

Requirements: 20 → 27 → 38 → **42**.

### Zero clarification markers, and why

No `[NEEDS CLARIFICATION]` markers were ever written. Three candidates were considered at drafting
time and resolved from evidence rather than raised as questions; all three still hold after the
clarification session:

1. **Automatic recovery vs. retry** for a terminal that failed to start. Resolved to retry: the
   in-place "still starting + retry" surface already exists for a slow start (008 FR-005) and is the
   natural home for a failed one. A watching recovery is a larger change; recorded in Assumptions.
2. **Auto-restart vs. offer** for the stopped background service. Resolved to offer: #182 asks for
   "a way to reconnect or restart it", and an automatic restart would mask a recurring fault —
   including the one #192 describes.
3. **Whether to change project-entry behaviour at all**, given that #181's wedge did not reproduce.
   Resolved to messages only, with FR-020 written as a regression guard rather than a fix. Recorded
   in Assumptions, and reversible if the reporter supplies a session where the halves disagree.

### One requirement is a guard, not a fix

**FR-020** describes behaviour that is already correct on `master`. It is stated because a fix that
reroutes a failed project entry could easily introduce the split it forbids, and nothing else in the
suite would catch it. It is the only requirement in this spec that passes before any work is done,
and it is labelled as such in both the spec and the replication.

### One requirement may ship in a reduced form

**FR-012** (name the holding process) depends on a spike into which operating-system route is viable.
If the spike does not land, its "could not identify which" branch is the shipped behaviour, and
FR-011 — classifying the cause — still holds and is independently valuable. Planning should treat
these as two deliverables, not one.

### Verification already exists

Unusually for a spec at Draft, every requirement in the "Preserving state" and "Saying what actually
went wrong" groups already has a failing E2E on the branch, written before this spec. SC-007 is the
criterion that ties the two together: those specs must pass *without their assertions being
weakened*, which is what stops a fix being declared by editing the test.
