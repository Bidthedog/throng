<!--
SYNC IMPACT REPORT
==================
Version change: 3.10.1 → 3.11.0
Bump rationale: MINOR. One additive governance rule (2026-07-08, feature 007 FR-048), no
                principle removed or redefined: Development Workflow & Quality Gates gains a
                "Configuration-editor completeness" rule — every configurable application setting,
                key binding, and theme token MUST be exposed and editable through the visual
                preference editors, and when new configuration is added the corresponding editor
                MUST be updated to expose it (no configuration editable only by hand-editing JSON).
                The rule is enforced by a declarative editor-metadata registry (one descriptor per
                configurable key, in @throng/core) plus a completeness test asserting every
                configurable key/action/token has a descriptor — a newly added config key without an
                editor descriptor fails the test. The code-review gate is extended with a matching
                configuration-editor-completeness check. Materially expanded, additive workflow
                guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review
                gate is extended to verify configuration-editor completeness). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution
       dynamically; the new rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; a feature that adds configuration
       MUST include the editor-descriptor + completeness-test tasks; enforced at /speckit-tasks time.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/007-preferences-editor/*       — the FR-025a editor-metadata registry + FR-047 completeness
       tests (settings/keybindings/theme) already implement and verify this rule; spec FR-048 records it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.10.0 → 3.10.1
Bump rationale: PATCH. Clarification only — no new obligation and no principle changed (2026-07-03):
                the Incremental Delivery rule now explicitly cross-references ROADMAP.md as the
                project-level home for deferred / end-state capabilities, connecting it to the
                Documentation-currency rule (v3.10.0) that already makes ROADMAP.md the single
                forward-looking list. No meaning change: deferrals were already required to be tracked
                (per-plan Complexity Tracking) and planned capabilities already had to appear in
                ROADMAP.md — this simply names the link. Net: PATCH.
Modified principles: none. (Development Workflow & Quality Gates — the Incremental Delivery clause gains
                a cross-reference to ROADMAP.md.)
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ ROADMAP.md — the forward-looking list; extended with newly planned items (enhanced project list,
       rich editors, native-folder-view panels, Markdown preview, terminal presets, additional
       terminal integrations, change review, diff tool, git worktrees, agents & multi-agent handoff,
       plugin system, backup/restore, macOS/Linux) and delivered items (theming, lazy loading) marked
       done. Existing principles already accommodate these (e.g. IV native-terminal/auto-detect covers
       the extra terminals; agents are existing future scope; import/export sits under Per-user local
       storage), so no per-feature principle changes are warranted.
  ✅ .specify/templates/*, .specify/extensions.yml — unaffected by a cross-reference clarification.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.9.0 → 3.10.0
Bump rationale: MINOR. One additive rule (2026-07-03), no principle removed or redefined:
                Development Workflow & Quality Gates gains an explicit "Documentation MUST be kept
                current as part of the lifecycle" rule — every change that alters user-facing
                behaviour, setup/commands, architecture, or the delivered/roadmap capability set MUST
                update the affected project docs in the SAME change: at minimum README.md (which
                describes only the current shipped finite state, with no per-feature narration),
                CONTRIBUTING.md, and ROADMAP.md (delivered items marked done, newly planned items
                added). Documentation reconciliation is part of /speckit-converge and the definition
                of done — a change MUST NOT be complete, and a PR MUST NOT merge, while these docs
                disagree with shipped behaviour. The code-review gate is extended with a matching
                doc-currency check. Materially expanded, additive workflow guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review gate
                is extended to verify documentation currency). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution dynamically;
       the new workflow rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; a feature that changes user-facing
       behaviour MUST include a doc-update task; enforced at /speckit-tasks time, not in the template.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ README.md / CONTRIBUTING.md / ROADMAP.md — README rewritten to the current finite state; ROADMAP.md
       created (delivered vs planned); PR template gains a documentation-currency checkbox.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.8.0 → 3.9.0
Bump rationale: MINOR. Two additive rules (2026-07-03), no principle removed or redefined:
                (1) Principle V (Test-First Quality Discipline) gains an explicit "Generated test
                artifacts & temporary files MUST be cleaned up" rule — files created by/for a test
                run and any scratch/temp files (fixtures, temp scripts, throwaway `tmp.*` sources,
                generated output) MUST be removed once they have served their purpose, MUST NOT be
                committed or left lingering, tests MUST self-clean the artifacts they create, and a
                green bar MUST NOT leave orphaned generated files behind.
                (2) Principle III (Detached, Tagged & Persistent Terminals) gains an explicit "No
                orphaned terminal windows/views on user-instructed destruction" rule — when the user
                instructs the app to destroy a terminal by ANY path (close/kill, panel-destroy,
                project-delete, app-close terminate-all), the terminal's on-screen surface (window or
                Panel view) MUST be fully torn down together with its process (complementing the
                existing resource-hygiene / no-orphaned-process rule); no window, view, or ghost
                surface may linger after a commanded destroy.
                Both are materially expanded guidance within existing principles → MINOR.
Modified principles: V "Test-First Quality Discipline" (added test-artifact / temp-file cleanup rule);
                III "Detached, Tagged & Persistent Terminals" (added no-orphaned-window / view rule on
                user-instructed destruction). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; both new rules are picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/005-terminal-panel-type/*      — destroy/terminate-all + resource-hygiene work already
       covers the terminal-window teardown; test-artifact cleanup applies to the e2e suite (e.g. the
       stray tmp.ts) and is enforced at review time, not in a template.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.7.0 → 3.8.0
Bump rationale: MINOR. Strengthens Principle III (Detached, Tagged & Persistent Terminals) with an
                explicit "No orphaned OS processes (resource hygiene)" rule (2026-07-02): when a terminal
                ends by ANY path — user close/kill, panel-destroy, project-delete, app-close terminate-all,
                self-exit, or daemon shutdown — every OS resource it created (including the per-terminal
                Windows/ConPTY `conhost.exe` host) MUST be released; a terminal host MUST reap its terminals
                before exiting and a detached helper MUST self-terminate when its server is gone; and this
                MUST be verified by a process-level E2E asserting the host's terminal child-processes return
                to baseline after each end path. Additive; no principle removed or redefined. Net: MINOR.
Modified principles: III "Detached, Tagged & Persistent Terminals" (added the resource-hygiene / no-orphaned-
                process rule + its process-level-E2E verification requirement). Title unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ specs/005-terminal-panel-type/*      — FR-015b/018/022 + the T134 convergence task and
       terminal-no-orphans.e2e.ts implement and verify the new rule; spec Release Status records it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.6.0 → 3.7.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an explicit,
                non-negotiable rule for privilege-dependent tests (2026-07-02): behaviour that only
                manifests when running elevated (the run-as-admin terminal path + OS de-elevation,
                Principle III / FR-025) MUST be tagged `@admin`, skipped when the test process is not
                elevated (no hollow non-elevated baseline), and verified only under an elevated run —
                and every E2E run MUST emit a reminder that the `@admin` suite is elevation-gated so a
                green non-elevated bar never implies admin coverage. Additive testing discipline; no
                principle removed or redefined. Net: MINOR.
Modified principles: V "Test-First Quality Discipline" (added the privilege-dependent / `@admin`
                elevation-gating + per-run reminder rule). Title unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — principle-agnostic / dynamic Constitution Check; no edit needed.
  ✅ specs/005-terminal-panel-type/*      — FR-025/025a-d + the de-elevation convergence task already
       document the elevated-verification requirement; the `@admin` tag + reminder implement it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.5.0 → 3.6.0
Bump rationale: MINOR. Two additive/relaxing changes for the 005 batch-2 refinements (2026-07-01):
                (1) Principle XI — the Sidebar Pane no longer requires a stacked *Terminals* Panel; it now
                hosts the Projects and Sub-workspaces panels only (Sub-workspaces pinned to the bottom).
                This REMOVES a specific sub-requirement (the Terminals list Panel) but does not remove or
                redefine a principle — the docking model, project-first isolation, and the Projects /
                Sub-workspaces panels are unchanged; a terminal *list* was never a load-bearing guarantee
                (terminals live in workspace Panels, Principle III/VI). Every other prior-compliant design
                stays compliant. (2) Principle III — adds an explicit "terminal elevation follows the
                application" clause: terminals inherit the integrity level of the app/daemon, so running a
                terminal as administrator requires launching throng elevated; there is no separate
                elevation broker. Additive clarification of existing behaviour. Net: MINOR.
Modified principles: XI "Dockable Workspace: Panes, Tabs & Panels" (Sidebar no longer lists a Terminals
                Panel; Sub-workspaces pinned to the bottom); III "Detached, Tagged & Persistent Terminals"
                (added the elevation-follows-the-app clause). Titles unchanged.
Added sections: none. Removed sections: none (a sub-requirement within Principle XI was dropped).
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; both changes are picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/005-terminal-panel-type/spec.md — batch-2 clarifications (2026-07-01) + FR-023 (sidebar) and
       FR-025/025a-d (elevation) written to match this amendment.
  ✅ specs/003-layout-and-app-tweaks/*     — Terminals-Panel-in-sidebar references to be scrubbed with FR-023.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.4.0 → 3.5.0
Bump rationale: MINOR. Adds a new "Idempotent data migrations" constraint under Technology &
                Architecture Constraints: any schema/data migration MUST be safe to re-run and safe
                to run against an already-migrated store, always converging on the same end state
                without erroring or duplicating/corrupting data. This is materially expanded,
                additive guidance (a new constraint), not the removal or redefinition of an existing
                principle, so it is a MINOR bump. Every prior-compliant design remains compliant.
Modified principles: none (constraint added under Technology & Architecture Constraints).
Added sections: none (one new bullet under Technology & Architecture Constraints: Idempotent data
                migrations). Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; the new constraint is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required. (Features that
       add a migration MUST include a task asserting idempotent re-run; enforced at /speckit-tasks
       time, not in the template.)
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.3.0 → 3.4.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an explicit,
                non-negotiable rule: every user-facing UI change MUST ship with passing E2E test
                coverage, and a UI change MUST NOT be marked complete on build/unit evidence alone.
                This materially expands existing testing guidance (the E2E layer was already
                mandated for critical journeys) rather than removing or redefining a principle, so
                it is additive. Templates reviewed below; no principle removed or redefined.
Modified principles: V "Test-First Quality Discipline" (added the UI-changes-require-E2E rule;
                title unchanged).
Added sections: none. Removed sections: none.
Clerical correction (2026-06-29): the footer "Last Amended" date for v3.4.0 was recorded as
                2026-06-27 (carried over unchanged from the v3.3.0 amendment) even though v3.4.0
                post-dates it; it is corrected to 2026-06-29, the date v3.4.0 actually landed
                (the feature 004 artifacts that cite v3.4.0 are dated 2026-06-29). Metadata-only:
                no principle text and no version number changes.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; the new V rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required. (Per-feature
       tasks for UI stories MUST now include an E2E task; enforced at /speckit-tasks time, not in
       the template.)
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.2.0 → 3.3.0
Bump rationale: MINOR. Reconciles the constitution with the 003 "Layout and app tweaks" feature
                (clarify session 2026-06-27). Principle I: adds project root-folder exclusivity as
                a fundamental restriction (no shared/ancestor/descendant roots; enforced on create
                and edit). Principle XI: the Sidebar Pane stays shown by default when no project is
                active (so a project can be selected) while the File Explorer Pane defaults to
                collapsed; adds a Sub-workspaces Panel to the sidebar and makes sub-workspaces
                first-class named/coloured/listed/managed entities (close = keep, delete = destroy,
                lazy reopen); windows form a focus/raise group with independent minimise, and
                closing the main window closes all sub-workspaces. Architecture: adds single-instance
                and lazy-project-loading constraints and a user-scoped config-files (settings /
                keybindings / themes) constraint. Refinements within an existing principle and new
                additive constraints — no principle removed or fundamentally redefined.
                ---- prior amendment (historical) ----
Version change: 3.1.0 → 3.2.0
Bump rationale: MINOR. Adds an "Incremental (staged) delivery" rule to Development Workflow &
                Quality Gates and relaxes (without removing) the timing of two Principle I
                requirements and one Principle XI requirement, so a capability mandated by the
                constitution MAY be delivered across features — e.g. the File Explorer Pane
                introduced as an empty shell ahead of its file-tree content and Markdown preview
                (feature 003 scope reduction, 2026-06-27). Backward-compatible: every
                previously-compliant design remains compliant (this is a relaxation that adds an
                allowance, not a redefinition). End-state requirements are UNCHANGED and MUST
                remain tracked as deferrals until delivered. Also relaxes Principle XI's no-project
                wording so a hidden pane MAY collapse to a slim reveal affordance the user can
                expand to an empty pane.
                ---- prior amendment (historical) ----
Version change: 2.0.0 → 3.0.0
Bump rationale: MAJOR. Backward-incompatible redefinition (and rename) of Principle XI
                to match the redesigned specs/002-panes-and-panels (second /speckit-clarify
                session, 2026-06-26). The previous three-Pane / Middle-tabbed model
                (Left=project list, Right=terminal list, Middle=tabbed terminals; every
                non-Middle Pane stacks) is REPLACED by a three-entity, two-Pane model:
                  - Panes (TWO by default): a stacked Sidebar Pane (Projects + Terminals
                    Panels) and a Workspace Pane (the active project's tab group).
                  - Tabs (new entity): live only in the Workspace Pane; each Tab is a
                    split tree of Panels.
                  - Panels: tiled within a Tab; reattach only to their original project;
                    the main workspace never mixes projects.
                Tear-off now detaches Tabs/Panels into "sub-workspaces" that may mix
                projects. Designs compliant under v2.0.0 (three Panes, Middle-tabbed) are
                non-compliant now — hence MAJOR. Also adds a "Per-user local storage"
                architecture constraint (no login; local profile; owner/user key for future
                multi-user + import/export) and minor terminology tweaks in Principle VI.

Principles (still 11):
  I.    Project-First Context Isolation          (unchanged; now actively built by 002)
  II.   Platform-Abstracted Core (OS-Agnostic)   (unchanged)
  III.  Detached, Tagged & Persistent Terminals  (unchanged; terminal-Panel wording still valid)
  IV.   Native Terminal Support & Auto-Detection (unchanged)
  V.    Test-First Quality Discipline            (unchanged)
  VI.   Simple, Modern, Discoverable UX          (TWEAKED: terminology — tabs hold multi-Panel
                                                  split layouts; Panels tiled within Tabs in
                                                  the workspace Pane beside a stacked sidebar)
  VII.  Change Review & Approval                 (unchanged)
  VIII. SOLID, DRY & YAGNI Engineering Discipline (unchanged)
  IX.   Dependency Injection & Composition Root  (unchanged)
  X.    Externalised Configuration               (unchanged)
  XI.   Dockable Panel & Pane Workspace          (RENAMED → "Dockable Workspace: Panes, Tabs &
                                                  Panels"; REDEFINED to the two-Pane / tab-group /
                                                  split-Panel / sub-workspace model above)

Renamed principles: XI "Dockable Panel & Pane Workspace" → "Dockable Workspace: Panes, Tabs & Panels"
Added sections: none (one new bullet under Technology & Architecture Constraints: Per-user local storage)
Removed sections: none

Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md   — "Constitution Check" gate references the
       constitution dynamically ("Gates determined based on constitution file"); the
       redefined Principle XI is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md    — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md    — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml                 — no before/after_constitution hooks registered.
  ✅ specs/002-panes-and-panels/spec.md      — already written to this model (two Panes, tab
       groups, split Panels, real projects, sub-workspaces, local-profile storage); now
       consistent with this constitution (supersedes the v2.0.0 alignment).
  ✅ specs/001-app-bootstrap/*               — bootstrap feature; no Panel/Pane/Tab behaviour,
       unaffected by this amendment.

Deferred TODOs: none.
-->

# throng Constitution

throng is a project-first, terminal-second, agent-third desktop application for
managing many independent command-line terminals and folders across multiple
projects. These principles are the non-negotiable rules that govern how throng
is designed, built, and evolved.

## Core Principles

### I. Project-First Context Isolation

The project is the root context of the entire application; everything else is
scoped beneath it.

- A project MUST be a first-class entity with, at minimum, a friendly name, a
  root folder path, and a dominant colour.
- A project's root folder MUST be **exclusively bound** to that project: no two
  projects may share the same root folder, and no project's root may be an
  ancestor (parent) or a descendant (subfolder) of another project's root. This
  is a fundamental restriction enforced on both project creation and editing, so
  that every file belongs to exactly one project.
- Each project MUST expose its root folder as a navigable workspace folder
  structure (akin to VS Code's explorer), scoped to that project. This is an
  end-state requirement that MAY be delivered incrementally — for example, the
  File Explorer Pane (Principle XI) MAY be introduced as an empty shell before its
  tree content lands — provided each released increment is internally consistent
  and the outstanding work is tracked under the Incremental Delivery rule
  (Development Workflow & Quality Gates).
- The workspace MUST be able to render previews of supported document files —
  Markdown (`.md`) preview at minimum — alongside the raw file view. This
  capability MAY be delivered in a later feature increment under the Incremental
  Delivery rule; until it lands, its absence MUST be recorded as a tracked deferral
  in the owning plan's Complexity Tracking.
- A user MUST be inside a selected project to spawn, view, or interact with any
  terminal. No terminal MAY exist outside a project context.
- When a project is selected, only that project's terminals, layout, and edit
  list MAY be active and visible; other projects' state MUST be hidden and
  isolated from the current view.
- Switching the active project MUST be a single, low-friction action and MUST
  fully swap the active terminal set, the workspace folder view, the edit list,
  and the dominant project colour.

Rationale: The user's core frustration with existing tools is the lack of clean,
native, per-project terminal isolation. Making the project the root context —
including its files, terminals, and pending edits — is the defining
characteristic of throng, not an afterthought.

### II. Platform-Abstracted Core (OS-Agnostic)

All operating-system-specific behaviour MUST sit behind abstractions; the core
application logic MUST remain platform-independent.

- Process spawning, terminal detection, filesystem paths, file-change watching,
  and process reattachment MUST be defined as abstract contracts (interfaces)
  with OS-specific concrete implementations selected at runtime.
- Core logic (project model, terminal lifecycle orchestration, edit-list state,
  layout state) MUST NOT contain direct OS calls or hardcoded OS assumptions.
- Windows is the first supported target, but no design decision MAY foreclose
  future macOS or Linux implementations.

Rationale: The user explicitly requires a technology choice that supports
multiple operating systems and code structured so OS-specific concrete
implementations can be added later without rewriting the core.

### III. Detached, Tagged & Persistent Terminals

Terminal processes MUST be decoupled from the application's host (UI) process
lifecycle, and MUST carry enough identity to be restored across restarts.

- Each terminal MUST be associated with exactly one shell (e.g. PowerShell 5,
  PowerShell 7, Git Bash/MINGW64, CMD), one owning project, and one running
  process.
- Each terminal/window MUST be tagged with a durable project identifier plus the
  metadata required to restore it (shell type, working directory, title, layout
  position, and launch command/preset). This tag is how terminals are matched
  back to their project on startup.
- Spawned terminals MUST run as independent processes; the failure, restart, or
  closure of one terminal MUST NOT cascade to others or to the host application.
- **No orphaned OS processes (resource hygiene).** When a terminal ends by ANY path
  — user close/kill, panel-destroy, project-delete, application-close "terminate all",
  the shell exiting on its own, or daemon shutdown — every OS resource it created MUST
  be released, including any auxiliary host process the platform spawns per terminal
  (e.g. the Windows/ConPTY `conhost.exe`). A terminal-hosting process MUST reap its
  terminals before exiting, and a detached helper process MUST self-terminate when the
  process it serves is gone. This MUST be verified by a **process-level E2E** that
  asserts the host's terminal-related child processes return to baseline after each
  end path (never merely that the UI updated).
- **No orphaned terminal windows/views on user-instructed destruction.** When the user
  instructs the application to destroy a terminal by ANY path — closing/killing the
  terminal, destroying its hosting **Panel**, deleting the owning project, or choosing
  "terminate all" on application close — the terminal's on-screen surface (its window or
  Panel view) MUST be fully torn down together with its process (per the resource-hygiene
  rule above). No terminal window, view, or ghost surface MAY be left behind. A destroy
  the user commanded MUST complete: the terminal MUST NOT survive, silently reappear, or
  linger as an orphaned window after the user has ordered its destruction. (This is
  distinct from a *deliberate close of the terminal alone*, where the empty hosting Panel
  is intentionally retained per the rule below.)
- A terminal and the **Panel** that hosts it (Principle XI) are separate entities;
  a terminal's lifecycle MUST NOT govern its Panel's lifecycle.
- When a terminal's process exits **unexpectedly** (not user-initiated), the
  terminal MUST surface the failure rather than vanish silently: the process's
  failure message(s)/error output and its exit code MUST be displayed to the user.
- When the user **deliberately closes or kills a terminal**, the terminal MUST
  close, but its hosting panel MUST remain in place — empty and ready to host a
  new terminal.
- Terminal lifecycle on close/reopen MUST follow these exact rules:
  - A terminal **with an active running process** MUST remain running in the
    background when its project or the application is closed, and MUST be
    re-attached to the UI (live session + restored scrollback) when reopened.
  - A terminal **with no active running process** (idle shell) MUST be closed
    when its project or the application is closed, and MUST be re-created in a
    new process when the project or application is reopened.
- When the application is closed while one or more terminals have active running
  processes, the user MUST be warned and offered exactly three choices:
  (A) close and leave terminals running in the background, (B) close and
  terminate all terminals, or (C) cancel and review the open terminals.
- Terminal **presets** (saved shell + working directory + startup command sets)
  MUST be definable per project and executable by the user when a project opens
  cold, so an idle project can be reconstituted to a known working state.
- **Terminal elevation follows the application.** A terminal inherits the operating-system
  privilege (integrity) level of the terminal-hosting process; running a terminal **as
  administrator** therefore requires launching throng itself **elevated** — there is no
  separate elevation broker. A per-terminal "run as admin" flag MAY be offered, but MUST be
  available only when the host is elevated; when the host is not elevated the flag MUST be
  disabled. When the host is elevated, a terminal without the flag MUST run at normal
  integrity (de-elevated). Elevation detection and de-elevation are OS-specific and MUST sit
  behind the Principle II abstractions.

Rationale: Watchers, servers, and long-running agents must not die when the UI
closes; idle shells carry no state worth preserving and are cheaper to recreate.
Encoding identity on each terminal is what makes reliable reattachment — rather
than guesswork — possible across restarts. Surfacing an unexpected exit (message
and code) stops a broken watcher or server from dying silently, and separating the
terminal from its panel lets the workspace layout stay stable as terminals come
and go.

### IV. Native Terminal Support & Auto-Detection

throng MUST host real, installed terminals natively rather than emulating a
single shell.

- throng MUST support any installed terminal shell (e.g. PowerShell 5,
  PowerShell 7, MINGW64/Git Bash, CMD) and MUST auto-detect installed shells
  where the platform permits.
- A newly spawned terminal's working directory MUST be set to the active
  project's root folder.
- Running terminals within a project MUST be clearly listed and switchable.

Rationale: Working natively in the command line for each agent is the user's
primary unmet need. Auto-detection and correct working-directory defaults remove
the friction that drove the user away from other tools.

### V. Test-First Quality Discipline (NON-NEGOTIABLE)

Behaviour MUST be specified by tests before implementation, following the XP
Red-Green-Refactor cycle.

- For each feature or fix, tests MUST be written first, MUST fail before
  implementation (Red), MUST pass after the minimal implementation (Green), and
  the code MUST then be refactored under a green bar (Refactor).
- A layered automated test strategy MUST be maintained:
  - **Unit tests** — fast, isolated tests for individual units of logic, with
    collaborators substituted via injected test doubles (see Principle IX).
  - **Integration tests** — verify cross-component behaviour, abstraction
    contracts, IPC, and persistence against real (or realistic) implementations.
  - **End-to-end (E2E) tests** — exercise critical user journeys through the
    running application using an appropriate automated E2E tool for the platform
    (the specific tool is pinned in feature plans, not here).
- **Every user-facing UI change MUST ship with E2E test coverage.** Any change that
  adds or alters renderer/UI behaviour — new or changed controls, menus, dialogs,
  drag-and-drop interactions, layout, panes, status indicators, theming, and the
  like — MUST include new or updated automated E2E tests that exercise the changed
  behaviour through the running application, and those tests MUST be observed passing
  before the change is considered complete. A UI change MUST NOT be marked done on
  the strength of build, type-check, or unit/integration evidence alone. Pre-existing
  UI shipped without E2E coverage MUST have that coverage backfilled as a tracked
  deferral under the Incremental Delivery rule rather than left permanently uncovered.
- Abstraction contracts (Principle II) MUST have contract tests that any
  OS-specific implementation is verified against.
- Process lifecycle behaviour (spawn, detach, tag, persist, idle-close,
  reattach, cold-respawn) MUST be covered by automated tests; success MUST NOT
  be claimed without observed passing output.
- **Generated test artifacts and temporary files MUST be cleaned up.** Files
  created by or for a test run, and any scratch/temporary files produced during
  development or a test's execution — on-disk fixtures, temp scripts, throwaway
  `tmp.*` sources, and generated output — MUST be removed once they have served
  their purpose and MUST NOT be committed or left lingering in the working tree.
  Tests MUST clean up the artifacts they create (self-cleaning setup/teardown, or
  writing under a temp location that is torn down), and one-off temporary files
  created while developing MUST be deleted before a change is considered complete.
  A green test bar MUST NOT leave orphaned generated files behind.
- **Privilege-dependent behaviour MUST be tagged and elevation-gated.** Tests
  whose behaviour depends on running **elevated** (administrator / high integrity)
  — the "run as admin" terminal path and OS **de-elevation** (Principle III /
  FR-025) — MUST be tagged **`@admin`** and MUST be **skipped when the test process
  is not elevated** (never asserting a hollow non-elevated baseline in their place).
  Such behaviour MUST NOT be claimed verified on the strength of a non-elevated run;
  it MUST be observed passing under an **elevated** run (a dedicated elevated test
  entry point). Because a normal (non-elevated) run therefore cannot cover it, every
  E2E run MUST emit a **reminder** that the `@admin` suite is only verified when run
  elevated, so missing admin coverage is never silently implied by a green bar.

Rationale: The hardest, riskiest parts of throng — detached process lifecycle,
cross-platform abstractions, and persisted edit state — are exactly where
regressions hide. Test-first discipline across the unit/integration/E2E layers
keeps the abstraction boundary honest and the persistence guarantees trustworthy.

### VI. Simple, Modern, Discoverable UX

The interface MUST be simple to understand and modern in feel.

- Common actions (switch project, spawn terminal, switch terminal, run a preset)
  MUST be reachable without instruction.
- Each project MUST support multiple tabs, and each tab MUST support a
  user-configurable multi-**Panel** split layout (e.g. four terminals tiled as
  quadrants in the work area, freely resizable and rearrangeable via drag-and-drop).
- The workspace is composed of **Panels** tiled within **Tabs** inside the workspace
  **Pane**, beside a stacked sidebar **Pane**, as defined in Principle XI; a terminal
  Panel is separate from the terminal process it hosts (Principle III).
- Tab, Panel, and Pane layout — including any detached windows — MUST be persisted
  per project and restored when the project is reopened.
- The interface SHOULD provide modern affordances such as resize handles,
  drag-and-drop panels, and themes, but these MUST NOT obscure core flows.
- The selected project's colour MUST be visually dominant so the active context
  is unambiguous at a glance.

Rationale: The user has rejected tools that are too cumbersome. Configurable
tabbed, tiled layouts are a primary workflow requirement, and clear context
signalling via the project colour keeps a busy multi-terminal workspace legible.

### VII. Change Review & Approval

throng MUST surface file changes made within a project and let the user review
them without mutating the files further.

- For each project, file changes produced by any terminal or agent MUST be
  monitored and aggregated into a single combined, project-scoped edit list —
  changes from multiple terminals/windows MUST appear together in that one list.
- The user MUST be able to approve or deny changes at line-by-line, whole-file,
  and whole-set granularity.
- Approval and denial MUST be review bookkeeping only: they check items off the
  list and MUST NOT modify file contents (the edits are already on disk).
- The edit list MUST be persisted between sessions; unapproved changes MUST be
  reloaded in new sessions so review can continue later.

Rationale: When multiple agents and watchers edit a project concurrently, the
user needs one trustworthy place to see and reason about what changed,
Copilot-style, without the review tool itself becoming another mutation source.

### VIII. SOLID, DRY & YAGNI Engineering Discipline

Production code MUST be written to recognised enterprise engineering standards.

- Code MUST adhere to the SOLID principles — single responsibility, open/closed,
  Liskov substitution, interface segregation, and dependency inversion (depend on
  abstractions, not concretions).
- Code MUST follow DRY: knowledge and logic MUST have a single authoritative
  representation; duplication MUST be refactored out rather than copied.
- Design MUST follow YAGNI: build only what a current, specified requirement
  needs. Speculative generality MUST NOT be added "in case" it is needed later.
- Established enterprise design patterns MUST be applied where they genuinely
  reduce complexity or coupling, and MUST NOT be applied ceremonially where they
  add indirection without benefit (YAGNI governs this tension).

Rationale: These are the baseline standards an enterprise codebase is judged by.
SOLID and DRY keep the OS-abstraction boundary and feature layers maintainable;
YAGNI stops the abstraction from ballooning into speculative over-engineering.

### IX. Dependency Injection & Composition Root

All collaboration between components MUST be wired through dependency injection.

- Components MUST receive their dependencies via **constructor injection**.
  Service-locator, ambient/static singletons, and `new`-ing collaborators inside
  business logic are prohibited.
- Dependencies MUST be expressed as abstractions (interfaces), reinforcing the
  dependency-inversion rule of Principle VIII and the contracts of Principle II.
- Each **application boundary** — each independently runnable process (for example
  the detached daemon and the UI main process) — MUST have **exactly one composition
  root**: a single IoC container configured in one file for that boundary. Within a
  boundary, object graphs are composed there and nowhere else, and the rest of that
  boundary's code MUST remain unaware of the container. A multi-process system therefore
  has one composition root per boundary, never one shared global container (processes
  cannot share an in-memory container) and never more than one container per boundary.

Rationale: One composition root per application boundary makes each process's wiring
explicit and testable, keeps OS-specific implementations swappable, and is what makes
the unit-testing layer of Principle V possible (collaborators replaced by injected test
doubles). Scoping the rule to the boundary — rather than to the whole system — is what
lets the required daemon/client split (two processes) stay compliant: each process owns
exactly one container, so the "single composition root" discipline holds within every
process.

### X. Externalised Configuration

Configuration MUST be separated from code.

- Configuration values (paths, timeouts, IPC endpoints, feature flags, limits,
  and similar) MUST NOT be hardcoded in business logic; they MUST be abstracted
  into application settings.
- Settings MUST be exposed to code through typed settings abstractions that are
  injected via constructor injection (Principle IX), never read ad hoc from the
  environment deep inside components.
- Defaults MUST be sensible and documented; environment- or machine-specific
  values MUST be overridable without code changes.

Rationale: Externalised, injected configuration keeps the codebase portable
across machines and future operating systems, makes behaviour testable by
substituting settings, and prevents magic values from scattering through the
code.

### XI. Dockable Workspace: Panes, Tabs & Panels

The workspace MUST use a VS Code / Visual Studio-style docking model built from
three distinct entities:

- A **Panel** is the atomic, draggable content unit. In the workspace a Panel hosts
  an editor or a terminal; in the sidebar the project list and the sub-workspaces list
  are Panels. A Panel is separate from any process/content running inside it — a terminal
  Panel persists when its terminal process ends (Principle III).
- A **Tab** is a workspace view that contains a **split arrangement (tree) of one or
  more Panels** (Panels tiled into rows/columns to arbitrary depth). Tabs exist only
  in the workspace Pane.
- A **Pane** is a top-level docking zone. The default layout has **two** Panes.

The model MUST obey these rules:

- The default layout MUST provide at least two top-level Panes. When a project is
  active, the layout is three Panes: a **Sidebar Pane** hosting the **Projects**
  Panel and a **Sub-workspaces** Panel **stacked** (non-tabbed), with the
  **Sub-workspaces Panel pinned to the bottom** of the pane; a **Workspace Pane**
  showing the **active project's** workspace; and a **File Explorer Pane** on the
  right showing the active project's file and folder hierarchy (which MAY be
  introduced as an empty shell ahead of its tree content per the Incremental Delivery
  rule). When no project is active, the **Sidebar Pane MUST remain shown by default**
  (so the user can select a project) unless the user has explicitly hidden it, while
  the **File Explorer Pane defaults to collapsed** but remains expandable to an empty
  placeholder. Each pane's visibility and width are user-controlled and persisted.
  The Workspace Pane (showing a project-selection prompt) remains visible.
- The Workspace Pane MUST be a **tab group**: one or more **Tabs**, exactly one
  active, with an unlimited number of Tabs that MUST be reorderable.
- Within a Tab, a Panel MUST be **splittable** by dragging another Panel to its edge,
  tiling the Tab into rows/columns to arbitrary depth; Panels MUST be draggable
  between split positions and between Tabs.
- Dragging the last Panel out of a split slot MUST collapse that slot; a Tab whose
  last Panel is removed MUST cease to exist; the active project's workspace MUST
  always retain at least one Tab containing at least one Panel.
- A **Tab** (with all its Panels) or a single **Panel** MUST be detachable
  ("disconnected") into a separate OS window — a **sub-workspace**. A sub-workspace
  MUST contain one or more Tabs (each with at least one Panel) and MAY hold
  Tabs/Panels from **multiple projects**; it cannot exist empty.
- A **sub-workspace is a first-class entity**: created at runtime by detach, it has
  an independent friendly name and dominant colour (no project folder), is listed and
  managed (rename / recolour / delete) in the Sidebar Pane's Sub-workspaces Panel,
  and is persisted. **Closing** a sub-workspace window retains it (reopenable);
  **deleting** it from the list destroys it. Sub-workspaces, like projects, are
  reopened **lazily** (listed at startup, opened on demand).
- The main window and every sub-workspace window MUST behave as a single
  **focus/raise group**: focusing any one of them MUST bring them all to the
  foreground together (they share one effective OS Z-order). **Minimise/restore MAY
  be independent** per window. Closing the main window (application exit) MUST close
  all sub-workspace windows.
- Only **Panels** MUST be reattachable to the main workspace, and only into **their
  original project's** workspace. The **main workspace MUST NOT mix Panels from
  different projects**; cross-project mixing exists only inside sub-workspaces. A
  Panel whose original project no longer exists MUST be retained, not discarded.
- The full per-project arrangement (Tabs, each Tab's split tree, sizes, and the
  active Tab) and all sub-workspaces (with their on-screen positions) MUST be
  persisted per project and restored on reopen (Principle VI); a restored window on
  an unavailable display MUST be brought back onto a visible one.

Rationale: A VS Code / Visual Studio docking model — a stacked sidebar (project and
sub-workspaces lists) beside a tabbed workspace whose Tabs tile editors and terminals into
split Panels, plus tear-off sub-workspaces that travel together as one focus group —
is what makes a many-terminal, multi-monitor, multi-project workspace shapeable
without fragmenting the application's focus or losing the saved layout. Keeping the
main workspace single-project preserves the project-first isolation of Principle I,
while sub-workspaces give the user one deliberate, bounded place to combine projects.

## Technology & Architecture Constraints

- **Baseline stack (chosen):** Electron + TypeScript for the UI, an xterm.js-family
  renderer for terminals, and `node-pty` (ConPTY on Windows) for PTY spawning.
  Specific library and version choices are recorded in feature plans, not here.
- **Daemon/client architecture (required):** Terminals MUST be owned by a
  persistent, detached daemon process — not by the UI process — so that closing
  the UI does not kill terminals (this is how Principle III is met). The UI is a
  client that connects to the daemon over local IPC (e.g. a named pipe on
  Windows) and reattaches to existing PTYs and their buffered scrollback on
  launch.
- **Change tracking:** The combined edit list (Principle VII) MUST be driven by
  filesystem watching of the project root behind the OS abstraction of
  Principle II.
- Using an existing open-source base (e.g. VS Code OSS components such as
  xterm.js, node-pty, and the pty-host pattern) is permitted and encouraged where
  it accelerates delivery, but MUST NOT violate the project-first model, the
  detachment/persistence guarantees, or the OS-agnostic core. Forking the entire
  VS Code editor is out of scope; reuse components, not the whole IDE.
- Persistent state required to restore the application (project definitions,
  terminal tags/records, presets, layouts, and the unapproved edit list) MUST be
  stored durably outside the host process memory.
- **Idempotent data migrations:** Every schema or data migration MUST be idempotent.
  Re-running a migration, or running it against a store that is already at (or past)
  the target version, MUST be safe and MUST converge on the same end state — it MUST
  NOT error, and MUST NOT duplicate, corrupt, or double-apply data. Migrations MUST
  therefore be written defensively (e.g. guard against columns/tables/rows that
  already exist, use create-if-not-exists / additive operations, and key changes off
  the recorded schema version) so that an interrupted, partially-applied, or repeated
  run heals to the correct state rather than failing or diverging.
- **Per-user local storage:** throng runs as the logged-in operating-system user
  with no in-app authentication; all persistent state MUST be stored in that user's
  local profile and MUST carry an owner/user key, so that future multi-user support
  and import/export of project setup data can be added without reshaping the store.
  User-scoped application configuration (settings, keybindings, and themes) MUST be
  stored as human-editable files in the user's profile (under a per-user throng
  configuration directory).
- **Single instance:** The application MUST run as a single instance per user; a
  second launch while an instance is running MUST not start a second instance.
  Multiple concurrent instances are disallowed because they would fracture terminal
  and project ownership.
- **Lazy project loading:** Projects MUST be loaded lazily — selected/opened on
  demand rather than all at startup — and, once loaded, MAY remain in memory for the
  session. Sub-workspaces are likewise opened on demand.
- Agent-specific tooling is explicitly future scope; the architecture MUST keep
  agents as a layer above terminals so they can be added without reworking the
  project or terminal layers.

## Development Workflow & Quality Gates

- Work MUST flow through the Spec Kit lifecycle: constitution → specify →
  (clarify) → plan → tasks → implement, with each plan passing the Constitution
  Check gate before design proceeds.
- **Incremental (staged) delivery:** A capability mandated by this constitution MAY
  be delivered across multiple features rather than all at once, provided: (a) every
  released increment is internally consistent and violates no principle in its own
  right; (b) the not-yet-delivered remainder is explicitly recorded as a tracked
  deferral in the owning plan's Complexity Tracking, naming the end-state requirement
  and the feature expected to complete it, and surfaced in the project roadmap
  (`ROADMAP.md`) as a planned item (the single forward-looking list per the
  Documentation-currency rule); and (c) the end-state requirement is never
  weakened or dropped — only its delivery is sequenced. Introducing a structural seam
  (e.g. a pane shell) ahead of its content is the canonical example. Incremental
  delivery MUST NOT be used to ship a permanently incomplete capability.
- Every plan MUST be evaluated against all eleven principles; any violation MUST
  be recorded and justified in the plan's Complexity Tracking section or the
  design MUST be revised to comply.
- Changes that touch the OS abstraction boundary, the daemon/terminal process
  lifecycle, or persisted edit/layout state MUST be reviewed with particular
  scrutiny against Principles II, III, V, and VII.
- **Documentation MUST be kept current as part of the lifecycle (NON-NEGOTIABLE).**
  Any change that alters user-facing behaviour, setup or commands, architecture, or the
  set of delivered/planned capabilities MUST update the affected project documentation
  **in the same change**, at minimum:
  - **`README.md`** — describes the application's **current, finite shipped state** only:
    what it is and does now, its architecture, prerequisites, commands, and configuration.
    It MUST NOT be written as a per-feature changelog or narrate feature numbers/increments;
    a superseded description MUST be replaced, not appended, so the README always reads as a
    truthful snapshot of the app as it currently exists.
  - **`CONTRIBUTING.md`** — the contribution process, required/recommended toolchain, testing
    bar, and developer setup, kept consistent with how the project is actually built and tested.
  - **`ROADMAP.md`** — the single forward-looking list: delivered capabilities marked done and
    newly planned capabilities added. Anything that is future scope lives here, **not** in the
    README.
  This reconciliation is part of **`/speckit-converge`** and the definition of done: a change
  MUST NOT be considered complete, and a PR MUST NOT be merged, while any of these documents
  disagrees with the shipped behaviour of the change.
- **Configuration editors MUST stay in sync with all configurable options (NON-NEGOTIABLE).**
  Every configurable application setting, key binding, and theme token MUST be exposed and editable
  through the visual preference editors; when new configuration is added to the application, the
  corresponding editor MUST be updated to expose it, so no configuration is editable only by
  hand-editing JSON. This MUST be enforced by a **declarative editor-metadata registry** (a single
  authoritative source with one descriptor per configurable setting / key-binding action / theme
  token, living in the platform-agnostic core) **plus a completeness test** asserting every
  configurable key/action/token has exactly one descriptor — so a newly added config key without an
  editor descriptor **fails the test**. A change that adds or alters configurable options MUST NOT be
  considered complete, and a PR MUST NOT be merged, while any configurable key lacks its editor
  descriptor. (A raw-JSON escape hatch MAY be offered in addition to, never instead of, the visual
  editor.)
- Code review MUST verify the engineering gates: Red-Green-Refactor with the
  unit/integration/E2E layers present (V), SOLID/DRY/YAGNI adherence (VIII),
  constructor DI wired only through each boundary's single composition-root
  container (IX), configuration sourced from injected settings rather than
  hardcoded (X), that the project documentation (README, CONTRIBUTING,
  ROADMAP) has been brought current with any user-facing, setup, architecture,
  or capability change (Documentation currency rule above), and that any newly
  added configurable option is exposed through the visual preference editors and
  covered by the editor-metadata completeness test (Configuration-editor
  completeness rule above).

## Governance

- This constitution supersedes other development practices where they conflict.
- Amendments MUST be made by editing this document, MUST state the rationale, and
  MUST update the version and dates below per the versioning policy.
- Versioning policy (semantic):
  - MAJOR: removal or backward-incompatible redefinition of a principle or
    governance rule.
  - MINOR: addition of a new principle or section, or materially expanded
    guidance.
  - PATCH: clarifications and wording fixes that do not change meaning.
- Compliance is verified at the Constitution Check gate of every plan and during
  code review. Complexity that violates a principle MUST be justified or removed.

**Version**: 3.11.0 | **Ratified**: 2026-06-25 | **Last Amended**: 2026-07-08
