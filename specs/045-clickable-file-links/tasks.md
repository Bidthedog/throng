# Tasks: Clickable File Links

**Feature**: 045 | **Branch**: `feature/S045-I198-I394-terminal-and-file-links` | **Date**: 2026-09-18

**Input**: [spec.md](./spec.md) (64 FRs, 7 stories, 11 SCs), [plan.md](./plan.md),
[research.md](./research.md) (R1–R16, O1–O6), [data-model.md](./data-model.md),
[quickstart.md](./quickstart.md), [contracts/](./contracts/) ×4.

**Tests**: REQUIRED and test-first. Principle V is NON-NEGOTIABLE and the spec's own *Assumptions*
name the layer for each property. Every implementation task below is preceded by the test task that
proves it, at the layer [plan.md](./plan.md) *Testing strategy* assigned — and no higher.

**E2E**: **zero new declarations.** Two existing declarations gain cases (Phase 11).
`packages/ui/tests/e2e/e2e-budget.json` reads `"total": 570`, `"@terminal": 107` **before and
after** (R15). A task that adds a `test(` declaration is out of scope for this feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — a different file from every other in-flight task, with no unmet dependency.
- **[Story]**: US1–US7, on user-story phase tasks only.
- **RED**: a test task. It must be run and observed FAILING before the GREEN task that follows it.
- Every task names exact paths and the FR ids it satisfies.

## Layer key

`unit(core)` node · `unit(ui)` node · `component` jsdom · `integration` serial, real FS/shell ·
`contract` port suites · `e2e` Playwright-on-Electron. **Never run a full E2E suite to find out
whether something works** — load the **running-tests** and **throng-testing** skills first.

---

## Phase 1: Setup & spec amendments

**Purpose**: the fixture tree every later layer reads from, and the four spec problems
[plan.md](./plan.md) *Reported to the maintainer* raised. Each is written as an **amendment** naming
what it replaces — never a silent contradiction (CLAUDE.md, *Before you add a requirement*).

- [x] T001 [P] Create the fixture tree in `packages/ui/tests/fixtures/links/` exactly as
  [quickstart.md](./quickstart.md) §2 lists it — `test.txt`, `src/foo.ts` (≥ 100 lines so `:42:7` is
  inside it), `docs/a.md` (naming `./b.md`, `packages/core/x.ts`, `src/foo.ts:10`), `docs/b.md`,
  `docs/My File.md`, `packages/core/src/x.ts`, `README.md`, `setup.exe`, `build.bat`, `deploy.ps1`,
  `shortcut.lnk`, `prose.txt` — plus `packages/ui/tests/fixtures/links-outside/elsewhere.txt` for the
  out-of-project cases. The four executable fixtures are inert placeholder bytes and **no test ever
  runs one**; only their extensions are under test. Satisfies SC-001, SC-003, SC-007, SC-010.
- [x] T002 [P] Amend `specs/045-clickable-file-links/spec.md` **FR-031** with the FR-031/FR-046
  resolution: Open Link shows the Open Link chord **where one is bound**, so in a terminal — where
  FR-046 binds none — it shows no chord. Cite constitution Principle VI (*One gesture follows a
  link*) as the authority and R10(b) as the derivation. This is a clarification of FR-031, not a
  supersession: neither FR changes meaning. Satisfies FR-031, FR-046.
- [x] T003 [P] Amend the *Assumptions* bullet in `specs/045-clickable-file-links/spec.md` that reads
  "the hover tooltip's wording for file links matches the wording web links use". The shipped wording
  is `Ctrl+Click to open in system browser` (`packages/ui/src/renderer/terminal/use-terminal.ts:311`)
  and is false for `src/foo.ts`. Restate it as: the file-link tooltip matches the **shape** and the
  **delay** (`terminals.linkHoverDelayMs`) of the web-link tooltip and names the gesture — FR-042's
  actual requirement — with the destination wording differing by link kind (R10a). Satisfies FR-042.
- [x] T004 [P] Amend `specs/045-clickable-file-links/spec.md` with **FR-035a**, under *Link targets
  and the link menu*: Open in OS Explorer for a file link is carried by a **third** reveal policy,
  `throng:links:reveal`, confined by FR-037's re-resolution rather than by a path prefix
  (`throng:files:reveal`) or the open-document registry (`throng:files:revealDocument`,
  `packages/ui/src/main/files-service.ts:518-528`, which refuses a path no panel has open and
  therefore cannot serve FR-030). State that neither existing confinement is loosened, and that
  the repo now has three reveal policies. Satisfies FR-030, FR-035, FR-037; R8;
  [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3.
- [x] T005 [P] Amend **FR-091** in `specs/045-clickable-file-links/spec.md`: its premise is already
  stale. 044 shipped `preview.followLink` bound to Ctrl+Enter
  (`packages/core/src/config/keybindings.ts:408`, dispatched at
  `packages/ui/src/renderer/preview/preview-commands.tsx:162-167`), so constitution Principle VI's
  *Known gaps* sentence is wrong **today**, before this feature changes anything. Restate FR-091 as
  correcting **two** statements — that no surface implements Ctrl+Enter (044 does) and that editors
  do not (045 will) — and require the amendment's SYNC IMPACT REPORT to record what it found rather
  than restating the premise. Satisfies FR-091; R16.
- [x] T006 [P] Fix the dangling reference in `specs/045-clickable-file-links/data-model.md` — its
  preamble points at `contracts/link-ipc.md`, which does not exist. The channel payloads are in
  [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3. Artifact
  consistency only; no FR.
- [x] T007 Add a **Clarifications** session dated 2026-09-18 to
  `specs/045-clickable-file-links/spec.md` recording T002–T005 as decisions taken during planning,
  each with its question and its answer, per the repo's clarification-recording rule. Depends on
  T002, T003, T004, T005.

**Checkpoint**: the spec no longer contains a contradiction an implementer would resolve the wrong
way, and every fixture the later layers read exists.

---

## Phase 2: Foundational — the grammar, the decisions, the ports, the settings, the chord

**Purpose**: everything pure, and everything a surface consumes. **No user story starts until this
phase is green** ([plan.md](./plan.md) *Sequencing* step 1).

**⚠️ CRITICAL**: `packages/core/src/links/**` may name **no** operating system, extension or drive
mapping (FR-026, FR-039a). T022 fails the build on one.

### 2a. The grammar and the decisions — `packages/core/src/links/`

- [x] T008 [P] RED unit(core) `packages/core/tests/unit/link-detect.test.ts` — D1–D8 of
  [contracts/link-resolution.md](./contracts/link-resolution.md) §1: every form in FR-003a–f without
  markup; FR-004's three position forms with `text` never carrying the position; FR-005's trailing
  punctuation, unbalanced brackets and matching-quote rules; D2 (a span overlapping a `claimed`
  range yields nothing); D7/D8 totality and purity; **SC-003 — every line of
  `packages/ui/tests/fixtures/links/prose.txt` yields zero candidates**; and the ambiguity rule,
  `C:\x\foo.ts:42:7` yielding two candidates with the positioned reading FIRST. Satisfies FR-003,
  FR-004, FR-005, FR-009, FR-010, SC-003.
- [x] T009 Implement `packages/core/src/links/types.ts` (`LinkCandidate`, `LinkPosition`, `Span`,
  `LinkResolutionRequest`, `ResolvedLink`, `LinkResolution`) and
  `packages/core/src/links/detect.ts` (`detectPathCandidates`) to turn T008 green.
  Satisfies FR-003 – FR-005, FR-009, FR-020.
- [x] T010 [P] RED unit(core) `packages/core/tests/unit/link-classify.test.ts` —
  `classifyTerminalLinkTarget(uri)` answers `'web'` for `http(s)`, `'file'` for `file:`, `'inert'`
  for `javascript:`, `data:`, `mailto:` and any unknown scheme, case-insensitively on the scheme.
  Satisfies FR-009, FR-011, FR-013; R5.
- [x] T011 Implement `packages/core/src/links/classify.ts` — the ONE scheme gate that replaces the
  three duplicated `^https?://` tests at `use-terminal.ts:29`, `:369` and
  `core/src/terminal/link-menu.ts` (site 1, `terminal-url.ts`'s `TERMINAL_URL_REGEX`, stays a text
  scanner and is NOT touched). Satisfies FR-009, FR-013; Principle VIII.
- [x] T012 [P] RED unit(core) `packages/core/tests/unit/link-resolve.test.ts` — R1–R11 of
  [contracts/link-resolution.md](./contracts/link-resolution.md) §2 against a **fake `IPathForms`**
  and an injected `exists` predicate: ordered candidate paths, first-that-exists wins, R5's
  base-directory-before-project-root (US1 scenario 8), R6's **project-root-before-platform** for a
  leading `/` (#394's `/test.txt`), R7's positioned-reading-first ambiguity
  (`C:\x\foo.ts:42:7`), R8's `file:` decoding, R9's no-WSL-mapping, R10's untitled buffer, R11's
  `projectRoot === null`. Satisfies FR-020, FR-022 – FR-026, FR-012.
- [x] T013 Implement `packages/core/src/links/resolve.ts` (`resolveCandidate`) to turn T012 green.
  It returns an ordered list and touches no disk. Satisfies FR-020, FR-022 – FR-026.
- [x] T014 [P] RED unit(core) `packages/core/tests/unit/link-membership.test.ts` — M1–M6 of
  [contracts/link-resolution.md](./contracts/link-resolution.md) §3: `inProject` from the **resolved**
  path (M1), the same answer for all five spellings of one file (M2, US1 scenario 3), a panel with no
  project judging everything outside (M3), a sub-workspace panel judging against `originProjectId`
  (M4), a symlink judged on the named location and not its destination (M5), and **M6 — the
  comparison is `isUnderPath` from `packages/core/src/fs/path-id.ts:97`, with no new normaliser
  written**. Satisfies FR-021; Principle VIII.
- [x] T015 Implement the membership decision in `packages/core/src/links/resolve.ts`, delegating to
  `isUnderPath`. Do not add a fourth near-copy — `path-id.ts`'s own docstring records three.
  Satisfies FR-021.
- [x] T016 [P] RED unit(core) `packages/core/tests/unit/link-targets.test.ts` — `linkTargetStates`
  across the five link shapes SC-009 names (in-project file, in-project file with an enabled
  provider, in-project file with a **disabled** provider, out-of-project file, folder): `editor`
  offered only for an in-project file; `preview` offered/`disabled`/absent per
  [data-model.md](./data-model.md) §3; `osExplorer` always; `osDefaultProgram` absent for a folder;
  and `preview` the **only** target that can be `disabled`. Satisfies FR-030, SC-009.
- [x] T017 Implement `packages/core/src/links/targets.ts` (`LinkTarget`, `TargetState`,
  `linkTargetStates`). Satisfies FR-030.
- [x] T018 [P] RED unit(core) `packages/core/tests/unit/link-default-action.test.ts` —
  `resolveDefaultLinkAction` over setting × shape × position × executable, clause by clause:
  **FR-039 first and overriding everything** (`executable` → `osExplorer` at every setting);
  `'throng'` → `preview` only when `previewIsDefault` **and** `!hasPosition` (FR-051, FR-052);
  a named target when it is `offered`; and FR-053's fallback `preview → editor → osDefaultProgram →
  osExplorer`, with a `disabled` preview counting as not offered and an executable's fallback landing
  on `osExplorer`. Plus FR-055 as a consequence: no input reaches `editor` or `preview` for an
  out-of-project target. Satisfies FR-039, FR-050 – FR-055, SC-007.
- [x] T019 Implement `packages/core/src/links/default-action.ts` (`DefaultLinkAction`,
  `DEFAULT_LINK_ACTIONS`, `resolveDefaultLinkAction`). Satisfies FR-039, FR-050 – FR-055.
- [x] T020 [P] RED unit(core) `packages/core/tests/unit/link-menu.test.ts` — `fileLinkMenuItems`
  returns the FR-031 run in order (Open Link, each offered/disabled target in FR-030's order, Copy
  Link Address), every item in the `contextual` section, **and the chord present only when one is
  passed** — the terminal caller passes none (T002's amendment, R10b). A link that resolves to
  nothing contributes **no** items rather than six disabled ones. Satisfies FR-031, FR-013, FR-046.
- [x] T021 Implement `packages/core/src/links/menu.ts` (`fileLinkMenuItems`). Satisfies FR-031.
- [x] T022 [P] RED→GREEN unit(core) `packages/core/tests/unit/links-no-os-names.test.ts` — a source
  guard beside `packages/core/tests/unit/no-os-imports.test.ts`: no file under
  `packages/core/src/links/` contains `PATHEXT`, `.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, `.msi`, a
  drive-letter mapping literal, or an `import` of `node:path`/`node:os`. Satisfies FR-026, FR-039a;
  Principle II.

### 2b. The two new Principle II ports and their contract suites

- [x] T023 [P] Add `IPathForms` in `packages/core/src/abstractions/path-forms.ts` —
  `homeDirectory()`, `fromDriveForm()`, `fromFileUrl()`, `fromHomeForm()` with the doc comments from
  [contracts/platform-ports.md](./contracts/platform-ports.md) §1. **Note the name collision**: the
  unrelated `packages/core/src/explorer/path-forms.ts` (Copy Path renderings, #156) and its test
  `packages/core/tests/unit/path-forms.test.ts` already exist and are NOT touched. Satisfies FR-012,
  FR-025, FR-026.
- [x] T024 Write the contract suite `packages/core/src/testing/path-forms-contract.ts` —
  `runPathFormsContract(makeSubject)`, PF1–PF12, in the **pure-throw** style of
  `packages/core/src/testing/platform-info-contract.ts:18` (imports nothing, throws
  `IPathForms contract violation: …`). It asserts shape and relationship, never a literal Windows
  path. Export it from `packages/core/src/testing/index.ts`. Depends on T023. Satisfies FR-012,
  FR-025, FR-026.
- [x] T025 RED contract `packages/platform-windows/tests/contract/windows-path-forms.contract.test.ts`
  — run `runPathFormsContract(() => new WindowsPathForms())`, plus the Windows-specific cases the
  shared suite deliberately omits (`/d/x` → `D:\x`, `file://server/share/x` → `\\server\share\x`,
  mixed separators). Observe it failing on the missing module. Depends on T024. Satisfies FR-012,
  FR-025.
- [x] T026 Implement `packages/platform-windows/src/windows-path-forms.ts` and export it from that
  package's index. Depends on T025. Satisfies FR-012, FR-025, FR-026.
- [x] T027 [P] Add `IExecutableExtensions` in
  `packages/core/src/abstractions/executable-extensions.ts` — `isExecutable(path)` **and** the
  member that reports the set it considers executable, which is what lets SC-010 be a test rather
  than a list (EX6). Satisfies FR-039a, SC-010.
- [x] T028 Write `packages/core/src/testing/executable-extensions-contract.ts` —
  `runExecutableExtensionsContract(makeSubject)`, EX1–EX7, pure-throw style, exported from
  `packages/core/src/testing/index.ts`. Depends on T027. Satisfies FR-039a.
- [x] T029 RED contract
  `packages/platform-windows/tests/contract/windows-executable-extensions.contract.test.ts` — the
  shared suite, plus the Windows cases: `.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, `.msi` executable;
  and `PATHEXT` **read per call**, so a fake environment that adds an extension makes it executable
  and one that removes it makes it not — FR-039a's "without a restart". Depends on T028.
  Satisfies FR-039a.
- [x] T030 Implement `packages/platform-windows/src/windows-executable-extensions.ts` — `PATHEXT`
  per call, uppercased and case-insensitive, plus the declared handler-launched set
  (`.lnk .url .msi .msp .ps1 .scr .cpl .reg .hta .pif`) — and export it. Depends on T029.
  Satisfies FR-039a.
- [x] T031 [P] RED contract — extend `packages/core/src/testing/shell-integration-contract.ts` with
  SI1–SI4 of [contracts/platform-ports.md](./contracts/platform-ports.md) §3: reject for a missing
  path, reject for a **folder**, a rejection carrying the path and a reason, and (SI4, `@admin`) a
  de-elevating implementation performing neither OS action from the elevated process itself.
  Satisfies FR-030, FR-036, FR-038.
- [x] T032 Add `openWithDefaultProgram(path): Promise<void>` to
  `packages/core/src/abstractions/shell-integration.ts`. Depends on T031. Satisfies FR-036.

### 2c. Settings, the chord, and the terminal environment

- [x] T033 [P] RED unit(core) `packages/core/tests/unit/app-settings.links.test.ts` — the four leaves
  (`editor.links.defaultAction` shipping `'throng'`, `editor.links.detectInEditors` and
  `editor.links.detectInTerminals` shipping `true`, `terminals.advertiseHyperlinks` shipping `true`):
  defaults, tolerant parse of a wrong type and an unknown enum value, **and a clone round-trip for
  every one** — a field missing from `cloneEditor`/`cloneTerminals` is silently dropped on write
  (`packages/core/src/config/app-settings.ts:1017-1019`). Satisfies FR-050, FR-060, FR-080b.
- [x] T034 Implement the four leaves in `packages/core/src/config/app-settings.ts` — interface field,
  `DEFAULT_APP_SETTINGS` entry, tolerant parse line and the `clone…` field, four edits each. **No
  `SHIPPED_DEFAULTS_VERSION` bump** (`shipped-defaults.ts:490` clones `DEFAULT_APP_SETTINGS`).
  Depends on T033. Satisfies FR-050, FR-060, FR-080b.
- [x] T035 [P] RED unit(core) `packages/core/tests/unit/settings-metadata-links.test.ts` — the four
  descriptors' content, beyond what `settings-metadata.test.ts` already enforces:
  `editor.links.defaultAction` carries `optionLabels` for the **whole** set (all-or-none,
  `metadata.ts:107-120`) with the FR-050 labels verbatim, and its description states that a link
  carrying a line and column always opens an editor (FR-052) and that an executable is never run by
  a click (FR-039); `terminals.advertiseHyperlinks`' description states that it applies to terminals
  started afterwards and never overrides a `FORCE_HYPERLINK` the user set (FR-080a, FR-080c); and the
  three link settings share `group: 'Editor'` + `subgroup: 'Links'` while the fourth sits in the flat
  Terminal group. Satisfies FR-061, FR-080c.
- [x] T036 Implement the four descriptors in `packages/core/src/config/settings-metadata.ts`.
  `packages/core/tests/unit/settings-metadata.test.ts` (the completeness gate) must go green without
  being edited. Depends on T035. Satisfies FR-061.
- [x] T037 [P] RED unit(core) — edit `packages/core/tests/unit/keybindings-preview.test.ts` at
  `:42-45` (scope is now editor **and** preview), `:56-59` (Ctrl+Enter now resolves in an editor) and
  `:119` (the scope-name column). **Leave `:61-67` exactly as they are** — Ctrl+Enter resolving to
  nothing in a terminal is FR-046. These three ranges are the only edits S3 permits. Satisfies
  FR-045, FR-046, FR-062.
- [x] T038 Widen `COMMAND_SCOPES['preview.followLink']` from `PREVIEW_ONLY` to a set containing
  `editor` and `preview` in `packages/core/src/config/keybindings.ts` (`:147`, `:180`, `:256`; the
  `['Ctrl+Enter']` default at `:408` is unchanged and the **ActionId is not renamed** — a rename
  silently drops every rebinding saved since 044), and rewrite its description in
  `packages/core/src/config/keybindings-metadata.ts:166-173` so it no longer says *"Live in a preview
  only."*. Depends on T037. Satisfies FR-045, FR-062; S3.
- [x] T039 Settle **Open item O5** — run `packages/core/tests/unit/keybindings-collision.test.ts`
  and `packages/core/tests/unit/keybindings-scope.test.ts` against the widened scope and record the
  answer in `specs/045-clickable-file-links/research.md`'s Open items table. Depends on T038.
  Satisfies FR-045.
- [x] T040 [P] RED unit(core) `packages/core/tests/unit/spawn-env-hyperlinks.test.ts` — E1–E7 of
  [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §4 over a fake
  `baseEnv`: absent → `{ FORCE_HYPERLINK: '1' }`; `0`, `1`, a lower-case key and a set-but-empty
  value all → `undefined`; `advertise === false` → `undefined` whatever `baseEnv` holds; and **E7 —
  the result has at most one key and it is `FORCE_HYPERLINK`**, which is FR-080d by construction.
  Satisfies FR-080 – FR-080d, SC-011.
- [x] T041 Implement `hyperlinkAdvertisementEnv` in `packages/core/src/terminal/spawn-env.ts`.
  Depends on T040. Satisfies FR-080 – FR-080d.
- [x] T042 [P] RED unit(core) — edit `packages/core/tests/unit/terminal-link-menu.test.ts:20`, the
  **only** change supersession S1 permits there: a `file:` hyperlink target that **resolves** now has
  a link target, while one that does not, and every `javascript:`/`data:`/`mailto:`/unknown scheme,
  stays inert. Satisfies FR-011, FR-013; S1.
- [x] T043 Make `terminalLinkTarget` in `packages/core/src/terminal/link-menu.ts` file-aware, over
  `classifyTerminalLinkTarget`. Depends on T042, T011. Satisfies FR-011, FR-013.
- [x] T044 Export every new module — `links/{types,detect,classify,resolve,targets,default-action,
  menu}`, `abstractions/{path-forms,executable-extensions}`, `testing/{path-forms-contract,
  executable-extensions-contract}` — from `packages/core/src/index.ts`. Depends on T009–T043.

**Checkpoint**: every rule this feature states is a pure, tested function, and both ports answer
their contract suites. No surface has changed yet.

---

## Phase 3: The one authority — `FileLinkResolver` and `throng:links:*`

**Purpose**: [plan.md](./plan.md) *Sequencing* step 2 — both surfaces consume this, and building
either against a renderer-side stand-in would produce the second implementation of FR-010 the whole
design exists to prevent.

- [x] T045 Settle **Open item O2** before anything in this phase depends on it: is
  `IDeElevator.isAvailable()` true in the **UI main** process? Run
  `packages/platform-windows/tests/contract/windows-de-elevated-launcher.contract.test.ts` and add an
  `@admin` case that asks it from main. Record the answer in
  `specs/045-clickable-file-links/research.md` O2. **If it is false**, FR-038 is delivered by handing
  the de-elevation to the daemon over an existing RPC, and
  `specs/045-clickable-file-links/plan.md`'s Complexity Tracking row is rewritten before T055 starts.
  Satisfies FR-038.
- [x] T046 [P] RED integration `packages/ui/tests/integration/file-link-resolver.integration.test.ts`
  — a real `NodeFileSystem` over a temp tree seeded from `packages/ui/tests/fixtures/links/`: every
  resolution rule R1–R11 against real files including UNC-shaped and missing paths; `inProject` for a
  sub-workspace panel (`originProjectId`) and for a panel with no project; the symlink rule M5;
  `kind`, `executable` and `preview: 'none' | 'enabled' | 'disabled'` on the answer; and **FR-037 —
  a file deleted between hover and follow answers `{ ok: false, reason: 'gone', path }` and raises
  exactly ONE notice**. Satisfies FR-006, FR-020 – FR-026, FR-030, FR-037, FR-039a.
- [x] T047 Implement `packages/ui/src/main/file-link-resolver.ts` — `resolve`,
  `revealInFileManager`, `openWithDefaultProgram`, every collaborator by constructor
  (`fs`, `pathForms`, `executables`, `projectRootFor`, `previewRegistry`, `readPreviewSettings`) per
  [data-model.md](./data-model.md) §6. `preview` is answered by `registry.forPath(path)` plus
  `settings.providers[id]?.enabled === true`, so the renderer never imports a provider. Depends on
  T046. Satisfies FR-020 – FR-026, FR-030, FR-037.
- [x] T048 [P] RED contract `packages/ui/tests/contract/link-ipc.contract.test.ts` — I1–I6 of
  [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3, on
  `preview-ipc.contract.test.ts`'s pattern: the three channels' request/response shapes, **preload
  parity for `window.throng.links`**, and that nothing here is broadcast. Satisfies FR-037.
- [x] T049 Implement `packages/ui/src/main/link-ipc.ts` — `throng:links:resolve`,
  `throng:links:reveal`, `throng:links:open`, all `ipcRenderer.invoke`, all over `FileLinkResolver`.
  Depends on T048, T047. Satisfies FR-035, FR-036, FR-037.
- [x] T050 Add `window.throng.links` to `packages/ui/src/preload/preload.cts` and type it in
  `packages/ui/src/renderer/global.d.ts`. Depends on T049. Satisfies FR-037.
- [x] T051 [P] RED integration
  `packages/ui/tests/integration/link-ipc-confinement.integration.test.ts` — I1/I2: the request
  carries a **link** (text, kind, baseDirectory, panelId) and never a resolved path; the owning
  project root is derived in main from `panelId` (the `authoritative()` precedent,
  `packages/ui/src/main/editor-ipc.ts:71-83`) and never taken from the renderer; a renderer-supplied
  absolute path is refused; and `throng:files:reveal` / `throng:files:revealDocument` keep their own
  confinements unchanged. Satisfies FR-037, FR-055; T004's FR-035a.
- [x] T052 [P] RED contract
  `packages/ui/tests/contract/electron-shell-integration.contract.test.ts` — run the extended
  `runShellIntegrationContract` (SI1–SI3) against `ElectronShellIntegration`. Depends on T031.
  Satisfies FR-036.
- [x] T053 Implement `openWithDefaultProgram` in
  `packages/ui/src/main/electron-shell-integration.ts` — the **non-elevated** path keeps today's
  `shell.openPath` / `shell.showItemInFolder` behaviour verbatim. Depends on T052. Satisfies FR-036.
- [x] T054 [P] RED integration (`@admin`)
  `packages/ui/tests/integration/link-de-elevated-open.integration.test.ts` — SI4: from an elevated
  host, `revealInFileManager` and `openWithDefaultProgram` launch through
  `IDeElevator.wrap({file, args})` and **neither OS action is performed by the elevated process
  itself**. Meaningless in a non-elevated run and must not assert a hollow baseline there — it is
  `@admin`, not `skipIfElevated()`. Satisfies FR-038.
- [x] T055 Implement the de-elevated route in
  `packages/ui/src/main/electron-shell-integration.ts` — `explorer.exe /select,<path>`,
  `explorer.exe <path>`, `rundll32.exe shell32.dll,ShellExec_RunDLL <path>`, gated on
  `shouldDeElevate(...)` (`packages/core/src/terminal/elevation.ts`). Depends on T054, T045.
  Satisfies FR-038.
- [x] T056 [P] RED integration (`@admin`) — settle **Open item O3** in
  `packages/platform-windows/tests/integration/explorer-select-path.integration.test.ts`: does
  `explorer.exe /select,<path>` behave identically to `shell.showItemInFolder` for a **UNC** path and
  for a path containing a **comma**? Record the answer in
  `specs/045-clickable-file-links/research.md` O3. Satisfies FR-035, FR-038.
- [x] T057 Bind `PathForms`, `ExecutableExtensions` and `FileSystem` in
  `packages/ui/src/main/tokens.ts` and `packages/ui/src/main/composition-root.ts` on the `#199`
  pattern. Binding `IFileSystem` closes one named item of 043's recorded Principle IX exception
  (`new NodeFileSystem(...)` at `main.ts:1082`, no `UI_TYPES` entry today). Depends on T026, T030.
  Satisfies Principle IX.
- [x] T058 Construct `FileLinkResolver` beside its collaborators and call `registerLinkIpc` in
  `packages/ui/src/main/main.ts`. The construction site is `main.ts` rather than the container —
  043's recorded continuation, unchanged and unwidened. Depends on T057, T049.
- [x] T059 [P] RED unit(ui) `packages/ui/tests/unit/link-cache.test.ts` — `peekLink` returning
  `undefined` means **not a link** (FR-071's "treated as not a link until it answers");
  `requestLink` is fire-and-forget and fills the cache; a second peek for the same key issues no
  second request (FR-070); `invalidateLinksUnder` drops entries under a changed path so a file
  created later becomes a link on the next hover (FR-070, P6); and an entry older than
  `LINK_CACHE_TTL_MS` is re-requested. Satisfies FR-070, FR-071.
- [x] T060 Implement `packages/ui/src/renderer/links/link-cache.ts` — one module-level store per
  window on the `cwd-store.ts` pattern (`Map` + `useSyncExternalStore`, one shared bridge
  subscription), keyed `${kind}\u0000${text}\u0000${baseDirectory ?? ''}\u0000${panelId}`. It is
  **view state** and holds no content-shaping state (Principle XI). Depends on T059, T050.
  Satisfies FR-070, FR-071.
- [x] T061 [P] RED component `packages/ui/tests/component/link-actions-router.test.ts` — one router
  takes a `ResolvedLink` plus a `LinkTarget` and performs exactly that target, and nothing else: no
  target falls through to another, and `editor`/`preview` are unreachable for an out-of-project
  target. Satisfies FR-054, FR-055.
- [x] T062 Implement `packages/ui/src/renderer/links/link-actions.ts` — the one router both surfaces
  call. Depends on T061, T060. Satisfies FR-033 – FR-037, FR-054.

**Checkpoint**: main can answer "what is this link, and may it be opened", the renderer can ask
cheaply and act, and neither surface exists yet — which is the point.

---

## Phase 4: User Story 2 — Follow a file hyperlink a program emits, including a folder (P1) 🎯 MVP

**Goal**: an OSC 8 hyperlink whose target is a `file:` URI becomes a file link, judged on its target
alone. This is the report that started the feature (SC-005) and it needs **no detection at all**.

**Independent Test**: print an OSC 8 hyperlink to a folder and one to a file, each with visible text
differing from its target; Ctrl+click each; right-click each. Nothing from US1 is needed.

**Moved from US1, deliberately**: [plan.md](./plan.md) *Sequencing* step 4 assigns the `hoveredLink`
widening to US1. It is done here (T064/T065) because **US2 scenario 1 requires FR-043 for an OSC 8
`file:` target**, and because [data-model.md](./data-model.md) §8 requires the type change to land in
ONE commit with all four of its readers — split across slices, the interceptor is briefly blind to
file links, which is #198 reopened. US1 then adds only a new *producer* of the same value.

- [x] T063 [P] [US2] RED unit(ui) `packages/ui/tests/unit/terminal-link-activation.test.ts` — a
  resolving `file:` OSC 8 target routes through `throng:links:*` and **never** through
  `throng:openExternal`; `http(s)` keeps today's behaviour byte for byte; `javascript:`, `data:`,
  `mailto:` and any unknown scheme stay inert; and a `file:` target that does **not** resolve offers
  nothing. Satisfies FR-011, FR-012, FR-013, FR-037; S1.
- [x] T064 [P] [US2] RED unit(ui) `packages/ui/tests/unit/terminal-hovered-link.test.ts` — the four
  readers of `hoveredLink` under a `{ kind: 'file' }` value ([data-model.md](./data-model.md) §8):
  `keepLinkClickFromProgram` (`use-terminal.ts:838-861`) fires for a file link exactly as it does for
  a web link; the tooltip text (`:311`) is worded by kind and names the gesture (FR-042, per T003's
  amendment); `setHovered`'s `^https?://` filter (`:369`) is gone, replaced by
  `classifyTerminalLinkTarget`; and `getHoveredLink()` (`terminal-panel.tsx:268`) returns the
  resolved link rather than a URL string. Satisfies FR-042, FR-043; R4, R5.
- [x] T065 [US2] Change `hoveredLink`'s type and **all four readers in one commit** across
  `packages/ui/src/renderer/terminal/use-terminal.ts` and
  `packages/ui/src/renderer/terminal/terminal-panel.tsx`. Depends on T064. Satisfies FR-042, FR-043.
- [x] T066 [US2] Teach the `linkHandler` path (`use-terminal.ts:402-409`) `file:` targets — classify,
  resolve through `link-cache.ts`, act through `link-actions.ts`. `WebLinksAddon` and
  `TERMINAL_URL_REGEX` are **not** touched. Depends on T063, T065, T062. Satisfies FR-011, FR-012,
  FR-013.
- [x] T067 [US2] Confirm `packages/ui/tests/unit/external-url.test.ts` is **unchanged and green** —
  `isSafeExternalUrl` stays `http`/`https` only and keeps `file:`/`FILE:` in its `INJECTIONS` array.
  The spec names this file as one FR-037 depends on; a diff to it is a defect, not a task.
  Satisfies FR-037; I5.
- [x] T068 [P] [US2] Update `docs/quick-start.md` §3 *Run a terminal* — an OSC 8 `file:` hyperlink to
  a file or folder is now followable, and what a Ctrl+click does with it. Ships in the same commit as
  this slice (Documentation currency). Satisfies FR-090.

**Checkpoint**: SC-005 is delivered — the maintainer's status-line folder link opens the OS file
manager on one Ctrl+click, and the program behind the terminal does not also receive the press.

---

## Phase 5: User Story 1 — Follow a path printed in a terminal (P1)

**Goal**: detected paths in terminal output become links, resolved against the terminal's live
working directory first.

**Independent Test**: print each supported path form with and without a position, Ctrl+click each,
and check which file opens and where the cursor lands.

- [x] T069 [P] [US1] RED unit(ui)
  `packages/ui/tests/unit/terminal-file-link-provider.test.ts` — **FR-072's structural assertion**,
  on `packages/ui/tests/unit/terminal-output-gate.test.ts`'s fake-terminal pattern: 50,000 lines
  pushed through a fake `Terminal`'s data path call the resolver port **zero** times; one
  `provideLinks(row, cb)` calls it exactly once; a second call for the same span calls it **not at
  all** (FR-070's cache); and the provider module registers no `onData`/`onWriteParsed` hook. This
  also settles **Open item O1**. Satisfies FR-070, FR-071, FR-072; P1/P2.
- [x] T070 [US1] Implement `packages/ui/src/renderer/terminal/file-link-provider.ts` — the repo's
  **first** `registerLinkProvider`. It scans one buffer row with `detectPathCandidates`, passes the
  ranges `TERMINAL_URL_REGEX` matched as `claimed` so it **declines** any span the web provider owns
  (FR-009), stops at the per-line candidate cap, and returns nothing on a cache miss (FR-071).
  Depends on T069. Satisfies FR-001, FR-003, FR-006, FR-007, FR-008, FR-009.
- [x] T071 [US1] Register the provider in `packages/ui/src/renderer/terminal/use-terminal.ts` beside
  `WebLinksAddon` and the `linkHandler`, and produce a `{ kind: 'file' }` `hoveredLink` from it so
  FR-043 covers detected paths too. Depends on T070, T065. Satisfies FR-001, FR-042, FR-043.
- [x] T072 [P] [US1] RED unit(ui) `packages/ui/tests/unit/terminal-link-base-directory.test.ts` —
  the request's `baseDirectory` is the panel's **live** working directory (025's seam) where throng
  knows it, and absent otherwise, so a relative path is tried against the terminal's directory before
  the project root (US1 scenario 8). Satisfies FR-023.
- [x] T073 [US1] Wire the live cwd and `panelId` into the request in
  `packages/ui/src/renderer/terminal/terminal-panel.tsx`. Depends on T072. Satisfies FR-023.
- [x] T074 [P] [US1] RED unit(core) `packages/core/tests/unit/link-guards.test.ts` — the two
  hard-coded integrity guards at their edges: `LINK_CACHE_TTL_MS` (a cached "this does not exist"
  cannot outlive the file being created) and the per-line candidate cap (a 100,000-character line of
  slashes cannot make a hover expensive). Both are named constants, not settings — recorded in
  [plan.md](./plan.md) Complexity Tracking with 030's and 044's precedents. Satisfies FR-070, FR-071.
- [x] T075 [US1] Declare both constants in `packages/core/src/links/` and consume them from
  `link-cache.ts` and `file-link-provider.ts`. Depends on T074. Satisfies FR-070, FR-071.
- [x] T076 [P] [US1] Update `docs/quick-start.md` §3 *Run a terminal* — detected paths, the supported
  forms, the position suffixes, the hover tooltip and Ctrl+click. Ships with this slice.
  Satisfies FR-090, FR-042.

**Checkpoint**: SC-001 and SC-006 hold in a terminal; SC-003's prose fixture underlines nothing.

---

## Phase 6: User Story 4 — Choose where a link opens from its menu (P2)

**Goal**: the menu is the one route that shows every choice (Principle VI). Built on the terminal
first, because that is the surface that already exists — [plan.md](./plan.md) *Sequencing* step 5.

**Independent Test**: right-click an in-project `.ts`, an in-project `.md` with the provider enabled
and then disabled, an out-of-project file and a folder, and compare the item sets.

- [x] T077 [P] [US4] RED component `packages/ui/tests/component/terminal-file-link-menu.test.ts` —
  **SC-009**: the FR-031 run over each of the five link shapes; with text selected the ordinary menu
  appears instead (024 FR-019d); away from a link the menu is unchanged; over a **web** link 024's
  two items are unchanged; the keyboard-opened menu (`menu.open`, Shift+F10) offers the same items
  from what the pointer rests on (§5, US4 scenario 8); and the terminal's Open Link shows **no
  chord** (T002). Satisfies FR-030, FR-031, FR-046, SC-009.
- [x] T078 [US4] Implement `packages/ui/src/renderer/links/link-menu-items.ts` — core's
  `fileLinkMenuItems` shapes → `MenuAction[]`, every item in the `contextual` section (`section` is a
  required field, so an omission is a compile error). Depends on T077, T021. Satisfies FR-031.
- [x] T079 [US4] Insert the run in `packages/ui/src/renderer/terminal/terminal-content-menu.ts:49`
  — it **replaces** the existing `contextual` Open Link / Copy Link Address pair (`:54-70`) **only
  over a file link**. Depends on T078. Satisfies FR-031.
- [x] T080 [P] [US4] RED unit(ui) — add a `shapeOf` pin for the terminal content menu and the editor
  content menu to `packages/ui/tests/unit/menu-sections.test.ts`. Satisfies Principle VI (*One
  section vocabulary for every menu*).
- [x] T081 [US4] Make T080 green — no new section name is introduced; the whole run is `contextual`.
  Depends on T080, T079.
- [x] T082 [P] [US4] RED component `packages/ui/tests/component/link-copy-address.test.ts` — Copy
  Link Address copies the **resolved** absolute path as plain text, followed by the position **in the
  form it was written** when the link has one, and copies a resolved path for a target **outside** the
  project too (where this differs from 044 FR-116). Satisfies FR-032.
- [x] T083 [US4] Implement Copy Link Address in
  `packages/ui/src/renderer/links/link-actions.ts`. Depends on T082. Satisfies FR-032.
- [x] T084 [P] [US4] RED component `packages/ui/tests/component/link-target-actions.test.ts` — each
  named item performs its own target **whatever the preference says** (FR-054): Open in Editor via
  `openFileInTab(ws, tabId, absPath, openTarget, …)` honouring *Open files in* and **never**
  `open-router.ts` (FR-033); Open in Preview via
  `requestPreviewOpen({ absPath, projectId, requesterPanelId })` with the link's **position ignored**
  (FR-034); Open in OS Explorer via `throng:links:reveal`; Open in OS Default Program via
  `throng:links:open`. Satisfies FR-033 – FR-036, FR-054.
- [x] T085 [US4] Implement the four named targets in
  `packages/ui/src/renderer/links/link-actions.ts`. Depends on T084. Satisfies FR-033 – FR-036.
- [x] T086 [P] [US4] RED component `packages/ui/tests/component/link-failure-notice.test.ts` — a
  failed OS open, and a target that has gone between hover and follow, each raise **exactly one**
  notice naming the file and the reason, through the shared failure presentation (030). One
  condition, one notice: no second surface reports the same state. Satisfies FR-036, FR-037.
- [x] T087 [US4] Implement the notice route from `LinkActionOutcome` in
  `packages/ui/src/renderer/links/link-actions.ts`. Depends on T086. Satisfies FR-036, FR-037.
- [x] T088 [P] [US4] Update `docs/quick-start.md` §3 and §4 — the file-link menu's items in both panel
  types, and which are absent or disabled for which link. Ships with this slice. Satisfies FR-090.

**Checkpoint**: SC-009 holds in a terminal. Every link action is reachable from a menu item, which is
half of what Principle VI requires of this feature.

---

## Phase 7: User Story 3 — Follow a path in an editor (P2)

**Goal**: the same navigation on the other surface, plus the keyboard route Ctrl+Enter gives it.

**Independent Test**: open `packages/ui/tests/fixtures/links/docs/a.md`, Ctrl+click each of `./b.md`,
`packages/core/x.ts` and `src/foo.ts:10`, and press Ctrl+Enter inside each.

- [x] T089 [P] [US3] RED component `packages/ui/tests/component/link-decorations.test.ts` — the
  `ViewPlugin` decorates **only resolved links** and **only within `view.visibleRanges`** (FR-002,
  FR-073); an unresolved answer draws nothing (FR-071); an invalidation re-requests and then draws
  (FR-070); and the compartment reconfigure turns decoration off **live, with no restart** (FR-060).
  Satisfies FR-002, FR-060, FR-070, FR-071, FR-073.
- [x] T090 [US3] Implement `packages/ui/src/renderer/editor/link-decorations.ts` — a `ViewPlugin`
  building a `RangeSetBuilder` over `view.visibleRanges` and nothing else, on
  `packages/ui/src/renderer/editor/function-highlight.ts:172-222`'s pattern, marking with
  `Decoration.mark({ class: 'cm-throng-link' })`. Depends on T089. Satisfies FR-002, FR-073.
- [x] T091 [US3] Add the link compartment in `packages/ui/src/renderer/editor/use-editor.ts`, on
  `functionHighlightCompartment`'s and `wrapCompartment`'s pattern (`:462-466`, `:939-952`, `:1254`).
  Depends on T090. Satisfies FR-060.
- [x] T092 [P] [US3] RED component `packages/ui/tests/component/editor-link-gestures.test.ts` — G1,
  G3 and **G4**: Ctrl+click over a resolved link follows; Ctrl+click **anywhere else adds a cursor**,
  unchanged (FR-041); a Ctrl+click that drags selects (FR-040); and the modifier comes from
  `shippedBindingsFor(DEFAULT_BINDING_PLATFORM)` rather than a hard-coded `Ctrl`, so FR-040's
  Cmd-on-macOS clause reads from one place. Satisfies FR-040, FR-041.
- [x] T093 [US3] Add a `mousedown` entry to `EditorView.domEventHandlers` in
  `packages/ui/src/renderer/editor/use-editor.ts` that returns `true` **only** when the modifier is
  held and `view.posAtCoords` lands inside a resolved link — otherwise CodeMirror's own
  multi-cursor handler runs, which is G4 by default. Depends on T092. Satisfies FR-040, FR-041.
- [x] T094 [P] [US3] RED component `packages/ui/tests/component/editor-link-chord.test.ts` — G8/G9:
  Ctrl+Enter with a **single caret inside** a link and no selection runs the default link action; with
  a selection, with two carets, or outside a link it inserts a blank line exactly as today, because
  the window handler does not `preventDefault` and the keypress reaches CodeMirror's `defaultKeymap`
  (`use-editor.ts:1232`). Satisfies FR-044, FR-045.
- [x] T095 [US3] Dispatch `preview.followLink` for the editor scope at the **window**, in capture
  phase, in `packages/ui/src/renderer/app.tsx` — the `navigate.gotoLine` shape (`:466-473`).
  `editorCommandKeymap` (`packages/ui/src/renderer/editor/commands.ts:575-590`) deliberately leaves
  the chord unbound and **must stay that way**. Depends on T094, T038. Satisfies FR-044, FR-045.
- [x] T096 [P] [US3] RED unit(ui) `packages/ui/tests/unit/reveal-position.test.ts` —
  `positionRevealTarget(line, column?)` produces a `RevealResolver` that resolves to document offsets
  once the document is loaded, and **clamps a position beyond the file's end to the nearest valid
  position** rather than erroring. Satisfies FR-033; the *position beyond the file's end* edge case.
- [x] T097 [US3] Implement `positionRevealTarget` in
  `packages/ui/src/renderer/editor/reveal-range.ts`, beside `headingRevealTarget` (`:55`), and hand
  it to `openFileInTab` (`editor-open.tsx:156-174`). A link with a position must **not** go through
  `open-router.ts`. Depends on T096. Satisfies FR-033, FR-052; R12.
- [x] T098 [P] [US3] RED component — extend
  `packages/ui/tests/component/editor-content-menu.test.ts` with the new `contextual` run ahead of
  the existing `content` section (the first contextual items this menu has had): the same five link
  shapes as T077, with the editor's Open Link showing the chord; the keyboard-opened menu composing
  from the **caret** and a right-click from `posAtCoords`, since `placeCaretForContextMenu`
  (`content-menu.ts:235`) already no-ops for a keyboard menu. Satisfies FR-031, SC-009.
- [x] T099 [US3] Insert the run in `packages/ui/src/renderer/editor/content-menu.ts:86`. Depends on
  T098, T078. Satisfies FR-031; S2.
- [x] T100 [P] [US3] RED component
  `packages/ui/tests/component/editor-link-base-directory.test.ts` — a relative path is tried against
  the open file's **own folder** first and then the project root (US3 scenarios 1 and 2), and an
  **untitled buffer** supplies no base directory, so the project root is tried alone. Satisfies
  FR-022; R10.
- [x] T101 [US3] Wire the document's own folder (or nothing, for an untitled buffer) into the request
  in `packages/ui/src/renderer/editor/use-editor.ts` and `link-decorations.ts`. Depends on T100.
  Satisfies FR-022.
- [x] T102 [US3] **Constitution PATCH** — amend `.specify/memory/constitution.md` Principle VI, the
  *Known gaps* sentence at lines 1666–1671, from v5.5.0 to **v5.5.1**. It corrects **two**
  statements: that no surface implements Ctrl+Enter (044 shipped it) and that editors do not (this
  slice ships it). The About window's plain-click links remain a gap and stay named. The SYNC IMPACT
  REPORT must state the bump and argue it against the project's own test (a clarification with no new
  obligation = PATCH), list the modified section, enumerate the templates and artifacts reviewed with
  ✅/⚠, and **say that one of the two statements was already stale before this feature**. This lands
  in the **same change as US3**, because Incremental Delivery forbids amending ahead of the behaviour.
  Depends on T095, T099. Satisfies FR-091; R16.
- [x] T103 [P] [US3] Update `docs/quick-start.md` §4 *Edit files* and the **Keyboard reference** —
  Ctrl+click and Ctrl+Enter in an editor, and that Ctrl+Enter still reaches the shell in a terminal.
  Ships with this slice. Satisfies FR-090, FR-062.

**Checkpoint**: SC-001 and SC-006 hold in both panel types; SC-009 holds in both menus; the
constitution's Known-gaps sentence is true again.

---

## Phase 8: User Story 5 — Set what Ctrl+click does (P3)

**Goal**: the preference picks the default; the menu already offers every variant.
**FR-039 lands with this slice, not after it** — an executable that runs on a Ctrl+click is the one
behaviour here that cannot be shipped and fixed later ([plan.md](./plan.md) *Sequencing* step 7).

**Independent Test**: at shipped settings Ctrl+click a `.ts` and a `.md`; set the Markdown provider's
default open action to Preview and repeat; set the default link action to Open in OS Default Program
and repeat **without restarting**.

- [x] T104 [P] [US5] RED component
  `packages/ui/tests/component/link-default-action-wiring.test.ts` — Ctrl+click, the Open Link chord
  and the plain **Open Link** menu item all run the same `resolveDefaultLinkAction` for the same link
  (FR-054); `previewIsDefault` is computed by the caller from `defaultOpenActionFor`
  (`packages/core/src/config/preview-settings.ts:283-294`) so the decision stays free of the preview
  registry; a link **with** a position opens an editor whatever the file's default open action
  (FR-052); an in-project `.md` with the provider set to Preview and **no** position opens its
  preview beside the file's editor (FR-051, 044 FR-053). Satisfies FR-050 – FR-054.
- [x] T105 [US5] Wire the setting and `previewIsDefault` into
  `packages/ui/src/renderer/links/link-actions.ts` and both surfaces. Depends on T104.
  Satisfies FR-050 – FR-054.
- [x] T106 [P] [US5] RED component `packages/ui/tests/component/link-executable-refusal.test.ts` —
  **SC-010**, driven from `IExecutableExtensions`' own reported set (EX6) rather than a hand-written
  list: **none** of them runs under Ctrl+click, the Open Link chord or the plain Open Link item, at
  **any** setting — all three perform Open in OS Explorer with the file selected — and **each** of
  them runs when Open in OS Default Program is chosen explicitly. Satisfies FR-039, FR-053, SC-010.
- [x] T107 [US5] Make T106 green **without a second implementation**: FR-039's precedence already
  lives in `packages/core/src/links/default-action.ts` (step 1, before everything). The only change
  here is that `link-actions.ts` routes through it rather than around it. Depends on T106.
  Satisfies FR-039.
- [x] T108 [P] [US5] RED component `packages/ui/tests/component/link-setting-live.test.ts` —
  **SC-008**: a change to `editor.links.defaultAction` applies to the **next gesture** with no
  restart, in both panel types. Satisfies FR-050, SC-008.
- [x] T109 [US5] Read the setting live in `packages/ui/src/renderer/links/link-actions.ts` rather
  than capturing it at mount. Depends on T108. Satisfies FR-050.
- [x] T110 [P] [US5] RED component `packages/ui/tests/component/link-out-of-project.test.ts` —
  **SC-007**: across the fixture set, **no** gesture, menu item or setting opens a file outside the
  owning project in a throng editor or preview, including a path inside **another** throng project
  and a panel with no owning project. Satisfies FR-055, SC-007.
- [x] T111 [P] [US5] Update `docs/quick-start.md` §7 *Make it yours* and `README.md` *Configuration*
  — the default link action, its five values, the position rule (FR-052) and the refusal to run an
  executable (FR-039). Ships with this slice. Satisfies FR-090.

**Checkpoint**: SC-007, SC-008 and SC-010 hold.

---

## Phase 9: User Story 6 — Turn detection off, and keep terminals fast (P3)

**Goal**: the safety valve, and the performance guarantee that is already structural.

**Independent Test**: toggle each switch and check the underline, the gestures and the menu; compare
the time to stream a large output with detection on and off.

**Independent of Phases 4–8** in principle — [plan.md](./plan.md) *Sequencing* step 8 — but the
switches have nothing to gate until the surfaces exist, so in practice T112 follows T071 and T091.

- [x] T112 [P] [US6] RED component
  `packages/ui/tests/component/link-detection-switches.test.ts` — with
  `editor.links.detectInTerminals` off: detected paths in terminals are not underlined, Ctrl+click
  does nothing, and the menu has no file-link items — while **web links and explicit `file:`
  hyperlinks still work**. With `editor.links.detectInEditors` off: the same in editors, and
  Ctrl+click and Ctrl+Enter keep their ordinary editor meanings everywhere. Both live, with no
  restart. Satisfies FR-060, SC-008.
- [x] T113 [US6] Gate `provideLinks` in
  `packages/ui/src/renderer/terminal/file-link-provider.ts` on the terminal switch, and reconfigure
  the link compartment in `packages/ui/src/renderer/editor/use-editor.ts` on the editor switch. A
  switch **never** touches an explicit hyperlink. Depends on T112, T071, T091. Satisfies FR-060.
- [x] T114 [P] [US6] Record the **SC-004** measurement in
  `specs/045-clickable-file-links/quickstart.md` §5 — streaming ≥ 50,000 lines with the switch on and
  off, expecting ≤ 5% — and the FR-073 visible-range scan cost on the largest fixture document,
  closing **Open item O6**. This is measured and annotated, never asserted: a wall-clock bound on a
  shared hosted runner is a flake by construction. Satisfies SC-004; FR-073.
- [x] T115 [P] [US6] Update `docs/quick-start.md` §7 — the two detection switches and exactly what
  each stops. Ships with this slice. Satisfies FR-090.

**Checkpoint**: SC-004's structural half is already proved by T069; its wall-clock half is recorded.

---

## Phase 10: User Story 7 — Programs print hyperlinks in throng as they do in Windows Terminal (P3)

**Goal**: a terminal throng starts advertises hyperlink support, without ever overriding a value the
user set. **Independent of every other story** and may run in parallel from Phase 2.

**Independent Test**: `echo $FORCE_HYPERLINK` in a new terminal with the setting on, with it off, and
with the variable already set outside throng.

- [x] T116 [P] [US7] RED unit(ui) `packages/ui/tests/unit/terminal-attach-env.test.ts` — `doAttach`
  merges `hyperlinkAdvertisementEnv`'s result into **`launch.env`** and **never** into `baseEnv`
  (a de-elevated terminal never receives `baseEnv`: `daemon/src/pty-agent-host.ts:290` sends only
  `env`, `pty-agent-entry.ts:172-179` forwards only `env`), and the setting is read **per attach**,
  so a change applies to the next terminal and never to a running one. Satisfies FR-080, FR-080c;
  R11.
- [x] T117 [US7] Add the injected `readTerminalSettings: () => TerminalSettings` to
  `registerTerminalIpc` (`packages/ui/src/main/terminal-ipc.ts:94-115`) and merge the result into
  `launch.env` in `doAttach`, beside the existing `baseEnv: { ...process.env }` (`:283`). Depends on
  T116, T041. Satisfies FR-080 – FR-080c.
- [x] T118 [US7] Wire `readTerminalSettings` from the same `configStore` `ShellDetectionService`
  already reads, in `packages/ui/src/main/main.ts:1661-1669`. Depends on T117. Satisfies FR-080c.
- [x] T119 [P] [US7] RED integration
  `packages/platform-windows/tests/integration/terminal-hyperlink-env.integration.test.ts` — spawn a
  **real shell** that echoes its environment, on the shape
  `packages/platform-windows/tests/integration/shell-history.integration.test.ts` already uses:
  with the setting on it sees `FORCE_HYPERLINK=1`; with a seeded `FORCE_HYPERLINK=0` it still sees
  `0`; with the setting off it sees neither a throng-added value nor a changed user value; and in
  none of the three does the environment carry a `WT_SESSION` or a `TERM_PROGRAM` **throng added**.
  **Not an E2E** — the spec's own Assumptions require this layer. Satisfies FR-080 – FR-080d, SC-011.
- [x] T120 [P] [US7] Update `docs/quick-start.md` §3 *Shell integration* and `README.md` *Highlights*
  — the hyperlink-advertising setting, the variable it sets, that it applies to terminals started
  afterwards, and that a value the user set is never overridden. Ships with this slice.
  Satisfies FR-090.
- [ ] T121 [US7] Hands-on, per [quickstart.md](./quickstart.md) §6 — settle **Open item O4**: does
  Claude Code actually emit OSC 8 in a throng terminal under `FORCE_HYPERLINK=1` on this Windows
  build? No test in this repository can assert it. Run step 5 too: with the setting **off** the
  reference must still be a link, because detection catches it either way — which is the check that
  US1 and US7 are independent. Record the answer in `specs/045-clickable-file-links/research.md` O4
  and in quickstart §6. Depends on T118. Satisfies SC-005, SC-011; US7 scenario 6.

**Checkpoint**: SC-011 holds.

---

## Phase 11: E2E — two existing declarations gain cases, and the budget does not move

**Purpose**: [plan.md](./plan.md) *Sequencing* step 9. **No `test(` declaration is added.** A case
inside an existing declaration does not raise the count — the counter is a per-line regex over
`test(` declarations.

- [x] T122 [P] Add two cases inside the existing declaration at
  `packages/ui/tests/e2e/terminal-link-once.e2e.ts:529` (`@extended @terminal @reserve:pty`), under
  the same mouse-owning fixture: a **detected path** and an **OSC 8 `file:` target naming a folder**.
  Each asserts one Ctrl+click opens once, the program receives no press, and a **plain** click still
  reaches the program. Satisfies FR-043, SC-002, SC-005; G5/G6.
- [x] T123 [P] Add a hover case inside an existing declaration in
  `packages/ui/tests/e2e/terminal-links.e2e.ts` — a detected path underlines on hover and a
  look-alike that names nothing does not. Satisfies FR-006, FR-042, SC-003.
- [x] T124 Re-read `packages/ui/tests/e2e/e2e-budget.json` and
  `packages/ui/tests/e2e/parallel-plan.json` **in the same commit** and confirm neither needs a
  change — `"total": 570` and `"@terminal": 107` before and after, and no new spec file to place in a
  tier. Run `packages/ui/tests/unit/e2e-budget.test.ts`, `packages/ui/tests/unit/e2e-tags.test.ts`
  and the tier-plan guard. Depends on T122, T123. Satisfies Principle V; R15.
- [ ] T125 Confirm `packages/ui/tests/e2e/terminal-modified-enter.e2e.ts:233` is **untouched and
  green** — Ctrl+Enter still reaches the program in a terminal with its modified-Enter encoding. A
  diff to this file is a defect, not a task. Satisfies FR-046.
  **Half-confirmed 2026-09-18 (T130/T131 pass): UNTOUCHED.** `git diff 92b29e68..HEAD --
  packages/ui/tests/e2e/terminal-modified-enter.e2e.ts` is empty. *Green* is the E2E stage of the
  gate (T132) and is not claimed here.

**Checkpoint**: SC-002 holds under a program that reports mouse events, for both link kinds, at the
only layer that can show it.

---

## Phase 12: Documentation, the artifact set, and closeout

**Purpose**: Documentation currency is NON-NEGOTIABLE, and each doc edit above ships **in the commit
with the behaviour it describes**. What is left here is the cross-cutting set and the closeout.

**On `menus-and-controls.md`**: this repo has **no `docs/menus-and-controls.md` page** — the file of
that name is `specs/044-file-previews/contracts/menus-and-controls.md`, a spec contract. 045's
equivalent is [contracts/menus-and-gestures.md](./contracts/menus-and-gestures.md) (T130), and the
user-facing menu and settings documentation is `docs/quick-start.md` (T068, T076, T088, T103, T111,
T115, T120).

- [x] T126 [P] Update `README.md` — *Highlights* (file links in terminals and editors, one gesture,
  the menu) and *Configuration* (the four new settings and the widened Open Link chord).
  Satisfies FR-090.
- [x] T127 [P] Update `CONTRIBUTING.md` — `IPathForms` and `IExecutableExtensions` as an extension
  point, with their contract suites in `packages/core/src/testing/` and the pure-throw style a new
  platform implementation must satisfy. Satisfies FR-090; Principle II.
- [x] T128 [P] Update `docs/testing.md` — the two extended E2E declarations, and that the budget was
  held flat at 570 with zero new declarations. Satisfies FR-090.
- [x] T129 [P] Update `CHANGELOG.md` with the user-visible set: clickable file links in terminals and
  editors, the four link targets and their menu, the default link action, the two detection switches,
  the refusal to run executables, and `FORCE_HYPERLINK`. Satisfies FR-090.
- [x] T130 [P] Reconcile [contracts/menus-and-gestures.md](./contracts/menus-and-gestures.md) and
  [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) with what actually
  shipped — every menu item, section, state and settings descriptor. A contract that disagrees with
  the code is worse than none. Satisfies FR-031, FR-061.
  **Done 2026-09-18, and it reached two more artifacts than it named**, because the drift was there:
  [data-model.md](./data-model.md) §4 (`LinkFollowDeps.defaultAction` ships as a **reader**,
  `() => DefaultLinkAction`, which is what makes SC-008 true), §7 (`peekLink` takes the request, not
  a `CacheKey`) and §8 (`HoveredLink`'s `file` arm carries `position` and `positionText`, the type
  lives in `hovered-link.ts`, and xterm's `allowNonHttpProtocols` is what hands a `file:` hyperlink
  over at all); and [contracts/platform-ports.md](./contracts/platform-ports.md) §2
  (`IExecutableExtensions` has **two** members — EX6 already required the second). The
  `IPathForms` pass-through was already recorded in
  [contracts/link-resolution.md](./contracts/link-resolution.md) §2 and is unchanged; that file gains
  only the note that an inert OSC 8 scheme now draws xterm's hover underline, which is
  `allowNonHttpProtocols`' one visible cost.
- [x] T131 Close **O1–O6** in `specs/045-clickable-file-links/research.md` with the answers found —
  O1 (T069), O2 (T045), O3 (T056), O4 (T121), O5 (T039), O6 (T114) — and delete nothing: an open item
  that turned out differently is recorded as it was and then answered.
  **Done 2026-09-18.** O1 closed (hover only, structurally — `terminal-file-link-provider.test.ts`,
  14 passed); O2, O3 and O5 were already closed in place by their own tasks. **O4 and O6 stay open**
  and say so: both need the running app, both are T121 and T114, and neither gates any code.
- [ ] T132 Dispatch `npm run gate` against this branch on a hosted runner and quote the **run URL and
  the SHA** when reporting done. A green gate goes stale the moment anything is edited, and a local
  green bar is progress, not done-ness.
  ```bash
  gh workflow run gate.yml --ref feature/S045-I198-I394-terminal-and-file-links
  gh run watch <run-id> --exit-status
  gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
  ```
  *2026-09-18: a gate run on a commit before Phase 13 proves nothing about the amended branch —
  T172 is the gate for the branch as amended.*

---

## Phase 13: Change request 2026-09-18 — one link model, the click rule, network paths

**Input**: the maintainer's request after hands-on testing of PR #408 (quoted in
[spec.md](./spec.md)); [plan.md](./plan.md) *Amendment 2026-09-18*; [research.md](./research.md)
R17 – R20. Adds US8 and US9; FR-003g, FR-100 – FR-107, FR-110 – FR-114, FR-120 – FR-124; SC-012 –
SC-014; defect D1.

**E2E: still zero new declarations, and `e2e-budget.json` still reads 570.** The one property no
unit, component, integration or contract test can observe — OS Explorer actually displaying a file
on a share — no Playwright test can observe either (the harness drives throng's windows, not
Explorer's), so it is a hands-on step (T154), not an E2E.

**Order** ([plan.md](./plan.md) *Sequencing for Phase 13*): 13b (D1) starts first and gates on the
maintainer; 13c, 13d and 13e can run in parallel with each other once 13a is done; **T144, T156 and
T158 land in one commit** (retiring the leaf without the decision, or the reverse, leaves a renderer
reading a setting that does not exist); **T162 lands before any of T163 – T168**.

### 13a. Artifacts and fixtures

- [x] T133 Amend the artifact set for the change request — [spec.md](./spec.md) (third 2026-09-18
  Clarifications session; US8, US9; FR-003g, FR-100 – FR-107, FR-110 – FR-114, FR-120 – FR-124;
  SC-012 – SC-014; D1; S4 and the within-spec supersession table; in-place supersession notes on
  FR-009, FR-039, FR-050, FR-051, FR-053, FR-054, FR-061, FR-090, SC-008, US5, *Terminology*,
  *Assumptions*, *Key Entities*, *Out of scope*), [plan.md](./plan.md),
  [research.md](./research.md) R17 – R20 and O7/O8, [data-model.md](./data-model.md) §13, all four
  contracts, [quickstart.md](./quickstart.md) §7, and this phase. **Done 2026-09-18.** Nothing was
  deleted; 024 is not edited (S4's note says why).
- [ ] T134 [P] Extend `packages/ui/tests/fixtures/links/` for Phase 13: `parity.txt` — one line per
  link kind × path form × position form in FR-100/FR-003/FR-004, including an out-of-project path, a
  folder, `https://host/src/foo.ts:42` (FR-009) and the PowerShell prompt form — and `deploy.ps1` and
  `build.bat` at the fixture root (FR-114). No UNC location can live in a fixture tree; T141 builds
  its UNC spellings at run time. Satisfies SC-012, SC-013.

### 13b. D1 — network paths cannot be followed [US9]

- [ ] T135 [US9] RED unit(core) — **adopt** the untracked reproduction
  `packages/core/tests/unit/link-resolve-unc.test.ts` exactly as another session wrote it; do not
  rewrite it. Run it, observe the join cases fail and the absolute-path control pass, **show the
  output to the maintainer and touch no production code until they confirm it reproduces what they
  saw** (the replicating-bugs gate). Record the answer as O8 in [research.md](./research.md).
  Covers D1 against FR-003c, FR-022, FR-023, FR-024.
- [x] T136 [US9] GREEN — fix `join` in `packages/core/src/links/resolve.ts`: a base beginning with two
  separators keeps both, and its first two segments are a root `..` cannot pop (contract R12). Use
  the `UNC_FORM` shape the file already holds; name no OS (FR-026 — `links-no-os-names.test.ts` must
  stay green). Depends on T135 and the maintainer's confirmation. Makes T135's join cases green.
- [ ] T137 [P] [US9] RED unit(core) `packages/core/tests/unit/link-membership.test.ts` — **M7**: a
  project rooted at `\\s\h\proj` contains `\\s\h\proj\src\x.ts` and `//s/h/proj/src/x.ts`, and not
  `\\s\h\proj-old\x.ts`; **M8**: `Z:\proj\x.ts` is not in a project rooted at `\\s\h\proj` (FR-106).
  If M7 passes on first run it is recorded as a characterisation pin and T138 is skipped.
  Satisfies FR-021, FR-106.
- [x] T138 [US9] GREEN, only if T137 is red — the fix goes in `packages/core/src/fs/path-id.ts`
  (`isUnderPath` / `normaliseForCompare`), never in `links/` (M6), with a case added to
  `packages/core/tests/unit/path-id.test.ts`. Depends on T137.
  **Skipped 2026-09-18** — T137's M7/M8 passed on first run (`96b5baac`), so they stand as a
  characterisation pin and there is nothing to fix; no production file was touched.
- [ ] T139 [P] [US9] RED unit(core) `packages/core/tests/unit/link-detect.test.ts` — **D12**:
  `FileSystem::\\s\h\x`, `Microsoft.PowerShell.Core\FileSystem::C:\x\y.ts` and the whole prompt
  `PS Microsoft.PowerShell.Core\FileSystem::\\s\h\dir> ` each yield one candidate spanning the path
  alone; `std::vector`, `Foo::Bar`, `a::b` and `Other::C:\x` yield none; the SC-003 prose fixture
  still yields zero. Satisfies FR-003g, FR-107, SC-003.
- [x] T140 [US9] GREEN — strip the qualifier in `packages/core/src/links/detect.ts` before a token is
  judged, keeping `::` a refusal everywhere else. Depends on T139.
- [ ] T141 [P] [US9] RED integration (`@admin`)
  `packages/ui/tests/integration/file-link-resolver.integration.test.ts` — against a **real**
  network spelling of the temp tree, `\\localhost\<drive>$\<temp>\…`, in both separators and as
  `file://127.0.0.1/<drive>$/…`: an absolute UNC file and folder resolve; a relative name against
  that UNC base directory resolves (D1); a project rooted there judges its files in-project (M7).
  The loopback administrative share needs an elevated token, so the case is skipped **with the
  reason printed** on a non-elevated workstation and runs on the hosted gate. Satisfies FR-003c,
  FR-012, FR-022 – FR-024, SC-014.
- [ ] T142 [US9] GREEN — make T141 green. **Expected to need no production change** beyond T136 and
  T140; if one is needed, it is a new finding and is recorded in R18 before it is made. Depends on
  T141, T136, T140.

### 13c. Bounded existence checks [US9]

- [ ] T143 [P] [US9] RED unit(core) — the `Editor · Links` block after the amendment, in
  `packages/core/tests/unit/app-settings.links.test.ts` and
  `packages/core/tests/unit/settings-metadata-links.test.ts`: **no** `defaultAction` leaf, value
  array or descriptor (FR-112); `existenceCheckTimeoutMs` ships `2000`, is bounded `250`–`25000`,
  survives the clone round-trip, and has a descriptor under Editor · Links whose description says it
  applies with no restart (FR-120); `parseAppSettings` of a document carrying each of the five
  retired values and a junk one yields no `defaultAction` and the other leaves intact, **and parse →
  serialise → parse → serialise is a fixed point** — the idempotent re-run (FR-113). One task
  because both halves edit the same two files. Satisfies FR-061, FR-112, FR-113, FR-120.
- [x] T144 [US9] GREEN `packages/core/src/config/app-settings.ts` (interface, default, `linkSettings`,
  `cloneEditor`: − `defaultAction`, + `existenceCheckTimeoutMs`) and
  `packages/core/src/config/settings-metadata.ts` (− the descriptor, with a retirement comment on the
  `explorer.openMode` pattern at `:353`; + the timeout descriptor, the three `Editor · Links`
  descriptors kept consecutive). Depends on T143. **Lands in one commit with T156 and T158.**
- [ ] T145 [P] [US9] RED unit(ui) `packages/ui/tests/unit/file-link-resolver-network.test.ts` —
  `FileLinkResolver` over a fake `IFileSystem` whose `stat` for one volume root never settles, with a
  fake clock: `resolve` answers `{ ok: false, reason: 'unreachable' }` at the timeout (P7); a second
  request under the same root answers at once and `stat` is **not** called again (P8); a request
  under a local root meanwhile answers normally and at once (P11); with two roots stuck, a third
  root's request answers `unreachable` without a `stat` (P9); when the stuck `stat` settles the root
  is checked again (P10); `revealInFileManager` and `openWithDefaultProgram` against a stuck root end
  at the timeout with reason `unreachable` (FR-124). Satisfies FR-120 – FR-122, FR-124.
- [x] T146 [US9] GREEN `packages/ui/src/main/file-link-resolver.ts` (the volume-root gate, the
  timeout race, `readLinkSettings` dep), `packages/core/src/links/types.ts` (`reason` on both
  unions), `packages/core/src/links/limits.ts` (`MAX_TIMED_OUT_LINK_CHECKS = 2`, with its edge in
  `packages/core/tests/unit/link-guards.test.ts`), and the wiring in
  `packages/ui/src/main/main.ts`. Depends on T145, T144.
- [ ] T147 [P] [US9] RED contract `packages/ui/tests/contract/link-ipc.contract.test.ts` — all three
  channels pass `reason: 'unreachable'` through unchanged, and a malformed request still answers as
  before (I1 – I6). Satisfies FR-120, FR-124.
- [ ] T148 [US9] GREEN `packages/ui/src/main/link-ipc.ts` — only if T147 is red; the sanitiser touches
  requests, not responses, so no change is expected. Depends on T147.
- [ ] T149 [P] [US9] RED unit(ui) `packages/ui/tests/unit/terminal-file-link-provider.test.ts` —
  **FR-123**: a resolution that lands after the provider stopped waiting still yields that line's
  link with no `provideLinks` call for another line in between; the wait is governed by the
  existence-check timeout, not an independent constant. The FR-072 structural cases in the file
  stay as they are. Satisfies FR-123.
- [ ] T150 [US9] GREEN `packages/ui/src/renderer/terminal/file-link-provider.ts` (and
  `use-terminal.ts` if the chosen mechanism needs the terminal) — settle **O7** and record the
  mechanism in R19. Depends on T149, T144.
- [ ] T151 [P] [US9] RED component `packages/ui/tests/component/link-decorations.test.ts` — FR-123 in
  editors: a late answer redecorates with no edit, scroll or pointer movement. Expected to pass on
  first run (the cache subscription already redecorates); if it does, it is kept as a
  characterisation pin and **no GREEN task follows** — say so in the commit. Satisfies FR-123.
- [ ] T152 [P] [US9] RED component `packages/ui/tests/component/link-failure-notice.test.ts` —
  `unreachable` raises exactly **one** notice naming the path and saying it did not answer, worded
  differently from `gone`. Satisfies FR-124.
- [x] T153 [US9] GREEN `packages/ui/src/renderer/links/link-actions.ts` — the notice for
  `unreachable`, through the shared failure presentation (030). Depends on T152, T146.
- [ ] T154 [US9] Hands-on, maintainer — [quickstart.md](./quickstart.md) §7 steps 1 – 7 on real
  shares, including OS Explorer showing a file on a share, which no test in this repository can
  observe. Depends on T136, T140, T146, T150. Satisfies SC-014; US9.

### 13d. The click rule, and the default link action retired [US8]

- [ ] T155 [P] [US8] RED unit(core) `packages/core/tests/unit/link-default-action.test.ts` —
  rewritten (permitted by the 2026-09-18 supersessions): no `setting` argument; folder in/out →
  `osExplorer`; out-of-project file of every type → `osExplorer`; in-project file → `preview` when
  `previewIsDefault` with no position and an enabled provider, else `editor`; an in-project
  executable → `editor` (FR-114); and a type-level assertion (`expectTypeOf`) that the result type
  excludes `'osDefaultProgram'` (FR-111). Satisfies FR-110, FR-111, FR-114.
- [x] T156 [US8] GREEN `packages/core/src/links/default-action.ts` (`ClickTarget`, − `DefaultLinkAction`,
  − `DEFAULT_LINK_ACTIONS`, − the fallback) and `packages/core/src/index.ts` exports. Depends on T155.
  **One commit with T144 and T158.**
- [ ] T157 [P] [US8] RED component — update, as the supersessions permit,
  `packages/ui/tests/component/link-default-action-wiring.test.ts`,
  `packages/ui/tests/component/link-setting-live.test.ts` (SC-008 now the detection switches and the
  timeout), `packages/ui/tests/component/link-executable-refusal.test.ts` and
  `packages/ui/tests/component/link-out-of-project.test.ts`: Ctrl+click, the chord and the plain Open
  Link item follow FR-110 in **both** panel types; and **SC-013** — across the fixture's file types
  and every extension `IExecutableExtensions` reports, in and out of the project, a spy on
  `window.throng.links.open` records **zero** calls from any gesture or plain Open Link, and exactly
  one from each explicit *Open in OS Default Program*. Satisfies FR-110, FR-111, FR-114, SC-010,
  SC-013.
- [ ] T158 [US8] GREEN `packages/ui/src/renderer/links/link-actions.ts` (− the `defaultAction` reader
  from `LinkFollowDeps` and `linkRouting`), `packages/ui/src/renderer/terminal/terminal-panel.tsx`
  and `packages/ui/src/renderer/editor/use-editor.ts` (their callers). Depends on T157, T156.
  **One commit with T144 and T156.**
- [ ] T159 [P] [US8] RED unit(core) `packages/core/tests/unit/link-hover-text.test.ts` — FR-105's
  three wordings, and `Cmd` on macOS; and edit `packages/ui/tests/unit/terminal-hovered-link.test.ts`
  (permitted) so the terminal's file wording follows the click result while its web wording is
  byte-identical. Satisfies FR-105.
- [ ] T160 [US8] GREEN `packages/core/src/links/hover-text.ts` (`linkHoverText`), delegated to from
  `packages/ui/src/renderer/terminal/hovered-link.ts` and used by the editor's tooltip in
  `packages/ui/src/renderer/editor/link-decorations.ts`. Depends on T159, T156.

### 13e. Web links in editors, and parity by construction [US8]

- [ ] T161 [P] [US8] RED unit(core) `packages/core/tests/unit/link-web-url.test.ts` — every case in
  `packages/ui/tests/unit/terminal-url.test.ts`, run against core's `WEB_URL_REGEX`, plus
  `detectWebLinks` spans and `scanLinkLine`: web spans and path candidates together, no path
  candidate overlapping a web span (D9 – D11). Satisfies FR-009, FR-102, FR-104.
- [x] T162 [US8] GREEN `packages/core/src/links/web-url.ts` (moved byte-for-byte),
  `packages/core/src/links/scan-line.ts`, `packages/core/src/index.ts`;
  `packages/ui/src/renderer/terminal/terminal-url.ts` re-exports core's pattern;
  `packages/ui/src/renderer/terminal/file-link-provider.ts` takes its claims from `scanLinkLine`.
  `packages/ui/tests/unit/terminal-url.test.ts` **must pass unchanged** (D10). Depends on T161.
  **Lands before T163 – T168.**
- [ ] T163 [P] [US8] RED unit(ui) `packages/ui/tests/unit/link-parity.test.ts` — **SC-012 / FR-104 /
  FR-106**: every line of T134's `parity.txt` through the terminal provider (fake terminal, fake
  resolver) and through the editor's per-line span function yields identical spans, kinds and
  resolved targets; one in-project file spelled every FR-106 way opens in throng from both. If the
  editor's per-line function cannot be called without a view, this task moves to the component layer
  and says so. Depends on T134, T162. Satisfies FR-104, FR-106, SC-012.
- [ ] T164 [US8] GREEN `packages/ui/src/renderer/editor/link-decorations.ts` — per-line spans from
  `scanLinkLine`; web spans decorated with no request to main; the decoration carries its kind
  (data-model §13.2). Depends on T163.
- [ ] T165 [P] [US8] RED component `packages/ui/tests/component/editor-web-links.test.ts` — G11 – G14
  and G4/G9 with web links present: Ctrl+click opens once through `window.throng.openExternal`
  (`http`/`https` only; `javascript:` and `mailto:` text are not links); plain click places the caret;
  Ctrl+drag selects; Ctrl+click off any link adds a cursor; Ctrl+Enter with one caret inside opens,
  with a selection or two carets inserts a line; no `throng:links:resolve` request is made for a web
  span; with `editor.links.detectInEditors` off, web links still work (FR-101). Satisfies FR-101,
  FR-103, SC-012.
- [ ] T166 [US8] GREEN `packages/ui/src/renderer/editor/use-editor.ts` (the `mousedown` handler and
  the window chord recognise web spans) and `packages/ui/src/renderer/links/link-actions.ts` (one web
  route both surfaces call — the terminal's existing open-external call, moved, not copied).
  Depends on T165, T164.
- [ ] T167 [P] [US8] RED component `packages/ui/tests/component/editor-web-link-menu.test.ts` — §7.2's
  run over a web link, with `Ctrl+Enter` shown; Copy Link Address copies the address as written; a
  selection gives the ordinary menu; a keyboard-opened menu composes from the caret. And a `shapeOf`
  pin for the editor menu over a web link in `packages/ui/tests/unit/menu-sections.test.ts`.
  `packages/ui/tests/component/editor-content-menu.test.ts`'s existing cases stay green.
  Satisfies FR-103, S4.
- [ ] T168 [US8] GREEN `packages/ui/src/renderer/links/link-menu-items.ts` (`webLinkMenuActions`),
  `packages/ui/src/renderer/editor/content-menu.ts`, and
  `packages/ui/src/renderer/terminal/terminal-content-menu.ts` (calls the shared builder; its output
  is unchanged item for item). Depends on T167, T166.

### 13f. Documentation and closeout

- [ ] T169 [P] Docs, in the same commits as the behaviour: `README.md` (*Highlights* — links in both
  panel types, the click rule; *Configuration* — the default link action gone, the existence-check
  timeout added), `docs/quick-start.md` (§3 terminal links on shares and the PowerShell form, §4 web
  links in editors, §7 *Make it yours* at `:603` and the menu note at `:227`, the *Keyboard
  reference*), and `CHANGELOG.md`'s `## Unreleased` 045 entry at `:51` **corrected** rather than a
  "removed" line added — the setting never reached a release. Satisfies FR-090 (amended).
- [ ] T170 Re-read `packages/ui/tests/e2e/e2e-budget.json` and
  `packages/ui/tests/e2e/parallel-plan.json`: `"total": 570` and no change; run
  `packages/ui/tests/unit/e2e-budget.test.ts`, `packages/ui/tests/unit/e2e-tags.test.ts` and the
  tier-plan guard. T125 (`terminal-modified-enter.e2e.ts:233` untouched) still holds. Depends on
  T133 – T169. Satisfies Principle V; R15.
- [ ] T171 The maintainer confirms the **derived** decisions of the third 2026-09-18 session (R17's
  retirement, FR-106's alias rule, FR-114's in-project executable, the `IExecutableExtensions`
  keep-or-retire question in plan item 6, and 044 FR-090e left alone), and the amended body of #394
  (drafted outside the repository) is posted. Nothing in 13c – 13e is blocked on it except by the
  maintainer's say-so.
- [ ] T172 Dispatch `npm run gate` against the amended branch and quote the run URL and SHA, exactly
  as T132 describes. Depends on everything above **and on Phase 14** (T173 – T196).
  *Amended 2026-09-18 (third round): and on Phase 15 (T197 – T224).*

**Checkpoint**: SC-012, SC-013 and SC-014 hold; D1 is closed with its reproduction green; the E2E
budget reads 570.

### Parallel opportunities in Phase 13

- **13b**: T137, T139 and T141 are three different test files and run alongside T135 (T136 waits for
  the maintainer; the others do not).
- **13c**: T143, T145, T147, T149, T151 and T152 are six different test files.
- **13d**: T155, T157 and T159 are different files; T155's GREEN (T156) must join T144 and T158 in
  one commit.
- **13e**: T161 first; after T162, T163, T165 and T167 are three different files.
- **Across strands**: 13c, 13d and 13e share no production file except `link-actions.ts` (T153, T158,
  T166) and `link-decorations.ts` (T160, T164) — those GREEN tasks are serialised, the REDs are not.
- **Never run two test commands at once** on this machine, whatever the above allows for writing.

---

## Phase 14: Second hands-on round 2026-09-18 — D2, wrapped links, one affordance, every flavour

**Input**: the fourth Clarifications session in [spec.md](./spec.md); [plan.md](./plan.md)
*Amendment 2026-09-18, second round*; [research.md](./research.md) R21 – R23, O9 – O11. Adds US10,
US11; FR-130 – FR-133, FR-135 – FR-139, FR-140 – FR-145; SC-015 – SC-018; defect D2. **Closes #326.**

**E2E: cases inside existing declarations only (T186); the declaration count and
`e2e-budget.json` stay at 570.** The reason, in one sentence: only a real xterm renderer with real
cell geometry shows whether its OSC 8 underline and its hover across a soft-wrapped row behave, and
jsdom has no cell geometry.

**Order**: 14a (D2) first and gated on the maintainer; 14b (wrapped links) before 14c's terminal half,
because the affordance marks the multi-row ranges 14b produces; 14d (flavours) is independent of
14b/14c and may run alongside them; T193 waits for the running matrix probe. Phase 13's T162
(`scanLinkLine`) precedes T177.

### 14a. D2 — a position suffix is not honoured [US1, US8]

- [x] T173 Amend the artifact set for the second round — [spec.md](./spec.md) (fourth session; US10,
  US11; FR-130 – FR-145; SC-015 – SC-018; D2; in-place notes on FR-007, FR-042, the wrap edge case,
  *Out of scope*; the corpus note in *Assumptions*), [plan.md](./plan.md),
  [research.md](./research.md) R21 – R23 and O9 – O11, [data-model.md](./data-model.md) §14, the
  contracts, [quickstart.md](./quickstart.md) §8 and this phase. **Done 2026-09-18.**
- [ ] T174 [US1] RED — reproduce D2 **first**, at the lowest layer that shows it:
  `packages/ui/tests/component/link-position-open.test.ts`. Use the maintainer's corpus line exactly
  (`test.md:3:5`). Cover a Markdown file whose provider is enabled and set to **Preview**, the same
  file with the default open action **Editor**, a `.ts` control, and each of those **with the file
  already open in a tab**. Follow it from a terminal (fake provider → `follow`, asserting the
  `position` it receives is `{ line: 3, column: 5 }`) and from an editor. Assert that an editor opens
  with the caret at 3:5. **Show the failing output to the maintainer and touch no production code
  until they confirm it reproduces what they saw** (the replicating-bugs gate). If every case passes,
  the layer is wrong, not the bug: step up to a case inside the existing
  `packages/ui/tests/e2e/terminal-links.e2e.ts` declaration, and say so. Covers FR-004, FR-033, FR-052,
  FR-110, SC-016.
- [x] T175 [US1] GREEN — fix D2 at the place T174 locates it. The likeliest candidates, in order:
  `packages/ui/src/renderer/links/link-actions.ts` (FR-052's branch against `previewIsDefault`),
  `packages/ui/src/renderer/editor/reveal-range.ts` (`positionRevealTarget`) and the open route for an
  already-open tab, then the terminal and editor surfaces that carry `position`. Depends on T174 and
  the maintainer's confirmation.
  *Amended 2026-09-18 (third round) — the site, located by reading and the probe, still a hypothesis
  until T174 is red:* the probe shows D2 in **terminals only** (the editor opens `test.md:3:5` at 3:5).
  The terminal's `openInEditor` performer at
  `packages/ui/src/renderer/terminal/terminal-panel.tsx:271-274` calls
  `openFileInTab(ws, tabId, link.path, openTarget)` with **no position**, under a comment deferring it
  to US3's `positionRevealTarget`, which has since landed. That is the first place T174's terminal case
  should point; the **already-open** case is the second — with `test.md` already in a tab the probe saw
  no change at all. T174 therefore MUST include the terminal route with the file already open.

### 14b. Wrapped links [US10] — closes #326

- [ ] T176 [P] [US10] RED unit(ui) `packages/ui/tests/unit/terminal-file-link-provider.test.ts`
  (single-row range assertions widened, as the second-round supersessions permit): a fake terminal
  whose rows carry `isWrapped`; a detected path, a web URL and a positioned path each wrapped across
  two and three rows yield **one** link whose range starts on the first row and ends on the last;
  `provideLinks` for **any** of those rows returns it; a row broken by a real newline is never joined
  (FR-132); the FR-072 zero-check assertions stay. Satisfies FR-130 – FR-133, SC-015.
- [ ] T177 [US10] GREEN `packages/ui/src/renderer/terminal/file-link-provider.ts` — read the logical
  line, scan it with `scanLinkLine`, map spans to cells across rows, serve **web** spans too; unload
  `WebLinksAddon` in `packages/ui/src/renderer/terminal/use-terminal.ts` (plan Complexity Tracking).
  `packages/ui/tests/unit/terminal-url.test.ts` stays unchanged and green. Depends on T176, T162.

### 14c. One affordance, marked at rest [US10]

- [ ] T178 [P] [US10] RED unit(ui) `packages/ui/tests/unit/terminal-link-idle-scan.test.ts` — with a
  fake clock and a fake terminal: no `ask` while writes arrive; the scan starts only after
  `LINK_IDLE_SCAN_MS` of quiet; a write during the scan cancels it; only rows in the viewport are
  scanned, each within the per-line cap; answers land in the same cache hover reads. The edge of
  `LINK_IDLE_SCAN_MS` goes in `packages/core/tests/unit/link-guards.test.ts`. Satisfies FR-137,
  FR-071, FR-072.
- [ ] T179 [US10] GREEN `packages/ui/src/renderer/terminal/link-idle-scan.ts` (new),
  `packages/core/src/links/limits.ts` (`LINK_IDLE_SCAN_MS`), wiring in `use-terminal.ts`.
  Depends on T178, T177.
- [ ] T180 [P] [US10] RED component `packages/ui/tests/component/link-decorations.test.ts` (colour
  assertions changed as permitted): a resolved link and a web link in the editor carry the same mark;
  dashed underline from `var(--throng-colour-linkUnderline)` at rest, solid from
  `linkUnderlineHover` on hover; **no** text colour set; the hand pointer only while the modifier is
  held. Satisfies FR-135, FR-136, FR-138.
- [ ] T181 [P] [US10] RED unit(core) `packages/core/tests/unit/theme-link-tokens.test.ts` —
  `linkUnderline` (parent `accent`) and `linkUnderlineHover` (parent `linkUnderline`) exist in every
  shipped theme's token set, each has exactly one descriptor, both sit in the **General** area
  (`assertThemeAreaGroups`, `assertEveryKeyDescribed`), and the shipped-defaults version test sees the
  bump. Satisfies FR-138.
- [x] T182 [US10] GREEN `packages/core/src/config/theme.ts`, `packages/core/src/config/theme-metadata.ts`,
  and `SHIPPED_DEFAULTS_VERSION` in `packages/core/src/config/shipped-defaults.ts` per its own rule.
  Depends on T181.
- [ ] T183 [US10] GREEN `packages/ui/src/renderer/editor/link-decorations.ts` — the mark's theme
  becomes the tokens and the three states; no recolour. Depends on T180, T182, T164.
- [ ] T184 [US10] Settle **O10** — can xterm's OSC 8 underline take the token's colour and the
  dashed-at-rest / solid-on-hover states, or must throng's decoration draw it instead (FR-139)? A
  read of the pinned `@xterm/xterm` version's renderer options and a spike, recorded in R22. No
  production code.
- [ ] T185 [P] [US10] RED unit(ui) `packages/ui/tests/unit/terminal-link-affordance.test.ts` — over a
  fake terminal's decoration API: a mark is registered on **every** row of every resolved link, web
  link and OSC 8 link in view; the hover state spans all rows (FR-131); the pointer class is applied
  only with the modifier; marks are removed when a cached answer is invalidated. Satisfies FR-130,
  FR-135, FR-136, FR-139.
- [ ] T186 [US10] RED e2e — **cases inside existing declarations, no new `test(`**: in
  `packages/ui/tests/e2e/terminal-links.e2e.ts`, a web URL, a detected path and an OSC 8 link each
  soft-wrapped by a narrowed panel are marked on every row at rest with the same decoration class;
  in `packages/ui/tests/e2e/terminal-link-once.e2e.ts`'s existing `@reserve:pty` declaration, a
  Ctrl+click on the **second** row of each opens it exactly once. Answers **O9**. Satisfies FR-130,
  FR-131, FR-135, SC-015, SC-017.
- [ ] T187 [US10] GREEN `packages/ui/src/renderer/terminal/link-marks.ts` (new — xterm decorations
  for at-rest and hover marks), `use-terminal.ts` wiring, `packages/ui/src/renderer/terminal/terminal.css`
  (token variables only, no literal colour), and the OSC 8 route O10 chose. Depends on T184, T185,
  T186, T177, T179, T182.

### 14d. Every terminal flavour [US11]

- [ ] T188 [P] [US11] RED unit(ui) — extend `packages/ui/tests/unit/terminal-link-base-directory.test.ts`:
  for each built-in flavour id, with `terminals.shellIntegration` on and off, the link request's
  `baseDirectory` is the cwd store's value when `flavourReportsDirectory(id, enabled)` is true and is
  **absent** when it is false — never the launch directory (FR-142, FR-143); a user-defined WSL
  flavour gets no base directory (FR-144) — **expected red**, because `flavourReportsDirectory`
  answers `true` for any flavour outside the integration maps (data-model §14.4). The other cases may
  pass on first run; any that do are kept as characterisation pins.
- [ ] T189 [US11] GREEN — `packages/ui/src/renderer/terminal/terminal-panel.tsx` (the site's
  `baseDirectory`) consults `flavourReportsDirectory` **and** a platform answer to "is this flavour
  WSL?", placed behind the platform abstraction beside the shell detection that already recognises
  WSL's `System32\bash.exe` (`packages/platform-windows/src/windows-shell-detection.ts`), with a
  contract case. 025's own callers of `flavourReportsDirectory` are left unchanged. Depends on T188.
- [ ] T190 [P] [US11] RED integration
  `packages/platform-windows/tests/integration/terminal-link-flavours.integration.test.ts` — for each
  built-in flavour **installed on the machine**, and WSL where a distro is configured, spawn the real
  shell on 025's `shell-history.integration.test.ts` shape: after `cd sub`, the directory arrives
  (observed for `cmd`; OSC 9;9 for the other three with integration on) in a form comparable with the
  project root (025 FR-032f); and an OSC 8 sequence the shell prints reaches the PTY output **intact**
  through ConPTY. A flavour not installed is skipped **with the reason printed**, never passed.
  Satisfies FR-141, FR-142, FR-144, SC-018.
- [ ] T191 [US11] GREEN — make T190 green. **Expected to need no production change** for the built-in
  flavours; where a flavour's path strips OSC 8, record it per flavour in R23 and rely on FR-141's
  detection fallback rather than working around ConPTY. Depends on T190.
- [ ] T192 [US11] Hands-on, maintainer — run `D:\git\throng_tests\test 1\links-test.sh` (the corpus;
  not copied into the repo) in a terminal of every installed flavour, per
  [quickstart.md](./quickstart.md) §8, and record each section's outcome against FR-145's cells.
- [x] T193 [US11] Record the running **Playwright matrix probe**'s results against FR-145's cells in
  [research.md](./research.md) **O11**, per flavour. A failing cell becomes an appended task with its
  own RED test at the lowest layer that shows it — never a silent fix. If the probe is kept as a
  committed spec, it lives as cases inside existing declarations or is paid for under R15's rule.
  Depends on the probe finishing.
  **Done 2026-09-18** — recorded in O11; every failing row is mapped in Phase 15, and the failures no
  task covered became FR-150 – FR-154, D3, D4 and T197 – T224. The probe was temporary and is not
  committed.

### 14e. Closeout

- [ ] T194 [P] #326: the PR states **closes #326** (FR-130), and the issue is claimed and released
  through the `github-issue-state` skill. **The coordinator does this, not the spec** — recorded
  here so it is not forgotten.
- [ ] T195 [P] Docs in the same commits as the behaviour: `README.md` and `docs/quick-start.md` —
  links are marked at rest, wrapped links, the two link tokens in the theme editor, flavour behaviour
  (including WSL's project-root fallback); `CHANGELOG.md`'s unreleased 045 entry, including #326.
  Satisfies FR-090.
- [ ] T196 Re-read `packages/ui/tests/e2e/e2e-budget.json` after T186: `"total": 570`, unchanged;
  run the budget, tag and tier-plan guards. Depends on T186.

**Checkpoint**: SC-015 – SC-018 hold; D2 closed with its reproduction green; #326 closed; the budget
reads 570.

**Parallel**: T176, T178, T180, T181, T185, T188 and T190 are seven different test files and may be
written together; GREEN tasks touching `use-terminal.ts` (T177, T179, T187) are serialised.

---

## Phase 15: Third round 2026-09-18 — the maintainer's corpus, run by a probe

**Input**: the fifth Clarifications session in [spec.md](./spec.md); [plan.md](./plan.md)
*Amendment 2026-09-18, third round*; [research.md](./research.md) O11 (the matrix). Adds US12;
FR-150 – FR-154; SC-019 – SC-020; defects D3 and D4. Every failing row of the matrix was first
matched to the requirement and task that already cover it (15b); only what nothing covered is new.

**E2E: one case inside an existing declaration (T213); the declaration count and
`e2e-budget.json` stay at 570.** The reason, in one sentence: xterm draws its own OSC 8 underline
in its renderer, and only a real renderer shows whether it is gone for a dead target.

**Order**: 15c (spaces), 15d (Git Bash paths) and 15e (`file:` paths) are core-first and independent
of each other except that T206 and T211 both edit `resolve.ts` and are serialised; 15f waits for
T184 and T187; D3 (15g) and D4 (15h) are reproduce-first and gate on the maintainer; 15i last.

### 15a. Artifacts

- [x] T197 Amend the artifact set for the third round — [spec.md](./spec.md) (fifth session; US12;
  FR-150 – FR-154; SC-019, SC-020; D3, D4; the located D2 site; in-place notes on FR-012, FR-024,
  FR-025, FR-038, FR-136, FR-145; four supersession rows; the tests the third round permits to
  change; *Key Entities*; *Out of scope*), [plan.md](./plan.md) (third-round design and Complexity
  Tracking, including the WSL deferral to #13), [research.md](./research.md) (O9 evidence, O11
  recorded), and this phase. **Done 2026-09-18.** Nothing was deleted.
- [x] T198 [P] Amend the design artifacts for FR-150 – FR-154: `contracts/link-resolution.md` (the
  extended-reading rule beside R7, the mount-table step and drive qualification in R6/R9, the `file:`
  readings in R8, and the dead-OSC-8 rule beside the affordance), `contracts/platform-ports.md` (the
  new `IPathForms` questions and their contract cases), [data-model.md](./data-model.md) (a §15 for the
  resolution context's WSL flag), and [quickstart.md](./quickstart.md) (a §9 hands-on block for US12's
  scenarios). No code. Satisfies FR-150 – FR-154.
  **Done 2026-09-18** — `contracts/link-resolution.md` §8 (D16 – D19, R13 – R16, V1 – V4, P15; notes
  on R8, R9 and §5's T130 note), `contracts/platform-ports.md` §6 (four `IPathForms` members, PF13 –
  PF19, the WSL answer placed, SI5 and FR-038's wiring for D4), `contracts/menus-and-gestures.md` §8
  (dead-hyperlink table, G16/G17, D3's first-character clause), `contracts/settings-and-environment.md`
  §7 (`wslFlavour` on the request, I7), [data-model.md](./data-model.md) §15 (including five
  corrections to stale earlier sections), [quickstart.md](./quickstart.md) §9 (and two corrections).
  **Names settled for T203 – T211**: `IPathForms.fromMountTable`, `qualifyRooted`, `fileUrlLocalPath`,
  `loopbackFromFileUrl`; `LinkResolutionContext.wslFlavour` / `LinkResolutionRequest.wslFlavour`;
  `MAX_PATH_SPACE_WORDS`.

### 15b. Every failing row, and the task that covers it

The four terminal flavours failed the **same** 30 rows (numbers are the corpus rows in O11's matrix).
"New" marks the rows nothing covered before this phase.

| Row(s) | Text | Surface | Failure | Covered by |
|---|---|---|---|---|
| 3, 24, 26, 27, 32, 34, 35, 42, 66 | `file:///C:/…win.ini` (OSC 8 and text), `C:\…win.ini`, `C:/…`, `\\localhost\C$\…`, `//localhost/C$/…`, `/c/…`, `/mnt/c/…`, the long OSC 8 `.dll` | terminal | out-of-project file opened in its default program | **T155 – T158** (FR-110, FR-111): `default-action.ts:41`'s fallback is exactly what T156 deletes |
| 24 – 27, 32, 34, 35 (middle), 42, 58 (middle), 59, 61, 62, 63, 65 | the same forms, and the long paths | editor | out-of-project file opened in its default program | **T155 – T158** |
| 5 | OSC 8 `file://localhost/C$/Windows/win.ini` | terminal | underlined; Ctrl+click inert | **New — T209 – T211** (FR-153); its dead-while-unresolved look is **T212 – T214** (FR-154) |
| 13, 14, 15 | OSC 8 to a missing file, a missing host, `notascheme:foo` | terminal | underline and hand pointer on a non-link | **New — T212 – T214** (FR-154) |
| 28, 36 | `D:\git\throng_tests\test 1\test.md`, `/d/git/throng_tests/test 1/test.md` | both | never recognised (the space) | **New — T199 – T202** (FR-150) |
| 43 | `/mnt/d/git/throng_tests/test 1/test.md:3` | both | never recognised; then the position | **New — T199 – T202** (FR-150), then **T174/T175** (D2) |
| 30, 31 | `test.md:3`, `test.md:3:5` | terminal | opened at 1:1 | **T174/T175** (D2) — site now named in T175's amendment |
| 38, 39 | `/usr/bin/bash.exe`, `/etc/hosts` | both | not recognised as Git Bash paths | **New — T203 – T208** (FR-151) |
| 40 | `/tmp` | both | followed to the current drive's `\tmp` with the text as written | **New — T203 – T208** (FR-151, FR-152) |
| 44 | `file:///c/Windows/win.ini` | both | not recognised | **New — T209 – T211** (FR-153) |
| 45 | OSC 8 `file:///mnt/c/Windows/win.ini` | terminal | Ctrl+click inert | **New — T209 – T211** (FR-153) |
| 58, 59, 61, 62, 63, 65 | long plain-text paths, wrapped at 144 columns | terminal | not a link on either row | **T176/T177** (FR-130 – FR-133), marks **T185 – T187**; once linked, the click rule (**T155 – T158**) |
| 60 | `C:\Program Files\Common Files\…bundle.js`, wrapped | terminal | not a link | **T176/T177** and **New — T199 – T202** (the spaces) |
| 60 | the same | editor | not a link | **New — T199 – T202** |
| 66 (76-column pass) | wrapped OSC 8 link | terminal | hover underline on the hovered row only (#326) | **T185 – T187** (FR-131, FR-135); activation from row 2 already works (O9 evidence) |
| 19 – 23, 64, 69 – 74 | plain-text `http`/`https` URLs | editor | not a link | **T161 – T168** (FR-101 – FR-104) |
| 35, 58 (first character) | `/c/Windows/win.ini`, the long `…Resources.dll` | editor | Ctrl+click placed a caret on a decorated link, 2 of 27 first-character clicks | **New — D3, T215/T216** |
| — (no row) | FR-038, by reading `main.ts:934` | app | de-elevating launcher never supplied | **New — D4, T217/T218** |
| WSL rows | — | WSL flavour | not run: no WSL flavour configured | **New — T220** (evidence only; Linux paths deferred to #13) |

### 15c. Paths containing spaces [US12]

- [ ] T199 [P] [US12] RED unit(core) `packages/core/tests/unit/link-detect.test.ts` — **FR-150**: each
  anchored form followed by ` 1\test.md` / ` 1/test.md` / ` Files\x` yields its extended readings
  **longest first** and the unextended token last, each with FR-004's position readings (so
  `/mnt/d/a b/c.md:3` carries `:3`); a reading never extends into a word beginning an anchored form
  (`C:\a.txt C:\b.txt` → two candidates, no joined reading), never into a web span, never past an
  unbalanced bracket or a quote; a bare word never starts one; the word cap is honoured at its edge
  (`MAX_PATH_SPACE_WORDS`, with the edge in `packages/core/tests/unit/link-guards.test.ts`); the
  SC-003 prose fixture, **extended with spaced prose after a path**, still yields zero candidates that
  are not anchored. Satisfies FR-150, SC-003, SC-020.
- [x] T200 [US12] GREEN `packages/core/src/links/detect.ts` (`emitReadings` gains the extension) and
  `packages/core/src/links/limits.ts` (`MAX_PATH_SPACE_WORDS`, Complexity Tracking third round).
  `links-no-os-names.test.ts` stays green. Depends on T199.
- [ ] T201 [P] [US12] RED integration `packages/ui/tests/integration/file-link-resolver.integration.test.ts`
  — over a real temp tree holding `with space/notes.md` (add it to `packages/ui/tests/fixtures/links/`,
  and a line per spaced form to T134's `parity.txt`): a drive path, a `/x/…` Git Bash form, a
  `/mnt/x/…` WSL form and a `file:` URI with `%20` each resolve to it; `see <root>\with space\notes.md
  for details` resolves to `notes.md` and not further; a spaced reading that names nothing leaves the
  unextended token's answer unchanged. Satisfies FR-150, SC-020.
- [x] T202 [US12] GREEN — make T201 green. **Expected to need no production change** beyond T200 (the
  resolver already takes the first reading that exists); if one is needed it is a new finding,
  recorded in R-notes before it is made. Depends on T201, T200.
  *Done 2026-09-18:* one production change was needed, recorded as research.md R24 — `readingsOf`
  no longer re-detects a shorter reading out of a requested extended one.

### 15d. Git Bash's own paths, and drive-qualified rooted paths [US12]

- [ ] T203 [P] [US12] RED contract — extend `packages/core/src/testing/path-forms-contract.ts` and
  `packages/platform-windows/tests/contract/windows-path-forms.contract.test.ts` with the new
  `IPathForms` questions (names settled in T198): over an injected Git install root and mount table,
  `/usr/bin/bash.exe` → `<root>\usr\bin\bash.exe`, `/bin/x` → Git's `/usr/bin` mapping, `/etc/hosts`
  → `<root>\etc\hosts`, `/tmp` → the user's temp folder, `/c/x` and `/mnt/c/x` → `null` (they are
  `fromDriveForm`'s), no Git install → `null` for every input; and drive qualification — `\tmp`
  against a base on `D:` → `D:\tmp`, against no base → `null`. Total: `null`, never a throw, for
  junk. Satisfies FR-151, FR-152, FR-026.
- [x] T204 [US12] GREEN `packages/core/src/abstractions/path-forms.ts` (the two questions),
  `packages/core/src/testing/path-forms-contract.ts`, and
  `packages/platform-windows/src/windows-path-forms.ts` — the Git install root from the shell
  detection that already finds Git Bash (`packages/platform-windows/src/windows-shell-detection.ts`,
  005 FR-024), Git's `etc/fstab` and its default mounts read once and cached. Depends on T203.
- [ ] T205 [P] [US12] RED unit(core) `packages/core/tests/unit/link-resolve.test.ts` — FR-151's order
  for a non-drive leading-`/` path: project root, drive form, **mount table**, then the
  **drive-qualified** platform meaning (FR-152); with the context marking a WSL flavour, the mount-table
  and platform steps are absent; with no base directory and no project root, `/test.txt` yields `[]`;
  no list ever contains a rooted path without a drive. Edits only the three cases the third-round
  supersessions permit (spec *Supersessions*); every other case stays. Satisfies FR-151, FR-152.
  *Amended 2026-09-18 (T198):* plus its contract half, in
  `packages/ui/tests/contract/link-ipc.contract.test.ts` — the request whitelist admits
  `wslFlavour: true` and drops any other value (settings-and-environment §7.1, I7). That file has
  uncommitted work in progress from another session; coordinate before editing it.
- [ ] T206 [US12] GREEN `packages/core/src/links/resolve.ts` (the step, the qualification, the WSL
  flag on `LinkResolutionContext`) and the surfaces that build the context —
  `packages/ui/src/main/file-link-resolver.ts`, and the terminal site that already asks T189's "is this
  flavour WSL?" (`packages/ui/src/renderer/terminal/terminal-panel.tsx`), sending it in the link
  request. Depends on T205, T204, T189.
  *Progress 2026-09-18:* the `resolve.ts` half is in (R13 step, R14 qualification,
  `LinkResolutionContext.wslFlavour`). Open: `file-link-resolver.ts` passing the request's
  `wslFlavour` into the context, and `terminal-panel.tsx` sending it — with T205's contract half.
  Two T205 cases stay red on a spec conflict (`/test.txt` with no anchor: R13 keeps Git's reading,
  T205 says `[]`), awaiting the maintainer.
  *Progress 2026-09-18 (main):* `file-link-resolver.ts` carries the request's `wslFlavour` into the
  context and `link-ipc.ts` admits exactly `true` (I7; T205's contract half green). Open: only
  `terminal-panel.tsx` sending it.
- [ ] T207 [P] [US12] RED integration `packages/ui/tests/integration/file-link-resolver.integration.test.ts`
  — against the **real** Git for Windows on the machine: `/usr/bin/bash.exe` and `/etc/hosts` resolve
  to files under the detected install, `/tmp` resolves to a folder; a WSL-flavour request for
  `/etc/hosts` does **not** resolve through Git. Skipped **with the reason printed** where Git for
  Windows is not installed. Satisfies FR-151, SC-019.
- [x] T208 [US12] GREEN — only if T207 is red after T206. Depends on T207, T206.

### 15e. POSIX spellings inside `file:` URIs [US12]

- [ ] T209 [P] [US12] RED unit(core) `packages/core/tests/unit/link-resolve.test.ts` — **FR-153**, with
  a fake `IPathForms`: `file:///c/Windows/win.ini` yields the same list as `/c/Windows/win.ini`;
  `file:///mnt/c/Windows/win.ini` as `/mnt/c/…`; `file:///usr/bin/bash.exe` as `/usr/bin/bash.exe`;
  `file://localhost/C$/Windows/win.ini` ends with `\\localhost\C$\Windows\win.ini` after its local
  readings; `file:///C:/x`, `file://localhost/D:/x` and `file://server/share/x` are unchanged.
  Satisfies FR-153, FR-012.
- [ ] T210 [P] [US12] RED contract — `packages/core/src/testing/path-forms-contract.ts` and
  `windows-path-forms.contract.test.ts`: whatever split T198 settles between the port and `resolve.ts`
  for "decoded path, and whether it is drive-qualified", answered totally; the existing `fromFileUrl`
  cases (`file://localhost/D:/x` = `file:///D:/x`, hosted ≠ hostless) stay exactly as they are.
  Satisfies FR-153, FR-026.
- [x] T211 [US12] GREEN `packages/core/src/links/resolve.ts` (the `file:` branch re-enters the
  leading-`/` rules; the loopback reading) and the port method T210 needs. Depends on T209, T210, and
  on T206 (same file, serialised).

### 15f. A hyperlink that goes nowhere looks like text [US12]

- [ ] T212 [P] [US12] RED unit(ui) `packages/ui/tests/unit/terminal-link-affordance.test.ts` (T185's
  file, written to FR-154) and `packages/ui/tests/unit/terminal-link-activation.test.ts` — OSC 8 targets
  `notascheme:foo`, an empty target, `file:///C:/does/not/exist.txt` (resolver answers not found) and
  `file://nonexistent-host-xyz/share/file.txt` (resolver answers unreachable) register **no** mark, no
  hover decoration, no pointer class and no tooltip; a Ctrl+click on one is **not** swallowed (FR-043's
  pass-through) and raises no notice; an OSC 8 `file:` target is marked only after the idle scan or a
  hover resolves it, and gains its mark without pointer movement when a late answer arrives (FR-123);
  an `https` OSC 8 target is marked as drawn. Satisfies FR-154, FR-013, FR-043.
- [ ] T213 [US12] RED e2e — **a case inside the existing `packages/ui/tests/e2e/terminal-links.e2e.ts`
  declaration, no new `test(`**: a program prints the three dead OSC 8 hyperlinks from the corpus; at
  rest and on hover none carries xterm's OSC 8 underline class or throng's mark, and the pointer stays
  the text cursor. Only a real renderer draws xterm's own underline. Satisfies FR-154, FR-139.
- [ ] T214 [US12] GREEN `packages/ui/src/renderer/terminal/use-terminal.ts` (the OSC 8 `linkHandler`'s
  hover/leave consult the click rule's answer before drawing anything),
  `packages/ui/src/renderer/terminal/link-marks.ts` and the OSC 8 underline route O10 chose (suppressed
  for a dead target), and `packages/ui/src/renderer/terminal/link-idle-scan.ts` (OSC 8 `file:` targets
  join the scan). Depends on T212, T213, T184, T187, T179.

### 15g. D3 — an editor Ctrl+click on a link's first character misses it [US3, US8]

- [ ] T215 [US3] RED — reproduce D3 **first**, at the lowest layer that shows it:
  `packages/ui/tests/component/editor-link-gestures.test.ts`. Use the probe's two lines verbatim
  (`/c/Windows/win.ini` and the long `…Resources.dll` path at column 1), decorated as out-of-project
  links; Ctrl+mousedown on the **first character**, both cold and immediately after a Ctrl+click on the
  previous line's link returned; assert the follow is called once and no caret is added. **Show the
  failing output to the maintainer and touch no production code until they confirm it** (the
  replicating-bugs gate). If every case passes, the layer is wrong, not the bug: step up to a case
  inside an existing editor E2E declaration and say so; if that cannot reproduce it either, record what
  was tried and the missing condition in O11 as a note — not a fix. Covers FR-040, FR-100, FR-110.
- [ ] T216 [US3] GREEN — fix D3 where T215 locates it; the likeliest places, in order:
  `packages/ui/src/renderer/editor/use-editor.ts` (the `mousedown` handler's span lookup at a span's
  start boundary) and `packages/ui/src/renderer/editor/link-decorations.ts` (the span set the handler
  reads against the one drawn). Depends on T215 and the maintainer's confirmation.

### 15h. D4 — FR-038's de-elevation is not wired into the app

- [ ] T217 RED unit(ui) `packages/ui/tests/unit/shell-integration-wiring.test.ts` — reproduce D4
  first: the function the composition uses to build the app's `ElectronShellIntegration` (extracted
  from `packages/ui/src/main/main.ts:934` by T218 — until then the test asserts against main's source,
  structurally, on the `links-no-os-names.test.ts` pattern) supplies a de-elevating launcher and an
  elevation probe; with the probe answering elevated and a fake launcher, `revealInFileManager`,
  `openFolder` and `openWithDefaultProgram` go through the launcher and never through `shell.*`.
  **Show the failing output to the maintainer before any fix.** The existing `@admin`
  `link-de-elevated-open.integration.test.ts` MUST NOT change: it proves the route, this proves the
  wiring. Covers FR-038.
- [x] T218 GREEN `packages/ui/src/main/main.ts` (and a small factory beside
  `packages/ui/src/main/electron-shell-integration.ts` if T217 needs a seam) — construct
  `WindowsDeElevatedLauncher` (`@throng/platform-windows`) and pass it with
  `() => new WindowsElevation().isElevated()` (the probe already used at `main.ts:704`) as
  `DeElevationOptions`; research O2 already established the launcher is available in UI main, so no
  RPC is involved. Depends on T217 and the maintainer's confirmation.

### 15i. Evidence, docs and closeout

- [ ] T219 [US12] Re-run the corpus through the probe in every installed built-in flavour and an
  editor, after 13d, 13e, 14a – 14c and 15c – 15h are green, and record the new matrix in O11 beside
  the first. **SC-019 is 0 FAIL.** A row that still fails becomes an appended task with its own RED
  test, never a silent fix. Depends on T158, T168, T175, T187, T202, T208, T211, T214, T216.
- [ ] T220 [US11] [US12] Configure a **user-defined WSL flavour** (025 FR-011; WSL is not a built-in —
  005 FR-024, epic #13) where a distro is installed, and run the corpus and FR-145's cells in it:
  `/mnt/<drive>/…` maps (FR-025), relative paths resolve against the project root (FR-144), Git Bash's
  mount table is **not** applied (FR-151), and Linux filesystem paths are recorded as not links —
  deferred to #13, never counted as a failure of this spec. Record the row in O11; a machine with no
  distro records **not run**. Satisfies FR-140, FR-145, SC-018.
- [ ] T221 [P] Docs in the same commits as the behaviour: `README.md` and `docs/quick-start.md` — paths
  with spaces, Git Bash paths (`/usr/…`, `/etc/…`, `/tmp`) and why WSL's Linux paths are not links yet,
  `file:` URIs in any spelling, and that a program's hyperlink to nothing is shown as plain text;
  `CHANGELOG.md`'s unreleased 045 entry. Satisfies FR-090.
- [ ] T222 Re-read `packages/ui/tests/e2e/e2e-budget.json` after T213: `"total": 570`, unchanged; run
  the budget, tag and tier-plan guards. Depends on T213.
- [ ] T223 The maintainer confirms the **derived** decisions of the fifth session: FR-150's grammar
  (anchored forms only, longest existing reading, the word cap), FR-151 applying in editors and in
  non-Git-Bash flavours, FR-153's loopback reading, and FR-154's "no notice". Nothing in 15c – 15f is
  blocked on it except by the maintainer's say-so.
- [ ] T224 [P] Record the deferred WSL Linux-path link mapping on issue #13 (a comment naming FR-151's
  WSL exclusion and plan *Complexity Tracking*, third round), through the `github-issues` skill. **The
  coordinator does this, not the spec.**

**Checkpoint**: SC-019 and SC-020 hold; D3 and D4 closed with their reproductions green; the budget
reads 570.

**Parallel**: T199, T201, T203, T205, T207, T209, T210, T212, T215 and T217 are different test files
(T205 and T209 share `link-resolve.test.ts` and are written in sequence); GREEN tasks touching
`resolve.ts` (T206, T211) and `use-terminal.ts` (T214 with Phase 14's T177, T179, T187) are
serialised.

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Why |
|---|---|---|
| 1 Setup & amendments | — | starts immediately |
| 2 Foundational | T001 (for the SC-003 fixture in T008) | **blocks every story** |
| 3 Resolver + IPC | Phase 2 complete | both surfaces consume it; a renderer stand-in would be the second implementation of FR-010 |
| 4 US2 | Phase 3 | first slice — no detection needed |
| 5 US1 | Phase 4 (T065's `hoveredLink` type change) | US1 adds a producer of a value US2 defined |
| 6 US4 | Phase 5 | the menu is proved against a surface that already exists |
| 7 US3 | Phase 6 (T078's `link-menu-items.ts`) | both menus compose from the same shapes |
| 8 US5 | Phase 6 | the fallback needs the target states the menu already consumes |
| 9 US6 | T071 and T091 | a switch needs something to gate |
| 10 US7 | Phase 2 only | **fully independent** — may run from the start |
| 11 E2E | Phases 4, 5 | after the surfaces the cases drive |
| 12 Docs & closeout | the slice each doc describes | each doc edit ships in that slice's commit |
| 13 Change request (2026-09-18) | Phases 1 – 11 as delivered | amends shipped slices; 13b gates on the maintainer confirming D1's reproduction; T172 supersedes T132 as the done-ness gate |
| 15 Third round (2026-09-18) | T134, T155 – T158, T162, T184, T187, T189 | 15c – 15e extend the resolution rules 13 and 14 leave in place; 15f builds on 14c's marks; D3 and D4 gate on the maintainer confirming their reproductions; T219 re-runs the matrix last |

### Within a slice

RED before GREEN, always. A GREEN task may not start until its RED task has been **run and observed
failing** — a test that has never been red proves nothing.

### Parallel opportunities

- **Phase 1**: T001–T006 are six different files; all six at once. T007 folds in T002–T005.
- **Phase 2**: the seven RED tasks T008, T010, T012, T014, T016, T018, T020 are seven new files with
  no dependency between them. T022, T023, T027, T031, T033, T035, T037, T040, T042 likewise. The
  port chains (T023→T024→T025→T026 and T027→T028→T029→T030) run as **two independent tracks**.
- **Phase 3**: T046, T048, T051, T052, T054, T056, T059, T061 are eight different test files.
- **Phases 4–10**: US7 (Phase 10) is independent of every other story and can be staffed in parallel
  with any of them from the moment Phase 2 is green. US6 (Phase 9) is independent of US3/US4/US5 in
  design but needs T071 and T091 to have something to gate.
- **Phase 12**: T126–T130 are five different files.

**Never run two test commands at once on this machine**, whatever the parallelism above allows for
*writing*. One test, lint, typecheck or build command at a time — the **running-tests** skill owns
that rule, and E2E saturates every core.

### Parallel example — Phase 2's grammar and decisions

```bash
# Seven RED tasks, seven new files, no shared state:
T008 packages/core/tests/unit/link-detect.test.ts
T010 packages/core/tests/unit/link-classify.test.ts
T012 packages/core/tests/unit/link-resolve.test.ts
T014 packages/core/tests/unit/link-membership.test.ts
T016 packages/core/tests/unit/link-targets.test.ts
T018 packages/core/tests/unit/link-default-action.test.ts
T020 packages/core/tests/unit/link-menu.test.ts
```

---

## Implementation Strategy

### MVP — US2 first, not US1

[plan.md](./plan.md) *Sequencing* step 3: **US2 is the MVP**, ahead of US1 despite the spec listing
US1 first. It needs no detection, so it exercises resolve → classify → act end to end at the smallest
possible size, and it delivers **SC-005 — the report that started the feature — in one slice**.

1. Phase 1 (amendments and fixtures) → Phase 2 (everything pure) → Phase 3 (the one authority).
2. Phase 4 (US2). **STOP and validate**: quickstart §3's US2 row.
3. Phase 5 (US1) → Phase 6 (US4) → Phase 7 (US3, with the constitution PATCH) → Phase 8 (US5).
4. Phase 9 (US6) and Phase 10 (US7) at any point after Phase 2.
5. Phase 11 (E2E) → Phase 12 (docs and closeout) → `npm run gate`.

### Incremental delivery

Every phase from 4 onward is a shippable increment: US2 alone makes the maintainer's status line
work; US1 alone makes compiler errors followable; US4 alone adds the menu; each is independently
testable by its own row in [quickstart.md](./quickstart.md) §3. No capability is deferred — the two
Out-of-scope items the spec names belong to other issues (#326 already exists for one), and there is
no ROADMAP.md to put them in.

---

## Notes

- **The stale-`dist` trap bites this feature hardest.** Vitest resolves `@throng/core` to **source**;
  the Electron app loads `packages/core/dist`. The Key Bindings editor's Scope column for
  `preview.followLink` and every settings descriptor are read from `dist`. If an E2E disagrees with a
  unit test about a scope, a default or a label, rebuild before debugging:
  `rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist && npm run build`.
- **Never run Prettier in this repo.** ESLint is the only formatter; `prettier --write` rewrites every
  string delimiter in every file it touches.
- **Tests these supersessions permit to change, and no others**:
  `packages/core/tests/unit/terminal-link-menu.test.ts:20` (T042),
  `packages/core/tests/unit/keybindings-preview.test.ts:42-45, :56-59, :119` (T037).
  `keybindings-preview.test.ts:61-67`, `packages/ui/tests/e2e/terminal-modified-enter.e2e.ts:233` and
  `packages/ui/tests/unit/external-url.test.ts` **must not change**.
- **`npm run gate` is the only thing that establishes done-ness** — eight stages, on a hosted runner,
  ~35 minutes. Quote the run URL and the SHA.
