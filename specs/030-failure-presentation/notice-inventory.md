# Notice inventory

**Feature**: `specs/030-failure-presentation` · **Requirements**: FR-017 (second half), FR-056 ·
**Evidence for**: SC-002, SC-012

This file is written in two halves and is one document.

| Half | Task | What it records |
|---|---|---|
| **A — surfaces outside the notice model** | **T027a** (US1) | Every user-facing report of an event that does **not** go through `notify()`, and its disposition |
| **B — the notice and banner strings** | **T073** (US6) | Every user-facing notice and banner string, whether it names its subject, and why not where it does not |

Half A is below. Half B is appended by T073 once US2–US5 have finished rewriting the notices, so
that it describes the notices as they finally are rather than as they were.

Generated once, as evidence that the sweep happened. It is **not** a maintained register: a surface
added after this feature will not appear here, and nothing in the build enforces that it does.

All paths are relative to the repository root. Line numbers are as of the commit this file was
added on.

---

## What "the notice model" means here

One entry point: `notify(input: NoticeInput)` from
`packages/ui/src/renderer/common/notification.tsx`. Everything raised through it is queued, rendered
by `NotificationProvider`, and — once T025 lands — has its display governed by the per-severity
notification preferences and its raise recorded in the diagnostic log.

Three renderer realms mount `NotificationProvider`, and the notice model exists in all three:

- main window — `packages/ui/src/renderer/composition-root.tsx:109`
- sub-workspace window — `packages/ui/src/renderer/composition-root.tsx:155`
- preferences window — `packages/ui/src/renderer/preferences/preferences-app.tsx:342`

A fourth window — **About** — does not (see **S-31**).

`notify()` has twelve literal call sites. Those are T033's subject sweep, and are **not** this
audit's subject; they are listed once here only so the complement is unambiguous.

| # | Call site | Raises |
|---|---|---|
| 1 | `config/config-write-notices.ts:40` | a preferences document that would not save |
| 2 | `common/notification.tsx:466` (inside `useErrorNotice`) | every explorer / project / sub-workspace failure |
| 3 | `panel-type/panel-type-form.tsx:115` | a terminal that ended |
| 4 | `statusbar/daemon-indicator.tsx:51` | the daemon stopped |
| 5 | `statusbar/daemon-indicator.tsx:66` | a daemon restart that failed |
| 6 | `preferences/themes-tab.tsx:177` | a theme operation that failed |
| 7 | `preferences/reset-notice.tsx:45` | a reset that would not write |
| 8 | `workspace/panel-placeholder.tsx:226` | a panel name that was adjusted |
| 9 | `terminal/terminal-panel.tsx:509` | a startup command that could not be remembered |
| 10 | `editor/drop-target.tsx:61` | a refused drop |
| 11 | `editor/drop-target.tsx:163` | a refused drop |
| 12 | `editor/editor-notice-dialog.tsx:28` | every editor notice |

## Dispositions used below

- **IN** — already inside the notice model (usually via an adapter that keeps its old identifiers).
- **RESHAPED** — outside the preferences by design, and changed by this feature anyway (US4's shared
  banner).
- **EXCLUDED** — deliberately outside, with the reason stated. Where a requirement already decides
  it, the requirement is cited; where it does not, the reason is mine and is open to argument.
- **GAP** — a user-visible consequence with no user-visible report, or a report the user cannot
  reach. Out of this feature's scope; each needs its own issue.
- **AMBIGUOUS** — genuinely does not fit one bucket. Recorded as such rather than forced.

---

## 1. Adapters — surfaces that look separate and are not

Recorded so nobody re-audits them. Feature 018 (FR-051) folded six idioms into `notify()`; the
components survive as adapters over stores, preserving their test ids.

| ID | Surface | Adapter → `notify()` | Fed by |
|---|---|---|---|
| S-01 | Editor notice message box | `editor/editor-notice-dialog.tsx:22–56` | `editor/editor-notice-store.ts:32` ← `editor/editor-missing-notice.ts:82`, `editor/use-editor.ts:1046`, `editor/use-editor.ts:1244`, `editor/missing-file-watcher.tsx:39` |
| S-02 | Terminal exit strip | `panel-type/panel-type-form.tsx:113–122` | `terminal/exit-store.ts:40` ← `terminal/terminal-panel.tsx:479` |
| S-03 | Preferences reset strip | `preferences/reset-notice.tsx:38–57` | every reset path in the preferences window, incl. `preferences/settings-tab.tsx:150–157` |
| S-04 | Preferences write-failure strip | `config/config-write-notices.ts:34–49` | `config/write-config.ts:73` (`onConfigWriteFailed`) |
| S-05 | Explorer / projects / sub-workspaces error strips | `common/notification.tsx:413–…` (`useErrorNotice`) | `app.tsx:422`, `explorer/file-tree.tsx:132`, `sidebar/projects-panel.tsx:133`, `sidebar/subworkspaces-panel.tsx:52` |
| S-06 | Themes surface error strip | `preferences/themes-tab.tsx:176–177` | every theme restore / clone / rename path |

**Disposition: IN.** No further work here beyond T033/T033a's subjects.

Two things worth noting inside S-05, because they answer questions this audit would otherwise leave
open:

- **The explorer watcher's death is reported.** `explorer/use-explorer-data.ts:518–526` raises
  `Live updates have stopped for this project. Reopen it to resume watching for changes.` through
  `useErrorNotice`, fed by `files.onWatchFailed`. The **config** watcher has no equivalent — see
  **G-03**.
- **The workspace restore failure is reported.** `app.tsx:417–426` raises
  `A fresh workspace was opened instead.`; the comment there records that this used to be the only
  non-dismissible inline notice in the app.

---

## 2. Panel banners — outside the preferences by design

### S-07 · Editor "This file could not be read" banner

- **Where**: `packages/ui/src/renderer/editor/unloadable-banner.tsx:26–69`; strings at `:51`
  (`This file could not be read`), `:52` (the path), `:55` (`Still unreadable. Put the file (or its
  folder) back, and this editor will reload by itself.`), `:56` (`What is shown here is not the
  file. Restore the path and it reloads by itself, or reload it now.`).
- **Reports**: the editor's path cannot be read, while the panel may be showing a recovered buffer
  over it (027 / #161 FR-011).
- **Can the user miss it?** No while the condition holds — it is not dismissible and unmounts only
  when the condition clears. It *is* invisible while the panel is not on screen.
- **Disposition: RESHAPED.** Replaced by the shared `PanelFailureBanner`
  (`contracts/panel-failure-banner.md`, FR-039). Deliberately **not** governed by the notification
  preferences — FR-005a and FR-041 say so explicitly, and SC-004a depends on it: with every severity
  silenced the user must still see that a panel failed and be able to copy from it.

### S-08 · Terminal start-failure strip

- **Where**: `packages/ui/src/renderer/terminal/terminal-panel.tsx:710–746`
  (`terminal-start-failed-{panelId}`); message from `causeMessage(cause)` at `:601`.
- **Reports**: a terminal that could not start from a transient cause, with Retry and Clear panel
  type.
- **Second surface for the same failure**: `terminal/terminal-panel.tsx:290–310` grows
  **Try again** / **Clear panel type** into the terminal's own context menu, but *only while*
  `startFailureRef.current` is set. FR-042c extends that pattern to the editor and adds Copy, so
  this is the precedent US4 builds on rather than a stray surface.
- **Can the user miss it?** Same as S-07 — persistent, but only in a visible panel.
- **Disposition: RESHAPED**, same reasoning and the same requirements.

### S-09 · Terminal "still starting…" strip

- **Where**: `packages/ui/src/renderer/terminal/terminal-panel.tsx:768–789`; string
  `Terminal is still starting…`.
- **Reports**: progress, not failure.
- **Disposition: EXCLUDED** — FR-039a names it: it offers no cause and no Cancel, and folding it
  into a failure component would make progress look like failure.

### S-10 · Terminal remembered-cwd fallback strip

- **Where**: `packages/ui/src/renderer/terminal/terminal-panel.tsx:747–767`; string
  `Started in the project root — "{folder}" no longer exists.`
- **Reports**: a substitution that succeeded, not a failure. Dismissible.
- **Disposition: EXCLUDED** — FR-039a, same clause.

---

## 3. Status bar, window chrome, and surfaces outside React

### S-11 · Daemon indicator, non-stopped states

- **Where**: `packages/ui/src/renderer/statusbar/daemon-indicator.tsx:24–28` (`LABEL`) and `:79–99`
  (the button). Labels: `Daemon reconnecting…`, `Daemon stopped — click to restart`,
  `Restarting daemon…`. It is the only degraded item in the status bar
  (`statusbar/status-bar.tsx:24–42`).
- **Reports**: the daemon's health, continuously, and is the only route to a restart.
- **Can the user miss it?** Yes — it is a small glyph with the state carried in a hover title and
  `data-status`. There is no text label at rest.
- **Disposition: EXCLUDED.** `stopped` already raises a notice (`:51`); `reconnecting` is
  deliberately silent, argued at `:42–47` — a blip nobody noticed is not news, and announcing every
  daemon restart during development is how a notice gets ignored. `restarting` follows the user's own
  click. The indicator is a **standing state and a control**, which is why it is not a notice: the
  file's own header (`:9–18`) argues that the notice reports and the status bar acts.
- See **A-04** for the ambiguity this creates.

### S-12 · The drag-ghost refusal hint

- **Where**: `packages/ui/src/renderer/workspace/tab-group.tsx:383–386` —
  `window.throng?.dragGhost?.hint?.('Can't move a sub-workspace panel out of its window', outside)`.
- **Reports**: a refused drag, as text painted onto the **OS drag image**. Outside React, outside the
  notice model, outside the DOM.
- **Can the user miss it?** It appears under the cursor at the moment of the gesture and vanishes
  with it, which is the best possible timing — but it exists only during the drag, so a user who
  releases quickly may never register it.
- **Disposition: EXCLUDED.** It is a live affordance during a gesture, in the same family as
  `dropEffect = 'none'` (S-13). A toast raised on drag-over would fire repeatedly and could be
  silenced by a preference, which would leave the gesture inexplicable.

### S-13 · Refusals expressed only as a cursor

- **Where**: `packages/ui/src/renderer/editor/tree-drop-target.tsx:69–71` — a refused tree drag sets
  `dropEffect = 'none'` and nothing else.
- **Disposition: EXCLUDED**, same reasoning as S-12.

### S-14 · Window titles, tray, native OS notifications, taskbar badge/progress

- **Confirmed absent, repo-wide**: `dialog.showMessageBox`, `dialog.showMessageBoxSync`,
  `dialog.showErrorBox`, Electron `Notification`, `Tray`, `displayBalloon`, `setOverlayIcon`,
  `setProgressBar`, `flashFrame`, `setBadgeCount`, `crashReporter`. Zero hits in source.
- Window titles are set only to identity strings (`packages/ui/src/main/main.ts:301`, `:384`;
  `main/about-window.ts:67`; `main/preferences-window.ts:114`) and to a workspace summary via
  `throng:setTitle` (`main.ts:905–909`). None conveys a failure.
- The only native dialogs are two **choosers**, which report nothing:
  `dialog.showOpenDialog` (`main.ts:875`, folder picker) and `dialog.showSaveDialog`
  (`main.ts:898`, editor save-as).
- **Disposition: EXCLUDED** — nothing to bring in. Recorded because a confirmed absence is what makes
  SC-002 checkable at all: there is no second, OS-level reporting channel to reason about.

---

## 4. Dialogs

### S-15 · The confirmation model

- **Where**: `packages/ui/src/renderer/confirm-dialog.tsx` (`ConfirmProvider`, `useConfirm`,
  `useChoose`); consumers include `editor/dirty-close-dialog.tsx:31`,
  `editor/unsaved-open-dialog.tsx:26`, `workspace/panel-placeholder.tsx:310–366`,
  `workspace/tab-group.tsx:604`, `sidebar/subworkspaces-panel.tsx:80`, `:90`,
  `app-close-prompt.tsx:68–110`.
- **Reports**: nothing. It **asks**, and the buttons state the consequence.
- **Disposition: EXCLUDED** — 018 FR-048a settled this: a confirmation is a second model with a
  different job. It has no severity because it has no display mode to govern; the user cannot miss it
  because it is modal and blocking.

### S-16 · The confirmation's `warningMessage`

- **Where**: `confirm-dialog.tsx:69` (the prop), `:190–194` (rendered, `role="alert"`). Used at
  `workspace/panel-placeholder.tsx:313` and `workspace/tab-group.tsx:604`
  ("This is the last panel/tab in "X" — destroying it destroys the sub-workspace…").
- **Reports**: a consequence of the choice being offered, not an event that has happened.
- **Disposition: EXCLUDED** — it is part of the question. Nothing has failed at the moment it renders.

### S-17 · A confirmation used to report a failure

- **Where**: `packages/ui/src/renderer/sidebar/projects-panel.tsx:324–329`.
  `title: 'Cannot create project'`, message
  `A sub-workspace editor is editing a file inside this folder ({files}). Save and close it first.`,
  with **both** `confirmLabel` and `cancelLabel` set to `'OK'`.
- **Reports**: a refused operation. Nothing is being asked — the two buttons are the same word.
- **Can the user miss it?** No. It is modal.
- **Disposition: AMBIGUOUS**, see **A-06**. It is a modal error box wearing the confirmation model,
  and it is the clearest counter-example to "every failure report goes through `notify()`".

### S-18 · The keybinding-capture conflict block

- **Where**: `packages/ui/src/renderer/preferences/capture-modal.tsx:123–146`
  (`capture-conflict`): `{token} is already bound to {action}.` with **Reassign** / **Cancel**.
- **Reports** a state of the world **and then asks** what to do about it.
- **Disposition: EXCLUDED** — the report exists only to frame the question that follows it, and the
  question cannot be silenced. Recorded because it is a genuine hybrid.

### S-19 · App-close busy overlay

- **Where**: `packages/ui/src/renderer/app-close-prompt.tsx:121–132`
  (`app-closing`, `role="status"`, `aria-live="polite"`); messages `Preparing to close…` (`:11`),
  `Leaving your terminals running in the background…` (`:12`), `Closing your terminals…` (`:13`),
  plus `Closing throng…` pushed from `packages/ui/src/main/main.ts:1286`.
- **Reports**: progress during shutdown. Blocking, non-dismissible, and there is **no error path**:
  if the quit hangs, this is a permanent modal with no escape. The docblock at `:34–37` acknowledges
  it is deliberately unmigrated.
- **Disposition: EXCLUDED** — progress, and the window is about to go. See **A-02** for the part of
  this flow that is not progress.

---

## 5. Inline validation — refusals of input

All of these are **refusals of input**, not reports of events: a value the user just typed was not
accepted, the last valid value remains in effect, and the message sits next to the control that
produced it. None can be missed by looking away, because none is transient.

| ID | Where | String |
|---|---|---|
| S-20 | `preferences/form-controls.tsx:392–397` (+ `ctl__input--invalid`/`aria-invalid` at `:371–373`) | `Enter a number ≥ {min} ≤ {max}.` |
| S-21 | `preferences/form-controls.tsx:587–591` | `Must be a valid JSON array.` |
| S-22 | `preferences/json-tab.tsx:143–147` | `Invalid JSON — not applied. The last valid document is still in effect.` |
| S-23 | `preferences/map-control.tsx:242–246`, `:480–484` | `Choose a language.` / `A key is required.` / `"{shown}" is already mapped.` and the add/commit errors from `:343`, `:348` |
| S-24 | `preferences/capture-modal.tsx:59`, `:63`, rendered `:118–122` | `That key can't be bound on its own (Esc, Space, Enter, Tab, etc.)…` / `{token} is reserved by the system and can't be bound.` |
| S-25 | `preferences/name-dialog.tsx:36–48`, rendered `:106–110` | `Enter a name.` / `That name is reserved for a built-in theme.` / `A theme with that name already exists.` / `Invalid name.` |
| S-26 | `common/colour-picker.tsx:322–345` | **no string at all** — a red border and `aria-invalid`, argued at `:347–357`: "NO MESSAGE. The RED BORDER IS THE MESSAGE." |
| S-27 | `sidebar/projects-panel.tsx:167–168`, `:386`, `:393` | **no string** — a `--error` class derived by regex-matching the store's error text (`/folder/i`, `/name/i`), paired with the notice raised at `:133` |

**Disposition: EXCLUDED** (S-20 – S-27). Validation belongs to the control. A validation message
routed through the toast stack would appear away from the field it is about and could be silenced by
a preference, which would make an unsaveable form look broken.

Two carry a caveat worth writing down, neither in this feature's scope:

- **S-26 and S-27 have no text in any modality.** S-26's reasoning (an inline sentence made the row
  below it jump while you were aiming at it) is good, and `aria-invalid` is set — but `aria-invalid`
  without an `aria-errormessage` tells a screen-reader user *that* the value is wrong and never
  *why*. S-27 is worse: the reason lives only in the toast, so once the toast is dismissed the field
  stays red with nothing on screen explaining it.
- **S-23's per-row variant reports a file, not a keystroke.**
  `preferences/map-control.tsx:439–448` renders `checkFlavourRecord(...).message` for a row that
  **arrived broken from the config file** — a report of an event, not a refusal of input. It is
  excluded anyway because only that row's cell can point at that row.

---

## 6. Inline reports of events that are not validation

### S-28 · Preferences JSON tab, external-change conflict

- **Where**: `packages/ui/src/renderer/preferences/json-tab.tsx:132–142` (`json-conflict`):
  `This file changed on disk while you were editing it.` with **Reload** / **Keep editing**.
- **Reports**: a real event — the file changed under a dirty buffer.
- **Can the user miss it?** No while it holds; it is dismissed only by choosing.
- **Disposition: EXCLUDED** — it is anchored to the buffer it is about and offers the two actions
  that resolve it. A toast could be silenced, leaving a stale buffer with no warning.

### S-29 · Icon pack that could not be loaded

- **Where**: `preferences/icon-section.tsx:105–110` (`icon-pack-error`, `role="alert"`) and `:86–98`
  (the disabled `<option>` carrying `title={p.error}` and a ` (unavailable)` suffix). The error is
  produced in main at `packages/ui/src/main/icon-pack-service.ts:256–263`.
- **Reports**: a real event — a pack on disk that cannot be read.
- **Can the user miss it?** The paragraph, no. The per-option `title`, **yes**: a tooltip inside a
  closed `<select>` is only seen by someone already hovering the right row.
- **Disposition: EXCLUDED**, see **A-05**. The paragraph renders only for the *selected* pack, so a
  user whose active pack is fine never learns another is broken until they try it. That is arguably
  correct — the owning feature's FR-004a says it must say so "right where it was chosen" — and is
  left alone.

### S-30 · "No shells detected on this machine"

- **Where**: `packages/ui/src/renderer/panel-type/terminal-inputs.tsx:42–45`
  (`terminal-no-flavours`), replacing the Flavour dropdown.
- **Reports**: shell detection returned nothing — an **empty state caused by a failure**, presented
  as an empty state.
- **Can the user miss it?** No, it is where the control would have been. But it says nothing about
  *why*, and offers no route to the detection settings.
- **Disposition: EXCLUDED** — it is a control's own empty state, and the panel-type form is exactly
  where a user would look. Recorded because "empty because detection failed" and "empty because
  there is nothing" render identically here.

### S-31 · Disabled controls that explain themselves

Recorded as the counter-examples to G-24, and because each states a condition the user might
otherwise read as a bug:

| Where | Title |
|---|---|
| `preferences/row-actions.tsx:115` | `{label} has not changed since this window was opened` |
| `preferences/row-actions.tsx:122` | `{label} is already at its default value` |
| `preferences/row-actions.tsx:129` | `{label} is already empty, or cannot be emptied` |
| `panes/file-explorer-pane.tsx:67–78` | `Project settings — no project is active` |
| `panel-type/terminal-inputs.tsx:103` | `This shell only reports its working directory when Shell integration is on — enable it in Settings › Terminal` |
| `panel-type/terminal-inputs.tsx:122` | `Relaunch throng as administrator to enable admin terminals` |
| `statusbar/daemon-indicator.tsx:88` | disabled while `restarting`, with the state in the title |
| `project-settings/project-settings-dialog.tsx:100–104` | `also matched by a global exclusion — removing it here will not bring it back` — an enabled control with an inline note saying it will not do what it looks like it does |

**Disposition: EXCLUDED** — a standing condition attached to the control it constrains.

---

## 7. Loading, empty and crash fallbacks

### S-32 · "Resolving project…" placeholders

- **Where**: `packages/ui/src/renderer/workspace/panel-body.tsx:79–89`
  (`terminal-loading-{panelId}`) and `:113–123` (`editor-loading-{panelId}`), both `role="status"`.
- **Reports**: progress. Deliberate — a terminal must not attach and an editor must not load until
  project ownership is known.
- **Disposition: EXCLUDED.**

### S-33 · "Empty Panel"

- **Where**: `packages/ui/src/renderer/workspace/panel-body.tsx:151`.
- **Reports**: a panel whose `kind` the registry does not recognise, rendered as a benign empty
  state with no explanation and no recovery control.
- **Disposition: GAP** (**G-25**) — this is the unknown-kind fallback, not an empty panel, and the
  two are indistinguishable on screen.

### S-34 · Skeletons that give up

- **Where**: `common/loading.tsx` (`PanelSkeleton`, `useDelayedFlag`), driven by
  `editor/editor-panel.tsx:40` and `terminal/terminal-panel.tsx:133`, both 4000 ms.
- **Reports**: nothing after the timer. A load that never resolves degrades into a blank panel with
  no message. For the terminal this is covered — `terminal-panel.tsx:607` drops the skeleton
  deliberately so the failure banner is not hidden under it — but for the **editor** there is no
  equivalent, so a never-resolving load is silent.
- **Disposition: GAP** (**G-26**) for the editor half; EXCLUDED for the terminal half.

### S-35 · File-tree error boundary

- **Where**: `packages/ui/src/renderer/explorer/error-boundary.tsx:18–26`; renders
  `File tree failed to render: {error.message}`. Logs to `console.error` at `:15` — the renderer
  console, which is attached to no file (see **G-05**). Keyed on project id at
  `panes/file-explorer-pane.tsx:85`, so only a project switch clears it.
- **Reports**: a React subtree that threw.
- **Can the user miss it?** No — it replaces the tree.
- **Disposition: EXCLUDED**, on 018's stated reasoning at `:20–22`: it is a crash **fallback**
  replacing a subtree that threw, not a report over one that still works. See **A-03**.
- **It is the only error boundary in the renderer** — see **G-21**.

### S-36 · About window cannot raise a notice at all

- **Where**: `packages/ui/src/renderer/main.tsx:84` mounts `<AboutApp />` directly — **no**
  `NotificationProvider`, `ConfirmProvider` or `ServicesProvider`. `about/about-app.tsx:65–72` loads
  its content with `void window.throng?.about?.get?.().then(…)` and `…getThirdParty?.().then(…)`,
  neither with a `.catch`, and `setThirdPartyLoading(false)` runs only inside the `.then`.
- **Reports**: nothing. A failed load leaves the version, author, build id and licence text as empty
  strings and the third-party list stuck permanently on `Loading third-party packages…`
  (`about-app.tsx:161–164`).
- **Can the user miss it?** They cannot see it at all — there is nothing to see except blanks and a
  spinner that never stops.
- **Disposition: GAP** (**G-17**). Not a notice that escapes governance; a window in which a notice
  is *structurally unraisable*.

### S-37 · Renderer and child-process crashes

- **Where**: `packages/ui/src/main/diagnostics.ts:106–114` (`render-process-gone`), `:116–124`
  (`child-process-gone`), `:126–139` (`uncaughtException`, rethrown), `:141–146`
  (`unhandledRejection`). Crash reports written by
  `packages/platform-windows/src/node-file-log.ts:199–208` to `<userData>/logs/crashes/`.
- **Can the user miss it?** Entirely. `diagnostics.ts:96–99` says so outright: with
  `window-all-closed → app.quit()` (`main.ts:1524–1530`), a dead renderer takes the app down
  "quietly and indistinguishably from the user closing it".
- **Disposition: GAP** (**G-18**). A crash cannot be reported by a renderer that no longer exists,
  so this is not a notice-model question — it is a question of whether throng should say anything on
  next launch.
- The one deliberate route to these files is the "open logs folder" action —
  `packages/ui/src/main/main.ts:842–847`.

---

## 8. Text throng writes into a terminal

The shell's own output is out of scope by FR-005a. These lines are **throng's**, in the shell's
stream, and are the only report of the failure they describe.

| ID | Where | String |
|---|---|---|
| S-38 | `packages/daemon/src/pty-agent-host.ts:166` (`failKey`) | `\r\n[throng] {reason}\r\n` where `reason` is `the terminal agent stopped unexpectedly` (`:129`), `the de-elevated terminal agent never started[: {launchReason}]` (`:94–98`, written at `:153` and `:278`), or `the terminal never started` (`:181`) |
| S-39 | `packages/daemon/src/pty-agent-host.ts:232` | `\r\n[throng] terminal failed to start: {message}\r\n` |
| S-40 | `packages/daemon/src/terminal-service.ts:535–540` | `\n[throng] Could not run the startup command: {message}\n` |

**Can the user miss them?** Yes, easily. They are lines of scrollback in a panel that may not be
visible, and they scroll away. S-38 and S-39 are accompanied by an exit, which does raise a notice
via S-02; **S-40 is accompanied by nothing** — the comment at `terminal-service.ts:532–534` says
plainly that a throwing `write` produces no terminal output at all, so this line is the only signal
the startup command never ran.

**Disposition: AMBIGUOUS**, leaning EXCLUDED. See **A-01** — FR-005a's exemption is worded for what
*a shell* prints, and these are not that.

There is **no** exit-code banner written into a terminal: no `[process exited with code N]`, no
"session ended", no elevation prompt. Exit is reported entirely out of band through S-02.

---

## 9. Raw error text that reaches the screen

Not a separate surface class — collected because a reader auditing FR-016/FR-034 ("the raw system
error is demoted to copy and the log, never rendered") will otherwise trip over these.

| Where | What renders |
|---|---|
| `explorer/error-boundary.tsx:23` | `error.message` from `getDerivedStateFromError`, directly in JSX |
| `preferences/icon-section.tsx:108` | `{selected.error}` — the icon-pack loader's raw string, directly in JSX |
| `preferences/themes-tab.tsx:435` | `Could not create "{newName}": {res.error}.` — a raw write error interpolated **into a notice** |
| `editor/drop-target.tsx:93` | `refuse(absPath, decision.error)` — main's raw error string forwarded **into a notice** |
| `terminal/terminal-panel.tsx:716` | `causeMessage(cause)` — classified, so *not* raw; noted so it is not mistaken for one |

The first two are outside the notice model and therefore outside FR-016's reach. The middle two are
**inside** it and are T034/T035's business, not this file's — recorded here only so the sweep is
complete.

---

## 10. Gaps — user-visible consequences with no user-visible report

Each of these needs its own issue. None is in this feature's scope, and none is proposed for change
here.

| ID | Where | Consequence to the user | Report today |
|---|---|---|---|
| G-01 | `main/main.ts:609`, `:618` | first-run seeding or a version upgrade of the shipped settings / keybindings / 14 built-in themes partially or wholly failed — the app starts looking wrong | `console.error` → `main.log` only |
| G-02 | `main/config-store.ts:186–193` + `preferences/themes-tab.tsx:400–407` | a theme the user deleted silently reappears — `deleteTheme` returns `Promise<void>` so the error cannot cross IPC, and the caller does not check | `console.error` → `main.log` only |
| G-03 | `main/config-watcher.ts` (`startConfigWatcher`) + `main/node-file-watcher.ts:138–141` | config hot-reload dies permanently: hand-edits to `settings.json` or a theme file never take effect again. `onFailed` is optional and only `ExplorerWatcher` supplies it (`main/explorer-watcher.ts:39` → `main.ts:941–943`) | `console.warn` → `main.log` only |
| G-04 | `main/config-store.ts:289` | a multi-file config rollback failed, so the config is half-written — the user is told the *write* failed, which implies nothing changed | `console.error` → `main.log` only |
| G-05 | `editor/commands.ts:130`, `:162`, `:191`; `editor/content-menu.ts:62`, `:101`; `terminal/use-terminal.ts:426` | cut / copy / paste does nothing and the user concludes the panel is broken | `console.error` in the **renderer**, which `attachConsole()` never touches (called only at `main.ts:473` and `daemon/src/main.ts:50`) — in an installed build this is not log-only, it is nowhere |
| G-06 | `editor/editor-language.ts:145`; `editor/language-override.ts:67`, `:108` | a file opens with no syntax highlighting; an explicit language choice is forgotten on reopen | renderer console only, as G-05 |
| G-07 | `main/terminal-ipc.ts:292` | every keystroke and paste to an unreachable daemon is discarded — the user types and nothing appears | `.catch(() => ({ ok: false }))`; not logged anywhere |
| G-08 | `main/icon-pack-service.ts:222–231` (also `:179–181`, `:200–202`) | a single unreadable or corrupt SVG in a custom pack degrades to `{ kind: 'missing' }` — a different glyph and no explanation | nothing at all |
| G-09 | `sidebar/projects-panel.tsx:209` | a settings write raised from the **main** window fails silently. `useConfigWriteFailureNotices()` — the single subscriber to `onConfigWriteFailed` — is mounted only in the preferences window (`preferences-app.tsx:57`), so the chokepoint fires into no listener | nothing at all |
| G-10 | `daemon/src/main.ts:119` | the terminal/session database was repaired after a half-applied migration; data in dropped-and-re-added columns is gone. The comment says "surface it loudly" — loudly means one warn line in `daemon.log` | daemon log only |
| G-11 | `main/main.ts:1247` | the shutdown drain lapsed against a wedged renderer, losing its 400 ms-debounced split-layout and per-panel-zoom writes. This is the bug class #86 was filed for, and its recurrence is invisible | `console.warn` → `main.log` only |
| G-12 | `main/single-instance.ts:19–27` | a second launch quits with no message. The primary raises its window via `second-instance`, so this only bites when no window exists | nothing at all |
| G-13 | `main/main.ts:822`; `main/window-open-guard.ts:22` | a link the guard rejects is dropped with no `else` branch and no log line — the user clicks and nothing happens | nothing at all |
| G-14 | `daemon/src/main.ts:145` | `terminals.shutdown()` threw during signal handling and the daemon exits anyway — orphaned `conhost.exe` and de-elevated agents. Bounded: `reapOrphans()` (`:101`) cleans up on the next daemon start | daemon log only |
| G-15 | `main/main.ts:592` | the daemon did not start at boot and throng runs on with a dead backend | `console.error` → `main.log`; **partially covered** — `main/daemon-supervisor.ts:134` broadcasts the state and S-11 renders it, so the user does get the indicator and, on `stopped`, a notice |
| G-16 | `daemon/src/pty-agent-entry.ts:38–41` | a native access violation in the de-elevated PTY agent is written below the JS layer straight to fd 2 and cannot be captured; its only signature is the **absence** of a post-`start` line in `%TEMP%\throng-agent-<pid>.log` | nothing capturable, by construction |
| G-17 | S-36 — About window | a failed load shows blanks and a spinner that never stops, in a window that cannot raise a notice | nothing at all |
| G-18 | S-37 — renderer crash | the app vanishes exactly as if the user had closed it | crash file only |
| G-19 | `config/write-config.ts:98` | a rejected write is swallowed with `.catch(() => undefined)` — the layer *above* the one S-04 subscribes to | nothing at all |
| G-20 | `confirm-dialog.tsx:117` | a second question opened over a first resolves the first as `DISMISSED` with no user-visible trace — the first question silently answers itself | nothing at all |
| G-21 | renderer-wide | `TreeErrorBoundary` (S-35) is the **only** error boundary, and wraps only the file tree. A throw in the workspace, an editor panel, a terminal panel, the preferences window, About or the title bar white-screens the renderer | nothing — see G-18 |
| G-22 | `explorer/use-explorer-data.ts:138`, `:158`, `:363–364` | `documents.pruneMissing` failures and corrupt `localStorage` are swallowed | nothing at all |
| G-23 | `common/icon.tsx:77–79` | an unresolvable icon token renders `null` — an invisible control. The comment calls it unreachable in practice | nothing at all |
| G-24 | `workspace/panel-placeholder.tsx:452`, `:503`, `:533`; `panel-type/panel-type-form.tsx:179`; `search/find-bar.tsx:168`, `:178`, `:188`; `explorer/context-menu-items.ts:65`, `:72`, `:79` | controls disabled with **no** title saying why, unlike S-31's set | nothing at all |
| G-25 | S-33 — `workspace/panel-body.tsx:151` | an unrecognised panel kind is indistinguishable from an empty panel | nothing at all |
| G-26 | S-34 — `editor/editor-panel.tsx:40`, `:68` | an editor load that never resolves becomes a blank panel after 4 s with no message | nothing at all |

**Where I would start**: G-05, G-07, G-09, G-02 and G-19. Each is a routine action that silently does
nothing, and four of the five leave no record anywhere. G-21 is the largest in blast radius but the
least likely to fire.

---

## 11. The ambiguous ones

### A-01 · `[throng]` lines in a terminal — whose words are exempt?

FR-005a exempts "whatever a **shell** prints into its own terminal". S-38 – S-40 are printed by
throng, into the shell's stream, and are failure reports by any behavioural test. They are outside
the preferences and outside the log's notice channel, and S-40 has no accompanying notice at all.

Reading the exemption as covering them makes it an exemption for a **stream** rather than for a
speaker, which is probably what was meant and is certainly what is implementable — throng cannot
govern the display of bytes it has already handed to xterm. But the FR does not say that, and a
reader checking SC-002 against this document should know the boundary was drawn after the fact.

Not proposed for change here. Worth a one-line clarification in FR-005a if anyone touches it.

### A-02 · The app-close prompt that both asks and reports

`packages/ui/src/main/main.ts:1192–1195` calls `terminal.list`; on failure it logs and returns
`null`, and `:1298` sends `throng:appClose:prompt` with `count: terminals?.length ?? null`. The
renderer (`app-close-prompt.tsx`) then shows a **confirmation** whose count is unknown.

So one dialog is simultaneously a question ("close throng?") and the sole consequence of a failure
("we could not find out what is running"). The comment calls it "unknown → warn to be safe", which is
the right behaviour; the point for this inventory is that the failure itself is never named, and the
user reads an uncertain warning without knowing why it is uncertain. Filed as neither IN nor
EXCLUDED.

### A-03 · A crash fallback that renders a raw error

`explorer/error-boundary.tsx:23` renders `error.message` directly. For a notice, FR-016/FR-034 forbid
exactly this. The boundary is not a notice and is excluded on 018's reasoning, but it is one of only
two places in the renderer where a raw error string still reaches the screen outside the notice model
(the other is `icon-section.tsx:108`), and a reader auditing "no raw error text in the UI" will find
both. See section 9.

### A-04 · One surface, two models

The daemon indicator (S-11) is a **notice** on entering `stopped`, and a **standing state** the whole
time it is not `running`. Silence every severity and the notice goes; the indicator stays. That is
the intended design (`daemon-indicator.tsx:9–18`) and it is also why "is the daemon's state governed
by the preferences?" has no single answer: half of it is, half of it is not.

### A-05 · Reported where nobody is looking

S-29's per-option `title={p.error}` is a real report of a real event delivered inside a closed
`<select>`. It is not silenced by any preference and it is not missable in the toast sense — it is
missable in the "you would have to already suspect it" sense, which no severity setting affects.

### A-06 · A confirmation that is not a question

S-17 (`projects-panel.tsx:324–329`) uses `confirm()` with both labels set to `OK`. It reports a
refused operation; it asks nothing. It is not in the notice model, and it is not a confirmation
either except by the component it borrows.

It is genuinely ambiguous which bucket it belongs in, and the ambiguity is instructive: a modal
error box is *better* than a toast for this failure — it blocks, it cannot be missed, it cannot be
silenced — which is an argument that the notice model is not the right home for every failure
report, and therefore an argument against reading SC-002 as a goal rather than a measurement. Left
alone; recorded.

---

## 12. What this means for SC-002

> **SC-002**: 100% of notices raised by the application are governed by the notification preferences
> — none has display behaviour the user cannot change.

**As worded, this is defensible and this document is the evidence for it** — but only under one
reading, and the reading matters.

**Why it holds.** `notify()` is the sole entry point, `NotificationProvider` the sole renderer, and
once T025 replaces the `severity !== 'error'` branch and `AUTO_DISMISS_MS`, the display mode is
applied in one place that every notice passes through. There is no second notification channel to
leak through: no tray, no native OS toast, no `dialog.showMessageBox`, nothing in main that paints a
message of its own (S-14). Six surfaces that once reported failures their own way are already
adapters over `notify()` (S-01 – S-06). So "every notice is governed" is true **by construction**,
not by enumeration — which is the strongest form the claim can take.

**Four things make it hard to claim honestly.**

1. **It is true because "notice" is defined narrowly, and the narrowing is load-bearing.** The
   surfaces the user would most want to control — the panel failure banners (S-07, S-08) — are
   explicitly exempt (FR-005a, FR-041), and SC-004a *requires* them to be. So SC-002 does not mean
   "the user controls how failures appear"; it means "the user controls how *toasts* appear". Both
   sentences are fine, but only the second is what was measured, and a reader who takes the first
   from it has been misled by a true statement. This document is what makes the difference visible.

2. **A failure that never becomes a notice cannot fail SC-002, and twenty-six of them exist.** The
   metric counts notices raised. G-01 – G-26 are user-visible consequences with no user-visible
   report at all — eleven of them leaving no record anywhere, not even a log line, and six more
   whose only record is a renderer `console.error` that is attached to no file in a packaged build.
   SC-002 is silent on every one, and a 100% figure sits comfortably beside them. **FR-017's second
   half is the requirement that actually bites here**, and this document is its answer: they are
   identified, and they are recorded as gaps rather than brought in, because none of them is in this
   feature's scope.

3. **One of throng's four windows cannot raise a notice at all** (S-36). About mounts no provider.
   It reports nothing today, so nothing escapes governance — but "100% of notices raised by the
   application" quietly means "by the three windows that can raise one". A closely related case is
   G-09: the main window *has* a provider but no subscriber to the config-write failure channel, so
   a failure that is correctly raised at the chokepoint reaches nobody.

4. **At least four user-facing failure reports exist that are not notices and are not banners**
   — S-17 (a modal error box wearing the confirmation model), S-28 (the JSON-tab conflict strip),
   S-38 – S-40 (throng's own words inside a terminal), and S-12 (text on the OS drag ghost). Each is
   individually well-argued and none should move. But their existence means the honest one-line
   summary of this feature is not "every failure is governed by the preferences"; it is
   **"every *toast* is governed by the preferences, and here is the list of failure reports that are
   not toasts."**

**What would make it stronger.** Nothing in the build enforces that a new surface comes through
`notify()`. T031's required `subject` field forces a *subject* on every call site; it does not force
a call site on every failure. There is no equivalent guard for FR-017, and this document —
explicitly generated once and not maintained — is not one either.

---

## Half B

Written by **T073** (US6), after US2–US5 finished rewriting the notices, so it describes them as they
finally are. FR-056; the evidence for SC-012.

Line numbers are as of the commit this half was added on.

### B.0 · What is counted, and how it was found

Half A's subject was everything **outside** `notify()`. This half's subject is everything **inside**
it, plus the panel failure banners — the two surfaces FR-056 names.

The list below is not a reading of the twelve call sites Half A recorded. There are **eighteen** raise
sites now, and two of them (`common/clipboard-copy.ts`, `workspace/panel-failure-notice.ts`) did not
exist when Half A was written — which is exactly why the accompanying guard,
`packages/ui/tests/unit/notice-phrases.test.ts`, **discovers** its scope instead of listing it: a
renderer file is in the notice model when it calls `notify(` or `useErrorNotice(`, and a core file is
when it names `FailureCause` or `NoticeSubject`. That discovery currently returns 16 renderer files
and 6 core files, and it returned this table.

Three sources of truth were used, and they measure different things:

| | What it can see | What it cannot |
|---|---|---|
| `notice-phrases.test.ts` (T071/T072) | every string literal in a file that raises; the `subject` of every inline `notify({…})` | a message assembled in a store and handed to `useErrorNotice` |
| `notice-subjects.e2e.ts:83–109` | a REAL notice's rendered text, asserted free of "this item / the item / this file" | anything not on the path that spec drives |
| this document | everything, by hand | nothing — and it is a snapshot, not a register |

### B.1 · The eighteen raise sites

"Names its subject" is about the notice as the user meets it: the heading (`noticeHeading` — an
explicit `title`, else `Couldn't {action} {subject}`, else `An error occurred when you tried to
{action}`), then the message.

| # | Raise | Sev. | Subject | What the user reads | Names its subject? |
|---|---|---|---|---|---|
| N-01 | `common/clipboard-copy.ts:60` | error | the caller's — the notice or panel being copied | `Couldn't copy Ghost — Main — Shell` · *The details could not be put on the clipboard.* | **Yes**, inherited from what was copied |
| N-02 | `common/notification.tsx:1043` (`useErrorNotice`) | error | the store's, per raise — see N-15 – N-18 | `Couldn't {action} {subject}` · a cause sentence (B.2) | **Yes** wherever the store recorded one |
| N-03 | `config/config-write-notices.ts:40` | error | `{ kind: 'none' }` | *Saving your settings / your key bindings / the theme "X" failed. Nothing was changed.* | **In the sentence.** See category C-1 |
| N-04 | `editor/drop-target.tsx:77` | error | `{ kind: 'file', name, dir }` | `Couldn't open alpha.ts` · the refusal from `core/editor/drop.ts` | **Yes** — with the folder, because a five-file drop that refuses two must say which two |
| N-05 | `editor/drop-target.tsx:185` | error | `{ kind: 'none' }` | *An error occurred when you tried to open a file you dropped here* · *That item has no file on disk, so it cannot be opened.* | **No — and correctly.** See C-2 |
| N-06 | `editor/editor-notice-dialog.tsx:28` ← `editor/file-changed-notice.ts:11` | error | `{ kind: 'file' }` from the one-entry list | *File changed on disk* · *This file was changed by another program…* + the file, its panel and its tab | **Yes**, in the body list |
| N-07 | `editor/editor-notice-dialog.tsx:28` ← `editor/use-editor.ts:1288` | error | `{ kind: 'none' }` | *Cannot save* · one of three sentences (*…only be saved INSIDE that project's folder* / *Choose where to save first.* / *Save failed — the file may be missing, locked, or read-only.*) | **No — and the subject WAS available.** The one genuine miss; see B.5 |
| N-08 | `panel-type/panel-type-form.tsx:138` | error \| info | `{ kind: 'terminal' }` — flavour + place | *Terminal exited (code 1) — Proj › Tab › Panel (PowerShell)* | **Yes**, twice over: `terminalExitNotice` carries the identity and the subject repeats it structurally |
| N-09 | `preferences/reset-notice.tsx:45` | error | `{ kind: 'none' }` | *Reset all settings failed. Nothing was changed.* | **In the sentence.** See C-1 |
| N-10 | `preferences/themes-tab.tsx:185` | error | `{ kind: 'none' }` | six messages (`:393`, `:403`, `:430`, `:437`, `:443`, `:455`) | **In the sentence**, in five of six. See C-1 and B.5 |
| N-11 | `statusbar/daemon-indicator.tsx:51` | error | `{ kind: 'none' }` | *throng's daemon has stopped* · *Terminals will not respond and changes will not be saved until it restarts…* | **In the title.** See C-3 |
| N-12 | `statusbar/daemon-indicator.tsx:73` | error | `{ kind: 'none' }` | *Could not restart the daemon* · the daemon's own reason, else *throng could not restart its daemon.* | **In the title.** See C-3 |
| N-13 | `terminal/terminal-panel.tsx:552` | warning | `{ kind: 'panel' }` | *Command not remembered* · *The command that was running could not be saved as the startup command. The previous value is unchanged.* | **Yes** — the panel, deliberately, not the flavour (FR-022 over FR-026) |
| N-14 | `workspace/panel-failure-notice.ts:129` | error | `{ kind: 'project' }`, else `{ kind: 'none' }` | `Couldn't open MyProject` · the reporter's sentence · the affected-panel list | **Yes**, unless the project id no longer resolves to a name (C-4) |
| N-15 | `workspace/panel-placeholder.tsx:242` | warning | `{ kind: 'panel' }` — the name it was GRANTED | *Another panel is already called "X", so this one was renamed.* | **Yes.** "this one" is anaphora after the heading has named it (FR-023), not a stand-in |
| N-16 | `app.tsx:422` (`useErrorNotice`) | error | `{ kind: 'none' }` | *An error occurred when you tried to restore your workspace* · *A fresh workspace was opened instead.* | **No — genuinely unavailable.** See C-5 |
| N-17 | `explorer/file-tree.tsx:136` (`useErrorNotice`) | error | per operation, from `use-explorer-data.ts` | `Couldn't rename alpha.txt` · a cause sentence | **Yes** for a single item; `{ kind: 'none' }` for a batch (C-4) |
| N-18 | `sidebar/projects-panel.tsx:134` and `sidebar/subworkspaces-panel.tsx:52` (`useErrorNotice`) | error | `{ kind: 'project' }` / `{ kind: 'subWorkspace' }` from the store | `Couldn't delete MyProject` · a cause sentence | **Yes**, unless the id no longer resolves (C-4) |

### B.2 · The sentences the shared raiser speaks

N-02 raises for four surfaces and writes none of its own words. Its message is one of three things,
and only the first two are throng's:

1. **A cause sentence** — `packages/core/src/failure/cause.ts:168` (`causeMessage`), five kinds and
   five sentences: `"X" is open in another program…`, `"X" could not be found. It may have been
   moved, renamed or deleted.`, `You do not have permission to change "X".`, `"X" still contains
   items.`, `throng's daemon has stopped. Restart it from the status bar to continue.` Each has a
   **subject-free twin** selected by `{ subjectPresented: true }` — *It is open in another
   program…*, *You do not have permission to change it.* — used when the heading has already named
   the thing. **That twin is the house style for referring back to a named subject**, and it is why
   pronouns are not treated as stand-ins by the guard.
2. **A producer's cause**, composed by main (`files-service.ts:failure`) from the same function, so
   the words cannot differ between the two routes.
3. **The raw failure, untouched** — FR-011b, for anything matching none of the five kinds. It names
   nothing by design, and the subject beside it is what makes the notice legible.

### B.3 · The banner strings

Not notices, and deliberately not governed by the notification preferences (FR-005a/FR-041,
SC-004a). Counted here because FR-056 says "notice **and banner**".

| ID | String | Where | Names its subject? |
|---|---|---|---|
| B-01 | *This file could not be read* | `editor/editor-failure.ts:26` (headline) | **Structurally.** FR-040 makes the headline the one sentence a panel TYPE owns, so it cannot contain a name; FR-040a renders the path directly beneath it, and `subject: panelSubject(place)` puts `Project — Tab — Panel` into the copied text (FR-052) |
| B-02 | *This terminal could not be opened* | `terminal/terminal-panel.tsx:796` (headline) | Same, same reasons |
| B-03 | *Copy the details here, or see the notification.* | `common/panel-failure-banner.tsx:94` | n/a — a pointer, not a report |
| B-04 | *That did not work — the condition is still there.* | `common/panel-failure-banner.tsx:97` | n/a — the outcome of a Retry the user just pressed, on the banner that already names the panel |

"This file" and "This terminal" in B-01/B-02 are **deictic, not generic**: the referent is the panel
the reader is looking at, and the path is on the next line. A guard that banned them would leave no
satisfiable wording for a requirement that says the sentence belongs to the type — which is why the
check inspects `notify()` raises and not banner props.

### B.4 · Why a notice says `{ kind: 'none' }` — five reasons, not thirteen misses

`{ kind: 'none' }` is written at more than twenty places in the renderer — at raise sites, and in the
helpers that derive a subject and fall back. Reading them as that many unnamed notices would be
wrong: they fall into five categories, and only the first is structural.

**C-1 · The subject is real, and `NoticeSubject` has no word for it.** *(N-03, N-09, N-10 — and see
the count note below.)*

`NoticeSubject` is the **workspace's** vocabulary — Pane, Tab, Panel, Panel Type, Project,
Sub-workspace, file, folder, terminal flavour — and the spec closes the set on purpose (FR-024: the
terms the interface itself uses, "with no synonyms invented"). The Preferences window's subjects are
none of those:

- a **configuration document** — settings, key bindings, a theme file (`config-write-notices.ts:40`);
- a **reset scope** — "Reset all settings", "Restore this theme" (`reset-notice.tsx:45`);
- a **theme** (`themes-tab.tsx:185`).

All three already name the thing **inside the sentence**, where it has always read correctly:
*Saving your key bindings failed*, *Reset all settings failed*, *Could not read "Solarized"*. FR-027
therefore applies exactly — the message is left as it is rather than padded — and the honest answer
is `{ kind: 'none' }` rather than a near-miss kind chosen to satisfy the compiler. Widening the union
is a spec-level decision and not one a call site may make.

*Count note: this brief described this category as **four** call sites. Three were measured
(`config-write-notices.ts:55`, `reset-notice.tsx:54`, `themes-tab.tsx:185`). The likely fourth is one
of the daemon's two (C-3), which shares the structure — a real subject with no word for it — while
belonging to the status bar rather than to Preferences. Recorded as measured rather than as
described.*

**C-2 · There is genuinely nothing to name.** *(N-05.)* `drop-target.tsx:185` handles a drop that
yielded no path at all — a virtual folder, a mail attachment, an item that exists only inside the
source application. *That item has no file on disk* is not a stand-in; it is the fact. This is the
case FR-027 was written for, and it is the reason the guard excuses a raise that states
`{ kind: 'none' }` rather than banning the phrase everywhere.

**C-3 · The daemon.** *(N-11, N-12.)* There is exactly one, so "which one?" — the question a subject
answers — cannot be asked about it. Both raises carry an explicit `title` naming it, and a title wins
the heading outright.

**C-4 · The operation spans a set, or the name no longer resolves.** A multi-item move, paste, copy
or delete (`use-explorer-data.ts:916`, `:934`, `:994`, `:1093`) has no single subject, and the wording
splits on the same line: one item is named, several become *"delete these items"*. A project or
sub-workspace whose id no longer resolves to a name (`projects-store.tsx:189`,
`detach-context.tsx:88`, `panel-failure-notice.ts:127`) yields `{ kind: 'none' }` rather than an
identifier the user has never seen. Both are FR-027, applied per raise.

**C-5 · The subject is the thing that failed to exist.** *(N-16.)* What did not restore is the whole
previous layout — every tab and panel in it, none of which exists to be named, because the failure is
precisely that they could not be brought back.

### B.5 · What this sweep found

Two things, and they are different in kind.

**1. A generic stand-in still reaching the user — `common/notification.tsx:920`, as the guard first
reported it.** Found on the guard's first run, before the fix below moved the line. `subjectFromMessage` ended `return presented ?? 'this item'`, and
`causeMessage` then **quoted** that value, so a classified failure whose raw message contained no
quoted path and whose raiser stated `{ kind: 'none' }` rendered as **`"this item" could not be found.
It may have been moved, renamed or deleted.`** — #195 verbatim, surviving inside the fix for it. T034
("replace generic stand-ins") closed with this line intact, and nothing could have failed: the E2E
that bans the phrase drives a path where the errno does quote a name.

Fixed under T072. The function now returns `undefined` when nothing has a name, and the caller speaks
the cause in its subject-free form (*It could not be found…*), which is FR-027's instruction — leave
the sentence as it is rather than pad it with a placeholder — and the same form FR-023 already uses.
Rendering of every named case is unchanged, and `causeKey` collapses exactly as it did when every
nameless failure shared the string `this item`.

**2. One notice whose subject was available and is not stated — N-07.** `reportSaveError`
(`use-editor.ts:1277–1288`) calls `showEditorNotice({ title, message })` with **no** `files`, so
`editor-notice-dialog.tsx:46` takes the `{ kind: 'none' }` branch. The heading is *Cannot save* and
the message is about "this editor" or "the file"; with two dirty editors open, neither says which.
The document's path is in `configRef.current.filePath` at that point — the sibling caller,
`buildFileChangedNotice`, passes exactly that and gets a named subject (N-06).

This is **not** an FR-058 offence — no banned phrase appears — which is why the guard is silent on it
and this hand audit is not. It is an FR-019/SC-012 one, and it is the only raise in the table whose
"names its subject" answer is *no* for a reason other than the subject being unavailable. Not fixed
here: US6's tasks are the check and the record, and a change to the save-refusal path belongs with an
issue of its own.

A third, smaller one: `themes-tab.tsx:455` raises *A theme with that name already exists.* /
*Invalid name.* without the name the user just typed — the one string in N-10's six that does not
name what it is about, and the same class as N-07 at a much smaller scale.

### B.6 · SC-012, measured

> **SC-012**: Every user-facing notice and banner string is accounted for in the inventory, and 100%
> of those with an available subject name it.

**Accounted for**: 18 raise sites and 4 banner strings above, plus the cause sentences they speak
(B.2) and the 40 non-notice surfaces of Half A. The two halves together are the sweep FR-017's second
half asks for.

**100% of those with an available subject name it**: **not yet — 12 of 13.** Thirteen entries have a
subject `NoticeSubject` can express and that was known at the moment of the raise (N-01, N-02, N-04,
N-06, N-07, N-08, N-13, N-14, N-15, N-17, N-18, B-01, B-02); twelve of them state it. **N-07 is the
exception**, and it is stated rather than argued away.

Of the remaining nine: five have a real subject the closed union has no word for and name it in the
sentence instead (C-1, C-3 — N-03, N-09, N-10, N-11, N-12); two have no subject to name (C-2, C-5 —
N-05, N-16); and two are pointers rather than reports (B-03, B-04).

**What now enforces it going forward**, and what does not:

- the **type** makes omission inexpressible (FR-057, `notice-subject-required.test.ts` compiles a
  fixture to prove the requirement is live);
- the **guard** makes a generic stand-in fail the build, over a scope it rediscovers on every run
  (FR-058, `notice-phrases.test.ts`);
- **nothing** makes a store record a subject it could have recorded. N-07 compiles, passes every
  check, and is wrong — which is the honest shape of this success criterion: the automated half
  covers *saying nothing* and *saying "this item"*, and a hand audit is still what covers *saying
  nothing when you knew*.
