# Implementation Plan: Vault links, a notifications panel and agent session restore

**Branch**: `feature/S068-vault-links-notifications-agent-restore` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/068-vault-links-notifications-agent-restore/spec.md`

## Summary

Five pieces of work over four surfaces. Wikilinks and image embeds share one resolution rule in core, decided by main's batch answer and applied to every use of a link. Toasts keep their surface but arm one global duration that pauses under the pointer or focus; persistent notices also go to a main-process store, shown in a new Notifications panel in the right pane, with minimise added to the side-pane panel stack. The daemon identifies a running Claude Code process's session from Claude Code's own per-process record and publishes a resume command beside the plain command. Every diagnostic log line passes one anonymiser at the file log's chokepoint. Decisions are in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 7, Node 24, Electron 44, React 19

**Primary Dependencies**: existing only (markdown-it, DOMPurify, node:crypto HMAC in main/daemon/agent for token hashing)

**Storage**: `userData/notifications.json` (main, atomic writes) for panel entries; `settings.json` for the new notification settings; renderer `localStorage` for side-panel sizes and minimised state; the daemon's SQLite for project id healing; a salt file in the logs folder

**Testing**: Vitest unit, component, integration and contract. E2E only where a real window is under test: a notice from another window reaching the main window's panel (FR-030), and entries and minimised state surviving a restart (FR-031, FR-038)

**Target Platform**: Windows and Linux, together (Principle II)

**Project Type**: desktop app (Electron main, renderer, detached daemon, PTY agent)

**Performance Goals**: a wikilink batch of 500 resolves in one IPC round trip, as today; the session resolver adds no per-terminal cost beyond one cached file read per Claude process (FR-046); the anonymiser adds under 1 ms to a typical log line

**Constraints**: toast timing pauses only on pointer or focus; no notice for a resume failure (FR-055); no raw path, name or command in any log file (FR-034f); a corrupt notifications file never stops startup (FR-031c)

**Scale/Scope**: 5 stories plus #623, FR-001 to FR-055, SC-001 to SC-007

## Constitution Check

| Principle | How this holds |
|---|---|
| I Project-first | wikilink and embed targets stay confined to the preview's project by real path; the root fallback never leaves the project |
| II Platform abstraction | the Claude session record lives at the same relative place on both OSes; argv recovery has a Linux reader and a Windows tokenizer behind one resolver port; the anonymiser handles both path forms |
| III Terminals | a terminal still running is reattached, never restarted; the resolver reads files only and never touches a live terminal |
| IV Keyboard tiers | no new chord |
| V Testing | failing test first at the lowest layer; E2E only for the two window-level outcomes above |
| VI UX | every new control is a themed icon with a menu item; the panel says when it is empty |
| VII Change review | Dismiss all asks first unless the user turned that off |
| VIII SOLID, DRY, YAGNI | one wikilink rule, one image path, one store, one anonymiser |
| IX DI | the session resolver, notification store and anonymiser are bound in their composition roots |
| X Configuration | three new settings (`toastDurationMs`, `confirmDismissAll`, `panelLimit`), each with a descriptor, default, editor and a reader; the removed timeouts are upgraded, not left inert |
| XI Workspace | the Notifications panel is a fixed part of the right pane, not a panel type |
| XII Responsive | store writes are queued off the input path; the resolver is time-bounded in the daemon |
| XIII Failure trace | store and resolver failures are logged; the log itself stops leaking the machine |

## Project Structure

### Documentation

```text
specs/068-vault-links-notifications-agent-restore/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ipc.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── preview/        wiki-links.ts, links.ts, embeds.ts (image extensions)
├── notice/         display-mode.ts, notification-entries.ts (new), log-record.ts
├── config/         app-settings.ts, settings-metadata.ts, settings-read.ts, theme.ts, theme-copy.ts, shipped-defaults.ts
├── terminal/       claude-resume.ts (new), command-line-args.ts (new)
├── diagnostics/    anonymise.ts (new)
├── projects/       project-service.ts (id heal)
└── abstractions/   claude-session.ts (new resolver port)
packages/platform-node/src/   node-file-log.ts (anonymiser in emit and crash reports), machine-identity.ts (new)
packages/platform-linux/src/  proc-table.ts (argv reader)
packages/ipc-contract/src/    terminal.ts (memoryCommand)
packages/daemon/src/          terminal-service.ts, claude-session-resolver.ts (new), composition-root.ts, main.ts, pty-agent-log.ts
packages/persistence/src/     project-repository.ts (id heal)
packages/ui/src/main/         notification-store.ts (new), main.ts, notice-log.ts, diagnostics.ts, daemon-lifecycle.ts, preview-service.ts, preview-protocol.ts, preferences-window.ts
packages/ui/src/preload/      preload.cts
packages/ui/src/renderer/     common/notification.tsx, notifications/ (new panel, menu, badge, hook), attention/, panes/vertical-panel-stack.tsx,
                              panes/file-explorer-pane.tsx, app.tsx, sidebar/subworkspaces-panel.tsx, sidebar/projects-panel.tsx,
                              preview/providers/markdown/ (wikilinks, sanitise, embeds, pipeline, markdown-body), terminal/ (command-store, terminal-panel),
                              panel-type/terminal-inputs.tsx, preferences/, explorer/paste-progress-notice.tsx, common/different-copy-notice.tsx,
                              common/installed-version-notice.tsx, find-in-files/
```

**Structure Decision**: The existing monorepo. Nothing new at package level.

## Delivery order

1. **Core rules** (pure, unit-tested): wikilink candidates and display text, image embed refs, display modes and their upgrade, notification entries, Claude resume command and argv tokenizer, anonymiser.
2. **Wikilinks and embeds** (#616, #615) end to end: main resolution, sanitiser, renderer resolution, embeds.
3. **Settings and toasts** (#618 part 1): new modes and settings, the pre-guard upgrade, toast duration with hover/focus pause, close X, sticky toasts, expire vs dismiss.
4. **Notifications panel** (#618 part 2): main store and IPC, panel, ordering, Dismiss all, limit and warning, cross-window add, minimise for both panels, pending badge, Preferences deep link.
5. **Session resume** (#189): resolver port and daemon implementation, argv recovery, contract field, renderer persistence, FR-051 text.
6. **Anonymised log** (#623): anonymiser wiring in every process, crash reports and the startup log, notice records, project id heal and hover.
7. **E2E adjustments, docs**, the shipped-defaults bump.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **FR-021's "every toast leaves" has four exceptions (now FR-021e, derived)**: the paste-progress card, the different-copy notice, the installed-version notice and FR-031f's limit warning are `sticky` and never time out. | Each carries the only control for something live: Cancel on a running paste (067 FR-037), a decision 058 FR-018 and 063 FR-010 require the user to make, and FR-031f's own "until dismissed or acted on". | Letting them time out would remove the only way to cancel a paste and would silently drop two decisions; moving them to the panel is impossible, since they carry live callbacks that cannot be stored (research D6). |
| **Attention notices and Find in Files' replace summary follow the new modes**, which the spec did not name. | Both share the display-mode vocabulary and timeout this feature removes; leaving them on the old names would keep a timeout setting no toast honours (inert, 019 FR-022). | Keeping a second vocabulary contradicts FR-021a. |

## Iteration 2026-11-13 (manual-test feedback)

The maintainer's manual testing (spec Clarifications, Session 2026-11-13) added FR-056 to FR-065, confirmed FR-041c, and found one defect against 044 FR-090b. Constitution v6.5.0 adds Principle VI's "Name the OS generically".

### Design

- **Heading jump after reflow (044 FR-090b, defect).** The chrome scrolls to a fragment once `onDrawn` reports the file on screen, but Mermaid diagrams, image loads and embeds change the height of what is above the heading afterwards. The jump becomes a **held** anchor: after the first scroll, the target heading is re-pinned to the top whenever the body's size changes, while the body is still **settling** — some image not yet `complete`, a Mermaid block or embed not yet drawn. Settling is a published state, not a timer (throng-testing, *A fixed delay that decides is a deadline*). The hold ends when the body has settled, or at the first scroll the reader makes (wheel, scrollbar, keys, pointer), whichever comes first. The hold never records a navigation entry (FR-115 is unchanged).
- **Image size forms (FR-056).** `parseImageEmbedRef` in `packages/core/src/preview/embeds.ts` splits a last `|` segment matching `^\d+$` or `^\d+x\d+$` off as a size. The size travels with the held embed and is applied as `width` (and `height`) attributes when the embed resolves. The sanitiser already allows those attributes on `img`; the preview's existing `max-width: 100%` keeps an oversized width inside the pane.
- **Image hover (FR-057).** `imageTitle` in `sanitise.ts` writes the alt text, a newline, and the source as written; the document's own title is kept after the source on its own line. An embed whose alt text is its default (the file name) writes the source alone.
- **Chevron (FR-058).** The two panel headers render `panes/chevron.tsx` (`dir="down"` open, `dir="up"` minimised) inside the existing icon button. Centring is a flex rule on the button, shared by both panels.
- **Count (FR-059).** `pendingSummary` becomes a count of every entry and the most severe of them. The stored `pending` flag, `setPendingMode`, `clearPending` and `PendingModeReporter` are removed; old stores that carry `pending` load unchanged (the field is ignored).
- **Badge places (FR-060).** One `PendingNotificationsBadge` beside the Notifications header title (always, when the count is above zero) and one on the right rail below its label. The badge on the pane-show-right button goes. Vertical centring by `align-items: center`; the gap is `margin-inline-start: 1ch` (title) and `margin-block-start: 1ch` (rail).
- **Origin (FR-061, FR-063).** A notice that relates to a panel carries an `origin: { panelId }` (or `{ projectId }` for a project-only notice). The notification layer resolves the names through the projects and layout stores when the notice is raised, renders `Project › Tab › Panel` as the notice's context line in the toast and the entry, and adds the same line to the copy text. The entry stores the resolved names and the origin ids, so a restored entry still names its place. The toast's and entry's activation is `goToPanel(origin.panelId)` — the route an attention toast already takes. The whole notice is the click target; buttons stop propagation. A notice whose panel no longer exists is not activatable. The `goToPanel` action descriptor is no longer rendered as a control; existing stored descriptors are ignored. Each raiser that relates to a panel passes the origin; the subject stays as it is.
- **Defaults (FR-062).** `settings-metadata.ts` defaults for attention, info and success become `toastAndPanel`. FR-021d's upgrade map is unchanged.
- **Hover id (FR-064).** `projects-panel.tsx` writes `${path}\n(id: ${id})`.
- **OS wording (FR-065).** The listed strings say "the OS"; product and format names stay.

### Constitution Check (iteration)

| Principle | How this holds |
|---|---|
| V Testing | each change starts with a failing test at the lowest layer: unit for embeds, the image title and the entry count; component for the chevron, badges, origin line and activation; the existing notifications E2E is updated for the badge and click, not widened |
| VI UX | the chevron is the themed `chevron` icon; the whole notice is a link with Enter as its keyboard route; user-visible text names the OS generically (v6.5.0) |
| VIII DRY | one origin resolver serves the toast, the entry, copy and activation; one badge component in two places |
