# Implementation Plan: Clickable File Links

**Branch**: `feature/S045-I198-I394-terminal-and-file-links` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/045-clickable-file-links/spec.md` (64 requirement ids,
7 user stories, 11 success criteria, 0 clarification markers; committed as `03ba7aed`). Closes #394.
The same branch already carries the fix for #198 (`f407a506`, `5a4f9ba8`), which FR-043 extends.

> **Amended 2026-09-18 — maintainer change request (US8, US9, FR-100 – FR-124, D1).** The plan below
> is the plan as delivered through T132 and is kept as written. What the change request adds and
> retires is in [*Amendment 2026-09-18*](#amendment-2026-09-18--one-link-model-the-click-rule-network-paths)
> at the end, and its tasks are Phase 13 of [tasks.md](./tasks.md). Where a sentence below describes
> the retired default link action setting, that section says what replaces it.

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

---

## Amendment 2026-09-18 — one link model, the click rule, network paths

**Input**: the maintainer's change request after hands-on testing of PR #408, quoted verbatim at the
top of [spec.md](./spec.md), and the third 2026-09-18 Clarifications session there. It adds **US8**
(every link behaves the same in editors and terminals), **US9** (follow a network path),
**FR-100 – FR-107**, **FR-110 – FR-114**, **FR-120 – FR-124**, **SC-012 – SC-014**, and records
defect **D1**. It retires one setting (FR-112) and adds one (FR-120). Derivations are
[research.md](./research.md) **R17 – R20**.

### What changes, in one paragraph per strand

**Editors gain web links, and parity becomes structural (FR-100 – FR-105).** The web-URL grammar
moves from `ui/src/renderer/terminal/terminal-url.ts` into `core/src/links/web-url.ts`, **unchanged**
— `ui/tests/unit/terminal-url.test.ts` stays byte-identical and passing as the proof (R20). A new
pure `scanLinkLine(line)` in `core/src/links/scan-line.ts` returns a line's web links and its path
candidates together, with FR-009's "never both" applied once. The terminal's `claimedByWebLinks` and
the editor's `link-decorations.ts` both call it, so the two surfaces cannot disagree about what is a
link: that is FR-104 stated as code, the same move FR-010 made for file links. The editor's
`mousedown` handler, window-dispatched chord and content menu learn the web kind and route it
through the **same** open-external call the terminal uses. The hover wording moves into one core
function, `linkHoverText`, which both surfaces call (FR-105).

**The click rule replaces the default link action (FR-110 – FR-114).** `resolveDefaultLinkAction`
loses its `setting` argument and its FR-053 fallback, and its return type becomes
`'editor' | 'preview' | 'osExplorer'` — so FR-111 is a property the compiler checks, not a clause a
later change could step round. `DefaultLinkAction`, `DEFAULT_LINK_ACTIONS`, the
`editor.links.defaultAction` leaf and its descriptor are deleted from the code; a persisted value is
dropped by the tolerant parse — `linkSettings` rebuilds the block from the leaves it knows — and
stripped on the next write, which is exactly the mechanism 019 FR-023 relies on for
`explorer.openMode` (R17). `link-actions.ts` loses its `defaultAction` reader; `linkRouting` keeps
`previewIsDefault`, the one preference left.

**Network paths (D1, FR-003g, FR-107, FR-120 – FR-124).** Three independent pieces:

1. **D1's fix is in `join`** (`core/src/links/resolve.ts`): a base that begins with two separators
   keeps both, and its first two segments — server and share — are a root that `..` cannot pop. The
   file already recognises the UNC shape (`UNC_FORM`), so no OS is named (FR-026). The reproduction is
   the untracked `core/tests/unit/link-resolve-unc.test.ts`, which is **adopted, not rewritten**, and
   is run and shown to the maintainer before any production line changes (R18).
2. **The PowerShell provider-qualified form** is a grammar addition in `core/src/links/detect.ts`:
   `FileSystem::` (optionally after `Microsoft.PowerShell.Core\`) is stripped before a token is
   judged, and `::` stays a refusal everywhere else, so SC-003's prose fixture still yields nothing.
3. **Bounded existence checks** live in `FileLinkResolver` (UI main), the one place that calls
   `stat` for a link (R19). Each check races the existence-check timeout; a timed-out check answers
   `unreachable` and marks its **volume root** (`path.parse(p).root` — `\\server\share\` or `C:\`) as
   outstanding. While it is, further checks under that root answer at once without touching the
   disk; a process-wide cap of **two** timed-out checks stops several offline servers from occupying
   the Node thread pool that also serves saves, reads and watchers. When the stuck call finally
   settles, the mark clears; the renderer's cached `unreachable` expires with the cache TTL, which is
   FR-122's back-off without a second timer. `LinkResolution` gains a `reason: 'unreachable'` on its
   failure arm and `LinkActionOutcome` gains `'unreachable'` beside `'gone'` and `'refused'`, which is
   what lets FR-124's notice say "did not answer". FR-123 is the terminal provider's: a late answer
   must reach xterm for the line it belongs to rather than being dropped after
   `LINK_ANSWER_DEADLINE_MS`; the mechanism is settled by R19's open question before the GREEN task.

### Constitution Check — the change request, re-evaluated

Every principle was re-read against the amendment. **Result: PASS**, with two new Complexity
Tracking rows and one reported tension.

| Principle | Assessment |
|---|---|
| **I** | **Engaged, and tightened.** FR-110 sends every out-of-project file to OS Explorer — throng never opens one, exactly as FR-055 already required. FR-106 refuses to treat an alias (mapped drive, admin share, 8.3 name) as in-project on a guess: the safe direction. A project rooted on a share now judges membership correctly (D1). |
| **II** | **Engaged.** The UNC join names no OS: it reuses the `UNC_FORM` shape `resolve.ts` already holds. The volume-root derivation uses `node:path` in UI main, which is not `core`. The web grammar in core names schemes, not an OS. `links-no-os-names.test.ts` is unchanged and must stay green. |
| **III** | **Not engaged.** No spawn, detach or reattach path changes. |
| **IV** | **Engaged, cleared.** No new chord. Ctrl+Enter gains a second link kind in editors (web) and stays out of terminals (FR-046, `terminal-modified-enter.e2e.ts:233` untouched). |
| **V** | **Engaged.** Every task in Phase 13 is test-first at the lowest layer; the UNC defect starts with the existing reproduction and the maintainer's confirmation. **E2E budget stays at 570, zero declarations added**: the one property no lower layer sees — OS Explorer actually displaying a file on a share — no E2E can see either, so it is a hands-on check (T154). |
| **VI** | **Engaged.** *One gesture follows a link, everywhere* is the change request's whole point, and web links in editors close a surface the rule covers ("document text"). *A preference picks the default* still holds — the preference is 044's default open action ([spec.md](./spec.md) *Reconciled*). *Every panel action has a menu item*: Open Link and Copy Link Address on the editor's web links. |
| **VII** | **Not engaged.** Nothing writes a file. |
| **VIII** | **Engaged twice.** DRY: one web grammar and one line scan replace two scanners (R20). YAGNI: a setting whose remaining choice duplicated 044's is removed rather than narrowed (R17). **Tension**: `IExecutableExtensions` loses its only production consumer — Complexity Tracking. |
| **IX** | **Engaged lightly.** `FileLinkResolver` gains one constructor collaborator, a settings reader for the timeout, on the `readPreviewSettings` pattern. |
| **X** | **Engaged.** The existence-check timeout is machine- and network-specific, which the principle requires to be overridable: it is a setting (FR-120). The two-check cap is an integrity guard — Complexity Tracking, on the per-line-cap precedent. `LINK_ANSWER_DEADLINE_MS` stops being an independent constant: the terminal's held reply waits as long as main's check may take. |
| **XI** | **Not engaged.** No panel, tab or pane change. |
| **Documentation currency** | **Engaged.** `README.md`, `docs/quick-start.md` and `CHANGELOG.md` change with the behaviour (T169). Because the default link action never reached a release, the CHANGELOG's unreleased 045 entry is corrected rather than a "removed" line added. |
| **Configuration-editor completeness** | **Engaged.** One descriptor removed, one added; `settings-metadata.test.ts` enforces both. |
| **Displayed quantities digit-grouped** | **Engaged.** The timeout's descriptor shows `2,000` ms and its bounds as `250` – `25,000`. |

### Project structure — files the amendment touches

```text
packages/core/src/links/
├── web-url.ts            NEW  — WEB_URL_REGEX (moved, unchanged), detectWebLinks        FR-102
├── scan-line.ts          NEW  — scanLinkLine: web spans + path candidates, FR-009 once  FR-104
├── hover-text.ts         NEW  — linkHoverText                                           FR-105
├── detect.ts             + FileSystem:: qualifier                                       FR-003g, FR-107
├── resolve.ts            join keeps a UNC root                                          D1
├── default-action.ts     no setting, no fallback, no default program in the result type FR-110, FR-111
├── limits.ts             + MAX_TIMED_OUT_LINK_CHECKS = 2                                FR-121
└── types.ts              + 'unreachable' on LinkResolution and LinkActionOutcome        FR-120, FR-124
packages/core/src/config/ app-settings.ts, settings-metadata.ts — − defaultAction, + existenceCheckTimeoutMs
packages/ui/src/main/     file-link-resolver.ts (volume-root gate), main.ts (settings reader)
packages/ui/src/renderer/
├── terminal/terminal-url.ts        re-exports core's grammar
├── terminal/file-link-provider.ts  scanLinkLine; late answers reach xterm (FR-123)
├── terminal/hovered-link.ts        delegates to linkHoverText
├── editor/link-decorations.ts      web spans via scanLinkLine
├── editor/use-editor.ts            web links in the mousedown handler and the chord
├── editor/content-menu.ts          the web-link run
├── links/link-actions.ts           − defaultAction reader; web route; 'unreachable' notice
└── links/link-menu-items.ts        + webLinkMenuActions, shared with the terminal
```

`daemon`, `persistence` and `ipc-contract` stay untouched. No SQLite migration, no
`LAYOUT_SCHEMA_VERSION` change, no `SHIPPED_DEFAULTS_VERSION` bump — settings leaves only.

### Sequencing for Phase 13

1. **D1 first**, because it is a defect with a reproduction already written: run it, show it, wait
   for confirmation, then fix `join`. The PowerShell form and the membership check follow in parallel.
2. **The click rule and the setting's retirement together**, in one commit: removing the leaf
   without the decision (or the reverse) leaves a build in which the renderer reads a setting that
   no longer exists.
3. **The web grammar's relocation before any editor web-link work**, with `terminal-url.test.ts`
   green and unchanged at that commit.
4. **The existence-check gate** is independent of 2 and 3 and may run in parallel with them.
5. **Docs in the same commit as the behaviour**; the E2E budget is re-read at the end and must read
   570.

### Complexity Tracking — added 2026-09-18

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`MAX_TIMED_OUT_LINK_CHECKS = 2` is a hard-coded limit** (Principle X names *limits*) | An integrity guard, not configuration: it bounds how many Node thread-pool threads an offline share may hold while its `stat` waits out the OS's own network timeout, and the only correct answer is "few enough that saves, reads and watchers never queue behind it". Declared in `core/src/links/limits.ts` beside the per-line cap and unit-tested at its edge. | *A setting*: a descriptor for a value whose mis-setting either starves the process or makes a second offline server's paths answer slowly for no benefit. The same precedent as the per-line cap and 044's `HIGHLIGHT_BUDGET_CHARS`. The timeout, which genuinely differs between networks, **is** a setting (FR-120). |
| **`IExecutableExtensions` keeps no production consumer** (Principle VIII, YAGNI) | FR-114 means the click rule no longer branches on executability, because it never reaches the default program for any file. The port, its contract suite and its Windows implementation stay because FR-039a stays in force and SC-010/SC-013 are driven from its reported set — the test that no gesture runs an executable reads the platform's own list rather than a hand-written one. | *Delete the port*: withdraws FR-039a, a shipped requirement, and SC-010's oracle with it. *Keep a dead clause in the decision*: code that cannot change an outcome. **Reported to the maintainer** (item 6 below) as a decision to confirm, not settled here. |

### Reported to the maintainer — added 2026-09-18

6. **`IExecutableExtensions` is now a test oracle only.** Keep it (as above), or retire FR-039a and
   drive SC-010/SC-013 from a list in the test. Either is defensible; the plan keeps it because
   withdrawing a requirement is the maintainer's call.
7. **Previews still differ.** A preview's link to a file outside the project stays on the current
   file with an inline notice (044 FR-090e); an editor's or terminal's is shown in OS Explorer
   (FR-110). The request named editors and terminals, so 044 is left alone and the difference is
   recorded rather than resolved.
8. **Aliases are judged by name** (FR-106). `Z:\proj\x.ts` for a project opened as
   `\\server\share\proj` is outside the project and is revealed, not opened. Canonicalising would
   need `realpath`, which the symlink edge case (M5) deliberately does not consult.
9. **024 is not edited in place** — S4 is recorded in 045's Supersessions table, on this spec's own
   S1 – S3 precedent and the 021 FR-042 worked example.

---

## Amendment 2026-09-18, second round — wrapped links, one affordance, every flavour, D2

**Input**: the maintainer's second hands-on round (spec *Clarifications*, fourth session): US10,
US11, FR-130 – FR-133, FR-135 – FR-139, FR-140 – FR-145, SC-015 – SC-018, defect D2. Derivations:
[research.md](./research.md) R21 – R23; open items O9 – O11. Tasks: Phase 14.

### Design, one paragraph per strand

**D2 first.** A reported defect starts with a failing test at the lowest layer that shows it
(T174), shown to the maintainer before any fix. The hypothesis order is in spec D2; nothing is
changed on a hypothesis.

**Wrapped links (FR-130 – FR-133).** Today `file-link-provider.ts` reads **one** buffer row
(`getLine(n).translateToString`) and every range it returns has `start.y === end.y`; plain-text URLs
come from `WebLinksAddon`. The design: one terminal link provider reads the **logical line** — walk
back while `line.isWrapped`, forward while the next row is wrapped — runs `scanLinkLine` over the
joined text, and maps each span back to (x, y) cells, so a range may start on one row and end on a
later one; xterm's `ILink.range` is already multi-row. The same provider then serves web links from
`scanLinkLine`'s `web` spans, and `WebLinksAddon` is unloaded — one provider for everything detected,
which is also what makes the affordance uniform (R21). OSC 8 ranges are xterm's own; whether its
hover and click cover a wrapped OSC 8 link's later rows is settled by an E2E case (O9).

**One affordance (FR-135 – FR-139).** The editor keeps its CodeMirror mark and changes its styling to
the tokens (no recolour; dashed at rest; solid on hover; hand pointer only with the modifier). The
terminal draws at-rest marks with xterm decorations over the resolved ranges, and restyles or
replaces xterm's own OSC 8 underline — which one is open item **O10**, because it depends on what
xterm exposes for styling its hyperlink underline. The idle scan (FR-137) is a new module,
`terminal/link-idle-scan.ts`: it subscribes to a **quiet** signal — no write for
`LINK_IDLE_SCAN_MS` — never to the data itself, and on quiet walks the viewport's logical lines
through the same `ask` the provider uses. `link-guards`' per-line cap bounds it; the cache (FR-070)
shares answers with hover.

**Every flavour (FR-140 – FR-145).** No new shell integration for any built-in flavour (R23). One
change is required and is a correction rather than an addition: a terminal's link base directory
must come from `flavourReportsDirectory` — when a flavour cannot report, the base is **absent**, not
the stale launch directory the PEB poll returns (FR-143). Whether the shipped code already does this
is checked by T188 before anything changes. One gap is already visible by reading: a user-defined
**WSL** flavour is absent from both integration maps, so `flavourReportsDirectory` calls it
observable and its stale `wsl.exe` launch directory would be the link base. T189 adds a platform
answer to "is this flavour WSL?" for the link base only, leaving 025's callers alone (reported to the
maintainer: whether 025's *Reopen in the last directory* should follow). The matrix (FR-145) is the evidence format the running
Playwright probe is checked against (T193).

### Constitution Check — second round

| Principle | Assessment |
|---|---|
| **I, II** | Unchanged in substance. Logical-line joining is renderer-side and names no OS; flavour ids are already data (`windows-shell-detection.ts`). |
| **III / IV** | **Engaged.** 028 FR-007 extended to links (FR-140). No flavour gains shell integration; no key binding changes. |
| **V** | **Engaged.** D2 reproduce-first. E2E: **cases inside existing declarations only**; the one-sentence reason — *only a real xterm renderer with real cell geometry shows whether its OSC 8 underline and its hover across a soft-wrapped row behave, and jsdom has no cell geometry* — and the budget stays **570**. |
| **VI** | **Engaged — this round is Principle VI's *A link MUST show … that it is actionable* made visible at rest.** Plain click still never navigates; the hand pointer appears only with the modifier. |
| **VIII** | **Engaged.** One terminal provider for web and path links retires `WebLinksAddon` — one fewer mechanism drawing links. |
| **X** | **Engaged.** Two theme tokens (FR-138). `LINK_IDLE_SCAN_MS` is an integrity guard — Complexity Tracking. |
| **Themeable icon controls / completeness** | **Engaged.** No icon; two tokens, each with a descriptor in **General** and an inheritance parent. **`SHIPPED_DEFAULTS_VERSION`**: this plan's own Technical Context says the bump is avoided only because 045 added *no theme token*; that premise no longer holds, so T182 bumps it per `shipped-defaults.ts`'s rule and its test. |
| **Documentation currency** | T195. |

### Complexity Tracking — second round

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`LINK_IDLE_SCAN_MS` is a hard-coded interval** (Principle X names *timeouts*) | It decides when output counts as "quiet" so the idle scan cannot run on the output path (FR-071/FR-072). It is an integrity guard: too short and a scan interleaves with a burst of output; too long and marks appear late. No reader has a reason to move it per machine. Declared in `core/src/links/limits.ts` beside its siblings and unit-tested at its edge. | *A setting*: one more descriptor for a value whose only effect of changing is making FR-071 easier to break. Same precedent as the per-line cap. |
| **`WebLinksAddon` unloaded in favour of throng's own provider** | FR-130 needs web links detected on the logical line and FR-135 needs them drawn like every other link; two mechanisms drawing links is how the inconsistency the maintainer reported arose. | *Keep the addon and patch around it*: a second link mechanism with its own hover, its own range logic and its own underline — the drift FR-104 and FR-139 forbid. |

## Amendment 2026-09-18, third round — the maintainer's corpus, run by a probe

**Input**: spec *Clarifications*, fifth session; US12, FR-150 – FR-154, SC-019 – SC-020, defects D3 and
D4. Evidence: [research.md](./research.md) O11 (the probe's matrix). Tasks: Phase 15.

### Design, one paragraph per strand

**Spaces (FR-150)** are a detection change in `core/src/links/detect.ts`: an anchored token also emits
extended readings, longest first, ahead of the unextended one — the same "readings in order, main
decides by existence" shape R7 already uses for positions, so `resolve.ts` and `FileLinkResolver`
need no new concept. The word cap is a named constant in `limits.ts`.

**Git Bash paths (FR-151, FR-152)** need a new `IPathForms` question — map a rooted path through the
installed Git's mount table, or `null` — answered in `platform-windows` from the Git install the shell
detection already finds, and a way to drive-qualify a rooted path against a base. `resolve.ts` gains
the step between the drive forms and the platform's meaning, and its context gains whether the panel
is a WSL flavour (T189's platform answer), so a WSL terminal skips the mount table.

**`file:` URIs (FR-153)** stop being a dead end in `resolve.ts`: a hostless or `localhost` URI whose
decoded path is not drive-qualified re-enters the leading-`/` branch, and a `localhost` URI with a
non-drive first segment appends the loopback UNC reading.

**Dead OSC 8 (FR-154)** is a terminal affordance change on top of T187's marks and O10's OSC 8 route:
xterm's `linkHandler` hover and its own underline are suppressed for a target the click rule cannot
follow, and a `file:` target is marked through the idle scan and cache like a detected path.

**D3 and D4** are defects: reproduce first (T215, T217), fix where the reproduction points.

### Complexity Tracking — third round

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`MAX_PATH_SPACE_WORDS` is a hard-coded limit** (Principle X names *limits*) | It bounds how many extended readings one anchored token can produce, and so how many existence checks a hover or idle scan can spend on one line. An integrity guard beside `MAX_LINK_CANDIDATES_PER_LINE`, unit-tested at its edge. | *A setting*: a descriptor for a value whose only effect of raising is making a hover more expensive. Same precedent as the per-line cap. |
| **WSL Linux-path mapping deferred** (FR-151 excludes a WSL flavour; *Out of scope*) — tracked by open issue [#13](https://github.com/Bidthedog/throng/issues/13) (`enhancement`, `area:terminal`, milestone vNext) | A Linux path printed in WSL names the distro's filesystem (`\\wsl.localhost\<distro>\…`), which needs to know which distro a terminal runs — a flavour property WSL does not have until #13 makes it a first-class flavour. Mapping it through Git's mount table would be wrong, so FR-151 skips that step for WSL rather than guessing. | *Map `/…` in WSL to `\\wsl.localhost\<default distro>\…`*: guesses the distro, and is new flavour modelling this spec does not own. *Apply Git's mount table in WSL too*: sends `/etc/hosts` printed in Ubuntu to Git's `etc\hosts` — a confident wrong answer. |
| **"Is this flavour WSL?" answered in `@throng/core`, not behind the platform abstraction** *(added 2026-09-18, `29b06f66`; a deviation from FR-144's note, T189's wording and this plan's "T189's platform answer" above)* | The question is asked by the **renderer**, at hover time, about a user-defined flavour it already holds in settings; the renderer has no route to `platform-windows` and no synchronous bridge to main. The answer is a pure reading of an executable path — `wsl[.exe]` anywhere, `bash[.exe]` directly inside `System32`/`Sysnative` — the same kind of shell fact `core/src/terminal/command-recipe.ts` already keeps when `flavourReportsDirectory` names `cmd`, `pwsh` and `git-bash`. `isWslExecutable` in `core/src/terminal/wsl-flavour.ts`, unit-tested in `core/tests/unit/wsl-flavour.test.ts`, is the one answer both FR-144 and FR-151 read, so they cannot disagree. It asks nothing of the OS, and `links/` still names no OS (`links-no-os-names.test.ts`). Recorded in [contracts/platform-ports.md](./contracts/platform-ports.md) §6.2. | *A port answered in `platform-windows`*: needs a new renderer-to-main round trip on the hover path for a string test, or a copy of the answer in the renderer — two answers FR-144 and FR-151 could then disagree through. The built-in detection skipping `System32\bash.exe` stays where it is; it answers a different question (which shells to offer). |

---

## Amendment 2026-09-19, round four — syntactic links, five resource classes, the hint, the Link menu, D5

**Input**: spec *Clarifications*, *Session 2026-09-19 (round four)* — the maintainer's feedback on PR
#408 (M1 – M11), the checkpoint answers the same day and the review of the space-rule case table
(`packages/core/tests/unit/link-detect-spaces.test.ts`, RED at `80e13719`, which wins on every edge);
US13 – US16, **FR-155 – FR-179**, **SC-021 – SC-027**, defect **D5**, supersessions **S5 – S11** (S8 – S11 derived during planning and analysis); the
baseline converge's Phase 16 (T225 – T232) as the maintainer mapped it. Derivations: [research.md](./research.md)
**R25 – R35**. Data: [data-model.md](./data-model.md) §16. Contracts: the *round four* section at the
end of each file in [contracts/](./contracts/). Tasks: Phases 17 – 22.

### The one idea

Round three decided a link by asking the disk. Round four decides it by **grammar alone** (FR-155), and
asks the disk only when a person does something deliberate with it — a Ctrl+click, Open Link, the chord,
or opening the Link menu (FR-160, FR-170). Everything else in this round follows from that split:
rendering becomes a pure function of the text in view, so marks no longer wait for quiet output (D5), the
renderer's existence cache, the held reply and the idle scan lose their reason to exist, and the one
place that still touches the disk — `FileLinkResolver` in UI main — gains one per-request deadline
(T226's main half, T227).

### Design, one paragraph per strand

**1. The syntactic link model (FR-155, FR-156, FR-162, FR-173, FR-174, FR-179).** `core/src/links/detect.ts`
gains `detectPathSpans(line, { knownExtensions })` — the entry point the RED test names — implementing
the maintainer's rule exactly as the test file's header encodes it: default stop at the first space;
enclosures (backticks, `"…"`, `'…'`, `()`, `<>`, `[]`, `{}`) taken whole when their contents start like a
path; the forward scan from any candidate that is anchored or contains a separator, ending at the
**first** word that ends in a separator or a known extension, crossing single spaces only, capped at
`MAX_PATH_SPACE_WORDS`; any rooted path a link (`/help`, FR-174). The extended-readings machinery round
three added (readings longest first, main decides by existence — plan *third round*, R24) is **removed**:
there is one reading per span now, plus FR-004's positioned/unpositioned pair, which main still tries in
order at click time. `scanLinkLine(line, options)` (FR-104's one scanner) takes the same options plus the
protocol allowlist and returns web, protocol and path spans with FR-009's "never both" applied once.
FR-156's validation is a new pure `core/src/links/sanitise.ts`: trim, reject C0/C1 controls and NULs
(raw or percent-encoded, `%00`), cut quote-delimited trailing text, and serialise a URI through the WHATWG
`URL` parser so what leaves the renderer is one normalised value. It runs in `scanLinkLine` (before a
span is clickable) **and again** in main before any OS call — the renderer is not trusted to have done it.

**2. Five resource classes and the allowlist (FR-157 – FR-159, S5).** A new pure
`core/src/links/resource-class.ts` answers `resourceClass(span, allowlist, refused)` →
`'web' | 'loopback' | 'unc' | 'onDevice' | 'protocol' | null`. Loopback is recognised separately only so
the tests can name it; it routes exactly as web. The allowlist is the setting
**`editor.links.protocolAllowlist`** — `string[]`, default `['mailto', 'tel', 'slack']`, compared without
case, `control: 'array'` / `itemControl: 'text'` / `clearable: true` under Editor · Links. The **refused
set** is two halves: the OS-neutral half (`javascript`, `data`, `vbscript`, `file`, `about`, `blob`) is a
frozen constant in `core/src/links/refused-schemes.ts`; the OS-specific half (`ms-msdt`, `search-ms`,
`search`, `ms-officecmd`, `ms-appinstaller`, `ms-cxh`, …) comes from a new Principle II port
**`IRefusedUriSchemes`** implemented in `platform-windows`, with a contract suite in `core/src/testing/`.
The refused set is applied **after** the allowlist, so adding `ms-msdt` to the allowlist has no effect
(FR-159). "Every scheme whose handler executes a file" is realised as that curated platform list (R27);
reading handler registrations from the registry at click time was rejected. Main enforces the policy on a
**new** channel, `throng:linkUri:openExternal`, with a new predicate `isAllowedLinkUri(url, allowlist,
refused)` in `ui/src/main/external-url.ts`. The existing `throng:openExternal` (About, window-open guard)
and `throng:preview:openExternal` (044 FR-091) keep their predicates **unchanged** — so
`packages/ui/tests/unit/external-url.test.ts` still must not change (tasks *Notes*); new cases go in
`packages/ui/tests/unit/external-link-uri.test.ts`. The allowlist is read from settings on each request,
so a change takes effect on the next gesture with no restart. FR-038's de-elevation is **not** extended to
protocol handlers this round (spec *Clarifications*, reported gap).

**3. Resolution only at click and menu-open (FR-158, FR-160, FR-161, FR-176, FR-177, T226, T227).**
A follow classifies first (pure). Web, loopback and protocol links go straight to
`throng:linkUri:openExternal`. A UNC or on-device link is sent to `FileLinkResolver` in UI main, which tries
FR-022 – FR-025's readings in order — with **FR-176** applied: a drive form (`/<letter>/…`,
`/mnt/<letter>/…`) maps to its drive **only**, the project-root reading is not tried for it
(`resolve.ts:79`'s order changes; `link-resolve.test.ts:170-173` and `:367` change with it, permitted by
FR-176) — and, per **FR-177**, drive forms map in every flavour including WSL (the code already does; a
test pins it). The first reading that exists **inside the project** opens in throng (FR-160). If none
exists and the first reading is in the project, one notice names the path (FR-160); otherwise the parent
folder of the first reading goes to `revealInFileManager` with **no** existence check (FR-158) — the
reveal policy `throng:links:reveal` loses its existence re-check for that case. `locate` gets **one
deadline per request** (`existenceCheckTimeoutMs`, total across every reading and root — T226's main
half and T227), sharing FR-121's per-root gate and FR-122's back-off. T226's renderer half (a late
answer after the held reply) is **moot**: nothing held remains. The Link menu makes the same single
bounded resolution when it opens (FR-170) and opens when the answer or the deadline arrives.

**4. Marks from the rows in view, and D5 (FR-164, FR-172, T228).** D5 first: a reproducing unit test over
a fake terminal whose output never goes quiet and which switches buffers — RED against today's
`link-idle-scan.ts`, shown to the maintainer before any fix (the replicating-bugs gate). The fix replaces
the idle scan with `terminal/link-view-marks.ts`: subscribed to xterm's `onRender` (rows drawn) — never to
output data — it recomputes the marks for the logical lines in view through `scanLinkLine` (pure, no
ask, no cache), **throttled** to `LINK_MARK_THROTTLE_MS` (100 ms, `core/src/links/limits.ts`), trailing
edge guaranteed so the last frame is always marked; on `buffer.onBufferChange` it drops every decoration
and rebuilds for the new buffer (no mark survives a switch). `link-marks.ts` draws the **hover** mark from
the link xterm reports hovered (the provider's `hover`/`leave` callbacks carry the range) instead of
looking it up in `viewLinks` — which closes T228, the same gap — and the hand pointer is shown whenever a
valid link is hovered, modifier or not (FR-164): `LINK_MARK_POINTER_CLASS` stops depending on Ctrl, and
the editor's link mark gets `cursor: pointer` unconditionally. OSC 8 links keep round three's O10 route;
their marks come from the same view pass (their ranges are xterm's, read from the buffer's link ids).

**5. The link hint (FR-165, FR-166, S6).** One component, `renderer/links/link-hint.tsx`, fed by a
module-level store `renderer/links/link-hint-store.ts` that holds **at most one** hint per renderer
(`show` replaces, `hide` clears). "At most one in the whole app" across windows is kept by hiding on the
window's `blur` — a click in another window blurs this one first (R29). Placement: the anchor is the
bottom-right corner of the link's **last** row (a zero-size rect at `{right, bottom}` of that row's
cells, or of the CodeMirror/preview range's last client rect), positioned through the **existing**
`renderer/common/clamp-to-viewport.ts` — already shared by `workspace/context-menu.tsx` and
`common/colour-picker.tsx` — so there is still one place "keep it on screen" is decided (FR-165c; no
copy). It is `pointer-events: none`, never focusable, `role="status"` with `aria-live="polite"`
(FR-165a); it hides after `LINK_HINT_MS` (2,500 ms, `limits.ts`), on any Ctrl keydown, on any link
Ctrl+click, on another hint, on scroll and on blur (FR-165d). Each surface calls `showLinkHint` from its
existing plain-click path only when the click did not drag (pointer moved < the drag slop the editor
and xterm already use) and the link's kind is enabled for that panel type (FR-165e, FR-165f): the
terminal in `terminal-link-activation.ts`, the editor in `use-editor.ts`'s mousedown/mouseup pair, the
preview in `preview-panel.tsx`'s link click handler. The plain click is never prevented — the hint is
additive (FR-165a). Three theme tokens — `linkHintBackground`, `linkHintText`, `linkHintBorder`, each
with a descriptor and an inheritance parent — so **`SHIPPED_DEFAULTS_VERSION` 10 → 11** (the additive
theme-token case `shipped-defaults.ts` records; an existing install otherwise never receives them).

**6. Tooltip and hint wording (FR-168).** `core/src/links/hover-text.ts`'s `linkHoverText` gains the
resource class and the open-target preference (`editor.openTarget`: `lastActive` → "active editor",
`new` → "new editor") and returns the FR-168 table: *Ctrl+Click to open in throng active editor* / *…new
editor* / *…to open in throng preview* / *…to show in OS Explorer* / *…to open in system browser* /
*…to open with the <scheme> handler*. The hint's text is the same string (one function, FR-168). At
hover time an on-device path's destination is not known without the disk, so the wording is chosen from
the **grammar**: a path that would lie in the project by name (FR-106's membership test, pure) is worded
as the editor/preview it would open in; anything else as "show in OS Explorer" (R30).

**7. The status-bar target readout (FR-167).** The preview's readout (`preview/preview-status-bar.tsx`,
044 FR-118 — the `editor-status-strip__group--readouts` group with its ellipsis rule in `preview.css`)
is extracted to `renderer/common/link-target-readout.tsx` and used by all three status bars:
`preview-status-bar.tsx` (unchanged output), `editor/status-strip.tsx` and `terminal/terminal-status-bar.tsx`,
placed after any persistent content in the leading group. Each panel publishes its hovered link's full
target (the grammar's address, or an OSC 8 link's declared target — never its text) through the hovered
state it already keeps (`terminal/hovered-link.ts`, the editor's link tooltip state); the readout is not
rendered when that status bar is hidden, so nothing is measured or written then.

**8. The Link menu (FR-169 – FR-171, FR-175, S7).** One builder, `core/src/links/menu.ts`'s
`buildLinkMenu(resolution, context)`, returns FR-170's items in order with each item's section and
offered/disabled state; `renderer/links/link-menu.ts` turns them into `MenuAction[]` (the Open In ▸
submenu uses `context-menu.tsx`'s existing `submenu`, with one row per open editor from
`editor/open-in-targets.ts`) and is rendered by the **existing** `workspace/context-menu.tsx` through
`useContextMenu` — one menu renderer, one style (Principle VIII). What makes it "separate from the
panels' context menus" is the opening rule, in one function `renderer/links/open-link-or-panel-menu.ts`:
a right-click or `menu.open` over a link with no selection opens the Link menu **instead of** the
panel's menu; with a selection, or away from a link, the panel's own menu opens unchanged (FR-171). The
three content menus — `terminal/terminal-content-menu.ts`, `editor/content-menu.ts`,
`preview/content-menu.ts` — **lose** their link runs; `core/src/terminal/link-menu.ts` and
`renderer/links/link-menu-items.ts`'s per-surface builders are folded into the one builder. The copy item
is **Copy Link to Clipboard** everywhere (FR-175; constitution v5.5.2), id `copyLink`, test id
`menu-item-Copy Link to Clipboard`. **Open Program** is offered only for an executable
(`IExecutableExtensions`, FR-039a — which gives that port a production consumer again, closing
*Reported to the maintainer* item 6's tension) and **Open in OS Default Program** only for a
non-executable file. A preview's in-document anchor link offers Open Link and Copy Link to Clipboard only
(R31). Unresolved links offer Open Link, Open in OS Explorer (UNC/on-device) and Copy Link to Clipboard.

**9. Known file extensions — the stored shape (FR-178). DECIDED: store the user's edits against the
shipped default, not the resulting list.** *(Reversed 2026-09-20 by the maintainer — round five, FR-182:
one list holding the extensions themselves, because the control has to show them. The strand below is
kept as written; its rationale is now the recorded cost, FR-182c / R36.)* `editor.links.knownFileExtensions` becomes an object with two
leaves, each an `array`/`text`/`clearable` control under Editor · Links:

| Leaf | Default | Meaning |
|---|---|---|
| `editor.links.knownFileExtensions.added` | `[]` | extensions the user adds to the shipped list |
| `editor.links.knownFileExtensions.removed` | `[]` | shipped extensions the user removes; `*` removes every shipped one |

The set detection receives is `(KNOWN_FILE_EXTENSIONS ∪ added) − removed`, computed by a pure
`resolveKnownExtensions(shipped, edits)` in `core/src/links/known-extensions.ts` (beside the constant the
RED test imports), each entry trimmed, lower-cased and stripped of one leading dot, empties dropped. The
renderer recomputes it on every settings broadcast, so a change reaches the next view pass and the next
editor decoration pass with no restart, in terminals and editors alike. **Rationale.** The settings file
materialises full values; a list stored whole freezes at the moment the user first edits it. This
codebase's only answer to a changed list default is a `SHIPPED_DEFAULTS_VERSION` bump with a frozen
copy and a deep-equality guard (`V4_EXCLUDE_GLOBS`, 033 FR-070b) — which by design **skips every user
who has customised the list**, the very users who care about extensions. A delta lets every extension
throng ships later reach every user, customised or not, with no migration and no bump, and it is the
maintainer's own model ("they can add to it or remove from it"). FR-178's other clauses hold: *Reset to
Defaults* empties both leaves, which restores the shipped list; an **empty effective set** is honoured
and reachable in one entry (`removed: ['*']`), after which FR-173e never applies; entries are compared
without case and accepted with or without a dot; the control is the existing string-list editor, so no
new control is built. The `removed` descriptor's text lists the shipped extensions, generated from the
constant so it cannot drift. **Not the allowlist's shape**: `editor.links.protocolAllowlist` stays a
whole list on purpose — a later release must never silently widen which schemes a user's throng hands to
the OS (R28). Recorded in the spec as a derived clarification amending FR-178's "a list of extensions".
No `SHIPPED_DEFAULTS_VERSION` bump is owed by either setting (both are filled by the tolerant parse);
the bump in strand 5 is for the theme tokens.

**10. The OS reason in the refused notice (T229, FR-036).** `IShellIntegration.revealInFileManager` and
`openWithDefaultProgram` return `{ ok: false, reason }` instead of throwing it away; `FileLinkResolver`
(`file-link-resolver.ts:132-134`, `:154-156`) carries `reason` on `LinkActionOutcome`'s `'refused'` arm,
and `link-actions.ts`'s one notice appends it through the failure-cause model's existing wording
(`common/notice-text.ts`). The shell-integration contract suite gains the failure case.

**11. Descriptors (T232, FR-060/061, FR-155).** `editor.links.detectInEditors` and
`editor.links.detectInTerminals` stop saying "name a file or folder that **exists**" (FR-155) and say
only detected paths are affected, web links and protocols staying followable (FR-101).
`editor.links.existenceCheckTimeoutMs` is re-worded to what it now bounds: the check made when a link is
followed or its Link menu opens (FR-161).

### What is removed

| Removed | Why | Tests removed or rewritten with it |
|---|---|---|
| `terminal/link-idle-scan.ts`, `LINK_IDLE_SCAN_MS` | FR-172 supersedes FR-137's quiet gate; it is D5's cause | `ui/tests/unit/terminal-link-idle-scan.test.ts` deleted; its still-true cases (never reads output data; bounded per line) move to `terminal-link-view-marks.test.ts` |
| The held reply in `terminal/file-link-provider.ts`, `LINK_ANSWER_DEADLINE_MS`, the detected-path `ask` on hover | No existence check at render (FR-155); `provideLinks` answers synchronously from the grammar | `ui/tests/unit/terminal-file-link-provider.test.ts` — held-reply, superseding and deadline cases deleted; synchronous-answer cases added |
| `renderer/links/link-cache.ts`, `LINK_CACHE_TTL_MS`, `invalidateLinksUnder` | Nothing caches an existence answer: a follow resolves fresh, so there is nothing to invalidate. **T225 is withdrawn** (R32) | `ui/tests/unit/link-cache.test.ts` deleted; `core/tests/unit/link-guards.test.ts` loses the TTL and idle-interval edges |
| Round three's extended readings (longest first) in `detect.ts` | FR-173/FR-179 pick one span by grammar | `core/tests/unit/link-detect.test.ts` extended-reading cases rewritten to `detectPathSpans`; `link-detect-spaces.test.ts` is the oracle |
| The link runs inside the three content menus; `core/src/terminal/link-menu.ts` | FR-169's one Link menu | `core/tests/unit/link-menu.test.ts`, `terminal-link-menu.test.ts`, component menu tests rewritten against the Link menu |
| "Copy Link Address" (label, id `copyLinkAddress`, test id `menu-item-Copy Link Address`) | FR-175 | every file `git grep "Copy Link Address"` lists outside `specs/` and the constitution's history block |
| Existence-based marking in `editor/link-decorations.ts` and `use-editor.ts` | FR-155 | `ui/tests/component/link-decorations.test.ts` and `editor-link-gestures.test.ts` cases that expect an unresolved path to be unmarked are rewritten |

`MAX_LINK_CANDIDATES_PER_LINE` stays (it bounds decorations per line, not checks), `MAX_PATH_SPACE_WORDS`
stays (it bounds the scan, FR-179d), `MAX_TIMED_OUT_LINK_CHECKS` stays (click-time checks). Their JSDoc
is corrected to say what they bound now.

### Constitution Check — round four (v5.5.2)

| Principle | Assessment |
|---|---|
| **I** | **Engaged, tightened.** An in-project file still opens in throng in any spelling (FR-160); everything else goes to the OS, and nothing out of project ever opens in throng. |
| **II** | **Engaged.** The OS-specific refused schemes sit behind the new `IRefusedUriSchemes` port with a contract test; `core/src/links/` still names no OS (`links-no-os-names.test.ts` must stay green, and is extended to `refused-schemes.ts` and `known-extensions.ts`). |
| **III / IV** | **Not engaged / cleared.** No spawn path changes; no new chord. `menu.open` opens the Link menu over a link — the binding is unchanged. |
| **V** | **Engaged.** D5 reproduces first (RED, shown, then GREEN). The space-rule table is already RED at `80e13719`. Every strand is TDD at the lowest layer: grammar, classes, sanitising, allowlist, known-extension resolution, wording and the menu builder are **unit**; the refused set's OS half is **contract**; the hint, the readout and the Link menu's opening rule are **component**; `FileLinkResolver`'s per-request deadline is **integration**. **E2E budget stays 570 / @terminal 107**: the three things only a real renderer shows — the hint over real xterm cell geometry, the hand pointer without Ctrl, and marks after a real alternate-screen switch — are **cases inside existing declarations** (`terminal-link-once.e2e.ts`'s plain-click and alternate-screen tests; the OSC 8 halves through `osc8HalfRuns`). No declaration is added, so no re-seed. |
| **VI** | **Engaged — the round is Principle VI.** A plain click keeps its meaning and gains a hint rather than a dead end; the hand pointer says "actionable" without a modifier; *every panel action has a menu item* holds through the one Link menu; Copy Link to Clipboard is the constitutional label (v5.5.2). *One condition, one notice*: FR-160's not-found is one notice owned by `link-actions.ts`. |
| **VII** | **Not engaged.** Nothing writes a user file. |
| **VIII** | **Engaged.** DRY: one Link menu builder replaces three runs; one clamp function; one readout; one wording function. YAGNI: the cache, the held reply and the idle scan are deleted rather than kept idle. `IExecutableExtensions` regains a production consumer (Open Program). |
| **IX** | **Engaged lightly.** `IRefusedUriSchemes` is bound in UI main's composition root; `FileLinkResolver` and the new external-link handler take it and a settings reader by constructor. |
| **X** | **Engaged.** Two settings (allowlist; known-extension edits) with descriptors; the timeout stays a setting. Two new named intervals — `LINK_MARK_THROTTLE_MS`, `LINK_HINT_MS` — are Complexity Tracking rows, on the per-line-cap precedent. |
| **XI** | **Not engaged.** No pane, tab or panel change. |
| **Configuration-editor completeness / themeable controls** | **Engaged.** Three leaves added, three theme tokens added — each with a descriptor; `settings-metadata.test.ts` and the theme-descriptor completeness test enforce it. `SHIPPED_DEFAULTS_VERSION` 10 → 11 for the tokens. |
| **Documentation currency** | **Engaged.** `README.md`, `docs/quick-start.md` and `CHANGELOG.md` change in the same commits as the behaviour; `.claude/agents/throng-renderer-ui.md` loses "Copy Link Address". |
| **Displayed quantities digit-grouped** | Descriptor text naming `2,500` ms or `100` ms uses grouping where it applies. |

**Result: PASS**, with the Complexity Tracking rows below and one reported gap (protocol handlers are not
de-elevated).

### Sequencing for Phases 17 – 22

1. **D5 first** (Phase 17): its reproducing unit test is written, run RED and shown before
   `link-idle-scan.ts` is touched.
2. **The grammar** (Phase 18) turns the committed RED table green; the known-extension setting lands in
   the same phase because `detectPathSpans`' option is its consumer.
3. **Classes, sanitising, allowlist and resolution** (Phase 19), including T226/T227, T229, T230, T231.
4. **Rendering without the disk** (Phase 20): marks from the view, the hover mark, the pointer, and the
   removal of cache, held reply and idle scan — after Phase 18, because the view pass calls the new
   grammar.
5. **The hint, wording, readout and Link menu** (Phase 21), with the relabel.
6. **Docs, E2E cases, budget re-read, gate** (Phase 22). The E2E cases go last so they drive the finished
   surfaces; the budget must still read 570 / @terminal 107.

`daemon`, `persistence` and `ipc-contract` stay untouched. No SQLite migration and no
`LAYOUT_SCHEMA_VERSION` change; one `SHIPPED_DEFAULTS_VERSION` bump (10 → 11) for the hint's tokens.

### Complexity Tracking — round four

| Violation / tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`LINK_MARK_THROTTLE_MS` (100) is a hard-coded interval** (Principle X names *timeouts*) | It bounds how often the view pass may run while a program repaints continuously (Claude Code's spinner redraws many times a second). An integrity guard: SC-021's "marked within one throttle interval" is stated against it, and no user has a reason to move it per machine. Declared in `core/src/links/limits.ts`, unit-tested at its edge. | *A setting*: a descriptor whose only effect is trading CPU on the render path for mark latency. *Unthrottled*: a scan per frame on the render path, what FR-072 exists to prevent. |
| **`LINK_HINT_MS` (2,500) is a hard-coded interval** | The spec fixes it as a named interval, not a setting (spec *Clarifications*, derived): reading time does not depend on the machine, which is the line Principle X draws. | *A setting*: nobody tunes a hint's lifetime; the timeout it is contrasted with differs between networks, this does not. |
| **The refused schemes' OS half is a curated list**, not a live query of registered handlers | "Every scheme whose handler executes a file" cannot be decided from the scheme name, and reading the registry per click is OS work on the click path with its own failure modes. The curated list is a Principle II port with a contract test, so it is reviewable in one place (R27). | *Registry query*: slower, and a handler registered after the check would be trusted. *Refuse every non-allowlisted scheme and stop*: already true — the refused set exists for the case where a user allowlists a dangerous one, which a query would not make safer. |
| **Known extensions are stored as edits, not as the list** (FR-178 names "a list") | Later-shipped extensions must reach users who have customised the set; the whole-list shape plus a frozen-copy upgrade skips exactly those users (strand 9, R28). | *Whole list + `planSettingsUpgrade` guard*: the `excludeGlobs` precedent, which by design never reaches a customised install. |
| **Protocol handlers are not de-elevated** (FR-038 names two targets) | Widening FR-038 to the open-external seam is a maintainer decision (spec *Clarifications*). Tracked in *Reported to the maintainer* below and by an open issue filed at closeout (T282). | *De-elevate silently*: extends a requirement nobody approved. |

### Reported to the maintainer — round four

10. **Protocol handlers run with throng's elevation.** An allowlisted `mailto:` launched from an elevated
    throng runs its handler elevated; FR-038 covers Open in OS Default Program and reveal only.
11. **T225 is withdrawn, not built.** With no render-time existence answer there is no cache to
    invalidate; a follow always resolves fresh (R32).
12. **The known-extension setting is two leaves** (`added`, `removed`) rather than one list, so later
    shipped extensions reach customised installs (strand 9). The maintainer's model — "add to it or
    remove from it" — is what is stored.

### Corrections after analysis — round four *(2026-09-19; the text above is kept, these supersede it where they differ)*

- **Strand 2 — `file` is not in the set classification reads.** The OS-neutral refused half that
  `resourceClass` applies is `javascript`, `data`, `vbscript`, `about`, `blob`. `file:` is class 3
  (FR-157) and is classified before any refusal; refusing it is FR-037's rule and lives only in
  `isAllowedLinkUri` on `throng:linkUri:openExternal`. (T251, T252.)
- **Strand 2 — the renderer applies the platform's refused set to drawing.** Main answers
  `throng:linkUri:refusedSchemes` (an `ipcMain.handle` over `IRefusedUriSchemes`); the renderer asks once at
  startup (`renderer/links/refused-schemes-client.ts`) and unites the answer with core's half before
  every `scanLinkLine`. Until it answers, only core's half shapes drawing and main still refuses every
  click (research R34). An allowlisted `ms-msdt` is therefore not a link (FR-159, US13 scenario 8).
  (T287, T288.)
- **Strand 1 / 3 — main sanitises every route.** `FileLinkResolver` applies `sanitiseLinkTarget` to every
  request (reveal, open in throng, default program, Open Program), not only the external opener
  (FR-156). (T255, T256.)
- **Strand 3 — reveal on itself.** A trailing-separator location or an OSC 8 target the program declared a
  folder is revealed as itself, not its parent (FR-158). (T255.)
- **Strand 4 — OSC 8 has a source in the view pass.** `link-view-marks.ts` takes a second source,
  `oscLinksInView()`, reading xterm's OSC 8 link ranges for the rows in view, so deleting the idle scan
  does not drop FR-136's OSC 8 at-rest mark. An OSC 8 target is judged by `resourceClass` only: a `file:`
  target is marked, hovered and worded **without asking main** (FR-163), an allowlisted scheme is a link,
  and `pendingOscHover` / `hoveredLinkFromUri`'s ask (`use-terminal.ts:501-514`, `:1107-1110`) are
  deleted. The sentence "OSC 8 links keep round three's O10 route" holds for the underline's styling
  only. (T237, T285, T286.)
- **Strand 5 — scroll.** The hint hides on a scroll the **user** makes (wheel, scrollbar, a scrolling
  key), never on output scrolling the terminal (FR-165d's note). (T268.)
- **Strand 6 — the preview's tooltip adopts `linkHoverText`** (FR-168's note), so the hint and the
  tooltip never word one preview link two ways. (T267.)
- **Strand 8 — the chord.** The Link menus are identical in items, order, labels and enablement; the
  Open Link chord is shown only where bound (FR-169's note, SC-025).
- **Sequencing step 1** — T235 / T236 declare two constants and change no behaviour, so they may land
  before the D5 gate (T234); Phase 18 does not depend on them.

### Corrections after analysis, second pass *(2026-09-19; supersede the text above where they differ)*

- **Strand 3 — the follow rule, restated** (spec FR-158a, FR-160's note). Under one FR-161 deadline,
  `locate` tries the readings in order; **the first reading that exists decides**, wherever it lies: in
  the project → open in throng; outside → one file-or-folder check (the same `stat`) picks a folder
  **as itself** or a file's parent with it selected. Only when no reading exists does the first reading
  decide: in the project → the one notice; outside → its parent to OS Explorer. This replaces strand 3's
  "first reading that exists **inside the project**" and "without an existence check" for the reveal.
  A trailing separator or an OSC 8 folder target opens as a folder with no check.
- **Strand 1 — one detector.** `detectPathCandidates` is rebuilt on FR-173 / FR-179 (it keeps returning
  `LinkCandidate`s with ranges and positions, which `scanLinkLine` needs); `detectPathSpans` is a thin
  view over it returning the trimmed span texts. So the RED table and SC-003's prose guard exercise the
  same code `scanLinkLine` runs.
- **Strand 1 — the word cap counts the whole span**, starting token included (FR-179f); the JSDoc of
  `MAX_PATH_SPACE_WORDS` and `detect.ts:150`'s loop change to say and do so.
- **Strand 10 — field name.** `reason` is already `LinkActionOutcome`'s discriminant; the OS's words
  travel as **`osReason?: string`** on the refused arm, and `IShellIntegration`'s failure is
  `{ ok: false; osReason: string }`.
- **Research R27's list** still names `file` in core's half: superseded by the first-pass correction —
  `file` is refused only at the external opener.

### Corrections after analysis, third pass *(2026-09-19; supersede the text above where they differ)*

- **Strands 6 and 8 — the surface decides what a follow does, and so what it says.** `linkHoverText`
  takes a **destination**, not a class: editors and terminals compute it from FR-157 / FR-160 by name
  (R30); the Markdown preview computes it from 044's follow (S6) — `preview` (in-project file),
  `heading` (in-document anchor, "Ctrl+Click to go to the heading"), `stays` (044 FR-090e's
  notice, "Ctrl+Click to follow"), `browser`, `handler`. `buildLinkMenu`'s Open Link carries no
  behaviour of its own: each surface passes the function its Ctrl+click runs, so Open Link and the
  gesture cannot diverge (Principle VI; spec FR-169's note).
- **Strand 2 — `scanLinkLine` takes `refused`.** Its options are `{ knownExtensions, allowlist,
  refused }`; core's refused half (`core/src/links/refused-schemes.ts`) is created with T245 so T244 can
  assert against it; the renderer later passes the union from `refused-schemes-client.ts` (T288).
- **Strand 3 — outcome names.** The follow's outcomes are data-model §16.10's; `gone` on the wire maps
  to `not-found-notice` and stays the IPC value, so no `ipc-contract` change is needed.

### Corrections after analysis, fourth pass *(2026-09-19; spec *Decisions taken while analysing round four*)*

- **Strand 8 — unresolved links draw targets disabled** (FR-170a). `buildLinkMenu` gains a grammar-only
  applicability input (in project by name; provider by extension; executable by extension through
  `IExecutableExtensions`, answered by main in the same menu-open request) and, when `resolution` is
  `null`, emits those items with `disabled: true`. Absent stays for web, loopback, protocol and anchor.
- **Strand 3 — folders** (FR-160a): the first existing reading that is a folder opens as itself in OS
  Explorer wherever it lies; only an in-project **file** opens in throng. An in-project first reading that
  times out yields FR-124's "did not answer" notice.
- **One scheme gate** (Principle VIII). `core/src/links/classify.ts`'s `classifyTerminalLinkTarget`
  (web | file | inert) is retired into `resourceClass`; its call sites — `terminal-link-activation.ts`
  (`activateTerminalHyperlink`, `hoveredLinkFromUri` at `:131` with its hover-time `drawn` resolution,
  which FR-163 withdraws), `link-marks.ts:142`, `link-actions.ts:160`, `use-terminal.ts:507,571,1108` —
  read `resourceClass`, and `activateTerminalHyperlink` gains the protocol route through
  `throng:linkUri:openExternal`. (T289, T290.)
- **Strand 1 — the protocol grammar has its own module**, `core/src/links/protocol-uri.ts` (FR-159a), so
  `web-url.ts` and `link-web-url.test.ts` stay unchanged.
- **Constitution Check row II** — `known-extensions.ts` names extensions such as `exe` as a syntactic hint
  for where a path ends; FR-178b carves it out of FR-039a and the guard names the exemption. Executability
  is still decided only behind `IExecutableExtensions`.
- **Strand 5 — the preview's click handler** is in `preview/providers/markdown/markdown-body.tsx`
  (`:601-653`), not `preview-panel.tsx`.
- **Strand 7 — the readout** shows FR-167a's first reading.

### Corrections after analysis, fifth pass *(2026-09-19)*

- **Derivations** for round four are research **R25 – R35** (the header, which first read R25 – R33, is corrected).
- **Open Program** (FR-170, S8) is `IShellIntegration.openWithDefaultProgram` on an executable — the same
  seam and the same de-elevating launcher as Open in OS Default Program (FR-038's extension), sent through
  `FileLinkResolver` like every file action. For an executable, Open in OS Default Program is not offered.
- **The menu opens at once** (FR-170b): the renderer builds it in FR-170a's state, then re-renders the
  open menu when main's menu-open answer arrives (`workspace/context-menu.tsx` takes new `items` while
  open); a late answer after close is dropped. Main's reply for an unresolved link carries
  `executableByExtension` and `previewByExtension` so the disabled items are the right ones.
- **Hint token parents** (T270): `linkHintBackground` → `surfaceActive`, `linkHintText` → `text`,
  `linkHintBorder` → `border`.

### Corrections after analysis, sixth pass *(2026-09-19)*

- **Reveal checks** (spec FR-158b, S10): `throng:links:reveal` keeps FR-035a's re-resolution from the
  request but replaces its "exists before acting" re-check with FR-158a's file-or-folder check; a missing
  location is revealed on its parent, never answered `gone`. Open in throng, Open in OS Default Program and
  Open Program keep FR-037's re-check.
- **The menu before main answers** (FR-170c): renderer-known rows only; rows 5/6 wait for main; the answer
  may add, enable or remove rows. `context-menu-provider.tsx` gains an update of the open menu's items.
- **Folding the old builders**: `core/src/links/targets.ts` and `fileLinkMenuItems` are absorbed by
  `buildLinkMenu` (T275) and deleted with `core/src/terminal/link-menu.ts` only after T277 has moved every
  caller, so no commit leaves a dangling import.

### Corrections after analysis, seventh and eighth passes *(2026-09-19)*

- **Strand 6 — folders by grammar** (spec FR-168b): the project root and a path ending in a separator are
  worded "show in OS Explorer" without the disk; any other in-project folder is the third by-name trade
  (research R35). A relative folder by grammar reveals its first reading unchecked (FR-158c).
- **Strand 8 — the menu before main answers** is FR-170c (renderer-known rows; a folder by grammar gets no
  Open In ▸ / Open Preview).
- **Constitution Check row V — E2E**: besides `terminal-link-once.e2e.ts`, `terminal-links.e2e.ts` is
  brought into line with FR-155 / FR-163 inside its existing declaration (T292). D5's never-quiet half
  is asserted in the plain-click declaration, which the hosted gate runs; its buffer-switch half sits in
  the alternate-screen declaration, which calls `skipIfElevated()` and so runs locally only — at the gate
  it is held by T233 and quickstart §10 row 9. The budget still reads 570 / @terminal 107.

### Corrections after analysis, ninth pass *(2026-09-19)*

- **The renderer's follow path** (was missing). `renderer/links/link-actions.ts`'s `followLink` today takes
  a synchronous `resolve` that returns a cached or drawn answer and does nothing without one. With the
  cache, the hover ask and the decoration answer gone, it becomes **async**: it awaits one bounded
  `window.throng.links.resolve(request)` (the existing `throng:links:resolve` invoke — no new channel),
  then branches on the reply:
  - `ok`, a **file in the project** → open in throng by the click rule (editor or preview);
  - `ok`, a **folder**, or a file outside the project → `throng:links:reveal` (FR-158a / FR-158b);
  - failure, **no `reason`** (not found): first reading in the project by name → FR-160's notice;
    otherwise `throng:links:reveal`, which reveals the parent unchecked (FR-158b);
  - failure, `reason: 'unreachable'`: in the project by name → FR-124's "did not answer" notice;
    otherwise `throng:links:reveal`.
  So data-model §16.10's outcomes are the renderer's branches, and "`not-found-notice` travels as `gone`"
  (§16.11) is superseded: it travels as `LinkResolution`'s failure arm with no `reason`. `HoveredLink`
  loses its resolved `link` (nothing resolves at hover) and keeps the grammar's request and position.
  Tasks T293 (RED) and T294 (GREEN).
- **Constitution Check row IX**: `FileLinkResolver` does **not** take `IRefusedUriSchemes`; the two
  consumers are the `throng:linkUri:openExternal` and `throng:linkUri:refusedSchemes` handlers
  (contracts `platform-ports.md` §7.1).
- **SC-004** was measured when nothing ran during streaming; FR-172's view pass runs while output
  streams, so SC-004 is re-measured after T237 (T295).

### Corrections after analysis, tenth pass *(2026-09-19; supersedes the ninth pass's follow path where it differs)*

- **One main request per follow** (FR-161 "in total per follow"; contracts link-resolution §9.1, §9.6). The
  ninth pass's "await `throng:links:resolve`, then call `reveal` / `open`" made two bounded passes. Instead,
  a Ctrl+click, Open Link and the chord send **one** `throng:links:follow` invoke (new; UI main,
  `FileLinkResolver.follow`), which resolves under the one deadline, performs a reveal itself when that is
  the outcome (FR-158a / FR-158b's single file-or-folder check — the same `stat`, not a second one), and
  replies with data-model §16.10's outcome:
  `{ kind: 'openInThrong'; link }` | `{ kind: 'revealed' }` | `{ kind: 'notFound'; path }` |
  `{ kind: 'unreachable'; path }` | `{ kind: 'refused'; path; osReason? }`.
  The renderer opens `openInThrong` by the click rule — the editor's own load of the file, not a second
  link resolution — and raises FR-160's or FR-124's one notice for `notFound` / `unreachable`, FR-036's
  for `refused`. `throng:links:resolve` stays for the Link menu's one resolution at opening;
  `throng:links:reveal` and `throng:links:open` stay for the menu's explicit items.
- The ninth pass's "reveals the parent **unchecked**" is struck: FR-158b's reveal makes the one
  file-or-folder check; only a folder by grammar (FR-158a's trailing separator, FR-158c) skips it.
- Not-found is `notFound` on `throng:links:follow`; on `throng:links:resolve` (the menu) it remains the
  failure arm with no `reason` (§16.17). `gone` is returned only by `throng:links:open`.

### Corrections after analysis, eleventh pass *(2026-09-19)*

- **The back-off moves to main** (spec FR-122a). data-model §13.5 and contract P10 made FR-122's back-off
  the renderer cache's lifetime; deleting the cache (R32, T265) would have deleted it. `FileLinkResolver`
  now keeps, per volume root, a "left alone until" time set when a stuck `stat` settles, and answers
  `unreachable` without touching the disk until it passes. The interval is `LINK_ROOT_BACKOFF_MS`
  (30,000 — the old cache lifetime) in `core/src/links/limits.ts`. Tasks T255 (RED) / T256 (GREEN).
- **Folders by grammar skip every check** (FR-158d), at a follow and at a menu opening.
- **The Markdown preview feeds the Link menu** by mapping 044's `PreviewLink` kinds
  (`preview/content-menu.ts`): `file` (in project) and `outside` → a `LinkResolutionRequest` with the menu-
  open `throng:links:resolve`, whose answer fills rows 2 – 6 as for the other surfaces; `heading` → the
  anchor rows; `web` → web; `mailto:` → protocol (the preview's own 044 FR-091 policy, S6 addendum);
  `inert` → no Link menu. Open Link runs 044's follow (FR-169's note). T276 pins each SC-025 fixture.

| Violation / tension *(Complexity Tracking, eleventh pass)* | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`LINK_ROOT_BACKOFF_MS` (30,000) is a hard-coded interval** (Principle X names *timeouts*) | An integrity guard: how long an offline root is left alone after a stuck check so repeated clicks do not each wait out the timeout. It is the value FR-122's back-off always had (the cache lifetime), now named for what it does. Unit-tested at its edge. | *A setting*: the timeout that differs between networks is already a setting (FR-120); this only spaces retries. *Drop the back-off*: SC-014 and FR-161 keep it. |

### Corrections after analysis, twelfth pass *(2026-09-19)*

- **Channel names.** The allowlisted-scheme opener and the refused-set query are
  `throng:linkUri:openExternal` (`send`) and `throng:linkUri:refusedSchemes` (`invoke`), exposed as
  `window.throng.linkUri.{openExternal, refusedSchemes}` and registered in `external-url.ts`. They were
  first written in the `throng:links:` namespace, whose contract (`link-ipc.contract.test.ts`, I6) keeps
  that namespace invoke-only and pins its members; every artifact now uses the new names.
  `throng:links:follow` does join that namespace — four channels — and is held to I1/I2 (T293).
- **The back-off map** (FR-122a) is separate from §13.5's stuck-root map: a `Map<root, leftAloneUntil>`
  that does **not** count toward `MAX_TIMED_OUT_LINK_CHECKS`, so two roots in back-off never gate a third.
- **Constitution Check row X**: three named intervals, not two — `LINK_MARK_THROTTLE_MS`, `LINK_HINT_MS`
  and `LINK_ROOT_BACKOFF_MS` (eleventh-pass Complexity Tracking row).
- **The preview's kinds** are 044's `external` / `file` / `outside` / `heading` / `inert`: `external`
  with `http(s)` → web, `external` with `mailto:` → protocol; there is no `web` kind.

### Corrections after analysis, thirteenth pass *(2026-09-19)*

- The `throng:linkUri:*` channels are registered by a **new** `registerLinkUriIpc(ipc: { on; handle }, refused, readAllowlist)` in `external-url.ts`, called from `main.ts` beside `registerOpenExternalIpc`, whose `{ on }`-only signature and test stay unchanged (T258, T288).
- A folder by grammar never consults the back-off: FR-158d wins over FR-122a (spec FR-122a's note).
- Quickstart §10 rows 12 – 13 separate the out-of-project case (straight to OS Explorer, no throng notice) from the in-project one (FR-124's notice).

### Corrections after analysis, fourteenth pass *(2026-09-19)*

- `throng:links:follow` applies `sanitiseLinkTarget` and is the route T293 pins SC-024 and the follow-shaped
  cases through; it answers `rejected` for an I1 refusal and `failed` for a throwing service (data-model
  §16.21). The Link menu builder carries a `pending` state so FR-170c needs no per-surface filtering.

### Corrections after analysis, fifteenth pass *(2026-09-19)*

- `rejected` is only for a malformed or sanitiser-refused request; a terminal with no project, or a stale
  project id, follows as out-of-project (data-model §16.22). T293 pins both renderer arms and the
  unknown-project case. The shared-test-file order puts T294's signature edits before T276 / T277's
  rewrites, so no Phase 20 task waits on Phase 21.

---

## Amendment 2026-09-20, round five — one hover, switches that mean all links, one extension list, D6, a subtler underline

Everything above stands. Round five deletes more than it adds, and its one new mechanism is an *input*
rather than a rule. Spec: *Session 2026-09-20 (round five)*, FR-169a – FR-169b, FR-180 – FR-184, D6,
SC-028 – SC-032. Tasks: **Phase 23** (T296 – T311). Research: **R36 – R40**, with **R28 reversed** and
**R10(a) superseded**.

### Design, one paragraph per strand

**1. One hover (FR-169a, FR-169b).** The hover stops being something throng draws. A native HTML `title`
carries the link's full target on all three surfaces, from the same function that feeds the status-bar
readout, so the two cannot disagree. That deletes the terminal's tip element, its CSS, its two timers,
its leave-grace, its floating-surfaces registration and `terminals.linkHoverDelayMs` — the OS places,
times and dismisses a title, so there is nothing left to configure. FR-168's wording is untouched and
now has exactly one consumer, the plain-click hint the maintainer asked to keep.

**2. The switches mean every link (FR-180).** Each panel type's switch is read at the **entry** of every
producer — the editor's hit scan, the terminal provider, the terminal view pass and the three OSC 8
closures — each returning nothing rather than filtering results afterwards. Gating entry is what makes
"all types" checkable: a kind added later that escapes the switch would have to be produced somewhere
none of these four seams covers, which review can see.

**3. The timeout stays, renamed (FR-181).** The maintainer's question ("is it in use? if not, remove it")
has an answer that reads as a contradiction unless it is written down: nothing checks existence before
drawing a link, and the value still bounds a follow's and a Link menu's resolution. The key is left
alone, because renaming a key silently drops every persisted value — the same mechanism a deliberate
retirement uses.

**4. One extension list (FR-182).** Round four stored a delta so later releases could widen the list;
round five stores the list, because the control has to *show* the extensions. The old shape migrates on
read and disappears on the next write. The cost is recorded rather than solved (FR-182c), and the
inverted empty value is recorded as a trap (FR-182d) because it has already caught one fixture.

**5. D6, fixed without touching the table (FR-183).** The grammar is given one optional fact — "this text
names the directory I am in" — and may end a spaced scan on the longest reading that matches it. No disk
access, no new guess, and the 92-case table stays byte for byte. The predicate lives in the renderer
because core may not know that `/d/git/x` and `D:\git\x` are the same place (Principle II).

**6. A subtler underline (FR-184).** `color-mix` on the existing token at rest, solid on hover; the
Markdown preview uses `border` and `syntaxFunction` because its stylesheet may name neither that token
nor a colour function. No new token, and `SHIPPED_DEFAULTS_VERSION` stays at 11.

**7. A bare email address is a `mailto:` link (FR-185, FR-186, D7 — reported after the six above).**
Nothing in `core/src/links` knew what an address was, so it fell through to the path grammar and a
Ctrl+click offered the panel's directory with the address stuck on the end; only the Markdown preview
escaped, because markdown-it autolinks an address before throng sees the text. An address is now a
protocol span with its **scheme supplied** — the span is the address, the target is `mailto:` plus the
address — which reuses class 4's route, menu, wording and allowlist for the cost of one documented
asymmetry (data-model §17.7). The rule the second attempt produced is worth more than the fix:
**claiming a range and publishing a link are different questions**, and the allowlist answers only the
second. Gating the detector on it passed four of six cases and then handed the address back to the path
grammar — the same defect by another route. Six cases, four red and two green controls, written before
the production change (R41).

**8. A readout names nothing rather than the wrong thing (FR-187, D8 — reported after D7).** The hover
title and the status bar said `<project>\tmp` for `/tmp` and then opened the user's temp folder. **No
rule was being broken**: FR-024 / R6 really do try the project root first, but *tried first* is not
*where it goes* — resolution falls through to the mount table, and which reading wins is a fact about
the disk that a hover, which resolves nothing (FR-155), never learns. It cannot be narrowed either,
because `/tmp` and `/help` are one shape by name and the renderer has no mount-table port by design
(Principle II). So a rooted non-drive path now reads out as its own text. The maintainer chose this over
**resolving on hover**, which would tell the whole truth for a `stat` per hovered link and a readout
that arrives late on a slow share — round four's trade, re-opened and re-settled the same way (R42).
Two tests that pinned the old rule are rewritten with notes rather than deleted, and **the plain-click
hint has the same defect and is deliberately not fixed** (item 6 below).

### Constitution Check — round five

| Principle | Verdict |
|---|---|
| **II. Platform-abstracted core** | **Engaged, satisfied.** FR-183's predicate is supplied by the renderer precisely because drive and mount forms are not core's to know; `detect.ts` gains a function type, not an OS name. |
| **V. Test-first (NON-NEGOTIABLE)** | **Engaged, satisfied.** D6 opens with a reproducing test at the lowest layer that shows it — a core unit for the grammar, a ui unit driving the real provider with a working directory — before any production change (T302 → T303). D7 the same, and its case list was shown to the maintainer red before a line of production code moved (T312). Every other strand is unit or component; one E2E declaration is added for what only a real window shows, with the budget raised in the same commit. |
| **VI. Simple, modern, discoverable UX** | **Engaged, satisfied.** One condition, one notice, applied to a hover: three surfaces had three tooltips and now have one, which says an address rather than a promise. The hint still names the gesture, so a plain click is still never a dead end. |
| **VIII. SOLID / DRY / YAGNI** | **Engaged, satisfied.** A deleted tip, a deleted setting, a deleted delta and one accessor per list setting; `resolveKnownExtensions` survives only because the migration needs it, and says so. |
| **X. Externalised configuration** | **Engaged, satisfied, with one deliberate removal.** `terminals.linkHoverDelayMs` is retired because the value it externalised belongs to the OS now — a descriptor for a knob that changes nothing is its own completeness failure. The five `Editor · Links` leaves keep their descriptors and their adjacency. |
| **Docs currency** | **NOT met at the time of writing — tracked as T309.** Round five renames user-facing settings and changes what a switch does, and `docs/quick-start.md`, `README.md` and the unreleased `CHANGELOG.md` entry still describe round four. The gate is stated here rather than quietly passed. |

### Complexity Tracking — round five

| What | Why it is not simpler | Recorded |
|---|---|---|
| A caller-supplied predicate threaded through two option types | The alternative that needs no thread is a grammar that guesses, which FR-173's table exists to prevent; the alternative that needs no predicate is a disk read, which FR-155 forbids | FR-183, R37 |
| The preview styles its underline differently from the other two surfaces | `preview-css-tokens.test.ts` allows its stylesheet neither `linkUnderline` nor any colour function, for the SC-005 contrast gate | FR-184a, R40 |
| A migration function for a setting shape that shipped in no release | The branch is long-lived and the maintainer runs it daily, so a document in the old shape exists on their machine; dropping it silently would reset their list | FR-182a |
| One span whose `uri` is not its own text | The alternative is a fourth span kind for addresses, with its own class, route, menu and wording, for something that behaves as an action protocol in every respect but its spelling. The asymmetry is OSC 8's, already in the model, and is documented where a reader meets it | FR-185a, data-model §17.7, R41 |
| A detector that takes no allowlist while its sibling does | Gating it makes the address a path again the moment `mailto` is removed — D7 by a second route. The asymmetry is the point, and FR-186 states it so the next grammar inherits it | FR-186, R41 |
| A readout that sometimes names no location at all | The alternatives are a guess (D8's cause), a mount table in the renderer (Principle II, and still a guess about a disk), or a `stat` on every hover (round four's settled trade, re-opened and re-rejected). The text as written is the only always-true answer available without the disk | FR-187, R42 |

### Reported to the maintainer — round five

1. **Docs are behind the behaviour** (T309). *(Updated 2026-09-20: `9a13eb87` and `2f966318` brought
   `docs/quick-start.md` and `CHANGELOG.md` up to round five, D7 included. **`README.md:269` is still
   outstanding** — it documents the retired `knownFileExtensions.added` / `.removed` pair.)*
2. **A later-shipped extension will not reach an edited list** (FR-182c). Accepted with the design, not
   a defect; worth remembering the first time the shipped list changes.
3. ~~**`known-extensions.ts` still carries a section header reading "THE SETTING STORES EDITS
   (FR-178a)"**, which round five made untrue.~~ *Fixed in `9a13eb87`, which also records what storing
   the whole list costs and why `resolveKnownExtensions` is still there.*
4. **A constitution clause needs a ruling** (spec *Reconciled, not superseded*, round-five entry):
   Principle VI requires a link to show **on hover** "by which gesture" it is followed. FR-169a's hover
   names no gesture; the hint does, on the plain click. We ship the reading that the clause's purpose —
   never a dead end — is met, and report the question rather than amending the constitution in a round
   that was not about it.
5. **M13 reverses the maintainer's own 2026-09-17 answer** (Clarifications, first session: "Does turning
   off file-link detection for terminals also switch off explicit file hyperlinks? → **No**"). Both are
   theirs; the later one wins and the earlier is marked where it stands. Flagged in case the earlier
   reasoning — a program *chose* to emit a hyperlink, so throng did not guess it — still matters to them.
6. **The plain-click hint has D8's defect and is NOT fixed** (spec FR-187, *Known gap*).
   `clickTargetByName` sends `/tmp` down its relative branch and answers `editor`, so the hint promises
   "Ctrl+Click to open in throng active editor" while the click reveals the temp folder in OS Explorer.
   M19's rule arguably reaches it, but they named the **title** and the **status bar**, and what a hint
   should say for a path whose destination is undecidable is a wording decision — "Ctrl+Click to follow"
   and "…to open or show it" promise different things. Reported rather than answered on their behalf: it
   needs one sentence from them, and is a small change after that.
