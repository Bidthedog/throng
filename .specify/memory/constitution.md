<!--
SYNC IMPACT REPORT
==================
Version change: 8.1.0 → 8.2.0
Bump rationale: MINOR. The maintainer's v1 review of 2026-11-28 asked that rows about a panel or its file
                leave the menu a right-click in the panel's body opens, and that rows about the content
                leave the panel's title menu, and that this be a constitution rule. Principle VI gains one
                rule, "A row goes on the menu of what it acts on". Argued against the project's own test:
                - Not MAJOR: no guarantee is withdrawn. Every row that moved off a menu arrives on the
                  other in the same change, so "Every panel action is reachable" holds for each, and no
                  principle is redefined.
                - MINOR, which decides it: a new obligation within an existing principle. Menus that put
                  Split, Copy Path or Find on both menus complied with 8.1.0 and fail 8.2.0, which is the
                  ordinary case for an additive rule.
                - Not PATCH: it adds an obligation, not a clarification.
Modified principles: VI (A row goes on the menu of what it acts on: added).
Modified sections: none outside VI. Added sections: none. Removed sections: none.
Skill reference: .claude/skills/throng-renderer-ui/references/constitution-ux.md › A row goes on the menu of
                what it acts on (new section): the body and title lists, the test for an unlisted row,
                how to apply it to a menu, and the gate.
Audit before the rule: every panel body and title menu was listed from the key sweep's fixtures and sorted
                by the rule; the maintainer approved the resulting moves row by row on 2026-11-28. The
                editor, preview, CSV, spreadsheet, terminal and blank-panel menus are brought into line on
                the same branch, so the shipped menus comply when the rule lands.
Enforcement: packages/ui/tests/unit/menu-placement.test.ts builds the swept body and title menus and fails
                a title row on a body menu or a body row on a title menu.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — name no menu placement; no edit.
           ✅ .specify/extensions.yml — no constitution hooks.
Artifacts: ✅ Specs that placed a moved row carry a dated amendment in their owning spec (043, 044, 048,
                054, 067, 073, 074, 076 and the editor's status-strip menus, as each applied).
           ✅ site/guide pages that say where a row lives are updated in the same branch.
           ⚠ The menus outside the key sweep (the Key Bindings chord menu, the Sub-workspaces rows, the
                Resource Monitor) are outside the placement gate too; none is a panel body or title menu.
Deferred: none.
-->

# throng Constitution

throng is a project-first, terminal-second, agent-third desktop application for managing many
independent command-line terminals and folders across multiple projects. These principles are the
non-negotiable rules that govern how throng is designed, built, and evolved. Where a rule names a
skill reference, that file holds the rule's binding detail and is part of this constitution
(Governance).

## Core Principles

### I. Project-First Context Isolation

The project is the root context of the entire application; everything else is scoped beneath it.

- A project MUST be a first-class entity with, at minimum, a friendly name, a root folder path, and
  a dominant colour.
- A project's root folder MUST be **exclusively bound** to that project: no two projects may share
  the same root folder, and no project's root may be an ancestor (parent) or a descendant
  (subfolder) of another project's root. This is a fundamental restriction enforced on both project
  creation and editing, so that every file belongs to exactly one project.
- Each project MUST expose its root folder as a navigable workspace folder structure (akin to VS
  Code's explorer), scoped to that project.
- The workspace MUST be able to render previews of supported document files — Markdown (`.md`)
  preview at minimum — alongside the raw file view.
- A user MUST be inside a selected project to spawn, view, or interact with any terminal. No
  terminal MAY exist outside a project context.
- When a project is selected, only that project's terminals, layout, and edit list MAY be active and
  visible; other projects' state MUST be hidden and isolated from the current view.
- Switching the active project MUST be a single, low-friction action and MUST fully swap the active
  terminal set, the workspace folder view, the edit list, and the dominant project colour.

Rationale: clean, native, per-project terminal isolation is throng's defining characteristic, not an
afterthought.

### II. Platform-Abstracted Core (OS-Agnostic)

All operating-system-specific behaviour MUST sit behind abstractions; the core application logic
MUST remain platform-independent.

- Process spawning, terminal detection, filesystem paths, file-change watching, and process
  reattachment MUST be defined as abstract contracts (interfaces) with OS-specific concrete
  implementations selected at runtime.
- Core logic (project model, terminal lifecycle orchestration, edit-list state, layout state) MUST
  NOT contain direct OS calls or hardcoded OS assumptions.
- Windows, Linux and macOS are the supported targets. macOS is supported on Apple silicon, at the
  level its docs state.
- **A feature that needs distinct code per OS delivers every platform.** A feature that requires
  distinct code per operating system MUST ship its Windows, Linux and macOS implementations in that
  feature, each passing the same shared contract and each tested on its own platform. It MUST NOT be
  declared done with one side missing, and Incremental Delivery staging applies inside the feature
  only, never across to a later one. Where a capability genuinely does not exist on one platform,
  the abstraction MUST report it as absent and the feature's spec MUST say so.
- **macOS is proved by CI.** The project has no macOS hardware. The macOS side of a feature is
  tested on hosted macOS CI runners, at the lowest layer that can show it, and no feature MAY
  require a manual test on a Mac. That proof runs in the full pipeline (Development Workflow &
  Quality Gates, *Static analysis & linting*), with a dispatch for macOS before merge. A macOS
  behaviour no automated test can show MUST be listed in the macOS known differences, never left
  unverified in silence.

Rationale: a feature shipped for one platform alone is a regression on the others, and a platform
that features may skip decays with each one.

### III. Detached, Tagged & Persistent Terminals

Terminal processes MUST be decoupled from the application's host (UI) process lifecycle, and MUST
carry enough identity to be restored across restarts. The binding detail of the rules marked
*(detail)* is in the `throng-terminal-pty` skill (`references/constitution-terminals.md`).

- Each terminal MUST be associated with exactly one shell (e.g. PowerShell 5, PowerShell 7, Git
  Bash/MINGW64, CMD), one owning project, and one running process.
- Each terminal/window MUST be tagged with a durable project identifier plus the metadata required
  to restore it (shell type, working directory, title, layout position, and launch command/preset).
  This tag is how terminals are matched back to their project on startup.
- Spawned terminals MUST run as independent processes; the failure, restart, or closure of one
  terminal MUST NOT cascade to others or to the host application.
- **No orphaned OS processes (resource hygiene).** When a terminal ends by ANY path, every OS
  resource it created — any auxiliary host process the platform spawns per terminal included — MUST
  be released, and this MUST be verified by a process-level E2E *(detail)*.
- **No orphaned terminal windows/views on user-instructed destruction.** A destroy the user
  commanded, by ANY path, MUST tear down the terminal's on-screen surface together with its process
  and MUST complete *(detail)*.
- A terminal and the **Panel** that hosts it are separate entities (Principle XI).
- When a terminal's process exits **unexpectedly** (not user-initiated), the terminal MUST surface
  the failure rather than vanish silently: the process's failure message(s)/error output and its
  exit code MUST be displayed to the user.
- When the user **deliberately closes or kills a terminal**, the terminal MUST close, but its
  hosting panel MUST remain in place — empty and ready to host a new terminal.
- Terminal lifecycle on close/reopen MUST follow these exact rules:
  - A terminal **with an active running process** MUST remain running in the background when its
    project or the application is closed, and MUST be re-attached to the UI (live session + restored
    scrollback) when reopened.
  - A terminal **with no active running process** (idle shell) MUST be closed when its project or
    the application is closed, and MUST be re-created in a new process when the project or
    application is reopened.
  - **Stated exception: an explicit Unload that keeps terminals running keeps ALL of them**, idle
    shells included, each re-attached rather than re-created when the project is next loaded;
    application close and every other project close keep the two rules above unchanged *(detail)*.
- When the application is closed while one or more terminals have active running processes, the user
  MUST be warned and offered exactly three choices: (A) close and leave terminals running in the
  background, (B) close and terminate all terminals, or (C) cancel and review the open terminals.
- Terminal **presets** (saved shell + working directory + startup command sets) MUST be definable
  per project and executable by the user when a project opens cold, so an idle project can be
  reconstituted to a known working state.
- **Terminal elevation follows the application.** A terminal inherits the terminal-hosting process's
  privilege level, so a terminal runs as administrator only when throng itself is launched elevated;
  a per-terminal "run as admin" flag MAY be offered, but MUST be available only while the host is
  elevated, and de-elevation sits behind the Principle II abstractions *(detail)*.

Rationale: watchers, servers and long-running agents must survive the UI closing, and identity on
each terminal is what makes reattachment reliable rather than guesswork.

### IV. Native Terminal Support & Auto-Detection

throng MUST host real, installed terminals natively rather than emulating a single shell.

- throng MUST support any installed terminal shell (e.g. PowerShell 5, PowerShell 7, MINGW64/Git
  Bash, CMD) and MUST auto-detect installed shells where the platform permits.
- A newly spawned terminal's working directory MUST be set to the active project's root folder.
- Running terminals within a project MUST be clearly listed and switchable.

**Terminal keys belong to the terminal.** A chord the application consumes while a terminal is
focused never reaches the running program, so binding one is not a preference — it is the silent
removal of a capability the user already had. Two tiers apply, and a chord's tier is decided by
**any** hosted flavour's line editor, not the flavour a given user happens to run.

- **Reserved — MUST NOT be taken.** No application command may bind, in a scope that is live in a
  terminal, a chord whose terminal meaning is dominant and has no equivalent by another route:
  `Ctrl+C` (SIGINT), `Ctrl+D` (EOF), `Ctrl+Z` (suspend), `Ctrl+A` / `Ctrl+E` (line start / end),
  `Ctrl+W` / `Ctrl+U` / `Ctrl+K` (word and line kill), `Ctrl+R` (reverse search), `Ctrl+L` (clear),
  `Ctrl+Q` (XON). Taking one of these is a defect, not a trade-off.
- **Shadowable — MUST be a recorded exception.** A chord whose terminal meaning is a *secondary*
  binding the user can reach another way — the emacs-style motion and edit aliases `Ctrl+B`,
  `Ctrl+F`, `Ctrl+N`, `Ctrl+P`, `Ctrl+H`, and flow-control `Ctrl+S` (arrow keys, `Home`/`End`,
  `Backspace` and history search serve the same ends in every hosted flavour) — MAY be bound, but
  only deliberately: the feature's spec MUST name the chord, the terminal behaviour it displaces,
  and why no free chord serves. Silence is not permission.
- **Recorded exceptions to the terminal tiers** (exhaustive; each open to revisiting; an addition
  MUST come with its own justification, and no chord in the reserved tier may join it):
  - `Ctrl+F` (`search.find`), `Ctrl+H` (`search.replace`) and `Ctrl+S` (`editor.save`), which
    shipped before this rule existed;
  - `Ctrl+F5` (`terminal.redraw`), feature 028 (#163): "hard refresh" for a mis-rendered terminal;
    bare `F5` is a file manager's, and the chord is scoped `terminal` only;
  - `Ctrl+Shift+Alt+F4` (`panel.destroy`), spec 048 FR-131 (#461): close from every panel, on the
    `F4` close family, displacing only a three-modifier `F4` no default line editor reads;
  - `Ctrl+Shift+Alt+F2` (`tabs.rename`), spec 067 FR-075 (#609): rename from every panel, on the
    `F2` rename meaning, displacing only a three-modifier `F2` no default line editor reads;
  - `Alt+Shift+Enter` (`panel.toggleMaximise`), spec 054 FR-071a (#467): maximise from every panel,
    on Visual Studio's full-screen chord; `Shift+Enter` and `Ctrl+Enter` still reach terminals and
    editors.
- **Moving a shipped default.** Only shipped defaults move. A saved binding is rewritten only where
  it still equals an old shipped default, and only when the new chord collides with nothing the user
  bound.

**Three modifier tiers: `Ctrl+Shift+Alt` navigates, `Ctrl+Alt` and `Ctrl+Shift` act on the active
panel or pane, one modifier acts on the content.** A user who knows what a command does should be
able to guess its modifiers. The binding detail of the rules below is in the
`throng-config-preferences` skill (`references/constitution-chords.md`).

- A default chord MUST sit in the tier for **what the command changes, not where it is live**:
  **Tier 1** `Ctrl+Shift+Alt+<key>`, navigation and the application; **Tier 2** `Ctrl+Alt+<key>` or
  `Ctrl+Shift+<key>`, the active panel or pane; **Tier 3** one modifier (`Ctrl+`, `Alt+` or
  `Shift+`) or none, the content.
- **Tier 1 is matched on the physical key.** Every `Ctrl+Shift+Alt` chord MUST be matched on
  `KeyboardEvent.code` in every resolver and in the Key Bindings capture modal, and the spec that
  ships a tier-1 default MUST name the characters it costs on the seven common European layouts.
- **One keyboard chord per command, plus at most one mouse gesture**, with only the exceptions the
  reference names: `menu.open`'s Menu key and `panel.zoomReset`'s main-row `Ctrl+Alt+0`.
- **The keypad `+` and `-` are the same binding as the main-row key**, and **the keypad `0` is a key
  of its own**; every resolver and the capture modal MUST treat these keys, and the docs and UI MUST
  write them, as the reference states.
- **A group of related commands uses one set of modifiers**, and a group MUST NOT mix tiers.
- **Outside the tiers:** function keys, mouse gestures and multi-stroke chords, categorically, as
  the reference lists them. A multi-stroke chord's FIRST stroke is judged by the terminal tiers
  above as though it were the whole chord, because a pending prefix consumes that stroke. A
  multi-stroke chord whose first stroke is in the reserved tier (`Ctrl+E`, `Ctrl+K`, …) MUST NOT be
  live in any scope that includes a terminal.
- **Recorded exceptions** (exhaustive; an addition MUST be justified in the spec that ships it and
  recorded here):
  - the terminal-tier exceptions above: `Ctrl+F`, `Ctrl+H`, `Ctrl+S`, `Ctrl+F5`,
    `Ctrl+Shift+Alt+F4`, `Ctrl+Shift+Alt+F2` and `Alt+Shift+Enter`;
  - **`navigate.quickOpen` `Ctrl+Shift+T`, `search.findInFiles` `Ctrl+Shift+F` and
    `search.replaceInFiles` `Ctrl+Shift+H`**: the chords every editor a user arrives from carries;
  - **`editor.saveAll` `Ctrl+Shift+S` and `editor.saveAs` `Ctrl+Alt+S`**, kept as a pair by the
    maintainer's decision;
  - **`search.replaceAll` `Ctrl+Alt+Enter`**, live only while an editor's find bar is open;
  - the function keys **`F2`** (`file.rename`), **`F3` / `Shift+F3`**, **`F11`**, **`Shift+F10`**,
    **`Ctrl+Shift+Alt+F4`** (`panel.destroy`) and **`Ctrl+Shift+Alt+F2`** (`tabs.rename`);
  - **`focus.cycle` `Ctrl+`` and `focus.cycleBack` `Ctrl+Shift+``**: Shift only reverses the
    direction of the same pair;
  - **`menu.open` `Shift+F10` and `ContextMenu`**, the one-chord rule's exception above;
  - **`editor.columnSelect*` `Shift+Alt+Arrow`**, VS Code's column-select chord. *(Recorded by
    derivation at 5.6.0: the maintainer's list did not name it, and no tier admits `Shift+Alt`. Spec
    046 carries it as a question for the maintainer.)*
  - **`panel.toggleMaximise` `Alt+Shift+Enter`** (spec 054), outside the tiers for the same reason,
    by the maintainer's decision; its terminal-tier entry is above.
  - **`help.open` `F1`** (spec 080), the standard Help key, by the maintainer's decision. It is never
    live in a terminal, so it needs no terminal-tier entry.
- **The tiers never override the terminal tiers above.** A reserved chord stays untakeable whatever
  tier it is in, and a shadowable chord still needs a recorded exception; which modifier-encoded
  chords stay subject to the terminal tiers is in the `throng-terminal-pty` skill
  (`references/constitution-terminals.md`).
- **The AltGr check.** A `Ctrl+Alt+<letter>` or `Ctrl+Alt+<digit>` default MUST pass the AltGr check
  the reference states.
- This is an **end-state requirement** under the Incremental Delivery rule, binding on new work
  immediately. A default that moves to meet it follows *Moving a shipped default* above.

**One command, one chord across panel types.** A command offered in more than one panel type MUST
use the SAME chord in each, so it is learned once rather than per surface.

Divergence is permitted ONLY where the terminal's meaning for that chord is well-known and genuinely
incompatible with the command's (`Ctrl+C` copies in an editor and interrupts in a terminal); each
exception MUST be recorded in the spec that introduces it, and MUST be visible wherever the
command's shortcut is displayed, never bound quietly per scope.

**Parity across flavours.** Every terminal throng hosts MUST present the same keys for the same
line-editing commands, whichever shell is behind it, and throng MUST normalise a key one flavour's
line editor does not bind. This is an end-state requirement under the Incremental Delivery rule;
until it lands, no feature may widen the gap by binding a key in one flavour alone.

**A default chord is the same on every platform wherever it can be.** A default key chord MUST be
the same on every supported platform. It MAY differ only when a platform's desktop reserves the
chord and no other route, such as the keypad, reaches it, and the key bindings docs MUST record the
reason.

Rationale: hosting a real terminal means hosting the shell's keyboard contract, and the keyboard
should describe the command, not the surface or the shell.

### V. Test-First Quality Discipline (NON-NEGOTIABLE)

Behaviour MUST be specified by tests before implementation, following the XP Red-Green-Refactor
cycle. The binding detail of every rule below is in the `throng-testing` skill
(`references/constitution-test-discipline.md`).

- For each feature or fix, tests MUST be written first, MUST fail before implementation (Red), MUST
  pass after the minimal implementation (Green), and the code MUST then be refactored under a green
  bar (Refactor).
- A layered automated test strategy MUST be maintained — **unit**, **component**, **integration**
  and **end-to-end (E2E)** tests, each layer as the reference defines it.
- **A change MUST ship with automated coverage at the LOWEST layer that can prove it**, chosen by
  what the assertion needs, and MUST NOT be marked done without observed passing output from
  whichever layer proves it.
- **E2E coverage is RESERVED for behaviour that no lower layer can observe**, and a change MUST NOT
  add an E2E test for anything a lower layer could assert. The reserve is closed: `@reserve:window`,
  `@reserve:focus`, `@reserve:native`, `@reserve:osdrag`, `@reserve:pty`, `@reserve:process`,
  `@reserve:layout`, `@reserve:input` and `@reserve:runtime`, each defined in the reference. An
  existing E2E a lower layer can assert MUST be moved down by the reference's replacement order;
  coverage is never dropped without a named replacement.
- **Every E2E test MUST name the reserve entry that makes it irreducible**, by its identifier, and
  the build MUST fail on a test that names none, more than one, or one that does not exist.
- **The E2E suite MUST carry a declared budget, and the build MUST fail when it is exceeded.** The
  budget is a ratchet: it may fall and MUST NOT rise.
- **Every E2E test MUST carry exactly one significance tag and at least one category tag**, and the
  build MUST fail on a test that lacks either; significance (`@core`, `@extended`) selects no
  pull-request lane, because no E2E test runs on a pull request.
- **A reported defect MUST begin with a test that reproduces it**, observed failing for the reason
  reported before any production code changes, written at the **lowest layer that reproduces the
  defect** and kept there once the fix lands.
- **A test run MUST be executed once, in full, and its complete output captured**; after a failure
  only the failing tests are re-run, then the full suite once; a test that passes on re-run without
  a code change is flaky, not fixed; and **a fault owned by NO test is infrastructure, not a
  flake**, retried once at most and only under the reference's conditions.
- Abstraction contracts (Principle II) MUST have contract tests that any OS-specific implementation
  is verified against.
- Process lifecycle behaviour (spawn, detach, tag, persist, idle-close, reattach, cold-respawn) MUST
  be covered by automated tests; success MUST NOT be claimed without observed passing output.
- **Generated test artifacts and temporary files MUST be cleaned up.** Tests MUST remove what they
  create (self-cleaning setup and teardown, or a temp location that is torn down), and no file
  created by or for a test run, or during development, MAY be committed or left in the working tree
  once it has served its purpose.
- **Privilege-dependent behaviour MUST be tagged and elevation-gated.** It is tagged **`@admin`**,
  skipped when the test process is not elevated, claimed verified only by an elevated run, and every
  E2E run MUST remind that `@admin` is verified only elevated.

Rationale: the riskiest parts of throng are where regressions hide, and choosing the lowest layer
that proves a change is what keeps that discipline affordable.

### VI. Simple, Modern, Discoverable UX

The interface MUST be simple to understand and modern in feel. The binding detail of the bold-named
rules below is in the `throng-renderer-ui` skill (`references/constitution-ux.md`).

- Common actions (switch project, spawn terminal, switch terminal, run a preset) MUST be reachable
  without instruction.
- Each project MUST support multiple tabs, and each tab MUST support a user-configurable
  multi-**Panel** split layout (e.g. four terminals tiled as quadrants in the work area, freely
  resizable and rearrangeable via drag-and-drop).
- The workspace is composed of **Panels** tiled within **Tabs** inside the workspace **Pane**,
  beside a stacked sidebar **Pane**, as defined in Principle XI; a terminal Panel is separate from
  the terminal process it hosts (Principle XI).
- Tab, Panel, and Pane layout — including any detached windows — MUST be persisted per project and
  restored when the project is reopened.
- The interface SHOULD provide modern affordances such as resize handles, drag-and-drop panels, and
  themes, but these MUST NOT obscure core flows.
- The selected project's colour MUST be visually dominant so the active context is unambiguous at a
  glance.
- **Every panel action is reachable.** Every discrete command or state toggle that acts on a Panel
  or its content MUST be reachable by a mouse-click or a keyboard command, never only by a route the
  user can hide; the routes, menu-item and Key Bindings editor rules are in the reference.
- **One section vocabulary for every menu.** Every context menu MUST place its items in these
  sections, in this order — Contextual, Content, Create, Navigate, View & state, Application,
  Destroy — with a divider only at a real section boundary, and every menu item MUST declare its
  section; the section definitions and divider rules are in the reference.
- **Disabled when unavailable, absent when meaningless.** A control whose action is temporarily
  unavailable MUST be drawn and disabled; one structurally meaningless for the thing under the
  pointer MUST NOT be drawn. The test is whether **any** future state of the application would
  enable it.
- **One gesture follows a link, everywhere.** A link rendered inside content MUST be followed by
  **Ctrl+click** (**Cmd+click** on macOS), and a plain click MUST NOT navigate, with the keyboard,
  hover and menu rules in the reference. An end-state requirement; known gaps are tracked in the
  reference.
- **A menu row shows its key.** Every menu row whose command a key performs where the menu
  was opened MUST show that key: the user's current binding for a rebindable command, the fixed key
  for one the surface handles itself, and nothing for a command with no key; the rules and the gate
  are in the reference.
- **A row goes on the menu of what it acts on.** A panel's body menu MUST hold only rows that act on
  the content under the pointer or on how the body shows it, and its title menu MUST hold the rows
  that act on the panel, its file or its link to other panels; the lists, the test for an unlisted
  row and the gate are in the reference.
- **A preference picks the default; the menu offers every variant.** Where a preference decides an
  action's variant, the menu MUST list each variant by name, and a plain item MUST run the
  preference's choice, labelled for the action.
- **Name the OS generically.** User-visible text SHOULD refer to the operating system as **the OS**,
  with the exceptions the reference names.
- **Name a setting for its behaviour.** A setting MUST be named for the behaviour it turns on, so
  that on, ticked or enabled always means the behaviour happens, and its stored key follows the
  name; known gaps are tracked in the reference.
- **One popup style.** Every popup MUST be drawn in the one popup style, and the OS's own tooltip
  MUST NOT be shown.

Rationale: an action the user cannot find, or must relearn per surface, is an action they do not
have.

### VII. Change Review & Approval

throng MUST surface file changes made within a project and let the user review them without mutating
the files further.

- For each project, file changes produced by any terminal or agent MUST be monitored and aggregated
  into a single combined, project-scoped edit list — changes from multiple terminals/windows MUST
  appear together in that one list.
- The user MUST be able to approve or deny changes at line-by-line, whole-file, and whole-set
  granularity.
- Approval and denial MUST be review bookkeeping only: they check items off the list and MUST NOT
  modify file contents (the edits are already on disk).
- The edit list MUST be persisted between sessions; unapproved changes MUST be reloaded in new
  sessions so review can continue later.

Rationale: When multiple agents and watchers edit a project concurrently, the user needs one
trustworthy place to see and reason about what changed, Copilot-style, without the review tool
itself becoming another mutation source.

### VIII. SOLID, DRY & YAGNI Engineering Discipline

Production code MUST be written to recognised enterprise engineering standards.

- Code MUST adhere to the SOLID principles — single responsibility, open/closed, Liskov
  substitution, interface segregation, and dependency inversion (depend on abstractions, not
  concretions).
- Code MUST follow DRY: knowledge and logic MUST have a single authoritative representation;
  duplication MUST be refactored out rather than copied.
- Design MUST follow YAGNI: build only what a current, specified requirement needs. Speculative
  generality MUST NOT be added "in case" it is needed later.
- Established enterprise design patterns MUST be applied where they genuinely reduce complexity or
  coupling, and MUST NOT be applied ceremonially where they add indirection without benefit (YAGNI
  governs this tension).

Rationale: SOLID and DRY keep the abstraction boundary maintainable, and YAGNI stops it ballooning.

### IX. Dependency Injection & Composition Root

All collaboration between components MUST be wired through dependency injection.

- Components MUST receive their dependencies via **constructor injection**. Service-locator,
  ambient/static singletons, and `new`-ing collaborators inside business logic are prohibited.
- Dependencies MUST be expressed as abstractions (interfaces), reinforcing the dependency-inversion
  rule of Principle VIII and the contracts of Principle II.
- Each **application boundary** — each independently runnable process (for example the detached
  daemon and the UI main process) — MUST have **exactly one composition root**: a single IoC
  container configured in one file for that boundary. Within a boundary, object graphs are composed
  there and nowhere else, and the rest of that boundary's code MUST remain unaware of the container.
  A multi-process system therefore has one composition root per boundary, never one shared global
  container (processes cannot share an in-memory container) and never more than one container per
  boundary.

Rationale: one composition root per process keeps each process's wiring explicit and testable and
its OS-specific implementations swappable.

### X. Externalised Configuration

Configuration MUST be separated from code. The binding detail of the bold-named rules below is in
the `throng-config-preferences` skill (`references/constitution-configuration.md`).

- Configuration values (paths, timeouts, IPC endpoints, feature flags, limits, and similar) MUST NOT
  be hardcoded in business logic; they MUST be abstracted into application settings.
- Settings MUST be exposed to code through typed settings abstractions that are injected via
  constructor injection (Principle IX), never read ad hoc from the environment deep inside
  components.
- Defaults MUST be sensible and documented; environment- or machine-specific values MUST be
  overridable without code changes.
- **Every theme setting belongs to its theme.** Everything a theme governs MUST be stored in that
  theme's file and nowhere else, activating a theme MUST restore every one of those values, and a
  token added to the shipped themes MUST reach every theme file on disk through the
  `SHIPPED_DEFAULTS_VERSION` upgrade.
- **Settings are quoted by value.** User-facing text that refers to a quantity a setting governs
  MUST state that setting's **current value**, read when the text is shown, in the unit its
  Preferences control displays, digit-grouped — never the shipped default, a constant copied from
  the code, or an estimate. An end-state requirement; known gaps are tracked in the reference.

Rationale: injected configuration keeps behaviour portable and testable, and text that copies a
setting's value goes wrong the moment the user changes it.

### XI. Dockable Workspace: Panes, Tabs & Panels

The workspace MUST use a VS Code / Visual Studio-style docking model built from three distinct
entities:

- A **Panel** is the atomic, draggable content unit. In the workspace a Panel hosts an editor or a
  terminal; in the sidebar the project list and the sub-workspaces list are Panels. A Panel is
  separate from any process/content running inside it: a terminal and the Panel hosting it are
  separate entities, a terminal's lifecycle MUST NOT govern its Panel's, and a terminal Panel
  persists when its terminal process ends (Principle III).
- A **Tab** is a workspace view that contains a **split arrangement (tree) of one or more Panels**
  (Panels tiled into rows/columns to arbitrary depth). Tabs exist only in the workspace Pane.
- A **Pane** is a top-level docking zone. The default layout has **two** Panes.

The model MUST obey these rules. The binding detail of *One document, one state* is in the
`throng-editor-documents` skill (`references/constitution-document-state.md`); that of the other
rules marked *(detail)* is in the `throng-renderer-ui` skill
(`references/constitution-workspace.md`).

- **One document, one state.** Where the same artefact is presented by more than one Panel, it MUST
  be **one document in every respect**: exactly one component owns its content-shaping state —
  content buffer and dirty state, undo/redo history, effective language and indentation — and every
  other copy is a derived replica changed only by that authority's ordered change stream.
  Peer-to-peer reconciliation between co-equal copies is FORBIDDEN, and only view state MAY differ
  per Panel. The rule binds every panel type that can present one artefact twice.
- The default layout MUST provide at least two top-level Panes, with the active-project and
  no-project layouts, defaults and persistence the reference states *(detail)*.
- The Workspace Pane MUST be a **tab group**: one or more **Tabs**, exactly one active, with an
  unlimited number of Tabs that MUST be reorderable.
- Within a Tab, a Panel MUST be **splittable** by dragging another Panel to its edge, tiling the Tab
  into rows/columns to arbitrary depth; Panels MUST be draggable between split positions and between
  Tabs.
- Dragging the last Panel out of a split slot MUST collapse that slot; a Tab whose last Panel is
  removed MUST cease to exist; the active project's workspace MUST always retain at least one Tab
  containing at least one Panel.
- A **Tab** or a single **Panel** MUST be detachable into a separate OS window — a
  **sub-workspace**, a first-class, persisted entity that MAY hold Tabs and Panels from multiple
  projects — and the main window and every sub-workspace window MUST behave as a single focus/raise
  group *(detail)*.
- **Focus follows the active Panel.** When a Panel becomes active by a keyboard route, DOM focus
  MUST move into it, and every Panel type MUST have a keyboard focus target *(detail)*.
- **A loaded Panel keeps its state.** A Panel's view state and transient UI state MUST NOT change
  while the Panel is loaded, whatever moves, hides or rebuilds it *(detail)*.
- Only **Panels** MUST be reattachable to the main workspace, and only into **their original
  project's** workspace. The **main workspace MUST NOT mix Panels from different projects**;
  cross-project mixing exists only inside sub-workspaces. A Panel whose original project no longer
  exists MUST be retained, not discarded.
- The full per-project arrangement (Tabs, each Tab's split tree, sizes, and the active Tab) and all
  sub-workspaces (with their on-screen positions) MUST be persisted per project and restored on
  reopen (Principle VI); a restored window on an unavailable display MUST be brought back onto a
  visible one.

Rationale: a workspace whose purpose is to show one artefact in many places MUST NOT let it acquire
many conflicting truths, and keeping the main workspace single-project preserves Principle I.

### XII. Responsive UI (NON-NEGOTIABLE)

The UI MUST stay responsive to input at all times. Scrolling, typing, clicking, resizing and closing
MUST never wait on rendering work.

- **Rendering yields to input.** Expensive rendering work — layout measurement, re-rendering, and
  derived visual work such as table layout, highlighting and outlines — MUST be deferred, debounced,
  batched or done incrementally rather than block the input thread. Showing content a moment later
  is always preferred over delaying the UI.
- **Re-run only on a real change.** Such work MUST re-run only when its inputs actually change — a
  width that changed, not every resize notification — and MUST NOT feed back into its own trigger
  (work that resizes the element whose resize started it is a loop).
- **Batch layout reads.** Forced synchronous layout reads MUST be batched — read everything, then
  write everything — never interleaved per item. One read per table, per cell or per token on a
  large document is a full layout each time.
- **Measured, not assumed.** A change that adds rendering work on an input path (resize, scroll,
  keystroke, draw) MUST carry a measurement in its tests or its PR — long-task time or forced layout
  reads per event — taken on a representative, large input, not a one-line fixture.

Rationale: a person notices lag long before a test does, which is why the cost is measured.

### XIII. Every Failure Leaves a Trace

A failure anywhere in throng MUST leave a record in the diagnostic log that says what failed and
why. No feature may fail in a way that leaves the diagnostic log empty. The binding detail of the
rules below is in the `throng-failure-notices` skill (`references/constitution-failure-trace.md`).

- **Every process is watched.** Every process throng starts MUST have its startup failure, its
  abnormal exit and the reason for both logged — by its parent always.
- **Every caught error is logged.** An error reported by a child, or caught and not re-thrown, MUST
  be logged, at the level the reference sets; a catch that only discards is a violation.
- **A crash is fatal.** The crash of any component is logged at `fatal`, written whatever log level
  is configured.
- **The log is where the user can find it.** Every process writes into the one logs folder the
  application opens for the user, and logging never crashes or stalls the process doing it.
- **Enforced by the build.** A new silent catch or an unwatched process start fails the unit layer,
  unless the site says why the parent deliberately does not watch it.

Rationale: an installed build has no console, so the log is the only thing a user can send.

## Technology & Architecture Constraints

- **Baseline stack (chosen):** Electron + TypeScript for the UI, an xterm.js-family renderer for
  terminals, and `node-pty` (ConPTY on Windows) for PTY spawning. Specific library and version
  choices are recorded in feature plans, not here.
- **Daemon/client architecture (required):** Terminals MUST be owned by a persistent, detached
  daemon process — not by the UI process — so that closing the UI does not kill terminals (this is
  how Principle III is met). The UI is a client that connects to the daemon over local IPC (e.g. a
  named pipe on Windows) and reattaches to existing PTYs and their buffered scrollback on launch.
- **Change tracking:** The combined edit list (Principle VII) MUST be driven by filesystem watching
  of the project root behind the OS abstraction of Principle II.
- Using an existing open-source base (e.g. VS Code OSS components such as xterm.js, node-pty, and
  the pty-host pattern) is permitted and encouraged where it accelerates delivery, but MUST NOT
  violate the project-first model, the detachment/persistence guarantees, or the OS-agnostic core.
  Forking the entire VS Code editor is out of scope; reuse components, not the whole IDE.
- Persistent state required to restore the application (project definitions, terminal tags/records,
  presets, layouts, and the unapproved edit list) MUST be stored durably outside the host process
  memory.
- **Idempotent data migrations:** Every schema or data migration MUST be idempotent: re-running it,
  or running it against a store already at or past its target version, MUST converge on the same end
  state without erroring, duplicating, corrupting or double-applying data, written defensively as
  the `throng-daemon-persistence` skill (`references/constitution-persistence.md`) states.
- **Per-user local storage:** throng runs as the logged-in operating-system user with no in-app
  authentication; all persistent state MUST be stored in that user's local profile and MUST carry an
  owner/user key, so that future multi-user support and import/export of project setup data can be
  added without reshaping the store. User-scoped application configuration (settings, keybindings,
  and themes) MUST be stored as human-editable files in the user's profile (under a per-user throng
  configuration directory).
- **Single instance:** The application MUST run as a single instance per user; a second launch while
  an instance is running MUST not start a second instance. Multiple concurrent instances are
  disallowed because they would fracture terminal and project ownership.
- **Lazy project loading:** Projects MUST be loaded lazily — selected/opened on demand rather than
  all at startup — and, once loaded, MAY remain in memory for the session.
- Agent-specific tooling is explicitly future scope; the architecture MUST keep agents as a layer
  above terminals so they can be added without reworking the project or terminal layers.

## Development Workflow & Quality Gates

- Work MUST flow through the Spec Kit lifecycle: constitution → specify → (clarify) → plan → tasks →
  implement, with each plan passing the Constitution Check gate before design proceeds.
- **Incremental (staged) delivery:** A capability mandated by this constitution MAY be delivered
  across multiple features rather than all at once, provided: (a) every released increment is
  internally consistent and violates no principle in its own right; (b) the not-yet-delivered
  remainder is explicitly recorded as a tracked deferral in the owning plan's Complexity Tracking,
  naming the end-state requirement and the feature expected to complete it, and surfaced in the
  **issue tracker** as an open, labelled issue (the single forward-looking list per the
  Documentation-currency rule); and (c) the end-state requirement is never weakened or dropped —
  only its delivery is sequenced. Introducing a structural seam (e.g. a pane shell) ahead of its
  content is the canonical example. Incremental delivery MUST NOT be used to ship a permanently
  incomplete capability. An end-state requirement's known gaps are listed in the skill reference
  that holds its detail.
- **Static analysis & linting MUST pass as a quality gate (NON-NEGOTIABLE).** ESLint with the
  typescript-eslint rule set and strict `tsc` type-checking MUST report **zero errors**, enforced
  automatically so a red gate blocks merge; **pull-request CI** and **the full pipeline** MUST run
  the layers the `throng-release` skill (`references/constitution-ci-lanes.md`) assigns them, and a
  release MUST NOT publish unless the full pipeline in its own run is green.
- Changes that touch the OS abstraction boundary, the daemon/terminal process lifecycle, persisted
  edit/layout state, or **the state of a document presented in more than one Panel** MUST be
  reviewed with particular scrutiny against Principles II, III, V, VII, and **XI** (One document,
  one state). In particular, a change that introduces a new panel type able to present an existing
  artefact MUST be checked for per-Panel copies of content-shaping state.
- **Documentation MUST be kept current as part of the lifecycle (NON-NEGOTIABLE).** A change that
  alters user-facing behaviour, setup or commands, architecture, or the set of delivered or planned
  capabilities MUST update the affected project documentation — at minimum `README.md`,
  `CONTRIBUTING.md`, `docs/` and the issue tracker — **in the same change**, as the `throng-docs`
  skill (`references/constitution-docs-currency.md`) defines each; the issue tracker is the single
  forward-looking list, and a PR MUST NOT be merged while any of them disagrees with the shipped
  behaviour.
- **Configuration editors MUST stay in sync with all configurable options (NON-NEGOTIABLE).** Every
  configurable setting, key binding and theme token MUST be editable through the visual preference
  editors, enforced by a declarative editor-metadata registry plus a completeness test, as the
  `throng-config-preferences` skill (`references/constitution-configuration.md`) states.
- **Displayed quantities MUST be digit-grouped, and grouping MUST NEVER be stored
  (NON-NEGOTIABLE).** Every quantity the application shows a user MUST be rendered with the active
  locale's digit grouping, and no grouping character may reach a stored value or cross a process
  boundary; what is and is not a quantity, the parser rule, and the known gaps are in the same
  reference.
- **Action controls MUST be themeable icons with hover titles (NON-NEGOTIABLE).** Every interactive
  control that performs an action MUST be an icon from the active theme's icon set, with a hover
  title naming the action and colours from theme tokens. The binding detail, and known gaps, of the
  rule and its parts below are in the `throng-renderer-ui` skill (`references/constitution-ux.md`).
  - **Exception — dialog decision buttons.** The buttons by which a user consents to or declines an
    action inside a dialog MUST retain text labels, with colours from theme tokens.
  - **Exception — disclosure headings.** A fold/expand control whose own visible text names what it
    opens need not carry a hover title; its accessible name is that text, and its open state is shown
    by its chevron and `aria-expanded`. No other control is exempt.
  - **Default dialog actions.** A dialog or modal that offers decision buttons MUST mark exactly one
    as its default action, drawn in the theme's Confirm (or Destroy) button type.
  - **Toast controls.** Every button a notice offers MUST sit in the card's single control group at
    its top-right, never in the notice's content.
  - **Setting toggles.** An icon control whose pressed state *is* an on/off setting MUST read its
    state at a glance and never invert it, titled **"<setting>: enabled"** or **"<setting>:
    disabled"**.
- Code review MUST verify every gate in this section and Principles V, VIII–X.

## Governance

- This constitution supersedes other development practices where they conflict.
- A skill reference a rule here names (`.claude/skills/<skill>/references/constitution-*.md`) is
  part of this constitution: it binds as this document does, and it changes only by amendment.
- Amendments MUST be made by editing this document, MUST state the rationale, and MUST update the
  version and dates below per the versioning policy.
- Versioning policy (semantic):
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: addition of a new principle or section, or materially expanded guidance.
  - PATCH: clarifications and wording fixes that do not change meaning.
- Compliance is verified at the Constitution Check gate of every plan and during code review. Every
  plan MUST be evaluated against every principle; any violation MUST be recorded and justified in
  the plan's Complexity Tracking section, or the design MUST be revised to comply.
- Every amendment's rationale — its Sync Impact Report, and the amendment notes that predate them —
  is kept in [`constitution-history.md`](constitution-history.md), newest first. This file carries
  only the latest amendment's report.

**Version**: 8.2.0 | **Ratified**: 2026-06-25 | **Last Amended**: 2026-11-28
