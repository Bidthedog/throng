---
description: "Task list for 044 — File Previews and Panel Navigation History"
---

# Tasks: File Previews and Panel Navigation History

**Input**: Design documents from `specs/044-file-previews/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required. Constitution V is NON-NEGOTIABLE — every change ships with coverage at the
**lowest layer that can prove it**, written first and observed failing for the expected reason.

## Format

`- [ ] T### [area] [P?] [US#?] Description — exact file paths`

- **[area]** — the owning specialist agent (`.claude/agents/README.md`): `core-architecture`,
  `editor-documents`, `renderer-ui`, `config-preferences`, `explorer-fileops`, `failure-notices`,
  `e2e-harness`, `build-release`, `daemon-persistence`, `spec-governance`, or `general`.
- **[P]** — may run in the same wave as the adjacent `[P]` tasks. **A run of consecutive `[P]` tasks
  shares no file**, and no `[P]` task depends on another in its run. A non-`[P]` task always ends a run.
- **[US#]** — the user story (story phases only).
- Paths are repository-relative. `core/` = `packages/core/`, `ui/` = `packages/ui/` **only inside
  prose**; every path in a task is written in full.

## Layer rules for this feature

| Layer | Command | Use it for |
|---|---|---|
| `unit` | `npx vitest run --project unit <files>` | Pure decisions: registry, settings derivation, history reducer, link/image/request policy, scheduler, titles, layout ops, pipeline string output, menu shapes, guards |
| `component` | `npx vitest run --project component <files>` | Anything rendered in jsdom: panel chrome, sanitised DOM, gestures, menus, status bars, header controls, settings tab, routing. **Preferred over E2E** |
| `integration` | `npx vitest run --project integration <files>` | Main services over a real coordinator, `NodeFileWatcher` and temp tree; the protocol handler; persistence round trip; purge |
| `contract` | `npx vitest run --project contract <files>` | OS seams (`IClipboard`, `IShellIntegration`) and IPC channel shapes |
| `e2e` | `npx playwright test <spec>` | **Only** R22's five declarations. Each carries `@extended` + a category + exactly one `@reserve:*`; `e2e-budget.json` is re-seeded in the same task |

**Red checkpoints.** A `[general]` "Red" task follows every wave of test tasks: run exactly the named
files once, capture the full output, and confirm each fails **for the stated reason** (missing module,
missing export, wrong value) — not for a typo or an import error in the test. Load the `running-tests`
skill first. One test command on the machine at a time.

---

## Phase 1: Setup

- [x] T001 [build-release] Add runtime dependencies to `packages/ui/package.json`: `markdown-it@^15.0.2`,
      `dompurify@^3.4.15`, `yaml@^2.9.1`, and the direct declarations `@lezer/highlight` (match the
      lockfile's `1.2.3` range) and `style-mod` (match the resolved version) — research R1, R2, R4, R5,
      Open item O8. Run `npm install` once and commit the resulting `package-lock.json` in the same
      change. No `@types/*` packages (markdown-it, DOMPurify and yaml ship types). Confirm with
      `npm ls markdown-it dompurify yaml @lezer/highlight style-mod --workspace @throng/ui`.
- [x] T002 [build-release] [P] Give the preview pipeline its own lazily loaded chunk in
      `packages/ui/vite.config.ts` `manualChunks`: route `markdown-it`, `linkify-it`, `mdurl`,
      `uc.micro`, `punycode.js`, `entities`, `dompurify` and `yaml` to `preview` rather than `vendor` (R21).
- [x] T003 [e2e-harness] [P] Create test fixtures under `packages/ui/tests/fixtures/preview/`:
      `gfm.md` (every FR-080 construct, a right-aligned table column, a `mermaid` fence, `$x$` and
      `$$y$$`), `front-matter.md` (scalar, nested mapping, list values), `front-matter-invalid.md`,
      `hostile.md` (every vector listed in `contracts/security-policy.md` §Layer 2, including the
      `<mark>`, `<form name>` and spoofed `data-heading-slug` cases — and **no** `https:`
      image, so its no-request assertion holds with *Load remote images* at its shipped ON),
      `remote-images.md` (one `https:` badge image with alt text and one relative image, nothing else —
      the fixture for SC-004's setting-off half), `long-1000.md` (1,000 lines with headings every 50),
      and `links/` holding: `README.md` (links to `docs/setup.md`, `docs/setup.md#install`, `docs/missing.md`
      (a file that does not exist), `src/app.ts`, `https://example.com/` and `#readme-heading`, plus a
      `# Readme heading`); `docs/setup.md` (at least 200 lines, so it can be scrolled halfway, with an
      `## Install` heading, a `## Halfway` heading at line 100, and a link to `install.md#install` on
      line 102 — directly below that heading, so it is already in view at the halfway scroll and neither
      Playwright's Ctrl+click nor Tab focus scrolls the page before the position is captured); `docs/install.md` (an `## Install`
      heading and a link back to `../README.md`); `docs/image.png` (a 1×1 PNG, referenced from
      `setup.md` as `![](image.png)`); and `src/app.ts`.
- [x] T003a [spec-governance] **GitHub write.** Using the `github-issues` skill, file an Enhancement:
      *history and editor `filePath` do not follow a rename made while their layout is unloaded (closed
      sub-workspace or unloaded project)*, `area:editor`, milestone v1.0.0, cross-linked to #136 and this
      spec; then replace `TODO(044-tasks)` in `specs/044-file-previews/plan.md` Complexity Tracking with
      the issue number. Read the body back before creating it; no attribution footer. Done first, so the
      deferral exists as an open issue for the whole build (Incremental Delivery gate). *(Was T168.)*

---

## Phase 2: Foundational (blocking — no user story starts until this phase is done)

### 2.1 Types that every wave below imports

- [x] T004 [core-architecture] Add type-only declarations, no behaviour:
      `packages/core/src/workspace/model.ts` (`PreviewPanelConfig`, `EditorPanelConfig.history`,
      `PersistedHistory` — data-model §9); `packages/core/src/preview/panel-type.ts` (`PREVIEW_KIND = 'preview'`,
      beside the descriptor T029 adds, as `EDITOR_KIND` sits in `editor/panel-type.ts`);
      `packages/core/src/preview/provider.ts` (`PreviewProviderKind`, `ProviderSettingDeclaration`,
      `PreviewProviderDescriptor`, `PreviewProviderRegistry` interface — data-model §1–§2);
      `packages/core/src/preview/settings-types.ts` (`PreviewCopyFormat`, `DefaultOpenAction`,
      `ProviderSettings`, `PreviewSettings` — data-model §3). `LAYOUT_SCHEMA_VERSION` stays 3.

### 2.2 Core decisions — failing tests (one wave)

- [x] T005 [core-architecture] [P] `unit` — `packages/core/tests/unit/preview-registry.test.ts`:
      registration validation and the exact FR-072 message naming both providers; `forPath`
      case-insensitive by extension only; `providerFor`; `enabledProviderFor`; `previewAffordance`'s
      six-row decision table (data-model §2) — absent for no file / folder / outside project (FR-004),
      absent with no provider (FR-001, FR-003), absent for a binary provider on the editor surface
      (FR-073), **disabled** `provider-disabled` (FR-001, FR-003, FR-062), disabled `preview-open`
      (FR-012), enabled.
- [x] T006 [core-architecture] [P] `unit` — `packages/core/tests/unit/navigation-history.test.ts`:
      invariants H1–H10 (data-model §4) for `recordOpen`, `moveTo`, `canGoBack`, `canGoForward`,
      `targetOf`, `applyCap`, `rewritePaths` (file and folder moves), `rewriteCurrent`,
      `setCurrentViewState`, `parseHistory` (bad entries dropped, index clamped, cap applied, >1 KiB
      viewState dropped), `serialiseHistory`; and **SC-007** as a seeded property test: for 500 random
      op sequences, Back-then-Forward and Forward-then-Back return to the same file, and
      `parseHistory(serialiseHistory(h))` equals `h`. Covers FR-100–FR-103, FR-107, FR-108, FR-112.
- [x] T007 [core-architecture] [P] `unit` — `packages/core/tests/unit/preview-links.test.ts`:
      `classifyPreviewLink` (http/https/mailto external; relative and root-relative file with fragment;
      `#heading`; `..` escaping the project → `outside`; `javascript:`, mixed-case `JaVaScRiPt:`, `data:`,
      `file:`, `vbscript:`, entity/percent-encoded schemes → `inert`) — FR-090, FR-090e, FR-091;
      `resolvePreviewImage` (relative against the document folder → `project`; https with
      `remoteImages` on → `remote`, off → `blocked`; http, `file:`, `data:`, `//host`, outside → `blocked`)
      — FR-084, FR-092, FR-093; `headingSlug` GitHub-style with de-duplication; `markdownHeadingLine`
      (FR-090d); `languageForFenceInfo` (`ts`, `py`, `sh`, `TypeScript`, unknown → `plaintext`,
      `mermaid` → `plaintext`, FR-086).
- [x] T008 [core-architecture] [P] `unit` — `packages/core/tests/unit/renderer-request-policy.test.ts`:
      every row of `contracts/security-policy.md` §Layer 4 for `decideRendererRequest` (incl. http image,
      https stylesheet, https xhr/fetch, `file:` outside the renderer dir → cancel; `data:` and `blob:`
      of any resource type → allow, the drag ghost window's `data:text/html` page among them); and
      `resolvePreviewAsset(route, { projectRoot, docPath, mimeAllowlist })` → 403 outside, 404-shaped
      result for a missing relPath, 415 for an extension not in the allowlist — FR-074, FR-084, FR-093.
- [x] T009 [core-architecture] [P] `unit` — `packages/core/tests/unit/settle-scheduler.test.ts` with an
      injected fake clock: trailing flush after `delayMs`; forced flush no later than `maxWaitMs` after
      the first unshown change under continuous changes; `flush()` immediate; the SC-002 arithmetic
      (300 ms delay leaves ≥ 700 ms of a 1 s budget) — FR-022, FR-028, FR-060, FR-060a.
- [x] T010 [core-architecture] [P] `unit` — `packages/core/tests/unit/front-matter.test.ts`:
      `splitFrontMatter` — `---` on line 1 only, closing `---`, CRLF, trailing whitespace, unclosed
      fence → no front matter, correct `bodyLineOffset` — FR-085.
- [x] T011 [core-architecture] [P] `unit` — `packages/core/tests/unit/preview-panel-title.test.ts`:
      `panelDisplayTitle` preview branch — parented `<parent display title> - Preview`, standalone
      `<derived editor title> - Preview`, truncation shortens the name part and never cuts
      ` - Preview` at every length up to the maximum name length — FR-031, FR-032.
- [x] T012 [core-architecture] [P] `unit` — `packages/core/tests/unit/workspace-operations-044.test.ts`:
      `addPanelBeside` left/right in a nested split (FR-010, FR-015c); `removePanelsWhere` collapses
      slots, closes an emptied tab, replaces the workspace's **last** panel with a fresh untyped panel
      (new id, default title), and is idempotent on a second run (FR-063, FR-064, FR-067).
- [x] T013 [core-architecture] [P] `unit` — `packages/core/tests/unit/path-canon-history.test.ts`:
      `canonicalisePersistedPaths` canonicalises a preview's `config.filePath` (already a
      `CONFIG_PATH_KEYS` key) and every `config.history.entries[].filePath` on editor and preview panels,
      leaves non-string values untouched, and returns the layout by identity when nothing changed —
      FR-068, FR-109; and `previewPathOf(config)` returns the persisted history's current entry path when
      the history is present and non-empty, else `config.filePath`, else `undefined` (FR-066, FR-067).
- [x] T014 [config-preferences] [P] `unit` — `packages/core/tests/unit/preview-settings.test.ts`:
      `previewSettingsDefaults` (300 / 1000 / `rich`; markdown enabled, `editor`, `loadRemoteImages`
      true — FR-035b, FR-050, FR-060, FR-060a, FR-065, FR-092); `previewSettingsDescriptors` (group
      `Editor`, subgroup `Previews`; binary provider has no `defaultOpenAction` descriptor — FR-051;
      `defaultOpenAction` and own settings carry `enabledWhen: { key: 'editor.previews.providers.<id>.enabled', is: true }`
      — FR-061; labels prefixed by `displayName`); `parsePreviewSettings` tolerant per leaf and
      preserving an unknown provider id; `effectiveMaxWaitMs` (FR-060a); `defaultOpenActionFor` returns
      `editor` while the provider is disabled without mutating the stored value (FR-062);
      `remoteImagesPermitted`; `providersTurnedOff(previous, next, registry)` returns exactly the ids
      whose `enabled` went true → false (not false → false, not true → true, not a provider absent from
      `previous`, not an unregistered id) — the trigger for FR-063; and
      `leavesOfDeclared(defaults, descriptors)` has zero missing / unknown
      for a **test registry** with one text provider (one own toggle) and one binary provider (FR-071,
      SC-003 S5). The test registries are inline object literals implementing the
      `PreviewProviderRegistry` interface from T004 — never `createPreviewProviderRegistry` — so T028
      does not depend on T019 in the same wave.
- [x] T015 [config-preferences] [P] `unit` — `packages/core/tests/unit/keybindings-preview.test.ts`:
      the four actions and their scopes and chords from `contracts/settings-bindings-tokens.md`
      (`preview.open` unbound, `navigate.back` `Alt+Left`, `navigate.forward` `Alt+Right`,
      `preview.followLink` `Ctrl+Enter`); `'preview'` is a `DispatchScope`, in `EVERYWHERE`,
      `SCOPE_NAMES` and `SCOPE_ORDER`; none is scoped to `terminal`; `resolveAction` finds no collision
      in overlapping scopes; one `KEYBINDINGS_METADATA` descriptor each in group Navigate — FR-005,
      FR-096c, FR-105.
- [x] T016 [core-architecture] [P] `unit` — `packages/core/tests/unit/preview-panel-type.test.ts`: the
      preview descriptor has id `PREVIEW_KIND`, `offered: false`, an icon, and is registered in the
      default panel-type registry but absent from `listOfferable()`.
- [x] T017 [config-preferences] [P] `unit` — amend `packages/core/tests/unit/default-themes.test.ts`
      (`EXPECTED_ICON_TOKEN_COUNT` 65 → 69; `preview`, `refresh`, `navigateBack`, `navigateForward`
      present in every bundled theme) and `packages/core/tests/unit/theme-copy.test.ts` (hand-written
      label and description for each) — R17.
- [x] T018 [general] Red: `npx vitest run --project unit` once over
      `packages/core/tests/unit/{preview-registry,navigation-history,preview-links,renderer-request-policy,settle-scheduler,front-matter,preview-panel-title,workspace-operations-044,path-canon-history,preview-settings,keybindings-preview,preview-panel-type,default-themes,theme-copy}.test.ts`
      and record each failure reason.

### 2.3 Core decisions — implementation (one wave)

- [x] T019 [core-architecture] [P] Implement `packages/core/src/preview/registry.ts`
      (`createPreviewProviderRegistry`, `providerFor`, `enabledProviderFor`, `previewAffordance`),
      `packages/core/src/preview/providers/markdown.ts` (descriptor per data-model §2) and
      `packages/core/src/preview/providers/index.ts` (**the one core registration line**,
      `SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS` and `SHIPPED_PREVIEW_PROVIDERS`). Makes T005 pass.
- [x] T020 [core-architecture] [P] Implement `packages/core/src/navigation/history.ts`. Makes T006 pass.
- [x] T021 [core-architecture] [P] Implement `packages/core/src/preview/links.ts`. Makes T007 pass.
- [x] T022 [core-architecture] [P] Implement `packages/core/src/preview/request-policy.ts`
      (`decideRendererRequest`, `resolvePreviewAsset` taking a MIME allowlist rather than a provider).
      Makes T008 pass.
- [x] T023 [core-architecture] [P] Implement `packages/core/src/preview/settle-scheduler.ts`. Makes T009 pass.
- [x] T024 [core-architecture] [P] Implement `packages/core/src/preview/front-matter.ts`. Makes T010 pass.
- [x] T025 [core-architecture] [P] Add the preview branch to `packages/core/src/workspace/panel-title.ts`
      (`PREVIEW_TITLE_SUFFIX`; parent title is an input). Makes T011 pass.
- [x] T026 [core-architecture] [P] Add `addPanelBeside` and `removePanelsWhere` to
      `packages/core/src/workspace/operations.ts`. Makes T012 pass.
- [x] T027 [core-architecture] [P] Extend `canonicalisePanel` in
      `packages/core/src/workspace/persisted-paths.ts` to walk `config.history.entries[].filePath`, and
      add `previewPathOf(config)` there. Makes T013 pass.
- [x] T028 [config-preferences] [P] Implement `packages/core/src/config/preview-settings.ts`
      (`previewSettingsDefaults`, `previewSettingsDescriptors`, `parsePreviewSettings`,
      `effectiveMaxWaitMs`, `defaultOpenActionFor`, `remoteImagesPermitted`, `providersTurnedOff`), each
      taking the registry as a parameter. Makes T014 pass.
- [x] T029 [core-architecture] [P] Implement `packages/core/src/preview/panel-type.ts` (descriptor,
      `offered: false`, icon `preview`) and register it in
      `packages/core/src/panel-type/default-registry.ts`. Makes T016 pass.
- [x] T030 [config-preferences] [P] Add the four actions, the `'preview'` `DispatchScope`, `EVERYWHERE`,
      `SCOPE_NAMES`, `SCOPE_ORDER` and chords to `packages/core/src/config/keybindings.ts`, and their
      descriptors to `packages/core/src/config/keybindings-metadata.ts`. Makes T015 pass; existing
      `keybindings-metadata.test.ts`, `keybindings-scope.test.ts` and
      `terminal-reserved-keys.test.ts` stay green.
- [x] T031 [config-preferences] [P] Add icon tokens `preview`, `refresh`, `navigateBack`,
      `navigateForward` to `THRONG_THEME.icons` in `packages/core/src/config/theme.ts` and copy to
      `packages/core/src/config/theme-copy.ts`; bump `SHIPPED_DEFAULTS_VERSION` 7 → 8 in
      `packages/core/src/config/shipped-defaults.ts` (no frozen V7 record — no existing value moves).
      Makes T017 pass.
- [x] T032 [core-architecture] Export every new core module from the barrel
      `packages/core/src/index.ts`: `preview/{provider,settings-types,registry,links,request-policy,settle-scheduler,front-matter,panel-type}`,
      `preview/providers/index`, `navigation/history`, `config/preview-settings`.

### 2.4 Settings document and keyboard scope

- [x] T033 [config-preferences] [P] `unit` — failing guards: amend
      `packages/core/tests/unit/settings-metadata-040.test.ts:167-179` to permit subgroup `Previews`
      in the `Editor` group (040's pin covered status-bar keys only; FR-061, Finding 7); extend
      `packages/core/tests/unit/editor-settings.test.ts` to require `cloneEditor` to deep-clone
      `previews.providers`; extend `packages/core/tests/unit/settings-metadata.test.ts` so
      `editor.previews.*` and `editor.navigation.historySize` (10, 1–100, step 1, group
      `Editor · Navigation` — FR-108) are required leaves.
- [x] T034 [renderer-ui] [P] `unit` — amend `packages/ui/tests/unit/scope.test.ts`: `scopeFromKind('preview')`
      is `'preview'` (not `explorer`), so `file.delete`, `file.rename`, `file.cut`, `file.copy`,
      `editor.save` and `search.find` resolve to nothing while a preview is focused — FR-021.
- [x] T035 [general] Red: `--project unit` over
      `packages/core/tests/unit/{settings-metadata-040,editor-settings,settings-metadata}.test.ts` and
      `packages/ui/tests/unit/scope.test.ts`.
- [x] T036 [config-preferences] [P] Wire `editor.previews` (from `previewSettingsDefaults/Descriptors/parse`
      over `SHIPPED_PREVIEW_PROVIDERS`) and `editor.navigation.historySize` into
      `packages/core/src/config/app-settings.ts` (`EditorSettings`, `DEFAULT_APP_SETTINGS`,
      `editorSettings()`, `cloneEditor`) and spread the generated descriptors plus the `historySize`
      descriptor into `packages/core/src/config/settings-metadata.ts`, avoiding the
      `settings-metadata.ts` ↔ `app-settings.ts` import cycle. Makes T033 pass.
- [x] T037 [renderer-ui] [P] Map `'preview'` in `scopeFromKind` in
      `packages/ui/src/renderer/keybindings/scope.ts`. Makes T034 pass.

### 2.5 Platform seams (Principle II) — clipboard HTML and open-external

- [x] T038 [core-architecture] [P] `contract` — add `writeRich({ text, html })` cases to
      `packages/core/src/testing/clipboard-contract.ts` (text and html both readable back from the
      double; `readText` still plain) and run them in
      `packages/ui/tests/contract/electron-clipboard.contract.test.ts` — FR-035a.
- [x] T039 [core-architecture] [P] `contract` — add `openExternal(url)` to
      `packages/core/src/testing/shell-integration-contract.ts`; exercise it in
      `packages/ui/tests/integration/electron-shell-integration.test.ts`; extend
      `packages/ui/tests/unit/external-url.test.ts` (`mailto:` accepted; `javascript:`, `file:` refused)
      and `packages/ui/tests/unit/window-open-guard.test.ts` (opens through an injected
      `IShellIntegration`, not Electron's `shell`) — FR-091, R10.
- [x] T040 [general] Red: `--project contract` over `packages/ui/tests/contract/electron-clipboard.contract.test.ts`;
      `--project integration` over `packages/ui/tests/integration/electron-shell-integration.test.ts`;
      `--project unit` over `packages/ui/tests/unit/{external-url,window-open-guard}.test.ts`.
- [x] T041 [core-architecture] [P] Implement `writeRich`: `packages/core/src/abstractions/clipboard.ts`
      (amend the "plain text only" comment — HTML is a standard format; read stays plain),
      `packages/ui/src/main/electron-clipboard.ts` (`clipboard.write({ text, html })`),
      `packages/ui/src/main/memory-clipboard.ts`, `packages/ui/src/main/clipboard-service.ts`,
      `packages/ui/src/main/clipboard-ipc.ts` (`throng:clipboard:writeRich`),
      `packages/ui/src/preload/preload.cts` and `packages/ui/src/renderer/global.d.ts`; update the
      `IClipboard` double in `packages/ui/tests/integration/clipboard-mode.integration.test.ts`.
      Makes T038 pass; `ipc-bridge-parity.test.ts` stays green.
- [x] T042 [core-architecture] [P] Implement `openExternal`: `packages/core/src/abstractions/shell-integration.ts`,
      `packages/ui/src/main/electron-shell-integration.ts`, `packages/ui/src/main/external-url.ts`
      (`mailto:`), `packages/ui/src/main/window-open-guard.ts` (take the seam), and move
      `main.ts:901-903`'s `shell.openExternal` onto the seam in `packages/ui/src/main/main.ts`; update the
      `IShellIntegration` doubles in `packages/ui/tests/integration/rename-case-only.integration.test.ts`,
      `packages/ui/tests/integration/files-reveal-document.integration.test.ts`,
      `packages/ui/tests/integration/files-move-same-folder.integration.test.ts`,
      `packages/ui/tests/integration/files-move-bracket.integration.test.ts` and
      `packages/ui/tests/integration/files-delete-mixed.integration.test.ts`. Makes T039 pass.

### 2.6 The coordinator observer

- [x] T043 [editor-documents] `integration` — `packages/ui/tests/integration/editor-coordinator-lifecycle.integration.test.ts`
      over a real `EditorCoordinator` and temp tree: `registered` on load and register; `unregistered`
      on destroy and on an in-place re-point; `repointed(from,to)` on an in-app move **and on Save As**
      (the observed gap: save relays no `movedTo`); `changed` on every canonical change; `dirtyChanged`
      on every dirty transition; `relaySync` output unchanged. Observe it fail.
- [x] T044 [editor-documents] Add the injected `DocumentLifecycleListener` to
      `packages/ui/src/main/editor-coordinator.ts`, called at the sites listed in
      `contracts/preview-ipc.md` §3. Makes T043 pass.

### 2.7 Rendering untrusted Markdown — pipeline skeleton and the security layers

- [x] T045 [renderer-ui] [P] `unit` — `packages/ui/tests/unit/markdown-pipeline.test.ts` (node): the
      pipeline configures markdown-it `{ html: true, linkify: true, typographer: false }`; emits
      `data-source-line` on block opens; `data-heading-slug` from `headingSlug` on every heading and
      **no `id` attribute anywhere** in its output; `th/td` alignment as
      `data-align`, never `style`; a fence as `<pre><code data-lang>` escaped; **calls its injected
      sanitiser exactly once per render with markdown-it's output** (FR-081 "in the path").
- [x] T046 [renderer-ui] [P] `component` — `packages/ui/tests/component/preview-sanitise.test.ts`:
      rendering `packages/ui/tests/fixtures/preview/hostile.md` through the real pipeline + sanitiser
      yields no `script`/`iframe`/`frame`/`form`/`object`/`embed`/`link`/`meta`/`base`/`style` element,
      no attribute starting `on`, no `style` attribute, no `href` attribute at all, no `src` beginning
      `javascript:`/`data:`/`file:` (the profile's URL filter), no `mark` element while its text
      survives, **no element carrying an `id` or `name` attribute** (so the `<div id="throng">` and
      `<form name="throng">` clobbering attempts have nothing left — true before and after T096); and
      `details`, `summary`, `kbd`, `sub`, `sup`, `br`, `img` survive —
      FR-081, FR-082, SC-004 (renderer half). *(An `http:` image `src` passes the profile's URL filter and
      is removed only by the image hook, so that assertion lives in T087, which T096 makes pass.)*
- [x] T047 [core-architecture] [P] `unit` — `packages/ui/tests/unit/renderer-csp.test.ts`: parses the
      `Content-Security-Policy` meta in `packages/ui/src/renderer/index.html` and asserts every directive
      in `contracts/security-policy.md` §Layer 3 (`img-src 'self' https: throng-preview:`,
      `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`, no
      `'unsafe-inline'` in `script-src`) — FR-082, FR-093.
- [x] T048 [explorer-fileops] [P] `integration` — `packages/ui/tests/integration/preview-protocol.integration.test.ts`:
      `createPreviewProtocolHandler({ fs, previews, settings })` over a temp tree with a fake previews
      lookup — asset inside → 200 with `Content-Type`, `nosniff`, `Content-Security-Policy: sandbox`,
      `no-store`; `..` escape and a **symlink escaping the root** → 403; missing → 404; `.html` → 415;
      over `editor.maxOpenFileBytes` → refused; unknown panel id → 404; `source` route on a text
      provider → 403 and on a binary provider with a listed MIME → 200 — FR-074, FR-084, FR-073.
- [x] T049 [core-architecture] [P] `unit` — `packages/ui/tests/unit/renderer-request-filter.test.ts`
      with a fake `session.webRequest` and fake `webContents`: requests without `webContents` pass
      untouched; renderer requests go through `decideRendererRequest` with `remoteImages` read live from
      settings; a `data:text/html` main-frame request from a renderer `webContents` (the drag ghost
      window) passes; `will-navigate` is `preventDefault`-ed on every window passed in — FR-092, FR-093.
- [x] T050 [general] Red: `--project unit` over
      `packages/ui/tests/unit/{markdown-pipeline,renderer-csp,renderer-request-filter}.test.ts`;
      `--project component` over `packages/ui/tests/component/preview-sanitise.test.ts`;
      `--project integration` over `packages/ui/tests/integration/preview-protocol.integration.test.ts`.
- [x] T051 [renderer-ui] [P] Implement `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`
      (markdown-it instance, task-list core rule, source-line, heading-slug and alignment rules, fence
      render, sanitiser injected). Makes T045 pass.
- [x] T052 [renderer-ui] [P] Implement `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts`
      with the `PROFILE` from `contracts/security-policy.md` §Layer 2, returning a `DocumentFragment`;
      links lose `href` (classification hook arrives in T096). Makes T046 pass.
- [x] T053 [renderer-ui] [P] Replace the CSP meta in `packages/ui/src/renderer/index.html`. Makes T047 pass.
- [x] T054 [explorer-fileops] [P] Implement `packages/ui/src/main/preview-protocol.ts`
      (`createPreviewProtocolHandler`, image allowlist, realpath containment via `relPathUnderRoot`).
      Makes T048 pass.
- [x] T055 [core-architecture] [P] Implement `packages/ui/src/main/renderer-request-filter.ts`
      (`installRendererRequestFilter(session, settings, registry)`, `guardNavigation(webContents)`).
      Makes T049 pass.
- [x] T056 [core-architecture] Wire the security layers in main: `protocol.registerSchemesAsPrivileged`
      for `throng-preview` before `app.ready`, `protocol.handle` with T054's handler, the request filter
      on the default session, and `guardNavigation` on every renderer window —
      `packages/ui/src/main/main.ts` (main and sub-workspace windows), `packages/ui/src/main/preferences-window.ts`,
      `packages/ui/src/main/about-window.ts`.
- [x] T056a [e2e-harness] Open item O3, early half — immediately after T056 installs the request filter,
      so no story phase runs on an unconfirmed filter: build once, then run the two existing drag-ghost
      specs — `npx playwright test packages/ui/tests/e2e/drag-ghost.e2e.ts packages/ui/tests/e2e/ghost-drag-noise.e2e.ts`
      (state the cost in one line first; never alongside another E2E run) — because the ghost window
      loads a `data:text/html` page (`packages/ui/src/main/ghost-window.ts`) and whether `webRequest` sees
      `data:` loads is unconfirmed. A failure is fixed in `packages/core/src/preview/request-policy.ts`
      with its row added to T008 before Phase 2 continues. No budget change: it adds no declaration.

### 2.8 `PreviewService` — the one authority for open previews

- [x] T057 [editor-documents] [P] `integration` — `packages/ui/tests/integration/preview-service-parented.integration.test.ts`
      (real coordinator, fake clock, fake push): a run is parented exactly while the registry holds a
      document for its path (FR-013); becomes parented in place on `registered` (FR-013a); falls back to
      disk, `dirty:false`, standalone title on `unregistered` (FR-013b); **follows `repointed` for a
      move and for Save As — `byPath` re-keyed, `filePath` updated, title re-derived, `openChanged` for
      both paths, and `pathChanged { panelId, filePath: to }` broadcast** (FR-013c, FR-066); Save As to `.txt` → `notice: no-provider` (FR-027); content snapshots
      obey delay and max wait, dirty and parent-title updates go immediately with `content: null`
      (FR-022, FR-040, FR-060, FR-060a); the forwarded parent title follows `publishEditorTitle`
      (FR-031); nothing the service does changes the document's text or dirty state (FR-041).
- [x] T058 [editor-documents] [P] `integration` — `packages/ui/tests/integration/preview-service-standalone.integration.test.ts`
      (real `EditorService`, `NodeFileWatcher`, temp tree): standalone follows disk writes (FR-023);
      **opening, following and closing a standalone preview leaves `coordinator.list()`, `isOpen()` and
      the open-document registry unchanged** (FR-025, FR-044, SC-006); `dirty` never true (FR-043);
      delete → `deleted`, oversize → `too-large`, binary → `not-text`, unreadable → `unreadable`, repeat
      of the same condition sets `repeat` (FR-026); `refresh` flushes immediately (FR-028); an in-app move
      bracketed by `previewService.beginMove(paths)` then `previewService.moved(moves)` rebinds the run to
      the new path, broadcasts `pathChanged` once, and **pushes no `deleted` notice at any point during the move**, even though the
      watcher sees the old path vanish (FR-013c, standalone sentence); and a real external delete with no
      bracket still pushes `deleted`.
- [x] T059 [editor-documents] [P] `integration` — `packages/ui/tests/integration/preview-service-open.integration.test.ts`:
      `open` decision order from `contracts/preview-ipc.md` §1 — `refused` for no provider, **disabled
      provider** (FR-062), outside project, no file (FR-004); `focused` when a run or reservation exists,
      with the injected window-focus called (FR-012, FR-014); `placeLocally` beside the parent when the
      requester holds it (FR-010) and standalone with `besidePanelId: null` (FR-011); `placedElsewhere`
      routes `place` to the main window and, on `placeDeclined`, to the registry's recorded window, then
      focuses it (FR-010); two concurrent opens for one path produce one reservation (FR-012), and a
      reservation no `attach` consumes is released after the reservation timeout on the fake clock, so a
      later `open` for that path is not answered `focused`; two
      viewers attach and receive identical revisions, and a second attach adopts the run rather than its
      persisted `filePath` (FR-022, FR-110); `destroyed` drops run, watch, reservation and path and
      broadcasts `openChanged` without touching the document (FR-042); `attach` for a disabled or
      unknown provider → `{ ok: false }` (FR-067); `dropProvider(id)` drops every run of that provider
      and broadcasts `openChanged` (FR-063).
- [x] T060 [editor-documents] [P] `contract` — `packages/ui/tests/contract/preview-ipc.contract.test.ts`:
      request/response and push payload shapes for every `throng:preview:*` channel in
      `contracts/preview-ipc.md` §1–§2, validated against the handlers registered by `registerPreviewIpc`
      with a fake `ipcMain`; failures returned, never thrown.
- [x] T061 [explorer-fileops] [P] `integration` — extend `packages/ui/tests/integration/files-reveal-document.integration.test.ts`:
      `revealDocument` accepts a path that only a **preview** is showing, and still refuses a path
      nothing shows — FR-033 (Open in OS Explorer on a standalone preview).
- [x] T062 [general] Red: `--project integration` over
      `packages/ui/tests/integration/{preview-service-parented,preview-service-standalone,preview-service-open}.integration.test.ts`
      and `packages/ui/tests/integration/files-reveal-document.integration.test.ts`; `--project contract`
      over `packages/ui/tests/contract/preview-ipc.contract.test.ts`.
- [x] T063 [editor-documents] Implement `packages/ui/src/main/preview-service.ts` (data-model §10:
      runs, `byPath`, reservations, derived source, `SettleScheduler` per run, `editorTitles`, viewers,
      `open`, `attach`, `detach`, `destroyed`, `refresh`, `isOpen`, `dropProvider`, `beginMove`, `moved`,
      listener callbacks incl. `repointed`), constructor-injected. Makes T057–T059 pass.
- [x] T064 [editor-documents] Implement `packages/ui/src/main/preview-ipc.ts` (`registerPreviewIpc`,
      every channel in `contracts/preview-ipc.md` §1–§2 incl. `navigate` delegating to the service) and
      expose `window.throng.preview` in `packages/ui/src/preload/preload.cts` and
      `packages/ui/src/renderer/global.d.ts`. Makes T060 pass; `ipc-bridge-parity.test.ts` green.
- [x] T065 [explorer-fileops] Wire in `packages/ui/src/main/main.ts`: construct `PreviewService` beside
      `EditorCoordinator` (listener, `EditorService`, `NodeFileWatcher`, settings accessor,
      `SHIPPED_PREVIEW_PROVIDERS`, per-viewer push, window focus); pass its lookup to the protocol
      handler; `filesService.setOpenDocumentCheck` → editor **or** preview open; and update
      `packages/ui/src/main/files-service.ts` only if the check's signature needs it. **`setOnMoveStarted`
      and `setOnMoved` each hold ONE callback** (`files-service.ts:194-201`) and `main.ts:1409-1410`
      already registers `editorCoordinator.beginMove` / `markMoved` there — so never call either setter a
      second time: **replace** those two lines with one combined callback each, in this order —
      `(absPaths) => { editorCoordinator.beginMove(absPaths); previewService.beginMove(absPaths); }` and
      `(moves) => { editorCoordinator.markMoved(moves); previewService.moved(moves); }` (T155 appends
      to the second). Makes T061 pass.

### 2.9 The header-menu cluster (one change — plan Sequencing 6)

- [x] T066 [renderer-ui] `unit` + `component` — failing pins: in `packages/ui/tests/unit/menu-sections.test.ts`
      add `panelActions` keys (`openPreview`, `navigateBack`, `navigateForward`, `refreshPreview`,
      `openInEditor`, `goToEditor`), `TABLE` rows and exact `shapeOf` pins for a text preview, a binary
      preview (no Open in Editor), and the editor shape gaining Open Preview / Back / Forward in Navigate
      with their enabled flags (`contracts/menus-and-controls.md` §1–§2; FR-002, FR-012, FR-015b, FR-030,
      FR-033, FR-062, FR-111); a preview shape with `panelFailure: true` carries Try again, Copy details
      and Clear panel type in View & state and one with `panelFailure: false` carries none of them
      (030 FR-042c, FR-033); in `packages/ui/tests/component/panel-header-zoom-menu.test.ts` the preview
      kind offers live Zoom In / Out / Reset (FR-034). **Red**: run exactly these two files once
      (`--project unit` over `packages/ui/tests/unit/menu-sections.test.ts`, `--project component` over
      `packages/ui/tests/component/panel-header-zoom-menu.test.ts`) and confirm each new pin fails for the
      missing shape, not for a typo.
- [x] T067 [renderer-ui] Implement in `packages/ui/src/renderer/workspace/panel-header-menu.ts`: the
      preview shape; editor Open Preview / Back / Forward items; `PanelHeaderMenuActions` keys;
      `KINDS_THAT_ZOOM` += preview; `isRenamable` false for preview; Close verb for preview; rename
      `PanelHeaderMenuArgs.editorFailure` to `panelFailure` (it is now true while **either** an editor's
      or a preview's failure banner is up, so the old name would lie about its scope) and update its one
      caller in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`. Makes T066 pass.

### 2.10 The panel kind mounts

- [x] T068 [renderer-ui] `component` + `unit` — `packages/ui/tests/component/preview-panel-mount.test.ts`:
      `panel-body` renders `PreviewPanel` for kind `preview`; mount calls `preview.attach` with
      `config.filePath` and `config.history`; an update with `revision` ≤ the last applied is dropped;
      unmount → `detach`; destroy → `destroyed` and no dirty prompt (FR-042); nothing is published to
      `editor-state` so tab / project / tree unsaved markers are unchanged (FR-044, SC-006);
      `--throng-zoom-preview` follows `Panel.zoom` (FR-034); no rename starter registered and no
      double-click handler (FR-030); the body is not `contenteditable` (FR-020); providers are resolved
      through `PreviewProviderRegistryContext`. And `packages/ui/tests/unit/provider-views.test.ts`:
      the key set of `PREVIEW_PROVIDER_VIEWS` equals the ids of `SHIPPED_PREVIEW_PROVIDERS`. **Red**: run
      exactly these two files once and confirm each fails for the missing module or branch, not for an
      import typo.
- [x] T069 [renderer-ui] Implement the panel: `packages/ui/src/renderer/preview/preview-store.ts`,
      `packages/ui/src/renderer/preview/preview-open-store.ts` (fed by `openChanged`),
      `packages/ui/src/renderer/preview/provider-registry-context.tsx` (default: shipped registry),
      `packages/ui/src/renderer/preview/provider-view.ts`, `packages/ui/src/renderer/preview/providers/index.ts`
      (**the one renderer registration line**), `packages/ui/src/renderer/preview/preview-panel.tsx`
      (chrome skeleton, body host, zoom variable),
      `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (renders via T051/T052,
      loaded by dynamic import) and `packages/ui/src/renderer/preview/preview.css` (layout only; colour
      rules arrive in T100).
- [x] T070 [renderer-ui] Wire the kind into the workspace: `packages/ui/src/renderer/workspace/panel-body.tsx`
      (preview branch), `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (destroy cleanup calls
      `preview.destroyed`; no rename starter for preview; header type icon/title via `panelDisplayTitle`),
      `packages/ui/src/renderer/workspace/panel-destroy-sync.tsx` (remote destroy),
      `packages/ui/src/renderer/subworkspace-app.tsx` and `packages/ui/src/renderer/app.tsx` if the kind
      needs registering there (043 precedent). Makes T068 pass.

**Checkpoint**: a preview panel can be created by code, attached to `PreviewService`, render sanitised
Markdown behind CSP, request filter and protocol, and be destroyed — no user-facing entry point yet.

---

## Phase 3: User Story 1 — Preview the Markdown file I am writing, beside its source (P1) 🎯 MVP

**Goal**: From an open `.md` editor, open a preview beside it that follows the buffer live and shares
its unsaved marker.

**Independent Test**: Open a `.md` in an editor, click the status bar's preview button, type a heading,
see it rendered without saving (quickstart §2).

- [x] T071 [editor-documents] [P] [US1] `component` — `packages/ui/tests/component/status-strip-preview-button.test.ts`:
      button absent for no provider / no file / outside project; **drawn disabled with a title naming
      *Preferences → Editor → Previews* while the provider is disabled** (FR-001, FR-062); enabled
      *Open Preview* calls `preview.open` (FR-001, SC-001); `aria-pressed="true"` and *Go to Preview*
      while `preview-open-store` holds the path, click focuses and never closes (FR-014); lives inside
      the measured controls group so width fit never hides it; `IconButton` token `preview`, accessible name.
- [x] T072 [editor-documents] [P] [US1] `component` — amend `packages/ui/tests/component/editor-content-menu.test.ts`:
      Open Preview in Navigate after Go To Line…, with its chord when bound; absent / disabled rules
      from `contracts/menus-and-controls.md` §3 (FR-002, FR-004, FR-012, FR-062, SC-001).
- [x] T073 [renderer-ui] [P] [US1] `component` — `packages/ui/tests/component/open-preview.test.ts`:
      `openPreview()` with a fake bridge — `placeLocally` with a parent → `addPanelBeside(…, 'right')`,
      parent's tab brought to the front, preview focused (FR-010); `placeLocally` standalone → appended at
      the active tab root (FR-011); `focused` with a panel id → tab to front and panel focused (FR-012, FR-014); `focused` with
      `panelId: null` (a reservation only) → no layout change, no lookup, no notice;
      an incoming `focus` with a `fragment` also scrolls that preview's body to the heading whose
      `data-heading-slug` matches (FR-090c); `refused` → no layout change; an incoming `place` for a parent this window holds places and
      attaches with the reservation, otherwise replies `placeDeclined` (FR-010).
- [x] T074 [renderer-ui] [P] [US1] `component` — `packages/ui/tests/component/preview-header-parented.test.ts`:
      header title `<parent title> - Preview` and its update when the parent title changes (FR-031);
      truncated name part with suffix intact (FR-032); unsaved dot shown exactly while an update says
      `dirty: true` and cleared on `dirty: false` (FR-040, FR-041); standalone never shows it (FR-043).
- [x] T075 [editor-documents] [P] [US1] `component` — `packages/ui/tests/component/editor-title-publisher.test.ts`:
      `EditorTitlePublisher` sends `preview.publishEditorTitle` for each mounted editor panel on mount and
      whenever its display title (custom or derived) changes, and not when it is unchanged (FR-031).
- [x] T076 [renderer-ui] [P] [US1] `unit` — `packages/ui/tests/unit/scroll-anchor.test.ts`: capture
      `{ line, offsetRatio }` from block rects and restore to the nearest `data-source-line` at or before
      it, with content inserted above — FR-024.
- [x] T077 [general] [US1] Red: `--project component` over
      `packages/ui/tests/component/{status-strip-preview-button,editor-content-menu,open-preview,preview-header-parented,editor-title-publisher}.test.ts`;
      `--project unit` over `packages/ui/tests/unit/scroll-anchor.test.ts`.
- [x] T078 [editor-documents] [P] [US1] Add the preview button to the controls group in
      `packages/ui/src/renderer/editor/status-strip.tsx`, fed by `previewAffordance` and
      `preview-open-store` from `packages/ui/src/renderer/editor/editor-panel.tsx`. Makes T071 pass.
- [x] T079 [editor-documents] [P] [US1] Add Open Preview to `packages/ui/src/renderer/editor/content-menu.ts`
      and supply its affordance and action from `packages/ui/src/renderer/editor/use-editor.ts`
      (right-click builder). Makes T072 pass.
- [x] T080 [renderer-ui] [P] [US1] Implement `packages/ui/src/renderer/preview/open-preview.ts`
      (`openPreview`, `place` / `focus` handlers). Makes T073 pass.
- [x] T081 [renderer-ui] [P] [US1] Implement `packages/ui/src/renderer/preview/providers/markdown/scroll-anchor.ts`.
      Makes T076 pass.
- [x] T082 [editor-documents] [P] [US1] Implement `packages/ui/src/renderer/editor/editor-title-publisher.tsx`.
      Makes T075 pass.
- [x] T083 [renderer-ui] [US1] In `packages/ui/src/renderer/workspace/panel-placeholder.tsx`: the
      unsaved-dot gate becomes editor-dirty **or** preview-update-dirty; the preview title reads the
      forwarded parent title; wire the editor header's `openPreview` action to `openPreview`. Makes T074 pass.
- [x] T084 [renderer-ui] [US1] Create `packages/ui/src/renderer/preview/preview-commands.tsx` registering
      `preview.open` (focused editor's file, or the Files & Folders selection) and the `place` / `focus`
      / `openChanged` listeners, and mount it and `EditorTitlePublisher` in
      `packages/ui/src/renderer/editor/editor-chrome.tsx` (every window) — FR-005.
- [x] T085 [renderer-ui] [US1] Apply the scroll anchor around every content update in
      `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (update ≠ navigation:
      a new `filePath` scrolls to top or fragment) — FR-024.

**Checkpoint**: US1 acceptance scenarios 1–7 hold at component and integration tiers; scroll and live
typing are hands-on per quickstart §2 until Phase 10.

---

## Phase 4: User Story 6 — Markdown looks right, and is safe (P1)

**Goal**: Every FR-080 construct renders in theme colours; links and images behave as specified; a
hostile file does nothing.

**Independent Test**: Preview `gfm.md` in two contrasting themes and `hostile.md` with Network open
(quickstart §3).

- [x] T086 [renderer-ui] [P] [US6] `unit` — `packages/ui/tests/unit/markdown-pipeline-gfm.test.ts`
      (node, string output before sanitising): each FR-080 construct from `gfm.md` — headings, emphasis,
      lists, block quotes, rules, links, images, tables with `data-align`, task list checkboxes
      `disabled`, strikethrough, autolinks, fenced code with `data-lang` (FR-080); front matter as a
      key/value table with nested values shown as their YAML source, invalid YAML and non-mapping as an
      escaped code block, never a notice (FR-085); `mermaid` fence as code and `$…$` / `$$…$$` literal (FR-086).
- [x] T087 [renderer-ui] [P] [US6] `component` — `packages/ui/tests/component/preview-images.test.ts`:
      relative image → `throng-preview://asset/<panelId>/…`; `../../outside.png` → no `src`, alt shown;
      https badge kept with *Load remote images* on and removed with it off; `http:` and `file:` removed
      regardless; an image `error` event shows the alt text (FR-084, FR-092, FR-093); and, rendering
      `hostile.md`, the raw `<h2 data-heading-slug="spoof">` has no `data-heading-slug` after sanitising
      while a pipeline-generated heading keeps its slug, and a `#spoof` fragment raises
      `link-missing-heading` (FR-090b, FR-090e — the heading hook in `contracts/security-policy.md` Layer 2).
- [x] T088 [renderer-ui] [P] [US6] `component` — `packages/ui/tests/component/preview-links.test.ts`:
      links carry no `href` and carry `data-throng-link`, `role=link`, `tabindex=0`, and a title naming
      the target and *Ctrl+click to follow* (FR-094); plain click → no `onFollow`; Ctrl+click with a
      collapsed selection → one `onFollow`; Ctrl+drag with a non-collapsed selection → none (FR-094);
      inert links have no tabindex (FR-091); Tab order follows document order and focused links get the
      focus class, and Tab on the **last** link is not `preventDefault`-ed, so focus leaves the preview
      (FR-096b); Enter follows nothing, `preview.followLink` follows the focused link
      (FR-096c); Shift+F10 and ContextMenu on a focused link open the link menu for it (FR-096d); the
      body is focusable and arrow / Page / Home / End keydowns are not `preventDefault`-ed (FR-096a); Tab
      does not dispatch `editor.indentLines` (FR-096).
- [x] T089 [renderer-ui] [P] [US6] `component` — `packages/ui/tests/component/preview-highlight.test.ts`:
      a `ts` fence is highlighted after insertion with spans carrying `throngHighlightStyle` classes,
      built without `innerHTML`; unknown language and `mermaid` stay plain; a line beyond
      `LONG_LINE_THRESHOLD` stays plain; a theme-variable change needs no re-render (FR-080, FR-083, FR-086).
- [x] T090 [renderer-ui] [P] [US6] `component` — `packages/ui/tests/component/preview-link-menu.test.ts`:
      the preview body menu's Contextual section (Open Link with its chord, Copy Link Address) appears
      only over a followable link with nothing selected, is absent over an inert link and whenever text
      is selected; Copy Link Address writes the URL through the clipboard bridge (FR-095).
- [x] T091 [renderer-ui] [P] [US6] `component` — `packages/ui/tests/component/preview-follow.test.ts`:
      `PreviewPanel.onFollow` — `external` → `window.throng.openExternal` (FR-091); same-document heading
      → `scrollIntoView` on the slugged heading, missing heading → one link notice (FR-090f); `file` →
      `preview.navigate` with `intent: link` **and `leavingViewState` captured from the body before the
      call** (FR-107); responses `shown` (applies update, scrolls to fragment, FR-090a/b), `shown` for an
      existing file whose `#heading` the rendered target does not contain (the target file is shown from
      its top and one `link-missing-heading` notice names the heading, FR-090e second sentence),
      `focusedOther` (no change, FR-090c), `openedInEditor` (routes through the Files & Folders open path
      with `markdownHeadingLine` for the caret, FR-090d), `refused` (one notice naming the target,
      FR-090e); a repeat of the same notice flashes rather than stacking.
- [x] T092 [editor-documents] [P] [US6] `integration` — `packages/ui/tests/integration/preview-service-navigate.integration.test.ts`:
      `navigate` with `intent: link` rebinds the run to the target, re-derives parented state from the
      target's document (a preview parented to README stops being parented, FR-090a), passes the
      fragment (FR-090b), returns `shown` — never `refused` — for an existing target whose fragment names
      no heading, passing the fragment through unjudged (main does not parse headings; the renderer
      raises `link-missing-heading`, FR-090e), returns `focusedOther` and sends `focus { panelId, fragment }`
      to the window holding the other preview, with the link's fragment when the target has a preview (FR-090c), `openedInEditor`
      when no enabled provider (FR-090d), `refused` with `link-missing-file` / `link-outside` and **no file
      created** (FR-090e); and following a link to a file **not** open in any editor leaves
      `coordinator.list()`, `isOpen()` and the open-document registry unchanged (FR-025, SC-006 —
      Finding 5's trap on the link path, not only the disk path T058 covers).
- [x] T093 [renderer-ui] [P] [US6] `unit` — `packages/ui/tests/unit/preview-css-tokens.test.ts`: parses
      `packages/ui/src/renderer/preview/preview.css` — no colour literal anywhere, including `var()`
      fallbacks; the body's `color`/`background` are exactly `--throng-colour-editorFg` /
      `--throng-colour-editorBg` (the editor-text contrast pair, SC-005) and its font the `paneText` role;
      **no rule sets a background other than `editorBg`**, and every `color` the file sets is
      `editorFg` or a `syntax*` token — so every text colour in a preview sits on a pair
      `contrastPairingsFor` (`packages/core/src/config/theme-quality.ts`) already measures on every
      shipped theme (`editorFg`/`editorBg`, `SYNTAX_ON_BODY`); links use `syntaxFunction` underlined and
      block quotes `syntaxComment` — the colours the editor's own Markdown highlighting gives them
      (`highlight-style.ts:54,58`); code uses the `editor` font role; `accent` appears only as the focus
      indicator's outline (FR-083, FR-096b, SC-005).
- [x] T094 [general] [US6] Red: `--project unit` over
      `packages/ui/tests/unit/{markdown-pipeline-gfm,preview-css-tokens}.test.ts`; `--project component` over
      `packages/ui/tests/component/{preview-images,preview-links,preview-highlight,preview-link-menu,preview-follow}.test.ts`;
      `--project integration` over `packages/ui/tests/integration/preview-service-navigate.integration.test.ts`.
- [x] T095 [renderer-ui] [P] [US6] Complete `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`:
      front matter via `splitFrontMatter` + `yaml.parseDocument` with source-range slicing, and the
      single `renderFence(info, code)` entry point (the #392 slot). Makes T086 pass.
- [x] T096 [renderer-ui] [P] [US6] Add the `afterSanitizeAttributes` hooks to
      `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` (links via `classifyPreviewLink`,
      images via `resolvePreviewImage`, checkbox forcing, `data-heading-slug` kept only where it matches
      the pipeline's slug for that line). Makes T087 and part of T088 pass.
- [x] T097 [renderer-ui] [P] [US6] Implement `packages/ui/src/renderer/preview/providers/markdown/highlight.ts`
      (`languageForFenceInfo` → `loadLanguage` → `highlightCode` with `throngHighlightStyle`, DOM built
      with `createElement`/`textContent`). Makes T089 pass.
- [x] T098 [renderer-ui] [P] [US6] Create `packages/ui/src/renderer/preview/content-menu.ts` with the
      Contextual link section. Makes T090 pass.
- [x] T099 [editor-documents] [P] [US6] Implement `navigate` (link intent) in
      `packages/ui/src/main/preview-service.ts`. Makes T092 pass.
- [x] T100 [renderer-ui] [P] [US6] Add the token-only visual rules to
      `packages/ui/src/renderer/preview/preview.css` (body, headings, code, blocks, quotes, tables, front
      matter table, links, focus indicator, `data-align`) per the token table in
      `contracts/settings-bindings-tokens.md` §Colour tokens. Makes T093 pass.
- [x] T101 [renderer-ui] [US6] In `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`:
      link gestures, focus handling, Shift+F10 / ContextMenu, post-insert highlighting, image alt
      fallback. Makes the rest of T088 pass except its `preview.followLink` case, which T103 completes.
- [x] T102 [failure-notices] [US6] Create `packages/ui/src/renderer/preview/preview-link-notice.tsx`
      (inline, dismissible, flashes on repeat), rendered with the shared `.panel-failure` element and
      classes from `packages/ui/src/renderer/common/panel-failure-banner.css` (`.panel-failure`,
      `.panel-failure__text`, `.panel-failure__headline`, `.panel-failure__control`) — the one shared
      in-panel notice styling that exists — with a Dismiss control in place of Try again; never styled by
      `preview.css`, whose T093 rules govern only the rendered document. Route `onFollow` / `onNotice` in
      `packages/ui/src/renderer/preview/preview-panel.tsx` — capturing the body's view state into
      `leavingViewState` before `preview.navigate`, and raising `link-missing-heading` when a `shown`
      target's rendered body has no heading for the fragment. Makes T091 pass.
- [x] T103 [renderer-ui] [US6] Register `preview.followLink` in the `preview` scope in
      `packages/ui/src/renderer/preview/preview-commands.tsx` — FR-096c. Makes T088's `preview.followLink`
      case pass.

**Checkpoint**: US6 scenarios 1–10 hold below E2E; SC-004's real-engine half lands in T163.

---

## Phase 5: User Story 2 — Preview a file without opening it for editing (P1)

**Goal**: Open In → Preview gives a standalone preview that follows the disk and never counts as an open editor.

**Independent Test**: quickstart §3 steps 1–3.

- [x] T104 [explorer-fileops] [P] [US2] `component` — `packages/ui/tests/component/explorer-open-in-preview.test.ts`:
      Open In → Preview sits after the editor targets and before Terminal, with *OS File Explorer* still
      first; absent on a folder, a file no provider claims, and outside the project; **disabled** while
      the provider is disabled (FR-062) and while `preview.isOpen` resolves true (FR-012); choosing it
      calls `preview.open` (FR-003, SC-001).
- [x] T105 [explorer-fileops] [P] [US2] `component` — amend `packages/ui/tests/component/find-in-files-open-in.test.ts`:
      a Find in Files row's Open In never offers Preview (the shared `describeOpenInTargets` is untouched)
      — FR-054, FR-055. This is a **regression guard**, expected to pass at T108: it pins that T109 adds
      Preview through `file-tree.tsx`'s own argument and not through the shared builder. T108 records it
      as passing-by-design rather than as a Red failure.
- [x] T106 [failure-notices] [P] [US2] `component` — `packages/ui/tests/component/preview-notice.test.ts`:
      each `PreviewNotice` of FR-026 renders one `PanelFailureBanner` with a human message (never the
      raw error), Try again → `preview.refresh`, Copy details; `no-provider` renders *Close* which
      destroys the panel (FR-027); `repeat: true` flashes the existing banner rather than adding one;
      a deleted file shows the notice and nothing else (US2 scenario 6).
- [x] T107 [renderer-ui] [P] [US2] `component` — `packages/ui/tests/component/preview-adopt-parent.test.ts`:
      a standalone preview receiving `parent: { … }` becomes parented **in place** — same slot, same
      tab, title switches to the parent's name, dot follows `dirty` (FR-013a); `parent: null` reverts
      (FR-013b).
- [x] T108 [general] [US2] Red: `--project component` over
      `packages/ui/tests/component/{explorer-open-in-preview,find-in-files-open-in,preview-notice,preview-adopt-parent}.test.ts`.
- [x] T109 [explorer-fileops] [P] [US2] Add the Preview argument to `buildContextMenuItems` in
      `packages/ui/src/renderer/explorer/context-menu-items.ts` and compute it (affordance + awaited
      `preview.isOpen`) in `packages/ui/src/renderer/explorer/file-tree.tsx`. Makes T104, T105 pass.
- [x] T110 [failure-notices] [P] [US2] Create `packages/ui/src/renderer/preview/preview-notice.tsx` over
      the shared `PanelFailureBanner`. Makes T106 pass.
- [x] T111 [renderer-ui] [US2] Mount `PreviewNotice` and derive parented chrome from the store in
      `packages/ui/src/renderer/preview/preview-panel.tsx`. Makes T107 pass.

**Checkpoint**: US2 scenarios 1–6 hold (disk-follow and no-registration proven in T058).

---

## Phase 6: User Story 3 — A preview panel behaves like a panel, but reads like a view (P2)

**Goal**: The header and body menus, status bar, read-only behaviour, zoom, copy and Open in Editor / Go to Editor.

**Independent Test**: quickstart §4 steps 1–3 and §3 step 9.

- [x] T112 [renderer-ui] [P] [US3] `component` — `packages/ui/tests/component/preview-status-bar.test.ts`:
      the preview status bar uses the editor strip's classes, follows `editor.showStatusBar`, has no
      readouts, and holds one `editorPanel` button — *Open in Editor* when standalone, *Go to Editor*
      `aria-pressed` when parented, never hidden by width (FR-015a, FR-015c, FR-015d); not rendered for
      a binary provider (FR-015e).
- [x] T113 [renderer-ui] [P] [US3] `component` — `packages/ui/tests/component/preview-open-in-editor.test.ts`:
      Open in Editor calls `editor.openInto` first — `focus` → nothing placed; `open` → new editor via
      `addPanelBeside(…, 'left')` of the preview (FR-015c); Go to Editor focuses the parent panel, its
      tab and window (FR-015d); the body and header menu items call the same function (FR-015b).
- [x] T114 [renderer-ui] [P] [US3] `component` — `packages/ui/tests/component/preview-read-only.test.ts`:
      typing, paste and drop in the preview body change nothing and call no editor bridge (FR-020);
      with the preview focused, the save chord, Delete and F2 dispatch nothing and the Files & Folders
      selection is untouched (FR-021); the rename chord and header double-click are inert (FR-030).
- [x] T115 [renderer-ui] [P] [US3] `component` — `packages/ui/tests/component/preview-copy.test.ts`:
      Copy, Copy as Rich Text, Copy as Plain Text and Select All in the body menu's Content section, all
      three copies disabled with an empty selection (FR-035, FR-035c); Select All selects only the body;
      Copy and the `copy` event use `editor.previews.copyFormat` (FR-035b); rich → `clipboard.writeRich`
      with plain text and export-profile HTML (no `data-*`, `id`, `class`; `href` restored for external
      links only), plain → `clipboard.write` text only (FR-035a); Navigate section's Open in Editor /
      Go to Editor absent for a binary provider (FR-015e).
- [x] T116 [renderer-ui] [P] [US3] `component` — `packages/ui/tests/component/preview-header-actions.test.ts`:
      from a preview's header menu — Close Panel destroys with no prompt (FR-042); Reveal File in Files
      & Folders dispatches `throng:reveal-in-tree`; Open in OS Explorer calls `revealPanelFile`; Refresh
      calls `preview.refresh` (FR-028); Zoom In changes the preview's zoom and not the parent editor's
      (FR-034); Send to Tab ▸ and Sync to ▸ present; Try again / Copy details / Clear panel type present
      only while the banner is up, and each **does** its job on a preview — Try again calls
      `preview.refresh`, Copy details writes the notice's message and detail through the clipboard
      bridge, Clear panel type sends `preview.destroyed` for the panel and then clears its type with no
      prompt (FR-042), after which `preview-open-store` no longer holds the file (FR-012, FR-033,
      030 FR-042c, US3 scenario 1).
- [x] T117 [general] [US3] Red: `--project component` over
      `packages/ui/tests/component/{preview-status-bar,preview-open-in-editor,preview-read-only,preview-copy,preview-header-actions}.test.ts`.
- [x] T118 [renderer-ui] [P] [US3] Implement `packages/ui/src/renderer/preview/preview-status-bar.tsx`. Makes T112 pass.
- [x] T119 [renderer-ui] [P] [US3] Implement `packages/ui/src/renderer/preview/open-in-editor.ts`. Makes T113 pass.
- [x] T120 [renderer-ui] [P] [US3] Implement `packages/ui/src/renderer/preview/copy.ts` (selection → `{ text, html }`).
- [x] T121 [renderer-ui] [P] [US3] Add the export profile to `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts`.
- [x] T122 [renderer-ui] [US3] In `packages/ui/src/renderer/preview/preview-panel.tsx` and
      `packages/ui/src/renderer/preview/content-menu.ts`: mount the status bar; body menu Content and
      Navigate sections; `copy` event interception and scoped Select All; drop / paste prevention. Makes
      T114 and T115 pass.
- [x] T123 [renderer-ui] [US3] Wire the preview header actions (Refresh, Reveal, Open in OS Explorer,
      Open in Editor / Go to Editor, Zoom, and the failure banner's Try again → `preview.refresh`, Copy
      details → the preview notice's text, Clear panel type → `preview.destroyed` then
      `ws.clearPanelType` with no dirty prompt; `panelFailure` is true while the preview's
      `PanelFailureBanner` is up) in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`.
      Makes T116 pass. *(u8 review:)* every preview failure the banner can show — an attach failure,
      a body/chunk load failure, a notice — lives where the header can read it (the preview store), and
      the menu's Try again goes through `retryPanelFailure(panel.id)` so it reaches whichever failure is
      up; Copy details copies that failure's own text, not only a notice's.

**Checkpoint**: US3 scenarios 1–9 hold.

---

## Phase 7: User Story 4 — Choose which file types preview, and how they open (P2)

**Goal**: Editor → Previews preferences; a disabled provider disables its affordances and closes its
previews everywhere; a default open action of Preview routes clicks, Enter and Quick Open.

**Independent Test**: quickstart §4 steps 4–5.

- [x] T124 [config-preferences] [P] [US4] `component` — `packages/ui/tests/component/settings-tab-previews.test.ts`:
      Preferences → Editor → **Previews** renders update delay, maximum wait, copy format, and per
      provider *Markdown: Enabled* / *Markdown: Default open action* / own settings (FR-060, FR-060a,
      FR-061, FR-065) — and no Previews label reads *Open files with*, which is `editor.openOnClick`'s
      label (019 FR-024) for a different setting; with the provider disabled its Default open action and
      Load remote images render **disabled, not hidden** (FR-061); the tab reads descriptors from a
      metadata context (SC-003 prerequisite).
- [x] T125 [editor-documents] [P] [US4] `component` — `packages/ui/tests/component/editor-open-router.test.ts`:
      `openFromTree` / `openFromQuickOpen` with Markdown's default Preview → `preview.open`, no editor
      (FR-052); for a file already open in an editor, `preview.open` (placing beside or focusing, FR-053);
      with the provider **disabled** → editor (FR-062); default Editor → `openFileInTab` unchanged;
      Quick Open still returns its opened boolean; Find in Files `openResultRow` and Open In editor
      targets always call `openFileInTab` (FR-054, FR-055).
- [x] T126 [renderer-ui] [P] [US4] `component` — `packages/ui/tests/component/preview-provider-sync.test.ts`:
      when a provider flips to disabled, this window removes its previews of that provider through
      `removePanelsWhere` — an emptied tab closes, the workspace's last panel becomes an empty panel —
      and sends `destroyed` for each (FR-063, FR-064).
- [x] T127 [daemon-persistence] [P] [US4] `integration` — `packages/ui/tests/integration/preview-purge.integration.test.ts`:
      `purgeUnloadedPreviews` over fake `workspace.load/save/loadSubWorkspaces/persistSubWorkspaces`
      removes matching previews from every project layout and sub-workspace record not held by a window,
      skips non-`restored` records, matches each preview on `previewPathOf(config)` (history's current
      entry, else `filePath`), replaces a workspace's last panel with an empty panel, strips a
      sub-workspace per `stripPanelFromSubWorkspaces`, and writes nothing on a second run (FR-063,
      FR-064, idempotent-migration constraint).
- [x] T128 [renderer-ui] [P] [US4] `component` — `packages/ui/tests/component/preview-restore-filter.test.ts`:
      a restored layout or sub-workspace holding a preview whose provider is disabled or unregistered does
      not mount it, and applies `removePanelsWhere` semantics (FR-067). The provider is matched on
      `previewPathOf(config)` — the persisted history's current entry when present, else `config.filePath`,
      the same precedence `attach` uses — and a case where the two differ in extension proves it.
- [x] T129 [general] [US4] Red: `--project component` over
      `packages/ui/tests/component/{settings-tab-previews,editor-open-router,preview-provider-sync,preview-restore-filter}.test.ts`;
      `--project integration` over `packages/ui/tests/integration/preview-purge.integration.test.ts`.
- [x] T130 [config-preferences] [P] [US4] Read metadata from a context defaulting to `SETTINGS_METADATA`
      in `packages/ui/src/renderer/preferences/settings-tab.tsx`. Makes T124 pass.
- [x] T131 [editor-documents] [P] [US4] Implement `packages/ui/src/renderer/editor/open-router.ts`. Makes T125 pass.
- [x] T132 [renderer-ui] [P] [US4] Implement `packages/ui/src/renderer/preview/preview-provider-sync.tsx`. Makes T126 pass.
- [x] T133 [daemon-persistence] [P] [US4] Implement `packages/ui/src/main/preview-purge.ts`. Makes T127 pass.
- [x] T134 [renderer-ui] [P] [US4] Apply the restore filter in `packages/ui/src/renderer/state/workspace-store.tsx`
      and `packages/ui/src/renderer/state/subworkspace-window-client.ts`. Makes T128 pass.
- [x] T135 [editor-documents] [US4] Route tree click / Enter through the router in
      `packages/ui/src/renderer/editor/editor-open.tsx` — **only** the `throng:open-file` handler's
      `openFileIntoEditor` call inside `EditorOpenListener`, never the prompt flows inside `openFileInTab`
      / `openFileInPanel`, which T147/T156 consolidate (plan Sequencing 3) — and Quick Open's `choose` in
      `packages/ui/src/renderer/navigate/quick-open.tsx`.
- [x] T136 [config-preferences] [US4] Mount `PreviewProviderSync` in `packages/ui/src/renderer/editor/editor-chrome.tsx`;
      in `packages/ui/src/main/main.ts`, on every settings change, call
      `providersTurnedOff(previous, next, SHIPPED_PREVIEW_PROVIDERS)` (unit-tested in T014) and, for each
      id it returns, `previewService.dropProvider(id)` and `purgeUnloadedPreviews`; and feed the request
      filter's `remoteImages` from settings — FR-062, FR-063. The decision is T014's; this task only
      calls it.

**Checkpoint**: US4 scenarios 1–5 hold.

---

## Phase 8: User Story 7 — Step back and forward through the files a panel has shown (P2)

**Goal**: Per-panel history for editor and preview panels, persisted with the panel and purged with it.

**Independent Test**: quickstart §5.

- [x] T137 [editor-documents] [P] [US7] `integration` — `packages/ui/tests/integration/navigation-history-service.integration.test.ts`:
      `attach` adopt-if-absent with `parseHistory`; two windows attaching one panel share one record, and
      `changed` is broadcast to every window (FR-110, FR-112); a second `attach` for the same panel id from
      another tab (Send to Tab remounts it) adopts the existing record unchanged rather than resetting it
      (FR-110 *"Moving the panel (Send to Tab) … MUST keep it"*); `purge`; `applyCap` over every record on a `historySize` change,
      never dropping the current entry (FR-108); `rewritePaths` over **every** record including panels
      no window mounts (FR-109); `rewriteCurrent` on an editor's Save-As `repointed`.
- [x] T138 [editor-documents] [P] [US7] `integration` — `packages/ui/tests/integration/editor-load-navigation.integration.test.ts`
      (real coordinator + history service): a new editor's first load is its first entry; each later
      in-place load appends (FR-103, FR-103a); loading the current file adds nothing; a load with
      `navigation: history` moves the index only (FR-102); a missing file with a history intent moves
      and the panel reports could-not-read (FR-106d); a refused load neither records nor moves (FR-106c); **Save As** to a new path rewrites the editor's
      current entry to that path — no second entry, no stale one — so Back then Forward returns to the new
      path, and a later open of the new path adds nothing (FR-109, FR-103).
- [x] T139 [editor-documents] [P] [US7] `component` — `packages/ui/tests/component/open-into-panel.test.ts`:
      `openIntoEditorPanel` outcomes with a fake bridge and a fake prompt — clean load → `loaded`;
      dirty + Cancel → no `editor.load` (`cancelled`); Save & open with a failing save → no load
      (`saveFailed`); Discard & open / Save & open → load with the intent; Open in new editor → a new
      panel, this panel not loaded (FR-106a); `openInto` focus → `focusedElsewhere` (FR-106b); `refuse`
      → one notice naming the file (FR-106c); a history intent ignores a missing-file refusal only (FR-106d).
- [x] T140 [renderer-ui] [P] [US7] `component` — `packages/ui/tests/component/back-forward-buttons.test.ts`:
      Back and Forward drawn before the type icon on editor and preview headers and on no other kind
      (FR-100, FR-104); disabled at the ends of the mirrored history; tokens `navigateBack` /
      `navigateForward`, accessible names, titles carrying the live chord; `pointerdown` does not start
      the header drag; mouse `button` 3 / 4 over the panel performs Back / Forward and prevents default
      (FR-105); the header menu's Back / Forward enabled state matches (FR-111); **Send to Tab** on an
      editor and on a preview moves the panel without calling `history.purge` or `preview.destroyed`,
      while Destroy calls both for a preview and `history.purge` for an editor (FR-110).
- [x] T141 [renderer-ui] [P] [US7] `component` — `packages/ui/tests/component/history-mirror-sync.test.ts`:
      `changed` writes `config.history` for panels in this window's layout — including a preview in a
      background tab that is not mounted — and skips identical values; and, in
      `packages/ui/tests/component/preview-path-sync.test.ts`, a broadcast `throng:preview:pathChanged`
      for a preview in this window's layout (mounted or not) writes the new `config.filePath`, an identical
      one writes nothing, and one for a panel this window does not hold writes nothing (FR-066, FR-090a,
      FR-013c);
      `throng:files:moved` rewrites every panel's `config.history` paths (asserted in
      `history-mirror-sync.test.ts`) and a preview's `config.filePath` (asserted in
      `preview-path-sync.test.ts`) for mounted and unmounted panels in this window (FR-066, FR-109).
- [x] T142 [editor-documents] [P] [US7] `integration` — `packages/ui/tests/integration/preview-history.integration.test.ts`:
      a new preview's first attach records its file (FR-103b); `preview.attach` adopts the panel's history
      record (no `throng:history:attach` call), and `throng:history:changed` for it is broadcast to every
      window — including one holding the preview in a background tab that has detached; a restore-time attach whose persisted `history` current
      entry is `setup.md` while `filePath` still says `README.md` opens the run on `setup.md`, and one
      with no `history` opens on `filePath` (FR-066, FR-109, US7 scenario 4); a link followed in place records, broadcasts `pathChanged` with the
      target path (FR-066), and pushes the same `update` to a second viewer of the run (FR-110); and
      its `leavingViewState` is stored on the entry it left (FR-107); a history-intent `navigate` also
      pushes its update, with `viewState`, to the second viewer; `navigate` with a history intent
      stores its `leavingViewState` on the entry being left **before** moving, moves, and returns an
      update whose `viewState` is the target entry's; a restore-time `attach` returns the current entry's
      `viewState` on its update, and an ordinary content update carries none — so Back with view state A then Forward returns A (FR-107, US7
      scenario 3); `destroyed` purges the panel's history
      record, so a preview removed by `PreviewProviderSync` or by Clear panel type leaves none (FR-110);
      `setViewState` stores on the current entry; a parented ↔ standalone change leaves history untouched
      (FR-103b); a refused history target does not move and returns `history-refused` (FR-106c); a
      missing one moves with a `deleted` notice (FR-106d); a target with a preview elsewhere → `focusedOther`
      and no move (FR-106b).
- [x] T143 [daemon-persistence] [P] [US7] `integration` — `packages/ui/tests/integration/preview-persistence.integration.test.ts`:
      a layout holding a preview (`filePath`, `zoom`, `history`) and an editor with `history` round-trips
      through `WorkspaceRepository` with canonical paths — including a preview whose `filePath` and
      history current entry are both `setup.md` after a link was followed from `README.md`; parented
      state and parent ids are never written (FR-066, FR-068, FR-109, SC-007 restart half).
- [x] T144 [renderer-ui] [P] [US7] `component` — `packages/ui/tests/component/navigate-history.test.ts`:
      `navigate.back` / `navigate.forward` act on the focused editor or preview panel only; for an
      editor → `openIntoEditorPanel` with `{ kind: 'history', index }`; for a preview →
      `preview.navigate` with the history intent and the body's captured `viewState`; no focused panel
      or no target → no-op; Back in one panel never touches another's history (FR-102, FR-105, FR-112);
      and the preview's handling of each reply — `shown` applies the update and restores its `viewState`,
      `refused` shows exactly one link notice naming the file and changes nothing else (FR-106c),
      `focusedOther` changes nothing in this panel (FR-106b).
- [x] T145 [general] [US7] Red: `--project integration` over
      `packages/ui/tests/integration/{navigation-history-service,editor-load-navigation,preview-history,preview-persistence}.integration.test.ts`;
      `--project component` over
      `packages/ui/tests/component/{open-into-panel,back-forward-buttons,history-mirror-sync,preview-path-sync,navigate-history}.test.ts`.
- [x] T153 [editor-documents] [US7] `contract` — `packages/ui/tests/contract/history-ipc.contract.test.ts`:
      shapes of `throng:history:attach/purge/setViewState/changed`, `throng:files:moved`, and that `changed`
      is registered as a broadcast (sent to every window, not to a viewer set)
      (`contracts/navigation-history.md` §2). Observe it fail. *(Placed before T146 so the bridge exists
      before any renderer task uses `window.throng.history` — see T154.)*
- [x] T146 [editor-documents] [US7] Implement `packages/ui/src/main/navigation-history-service.ts`. Makes T137 pass.
- [x] T154 [editor-documents] [US7] Implement `packages/ui/src/main/navigation-history-ipc.ts` and expose
      `window.throng.history` and `window.throng.files.onMoved` in `packages/ui/src/preload/preload.cts`
      and `packages/ui/src/renderer/global.d.ts`. Makes T153 pass; parity green. Lands before T147–T150,
      which call and type against the bridge, so the tree typechecks between tasks.
- [x] T147 [editor-documents] [P] [US7] Implement `packages/ui/src/renderer/editor/open-into-panel.ts`
      (the consolidated unsaved-open flow). Makes T139 pass.
- [x] T148 [renderer-ui] [P] [US7] Implement `packages/ui/src/renderer/navigation/history-store.ts` and
      `packages/ui/src/renderer/navigation/back-forward-buttons.tsx`. Makes T140's button assertions pass.
- [x] T149 [renderer-ui] [US7] Implement `packages/ui/src/renderer/navigation/navigate-history.ts` and add
      `navigate.back` / `navigate.forward` to `WINDOW_HANDLED_ACTIONS` with their dispatch in
      `packages/ui/src/renderer/app.tsx` (capture phase beats CodeMirror's `cursorSyntaxLeft/Right`). Makes T144 pass.
- [x] T150 [renderer-ui] [US7] Implement `packages/ui/src/renderer/navigation/history-mirror-sync.tsx`
      (`config.history` from broadcast `throng:history:changed` and `throng:files:moved`) and
      `packages/ui/src/renderer/preview/preview-path-sync.tsx` (a preview's `config.filePath` from
      broadcast `throng:preview:pathChanged` and `throng:files:moved`), both mounted and unmounted panels
      in this window's layout. `moved-path-sync.tsx` is **not** edited: it listens to editor sync
      messages, which never name a preview. Makes T141 pass.
- [x] T151 [editor-documents] [US7] Add history recording, history-intent `navigate`, `leavingViewState`
      and `setViewState` forwarding, `rewriteCurrent` on `repointed`, `history.purge` on `destroyed`, the
      history-record adoption in `attach`, `pathChanged` broadcasts on every `filePath` change, and restore precedence (history's current entry
      over `filePath`) to `packages/ui/src/main/preview-service.ts`. Makes T142 pass.
- [x] T152 [editor-documents] [US7] Add the `navigation` intent to `load` in
      `packages/ui/src/main/editor-coordinator.ts` and `packages/ui/src/main/editor-ipc.ts`, calling the
      history service; and at the Save-As re-point in the same file call
      `historyService.rewriteCurrent(panelId, newPath)` directly (the `DocumentLifecycleListener` slot is
      `PreviewService`'s and holds one listener). Makes T138 pass.
- [x] T155 [editor-documents] [US7] Wire in `packages/ui/src/main/main.ts`: construct
      `NavigationHistoryService`, inject it into the coordinator and `PreviewService`; **extend T065's
      combined `setOnMoved` callback** (never a second `setOnMoved` call, which would silently replace
      `markMoved` and 019 FR-008's move handling) to run, after `previewService.moved(moves)`,
      `historyService.rewritePaths(moves)` and then broadcast `throng:files:moved`; `historySize` changes →
      `applyCap`. A code-review check for this task: `git grep -n "setOnMoved\|setOnMoveStarted" -- packages/ui/src/main/main.ts`
      returns exactly one line each.
- [x] T156 [editor-documents] [US7] Replace the duplicated prompt flow in `openFileInTab` and
      `openFileInPanel` with `openIntoEditorPanel` in `packages/ui/src/renderer/editor/editor-open.tsx`;
      existing `packages/ui/tests/component/editor-open-routing.test.ts` stays green.
- [x] T157 [renderer-ui] [US7] In `packages/ui/src/renderer/workspace/panel-placeholder.tsx` render
      `BackForwardButtons` before the type icon for editor and preview, wire the header menu's
      `navigateBack` / `navigateForward`, forward mouse buttons 3 / 4, and call `history.purge` on
      destroy; call `history.purge` in `packages/ui/src/renderer/workspace/panel-destroy-sync.tsx` and
      `packages/ui/src/renderer/editor/clear-editor-panel-type.ts` (FR-110). Makes T140 pass in full,
      including its Send-to-Tab case.
- [x] T158 [renderer-ui] [US7] Mount `HistoryMirrorSync` and `PreviewPathSync` in `packages/ui/src/renderer/editor/editor-chrome.tsx`
      and attach history for editor panels on mount in
      `packages/ui/src/renderer/editor/use-editor.ts`.

**Checkpoint**: US7 scenarios 1–6 hold below E2E; Alt+Left precedence and cross-window history land in Phase 10.

---

## Phase 9: User Story 5 — A new preview type is one provider, not a feature (P3)

**Goal**: Prove FR-070 and SC-003 with a test-only provider and a structural guard.

**Independent Test**: T159 and T160 green with no edit outside the test files.

- [x] T159 [core-architecture] [P] [US5] `component` — `packages/ui/tests/component/preview-provider-seam.test.ts`:
      registers **inside the test only** a text provider `testText` (`.prvtxt`, one own toggle) and a
      binary provider `testBinary` (`.prvbin`, `sourceMimeTypes: ['application/x-prvbin']`) through
      `PreviewProviderRegistryContext` and injected registries, and asserts S1–S7 incl. S6a from
      `contracts/preview-provider-seam.md` §6 — Open In → Preview for both, status-bar button for text
      only, header menu shapes, generated settings under Editor → Previews (binary without default open
      action), descriptor completeness, restore with the provider enabled and dropped when disabled,
      disabled-provider affordances drawn disabled, and a binary preview mounting with
      `content.kind === 'resource'` and never parented (FR-001, FR-003, FR-051, FR-061, FR-062, FR-066,
      FR-067, FR-070, FR-071, FR-073, SC-003).
- [x] T160 [core-architecture] [P] [US5] `unit` — `packages/ui/tests/unit/preview-surfaces-name-no-provider.test.ts`:
      reads every file in the guard scope `contracts/preview-provider-seam.md` §3 defines (the renderer
      `preview/`, `state/`, `workspace/`, `editor/`, `explorer/` and `preferences/` directories, the four
      named `packages/ui/src/main/` files and `packages/core/src/config/app-settings.ts`, excluding the two
      registration indexes and the provider folders), asserts the scope includes
      `packages/ui/src/renderer/state/workspace-store.tsx` and `packages/ui/src/main/preview-service.ts`,
      and fails on any import from `preview/providers/` other than the two registration indexes, or any
      exact string literal `'markdown'` / `'.md'` outside comments (FR-070).
- [x] T161 [general] [US5] Red: `--project component` over
      `packages/ui/tests/component/preview-provider-seam.test.ts` and `--project unit` over
      `packages/ui/tests/unit/preview-surfaces-name-no-provider.test.ts`. Where they
      already pass, record that the earlier tasks met the seam; where they fail, T162 remediates.
- [x] T162 [core-architecture] [US5] Remediate each surface T159/T160 names so it takes the registry by
      injection rather than import — the candidates are `packages/ui/src/renderer/editor/status-strip.tsx`,
      `packages/ui/src/renderer/editor/editor-panel.tsx`, `packages/ui/src/renderer/editor/use-editor.ts`,
      `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/editor/open-router.ts`,
      `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/state/workspace-store.tsx`,
      `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/preview-protocol.ts` and
      `packages/ui/src/main/renderer-request-filter.ts`, and `packages/ui/src/renderer/state/subworkspace-window-client.ts`,
      `packages/ui/src/renderer/preview/preview-provider-sync.tsx`, `packages/ui/src/renderer/preview/open-preview.ts`,
      `packages/ui/src/renderer/preview/preview-commands.tsx`, `packages/ui/src/main/preview-purge.ts` — until
      T159 and T160 pass. Every one of
      them is inside T160's scope, so each can fail; edit only files a failure names.

**Checkpoint**: #388 can land as a descriptor, a view and two registration lines.

---

## Phase 10: E2E — only what no lower layer can hold (R22)

Sequential by construction: each task edits `packages/ui/tests/e2e/e2e-budget.json` (and three edit
`packages/ui/tests/e2e/parallel-plan.json`). Every declaration sits on one line, carries `@extended`,
its category, and exactly one `@reserve:*`. State the expected cost in one line before any run; never
run two E2E suites at once.

**The budget does not rise (Principle V: *"may fall and MUST NOT rise"*).** This feature's five new
declarations (four `@editor`, one `@window`) are offset by moving five existing declarations whose
assertion a lower layer already makes (four `@editor`, one `@window`) down, first — so the ratchet
reads 569 → 564 → 569, `@editor` 117 → 113 → 117, `@window` 197 → 196 → 197, `core` 39 throughout.
Each demotion follows the constitution's order: the lower-layer test that holds the assertion is
**observed failing against a deliberately broken implementation** (then the break is reverted), and
only then is the E2E declaration deleted. Declarations are named by title, not line, because each
deletion moves the lines below it.

- [x] T163a [e2e-harness] Demote *"Open In offers "New Editor" (a second panel) and disables it once the
      file is open"* from `packages/ui/tests/e2e/editor-feedback.e2e.ts` (`@extended @editor`, no
      reserve — it asserts an in-document menu item's enabled class). Its assertion is held by
      `packages/ui/tests/component/explorer-open-in-target.test.ts` (offered, then offered-but-disabled)
      and `packages/ui/tests/unit/open-in-targets.test.ts`: break the disabled rule in
      `packages/ui/src/renderer/editor/open-in-targets.ts`, observe both fail for that reason, revert, delete the E2E declaration, and re-seed
      `packages/ui/tests/e2e/e2e-budget.json` (569 → 568, `@editor` 117 → 116) with the sentence in
      `measuredFrom`.
- [x] T163b [e2e-harness] Demote *"a persisted language this build no longer knows opens as plain text,
      WITHOUT error, and is preserved (FR-005b)"* from `packages/ui/tests/e2e/editor-language-override.e2e.ts`
      (`@extended @editor`, no reserve — a pure precedence decision plus a persisted value). Held by
      `packages/core/tests/unit/language-precedence.test.ts`, `packages/ui/tests/integration/language-detect.integration.test.ts`
      (the same FR-005b case) and `packages/daemon/tests/integration/document-ipc.integration.test.ts`
      (the unknown id is kept): break the unknown-language fallback, observe them fail, revert, delete,
      re-seed (568 → 567, `@editor` 116 → 115).
- [x] T163c [e2e-harness] Demote *"the editor pill shows the containing folder in brackets (subfolder +
      root)"* from `packages/ui/tests/e2e/editor-feedback3.e2e.ts` (`@extended @editor`, no reserve).
      It asserts three things, and only the first is held lower today: (a) the path formatting — held by
      `packages/core/tests/unit/path-display.test.ts` (root prefix, subfolder, mixed separators); (b)
      that an editor panel's header renders the file pill `panel-file-<id>` with the folder part in
      `.panel-box__file-folder` and the name in `.panel-box__file-name`; (c) that the pill's `title` is
      the full native path (`packages/ui/src/renderer/workspace/panel-placeholder.tsx:754-766`). **First
      add (b) and (c)** to `packages/ui/tests/component/panel-box.test.ts`, which already renders
      `PanelPlaceholder` — an editor panel on a file in a subfolder and one at the root, asserting the two
      spans' text and the backslash-only `title` — and observe them fail against a pill that drops the
      folder span and a `title` built with `/`; revert. Then break the formatter and observe (a) fail;
      revert; delete the E2E declaration; re-seed (567 → 566, `@editor` 115 → 114).
- [x] T163d [e2e-harness] Demote *"the Files & Folders context menu has a New Folder action"* from
      `packages/ui/tests/e2e/editor-feedback2.e2e.ts` (`@extended @editor`, no reserve). Held for the
      root folder by `packages/ui/tests/component/explorer-root-menu.test.ts` ("New Folder creates in
      the root folder"), `packages/ui/tests/unit/menu-sections.test.ts` and
      `packages/ui/tests/integration/files-service.test.ts` (`newFolder` → `New folder`); the E2E's
      **subfolder** case has no lower test, so first add that case to
      `packages/ui/tests/component/explorer-root-menu.test.ts` (New Folder on a subfolder row opens the
      rename input and calls `newFolder` with that subfolder), observe it fail against a broken target
      folder, revert, then delete the E2E and re-seed (566 → 565, `@editor` 114 → 113).
- [x] T163e [e2e-harness] Demote *"T057 — a value outside a declared range is refused, and the last
      valid one stands"* from `packages/ui/tests/e2e/tab-settings.e2e.ts` (`@extended @window`, no
      reserve — a number control's validation and the stored value). Held by
      `packages/ui/tests/component/preferences-number-control.test.ts` ("refuses a value above the
      declared maximum, leaving the last valid one standing") and `packages/core/tests/unit/tabs-settings.test.ts`:
      break the range refusal, observe both fail, revert, delete, re-seed (565 → 564, `@window` 197 → 196).
- [x] T163 [e2e-harness] `packages/ui/tests/e2e/preview-hostile.e2e.ts` — one declaration
      `@extended @editor @reserve:runtime`, with its own app (`runOwnApp`, a seeded project holding the
      fixtures): (1) with *Load remote images* at its shipped ON, preview `hostile.md`; assert no dialog,
      no navigation, no `console` error from script execution, and — by recording `session` requests —
      no request other than `file:` app assets and `throng-preview:`; (2) turn the setting **off by
      writing `editor.previews.providers.markdown.loadRemoteImages: false` into the settings document on
      disk** (the config store's hot reload — never through the preferences window, so the spec takes no
      focus and needs no `parallel-plan.json` entry), wait for the setting to apply, preview
      `remote-images.md`, and assert no request for its `https:` image and its alt text shown (SC-004,
      FR-081, FR-082, FR-092, FR-093). Re-seed `packages/ui/tests/e2e/e2e-budget.json` (564 → 565,
      `@editor` 113 → 114) with its sentence in `measuredFrom`.
- [x] T164 [e2e-harness] `packages/ui/tests/e2e/preview-scroll.e2e.ts` — two declarations
      `@extended @editor @reserve:layout`: (1) with `long-1000.md` parented and scrolled halfway, typing
      at the top of the editor leaves the same heading in view after the update (FR-024; record O7's
      timing as an annotation, asserting none — see plan *Deliberately not E2E*); (2) following README →
      setup → install, scrolled halfway on setup before following the link to install, **Alt+Left twice**
      (install → setup → README) **then Alt+Right once** shows setup at the same place — the spec's User
      Story 7 scenario 3 keystrokes (FR-107). Add the file to `packages/ui/tests/e2e/parallel-plan.json` `serial` (`FOCUS`) and re-seed
      `e2e-budget.json` (565 → 567, `@editor` 114 → 116).
- [x] T165 [e2e-harness] `packages/ui/tests/e2e/navigation-history-keys.e2e.ts` — one declaration
      `@extended @editor @reserve:input`: in an editor that has shown `a.ts` then `b.ts`, with the caret
      inside a code line, a real Alt+Left shows `a.ts` and does not move the caret by syntax (FR-105).
      Add to `parallel-plan.json` `serial` (`FOCUS`); re-seed `e2e-budget.json` (567 → 568, `@editor` 116 → 117).
- [x] T166 [e2e-harness] `packages/ui/tests/e2e/preview-subworkspace.e2e.ts` — one declaration
      `@extended @window @reserve:window`: a parented preview synced into a sub-workspace window updates
      when its parent is typed into in the main window, and Back pressed in one window moves the other
      window's preview (FR-022, FR-110). Add to `parallel-plan.json` `serial` (`FOCUS`); re-seed
      `e2e-budget.json` (568 → 569, `@window` 196 → 197); `@core` stays 39. The budget file now reads
      exactly what it read before Phase 10.

---

## Phase 11: Polish & cross-cutting

- [x] T167 [config-preferences] `unit` — `packages/core/tests/unit/settings-inertness-044.test.ts` on the
      043 pattern: every new key (`editor.previews.updateDelayMs`, `maxWaitMs`, `copyFormat`,
      `providers.markdown.enabled`, `providers.markdown.defaultOpenAction`,
      `providers.markdown.loadRemoteImages`, `editor.navigation.historySize`) has a descriptor and a
      reader outside the config layer that also names its parent segment. **Red first**: run it once
      before any fix and record which keys it reports inert (expected: none, since T028–T158 added their
      readers; a reported key is a real defect). Then fix any inert key it finds in the file that should
      read it, and re-run only this file.
- *(T168 moved to Phase 1 as T003a, so the deferral's issue exists before the build starts.)*
- [x] T169 [spec-governance] [P] `README.md` — Highlights: file previews (Markdown), per-panel back/forward;
      Configuration: Editor → Previews and the history size. Current state only, no feature narration.
- [x] T170 [spec-governance] [P] `docs/quick-start.md` — §4 Edit files (opening a preview, Open in Editor,
      Back/Forward), the file tree's menu (Open In → Preview), §7 Make it yours (Previews settings,
      default open action), Keyboard reference (Alt+Left / Alt+Right, Ctrl+Enter in a preview, mouse
      back/forward buttons).
- [x] T171 [spec-governance] [P] `docs/testing.md` — record the five new E2E declarations and their
      reserves, the five declarations moved down by T163a–T163e and where their assertions now live, the
      unchanged budget figures, and that mouse X-buttons are a manual check (Playwright cannot press them).
- [x] T172 [spec-governance] [P] `CONTRIBUTING.md` — *Adding a preview provider*: the descriptor file,
      the view folder, the two registration lines, what the seam test and guard enforce.
- [x] T173 [spec-governance] [P] `CHANGELOG.md` — unreleased entry for file previews (closes #10) and
      panel navigation history (closes #136).
- [ ] T174 [general] Manual checks per `specs/044-file-previews/quickstart.md`, results into the PR description: quickstart §6 mouse back/forward
      buttons on editor, preview and terminal (O2); quickstart §2 step 3 update latency on `long-1000.md`
      against SC-002 (O7).
- [x] T175 [build-release] Bundle and dependency checks: `npm run build`, list `packages/ui/dist/renderer/assets`
      and record the `preview` chunk size and that `vendor` did not grow by the pipeline (O5); re-run
      `npm ls @lezer/highlight style-mod --workspace @throng/ui` (O8). Record in the PR description.
- [ ] T176 [general] Dispatch `.github/workflows/gate.yml`: `gh workflow run gate.yml --ref feature/S044-I10-I136-file-previews`, one
      blocking `gh run watch <id> --exit-status`, then take the verdict from `gh run view <id> --json
      status,conclusion`; quote the run URL and SHA. This closes Open item O3 (the request filter over the
      full E2E stage).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** → **Phase 2** (all of it) → story phases.
- **Phase 3 (US1)** precedes every other story: it creates `preview-commands.tsx` and the entry points.
- **Phase 4 (US6)** after US1 (edits `markdown-body.tsx`, `preview-panel.tsx`, `preview-commands.tsx`).
- **Phase 5 (US2)** and **Phase 6 (US3)** after US6 (both edit `preview-panel.tsx`); US3 after US2.
- **Phase 7 (US4)** after US3 (edits `editor-open.tsx`, `editor-chrome.tsx`, `main.ts`).
- **Phase 8 (US7)** after US4 (edits `editor-open.tsx`, `panel-placeholder.tsx`, `preview-service.ts`, `main.ts`).
- **Phase 9 (US5)** after every surface exists.
- **Phase 1**: T003a (the deferral issue) before any Phase 2 task.
- **Phase 2**: T056a directly after T056, before T057.
- **Phase 10** after Phases 3–8, in the order listed — the demotions T163a–T163e (listed first,
  despite the suffix) before the first new declaration T163, so `e2e-budget.json` never reads above 569; **Phase 11** last, T176 very last.
- *(Iteration 2026-09-15.)* **Phase 12** (T177–T180) → **Phase 13** (T181–T217, its own order table at the
  end of the phase) → **T176**. T176 stays the last task in the file's execution order even though its line
  sits in Phase 11.

The story phases are sequenced by **shared files**, not by product dependency: each story remains
independently testable at its checkpoint, but running two story phases at once would put two agents on
`preview-panel.tsx`, `panel-placeholder.tsx` or `main.ts`.

### Files edited by more than one task (always in different waves)

**T162** (Phase 9, not `[P]`) may additionally edit any file in its own candidate list, and only a file
T159 or T160 names; the rows below mark the ones already shared with another task, and the rest are
edited by T162 alone. It runs by itself, so it can share no wave with anything.

| File | Tasks |
|---|---|
| `packages/ui/src/main/main.ts` | T042, T056, T065, T136, T155 |
| `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/global.d.ts` | T041, T064, T154 |
| `packages/ui/src/main/preview-service.ts` | T063, T099, T151 (T162 if T160 names it) |
| `packages/ui/src/main/editor-coordinator.ts` | T044, T152 |
| `packages/ui/src/renderer/workspace/panel-placeholder.tsx` | T067, T070, T083, T123, T157 |
| `packages/ui/src/renderer/workspace/panel-destroy-sync.tsx` | T070, T157 |
| `packages/ui/src/renderer/app.tsx` | T070, T149 |
| `packages/ui/tests/integration/files-reveal-document.integration.test.ts` | T042, T061 |
| `packages/core/tests/unit/preview-settings.test.ts`, `packages/core/src/config/preview-settings.ts` | T014 / T028 only (`providersTurnedOff` included) |
| `packages/ui/src/renderer/preview/preview-panel.tsx` | T069, T102, T111, T122 (T162 if T160 names it) |
| `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` | T052, T096, T121 |
| `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts` | T051, T095 |
| `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` | T069, T085, T101 |
| `packages/ui/src/renderer/preview/preview-commands.tsx` | T084, T103 (T162 if T160 names it) |
| `packages/core/src/preview/request-policy.ts`, `packages/core/tests/unit/renderer-request-policy.test.ts` | T008 / T022, T056a (only if its probe fails) |
| `packages/ui/src/renderer/preview/content-menu.ts` | T098, T122 |
| `packages/ui/src/renderer/preview/preview.css` | T069, T100 |
| `packages/ui/src/renderer/editor/editor-chrome.tsx` | T084, T136, T158 |
| `packages/ui/src/renderer/editor/editor-open.tsx` | T135, T156 |
| `packages/ui/src/renderer/editor/use-editor.ts` | T079, T158 (T162 if T160 names it) |
| `packages/ui/tests/e2e/e2e-budget.json` | T163a, T163b, T163c, T163d, T163e, T163, T164, T165, T166 |
| `packages/ui/tests/e2e/parallel-plan.json` | T164, T165, T166 |

### Parallel waves (consecutive `[P]` runs)

| Wave | Tasks | Width |
|---|---|---|
| Setup | T002–T003 | 2 |
| Core tests | T005–T017 | 13 |
| Core impl | T019–T031 | 13 |
| Settings/scope tests | T033–T034 | 2 |
| Settings/scope impl + seam tests (independent) | T036–T039 | 4 |
| Seam impl | T041–T042 | 2 |
| Security tests | T045–T049 | 5 |
| Security impl | T051–T055 | 5 |
| PreviewService tests | T057–T061 | 5 |
| US1 tests | T071–T076 | 6 |
| US1 impl | T078–T082 | 5 |
| US6 tests | T086–T093 | 8 |
| US6 impl | T095–T100 | 6 |
| US2 tests | T104–T107 | 4 |
| US2 impl | T109–T110 | 2 |
| US3 tests | T112–T116 | 5 |
| US3 impl | T118–T121 | 4 |
| US4 tests | T124–T128 | 5 |
| US4 impl | T130–T134 | 5 |
| US7 tests | T137–T144 | 8 |
| US7 impl | T147–T148 (after T153 → T146 → T154) | 2 |
| US5 tests | T159–T160 | 2 |
| Docs | T169–T173 | 5 |
| Iteration defect start | T181–T182 | 2 |
| Iteration tests | T186–T196 | 11 |
| Iteration impl | T198–T200 | 3 |
| Iteration docs | T211–T215 | 5 |

---

## Implementation Strategy

### MVP

Phases 1–2, then Phase 3 (US1). Stop and validate quickstart §2 by hand. Because Phase 2 already puts
every security layer in front of the renderer, the MVP never shows unsanitised content.

### Incremental delivery

US1 → US6 (render everything, safely) → US2 (standalone) → US3 (panel behaviours) → US4 (preferences
and routing) → US7 (history) → US5 (seam proof) → E2E → docs → gate. Each checkpoint is a coherent
increment; none is released alone, and the gate (T176) is the only evidence of done-ness.

---

## Traceability

Every FR and SC maps to at least one task. Primary proving task(s) first.

| Requirement | Tasks |
|---|---|
| FR-001 | T005, T071, T078, T159 |
| FR-002 | T066, T072, T079, T083 |
| FR-003 | T005, T104, T109, T159 |
| FR-004 | T005, T059, T071, T072, T104 |
| FR-005 | T015, T030, T084 |
| FR-010 | T012, T059, T073, T080 |
| FR-011 | T059, T073, T080 |
| FR-012 | T005, T059, T066, T072, T104 |
| FR-013 | T057, T063 |
| FR-013a | T057, T107, T111 |
| FR-013b | T057, T107 |
| FR-013c | T043, T057, T058, T063, T141, T150, T158 |
| FR-014 | T059, T071, T073 |
| FR-015 / 015a–e | T112, T113, T115, T066, T118, T119, T122, T123 |
| FR-020 | T068, T114, T122 |
| FR-021 | T034, T037, T114 |
| FR-022 | T009, T057, T059, T166 |
| FR-023 | T058 |
| FR-024 | T076, T081, T085, T164 |
| FR-025 | T058 |
| FR-026 | T058, T106, T110 |
| FR-027 | T057, T106 |
| FR-028 | T009, T058, T116 |
| FR-030 | T066, T068, T114 |
| FR-031 | T011, T057, T074, T075, T082 |
| FR-032 | T011, T074 |
| FR-033 | T066, T116, T061, T067, T123 |
| FR-034 | T066, T068, T116 |
| FR-035, 035a–c | T038, T041, T115, T120, T121, T122 |
| FR-040, FR-041 | T057, T074, T083 |
| FR-042 | T059, T068, T116 |
| FR-043 | T058, T074 |
| FR-044 | T058, T068 |
| FR-050 | T014, T028 |
| FR-051 | T014, T159 |
| FR-052, FR-053 | T125, T131, T135 |
| FR-054, FR-055 | T105, T125 |
| FR-060, FR-060a | T009, T014, T057, T124 |
| FR-061 | T014, T033, T124, T159 |
| FR-062 | T005, T014, T059, T071, T104, T125, T136 |
| FR-063 | T014, T059, T126, T127, T028, T136 |
| FR-064 | T012, T126, T127 |
| FR-065 | T014, T124 |
| FR-066 | T141, T142, T143, T150, T158, T159 |
| FR-067 | T059, T128, T159 |
| FR-068 | T013, T143 |
| FR-070 | T159, T160, T162 |
| FR-071 | T005, T014, T159 |
| FR-072 | T005 |
| FR-073 | T005, T048, T159 |
| FR-074 | T008, T048 |
| FR-080 | T086, T089, T095, T097 |
| FR-081 | T045, T046, T163 |
| FR-082 | T046, T047, T163 |
| FR-083 | T093, T089, T100 |
| FR-084 | T007, T048, T087 |
| FR-085 | T010, T086 |
| FR-086 | T007, T086, T089 |
| FR-090, 090a–f | T007, T073, T087, T091, T092, T099, T102 |
| FR-091 | T007, T039, T042, T088, T091 |
| FR-092 | T007, T008, T049, T087, T163 |
| FR-093 | T008, T047, T049, T087, T163 |
| FR-094 | T088, T101 |
| FR-095 | T090, T098 |
| FR-096, 096a–d | T088, T101, T103 |
| FR-100 | T006, T140 |
| FR-101 | T006, T142 |
| FR-102 | T006, T138, T144 |
| FR-103, 103a, 103b | T006, T138, T142 |
| FR-104 | T140, T148, T157 |
| FR-105 | T015, T140, T144, T165 |
| FR-106, 106a–d | T138, T139, T142 |
| FR-107 | T006, T091, T142, T102, T151, T164 |
| FR-108 | T006, T033, T137 |
| FR-109 | T013, T137, T138, T141, T143, T152 |
| FR-110 | T059, T137, T140, T142, T116, T151, T157, T166 |
| FR-111 | T066, T140 |
| FR-112 | T006, T137, T144 |
| SC-001 | T071, T072, T104 |
| SC-002 | T009, T174 |
| SC-003 | T014, T159 |
| SC-004 | T046, T003, T163 |
| SC-005 | T093, T100 |
| SC-006 | T058, T068 |
| SC-007 | T006, T143, T190 |
| *Iteration 2026-09-15 (Phase 13):* | |
| Request 2 — text selection (defect against FR-035, FR-094) | T184, T182, T183, T185, T181 (budget offset) |
| FR-113 | T189, T188, T200, T202, T217 |
| FR-114 | T186, T187, T198 |
| FR-115 (refines FR-101, FR-103b) | T190, T191, T192, T199, T201, T203, T217 |
| FR-116 (refines FR-095) | T193, T204 |
| FR-117 (refines FR-085) | T194, T186, T187, T198, T205 |
| FR-118 (partly supersedes FR-015a) | T195, T206 |
| FR-119 (refines FR-091) | T208, T209, T210, T217 |
| FR-120 | T196, T207 |
| Docs currency for the above | T211, T212, T213, T214, T215 |
| *Iteration 2026-09-16 (Phase 15):* | |
| FR-121 (partly supersedes FR-113) | T231, T229, T240, T242, T237, T246, T253 |
| FR-121a | T231, T229, T240, T242, T253 |
| FR-121b | T229, T240, T237, T253 |
| FR-121c | T229, T231, T240, T242 |
| FR-121d | *superseded by FR-121f — no task* |
| FR-121e (refines FR-107; T222) | T232, T230, T233, T241, T242, T253 |
| FR-121f | T231, T229, T240, T242, T237, T253 |
| FR-121g | T230, T231, T229, T242, T237, T253 |
| FR-121h | T232, T230, T233, T240, T242, T253 |
| FR-122 (refines FR-114) | T234, T235, T243, T244, T253 |
| FR-122a | T234, T235, T243, T244 |
| FR-122b | T234, T243 |
| FR-122c (partly supersedes FR-015a) | T235, T227, T239, T244 |
| FR-122d | T227, T236, T239, T245 |
| FR-122e | T235, T236, T228, T245, T253 |
| FR-122f | T227, T239 |
| Budget offset for T237 (Principle V) | T226 |
| Docs currency for the above | T247, T248, T249, T250, T251 |

### Covered only by E2E or a manual check, deliberately

- **FR-105, mouse back / forward buttons** — the handler is component-tested (T140), but whether
  Electron on Windows actually delivers buttons 3 / 4 to the page is **manual only** (T174, Open item O2):
  Playwright cannot press X-buttons.
- **FR-105, Alt+Left beating CodeMirror in a real editor** — T165 (`@reserve:input`); the ordering is
  argued at unit/component tier but only a real keystroke proves it.
- **FR-024 and FR-107, what is scrolled into view** — T164 (`@reserve:layout`); T076 proves only the
  anchor arithmetic.
- **SC-004, no request in the real engine** — T163 (`@reserve:runtime`); T046 proves the sanitised DOM.
- **FR-096a, arrow / Page / Home / End actually scrolling** — component tier proves the keys are not
  consumed and the body is focusable; the native scroll itself is a manual check (quickstart §3).
- **SC-002, end-to-end latency** — arithmetic at T009; the real render time is measured by hand (T174)
  and recorded as an annotation in T164 (O7), deliberately **not asserted**: a wall-clock bound on a
  shared hosted runner is a timing assertion of the class `docs/testing.md` records as the leading
  source of flakes, and a flaky gate would cost more than the property it guards (plan *Testing
  strategy*, *Deliberately not E2E*).
- **FR-113, what the editor's scroll puts at the top of a real preview** *(iteration 2026-09-15)* — the
  store, the top-line helper and the wiring are unit and component (T188, T189); the real-engine geometry of
  `restoreScrollAnchor` is already `preview-scroll.e2e.ts`'s claim; the whole loop is a manual check (T217,
  quickstart §8 step 2). No E2E: the new part is the connection, which is the component layer's (research R23).
- **FR-115, a jump entry restoring its place** *(iteration 2026-09-15)* — reducer, service and routing at
  unit, integration and component (T190–T192); restoring a scroll anchor in a real engine is
  `preview-scroll.e2e.ts` declaration 2's existing claim; manual step 3 (research R24).
- **FR-119, which application's window is in front** *(iteration 2026-09-15)* — manual only (T208, T210,
  T217): outside the page, and a hosted runner has no default browser to assert against (research R27).
- **Request 2, a real drag selecting text** *(iteration 2026-09-15)* — T183 (`@reserve:input`); T182 pins
  the cascade.
- **SC-005, body-text contrast** — no preview-specific contrast test: T093 pins every preview text
  colour to a pairing `theme-quality.ts` already measures on every shipped theme, so the existing
  theme-quality suite is the proof.

### Open plan items that gate a task

| Item | Gates |
|---|---|
| O1 (`file:` image under CSP `'self'`) | T163 — `hostile.md` includes a `file:` image outside the app directory; the assertion confirms the two designed guards hold (the sanitiser — its URL filter from T052 and its image hook from T096, whose classification T007 tests — removes the `src`, and the request filter's row, tested by T008, cancels `file:` outside the renderer directory). CSP is not relied on either way; if a request is recorded, the defect is in whichever of those two let it through, fixed there with its unit row |
| O3 (request filter vs existing loads) | T056a (the drag ghost's `data:text/html` page, early) and T176 (everything else, in the full E2E stage) |
| O4 (DOMPurify under jsdom 29) | T046 — if DOMPurify misbehaves under jsdom, the component tier needs a documented fallback before T052 |
| O5, O8 | T175 |
| O6 (which projects a window holds, for the purge skip) | T133 — read `packages/ui/src/renderer/state/workspace-store.tsx:409-415` before implementing |
| O2, O7 | T174 |

---

## Phase 12: Convergence

*Baseline converge, 2026-09-15, against the spec, plan and tasks as they stood before any
speckit-iterate amendment. Adversarial-review fix batches A–D (`session-notes/progress.md`,
FIX BATCHES) are already queued and are not repeated here.*

- [x] T177 [renderer-ui] Keep the reader's scroll position when a preview's file changes path without a link being followed (in-app rename or move, or Save As from the parent editor): `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx:198-207` treats every `filePath` change as a navigation and sets `scrollTop = 0`, while `packages/ui/src/main/preview-service.ts` re-points the run on `repointed` (`:727-728`, `:1087-1099`) and `moved()` (`:672-681`). Distinguish a re-point from a navigation (a signal on the update, or the history intent) and add the rename case to `packages/ui/tests/component/markdown-body.test.ts` first, observed failing, per FR-024 with FR-013c (partial)
- [x] T178 [renderer-ui] Slug a heading from its rendered text, not its raw source, so `[x](#foo-baz)` reaches `## [Foo](bar.md) baz`, `## <a name="install"></a>Install` and `## _Note_`: `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts:233-239,261` slugs `inline.content`; keep `packages/core/src/preview/providers/markdown/heading-line.ts:138-139` (FR-090d caret placement) in agreement; failing cases first in `packages/ui/tests/unit/markdown-pipeline.test.ts` and `packages/core/tests/unit/heading-line.test.ts`, per FR-090b, FR-090f (partial)
- [x] T179 [editor-documents] Purge an editor panel's navigation history on Clear panel type only when this view ends the panel, as every other route does (`killsSession` / `viewEndsPreview`): `packages/ui/src/renderer/editor/clear-editor-panel-type.ts:57` purges unconditionally, so clearing a synced editor's type in a sub-workspace window deletes the project window's history for the same panel (`history-mirror-sync.tsx:70-74`); component test for the sub-workspace case first, per FR-110 (contradicts)
- [x] T180 [spec-governance] Correct `docs/testing.md:152`, which says of `preview-subworkspace.e2e.ts` "Back pressed in either window moves both"; the declaration presses Back in the sub-workspace window only (`preview-subworkspace.e2e.ts:129-138`), as `e2e-budget.json` already states, per T171 (partial)

---

## Phase 13: Iteration 2026-09-15

*Appended by `speckit-iterate` for spec Clarifications **Session 2026-09-15** (FR-113–FR-120) and the
text-selection defect (FR-035, FR-094). Design: plan.md → *Iteration 2026-09-15*; research R23–R29;
data-model §14; contracts `settings-bindings-tokens.md` (iteration obligations), `menus-and-controls.md`
§4 and §8, `navigation-history.md` §3 and §8, `security-policy.md` Layer 1, Layer 2 and *Links out*;
quickstart §8. The `contracts/preview-ipc.md` §1 change for FR-115 is written in
`session-notes/iterate-preview-ipc-pending.md` and is applied to the contract before T201 starts.*

**Starts after** Phase 12 (T177–T180) and the adversarial-review fix batches C and D, which edit
`markdown-body.tsx`, `pipeline.ts` and `preview-panel.tsx`. **T176** (the hosted gate) stays open and runs
after T217.

Layer rules, Red checkpoints and the one-test-command-at-a-time rule are this file's own (top of file).
Every E2E step states its expected cost in one line first.

### 13.1 Request 2 — preview text cannot be selected with the mouse (defect; FR-035, FR-094)

*Hypothesis until T184 shows both tests failing for it: `theme.css:200-207`'s app-wide
`user-select: none` has no re-enable for a preview body (research R29).* The E2E reproduces the reported
behaviour and is written **before** the fix, so it is a reproduction, not reassurance; the budget is held
flat by T181.

- [x] T181 (performed by T218 on 2026-09-16: auto-save demoted, budget back to 569) [e2e-harness] [P] [US3] **Demote one E2E declaration to pay for T183.** Audit
      `packages/ui/tests/e2e/*.e2e.ts` for an `@extended @editor` declaration carrying **no** `@reserve:*`
      tag (one of the 116 counted in `packages/ui/tests/e2e/reserve-tag-debt.json`) whose assertion a
      unit, component or integration test already makes, or can make with one added case — the T163a–T163e
      method. Name it by title in this task's commit. Write or identify the lower-layer test, observe it
      **fail against a deliberately broken implementation**, revert the break, delete the E2E declaration,
      and re-seed `packages/ui/tests/e2e/e2e-budget.json` (569 → 568, `@editor` 117 → 116, the sentence in
      `measuredFrom`) and `packages/ui/tests/e2e/reserve-tag-debt.json` (116 → 115). If the spec file is
      in `packages/ui/tests/e2e/parallel-plan.json` and loses its last declaration, remove its entry. **If
      no such declaration exists, stop and report — do not raise the budget.**
- [x] T182 [renderer-ui] [P] [US3] `unit` RED — new `packages/ui/tests/unit/preview-text-selection-css.test.ts`,
      reading files the way `packages/ui/tests/unit/preview-css-tokens.test.ts:23-28` does: (1)
      `packages/ui/src/renderer/theme.css`'s `body` rule declares `user-select: none` (so the re-enable is
      needed — if it ever stops, this case tells the next reader why the other one exists); (2)
      `packages/ui/src/renderer/preview/providers/markdown/markdown.css` has a rule whose selector list
      includes `.preview-markdown` declaring **both** `user-select: text` and `-webkit-user-select: text`.
      Expected RED: (2) fails — `markdown.css` names no `user-select` today.
- [x] T183 [e2e-harness] [US3] `e2e` RED — **after T181.** One new declaration in
      `packages/ui/tests/e2e/preview-scroll.e2e.ts`, on one line, tags `['@extended', '@editor',
      '@reserve:input']`, reusing the file's app and fixture helpers: preview a document with two plain
      paragraphs and a link (a fixture already under `packages/ui/tests/fixtures/preview/`, e.g.
      `links/README.md`); (1) a real `page.mouse` down → move → up across both paragraphs leaves
      `window.getSelection().toString()` non-empty and containing text from both; (2) with Ctrl held, a
      drag that starts on a link leaves a non-empty selection, and the panel still shows the same file with
      no link notice — nothing was followed (FR-094). Justify the reserve in a comment: jsdom applies no
      stylesheet and the Range API ignores `user-select`, so no substitute can hold "a drag selects".
      Re-seed `packages/ui/tests/e2e/e2e-budget.json` (568 → 569, `@editor` 116 → 117) — the totals now
      read what they read before T181. The spec is already `serial` (`FOCUS`) in `parallel-plan.json`.
- [x] T184 [general] [US3] Red checkpoint for T182 and T183: load `running-tests` and `throng-testing`;
      state the E2E's expected cost; run `npx vitest run --project unit packages/ui/tests/unit/preview-text-selection-css.test.ts`,
      then `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts -g "<T183's title>"` against a
      fresh build (`npm run build`). Confirm T182 (2) fails for the missing declaration and T183 fails
      because the selection is **empty** (step 1) — not for a locator or fixture error. If T183 passes, the
      hypothesis is wrong: stop and report; do not write T185.
- [x] T185 [renderer-ui] [US3] Fix — in `packages/ui/src/renderer/preview/providers/markdown/markdown.css`,
      `.preview-markdown { user-select: text; -webkit-user-select: text; }`, with a comment naming
      `theme.css`'s app-wide rule and why the re-enable lives here: a Markdown class outside the provider
      folder fails `packages/ui/tests/unit/preview-surfaces-name-no-provider.test.ts`, and whether a body's
      content is selectable is its provider's `textSelection`, not the chrome's. No colour, so
      `preview-css-tokens.test.ts` is unaffected. Re-run T182's file, `preview-css-tokens.test.ts`,
      `preview-surfaces-name-no-provider.test.ts` and T183's declaration (after `npm run build`): all green.

### 13.2 Failing tests for FR-113–FR-118 and FR-120 (one wave)

- [x] T186 [config-preferences] [P] [US1] `unit` RED — both new settings leaves (FR-114, FR-117):
      `packages/core/tests/unit/preview-settings.test.ts` — `syncScroll` defaults `true`, a non-boolean
      stored value parses to `true`, its descriptor is a toggle under group `Editor` subgroup `Previews`
      labelled *Synchronise preview and editor scrolling* with **no** `enabledWhen`; the generated
      `editor.previews.providers.markdown.showFrontMatter` descriptor is a toggle labelled *Markdown: Show
      front matter*, default `true`, `enabledWhen` Markdown's Enabled; update every whole-object expectation
      in that file for both leaves. Also: `packages/core/tests/unit/editor-settings.test.ts` (clone copies
      `syncScroll`; whole-object expectations), `packages/core/tests/unit/settings-metadata.test.ts`
      (REQUIRED list gains both keys), `packages/core/tests/unit/preview-registry.test.ts:256-259` (the
      Markdown descriptor's settings list), and `packages/core/tests/unit/settings-inertness-044.test.ts`
      (key list and its header count gain both keys). Expected RED: missing leaf / descriptor / key; the
      inertness cases stay red until T202 (reader of `syncScroll`) and T205 (reader of `showFrontMatter`).
- [x] T187 [config-preferences] [P] [US1] `component` RED — `packages/ui/tests/component/settings-tab-previews.test.ts`:
      the Previews subgroup draws *Synchronise preview and editor scrolling* and *Markdown: Show front
      matter*; toggling each writes its key; with Markdown disabled, *Show front matter* is drawn disabled
      and visible (FR-061) while *Synchronise preview and editor scrolling* stays enabled.
- [x] T188 [editor-documents] [P] [US1] `unit` RED — new `packages/ui/tests/unit/editor-scroll-store.test.ts`
      for `packages/ui/src/renderer/editor/editor-scroll-store.ts` (data-model §14.4): publish then read
      per editor panel id; the same line twice emits once; the snapshot for an unchanged panel is the same
      value; forget removes and emits; two panel ids are independent. And a pure helper
      `editorTopLine(view)` over a fake view object: `posAtCoords` at the scroller's top-left → `doc.lineAt(pos).number - 1`;
      `posAtCoords` returning `null` → `0`. Expected RED: module not found.
- [x] T189 [renderer-ui] [P] [US1] `component` RED — new `packages/ui/tests/component/preview-scroll-sync.test.ts`,
      mounting the preview panel as `packages/ui/tests/component/preview-panel-mount.test.ts` does and
      stubbing block rects as `packages/ui/tests/component/markdown-body.test.ts` does, for a preview whose
      update carries `parent: { panelId: 'ed-1', … }`: (1) setting on, publishing line N for `ed-1` scrolls
      the body host so the block with the greatest `data-source-line` ≤ N is at its top (FR-113); (2)
      setting off → no scroll; (3) `parent: null` (standalone) → no scroll; (4) the update re-parents to
      `ed-2` → follows `ed-2`, ignores `ed-1`; (5) a line published before the file is drawn is applied once
      it is; (6) after a sync, the reader scrolls the host by hand, then a live update arrives → the host
      keeps the reader's place (captured anchor), not line N (FR-024; "not fight it"); (7) scrolling the host
      publishes nothing to the store and sends no `preview.navigate` (FR-101). Expected RED: nothing
      scrolls — no `syncLine` prop, no subscription.
- [x] T190 [core-architecture] [P] [US7] `unit` RED — `packages/core/tests/unit/navigation-history.test.ts`
      for `recordJump` (data-model §14.2): H11 empty unchanged; leaving stored on the current entry; arriving
      equal to leaving → no entry (FR-115's no-duplicate rule); otherwise forward entries discarded and a
      same-file entry appended with `arriving`, index at it; step 2's merge when the reader scrolled back to
      the previous jump's place (H12); the cap applies (H13, H6); an over-1 KiB `arriving` is dropped as
      `keepableViewState` drops it; H14 `moveTo`/`targetOf` across same-file entries; H15 `parseHistory` keeps
      same-file consecutive entries with different view states; **H2a refined** — `rewriteCurrent` inside a
      jump chain `[a@top, a@h]` rewrites both to `b` with view states kept, and a neighbour outside the run
      naming `b` still merges; every existing H2/H2a case unchanged. Add a `recordJump` op to the SC-007
      property test at `:430-470` with H12 as an invariant. Expected RED: `recordJump` not exported.
- [x] T191 [editor-documents] [P] [US7] `integration` RED — (1) `packages/ui/tests/integration/navigation-history-service.integration.test.ts`:
      `recordJump` on a preview record appends and broadcasts `changed` once; on an editor record it is a
      no-op with no broadcast (H10); an equal jump broadcasts only the leaving view-state change or nothing.
      (2) `packages/ui/tests/integration/preview-service-navigate.integration.test.ts`: `intent: { kind:
      'heading' }` for the run's current file records a jump, performs **no** read (the file-read spy is not
      called) and answers `shown` with the unchanged revision; a `heading` intent naming another file records
      nothing and answers the unchanged snapshot; a history step onto an entry of the run's current file
      moves the position and emits the entry's `viewState` to every viewer with no re-read and no
      `pathChanged` broadcast; the existing same-file **`link`** case at `:223-233` still records nothing.
      Expected RED: the intent is rejected by the request parser / `recordJump` missing.
- [x] T192 [renderer-ui] [P] [US7] `component` + `unit` RED — (1) `packages/ui/tests/component/preview-follow.test.ts`:
      **supersede** `:93-117` ("same-document headings never reach main") with FR-115's rule — Ctrl+click on
      a found `#heading` calls `preview.navigate` once with `intent: { kind: 'heading' }`, `target.absPath` the
      current file, and both view states, the top being `{ line: 0, offsetRatio: 0 }`; a `file` link to the
      current file with a fragment does the same; without a fragment it scrolls to the top and calls nothing;
      a missing heading raises `link-missing-heading` and calls nothing. Keep the old test's title in a
      comment naming FR-115 as its supersession. (2) `packages/ui/tests/component/navigate-history.test.ts`,
      preview block: a mirrored history `[README, guide, guide@h]` at index 2 — Back sends a history intent
      for index 1 and the body restores the top; Back again targets README (FR-115's "then the previous
      document"). (3) `packages/ui/tests/unit/scroll-anchor.test.ts`: `restoreScrollAnchor` with `{ line: 0,
      offsetRatio: 0 }` sets `scrollTop` to 0 even when the first block's `data-source-line` is greater than 0.
      Expected RED: `navigate` never called for a heading; restore leaves `scrollTop` unchanged.
- [x] T193 [renderer-ui] [P] [US6] `component` RED — `packages/ui/tests/component/preview-link-menu.test.ts`:
      amend `:74-85` so `linkAddress` takes the document path and a `heading` link gives
      `<docPath>#install` (was `'#install'` at `:80`); `file` unchanged with and without a fragment;
      `external` the URL; `outside` its target as written; and no result starts with `#`. Extend the mounted
      clipboard case (`:88`) so *Copy Link Address* on a same-document heading link writes the preview's own
      absolute path + `#fragment` (FR-116, US6 scenario 12). Expected RED: `#install` returned.
- [x] T194 [renderer-ui] [P] [US6] `unit` + `component` RED (FR-117) — (1) `packages/ui/tests/unit/markdown-pipeline.test.ts`:
      with `frontMatter: false` in the render environment, `front-matter.md` renders no front matter table,
      no `<hr>`, and none of its YAML keys or values as text, and the first body block's `data-source-line`
      equals the body's line offset (the block's line count); `front-matter-invalid.md` with `false` renders
      no code block either; `true` is unchanged. (2) `packages/ui/tests/component/markdown-body.test.ts`:
      `providerSettings.showFrontMatter: false` draws no front matter table; changing it to `true` redraws
      with the table. Expected RED: the table always renders.
- [x] T195 [renderer-ui] [P] [US3] `component` RED (FR-118) — (1) `packages/ui/tests/component/preview-links.test.ts`:
      a followable link carries `data-throng-target` equal to its `title` without ` — Ctrl+click to follow`,
      bidi controls stripped; an inert link has none; a document-written `data-throng-target` on any element
      is gone. (2) `packages/ui/tests/component/preview-status-bar.test.ts`: **amend** `:60` ("carries no
      readouts") to FR-118 — with no `readout` the readouts group is empty; with one it shows that text in the
      editor strip's readout class; the controls group and its button are unchanged either way. (3) new
      `packages/ui/tests/component/preview-link-readout.test.ts`, mounted panel: pointer over a link → the
      readout shows its target; pointer out → cleared; `focusin` on a link (Tab) → shown; `focusout` →
      cleared; with link A focused, pointer over link B → B's target, pointer out → A's target again
      (hover wins, focus is the fallback — `contracts/menus-and-controls.md` §8); pointer over an image
      inside a link → the link's target, and moving from the link's text onto that image (a `pointerout`
      whose `relatedTarget` is inside the same link) does not clear it; the panel's file changes → cleared;
      `editor.showStatusBar` off → no bar is rendered. Expected RED: no attribute, no readout.
- [x] T196 [renderer-ui] [P] [US6] `component` RED (FR-120) — `packages/ui/tests/component/preview-images.test.ts`:
      a project image `![](image.png)` has `title` `image.png` and a `src` beginning `throng-preview:` that
      the title does not contain; `![](image.png "Diagram")` → `image.png — Diagram`; a remote `https:` image
      (setting on) → its URL; an `http:` image (blocked) → its alternative-text span carries the same
      `title`; with *Load remote images* off, the same for an `https:` image; `[![](a.png "x")](https://real/)`
      → the image has **no** `title` and the link's title is the generated one (I3); bidi controls in a
      source or title are stripped; and, mounting the body as `packages/ui/tests/component/markdown-body.test.ts`
      does, an image whose `error` fires is replaced by an alternative-text span carrying its `title`.
      Expected RED: no `title` built from `src`.
- [x] T197 [general] Red checkpoint for T186–T196: load `running-tests`; run exactly the files those
      tasks name, once per project (`unit`, `component`, `integration`), capture the full output, and confirm
      each new or amended case fails for its stated reason — not an import typo. One test command at a time.

### 13.3 Implementation

- [x] T198 [config-preferences] [P] [US1] Settings (FR-114, FR-117): `packages/core/src/preview/settings-types.ts`
      (`PreviewSettings.syncScroll`), `packages/core/src/config/preview-settings.ts` (default, descriptor,
      parse beside `copyFormat`), `packages/core/src/config/app-settings.ts` (`editorSettings()` leaf list,
      `cloneEditor`), `packages/core/src/preview/providers/markdown.ts` (`showFrontMatter` own setting beside
      `loadRemoteImages`). No `SHIPPED_DEFAULTS_VERSION` change. Re-run T186's files except the inertness
      cases, and T187's: green.
- [x] T199 [core-architecture] [P] [US7] History reducer and wire type (FR-115): `recordJump` and the H2a
      jump-chain refinement in `packages/core/src/navigation/history.ts`, exported through
      `packages/core/src/index.ts` if the barrel lists history functions; `PreviewNavigateRequest` in
      `packages/core/src/preview/wire-types.ts` gains intent `{ kind: 'heading' }` and `arrivingViewState?`
      (data-model §14.6). Re-run T190's file: green.
- [x] T200 [editor-documents] [P] [US1] Scroll store (FR-113): new `packages/ui/src/renderer/editor/editor-scroll-store.ts`
      (`publishEditorTopLine`, `editorTopLine`, `useEditorTopLine`/subscribe, `forgetEditorTopLine`, test reset)
      on the `caret-store.ts` pattern; in `packages/ui/src/renderer/editor/use-editor.ts`, the existing
      `scrollDOM` scroll listener (`:1264-1272`) also publishes `editorTopLine(view)` through one
      `requestAnimationFrame` per frame, publishes once after `registerEditorView` (`:1275`), and forgets at
      unmount beside the view's unregistration. Re-run T188's file: green.
- [x] T201 [editor-documents] [US7] Main (FR-115) — **after T199, and after the pending `contracts/preview-ipc.md`
      §1 edits are applied.** `packages/ui/src/main/navigation-history-service.ts`: `recordJump(panelId,
      leaving, arriving)`, a no-op unless the record is a preview. `packages/ui/src/main/preview-ipc.ts`: the
      navigate request parser accepts `heading` and `arrivingViewState`. `packages/ui/src/main/preview-service.ts`:
      handle `heading` before the link path's "already shown" short-circuit (target is the run's current file →
      `recordJump`; otherwise nothing; always the unchanged snapshot, no read, no `emit`); a `history` step onto
      an entry naming the run's current file → store leaving, `moveTo`, `emit` with the entry's `viewState`,
      no re-read and no `moveRun`. Re-run T191's files: green.
- [x] T202 [renderer-ui] [US1] Scroll sync in the preview (FR-113) — **after T198 and T200.**
      `packages/ui/src/renderer/preview/provider-view.ts`: optional `syncLine?: number | null` on
      `PreviewBodyProps`, with its doc comment. `packages/ui/src/renderer/preview/preview-panel.tsx`: subscribe to
      `state.parent.panelId`'s top line while `settings.editor.previews.syncScroll` is on and the provider is
      `text`, and pass it as `syncLine`. `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`:
      when `syncLine` changes, `restoreScrollAnchor(scroller, { line, offsetRatio: 0 })`, or once drawn if it
      arrived first; the live-update path keeps its captured anchor. Re-run T189's file (green) and
      `packages/ui/tests/component/markdown-body.test.ts` (green except T194's front matter cases, which
      wait for T205).
- [x] T203 [renderer-ui] [US7] Heading jumps in the renderer (FR-115) — **after T201 and T202.**
      `packages/ui/src/renderer/preview/preview-panel.tsx`: in `onFollow`, for a `heading` link and for a `file`
      link to the current file **with** a fragment, capture the leaving view state (top → `{ line: 0,
      offsetRatio: 0 }`), scroll with `scrollToHeading`, and — only when the heading was found — capture the
      arriving state and call `preview.navigate` with `intent: { kind: 'heading' }`; update the header comment's
      table (`:45-47`) that says headings never reach main.
      `packages/ui/src/renderer/preview/providers/markdown/scroll-anchor.ts`: `restoreScrollAnchor` treats
      `{ line: 0, offsetRatio: 0 }` as `scrollTop = 0`. Re-run T192's files: green.
- [x] T204 [renderer-ui] [US6] Copy Link Address (FR-116): `packages/ui/src/renderer/preview/content-menu.ts`
      `linkAddress(link, docPath)` per `contracts/menus-and-controls.md` §4; its call site in
      `packages/ui/src/renderer/preview/preview-panel.tsx` (`:721`) passes `stateRef.current.filePath`.
      Re-run T193's file: green.
- [x] T205 [renderer-ui] [US6] Show front matter (FR-117) — **after T198.**
      `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`: `RenderEnvironment.frontMatter`; when
      `false`, `render()` skips `renderFrontMatter` and keeps `bodyLineOffset`.
      `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`: pass
      `providerSettings.showFrontMatter !== false` and add it to the render effect's dependencies (`:245`).
      Re-run T194's files and the full T186 file set, inertness cases included: green.
- [x] T206 [renderer-ui] [US3] Link target readout (FR-118):
      `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` (link hook sets `data-throng-target` =
      `displayTarget(target)`); `packages/ui/src/renderer/preview/provider-view.ts` (optional
      `onLinkTarget`); `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (delegated
      `pointerover`/`pointerout` and `focusin`/`focusout` resolving `closest('[data-throng-link]')`, reporting
      `onLinkTarget('hover' | 'focus', attribute | null)`); `packages/ui/src/renderer/preview/preview-panel.tsx`
      (panel-local `{ hover, focus }`, both cleared on file change, `hover ?? focus` passed as `readout`); `packages/ui/src/renderer/preview/preview-status-bar.tsx`
      (render `readout` in the readouts group with the editor strip's readout class);
      `packages/ui/src/renderer/preview/preview.css` (a no-colour rule: `min-width: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap` for the readout). Re-run T195's files and
      `packages/ui/tests/unit/preview-css-tokens.test.ts`: green.
- [x] T207 [renderer-ui] [US6] Image tooltips (FR-120):
      `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` image hook — authored `src` read before
      rewrite; `title` per `contracts/security-policy.md` Layer 2 (iteration row), none under a followable link
      (`closest('[data-throng-link]')`); `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`
      `showAltText` copies `title` onto the span. Re-run T196's file, `preview-sanitise.test.ts` and
      `preview-copy.test.ts` (the export profile still drops image titles): green.

### 13.4 FR-119 — the browser ends in front (probe first; cause unproven)

- [x] T208 [core-architecture] [US6] **Instrumented probe** (research R27, Open item O9). Temporarily add
      `diagnostics.log.info` lines with `performance.now()` timestamps: immediately before and after
      `shell.openExternal` in both handlers in `packages/ui/src/main/external-url.ts`; `focus` and `blur` on
      every `BrowserWindow` and `app` `browser-window-focus` / `browser-window-blur` in
      `packages/ui/src/main/main.ts`; and in `WindowManager.raiseOne` (`packages/ui/src/main/window-manager.ts`).
      Build, then run hands-on under the `throng-testing` skill's launch rules (no test command): Ctrl+click
      `https://example.com/` in a preview of `packages/ui/tests/fixtures/preview/links/README.md` three times,
      and the same URL printed in a terminal three times, with the default browser running, then again with it
      closed; the maintainer notes which window ends in front each time. Record the log excerpt, the counts
      and the verdict — **H-a** (a throng `focus` or `raiseOne` after the open with no input), **H-b** (no
      throng `focus`, throng still in front), or **not reproduced** — in `specs/044-file-previews/research.md`
      R27 under a dated *Probe result* heading. Remove every probe line; `git diff` on the three source files
      is empty afterwards.
- [x] T209 [core-architecture] [US6] `unit` RED, by T208's verdict. **H-b:** in
      `packages/ui/tests/unit/external-url.test.ts` (`registerOpenExternalIpc` block, `:71`), both handlers
      given a fake `IForegroundHandoff` call `allow()` exactly once **before** `shell.openExternal` for an
      accepted URL, and never for a refused one (`javascript:`, and `mailto:` on `throng:openExternal`).
      **H-a:** a failing test at the lowest layer that reproduces the trigger T208 named — for
      `WindowManager`, `packages/ui/tests/unit/window-manager.test.ts` with fake windows — asserting throng
      does not raise itself after an external open, while a user focus still raises the group (002 FR-022)
      and closing Preferences still returns throng to front (007 FR-013a). **Not reproduced:** no test; file
      a Bug through `github-issues` with T208's conditions and counts, and mark FR-119 open in this file's
      traceability. Run the named file once and confirm it fails for the stated reason.
- [x] T210 [core-architecture] [US6] Fix, by T208's verdict. **H-b:** `registerOpenExternalIpc(ipc, shell,
      foregroundHandoff)` in `packages/ui/src/main/external-url.ts` calls `allow()` after the scheme check and
      before the open; `packages/ui/src/main/main.ts:977` passes `container.get<IForegroundHandoff>(UI_TYPES.ForegroundHandoff)`;
      widen the interface's doc comment in `packages/core/src/abstractions/foreground-handoff.ts` from "a
      command running in a terminal" to "a window the user's own action opened". **H-a:** the fix at the
      trigger T209 pinned, nothing more. Re-run T209's file and the neighbouring suite
      (`packages/ui/tests/unit/window-manager.test.ts` or `packages/ui/tests/integration/electron-shell-integration.test.ts`):
      green. Then repeat T208's hands-on steps without the probe and record the counts for T217.

### 13.5 Documentation currency (same change as the behaviour)

- [x] T211 [spec-governance] [P] `README.md` — Highlights (file previews, `:90-99`): editor scroll drives
      the preview; text selectable; hovering a link shows its target in the preview's status bar; heading
      links are Back/Forward steps in a preview. Configuration (`:203-211`): `editor.previews.syncScroll` and
      the Markdown provider's **Show front matter**. Current state only.
- [x] T212 [spec-governance] [P] `docs/quick-start.md` — *Preview a file* (`:296-315`): scroll sync and the
      setting, selecting and copying text, the status-bar link target, image tooltips, what *Copy Link
      Address* copies, the browser coming to the front; *Step back and forward* (`:317-325`): a followed
      heading link in a preview is a step, editors unchanged; §7 *Previews* (`:460-465`): the two settings.
- [x] T213 [spec-governance] [P] `docs/testing.md` — the 044 table (`:143-152`): T183's declaration and its
      reserve, T181's demotion and where its assertion now lives, the unchanged budget and the debt
      116 → 115; why FR-113, FR-115 and FR-119 have no E2E and are checked by hand (quickstart §8).
- [x] T214 [spec-governance] [P] `CHANGELOG.md` — `## Unreleased`, the file previews and Back/Forward
      entries (`:35-50`): the additions and the text-selection fix, in the file's existing voice.
- [x] T215 [spec-governance] [P] `CONTRIBUTING.md` — *Adding a preview provider* (`:142-179`): a body may
      honour two optional props — `syncLine` (scroll to a source line) and `onLinkTarget` (report a hovered or
      focused link) — and a body that ignores them still conforms.

### 13.6 Verification

- [x] T216 [general] The cheap rungs, then the E2E that covers the diff — once each, under `running-tests`:
      `npm run typecheck`; `npm run lint`; every unit, component and integration file named in T182 and
      T186–T196 plus the T209 file; `npm run build` (after deleting `packages/core/tsconfig.tsbuildinfo` and
      `packages/core/dist`, the stale-dist trap); then, stating the cost first,
      `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts packages/ui/tests/e2e/preview-subworkspace.e2e.ts packages/ui/tests/e2e/navigation-history-keys.e2e.ts`
      at one worker, plus the spec T181 edited. `preview-scroll.e2e.ts` declaration 1 now runs with FR-114 at
      its shipped **on** (Open item O10): if it fails because typing scrolled the editor, report it with the
      editor's scroll trace — do not turn the setting off in the test without recording why in research O10.
- [ ] T217 [general] Hands-on per `specs/044-file-previews/quickstart.md` §8, steps 1–8, results into the PR
      description (step 7 uses T210's counts). The hosted gate **T176** follows this task.
      > **Note 2026-09-16 (iteration, step 7 only)**: the maintainer reports from hands-on use that the
      > browser now ends in front after a followed web link — FR-119 confirmed, research R27's H-b
      > confirmed. This records that result against step 7; it does not complete T217, which still runs
      > steps 1–8 and records step 7's counts (browser running / closed).

### Phase 13 — dependencies and waves

| Order | Tasks | Notes |
|---|---|---|
| 1 | T181, T182 `[P]` | T181 lowers the budget before anything adds to it |
| 2 | T183 → T184 → T185 | the reproduction precedes the fix |
| 3 | T186–T196 `[P]` → T197 | the RED wave — eleven tasks, no shared file |
| 4 | T198, T199, T200 `[P]` | settings, reducer, store |
| 5 | T201 → T202 → T203 → T204 → T205 → T206 → T207 | serial: they share `preview-panel.tsx`, `markdown-body.tsx`, `provider-view.ts` and `sanitise.ts` (T201 is main-only but T203 needs it) |
| 6 | T208 → T209 → T210 | T208 may start any time after order 2; T209–T210 wait for its verdict |
| 7 | T211–T215 `[P]` | |
| 8 | T216 → T217 → T176 | |

**Files edited by more than one Phase 13 task**

| File | Tasks |
|---|---|
| `packages/ui/src/renderer/preview/preview-panel.tsx` | T202, T203, T204, T206 |
| `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` | T202, T205, T206, T207 |
| `packages/ui/src/renderer/preview/provider-view.ts` | T202, T206 |
| `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` | T206, T207 |
| `packages/ui/tests/e2e/e2e-budget.json` | T181, T183 |
| `packages/ui/tests/e2e/preview-scroll.e2e.ts` | T183 (and T181 only if the audit picks a declaration in it) |
| `packages/ui/src/main/external-url.ts`, `packages/ui/src/main/main.ts` | T208 (temporary, reverted), T210 |
| `specs/044-file-previews/research.md` | T208 |

---

## Phase 14: Convergence

*Second converge pass, 2026-09-16, against the spec, plan, tasks and contracts as they stand after the
`speckit-iterate` amendment (FR-113–FR-120) and Phase 13. The 2026-09-15 baseline
(`session-notes/iterate-baseline-converge.md`) was read as the "before": **T177–T180 all landed
and none regressed**, verified in the code rather than assumed. Full report:
`session-notes/converge-final.md`.*

**26 findings: 1 missing, 12 partial, 10 contradicts, 3 unrequested.** Eighteen were artifact drift whose
fix was text, and those are **already applied** to `spec.md`, `plan.md`, `research.md`, `data-model.md`
and four contracts, in the commit immediately preceding this section — they are listed in the report, not
repeated as tasks. The eight below are what remains. No code was written by this pass.

**Three things this pass deliberately did NOT do**, so the next reader is not misled:

- **It did not tick T216.** `research.md` Open item O10 cites T216 in the past tense and
  `session-notes/t216-report.md` records rungs 1–8 green, but the full re-run of the named
  unit/component/integration set **after** the declaration-1 re-seat has not happened. T216 and T217 stay
  open, and that is the honest state.
- **It did not edit T183, T213 or T216 in place**, though each carries an instruction the delivery
  overtook (T183's "568 → 569" re-seed, T213's "the unchanged budget and the debt 116 → 115", T216's
  "declaration 1 now runs with FR-114 at its shipped **on**"). Converge is append-only over existing
  tasks. All three are spent — no work remains in them — and the artifacts they pointed at now record
  what actually shipped.
- **It did not touch anything outside `specs/044-file-previews/`.** T223–T225 are documentation text
  whose files sit in `docs/`, `README.md` and `CHANGELOG.md`; they are tasks rather than applied fixes
  only for that reason.

- [x] T218 [e2e-harness] **CRITICAL — the E2E budget rose, and Principle V says it MUST NOT.**
      `packages/ui/tests/e2e/e2e-budget.json` reads `total` **570** / `@editor` **118**, up from 569 / 117,
      because T181's demotion was skipped by ruling and the budget was re-seeded upward for T183's new
      declaration. The constitution's text is *"The budget is a ratchet: it may fall and MUST NOT rise"*,
      and this feature's own plan argued that *"a recorded practice does not satisfy a NON-NEGOTIABLE
      MUST"* when it replaced an earlier 569 → 574 raise with the T163a–T163e offset — so the ruling
      reversed the plan's own constitutional reasoning. **The build cannot catch it**: the guard
      (`packages/ui/tests/unit/e2e-budget.test.ts`) asserts equality in *both* directions, so a re-seeded
      budget is green, which is why this survived to converge. Resolve it one of two ways and record which:
      **(a)** perform T181 as written — audit `packages/ui/tests/e2e/*.e2e.ts` for an `@extended @editor`
      declaration carrying no `@reserve:*` tag whose assertion a lower layer already makes or can make with
      one added case, observe the replacement failing against a deliberately broken implementation, delete
      the declaration, and re-seed `e2e-budget.json` to 569 / `@editor` 117 and
      `reserve-tag-debt.json` to 115; or **(b)** the maintainer rules the raise acceptable and Principle V
      is amended to permit a per-test justified raise, which is a constitution bump, not a task decision.
      Until one lands, `plan.md`, `research.md` R29 and `docs/testing.md` all correctly describe this as an
      outstanding violation. Per Constitution V (E2E budget ratchet) (contradicts)
- [x] T219 [core-architecture] FR-115's *"Two consecutive entries for the same file and the same position
      MUST NOT be recorded"* is enforced **only inside `recordJump`**
      (`packages/core/src/navigation/history.ts:300-335`). `setCurrentViewState` (`:257-266`) has no
      neighbour merge, and three routes reach it without `recordJump`:
      `packages/ui/src/main/preview-service.ts:601-604` (link intent, then `recordOpen`),
      `preview-service.ts:662-665` (history intent, then `moveTo`), and
      `packages/ui/src/main/navigation-history-ipc.ts:118-121`, fed by the detaching-view effect at
      `packages/ui/src/renderer/preview/preview-panel.tsx:750-760`. **What the reader meets**: preview
      `guide.md`, Ctrl+click its contents link to *Install*, scroll back to the top by hand, then switch
      to another tab and back (or follow a link to another file) — now press Back. It is enabled, the
      press is accepted, and nothing on screen changes; the button then greys out. One dead press, every
      time, and the codebase already calls this failure mode a defect in `history.ts:218-220`'s H2a
      comment. **Fix after the move or record, not inside `setCurrentViewState`**, whose ordering a
      `navigate` request's `index` depends on. Failing cases first: a core unit case in
      `packages/core/tests/unit/navigation-history.test.ts` (`setCurrentViewState` then
      `recordOpen`/`moveTo` leaves no equal consecutive pair) and one in
      `packages/ui/tests/integration/preview-service-navigate.integration.test.ts`. `data-model.md` §14.2's
      H12 note records that the invariant is currently narrower than the requirement. Per FR-115 (partial)
- [ ] T220 [renderer-ui] The FR-118 status-bar readout can keep naming a link a live update has removed.
      Every draw does `body.replaceChildren(fragment)`
      (`packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx:267-271`), which destroys
      every link element, and only the **focus** half is reconciled against the new DOM (`:306-309`) —
      nothing reconciles **hover**, and the detached element's `pointerout` cannot bubble to the delegated
      handler. **What the reader sees**: parented preview with the status bar shown, rest the pointer on a
      link and read its target bottom-left, then — without moving the mouse — type in the editor so that
      line changes, and wait for the settle. The readout still names the old target until the pointer moves
      one pixel. Symmetric with the existing focus reconciliation: after `replaceChildren`, either
      re-resolve from `document.elementFromPoint` at the last pointer position or report `('hover', null)`.
      Component test first, beside `packages/ui/tests/component/preview-link-readout.test.ts`.
      Per FR-118 (partial)
- [ ] T221 [renderer-ui] An image with a `data:` source gets no tooltip, where FR-120's clause is
      unconditional. `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts:208` strips a `data:`
      `src` at the top of the `afterSanitizeAttributes` hook, **before** `onImage` runs at `:221`, so
      `imageTitle` (`:171`) reads `null` and contributes no source part. **What the reader sees**: a README
      with an embedded badge or logo, `![Company logo](data:image/png;base64,…)` — the image is blocked and
      shown as its alt text, and hovering it gives **no tooltip at all**, where every other blocked image
      (`http:`, remote with the setting off, a failed load) shows one. Decide which is intended and make
      the artifacts agree: either give it an elided form (`data:image/png;base64,…`) with a component case
      in `packages/ui/tests/component/preview-images.test.ts`, or add one sentence to FR-120 excluding
      `data:` sources and say why a base64 payload is worse in a tooltip than nothing. Per FR-120 (partial)
- [x] T222 [renderer-ui] With scroll sync on, Back onto an entry the reader left at the **very top** lands
      on the editor's line rather than the top. `scroll-anchor.ts:77` records no `viewState` for an entry
      left at `scrollTop <= 0`, and the draw's navigation branch claims the editor's line only when a place
      exists (`markdown-body.tsx:279-288`), so with no anchor the `applyPendingSync(scroller)` at `:292`
      writes the editor's line over the freshly-zeroed `scrollTop`. **Steps**: `README.md` in an editor
      beside its preview, sync on; scroll the **editor** to line 200 (the preview follows); scroll the
      **preview** back to the very top; Ctrl+click a link to a file with no editor open; press Back — the
      preview returns to `README.md` at line 200, not the top. This is the at-top variant of review
      finding 1 (fixed at `markdown-body.tsx:282-288`, covered by declaration (10) of
      `packages/ui/tests/component/preview-scroll-sync.test.ts`) and has no test. It needs a **maintainer
      ruling first**: FR-113 winning here is arguably literal ("the preview follows the editor"), and
      FR-107 losing is arguably the defect — settle which, record it in the spec, then test at the
      component layer beside declaration (10). Per FR-107 with FR-113 (partial)
      > **Note 2026-09-16 (iteration — ruling made)**: the maintainer chose **the editor's position**
      > (spec.md, Session 2026-09-16; **FR-121e**, refining FR-107 for the top-of-document case only).
      > T222 now implements "editor's position wins" rather than treating it as a defect. Reconcile with
      > review fix `dbd60bf9`: its claim (`markdown-body.tsx:282-287`) runs only when the entry HAS an
      > anchor, so it does not touch the top case, and for a **cross-file** Back the shipped fall-through to
      > `applyPendingSync` already lands on the editor's line — which is now the required behaviour, not a
      > bug; its comment "the reader's place WINS" stays true for every non-top place. What is open: the
      > top case is decided by an anchor's absence rather than an explicit rule, so it should be made
      > explicit; and the **same-file** Back/Forward route (FR-115), which does not take the draw path,
      > must be checked — there an unchanged editor line applies nothing, so the preview may stay at the
      > top, contrary to FR-121e. Not ticked.
      > **Note 2026-09-16 (iteration round 2 — planned)**: delivered by **T232** (RED, both routes) and
      > **T242** (the explicit rule, `placeOnStep`), with main's `viewState: null` from **T241**; tick this
      > task with T242 (plan.md, Iteration 2026-09-16, decision 4).
- [x] T223 [spec-governance] [P] `docs/testing.md:149-150` attributes an assertion to the wrong
      declaration: the row for `preview-scroll.e2e.ts` declaration 1 claims it covers the heading's place
      *"including across a file notice appearing and disappearing"*, but the notice step is in
      **declaration 2** (`preview-scroll.e2e.ts:261-275`); declaration 1 (`:152-203`) ends at the
      anchor-compensation assertion. The row also omits that declaration 1 now runs on its **own app with
      `editor.previews.syncScroll` seeded off** (`:141-151`, `:155-157`), which is the whole point of
      research Open item O10 — with sync on it measures FR-113, not FR-024. Split the row in two and say
      so. Per T171 / T213 (docs currency) (contradicts)
- [x] T224 [spec-governance] [P] Three docs over-narrow FR-113 to headings, where the implementation moves
      whatever **block** is at the top of the editor's viewport — `markdown-body.tsx:201-203` restores the
      greatest `data-source-line ≤ N`, which is any paragraph, list or table: `README.md:93-94` ("to the
      same heading"), `docs/quick-start.md:309-310` ("the heading at the top of the editor's view"),
      `CHANGELOG.md:39-40` ("to the same heading"). A reader who scrolls to a long paragraph and sees the
      preview follow is not being told the truth by any of the three. Per FR-113 / T211, T212, T214
      (partial)
- [x] T225 [spec-governance] [P] No document records that a web link followed from a **terminal** or the
      **About window** now leaves the browser in front, only the preview case. `docs/quick-start.md:319-321`
      covers previews; `CHANGELOG.md:64-66` has an entry only for #199's terminal-*command* case; but
      `packages/ui/src/main/external-url.ts:77-79` applies the handoff to `throng:openExternal` too, so a
      Ctrl+clicked terminal link and an About link changed behaviour with no user-facing note. Extend the
      CHANGELOG *Fixed* entry. Per FR-119 / T214 (missing)

### Phase 14 — order

| Order | Tasks | Notes |
|---|---|---|
| 1 | T218 | CRITICAL and it gates a clean gate run; route (b) is a constitution bump, so ask before assuming (a) |
| 2 | T222 | needs a maintainer ruling before any code — FR-113 vs FR-107 at the top of a document |
| 3 | T219, T220, T221 | independent of each other; T220 and T221 share `markdown-body.tsx` / `sanitise.ts` so do not run them in one wave |
| 4 | T223, T224, T225 `[P]` | documentation only, no shared file |
| 5 | T216 → T217 → T176 | unchanged from Phase 13: the verification rungs, the hands-on, then the hosted gate — which must run **after** T218 settles, or it certifies a tree that violates Principle V |

---

## Phase 15: Iteration 2026-09-16

*Appended by `speckit-iterate` (round 2) for spec Clarifications **Session 2026-09-16** — FR-121 (a–h),
FR-122 (a–f) — and Phase 14's **T222**, now ruled by FR-121e. Design: plan.md → *Iteration 2026-09-16*
(decisions 1–7); research R30–R33; data-model §15; contracts `settings-bindings-tokens.md` (*Iteration
2026-09-16*), `menus-and-controls.md` §§1–4, 7, 8, 10, `preview-ipc.md` §1–§2 (`viewState: null`);
quickstart §9.*

**Starts after** Phase 14's open renderer tasks that edit the same files — **T220** (`markdown-body.tsx`)
and **T221** (`sanitise.ts`) — or is sequenced around them: no Phase 15 task starts on `markdown-body.tsx`
while T220 holds it. **T222 is delivered by T232 (its RED) and T242 (its fix)** and is ticked with T242.
T217 and T176 stay open and run after T253.

Layer rules, Red checkpoints and the one-test-command-at-a-time rule are this file's own (top of file).
Every E2E step states its expected cost in one line first. **The E2E budget MUST NOT rise** (Principle V):
T237's declaration exists only if T226 has paid for it.

### 15.1 Budget first

- [x] T226 [e2e-harness] [US1] **Demote one E2E declaration to pay for T237.** Audit
      `packages/ui/tests/e2e/*.e2e.ts` for an `@extended @editor` declaration carrying **no** `@reserve:*`
      tag (one of the 115 counted in `packages/ui/tests/e2e/reserve-tag-debt.json`) whose assertion a unit,
      component or integration test already makes, or can make with one added case — the T163a–T163e and
      T218 method. Name it by title in the commit. Write or identify the lower-layer test, observe it **fail
      against a deliberately broken implementation**, revert the break, delete the declaration, and re-seed
      `packages/ui/tests/e2e/e2e-budget.json` (569 → 568, `@editor` 117 → 116, a sentence in `measuredFrom`
      naming the declaration and where its assertion now lives) and
      `packages/ui/tests/e2e/reserve-tag-debt.json` (115 → 114). If the spec file is in
      `packages/ui/tests/e2e/parallel-plan.json` and loses its last declaration, remove its entry. **If no such
      declaration exists, stop and report: T237 and T246 are then not performed, the budget files are not
      touched, and the real-engine claim falls to quickstart §9 steps 1–3 — the budget is never raised.**

### 15.2 Failing tests for FR-121, FR-122 and T222 (one wave)

- [x] T227 [config-preferences] [P] [US1] `unit` RED — settings text, binding and token (FR-122d, FR-122f,
      FR-122c): (1) `packages/core/tests/unit/preview-settings.test.ts` — the `editor.previews.syncScroll`
      descriptor's description contains *both directions*, *Synchronise Scrolling* and *status bar* (substring
      assertions; label and absence of `enabledWhen` unchanged); (2) `packages/core/tests/unit/keybindings-preview.test.ts`
      — `preview.toggleSyncScroll` exists, ships `[]`, `COMMAND_SCOPES` is exactly `{editor, preview}`, and is
      not live in `terminal` or `explorer`; (3) `packages/core/tests/unit/keybindings-metadata.test.ts` — one
      descriptor, label *Synchronise Scrolling*, group *Editor*; (4) `packages/core/tests/unit/default-themes.test.ts`
      — `EXPECTED_ICON_TOKEN_COUNT` 69 → 70 and every shipped theme has `icons.syncScroll`;
      (5) `packages/core/tests/unit/theme-metadata.test.ts` — `syncScroll` has a label and description;
      (6) `packages/core/tests/unit/shipped-defaults-upgrade.test.ts` — `SHIPPED_DEFAULTS_VERSION` is 9, a
      version-8 theme file without `icons.syncScroll` gains it on upgrade, one with a user value keeps it.
      Expected RED: missing description words, missing action, count 69, version 8.
- [x] T228 [core-architecture] [P] [US1] `unit` pin (plan decision 3, FR-122e with 032 FR-001a) —
      `packages/core/tests/unit/revert-plan.test.ts`: a snapshot with `editor.previews.syncScroll: true` and a
      current document with `false` (plus a changed `newProject.lastProjectFolder`) plans a settings change
      restoring `syncScroll` to `true` and leaves `lastProjectFolder` alone. **Expected: passes on its first
      run** — it pins a decision the metadata-driven plan already implements; observe it **fail** against a
      deliberate break (the key filtered out of `planRevertAll` in
      `packages/core/src/config/revert-plan.ts`), revert the break, and record both results in the commit.
- [x] T229 [editor-documents] [P] [US1] `unit` RED — the editor side (FR-121, FR-121a, FR-121b, FR-121c,
      FR-121f, FR-121g; data-model §15.1): (1) `packages/ui/tests/unit/editor-scroll-store.test.ts` — the value
      is `{ line, fromSync }`; the same value twice emits once; a changed `fromSync` alone emits;
      `requestEditorTopLine` returns `false` with no registered scroller and calls nothing;
      `registerEditorScroller` then request → the scroller is called with the line; unregister and forget both
      drop it. (2) new `packages/ui/tests/unit/editor-scroll-relay.test.ts` for
      `packages/ui/src/renderer/editor/editor-scroll-relay.ts` over a fake view and a fake `raf`: R-E1 — two
      `scroll` events in one frame publish once, and an `onUpdate({ docChanged: true })` or
      `{ geometryChanged: true }` with no scroll event publishes the new top line (typing or a reflow above the
      viewport); an update with neither publishes nothing new; R-E2 — a request dispatches a spec whose only
      key is `effects` (a scroll-into-view at the line's start, `y: 'start'`), with no `selection` and no
      `changes`, and never calls `view.focus`; a line past the end clamps to the last line; a request for the
      line already at the top dispatches nothing; R-E3 — the publish caused by the request carries
      `fromSync: true`, the next user `scroll` after it carries `false`, and a request that produces **no**
      scroll event lapses after one frame so the following user scroll carries `false`; R-E4 — a request before
      `ready()` is held, the latest wins, and `ready()` applies it; `dispose()` removes listeners, forgets and
      unregisters. Expected RED: module not found; store value is a number.
- [x] T230 [renderer-ui] [P] [US1] `unit` RED — the pure decisions (FR-121e, FR-121g, FR-121h; data-model
      §15.3): (1) new `packages/ui/tests/unit/scroll-sync-policy.test.ts` for
      `packages/ui/src/renderer/preview/scroll-sync-policy.ts` — P1 `placeOnStep` (`null` and
      `{ line: 0, offsetRatio: 0 }` with `crossFile`, sync and a known editor line → `editorLine`; the same with
      sync off, with no editor line, or **same-file** → `top` (the reading proposed under FR-121e, analysis
      C1); `{ line: 40, offsetRatio: 0.25 }` → `restore` whatever the sync; **`undefined` never yields
      `editorLine`** and `isTopOfDocument(undefined)` is `false` (analysis C2));
      P2 `pairStart` (first update parented → `editor`; null → parent, same `navigationSeq`, drawn → `preview`;
      parent change with `navigationSeq` moved → `preview`; parent null → `none`; null → parent before the
      first draw → `editor`); P4 `shouldFollow`/`shouldDrive` (equal blocks → false; either null → false;
      different → true). (2) `packages/ui/tests/unit/scroll-anchor.test.ts` — `topBlockLine` over supplied
      rects (the block containing the viewport top, including one taller than the viewport); `blockLineFor`
      (greatest `data-source-line` ≤ line; before the first block → `null`); `isTopOfDocument`. Expected RED:
      module and exports not found.
- [x] T231 [renderer-ui] [P] [US1] `component` RED — the preview side, two-way (FR-121, FR-121a, FR-121c,
      FR-121f, FR-121g), in `packages/ui/tests/component/preview-scroll-sync.test.ts`, with a fake editor
      scroller registered for `ed-1` through `registerEditorScroller`. **Rewrite, do not delete**, cases (7),
      (8), (9) and (10), each keeping its old title in a comment naming FR-121 as the supersession:
      (7) a hand scroll of the host (dispatched `scroll`, one frame) requests `ed-1` at the top block's line
      once, and sends no `preview.navigate`; (8) a same-file step onto `{ line: 40, offsetRatio: 0 }` restores
      it and then requests `ed-1` at 40; (9) a heading jump requests `ed-1` at the heading's line (62), with one
      heading intent as before; (10) Back from a file with no editor onto a place restores it and then requests
      `ed-1` at 40. New cases: setting off / standalone / binary / **no scroller registered for the parent**
      (the editor view is in another window) → nothing requested; a link to `docs/setup.md` answered with
      `parent: null` then a hand scroll → `ed-1` not requested (FR-121a); the same link answered with
      `parent: { panelId: 'ed-2' }` → `ed-2` requested at the start position (line 0) and `ed-1` never;
      **echo**: a publish `{ line: 40, fromSync: true }` for `ed-1` does not scroll the host; the host scroll the
      body made to apply a `fromSync: false` line requests nothing; **granularity**: with a code block spanning
      lines 20–30 at the top, publishing 25 does not move the host, and a hand scroll within that block while
      `ed-1` reads 25 requests nothing (the edge case in spec *Edge Cases*); **end of document**: a request for
      line 200 answered by a `fromSync: true` publish of 150 leaves the host where it is; **live update**: an
      update that keeps the top block requests nothing, one whose remap changes the top block's line requests
      the new line once. Keep cases (1)–(6) green unchanged. Expected RED: nothing is requested — no relay.
- [x] T232 [renderer-ui] [P] [US1] `component` RED — T222 and where a pair starts (FR-121e, FR-121h), new
      `packages/ui/tests/component/preview-scroll-pairing.test.ts`, mounted as `preview-scroll-sync.test.ts`
      mounts: **FR-121e / T222** — (a) parented, synced, `ed-1` at 13, the run passed through a file with no
      editor, then Back arrives as a navigation with `viewState: null` → the host shows line 13's block and
      `ed-1` is not requested; (b) same-file step with `content: null` and `viewState: { line: 0, offsetRatio: 0 }`
      while `ed-1` reads 20 → **the top**, and `ed-1` requested at the top block's line — the reading proposed
      under FR-121e (analysis C1: applying the editor's line here makes Back after a contents jump a no-op);
      **if the maintainer confirms FR-121e's same-file clause as written, flip (b)** to "line 20's block,
      nothing requested"; (b2) a followed **link** (no `viewState` key, `navigationSeq` moved) to a file with
      `parent: ed-2` while `ed-2` reads 30 → the start of the file, and `ed-2` requested at 0 — never line 30
      (analysis C2); (c) (a) with the setting off
      → the top; (d) (a) standalone → the top; (e) (a) with no scroller and no line for `ed-1` in this window →
      the top, nothing requested; (f) (a) with `viewState: { line: 40, offsetRatio: 0 }` → restored and `ed-1`
      requested at 40. **FR-121h** — (g) first attach answered with a saved place while `ed-1` already reads 13
      → the host shows line 13's block, not the saved place, and nothing is requested; (h) a place tagged
      `attach` arriving after the first draw (the re-attach effect) while opening → ignored for the editor's
      line; (i) a drawn standalone preview scrolled to line 40 receives `parent: { panelId: 'ed-9' }` with the
      **same** `navigationSeq` → `ed-9` requested at 40, the host does not move, and `ed-9`'s first publishes
      (0, then 40 `fromSync`) do not move it; (j) setting turned on while `ed-1` reads 13 and the host shows
      40 → the host follows to 13 and nothing is requested. Expected RED: (a) and (b) land at the top or keep
      the place; (g) restores the saved place; (i) follows `ed-9` to 0.
- [x] T233 [editor-documents] [P] [US1] `integration` RED — the wire half of FR-121e,
      `packages/ui/tests/integration/preview-service-navigate.integration.test.ts`: a cross-file history step
      onto an entry with no saved place answers, and pushes to every viewer, an update whose `viewState` is
      **present and `null`** (`'viewState' in update`); a same-file step onto such an entry likewise; a step
      onto an entry with a place is unchanged; a `link` navigation's update has **no** `viewState` key; a stale
      history intent's unchanged snapshot has none; attach with no place has none. And
      `packages/ui/tests/unit/preview-store.test.ts` (create it beside the store if absent): an update with
      `viewState: null` is stored as `null` with `viewStateSource: 'update'`, the same `null` on the same revision
      is de-duplicated, and a place applied through the attach call path is tagged `'attach'`. Expected RED: the
      key is absent; no source tag.
- [x] T234 [renderer-ui] [P] [US1] `unit` + `component` RED — the four menu items (FR-122a, FR-122b):
      (1) `packages/ui/tests/unit/menu-sections.test.ts` — `TABLE` rows and exact `shapeOf` pins: editor header
      View & state = … `Zoom`, `Synchronise Scrolling`, then the banner items when `panelFailure`; preview
      header View & state = `Refresh`, `Zoom`, `Synchronise Scrolling`, banner items; editor content menu View &
      state ends `Word Wrap`, `Synchronise Scrolling`; preview body menu gains a View & state section after
      Navigate; `panelActions` (`:247-272`) gains `toggleSyncScroll`. (2) `packages/ui/tests/unit/menu-icon-tokens.test.ts`
      — the item's icon is `syncScroll`. (3) `packages/ui/tests/component/editor-content-menu.test.ts` and a new
      header block in `packages/ui/tests/component/panel-header-zoom-menu.test.ts` (or a sibling
      `panel-header-sync-menu.test.ts`) — label `Synchronise Scrolling ✓` when on and bare when off, test id
      `menu-item-Synchronise Scrolling`, chord shown when `preview.toggleSyncScroll` is bound and absent when
      not, **absent** where the preview affordance is `absent`, **present and enabled** when the affordance is
      `disabled` for either reason, and choosing it calls the toggle once. (4) `packages/ui/tests/component/preview-link-menu.test.ts`
      — the preview body menu carries the item with or without a link or a selection under the pointer, and
      not for a binary provider. (5) `packages/ui/tests/component/status-strip-no-menu-items.test.ts` — still
      green: the new item is an action, not a readout (read the file's rule; extend its expected list only if
      it enumerates every item). Expected RED: no item, no action key.
- [x] T235 [renderer-ui] [P] [US1] `component` RED — the two status-bar buttons (FR-122a, FR-122c, FR-122e):
      (1) `packages/ui/tests/component/status-strip-preview-button.test.ts` — `editor-sync-scroll-<id>` is an
      `IconButton` with token `syncScroll`, is the element **immediately before** `editor-preview-<id>` in the
      controls group, `aria-pressed` follows the setting, `title` is `Synchronise Scrolling` and gains
      ` (<chord>)` when bound, is **absent** when the preview button is absent, **enabled** when the preview
      button is disabled for a switched-off provider or pressed for an open preview; clicking it calls
      `writeConfigPatch` once with exactly `[{ path: ['editor','previews','syncScroll'], value: false }]`; with
      the patch resolving `{ ok: false }` the button stays pressed and nothing else changes. (2)
      `packages/ui/tests/component/preview-status-bar.test.ts` — `preview-sync-scroll-<id>` immediately before
      `preview-editor-<id>`, standalone and parented alike, same pressed/title/click rules; the readout does not
      displace it. (3) `packages/ui/tests/component/status-strip-fit-wiring.test.ts` — the button is inside the
      measured controls group (never hidden by width, 040 FR-024). Expected RED: no button.
- [x] T236 [config-preferences] [P] [US1] `component` RED — the command and failure reporting (FR-122d,
      FR-122e): (1) new `packages/ui/tests/component/preview-toggle-sync-command.test.ts`, mounting
      `packages/ui/src/renderer/preview/preview-commands.tsx` as `packages/ui/tests/component/window-arrow-chords.test.ts`
      mounts a window handler, with `preview.toggleSyncScroll` bound to a test chord: the chord with an active
      editor whose file has a text provider patches the key once and prevents default; with an active text
      preview, the same; with an active editor on a file with no provider, or a terminal, nothing is written and
      the event is not prevented; with the chord unbound nothing happens. (2) new
      `packages/ui/tests/component/subworkspace-config-write-notice.test.ts`: the sub-workspace window's root
      (`packages/ui/src/renderer/subworkspace-app.tsx`, rendered under its composition root with stub services)
      shows exactly one `prefs-notice` when a `writeConfigPatch` in that realm fails, and two failures in a row
      still leave one notice. Expected RED: the chord does nothing; no notice in a sub-workspace window.
- [x] T237 [e2e-harness] [US1] `e2e` RED — **only after T226 has paid for it**; expected cost ~40 s on its own
      app. One new declaration in `packages/ui/tests/e2e/preview-scroll.e2e.ts`, on one line, tags
      `['@extended', '@editor', '@reserve:layout']`, reusing the file's helpers and a fixture under
      `packages/ui/tests/fixtures/preview/` with headings far apart and one tall code block: open the file in an
      editor, open its preview (sync at its shipped **on**); (1) `page.mouse.wheel` over the preview until a
      named heading is at its top → the editor's first visible line (read from `.cm-scroller` with
      `posAtCoords`, or the gutter's first visible line number) is that heading's source line, and the caret's
      Ln/Col readout is unchanged; (2) Go to Line (Ctrl+G) to a line far below → the preview's top block is
      that line's block; (3) after each of (1) and (2), both scrollers' `scrollTop` read identically across five
      consecutive animation frames — no oscillation. A comment justifies the reserve: jsdom lays nothing out and
      fires no `scroll` event for a `scrollTop` write, so the echo marks' agreement with Chromium's and
      CodeMirror's real event order is visible nowhere cheaper (plan, *Test layers*). Re-seed
      `packages/ui/tests/e2e/e2e-budget.json` (568 → 569, `@editor` 116 → 117) — the totals read what they read
      before T226. The spec is already `serial` (`FOCUS`) in `packages/ui/tests/e2e/parallel-plan.json`.
      Expected RED: step (1) — the editor does not move.
- [x] T238 [general] Red checkpoint for T227–T237: load `running-tests` (and `throng-testing` for T237); run
      exactly the files those tasks name, once per project (`unit`, `component`, `integration`), capture the
      full output, and confirm each new or rewritten case fails for its stated reason — not an import typo —
      and that T228 passes and then fails against its break. For T237, `npm run build` first (after deleting
      `packages/core/tsconfig.tsbuildinfo` and `packages/core/dist`), state the cost, and run
      `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts -g "<T237's title>"` at one worker:
      it must fail at step (1) because the editor did not move, not for a locator. One test command at a time.

### 15.3 Implementation

- [x] T239 [config-preferences] [P] [US1] Settings text, binding, token, defaults (FR-122c, FR-122d, FR-122f;
      contracts `settings-bindings-tokens.md` *Iteration 2026-09-16*): `packages/core/src/config/preview-settings.ts`
      (the description, plan decision 1); `packages/core/src/config/keybindings.ts` (`ActionId`,
      `COMMAND_SCOPES` → `HISTORY_PANELS`, `WINDOWS_BINDINGS` `[]`); `packages/core/src/config/keybindings-metadata.ts`
      (descriptor in the Editor group beside *Toggle word wrap*); `packages/core/src/config/theme.ts`
      (`THRONG_THEME.icons.syncScroll`) and the icon type it satisfies; `packages/core/src/config/theme-copy.ts`
      (label and description); `packages/core/src/config/shipped-defaults.ts` (`SHIPPED_DEFAULTS_VERSION` 9, with
      a comment paragraph in the file's voice citing 043's 6 → 7 precedent). Re-run T227's and T228's files:
      green.
- [x] T240 [editor-documents] [P] [US1] The editor relay (FR-121, FR-121a–c, FR-121f, FR-121g; data-model
      §15.1): extend `packages/ui/src/renderer/editor/editor-scroll-store.ts` (the `{ line, fromSync }` value,
      `registerEditorScroller`, `requestEditorTopLine`, forget also unregisters); new
      `packages/ui/src/renderer/editor/editor-scroll-relay.ts` (R-E1–R-E4); in
      `packages/ui/src/renderer/editor/use-editor.ts`, replace the inline top-line publisher (`:1266-1290`) with
      `attachEditorScrollRelay`, feed it from an `EditorView.updateListener` (`docChanged || geometryChanged`),
      call `ready()` once the view's initial placement (#144 view state and US8 document scroll) has run, and
      `dispose()` beside the view's unregistration. Do not change `lastScrollAnchor` handling. Re-run T229's
      files, `packages/ui/tests/unit/editor-scroll-store.test.ts` and
      `packages/ui/tests/component/editor-update-listener.test.ts`: green.
- [x] T241 [editor-documents] [P] [US1] Main sends `null` (FR-121e; `contracts/preview-ipc.md` §1–§2):
      `packages/ui/src/main/preview-service.ts` `navigateHistory` — both the same-file and the cross-file branch
      pass the target entry's place `?? null` to `emit`, and `updateOf` keeps a `null` (it already sets the key
      whenever the argument is not `undefined`); nothing else changes. `packages/ui/src/renderer/preview/preview-store.ts`
      — `viewStateSource` set to `'update'` on every apply that carries a place, and an attach apply path that
      sets `'attach'` (called from `packages/ui/src/renderer/preview/preview-panel.tsx`'s `attach`). Re-run T233's
      files and `packages/ui/tests/integration/preview-service-navigate.integration.test.ts` in full: green.
- [x] T242 [renderer-ui] [US1] The preview side (FR-121, FR-121a, FR-121c, FR-121e–h; closes **T222**) — **after
      T240 and T241, and not while T220 holds `markdown-body.tsx`.** `packages/ui/src/renderer/preview/providers/markdown/scroll-anchor.ts`
      (`topBlockLine`, `blockLineFor`, `isTopOfDocument`); new `packages/ui/src/renderer/preview/scroll-sync-policy.ts`
      (P1–P5); `packages/ui/src/renderer/preview/provider-view.ts` (optional `onTopLineChange`, `placePolicy`, doc
      comments); `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (one rAF-coalesced
      `scroll` listener reporting through `onTopLineChange` unless the scroll was the body's own sync placement or
      the same-block check fails; `applyPendingSync` skips a line in the current top block; the navigation branch
      and the place-alone effect consult `placeOnStep` **only when the update carries a history place (the
      `viewState` key is present)** — a followed link keeps its start position and drives the editor — passing
      `crossFile` (navigation branch) or not (place-alone effect), and apply the opening rule; the "reader's place WINS" comment at
      `:282-287` updated to FR-121e/FR-121f); `packages/ui/src/renderer/preview/preview-panel.tsx` (read
      `useEditorTopLine` as `{ line, fromSync }`, drop `fromSync` values before `syncLine`, relay
      `onTopLineChange` through `requestEditorTopLine(state.parent.panelId, line)` while syncing, compute
      `pairStart` from the previous and current `parent`/`navigationSeq`, perform adoption by requesting the new
      editor at the body's top block, and pass `placePolicy`). Re-run T230's, T231's and T232's files,
      `packages/ui/tests/component/markdown-body.test.ts`, `packages/ui/tests/component/preview-follow.test.ts` and
      `packages/ui/tests/component/navigate-history.test.ts`: green. Then tick **T222** in the same commit.
- [x] T243 [renderer-ui] [US1] The four menu items (FR-122a, FR-122b; `menus-and-controls.md` §10) — **after
      T239 and T242.** New `packages/ui/src/renderer/preview/sync-scroll-toggle.ts` (`toggleSyncScroll()`, the one
      command body: read the window's current value, one-key `writeConfigPatch`);
      `packages/ui/src/renderer/workspace/panel-header-menu.ts` (`PanelHeaderMenuArgs.syncScroll`,
      `PanelHeaderMenuActions.toggleSyncScroll`, the item pushed after the Zoom block and before `failureItems`
      for an editor and a preview, update the header table comment); its call site in
      `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (presence from the editor's preview affordance or
      the preview's provider kind; on/off from the settings); `packages/ui/src/renderer/editor/content-menu.ts`
      (`ContentMenuArgs.syncScroll`, the item after Word Wrap) and its call site in
      `packages/ui/src/renderer/editor/use-editor.ts` (read at menu-open time, like Go To Line);
      `packages/ui/src/renderer/preview/content-menu.ts` (the View & state section) and its call site in
      `packages/ui/src/renderer/preview/preview-panel.tsx`. Re-run T234's files: green.
- [x] T244 [renderer-ui] [US1] The two status-bar buttons (FR-122c) — **after T243** (shares
      `preview-panel.tsx`). `packages/ui/src/renderer/editor/status-strip.tsx` (a `SyncScrollButton` rendered
      immediately before `PreviewButton` inside the measured controls group, present when the affordance is not
      `absent`, never disabled); `packages/ui/src/renderer/preview/preview-status-bar.tsx` (the same control
      before the editor button, props `syncScroll` and `onToggleSyncScroll`); `packages/ui/src/renderer/preview/preview-panel.tsx`
      (passes them); both call `toggleSyncScroll()`; no colour literal (`preview-css-tokens.test.ts`,
      `status-strip-declared-css.test.ts`). Re-run T235's files: green.
- [x] T245 [config-preferences] [US1] The command and sub-workspace failure reporting (FR-122d, FR-122e) —
      **after T243.** `packages/ui/src/renderer/preview/preview-commands.tsx` (resolve
      `preview.toggleSyncScroll` beside `preview.open`: act and `preventDefault` only when the active panel is an
      editor whose affordance is not `absent` or a text preview; update the header list to six items);
      `packages/ui/src/renderer/subworkspace-app.tsx` (call `useConfigWriteFailureNotices()`);
      `packages/ui/src/renderer/config/config-write-notices.ts` (doc comment: three kinds of window write, and why
      the report stays in the writing window). Re-run T236's files: green.
- [x] T246 [e2e-harness] [US1] Make T237 green — **only if T226 paid for it.** Expected cost ~40 s plus a build.
      Delete `packages/core/tsconfig.tsbuildinfo` and `packages/core/dist`, `npm run build`, then
      `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts -g "<T237's title>"` at one worker. A
      failure is fixed at the lowest layer that reproduces it (a new case beside T229 or T231 first), never by
      loosening the frame-stability assertion; a pass on retry is a flake, handled under `throng-testing`, not a
      green.

### 15.4 Documentation currency (same change as the behaviour)

- [x] T247 [spec-governance] [P] `README.md` — Highlights (file previews): scroll sync is two-way and can be
      switched from the editor's and the preview's menus and status bars; Configuration: the
      `editor.previews.syncScroll` row says both directions; key bindings: `preview.toggleSyncScroll`, unbound.
      Current state only; whatever block moves, not "the same heading" (T224's correction stands).
- [x] T248 [spec-governance] [P] `docs/quick-start.md` — *Preview a file*: two-way sync, what moves which side,
      the top-of-document Back rule in one sentence, and the toggle's four menu items and status-bar button;
      §7 *Previews*: the setting's new meaning; *Keyboard reference*: *Synchronise Scrolling*, unbound.
- [x] T249 [spec-governance] [P] `CHANGELOG.md` — `## Unreleased`, the file previews entry: two-way scroll
      sync and the toggle surfaces, in the file's existing voice.
- [x] T250 [spec-governance] [P] `docs/testing.md` — the 044 table: T237's declaration and its reserve, T226's
      demotion and where its assertion now lives, the unchanged budget 569 and the debt 115 → 114; that
      `preview-scroll-sync.test.ts` (7)–(10) were rewritten to FR-121; that the rest of FR-121/FR-122 is held at
      unit and component (or, if T226 stopped, that no declaration was added and why).
- [x] T251 [spec-governance] [P] `CONTRIBUTING.md` — *Adding a preview provider*: a body may also honour
      `onTopLineChange` (report the top block's source line for two-way sync) and `placePolicy`; a body that
      ignores them still conforms, and its preview simply does not drive the editor.

### 15.5 Verification

- [x] T252 [general] The cheap rungs, then the E2E covering the diff — once each, under `running-tests`:
      `npm run typecheck`; `npm run lint`; every unit, component and integration file named in T227–T236;
      `npm run build` after deleting `packages/core/tsconfig.tsbuildinfo` and `packages/core/dist`; then, stating
      the cost first, `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts packages/ui/tests/e2e/preview-subworkspace.e2e.ts packages/ui/tests/e2e/navigation-history-keys.e2e.ts`
      at one worker, plus the spec T226 edited. `preview-scroll.e2e.ts` declaration 2 (a standalone preview) and
      `preview-subworkspace.e2e.ts` (a parented preview in a second window, where FR-121a says no editor is
      driven) must pass unchanged; if either fails because sync moved something, report it with both scroll
      traces rather than seeding the setting off.
      > **Ticked at converge 2026-09-16 (round 2)** against `session-notes/t252-report.md` (HEAD
      > `b6e43b91`): typecheck exit 0; lint red only on two untracked, gitignored scratch scripts under
      > `session-notes/`, tracked source clean; the 17 unit, 17 component and 2 integration files covering
      > T227–T236 (plus the re-run files T240/T242 name) green; a clean build carrying `syncScroll`; and
      > `preview-scroll`, `preview-subworkspace`, `navigation-history-keys` and `quick-open` (the spec T226
      > edited), plus `editor-status-bar`, `status-bar-visibility`, `editor-menus` and
      > `editor-content-menu`, 19/19 first attempt at one worker — declaration 2 and the sub-workspace spec
      > unchanged. Two review fixes landed after it (`fe0fff59`, `b3bfb70b`); their own record
      > (`review2-fix-report.md`) re-ran typecheck, full `npm run lint` (exit 0), the `preview-*`,
      > `markdown-body*` and `editor-scroll-*` unit and component files, the E2E guards, a build, and
      > `preview-scroll` + `preview-subworkspace` at one worker (5/5). `navigation-history-keys` and
      > `quick-open` were not re-run after those two commits; the hosted gate **T176** is the evidence for
      > the final SHA.
- [ ] T253 [general] Hands-on per `specs/044-file-previews/quickstart.md` §9, steps 1–10, results into the PR
      description. Then **T217** (quickstart §8) and the hosted gate **T176**.

### Phase 15 — dependencies and waves

| Order | Tasks | Notes |
|---|---|---|
| 1 | T226 | lowers the budget before anything adds to it; its stop clause decides whether T237/T246 exist |
| 2 | T227, T228, T229, T230, T231, T232, T233, T234, T235, T236 `[P]` → T237 → T238 | the RED wave — the `[P]` run shares no file; T237 waits for T226 |
| 3 | T239, T240, T241 `[P]` | core config; editor relay; main + store |
| 4 | T242 → T243 → T244 → T245 | serial: T242–T244 share `preview-panel.tsx`; T245 follows T243's command body |
| 5 | T246 | only if T226 paid |
| 6 | T247–T251 `[P]` | |
| 7 | T252 → T253 → T217 → T176 | |

**Files edited by more than one Phase 15 task**

| File | Tasks |
|---|---|
| `packages/ui/src/renderer/preview/preview-panel.tsx` | T241, T242, T243, T244 |
| `packages/ui/src/renderer/editor/use-editor.ts` | T240, T243 |
| `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` | T242 (and Phase 14's T220 — never concurrently) |
| `packages/ui/tests/component/preview-scroll-sync.test.ts` | T231 |
| `packages/ui/tests/e2e/e2e-budget.json` | T226, T237 |
| `packages/ui/tests/e2e/preview-scroll.e2e.ts` | T237 (and T226 only if the audit picks a declaration in it) |

## Phase 16: Iteration 2026-09-17

Third hands-on round (spec Session 2026-09-17). One defect against FR-121g and one amendment (FR-123).

- [x] T254 [renderer] [US8] Reproduce and fix the editor jumping up while typing at the end of a long
      document with front matter (defect against FR-121g; no spec change). RED first:
      `packages/ui/tests/fixtures/preview/sync-two-way.md` gains a front matter block with nested values,
      and `packages/ui/tests/e2e/preview-scroll.e2e.ts` T237 gains a step writing three lines at the end —
      red before the fix (`after writing line 2 at the end, the editor's top line went up from 466 …
      Received: 462`; the existing 1c and end-of-document steps went red too), confirmed by the maintainer.
      Cause, measured with an instrumented probe on the maintainer's file: the front matter table was
      dressed (`preview-markdown__front-matter`) after the update restored the place, so the document
      shrank ~54px under the reader; at the preview's end the engine clamped `scrollTop`, and
      `reportTopLine` read the clamp as the reader's scroll. Fix in
      `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`: the fragment is dressed
      (front matter class, blocked images' alt text) before insertion, and a clamp to the end below the
      body's own place is not reported (the claim stands across frames). Component case in
      `packages/ui/tests/component/preview-scroll-sync.test.ts` ("a later shrink that clamps the position
      requests nothing"), red before the guard.
- [x] T255 [failure-notices] [US6] FR-123 — raise link and history notices as application notifications.
      `packages/ui/src/renderer/preview/preview-panel.tsx` raises a warning through `useNotify` (heading
      `Couldn't follow the link in <panel>` / `Couldn't go back or forward in <panel>`, message
      `linkNoticeMessage`), test id `preview-link-notice-<panelId>`; the same condition re-raised pulses the
      card (the notification system's duplicate rule), a different one clears the last first, and every
      former clear calls `clear(testId)`. `preview-link-notice.tsx` loses its inline component and gains
      `previewLinkNoticeTestId` and `linkNoticeAction`. File conditions (FR-026, FR-027) are unchanged
      (FR-123c). Tests: `preview-follow`, `preview-images`, `navigate-history`, `preview-copy` component
      files updated — kind read from the message, the flash from `data-pulsing`, placement outside the
      panel, and FR-123b's replacement.
- [x] T256 [spec-governance] Record Session 2026-09-17 and FR-123 in `spec.md`, the §9 row in
      `contracts/menus-and-controls.md`, and this phase.
- [ ] T257 [general] Hosted gate for the final SHA (as T176), and the hands-on checks of T254 and T255 in
      the PR description.
