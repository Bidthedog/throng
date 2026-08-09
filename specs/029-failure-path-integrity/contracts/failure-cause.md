# Contract: Failure Cause & Daemon State

**Feature**: 029 | **Date**: 2026-08-07

The surfaces 029 adds or changes. Everything here is consumed by more than one package, which is why
it is a contract rather than an implementation detail.

---

## 1. `@throng/core` — classification (pure)

```ts
/** The CLOSED set (FR-011a). A failure matching none of these has no cause. */
export type FailureKind =
  | 'held'
  | 'path-missing'
  | 'permission-denied'
  | 'not-empty'
  | 'daemon-stopped';

/** What kind of operation failed — decides how an ambiguous EPERM resolves. */
export type FailureOperation = 'lock' | 'access';

export interface Holder {
  isThrong: boolean;
  panelTitle?: string;
  windowTitle?: string;
  processName?: string;
  pid?: number;
}

export interface FailureCause {
  kind: FailureKind;
  subject: string;
  holder?: Holder;
  raw: string;
}

/**
 * Classify a raw error into a cause, or `null` when it matches none of the five.
 * `null` is not a failure of this function — it is FR-011b, and the caller reports
 * the raw message unchanged.
 */
export function classifyFailure(
  error: unknown,
  opts: { subject: string; operation: FailureOperation; holder?: Holder },
): FailureCause | null;

/** The user-facing sentence for a cause. The CAUSE owns this, not the reporter (FR-019e). */
export function causeMessage(cause: FailureCause): string;

/**
 * A stable key for "the user has already been told about this" (FR-019).
 * Derived from kind + subject — NOT from the message text and NOT from the reporter,
 * so two differently-worded failures of one cause collapse and two different causes never do.
 */
export function causeKey(cause: FailureCause): string;
```

**Why `operation` is a parameter and not inferred.** `EPERM` means both "held" and "permission
denied" on Windows, and the errno cannot separate them (`data-model.md`). The caller knows which
operation it attempted; the classifier does not. Making it explicit puts the judgement at the site
that has the information, rather than guessing centrally and being wrong in the direction #196
reports.

---

## 2. `@throng/core` — daemon state (pure)

```ts
export type DaemonStatus = 'running' | 'reconnecting' | 'stopped' | 'restarting';

export interface DaemonState {
  status: DaemonStatus;
  since: number;
}

export type DaemonEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'grace-expired' }
  | { type: 'restart-requested' }
  | { type: 'restart-failed' };

/** Pure transition. Unit-testable without a socket, a daemon or a clock. */
export function nextDaemonState(state: DaemonState, event: DaemonEvent, now: number): DaemonState;

/** The state a freshly-connected app starts in. */
export function initialDaemonState(now: number): DaemonState;

/** How long a disconnect stays `reconnecting` before it becomes `stopped`. */
export const DAEMON_GRACE_MS = 1200;
```

**`DAEMON_GRACE_MS = 1200`** is chosen against SC-002's 2-second ceiling: the existing reconnect
fires at 500ms (`daemon-events.ts:59`), so 1200ms clears one full retry with margin, and still leaves
~800ms for the notice and status bar to render inside the budget. It is a stated number so a test can
assert it rather than sleep past it.

---

## 2b. Resolving a throng holder — who knows what, and where they meet

The three facts needed to name a throng holder live in three places, and **nothing joined them before
029**. This is the one part of the design that is genuinely new plumbing rather than a new rule:

| Fact | Lives in | Keyed by |
|---|---|---|
| which terminal's cwd sits under the failed path | **daemon** — `terminal-service.ts` tracks `lastCwd` per session | panel id |
| the panel's displayed title | **renderer** — `workspace-store.tsx` owns the layout | panel id |
| the sub-workspace window that panel is in | **renderer** — window ownership | panel id |

Classification runs in **main** (`files-service.ts`), which holds the layout only as an opaque blob.
So main can learn *that* a throng terminal holds the folder but cannot, on its own, say *which*.

```ts
/** What the renderer publishes to main so a holder can be named. Panel id → what a user calls it. */
export interface PanelIdentity {
  panelId: string;
  panelTitle: string;
}

/**
 * Where each terminal is working, as `terminal.list` reports it. Main does the matching.
 *
 * `refreshCwd` reads every running shell RIGHT NOW instead of serving the 1-second poll. Off by
 * default and paid only on a failure path: the poll is a second stale at worst, which is invisible in
 * the panel title it was built for and WRONG in a sentence shown to a user — measured, a rename
 * attempted within a second of `cd Inner` was told the folder was "open in another program" while the
 * program was the user's own terminal.
 */
export interface TerminalListParams {
  projectId?: string;
  includeBusy?: boolean;
  refreshCwd?: boolean;
}
```

**Direction of flow**: the renderer publishes its own panels to main whenever titles or window
ownership change (it already re-renders on both); main asks the daemon for the live session list with
`refreshCwd`, and does the at-or-under match itself. A panel id with no published identity degrades to
FR-013b's "could not identify which panel" — the same branch an unresolvable third party takes, so
neither path can rot unnoticed.

**The daemon does NOT answer "which panel holds this path".** An earlier draft of this contract gave
it a `HoldingPanelQuery`, and that was the wrong seam: the daemon would have to know what "holding"
means — at-or-under, case-insensitive, separator-normalised — which is a rule about paths, not about
sessions, and it would have had to be re-derived if anything else ever needed it. The daemon reports
FACTS (which session, which cwd); main applies the RULE. `throng-holder.ts` is that rule, and it is
pure and unit-tested precisely because it stayed out of the daemon.

**Identities are held PER WINDOW** (`panel-identity.ts`), not in one flat map. Each renderer publishes
only its own panels, so a single map cleared on every publication loses the other window's the moment
a sub-workspace exists — every panel in it silently becoming "could not identify which panel". The
reporting window is passed to the lookup so FR-013a names the sub-workspace only when the holder is
somewhere the user is not already looking.

**Why not resolve it in the renderer?** The notice is raised there, so it is tempting. But the *cause*
must be classified where the error is caught, or `files-service` would have to return unclassified
errors and let each consumer re-derive them — which is the seven-places-to-keep-in-step problem this
design exists to avoid.

## 3. Main → renderer IPC

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `throng:daemon:state` | main → renderer (broadcast) | `DaemonState` | FR-006, FR-008. Pushed on every transition, to every window |
| `throng:daemon:restart` | renderer → main (invoke) | — → `{ ok: boolean; error?: string }` | FR-009. The status-bar control's action |
| `throng:panels:identities` | renderer → main (send) | `PanelIdentity[]` | §2b. Lets main name a throng holder (FR-013, FR-013a) |

### The two failure envelopes that gained a cause

Both cross a process boundary, which is why they are here and not left as implementation detail.

```ts
/** `files.*` — every file operation's failure (FR-018). */
export interface FilesFailure {
  error: string;          // the sentence to show; already spoken by main
  cause?: FailureCause;   // absent when the failure matched none of the five kinds (FR-011b)
}

/** `terminal.attach` — the envelope UI main returns to the renderer. */
type AttachEnvelope =
  | { ok: true; cwdFallback?: string }          // FR-005b: a remembered directory that has gone
  | { ok: false; stillStarting?: boolean; error: {...}; cause?: FailureCause };
```

**Why the cause travels rather than being re-derived.** Classification happens where the errno exists
and where the holder can be looked up. But a spoken sentence is a one-way door: `EBUSY` is gone from
it, and with it both the raw text a bug report needs (FR-018) and the `causeKey` that decides whether a
cascade is one notice or five (FR-019). Sending the cause alongside keeps all three facts without
asking the renderer to reverse-engineer any of them out of prose.

On the terminal path the same argument is stronger still: `error.code` on the wire is a numeric
JSON-RPC code, not an errno, so the cause could not be re-derived at the far end even in principle —
the errno only ever existed where the throw happened.

### Notice severity per cause

Severity is not cosmetic here — it sets how long suppression lasts. `notification.tsx` auto-dismisses
everything except `error` after `AUTO_DISMISS_MS` (5s), and FR-019c ties the suppression window to
the notice's lifetime. A cause raised as `warning` would therefore stop suppressing after five
seconds and the cascade would re-report.

| Cause | Severity | Why |
|---|---|---|
| `held` | `error` | The operation did not happen; the user must act |
| `path-missing` | `error` | Same, and it must persist long enough to outlive the cascade it causes |
| `permission-denied` | `error` | Same |
| `not-empty` | `error` | Same |
| `daemon-stopped` | `error` | Must persist until acknowledged — an auto-dismissing "your daemon died" is the defect #182 reports, wearing a different hat |

**Every cause is an `error`.** That is not laziness: each of the five reports something that did NOT
happen, which is exactly the line `notification.tsx:34` draws between `error` and `warning`.

`throng:getDaemonStatus` already exists (`preload.cts:65`, `main.ts:814`) and has **no consumer**.
It is a one-shot pull; this feature needs a push. It stays for diagnostics; the new channel is what
the UI binds to.

---

## 4. Existing surfaces this feature changes

| Surface | Change |
|---|---|
| `files-service.ts` `message()` (`:403`) | returns a classified cause where one applies; raw text otherwise (FR-011, FR-011b) |
| `use-terminal.ts` `onError` (`:998`, `:1088`) | carries a cause, not a bare string, so the panel can apply FR-003 |
| the terminal attach result (`global.d.ts:421`) | gains `cause?: FailureCause` beside its existing `{ code, message }` |

**Why the cause crosses the RPC rather than being derived at the far end.** The attach error today is
`{ code: number \| null; message: string }` — a *numeric JSON-RPC* code, not an errno, so the renderer
cannot classify it: the errno exists only where the throw happened. Two consequences:

1. **The daemon classifies terminal start failures**, and the cause travels in the result. Deriving it
   renderer-side would mean pattern-matching internal message strings, which is exactly the fragility
   this feature removes.
2. **`WindowsDirectoryLock` must carry an errno.** It throws a plain `Error` today
   (`windows-directory-lock.ts:39`, "Cannot lock … the path does not exist"), so it classifies as
   nothing. Setting `code = 'ENOENT'` on that throw makes it classify naturally instead of needing a
   special case — the path really is missing, and saying so in the OS's own vocabulary is what lets
   one classifier serve both this and `fs`.
| `terminal-panel.tsx` `onError` (`:489`) | routes a transient cause to the in-place failure state; keeps routing an unsatisfiable one to `end()` |
| `notification.tsx` | suppression keyed on `causeKey` while a notice for that key is live (FR-019, FR-019c) |
| `status-bar.tsx` | a daemon indicator that is also the restart control (FR-008, FR-009b) |

---

## 5. Test seams

Everything above is deliberately shaped so the hard parts are testable without an app:

- `classifyFailure`, `causeMessage`, `causeKey`, `nextDaemonState` are **pure** → unit.
- The grace window is a **constant**, not a literal buried in a timer → assertable.
- Holder resolution for throng's own terminals is a **prefix match over known cwds** → unit, with the
  daemon's terminal registry faked.
- Third-party holder lookup sits behind a **seam that returns "unidentified"** → the non-Windows and
  not-yet-implemented paths are the same code path, so neither can rot unnoticed.
