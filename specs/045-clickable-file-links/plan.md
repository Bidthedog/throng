# Implementation Plan: Clickable File Links

**Branch**: `feature/S045-I198-I394-terminal-and-file-links` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/045-clickable-file-links/spec.md` (64 requirement ids,
7 user stories, 11 success criteria, 0 clarification markers; committed as `03ba7aed`). Closes #394.
The same branch already carries the fix for #198 (`f407a506`, `5a4f9ba8`), which FR-043 extends.

## Summary

**One shared authority, two surfaces, and a fix that already exists.**

A file reference becomes a link in three steps, and each step has exactly one home. **Detection** is
a pure grammar in `packages/core` (`links/detect.ts`) — one grammar for terminals and editors, which
is FR-010 stated as code rather than as a promise. **Resolution** is a new `FileLinkResolver` in
**UI main**, because every input it needs is a main-process fact: the filesystem (`IFileSystem`), the
home folder, `PATHEXT`, and the panel's owning project root — which is never taken from the renderer
(the `authoritative()` precedent). **Action** is decided by pure core functions
(`linkTargetStates`, `resolveDefaultLinkAction`) and carried out by whichever layer owns the
destination: an editor or a preview in the renderer, the OS file manager or the default program in
main, behind the platform seam.

**Terminals gain their first `registerLinkProvider`.** xterm's `linkHandler` (OSC 8) and
`WebLinksAddon` (plain-text URLs) both stay exactly as they are; a new file-link provider sits
beside them and declines any span the web regex already claimed (FR-009). The `linkHandler` path
learns `file:` targets, which is US2 in its entirety and needs no detection at all.

**FR-043 — one Ctrl+click, one open — is inherited rather than built.** `keepLinkClickFromProgram`
(`use-terminal.ts:838-861`) already stops a Ctrl+press over a link from reaching a mouse-owning
program, gated on `hoveredLink !== null`. `hoveredLink` is filtered to `^https?://` at `:369`, so a
file link would slip past the interceptor and reproduce #198 for a new link kind. Widening
`hoveredLink` from "the hovered URL" to "the link throng resolved" is the whole of FR-043 — see
[research.md](./research.md) R4.

**Editors gain a `ViewPlugin` over `view.visibleRanges`** (FR-073 by construction, on
`function-highlight.ts`'s pattern), a `mousedown` handler that claims the event only over a resolved
link so CodeMirror's multi-cursor keeps every other Ctrl+click (FR-041), and a window-dispatched
Ctrl+Enter — the `navigate.gotoLine` shape, which is why FR-044's "otherwise the chord keeps its
current editor meaning" costs nothing.

**Two new Principle II ports** (`IPathForms`, `IExecutableExtensions`), each with a contract suite,
because FR-025/FR-026 and FR-039a ask for OS knowledge that core is forbidden to hold. **Four new
settings**, three under a new *Editor · Links* subsection and one beside the terminal settings.
**One key binding widened, not added.** **Zero new E2E declarations.**

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022), Node 22, Electron 43

**Primary Dependencies**: React 18.3, `@xterm/xterm` + `@xterm/addon-web-links` (reused),
CodeMirror 6 (reused), InversifyJS, Vitest + Playwright. **No new runtime dependency in any
package** — the grammar is a regex set, and every OS fact comes from a port.

**Storage**: none. No SQLite migration, no `LAYOUT_SCHEMA_VERSION` change, no
`SHIPPED_DEFAULTS_VERSION` bump (four settings leaves, no theme token; `shipped-defaults.ts:490`
clones `DEFAULT_APP_SETTINGS`). Nothing about a link is persisted.

**Testing**: unit (node), component (jsdom), integration and contract (serial), Playwright-on-Electron
E2E under the budget ratchet. Layer map below.

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS or Linux — the contract
suites assert shape and relationship, never a literal Windows path.

**Project Type**: Desktop application, npm-workspaces monorepo, three processes (renderer, Electron
main, detached daemon).

**Performance Goals**: SC-004 — streaming 50,000 lines no more than 5% slower with detection on.
Delivered structurally rather than by tuning: nothing on the output path calls the detector at all
([contracts/link-resolution.md](./contracts/link-resolution.md) §4).

**Constraints**: An existence check must never touch the PTY data path or the typing path (FR-071).
A `file:` URI must never reach the OS URL opener (FR-037). Ctrl+Enter must not become live in a
terminal (FR-046). `core/src` may name no OS concept — `core/tests/unit/no-os-imports.test.ts`
already fails the build on one.

**Scale/Scope**: 64 FRs across 7 stories. Touches `packages/core`, `packages/ui` and
`packages/platform-windows`. `daemon`, `persistence` and `ipc-contract` are untouched.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

Constitution **v5.5.0**. Every principle and every workflow gate is assessed; none is skipped.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, and it decides where resolution lives.** "In the project" is judged in **main**, against the root derived from the panel's `originProjectId` — never from a renderer-supplied root (the `editor-ipc.ts:71-83` precedent). FR-055 is a consequence rather than a check: `editor` and `preview` are only ever *offered* for an in-project file ([data-model.md](./data-model.md) §3), so no gesture, menu item, setting or fallback can reach them for anything outside it (SC-007). A panel in a sub-workspace judges against its original project; a panel with no owning project judges every target outside one. A path inside **another** throng project is simply outside this one. **Satisfied.** |
| **II. Platform-Abstracted Core** | **Engaged heavily; two ports added, one long-standing gap closed.** FR-026 forbids the shared rules from naming an operating system and FR-039a forbids core from naming an extension. Today there is **no path port at all** — path rules are pure string functions with the separator passed in (`core/src/fs/path-canon.ts`), which cannot express "what does `/d/x`, `~` or `file://server/share` mean here". `IPathForms` and `IExecutableExtensions` are added with contract suites (R6, [contracts/platform-ports.md](./contracts/platform-ports.md)); `IShellIntegration` gains `openWithDefaultProgram`. A new unit test asserts `core/src/links/**` names no extension and no drive mapping, beside the existing `no-os-imports.test.ts`. **Satisfied.** |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged twice, lightly.** (a) FR-080 changes what a terminal is *started with*. It goes into `launch.env`, not `baseEnv`, because a de-elevated terminal never receives `baseEnv` (R11) — a PTY lifecycle detail that would otherwise have made FR-080 silently false for mixed-mode terminals. No spawn, detach, tag, reattach or reap path changes. (b) FR-038 extends the de-elevation rule to a *launched application*: an OS open from an elevated throng must not inherit the elevated token. The existing `IDeElevator` carries it, because both OS actions have a `{file, args}` form (R7). **Satisfied**, with O2 open. |
| **IV. Native Terminal Support & Auto-Detection** | **Engaged, and cleared without a new recorded exception.** No chord in the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) is taken, and none in the shadowable tier. **Ctrl+click is not a chord.** `Ctrl+Enter` is widened from `preview` to `preview` + `editor` and stays **out of `terminal`** — FR-046, and `keybindings-preview.test.ts:61-67` plus `terminal-modified-enter.e2e.ts:233` are left untouched as the proof. **One command, one chord across panel types** is the reason the id `preview.followLink` is widened rather than a second editor command being added (R9). |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | **Engaged, and satisfied as the text reads.** Every task is test-first at the lowest layer that can prove it (layer map below). **The E2E budget does not rise and no declaration is added**: two existing declarations gain cases, both already carrying `@reserve:pty`, and `e2e-budget.json` reads 570 before and after (R15). The plan also names what is *not* tested at E2E and where each is proved instead. FR-072's structural assertion is a unit test; SC-004's wall-clock ceiling is deliberately not asserted (044's SC-002 precedent). |
| **VI. Simple, Modern, Discoverable UX** | **Engaged heavily; no deviation.** Assessed in five rows below. |
| **VII. Change Review & Approval** | **Not engaged.** Following a link never writes a file — the spec says so in as many words ("Following a link never creates a file"). No edit-list behaviour changes. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided three shapes.** **DRY, twice over**: the `^https?://` test exists in four independent places (R5) and becomes one core classifier; and FR-021's containment check **reuses `isUnderPath`** (`core/src/fs/path-id.ts:97`) rather than becoming the *fifth* near-copy of a rule whose own docstring already records three. **ISP**: two one- and four-method ports rather than one grab-bag, because resolution and executable classification have different callers. **YAGNI**: no link registry, no persisted link state, no plugin seam, no new panel kind, no new IPC to the daemon. |
| **IX. Dependency Injection & Composition Root** | **Engaged, and it *reduces* an existing shortfall.** Both new ports are bound in the one UI-main container on the `#199` pattern. `FileLinkResolver` takes every collaborator by constructor, which is what makes it integration-testable without Electron. `IFileSystem` — `new NodeFileSystem(...)` at `main.ts:1082`, with no `UI_TYPES` entry — is **bound here**, closing one named item of 043's recorded exception rather than widening it. |
| **X. Externalised Configuration** | **Engaged, satisfied, with one recorded deviation.** Four settings with descriptors (FR-060–FR-061, FR-080b). Two hard-coded values the principle's text names — the link-cache TTL and the per-line candidate cap — are integrity guards rather than business configuration and are recorded in Complexity Tracking with 030's and 044's precedents. |
| **XI. Dockable Workspace: Panes, Tabs & Panels** | **Engaged lightly, and the workflow gate does not fire.** No new panel type, and nothing here presents an artefact. The link cache is per-window **view state** on the `cwd-store.ts` pattern, holding no buffer, dirty state, undo history, language or indentation. Two panels showing the same file resolve the same link to the same target because both ask the same main authority. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | **Satisfied, and it is half the feature.** Every link action is a menu item: Open Link, the four named targets, Copy Link Address, in both panel types (FR-031). No action is reachable only by a gesture. The chord and Ctrl+click are accelerators over items that exist. Nothing new appears on a status bar, so hiding one strands nothing. |
| **One section vocabulary for every menu** | **Satisfied.** The whole run is `contextual` — the section's own test is *"would this item be absent if the pointer were elsewhere?"*, and every one of the six would be. It leads the menu, which is where 024 already puts the terminal's link items. `section` is a required field, so an omission is a compile error. The editor content menu gains its first contextual section; `menu-sections.test.ts` gains a `shapeOf` pin for both menus. |
| **Disabled when unavailable, absent when meaningless** | **Satisfied, and the discriminator is applied per target.** Only **Open in Preview** is ever drawn disabled: a disabled provider is one setting away from working, so it is *unavailable* (044 FR-062). Every other absence is structurally meaningless for that link and is not drawn — Open in Editor for a folder or an out-of-project file, Open in OS Default Program for a folder. A link that resolves to nothing is not a link, so it contributes **no** items at all rather than six disabled ones. |
| **One gesture follows a link, everywhere** | **Satisfied, and this feature closes the rule's second Known Gap.** Ctrl+click (Cmd on macOS) follows; a plain click never navigates; a modified click that drags selects; hover names the gesture; the menu offers Open Link and Copy Link Address. **Ctrl+Enter** arrives in editors, where a caret gives a link a keyboard position — and deliberately **not** in terminals, where none does and the shell keeps the chord, which is the rule's own carve-out. See FR-091 below. |
| **A preference picks the default; the menu offers every variant** | **Satisfied, and this is the rule's first full worked example.** The menu names each of the four targets, each performing that target whatever the preference says (FR-054), beside a **plain** item labelled for the action — *Open Link*, never *Open in Editor* — which runs the preference's current choice. The constitution names #394's link targets as the first to add a plain item beside named variants; this is it. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | **Engaged once.** FR-091's constitution PATCH cannot be made before the behaviour ships, so it lands in the same change as US3 rather than ahead of it. No capability is deferred; the two Out-of-scope items the spec names (a terminal link-navigation mode, underlining every row of a wrapped link) belong to other issues, not to a deferred part of this one — #326 already exists for the second. |
| **Every plan evaluated against all eleven principles** | Done above. |
| **Static analysis & linting (NON-NEGOTIABLE)** | **Engaged as the standing gate.** `npm run gate`, dispatched to a hosted runner, is the only evidence of done-ness; the run URL and SHA are quoted when it is claimed. |
| **Particular-scrutiny review** | **Engaged once**, and squarely: this change touches the **OS abstraction boundary** (two new ports, one widened seam, a de-elevation path). It does **not** touch daemon/terminal process lifecycle, persisted edit or layout state, or a document presented in more than one Panel. |
| **Documentation currency (NON-NEGOTIABLE)** | **Engaged.** FR-090 names it. `README.md` (Highlights, Configuration), `docs/quick-start.md` (§3 *Run a terminal* and *Shell integration*, §4 *Edit files*, §7 *Make it yours*, the *Keyboard reference*), `CONTRIBUTING.md` (the two new ports and their contract suites are an extension point), `docs/testing.md` (the two extended declarations) and `CHANGELOG.md` are updated in the same change. |
| **Configuration-editor completeness (NON-NEGOTIABLE)** | **Engaged.** Four settings descriptors and one amended key-binding descriptor; `settings-metadata.test.ts` fails without them. FR-061's placement is delivered by `group` + `subgroup`, which `groupDescriptors` already honours. |
| **Displayed quantities digit-grouped (NON-NEGOTIABLE)** | **Engaged and clear.** The only numbers this feature displays are a link's line and column — an **ordinal inside a location**, not a quantity, and the rule names *"a number seeded into an editable field"* and identifiers as exclusions. `foo.ts:1,042` would be a defect. No new count appears on any surface. |
| **Themeable icon controls (NON-NEGOTIABLE)** | **Engaged lightly.** No new action control: every addition is a context-menu item, which carries a label by definition, and the existing link items already ship without an icon because no link/open token exists (`terminal-content-menu.ts:54-70`). No new icon or colour token, and no colour literal is added. |

**Result: PASS**, with two Principle X deviations and one Principle IX/naming tension, all recorded
in Complexity Tracking; two Principle II gaps closed; one Principle IX item of 043's exception
closed; the E2E budget held flat with **zero** new declarations.

### Re-evaluation after Phase 1

Re-checked against the design artifacts. Three findings changed the design; none changed the
verdict.

- **I and II together forced resolution into main.** The first sketch resolved in the renderer and
  asked main only to act. `~`, `PATHEXT` and the project root are all main facts, and FR-037 makes
  main re-check anyway, so the renderer version would have been a second implementation of a rule
  that must be identical (FR-010). It resolves nothing and caches answers instead (R3).
- **III surfaced the `baseEnv` trap.** FR-080 read naturally as "add it to the environment the shell
  is built from", which is `baseEnv` — and a de-elevated terminal never receives `baseEnv`. FR-080
  would have been silently false for exactly the terminals a user runs deliberately (R11).
- **VI's chord rule resolved an apparent contradiction between FR-031 and FR-046** rather than
  needing a spec change: a menu item shows its chord *where one is bound*, and in a terminal none is
  (R10b).

## Project Structure

### Documentation (this feature)

```text
specs/045-clickable-file-links/
├── spec.md
├── plan.md                                 # this file
├── research.md                             # Phase 0 — R1–R16, Open items O1–O6
├── data-model.md                           # Phase 1
├── quickstart.md                           # Phase 1
├── contracts/
│   ├── link-resolution.md                  # FR-003–FR-013, FR-020–FR-026, FR-070–FR-073
│   ├── platform-ports.md                   # FR-012, FR-025, FR-026, FR-035–FR-039a
│   ├── menus-and-gestures.md               # FR-030–FR-034, FR-040–FR-046, FR-050–FR-055, FR-062
│   └── settings-and-environment.md         # FR-037, FR-060–FR-062, FR-080–FR-080d
├── checklists/requirements.md
└── tasks.md                                # Phase 2 (/speckit-tasks)
```

### Source Code

Each block names the **owning area agent** (`.claude/agents/README.md`) so tasks can be routed.

```text
packages/core/src/                                          ── throng-core-architecture
├── links/                              NEW
│   ├── detect.ts                       the grammar (FR-003–FR-005, FR-009)
│   ├── resolve.ts                      candidate → ordered candidate paths (FR-020–FR-026)
│   ├── types.ts                        LinkCandidate, LinkResolutionRequest, ResolvedLink
│   ├── targets.ts                      linkTargetStates (FR-030)
│   ├── default-action.ts               resolveDefaultLinkAction + FR-053 fallback (FR-039, FR-050–FR-055)
│   ├── menu.ts                         fileLinkMenuItems (FR-031)
│   └── classify.ts                     classifyTerminalLinkTarget — the ONE scheme gate (R5)
├── abstractions/
│   ├── path-forms.ts                   NEW — IPathForms (FR-012, FR-025, FR-026)
│   ├── executable-extensions.ts        NEW — IExecutableExtensions (FR-039a)
│   └── shell-integration.ts            + openWithDefaultProgram (FR-036)
├── terminal/
│   ├── spawn-env.ts                    + hyperlinkAdvertisementEnv (FR-080–FR-080d)
│   └── link-menu.ts                    terminalLinkTarget → the file-aware form (S1)
├── testing/
│   ├── path-forms-contract.ts          NEW      ── throng-core-architecture
│   ├── executable-extensions-contract.ts NEW
│   └── shell-integration-contract.ts   + SI1–SI4
└── index.ts                            + barrel exports for every new module

packages/core/src/config/                                   ── throng-config-preferences
├── app-settings.ts                     + editor.links.{defaultAction,detectInEditors,detectInTerminals}
│                                       + terminals.advertiseHyperlinks; defaults, parse, clone
├── settings-metadata.ts                + 4 descriptors (Editor·Links ×3, Terminal ×1)
├── keybindings.ts                      preview.followLink scope PREVIEW_ONLY → editor+preview
└── keybindings-metadata.ts             its description (FR-062)

packages/platform-windows/src/                              ── throng-terminal-pty / core-architecture
├── windows-path-forms.ts               NEW — drive forms, file: URLs, UNC, home
└── windows-executable-extensions.ts    NEW — PATHEXT per call + the declared handler set

packages/ui/src/main/
├── file-link-resolver.ts               NEW — the one authority (R3)          ── throng-explorer-fileops
├── link-ipc.ts                         NEW — throng:links:{resolve,reveal,open} ── throng-explorer-fileops
├── electron-shell-integration.ts       + openWithDefaultProgram; de-elevated route (FR-038) ── throng-core-architecture
├── terminal-ipc.ts                     + readTerminalSettings dep; merge into launch.env  ── throng-terminal-pty
├── tokens.ts / composition-root.ts     + PathForms, ExecutableExtensions, FileSystem      ── throng-core-architecture
└── main.ts                             construct + wire FileLinkResolver and link-ipc

packages/ui/src/preload/preload.cts, renderer/global.d.ts   + window.throng.links  ── throng-renderer-ui

packages/ui/src/renderer/links/          NEW                                    ── throng-renderer-ui
├── link-cache.ts                       per-window resolution cache (FR-070, FR-071)
├── link-actions.ts                      one router: resolved link + target → the act
└── link-menu-items.ts                   core's shapes → MenuAction[] (FR-031)

packages/ui/src/renderer/terminal/                                              ── throng-terminal-pty
├── file-link-provider.ts               NEW — the first registerLinkProvider (R1)
├── use-terminal.ts                     hoveredLink becomes a resolved link (R4); file: in linkHandler;
│                                       tooltip wording; the 3 scheme gates → classify.ts
├── terminal-content-menu.ts            the FR-031 run over a file link
└── terminal-panel.tsx                  getHoveredLink / menu wiring; cwd as baseDirectory (FR-023)

packages/ui/src/renderer/editor/                                                ── throng-editor-documents
├── link-decorations.ts                 NEW — ViewPlugin over visibleRanges (FR-002, FR-073)
├── use-editor.ts                       + mousedown handler, + a link compartment, + menu args
├── content-menu.ts                     + the contextual run (FR-031)
└── reveal-range.ts                     + positionRevealTarget(line, column) (FR-033, R12)

packages/ui/src/renderer/app.tsx                            + preview.followLink in editor scope ── throng-renderer-ui

packages/ui/tests/e2e/  terminal-link-once.e2e.ts and terminal-links.e2e.ts gain CASES;
                        e2e-budget.json and parallel-plan.json UNCHANGED         ── throng-e2e-harness
packages/ui/tests/fixtures/links/  the tree in quickstart §2                     ── throng-e2e-harness
README.md, docs/quick-start.md, docs/testing.md, CONTRIBUTING.md, CHANGELOG.md,
.specify/memory/constitution.md (FR-091 PATCH)                                   ── throng-spec-governance
```

**Structure Decision**: `packages/core`, `packages/ui` and `packages/platform-windows`.
`daemon`, `persistence` and `ipc-contract` are untouched — a link never crosses the daemon boundary,
nothing is persisted, and FR-080's variable rides the **existing** `LaunchSpec.env` field, which the
daemon already forwards verbatim (`terminal-service.ts:503`).

## Testing strategy

Principle V: the lowest layer that can prove each thing.

| Layer | What proves itself here |
|---|---|
| **unit** (core) | The whole grammar, D1–D8 — every form in FR-003a–f, every position form in FR-004, FR-005's punctuation/bracket/quote rules, and **SC-003's prose fixture yielding zero candidates**. Resolution order R1–R11 with a fake `IPathForms` and an injected `exists` — including the `C:\x\foo.ts:42:7` ambiguity (R7) and the leading-`/` project-root-first rule (R6). Membership M1–M6 against `isUnderPath`. `linkTargetStates` across the five link shapes (SC-009). `resolveDefaultLinkAction` across setting × shape × position × executable, with SC-010 driven from `IExecutableExtensions`' own reported set. `fileLinkMenuItems` order and the chord-only-where-bound rule. `classifyTerminalLinkTarget`. `hyperlinkAdvertisementEnv` E1–E7. Keybinding scope, collisions and metadata. Settings defaults, tolerant parse, **clone round-trip**, and descriptor completeness. The guard that `core/src/links/**` names no extension or drive mapping. |
| **unit** (ui, node) | **FR-072's structural assertion**: 50,000 lines pushed through a fake terminal's data path call the resolver port **zero** times; one `provideLinks` calls it once; a second for the same span calls it not at all (FR-070). `doAttach` merges the hyperlink env into `launch.env` and never into `baseEnv`, and reads the setting per attach (FR-080c). `menu-sections.test.ts` gains a `shapeOf` pin for both menus. |
| **component** (jsdom) | The editor end to end below a window: the `ViewPlugin` decorates only resolved links and only within `view.visibleRanges` (FR-002, FR-073); Ctrl+click over a link follows and **anywhere else adds a cursor** (FR-041); Ctrl+drag selects (FR-040); the compartment reconfigure turns decoration off live with no restart (FR-060); Ctrl+Enter with a single caret inside a link follows, and with a selection, with two carets, or outside a link inserts a blank line (FR-044, G9). Both content menus' item sets across in-project file / file with a provider / file with a **disabled** provider / out-of-project file / folder (SC-009), with and without a selection (024 FR-019d), and the keyboard-menu path. The link cache: an unresolved answer draws nothing (FR-071), an invalidation re-requests (FR-070). |
| **integration** (serial, real `NodeFileSystem` over a temp tree) | `FileLinkResolver`: every resolution rule against real files, including UNC-shaped and missing paths; `inProject` for a sub-workspace panel and for a panel with no project; the symlink rule (M5); FR-037's re-check answering `gone` for a file deleted between hover and follow, and that re-check raising exactly **one** notice. `throng:links:*` refusing to act on a renderer-supplied path. The **de-elevated** OS routes (`@admin`). A real shell spawned with and without the setting, echoing its environment (FR-080 – FR-080d). |
| **contract** | `runPathFormsContract` PF1–PF12 and `runExecutableExtensionsContract` EX1–EX7 against the Windows implementations; `IShellIntegration` SI1–SI4; preload parity for `window.throng.links`. |
| **E2E** (**+0 declarations**; two existing ones gain cases; budget stays at 570) | `terminal-link-once.e2e.ts:529` (`@extended @terminal @reserve:pty`) gains a **detected path** case and an **OSC 8 `file:` folder** case — one Ctrl+click opens once, the program receives no press, and a plain click still reaches the program. `terminal-links.e2e.ts` gains a hover case: a detected path underlines, a look-alike that names nothing does not. |

**Deliberately not E2E, and where each is proved instead**: every menu shape (component — these are
in-document React menus); the settings and their descriptors (unit + the completeness test); the
terminal environment (integration against a real shell, as the spec's Assumptions require); the
executable classification (contract); resolution against the filesystem (integration); the editor's
Ctrl+click and Ctrl+Enter (component — CodeMirror runs in jsdom, and the ordering that matters is
declarative: the window listener is capture-phase and `editorCommandKeymap` deliberately leaves the
chord unbound so it is not `preventDefault`ed); and **SC-004's 5% wall-clock ceiling**, which is
measured in the quickstart and asserted nowhere, because a timing bound on a shared hosted runner is
a flake by construction and a flaky gate costs more than the property it guards.

**If a case is found during `/speckit-tasks` that genuinely needs its own declaration**, it must be
paid for by moving one down first, replacement observed failing. The candidate pool is stated rather
than hoped for: `reserve-tag-debt.json` records **114** declarations naming no reserve entry, and
the constitution already owes their demotion.

## Sequencing

This is a planning constraint for `/speckit-tasks`, not advice.

1. **Foundations, in parallel** — the core `links/` grammar and decisions; the two ports, their
   contract suites and their Windows implementations; `hyperlinkAdvertisementEnv`; the settings
   leaves and descriptors; the keybinding scope widening. Nothing below starts until these are green.
2. **`FileLinkResolver` and `throng:links:*` before any surface.** Both surfaces consume it, and
   building either against a renderer-side stand-in would produce the second implementation of
   FR-010 that this plan exists to prevent.
3. **US2 (explicit `file:` hyperlinks) is the first slice**, ahead of US1 despite the spec listing
   US1 first. It needs **no** detection, so it exercises resolve → classify → act → menu end to end
   at the smallest possible size, and it delivers SC-005 — the report that started the feature — in
   one slice.
4. **US1 (detected paths in terminals)** next: the link provider, the widened `hoveredLink`, the
   tooltip. **`hoveredLink`'s type change lands in one commit** with all four of its readers
   (data-model §8) — split across commits, the interceptor is briefly blind to file links, which is
   #198 reopened.
5. **US4 (the menu) before US3 (editors)**, because both panel types compose from the same core
   shapes and the terminal is where they can be proved against a surface that already exists.
6. **US3 (editors)**: decorations, the `mousedown` handler, the window-dispatched chord, the
   contextual menu run, `positionRevealTarget`.
7. **US5 (the default link action)** after US4, since the fallback needs the target states the menu
   already consumes. **FR-039 lands with it, not after it** — an executable that runs on a Ctrl+click
   is the one behaviour in this feature that cannot be shipped and fixed later.
8. **US6 (the switches)** and **US7 (`FORCE_HYPERLINK`)** are independent of everything above and of
   each other; either may run in parallel from step 1.
9. **The E2E cases last**, after the surfaces they drive, with `e2e-budget.json` and
   `parallel-plan.json` re-read in the same commit to confirm neither needs a change.
10. **Docs in the same change as the behaviour they describe**; the FR-091 constitution PATCH in the
    same change as US3, which is the increment that makes its Known Gap wrong.

## Complexity Tracking

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Two hard-coded guard values: the link-cache TTL and the per-line candidate cap** (Principle X names *timeouts* and *limits*) | The TTL exists so a cached "this does not exist" cannot outlive the file being created (FR-070) in the gap between watcher events; the cap bounds how many candidates one pathological line can produce before the provider gives up, so a 100,000-character line of slashes cannot make a hover expensive. Neither is business configuration — both are integrity guards whose only correct answer is "small enough to be invisible, large enough never to bite". Named constants in `core/src/links/`, unit-tested at their edges. | *Make them settings*: two descriptors, two preference rows and two completeness cases for values no reader has a reason to move, and whose mis-setting either defeats FR-070 or makes a hover slow. The precedent is explicit — 030's truncation bound and 044's `HIGHLIGHT_BUDGET_CHARS`, both recorded exactly this way. Revisit if either ever needs to differ between machines. |
| **`preview.followLink` keeps a `preview.`-prefixed id while being live in editors** (Principle VIII, naming; Principle IV, one command one chord) | FR-045 requires **one** rebindable command across both panel types, so widening the scope of the existing ActionId is what the constitution asks for. Renaming it to something surface-neutral would be tidier and is the obvious instinct — and a user's saved keybindings are stored **by ActionId**, so a rename silently drops every rebinding made since 044 shipped. A behaviour change with no requirement behind it, bought with a better identifier, is not a trade this feature is entitled to make. | *Rename with a migration*: a settings migration for a cosmetic id, on a store whose migrations must be idempotent and which no other requirement asks to touch. *Add a second editor command*: two commands sharing Ctrl+Enter, which Principle IV forbids by name because they could be rebound apart. |
| **`FileLinkResolver` constructed in `main.ts` beside its collaborators, not resolved from the container** (Principle IX) — **continues** 043's recorded exception without widening it | It takes every collaborator by constructor, and three of them (`EditorCoordinator`'s neighbours, the preview registry, the watchers) are themselves `new`-ed in `main.ts`. This is 043's recorded continuation, and the feature **reduces** the exception on balance: `IFileSystem` is bound into the container here, closing one of the items 043 named. | Binding this one service in the container while the objects it composes with are not: two conventions for one object graph, inside a feature that is not about DI. The end state — the UI-main graph built in the container — is unchanged and unweakened. |
| **`explorer.exe` / `rundll32.exe` instead of `shell.openPath` when the host is elevated** (FR-038) | Electron's `shell.*` calls are made **by the current process**, so an elevated throng hands its token to whatever it launches — exactly what FR-038 forbids, and what would let a link printed by a non-elevated terminal start an elevated program. `IDeElevator.wrap` takes a `{file, args}` spec, and both actions have one (R7), so the existing seam carries it with no new abstraction. The non-elevated path keeps today's `shell.*` behaviour verbatim. | *Leave it*: ships the hazard the requirement names. *A new de-elevation seam for `ShellExecute`*: a second abstraction for a capability the first already expresses. *`cmd /c start "" <path>`*: flashes a console window, and its first quoted argument is a **title**, which is a well-known injection foot-gun on a user-supplied path. **Open item O2** — whether `IDeElevator.isAvailable()` holds in UI main — is settled before this task, and if it does not, the de-elevation is handed to the daemon over an existing RPC and this row is rewritten. |

### Reported to the maintainer, not worked around

1. **Constitution Principle VI's *Known gaps* sentence is already wrong, before this feature.** It
   says *"no surface yet implements Ctrl+Enter"* and that 044 and #394 "add the first". 044 shipped:
   `preview.followLink` is bound to Ctrl+Enter and dispatched in `preview-commands.tsx:162-167`.
   FR-091's PATCH therefore corrects **two** statements, and its SYNC IMPACT REPORT should say it
   found one of them already stale rather than restating FR-091's premise (R16). The About window's
   plain-click links remain a gap this feature does not touch.
2. **FR-031 and FR-046 read as a contradiction and are resolved by the constitution, not by the
   spec.** FR-031 requires Open Link to show the chord; FR-046 forbids the chord in a terminal.
   Principle VI's *"where one is bound"* settles it — the terminal's Open Link item shows no chord
   (R10b). Recorded because a reader of the spec alone would implement it the other way.
3. **The spec's Assumption that the file-link tooltip "matches the wording web links use" cannot be
   taken literally.** The shipped wording is *"Ctrl+Click to open in system browser"*
   (`use-terminal.ts:311`), which would be false for `src/foo.ts`. FR-042 only requires the tooltip
   to name the gesture, so the *shape* is matched and the destination is not (R10a).
4. **US4 scenario 8's keyboard-opened terminal menu composes from what the pointer rests on**, since
   FR-046 denies a terminal link any keyboard position. That is 024's existing mechanism, unchanged,
   and it means a keyboard-opened menu offers the link items only when the pointer happens to be
   over a link. Reported rather than solved, because solving it is the terminal link-navigation mode
   the spec puts out of scope.
5. **`throng:files:revealDocument`'s confinement does not admit a link's target.** It accepts a path
   only when some panel has the file open (`files-service.ts:518-528`), while FR-030 offers Open in
   OS Explorer for every file link. A third policy is added rather than either existing one widened
   (R8, [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3), so no
   shipped confinement is loosened — but the fact that there are now three reveal policies is worth
   a maintainer's eye.
