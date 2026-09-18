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
