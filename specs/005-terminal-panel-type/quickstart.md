# Quickstart: Typed Panels — Terminal Panel Type

A phased validation guide. Each phase is built test-first (RGR) and **shipped only when its E2E is green**
(constitution v3.4.0). Verify each phase in the running app before starting the next.

## Prerequisites
- Node 20 LTS, repo bootstrapped (`npm install`). Windows 11.
- At least one shell installed (PowerShell ships with Windows) for Phases B/C.
- Phase C adds native/renderer deps: `npm install` after they land (node-pty builds for **plain Node 20**
  — no electron-rebuild).

## Run the app
```powershell
npm start         # builds, then starts daemon + UI (concurrently)
```
For terminals (Phase C) the UI also **spawns the daemon itself if the pipe is absent**; `npm start`'s
daemon is simply reused when present.

## Test commands
```powershell
npm run test:unit         # core: registry, validation/lock, flavour-merge, defaults, launch-spec, confine, idle/busy
npm run test:integration  # IShellDetection + IPtyHost contract suites; daemon terminal service over the pipe; daemon spawn/single-instance
npm run test:contract     # OS-impl contract suites (shell detection, pty host)
npm run test:e2e          # Playwright-Electron, per phase (see below)
```

---

## Phase A — Panel type UI  (verify point 1)
**Goal**: the form replaces "Empty Panel"; type is selectable, validated, and **locked on Confirm**.

1. Open a project, add a Panel. Its body shows a **type-selection form** (Panel-Type dropdown +
   Confirm/Clear), **not** "Empty Panel".
2. Select **Terminal** → the **Flavour** + **Startup Params** inputs appear (flavour list is a stub this
   phase). Switching type swaps inputs.
3. **Clear** → form resets to empty. **Confirm** with a valid selection → the type is applied; the
   Panel-Type control is gone (cannot change type).
4. Reload / reopen the project → the Panel returns **as its confirmed type** (config persisted in the
   layout blob).

**E2E**: `panel-type-form.e2e.ts` — render-instead-of-placeholder, input-swap, Clear reset, Confirm lock,
persistence across reload.

---

## Phase B — Settings & flavour detection  (verify point 2)
**Goal**: the Flavour dropdown is real (machine + user-defined) with sensible default params.

1. Add a Panel → Terminal. The **Flavour** dropdown lists shells **detected on this machine**
   (PowerShell, CMD, Git Bash if installed).
2. Pick a flavour → **Startup Params** pre-fills its default (e.g. PowerShell `-NoLogo`); changing flavour
   updates the default.
3. Add a user flavour to `%USERPROFILE%\.throng\settings.json` under `terminals.flavours`
   (e.g. a WSL entry) → it appears in the dropdown (hot-reload, no restart).
4. Still **no terminal launches** — Confirm just records the choice.

**E2E**: `terminal-flavours.e2e.ts` — dropdown populated from detection, default-params fill/update,
user-defined flavour appears.

---

## Phase C — Terminal & backing daemon  (verify point 3)
**Goal**: a live, persistent, inline terminal rooted at the project.

1. Add a Panel → Terminal → pick a flavour → **Confirm**. A live terminal appears inline; type
   `pwd`/`cd` → its working directory **is the project root**.
2. Run a command that prints output → streams into the panel. Run a long-running process.
3. **Close the whole app, reopen it** → the terminal is **still running** and **reattaches live with
   scrollback** (the daemon outlived the UI).
4. An **idle** terminal (no running process) is **recreated cold** at the project root on reopen.
5. Close the app while a process runs → the **three-choice prompt** (leave running / terminate / cancel)
   appears.
6. Kill a running process unexpectedly → the panel shows its **exit code + output** (no silent blank).
7. Confirm the terminal **starts** at the project root. *(cwd-confinement is WON'T FIX — `cd ..` is NOT
   blocked; the root lock in step 11 is the shipped guard-rail. See FR-016.)*
8. Destroy a running Terminal Panel → the existing running-process confirmation appears; on confirm the
   PTY is terminated.
9. **Revert-to-form (FR-020)**: in a terminal, type `exit` (or let a command crash) → the Panel shows the
   exit code/output and **returns to the type-selection form**; pick Terminal again (or a different type)
   and Confirm → a fresh terminal/content starts.
10. **Mirror (FR-021)**: sync a Terminal Panel into a sub-workspace → both windows show the **same**
    session; type in one, see it in both; output appears in both.
11. **Root lock (FR-022)**: with a terminal open in a project, try to **delete or rename the project's root
    folder** in OS Explorer → the OS refuses; try to **change the project's root path** in the app → blocked.
    Close all terminals in that project → the folder can be deleted/renamed and the root edited again.

**E2E**: `terminal.e2e.ts` — live echo, cwd=root, unexpected-exit surfacing, destroy-kills-PTY;
`terminal-persistence.e2e.ts` — **survive app close→reopen reattach + scrollback**, idle cold-respawn,
app-close three-choice; `terminal-revert.e2e.ts` — exit → form returns → re-type; `terminal-mirror.e2e.ts`
— synced panel mirrors one session; `terminal-root-lock.e2e.ts` — root undeletable + root-edit blocked
while open. *(There is no cd-confinement E2E — cwd-confinement is WON'T FIX, FR-016; `confine.ts` is a
no-op stub. The root-lock E2E is the shipped guard-rail.)*

---

## Done / acceptance
- All four test layers green; each phase's E2E observed passing before the next began.
- Spec Success Criteria SC-001..SC-011 demonstrably met.
- SQLite remains at `user_version 6` (no migration); `@throng/core` stays OS/DOM-free (guard passes).

## Finalisation validation (2026-07-02) — resource hygiene, elevation respawn, dedicated E2E

Run alongside the A→G checks. Confirms the finalisation pass (constitution v3.8.0, Principle III).

- [ ] **No orphaned processes.** Open a terminal of each detected flavour; end it three ways — destroy the
  Panel, delete its project, and app-close → "Terminate all". After each, Task Manager shows **no leftover
  `conhost.exe` / shell** under the throng daemon. Also type `exit` in a terminal (natural exit) → no
  leftover. Automated by `packages/ui/tests/e2e/terminal-no-orphans.e2e.ts`.
- [ ] **Daemon shutdown reaps.** With terminals open, quit the app choosing "Terminate all" (or stop the
  daemon) → every `conhost.exe` is gone; no orphaned de-elevation agent lingers.
- [ ] **Elevated-daemon respawn (FR-025b).** With a normal daemon already running, launch throng elevated
  (`npm run start:admin`) → it retires the medium daemon and respawns elevated; the ADMIN pill + enabled
  "run as admin" become available. Automated seam: `daemon-elevated-respawn.test.ts`.
- [ ] **Revert / mirror / root-lock / restore-flavour.** `exit` reverts a terminal Panel to the form with
  exit info, then re-types (FR-020); a Panel synced into a sub-workspace mirrors one session across windows
  (FR-021); while a terminal is open the project root can't be deleted or its path edited, and can once it
  closes (FR-022); a Panel whose saved flavour was removed shows unavailability on restore, not a blank
  terminal (FR-019). Automated: `terminal-revert/-mirror/-root-lock/-persistence.e2e.ts`.
- [ ] **Root confinement is intentionally absent.** A terminal starts at the project root but `cd ..` is
  allowed (WON'T FIX — a live shell can't be caged); only the root **lock** above is guaranteed.
