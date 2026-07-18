# Research: v1.0.0 Bug Sweep — Signals That Were Never Sent

**Feature**: 019 | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

Every line reference is to the tree at `87e28a9` (the branch's base), and every claim was checked
against the source rather than taken from an issue. The spec's **Clarifications C1–C28 are settled** —
this document records *how* they are implemented, not whether. Where a settled decision looks wrong to
the author, it is implemented as written and the objection is filed under
[Concerns with settled decisions](#concerns-with-settled-decisions).

---

## 1. How the move signal reaches the editor coordinator (FR-001…FR-009)

### The asymmetry, in three lines

```ts
// files-service.ts:165   — delete TELLS the coordinator what it removed
if (removed.length > 0) this.onDeleted?.(removed);
// main.ts:586            — …which is wired to the coordinator
filesService.setOnDeleted((absPaths) => editorCoordinator.markDeleted(absPaths));
// files-service.ts:84-112 — move TELLS NOBODY. rename (`:62-82`) likewise.
```

With no signal, the only thing that eventually notices is the per-doc folder watch: `onDiskChange`
re-reads `doc.absPath`, the load fails, and the doc is routed through `markDeleted`
(`editor-coordinator.ts:702-706`) — buffer kept, force-dirtied, snapshot written. Correct for an
external delete (AC7 guards it); catastrophic for a move throng performed itself, because the dirty
dot invites a save and `save()` writes to `doc.absPath` — the **old** path — re-creating the file.

### Decision — a `{from,to}` signal, symmetric, reporting what ACTUALLY moved

Add to `FilesService`, mirroring `setOnDeleted` exactly:

```ts
setOnMoved(cb: (moves: readonly { from: string; to: string }[]) => void): void
```

`move()` accumulates `moved: {from,to}[]` **as each `this.fs.move(...)` returns**, in the same shape
`delete` learned with `removed[]` (`files-service.ts:140-165`). This matters because `move` **returns
on the first disallowed item** (`:100-105`, `:103-105`) — a half-succeeded batch is the normal case, not
an edge case, and reporting the *requested* pairs would re-point editors for files still sitting where
they were. The accumulated moves are announced **before** the early `return { error }`, exactly as
`delete` announces `removed` before reporting its failures.

`rename()` (FR-006) emits a single pair `{ from: abs, to: join(dirname(abs), name) }`. A rename is a
move; it has the identical hole and is not in #87's acceptance criteria, which is why FR-006 exists.

**Rationale**: it is the pattern already in the file, already wired, already understood by the reader.
The signal is deliberately **symmetric** (`{from,to}`) so that #85 (undo of a move) is a move in the
other direction rather than a new concept — an Assumption the spec states explicitly.

**Alternatives rejected**
- *Have the renderer tell the coordinator after a successful `files.move`.* The renderer does not know
  which files actually moved (the bridge returns `{ok:true}` or `{error}`, not a manifest), and it is
  the sandboxed party. Main knows; main should say.
- *Make the watcher smarter — correlate a delete in folder A with a create in folder B.* This is
  heuristic path-guessing over an event stream with no ordering guarantee, and it would also fire for
  **external** moves, destroying AC7 (which requires that an externally-moved file stay kept/dirty/
  recoverable precisely *because* throng has no idea where it went).
- *Re-load the document at the new path.* Forbidden by FR-002 and by Principle XI: a reload mints a
  second original, discarding the buffer, the dirty state and the undo history.

### Decision — re-point by PATH MUTATION, reusing `load()`'s existing branch

`EditorCoordinator.markMoved(moves)` does, per matched doc, exactly what `load()` already does when a
panel is re-pointed at a different file (`editor-coordinator.ts:204-218`) — minus the load:

1. `unregisterPanel(this.registry, panelId)` then
   `registerOpen(this.registry, newAbs, { panelId, windowId })` — the one-buffer registry follows the
   file (AC4: the new path answers `focus`, the old answers `open`). This is the same pair `save()`
   uses for a Save-As (`:503-505`), so there is one re-keying idiom, not two.
2. `doc.absPath = newAbs`, then `this.watchDoc(doc)` — the watch is on `dirname(absPath)`
   (`:681-685`), so a move to another folder **must** re-watch or the doc is watching the wrong folder
   forever.
3. `this.deps.relaySync(-1, { panelId, movedTo: newAbs })` — the ordered change stream every replica
   already consumes (`use-editor.ts:779-790`). `-1` = every window, as `markDeleted` uses at `:290`.
4. **No** `markUnsaved()`, **no** `snapshot()`, **no** notice (FR-003).

The buffer, `DocumentAuthority`, undo history and dirty flag are untouched — the document is the same
document (Principle XI, "one document, one state"; the move is not view state, so it reaches every
view through the authority's stream rather than being mutated per panel).

**FR-005 (folder move)**: match by **path prefix**, reusing the exact predicate `markDeleted` already
has (`editor-coordinator.ts:270-276`: normalise, compare `f === g || f.startsWith(g + '/')`), and
rewrite the matched doc's path by replacing the prefix. AC6 moves `pack/` and expects both `one.txt`
and `two.txt` to re-point.

**FR-007 (path spelling)**: the coordinator stores what the renderer opened with — forward-slashed,
from the tree — while `node:path.join` in main produces back-slashes. `markDeleted` already
normalises inline (`:269`). Rather than a third copy of that lambda, extract it once as pure core
(`packages/core/src/fs/path-id.ts`: `normaliseForCompare`, `samePath`, `isUnderPath`) and have
`markDeleted` and `markMoved` share it (DRY, Principle VIII; and Principle II — a normalisation rule
is not an OS call, so it belongs in core). The RED E2E is emphatic about this: its own `normPath`
helper exists (`editor-move-repoint.e2e.ts:74-75`) *because* raw comparison would make even the
already-correct AC7 look broken.

**FR-008 (the recovery snapshot)**: snapshots are keyed by `panelId` and carry **no path**
(`editor-recovery.ts`), so a moved doc's snapshot cannot point anywhere by itself. AC5's assertion is
therefore that a clean move leaves **no snapshot at all** — which follows automatically from not
routing through `markDeleted` (`:288`, which writes one immediately and undebounced). What *does*
strand a document at its old path is the **persisted layout**: the panel's config carries `filePath`,
and it is restored on next launch. So the `movedTo` relay must reach the renderer's panel config —
`use-editor.ts` updates the panel's `filePath`, which schedules the debounced `workspace.save`. That
write is US2's subject, which is why the phase order puts #87 before #86.

### Decision — FR-004's ordering is solved by BRACKETING, not by a timer

The folder watch can fire *during* the `for` loop in `move()` — before any signal could arrive — and
dirty the doc for a file that is mid-move. FR-004 offers two limbs: the signal arrives first, **or**
the watcher tolerates a just-moved document. Chosen: **both, deterministically**.

```ts
// FilesService.move / rename
this.onMoveStarted?.(srcAbsPaths);      // BEFORE the first fs.move
try   { …accumulate moved pairs… }
finally { this.onMoved?.(moved); }      // ALWAYS — the pairs that ACTUALLY moved (possibly [])
```

`beginMove(paths)` marks the matched docs `movePending = true`; `onDiskChange`'s `!res.ok` branch
(`editor-coordinator.ts:702-706`) returns **without** `markDeleted` while `movePending` is set;
`markMoved(pairs)` re-points the moved docs and clears the flag on **every** bracketed doc — including
the ones that did not move, which are then free to be dirtied by the watcher exactly as today (a move
that failed *is* a file still sitting there, and if it vanished anyway, an external agent did it).

**Alternative rejected — a grace period in `onDiskChange`** ("wait 250ms, re-check, then dirty"). It
is the shape FR-011 explicitly condemns one story over: a timer that merely outlasts a race is the
`terminate-all` accident in miniature. The bracket is exact because `move()` is a single IPC call that
owns the whole window.

**Alternative rejected — suppress the watch during the move.** `disposeWatch` + re-watch after would
lose a *genuine* external change landing in that window, and would need the same bracket anyway.

### Known, out of scope — a move onto a path that is itself open

Two docs would then claim one path in the registry. Undefined today (spec, Edge Cases), and made
*expressible* rather than worse by this design: `registerOpen` after `unregisterPanel` is the same
sequence Save-As already performs, which refuses with "already open in another editor"
(`editor-coordinator.ts:480`). Recommend a follow-up issue for the collision UX; do not grow 019.

---

## 2. How the shutdown drain awaits the deferred writes (FR-010, FR-011, C6, C19–C26)

### What is actually deferred

**More than one write — and this section states no tally (C24).** It has carried two now, and both were
false: *"exactly one"*, and then *"four"* (the apply client's debounce is **unreachable dead code** —
`applyDebounced` has no callers, `applyNow` cancels it and writes immediately, so the reachable
debounced writes are `workspace.save`, `writeTheme` and the JSON tab's apply). The drain uses no count,
which is why neither error ever reached the design. An earlier draft of this section opened *"Exactly one write:
`workspace.save`"* — the claim **C19 exists to correct**, and it is embarrassing that it survived
longest in the document whose entire purpose is recording what was **measured**. It was never counted;
it was asserted. Counted, by grepping the debounced writers:

| Write | Debounce | Flushed today | Owner |
|---|---|---|---|
| `workspace.save` — split structure **and** per-panel zoom (the one #86 reproduced) | 400 ms (`workspace-store.tsx:42`) | project switch, unmount | workspace window |
| ~~apply client~~ **not debounced in practice (C24)** — `applyDebounced` (`:33`) has **zero callers**; `applyNow` (`:29-32`) cancels the debounce and writes immediately, `void`-dropped at `settings-tab.tsx:119` and `themes-tab.tsx:312/404/438/449` | ~~250 ms~~ unreachable | ~~unmount (`settings-tab.tsx:115`)~~ — flushes a debounce that can never be armed | preferences window |
| `writeTheme` | 150 ms (`themes-tab.tsx:297`) | unmount (`:302`) | preferences window |
| JSON tab apply | 300 ms (`json-tab.tsx:54`) | **nothing** | preferences window |

**Every `void`-dropped write is covered — and every awaited one too** (`themes-tab.tsx:432` awaits;
`apply-client.ts:31` returns): the module does not distinguish (**C26**). *(An earlier draft asserted
"every one drops its promise with `void`" — false, and it survived C24's tally strike because it is a
word rather than a number.)* The shared `debounce` helper (`write-config.ts:93`) is left alone because
its **search-input** callers (`keybindings-tab.tsx:93`, `settings-tab.tsx:76`, `themes-tab.tsx:121`)
write nothing and must not be dragged into a writer's fix; `scheduleWrite` is built on it, for writers
only. **No tally here (C24)** — an earlier draft's arithmetic ("six callers: the three writers above")
closed only under a writer set C24 struck, and counted `workspace.save`, which hand-rolls its own
`setTimeout` (`workspace-store.tsx:170`) and never calls this helper at all. *(And "each writer holds its
own in-flight promise" was **C19's** mechanism: under C22/C26 the module's existing `writeChains` map
holds them — see below.)*

### Do not count the writers — settle the module (**C22**)

*(History, not authority — the numbers below are what each draft **asserted**; C24 struck them all.)*
The window has more tabs than any draft counted (`JsonTab`, `SettingsTab`, **`KeybindingsTab`**, `ThemesTab`),
and three attempts to model them as a list produced three wrong answers, each caught only by the next
analysis pass:
- **C19** counted four writers but treated the Key Entity's "only one" as the sole error.
- **C20** argued "at most one pending" from the single-tab render — reading **two** of the three tabs it
  knew about.
- **C21** fixed the JSON tab's *unmount* — but `JsonTab` **does not unmount** on a tab switch.
  `preferences-app.tsx:273-288` is `{mode === 'json' ? <JsonTab docId={…}/> : …}`, so in JSON mode a tab
  switch re-renders **the same instance** with a new `docId`; `apply` is `useMemo(…, [docKey])`
  (`json-tab.tsx:52-74`), so the change mints a new debounce and **orphans the old one's armed timer**,
  which still fires `void writeConfig(oldDocId, v)`. No unmount ⇒ no unmount flush ⇒ the fix misses it.
- All three omitted `KeybindingsTab`, whose `writeConfig` (`keybindings-tab.tsx:117`) is **undebounced**
  — excluded under C19's test (*is it pending?*) and never re-tested under C21's (*is it in flight and
  owned?*), which is the test that matters.

- **C22** then stopped counting tabs — and counted **writers** instead: *"all four writers call it; a
  fifth would too."* **C24 records that replacement count as false too** — hence no number here; run the
  grep if you want one, and the design will not care what it returns. The two it never named
  are the two that mattered: `preferences-app.tsx:176` (`revertAll`, undebounced — which C22's design
  absorbed for free, C22 working as intended) and **`projects-panel.tsx:208`**, `void
  writeConfig({kind:'settings'}, …)` rendered by `app.tsx:493` — in the **workspace** window. C22 gated
  `settleConfigWrites()` on *"in a preferences window"*, so that write would have been **acked in
  flight**: the exposure C21 refused to accept as a limit, shipped inside the fix for it.

**Decision (C22, completed by C23)**: every config write already calls **`writeConfig`**. That is the
chokepoint, and it is where the drain goes: `writeConfig` retains in-flight promises in a module-level
tail map — **`writeChains` (`write-config.ts:24`), which already exists** and is what `settleConfigWrites`
awaits (**C26**: adding a second in-flight set would duplicate state the module already keeps for issue
#50's per-doc chaining — half of "the story's only new construct" was already built);
`scheduleWrite(id, produce, ms)` debounces **per `ConfigDocId`**, evaluating the thunk at fire time with
**`null` meaning "do not write"** (C26 — json-tab's body parses, and on failure must **not** write, 007
FR-017), plus `cancelWrite(id)` for `json-tab`'s `reload` abandon (`:108`, without which adopting an
external change silently clobbers it), and registers armed timers (**C25** —
`debouncedWrite(id, ms)`, C22's original shape, **cannot be implemented**: `writeTheme` derives its id
from the debounced payload at fire time, so an id bound at creation cannot express it; per-id keying
*is* 018 FR-023's captured-at-edit-time guarantee, and it dissolves `json-tab`'s orphaned timer because
there is no per-doc instance to mint); `settleConfigWrites()` flushes and awaits the lot;
and **every window calls it unconditionally** — no provider, no per-tab registration, no `useMemo`
identity to track, **no list of writers, tabs or windows to keep accurate**. The two
`useEffect(() => () => x.flush(), [x])` cleanups (`settings-tab.tsx:115`, `themes-tab.tsx:302` — **two**,
not three; the JSON tab has none) are deleted (Principle VIII).

**The tell that this is finally the right design**: "at most one pending", "four writers", "the
preferences window" — every premise the earlier drafts leaned on has stopped being load-bearing.
Settling *n* writes is the same call as settling one, in a window that has none as in a window that has
three. **A claim that must be recounted whenever the code changes is not a design — it is a liability
with good intentions**, and this section spent attempt after attempt proving it (C24: nobody counts — including counting the miscounts).

What is **not** deferred: `setDocumentOverride` is an awaited IPC onto a **synchronous** SQLite write
(`daemon/src/document-service.ts:67`) — no close beats it; the guard test that says so stays green. The
find bar's last term and "recently-used values" **do not exist** in the codebase.
`keybindings-tab.tsx:117` writes via `writeConfig` but is **not** debounced, so it is not a *deferred*
write. **It is still drained (C22)**, and deliberately: C19's test was *"is a write pending?"*, under
which this was excluded; **C21 changed the test** to *"is a write in flight and owned by this window?"*
and refused to accept that IPC-latency exposure as a limit. A rebind followed immediately by a close is
the same drop, the same owner. Since the drain settles the **module** rather than a list of writers, it
covers this one at zero cost and without anyone having to remember it exists — which is the point.

### Three facts that decide the design

1. `flushSave` exists (`workspace-store.tsx:121-133`) and is wired only to a project switch and unmount
   (`:135-164`). No close path calls it.
2. `flushSave` **drops its promise**: `void client.save(...).catch(...)`. Even called from a close
   path, it would return before the write lands. FR-010 says the drain MUST be *awaited*, so
   `flushSave` must **return** `client.save(...)` and the caller must await it.
3. Both close paths funnel through main (`main.ts:650-686`): the ordinary close sends
   `appClose:closing` and fires `mainWindow.close()` on a **250ms** timer (`:661-663`); the
   terminate/leave choice calls `mainWindow.close()` after `terminal.killAll`. Neither `app.close()`
   nor the harness teardown reaches this handshake at all — both *destroy* the window — which is why
   no existing spec covered it and why the RED test drives `BrowserWindow.close()` explicitly.

### Decision — an awaited drain round-trip, on every window, bounded by an injected timeout

Add one request/ack pair to the existing close handshake (main → renderer `appClose:drain`, renderer →
main `appClose:drained`, correlated by `requestId`):

- Main asks **every** window — `mainWindow` **and** every sub-workspace window (C6) — to drain, and
  `await Promise.all(...)` before allowing the close. `BrowserWindow.getAllWindows()` is the source, as
  `relaySync` already uses (`main.ts:531-533`).
- Each renderer's handler awaits **`Promise.all([flushSave(), settleConfigWrites()])`** — in **every**
  window, **unconditionally** (**C22/C23**), with no tab, writer or window named anywhere in it. A window
  with nothing pending settles immediately; so does one hosting no config writer. Then it acks.
- The wait is bounded by `IUiSettings.shutdownDrainTimeoutMs` (new; default 5000, env
  `THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS`) — a window that has crashed or is unresponsive must not hold the
  app open forever. A lapsed budget closes anyway and logs; it is a backstop, not the mechanism.
- The 250ms timer is **deleted as a correctness device**. It may remain as the cosmetic beat that lets
  the "Closing throng…" overlay paint, but the close now waits on the drain, not on the clock. This is
  FR-011 in one line: *widening the accident is not a fix*.

**Why every window (C6)**: sub-workspace windows carry their own layout writes on the same close-all
cascade (`WindowManager.closeChildren`, `window-manager.ts:96`, fired from `:32` over the windows `registerChild` collected at `main.ts:723`). Draining only the main window
leaves the bug half-fixed for exactly the multi-window users most likely to have a layout worth
keeping — and FR-010 says *every* exit path.

**Alternative rejected — `BrowserWindow.getAllWindows()` vs. widening `WindowManager`.** `ManagedWindow`
(`window-manager.ts:11-18`) is deliberately Electron-free so the focus-group logic is unit-testable; it
has no `webContents`. Adding a `send()` to it would drag an Electron concern into the one class that
was designed without one, for no gain — main.ts is already the Electron-bound layer and already uses
`getAllWindows()` for broadcast.

**Alternative rejected — drain in `will-quit`/`before-quit`.** The renderer is already gone (or going)
by then; the write we are trying to rescue lives *in* the renderer. The drain must happen while the
window still exists, which is what the `close` interception is for.

**Alternative rejected — make `workspace.save` synchronous / remove the debounce.** The debounce is a
deliberate trade against write amplification during a drag (FR-011 states this explicitly). The
accepted, documented limit stands: an **uncatchable** termination (`SIGKILL`, Task Manager) can still
lose up to 400ms of layout. That is a stated limit, not a defect.

---

## 3. How `PtyAgentHost` surfaces a lapsed deadline (FR-012…FR-015, C7, C8)

### The silence, precisely

```ts
// pty-agent-host.ts:36     — the ONLY budget anywhere in the de-elevated path
this.connectWithRetry(Date.now() + 15_000);
// pty-agent-host.ts:67-74  — when it lapses, the loop just… stops
sock.on('error', () => { … if (Date.now() < deadline) { retry } });   // else: nothing
// pty-agent-host.ts:139-152 — meanwhile start() is optimistic
start(opts) { this.sendCmd({op:'start', …}); return { pid: key }; }   // queued to outbox forever
```

So `TerminalService.attach` returns `{status:'running'}`, the panel clears "still starting"
(`use-terminal.ts:361`), and nothing ever fires. The panel is not buggy; it is being lied to.

### Decision — route both lapses into the EXISTING failure path

`failAllLive(reason)` (`:78-84`) does **almost** exactly what is needed: `[throng] <reason>` on `onData`
plus an `onExit`, which `TerminalService` publishes as `terminal.output` + `terminal.exit` and the panel
renders as a visible error and a reverted type form (**005** FR-019/FR-020 — not 019's, which govern the
flavour-record control).

**Almost — and this section said "already", four times over, in four documents (C27).** Measured,
`failAllLive` fires **`cb({ code: null })`** (`:82`). The **non-zero** exit is the `ev:'error'` branch's
(`cb({ code: 1 })`, `:127`) — the branch cited just below as "proving the shape", which is how the error
survived: the shape was read off the *neighbour*. Its comment states what the non-zero code buys —
*"so the Panel reverts with a visible message (005 FR-019), never a silent blank"* — which is precisely
what FR-012 demands. So **T025 changes `failAllLive` to `code: 1`** (C27): one outcome, one shape, and
Route 2 (T026) no longer contradicts Route 1. **Nothing asserts `code: null`**, so nothing is weakened —
and the RED test asserts only `exits.length > 0` **and** chunks matching `/throng/i`, which is exactly
why neither the contradiction nor the `null` was ever caught.

- **Connect deadline lapsed** → `failAllLive('the de-elevated terminal agent never started…')`,
  including the launch reason if one was captured (below), and **do not relaunch** (C8).
- **Readiness never acknowledged** → per-key budget started **at connect** (C7), cleared by the
  `{ev:'started', key, pid}` ack; on lapse, fail **that key** (not all live keys) with
  `[throng] the terminal never started` — **this exact string**, matching
  [contracts/pty-agent-readiness.md](./contracts/pty-agent-readiness.md) §Route 2 and T026. (An earlier
  draft here said *"never reported that it started"*; the RED test only matches `/throng/i`, so nothing
  would have caught the drift and it would have shipped as whichever wording the implementer read last.
  The contract's is authoritative.)

**C7 — 15s from connect, separate from the 15s connect deadline.** Precedent: the existing 15s connect
deadline (`:36`) and `DEFAULT_ATTACH_TIMEOUT_MS = 15000` (`ui-settings.ts:19`), both sized for
launching an interactive shell. Kept **separate** (worst case 30s) so a slow connect does not consume
the readiness allowance; started at connect, because before connect there is no agent that could ack.
The RED test waits `15s + 3s` per scenario with the socket connecting immediately in scenario 2 — so a
readiness budget measured from `start()` would also pass, and one measured from connect is what C7
specifies.

**FR-013 — readiness is the `started` ack, never first output.** The protocol already defines
`{ ev: 'started'; key; pid }` (`pty-agent-protocol.ts:26`) and the host drops it unhandled
(`pty-agent-host.ts:133-135`). Using first output instead would kill a legitimately slow shell that
has printed nothing yet (US3 AC4 exists to forbid exactly that), and would make the budget a function
of the shell's chattiness. The agent must therefore **emit** the ack when its ConPTY spawns — and
**it already does**: `pty-agent-entry.ts:91` unconditionally sends `{ ev: 'started', key: msg.key, pid:
h.pid }` on the spawn path (with `{ev:'ready'}` at `:130` for the connection itself). This was left
conditional at planning time ("verify, and implement if absent"); it was **verified during the
2026-07-17 cross-artifact analysis and the answer is *present***, so **the whole of the work is
host-side** — the discard at `pty-agent-host.ts:133-135`. T027 is a confirmation task, not a build
task, and US3 carries no hidden protocol work. The RED test's live server (which deliberately never
replies) proves the host waits for the ack independently of the real agent's emit, which is why the two
could be settled separately.

**C8 — a lapsed launch does not relaunch.** The `close` path relaunches (**`:64-65`**; `:63` is its `failAllLive` call, which C28 parameterises while keeping that caller's `null`) because a *crashed*
agent may come back; an agent that never arrived at all indicates a systemic failure (the shim), where
relaunching produces a launch loop that buries the error under retries. Surface it; the user retries
deliberately by re-typing the panel.

### Decision — make the launch observable (FR-015) by widening the launch seam

`WindowsDeElevatedLauncher.launch()` is fire-and-forget over `stdio:'ignore'` + `.unref()`
(`packages/platform-windows/src/windows-de-elevated-launcher.ts:31-34`), and the PowerShell shim it
spawns has `$ErrorActionPreference='Stop'` and throws real, specific messages
(`"CreateProcessWithTokenW failed: <win32 error>"`). Those messages are **thrown into `/dev/null`
today**. This is why nobody has ever known why #94 hangs.

The seam is the `launch` callback the host is constructed with. Widen its signature — additively, so
the RED test's `new PtyAgentHost(pipe, () => { launches += 1 })` still compiles (`:96`, `:164`):

```ts
// daemon/src/pty-agent-host.ts
launch: (pipeName: string, report: (reason: string) => void) => void
```

The composition root (`composition-root.ts:142-148`) passes `report` down to the launcher, which
switches to `stdio: ['ignore','ignore','pipe']`, collects stderr, and on a non-zero exit calls
`report(stderr)`. The host stores the last reason and appends it to the connect-deadline message. The
launcher stays behind its Principle II seam and returns `void` as before — the reporting is a callback,
not a returned promise, because `PtyAgentHost`'s constructor invokes `launch` synchronously and
`deElevatedPty` does not exist yet at that moment (a returned promise wired back into the host would be
a temporal-dead-zone reference).

**Alternative rejected — make `launch` async and await it in the host.** `IPtyHost.start` is
synchronous by contract and the host's whole design is "return a handle, queue the command". Async
launch would change the seam's contract for every implementation to buy what a callback buys.

**Alternative rejected — a new panel-visible error channel.** `failAllLive` already reaches the panel,
is already tested, and already releases the project-root lock. A second path would be two ways to fail
(Principle VIII).

### Budgets are injected (Principle X)

`IDaemonSettings` gains `agentConnectTimeoutMs` and `agentReadyTimeoutMs` (defaults 15000/15000, env
`THRONG_AGENT_CONNECT_TIMEOUT_MS` / `THRONG_AGENT_READY_TIMEOUT_MS`, read in `readDaemonSettings`,
`composition-root.ts:70-74`). `PtyAgentHost` takes them as an optional third constructor parameter
defaulting to the exported documented constants — the 2-arg form the RED test uses. This **removes** a
hardcoded `15_000` from business logic rather than adding one.

---

## 4. How `map-control.tsx` generalises to an array-of-records mode (FR-016…FR-020, C9, C14)

### Why the issue's proposed remedy could not work

```ts
// map-control.tsx:29-30 — arrays are rejected outright
const asMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
```

Feed it `terminals.flavours` and it renders an empty table; the **first commit overwrites the array
with an object**. It also sorts alphabetically (`:67-69`), has no text cell (`:264-277`: anything that
is not `control:'number'` becomes a `<select>` over `allowedValues ?? options ?? []`), and no
per-column validation. It is *generalisable*, but that is real work.

Today's `terminals.flavours` behaviour is worse than "JSON textarea": its declared `control:'array'`
means the control type **flips with the value** — `[].every(...)` is vacuously true, so an *empty*
list renders as a string-array control whose Add button appends `''` (an empty **string** into an array
of **objects**, which the tolerant parser then drops). FR-018 exists for that sentence: the control
type MUST NOT be inferred from the data.

### Decision — one component, two modes, the mode DECLARED by the descriptor

Add `ControlKind = 'records'` (`metadata.ts:12-38`) and render it from **the same** `map-control.tsx`
(FR-020: "not two table implementations" is C9's and the issue's stated goal). The descriptor declares
everything the mode needs; nothing is inferred:

```ts
{ key: 'terminals.flavours', control: 'records', idKey: 'id', itemNoun: 'flavour',
  columns: [ { key:'label', label:'Label', control:'text' },
             { key:'file',  label:'Executable', control:'text' },
             { key:'args',  label:'Arguments', control:'text' },      // string[] ↔ text, see below
             { key:'defaultParams', label:'Default params', control:'text' } ] }
```

- **Rows carry the flavour's `id` but are keyed by index** (C9 as corrected by **C17**) — so the
  existing row/column machinery, add/remove and duplicate-key refusal are *reused*, not reinvented.
  `validateKey` (`map-control.tsx:38-55`) is the shape `validateFlavourRecord` follows. **C9's original
  "unique by `dedupeById`" claim is false**: `dedupeById` (`flavour.ts:55`) is **not exported**, runs on
  the *merged runtime* list, and only shapes the **launch list** — `parseTerminals` does not dedupe
  `terminals.flavours`, and the JSON tab ships, so two rows can claim one id. C17 decides that case:
  render both, key by index, flag the duplicate. The launch list's first-wins behaviour is untouched.
- **Order is preserved (C11)**: the `records` mode must **not** sort. Order is user-visible — it is the
  panel dropdown's order, and `mergeFlavours` is first-wins (`flavour.ts:33-54`). The `map` mode keeps
  its alphabetical sort for keyed maps, where order is meaningless. This is the one place the two modes
  legitimately differ, and it is a property of the *value*, not of the control.
- **The text cell** (`MapCell`, `map-control.tsx:237-278`) gains an `input[type=text]` arm for
  `control:'text'`. This is what C14 folds in: `terminals.defaultParams` declares
  `columns:[{label:'Arguments', control:'text'}]` (`settings-metadata.ts:185-186`) and renders an empty
  `<select>` **today**, for exactly this missing arm. It ships with **zero** test coverage, so the fix
  lands with a regression test (C14) rather than an issue.
- **`args` is `string[]`**, and the RED test does not drive it. Render it as a text cell over a
  space-separated round-trip (parse on commit, join on render) — the same thing the Startup Params
  field already asks a user to type. A nested array editor is a capability nobody asked for (YAGNI).

### The unknown the spec did not cover: test-id naming

The RED E2E demands **`flavour-row-my-wsl`**, `flavour-cell-my-wsl-label`, `flavour-new-id`,
`flavour-add`, `flavour-error` (`preferences-terminal-flavours.e2e.ts:175-215`) — while the control's
existing scheme is `map-row-${descriptor.key}-${key}`, `map-new-key-${key}`, `map-add-${key}`,
`map-error-${key}`, and 016's E2E depends on those. These are two naming schemes, not one template.

**Decision**: the descriptor declares `itemNoun` (here `'flavour'`); the `records` mode derives
`${noun}-row-${rowKey}`, `${noun}-cell-${rowKey}-${column.key}`, `${noun}-row-error-${rowKey}`,
`${noun}-new-id`, `${noun}-add`, `${noun}-error`. The `map` mode keeps its `map-*-${descriptor.key}`
scheme untouched. One small branch, in one place, driven by the tests on both sides.
**[contracts/settings-descriptors.md §2](./contracts/settings-descriptors.md) is authoritative for this
table** — read it there, not here, if the two ever drift again.

**`rowKey`, and why it is not simply `id`** (**C17**): `rowKey` = the row's `id` for the **first** row
claiming that id, `${id}-${index}` thereafter. An earlier draft of this section decided plain `${id}`,
which is correct for every id the RED E2E drives (all unique → `rowKey === id`, so `flavour-row-my-wsl`
resolves exactly as written) but **breaks on a file-authored duplicate**: two elements would answer one
test id, a Playwright strict-mode violation, making the duplicate case untestable — undefined behaviour
wearing a locator. `parseTerminals` does not dedupe and the JSON tab ships, so that input is reachable.

**The row-error cell** (`${noun}-row-error-${rowKey}`) is likewise new and load-bearing: the existing
control-level `${noun}-error` region (`map-control.tsx:208-212`) is driven by **transient add/commit
state** and structurally cannot speak for a row that arrived pre-broken from the file. It keeps its
current job and test id — the RED E2E asserts on it at `:198`/`:205`/`:215`.

**Alternative rejected — renaming 016's test ids to one scheme.** It churns a suite that is green, for
a consistency no user can see, in a feature whose entire purpose is not breaking things that work.

**Alternative rejected — a second `<RecordListControl>` component.** FR-020 forbids it in terms.

### Validation (FR-019), in core and pure

`packages/core/src/terminal/flavour-record.ts` — `validateFlavourRecord(record, existingIds)` returning
a **message, not a boolean** (the idiom `validateKey` already established, and the RED test asserts the
message contains `id` / `already` / `executable`):

- id required → `'An id is required.'`
- duplicate id → `'“<id>” is already used by another flavour.'` (contains "already")
- executable required → `'An executable is required.'` (contains "executable")

**C12 — "an executable" means non-empty, not existence-checked.** A flavour may legitimately point at a
path valid on another machine or not installed yet; launch already reports *"not available on this
machine"*, which is the right place for that check. The editor's job is refusing what can **never**
work, not predicting what might not work today.

**C13 — a flavour `id` is immutable once created.** It keys `terminals.defaultParams`; the alternative
is silently orphaning those params. So the id column is **not editable** on an existing row — it is
rendered as text (as `map-control.tsx:130` already renders its key column), and to rename you delete
and re-add. The RED test only ever fills `flavour-new-id`, never an existing row's id, and consistently
reads `flavour-cell-<id>-label` / `-file` — the editable fields.

---

## 5. How the raw detected flavour set gets a new IPC channel (FR-017, C10)

Hiding a built-in is a **one-way door** today: `listFlavours()` already subtracts `disabledBuiltins`
(`shell-detection-service.ts:27-35` → `flavour.ts:33,42-43`), so a picker built from it cannot offer an
already-hidden built-in to be un-hidden. The RED test states it plainly: check `cmd`, then assert it is
**still offered and checked** (`preferences-terminal-flavours.e2e.ts:130-144`).

**Decision (C10)** — a distinct channel, not a flag:

```ts
// shell-detection-service.ts
listDetectedFlavours(): Promise<DetectedFlavour[]>   // the RAW detected built-ins; NOTHING subtracted
// main.ts (beside :595)
ipcMain.handle('throng:terminal:listDetectedFlavours', () => shellDetectionService.listDetectedFlavours());
```

`listFlavours()` — the **panel dropdown's** source — is unchanged. An `includeHidden` flag would invite
a caller to accidentally offer hidden flavours to users in the dropdown itself; a distinct method
cannot be misused that way. The two callers want genuinely different questions answered: *"what can I
launch?"* and *"what does this machine have?"*.

The renderer reaches it through `settings-tab.tsx`'s existing `dynamicOptions(...)` seam
(`:135-145`) — the hook 016 generalised for exactly this ("a third such field would have meant a third
`d.key === …` in the JSX"). `terminals.disabledBuiltins` becomes `control: 'multiselect'` over those
ids; the RED test accepts checkboxes or a `<select>` and forbids any free-text element
(`preferences-terminal-flavours.e2e.ts:99-101`), satisfying 007 FR-029.

---

## 6. How `CONTRAST_PAIRINGS` becomes derived (FR-025…FR-029, C3, C4)

### The premise was false; the gap is real

All ten syntax tokens measured against `editorBg` across all fifteen bundled themes: **150 pairs, zero
failures**, every pair above 6:1 (`Light`'s worst is 6.12:1). The cause is `default-themes/index.ts:186-192`:
`makeTheme` pushes every seed through `legibleOn(c, [editorBg], editorFg, 6)` before it ever becomes a
token. **The authored seeds are not what ships** — which is exactly why FR-029 says the guard must
measure the **shipped** token, and why the RED test reads `theme.colours[token]`, never a seed.

The existing pairings measure syntax only against the two **search-match** surfaces
(`theme-quality.ts:314-317`) — the background for a handful of characters, occasionally — and never
against the body the other 99% of a file is painted on.

### Decision — derive twice: the token set, then the pairings

```ts
// theme-quality.ts
export const SYNTAX_TOKENS = Object.keys(THRONG_THEME.colours).filter(t => t.startsWith('syntax')).sort();
const SYNTAX_ON_BODY = SYNTAX_TOKENS.map(fg => ({ fg, bg:'editorBg', min: SYNTAX_BODY_MIN, label:`${fg} on the editor background` }));
export const CONTRAST_PAIRINGS = [ …existing…, ...SYNTAX_ON_MATCH, ...SYNTAX_ON_BODY ];
```

`SYNTAX_TOKENS` (`theme-quality.ts:292-303`) is **itself a hand-list**, and the RED test refuses to
trust it — deriving its own set from `THRONG_THEME.colours` and then asserting the constant agrees
(`theme-syntax-body-contrast.test.ts:45-48,106-108`). Deriving the constant from the same registry makes
that assertion structurally true rather than a promise, and closes the escape hatch one level down:
a future `syntaxDecorator` is measured **without anyone editing a list** (FR-026, SC-013, and the RED
test's "covers a syntax token that does not exist yet").

`THRONG_THEME` is the right registry: it is the always-complete theme every other theme falls back to,
and it is hand-authored — bypassing `makeTheme`'s lift entirely, so it is the one theme that currently
passes **by luck**. Gating it is the point.

### Decision — the threshold is 6.0 (C3), and it is a stated decision

```ts
/** WCAG AA (4.5) is the FLOOR. 6.0 is throng's house standard for code on the editor body. */
export const SYNTAX_BODY_MIN = 6.0;
```

C3's reasoning is decisive and is recorded in the source, not just here: `default-themes/index.ts:186-191`
lifts every seed to 6:1 **because the search-match tint can only be as strong as the weakest syntax hue
permits**. A 4.5 gate would be *weaker than the derivation it exists to protect* — it would permit a
comment authored at exactly 4.5 that collapses the search highlight to invisibility. All fifteen themes
already measure ≥6.01, so 6.0 gates reality with **zero recolouring** (SC-014).

### Decision — gate everywhere except the by-design carve-out (C4)

```ts
export const BY_DESIGN_LOW_CONTRAST_THEMES = ['Matrix', 'VI-VIM', 'Gothic'];   // #61's policy
export function assertSyntaxBodyContrast(themes: readonly Theme[]): void       // throws → fails the build (FR-027)
```

The contradiction #83 carried dissolves once the two pairing **sets** are separated. `IN_SCOPE_THEMES`
(`theme-quality.ts:278`) stays untouched and keeps governing the **existing** pairings — widening *that*
is #61, milestoned vNext, and risky because those themes may fail today. The **new** syntax/`editorBg`
pairings pass on all fifteen right now (measured), so gating them everywhere cannot fail the build and
**cannot block on #61**. The three deliberate low-contrast themes keep their carve-out per #61's policy
— though all three pass anyway, so the carve-out costs nothing today and exists so a future recolour of
Matrix is not reported as a defect (FR-028).

FR-027 ("fails the build") is satisfied by the existing theme guard suite calling the new assert
alongside `assertDistinct` / `assertInScopeContrast` — the same mechanism, not a new one.

### Concerns with settled decisions

> Implemented as written. Recorded so a reviewer meets the objection rather than discovering it.

- **C3 vs. a written RED assertion.** `theme-syntax-body-contrast.test.ts:65` asserts
  `pairing.min` **`toBe(WCAG_AA_BODY)`** — 4.5. Implementing C3 (6.0) makes that assertion fail. The
  test predates the clarification session, and its own stated intent is "at the body-text threshold,
  **not a relaxed UI one**" — it is defending against `WCAG_AA_LARGE_UI` (3.0), and 6.0 satisfies that
  intent more strictly than 4.5 does. **Disposition**: implement C3, amend that single assertion to
  `toBe(SYNTAX_BODY_MIN)` and add `expect(SYNTAX_BODY_MIN).toBeGreaterThanOrEqual(WCAG_AA_BODY)` beside
  it so the "not relaxed" property remains asserted. This is the only test amendment in the feature, and
  it is a clarification of intent, not an accommodation of an implementation. If the owner would rather
  keep the test literal, the correct move is to **overturn C3**, not to quietly ship 4.5 — because the
  6:1 lift in `makeTheme` stays either way, and a gate below it protects nothing.
- **C1 (drop, do not migrate) is right, and its cost should be stated once.** A user with
  `explorer.openMode: 'double'` in `settings.json` gets **single**-click today (the setting is inert)
  and keeps getting single-click after 019 — which is the whole argument for C1, and it is correct.
  The cost is that a user who *thought* they had configured double-click and never noticed will now find
  the working control in the File Explorer group set to `single`, with no trace of what they typed. C1
  accepts that deliberately ("no warning"), and `parseExplorer` (`app-settings.ts:269`) already drops
  unknown keys silently, so this is consistent. Noted, not contested.
- **C13 (immutable id) is correct but slightly unkind.** "To rename, delete and re-add" costs the user
  the row's other fields. The kinder version — rename the id *and* re-key `terminals.defaultParams` in
  the same commit — is a capability, not a defect fix, and would need its own acceptance criteria.
  Implemented as written; recommend the follow-up.

---

## 7. Why #95's fix is a deletion, and why the guard is narrow (FR-021…FR-024, C1, C2)

`explorer.openMode` is a typed field (`app-settings.ts:21`), defaulted (`:199`), parsed (`:269-270`),
cloned (`:291`) and **described** (`settings-metadata.ts`) — and read by nothing. It hid because
`decideClick(openMode, …)` (`open-intent.ts:17`) **names its parameter** that, so a search appears to
find a consumer; the parameter is only ever fed `editor.openOnClick` (`file-tree.tsx:270` →
`tree-node.tsx:47-49`).

**Decision**: delete the key, its default, its parse, its clone and its descriptor. `OpenMode`
(`app-settings.ts:14`, `'single'|'double'`) then has one user left — `decideClick` — which is actually
fed `EditorOpenOnClick` (`'single'|'double'|'none'`, guarded by an early return at `tree-node.tsx:48`).
Retype `decideClick`'s parameter to the type it is really given, so the signature stops naming the
setting that never fed it. This is what makes the #95 guard test **structurally** green rather than
accidentally: `readersOf('editor.openOnClick', …)` finds `file-tree.tsx`/`tree-node.tsx`, and
`explorer.openMode` is no longer rendered at all.

**C2 — the survivor keeps its key and moves group.** A descriptor's Preferences section comes from its
explicit `group` field (`metadata.ts:65`), **not** from its key prefix — so `editor.openOnClick` can
appear under **File Explorer**, labelled *"Open files with"*, while keeping the key 006 chose, which
already has consumers, tests and specs pointing at it. Discoverability of the inert control, behaviour
of the working one, **no key rename and therefore no migration of a setting that works**. Its `none`
value is retained and becomes visible.

**Open Question 9 (a fleet-wide "no inert settings" guard) stays out.** It was attempted during
reproduction and is **unsound as a text scan**: 11 false positives, because settings read via aliased
section objects (`explorerSettings.dragCopyModifier`) defeat it. The #95 guard
(`settings-open-on-click-single-owner.test.ts:78-85`) is the narrow, sound version — it scans for **two
named claimants**, not for the class. Generalising it needs typed accessors or a type-graph check;
raise it, do not smuggle it in here.

---

## 8. The CI hole this feature must close (FR-013a, SC-008)

Worse than "the runners are elevated":

- `playwright.config.ts:55` — `if (!process.env.THRONG_E2E_INCLUDE_ADMIN) excludedTags.push(/@admin/)`,
  applied via `grepInvert` (`:88`). CI never sets it (`ci.yml:167-168` runs a bare `npm run test:e2e`).
- GitHub's Windows runners **are** elevated. So `@admin` specs are excluded from the one runner capable
  of executing them, while `skipIfElevated()` specs self-skip there.
- `admin.ts`'s docblock asserts the opposite of what `ci.yml:157-158` does ("CI runs non-elevated so
  these still execute there").

**Decision**: add a CI step that runs the `@admin` subset with `THRONG_E2E_INCLUDE_ADMIN=1` directly
(`npx playwright test --grep @admin`) — **not** via `npm run test:e2e:admin`, which exists to hop UAC
from a non-elevated shell (`scripts/test-e2e-admin.mjs:20-24`, `Start-Process -Verb RunAs`) and is
pointless on a runner that is already elevated. SC-008's measurable outcome is the count of
admin-gated tests **executed** there being greater than zero, so the step must fail on zero rather than
report a vacuous pass — Playwright exits 0 on an empty selection, which is precisely how this hole
stayed invisible. Correct the `admin.ts` docblock and `ci.yml`'s comment in the same change; a comment
that asserts the opposite of the workflow beside it is how the next reader gets misled.

**Known and out of scope**: the same elevation means `editor-move-repoint` and
`terminate-all-drain` — the **two** files that call `skipIfElevated()` — will **not execute in CI**
either. That guard is correct for terminal-adjacent assumptions and over-applied here, but narrowing it
is an E2E-strategy change, not a defect fix. See the plan's Complexity Tracking.
**`preferences-terminal-flavours` is NOT among them** (**C18**): it has no elevation guard, so #67's 4
RED execute — and fail — on CI today. An earlier draft of this section said all three self-skip and that
CI covers none of the three; that was false, and it propagated into the spec, plan, quickstart and
tasks before being counted.
