# Implementation Plan: File Previews and Panel Navigation History

**Branch**: `feature/S044-I10-I136-file-previews` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/044-file-previews/spec.md` (106 FRs, 7 user stories, two
Clarifications sessions). Closes #10 and #136.

## Summary

Two capabilities that share one model.

**A preview panel on a provider seam.** A new panel kind, `preview`, shows one file rendered
read-only. What it looks like is decided by a **provider** registered once — a pure descriptor in
`packages/core` (extensions, text or binary, its own settings) and a view in the renderer. Markdown is
the first provider; the seam is drawn so #388's PDF provider, which is binary, has no editor and is
always standalone, lands with **zero** edits to the panel, the menus, the status bar, the preferences
editor or persistence (FR-070, SC-003).

A preview is **bound to a file, never to a panel** (FR-013). A new UI-main `PreviewService` is the one
authority for every open preview: it derives *parented* from the editor's document registry on every
registration event, follows the document's content (debounced with a maximum wait) while parented and
the disk while standalone, and reads through `EditorService` — which, unlike the coordinator, registers
nothing (Finding 5, FR-025).

**Per-panel back/forward history** for editor and preview panels (#136). A pure core reducer, a
UI-main `NavigationHistoryService` keyed by panel id (so a panel shown in two windows has one
history), recorded **inside `EditorCoordinator.load`** — which makes every FR-106 outcome fall out of
whether a load happened at all — persisted in `Panel.config` and purged with the panel.

The Markdown pipeline is **markdown-it → DOMPurify (allowlist) → DOM fragment**, with front matter
parsed by `yaml`, fenced code highlighted by the **editor's own** grammars and highlight style, links
carried with **no `href`** at all, relative images served by a confined `throng-preview:` protocol,
and a main-process request filter plus a tightened CSP behind the sanitiser. See
[research.md](./research.md) R1–R8.

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node 22, Electron 43

**Primary Dependencies**: React 18.3, CodeMirror 6 / `@lezer/highlight` 1.2 (reused), InversifyJS,
Vitest + Playwright. **New runtime dependencies of `@throng/ui`**: `markdown-it@^15.0.2` (MIT),
`dompurify@^3.4.15` (Apache-2.0 option), `yaml@^2.9.1` (ISC), and `@lezer/highlight` / `style-mod`
declared directly (currently transitive). `packages/core` gains **no** dependency.

**Storage**: `Panel.config` inside the existing `workspace_layout.layout_json` and sub-workspace blobs
(`PreviewPanelConfig`, `EditorPanelConfig.history`). **No SQLite migration**, `LAYOUT_SCHEMA_VERSION`
stays 3 — the 006/043 precedent. Settings are new leaves in the existing settings document.
`SHIPPED_DEFAULTS_VERSION` 7 → 8 for four icon tokens.

**Testing**: unit (node), component (jsdom), integration and contract (serial), Playwright-on-Electron
E2E under the budget ratchet. Layer map below.

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS/Linux.

**Project Type**: Desktop application, npm-workspaces monorepo, three processes (renderer, Electron
main, detached daemon).

**Performance Goals**: SC-002 — a change in a parented preview's source visible within 1 s of the user
pausing, for a 1,000-line document, with the 300 ms delay: ~700 ms for IPC, parse, sanitise and insert
(Open item O7). The Markdown pipeline is a lazily loaded chunk, costing nothing until the first preview
mounts (R21).

**Constraints**: Untrusted content in the app's own renderer — four independent layers (pipeline,
sanitiser, CSP, request filter; [contracts/security-policy.md](./contracts/security-policy.md)).
A preview holds **no** content-shaping state of its own (Principle XI). Standalone reads must never
register an editor document. Provider modules are never imported by a surface (enforced by a guard).

**Scale/Scope**: 106 FRs across 7 stories. Touches `packages/core` and `packages/ui` only. `daemon`,
`persistence`, `ipc-contract` and `platform-windows` are untouched — the unloaded-layout purge
composes existing RPCs (R19).

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

Constitution **v5.4.1**. Every principle and every workflow gate is assessed; none is skipped.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, and this feature discharges one of its clauses.** *"The workspace MUST be able to render previews of supported document files — Markdown (`.md`) preview at minimum"* was deferred by 004 and 006; Markdown ships here, so the clause's deferral ends. Isolation is enforced **in main**, never trusted from the renderer: a preview's project root is resolved from `Panel.originProjectId` (the `authoritative()` precedent, `editor-ipc.ts:71-83`); no affordance is offered outside the project (FR-004); links resolving outside it raise a notice (FR-090e); the `throng-preview:` protocol re-checks containment on the **real** path and takes the root from main's run, not the URL (FR-074, FR-084). Preview content goes only to a preview's **viewers**, never broadcast, because a sub-workspace window may hold a different project (043 round-two row). **Satisfied.** |
| **II. Platform-Abstracted Core** | **Engaged, satisfied, and one pre-existing gap closed.** Every decision — provider matching, settings derivation, history, link/image classification, request policy, asset resolution, slugging, title, layout ops — is a pure function in core with no OS call. Electron-specific pieces (`protocol.handle`, `webRequest`, `clipboard.write`) live in `ui/src/main`, the Electron boundary. **Closed:** `shell.openExternal` is called directly at `main.ts:902` and `window-open-guard.ts:22`; FR-091 requires the platform seam, so `IShellIntegration` gains `openExternal` and both call sites move onto it (R10). `IClipboard` gains `writeRich` behind its contract suite (R12). |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** No terminal, PTY or daemon lifecycle code changes. The new chords are not scoped to terminals. |
| **IV. Native Terminal Support & Auto-Detection** | **Engaged, and cleared without an exception.** `Alt+Left`, `Alt+Right` and `Ctrl+Enter` are in neither the reserved nor the shadowable tier and none is scoped to `terminal`, so no recorded exception is needed and `terminal-reserved-keys.test.ts` stays green. **One command, one chord**: Back/Forward share one binding across editor and preview. Displacing CodeMirror's `cursorSyntaxLeft/Right` on those keys inside an editor is FR-105's own stated precedence, and an editor, not a terminal, is what it displaces. |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | **Engaged, and satisfied as the text reads.** Every task is test-first at the lowest layer that can prove it (layer map below). Five E2E declarations are added, each naming one reserve entry and arguing why no cheaper layer holds the property (R22). **The budget does not rise.** The principle says the budget *"may fall and MUST NOT rise"*, and it also says an existing E2E test whose assertion a lower layer can make *"MUST be moved down"*. Five such declarations were found by audit — four `@editor`, one `@window`, none carrying a reserve tag, each with its assertion already held (or, for one subfolder case, added) at the unit, component or integration layer — and tasks T163a–T163e move them down **before** the new declarations land, replacement observed failing first. `e2e-budget.json` therefore reads 569 before and after the feature, per category. The plan also names what is **not** tested at E2E (mouse X-buttons, placement, persistence round-trip, menus, sanitiser output, SC-002's wall-clock latency) and where each is proved instead. Every reported-defect rule is inherited unchanged. *(An earlier draft raised the budget 569 → 574 on the strength of eight recorded raises; analysis on 2026-09-14 found that a recorded practice does not satisfy a NON-NEGOTIABLE MUST, and the offset replaced the raise.)* |
| **VI. Simple, Modern, Discoverable UX** | **Engaged heavily; one deviation.** Assessed in four rows below. |
| **VII. Change Review & Approval** | **Not engaged.** A preview is read-only (FR-020) and writes nothing; no edit-list behaviour changes. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided the shape.** **YAGNI** — a provider abstraction with one shipped provider must justify itself; it does, by a filed, blocked second consumer that differs on the hardest axis (#388, binary), plus two filed Markdown-internal consumers (#392, #393) that deliberately do **not** get an extension registry here — see Complexity Tracking. No new colour token (R17), no new RPC (R19), no `viewState` schema beyond an opaque bounded value (R11), no bindable command for Refresh or Open in Editor that no requirement asks for. **DRY** — the editor's grammars and highlight style are reused rather than a second highlighter (R5); `EditorService.load` is reused as the read path; the unsaved-open prompt duplicated at `editor-open.tsx:197-213` and `:285-301` is consolidated before Back/Forward would have made a third copy (R14). **Open/closed** — surfaces derive from the registry and a guard fails if one imports a provider. |
| **IX. Dependency Injection & Composition Root** | **Engaged; the 043 shortfall is continued and widened by two services** (recorded in Complexity Tracking). `PreviewService` and `NavigationHistoryService` take every collaborator by constructor (coordinator, `EditorService`, `IFileWatcher`, settings accessor, registry, push callback), which is what makes them integration-testable without Electron. They are constructed in `main.ts` beside `EditorCoordinator` (`:1269`), which is itself `new`-ed there and is their main collaborator — the shipped pattern. Recorded in Complexity Tracking with 043's row. Renderer surfaces receive the provider registry through a React context, never a module import. |
| **X. Externalised Configuration** | **Engaged, satisfied.** The update delay, maximum wait, copy format, per-provider enabled / default open action / own settings, and history size are settings with descriptors (FR-060–FR-061, FR-108). **Two hard-coded values the principle's text names**: the 10 s open-reservation timeout and the 1 KiB view-state bound are a *timeout* and a *limit*, the words Principle X uses, so they are recorded in Complexity Tracking as a deviation — with 030's truncation-bound row (`specs/030-failure-presentation/plan.md` Complexity Tracking) as the precedent — rather than argued away here. The image MIME allowlist is a security policy, not a tunable value, and is not a deviation. |
| **XI. Dockable Workspace: Panes, Tabs & Panels** | **Engaged, and it is the highest-risk row.** The workflow gate fires verbatim: *"a change that introduces a new panel type able to present an existing artefact MUST be checked for per-Panel copies of content-shaping state."* Assessed in full below. |

### Principle XI in full — per-panel content-shaping state

- **A preview presents an existing artefact**, so the rule binds: *"This rule binds every panel type
  that can present one artefact twice — an editor, a diff view, **a document preview**…"*.
- **It holds no content-shaping state of its own.** No buffer (content arrives as snapshots from
  `PreviewService`, which reads `coordinator.getContent` at flush time and keeps nothing between),
  no dirty state (copied from the document, FR-040; never set by the preview, FR-041), no undo, no
  language, no indentation.
- **One authority, not two peers.** Parented content has exactly one authority — the coordinator's
  `DocumentAuthority` — and the preview is a derived replica driven by versioned snapshots from it
  (*"a replica driven by an ordered stream from a single authority satisfies this rule"*). Nothing
  flows back.
- **The trap the research found.** Following the existing `throng:editor:sync` broadcast from each
  window would have made every window derive *parented* separately, from a stream that announces
  neither document open nor destroy, and whose `reset` carries no path (R9). Two windows deriving one
  fact is two originals. `PreviewService` derives it once.
- **The same test applied to the preview's own state.** A preview's current file and its history are
  not content-shaping state of a document — but they are one panel's state shown in possibly two
  windows, and Sync to **clones** the Panel (`sub-workspace.ts:50,138`) while config changes are not
  relayed. Kept in `Panel.config` alone they would fork. Both live in main, keyed by panel id, with
  each window a viewer that mirrors for persistence — the 043 FR-078 precedent.
- **Counts.** A preview never publishes to the renderer's editor state store, so tab, project and
  Files & Folders unsaved markers count one document once (FR-044, SC-006).

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | **Satisfied.** Every discrete command or toggle on a preview is in its header or body menu: Close, Reveal, Open in OS Explorer, Open in Editor/Go to Editor, Back, Forward, Send to Tab, Sync to, Refresh, Zoom, Copy (three formats), Select All, Open Link, Copy Link Address. The status-bar buttons (preview on an editor, Open in Editor on a preview) and the header Back/Forward buttons are **accelerators over menu items that exist** — hiding the status bar strands nothing. Editors gain Open Preview (body and header) and Back/Forward (header). **Exempt as navigational input**: scrolling, Tab between links, mouse X-buttons (which perform Back/Forward, themselves menu items). Focusing an open preview from the pressed status-bar button is not a command a hidden bar could strand (FR-014 argues this). |
| **One section vocabulary for every menu** | **Satisfied without amendment.** Shapes in [contracts/menus-and-controls.md](./contracts/menus-and-controls.md): Close is Destroy; Reveal, Open in OS Explorer, Open in Editor/Go to Editor, Back, Forward, Send to Tab and Sync to are Navigate; Refresh and Zoom are View & state; Copy/Select All are Content; Open Link / Copy Link Address are **Contextual** — present only because of what the pointer is over, 024 US7's placement. `section` is a required field, so omission is a compile error. |
| **Disabled when unavailable, absent when meaningless** | **Engaged, satisfied as the rule reads.** Back/Forward **disabled** at the ends of a history, never hidden (FR-104); Open Preview and Open In → Preview **disabled** while a preview is open (FR-012); Copy items **disabled** with no selection; Rename **absent** on a preview (never meaningful, FR-030); Open in Editor **absent** for a binary provider (a PDF can never have an editor, FR-015e). **A disabled provider** is one setting away from working, so its affordances are *unavailable*, not meaningless: the status-bar button, Open Preview and Open In → Preview are **drawn disabled**, the button's tooltip naming the setting that re-enables it (FR-001, FR-003, FR-062), and the provider's default open action and own settings are **drawn disabled** through the existing `enabledWhen` (FR-061). Only a file type with **no provider at all**, a folder, a file outside the project, or an editor with no file on disk gets **no** affordance (FR-001, FR-003, FR-004). *(An earlier draft of this plan recorded a deviation here; the spec was amended 2026-09-14 (planning) to follow the rule, and the deviation is withdrawn.)* |
| **Themeable icon controls (NON-NEGOTIABLE)** | **Satisfied.** Every new action control is an icon from the theme with a hover title naming the action: the status-bar preview button, the preview's Open in Editor/Go to Editor button, and the header Back/Forward buttons (titles carry the chord, FR-104). Four new icon tokens, `editorPanel` reused (R17). No colour literal in `preview.css`, enforced by a guard. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | **Engaged.** This feature ends Principle I's preview deferral. Future providers (#388) and Markdown extensions (#392, #393) are **separate features**, not deferred parts of a constitutional requirement — the requirement is "Markdown at minimum". One inherited limitation is recorded in Complexity Tracking (history path-following in layouts no window holds) with its issue to be filed at task time. |
| **Every plan evaluated against all eleven principles** | Done above. |
| **Static analysis & linting (NON-NEGOTIABLE)** | **Engaged as the standing gate.** `npm run gate`, dispatched to a hosted runner, is the only evidence of done-ness; the run URL and SHA are quoted. |
| **Particular-scrutiny review** | **Engaged twice**: persisted layout state (new config fields, canonicalisation, purge across unloaded layouts) and a document presented in more than one Panel (XI above). |
| **Documentation currency (NON-NEGOTIABLE)** | **Engaged.** User-facing behaviour, settings, key bindings and a contributor extension point all change. `README.md` (Highlights, Configuration), `docs/quick-start.md` (§4 Edit files, the file tree's menu, §7 Make it yours, Keyboard reference), `CONTRIBUTING.md` (**adding a preview provider** — the two files and two registration lines), `docs/testing.md` (the new declarations and their reserves, the five moved down, the manual X-button check) and `CHANGELOG.md` (unreleased entry) are updated in the same change. |
| **Configuration-editor completeness (NON-NEGOTIABLE)** | **Engaged.** Every new setting, binding and token has exactly one descriptor; per-provider descriptors are **generated** from the registry and the completeness test is also run against a test registry (SC-003 S5). `settings-metadata-040.test.ts:167-179` must be amended for the Previews subgroup. `SHIPPED_DEFAULTS_VERSION` 7 → 8. |
| **Displayed quantities digit-grouped (NON-NEGOTIABLE)** | **Engaged lightly.** New displayed quantities are the settings' numeric fields (update delay, max wait, history size), which the preference editors already group through their paired formatter/parser. A preview renders the **document's** text verbatim — numbers in a user's Markdown are content, not quantities the app displays, and are never regrouped. No new count appears on any surface. |

**Result: PASS**, with one Principle X deviation (two hard-coded guard values) and 043's Principle IX
exception widened by two services, both recorded in Complexity Tracking, one Principle II gap closed, and the E2E
budget held flat by moving five existing declarations down.

### Re-evaluation after Phase 1

Re-checked against the design artifacts. Two findings changed the design, none changed the verdict:

- **XI forced `NavigationHistoryService` into main.** The first draft kept history in `Panel.config`
  only; Sync to's shallow clone would have forked it, contradicting FR-110. Moved to a main authority.
- **II surfaced the missing open-external seam** while contracting FR-091; closed in scope (R10).
- The request filter (R8) was checked against Principle II: the *decision* is pure core, the
  *installation* is Electron — same split as the scan service in 043.

## Project Structure

### Documentation (this feature)

```text
specs/044-file-previews/
├── spec.md
├── plan.md                                # this file
├── research.md                            # Phase 0 — R1–R22, Open items O1–O8; iteration — R23–R29, O9–O10; round 2 — R30–R33
├── data-model.md                          # Phase 1
├── quickstart.md                          # Phase 1
├── contracts/
│   ├── preview-provider-seam.md           # FR-070–074, SC-003
│   ├── preview-ipc.md                     # channels, coordinator observer, throng-preview: protocol
│   ├── navigation-history.md              # FR-100–112
│   ├── security-policy.md                 # pipeline, sanitiser profile, CSP, request filter
│   ├── settings-bindings-tokens.md
│   └── menus-and-controls.md
├── checklists/requirements.md
└── tasks.md                               # Phase 2 (/speckit-tasks)
```

### Source Code

Each block names the **owning area agent** (`.claude/agents/README.md`) so tasks can be routed.

```text
packages/core/src/                                          ── throng-core-architecture
├── preview/                          NEW
│   ├── provider.ts                   descriptor types, PreviewProviderRegistry interface (FR-071, FR-072)
│   ├── settings-types.ts             PreviewCopyFormat, DefaultOpenAction, ProviderSettings, PreviewSettings
│   ├── registry.ts                   createPreviewProviderRegistry + validation, providerFor,
│   │                                 enabledProviderFor, previewAffordance
│   ├── providers/index.ts            THE core registration line; SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
│   │                                 SHIPPED_PREVIEW_PROVIDERS
│   ├── providers/markdown.ts         the Markdown descriptor (FR-080, FR-092)
│   ├── links.ts                      classifyPreviewLink, resolvePreviewImage, headingSlug,
│   │                                 markdownHeadingLine, languageForFenceInfo
│   ├── request-policy.ts             decideRendererRequest, resolvePreviewAsset (takes a MIME allowlist)
│   ├── front-matter.ts               splitFrontMatter (no YAML parsing — that is in ui)
│   ├── settle-scheduler.ts           debounce + max wait, injected clock (FR-022, FR-060a)
│   ├── wire-types.ts                 PreviewUpdate, PreviewNotice, PreviewContent and every throng:preview:*
│   │                                 request/response/push shape — types only, shared by main, preload and
│   │                                 renderer (contracts/preview-ipc.md §1–§2) *(added 2026-09-15 (u7))*
│   └── panel-type.ts                 PREVIEW_KIND = 'preview' and the preview panel-type descriptor,
│                                     offered:false (the EDITOR_KIND convention; no separate kind.ts)
├── navigation/history.ts             NEW — reducer, parse/serialise (FR-100–FR-112)
├── panel-type/default-registry.ts    + register preview
├── workspace/
│   ├── model.ts                      + PreviewPanelConfig, EditorPanelConfig.history, PersistedHistory
│   ├── panel-title.ts                + preview branch, suffix never truncated (FR-031, FR-032)
│   ├── operations.ts                 + addPanelBeside, removePanelsWhere (FR-010, FR-063/064)
│   └── persisted-paths.ts            + walk config.history.entries[].filePath (FR-109)
├── index.ts                          + barrel exports for every new core module
├── abstractions/
│   ├── clipboard.ts                  + writeRich (FR-035a)
│   └── shell-integration.ts          + openExternal (FR-091)
└── testing/                          + contract cases for both

packages/core/src/config/                                   ── throng-config-preferences
├── preview-settings.ts               NEW — defaults / descriptors / parse from a registry (R15);
│                                     effectiveMaxWaitMs, defaultOpenActionFor, remoteImagesPermitted,
│                                     providersTurnedOff (the FR-063 trigger)
├── app-settings.ts                   + editor.previews, editor.navigation.historySize; clone
├── settings-metadata.ts              + spread previewSettingsDescriptors; historySize descriptor
├── keybindings.ts                    + 4 actions, 'preview' DispatchScope, SCOPE_NAMES/ORDER
├── keybindings-metadata.ts           + 4 descriptors
├── theme.ts, theme-copy.ts           + 4 icon tokens
└── shipped-defaults.ts               VERSION 7 → 8

packages/ui/src/main/
├── preview-service.ts                NEW — runs, viewers, derived source, scheduler      ── throng-editor-documents
├── preview-ipc.ts                    NEW — throng:preview:*                              ── throng-editor-documents
├── navigation-history-service.ts     NEW — authority keyed by panel id                   ── throng-editor-documents
├── navigation-history-ipc.ts         NEW — throng:history:*                              ── throng-editor-documents
├── editor-coordinator.ts             + DocumentLifecycleListener; load navigation intent ── throng-editor-documents
├── editor-ipc.ts                     + load's navigation field                           ── throng-editor-documents
├── preview-protocol.ts               NEW — throng-preview: handler (FR-074, FR-084)      ── throng-explorer-fileops
├── preview-purge.ts                  NEW — unloaded-layout purge over existing RPCs      ── throng-daemon-persistence
├── renderer-request-filter.ts        NEW — webRequest + will-navigate installation       ── throng-core-architecture
├── electron-shell-integration.ts     + openExternal                                      ── throng-core-architecture
├── electron-clipboard.ts, memory-clipboard.ts, clipboard-service.ts, clipboard-ipc.ts  + writeRich ── throng-core-architecture
├── preferences-window.ts, about-window.ts   + guardNavigation                            ── throng-core-architecture
├── external-url.ts                   + mailto                                            ── throng-core-architecture
├── files-service.ts / main.ts        open-document check += previews; moves broadcast;  ── throng-explorer-fileops
│                                     construct + wire the new services
└── window-open-guard.ts              shell call → seam                                   ── throng-core-architecture

packages/ui/src/preload/preload.cts, renderer/global.d.ts   + preview, history, rich clipboard ── throng-renderer-ui

packages/ui/src/renderer/index.html                         CSP (security-policy Layer 3)  ── throng-renderer-ui

packages/ui/src/renderer/preview/                           NEW                             ── throng-renderer-ui
├── preview-panel.tsx                 chrome: status bar, notices, body host, zoom var, copy routing, X-buttons
├── preview-store.ts, preview-open-store.ts
├── provider-registry-context.tsx     PreviewProviderRegistryContext (default: the shipped registry)
├── preview-commands.tsx              preview.open, preview.followLink; place / focus / openChanged listeners
├── preview-provider-sync.tsx         closes previews when a provider is disabled (FR-063)
├── preview-path-sync.tsx             config.filePath from broadcast pathChanged / files:moved (FR-066)
├── provider-view.ts, providers/index.ts        THE renderer registration line
├── content-menu.ts                   body menu (FR-035, FR-095)
├── open-preview.ts                   preview.open, placement, placeDeclined (FR-010, FR-011)
├── open-in-editor.ts                 Open in Editor / Go to Editor (FR-015c, FR-015d)
├── preview-status-bar.tsx            the preview's status bar (FR-015a, FR-015e)
├── preview-notice.tsx                FR-026 / FR-027 notices over PanelFailureBanner
├── preview-link-notice.tsx           link and history notices, raised as notifications (FR-090e/f, FR-106c, FR-123)
├── copy.ts                           selection → { text, html } via export profile (FR-035a)
├── preview.css                       tokens only (FR-083)
└── providers/markdown/
    ├── pipeline.ts                   markdown-it + rules + yaml front matter (R1, R4)
    ├── sanitise.ts                   DOMPurify profile + hooks (R2, R6, R7)
    ├── highlight.ts                  post-insert fenced-code highlighting (R5)
    ├── scroll-anchor.ts              capture/restore (R11)
    └── markdown-body.tsx

packages/ui/src/renderer/navigation/                        NEW                             ── throng-renderer-ui
├── history-store.ts, history-mirror-sync.tsx   (config.history from broadcast changed / files:moved)
├── back-forward-buttons.tsx          header buttons (FR-104)
└── navigate-history.ts               Back/Forward command → editor or preview path

packages/ui/src/renderer/editor/                                                            ── throng-editor-documents
├── open-into-panel.ts                NEW — the consolidated prompt flow (R14)
├── open-router.ts                    NEW — default open action router (FR-052–FR-055)
├── editor-open.tsx                   callers → open-into-panel / open-router
├── status-strip.tsx                  + preview button in controls group (FR-001, FR-014)
├── editor-panel.tsx                  feeds the button its affordance and preview-open state
├── use-editor.ts                     Open Preview affordance/action; history attach on mount
├── editor-chrome.tsx                 mounts PreviewCommands, EditorTitlePublisher, PreviewProviderSync, HistoryMirrorSync
├── clear-editor-panel-type.ts        + history.purge (FR-110)
├── content-menu.ts                   + Open Preview (FR-002)
└── editor-title-publisher.tsx        NEW — publishEditorTitle (FR-031)

packages/ui/src/renderer/workspace/                                                         ── throng-renderer-ui
├── panel-body.tsx                    + preview branch
├── panel-placeholder.tsx             + Back/Forward before type icon; dot gate; destroy cleanup
├── panel-destroy-sync.tsx            + preview destroyed, history purge
└── panel-header-menu.ts              + preview shape; editor Open Preview/Back/Forward; KINDS_THAT_ZOOM; isRenamable

packages/ui/src/renderer/explorer/context-menu-items.ts, file-tree.tsx   + Open In → Preview ── throng-explorer-fileops
packages/ui/src/renderer/navigate/quick-open.tsx                         → open-router      ── throng-renderer-ui
packages/ui/src/renderer/state/workspace-store.tsx, subworkspace-window-client.ts   restore filter (FR-067) ── throng-renderer-ui
packages/ui/src/renderer/subworkspace-app.tsx                            preview kind registration if needed ── throng-renderer-ui
packages/ui/src/renderer/keybindings/scope.ts, app.tsx                   scope + window-handled ── throng-renderer-ui
packages/ui/src/renderer/preferences/settings-tab.tsx                    metadata context (SC-003) ── throng-config-preferences
packages/ui/vite.config.ts                                               preview chunk      ── throng-build-release
packages/ui/package.json                                                 new dependencies   ── throng-build-release

packages/ui/tests/e2e/  4 new specs, 5 declarations; 5 declarations moved down from
                        editor-feedback{,2,3}.e2e.ts, editor-language-override.e2e.ts,
                        tab-settings.e2e.ts; e2e-budget.json (unchanged totals); parallel-plan.json ── throng-e2e-harness
packages/ui/tests/fixtures/preview/  gfm, front-matter, hostile, remote-images, long-1000, links/ ── throng-e2e-harness
README.md, docs/quick-start.md, CONTRIBUTING.md, docs/testing.md, CHANGELOG.md               ── throng-spec-governance
```

**Structure Decision**: `packages/core` and `packages/ui` only. Nothing in `daemon`, `persistence`,
`ipc-contract` or `platform-windows`: the preview never crosses the daemon boundary, the persisted
fields ride the existing blob, and the unloaded-layout purge composes existing RPCs (R19).

## Testing strategy

Principle V: the lowest layer that can prove each thing.

| Layer | What proves itself here |
|---|---|
| **unit** (core) | Provider registry: extension matching, the FR-072 conflict message, `previewAffordance` for text/binary/outside/no-file (FR-004, FR-073); settings derivation, parsing, `effectiveMaxWaitMs` (FR-060a), completeness against the shipped **and** a test registry; history reducer invariants H1–H10 and SC-007 as a property test; `classifyPreviewLink`, `resolvePreviewImage`, `headingSlug`, `markdownHeadingLine`, `languageForFenceInfo` (FR-084, FR-090–FR-091); `decideRendererRequest` table (FR-092/FR-093); `resolvePreviewAsset`; settle scheduler with a fake clock (FR-022, FR-060, SC-002 arithmetic); `panelDisplayTitle` preview branch and truncation (FR-031/FR-032); `addPanelBeside`, `removePanelsWhere` incl. the last-panel rule and idempotence (FR-064); history canonicalisation (FR-068/FR-109); keybinding metadata, scopes and collisions; icon token count; the surfaces-name-no-provider guard (FR-070) |
| **unit** (ui, node) | Markdown pipeline output for every FR-080 construct, front matter table / invalid-YAML code block (FR-085), `mermaid` fence and math as literal (FR-086), the sanitiser-is-called assertion (FR-081); menu builder shapes in `menu-sections.test.ts`; `settings-metadata-040` amendment; `settings-inertness-044`; provider view key parity |
| **component** (jsdom) | Sanitised DOM for the hostile fixture (FR-081, SC-004 renderer half); image rewriting with remote images on/off (FR-084, FR-092); links — no `href`, title, Ctrl+click vs click vs Ctrl+drag, Tab/Ctrl+Enter/Shift+F10 handlers (FR-094–FR-096); body menu presence and disabled states (FR-035–FR-035c, FR-095); copy payloads by format via a fake bridge (FR-035a); header Back/Forward buttons enabled states and title chords on editor and preview (FR-104); unsaved dot on parented-dirty only (FR-040, FR-043); status-bar preview button absent/disabled-with-setting-tooltip/pressed (FR-001, FR-014, FR-062) and the preview status bar (FR-015a/e); Explorer Open In → Preview absent/disabled (FR-003, FR-012); rename inert (FR-030); scope mapping so file commands are inert (FR-021); settings tab Previews subgroup, a disabled provider's settings drawn disabled via `enabledWhen` (FR-061); **SC-003 seam test S1–S7**; notice one-and-flash (FR-026); front matter table rendering; mouse X-button handler (FR-105); no colour literal in `preview.css` (FR-083); zoom variable (FR-034) |
| **integration** (serial, real coordinator + `NodeFileWatcher` over a temp tree) | `PreviewService`: parented follow with delay and max wait, dirty immediate (FR-022, FR-040); standalone disk follow (FR-023); **reads register nothing** — registry and `list()` unchanged across open/follow/close (FR-025, SC-006, FR-044); adopt on register (FR-013a) and fall back on destroy (FR-013b); Save-As type change notice (FR-027); delete notice (FR-026); refresh flush (FR-028); at most one preview under racing opens (FR-012); two viewers get identical revisions (FR-022); link navigation outcomes (FR-090a–e). `NavigationHistoryService` with `coordinator.load` intents: record, no-op on current, move, missing-file move, refusal no-move (FR-103, FR-103a, FR-106); rename/move rewrite for unmounted panels (FR-109); cap change (FR-108); purge (FR-110). `throng-preview:` handler over a temp tree incl. symlink escape (FR-074, FR-084). Layout round-trip of preview config and history through `WorkspaceRepository` (FR-066, FR-068, FR-109). Unloaded-layout purge and its idempotent re-run (FR-063, FR-067). `revealDocument` accepting a standalone preview's path |
| **contract** | Preload parity for `throng:preview:*` and `throng:history:*`; `IClipboard.writeRich` and `IShellIntegration.openExternal` contract suites against Electron and memory implementations |
| **E2E** (+5 declarations, −5 moved down, budget and `@core` unchanged) | `preview-hostile` `@reserve:runtime`; `preview-scroll` ×2 `@reserve:layout`; `navigation-history-keys` `@reserve:input`; `preview-subworkspace` `@reserve:window` — each argued in R22. Offset by T163a–T163e, which move five unreserved declarations whose assertions a lower layer holds (four `@editor`, one `@window`) down first |

**Deliberately not E2E**: placement beside the parent (a pure layout op plus a main routing decision
with an injected focus function), persistence across a restart (repository round-trip at integration
— Principle V names persistence as integration), every menu shape (in-document React menus), the
sanitiser's output (component), theme legibility (every preview text colour pinned by T093 to a pairing
`theme-quality.ts` already measures on every shipped theme), the mouse X-buttons (Playwright cannot
press them — manual step, quickstart §6), and **SC-002's wall-clock latency**: T009 proves the
scheduler arithmetic, T164 records the measured time as an annotation (O7) and T174 checks it by hand,
but nothing asserts a millisecond bound, because a wall-clock assertion on a shared hosted runner is a
flake by construction and a flaky gate costs more than the property it would guard.

## Sequencing

This is a planning constraint for `/speckit-tasks`, not advice.

1. **Foundations, in parallel** — core preview registry + settings derivation; core history reducer;
   core link/request/asset policies; keybinding scope and actions; icon tokens + shipped-defaults bump
   (**one** bump, carrying all four tokens).
2. **Main authorities** — the coordinator observer lands **before** `PreviewService` and
   `NavigationHistoryService`: `PreviewService` is its one listener, and the coordinator calls the history
   service directly for `load` recording and the Save-As `rewriteCurrent`. The `load` navigation intent lands with the
   history service.
3. **The consolidated prompt flow (`open-into-panel.ts`) lands before Back/Forward** and before any
   change to `openFileInTab`/`openFileInPanel` — otherwise the two copies are edited twice. The
   default-open-action router (T135) edits `editor-open.tsx` earlier, but only the `throng:open-file`
   handler inside `EditorOpenListener`, which calls neither prompt copy; that is not a change to them.
4. **Security layers before the Markdown body is mounted anywhere**: CSP, request filter,
   `will-navigate` guard and the protocol handler precede the first component that inserts sanitised
   HTML into a real window.
5. **Surfaces** — panel kind, header, status bars, menus, explorer, router, preferences — in any order
   after 1–2.
6. **`panel-header-menu.ts` is one cluster**: the preview shape, the editor's Open Preview/Back/Forward,
   `KINDS_THAT_ZOOM` and `isRenamable` edit the same builder and its `menu-sections.test.ts` pins —
   one commit, not four.
7. **E2E last**, the five demotions first, with `e2e-budget.json` and `parallel-plan.json` re-seeded
   in the same commit as each spec change — so the budget never reads above 569.
8. **Docs** in the same change as the behaviour they describe.

## Complexity Tracking

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **A provider abstraction with one shipped provider** (Principle VIII, YAGNI) | The maintainer directed an abstract base with per-type providers (spec *Input*). The second consumer is concrete and filed: **#388** (PDF) is blocked on this feature and differs from Markdown on the axis that tests a seam hardest — **binary**, no editor, always standalone, content delivered as a resource URL rather than text. The seam's `kind` axis, the `source` route, `sourceMimeTypes`, and the binary test provider in SC-003 exist for exactly that shape. **#392** (Mermaid) and **#393** (math) are also blocked on this feature, but they are **Markdown-internal**: they extend one provider, not the seam. So the Markdown provider gets **no** plugin registry here — fenced code goes through one `renderFence(info, code)` function, which is where #392 will slot in, and math remains literal text (FR-086) until #393's own plan decides its renderer. | A Markdown-only panel: every later provider re-decides the panel kind, both menus, the status bar, the settings, persistence and the security model — the very re-litigation the maintainer's direction forbids, and #388 is already waiting. A general *extension* registry inside the Markdown provider for #392/#393: speculative today — neither issue has a plan, and a registry designed without its consumers is the speculative generality Principle VIII prohibits. |
| **Five new E2E declarations, paid for by five moved down** (Principle V: *"may fall and MUST NOT rise"*; *"an existing E2E test whose assertion a lower layer can make MUST be moved down"*) — not a deviation; recorded because it spends feature scope | Five declarations, each naming one reserve entry and stating what no cheaper layer can hold (R22). An audit of the suite found five `@extended` declarations carrying **no** reserve tag whose assertions a lower layer already makes (four `@editor`, one `@window` — T163a–T163e name them), so moving them down is owed by the principle anyway; doing it here keeps `e2e-budget.json` at 569 and every category flat. One of the five (New Folder on a subfolder) needs its lower-layer case written first. | Raising the budget 569 → 574 on the strength of eight recorded raises: a recorded practice does not satisfy a NON-NEGOTIABLE MUST, and the offset was available. Adding none: SC-004's "no network request" and FR-024/FR-107's scroll position are false-positive-prone below the real engine, which is exactly when the reserve exists. |
| **Two hard-coded guard values: the 10 s open-reservation timeout and the 1 KiB view-state bound** (Principle X names *timeouts* and *limits*) | The reservation timeout exists only to release a path whose requesting window died between `open` and `attach` (contracts/preview-ipc.md §1); in every live case `attach` consumes the reservation first, so a user never waits on it and has no reason to tune it. The 1 KiB bound caps an opaque provider value inside a persisted layout blob so a misbehaving provider cannot bloat every layout write (data-model §4). Neither is business configuration — both are integrity guards — the same reasoning 030's plan recorded for its truncation bound and `max-height` (`specs/030-failure-presentation/plan.md` Complexity Tracking) and 043's for `DISTINCTNESS_THRESHOLD`. Both are named constants in core, unit-tested at their edges (T006, T059). | *Make them settings*: two more leaves, descriptors, editor rows and completeness cases for values whose only correct answer is "long enough never to fire in a healthy app" and "large enough for a scroll position", and whose mis-setting either disables the one-preview-per-file guard or silently drops Back's scroll restore (FR-107). Revisit if either ever needs to differ between machines. |
| **A hard-coded highlighting budget: `HIGHLIGHT_BUDGET_CHARS` (100,000 fenced-code characters per document)** (Principle X names *limits*) — *(added 2026-09-15, US6 review; per document rather than per block since the whole-branch security review M2, 2026-09-15, because a per-block bound let many fences just under it each be highlighted in full)* | The editor bounds syntax highlighting by its viewport; a preview has none and highlights every block on every live update of a parented preview, so a pasted bundle or log in a fence would be re-highlighted on each keystroke. Blocks are highlighted in document order while their running total stays within the budget; the block that would pass it, and every later one, renders as plain code — the same treatment, and the same reasoning, as the editor's fixed `LONG_LINE_THRESHOLD` (016 FR-008a). A named constant in `ui/src/renderer/preview/providers/markdown/highlight.ts`, component-tested at its edge (`preview-highlight.test.ts`). | *Make it a setting*: a descriptor, a preferences row and completeness cases for a performance guard no reader has a reason to move; the editor's own long-line threshold was kept fixed for the same reason. Revisit if a real document needs larger highlighted blocks. |
| **`PreviewService` and `NavigationHistoryService` constructed in `main.ts`, outside the container** (Principle IX) — **widens** 043's recorded exception by two services | Their principal collaborator, `EditorCoordinator`, is itself `new`-ed at `main.ts:1269`, as are `EditorService` and the watchers; both services take every collaborator by constructor. This is 043's recorded continuation (`IFileSystem` outside the container), not a new pattern — but it is two more objects inside the exception, stated as such so the next feature counts them. **End state**: the UI-main object graph built in the container, coordinator first. 043 recorded its row without an issue and this plan does not invent one; it is raised to the maintainer below (item 3). | Binding two new services in the container while the coordinator they depend on is not: two conventions for one object graph, inside a feature that is not about DI. |
| **History path-following in layouts no window holds** (FR-109; Incremental Delivery) | `NavigationHistoryService` rewrites every history it holds, and each window rewrites its own layout's `config.history` for mounted and unmounted panels. A panel in a **closed sub-workspace** or an **unloaded project** is held by no one, so a rename made meanwhile is not applied to its history — the same scope editors' own `config.filePath` has today (`moved-path-sync.tsx` handles loaded layouts only; research agent finding on `markMoved`). On restore such an entry points at the old path and shows the could-not-read state when stepped onto (FR-106d), which the user can step past. | Walking every persisted layout on every move: a daemon-wide write per rename, racing live windows, to fix a gap editors already have. **End-state requirement**: history and editor paths both follow moves in every persisted layout. **Tracked as**: **#397** (`github-issues`: Enhancement, `area:editor`, milestone v1.0.0), filed by T003a, the first task after setup and before any build work. **Expected to complete it**: the spec written for that issue. **Is FR-109 weakened?** Not for any panel a window holds; the unloaded case inherits 019 FR-008's scope and is recorded rather than implied. |

### Reported to the maintainer, not worked around

1. **Constitution V's budget text vs the budget's recorded practice.** *"MUST NOT rise"* against eight
   justified raises. This feature no longer relies on the practice — it offsets its five declarations
   (T163a–T163e) — but the two still disagree, and either the text gains the practice (a raise justified
   per test in the diff) or the practice stops.
2. **FR-105's mouse buttons** cannot be driven by Playwright; verified at component tier plus a manual
   step (quickstart §6, Open item O2).
3. **The UI-main services outside the container have no tracking issue.** 043 recorded
   `IFileSystem`; this feature adds `PreviewService` and `NavigationHistoryService`. Whether that
   end state deserves its own issue is a backlog decision, not this feature's.

### Resolved during planning (spec amended 2026-09-14)

Three spec-wording findings from the first pass of this plan were resolved in `spec.md` by the
orchestrator; the design already matched two of them and now matches all three.

| Finding | Resolution in spec | Design |
|---|---|---|
| A disabled provider's affordances were *absent*, contradicting Principle VI | FR-001, FR-003, FR-061, FR-062, US4 scenario 1 and the Assumption now say **disabled** | `previewAffordance` returns `absent` / `disabled` / `enabled` (data-model §2); settings use `enabledWhen`, and the planned `visibleWhen` descriptor field is **dropped** (R15); the Principle VI deviation is withdrawn |
| FR-064's "the tab is kept" over-read 002 FR-016 | FR-064 and its edge case: closing under FR-063 behaves as closing by hand — an emptied tab closes; the workspace's last panel is replaced by an empty panel | `removePanelsWhere` (data-model §8, R19) |
| FR-027's notice was unreachable for a preview bound strictly to the old path | **FR-013c**: a parented preview follows its source document's path change (rename, move, Save As) | `PreviewService` source transitions on `repointed` (data-model §10, contracts/preview-ipc.md §3) |

---

## Iteration 2026-09-15 (FR-113–FR-120, and the text-selection defect)

*Added 2026-09-15 by `speckit-iterate`, after the maintainer's hands-on test of the delivered build.
Additive only: nothing above is rewritten, and where a decision above is refined the row below says
so. Inputs: spec.md Clarifications **Session 2026-09-15**, FR-113–FR-120 and their markers on FR-015a,
FR-085, FR-091, FR-095, FR-101 and Out of Scope; the triage in
`.superpowers/sdd/tasks/iterate-triage.md`. Research: [research.md](./research.md) R23–R29, Open items
O9–O10. Model: [data-model.md](./data-model.md) §14. Tasks: Phase 13, T181–T217.*

### Scope

| # | Request | Shape | Requirements |
|---|---|---|---|
| 1 | Editor scroll drives the preview, as a setting shipping on | gap | FR-113, FR-114 |
| 2 | Preview text cannot be selected with the mouse | **defect** — no spec change | FR-035, FR-094 |
| 3 | A way back after a same-document heading link | gap | FR-115 (refines FR-101) |
| 4 | Copy Link Address on a heading link includes the file | gap | FR-116 (refines FR-095) |
| 5 | Show or hide front matter | gap | FR-117 (refines FR-085) |
| 6 | Hovered or focused link's target in the status bar | gap | FR-118 (partly supersedes FR-015a) |
| 7 | The browser drops behind throng after a Ctrl+click | gap, **cause unproven** | FR-119 (refines FR-091) |
| 8 | An image's tooltip names its source | gap | FR-120 |

Touches `packages/core` and `packages/ui` only, as the original plan did. `daemon`, `persistence`,
`ipc-contract` and `platform-windows` stay untouched — FR-119's candidate remedy reuses the
**existing** `IForegroundHandoff` binding (`platform-windows/src/windows-foreground-handoff.ts`), it
does not add one. No SQLite migration, no `LAYOUT_SCHEMA_VERSION` change, **no
`SHIPPED_DEFAULTS_VERSION` bump** (two settings leaves, no token; `shipped-defaults.ts:134-140`), no
new icon or colour token, no new key binding, no new IPC channel.

### Design per requirement

**Request 2 — text selection (defect; FR-035, FR-094).** *Hypothesis, from a code reading:*
`theme.css:200-207` sets `body { user-select: none }` app-wide and re-enables it only for form fields,
`.cm-editor` and `.xterm` (`:212-219`); nothing re-enables it for a preview body, and Chromium will not
start a mouse selection inside `user-select: none` content. The component tests pass because they
select with the Range API, which jsdom and Chromium both let ignore `user-select`.
The fix is one rule in the **Markdown provider's own stylesheet**,
`preview/providers/markdown/markdown.css`: `.preview-markdown { user-select: text; -webkit-user-select:
text; }`. Not in `theme.css` — `preview-surfaces-name-no-provider.test.ts` fails the build on a Markdown
CSS class outside the provider folder — and not on the chrome's `.preview-panel__body`, because whether
a body's content is selectable is the provider's declaration (`textSelection`, contracts/menus-and-controls.md
§4), which a binary provider may answer no. See R29 for the test order.

**FR-113 / FR-114 — editor → preview scroll sync.** One setting leaf, `editor.previews.syncScroll`
(boolean, ships `true`, Editor · Previews, every text provider, no `enabledWhen`). The mechanism is a
**renderer-local store, per window, keyed by editor panel id** — `renderer/editor/editor-scroll-store.ts`,
on the `caret-store.ts` pattern (view state, Principle XI's view side):
- **Publish.** `use-editor.ts`'s existing `scrollDOM` scroll listener (`:1264-1272`) additionally
  publishes the editor's **top visible source line** (0-based), rAF-throttled, computed with
  `view.posAtCoords` at the scroller's top-left — not `lineBlockAtHeight`, which `use-editor.ts:492-514`
  records as wrong for wrapped lines. It also publishes once at view registration, and forgets the
  panel at unmount.
- **Subscribe.** `preview-panel.tsx` subscribes to `state.parent.panelId` — main already pushes the
  parent editor's panel id on every update (`PreviewUpdate.parent`, `core/src/preview/wire-types.ts:43`)
  — while the setting is on and the provider is `text`, and hands the body an optional
  `syncLine` prop (`PreviewBodyProps`, data-model §14.4).
- **Apply.** The Markdown body calls the existing `restoreScrollAnchor(scroller, { line, offsetRatio: 0 })`
  when `syncLine` changes, or once the file is drawn if it arrives first. A live update keeps using the
  **captured** anchor (`markdown-body.tsx:198-203`), which is wherever the last sync — or the reader's own
  later scroll — left the body; that is what "keep the synchronised position rather than fight it"
  means, and it leaves FR-024 exactly as shipped.
- **One-way.** Nothing in the preview writes the store; a sync scroll is scrolling within a file, so it
  records no history (FR-101).
- **Reading of FR-113 — the window.** The editor view that drives a preview view is the parent
  editor's view **in the same window**. A preview view whose window holds no mounted view of its parent
  editor (the editor only in another window, or in a background tab) does not follow. Recorded in the
  spec as a planning note under FR-113; see R23 for why a cross-window relay was rejected.

**FR-115 — heading jumps join the preview's history.** A new core reducer function,
`recordJump(h, leaving, arriving, cap)` (data-model §14.2): it puts `leaving` on the current entry,
returns `h` unchanged when `arriving` equals it (FR-115's no-duplicate rule, decided in core so it is a
unit and property-tested invariant), and otherwise truncates forward entries and appends
`{ filePath: current.filePath, viewState: arriving }` under the cap. `recordOpen` and H2 are untouched,
so editors stay file-level.
- **Origin.** The renderer's `scrollToHeading` in `preview-panel.tsx` knows whether the heading was
  found and where the body was before and after. On a followed **same-document** heading link — and on
  a `file` link naming the file already shown **with** a fragment, which the chrome already treats as
  the same scroll (`preview-panel.tsx:508-510`) — it sends `throng:preview:navigate` with a new intent
  `{ kind: 'heading' }`, `leavingViewState` and a new `arrivingViewState`. A missing heading raises its
  notice and sends nothing. A same-file link **without** a fragment scrolls to the top and stays out of
  history (FR-103: opening the current file adds no entry).
- **Top of the document.** `captureScrollAnchor` returns `null` at the top (`scroll-anchor.ts:77`), so
  the top of a document had no representation and "Back returns to the top" would do nothing. The
  panel records an explicit `{ line: 0, offsetRatio: 0 }` for a jump, and `restoreScrollAnchor` treats
  line 0 with ratio 0 as `scrollTop = 0`.
- **Main.** `PreviewService` handles `heading` before the link path's "already shown" short-circuit:
  it checks that the target is the run's current file (a stale target answers the current snapshot) and
  calls `NavigationHistoryService.recordJump`, which is a no-op for an editor record (the guard
  `setCurrentViewState` already has, `navigation-history-service.ts:141`). No read, no `emit`; every
  window follows through `throng:history:changed`. The channel stays `throng:preview:navigate`, so the
  rule that no renderer channel records history directly (contracts/navigation-history.md §2) holds.
- **Same-file Back/Forward.** A history step whose target entry names the run's current file becomes
  `moveTo` plus an `emit` carrying the target's `viewState` — no re-read, no `moveRun`, no
  `pathChanged` broadcast (today it runs the full cross-file path, `preview-service.ts:593-645`). The
  service's stale-index check stays path-only (data-model §14.3 says why).
- **Save As across a jump chain.** `rewriteCurrent` (H2a) rewrites the **contiguous run of entries
  naming the current entry's old path** — the jump chain is one document's positions, and it was that
  document that was saved under a new name — keeping each entry's `viewState`, then applies H2a's
  neighbour merge outside that run.
- IPC contract changes to `contracts/preview-ipc.md` §1 were **applied** on 2026-09-15 before T201, from
  `.superpowers/sdd/tasks/iterate-preview-ipc-pending.md` (`preview-ipc.md:137`, `:139`, `:169-175`).
  *(Updated 2026-09-16 by converge; this line still read "pending".)*

**FR-116 — Copy Link Address.** `linkAddress(link, docPath)` in `preview/content-menu.ts`: `external` →
URL; `file` → absolute path, plus `#fragment` when named (unchanged); `heading` → **the preview's own
file's absolute path** + `#fragment`; `outside` → its target as written (not a bare fragment, and not a
path the app resolved outside the project). The call site (`preview-panel.tsx:721`) passes
`stateRef.current.filePath`. The fragment is the one written in the link, as `file` links already copy.

**FR-117 — Show front matter.** A second Markdown-provider setting, `showFrontMatter` (toggle, ships
`true`), declared in `core/src/preview/providers/markdown.ts` beside `loadRemoteImages` — which makes it
`editor.previews.providers.markdown.showFrontMatter`, drawn disabled while Markdown is off, with no
preferences edit (FR-071). The pipeline's `RenderEnvironment` gains `frontMatter: boolean`; when false,
`render()` skips `renderFrontMatter` but **keeps** `bodyLineOffset`, so `data-source-line`, heading
lines (FR-090d), scroll anchors and FR-113's sync stay aligned with the file. The block is never
rendered as Markdown.

**FR-118 — link target readout.** The sanitiser's link hook already builds the tooltip from
`displayTarget(target)` (`sanitise.ts:151-152`); it now also sets **`data-throng-target`** to that same
display string — a hook-set output, added after DOMPurify's checks like `data-throng-link`, so a document
cannot supply it (security-policy Layer 2). `PreviewBodyProps` gains an optional
`onLinkTarget(source: 'hover' | 'focus', display: string | null)`; the Markdown body delegates
`pointerover`/`pointerout` and `focusin`/`focusout` on `[data-throng-link]` (an image inside a link
resolves to the link) and reports the attribute's value, or `null` on leave, per source. The chrome holds
both as panel-local state, shows the hovered target if there is one and otherwise the focused one, clears
both when the file changes, and `preview-status-bar.tsx` renders it as the **one** readout in the currently empty
readouts group (`:47`), with the editor strip's readout class and an ellipsis when narrower than the
text — the element's text is the full target; the control group is measured whole as before, so the
Open in Editor button is never pushed out. The bar is already gated on `editor.showStatusBar`
(`preview-panel.tsx:921-922`), so FR-118's "only while shown" needs no new condition; the tooltip is
unchanged and remains the surface when the bar is hidden. No readout for a binary provider (no bar,
FR-015e).

**FR-119 — the browser ends in front. Cause: hypothesis only.** Nothing in throng's code is known to
re-raise a window after `shell.openExternal` (`external-url.ts:43-52`; triage §7). Two hypotheses, and
the first task is the probe that decides between them (R27):
- **H-a — throng re-activates itself.** A throng window receives `focus` shortly after the open with no
  user input, and something acts on it: `WindowManager` raising the window group on focus
  (`window-manager.ts:34, 42, 84-92`, which is 002 FR-022), the preferences window's always-on-top toggle
  (`preferences-window.ts:332-354`), or the drag ghost (`ghost-window.ts:111`).
  *Candidate remedy*: fix the trigger at the lowest layer that reproduces it, keeping 002 FR-022's
  group raise on a user focus and 007 FR-013a's return to front when Preferences closes.
- **H-b — the Windows foreground lock.** throng owns the foreground; the browser's window is created or
  re-activated by another process that holds no foreground right, so it flashes and throng keeps the
  foreground. *Candidate remedy*: call the existing `IForegroundHandoff.allow()`
  (`core/src/abstractions/foreground-handoff.ts:21`, `AllowSetForegroundWindow(ASFW_ANY)`, already bound
  in the container, `composition-root.ts:110-114`) immediately before `shellIntegration.openExternal`
  in both handlers — a Ctrl+click is exactly the "user's own action" that seam was written to attribute
  (#199). `registerOpenExternalIpc` then takes the handoff as a parameter (Principle IX).
- **Neither** — no production change; FR-119 stays open, reported with the probe's timeline, and a Bug is
  filed through `github-issues` with steps and a frequency.
Both channels — `throng:openExternal` (terminal links, About) and `throng:preview:openExternal` (preview
links) — share the seam, so a remedy in the shared handler also leaves a browser opened from a terminal
link in front. That changes no terminal requirement: 024 FR-019 says a link opens in the default
browser and says nothing about which window is in front (searched: no `foreground` requirement in any
spec beyond 002 FR-022, 007 FR-013a and 012's indicator, none of which this touches).

**FR-120 — image tooltips.** In `sanitise.ts`'s image hook, the **authored** `src` is read before it is
rewritten (`:156`) and is the only source a tooltip is built from — never the live
`throng-preview://asset/…` address. Title = `displayTarget(authored)` (the link title's bidi-stripped,
percent-decoded form), followed by ` — ` and the document's own image title (bidi controls stripped)
when one is given; with no surviving authored `src` (removed by DOMPurify or the `data:` rule) the title
is the document's own title or nothing. An image with a followable-link ancestor gets **no** title — the
image hook checks `closest('[data-throng-link]')` itself, because the I3 descendant strip runs before it
(`sanitise.ts:191-198`) and would not remove a title the hook sets. `showAltText`
(`markdown-body.tsx:110-121`) copies the image's `title` onto the alternative-text span, for blocked and
failed images alike. An image with empty alt text is removed as today, tooltip and all (FR-084). The
export profile already turns an image into its alt text, so no tooltip reaches the clipboard.

### Test layers (Principle V)

| Requirement | Lowest layer that proves it | Notes |
|---|---|---|
| Request 2 | **unit** (the cascade: `markdown.css` re-enables selection over `theme.css`'s `none`) + **E2E** `@reserve:input` (a real mouse drag selects; a Ctrl+drag over a link selects and follows nothing) | The E2E is the reproduction of the reported behaviour, written and observed failing **before** the fix — see R29 |
| FR-113 | **unit** (store; top-line helper over a fake view) + **component** (panel subscribes to its parent, body restores to the published line, off/standalone/binary ignore it, a live update keeps the synced place, sync records no history) | No E2E — R23 |
| FR-114 | **unit** (default, parse, descriptor, clone, inertness key) + **component** (settings tab row) | |
| FR-115 | **unit** (`recordJump`, dedupe, cap, jump-chain Save As, parse keeps same-file runs, SC-007 property test gains a jump op) + **integration** (`NavigationHistoryService.recordJump` preview-only; `PreviewService` heading intent and same-file step) + **component** (follow → heading intent; Back steps through jumps, then to the previous document) | No E2E — R24 |
| FR-116 | **component** (`linkAddress` forms; the mounted menu writes `<file>#heading`) | |
| FR-117 | **unit** (pipeline with `frontMatter: false`) + **component** (the body honours the setting and re-renders on change) + settings rows as FR-114 | |
| FR-118 | **component** (sanitiser sets `data-throng-target`, a document cannot; status bar renders the readout; panel hover/leave/focus/blur, image in a link, bar hidden) | |
| FR-119 | **probe** first (R27), then **unit** at the remedy's seam (handler order, or the re-raise trigger) + **manual** (quickstart §8) | Which window the OS leaves in front cannot be asserted on a hosted runner |
| FR-120 | **component** (title forms, never `throng-preview:`, remote, blocked span, failed-load span, none inside a link, bidi stripped) | |

**E2E budget: raised in flight, put back before merge — settled 2026-09-16 (T218/T181, commit
`96975d66`).** The demotion below was performed after all: `editor-indicators.e2e.ts`'s *"auto-save
writes edits within the debounce without Ctrl+S"* (`@extended @editor`, no reserve tag) is gone, its
firing half moved to `editor-update-listener.test.ts` — which owned the arming and asserted nothing
about the armed timer, so a callback that saved nothing had been green at every layer — and its disk
half already covered, with more, by `editor-service-save.integration.test.ts`. Both halves were
observed red against two deliberate breaks. `e2e-budget.json` reads **569 / `@editor` 117** again and
`reserve-tag-debt.json` **115**. The account of the deviation is kept below, because the way it hid is
worth keeping.

The plan was that one new declaration
(Request 2, `@extended @editor @reserve:input`, in `preview-scroll.e2e.ts`, already `serial`/`FOCUS` in
`parallel-plan.json`) would be paid for by demoting one existing `@extended @editor` declaration that
carries no reserve tag and whose assertion a lower layer holds — chosen by audit at task time (T181),
its lower test observed failing against a broken implementation first, exactly as T163a–T163e did.
`e2e-budget.json` would then read 569 / `@editor` 117 / `core` 39 before and after, with
`reserve-tag-debt.json` falling 116 → 115.

**That is not what shipped.** T181 was skipped by a controller ruling for a lean finish, and
`e2e-budget.json` was re-seeded **upward** instead: total **570**, `@editor` **118** (`@window` 197 and
`core` 39 unchanged), `reserve-tag-debt.json` unchanged at 116. `docs/testing.md` *Iteration 2026-09-15*
and the budget file's own `measuredFrom` note both record this honestly; this plan did not, until now.
Because the guard asserts equality in **both** directions, a re-seeded budget passes — the rise is
invisible to the build, which is why it survived to converge.

**This is an open deviation from Principle V, not a recorded one.** The principle says the budget
*"may fall and MUST NOT rise"*, and this plan's own Principle V row argues that *"a recorded practice
does not satisfy a NON-NEGOTIABLE MUST"* — the reasoning that replaced an earlier 569 → 574 raise with
the T163a–T163e offset. The same reasoning applies here, so the ruling reversed the plan's own
constitutional argument. It is carried as a convergence task (Phase 14) and needs one of two outcomes:
the demotion T181 described is performed and the budget returns to 569 / `@editor` 117, or the
maintainer rules the raise acceptable and the constitution's text is amended to permit a per-test
justified raise. *(Recorded 2026-09-16 by converge; not an authorisation.)* **Outcome: the first —
the demotion was performed the same day; see the note at the top of this section.**

### Constitution Check — deltas for this iteration

Constitution v5.4.1, as cited above. Every principle re-read against the design; the verdict above
stands, with the Principle V row corrected below.

**Re-cited 2026-09-16 (converge) against Constitution v5.5.0** (amendment `a3eab7e1`; the citation above
was made against v5.4.1, before the branch was rebased onto it at branch-sync on 2026-09-16).
v5.5.0 is a MINOR bump adding two rules to Principle VI; the verdicts above stand and no design change
follows. ***One gesture follows a link, everywhere*** — the preview conforms in full: Ctrl+click follows
and a plain click does not, a Ctrl+drag selects rather than activates (FR-094), hover names the target
and the gesture (FR-094, FR-118), and the body menu over a link offers Open Link and Copy Link Address
(FR-095, FR-116), with the inert-link and active-selection carve-outs following the terminal menu the
amendment itself verified as conforming (024 FR-019d). FR-096c's `preview.followLink` — a rebindable
command in the `preview` scope shipping on Ctrl+Enter, which takes the key only when a link holds focus
and leaves it to the shell everywhere else — is the **first** implementation of that rule's Ctrl+Enter
clause anywhere in throng, so on merge it closes the second of the two known gaps the rule records; the
first (the About window's plain-click links) is outside this feature. ***A preference picks the default;
the menu offers every variant*** — FR-035a–c are the rule's own worked example and conform as written:
**Copy** is labelled for the action and performs `editor.previews.copyFormat`, the same choice the Ctrl+C
gesture makes, while **Copy as Rich Text** and **Copy as Plain Text** name each variant and ignore the
setting — three distinct commands, so no second row for one command (006 FR-030). One delta is recorded
rather than left silent, on a platform this feature does not ship for: the body follows on `ctrlKey`
alone (`markdown-body.tsx:343`) where the terminal already accepts `metaKey` too, so the rule's
"Cmd+click on macOS" clause needs that one condition added whenever a macOS build is taken up. No
shipped configuration can reach it today.

| Principle / gate | Delta |
|---|---|
| I | No change. The readout and image tooltip show a URL, a project path as written, or nothing; the scroll store never leaves its window. |
| II | **Engaged by FR-119.** H-b's remedy goes through the existing core abstraction `IForegroundHandoff`; no OS call enters `ui/src/main` or core. H-a's remedy is window-management code already in `ui/src/main`. Satisfied either way. |
| III, IV | Not engaged. No chord added; the shared open-external handler is not PTY lifecycle. |
| V | **Engaged.** Test-first per row above; the defect's reproduction precedes its fix (R29); FR-119 starts from an instrumented probe, and its cause stays a hypothesis until the probe reports. **The E2E budget was NOT held flat**: T181's demotion was skipped by ruling and the budget was re-seeded 569 → 570 (`@editor` 117 → 118), which Principle V's ratchet forbids — see *E2E budget* above and the Phase 14 convergence task. *(Corrected 2026-09-16 by converge; the row previously read "the E2E budget is held flat by one demotion".)* Tests superseded by FR-115/FR-116 are rewritten to the new rule, not deleted: `preview-follow.test.ts:93-117`, `preview-link-menu.test.ts:80`. |
| VI | **Engaged lightly.** No new panel action, so no new menu item: the two settings are preferences, the readout is not a control, and Copy Link Address changes what it copies, not where it sits. No new icon control. *Disabled when unavailable*: Show front matter is drawn disabled with its provider through the existing `enabledWhen`; Synchronise scrolling is not provider-scoped and has none. *One condition, one notice*: FR-115 adds no notice (a missing heading keeps its one). |
| VII | Not engaged. |
| VIII | Satisfied. No new abstraction beyond a per-window store on an existing pattern; `recordJump` extends the reducer rather than adding a second history; `displayTarget` is reused for the readout and the image tooltip rather than re-derived; the FR-119 remedy reuses the #199 seam. A cross-window scroll relay is rejected as speculative (R23). |
| IX | Satisfied. No new service. H-b passes `IForegroundHandoff` to `registerOpenExternalIpc` as a parameter from the container, as `terminal-ipc.ts` receives it. |
| X | Satisfied. Both behaviours are settings with descriptors. The rAF throttle is a frame boundary, not a tunable. |
| XI | Satisfied. The scroll store holds **view** state keyed by panel id — the `caret-store.ts` rationale — and holds no document content. Jump entries live in the one main history authority. |
| Configuration-editor completeness | Two new descriptors (one static, one generated per provider); `settings-metadata.test.ts` REQUIRED list, `settings-inertness-044.test.ts` and `settings-tab-previews.test.ts` extended. |
| Documentation currency | `README.md`, `docs/quick-start.md`, `docs/testing.md`, `CHANGELOG.md`, `CONTRIBUTING.md` (two optional body props) in the same change — T211–T215. |
| Digit grouping | Not engaged. |
| Incremental delivery | Not engaged: nothing constitutional is deferred. FR-113's same-window reading is a scope statement in the spec, not a deferral. |

### Complexity Tracking — this iteration

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **One new E2E declaration, NOT paid for — the budget rose 569 → 570** (Principle V, *"may fall and MUST NOT rise"*) — **an open deviation**, recorded 2026-09-16 by converge; the row previously read "paid for by one moved down … not a deviation" | The declaration itself is justified below, and that justification stands. What does **not** stand is the payment: T181 was skipped by a controller ruling for a lean finish, so no declaration came down and `e2e-budget.json` was re-seeded upward. The build cannot see it — the guard asserts equality both ways, so a re-seeded budget is green. Carried as a Phase 14 convergence task; it resolves either by performing T181's demotion or by the maintainer amending Principle V. | *Leave it unrecorded*: the plan would assert compliance the repository contradicts, which is the failure converge exists to catch. *Treat the ruling as authorisation*: a controller ruling cannot relax a NON-NEGOTIABLE principle, and this plan's own Principle V row already rejected that reasoning once when it replaced a 569 → 574 raise with the T163a–T163e offset. |
| **One new E2E declaration, its layer justified** (Principle V) — not a deviation; recorded because it spends scope | The defect is "a mouse drag does not select". The substitute layers cannot hold it: jsdom applies no stylesheet and its Range API ignores `user-select`, and a static CSS read proves the declaration exists, not that the cascade Chromium computes lets a drag start a selection. A real pointer drag in the real engine is the `@reserve:input` claim. | *Unit CSS test alone*: pins the hypothesised cause, and would stay green if the cause were a different rule or a handler; the report is about behaviour. *Raise the budget*: Principle V's MUST NOT. |
| **FR-119's remedy is chosen by a probe, not by this plan** | The cause is unproven (R27). Committing to `AllowSetForegroundWindow` would fix nothing if throng is re-raising itself, and a re-raise guard would fix nothing under the foreground lock. | *Pick H-b now because the seam exists*: asserts a root cause with no reproducing evidence, which the project's rules forbid. |

### Sequencing — this iteration

1. **After Phase 12 (T177–T180) and adversarial fix batches C and D**, which edit the same renderer
   files (`markdown-body.tsx`, `pipeline.ts`, `preview-panel.tsx`). Phase 13 does not start on a
   renderer file another batch holds.
2. **The defect first** (T181–T185): the demotion before the new declaration, so `e2e-budget.json`
   never reads above 569.
3. **One RED wave** for FR-113–FR-118 and FR-120 (T186–T196), then settings, reducer and scroll store in
   parallel, then main, then the renderer changes **one at a time** — they share `preview-panel.tsx`,
   `markdown-body.tsx`, `provider-view.ts` and `sanitise.ts`.
4. **FR-119 probe** (T208) may run at any point after step 2 — it edits only temporary diagnostics — but
   its RED and fix (T209–T210) wait for it.
5. **Docs** with the behaviour (T211–T215); **verification** (T216–T217); then the still-open **T176**
   hosted gate, last of all.

---

## Iteration 2026-09-16 (FR-121, FR-122, and T222)

*Added 2026-09-16 by `speckit-iterate` (round 2), after the maintainer's second hands-on test. Additive
only: nothing above is rewritten; where a decision above is refined, the row below says so. Inputs:
spec.md Clarifications **Session 2026-09-16**, FR-121 (a–h), FR-122 (a–f), and the markers they left on
FR-015a, FR-107, FR-113, FR-114 and US1 scenarios 8–16; Phase 14's **T222** (now ruled by FR-121e).
Research: [research.md](./research.md) R30–R33. Model: [data-model.md](./data-model.md) §15. Contracts:
`settings-bindings-tokens.md` (*Iteration 2026-09-16*), `menus-and-controls.md` §§1–4, 7, 8 and §10,
`preview-ipc.md` §2 (`update.viewState`). Quickstart §9. Tasks: Phase 15, T226–T253.*

### Scope

| # | Request | Shape | Requirements |
|---|---|---|---|
| 1 | Scroll sync is **two-way**, in every situation | gap; partly supersedes FR-113, supersedes FR-121d | FR-121, FR-121a–c, FR-121f–h |
| 2 | Back/Forward onto a top-of-document entry lands on the editor's line (T222) | ruling; refines FR-107 | FR-121e |
| 3 | Toggle the one global setting from both body menus, both header menus, both status bars and a command | gap; refines FR-114, partly supersedes FR-015a | FR-122, FR-122a–f |

Touches `packages/core` and `packages/ui` only. `daemon`, `persistence`, `ipc-contract` and
`platform-windows` stay untouched. **No new IPC channel**: the scroll relay stays inside one renderer
window (FR-121a), so `contracts/preview-ipc.md` changes in one respect only — `update.viewState` may now
be `null` (decision 4 below). No SQLite migration, no `LAYOUT_SCHEMA_VERSION` change. **One new icon
token** (`syncScroll`), so `EXPECTED_ICON_TOKEN_COUNT` 69 → 70 and **`SHIPPED_DEFAULTS_VERSION` 8 → 9**
(R33). One new key binding (`preview.toggleSyncScroll`, shipped unbound). No new settings leaf — the
existing `editor.previews.syncScroll` gains surfaces and a new description.

### Decisions the spec author flagged

**1 — The shipped description (FR-122f).** `preview-settings.ts:172` says *"Scrolling the preview never
moves the editor"*, which FR-121 makes false. It becomes:
*"Keep a preview and its editor at the same place in the file, in both directions: scrolling either one
scrolls the other. Also switched by Synchronise Scrolling in the editor's and the preview's menus, and by
the button beside the preview button on their status bars."* The label stays *Synchronise preview and
editor scrolling* (renaming a label moves nothing but the key binder's search, and no requirement asks).
`preview-settings.test.ts` pins the two facts FR-122f names — "both directions" and the two surfaces — as
substrings, not the whole sentence.
> *Converge 2026-09-16 (round 2): the shipped sentence ends "…and by the **Synchronise Scrolling button**
> on their status bars" rather than "the button beside the preview button" — changed at analysis (T1) so
> the description names the control rather than its position, and pinned by `preview-settings.test.ts`
> asserting the old phrase is gone. `contracts/settings-bindings-tokens.md` carries the same note.*

**2 — Sub-workspace windows become settings writers (FR-122e); how their failure is reported.** Searched:
spec 032, US3 scenario 2's parenthetical, says *"`subworkspace-app.tsx` issues no configuration write of
any kind … Exactly **two** windows write settings"*, and therefore mounts no failure subscriber there
(`useConfigWriteFailureNotices` is mounted only in `app.tsx:706` and `preferences-app.tsx:61`). FR-122e
makes that premise false: a sub-workspace window can hold an editor or a preview, and its toggle writes.
**Decision: the sub-workspace window mounts the same subscriber** (`subworkspace-app.tsx`), which it can
— `SubWorkspaceRoot` already provides a `NotificationProvider` (`composition-root.tsx:166`).
- **One condition, one notice.** `onConfigWriteFailed` is module state in `write-config.ts`, so each
  renderer realm hears only the writes **it** issued; a failed toggle in a sub-workspace window raises
  exactly one notice, in that window — the one the user is looking at — and no other window reports it.
  The notice reuses `prefs-notice`, so a second failed click replaces rather than stacks (the subscriber's
  own design).
- **Rejected: routing the write through the main window.** The notice would appear in a window that may
  be behind the one the user clicked in, which is "say what is wrong" in the wrong place; and it adds a
  cross-window request for a write `writeConfigPatch` already makes safely from any realm (032 FR-001,
  FR-002a serialise in main).
- **No optimistic state.** Every surface renders `settings.editor.previews.syncScroll` from the config
  store, which changes only on a successful patch (`onConfigPatched`) or a watcher broadcast. A failed
  write therefore leaves every surface on the stored value with nothing to roll back (FR-122e).
- This **supersedes 032 US3 scenario 2's parenthetical** for sub-workspace windows, stated in the 044
  spec as a planning note under FR-122e (the 032 artifact is not edited — the note names it). The 032
  requirement it served — a write failure is reported to the user — is kept, and widened to the new
  writer.

**3 — Revert All Preferences (032 FR-001a) undoes a toggle made outside Preferences after Preferences
opened.** **Decision: accepted, and pinned.** `planRevertAll` reverts every leaf that carries a
descriptor to its value when the Preferences window opened; `editor.previews.syncScroll` has one, so a
toggle from a menu or status bar after Preferences opened is reverted with the rest. Reasons:
- 032 FR-001a's exclusion is about **non-preference** state (`newProject.lastProjectFolder`) that the
  user never sees in Preferences. This key is a preference, and FR-122e requires the open Preferences
  window to show the toggle's new value — so the change is on screen, in the editor Revert All reverts,
  when the user confirms *"Revert every editor to its state when this window opened?"*.
- Excluding it would need a second key list beside `SETTINGS_METADATA` — a descriptor-carrying leaf that
  Revert All skips — which is exactly the "someone must remember this call site" shape FR-001a's
  metadata-driven design exists to remove.
- Recorded as a planning note under FR-122e *(derived; not confirmed)*, and pinned by a unit case in
  `revert-plan.test.ts` (T228) so a later exclusion is a visible decision, not a drift.

**4 — FR-121e's top-of-document case works by accident; make it a rule.** Today a cross-file Back onto
a top entry reaches the editor's line only because the entry carries **no** `viewState`
(`scroll-anchor.ts:77`) and the draw's fall-through (`markdown-body.tsx:292`) applies the editor's line —
and a **link** followed to another file looks identical (no `viewState`, `navigationSeq` bumped), so the
body cannot tell "a step onto a placeless entry" (FR-121e: the editor's line) from "a link followed"
(FR-121f: the preview's start position drives the editor). The **same-file** route (FR-115) sends an
explicit `{ line: 0, offsetRatio: 0 }` and restores the top through the place-alone effect
(`markdown-body.tsx:231-239`) — contrary to FR-121e. **Decision:**
- **Wire.** On a `history` navigate, main sends the target entry's place **or `null`** — never omits it
  (`preview-service.ts`, both the same-file and the cross-file branch of `navigateHistory`). `null` means
  "a history step onto an entry with no saved place". Absent still means "no place to restore" (a link, a
  live update); attach is unchanged. `viewState` is `unknown` on the wire already, so no type changes;
  `contracts/preview-ipc.md` §2 records the refined meaning. The store already passes a present `null`
  (`preview-store.ts:79`, `update.viewState !== undefined`).
- **Rule.** One pure function, `placeOnStep` (data-model §15.3), consulted **only** for an update that
  carries a history place (the key is present) — never for a followed link or a live update, which carry
  none (analyze C2). A **cross-file** history place that is **top of document** — `null`, or `{ line: 0,
  offsetRatio: 0 }`, which `restoreScrollAnchor` already treats as the top — on a **synced, parented**
  preview **whose editor's line is known in this window** yields to the editor's line, applied as a sync
  scroll (so it drives nothing, FR-121c/g). Every other place is restored and then drives the editor
  (FR-121f). Sync off, standalone, or no editor view in this window: the top, as FR-107 says.
- **Same-file steps — a conflict found by analysis (C1), proposed reading pending the maintainer's
  ruling.** FR-121e says its rule "holds whether the step stays in the same file", but under FR-121f the
  editor follows every jump, so at a same-file Back the editor's line *is* the jump's place: applying
  FR-121e there makes Back after a contents link a visible no-op, which contradicts FR-115 ("Back returns
  to where the reader was") and US7 scenario 7. The user's ruling was asked about the **cross-file** case
  (T222's steps), where the pair had come apart. **Proposed**: a same-file step restores its place,
  including the top, and the editor follows (FR-115 with FR-121f). Recorded as a planning note under
  FR-121e; T232(b) and T242 are written to it, and flip if the ruling keeps the same-file clause.
  *Converge 2026-09-16 (round 2): the controller ruled on 2026-09-16 that this reading stands (spec.md
  FR-121e, "Ruled 2026-09-16"), and `placeOnStep` ships with the `crossFile` condition. The maintainer's
  own confirmation is still outstanding; quickstart §9 step 4 (T253) asks it.*
- **Tests.** At the component layer (T232): cross-file Back with `viewState: null` lands on the editor's
  line and requests no editor scroll; same-file Back onto `{ line: 0, offsetRatio: 0 }` lands at the top
  and requests the editor at the top (proposed reading); with sync off both land at the top; a non-top
  place still restores and then drives the editor; a followed link (no `viewState`) never takes the
  editor's line. The wire half is integration (T233). This closes **T222**.

**5 — Echo and oscillation (FR-121g).** The mapping is block-granular in both directions
(`data-source-line`), so a naive relay oscillates: the editor at line 105 inside a code block starting at
100 puts block 100 at the preview's top; relayed back, the preview's top block would pull the editor to
100. Three guards, each a stated rule rather than a timing accident (R31):
- **Cause marking, per side.** A scroll a side makes *to follow the other* is marked, and a marked scroll
  is never relayed. The editor marks its publishes `fromSync` while a sync request it applied is
  settling (`editor-scroll-relay.ts`); the preview marks its own sync-applied scroll the same way in the
  body. The mark lapses on the first publish after the request settles, **and at the latest one frame
  after the request produced no scroll at all** — so a request that moves nothing (already there, or the
  end of the document) can never leave the guard stuck and swallow the reader's next scroll.
- **Same block is already there.** The preview follows the editor only when the block the editor's line
  falls in (`blockLineFor(line)`) differs from the preview's current top block; the preview drives the
  editor only when its top block differs from the block the editor's current line falls in. That is
  FR-121g's "a side already showing the target does nothing" at block granularity, and it is what keeps a
  reader scrolling *within* one tall block from yanking the editor, and an editor moving *within* one
  block from snapping the preview.
- **Short of target is not a disagreement.** A side that could not reach the target (FR-121b) publishes
  its clamped place marked `fromSync`, so the other side is never pulled back.
  *Converge 2026-09-16 (round 2) — two review fixes made this rule hold in the states jsdom never
  produced (a scroll host that clamps). **Editor side** (`b3bfb70b`, data-model §15.1 R-E5): a request
  that moved nothing at all — no `scroll` event, `scrollTop` unmoved — is now **answered** with the view's
  line marked `fromSync`, instead of lapsing silently; without it, an adoption (FR-121h) whose editor
  could not move never settled and the pair stayed unsynchronised. **Preview side** (`fe0fff59`,
  data-model §15.2): after a live update the body reports only when the kept block was renumbered or a
  report was deferred; otherwise the restore and its clamp are the body's own scroll, so a preview at
  its end no longer pulls the editor up on every keystroke.*

Where each lives: the pure decisions (`topBlockLine`, `blockLineFor`, `placeOnStep`, `pairStart`,
`shouldFollow`, `shouldDrive`) in `renderer/preview/scroll-sync-policy.ts` and
`providers/markdown/scroll-anchor.ts` — unit-tested; the wiring in the body and chrome — component; the
engine's real scroll-event timing — one E2E (below).

**6 — The editor side: every scroll drives the preview (FR-121f).** Verified by code reading: the shipped
publisher is `use-editor.ts`'s `scrollDOM` `scroll` listener (`:1277-1285`), and caret moves
(`scrollIntoView` on a selection), find/replace moving to a match, Go to Line, a history step's restored
scroll, the #144/US8 restores, a Find in Files reveal and typing that scrolls all end in a `scrollTop`
write on `scrollDOM`, which fires `scroll`. So the existing path **already covers** them. One gap remains:
a change to **which line is at the top without a scroll** — lines inserted or deleted above the viewport
where CodeMirror's height map shifts without moving `scrollTop`, or a wrap/zoom reflow at `scrollTop` 0.
**Decision:** the publisher also runs from an `EditorView.updateListener` on `docChanged ||
geometryChanged` (the same rAF coalescing; the store already de-duplicates an unchanged line), so the
published line is always the line on screen. The listener and publisher move out of `use-editor.ts` into
a framework-free `editor/editor-scroll-relay.ts` over a view-shaped interface, so both paths — and the
request side — are unit-tested with a fake view (T229). The real-engine claim that Go to Line and a caret
move reach the preview is the new E2E's.

**7 — Menu items, status-bar buttons, command (Principle VI; `contracts/menus-and-controls.md`).**
- **One command body.** `renderer/preview/sync-scroll-toggle.ts` exports `toggleSyncScroll()`: read the
  window's current value, `writeConfigPatch({ kind: 'settings' }, [{ path: ['editor', 'previews',
  'syncScroll'], value: !current }])`. Every surface calls it; nothing else writes the key outside
  Preferences. A stale read racing another window's toggle is last-write-wins (032 FR-003), acceptable
  for a boolean the user can see on every surface.
  *Converge 2026-09-16 (round 2): shipped as **`toggleSyncScroll(current: boolean)`**. The config store is
  React context only, so the module has no "window's current value" to read; every surface already holds
  `settings.editor.previews.syncScroll` (the editor body menu reads it at menu-open time) and passes it.
  Still one body and one one-key patch; the rejected alternative was a module-level settings snapshot in
  `config-store.tsx`. Recorded for the PR (review M4): with no optimistic state, a quick double-click on a
  status-bar toggle can issue two writes of the same value, leaving the setting flipped once.*
- **Menus.** A checkable **Synchronise Scrolling** item, `section: 'viewState'`, label `Synchronise
  Scrolling ✓` while on (the Word Wrap idiom, `editor/content-menu.ts:195`; test id pinned to the bare
  label), shortcut `firstBinding(keybindings, 'preview.toggleSyncScroll')`, icon `syncScroll`, never
  disabled (FR-122a). Editor body: after *Word Wrap*. Preview body: a new View & state section after
  Navigate. Editor and preview **header**: after *Zoom ▸*, before the failure-banner items (FR-122b) —
  which is the emission order `panel-header-menu.ts:366-480` already produces if the item is pushed
  between the Zoom block and `failureItems`. `PanelHeaderMenuArgs` gains `syncScroll?: { on: boolean } |
  null` and `PanelHeaderMenuActions` gains `toggleSyncScroll`.
- **Presence (FR-122a).** Editor: where the preview affordance is not `absent` (the same
  `previewAffordance` that draws the preview button — so a disabled provider still shows an **enabled**
  toggle). Preview: provider kind `text`. Binary preview: none (it has no status bar either, FR-015e).
- **Status bars (FR-122c).** An `IconButton`, token `syncScroll`, `aria-pressed` = the setting, `title`
  *Synchronise Scrolling* plus ` (<chord>)` when bound, test id `…-sync-scroll-<panelId>`. Editor strip:
  inside the measured controls group, immediately before `PreviewButton` (`status-strip.tsx:565`), so
  040 FR-024's never-hidden rule holds with no change to `status-strip-fit.ts`. Preview bar: immediately
  before the Open in Editor / Go to Editor button, same group.
- **Command (FR-122d).** `preview.toggleSyncScroll`: `ActionId`, `COMMAND_SCOPES` = the existing
  `HISTORY_PANELS` (`editor`, `preview` — nothing else, so no terminal loses a key, Principle IV),
  `WINDOWS_BINDINGS` `[]`, `KEYBINDINGS_METADATA` *Synchronise Scrolling* in group **Editor** (beside
  *Toggle word wrap*). Resolved in `preview-commands.tsx`'s existing window `keydown` handler, beside
  `preview.open`: it acts, and takes the key, only when the active panel shows a toggle (FR-122a); on an
  editor with no provider it does nothing and leaves the key alone. Not installed in CodeMirror's keymap
  (`preview.open` is not either), so a chord bound to it reaches the window handler.
- **Cross-window (FR-122).** Every surface reads the config store, which every window refreshes on write
  (032 FR-004, 100 ms), so the Preferences window, every other window and every other panel follow with
  no new wiring. **Turning sync on** aligns each pair by the editor's line — the shipped FR-113 behaviour —
  whichever surface was used *(derived: choosing by the surface would make where the user clicked decide
  which side moves; recorded, not confirmed)*.

### Design per requirement

**FR-121 / FR-121a — the relay, same window only.** `editor-scroll-store.ts` gains the request direction:
`registerEditorScroller(panelId, scroller)` (the editor view registers when its own initial placement —
#144 view state, US8 document scroll — has run; a request made earlier is held and applied then) and
`requestEditorTopLine(panelId, line): boolean` (`false` when this window has no mounted view of that
editor, which is FR-121a's "drives nothing"). The store's value becomes `{ line, fromSync }` per panel;
`useEditorTopLine` keeps returning a stable snapshot (the object is replaced only when a field changes).
The chrome (`preview-panel.tsx`) relays to `state.parent.panelId` only while syncing
(`syncScroll && providerKind === 'text' && parent != null`, unchanged) — so a standalone preview, a binary
one, and a preview that followed a link to a file with no editor (`parent: null`, FR-090a) drive nothing,
and a preview re-parented to another file's editor drives only that one.
*Converge 2026-09-16 (round 2): the scroller is registered when the relay **attaches**, not after the
initial placement; a request made before placement is held and applied by `ready()` (R-E4), which is what
"held and applied then" above requires. data-model §15.1 carries the as-shipped shapes, including the
document line-count the store also publishes for analysis U2.*

**FR-121b — how the editor moves.** The editor's scroller dispatches `EditorView.scrollIntoView(
doc.line(line + 1).from, { y: 'start' })` as an **effect with no selection** — the caret, selection and
focus do not change, the document is not touched (so not dirty), and no history entry is recorded
(scrolling within a file is not a load, R14). A line past the end is clamped to the last line; the
editor goes as far as it can.

**FR-121f — the preview side: every scroll.** The body (`markdown-body.tsx`) adds one `scroll` listener
on its scroller, rAF-coalesced like the editor's, reporting the top block's `data-source-line` through a
new optional prop `onTopLineChange(line)` — for every scroll it did not make to follow `syncLine`, and
only when FR-121g's same-block check passes. Wheel, scrollbar, keyboard (FR-096a), `scrollToHeading`
(FR-090b/f), a live update's anchor restore (FR-024), a history restore (FR-107, FR-115) and a
navigation's start position all end in a `scrollTop` write on that scroller, so one listener covers the
list the requirement gives. The shipped rule "only a CHANGED `syncLine` scrolls" (T189 case 6) stays for
the editor → preview direction; what changes is that the reader's own later scroll now also moves the
editor, so the pair no longer drifts apart.

**FR-121h — where a pair starts.** A pure `pairStart` (data-model §15.3), fed by what the chrome already
receives:
- **Opening / restoring beside an editor** — the view's first update is already parented: the editor's
  line decides. Until the body has applied the editor's line once (or found no editor view in this
  window), a place from `attach` — on the first draw or through the place-alone effect — is **not**
  restored over it, and the body's scrolls are not relayed. Once paired, both directions apply. The
  chrome tags a place with its source (`attach` vs a pushed/answered update) in `preview-store.ts` — a
  renderer-side field, not a wire field.
- **Adopting an editor** — `parent` goes from `null` to an editor **with `navigationSeq` unchanged**
  while the body is drawn (Open in Editor, FR-013a/FR-015c; or the file opened in an editor by any other
  route): the preview decides. The chrome requests the new editor's top line at the preview's top block
  and does not follow that editor's publishes until the request has settled (the request is held until
  the new view's initial placement has run, above, so a restore cannot overwrite it afterwards).
- **Following a link / Back / Forward** — `parent` changes **with** `navigationSeq` moving: not an
  opening. The preview's start position drives the editor (FR-121f), except FR-121e's top case.
- **An editor view appearing** for an existing parent (its tab brought to front, a window gaining a view)
  is the editor publishing: the preview follows, as shipped for FR-113 *(derived; FR-121h names only
  opening, restoring and adopting)*.

**FR-121e (T222).** Decision 4 above.

**FR-122.** Decision 7 above; FR-122e's persistence and failure half is decisions 2 and 3; FR-122f is
decision 1.

### Test layers (Principle V)

| Requirement | Lowest layer that proves it | Notes |
|---|---|---|
| FR-121, FR-121a | **component** (`preview-scroll-sync.test.ts`, rewritten: a hand scroll requests the parent's line; off / standalone / binary / no editor view in this window / a link to a file with no editor request nothing; re-parented requests only the new editor) + **unit** (store request/register/held-until-ready) | Cases (7)–(10) of that file asserted FR-113's one-way rule; they are **rewritten to FR-121**, each keeping its old title in a comment naming the supersession — not deleted |
| FR-121b | **unit** (`editor-scroll-relay.test.ts` over a fake view: the dispatched spec carries a scroll effect and no selection, no `changes`; `focus` not called; a line past the end clamps) | |
| FR-121c, FR-121g | **unit** (the echo mark sets and lapses, including the no-scroll lapse; `shouldFollow` / `shouldDrive` same-block rules; `blockLineFor`) + **component** (a `fromSync` publish is not re-applied; a sync-applied preview scroll requests nothing; an editor line inside the preview's top block moves nothing; end of document: a clamped `fromSync` publish does not pull the preview back) + **E2E** (below) | jsdom fires no `scroll` for a programmatic `scrollTop` write and lays nothing out, so whether the marks line up with the engine's real event order is the E2E's claim |
| FR-121e | **unit** (`placeOnStep`) + **component** (`preview-scroll-pairing.test.ts`, both routes) + **integration** (`viewState: null` on the wire) | Closes T222 |
| FR-121f (editor side) | **unit** (any `scroll`, and an update with `docChanged`/`geometryChanged`, publishes once per frame) + **E2E** (Go to Line and a caret move reach the preview) | CodeMirror does not lay out in jsdom |
| FR-121f (preview side) | **component** (heading jump, same-file and cross-file Back with a place, a live update whose top block changed, a link to a parented file's start — each requests the editor's line once) | |
| FR-121h | **unit** (`pairStart`) + **component** (opening with a saved place and a known editor line; a late attach place; adoption null → editor with the same `navigationSeq`; turning the setting on) | |
| FR-122a–c | **unit** (`menu-sections.test.ts` shapes and `panelActions`; `menu-icon-tokens.test.ts`) + **component** (`editor-content-menu.test.ts`, `panel-header-zoom-menu.test.ts`-style header cases, `preview-link-menu.test.ts` body menu, `status-strip-preview-button.test.ts`, `preview-status-bar.test.ts`, `status-strip-fit-wiring.test.ts`) | |
| FR-122d | **unit** (`keybindings-preview.test.ts`, `keybindings-metadata.test.ts`, `keybindings-collision.test.ts`) + **component** (the window handler: acts in an editor with a toggle and in a preview; leaves the key alone elsewhere) | |
| FR-122e | **component** (a click writes exactly that key and nothing else; a failed write leaves every surface unpressed/unchanged; a sub-workspace window reports its own failure once) + **unit** (Revert All includes the key — decision 3) | "An open Preferences window shows the new value" is 032 FR-004's existing guarantee for any settings write, already tested there; no new test |
| FR-122f | **unit** (`preview-settings.test.ts` description substrings) | |
| Icon token, defaults version | **unit** (`default-themes.test.ts` count 70, `theme-metadata.test.ts`, a new `shipped-defaults-upgrade` case: a v8 install gains `icons.syncScroll`) | |

**E2E: one new declaration, paid for by one moved down — the budget does not rise.** The new
declaration (in `preview-scroll.e2e.ts`, `@extended @editor @reserve:layout`, already `serial`/`FOCUS` in
`parallel-plan.json`) asserts, in a real engine with a real CodeMirror: the wheel on the preview moves the
editor's top visible line to the heading's source line with the caret unchanged; Go to Line in the editor
moves the preview; and after each, both scroll positions are unchanged across several consecutive frames
— no oscillation. **Why no cheaper layer holds it**: jsdom lays nothing out and fires no `scroll` event
for a programmatic `scrollTop` write, so every component case dispatches the events the test chose, in
the order it chose; whether the echo marks match the order Chromium and CodeMirror's measure cycle really
produce is exactly what an oscillation defect would be, and it is invisible below this layer. It is paid
for **first** (T226) by demoting one `@extended @editor` declaration with no `@reserve:*` tag whose
assertion a lower layer holds, observed red at that layer against a deliberate break, exactly as
T163a–T163e and T218 did — so `e2e-budget.json` reads **569 / `@editor` 117 / `core` 39** before and after
and `reserve-tag-debt.json` falls **115 → 114**. **If the audit finds no such declaration, T226 stops and
reports, T237 is not written, and the real-engine claim falls to the hands-on check (quickstart §9)** —
the budget is not raised.

### Constitution Check — deltas for this iteration (against v5.5.0)

Re-read against Constitution **v5.5.0** (the text the converge re-citation above already used). The
verdicts above stand.

| Principle / gate | Delta |
|---|---|
| I | Not engaged beyond the above: the relay never leaves its window, and the toggle writes a settings key, not project state. |
| II | Not engaged. No OS call; the relay is renderer code over CodeMirror and the DOM. |
| III | Not engaged. |
| IV | **Engaged lightly, cleared.** `preview.toggleSyncScroll` ships unbound and is scoped to `editor` and `preview` only; no reserved or shadowable key is touched and no terminal scope gains a command (`terminal-reserved-keys.test.ts` unchanged). |
| V | **Engaged.** Test-first per the table above; one RED wave before any implementation. **The E2E budget is held flat** by T226's demotion, with a stop clause instead of a raise. Four component cases asserting FR-113's one-way rule are **rewritten** to FR-121 with their supersession named, not deleted. T222 gets its test before its rule is implemented. |
| VI | **Engaged heavily; satisfied.** *Every panel action has a menu item*: the toggle is a state toggle acting on the panel's content, so it is in both body menus and both header menus (the user's answer) with its check state and live chord; the status-bar buttons are accelerators over those items, so hiding a bar strands nothing. *One section vocabulary*: View & state, the constitution's own row for "toggles"; the preview body menu gains that section. *Disabled when unavailable, absent when meaningless*: absent on a binary preview and on an editor with no provider (no state of the application makes sync meaningful there); **enabled** while a provider is disabled, because the setting is not provider-scoped. *Themeable icon controls (NON-NEGOTIABLE)*: the status-bar button is an `IconButton` on the new theme token `syncScroll` with a hover title naming the action and chord. *One gesture follows a link* and *a preference picks the default*: not engaged — the toggle is a preference switch, not a variant. |
| VII | Not engaged. |
| VIII | Satisfied. One command body for every surface; the relay extends the existing per-window store rather than adding a channel; the pure decisions are functions, not a new service. A cross-window relay is still rejected (R23, R30). Moving the publisher into `editor-scroll-relay.ts` is justified by testability of a path `use-editor.ts` cannot be unit-tested through, not by abstraction for its own sake. |
| IX | Satisfied. No new service; the store and relay are renderer modules on the `caret-store.ts` pattern. The Principle IX exception recorded above is not widened. |
| X | **Engaged, satisfied.** The toggle writes the one existing setting (it is the setting, not a shadow of it); the command is rebindable; the icon is a theme token. The echo mark's lapse is a **frame boundary**, like the existing rAF throttle, not a tunable timeout. |
| XI | **Engaged, satisfied.** The store holds **view** state keyed by panel id and no document content. Nothing per-panel holds the sync on/off state — FR-122 forbids it, and the design reads the one setting everywhere. |
| Configuration-editor completeness | The command has one `KEYBINDINGS_METADATA` descriptor; the icon token has a label and description in `theme-copy.ts`; the setting's descriptor changes text only. `keybindings-metadata.test.ts`, `theme-metadata.test.ts` and `default-themes.test.ts` fail both ways. |
| Themeable icon controls | See VI. `menu-icon-tokens.test.ts` and `icon-tokens-exist.test.ts` gain `syncScroll`. |
| Documentation currency | `README.md`, `docs/quick-start.md` (Preview a file, §7 Previews, Keyboard reference), `CHANGELOG.md`, `docs/testing.md` and `CONTRIBUTING.md` (one optional body prop) in the same change — T247–T251. |
| Digit grouping | Not engaged. |
| Incremental delivery | Not engaged: nothing constitutional is deferred. FR-121a's same-window reading is a scope statement in the spec, not a deferral. |
| Particular-scrutiny review | **Engaged once**: a document presented in two Panels (editor and preview) now exchanges view state in both directions — assessed under XI above: view state only, one setting, no per-panel copy. |

**Result: PASS**, with no new deviation. The shipped-defaults bump and the budget-neutral E2E are
recorded below because they spend scope.

### Complexity Tracking — this iteration

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **One new E2E declaration, paid for by one moved down** (Principle V) — not a deviation; recorded because it spends scope | The oscillation property is a claim about the engine's real scroll-event order against CodeMirror's measure cycle; jsdom lays nothing out and fires no `scroll` for a `scrollTop` write, so component cases can only replay events in an order the test chose. | *Component tests alone*: would stay green while the real pair oscillated — the class of defect FR-121g exists to rule out. *Raise the budget*: Principle V's MUST NOT, and this plan's own Principle V row. |
| **`SHIPPED_DEFAULTS_VERSION` 8 → 9 on the same branch that introduced 8** | Version 8 has not shipped, but the maintainer's hand-testing builds of this branch already hold an 8 marker, so without the bump their theme files never receive `icons.syncScroll` and the new button renders as an empty box — 043's 6 → 7 precedent, recorded in `shipped-defaults.ts:104-121`. The version is a sequence, not a label. | *Keep 8 and rely on fresh installs*: the one population that reported the feature would not see the button. |
| **A renderer-only place-source tag and a `null` wire value** for FR-121e/FR-121h | The body must tell an attach place from a history place (FR-121h) and a placeless history step from a followed link (FR-121e); neither is recoverable from what arrives today. `null` is the smallest change that makes the second visible to every viewer of a panel shown in two windows. | *Decide in the invoking window only* (it knows its own request): a second window showing the same preview would treat the same step as a link and drive its editor to the top. *A new wire field*: two fields for one fact the existing `unknown` value can carry. |

### Sequencing — this iteration

1. **T226 first** — the demotion, so `e2e-budget.json` never reads above 569.
2. **One RED wave** (T227–T237, the E2E T237 last and only if T226 paid), then the checkpoint (T238).
3. **Settings, bindings, token** (T239) and **main's `null`** (T241) in parallel with the **editor relay**
   (T240); then the **preview side** (T242), which needs T240 and T241; then **menus** (T243),
   **status bars** (T244) and **command + failure reporting** (T245) one at a time — they share
   `preview-panel.tsx`.
4. **T246** makes the new E2E green against a fresh build (stale-dist trap).
5. **Docs** (T247–T251) with the behaviour; **verification** (T252) and **hands-on** (T253); then the
   still-open **T217** and **T176**, last.
