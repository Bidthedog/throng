# Research: Panel Attention Marks and Terminal Attention Signals

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-10-18

Each decision below names what it rests on in the code today. Paths are repo-relative.

## R1 — Signals are recognised in the daemon, not the renderer

**Decision**: A pure scanner in `packages/core/src/terminal/attention-scan.ts` runs in the daemon's
`TerminalService` output handler, beside the existing `scanWindowTitle`, and publishes a new
`terminal.attention` notification. Command finished and process exited are emitted by the daemon
from the events it already owns (`observeCommand`, `handleExit`).

**Rationale**:
- The daemon is the only process that sees every byte of every terminal, mounted or not
  (`packages/daemon/src/terminal-service.ts:747-753`). The renderer only sees output for mounted
  panels, and its OSC handlers die with the panel (`use-terminal.ts:1331`). FR-012, FR-066 and FR-067a
  all need signals from panels no window shows.
- #481 will stop forwarding output to panels nobody watches. `terminal.attention` is its own
  notification, so it is unaffected (FR-067a).
- 053 already put an OSC scanner (`core/src/terminal/window-title.ts:31`) in this exact position,
  carrying split sequences across chunks with a bound. The new scanner copies that shape.

**Alternatives rejected**: xterm.js `onBell` and `registerOscHandler` in the renderer (blind to
unmounted panels); `@xterm/headless` in the daemon (a full terminal emulator per session, for
signals a byte scanner finds).

## R2 — The scanner's grammar

**Decision**: one pass over each chunk, carrying an unterminated OSC across chunks up to 4 KB.

| Input | Signal | Kind |
|---|---|---|
| `BEL` (0x07) **outside** an OSC string | Bell | Attention |
| `OSC 9 ; <text>`, where `<text>` does **not** match `^\d+(;|$)` | Notification, message `<text>` | Attention |
| `OSC 9 ; <n> ; …` (ConEmu subcommand), including `9;9` cwd | nothing (FR-060a) | — |
| `OSC 9 ; 4 ; <st> [; <pr>]` | Progress ended when `st` = 0 after a non-zero state (completed) or `st` = 2 (error) | Attention / Failed |
| `OSC 777 ; notify ; <title> ; <body>` | Notification, message `<title>: <body>` | Attention |
| `OSC 99 ; <meta> ; <payload>` (kitty) | Notification when the chunk is final (`d=1` or no `d`); `p=title` or `p=body` text | Attention |

OSC strings end on `BEL` or `ESC \`. A `BEL` that terminates an OSC is not a bell. Progress state is
kept per session (`lastProgressState`), so a 9;4 "set → remove" sequence is "completed" and a bare
"remove" with no preceding set is nothing (spec edge case "Progress that only updates").

**Rationale**: Every form above is what the spec's Signals table names. The `^\d+(;|$)` rule is
FR-060a: ConEmu's subcommands are numeric, and throng's own shell integration emits `9;9` at every
prompt (`core/src/terminal/command-recipe.ts:104`). An iTerm2 notification whose text begins with a
number followed by a semicolon is misread as a subcommand and dropped. That is the safe direction:
a lost notification beats a mark on every prompt.

**Message sanitising (FR-068)**: control characters stripped, whitespace collapsed to one line,
truncated at 200 characters with an ellipsis. An empty result leaves the reason as "notification".

## R3 — Bell storms and rate limiting (SC-004)

**Decision**: The daemon emits at most one `terminal.attention` per panel per signal per 250 ms,
and coalesces within the window (last message wins). The scanner's fast path is `indexOf(0x07)` and
`indexOf(ESC ']')`; a chunk with neither costs two scans.

**Rationale**: 1,000 bells a second must cost the output path nothing measurable. One mark per panel
is already guaranteed by the mark model (FR-002, FR-035); the rate limit keeps IPC traffic flat. The
measurement SC-004 and Principle XII require is a unit benchmark on the scanner and a daemon
integration measurement of output throughput with and without attention on.

## R4 — Heuristic signals are computed in the daemon, gated by a pushed config

**Decision**: The daemon tracks `lastOutputAt` per session. With **Unseen output** on, it emits
`activity` on the first chunk after at least 1 s without output. With **Output went quiet** on, it
emits `quiet` once output has stopped for the quiet interval after an `activity`. Main decides
whether the panel is attended.

The daemon reads settings once at start (`packages/daemon/src/composition-root.ts:134`), so main
pushes the producer settings with a new RPC, `terminal.attentionConfig`, on connect and whenever
they change. With the master switch off, the daemon skips the scanner entirely (no cost, FR-063).

**Alternatives rejected**: Computing activity in main from `terminal.output` frames. It works today,
but #481 is about to stop that stream reaching main for unwatched panels.

## R5 — Main owns marks; renderers report focus

**Decision**: A pure state machine, `packages/core/src/attention/attention-model.ts` (raise, clear,
withdraw, kind merge, holder aggregation, clear-delay arming), is driven in main by an
`AttentionService` (`packages/ui/src/main/attention-service.ts`). Main broadcasts the mark set to
every window on `throng:attention:changed`. Each renderer keeps a module store
(`renderer/attention/attention-store.ts`, the `command-store.ts` pattern) and derives its holders
from it.

Each window reports to main on `throng:attention:focus`: its window id, whether it has focus, its
focused panel (keyboard focus in the workspace pane, else null), each shown tab's active panel, and
the panels it currently hosts, each with its project id and live title.

**Names.** Notifications and tooltips name the panel and project (FR-015, FR-033). Main knows neither.
The daemon does: it holds every layout and project (`daemon/src/panel-name-service.ts` is "the ONE
component that can see every panel name"). So each `terminal.attention` carries `panelTitle`
(through core's `panelDisplayTitle`) and `projectName`. A hosting window's report replaces them with
the live title, and moves the mark's `projectId` when a panel or tab moved between projects.
Panel destroy and project delete reach main through the existing `panel destroy` broadcast and the
project service, and clear the mark without notifying (FR-007).

**Rationale**:
- Marks must be the same in every window, and the taskbar badge and OS notifications are main's.
- The mark model is per-window in the renderer's unsaved-dot precedent (`editor-state.ts:78-95`).
  That works for editors because each window holds its own documents. It cannot work for a
  terminal marked while no renderer hosts it.
- Main does not know the focused panel today (`preload.cts:248-249`). It must, to apply FR-004 at
  the moment of a raise.
- Project rows cannot derive marks from the layout, which holds only the active project
  (`projects-panel.tsx:667-675`). Every mark therefore carries its `projectId`, which the daemon
  session already knows (it serves `killForProject`).

## R6 — Clear-delay semantics (FR-006 as clarified 2026-10-18)

**Decision**: the model keeps an `armed` flag per mark. When a panel **becomes** active (its tab is
shown and it is the tab's active panel, by a tab switch, project switch or panel move), every mark it
already had is armed and a timer starts while its window is focused. A raise on a panel that is
already active and unfocused creates an unarmed mark, which only a focus (FR-005) or a later
"becomes active" clears. Window focus regained neither arms nor disarms. Losing active status
restarts the timer.

The clock is injected, so the whole rule is unit-tested in core.

## R7 — User-caused ends (FR-064) are already told apart

**Decision**: Raise Process exited only from `handleExit` when `unexpected === true`
(`terminal-service.ts:973`). `unexpected = !session.userKilled`, and every throng-initiated end
(panel close, tab close, project delete, Unload with End Terminals, app-close Terminate all, daemon
shutdown) goes through `beginEnd`, which sets `userKilled`. `terminate()` publishes no exit at all.
A shell exiting on its own, including a typed `exit`, is `unexpected` and is raised, which FR-064
intends: the user typed it in that panel, so FR-004 suppresses it when it was attended.

## R8 — Startup commands (FR-065a, FR-038a)

**Decision**: The daemon session gets a `startupPending` flag, set when the launch carries a startup
command (`writeOnReady`, or a flavour `commandRecipe`, `core/src/terminal/launch-spec.ts:148-211`).
In `observeCommand`, the first command→nothing transition while `startupPending` is emitted with
`startup: true`, then the flag clears. The flag also clears on the first `terminal.write` (user
input), so a startup command too quick for the 1 s poll does not tag a later command. Main uses
`startup` only to skip notifications (FR-038a); the mark is raised as usual.

## R9 — Persistence across a closed window (FR-066, FR-091)

**Decision**: The daemon keeps an **attention ledger**: a bounded map (at most 1,000 entries) from
panel id to the mark main currently holds, plus any signal that arrived while no events socket was
connected. Main keeps it current with `terminal.attentionSync` (the full set, debounced 250 ms) and
reads it on connect with `terminal.attentionLedger`. Restored marks raise no notifications (FR-038).
A panel's entry is dropped when its terminal is killed by throng or its project deleted.

**Rationale**: When the last window closes, main quits (`main.ts:2369-2374`). Only the daemon
survives. It already drops a session on exit (`terminal-service.ts:983`), so the ledger is separate
from sessions. Command finished is not observed while no window is open (025 FR-019f, unchanged for
that case); the poll is already suspended on `sinkCount === 0`.

**FR-062 needs no code change.** The poll suspends only when **no** events socket is attached
(`terminal-service.ts:357-358`), and main holds one socket for the whole app (`main.ts:1901-1904`).
So an unloaded project's terminals are observed whenever a window is open, which is exactly what
FR-062 requires. The supersession is recorded in the spec; the code already behaves this way.

## R10 — Settings layout and bounds

**Decision**:
- Mechanism settings live in a new top-level slice, `attention.*` (FR-001: the mechanism reads no
  producer's settings): `attention.clearDelayMs`, `attention.delivery.attention`,
  `attention.delivery.failed`, `attention.osNotifications`, `attention.taskbarBadge`.
- Producer settings live under `terminals.attention.*`: `enabled`, `signals.processExited`,
  `signals.commandFinished`, `signals.bell`, `signals.notification`, `signals.progressEnded`,
  `signals.unseenOutput`, `signals.outputQuiet`, `quietSeconds`.
- Descriptors: the mechanism group is `'Attention'`; the producer's are `group: 'Terminal'`,
  `subgroup: 'Attention'`. Per-signal toggles use `enabledWhen: { key: 'terminals.attention.enabled',
  is: true }`.
- `notifications.*` is **not** used. That slice belongs to `core/src/notice/display-mode.ts`, and
  `settings-metadata.test.ts:215-219` pins it at eight descriptors.
- **Bounds**: clear delay 0–10,000 ms, step 100, default 1,000. Went quiet: the slider rules
  (`slider-descriptors.test.ts`: step ≥ 1% of the range and dividing it) cannot be met by 2–600 s with
  default 10. **The range becomes 10–600 s, step 10, default 10** (59 stops; a step of 5 is under 1% of a 5–600 range). FR-061 is amended to
  say so. A two-second floor bought nothing: under ten seconds, "quiet" is a pause between lines.
- Hot reload: main reads `currentSettings` at use time and registers `onSettingsChanged` to push
  `terminal.attentionConfig` (`main.ts:869-899`). Renderers read via `useAppSettings()`.

## R11 — Theme tokens and icons

**Decision**: two colour tokens, `attentionMark` and `attentionFailedMark` (general colours, each with
hand-written copy, a value in all 14 bundled themes from `makeTheme`), and three icon tokens:
`attention`, `attentionFailed` and `goToPanel` (the toast's link control). SVG shapes are added to
`SVG_SHAPES` in `main/icon-pack-service.ts`. `SHIPPED_DEFAULTS_VERSION` goes from 23 to 24 so existing
theme files gain the tokens. The token-count pins move to 80 colours and 85 icons.

These are distinct from 047 FR-083's attention flash colour, which 048 reuses for split mode: a flash
is a moment, a mark is a state (spec, 2026-10-18 revision).

## R12 — In-app toasts

**Decision**: Toasts are raised in a renderer, the only place notices can be
(`renderer/common/notification.tsx`). Main picks one window per mark: the focused throng window, or
the main window when none is focused. It sends `throng:attention:toast` (`raise` / `update` /
`dismiss`). The renderer's `AttentionToasts` component calls `notify` with
`instanceKey: 'attention:<panelId>'` (so 041's identical-content rule never folds two panels
together) and `update` / `dismiss` by id, which is `PasteProgressNotice`'s pattern.

- Severity `info` for Attention and `error` for Failed (FR-037); display modes apply unchanged.
- The link is a new control, an `IconButton` with token `goToPanel` and a hover title, in `body`.
  This follows paste's Cancel precedent. 030 FR-032b puts it in the tab order. It is not a clickable
  affected-list row, which `notification.tsx:1258-1260` rules out. Dismiss stays (030 FR-060).
- `subject` is the panel's title through `formatSubject` (030 FR-058).

## R13 — OS notifications and the taskbar badge

**Decision**: Two new core abstractions, each with a no-op, a contract test and an Electron
implementation in `packages/ui/src/main` (the `electron-clipboard.ts` pattern):

- `ISystemNotifier`: `show({ id, title, body, kind }) → handle`, `close(id)`, and a click callback.
  Electron `Notification`. Click → `AttentionService.goTo(panelId)`, which raises the window
  (restore, show, focus, the `main.ts:666-682` sequence, factored into one helper) and navigates.
- `ITaskbarBadge`: `set(count, kind)` / `clear()`. `BrowserWindow.setOverlayIcon` on every window
  with a taskbar button, with a description from FR-039.
- `app.setAppUserModelId('com.throng.throng')` is set at startup. Windows drops toasts from an
  unregistered process, and the NSIS shortcut only covers installed builds.
- **The badge image is drawn in the main window's renderer**: a 16×16 canvas with the theme's mark
  colour and the count ("9+" above 9), returned as a PNG data URL on `throng:attention:badgeImage`.
  Main has no canvas, and the colour must come from the theme (FR-016). With the main window closed,
  a sub-workspace window draws it.
- Under the E2E harness both are fakes that record calls, the `THRONG_E2E_*` pattern of
  `IForegroundHandoff` (`main/composition-root.ts:110-130`).

## R14 — Navigation (FR-034, FR-080, FR-080a)

**Decision**: `AttentionService.goTo(panelId)` uses the hosted-panel sets windows report (R5). A
sub-workspace window hosting the panel is raised and told `throng:attention:focusPanel`. Otherwise
the main window is raised and told to switch to the mark's project, then focus the panel. The
renderer handler is `switchProject` → wait for layout → `focusLocalPanel` (`preview/open-preview.ts:
162-181`), with the pending-switch mark so the workspace pane takes focus (`active-pane.ts:58-80`).
This works for a project hidden in a minimised category (FR-080a): `switchProject` does not consult
reachability. Only the cycle commands do.

**Go to Next Marked Panel** runs in the main window's renderer. Order is project-list order, then
tab order, then panel order (`collectPanels`), from the current position. Within the active project
the order comes from its layout. In another project the command switches to that project and takes
its first marked panel in layout order once loaded. A sub-workspace's panels count as after their
project's main-layout panels.

## R15 — Command, binding and menu

**Decision**: command id `focus.nextMarkedPanel`. The `focus.` prefix gets `isPanelScoped`'s
exemption (`renderer/keybindings/scope.ts:200-246`). It is window-handled, so it fires from a focused
terminal. Default chord **Ctrl+Shift+Alt+G** ("go"): tier 1, free, and not a reserved or shadowable
terminal key. It owes the AltGr+Shift fourth-level layout audit 046 R22 did for B, F, M, N, P and T,
and the `docs/key-bindings.md` disclosure.

Menu (FR-082): a cog-menu row, "Go to Next Marked Panel", with icon token `attention` and its chord,
disabled while nothing is marked. That supersedes the cog menu's pinned shape in
`menu-sections.test.ts:1615-1628` (five items → six). The test is amended, not deleted.

**The fourth-level audit for Ctrl+Shift+Alt+G (T060, 2026-10-18).** Same method as 046 R22 / T148:
the published Windows layout tables, read rather than typed. This one was taken from knowledge of
those tables, not a fresh reading, and nothing ran on a real keyboard, so it carries 046's "owed:
check on a keyboard" standing.
- G is physical `KeyG`. It stays at the US position on AZERTY and QWERTZ (only A/Q, Z/W, M and Y/Z
  move), so it needs no per-layout disclosure beyond 046's.
- AltGr+Shift types nothing on that key on any audited layout: US (no AltGr layer), UK, German,
  French (AZERTY), Spanish, Italian, Nordic and Polish (programmer's; its AltGr letters are
  A C E L N O S X Z). Also nothing on US-International and Romanian (Programmers), the two layouts
  046 recorded as losing characters elsewhere. So `docs/key-bindings.md` gains only the letter, in its
  list of letters that carry none.
- G is not reserved or shadowable. Ctrl+G is `navigate.gotoLine` and the preview's "Go to Heading", a
  different token, and this chord needs Alt+Shift. xterm sends nothing on keydown for a letter under
  Ctrl+Alt (third-level shift, keyCode > 47), and the window listener takes a bound chord first.

## R16 — Test layers

| Concern | Layer |
|---|---|
| Scanner grammar, FR-060a, sanitising, chunk splits, progress state | core unit |
| Mark model: raise, merge, attended, clear, clear-delay arming, withdraw, holders, badge count, next-marked order | core unit, injected clock |
| Daemon emission: signals, rate limit, startup tag, ledger, config push, exit `unexpected` | daemon integration (real `TerminalService`, fake PTY host) |
| SC-004 cost | core unit benchmark + daemon integration throughput measurement |
| Settings: parse, clone, descriptors, docs | core unit + existing guards + `settings-inertness-057.test.ts` |
| Notifier / badge adapters | contract tests (`packages/ui/tests/contract`) |
| Holders, toasts, tooltip text, settings section | component (jsdom) |
| AttentionService wiring (focus reports, routing, notifications) | ui unit with fakes |
| A real window: bell in a background project marks its row; toast link lands on the panel | **one** E2E spec, `@extended @terminal`, in the serial tier (real shell) |

E2E is limited to what only a real window shows: the daemon-to-main-to-renderer path end to end.
Everything else sits lower. `e2e-budget.json` is re-seeded in the same commit.

## R17 — Documentation

`docs/preferences.md` (one row per new key, in a new `## Attention` section and the Terminal table),
`docs/key-bindings.md` (the command row and the AltGr disclosure), `docs/architecture.md` (the
`terminal.attention` notification and main's attention service), `docs/quick-start.md` (a tour line),
`README.md` (one feature line), and a short section on making Claude Code ring the bell or notify,
pointing at Claude Code's own documentation rather than copying it.

## R18 — Round 12: the toast body is the link (FR-124)

The card's `onClick` calls `attention.goTo(panelId)`; Copy and Dismiss stop propagation. The `goToPanel` control and its `controls` slot use (T114) go; the `goToPanel` icon token stays registered only if something else uses it, otherwise it is retired with its theme row. A Windows notification click already routes through `ISystemNotifier.onClick` → `goTo` (FR-034); MT-01 checks it lands on the panel, and a miss is a defect against FR-034.

## R19 — Round 12: where a manual flag lives (FR-125, FR-128)

Decision: a SQLite table, `attention_flag`, owned by the daemon, written through `attention.flagSet` / `attention.flagClear` and read with `attention.flagList` on every (re)connect. Rejected: the ledger (in memory, so a reboot loses an editor's flag; and `restore()` stamps every entry `producer: 'terminal'`, so a flag would come back as a terminal mark the master switch then withdraws); the saved layout (a panel field would need every project's layout read at start-up to draw holders for unloaded projects). Terminal marks stay out of SQLite for the reason the Complexity table gives.

## R20 — Round 12: the held clear delay (FR-127)

A manual flag is raised with `heldSinceRaise: true`. `settle()` starts no dwell for a held mark; the first settle that finds its panel unattended clears the hold, after which FR-095's dwell applies unchanged. A restored flag comes back unheld: the focus it was raised under is gone. Flag on a panel already marked changes nothing (FR-125), so the hold is never added to a terminal mark.

## R21 — Round 12: announce on creation only (FR-134)

`onSignal` reads whether the panel was marked **before** `model.raise`; a raise that only updated an existing mark refreshes its toast (FR-112) and announces nothing. This replaces the `announced` set, whose absence of restored and startup marks was the leading hypothesis for #524. A unit test in `attention-service.test.ts` restores a mark from the ledger, raises on it, and expects no toast and no `notifier.show` — red today.

## R22 — Round 12: numbers and pills without reflow (FR-129 – FR-133)

`holderState` returns `count` (marked panels beneath). The numbered flag is drawn in the same reserved slot FR-114 gives the project-row glyph (16 × 16 over the dot's box), with the digits inside; `9+` above nine. Tab chips and category headers reserve the flag's and the pill's width whether or not they show (`visibility: hidden`), so a mark appearing moves nothing. The minimised header's paler surface is a `color-mix` of the header surface toward the sidebar background, so every theme gets it with no new token; `theme-quality` keeps the header text's contrast. The category pill shows the total project count in every state, replacing FR-051a's "shown of total".

*(round 12)* A terminal signal on a manually flagged panel updates its reason and kind (FR-002) but keeps `producer: 'user'`, so the flag stays persisted and the terminal master switch does not withdraw it *[derived]*.
