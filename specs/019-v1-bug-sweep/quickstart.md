# Quickstart: Validating Feature 019

**Feature**: 019 | **Date**: 2026-07-16

How to prove all six fixes — by machine first, because the machine already knows the answer, then by
hand for the two things no test in this repository can currently see.

## Prerequisites

```bash
npm install            # a fresh worktree cannot resolve @throng/* until this runs (junctions, no lock change)
npm run build          # REQUIRED before E2E: the suite launches packages/ui/dist/main/main.js
```

## The baseline you must reproduce first

Before changing a line, prove the bar is where the spec says it is. **1500 pass, 8 fail, and all 8 are
this feature's guards.**

```bash
npm run lint           # ZERO errors (constitution v3.13.0 — a lint error is a build failure)
npm run typecheck      # tsc -b now covers the renderer too (87e28a9)
npm test 2>&1 | tee 019-baseline.log           # capture ONCE, unfiltered (constitution v3.14.0)
# Capture to a `*.log` at the REPO ROOT, which .gitignore already covers — not to `/tmp`, which on this
# Windows-first repo resolves inside the Git-Bash root, nowhere near the worktree. T063 deletes them.
```

Expect exactly these red:

| File | RED | Green guards in the same file |
|---|---|---|
| `packages/core/tests/unit/theme-syntax-body-contrast.test.ts` | 4 | 16 (the measured 150 + the token list) |
| `packages/core/tests/unit/settings-open-on-click-single-owner.test.ts` | 2 | — |
| `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts` | 2 | — |

E2E is a separate run (and see [the CI caveat](#the-caveat-you-must-not-skip-past)):

```bash
THRONG_E2E_RETRIES=0 npx playwright test editor-move-repoint.e2e.ts terminate-all-drain.e2e.ts preferences-terminal-flavours.e2e.ts 2>&1 | tee 019-e2e-baseline.log
# expect: #87 6 RED + AC7 green · #86 2 RED + 2 green · #67 4 RED
```

Parse the captured file as many times as you like. **Do not re-run a suite to learn what it already
said.**

---

## Proving each fix

### #83 — the derived contrast guard (do this first: pure, fast, no app)

```bash
npx vitest run packages/core/tests/unit/theme-syntax-body-contrast.test.ts
```

Then prove the **derivation**, which is the actual requirement — a hand list would pass the tests above
and still be the bug:

```bash
# Add a token nobody measured, to the canonical theme. The suite must go RED with NO test edited.
# packages/core/src/config/theme.ts → THRONG_THEME.colours: syntaxDecorator: '#0d1017'
npx vitest run packages/core/tests/unit/theme-syntax-body-contrast.test.ts    # MUST fail
git checkout packages/core/src/config/theme.ts
```

If that passes, the list is still hand-written somewhere and FR-026 is unmet.

### #95 — one owner per behaviour

```bash
npx vitest run packages/core/tests/unit/settings-open-on-click-single-owner.test.ts
```

By hand — the part the guard cannot see (that the survivor is **findable**):

1. Launch throng, open Preferences → Settings.
2. **File Explorer** group shows *"Open files with"*. There is **no** second open-on-click control
   anywhere (C2/FR-021).
3. Set it to `double`. A single click in the tree now only **selects**; a double click opens.
4. Set it to `none`. Neither click opens; Enter and *Open In* still do (FR-024 keeps `none` available).
5. Put `"explorer": { "openMode": "double" }` into `%USERPROFILE%\.throng\settings.json` by hand.
   Relaunch. Behaviour is **unchanged** (single-click), no warning appears, and the key is **stripped**
   on the next write from the editor (C1/FR-023). That is the whole of C1: the user's *current
   experience* is preserved exactly, because the key never had one.

### #94 — a terminal that cannot start says so

```bash
npx vitest run packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts
# ~40s: each scenario deliberately waits past the 15s budget + grace
```

Then the half no CI has ever run. **Do this before believing #94 is fixed** — the fail-fast path is the
safety net, not the outcome (FR-014):

```powershell
# From an ELEVATED PowerShell. The budgets are NOT optional (C27): the test's own LAUNCH_BUDGET_MS is
# 25s (terminal-de-elevation-hang.e2e.ts:33), while the production worst case is connect 15s + ready
# 15s = 30s — so a connect at ~14s followed by no ack surfaces at ~29s and is reported as "it hung
# (#94)", the very failure the test exists to detect. 8000/8000 makes the worst case 16s.
# REQUIRES T031a: `Start-Process -Verb RunAs` inherits NO environment, so without it these never
# arrive and the run is silently back at 15/15.
$env:THRONG_AGENT_CONNECT_TIMEOUT_MS='8000'; $env:THRONG_AGENT_READY_TIMEOUT_MS='8000'
npm run test:e2e:admin -- terminal-de-elevation-hang.e2e.ts
```

Three outcomes, and only one of them is done:

| Result | Meaning |
|---|---|
| a working non-elevated prompt (cwd marker in the terminal) | **FR-014 met.** Ship. |
| a visible `[throng] …` error within **~16s** (the injected budget; ~30s at production defaults) | FR-012 met, **FR-014 unmet**. De-elevation is genuinely broken. The captured shim reason (FR-015) now says *why* — attach it to a new issue and ship the bounded failure as an honest partial. |
| a blank terminal that stays "running" | **#94 is not fixed.** |

Prove the *reason* is real, not a generic message:

```powershell
# Force a launch failure and read the terminal's text — it must name the shim's own error.
# REQUIRES T031a: `Start-Process -Verb RunAs` does NOT inherit the caller's environment, so this var
# only arrives once it is on test-e2e-admin.mjs's `forwarded` allow-list. Without it the run silently
# uses the 15s default and proves nothing — the same trap the script's docblock records for RETRIES.
$env:THRONG_AGENT_CONNECT_TIMEOUT_MS='2000'; npm run test:e2e:admin -- terminal-de-elevation-hang.e2e.ts
```

And prove a slow shell is **not** killed (US3 AC4 — readiness is the `started` ack, never first output).
**Not with `terminal-slow-start.e2e.ts`**, which cannot fail for this reason: its env is hard-coded at
`:70` (so a shell prefix does nothing), it calls `skipIfElevated()`, and a non-elevated daemon routes
terminals to `NodePtyHost` — `PtyAgentHost`, and therefore the readiness budget, is **never in the
path**. It would report a green pass on an untested mechanism. The proof is T034's scenario in the
elevation-free integration test, which drives `PtyAgentHost` directly and runs in CI:

```bash
# T034: a server that acks `started` then goes silent past the budget must NOT be killed.
npx vitest run packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts

# Still worth running as an unchanged NEIGHBOUR — it guards the "still starting" retry, a real
# but different thing. THRONG_FORCE_PTY_AGENT=1 is the hook if you want the E2E-level version.
npx playwright test terminal-slow-start.e2e.ts
```

### #87 — a moved file takes its editor with it

```bash
THRONG_E2E_RETRIES=0 npx playwright test editor-move-repoint.e2e.ts
# 6 RED → green; AC7 was green and MUST STILL BE GREEN
```

By hand, because AC7 is the one that matters and the one a fix is most likely to break:

1. Open a file into an editor. Confirm **no** unsaved dot.
2. Cut it in the tree, paste it into another folder. The header pill shows the **new** path; **no**
   dot appears; no notice.
3. Type something, Ctrl+S. The text lands at the **new** path, and **nothing** is re-created at the old
   one. *(This is the data loss: today the dot invites the save and the save undoes the move.)*
4. Click the file at its new path in the tree → the **existing** editor focuses. No second buffer.
5. Move the file **from Windows Explorer**, behind throng's back. The buffer stays, goes **dirty**, and
   Ctrl+S re-creates it at the **old** path. **That is correct** (FR-009). If step 5 went quiet, the fix
   swept away the behaviour AC7 guards.
6. Move a **folder** containing two open files. Both editors re-point.
7. Restart. The panels reopen on the **moved** paths — the persisted layout followed (FR-008).

### #86 — closing throng keeps the layout you were looking at

```bash
THRONG_E2E_RETRIES=0 npx playwright test terminate-all-drain.e2e.ts
# 2 RED → green; the 2 terminate-all tests were green and MUST STILL BE GREEN
```

By hand, both exits — the point is that they now agree by construction rather than by timing:

1. Split a panel (or zoom one with `Ctrl+Alt+=` twice), then close **immediately** with **no terminals
   running**. Relaunch: the change is there.
2. Same, but with a terminal running: close, answer **Terminate all**. Relaunch: the change is there.
3. Prove the drain is **awaited**, not raced:
   ```bash
   THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS=1 npm start   # a 1ms budget: the drain cannot complete
   ```
   Make a layout change, close immediately, relaunch — the change should be **lost**, and the main log
   should say the drain budget lapsed. If it survives, the write is landing by luck and the test is
   passing for the wrong reason.
4. **Sub-workspaces (C6)**: tear a Tab off into a sub-workspace, rearrange panels **in the
   sub-workspace**, close the **main** window (which closes the group). Relaunch: the sub-workspace's
   arrangement survived too.
5. **The preferences window (C19–C23)**: open Preferences on the **Themes** tab, change a colour, and
   close the **main** window **within ~150ms** so the preferences window goes down with its **Electron parent** (`preferences-window.ts:67`) — it is NOT in `WindowManager`'s `registerChild` cascade, which carries sub-workspace windows only (`main.ts:723`).
   Relaunch: the colour survived. `workspace.save` is **not** the only deferred write, and the drain
   covers every config write — `void`-dropped **or awaited** — because it settles the write **module**
   rather than a list of writers (C22–C26; the tallies earlier drafts asserted were all wrong and are
   struck, C24). Only **one** preferences write can be pending
   at a time in the **UI** tabs **as the code stands today** — the window renders a single tab and
   switching tabs flushes the previous one (C20) — so do not try to stage a settings edit and a theme
   edit together; that state is unreachable. **That is an observation about staging this check, not a
   shipped property**: T017a deletes both unmount cleanups and moves the theme debounce into the module
   registry, where an armed timer survives unmount. C22 is what makes that harmless — the drain settles
   the module either way. Do not rely on it: the drain settles the **write module**, not a list of tabs
   (**C22**), because counting them was wrong every time it was tried (C24 — nobody counts) — the **JSON tab** is re-rendered
   with a new `docId` rather than unmounted on a tab switch, orphaning an armed 300ms timer that still
   writes, and **KeybindingsTab** writes undebounced and was omitted from every earlier draft.
6. **The workspace window settles config writes too (C23)** — the drain is **unconditional**, not
   preferences-only. **Create** a project and pick a root folder, then close immediately; relaunch and
   confirm **"+ New" starts at that folder**. That is `persistLastProjectFolder`
   (`projects-panel.tsx:205-209` → `writeConfig({kind:'settings'}, …)`, undebounced, `void`-dropped,
   011 FR-040), reached **only** from project creation (`:333`) — and `ProjectsPanel` is rendered by
   `app.tsx:493`, in the **workspace** window. An earlier draft gated the config drain on "a preferences
   window" and would have acked with this write in flight.
   **Do not use a project *rename* to prove this** — an earlier draft of this step did, and it is an
   **inert proof**: rename calls `updateProject` → `client.update` (`projects-store.tsx:145`), an
   **awaited** daemon/SQLite IPC that touches `writeConfig` not at all. It passes identically whether or
   not the workspace window settles config writes. T015c is the machine version of this step.

### #67 — the flavour settings can actually be edited

```bash
THRONG_E2E_RETRIES=0 npx playwright test preferences-terminal-flavours.e2e.ts
```

By hand:

1. Preferences → Settings → **Terminals**.
2. *Hidden built-in flavours* is a **picker** over the built-ins this machine actually has — no text
   box. Tick **Command Prompt**; it disappears from a new panel's Flavour dropdown.
3. Look again: it is **still offered, and ticked**. Untick it; it returns. *(Hiding is not a one-way
   door — FR-017.)*
4. *Custom terminal flavours* is a **table**, one row per flavour, a cell per field — **including when
   it is empty**. Not JSON, in any state (FR-018).
5. Add a flavour with no id → refused, and the message says **id**. Add one duplicating an existing id →
   refused, message says **already**. Add a valid id with no executable → the message says
   **executable**.
6. Fill in `file`, open a Terminal panel: the new flavour is in the dropdown and launches.
7. **C14, the incidental fix**: *Default flavour parameters* now has a usable **text** cell. It rendered
   an empty `<select>` before this feature and had no test coverage at all.

---

## The caveat you must not skip past

**Two of the seven test files call `skipIfElevated()`, and GitHub's Windows runners run elevated.**
`editor-move-repoint` and `terminate-all-drain` therefore **self-skip in CI**. A green CI bar
says **nothing** about **#87 or #86**.

**#67 is not one of them** (C18): `preferences-terminal-flavours.e2e.ts` has **no** elevation guard, so
it executes on the elevated runner — its 4 RED fail CI on this branch today, and T046 turning them green
shows up there. It starts no terminal, so `admin.ts`'s elevated-daemon caveat does not apply to it.
*(Every artifact here used to claim "six of the seven"; it was never true — three of the seven are
Vitest suites that cannot call a Playwright skip helper.)*

- Run **#87's and #86's** specs on a **non-elevated** developer machine and put that output in the PR
  evidence. Do not let CI imply coverage it does not have — and do not claim it lacks coverage it does.
- Conversely, the `@admin` de-elevation spec runs **only** elevated, and FR-013a/SC-008 add the CI step
  that finally executes it. Verify the step reports **more than zero** executed tests — Playwright exits
  0 on an empty selection, which is exactly how this hole stayed invisible.

## Definition of done

```bash
npm run lint && npm run typecheck
npm test                                    # ONE full run: 0 fail; the 8 named guards green; EVERY delta from the
                                            # baseline owned by a task here — no floor figure (C24: an
                                            # earlier ">= 1508" was falsified by its own delta list) (this feature ADDS tests — T004,
                                            # T007, T029, T034, T035, T036a add tests; T039/T052 retire assertions;
                                            # T060 deletes 2 (windows-de-elevator.contract) — so an exact figure lies,
                                            # and a lie in a gate gets "fixed" by deleting a test. See T062.
THRONG_E2E_RETRIES=0 npx playwright test    # non-elevated, retries OFF — a retried pass is a flake, not a pass
```

Plus, per the constitution's currency rule (v3.10.0), **in this change**: `README.md` (a settings key is
gone, one moved group), `CONTRIBUTING.md` / `docs/testing.md` (how the `@admin` suite is
now run in CI), and the accepted 400 ms loss under an uncatchable kill (FR-011) written down where a
user can find it.
