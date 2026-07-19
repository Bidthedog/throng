# Phase 0 Research: Application Packaging

**Feature**: 020-application-packaging | **Date**: 2026-07-18 | **Constitution**: v4.0.0

This resolves every technical unknown the spec deferred to planning. Each decision cites the codebase
fact that constrains it (from the recon of the current `master`-tip worktree) and names the alternatives
rejected, so a reviewer can see the fork and disagree with the turn taken.

---

## D1. How the daemon's host-Node runtime + native modules ship in a self-contained per-user install (FR-009)

**Decision**: **Bundle a pinned Node.js runtime (`node.exe`) inside the installed application** and spawn
the daemon with that bundled runtime in production. The daemon's native modules (`better-sqlite3`,
`node-pty`, `koffi`) continue to be built against the **host Node ABI** and ship alongside the bundled
`node.exe`, unchanged.

**Rationale**:
- The daemon is *already* spawned with host Node, never Electron, and this is load-bearing:
  `packages/ui/src/main/daemon-lifecycle.ts:160-177` spawns `opts.nodePath ?? npm_node_execpath ?? 'node'`
  precisely because the natives are compiled against the host Node ABI and crash under Electron's Node with
  `NODE_MODULE_VERSION` mismatch ("no electron-rebuild", documented at `:28-34`).
- `opts.nodePath` is **already an injection point** — the spawn honours a caller-supplied node path first.
  Packaging therefore adds a runtime and points `nodePath` at it; it does not rewrite the spawn contract.
- Bundling a runtime keeps the deliberate daemon/host-Node split intact, so nothing about the terminal
  persistence guarantees (Principle III) changes.

**Alternatives rejected**:
- *`electron-rebuild` the natives and run the daemon under Electron's Node* — reverses an explicit,
  documented architectural decision; every native module would need Electron-ABI rebuilds and the daemon
  would run under `process.execPath` (electron.exe), which the code comments call out as the crash path.
  High risk, large blast radius, no benefit over bundling a ~40 MB runtime.
- *Single-binary the daemon (`pkg`/`nexe`)* — these do not reliably carry prebuilt native `.node` addons
  (`better-sqlite3`, `koffi`), which is exactly what the daemon needs.
- *Require the user to install Node* — forbidden by FR-009 ("MUST NOT require the user to have a language
  runtime installed... MUST NOT depend on one being discoverable on the search path").

**Consequence for tasks**: the installed layout carries `resources/runtime/node.exe` (a pinned Node ≥20
matching the ABI the natives were built for) and the daemon dist + its `node_modules` natives. In
production, `main.ts` resolves `nodePath` to the bundled runtime rather than falling through to PATH.

---

## D2. Windows installer format & tooling (FR-007, FR-012, FR-014, FR-015, FR-021, FR-038, FR-040)

**Decision**: **`electron-builder` with the NSIS target, `perMachine: false` (per-user)**, installing to
`%LOCALAPPDATA%\Programs\throng`. Bundle the daemon runtime and dist via `extraResources`. Add a small
custom NSIS include to render the uninstaller's **"also delete my projects and settings" checkbox**
(FR-021), unticked by default.

**Rationale**:
- `electron-builder`'s NSIS target with `perMachine: false` installs **without administrator elevation**
  into the user profile (FR-012, FR-040), creates a Start-menu shortcut, applies the app icon (FR-014),
  and registers in *Programs & Features* for removal (FR-015) — all first-class.
- `extraResources` places the bundled Node runtime + daemon under the single install root (FR-007), and
  nothing is written there at runtime because all state already lives in `%APPDATA%\throng` /
  `%USERPROFILE%\.throng` (FR-008, confirmed: the app writes only to per-user config/data locations).
- NSIS `include`/macros give the control needed for the custom uninstall data-retention checkbox that
  the spec's clarified decision requires; Squirrel (electron-forge default) does not offer a comparable
  uninstall-UI hook.
- The app is already emitted to `packages/ui/dist/main/main.js` with preload + renderer + daemon dist —
  the exact input `electron-builder` packages.

**Alternatives rejected**:
- *electron-forge (Squirrel.Windows)* — per-user, but its uninstall flow is fixed; no place for the
  data-retention checkbox, and `extraResources`/`extraFiles` control is weaker.
- *MSIX / Microsoft Store* — Microsoft re-signs and there is no SmartScreen warning, but it requires a
  Store account/identity and a different distribution channel; explicitly out of scope (spec keeps
  distribution to GitHub Releases). Recorded as knowingly rejected, per the signing clarification note.
- *Hand-rolled `.nsi`* — reinvents what electron-builder already does for an Electron app (asar,
  code-integrity, auto-generated uninstaller, ARP registration).

**Downgrade (FR-016a)**: electron-builder NSIS exposes the installed version; a custom install-time NSIS
check compares the incoming version against the installed one and **aborts a downgrade** with a message
directing the user to uninstall first. The version comparison uses the same ordered scheme as D4.

---

## D3. Per-user IPC endpoint scoping (FR-013)

**Decision**: **Derive the default pipe name from a per-user identity token in a single shared source**
(`packages/core`), e.g. `\\.\pipe\throng.<user-token>.daemon`, and have **both** the daemon composition
root and the UI settings consume that one derivation. The `THRONG_PIPE_NAME` env override stays (tests
depend on it).

**Rationale**:
- Today the literal `\\.\pipe\throng.daemon` is hardcoded **twice** —
  `packages/daemon/src/composition-root.ts:56` and `packages/ui/src/main/ui-settings.ts:10` — and is
  machine-wide, so two users collide (spec edge case; FR-013). A single derived source removes both the
  duplication (DRY, Principle VIII) and the collision.
- The user token must be stable per user and safe in a pipe name. `os.userInfo().username` is available
  cross-process and sufficient on Windows; the account **SID** is the more collision-proof choice and is
  obtained behind the Principle II OS abstraction. Decision: derive from the SID via the platform
  abstraction, falling back to a sanitised username, in one `core` function both boundaries call.
- Keeping the value flowing through the existing `IDaemonSettings.pipeName` / `IUiSettings.pipeName`
  injected settings preserves Principle X (externalised, injected config) — only the *default* changes
  from a constant to a derivation.

**Alternatives rejected**:
- *Keep the env override as the only per-user mechanism* — the default still collides; tests set the env,
  real installs do not.
- *Per-install random pipe written to a file* — adds a shared-state file and a bootstrap ordering problem
  (the UI must discover the daemon's pipe); a deterministic per-user derivation needs no rendezvous file.

**Testing**: a contract test asserts the daemon-side and UI-side derivations produce the **same** pipe
name for the same user and **different** names for different user tokens.

---

## D4. Single-source product version wiring (FR-001, FR-002, FR-004, FR-005, FR-006)

**Decision**: The **root `package.json` `version`** is the single authoritative product version (SemVer,
FR-002 — ordered and comparable). Electron's `app.getVersion()` returns it for the main process at no
cost. A **build step generates a `version` constant** for the daemon (mirroring the existing `BUILD_ID`
stamp) and the renderer receives the version via the existing preload/IPC bridge. A **guard test** asserts
every surface reports the root version and that no component declares its own. The content-hash `BUILD_ID`
stays **separate and unchanged** (FR-006).

**Rationale**:
- `package.json` `version` is already the only version string in the repo (`0.0.0`), and Electron reads it
  automatically — so the main process needs no new plumbing (FR-001/003).
- The daemon does not read `package.json` at runtime today; a generated `version` file written next to
  `BUILD_ID` at build time is the established pattern (`scripts/stamp-build.mjs`) and keeps the daemon
  self-describing (FR-004).
- The renderer already has a preload bridge (used for preferences/version-style data); exposing the
  version through it avoids a second source (FR-005).
- `BUILD_ID` and product version answer different questions (stale-code detection vs. release identity);
  the spec (FR-006) requires they stay distinct — the stamp script already isolates `BUILD_ID`.

**Alternatives rejected**:
- *A hand-maintained `version.ts` constant* — a second source that can disagree with `package.json`
  (violates FR-001/005).
- *Derive the version from git tags at build* — the spec's assumption is a deliberately bumped version, not
  a commit-derived one; and tag-derivation would not work in a fresh checkout without tags.

**Bump mechanism (FR-005)**: changing the version is a single edit to the root `package.json` `version`;
the build regenerates the daemon constant and the packaged installer name/metadata from it. A guard test
fails the build if any workspace `package.json` version disagrees with the root (they are all `0.0.0`
today and move together to `1.0.0`).

---

## D5. The "About throng" surface (FR-003, FR-003a)

**Decision**: **Build a minimal native application menu** carrying a **Help → About throng** item (the app
currently sets no menu), which opens an **app-modal About window** following the established
**preferences-window pattern**. The About renderer surface shows the product version and `BUILD_ID` as
**selectable text**, a copyright notice, a licence link, and the **full AGPL-3.0 licence text in a
read-only scrollable region**.

**Rationale**:
- FR-003 pins the entry point to "the application menu". The app deliberately removed the native menu
  (`packages/ui/src/main/main.ts:277`, `Menu.setApplicationMenu(null)`) because "no application commands
  exist in the bootstrap"; the About command is the first such command, so a minimal application menu is
  the spec-directed home for it. When the planned in-window menu lands later it can also host About.
- The **preferences window** (`packages/ui/src/main/preferences-window.ts`) is the exact precedent for an
  app-modal, parented, frameless `BrowserWindow` that loads `index.html` with a query
  (`?prefs=`); About mirrors it as `index.html?about=1`. Reuses the composition root, preload, and
  window-parenting discipline already in place.
- The full licence text travels with the app because AGPL-3.0 requires it; the About dialog is where a
  running copy surfaces it (FR-003a). The licence text ships as a bundled asset read at build/runtime, not
  duplicated in code.

**Alternatives rejected**:
- *An in-window title-bar affordance with no native menu* — contradicts FR-003's "application menu" wording
  pinned in clarification.
- *Electron's built-in `role: 'about'` panel* — not themeable, cannot host the scrollable full-licence
  region or selectable build id; the spec needs a custom surface.

**Testing (Principle V)**: the About dialog is a user-facing UI surface, so it ships with a Playwright
`_electron.launch` E2E following `packages/ui/tests/e2e/context-menu.e2e.ts` — open the menu, open About,
assert the version/build-id/licence are present and the version matches `app.getVersion()`.

---

## D6. Installer verification on a clean environment (US4, FR-023–FR-027, FR-024a)

**Decision**: A **CI job on a clean `windows-latest` runner** that builds the installer, installs it
silently per-user (`installer.exe /S`), launches the app, asserts the reported version equals the expected
version, exercises one **core journey** (create a project + spawn a terminal — the US2 independent test),
uninstalls silently, and asserts **no residual component or process**. The machine-readable **verdict** is
bound to the exact package (version + installer SHA-256) and published as a CI artifact/check (FR-026); an
**absent verdict is treated as failure** (FR-027). Verification also confirms the published **checksum
matches the artifact bytes** (FR-024a).

**Rationale**:
- A fresh CI runner *is* the "clean environment provisioned per run" the spec assumes — no developer state
  to leak a false pass.
- The residue check is process-level and filesystem-level (no `throng` process, no install-root files
  after uninstall), matching Principle III's resource-hygiene rule and SC-004.
- The verdict binds to `{version, installerSha256}` so a sign-off/verification cannot be mistaken for a
  different build (FR-030 analogue for verification).

**What is authored vs. what only runs in CI**: the **verification logic** (version assertion, residue
scan, checksum match) is a script with unit tests; the **end-to-end run** (actually building an NSIS
installer and installing it) executes on the CI runner, not inside this planning/implementation session.
This is called out in Complexity Tracking as an incremental-delivery boundary, not a gap.

---

## D7. Gated publication to GitHub Releases (US5, FR-028–FR-037) + checksum (FR-042, FR-042a, FR-043)

**Decision**: A **`release` workflow** (triggered by `workflow_dispatch`/a version tag on the reviewed
default branch) gated on three conditions with **no override path**:
1. **Real version** — refuse a placeholder/`0.0.0` version (FR-028a, FR-033).
2. **Verification passed** — the release job `needs:` the verification job (D6); a red verdict blocks it
   (FR-028b).
3. **Human QA sign-off** — a **GitHub Environment (`release`) with required reviewers**, so publication
   pauses for an explicit human approval that cannot be satisfied by automation, a default, or elapsed
   time (FR-028c, FR-029, FR-030).

The job **computes the installer's SHA-256 as the last step that reads its bytes** (FR-042a), creates a
GitHub Release for the version carrying the installer **and its checksum in the release notes** (FR-032,
FR-042), embeds the **source revision** (FR-035), **refuses a re-publish** of an existing version
(FR-034), and requires **no manual artifact handling** (FR-036). Running it from anywhere but the reviewed
branch/CI is prevented by the environment + branch protection (FR-037). Release notes state the unsigned
warning and how to verify against the checksum (FR-043).

**Rationale**:
- GitHub **Environments with required reviewers** are the native, non-bypassable "human sign-off gate" —
  exactly the "explicit act by a person, not automatable, not defaultable" the spec demands (FR-029).
- Computing the checksum as the final byte-reading step guarantees the checksum and artifact cannot drift
  (FR-042a); publishing it in the notes beside the artifact is the integrity contract (FR-042).
- Refusing re-publish preserves the immutability the traceability of US1 depends on (FR-034).

**Alternatives rejected**:
- *A label or file as the "QA sign-off"* — a label can be added by automation or a bot; it is not the
  explicit human act FR-029 requires. The Environment reviewer gate is.
- *Signing for identity* — dropped by clarification; replaced by the checksum (FR-042). Recorded, not
  re-litigated.

**What is authored vs. what only runs in CI**: the workflow, the gate-evaluation logic (version-real
check, re-publish refusal, checksum generation) are authored and unit-tested; the **actual GitHub Release
publish** executes only when the workflow runs against a real tag with a real approver — it is not
exercised in this session, and the final report says so plainly.

---

## Cross-cutting: test layers (Principle V) the tasks must target

Confirmed from the repo: **vitest projects** `unit` / `integration` / `contract` (contract is a
runner sub-suite of integration) and a **Playwright `e2e`** layer (`packages/ui/tests/e2e/**/*.e2e.ts`,
launched via `_electron.launch`). Gates: `npm run lint`, `npm run typecheck`, `npm run test:unit|integration|contract`,
`npm run test:e2e`. `@admin`-tagged E2E is elevation-gated (and, per repo memory, CI runners run elevated,
so `skipIfElevated()` specs never run in CI — relevant if any packaging behaviour is elevation-sensitive;
none here is, since the install is deliberately per-user/no-admin). Tasks are shaped to these exact layers:
pure logic (version derivation, pipe derivation, checksum, gate evaluation, residue scan) → unit/contract;
IPC/version-surfacing → integration; the About dialog → E2E.
