# Contract: PTY agent connect & readiness budgets

**Feature**: 019 | Governs FR-012…FR-015, FR-013a (C7, C8, C27, C28) |
**Tested by**: `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts` (elevation-free, 2 RED)
and `packages/ui/tests/e2e/terminal-de-elevation-hang.e2e.ts` (`@admin`, never yet executed)

The failure path already exists — `failAllLive` (`pty-agent-host.ts:78-84`) and the `ev:'error'` branch
(`:123-129`) both surface `[throng] …` on `onData` plus an `onExit`, which `TerminalService`
publishes as `terminal.output` + `terminal.exit` and the panel renders as a visible error (**005**
FR-019/FR-020 — 019's FR-019/FR-020 are the flavour-record control's, not these).
Nothing reaches it. This contract is the two routes in.

---

## 1. `PtyAgentHost` (`packages/daemon/src/pty-agent-host.ts`)

```ts
export interface AgentBudgets {
  /** Time from construction for the agent to connect. Default 15_000 (today's hardcoded :36). */
  readonly connectMs: number;
  /** Time from CONNECT for a started terminal to ack `started`. Default 15_000. SEPARATE (C7). */
  readonly readyMs: number;
}

constructor(
  pipeName: string,
  launch: (pipeName: string, report: (reason: string) => void) => void,   // WIDENED, additively
  budgets: AgentBudgets = DEFAULT_AGENT_BUDGETS,                          // NEW, optional
)
```

**MUST**
- keep the **2-argument** construction compiling and working: the RED test builds
  `new PtyAgentHost(pipe, () => { launches += 1 })` (`:96`, `:164`) and asserts the launch happened
  **synchronously in the constructor** (`:99`). Widening `launch`'s parameter list is source-compatible;
  a required third parameter is not
- take `connectMs` from the injected budgets instead of the literal `Date.now() + 15_000` (`:36`, `:65`).
  This **removes** a hardcoded timeout from business logic (Principle X)

**MUST NOT**: read `process.env` inside the class; construct its own launcher; grow a second failure path.

### Route 1 — the connect deadline lapses (FR-012)

Today: `sock.on('error')` retries `if (Date.now() < deadline)` and otherwise **does nothing** (`:67-74`).
The host has conclusively established the agent will never arrive and keeps it to itself.

**MUST**, when the deadline lapses:
- call `failAllLive(reason)` where `reason` names the failure **and appends the captured launch reason
  when one exists** (FR-015) — e.g.
  `the de-elevated terminal agent never started: CreateProcessWithTokenW failed: 1314`
- **give `failAllLive` the exit code as a PARAMETER** — `failAllLive(reason, code)`, this route passing `1`; not a body change to today's unconditional `cb({ code: null })`
  (`:82`) — **C27**. This contract's own preamble used to say it "already" emits non-zero; **it does
  not**. That is the `ev:'error'` branch (`cb({ code: 1 })`, `:127`), whose comment states what the
  non-zero code buys: *"so the Panel reverts with a visible message (005 FR-019), never a silent blank"*
  — which is precisely what **FR-012** demands of *"a **visible**, actionable failure"*. `code: null` is
  the shape of an ordinary end, not a failure. It also makes Route 1 and Route 2 agree, which they did
  not. **Nothing asserts `code: null`** (the RED test checks only `exits.length > 0`), so no test is
  weakened — and that is exactly why the contradiction survived four documents
- **NOT relaunch** (**C8**). The `close`-path relaunch (**`:64-65`**; `:63` is its `failAllLive` call, which C28 parameterises while that caller keeps `null` — a crashed agent's code is genuinely unknown, and "exited (code —)" is the honest render) stays exactly as it is — a *crashed*
  agent may come back; one that never arrived indicates the shim, and relaunching produces a launch
  loop that buries the error
- leave `dispose()`'s suppression intact (`:188`): a deliberate close must not fire a failure

**Note on the RED test's shape**: it registers `onData`/`onExit` **after** `start()` (`:101-104`) and
polls for ~18 s. `failAllLive` iterates `dataCbs`/`exitCbs` keys, so a key with **no** callbacks
registered yet would be invisible. The lapse fires long after registration here, but the implementation
must fail the **started keys**, not merely the keys that happen to have listeners — otherwise the fix
is a race.

### Route 2 — readiness is never acknowledged (FR-013)

Today: `case 'ready': case 'started': break;` (`:133-135`) — the protocol's ack
(`pty-agent-protocol.ts:26`, `{ ev:'started'; key; pid }`) is parsed and thrown away, and nothing waits
for it.

**MUST**
- start a per-key readiness timer of `budgets.readyMs` **at connect** (C7) for every key that has been
  `start`ed and not yet acked. Not at `start()`: before connect there is no agent that could ack
- clear that key's timer on `{ev:'started', key}`
- on lapse, fail **that key only** — `[throng] the terminal never started`, plus a non-zero exit —
  leaving other live terminals alone
- clear the timer on `exit`/`error`/`forgetKey` (`:86-91`) so a key that ended cannot re-fire

**MUST NOT**
- treat **first output** as readiness (**FR-013**). A legitimately slow shell that has printed nothing
  is still starting, and killing it is US3 AC4's explicit prohibition
- start the readiness clock before the socket connects, or share one clock across keys

### The agent side

The agent (`packages/daemon/src/pty-agent-entry.ts`) **MUST** emit `{ev:'started', key, pid}` once its
ConPTY is spawned — **and it already does**, unconditionally, at `:91` (with `{ev:'ready'}` at `:130`
for the connection itself). Verified during the 2026-07-17 cross-artifact analysis; T027 therefore
**confirms** this rather than building it, and **the whole of US3's work is host-side** (the discard at
`pty-agent-host.ts:133-135`). The RED test's second scenario stands up a live server that accepts the
`start` and **deliberately never replies** (`:139-158`), proving the host waits for an ack rather than
for silence to end — independently of the real agent's emit, which is why the two settle separately.

## 2. Launch reporting (FR-015) — `packages/platform-windows/src/windows-de-elevated-launcher.ts`

```ts
launch(file: string, args: string[], report?: (reason: string) => void): void   // still returns void
```

**MUST**
- capture the shim's stderr — `stdio: ['ignore', 'ignore', 'pipe']` in place of `stdio:'ignore'`
  (`:31-34`) — and call `report(stderr || `exit ${code}`)` on a non-zero exit
- keep `.unref()` and `windowsHide` — the launch stays fire-and-forget in *lifetime*; only its
  **failure** becomes observable
- stay behind its Principle II seam and remain synchronous

The shim already throws precise, actionable messages (`$ErrorActionPreference='Stop'`;
`"CreateProcessWithTokenW failed: <win32 error>"`, `"OpenProcessToken failed: …"`). They go into
`/dev/null` today. **This is why nobody has ever known why #94 hangs.**

**MUST NOT**: pipe stdout (the agent's own output belongs on the pipe, not here); block on the shim;
throw.

## 3. Composition root (`packages/daemon/src/composition-root.ts:140-148`)

```ts
const deElevatedPty = new PtyAgentHost(agentPipe, (pipe, report) => {
  if (elevation.isElevated() && deElevatedLauncher.isAvailable()) {
    deElevatedLauncher.launch(process.execPath, [agentEntry, pipe], report);
  } else {
    const child = spawn(process.execPath, [agentEntry, pipe], { stdio: ['ignore','ignore','pipe'], windowsHide: true });
    /* …report a non-zero exit the same way… */ child.unref();
  }
}, { connectMs: settings.agentConnectTimeoutMs, readyMs: settings.agentReadyTimeoutMs });
```

`report` **must** arrive as a parameter of the launch callback rather than close over `deElevatedPty`:
the host's constructor invokes `launch` **synchronously** (`:35`), before `deElevatedPty` is assigned —
a closure reference would be a temporal dead zone.

## 4. Configuration (Principle X)

```ts
// packages/core/src/config/settings.ts — IDaemonSettings
/** Time the de-elevated PTY agent has to connect before the launch is declared failed (FR-012). */
agentConnectTimeoutMs: number;
/** Time from connect for a started terminal to ack `started` (FR-013). Separate from the connect
 *  budget so a slow connect does not consume the readiness allowance (C7) — worst case 30s. */
agentReadyTimeoutMs: number;
```

Read in `readDaemonSettings` (`composition-root.ts:70-74`) via the existing `numberFromEnv`, defaults
15000/15000, env `THRONG_AGENT_CONNECT_TIMEOUT_MS` / `THRONG_AGENT_READY_TIMEOUT_MS`. `DEFAULT_AGENT_BUDGETS`
is exported for the 2-arg constructor form, mirroring `DEFAULT_ATTACH_TIMEOUT_MS` (`ui-settings.ts:19`).

## 5. Observable contract

| Scenario | Expectation | Test |
|---|---|---|
| agent never connects (no pipe server, `launch` does nothing) | ≥1 `onExit`, and `onData` chunks matching `/throng/i`, within 15 s + grace | RED (`:87-125`) |
| agent connects, receives `start`, never acks | the `start` **did** reach the agent, **and** ≥1 `onExit` + a `/throng/i` chunk | RED (`:127-195`) |
| elevated throng, non-elevated terminal | a **working prompt** (cwd marker in the terminal) — a visible error is the permitted degradation, not the goal | `@admin` (`:101-112`) |
| a slow shell producing no output yet | **not** killed | US3 AC4 — guaranteed by acking on `started`, not on output |

## 6. CI (FR-013a / SC-008)

`playwright.config.ts:55` excludes `@admin` unless `THRONG_E2E_INCLUDE_ADMIN` is set, and CI never sets
it (`ci.yml:167-168`) — while GitHub's Windows runners **are** elevated. The `@admin` suite is therefore
excluded from the only runner that could execute it, and `admin.ts`'s docblock asserts the opposite of
what `ci.yml:157-158` does.

**MUST**: a CI step running the admin subset **on the elevated runner**, with
`THRONG_E2E_INCLUDE_ADMIN=1` and `--grep @admin` directly — **not** `npm run test:e2e:admin`, which
exists to hop UAC from a non-elevated shell (`scripts/test-e2e-admin.mjs:20-24`) and is pointless where
the process is already elevated. The step **MUST fail on zero executed tests**: Playwright exits 0 on an
empty selection, which is exactly how this hole stayed invisible (SC-008 measures *executed > 0*).
Correct `admin.ts`'s docblock — which is the **false** one (`:49`, *"CI runs non-elevated so these still
execute there"*) — and refresh `ci.yml`'s comment (`:157-160`), which is **accurate today** and only
goes stale *because* this step lands. See T031: two comments, two different reasons.
