# Contract: The shutdown drain

**Feature**: 019 | Governs FR-010, FR-011 (C6, C19–C26) | **Tested by**: `packages/ui/tests/e2e/terminate-all-drain.e2e.ts`

**More than one** deferred write exists (**C19** — an earlier draft said "one deferred write exists", which is how the others stayed invisible; a later one said "four", which **C24** measured as three — the apply client's debounce is unreachable dead code. **This contract states no tally**: the drain never used one). The one #86 reproduced is `workspace.save` — layout
**and** per-panel zoom — behind a 400 ms debounce (`workspace-store.tsx:42`). The ordinary close fires
on a 250 ms timer (`main.ts:661-663`). 250 < 400. Terminate All survives only because its prompt detains
the user ~900 ms. This contract removes timing from the answer.

The others are owned by a **preferences** window and are the same defect on other paths: the themes tab's `writeTheme` (150 ms, `themes-tab.tsx:297`) and the JSON tab's apply (300 ms, `json-tab.tsx:54`, which has **no flush at all**), plus the **undebounced** writes that are the same exposure with a shorter fuse — the apply client via `applyNow`, `keybindings-tab.tsx:117`, `revertAll`, and `projects-panel.tsx:208` in the **workspace** window. **Every `void`-dropped config write is covered, and so is every awaited one (`themes-tab.tsx:432`, `apply-client.ts:31`) — the module does not distinguish (C26)**. A dropped promise cannot be awaited by its caller — `await` on a `void` function
awaits `undefined` and acks having drained nothing. Only **`flushSave`** gains a return type (§1); the
config writes are fixed at their **chokepoint** instead, which retains each promise where the write is
*created* (§3, C22) — so no flush signature is load-bearing and no writer needs naming.

**How many are pending at once no longer matters** (**C22/C23**). Every enumeration-based draft modelled a **list** — of writers (C19), of tabs (C20, C21), then of windows (C22) — and every one was wrong (C24 found even the correction counts false; nobody counts): `JsonTab` is re-rendered with a new `docId` rather than unmounted, orphaning an armed timer that still fires; `KeybindingsTab` and `revertAll` write undebounced and were never named; and `projects-panel.tsx:208` writes `{kind:'settings'}` from the **workspace** window, which a preferences-only drain would have missed entirely. The drain therefore counts nothing: it settles the **write module** every config write goes through, in **every** window (§3). Settling *n* writes is the same call as settling one.

---

## 1. Renderer — `WorkspaceProvider` (`packages/ui/src/renderer/state/workspace-store.tsx`)

```ts
flushSave(): Promise<void>      // CHANGED from `void` (:121-133)
```

**MUST**
- return the `client.save(...)` promise rather than dropping it with `void` (`:129`). A drain that is
  not awaited is not a drain — FR-010 says *and MUST await the drain*
- resolve when there is nothing pending (a no-op flush is a resolved promise, not a rejection)
- keep swallowing a save **failure** as today (`.catch(…)`, `:128-130`) — a failed write must not wedge
  the close. It is reported through the existing reload path

**MUST NOT**: change the debounce, the project-switch flush, or the unmount flush (`:135-164`). Those
work.

### 1a. The layout module — `packages/ui/src/renderer/state/layout-saves.ts`

`flushSave` reports the **armed** half and can only ever report that half: once the 400 ms timer has
fired, `pendingSave.current` is `null` and it returns immediately, while `void client.save(…)` is still
on the wire. That is the exact asymmetry `writeChains` exists to close on the config side (§3a), and
the layout side needs it for the same reason — *worse*, in fact: a sub-workspace's save is **two**
round-trips (`subworkspace-window-client.ts:54-66`), and the terminate/leave exit calls
`mainWindow.close()` on the line after the ack with **no beat behind it** (`main.ts:761-762`), so
`closeChildren` destroys the child mid-round-trip. The drain would have acked **having drained it**.

```ts
export function registerLayoutFlusher(flush: () => Promise<void>): () => void; // the ARMED half
export function trackLayoutSave(save: Promise<unknown>): Promise<void>;        // the IN-FLIGHT half
export function settleLayoutSaves(): Promise<void>;                            // fire armed, then await in flight
```

**MUST**
- track a save from where it is **started** — both the debounce timer (which still drops its promise:
  the drag loop must not await a save) and `flushSave`. Dropping the promise is fine; dropping the
  *record* is the defect
- resolve on a **failed** save, never reject (as `settleConfigWrites` does)
- live **outside** the store, so both halves are drivable without React
  (`packages/ui/tests/unit/layout-saves.test.ts`)

**MUST NOT**: build the in-flight half into the component; settle only what is armed.

## 2. IPC — the close handshake gains a round-trip

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `throng:appClose:begin` | main → renderer | — | **exists** (`main.ts:654`): the blocking overlay |
| `throng:appClose:drain` | main → renderer | `{ requestId: string }` | **NEW**: flush every pending deferred write |
| `throng:appClose:drained` | renderer → main | `{ requestId: string }` | **NEW**: the ack. Correlated, so a stale ack cannot satisfy a later drain |
| `throng:appClose:prompt` / `:closing` / `:choice` | both | — | **exist**, unchanged |

Preload (`packages/ui/src/preload/preload.cts`) exposes the pair beside the existing `appCloseChoice`
(`global.d.ts:45`): a subscribe for the request, a send for the ack. The renderer's handler is the only
place that knows what "pending" means.

## 3. Renderer — the drain handler

**MUST**, on `appClose:drain`, await **every deferred write the window owns** (**C19**; C6's reasoning
one level down — a drain that reaches some writes and not others leaves the bug half-fixed):
1. `await Promise.all([flushSave(), settleConfigWrites()])` — in **every** window, **unconditionally**
   (**C22/C23**). `flushSave()` is the workspace layout + zoom (the write #86 is about);
   `settleConfigWrites()` flushes every armed debounced config write and awaits every in-flight one.
2. **Do not enumerate tabs, writers or windows.** The module is the chokepoint — every config write goes
   through `writeConfig` — and enumeration is what every earlier draft got wrong: a miscount (C19),
   a two-of-three tab model (C20), an unmount that never happens (C21 — `JsonTab` is re-rendered with a
   new `docId`, orphaning an armed timer that still fires), and gating this call on *"in a preferences
   window"* (C22) while `projects-panel.tsx:208` writes `{kind:'settings'}` from the **workspace**
   window. A window with nothing pending settles immediately; so does one hosting no config writer.
3. ack **once**, with the same `requestId`, whether the writes succeeded or failed

**One precondition, and the handler is a no-op without it** (T017a): `settleConfigWrites()` must exist.
Until it does, every flush returns `void`, and `await` on a `void` function awaits `undefined` — it
resolves immediately, the ack fires before the write lands, and the drain reports success having drained
nothing (FR-010's defect, reproduced by its own fix). The MUST NOT below ("ack before the awaited writes
settle") is **unsatisfiable** until it lands.

**MUST NOT**: ack before the awaited writes settle; ack twice; throw across the bridge.

## 3a. The write module — `packages/ui/src/renderer/config/write-config.ts` (C22–C26)

```ts
/** `produce` runs at FIRE time; `null` = DO NOT WRITE (C26). Debounced PER id (C25). */
export function scheduleWrite(id: ConfigDocId, produce: () => string | null, ms: number): void;
/** json-tab's `reload` abandon (`:108`) — without it, adopting an external change is silently
 *  clobbered by the edit you just abandoned (C26). */
export function cancelWrite(id: ConfigDocId): void;
/** Flush every armed write, then await `writeChains.values()` — the EXISTING per-doc in-flight tail
 *  map (`:24`, issue #50). NOT a new set (C26). */
export function settleConfigWrites(): Promise<void>;
```

**MUST**
- key the debounce by **`ConfigDocId`** (C25). An id bound at *creation* cannot express `writeTheme`,
  whose id comes from the debounced payload at fire time; per-id keying is also **018 FR-023**'s
  captured-at-edit-time guarantee, enforced by the module rather than by a payload convention
- evaluate `produce` **at fire time**, and **write nothing when it returns `null`** (C26). `json-tab`'s
  body parses the buffer and must not write an unparseable one (**007 FR-017**), while its
  echo-suppression (`lastAppliedRef`), `dirtyRef` and `setExternal(null)` (**007 FR-041**) bookkeeping
  keeps firing exactly when it does today
- reuse **`writeChains`** for in-flight tracking. It already exists (`:24`), it already chains per
  document (issue #50 — two writes to one file are not commutative), and duplicating it would breach
  the DRY principle this feature's Constitution Check invokes

**MUST NOT**: change the shared `debounce` helper's signature (`:93`) — its search-input callers write
nothing; build a second in-flight set; drop `cancelWrite` (its absence is a silent config write-back).

**This API's shape was wrong twice before it was written**: `debouncedWrite(id, ms)` (C22) could not
express `writeTheme`; `scheduleWrite(id, json, ms)` (C25) could not express `json-tab` and would have
put invalid JSON on disk. Both were found by asking *what does this writer actually do?* — T021a is the
mechanical version of that question.

## 4. Main — `packages/ui/src/main/main.ts` (`:650-686`)

**MUST**
- drain **before** allowing the close, on **both** paths:
  - the no-terminals path (`:657-665`) — the one that loses the write today
  - the `appClose:choice` handler (`:673-686`) for `'terminate'` **and** `'leave'` — the ones that
    survive by accident. A fix that drains one exit and not the other is what the two green tests in
    the RED file exist to catch
- drain every window from `BrowserWindow.getAllWindows()` **that can answer**, as `relaySync` already
  does (`:531-533`) — **the drain names no windows** (**C23**). **C6** is why sub-workspace windows are
  not special-cased *out*: they carry their own layout writes on the same close-all cascade
  (`WindowManager.closeChildren`), and excluding them leaves the bug half-fixed for exactly the
  multi-window users most likely to have a layout worth keeping. **C23** is why nothing is special-cased
  *in*: an earlier draft's enumeration ("the main window and every sub-workspace window") silently
  omitted the **preferences** window — the one this feature's drain work exists for — and a
  preferences-only gate on the config half omitted the **workspace** window's own config write. Name
  none of them; ask the list
- filter that list on **whether the window has announced that it is listening**, and on nothing else.
  `getAllWindows()` includes the **drag ghost**: a real `BrowserWindow` with **no preload**, loaded
  from a `data:` URL and merely **hidden** on drop (`ghost-window.ts` — "load the shell ONCE"), so it
  survives the whole session after one drag. It has no `window.throng`, never registers the handler and
  can never ack, so asking it cost **every** later close the full `shutdownDrainTimeoutMs` — 5s of
  "Closing throng…" after the most ordinary gesture in the product, plus a `drain budget lapsed` log
  each time. The renderer therefore announces itself (`throng:appClose:drainReady`) at the moment it
  registers the drain handler, and main drains the announcers. **This is not an enumeration wearing a
  disguise**: it names no window, no kind and no count — it asks the same list a different question,
  the only one the answer depends on. Nor is it a race: a window announces at its **entry point**,
  before React mounts and therefore before any write can be scheduled, so a window that has not
  announced has nothing to settle (ordering, not timing). Main's listener is registered at **module
  scope** for the same reason — one installed beside the drain is installed *after* `createMainWindow`,
  and the main window's announcement, sent while that `await` is still loading its renderer, is dropped
  forever. Measured: the main window then answered no drain at all
- **not** widen the budget, and **not** special-case "the ghost" by name (the next mute window would
  have to be found by another 5s stall)
- `await Promise.all(...)` the acks, then set `allowClose = true` and close
- bound the wait with `IUiSettings.shutdownDrainTimeoutMs` (§5). A lapsed budget logs and closes anyway
  — an unresponsive window must not hold the app open forever
- skip a destroyed/crashed window rather than waiting out its budget

**MUST NOT**
- rely on the 250 ms timer for correctness (**FR-011**). It may remain as the beat that lets the
  "Closing throng…" overlay paint, but the close now waits on the **drain**, not on the clock.
  Widening it to 500 ms is the accident wearing a bigger coat, and is explicitly refused
- move the drain to `will-quit` / `before-quit` — the renderer holding the write is already gone by then
- make the drain conditional on there being terminals, a prompt, or a choice

## 5. Configuration (Principle X)

```ts
// packages/core/src/config/settings.ts — IUiSettings
/** Max time to await every window's shutdown drain before closing anyway (FR-010). A BACKSTOP for an
 *  unresponsive window, never the mechanism: the close waits on the ACK, not on this. */
shutdownDrainTimeoutMs: number;
```

```ts
// packages/ui/src/main/ui-settings.ts — documented default + env override, as DEFAULT_ATTACH_TIMEOUT_MS (:19)
export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;
shutdownDrainTimeoutMs: numberFromEnv(env.THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS, DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS),
```

## 5a. Found while fixing this, NOT fixed here: the ghost outlives the app

Chasing the drag-ghost stall turned up a **second, older** defect on the same journey, and it is not
019's: after any drag, the hidden ghost is still in `getAllWindows()`, so `window-all-closed` never
fires (`main.ts:935`) and **`app.quit()` is never called**. The main window vanishes and the process
stays — invisible (`skipTaskbar`), which is presumably why nobody has reported it. It reproduces at
`THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS=1`, so it is not the drain, and it predates this feature: nothing
ever closes the ghost, `stopGhost` only hides it.

This is why the drag test asserts on the **window's** destruction (`win.waitForEvent('close')`) rather
than the app's exit: the app's exit cannot be waited on at all in that session, and the symptom
CRITICAL 2 describes is the "Closing throng…" overlay sitting there. **Own it separately** — the fix is
the ghost's, not the drain's.

## 6. Accepted limit (FR-011)

An **uncatchable** termination (`SIGKILL`, Task Manager) can still lose up to 400 ms of layout. The
debounce is a deliberate trade against write amplification during a drag. This is a **documented
accepted limit**, not a defect, and it belongs in the docs the constitution's currency rule names — not
in a comment nobody reads.

## 7. Observable contract (what the RED tests read)

| Journey | Expectation | Test |
|---|---|---|
| add a panel → **ordinary** close → relaunch | `workspace.load` layout holds **2** panels; 2 `.panel-box` on screen | RED (`:259-311`) |
| zoom ×2 → **ordinary** close → relaunch | stored `zoom === 1`; `panel-<pid>` has `data-zoom="1"` | RED (`:313-361`) |
| add a panel + zoom → **Terminate All** → relaunch | 3 panels stored, zoom 1 | **green today — must stay green** (`:370-424`) |
| language override → **Terminate All** → relaunch | `document.getState` returns `'shell'`; strip reads *Shell* | **green today — must stay green** (`:182-250`) |
| rearrange a **sub-workspace** → close the main window → relaunch | the sub-workspace's arrangement survived | **NEW — T015** (C6). **Discriminating, and only just**: the main window's handle MUST be resolved *before* the decision (`app.browserWindow()` is a CDP round-trip that costs more than the 400 ms debounce by itself, so paying for it after the decision lets the child's own timer save the write and the test cannot fail), and the child's death is stamped from **main** and asserted **inside** its 400 ms debounce — measured, not assumed. Verified RED with `settleLayoutSaves()` deleted (`stored: ["p"]`), GREEN with it |
| one **drag**, then an ordinary close | the window closes **promptly** — a mute window is not waited on | **NEW** (FR-011). The only test that fails on the drag-ghost stall: measured 5279 ms before the fix, against a 2000 ms guard. Asserted on the **window**, not the app's exit — see "unfixed" below |
| a **theme colour** edit inside its 150 ms debounce → close → relaunch | the colour survived | **NEW — T015a** (C19; scope per C20/C21 — the preferences window is Electron-**parented** (`preferences-window.ts:67`), not in `WindowManager`'s `registerChild` cascade; **as the code stands today** the **settings and themes** tabs are mutually exclusive, both flushing on unmount, which is why this RED test drives Themes; the JSON tab is the exception, being re-rendered rather than unmounted. **T017a deletes both cleanups** and the module settles them either way (C22), so this is about how the test is **staged**, not a shipped property) |
| language override → **ordinary** close → relaunch | `document.getState` returns it; strip reads it | **NEW — T015b**. AC4/SC-005 claim **either** exit; only Terminate All was measured. Expected **green on the first run** — the mechanism (awaited IPC, no debounce, synchronous SQLite write) says it cannot fail. If it is RED, #86 is wider than reproduced |
| **create** a project (root folder chosen) → **ordinary** close inside the write → relaunch | `newProject.lastProjectFolder` persisted; "+ New" starts there | **NEW — T015c** (**C23** — the workspace window's own config write, `projects-panel.tsx:205-209` → `writeConfig`, reached only from create at `:333`). **Not a rename**: `updateProject` → `client.update` is an awaited SQLite IPC that never touches `writeConfig`, so a rename-based proof cannot fail. This is the journey §4 argues for by name, and C23's widening had no test until it was asked for |

Note the harness caveat the RED file documents (`:88-90`): neither `app.close()` nor the harness
teardown reaches this handshake — both **destroy** the window, firing no `close` event at all. Any new
coverage must drive `BrowserWindow.close()`.

**A guard on a proxy is not a guard.** The JSON-tab case is this feature's ONLY discriminating proof of
the config drain, and it originally guarded `closeRequestedAfterMs < 300` — six times looser than the
~50 ms it needed, because with the drain deleted the renderer dies at
`armedAt + closeRequestedAfterMs + t(terminal.list) + 250ms`. **Measured**: with `settleConfigWrites()`
deleted and the close requested 120 ms in (a mildly loaded box), *every* assertion in that test passed —
the debounce simply fired on its own while the close was still asking the daemon about terminals. It
now asserts the one quantity that separates the two worlds — **when the bytes landed**, from the file's
mtime: **8 ms** with the drain (it fires the timer the moment the close asks), **309 ms** without (the
timer ran out and did it). The timer cannot beat its own 300 ms; the drain cannot miss by 200. Prefer a
measurement of the thing itself over arithmetic about who was scheduled when.
