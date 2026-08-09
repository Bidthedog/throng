# Phase 1 Data Model: Failure-Path Integrity

**Feature**: 029 | **Date**: 2026-08-07

Two concepts, both pure and both in `@throng/core` so the daemon, the main process and the renderer
share one definition rather than three that drift.

---

## FailureCause

The human-meaningful reason an operation failed. **Derived from a raw error, never replacing it.**

```
FailureCause
  kind          one of the CLOSED set (FR-011a) — see below
  subject       what it happened to, in prose: a folder name, a project name, a panel title
  holder        optional; who is holding it (see Holder)
  raw           the original error text, carried through for FR-018
```

### kind — the closed set (FR-011a)

| kind | Derived from | Message shape |
|---|---|---|
| `held` | `EBUSY`, `EPERM` on a lock-class operation | *"<subject> is open in another program"* / *"…in throng"* |
| `path-missing` | `ENOENT` | *"<subject> could not be found"* |
| `permission-denied` | `EACCES`, `EPERM` on an ACL-class operation | *"You do not have permission to change <subject>"* |
| `not-empty` | `ENOTEMPTY` | *"<subject> still contains items"* |
| `daemon-stopped` | the daemon connection being lost | *"throng's daemon has stopped"* |

**A failure matching none of these has NO cause** (FR-011b). It is reported exactly as today — the
raw message, unchanged. This is what makes the set closed rather than aspirational, and it is what
guarantees no regression: a classifier that declines to guess cannot make anything worse.

### The `EPERM` ambiguity, and how it is resolved

`EPERM` appears in two rows. Windows returns it both for a held handle and for an ACL refusal, and
the errno alone cannot separate them. **The operation decides**: a rename, move or delete whose target
is a directory resolves `EPERM` to `held`; anything else resolves it to `permission-denied`.

This is a judgement, and it is recorded rather than buried because it is the one place classification
can be *wrong* — and being wrong here sends a user to check permissions for a lock, which is the exact
harm #196 reports. The measured case (`EBUSY`) is unambiguous; `EPERM` is the inherited risk from the
network-share path the issue was originally filed from.

### Invariants

- `raw` is never empty. A cause with nothing behind it means the classifier invented one.
- `subject` is prose, never a file path. FR-017 exists because the path already appears inside `raw`,
  and a message whose only subject is a path buried in a diagnostic string is not a named subject.
- The **cause owns the message wording**; the reporter supplies only `subject` (FR-019e). Two
  different failures with the same `kind` and `subject` therefore produce identical text, which is
  what makes it deterministic and what makes it testable.

---

## Holder

Who is holding a file or folder. Optional — absent means "not identified", which FR-012 requires be
said out loud rather than degraded to an errno.

```
Holder
  isThrong      true when this is one of throng's own processes
  panelTitle    optional; the panel whose terminal holds it
  windowTitle   optional; the sub-workspace window that panel lives in (FR-013a)
  processName   optional; a third-party image name, when identifiable
  pid           optional
```

### Resolution order, and why it is not what the issue expects

**throng's own holders resolve first, and for free.** The daemon knows every terminal it launched,
keyed by panel id, and tracks each one's working directory. Asking "does a known terminal's cwd sit
at or under the failed path?" is a prefix match over throng's own state — no OS API.

**Third-party holders do not resolve initially.** They need the Windows Restart Manager or handle
enumeration, both of which need a native addon or FFI that this repo deliberately does not have
(`research.md` R6). `Holder` is absent, and the message says throng could not identify which.

This inverts #196's assumption that naming throng is the hard part. It is the cheap part, and it is
also the common case — a user's own terminal is usually what is holding the folder they are renaming.

### Invariants

- `isThrong` true with no `panelTitle` IS reported, and says so explicitly — "throng is holding this,
  and throng could not identify which panel". That is much less useful than naming the panel, but it
  is far more useful than `EBUSY`: it tells the user to look at their own terminals rather than hunt
  for a foreign process. FR-013b is the ratified behaviour, and an earlier draft of this invariant
  said the opposite; the invariant was wrong.
- `windowTitle` is set **only** when the panel is in a different window from the one reporting
  (FR-013a). Naming the current window on every message is noise; omitting it across windows is
  actively misleading.

---

## DaemonState

Whether the daemon is usable. Read by the status bar and by the failure reporter.

```
DaemonState
  status        'running' | 'reconnecting' | 'stopped' | 'restarting'
  since         when it entered this status
```

### Transitions

```
running ──socket close──▶ reconnecting ──reconnect ok──▶ running
                              │
                              └──grace expires──▶ stopped ──user restarts──▶ restarting
                                                     ▲                          │
                                                     └────restart failed────────┘
                                                                                │
                                                              restart ok ────────┴──▶ running
```

**`reconnecting` is the state that makes this correct, and it is why a socket close alone is not
enough evidence.** The events socket also closes on a *legitimate* daemon restart — a new build
retiring the old daemon is normal — and `daemon-events.ts:59` already reconnects 500ms later. Going
straight to `stopped` on close would raise a false alarm every time a developer rebuilds.

The grace is what turns close into death. It must be short enough for SC-002's **2-second ceiling**
and long enough to cover an ordinary reconnect, both of which the existing 500ms retry already fits
inside.

### Invariants

- Only `stopped` raises the notice (FR-007) — `reconnecting` is silent, because a blip the user never
  noticed is not news.
- The status bar reflects every state, including `reconnecting` (FR-008), so a user watching it sees
  the difference between a blip and a death.
- `restarting` disables the status-bar control (FR-009b) so a restart cannot be triggered twice.
