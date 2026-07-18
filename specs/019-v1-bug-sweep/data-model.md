# Data Model: v1.0.0 Bug Sweep

**Feature**: 019 | **Date**: 2026-07-16

**This feature persists nothing new.** No table, no store, no config file, and — with one deletion —
no new settings key. What changes is the shape of facts **in flight**: a move that was never announced,
a write nobody asked for, an ack that was defined and discarded, a record that had no control.

One key is **removed** (`explorer.openMode`). One descriptor **moves group**. That is the whole
persisted-surface delta.

---

## 1. Move notification (US1 / #87)

The spec's Key Entity: *"`{from, to}` pairs for files that actually moved; emitted by the files service,
consumed by the editor coordinator. Symmetric, so an undone move (#85) is just a move in the other
direction."*

```ts
/** One completed move. Both paths are ABSOLUTE and as the OS spelled them. */
export interface MovePair {
  readonly from: string;
  readonly to: string;
}
```

**Invariants**

- `from`/`to` are absolute. Comparison against a stored `doc.absPath` is **never** raw — it goes through
  the shared normaliser (§2), because the coordinator holds forward-slashed paths from the tree and
  main produces back-slashed ones (FR-007).
- A pair is emitted **only after** its `fs.move` resolved. What was *asked for* is not the payload;
  what *actually moved* is (FR-001) — `move()` returns on the first disallowed item
  (`files-service.ts:100-105`), so a half-succeeded batch is ordinary.
- A folder pair re-points every doc **beneath** `from`, by prefix (FR-005). One pair, N docs.
- The set may be **empty** (the whole batch failed): the bracket still closes, and the docs it opened
  return to ordinary watcher behaviour.
- Symmetric by construction: `{from: A, to: B}` undone is `{from: B, to: A}`. No `kind` field, no
  `undo` flag — #85 needs no new concept.

**Lifecycle (the bracket — FR-004)**

```text
FilesService.move/rename
  │
  ├─ onMoveStarted(absPaths)      ──►  EditorCoordinator.beginMove(paths)
  │                                      docs matching paths (exact or prefix): movePending = true
  │   … await fs.move / fs.rename, accumulating MovePair[] …
  │      (watch may fire HERE: onDiskChange's !res.ok branch returns while movePending — no markDeleted)
  │
  └─ onMoved(pairs)   [finally]   ──►  EditorCoordinator.markMoved(pairs)
                                         re-point matched docs; clear movePending on ALL bracketed docs
```

**Doc state touched by `markMoved`** (`CoordDoc`, `editor-coordinator.ts:61-88`):

| Field | Before | After | Why |
|---|---|---|---|
| `absPath` | old | **new** | the fact of the move (FR-002) |
| `watch` | watching `dirname(old)` | re-established on `dirname(new)` | the watch is per-folder (`:681-685`) |
| `authority` (buffer, dirty, undo history) | — | **unchanged** | FR-002/FR-003; Principle XI — one document |
| `fileMissing` | `false` | **`false`** | it is not missing; it moved |
| recovery snapshot | none (clean doc) | **none** | AC5: a clean move leaves nothing to strand |
| registry entry | keyed `old` | keyed `new` | AC4: new path → `focus`, old path → `open` |
| `movePending` (**new**) | `true` | `false` | the bracket closes |

**Not touched, deliberately**: `markDeleted` (`:268-294`). A file moved or deleted by **another
program** keeps today's behaviour — kept, dirty, recoverable (FR-009, AC7). That path is correct; the
fix must not sweep it away while making in-app moves quiet.

### `EditorSyncMsg.movedTo` — the fact, on the ordered stream

```ts
export interface EditorSyncMsg {
  panelId: string;
  change?: CanonicalChangeMsg;
  reset?: ResetDocumentMsg;
  dirty?: boolean;
  deleted?: boolean;
  externalChange?: boolean;
  movedTo?: string;   // NEW — the document's new absolute path (FR-002)
}
```

Broadcast with `relaySync(-1, …)` — **every** window, the same channel `markDeleted` uses (`:290`).
A move is a property of the **document**, not of a view, so every replica learns it from the one
authority rather than each discovering it (Principle XI). The renderer's handler
(`use-editor.ts:779-790`) writes the new path into the panel's config, which is what makes the header
pill follow (AC1) and what makes the **persisted layout** carry the new path — riding the very
`workspace.save` debounce US2 drains.

---

## 2. Path identity (US1 / FR-007)

```ts
// packages/core/src/fs/path-id.ts — NEW, pure, no OS calls
export function normaliseForCompare(p: string): string;   // \→/, strip trailing /, lowercase
export function samePath(a: string, b: string): boolean;
export function isUnderPath(file: string, folder: string): boolean;   // === or startsWith(folder + '/')
```

Not new logic — the **third** copy of it, collapsed into one. It exists inline in `markDeleted`
(`editor-coordinator.ts:269-276`) and again in the RED E2E's own helper
(`editor-move-repoint.e2e.ts:74-75`, written because raw comparison makes even the *correct* AC7 look
broken). Case-insensitivity is a Windows-first choice, kept in core as a **rule** rather than an OS
call (Principle II), and stated so the next reader knows it is a decision and not an accident.

---

## 3. Deferred write (US2 / #86)

The spec's Key Entity: *"a debounced renderer→daemon persistence action with a pending state that a
shutdown must drain … **Every write is covered — `void`-dropped or awaited — because the module does not
distinguish (C26).** … **This entry states no tally, deliberately (C24)** … A window's drain covers every
write **that window owns**, and needs to know no number to do it."*

| Write | Debounce | Flushed today | Owned by |
|---|---|---|---|
| `workspace.save` (layout + zoom) | 400 ms (`workspace-store.tsx:42`) | project switch, unmount | workspace window |
| ~~apply client~~ — **not debounced in practice (C24)**: `applyDebounced` has zero callers; `applyNow` cancels the debounce and writes immediately, `void`-dropped at every call site | ~~250 ms~~ unreachable | ~~unmount (`settings-tab.tsx:115`)~~ — flushes a debounce that can never be armed | preferences window |
| `revertAll`, `KeybindingsTab`, `ProjectsPanel` | none — undebounced | nothing | preferences / **workspace** |
| `writeTheme` | 150 ms (`themes-tab.tsx:297`) | unmount (`:302`) | preferences window |
| JSON tab apply | 300 ms (`json-tab.tsx:54`) | **nothing** | preferences window |

```ts
/** The renderer-side pending state (workspace-store.tsx:117-133) — unchanged in shape. */
pendingSave: WorkspaceLayout | null      // the layout awaiting the 400ms debounce
saveTimer:   Timeout | null

flushSave(): Promise<void>               // CHANGED: was void, dropped its promise (`void client.save(…)`)
// No OTHER flush needs a signature change (C22): the chokepoint retains each promise where the write is
// CREATED rather than where it is flushed. Both unmount cleanups are deleted — settings-tab.tsx:115
// (ApplyClient.flush(), which has only ever flushed a debounce that could never be armed) and
// themes-tab.tsx:302 (writeTheme.flush() — a `debounce` object, NOT an ApplyClient). ApplyClient itself
// shrinks to { applyNow }; see C25 and T017a.

/** NEW (C22–C26 / T017a) — write-config.ts, the chokepoint EVERY config write already goes through,
 *  in ANY window. *Half* of it already existed: `writeChains` (:24) is the in-flight map (C26), so what
 *  is new is the armed-timer registry + scheduleWrite/cancelWrite/settleConfigWrites. Draft after draft
 *  called this "the story's only new construct" while half of it sat in the file they pointed at.
 *  It replaces the per-tab provider C20/C21 proposed, because a design that must know the list — of
 *  writers, tabs, or windows — was wrong EVERY time it was tried. Every window calls
 *  settleConfigWrites() unconditionally; nobody counts (C24). */
/** Debounced PER ConfigDocId (C25) — no factory, no instance, no useMemo. Theme A's pending write is
 *  keyed to A and theme B's to B, so neither displaces the other: this IS 018 FR-023's
 *  captured-at-edit-time guarantee, enforced by the module. It also dissolves json-tab's orphaned
 *  timer — there is no per-doc instance to mint, so none can be stranded. */
/** `produce` runs at FIRE time; `null` means DO NOT WRITE (C26) — json-tab's body parses the buffer and
 *  must not write an unparseable one (007 FR-017), while keeping its echo-suppression and dirty/external
 *  bookkeeping at fire time. A finished `json: string` parameter would have forced all of that to the
 *  call site, per keystroke, and written invalid JSON to disk. */
declare function scheduleWrite(id: ConfigDocId, produce: () => string | null, ms: number): void;
/** json-tab's `reload` abandon (`:108`): without it, adopting an external change is silently clobbered
 *  by the edit you just abandoned (C26). */
declare function cancelWrite(id: ConfigDocId): void;
/** Flush every armed write, then await `writeChains.values()` — the module's EXISTING per-doc in-flight
 *  tail map (`write-config.ts:24`, issue #50). NOT a new set: that state is already there (C26). */
declare function settleConfigWrites(): Promise<void>;

/** C24/C25: applyDebounced (zero callers) and its debounce are DELETED, and with them flush()/cancel()
 *  — bodies that only drove that debounce, whose sole external caller T017a deletes. Leaving them is a
 *  compile error under `tsc -b`, not a smell. */
interface ApplyClient { applyNow(value: unknown): Promise<ConfigWriteResult> }
```

`writeConfig` **already** retains each doc's in-flight tail in **`writeChains`** (`write-config.ts:24`,
set at `:69`, deleted on settle at `:74`) — chained per document because two writes to one file are not
commutative (issue #50). `settleConfigWrites()` **awaits that existing map**; it builds **no new set**
(**C26** — a second copy of state the module already keeps would breach the very DRY principle this
feature's Constitution Check invokes). So the drain covers **every** write any window owns — debounced;
**undebounced** (`keybindings-tab.tsx:117`; `preferences-app.tsx:176`'s `revertAll`;
`projects-panel.tsx:208`, in the **workspace** window, `app.tsx:493`); **awaited** (`themes-tab.tsx:432`,
`apply-client.ts:31`), since the chain never asked whether the caller dropped the promise; **orphaned**
(`json-tab`'s `useMemo(…, [docKey])` mints a new debounce on a tab switch **without unmounting**,
stranding the old one's armed timer — which C25's per-id keying dissolves outright); and any writer added
later — **without naming one of them**. Those are cited to show the *range*, not as a list to maintain. The two `useEffect(() => () => x.flush(), [x])` cleanups
(`settings-tab.tsx:115`, `themes-tab.tsx:302`) are deleted: the module settles them (Principle VIII).

**Two shape changes, not one.** (1) The **return type** — but in **one** place, not four:
`flushSave` (T017). FR-010 requires the drain be *awaited*, and a `void` flush returns before the write
lands. The other three flushes need **no** signature change (C22): the module retains each write's
promise **at the point it is created**, so no flush return value is load-bearing and the two external
callers of one (`settings-tab.tsx:115`, `themes-tab.tsx:302`) are deleted. (2) The **chokepoint**
(C22/C23): a return type does not make a *dropped* promise awaitable — module-level in-flight tracking
does, in every window, without naming a writer. *(Earlier drafts of this section said "the only shape
change is the return type" (false — the chokepoint is new), "the return type in four places" (only
`flushSave` needs it), "the **seam** (C20)" (no seam is built), and "four of its six callers are search
inputs" (three are — 3 writers + 4 non-writers would be 7 callers, not 6). Recorded rather than quietly
edited, per C17.)*

**How many are pending at once no longer matters** (**C22**). C20 claimed "at most one" (single tab);
C21 qualified it (the JSON tab has no unmount flush). Both modelled a **list of components**, and both
were wrong — `JsonTab` is re-rendered with a new `docId`, not unmounted, so its old debounce's armed
timer survives and still fires; and a **fourth** tab writes undebounced. The drain settles the module,
so settling *n* writes is the same call as settling one.

The shared `debounce` helper (`write-config.ts:93`) is **not** changed: its **search-input** callers (`keybindings-tab.tsx:93`, `settings-tab.tsx:76`, `themes-tab.tsx:121`) write nothing, and `scheduleWrite` is built on it for writers only. No tally here (C24): after T017a the only `debounce` callers left are those search inputs anyway.

**Drain request** (main → renderer → main; see [contracts/shutdown-drain.md](./contracts/shutdown-drain.md)):

```ts
interface DrainRequest { requestId: string }
interface DrainAck     { requestId: string }
```

| Property | Value | Source |
|---|---|---|
| Debounce | 400 ms | `AUTOSAVE_DEBOUNCE_MS`, `workspace-store.tsx:42` |
| Ordinary close fuse | 250 ms | `main.ts:661-663` — 250 < 400: the bug |
| Terminate All stall | ~900 ms measured | the prompt; the user is the drain **by accident** |
| Drain budget (**new**) | `IUiSettings.shutdownDrainTimeoutMs`, default 5000 | backstop for an unresponsive window, **not** the mechanism |
| Windows drained | **every** window from `BrowserWindow.getAllWindows()` — the drain names no windows (C23) | C6 (why sub-workspaces are not special-cased *out*), C23 (why nothing is special-cased *in*) |
| Accepted loss | ≤400 ms of layout under an **uncatchable** kill | FR-011 — a stated limit, not a defect |

---

## 4. Readiness ack & agent budgets (US3 / #94)

The spec's Key Entity: *"`{ ev: 'started'; key; pid }`; already defined in the PTY agent protocol,
currently discarded."*

```ts
// pty-agent-protocol.ts:26 — EXISTS. Unchanged.
{ ev: 'started'; key: number; pid: number }
// pty-agent-host.ts:133-135 — TODAY: `case 'ready': case 'started': break;`  ← the discard
```

**New host state, per terminal key:**

| Field | Meaning | Cleared by |
|---|---|---|
| `readyTimer: Map<key, Timeout>` | the readiness budget for a started-but-unacked terminal | the `started` ack for that key, or its own lapse |
| `lastLaunchFailure: string \| null` | the reason the shim reported (FR-015) — the thing nobody has ever seen | a successful connect |
| `connectDeadline` | injected, no longer `Date.now() + 15_000` at `:36` | connect, or lapse → `failAllLive` |

```ts
// NEW — injected from the daemon composition root (Principle X)
export interface AgentBudgets {
  /** Time from construction for the agent to connect. Default 15_000. */
  readonly connectMs: number;
  /** Time from CONNECT for a started terminal to ack `started`. Default 15_000. Separate: worst case 30s (C7). */
  readonly readyMs: number;
}
```

**State machine** (the panel-visible outcome in the right-hand column is what the RED test asserts):

```text
constructed ──launch(pipe, report)──► connecting ──connect──► live ──start──► awaiting `started`
     │                                    │                                      │
     │                     connectMs lapses│                          readyMs lapses│    `started` ack
     │                                     ▼                                      ▼          ▼
     └──report(reason)──► lastLaunchFailure│                                 fail THAT key   running
                                            ▼
                              failAllLive('… never started' [+ reason])
                              NO relaunch (C8)                       ──► onData `[throng] …` + onExit({code: 1})   ◄── C27/C28: TODAY it is
                                                                          {code: null} (:82). T025 adds the code
                                                                          PARAMETER; the crashed-agent caller (:63)
                                                                          keeps null — "exited (code —)" is honest
```

The existing `close`-path relaunch (**`:64-65`** — `:63` is its `failAllLive` call, which C28
parameterises while keeping that caller's `null`) is untouched: a **crashed** agent may come back; one that
never arrived indicates the shim, and relaunching buries the error in a loop (C8).

### Launch seam (FR-015)

```ts
// daemon/src/pty-agent-host.ts — widened ADDITIVELY (the RED test's 2-arg `() => {}` still compiles)
launch: (pipeName: string, report: (reason: string) => void) => void
```

`WindowsDeElevatedLauncher.launch` keeps returning `void` and stays behind its Principle II seam; it
swaps `stdio:'ignore'` (`windows-de-elevated-launcher.ts:31-34`) for a captured stderr and calls
`report(...)` on a non-zero exit. The shim already throws precise messages
(`"CreateProcessWithTokenW failed: <win32 error>"`) — today straight into the void. This is what will
finally explain the original hang.

---

## 5. Terminal flavour record (US4 / #67)

The spec's Key Entity: *"`{ id, label, file, args, defaultParams }`; an **ordered** array whose `id`
keys `terminals.defaultParams`. Uniqueness holds **on editor entry** (FR-019 refuses a duplicate) and in
the **merged launch list** (`mergeFlavours` is first-wins) — but **not** in `settings.json`, which the
JSON tab can hand a duplicate and `parseTerminals` does not dedupe. C17 defines that case."*

```ts
// EXISTS (settings.terminals.flavours). Shape unchanged — only its CONTROL changes.
interface UserFlavour { id: string; label: string; file: string; args: string[]; defaultParams: string }
```

| Property | Rule | Source |
|---|---|---|
| `id` | required, **immutable once created** (C13); unique **on editor entry** (FR-019) and in the merged launch list — **not** guaranteed in `settings.json` (C17) | keys `terminals.defaultParams`; `mergeFlavours`'s `dedupeById` (`flavour.ts:55`, unexported) is first-wins over the **merged runtime** list only — `parseTerminals` does **not** dedupe the persisted array, and the JSON tab ships |
| `file` | required, **non-empty — not existence-checked** (C12) | may be valid on another machine; launch already says *"not available on this machine"* |
| `label` | free text | shown in the Flavour dropdown |
| `args` | `string[]`, edited as space-separated text | YAGNI — a nested array editor is a capability nobody asked for |
| order | **preserved, never sorted** (C11) | it is the panel dropdown's order; `mergeFlavours` is first-wins |

```ts
// packages/core/src/terminal/flavour-record.ts — NEW, pure
export function validateFlavourRecord(
  record: Partial<UserFlavour>, existingIds: readonly string[],
): string | null;   // a MESSAGE, not a boolean — "invalid" with no reason is a dead end
```

The idiom is `validateKey`'s (`map-control.tsx:38-55`), and the RED test asserts on the message text
(`id` / `already` / `executable`).

### Descriptor additions (the registry, `metadata.ts`)

```ts
export type ControlKind = … | 'records';    // NEW — an ARRAY of records, keyed by a declared id field

export interface FieldDescriptor {
  …
  /** `records` only: the property that identifies a row. Immutable once created (C13). */
  idKey?: string;
  /** `records` only: what one row IS ('flavour') — labels the affordances and names the test ids. */
  itemNoun?: string;
}

export interface MapColumn {
  …    // unchanged shape; `control: 'text'` finally RENDERS (C14) — see contracts/settings-descriptors.md
}
```

**`records` is declared, never inferred** (FR-018). Today `control:'array'` lets the control type flip
with the value: `[].every(...)` is vacuously true, so an *empty* `terminals.flavours` renders as a
string-array control whose Add appends `''` — an empty **string** into an array of **objects**, which
the tolerant parser then drops. Add one flavour and it silently becomes a JSON textarea.

### Settings-key delta (the whole of it)

| Key | Before | After | Clarification |
|---|---|---|---|
| `terminals.flavours` | `control: 'array'` → JSON textarea / string-array | `control: 'records'`, `idKey: 'id'`, `itemNoun: 'flavour'`, 4 columns | FR-018, C9 |
| `terminals.disabledBuiltins` | `array` + `itemControl: 'text'` (free text) | `multiselect` over the **detected** built-ins | FR-016/017, C10 |
| `terminals.defaultParams` | `map` + `columns:[{label:'Arguments',control:'text'}]` → an empty `<select>` | unchanged descriptor; the **text cell** now exists | C14 |
| `editor.openOnClick` | `group: 'Editor'`, label *"Open file into editor on"* | `group: 'File Explorer'`, label *"Open files with"*, key **unchanged** | C2, FR-024 |
| `explorer.openMode` | descriptor + typed field + default + parse | **DELETED** — key, descriptor, field, default, parse, clone | C1, FR-023 |

`explorer.openMode` is **dropped, not migrated** (C1): ignored on load, stripped on the next write, no
warning, and — this is the argument — **no change to the user's current behaviour**, because it has
never had any effect. A user with `openMode: 'double'` gets single-click today and single-click
tomorrow; migrating would *change* their experience to double-click. `parseExplorer`
(`app-settings.ts:267-285`) already drops unknown keys silently, so nothing is needed to make this
happen — the deletion **is** the mechanism, and it is idempotent by construction (v3.5.0).

---

## 6. Contrast pairing (US6 / #83)

The spec's Key Entity: *"`{ fg, bg, min }`, to be derived from the token registry rather than
enumerated."*

```ts
export interface ContrastPairing { fg: string; bg: string; min: number; label: string }   // unchanged

export const SYNTAX_TOKENS: readonly string[] =          // DERIVED (was a hand-list, :292-303)
  Object.keys(THRONG_THEME.colours).filter(t => t.startsWith('syntax')).sort();

export const SYNTAX_BODY_MIN = 6.0;                       // C3 — the house standard, stated
export const BY_DESIGN_LOW_CONTRAST_THEMES = ['Matrix', 'VI-VIM', 'Gothic'];   // C4 — #61's policy

const SYNTAX_ON_BODY = SYNTAX_TOKENS.map(fg => ({ fg, bg: 'editorBg', min: SYNTAX_BODY_MIN, … }));
export const CONTRAST_PAIRINGS = [ …existing…, ...SYNTAX_ON_MATCH, ...SYNTAX_ON_BODY ];
```

| Constant | Value | Why it is what it is |
|---|---|---|
| `WCAG_AA_BODY` | 4.5 | the **floor**. Unchanged; still governs every other body pairing |
| `SYNTAX_BODY_MIN` | **6.0** | `makeTheme` lifts every seed to 6:1 (`default-themes/index.ts:186-192`) because the search-match tint can only be as strong as the weakest syntax hue permits. A 4.5 gate is weaker than the derivation it protects (C3) |
| Measured today | **150 pairs, 0 failures**, all ≥6.01 | so 6.0 gates reality with zero recolouring (SC-014) |
| Scope | all 15 bundled themes **except** the carve-out | new pairings only; `IN_SCOPE_THEMES` (`:278`) is untouched and still governs the old ones → **not blocked by #61** (C4) |
| Measured value | the **shipped** token (`theme.colours[t]`), never the seed | FR-029 — the authored seeds are not what ships |

The derivation happens **twice** on purpose: the token set from the registry, and the pairings from the
token set. A hand-list is precisely how these ten tokens were missed when 016 introduced them
(FR-026), and `SYNTAX_TOKENS` was the second hand-list hiding underneath the first — which is why the
RED test refuses to trust it and derives its own set to compare against
(`theme-syntax-body-contrast.test.ts:45-48,106-108`).
