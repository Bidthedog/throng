# Feature Specification: Side Panes and Project List

**Feature Branch**: `feature/S046-I331-I332-I390-I411-I292-side-panes-and-project-list`

**Created**: 2026-09-23

**Status**: Draft

**Issues**: closes [#331](https://github.com/Bidthedog/throng/issues/331) (rename the "Files &
Folders" pane to "File Explorer"), [#332](https://github.com/Bidthedog/throng/issues/332) (global
keyboard commands to cycle projects and to focus the side panes),
[#390](https://github.com/Bidthedog/throng/issues/390) (Ctrl+Shift+0 resets the app-wide zoom),
[#411](https://github.com/Bidthedog/throng/issues/411) (a right-click menu for projects, with
Unload) and [#292](https://github.com/Bidthedog/throng/issues/292) (project categories with
minimisable groups). Related, and not in scope: [#330](https://github.com/Bidthedog/throng/issues/330)
(per-project side-pane expanded state, same panes) and
[#2](https://github.com/Bidthedog/throng/issues/2) (the roadmap's richer project list).

**Input**: The bodies of the five issues above. Their *Intent*, *Scope and constraints* and
*Acceptance criteria* are binding. Where this spec settles a question an issue left open, the issue
names the question and this spec answers it in *Clarifications* or *Assumptions*.

## Background

The five issues share two surfaces: the **side panes** (the Projects pane on the left, the file tree
on the right) and the **keyboard layer** that reaches them. The file tree has two names. The Projects
pane cannot take keyboard focus and has no right-click menu. The project list is flat. Together they
cover how a user finds, reaches, and puts away a project.

Facts from the code on master at `5896600d` that shape the requirements:

- **The file tree is called two things.** The pane header, the pane rail, the panel header menu
  item *Reveal File in Files & Folders*, two setting descriptions, two keybinding descriptions, a
  preview-setting description, the empty-editor placeholder and four docs say "Files & Folders".
  Both configuration editors, the scope pill and the component itself already say "File Explorer",
  and so does constitution Principle XI.
- **The Projects pane is not a focus target.** The focus model knows two panes, the file tree and
  the workspace. Clicking the Projects pane does not change the active pane, and no command names it.
- **Nothing switches project except a click.** No command exists for it.
- **Ctrl+Shift+0 cannot reach `zoom.reset`.** The window keyboard listener drops Shift for every key
  except the backtick, function keys, letters and arrows. It matches on the character produced, and
  Ctrl+Shift+0 produces `)` on US and UK layouts.
- **"Loaded" already exists and is session-only.** A project is loaded once it has been opened in
  this session. Unloaded rows keep the greyed italic style (006 FR-051). Nothing can unload a project
  again.
- **A project row has no context menu**, although 002 FR-041 already describes double-click rename
  as "the same inline rename as the right-click menu".
- **Switching away from a project leaves its terminals running.** The daemon keeps every session,
  idle or not, until the project is removed.

## Terminology

- **Side panes**: the **Projects pane** (the sidebar that stacks the project list above the
  sub-workspaces list) and the **File Explorer** (the right-hand file tree, formerly titled "Files &
  Folders").
  - *(recorded at implementation, analysis A1b; T034/T040):* as a **focus target** (FR-015 –
    FR-018), "the Projects pane" means its project list (the `role="tree"` list in the Projects
    panel), not the whole sidebar: the Sub-workspaces list beneath it is not part of the target.
- **Loaded project**: a project whose layout, panels, editors and terminal views have been opened
  in this session. **Unloaded project**: one that has not, or that has been unloaded since
  (US4). The active project is always loaded.
- **Category**: a named group in the project list. Every project belongs to exactly one.
- **Default category**: the category named "In Progress" at first run. It cannot be deleted or
  minimised.
- **Minimised category**: a category drawn as a single header row carrying its name and a count. Its
  projects are not listed.
- **List order**: the order projects appear in the project list, top to bottom, with categories in
  their own order and projects in their order within each category.

## Clarifications

### Session 2026-09-23 (spec author, from the issues and the governing specs)

- Q: Does `project.next` / `project.previous` wrap at the ends of the list? → A: **No. They stop at
  the ends**, matching `focus.*`, which does not wrap at the edge (012 FR-015). (FR-011)
- Q: Do the cycle commands step into projects in a minimised category? → A: **No.** #292 makes a
  minimised category's projects impossible to switch into, and a keyboard route must not undo that.
  They step over them. (FR-012)
- Q: Do the focus commands reveal a hidden pane, or do nothing while it is hidden? → A: **They reveal
  it, then focus it.** A chord that does nothing while the pane is hidden looks broken. (FR-016)
- Q: Where is the menu route for the four new commands (Principle VI)? → A: **The title-bar cog
  menu**, in a new *Navigate* section. The app has no View or Go menu, and the cog is the only
  whole-app menu in the window. (FR-019)
- Q: Which project becomes active when the active project is unloaded? → A: **None.** The workspace
  returns to the state it has at startup before any project is chosen (003 FR-035). Choosing a
  different project on the user's behalf would be a switch they did not ask for. (FR-036)
- Q: What happens to a minimised category that holds the active project? → A: **It can still be
  minimised, and the active project's row stays visible under the collapsed header.** Its other
  projects are hidden. Switching away from the active project hides its row too. (FR-052)
- Q: What does dragging a project across a category boundary do? → A: **It moves the project into
  that category, at the position where it is dropped.** Reordering within a category works as it does
  today. (FR-055)

### Session 2026-09-23 (maintainer)

- Q: When a project is unloaded, what happens to its terminals? → A: **"1 by default, but we need to
  provide preference options for confirmation dialogs terminating terminals when a project is
  unloaded manually, similar to the other dialogs; two, one, or none. We also provide another option
  for the "default action" - the default action being "keep open". Look at other preferences (tabs,
  panels, closing the app) and match them. Two confirmations should show by default."** "1" is
  Principle III's project-close rule. The existing confirmation preferences are
  `confirmations.destroyProject/Tab/Panel/SubWorkspace` (`none` | `single` | `double`, all shipped as
  `double`). No close preference yet carries a default action, so FR-034a adds the first.
  (FR-034 – FR-034d)

### Session 2026-09-23 (maintainer, iterate round 1 — after hand-testing)

Answers in the maintainer's own words are quoted. Everything marked *derived* was worked out from the
code and the older requirements and has not been confirmed. The constitution was amended to v5.6.0
in the same round (Principles III, IV and VI), with the maintainer's approval for all three rules.

- Q: How should a category header row look? → A: **"The collapse header should have a highlighted
  background, and be in a bold, uppercase font."** The background comes from a theme token, and the
  style applies to every category header, the default included *(derived from Principle X and the
  themeable-control rule, FR-061; not confirmed by the maintainer)*. (FR-072)
- Q: How thick is the active-pane outline on the side panes? → A: **"The new left and right pane
  highlight border should be thinner. Just match the default border, the colour is enough to indicate
  it is selected."** It is the pane's default border width (1px today, `panes.css`) in the active
  colour. The workspace panels' own active outline is unchanged *(derived: the maintainer named "the
  left and right pane" only; not confirmed by the maintainer)*. (FR-073)
- Q: Do Next/Previous Project and the two focus commands need a menu route? → A: **"Remove the
  Next/Previous and focus entries from the cog menu. They do not belong there (not necessary anywhere
  — keyboard shortcuts are sufficient)."** Constitution v5.6.0 Principle VI now allows this: a
  command that is not a panel action MAY have a chord and no menu item. The four stay in the Key
  Bindings editor. This reverses the spec author's answer above ("The title-bar cog menu, in a new
  Navigate section"). (FR-074)
- Q: Where can a project row be dragged from? → A: **"The whole project row (that is not a single
  click interactable element) should be draggable, not just the handle on the left."** A drag may
  start anywhere on the row except its interactive controls (Edit, Remove, the inline rename and edit
  inputs). The grip stays. A click that does not move past the drag threshold still switches project
  *(the last two sentences derived from 002 FR-046 and the current row; not confirmed by the
  maintainer)*. (FR-075)
- Q: Is there a global (app-wide) zoom reset, and which chord does it use? → A: The maintainer found
  that **Ctrl+Shift+0 works but appears to reset a panel's zoom**, and that **"there does not seem to
  be a global zoom reset — implement it and follow the rule"**. The rule is the v5.6.0 modifier
  convention: the global reset is on **Ctrl+Alt+0**, and the panel reset moves to **Ctrl+Shift+0**.
  #390 asked for Ctrl+Shift+0 on the app-wide reset. Under the new convention it is read as "reset
  zoom with a two-modifier chord", so the app-wide reset gets Ctrl+Alt+0 and Ctrl+Shift+0 goes to the
  panel. Reading the code, `zoom.reset` already calls `webContents.setZoomLevel(0)`, which is the
  app-wide zoom. The maintainer's observation does not match that code, so it is recorded as a
  **hypothesis** in research.md R16 until a probe settles it. Either way FR-080 requires the
  app-wide reset and a test that proves it *(the reading of #390 and the hypothesis are derived; not
  confirmed by the maintainer)*. (FR-080)
- Q: How many Unload rows does the project menu show? → A: **"The three Unload options should be two:
  'Unload Project' and 'Unload Project <opposite of default setting>'."** They are **Unload Project**,
  which applies `projects.unloadTerminalAction`, and a second row for the other action: **Unload
  Project and End Terminals** when the default is `keepRunning`, or **Unload Project and Keep
  Terminals Running** when it is `endTerminals`. The exact wording of the second label is *derived
  from the existing variant rows; not confirmed by the maintainer*. (FR-081)
- Q: Which pane is active after a project is chosen from the list? → A: **"Clicking on a project now
  flashes the active pane around the projects list briefly. Keep the selected project activated
  instead of activating the middle panel like we used to."** A click, or Enter, on a project row
  switches project and the **Projects pane stays the active pane**. The workspace becomes active when
  the user clicks or moves focus into it. A `project.next` / `project.previous` chord pressed
  elsewhere leaves the active pane where it was *(the Enter case and the chord case are derived; not
  confirmed by the maintainer)*. (FR-082)
- Q: Which default chords break the new modifier convention, and what replaces them? → A: The
  convention is the maintainer's: **Ctrl+Shift+<key> targets the active panel or pane; Ctrl+Alt+<key>
  targets global, app-wide actions.** The audit and the replacement chords are *derived (research.md
  R15; not confirmed by the maintainer)*. Every chord is listed in FR-077's table. (FR-076 – FR-079)
- Q: Can categories be reordered? → A: **"We need to be able to re-order categories, except the
  default category — that always stays at the top."** A non-default category header can be dragged,
  and its menu gets **Move Category Up** and **Move Category Down**. The default category is always
  first and cannot be moved or passed. The order persists through a new migration (v10), because v9
  has already run on the maintainer's development database and must not be edited. A new category is
  added at the end *(everything after the first sentence is derived; not confirmed by the
  maintainer)*. (FR-083, FR-084)
- Q: Should any Unload row still ask what to do with the terminals? → A: **"If I select 'Unload and
  keep terminals running' or '… end terminals', I still get a confirmation prompt asking me what I'd
  like to do. I would not expect a prompt to appear for any options, as they are all pre-determined
  before click."** The dialog that asks Keep running / End terminals / Cancel is removed entirely.
  Keep Terminals Running never prompts. **End Terminals still shows the destructive confirmation**
  set by `confirmations.unloadProject` (none / single / double) when at least one terminal is running
  a process, and no prompt when every shell is idle. That keeps the confirmation the maintainer asked
  for in the session above *(derived; not confirmed by the maintainer, and a direct tension with "I
  would not expect a prompt to appear for any options", so it is the first answer to challenge)*.
  (FR-085)
- Q: Does Keep Terminals Running close idle shells? → A: **No: it keeps every terminal alive, idle
  shells included, and reattaches them on the next load.** This is constitution v5.6.0 Principle
  III's stated exception, which the maintainer approved. Application close and project close keep the
  idle-shell rule. (FR-086)
  *(T153, 2026-09-25: they keep it as a requirement, but no app-close path has ever closed an idle
  shell. See FR-086's T153 note.)*
- Q: Which Key Bindings group holds Focus File Explorer and Focus Projects? → A: **"Move the Focus
  File Explorer / Projects preferences to the focus group in keybindings."** That is **Focus & Zoom**,
  the group holding the other `focus.*` commands. Next and Previous Project stay in View *(derived:
  the maintainer named only the two focus commands; not confirmed by the maintainer)*. (FR-087)
- Q: Having reviewed the remap, which of FR-077's changes stand? → A: The maintainer kept five chords
  where they are, as **recorded exceptions to the modifier convention**: `navigate.quickOpen`
  **Ctrl+Shift+T**, `search.findInFiles` **Ctrl+Shift+F** and `search.replaceInFiles`
  **Ctrl+Shift+H** ("KEEP unchanged"), and **"Global Save All must stay on Ctrl+Shift+S, which means
  Save As for an editor should stay Ctrl+Alt+S."** It follows that `focus.explorer` **stays on
  Ctrl+Alt+F**: its move to Ctrl+Alt+D only existed to free F for Find in Files. This reverses the
  corresponding rows of the Q/A above. (FR-089)
- Q: Should the zoom chords answer to the numeric keypad? → A: **"Any bindings that use = or -
  should support keypad + and - also by default."** Every shipped chord on the `=`/`+` or `-` key
  also ships a keypad variant, NumpadAdd or NumpadSubtract, with the same modifiers. The audit behind
  it is research.md R17: the bare-Ctrl and Ctrl+Alt keypad presses already work through the produced
  character, and the Ctrl+Shift keypad presses do not. (FR-090)
- Q: Is Ctrl+Alt+Enter (Replace All) a real binding, given it "does not currently 'replace all'" in
  an editor, while Ctrl+Shift+F and H open the global search and replace? → A: It is real and wired
  (research.md R18). It acts only while an editor's in-panel find bar is open, and nothing in the
  suite presses it. The maintainer's report is recorded as a **defect finding** to reproduce with a
  failing test at implementation. It is not a spec change. The requirement stands, under the
  convention, on **Ctrl+Shift+Enter**, and it must work from the in-editor replace bar
  *(scope and chord derived from the audit and the convention; not confirmed by the maintainer)*.
  (FR-093)
- Q: Which chord toggles word wrap? → A: **"Toggle word wrap should be Ctrl+E+W (chord)"**, a
  two-stroke chord: Ctrl+E, then W. throng's keybinding model has no multi-stroke chords today
  (research.md R19), so this adds the capability in the smallest form that serves this binding. The
  first stroke is live only where the command is, the editor, so a terminal never loses Ctrl+E,
  which is in the reserved tier. The capability's behaviour follows VS Code's Ctrl+K chords
  *(derived: the pending indication, the ending conditions, the unbound-second-stroke behaviour and
  the terminal exclusion; not confirmed by the maintainer)*. This supersedes 024's explicit rejection
  of the same chord, whose two grounds were the missing engine and the terminal shadow. (FR-091,
  FR-092)
- Q: What is `focus.cycleBack` supposed to do? → A: It is the reverse of `focus.cycle`. Ctrl+` moves
  keyboard focus to the next panel of the **active tab** in layout order (left to right, then top to
  bottom), and **Ctrl+Shift+`** moves to the previous one, wrapping at either end. It never leaves
  the tab and never reaches a side pane. It comes from 012 FR-015 and is documented in
  `docs/quick-start.md` (the chord table, "Cycle the active panel forward / back"). It works: the
  window listener keeps Shift on the physical backtick key (`chord-key.ts` `chordKey`), and the E2E
  `window-chord-resolution.e2e.ts:283` presses both directions. With one panel in the tab it has
  nothing to move to and does nothing, which may be why it looked inert. No change requested.
- Q: Is "Ctrl+Shift acts on the active panel, Ctrl+Alt acts on the application" the convention? →
  A: **No, the maintainer redefined it:** "What I'd like is to be able to navigate to any surface
  pane / panel with CTRL+SHIFT (move between panes, panels, activate panels, tabs etc), then use
  CTRL+ALT to do things that affect the pane or panel when inside a panel or pane. Actions that
  affect the pane content itself should be bound to CTRL+, SHIFT+ or ALT+. So, three hierarchies
  (with a few noted exceptions)." This reverses the convention recorded in the Q/As above and
  replaces FR-076. Constitution v5.6.0 IV was revised to "Three modifier tiers" before publication.
  (FR-094)
- Q: May a group of related chords mix modifiers? → A: **"zoom in / out / reset need to use the same
  chord combinations for each action within a group. Mixing them does not make any sense."** So the
  window zoom is `Ctrl+=` / `Ctrl++` / `Ctrl+-` / `Ctrl+0`, and the panel zoom is `Ctrl+Alt+=` /
  `Ctrl+Alt++` / `Ctrl+Alt+-` / `Ctrl+Alt+0`, as they were before this round. `zoom.reset`'s
  `Ctrl+Shift+0` and every `Ctrl+Alt` addition to `zoom.*` are removed. #390 is re-read: its ask came
  from `+` needing Shift on US layouts, and Ctrl+Plus through Shift+= already arrives as `Ctrl++`.
  That matching is kept. *(Re-reading #390 is the controller's ruling, derived; not confirmed by the
  maintainer.)* (FR-099)
- Q: How are the `+` and `-` chords written, and do the keypad keys need their own bindings? → A: The
  maintainer's addendum: **keep "Ctrl++"** (Ctrl plus the `+` key); there is no Plus/Minus
  renaming. **There are no separate keypad tokens.** throng matches on the produced character, so
  keypad `+` already arrives as `Ctrl++` and keypad `-` as `Ctrl+-`, and the same holds for
  `Ctrl+Alt`. The requirement is that every chord on `+` or `-` also fires from the keypad key with
  the same modifiers, and any place where a modifier is dropped differently for one of the two keys
  gets fixed. Ctrl++ and keypad + are one binding. (FR-098)
- Q: Which chord does each command take under the three tiers? → A: FR-095's table. The tier
  classification, every new chord, and the directional-navigation exception are *derived (the
  controller's rulings and research.md R21; not confirmed by the maintainer)*. The maintainer named
  these noted exceptions: `editor.saveAll` Ctrl+Shift+S, `editor.saveAs` Ctrl+Alt+S,
  `navigate.quickOpen` Ctrl+Shift+T, `search.findInFiles` Ctrl+Shift+F and
  `search.replaceInFiles` Ctrl+Shift+H. The controller added `search.replaceAll` **Ctrl+Alt+Enter**,
  the VS Code and Sublime Text chord, which withdraws FR-093's move to Ctrl+Shift+Enter. FR-091's
  Ctrl+E W for word wrap stands as a noted exception. (FR-095, FR-096)

### Session 2026-09-24 (maintainer, iterate round 1 checkpoint — the agreed keybinding convention)

The maintainer hand-tested the second-review tiers and agreed the final convention at the
checkpoint. It supersedes the second-review Q/As above wherever they differ. Answers are the
maintainer's decisions, close to their words. Anything marked *derived* was worked out from the code
and the older requirements and has not been confirmed.

- Q: Which modifiers mean navigation? → A: **Ctrl+Shift+Alt is navigation and global / app
  actions.** Every Ctrl+Shift+Alt chord is matched on the **physical key** (`KeyboardEvent.code`),
  never on the produced character, so it works on every layout: Ctrl+Alt is AltGr on European
  layouts, and AltGr+Shift produces characters on, for example, Polish, which physical matching
  sidesteps. The renderer already matches Ctrl+digit and the backtick physically (`chord-key.ts`);
  the rule extends that to the whole family. (FR-101, FR-104)
- Q: Which modifiers act on a panel or pane? → A: **Ctrl+Alt and Ctrl+Shift are commands on the
  active panel or pane.** (FR-101)
- Q: Which modifiers act on content? → A: **A single modifier (Ctrl, Alt, Shift), or none, is
  content.** (FR-101)
- Q: May a command have more than one chord? → A: **One keyboard chord per command, plus at most
  one mouse gesture.** The keypad `+`, `-` and `0` are the **same binding** as the main-row key, not
  a second chord, so any binding using `+`, `-` or `0` fires from the keypad too. In docs and in the
  UI it is written `Ctrl++`, `Ctrl+Alt++`, `Ctrl+Shift+Alt++` ("Ctrl plus the + key"), never
  `Ctrl+Num+` or `Ctrl+Plus`. (FR-105)
- Q: Which chords are exceptions, kept as they are? → A: The existing list, **Ctrl+F, Ctrl+H,
  Ctrl+S, Ctrl+F5**; `navigate.quickOpen` **Ctrl+Shift+T**; `search.findInFiles` **Ctrl+Shift+F**;
  `search.replaceInFiles` **Ctrl+Shift+H**; `editor.saveAll` **Ctrl+Shift+S**; `editor.saveAs`
  **Ctrl+Alt+S**; `search.replaceAll` **Ctrl+Alt+Enter** (live only while the find bar is open,
  unchanged); the function keys **F2 / F3 / F11 / Shift+F10**; `focus.cycle` **Ctrl+`** and
  `focus.cycleBack` **Ctrl+Shift+`** (Shift reverses direction). **`menu.open` keeps both Shift+F10
  and the dedicated ContextMenu key**: "fine as it is" — the Menu key is a single-purpose hardware
  key, not a second chord. `editor.columnSelect*` (Shift+Alt+Arrow) was not on the list and fits no
  tier; it is kept as an exception *(derived; not confirmed by the maintainer)*.
  `terminal.scrollLineUp/Down` (Ctrl+Shift+ArrowUp/Down) acts on the pane's viewport, so it now
  conforms to the panel tier and needs no exception *(derived)*. (FR-103)
- Q: Are multi-stroke chords in? → A: **Yes, a new capability.** `editor.toggleWordWrap` is
  **Ctrl+E W**, two strokes. FR-091 and FR-092 stand. (FR-091, FR-092)
- Q: Which defaults change? → A: **Only these**, everything else stays:
  - window zoom: `zoom.in` **Ctrl+Shift+Alt++**, `zoom.out` **Ctrl+Shift+Alt+-**, `zoom.reset`
    **Ctrl+Shift+Alt+0**;
  - `focus.left/right/up/down` **Ctrl+Shift+Alt+Arrow**; `focus.notice` **Ctrl+Shift+Alt+M**;
    `view.toggleProjects` / `toggleExplorer` **Ctrl+Shift+Alt+B / N**; `project.next` / `previous`
    **Ctrl+Shift+Alt+PageDown / PageUp**; `focus.explorer` **Ctrl+Shift+Alt+F**; `focus.projects`
    **Ctrl+Shift+Alt+P**; `tabs.openPicker` **Ctrl+Shift+Alt+T**;
  - panel zoom: `panel.zoomIn` **Ctrl+Alt++, Ctrl+WheelUp**; `panel.zoomOut` **Ctrl+Alt+-,
    Ctrl+WheelDown**; `panel.zoomReset` **Ctrl+Alt+0, Ctrl+MiddleClick**;
  - `editor.toggleWordWrap` **Ctrl+E W**.

  Content chords do not change. Plain **Ctrl++ / Ctrl+- / Ctrl+0 become unbound**. This supersedes
  FR-095's table: `focus.cycle` stays on Ctrl+`, and none of the second-review Ctrl+Shift navigation
  chords (PageDown, ], E, P, B, N, M, Tab) ships. (FR-102)
- Q: How does a user without a working chord reach the window zoom? → A: **A Zoom row (in / out /
  reset) in the cog menu**, because AltGr users and mouse users need a route that is not a chord.
  The row's shape — one row with three controls, in the menu's View & state section — is *derived
  from Principle VI's section vocabulary; not confirmed by the maintainer*. (FR-107)
- Q: What happens to #390's Ctrl+Shift+0? → A: **It is retired.** The #390 close text must say the
  global zoom reset is **Ctrl+Shift+Alt+0**, plus the cog menu's Zoom row. (FR-102, FR-107)
- Q: How do saved bindings reach the new defaults? → A: **Shipped-defaults version 13 rewrites only
  saved bindings that still equal the OLD shipped defaults.** Any user-customised binding is left
  alone, and a new default is not applied if it would collide with one of the user's own bindings,
  the same collision guard as version 12. (FR-108)
- Q: What proves the new family is safe? → A: **A Ctrl+Shift+Alt audit**: a guard test that every
  Ctrl+Shift+Alt default is matched physically and that no default collides across scopes,
  extending the existing `keybindings-collision`, `window-chord-manifest`,
  `renderer-chord-resolvers` and `terminal-reserved-keys` guards rather than adding files where
  possible. (FR-109)
- Q: Why did the tab picker chord do nothing from a terminal? → A: `tabs.openPicker` was missing
  from `isPanelScoped`'s window-command exemptions (`keybindings/scope.ts`), so the chord was dead
  whenever a terminal (xterm's helper textarea) or an editor's find bar held focus. **Fixed in
  commit `3b04ec33`.** The requirement is that a window command survives a focused transient
  surface, and the audit checks every EVERYWHERE-scoped command is either exempt or deliberately
  panel-scoped. (FR-110)
- Q: Does any Unload row prompt? → A: **No confirmation prompt for ANY project-menu Unload option**
  — "Unload Project" and its opposite alike. Each states its outcome up front. This reverses
  FR-085's derived End Terminals confirmation, and with it the first maintainer session's request
  for a confirmation level on unload. The unsaved-editor prompt is a different thing — it guards
  unsaved documents, not terminals, and Remove raises it too — so it stays *(derived; not confirmed
  by the maintainer)*. (FR-111)
- Q: Do the other round-1 items stand? → A: **Yes, as specified**: the category header style
  (FR-072), the thinner side-pane outline (FR-073), no Navigate entries in the cog menu with
  Principle VI amended (FR-074), the whole project row draggable (FR-075), two Unload rows
  (FR-081), a project click keeping focus in the project list (FR-082), category reorder with the
  default pinned first (FR-083, FR-084), Keep Terminals Running keeping idle shells with Principle
  III amended (FR-086), and Focus File Explorer / Focus Projects in the Focus group (FR-087). The
  cog menu gains the Zoom row of FR-107 and nothing else.

*Decisions taken during implementation (2026-09-25).* The two Q/As below were settled by the
controller while building the round, not asked of the maintainer. Both are *[derived]*.

- Q: Is `menu.open` a window command that survives a focused transient surface, or panel-scoped?
  → A: **It stays panel-scoped.** A terminal has its own native context-menu handler, so a
  window-level `menu.open` from a focused terminal would compete with it. It is listed in a named
  `DELIBERATELY_PANEL_SCOPED` set in `keybindings/scope.ts`, which is how FR-110's audit ("every
  EVERYWHERE-scoped command is either exempt or deliberately panel-scoped") classifies it
  *[derived; the controller's ruling, not confirmed by the maintainer]*. (FR-110)
- Q: Does the maintainer's report that `Ctrl+Alt+Enter` does not "replace all" reproduce? → A:
  **Not as reported.** With the find bar open and its replace section shown, `Ctrl+Alt+Enter`
  replaces every match (T140). The real defect T140 found is different: with the replace section
  **hidden**, the chord still replaced every match with the hidden field's stale value. The fix makes
  `Ctrl+Alt+Enter` a no-op, passing the key on, unless the replace section is shown (T141). FR-093's
  requirement stands; the literal report is recorded as not reproduced *[derived; the controller's
  ruling from T140's results, not confirmed by the maintainer]*. (FR-093)
- Q: The remote gate's E2E stage failed `editor-caret-persist.e2e.ts:173` ("the editor takes focus on
  switching to a project whose editor mounts fresh (issue 144)"), which asserts 023 FR-030 (#144:
  "switching tabs/projects/panels still restores each open editor's scroll, caret, and active state").
  FR-082 (this round: "keep the selected project activated instead of activating the middle panel like
  we used to") keeps focus on the Projects list instead. Which requirement governs? → A: **Both,
  on different routes.** For a project switch made **from the Projects pane list** — a click or Enter
  on a row — FR-082 governs and **supersedes** FR-030/#144: the Projects pane keeps the active pane,
  the outline and the keyboard scope, and focus stays on the chosen row; the editor does not take
  focus. The maintainer's round-1 instruction was explicit about dropping the old behaviour for this
  route. For a project switch made **from the workspace** — a `project.next` / `project.previous`
  chord while a panel there holds focus — FR-030/#144 still holds: focus still moves into the target
  editor once it mounts. Recorded as Supersession S26 and as a note on FR-082
  *[derived; the controller's ruling, not confirmed by the maintainer]*. (FR-082, 023 FR-030)

### Session 2026-09-25 (maintainer, mid-build)

The maintainer reviewed the in-progress iterate round 1 build and gave two decisions, verbatim:
"Remove the new "Zoom" options from the menu." and "The "Zoom Reset" key bindings need to use the
numpad zero, NOT the 0 key." Both supersede iterate-round-1-checkpoint content above; nothing here
reopens a question the maintainer did not touch.

- Q: Does the cog menu keep FR-107's Zoom row? → A: **No.** "Remove the new "Zoom" options from the
  menu." The cog menu's **View & state** section and its Zoom row (Zoom In, Reset Zoom, Zoom Out) are
  withdrawn; the cog menu returns to the single Application section FR-074 and the 2026-09-09 audit
  describe. The window zoom's only routes are now its keyboard chords — `zoom.in` **Ctrl+Shift+Alt++**,
  `zoom.out` **Ctrl+Shift+Alt+-**, `zoom.reset` **Ctrl+Shift+Alt+Numpad0** (next bullet) — with no
  mouse or menu route at all. FR-107's reason for the row (an AltGr or mouse-only user needs a
  non-chord route) is not met by this decision; the maintainer's instruction is taken as accepting
  that trade, stated plainly rather than left implicit. (FR-113)
- Q: Which physical key resets zoom? → A: **The numpad zero, not the main-row 0.** "The "Zoom Reset"
  key bindings need to use the numpad zero, NOT the 0 key." `zoom.reset` becomes
  **Ctrl+Shift+Alt+Numpad0** and `panel.zoomReset` becomes **Ctrl+Alt+Numpad0** (`Ctrl+MiddleClick`
  stands for the panel reset, unchanged). Matched on the physical code `Numpad0`, the same
  physical-match style FR-104 already uses, so a keyboard with NumLock off — which still reports
  `code: 'Numpad0'` even though the produced `key` changes — still fires it. The main-row `0` no
  longer resets either zoom, in any tier. A keyboard with no numeric keypad has **no keyboard route**
  to `zoom.reset` at all (paired with the previous bullet, no mouse route either), and `panel.zoomReset`
  keeps `Ctrl+MiddleClick`. `zoom.in`, `zoom.out`, `panel.zoomIn` and `panel.zoomOut` are unaffected:
  their keypad `+` / `-` stay the same binding as the main-row key exactly as FR-105 already requires.
  (FR-114, FR-115)

### Session 2026-09-25 (maintainer, iterate round 3 — hand-testing)

The maintainer hand-tested the round-2 build and reported, verbatim: "There does not seem to be a
way to get back to the center pane from the keyboard." Then: "all shortcuts use Ctrl+Shift+Alt.
Focus should be B, N and M (from left to right). Collapse / expand side panes should be J and K,
from left to right. V for notices if it is not already reserved." The Projects pane is on the left
and the File Explorer on the right (Background, Terminology), so "left to right" resolves as below.
Nothing here reopens a question the maintainer did not touch.

- Q: Is there a keyboard route back to the workspace from a side pane? → A: **No, and there must
  be.** Checked against the code before writing: `focus.left/right/up/down` and `focus.cycle` move
  only within the active tab's split tree (`packages/ui/src/renderer/app.tsx`, `dispatchMove` /
  `dispatchCycle`). From a side pane they do nothing when the tab has one panel, or when the target
  is the panel that is already active, because both skip `goToPanel` when the target equals the
  active panel. FR-024 requires exactly that, so the gap is a missing command, not a defect in
  those five. A new command, **`focus.workspace`**, puts focus in the active tab's active panel.
  (FR-116)
- Q: Which chords do the focus commands take? → A: **Ctrl+Shift+Alt+B, N and M, left to right**:
  `focus.projects` **B** (left pane), `focus.workspace` **N** (centre), `focus.explorer` **M**
  (right pane). (FR-117)
- Q: Which chords collapse and expand the side panes? → A: **Ctrl+Shift+Alt+J and K, left to
  right**: `view.toggleProjects` **J**, `view.toggleExplorer` **K**. (FR-117)
- Q: Which chord focuses a notice? → A: **Ctrl+Shift+Alt+V**, checked not reserved (research R22,
  iterate-round-3 check): no shipped default binds V in any tier, the token is in neither of
  constitution IV's terminal tiers, and xterm sends no bytes for it. `focus.notice` takes it.
  (FR-117)
- Q: What happens to Ctrl+Shift+Alt+F and P? → A: **They become unbound.** Nothing ships on them.
  *(derived: the maintainer named the new chords and not the old ones; one chord per command, FR-105,
  leaves them with no owner.)* (FR-117)
- Q: How does a saved `keybindings.json` reach the new chords? → A: **Through a new
  shipped-defaults version, 14, not by editing 13.** *(derived; the controller's ruling, not
  confirmed by the maintainer.)* The upgrade runs only when the saved marker differs from the shipped
  version (`packages/ui/src/main/main.ts`, `readAppliedVersion() !== shipped.version`). The
  maintainer's own development config has already run version 13 and holds its defaults, so a change
  to version 13 would never reach it. Version 13 is not edited, for the reason FR-108 gave for version
  12. (FR-118)

### Session 2026-09-26 (maintainer, iterate round 4 — hand-testing)

The maintainer hand-tested the round-3 build and reported, verbatim: "There is nothing to indicate
that the center pane is focussed. You should not show the focussed panel highlight box if the center
pane is not focussed." Then: "CTRL+SHIFT+ALT+arrows moves from the last panel to its sister even if
the center pane is not active. The center pane should be active before these shortcuts work (i.e. we
are moving FROM the active panel, not from the side panes)". Then: "CTRL+E+W isn't working properly
for word wrap. When I try it in an editor, it registers as CTRL+E, CTRL+W, and says nothing is
registered to it. The correct keystroke is Hold CTRL, then press E, release E, then press W." Each
was checked against the code before writing; none is a defect against a requirement already stated.

- Q: Does the workspace's active-panel outline show while a side pane holds the active pane? → A:
  **No.** The outline and the raised header (012 FR-002), in both the foreground and the dimmed
  state, show only while the **workspace** holds the active pane. Checked: the panel frame reads
  only the tab's active panel id (`packages/ui/src/renderer/workspace/panel-placeholder.tsx:173`),
  never the active pane, so today it stays lit while the Projects pane or File Explorer holds focus.
  The active panel id itself is kept, so returning to the workspace (Ctrl+Shift+Alt+N, a click, a
  directional move) lights the same panel again *(derived)*. (FR-121)
- Q: Do Ctrl+Shift+Alt+Arrows act while a side pane holds the active pane? → A: **No.** They move
  FROM the active panel, so they act only while the workspace holds the active pane. Checked:
  `dispatchMove` in `packages/ui/src/renderer/app.tsx` reads the active tab's active panel and never
  the active pane, so from a side pane it moves the workspace's selection. From a side pane the chord
  does nothing, is consumed, and raises no notice *(derived; FR-011's rule for an end of the list)*.
  `focus.cycle` / `focus.cycleBack` are unchanged *(derived; the maintainer named only the arrows)*.
  (FR-122)
- Q: Does Ctrl+E W complete when Ctrl is still held for the W? → A: **Yes.** Holding Ctrl, pressing
  E, releasing E, then pressing W completes Ctrl+E W. A modifier still held from the first stroke is
  not part of the second stroke. Releasing Ctrl first (FR-091's wording) still works too *(derived)*.
  No shipped default changes. (FR-123)
  *Superseded by FR-124 (round 5, 2026-09-26):* chords are now matched exactly as pressed.

### Session 2026-09-26 (maintainer, iterate round 5 — hand-testing)

The maintainer hand-tested the round-4 build and reported, verbatim: "When the focus is on the
center pane, and I move between panels with CTRL+SHIFT+Alt+Arrows, it seems that the last terminal
or editor keeps carat focus when I move to an empty panel, or the search panel. Focus should move to
either the first control on those panels, or the last active control e.g. empty panels should have
the panel type drop-down focussed if no other controls were previously active, and the find in files
panel should have the search text box active if none of its other controls were previously active.
Any future panels we create should have the same behaviour - I expect this is a constitution
amendment." Then: "If I use the arrow keys to select a project in the project list, then press
enter, the project becomes active (the first panel activates), but the highlight box remains visible
around the projects pane, and no highlight box is active around the active panel in the center pane.
When entering a project, the project pane should stay active - center pane activation is a manual
step for the user." Then: "I can't record CTRL+E, CTRL+W as a multi-step chord in the preferences
either. It just records CTRL+E. Seems it returns on the first key up, rather than when the control
keys are all raised." Each was reproduced as a failing component test and the maintainer confirmed
all three ("Yes, all three"), adding: "It can be any arrow direction, and the target panel shows
the focus border around it, but the carat does not change" and, for the project switch, "the caret
moves, but the border does not focus."

- Q: Where does focus go when a keyboard route makes a Panel active? → A: **Into that Panel**: its
  last-focused control, else its first (an untyped Panel's type picker; Find in Files' search box).
  Adopted into the constitution as Principle XI "Focus follows the active Panel", the maintainer's
  approved wording. (FR-125)
- Q: Does Enter on a project row keep focus on the list? → A: **Yes, as FR-082 already requires.**
  The defect is in the code: an editor restored with saved view state focuses itself on mount
  (`packages/ui/src/renderer/editor/use-editor.ts:1881`), on any second visit to a project
  (reproduced). A terminal's mount/attach focus (`terminal/use-terminal.ts`, `focusIfActive`) is the
  same route read from the code, not reproduced. No spec change; FR-082 stands for both.
- Q: Does the capture box keep the "record a two-stroke chord" button? → A: **No.** "Remove the
  button. I did not even notice it. That is not the normal way that key binders work - the user is
  in control of the buttons; they express how they press the keys, and that exact expression should
  be repeatable in both the app, and the preferences window." (FR-124)
- Q: Is a held Ctrl part of the second stroke? → A: **Chords are matched exactly as pressed, and a
  held-modifier sequence is written with a comma**: "surely `CTRL+E,W` would be a better way to
  express it? Just like `CTRL+SHIFT+ALT+J` is a three-key control chord followed by a single key.
  `CTRL+SHIFT+ALT+J,K` would be similar - press & hold ctrl, shift, and alt, then press J, then press
  K (with the controls still pressed)." (FR-124)

### Session 2026-09-26 (maintainer, iterate round 6 — hand-testing)

The maintainer, verbatim: "'Only two keys can follow modifiers' is displayed if I type more than 2
keys when binding. Can we expand this to three keys? Also, when the error shows, the dialog seems to
get stuck and the only thing I can do is cancel (because normally the dialog closes). Whilst the
error should be shown, the user should still be able to release the modifier keys and apply their
latest chord." And: "Other than that, things look good so far."

- Q: How many keys may follow the held modifiers? → A: **Three** (`Mods+K1,K2,K3`). (FR-126)
- Q: What happens when the capture box refuses a key? → A: **The notice shows, the refused key is
  dropped, and releasing every key records the chord as it stood before it.** *(derived: "the chord
  as it stood" is how the maintainer's "their latest chord" is read — the one the box last showed
  as valid.)* (FR-126)

### Session 2026-09-26 (maintainer, iterate round 7)

The maintainer, verbatim: "Add Ctrl+Alt+0 as a secondary default keybinding for "reset panel
zoom"". Asked how it meets constitution IV's one-keyboard-chord rule, the maintainer chose "Second
chord, new exception".

- Q: Does Reset Panel Zoom ship the main-row Ctrl+Alt+0 too? → A: **Yes, as a second keyboard
  chord**, beside Ctrl+Alt+Numpad0, under a new named exception to Principle IV. (FR-127)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One name for the file tree (Priority: P1)

A user reads "File Explorer" everywhere the right-hand file tree is named: on the pane, on the rail,
in menus, in settings and keybinding descriptions, in placeholder copy and in the docs. The name
matches the one the configuration editors already use.

**Why this priority**: It is the smallest story, and every later story names the pane: the focus
command, its menu item, its description. Settling the name first means that copy is written once.
It also changes the accessible name that tests locate the pane by, so it lands before other work
adds new locators.

**Independent Test**: Open the app and read every surface in FR-001. None says "Files & Folders" or
"Files and Folders".

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the user looks at the file tree pane, **Then** its header
   reads **File Explorer**.
2. **Given** the file tree pane is collapsed to its rail, **When** the user reads the rail and
   hovers its show/hide control, **Then** the label reads **File Explorer** and the tooltip reads
   **Show File Explorer** or **Hide File Explorer**.
3. **Given** an editor panel showing a project file, **When** the user opens its header menu,
   **Then** the item reads **Reveal File in File Explorer**.
4. **Given** a config directory written by the previous build, **When** the new build starts,
   **Then** every setting and keybinding loads with no migration and no warning.

---

### User Story 2 - Switch project and reach the side panes from the keyboard (Priority: P1)

A user working in a terminal, an editor or the file tree presses a chord to move to the next or
previous project in the list, without touching the mouse or even showing the Projects pane. Another
chord puts focus on the File Explorer with its selection live. A third puts focus on the Projects
pane on the active project's row, where the arrow keys move through the list and Enter switches.

**Why this priority**: Constitution Principle VI names "switch project" as a common action, and
today it needs the mouse. This is the most frequent gap in the set.

**Independent Test**: With three projects and focus in a terminal, press the next-project chord
twice and see the title bar change twice. The terminal receives neither keystroke. Press the
focus-explorer chord, then F2, and the tree's selected entry goes into rename.

**Acceptance Scenarios**:

1. **Given** three projects with the first active and focus in a terminal, **When** the user presses
   the next-project chord, **Then** the second project becomes active and the terminal receives no
   input.
2. **Given** the Projects pane is hidden, **When** the user presses the next-project chord, **Then**
   the switch happens and shows in the title bar and status bar, and the pane stays hidden.
3. **Given** the last project in the list is active, **When** the user presses the next-project chord,
   **Then** nothing changes and no notice appears.
4. **Given** focus in an editor, **When** the user presses the focus-explorer chord and then F2,
   **Then** the File Explorer takes focus and rename starts on its selected entry.
5. **Given** the Projects pane is hidden, **When** the user presses the focus-projects chord, **Then**
   the pane is revealed with focus on the active project's row, and the active-pane outline surrounds
   it.
6. **Given** the Projects pane is focused, **When** the user presses ArrowDown twice and then Enter,
   **Then** the selection moves two rows and the project on that row becomes active.
7. **Given** the title-bar cog menu is open, **When** the user reads its Navigate section, **Then**
   it lists Next Project, Previous Project, Focus File Explorer and Focus Projects, each with its
   chord.
   *Superseded by FR-074 (Session 2026-09-23, iterate round 1): the cog menu has no Navigate
   section, and the four commands are reached by their chords and listed in the Key Bindings
   editor.*
8. **Given** the Projects pane is focused, **When** the user clicks a different project row or
   presses Enter on it, **Then** that project becomes active and the active-pane outline stays on
   the Projects pane, without moving to the workspace. (FR-082)
9. **Given** the Key Bindings editor, **When** the user opens the Focus & Zoom group, **Then** Focus
   File Explorer and Focus Projects are listed there beside the other focus commands. (FR-087)
10. *(iterate round 3, 2026-09-25)* **Given** focus on the Projects pane or the File Explorer, and
    a tab with an editor as its active panel, **When** the user presses Ctrl+Shift+Alt+N, **Then**
    the workspace becomes the active pane, its outline surrounds that panel, and the next keystroke
    types into the editor. (FR-116)
11. *(iterate round 3)* **Given** any focused surface, **When** the user presses Ctrl+Shift+Alt+B,
    N and M in turn, **Then** focus goes to the Projects pane, the workspace and the File Explorer:
    left to right, the order the keys sit on the keyboard. Ctrl+Shift+Alt+J and K collapse or
    expand the left and right panes, and Ctrl+Shift+Alt+V focuses the newest notice. (FR-117)
12. *(iterate round 3)* **Given** a `keybindings.json` saved by a build carrying
    shipped-defaults version 13, with every navigation default untouched, **When** the new build
    starts, **Then** each moved default carries its FR-117 chord and any customised binding is
    byte-identical. (FR-118)
13. *(iterate round 4, 2026-09-26)* **Given** a tab whose active panel is outlined, **When** the
    user presses Ctrl+Shift+Alt+B or M, **Then** no workspace panel is outlined and only the side
    pane shows as active; **When** the user then presses Ctrl+Shift+Alt+N, **Then** the same panel
    is outlined again. (FR-121)
14. *(iterate round 4)* **Given** a tab with two panels side by side and focus on the Projects pane
    or the File Explorer, **When** the user presses Ctrl+Shift+Alt+ArrowLeft or ArrowRight, **Then**
    nothing moves, the side pane keeps focus and no notice appears; **Given** focus in one of the
    panels, **When** the user presses the same chord, **Then** focus moves to the other. (FR-122)
15. *(iterate round 4)* **Given** an editor with focus, **When** the user holds Ctrl, presses E,
    releases E and presses W, **Then** word wrap toggles, exactly as when Ctrl is released before
    the W. (FR-123) *Superseded by scenario 16 (round 5): releasing Ctrl first no longer
    completes it.*
16. *(iterate round 5, 2026-09-26)* **Given** an editor with focus, **When** the user holds Ctrl,
    presses E, then W, Ctrl still held, **Then** word wrap toggles (`Ctrl+E,W`); **When** the user
    releases Ctrl after E and then presses W, **Then** the chord ends at the release and W types a
    `w`. (FR-124)
17. *(iterate round 5)* **Given** the Key Bindings capture box, **When** the user holds Ctrl,
    presses E, then W, then releases every key, **Then** it records `Ctrl+E,W`, and nothing is
    recorded before the last key is released; holding Ctrl and pressing S records `Ctrl+S` on
    release. There is no two-stroke button. (FR-124)
18. *(iterate round 5)* **Given** focus in an editor and an empty panel, or a Find in Files panel,
    beside it, **When** the user presses Ctrl+Shift+Alt+Arrow towards it, **Then** the caret
    leaves the editor and typing goes into the target: the empty panel's type picker, or the Find
    in Files search box (or whichever of its controls last had focus). (FR-125)
19. *(iterate round 5)* **Given** a project visited earlier this session whose active panel is an
    editor, **When** the user selects its row with the arrow keys and presses Enter, **Then** the
    row keeps focus and typing does not reach the editor. (FR-082)
20. *(iterate round 6, 2026-09-26)* **Given** the Key Bindings capture box, **When** the user holds
    Ctrl and presses E, W and Q, then lets go, **Then** it records `Ctrl+E,W,Q`, and that chord runs
    its command when pressed the same way; **When** the user presses a fourth key, **Then** the box
    says "Only three keys can follow the modifiers.", and letting go of every key records
    `Ctrl+E,W,Q` and closes the box as any capture does. (FR-126)
21. *(iterate round 7, 2026-09-26)* **Given** a zoomed panel, **When** the user presses Ctrl+Alt+0
    on the main row, **Then** that panel's zoom resets, as Ctrl+Alt+Numpad0 does; on a German
    layout, AltGr+0 still types `}`. (FR-127)

---

### User Story 3 - Reset zoom with the Shift key still held (Priority: P3)

A user who zoomed in with Ctrl+Shift+= and out with Ctrl+Shift+- presses Ctrl+Shift+0 without
letting go of Shift, and the app returns to 100% zoom.

**Why this priority**: Ctrl+0 already resets zoom. This adds a second route to an existing command.

**Independent Test**: Zoom in twice, press Ctrl+Shift+0, and the app is back at 100%.

**Acceptance Scenarios**:

1. **Given** the app is zoomed in with focus in a terminal, **When** the user presses Ctrl+Shift+0,
   **Then** the zoom returns to 100% and the shell receives nothing.
2. **Given** the same with focus in an editor or a find input, **When** the user presses
   Ctrl+Shift+0, **Then** the zoom resets and no character is typed.
3. **Given** the Preferences key binder, **When** the user looks at Reset Zoom, **Then**
   Ctrl+Shift+0 is listed next to Ctrl+0 and Ctrl+MiddleClick, and resetting the binding restores
   all three.

*Superseded in part by FR-076 – FR-080 (Session 2026-09-23, iterate round 1).* Under the v5.6.0
modifier convention, Ctrl+Shift+0 resets the **active panel's** zoom and **Ctrl+Alt+0** resets the
**app-wide** zoom. Ctrl+0 and Ctrl+MiddleClick still reset the app-wide zoom. Scenarios 1–3 keep
their surfaces and their "nothing reaches the shell or the editor" clause, with the chord and the
target read as below:

4. **Given** the app is zoomed in and the active panel is zoomed too, with focus in a terminal,
   **When** the user presses Ctrl+Alt+0, **Then** the app-wide zoom returns to 100%, the panel keeps
   its own zoom, and the shell receives nothing. (FR-080)
5. **Given** the same, **When** the user presses Ctrl+Shift+0, **Then** the active panel returns to
   its default text size, the app-wide zoom is unchanged, and the shell receives nothing. (FR-077)
6. **Given** the Preferences key binder, **When** the user looks at Reset zoom, **Then** it lists
   Ctrl+0, Ctrl+Alt+0 and Ctrl+MiddleClick, and Reset panel type zoom lists Ctrl+Shift+0. (FR-077)
7. **Given** a keyboard with a numeric keypad, **When** the user presses Ctrl+Shift+Num + or
   Ctrl+Shift+Num −, **Then** the active panel zooms in or out. Ctrl+Num + / − and Ctrl+Alt+Num + / −
   zoom the app. (FR-090)

*Scenarios 4–7 superseded by FR-098 / FR-099 (second review, 2026-09-24).*

9. **Given** the app and the active panel are both zoomed, with focus in a terminal, **When** the
   user presses Ctrl+0, **Then** the app-wide zoom returns to 100% and the panel keeps its zoom.
   **When** they press Ctrl+Alt+0, **Then** only the panel resets. The shell receives nothing either
   time. (FR-099)
10. **Given** a keyboard with a keypad, **When** the user presses Ctrl + keypad plus, **Then** the app
    zooms in exactly as Ctrl++ from the main row does. Ctrl+Alt + keypad minus zooms the panel out
    exactly as Ctrl+Alt+- does. **When** they record either in the Key Bindings capture modal, **Then**
    the main-row press and the keypad press record the same chord. (FR-098)
11. **Given** focus in a terminal, **When** the user presses Ctrl+Shift+E, Ctrl+Shift+P,
    Ctrl+Shift+] or Ctrl+Shift+PageDown, **Then** focus goes to the File Explorer or the Projects
    pane, or the project or panel moves to the next one, and the shell receives nothing. (FR-095)
8. **Given** focus in an editor, **When** the user presses Ctrl+E and then W, **Then** the document's
   word wrap toggles, nothing is typed, and a pending indication showed between the two strokes.
   **When** they press Ctrl+E and then Escape, **Then** nothing happens and nothing is typed. (FR-091,
   FR-092)

*Scenarios 9–11 superseded by FR-102 – FR-107 (iterate round 1 checkpoint, 2026-09-24). Scenario 8
stands.*

12. **Given** the app and the active panel are both zoomed, with focus in a terminal, **When** the
    user presses Ctrl+Shift+Alt+0, **Then** the app-wide zoom returns to 100%, the panel keeps its
    own zoom, and the shell receives nothing. **When** they press Ctrl+Alt+0, **Then** only the
    active panel resets. (FR-102)
13. **Given** a keyboard with a keypad, **When** the user presses Ctrl+Shift+Alt with keypad plus,
    **Then** the app zooms in exactly as with the main-row `+` key. **When** they press Ctrl+Alt with
    keypad minus or keypad 0, **Then** the active panel zooms out or resets exactly as with the
    main-row key. The capture modal records the main-row press and the keypad press as the same
    chord. (FR-105)
14. **Given** the pointer over a zoomed panel, **When** the user holds Ctrl and turns the wheel or
    middle-clicks, **Then** that panel's zoom (its panel type's, 012 FR-008) steps or resets, and
    the app-wide zoom does not change.
    **When** they press plain Ctrl+0, Ctrl++ or Ctrl+-, **Then** nothing is zoomed. (FR-102, FR-106)
15. **Given** the cog menu is open, **When** the user uses its Zoom row, **Then** Zoom In, Zoom Out
    and Reset change the app-wide zoom exactly as their chords do, and each control's hover title
    shows its chord. (FR-107)
16. **Given** a German, French or Polish keyboard layout and focus in a terminal, **When** the user
    presses Ctrl+Shift+Alt+PageDown, Ctrl+Shift+Alt+F or Ctrl+Shift+Alt+0, **Then** the next project
    is active, the File Explorer is focused, or the app-wide zoom is reset, and the shell receives
    nothing. (FR-102, FR-104)

---

### User Story 4 - A right-click menu on a project, with Unload (Priority: P2)

A user right-clicks a project in the list and gets Edit, Rename, Remove and Unload. The first three
do exactly what the inline controls and double-click already do. Unload puts a project away for the
rest of the session without forgetting anything: its tabs and panels close, and the row returns to
the unloaded style. The next time the user selects it, it opens with the saved layout.

**Why this priority**: Unload is a new ability, and today the only way to release a project's
panels and terminals is to quit the app or remove the project. The menu also makes existing actions
discoverable.

**Independent Test**: Open two projects, right-click the non-active one and choose Unload. Its row
turns greyed and italic. Select it and its previous layout comes back.

**Acceptance Scenarios**:

1. **Given** a project row, **When** the user right-clicks it, **Then** a menu opens offering Edit,
   Rename, Remove and Unload. **When** they press Shift+F10 or the context-menu key on a focused row,
   **Then** the same menu opens.
2. **Given** the menu is open, **When** the user chooses Edit, Rename or Remove, **Then** the result
   is the same as the inline Edit button, a double-click on the name, or the inline Remove button.
   Remove keeps its confirmation and its unsaved-editor guard.
3. **Given** a loaded project with an unsaved editor, **When** the user chooses Unload, **Then** the
   same unsaved-editor prompt that Remove shows appears first. Cancelling it leaves the project loaded
   and unchanged.
4. **Given** the active project, **When** the user unloads it, **Then** no project is active and the
   workspace shows its no-project state.
5. **Given** an unloaded project, **When** the user selects it, **Then** it opens with the layout it
   had when it was unloaded.
6. **Given** a project that is already unloaded, **When** the user opens its menu, **Then** Unload is
   shown disabled.
7. **Given** shipped defaults and a project whose terminal is running a build, **When** the user
   chooses Unload, **Then** a dialog names the build and offers Keep running (focused), End terminals
   and Cancel. **When** they choose Keep running, **Then** the project unloads, the build keeps
   running, and the terminal shows it still running when the project is loaded again.
8. **Given** the same, **When** the user chooses End terminals, **Then** a second confirmation
   appears, and only after they confirm it do the terminals end and the project unload.
9. **Given** the unload confirmation set to None in Preferences, **When** the user unloads a project
    with a running process, **Then** no dialog appears and the default terminal action applies.
10. **Given** the menu is open, **When** the user presses Escape, **Then** it closes and focus returns
    to the row.

*Scenarios 7–9 superseded by FR-081, FR-085 and FR-086 (Session 2026-09-23, iterate round 1). No
Unload row asks which action to take, and Keep Terminals Running keeps idle shells as well. Scenario
1's "Unload" is the plain **Unload Project** row, with the opposite-action row beside it (FR-081).*

11. **Given** shipped defaults (`keepRunning`), **When** the user opens a loaded project's menu,
    **Then** it offers exactly two Unload rows: **Unload Project** and **Unload Project and End
    Terminals**. With the preference set to `endTerminals`, the rows are **Unload Project** and
    **Unload Project and Keep Terminals Running**. (FR-081)
12. **Given** a project with one terminal running a build and one idle shell, **When** the user
    chooses the row that keeps terminals running, **Then** no dialog appears, the project unloads,
    and on the next load both terminals reattach: the build is still running and the idle shell is
    the same process, with its scrollback. (FR-085, FR-086)
13. **Given** shipped defaults and a project whose terminal is running a build, **When** the user
    chooses **Unload Project and End Terminals**, **Then** no choice dialog appears. The
    `confirmations.unloadProject` confirmation (two steps at `double`) names the build, and only after
    it is confirmed do the terminals end and the project unload. (FR-085)
14. **Given** a project with only idle shells, **When** the user chooses the row that ends
    terminals, **Then** no dialog appears, and the shells end and the project unloads. (FR-085)

*Scenario 13 superseded by FR-111 (iterate round 1 checkpoint, 2026-09-24): no Unload row prompts.*

15. **Given** shipped defaults and a project whose terminal is running a build, **When** the user
    chooses **Unload Project and End Terminals**, **Then** no dialog of any kind appears: the build
    and every other terminal of the project end, and the project unloads. (FR-111)
16. **Given** the preference set to `endTerminals` and a running build, **When** the user chooses
    **Unload Project**, **Then** the same happens with no dialog. **When** they choose **Unload
    Project and Keep Terminals Running** instead, **Then** no dialog appears and the build keeps
    running. (FR-111)
17. **Given** a project with an unsaved editor, **When** the user chooses either Unload row, **Then**
    the unsaved-editor prompt appears first, as Remove's does, and nothing else asks. (FR-035,
    FR-111)

---

### User Story 5 - Put projects away in categories (Priority: P2)

A user with a long project list puts stale projects into a category such as "Parked" and minimises
it. The category collapses to one row with its name and a count, and its projects are no longer
listed or reachable by a stray click. Nothing about those projects is lost. Expanding the category
brings them back exactly as they were.

**Why this priority**: A project list that only grows gets harder to read over time. This is the
first grouping of any kind in the list.

**Independent Test**: Create a category, move two projects into it, minimise it and restart. The
category is still minimised and shows "2". Expand it and both projects are there with their colours
and layouts.

**Acceptance Scenarios**:

1. **Given** a database written before this feature, **When** the new build starts, **Then** every
   project appears in the default category "In Progress", in its existing order, with no user action.
2. **Given** a project row, **When** the user moves it to another category through its context menu,
   **Then** it appears in that category and stays there after a restart.
3. **Given** a category other than the default, **When** the user minimises it, **Then** its projects
   are hidden, the header shows the name and the number of projects, and clicking the header expands
   it.
4. **Given** the default category, **When** the user looks for a way to minimise it, **Then** there
   is none, in any menu or control.
5. **Given** a category holding projects, **When** the user deletes it, **Then** its projects move to
   the default category and nothing else about them changes.
6. **Given** the active project sits in a category, **When** the user minimises that category,
   **Then** the active project's row stays visible under the collapsed header.
7. **Given** two categories, **When** the user drags a project from one and drops it between two
   projects of the other, **Then** the project moves into the second category at that position.
8. **Given** a newly created project, **When** it is added, **Then** it lands in the default
   category.
9. **Given** any category, **When** the user looks at its header row, **Then** it has a highlighted
   background from the theme, and its name is bold and uppercase. (FR-072)
10. **Given** three categories, **When** the user drags the third category's header above the
    second, or chooses **Move Category Up** from its header menu, **Then** the order changes and is
    the same after a restart. (FR-083, FR-084)
11. **Given** the default category, **When** the user looks for a way to move it, or drags another
    category above it, **Then** there is none, and it stays first. (FR-083)
12. **Given** a project row, **When** the user presses on its name, its colour swatch or the empty
    part of the row and drags, **Then** the row moves exactly as a drag on the grip does. A press on
    Edit or Remove does not start a drag. (FR-075)
13. **Given** the File Explorer or the Projects pane holds the active pane, **When** the user looks
    at its outline, **Then** the outline is as thin as the pane's ordinary border and differs only in
    colour. (FR-073)

### Edge Cases

- **One project, or none.** With a project active, `project.next` and `project.previous` do nothing
  and raise no notice. *(recorded at implementation, analysis I2b: "with a project active" per
  FR-011's Recorded note; with no project active, one reachable project is stepped to.)*
  `focus.projects` with no projects focuses the pane's empty state or its create control. It never
  focuses nothing.
- **Every other project is in a minimised category.** The cycle commands have no reachable
  neighbour, so they do nothing and raise no notice.
- **The active project is in a minimised category** and the user presses next. The cycle moves to
  the next reachable project in list order, and the previously active row disappears under its
  collapsed header.
- **Unload while a sub-workspace window holds that project's panels.** The sub-workspace's panels are
  untouched. Unload acts on the main window's project workspace only (Principle XI keeps panels
  whose project is absent).
- **Unload while a terminal of the project is running a process.** With the shipped defaults, a
  dialog offers Keep running (focused), End terminals and Cancel, and End terminals asks once more
  (FR-034c). With confirmations set to `none`, the default terminal action applies silently.
  *Superseded by FR-085 (iterate round 1): no dialog offers a choice. Keeping terminals running
  never prompts. Ending them confirms per `confirmations.unloadProject` while a process is running.*
  *Superseded again by FR-111 (iterate round 1 checkpoint, 2026-09-24): ending them does not prompt
  either.*
- **Unload with only idle shells.** No terminal dialog. The shells close and are re-created on the
  next load.
  *Superseded by FR-086 (iterate round 1): when terminals are kept running, idle shells are kept and
  reattached, not re-created. When they are ended, they end with no prompt (FR-085).*
- **A process exits while the dialog is open.** The chosen action applies to whatever is still
  running when the user answers. A terminal that has gone idle is closed like any idle shell.
  *Narrowed by FR-085 (iterate round 1): the only dialog left is End Terminals' confirmation.
  Confirming it ends every terminal of the project, whether it is still running or has gone idle.*
  *Moot under FR-111 (iterate round 1 checkpoint): no Unload dialog remains.*
- **Unload keeping terminals, then delete the project** *(iterate round 1)*. The kept terminals,
  idle ones included, end with the project, as for any project deletion (Principle III).
- **Unload keeping terminals, then close the app** *(iterate round 1)*. Kept terminals follow the
  app-close rule: a running process triggers the three-choice app-close warning, and a kept idle
  shell is closed like any idle shell, because the app-close rule is not part of v5.6.0's exception.
  *(derived; not confirmed by the maintainer)*
  *(T153, 2026-09-25: the requirement stands, but the shipped behaviour differs: the app-close
  prompt appears for idle shells too, and Leave running keeps them. A pre-existing gap; not filed —
  unreproduced; recorded in PR #440's description for the maintainer to reproduce and file; see
  FR-086.)*
- **Reordering categories when only the default exists** *(iterate round 1)*. There is nothing to
  move. Move Category Up / Down are not drawn on the default category's menu, because nothing could
  ever enable them there. On the second category, Move Category Up is drawn but disabled (Principle
  VI).
- **A chord upgrade meets a user rebinding** *(iterate round 1)*. A saved binding that differs from
  every shipped default it could have come from is left exactly as saved (FR-079), even when it now
  breaks the convention. The convention governs shipped defaults only.
- **AltGr layouts and the global family** *(iterate round 1)*. On Windows, Ctrl+Alt is AltGr. On a
  layout where a remapped Ctrl+Alt key produces a character (German AltGr+0 `}`, French AltGr+= `}`,
  Polish AltGr+S `ś`), the character is typed and the chord does not fire. research.md R15 lists
  each case. The bare-Ctrl routes (Ctrl+0, Ctrl+=, Ctrl+-) keep the app-wide zoom reachable there.
  *Re-read under FR-095 (second review, 2026-09-24):* no global command stays on Ctrl+Alt, so the
  AltGr losses are now the panel zoom's alone: German Ctrl+Alt+0 and French Ctrl+Alt+= / - have
  been unreachable since 012 and still are. The window zoom is unaffected. The new navigation chords
  are Ctrl+Shift, which carries no AltGr risk.
  *Re-read under FR-102 / FR-104 (iterate round 1 checkpoint, 2026-09-24):* navigation and the window
  zoom are Ctrl+Shift+Alt, matched on the physical key, so they fire on every layout. The panel
  zoom's main-row losses stand (German Ctrl+Alt+0, French Ctrl+Alt+= / -), but the keypad `+`, `-`
  and `0` now reach it there, because the keypad has no AltGr characters (FR-105). The trade flips
  for tier 1: a produced-character Ctrl+Alt chord lost the chord on an AltGr layout, while a
  physical Ctrl+Shift+Alt chord keeps the chord and can take an AltGr+Shift character (below).
- **A tier-1 letter on a non-QWERTY layout** *(iterate round 1 checkpoint; derived)*. Physical
  matching binds the key in the US-QWERTY position of the letter. On French AZERTY, `KeyM` is the key
  labelled `,`, so Ctrl+Shift+Alt+M (`focus.notice`) is pressed on that key. German QWERTZ moves no
  bound letter (only Y and Z swap). The Key Bindings editor shows the token as written; whether it
  should show the local key label instead is a question for the maintainer (research.md R22).
  *Re-read under FR-117 (iterate round 3, 2026-09-25):* M now belongs to `focus.explorer`, and
  `focus.notice` is on V, which AZERTY does not move. See "Letters on AZERTY under FR-117" below.
- **The `+` and `-` keys under physical matching** *(iterate round 1 checkpoint; derived)*. Tier 1
  matches `+` on the `Equal` key and the keypad, `-` on `Minus` and the keypad, `0` on `Digit0` and
  the keypad. On US and UK those main-row keys carry `+` and `-`; on French the `Equal` key carries
  `+`, but `-` is on the 6 key. On German, Nordic, Spanish and Italian they are simply the keys in
  the same position (German `´` and `ß`), so a dedicated `+` or `-` key elsewhere does not fire a
  tier-1 chord; the keypad always does (research.md R22).
- **Ctrl+Alt++ on a US or UK keyboard without a keypad** *(iterate round 1 checkpoint; derived)*. The
  `+` there needs Shift, and Ctrl+Alt with Shift is tier 1, so Ctrl+Alt+Shift+= would be the window
  zoom. The panel zoom-in is therefore pressed as Ctrl+Alt with the `=`/`+` key and **no Shift**,
  which FR-105 matches as `Ctrl+Alt++`. It is one binding and one key; nothing is typed.
- **AltGr+Shift characters on a tier-1 key** *(iterate round 1 checkpoint; derived)*. Polish
  (programmer's) AltGr+Shift+N types `Ń`. While `view.toggleExplorer` holds Ctrl+Shift+Alt+N, a
  physical match takes that press unless the renderer can tell right-hand AltGr from left
  Ctrl+Alt (a **hypothesis**, research.md R22). FR-104 names the loss and the test that settles it.
  *Re-read under FR-117 (iterate round 3, 2026-09-25):* Ctrl+Shift+Alt+N now belongs to
  `focus.workspace`, not `view.toggleExplorer`. The loss is the same `Ń` on the same key. Freeing P
  gives US-International `Ö` back. J, K and V add no loss on the seven layouts (research R22,
  iterate-round-3 check).
- **`focus.workspace` with nothing to focus** *(iterate round 3; derived)*. With no active project,
  no tab, or a tab with no panel, Ctrl+Shift+Alt+N does nothing and raises no notice. The active pane
  stays where it was, the same as FR-011 at the end of the list. When the workspace already holds the
  active pane, the chord puts keyboard focus back into the active panel's input, which recovers a
  caret lost to a notice or a click on the title bar (FR-116).
- **A new action filled onto a chord the user still holds** *(iterate round 3; derived)*.
  `parseKeybindings` fills an absent action from the shipped defaults on every read, with no
  collision check. On an install whose `view.toggleExplorer` was customised and still contains
  Ctrl+Shift+Alt+N, that fill would give `focus.workspace` the same chord. FR-118 prevents it.
- **Letters on AZERTY under FR-117** *(iterate round 3; derived)*. B, N, J, K and V are in the same
  place on AZERTY and QWERTZ. `KeyM` is the key labelled `,` on AZERTY, so `focus.explorer` is
  pressed there. The row still reads left to right, because physical matching keeps the positions
  even where a label differs.
- **A directional chord from a side pane** *(iterate round 4; derived)*. Consumed and does nothing:
  no panel is selected, no notice, and the tree or list does not receive it (FR-122).
- **Switching project while a side pane is active** *(iterate round 4; derived)*. The new project's
  tab has an active panel, but it is not outlined until the workspace holds the active pane
  (FR-121, SC-012).
- **Ctrl released and pressed again between the strokes** *(iterate round 4; derived)*. The second
  stroke counts Ctrl, so it reads `Ctrl+W`, which completes a `Ctrl+E Ctrl+W` binding if one is
  saved and otherwise reports the combination as not bound (FR-123). *Superseded by FR-124 (round
  5): releasing Ctrl ends the prefix, so the Ctrl pressed again starts a fresh chord.*
- **Releasing the modifiers between the two keys** *(iterate round 5; derived)*. The pending prefix
  ends at the release, silently; the next key does what it does with no prefix (FR-124).
- **A panel with no focusable control** *(iterate round 5; derived)*. It makes its own container
  focusable, so a keyboard route still takes the caret out of the panel it left (FR-125).
- **Unload with a running process, ending terminals** *(iterate round 1 checkpoint)*. No dialog. The
  processes end with the project's other terminals (FR-111).
- **Remove on a project in a minimised category** behaves exactly as Remove anywhere else.
- **Renaming a category to an existing name.** Refused inline, the same way a duplicate project name
  is treated.
- **Deleting the only non-default category while it is minimised.** Its projects move to the default
  category and are listed, because the default category is never minimised.
- **Non-US layouts.** Ctrl+Shift+0 is matched on the physical key in the digit row, so it works
  wherever that key is, whatever character it produces. On layouts where Ctrl+Alt is AltGr,
  Ctrl+Alt+letter chords can produce a character. FR-021 covers this.
  *Re-read under FR-104 (iterate round 1 checkpoint):* no default uses Ctrl+Shift+0 any more; the
  whole Ctrl+Shift+Alt family is matched physically, and the layout cases are the edge cases above.
- **A user who rebound `zoom.reset`** keeps exactly their binding; an untouched one gains Ctrl+Shift+0
  through the guarded upgrade FR-025's Recorded note states, not by 026 FR-030's leave-alone rule
  (refined at implementation).
  *Superseded by FR-079 (iterate round 1): an untouched `zoom.reset` now moves to Ctrl+Alt+0 (from
  the version-11 or version-12 default), under the same guard.*
  *Superseded again by FR-108 (iterate round 1 checkpoint, 2026-09-24): an untouched `zoom.reset`
  moves to Ctrl+Shift+Alt+0, under the same guard. A rebound one is left exactly as saved.*

## Requirements *(mandatory)*

### Functional Requirements

#### File Explorer naming (#331)

- **FR-001**: Every user-visible string that names the right-hand file tree MUST call it **File
  Explorer**. That covers the pane header, the pane rail label and its show/hide tooltip, the panel
  header menu item (**Reveal File in File Explorer**), the empty-editor placeholder, the descriptions
  of `view.toggleExplorer`, `panes.fileExplorer.maxWidth`, `explorer.autoRevealActiveFile` (corrected
  at implementation: the setting is `explorer.autoRevealActiveFile`, not `explorer.followActiveEditor`,
  which does not exist) and every other setting or keybinding description that names the pane, the
  theme-token descriptions, and the user docs (`README.md`, `CONTRIBUTING.md`, `docs/quick-start.md`,
  `docs/testing.md`).
- **FR-002**: No user-visible string or doc may contain "Files & Folders", "Files &amp; Folders" or
  "Files and Folders". A test MUST enforce this over the shipped sources and docs.
- **FR-003**: The rename MUST be copy only. No setting key, command id, keybinding, CSS class,
  `data-testid` or persisted identifier may change, and a config directory written by the previous
  build MUST load with no migration and no warning.
- **FR-004**: Shipped `specs/*/` files, the constitution and bridge snapshots MUST NOT be rewritten.
  They record what was decided at the time. This spec records the supersession of their user-visible
  wording (S1).
  - *(recorded at implementation, analysis I3b):* FR-002's guard also exempts `CHANGELOG.md` (a
    release record, whose #331 line names the old title on purpose) and every `packages/*/tests`
    tree (test prose is not a user-visible string), as `file-explorer-name.test.ts` states. A doc
    that quotes a test title, such as `docs/testing.md`'s tables, quotes the renamed title, never the
    old name.

#### Project cycling and side-pane focus (#332)

- **FR-010**: Four new commands MUST exist: **`project.next`** and **`project.previous`** (switch to
  the next or previous project in list order), **`focus.explorer`** (move keyboard focus to the File
  Explorer tree), and **`focus.projects`** (move keyboard focus to the Projects pane list). All four
  are live in every scope, including a focused terminal. A chord bound to one of them MUST NOT also
  reach the shell or the editor.
  *Extended by FR-116 (iterate round 3, 2026-09-25): a fifth command, `focus.workspace`, follows
  the same rules.*
- **FR-011**: `project.next` and `project.previous` MUST stop at the ends of the list and not wrap.
  At an end, and with zero or one reachable project, they MUST do nothing and raise no notice.
  - *Recorded 2026-09-23 (plan R5, analysis I1):* the zero-or-one clause governs when a project is
    active. With **no** active project, `project.next` goes to the first reachable project and
    `project.previous` to the last. That includes the case of exactly one reachable project.
- **FR-012**: The cycle commands MUST step only through reachable projects: those listed and not
  hidden by a minimised category (FR-051). Projects in a minimised category are skipped. The active
  project's own row counts as the starting point even when its category is minimised (FR-052).
- **FR-013**: The cycle commands MUST work whether or not the Projects pane is visible, and MUST NOT
  change its visibility. The switch MUST be visible in the title bar and status bar, as a click
  switch is.
- **FR-014**: A switch made by a cycle command MUST be the same switch a click makes. It follows the
  same failure handling, the same lazy load, and the same rules for terminals and dirty editors.
- **FR-015**: The Projects pane MUST become a focus target in the app's focus model, alongside the
  File Explorer and the workspace. When it has focus, the active-pane outline MUST surround it, and
  the keyboard scope MUST be one in which no text-editing command is live.
  - *(recorded at implementation, analysis A1b; T034/T040):* the focus target is the Projects
    panel's project list (the tree), not the whole sidebar. See the Terminology note on side panes.
  - *Refined by FR-073 and FR-082 (Session 2026-09-23, iterate round 1):* the outline is as thin as
    the pane's default border, and choosing a project from the list keeps this pane active.
- **FR-016**: `focus.explorer` and `focus.projects` MUST reveal their pane if it is hidden, then focus
  it. The reveal is the same state change the pane's show control makes, so it persists the same way.
- **FR-017**: `focus.explorer` MUST land on the tree with its current selection live, so that `file.*`
  commands (F2 rename, cut, copy, paste, delete, undo, redo) act on it with no click in between. With
  no selection, it lands on the first entry.
- **FR-018**: `focus.projects` MUST land on the **active** project's row, or on the first listed row
  when no project is active. Within the focused list, ArrowUp and ArrowDown MUST move the selection
  one row at a time, Home and End MUST go to the first and last row, and Enter MUST switch to the
  selected project. Category header rows are part of this list: Enter or Space on a header toggles
  minimise, except on the default category. Moving the selection alone never switches project.
  *Refined by FR-082 (Session 2026-09-23, iterate round 1): Enter switches project and the Projects
  pane stays the active pane.*
- **FR-019**: Each of the four commands MUST have a menu route (Principle VI). The title-bar cog menu
  gains a **Navigate** section listing Next Project, Previous Project, Focus File Explorer and Focus
  Projects, each showing its current chord. Next and Previous MUST be disabled when they would do
  nothing (Principle VI: disabled when unavailable).
  *Superseded by FR-074 (Session 2026-09-23, iterate round 1). Constitution v5.6.0 Principle VI lets
  a non-panel command stand on its chord alone, and the maintainer asked for the Navigate section to
  be removed.*
- **FR-020**: The shipped default chords are **Ctrl+Alt+PageDown** (`project.next`),
  **Ctrl+Alt+PageUp** (`project.previous`), **Ctrl+Alt+F** (`focus.explorer`; ~~Ctrl+Alt+E~~,
  superseded under FR-021) and **Ctrl+Alt+P** (`focus.projects`). None of them may be in the reserved or shadowable tier. The recorded-exception
  list MUST stay at four entries, and a unit test MUST assert both.
  *Superseded in part by FR-077 (Session 2026-09-23, iterate round 1): `focus.explorer` moves to
  **Ctrl+Alt+D**, so that Find in Files can take Ctrl+Alt+F. The recorded-exception list is now five,
  with `Ctrl+Shift+-` added by constitution v5.6.0. The other three chords are unchanged.*
  *That move is itself superseded by FR-089 (same session, after the maintainer's review):
  `focus.explorer` stays on **Ctrl+Alt+F**, because Find in Files keeps Ctrl+Shift+F. The
  terminal-tier exception list stays at five.*
  *All four chords superseded by FR-095 (second review, 2026-09-24): `project.next` / `previous`
  are Ctrl+Shift+] / [, `focus.explorer` Ctrl+Shift+E, and `focus.projects` Ctrl+Shift+P. The
  terminal-tier exception list is back to **four**, because `Ctrl+Shift+-` was withdrawn. FR-021's
  line-editor check for the new chords is in research.md R21: xterm sends no bytes for Ctrl+Shift
  with a letter or a bracket.*
  *All four chords superseded again by FR-102 (iterate round 1 checkpoint, 2026-09-24):
  `project.next` / `previous` are **Ctrl+Shift+Alt+PageDown / PageUp**, `focus.explorer`
  **Ctrl+Shift+Alt+F** and `focus.projects` **Ctrl+Shift+Alt+P**. The terminal-tier exception list
  stays at four. FR-021's check for them is research.md R22.*
  *`focus.explorer` and `focus.projects` superseded again by FR-117 (iterate round 3, 2026-09-25):
  `focus.explorer` **Ctrl+Shift+Alt+M**, `focus.projects` **Ctrl+Shift+Alt+B**. `project.next` /
  `previous` are unchanged.*
- **FR-021**: Before any default chord ships, it MUST be shown to carry no meaning in any hosted
  shell flavour's line editor (Principle IV's "any flavour" test). That includes, for example, bash
  readline's Meta-Ctrl bindings, which Ctrl+Alt+letter may arrive as. The chord must also not
  collide on AltGr layouts in a way that stops a character being typed. A chord that fails this test
  MUST be replaced by a free `Ctrl+Alt` chord, and the replacement is recorded in this spec.
  - *Recorded 2026-09-23 (plan R1):* **Ctrl+Alt+E fails** because bash readline binds Meta-Ctrl-E to
    `shell-expand-line`, and it is AltGr+E (€, ę) on most European layouts. `focus.explorer` ships
    **Ctrl+Alt+F** instead. Ctrl+Alt+PageDown, Ctrl+Alt+PageUp and Ctrl+Alt+P pass.
  - *Recorded 2026-09-23 (recorded at implementation; live O3 check, `bind -p` in Git Bash):*
    readline binds `"\e\C-f"` to `shell-forward-word` (R1 had it unbound) and `"\e\C-e"` to
    `shell-expand-line`; nothing is bound on `"\e\C-p"`, `CSI 5;7~` or `CSI 6;7~`. **Ctrl+Alt+F is
    kept**: on Windows, xterm.js treats Ctrl+Alt+letter as AltGr (third-level shift) and never sends
    `ESC ^F`, and the window listener captures the chord before xterm in any case, so no user loses
    `shell-forward-word` to it (Esc then Ctrl+F still reaches it). Ctrl+Alt+E stays rejected, now on
    the AltGr € collision alone. research.md R1 is corrected to match.
  - *Read with FR-104 (iterate round 1 checkpoint, 2026-09-24):* "replaced by a free `Ctrl+Alt`
    chord" dates from the Ctrl+Alt navigation family. A failing tier-1 chord is replaced by a free
    `Ctrl+Shift+Alt` chord. The check itself stands, and research.md R22 applies it to every
    Ctrl+Shift+Alt default.
- **FR-022**: All four commands MUST appear in the keybindings editor with a label and description,
  in the group that holds the other side-pane commands. Rebinding MUST take effect without a restart.
  No existing binding may change meaning, and no chord may resolve to two commands in one scope.
  *Superseded in part by FR-087 (group for `focus.explorer` / `focus.projects`) and FR-077 ("no
  existing binding may change meaning" gives way to the convention remap, which moves shipped
  defaults deliberately; no chord still resolves to two commands in one scope) (Session 2026-09-23,
  iterate round 1).*
- **FR-023**: A keybindings file already saved by the user MUST NOT be rewritten. The new commands
  take their shipped defaults alongside it (026 FR-030).
- **FR-024**: `focus.left`, `focus.right`, `focus.up`, `focus.down` and `focus.cycle` MUST keep their
  current behaviour. They move between panels in the active tab and never reach a side pane.
  *Still binding under FR-116 (iterate round 3, 2026-09-25):* none of the five changes. The route
  back from a side pane is a new command, `focus.workspace`. None of the five is widened to reach the
  workspace from outside it.
  *Extended by FR-122 (iterate round 4, 2026-09-26):* the four directional commands act only while
  the workspace holds the active pane.
- **FR-073** *(Session 2026-09-23, iterate round 1)*: When the File Explorer or the Projects pane
  holds the active pane, its active outline MUST be exactly as wide as that pane's default border.
  Only the colour marks it active: the project colour, or the `activePanelBorder` token with no
  project (021 FR-048, unchanged). The workspace panels' active outline is not changed by this FR.
  *Extended by FR-121 (iterate round 4, 2026-09-26):* while a side pane holds the active pane, its
  outline is the only active indication; no workspace panel is outlined.
- **FR-074** *(Session 2026-09-23, iterate round 1; supersedes FR-019 and FR-070's menu clause)*:
  The title-bar cog menu MUST NOT carry a Navigate section or any of `project.next`,
  `project.previous`, `focus.explorer` or `focus.projects`. It returns to the single Application
  section it had before this feature. The four commands MUST be reachable by their chords and MUST
  stay listed, with label and description, in the Key Bindings editor. This is the constitution
  v5.6.0 Principle VI rule "A chord MAY stand without a menu item": none of the four acts on a Panel
  or its content. No other menu gains them.
  *"It returns to the single Application section" superseded by FR-107 (iterate round 1 checkpoint,
  2026-09-24): the cog menu gains a View & state section holding the window Zoom row. The rest of
  this FR stands: no Navigate section, and none of the four commands in any menu.*
  *Extended by FR-116 (iterate round 3, 2026-09-25): `focus.workspace` falls under the same rule.
  It has no menu item in any menu, and it is listed in the Key Bindings editor with a label and a
  description.*
- **FR-082** *(Session 2026-09-23, iterate round 1)*: Switching project from the Projects pane list —
  a click on a row, or Enter on the selected row (FR-018) — MUST leave the **Projects pane as the
  active pane**, with its outline and its keyboard scope (`projects`), and focus MUST stay on the
  project list, on the chosen row. The workspace MUST become the active pane only when the user moves
  into it: a click or pointer-down in it, a `focus.*` chord, or any other route that already makes it
  active. This supersedes, **for list-initiated switches only**, the US2 fix-round behaviour (commit
  `52d8f13d`, `PanelFocusSync` calling `setActivePane('workspace')` on every active-tab change), which
  made the outline flash around the Projects pane and move to the workspace. A switch made by
  `project.next` / `project.previous` MUST leave the active pane where it was before the chord *(derived;
  not confirmed by the maintainer)*. When the active pane stays on the workspace, the Ctrl+S defect
  that `52d8f13d` fixed must stay fixed: a chord in the new project's editor still reaches it.
  *This also supersedes 023 FR-030 (#144, asserted by `editor-caret-persist.e2e.ts:173`) for a
  list-initiated switch only: the editor MUST NOT take keyboard focus when the switch is a click or
  Enter on a Projects-pane row. FR-030/#144 stands for every other route — a tab switch, a panel
  switch, and a `project.next` / `project.previous` switch made from the workspace. See Supersession
  S26.*
- **FR-087** *(Session 2026-09-23, iterate round 1; supersedes FR-022's group clause for these two)*:
  `focus.explorer` and `focus.projects` MUST be listed in the Key Bindings editor's **Focus & Zoom**
  group, beside the other `focus.*` commands. `project.next` and `project.previous` stay in **View**.
  *Extended by FR-116 (iterate round 3, 2026-09-25): `focus.workspace` joins them in **Focus &
  Zoom**.*

#### Reset zoom with Shift held (#390)

- **FR-025**: `zoom.reset` MUST ship **Ctrl+Shift+0** as an additional default chord, alongside
  Ctrl+0 and Ctrl+MiddleClick, which are unchanged. Per-panel `Ctrl+Alt+0` is unchanged too.
  - *Recorded 2026-09-23 (controller ruling, US3 upgrade-path defect):* `seed()` writes `zoom.reset`
    into every install's `keybindings.json` at first run, so it is never MISSING and the per-read
    fill (026 FR-030) never reaches it — an existing install's Ctrl+Shift+0 would otherwise do
    nothing forever. This narrows the Edge Case below, which cites 026 FR-030's leave-alone rule:
    the version-12 upgrade instead rewrites a saved `zoom.reset` to the new default, but ONLY when
    it still exactly equals (order-insensitive) the previous shipped pair `[Ctrl+0,
    Ctrl+MiddleClick]` — the same guarded-rewrite evidence 043 FR-074/FR-075 already uses for
    settings. Any other saved value is left untouched.
  - *Recorded 2026-09-23 (review finding, collision guard):* FR-026's physical-first matching means
    the upgrade above MUST also refuse when another action already binds `Ctrl+Shift+0` or
    `Ctrl+Shift+)` — the physical token and the pre-046 US/UK produced token for the same key —
    since adding it to `zoom.reset` would otherwise let `resolveKeydown`'s physical-first candidate
    silently steal that key from whichever action already held it, with no conflict visible in
    Preferences (the saved strings differ). Chosen conservatively: only these two tokens, not every
    layout's Shift+0 character, because a miss here costs a user the new chord rather than an
    existing one; a differently-symboled layout's collision is a decision for when it is reported,
    not a table this feature exists to avoid building.
  - *Superseded by FR-077, FR-079 and FR-080 (Session 2026-09-23, iterate round 1).* Under
    constitution v5.6.0's modifier convention, `zoom.reset` ships **Ctrl+0, Ctrl+Alt+0,
    Ctrl+MiddleClick**, and Ctrl+Shift+0 belongs to `panel.zoomReset`. #390's request, "Ctrl+Shift+0
    resets the app-wide zoom", is read under the new convention as "a two-modifier reset for the
    app-wide zoom", which is Ctrl+Alt+0. The version-12 upgrade above and its collision guard stay as
    history. FR-079 states the upgrade that replaces it.
  - *Superseded again by FR-102 and FR-107 (iterate round 1 checkpoint, 2026-09-24): Ctrl+Shift+0 is
    retired. The app-wide reset is **Ctrl+Shift+Alt+0** and the cog menu's Zoom row. #390 closes on
    that, and its close text MUST say so.*
- **FR-026**: A chord on a digit-row key MUST be matched on the physical key, the same way the
  backtick already is, so that Ctrl+Shift+0 matches whatever character the layout produces for it.
  Chords that match on a produced character today MUST keep matching, including Ctrl++ and Ctrl+=
  for zoom in and Ctrl+- for zoom out.
  - *Recorded 2026-09-23 (plan R2, controller ruling closing research O2):* "a chord on a digit-row
    key" means **`Digit0`–`Digit9` with Ctrl held and Alt not held**. Ctrl+Alt+digit and the Minus
    and Equal keys keep matching on the produced character, so that no AltGr layout loses a
    character (FR-021).
  - *Extended, and superseded in part, by FR-078 (Session 2026-09-23, iterate round 1):* the Minus
    and Equal keys with **Ctrl and Shift held and Alt not held** now also match on the physical key.
    FR-026's "Ctrl++ ... for zoom in MUST keep matching" still holds for a `+` produced without Shift
    (the numpad, or a German `+` key). On US and UK layouts, though, Ctrl+Shift+= now resolves to
    `panel.zoomIn` rather than `zoom.in`.
  - *Extended by FR-104 (iterate round 1 checkpoint, 2026-09-24):* the physical digit rule stays for
    Ctrl without Alt, and every chord with Ctrl, Shift and Alt all held is matched physically too.
    "Ctrl++ and Ctrl+= for zoom in" no longer ship; plain Ctrl++ / Ctrl+- / Ctrl+0 are unbound
    (FR-102).
- **FR-027**: Ctrl+Shift+0 MUST reset zoom in every scope where `zoom.reset` is live today, which is
  everywhere, including a focused editor, a terminal and a find input. It MUST NOT reach the shell or
  the editor as input.
  *Superseded in part by FR-077 / FR-080 (Session 2026-09-23, iterate round 1): Ctrl+Shift+0 now
  resets the active panel's zoom (`panel.zoomReset`, also live everywhere), and Ctrl+Alt+0 resets the
  app-wide zoom. The "everywhere, and never reaches the shell or the editor" clause applies to both.*
  *Both chords superseded by FR-099 (second review, 2026-09-24): no chord uses Ctrl+Shift+0. The
  app-wide reset is Ctrl+0 and the panel reset Ctrl+Alt+0. The "everywhere" clause applies to
  both.*
  *Chords superseded again by FR-102 (iterate round 1 checkpoint, 2026-09-24): the app-wide reset is
  Ctrl+Shift+Alt+0, the panel reset Ctrl+Alt+0. The "everywhere, never reaches the shell or the
  editor" clause applies to both.*

#### Modifier convention and the chord remap (Session 2026-09-23, iterate round 1)

- **FR-076**: Every shipped default chord MUST follow constitution v5.6.0 Principle IV's modifier
  families. **Ctrl+Shift+<key>** is only for a command that acts on the active panel or pane.
  **Ctrl+Alt+<key>** is only for a global command: one that acts on the application, the window, the
  workspace layout or the project, or that moves the user between surfaces. The principle's
  carve-outs apply: bare-Ctrl chords, Alt-only and Shift+Alt chords, function keys, and a Shift that
  only reverses a pair's direction (`focus.cycle` / `focus.cycleBack`). A unit test MUST classify
  every `ActionId` as panel-or-pane or global, and MUST fail when a shipped default puts a global
  command on Ctrl+Shift or a panel-or-pane command on Ctrl+Alt. A new `ActionId` with no
  classification MUST also fail it. The completeness guarantee is the same one `COMMAND_SCOPES`
  gives.
  *Read with FR-089:* the guard carries the five recorded convention exceptions as an explicit,
  exhaustive list, mirroring constitution IV. An unlisted violation still fails it. A multi-stroke
  chord (FR-091) is outside both families.
  *Superseded by FR-094 (second review, 2026-09-24): the maintainer replaced the two families with
  three tiers.*
- **FR-077**: The Windows shipped defaults MUST change as the table below states, and no other
  default may change. Every chord in the **Proposed** column MUST be absent from the reserved tier.
  It MUST collide with no other command in any scope that command is live in (the scope-aware
  collision rule). It MUST pass FR-021's check against any hosted flavour's line editor, recorded in
  research.md R15. The one shadowable chord, `Ctrl+Shift+-`, is recorded as an exception in
  constitution v5.6.0 Principle IV. Each command keeps one chord across panel types (Principle IV).

  | Command | Acts on | Current default | Proposed default | Reason |
  |---|---|---|---|---|
  | `zoom.in` | global | Ctrl+=, Ctrl++, Ctrl+WheelUp | Ctrl+=, Ctrl++, **Ctrl+Alt+=**, **Ctrl+Alt++**, Ctrl+WheelUp | Gains the global family's route (taken from `panel.zoomIn`). Browser-convention bare-Ctrl chords kept |
  | `zoom.out` | global | Ctrl+-, Ctrl+WheelDown | Ctrl+-, **Ctrl+Alt+-**, Ctrl+WheelDown | As above |
  | `zoom.reset` | global | Ctrl+0, Ctrl+Shift+0, Ctrl+MiddleClick | Ctrl+0, **Ctrl+Alt+0**, Ctrl+MiddleClick | Global on Ctrl+Shift violates. Gives the maintainer's "global zoom reset" its convention chord (FR-080) |
  | `panel.zoomIn` | panel | Ctrl+Alt+=, Ctrl+Alt++ | **Ctrl+Shift+=** | Panel on Ctrl+Alt violates. Matched on the physical Equal key (FR-078), so it is layout-independent |
  | `panel.zoomOut` | panel | Ctrl+Alt+- | **Ctrl+Shift+-** | As above. Shadows readline `undo` (`^_`, still on Ctrl+X Ctrl+U), recorded exception v5.6.0 |
  | `panel.zoomReset` | panel | Ctrl+Alt+0 | **Ctrl+Shift+0** | As above. Physical Digit0 (FR-026) |
  | `editor.saveAs` | panel | Ctrl+Alt+S | **Ctrl+Shift+S** | Saves the active panel's document. Swaps with Save All, and Ctrl+Shift+S is Save As in VS Code |
  | `editor.saveAll` | global | Ctrl+Shift+S | **Ctrl+Alt+S** | Saves across the configured scope, not the active panel. Supersedes 006 FR-023's chord |
  | `editor.toggleWordWrap` | panel | Ctrl+Alt+W | **Ctrl+Shift+W** | Toggles the focused editor's document (024 US1). EDITOR_ONLY, so no shell sees it. Supersedes 024 FR-003b's chord |
  | `search.replaceAll` | panel | Ctrl+Alt+Enter | **Ctrl+Shift+Enter** | Acts in the active panel's find bar, and only while it is open in an editor. CodeMirror binds nothing on it |
  | `navigate.quickOpen` | global | Ctrl+Shift+T | **Ctrl+Alt+G** | Opens a project-wide picker. "Go to file". Ctrl+Alt+O is AltGr+O (ó) on UK, which v5.6.0 forbids. Supersedes 033 FR-002's chord |
  | `search.findInFiles` | global | Ctrl+Shift+F | **Ctrl+Alt+F** | Searches the project (043's own reasoning). Supersedes 043 FR-029's chord |
  | `search.replaceInFiles` | global | Ctrl+Shift+H | **Ctrl+Alt+H** | As above |
  | `focus.explorer` | global | Ctrl+Alt+F | **Ctrl+Alt+D** | Frees F for Find in Files. D is AltGr-free on all seven common layouts. Supersedes FR-020's chord |

  Unchanged and already conforming. Global on Ctrl+Alt: `focus.left/right/up/down`
  (Ctrl+Alt+Arrow), `focus.notice` (Ctrl+Alt+M), `view.toggleProjects` (Ctrl+Alt+B),
  `view.toggleExplorer` (Ctrl+Alt+N), `project.next` / `project.previous` (Ctrl+Alt+PageDown /
  PageUp), `focus.projects` (Ctrl+Alt+P) and `tabs.openPicker` (Ctrl+Alt+T). Panel on Ctrl+Shift:
  `terminal.scrollLineUp/Down` (Ctrl+Shift+ArrowUp/Down). The direction carve-out covers
  `focus.cycleBack` (Ctrl+Shift+`). Outside both families: every bare-Ctrl, Alt, Shift+Alt, Shift
  and function-key default (`focus.cycle`, `menu.open`, `panel.rename`, `file.*`, `editor.save`,
  `editor.cutLine`, `editor.indentLines` / `outdentLines`, `editor.columnSelect*`, `search.find` /
  `findNext` / `findPrevious` / `close` / `replace` / `replaceCurrent`, `navigate.gotoLine`,
  `navigate.back` / `forward`, `preview.followLink`, `terminal.scrollPage*`, `terminal.scrollToTop`
  / `Bottom`, `terminal.redraw`, `view.fullscreen`). Unbound: `preview.open` and
  `preview.toggleSyncScroll`. Ctrl+Shift+C / Ctrl+Shift+V are not throng bindings. They reach the
  shell, as `use-terminal.ts` intends, and this FR does not claim them.
  - *Rows superseded after the maintainer's review of the remap (Session 2026-09-23, iterate round
    1).* The rows for `editor.saveAs`, `editor.saveAll`, `navigate.quickOpen`,
    `search.findInFiles`, `search.replaceInFiles` and `focus.explorer` are superseded by **FR-089**:
    all six keep their current defaults. The `editor.toggleWordWrap` row is superseded by
    **FR-091** (Ctrl+E W). The four zoom-in and zoom-out rows gain keypad variants under **FR-090**.
    The `search.replaceAll` row stands and is restated with its scope in **FR-093**. The rows kept
    unchanged are `zoom.reset` and `panel.zoomReset`.
  - *The whole table is superseded by FR-095 (second review, 2026-09-24).* Under the three tiers,
    the window zoom and the panel zoom both keep their pre-046 chords, `search.replaceAll` stays on
    Ctrl+Alt+Enter, and the navigation commands move to Ctrl+Shift.
- **FR-078**: A keydown on the **Equal** or **Minus** key with **Ctrl and Shift held and Alt not
  held** MUST match on the physical key, as `Ctrl+Shift+=` / `Ctrl+Shift+-`, first. The produced
  token is tried second, the same physical-first rule FR-026 gives the digit row. Alt held excludes
  the physical candidate, so no AltGr character on those keys is taken.
  *Withdrawn by FR-097 / FR-098 (second review, 2026-09-24): nothing ships on Ctrl+Shift with `=` or
  `-`, and Ctrl+Shift+= must keep arriving as `Ctrl++` (FR-099).*
- **FR-079**: An existing install's saved keybindings MUST be upgraded by a new shipped-defaults
  version (13), using the guarded-rewrite shape of FR-025's Recorded note. For each action in
  FR-077's table, the saved array is rewritten to the new default **only** when it is still
  set-identical to a previous shipped default for that action: the version-11 value, or the
  version-12 value where 046 changed it (`zoom.reset`). The rewrite MUST also be refused when any
  other action's saved array already holds one of the new chords, because a physical-first match
  could otherwise take the key from it silently. Any other saved value, including every user rebind,
  is left exactly as saved. Version 12 is not edited, because it has already run on the maintainer's
  development install *(derived; not confirmed by the maintainer)*. The upgrade MUST be idempotent: a
  second run changes nothing, and a test asserts the re-run.
  *Read with FR-089 – FR-091 (same session, after the maintainer's review):* "each action in FR-077's
  table" now means the rows still standing: `zoom.in`, `zoom.out`, `zoom.reset`, `panel.zoomIn`,
  `panel.zoomOut`, `panel.zoomReset`, `search.replaceAll`, and `editor.toggleWordWrap` from
  Ctrl+Alt+W to Ctrl+E W. The keypad variants (FR-090) arrive through the same guarded rewrite. The
  six FR-089 commands are not touched.
  *Row set superseded by FR-100 (second review, 2026-09-24). The mechanism — version 13, the
  guarded rewrite from a v11 or v12 value, the collision refusal, the idempotent re-run — stands.*
- **FR-080**: `zoom.reset` MUST reset the **app-wide** zoom: the window's page zoom, shared by chrome
  and every panel, back to 100%. It MUST leave every panel's own zoom unchanged, and it MUST work
  from every scope, including a terminal, where the shell receives nothing. `panel.zoomReset` MUST
  reset only the active panel, and MUST leave the app-wide zoom unchanged. A test at the lowest layer
  that can observe it MUST prove each half: that `zoom.reset` reaches the app-wide reset (the main
  process's zoom-level reset for the sending window) and not the per-panel store, and the converse
  for `panel.zoomReset`. The maintainer's report that "there does not seem to be a global zoom
  reset" is a **hypothesis** until that test or a probe explains it (research.md R16). If the test
  shows `zoom.reset` resets a panel, that is a defect, and this FR requires it fixed.
  *Still binding, with the chords restated by FR-099 (second review, 2026-09-24): the app-wide reset
  is `Ctrl+0` and `Ctrl+MiddleClick` (no `Ctrl+Alt+0`), and the panel reset is `Ctrl+Alt+0`.*
  *Still binding, with the routes restated by FR-102 / FR-106 / FR-107 (iterate round 1 checkpoint,
  2026-09-24): the app-wide reset is `Ctrl+Shift+Alt+0` and the cog menu's Zoom row; the panel reset
  is `Ctrl+Alt+0` and `Ctrl+MiddleClick`. The two tests this FR requires are unchanged in shape.
  "Only the active panel" now reads for the keyboard route; the gesture resets the panel under the
  pointer (FR-106).*
- **FR-089** *(after the maintainer's review of the remap; supersedes FR-077's rows for these six
  and FR-020's move to Ctrl+Alt+D)*: These shipped defaults MUST stay exactly as they are:
  `navigate.quickOpen` **Ctrl+Shift+T**, `search.findInFiles` **Ctrl+Shift+F**,
  `search.replaceInFiles` **Ctrl+Shift+H**, `editor.saveAll` **Ctrl+Shift+S**, `editor.saveAs`
  **Ctrl+Alt+S**, and `focus.explorer` **Ctrl+Alt+F**. The first five are **recorded exceptions to
  the modifier convention** in constitution v5.6.0 Principle IV: the first three because every
  editor a user arrives from uses them, the Save pair by the maintainer's decision. `focus.explorer`
  already conforms. The FR-079 upgrade MUST NOT touch any of the six.
  *Superseded in part by FR-095 / FR-096 (second review, 2026-09-24):* the five exceptions stand.
  `focus.explorer` moves to **Ctrl+Shift+E**, because it is navigation under the three tiers.
  *Superseded again in part by FR-102 / FR-103 (iterate round 1 checkpoint, 2026-09-24):* the five
  exceptions stand, and `focus.explorer` is **Ctrl+Shift+Alt+F**.
- **FR-090** *(after the maintainer's review)*: Every shipped chord on the `=`/`+` key or the `-` key
  MUST also ship a **keypad** variant with the same modifiers:
  - `zoom.in` gains **Ctrl+NumpadAdd** and **Ctrl+Alt+NumpadAdd**;
  - `zoom.out` gains **Ctrl+NumpadSubtract** and **Ctrl+Alt+NumpadSubtract**;
  - `panel.zoomIn` gains **Ctrl+Shift+NumpadAdd**;
  - `panel.zoomOut` gains **Ctrl+Shift+NumpadSubtract**.

  No other shipped chord uses those keys. A keydown whose physical key is `NumpadAdd` or
  `NumpadSubtract` MUST match on that physical key first, with its modifiers **including Shift**,
  and on the produced character second (the FR-026 / FR-078 physical-first rule, extended to the
  two keypad keys). The keypad has no AltGr characters, so Alt does not exclude the physical
  candidate here. The capture modal MUST record a keypad press as the keypad token, and the Key
  Bindings editor and menu shortcuts MUST display it legibly: "Num +" / "Num −" or equivalent
  *(display wording derived; not confirmed by the maintainer)*. A keypad variant counts as a second
  chord of the same command, so "one command, one chord across panel types" is unaffected.
  *Superseded by FR-098 (the maintainer's addendum, 2026-09-24):* there are no keypad tokens, and no
  keypad physical candidate. The keypad `+` and `-` are the same binding as the main-row keys,
  through the produced character. The Ctrl+Shift rows no longer exist.
- **FR-091** *(after the maintainer's review; supersedes FR-077's word-wrap row and 024 FR-003b's
  chord)*: `editor.toggleWordWrap` MUST ship the two-stroke chord **Ctrl+E W**: Ctrl+E, released,
  then W. It stays `EDITOR_ONLY`, so no terminal ever receives it or waits on it. Its menu item and
  its Key Bindings row show the two strokes. The FR-079 upgrade moves a saved Ctrl+Alt+W that is
  still the shipped default. 024 FR-003c's don't-shadow rule is met by scope: the first stroke is
  live only in an editor, where Ctrl+E does nothing on Windows today (CodeMirror binds `Ctrl-e` for
  macOS only, research.md R19). If #169 ever makes the command live in a terminal, that terminal
  MUST NOT receive the Ctrl+E prefix, because it is in the reserved tier. The terminal would then
  need its own chord, recorded as a divergence under Principle IV's one-chord rule.
  *Stands under the agreed convention (iterate round 1 checkpoint, 2026-09-24); a recorded exception
  in FR-103. "The FR-079 upgrade" now reads "the FR-108 upgrade", which moves a saved Ctrl+Alt+W
  still equal to the shipped default.*
  *Extended by FR-123 (iterate round 4, 2026-09-26):* "Ctrl+E, released, then W" also completes with
  Ctrl held through the W; only E has to be released.
- **FR-092** *(after the maintainer's review; the capability FR-091 needs; behaviour derived from VS
  Code's Ctrl+K chords, not confirmed by the maintainer)*: A binding MAY be a **two-stroke chord**,
  written as two tokens separated by a space (`Ctrl+E W`), within these limits:
  - **Scope.** Only a command whose scope contains no `terminal` may carry one. A unit test MUST fail
    on any binding, shipped or saved, that breaks this. A pending prefix would hold back a shell's
    input.
  - **First stroke.** It MUST carry a modifier (FR-033a's rule for any chord). Pressed where a
    two-stroke chord starting with it is live, it is consumed, types nothing, and shows a visible
    pending indication in the focused editor, naming the stroke and that a second key is awaited.
  - **Second stroke.** It MAY be a bare key. If it completes a bound chord, that command runs. If it
    completes nothing, it is consumed, nothing is typed, and the indication says briefly that the
    combination is not bound (VS Code's behaviour).
  - **Ending.** A pending prefix ends on its second stroke, on **Escape**, which cancels and is
    consumed without closing any bar, on focus leaving the editor, or after **4 seconds**
    (CodeMirror's own prefix timeout).
  - **Collisions.** A first stroke that is also bound as a whole single-stroke chord in an
    intersecting scope is a collision. `chordCollisions` MUST report it, and the capture modal MUST
    warn about it, as for any clash.
  - **Editor, parse, format and upgrade.** The capture modal MUST be able to record a second stroke
    after the first. Parsing, display, reset, conflict warnings and the shipped-defaults upgrade
    MUST treat a two-stroke binding as one binding.

  Longer sequences are out of scope.
- **FR-093** *(after the maintainer's review; restates FR-077's `search.replaceAll` row with its
  scope)*: `search.replaceAll` MUST ship **Ctrl+Shift+Enter**. It MUST replace every match in the
  active editor's document whenever that editor's in-panel find bar is open with its replace
  section shown, whether focus is in the bar's find field, its replace field or the document. (The
  "replace section shown" condition is *derived; not confirmed by the maintainer*. Today's handler
  gates only on an open bar, `search-keybindings.tsx:157`, so a hidden replace field can still
  replace with its last value.) It
  stays a no-op, and passes the key on, when no bar is open, and in a terminal. The maintainer's
  report that Ctrl+Alt+Enter does not replace all is a **defect finding** (research.md R18). At
  implementation it is reproduced first with a failing test at the lowest layer that shows it,
  pressing the chord with focus in each of those three places. It is not a requirement change.
  *Chord superseded by FR-096 (second review, 2026-09-24): `search.replaceAll` stays on
  **Ctrl+Alt+Enter**, as a noted exception. The scope, the replace-section gate and the defect
  finding stand, with the chord read as Ctrl+Alt+Enter.*

#### Three modifier tiers (second review, 2026-09-24)

- **FR-094** *(supersedes FR-076)*: Every shipped default MUST follow constitution v5.6.0 Principle
  IV's three tiers:
  - **navigation**: `Ctrl+Shift+<key>`, for moving between or activating panes, panels, tabs,
    projects and notices, and for revealing or hiding a side pane;
  - **container**: `Ctrl+Alt+<key>`, for acting on the pane or panel itself;
  - **content**: one modifier (`Ctrl+`, `Shift+`, `Alt+`) or none, for acting on what a surface
    shows.

  A group of related commands MUST share modifiers. Function keys, mouse gestures and multi-stroke
  chords are outside the tiers. A unit test MUST give every `ActionId` a tier. It MUST fail on a
  shipped default in the wrong tier unless that default is on FR-096's exception list, and it MUST
  fail on an `ActionId` with no tier.
  *Superseded by FR-101 (iterate round 1 checkpoint, 2026-09-24): the maintainer agreed a different
  set of tiers. The guard's shape stands, over FR-101's tiers and FR-103's list.*
- **FR-095** *(supersedes FR-077's table, FR-020's chords for its four commands, FR-089's
  `focus.explorer` clause, and FR-090's and FR-093's chords)*: The Windows shipped defaults MUST be as
  below. Rows marked *unchanged* keep today's default on master. Each new chord MUST be outside the
  reserved tier, MUST collide with nothing in an intersecting scope, and MUST pass FR-021's
  line-editor check (research.md R21).

  **Navigation (Ctrl+Shift)**

  | Command | Current | Proposed | Note |
  |---|---|---|---|
  | `focus.left/right/up/down` | Ctrl+Alt+Arrow | *unchanged* | Noted exception (FR-096): every Ctrl+Shift+Arrow is word selection |
  | `focus.cycle` | Ctrl+` | **Ctrl+Shift+PageDown** | Next panel in the active tab. Kept rather than folded into directional: it reaches every panel in layout order, which directional moves cannot in a nested split |
  | `focus.cycleBack` | Ctrl+Shift+` | **Ctrl+Shift+PageUp** | Its pair |
  | `project.next` | Ctrl+Alt+PageDown (046) | **Ctrl+Shift+]** | Matched on the physical bracket key (FR-097) |
  | `project.previous` | Ctrl+Alt+PageUp (046) | **Ctrl+Shift+[** | Its pair |
  | `focus.explorer` | Ctrl+Alt+F (046) | **Ctrl+Shift+E** | VS Code's "focus Explorer" chord |
  | `focus.projects` | Ctrl+Alt+P (046) | **Ctrl+Shift+P** | |
  | `view.toggleProjects` | Ctrl+Alt+B | **Ctrl+Shift+B** | Revealing or hiding a pane is navigation (controller's ruling) |
  | `view.toggleExplorer` | Ctrl+Alt+N | **Ctrl+Shift+N** | Its pair |
  | `focus.notice` | Ctrl+Alt+M | **Ctrl+Shift+M** | Moves focus to a notice |
  | `tabs.openPicker` | Ctrl+Alt+T | **Ctrl+Shift+Tab** | Activates a tab. Ctrl+Shift+T is Quick Open's |
  | `navigate.quickOpen` | Ctrl+Shift+T | *unchanged* | Fits this tier; also on the maintainer's exception list |

  **Container (Ctrl+Alt)**

  | Command | Current | Proposed | Note |
  |---|---|---|---|
  | `panel.zoomIn` | Ctrl+Alt+=, Ctrl+Alt++ | *unchanged* | Keypad + is the same binding (FR-098) |
  | `panel.zoomOut` | Ctrl+Alt+- | *unchanged* | Keypad − is the same binding |
  | `panel.zoomReset` | Ctrl+Alt+0 | *unchanged* | One group, one set of modifiers |
  | `panel.rename` | F2 | *unchanged* | Function key, outside the tiers. Shares F2 with `file.rename` by design |
  | `editor.saveAs` | Ctrl+Alt+S | *unchanged* | Noted exception (it acts on content) |
  | `search.replaceAll` | Ctrl+Alt+Enter | *unchanged* | Noted exception (VS Code / Sublime Text) |
  | `editor.toggleWordWrap` | Ctrl+Alt+W | **Ctrl+E W** | Noted exception, multi-stroke (FR-091 / FR-092) |

  **Content (one modifier or none)**

  | Command | Current | Proposed | Note |
  |---|---|---|---|
  | `zoom.in` | Ctrl+=, Ctrl++, Ctrl+WheelUp | *unchanged* | Window zoom, noted exception (app-wide on one modifier). Keypad + is the same binding |
  | `zoom.out` | Ctrl+-, Ctrl+WheelDown | *unchanged* | As above |
  | `zoom.reset` | Ctrl+0, Ctrl+Shift+0 (046), Ctrl+MiddleClick | **Ctrl+0, Ctrl+MiddleClick** | Ctrl+Shift+0 removed: one group, one set of modifiers (FR-099) |
  | `editor.saveAll` | Ctrl+Shift+S | *unchanged* | Noted exception |
  | `search.findInFiles` / `replaceInFiles` | Ctrl+Shift+F / H | *unchanged* | Noted exceptions |
  | `terminal.scrollLineUp/Down` | Ctrl+Shift+ArrowUp/Down | *unchanged* | Noted exception (Windows Terminal's chord), terminal only |
  | `editor.columnSelect*` | Shift+Alt+Arrow | *unchanged* | Noted exception (VS Code column select) |
  | everything else | — | *unchanged* | See the one-line list below |

  Unchanged content and function-key chords:
  - one modifier: `editor.save` Ctrl+S, `editor.cutLine` Ctrl+X, `editor.indentLines` /
    `outdentLines` Tab / Shift+Tab, `search.find` Ctrl+F, `search.replace` Ctrl+H,
    `search.replaceCurrent` Alt+Enter, `navigate.gotoLine` Ctrl+G, `navigate.back` / `forward`
    Alt+ArrowLeft / ArrowRight, `preview.followLink` Ctrl+Enter, `file.*` Ctrl+X / C / V / Z / Y,
    `terminal.scrollPageUp/Down` Shift+PageUp / PageDown, `terminal.scrollToTop` / `Bottom`
    Ctrl+Home / End;
  - no modifier: `file.delete` Delete, `search.close` Escape;
  - function keys: `file.rename` F2, `search.findNext` / `findPrevious` F3 / Shift+F3,
    `terminal.redraw` Ctrl+F5, `view.fullscreen` F11, `menu.open` Shift+F10 / ContextMenu;
  - unbound: `preview.open`, `preview.toggleSyncScroll`.

  *Whole table superseded by FR-102 (iterate round 1 checkpoint, 2026-09-24). None of its Ctrl+Shift
  navigation chords ships; `focus.cycle` / `cycleBack` keep Ctrl+` / Ctrl+Shift+`; the window zoom
  moves to Ctrl+Shift+Alt; the panel zoom takes the mouse gestures.*
- **FR-096** *(supersedes FR-089's exception list)*: The noted exceptions are exactly these, and the
  FR-094 guard MUST hold them as an exhaustive list mirroring constitution IV:
  - the window zoom group (`Ctrl+=`, `Ctrl++`, `Ctrl+-`, `Ctrl+0`, wheel, middle-click): the
    universal page-zoom chords;
  - `navigate.quickOpen` Ctrl+Shift+T, `search.findInFiles` Ctrl+Shift+F, `search.replaceInFiles`
    Ctrl+Shift+H: the maintainer's list, because every editor carries them;
  - `editor.saveAll` Ctrl+Shift+S and `editor.saveAs` Ctrl+Alt+S: the maintainer's pair;
  - `search.replaceAll` Ctrl+Alt+Enter: VS Code and Sublime Text *(the controller's ruling)*;
  - `focus.left/right/up/down` Ctrl+Alt+Arrow: no Ctrl+Shift key set is directional without taking
    word selection *(derived; see the open question in research.md R21)*;
  - `terminal.scrollLineUp/Down` Ctrl+Shift+ArrowUp/Down: Windows Terminal's own chord, terminal only
    *(derived)*;
  - `editor.columnSelect*` Shift+Alt+Arrow: VS Code's column select, whose two modifiers are in no
    tier *(derived)*;
  - `editor.toggleWordWrap` Ctrl+E W: the maintainer's multi-stroke chord (FR-091).

  *Superseded by FR-103 (iterate round 1 checkpoint, 2026-09-24), the maintainer's own list.*
- **FR-097** *(supersedes FR-078)*: The window-chord matcher MUST keep Shift for `PageUp`,
  `PageDown` and `Tab`, as it already does for arrows, letters, function keys and the backtick. For
  these named keys Shift is not encoded in the produced key, so dropping it would turn Ctrl+Shift+Tab
  into Ctrl+Tab. The matcher MUST also match `BracketLeft` / `BracketRight` with Ctrl and Shift held
  and Alt not held on the physical key first, as `Ctrl+Shift+[` / `Ctrl+Shift+]`, because Shift+[
  produces `{` on US and something else on every other layout. This is the FR-026 digit rule applied
  to two more keys. The capture modal records these chords the same way. The Equal and Minus
  physical rule of FR-078 is withdrawn.
  *Superseded by FR-104 (iterate round 1 checkpoint, 2026-09-24): no default uses Ctrl+Shift with
  PageUp, PageDown, Tab or a bracket. The whole Ctrl+Shift+Alt family is matched physically
  instead. Keeping Shift for PageUp / PageDown / Tab in the Ctrl+Shift tier remains harmless and is
  not required.*
- **FR-098** *(supersedes FR-090; the maintainer's addendum)*: The keypad `+` and `-` MUST be the
  **same binding** as the main-row `+` and `-`, through the produced character: `Ctrl++` fires from
  Ctrl+Shift+= on a US main row and from Ctrl+keypad-plus alike, `Ctrl+-` from either minus, and the
  same for `Ctrl+Alt`. No keypad token exists, and the displayed form stays `Ctrl++`. Every place
  that turns a keypress into a chord MUST apply one Shift rule to these two keys, so the main row and
  the keypad resolve and record identically. That covers the window listener, `editor-chrome.tsx`,
  `search-keybindings.tsx`, the preview dispatcher and the capture modal. Today the window listener
  drops Shift for them, while the capture modal keeps it: it records a main-row Ctrl+Plus on a US
  keyboard as `Ctrl+Shift++`, which the window listener then never matches, and a keypad press as
  `Ctrl++` (research.md R17, R21). That divergence MUST be fixed, and a test MUST press both keys in
  each tier.
  *Superseded in part by FR-105 (iterate round 1 checkpoint, 2026-09-24):* the one-Shift-rule and the
  capture divergence fix stand. The keypad `0` joins `+` and `-`. With Ctrl, Shift and Alt all held
  the chord is tier 1 and matched physically (FR-104), so "Ctrl+Alt++ from Ctrl+Alt+Shift+= on a
  US main row" no longer holds: that press is `Ctrl+Shift+Alt++`, the window zoom-in.
- **FR-099** *(supersedes FR-025's chord, FR-077's zoom rows and FR-080's chords; re-reads #390)*: The
  window zoom group MUST be exactly `zoom.in` Ctrl+= / Ctrl++ / Ctrl+WheelUp, `zoom.out` Ctrl+- /
  Ctrl+WheelDown, and `zoom.reset` Ctrl+0 / Ctrl+MiddleClick. The panel zoom group MUST be exactly
  `panel.zoomIn` Ctrl+Alt+= / Ctrl+Alt++, `panel.zoomOut` Ctrl+Alt+-, and `panel.zoomReset`
  Ctrl+Alt+0. Neither group may carry a chord from another tier. **#390 is re-read** *(controller's
  ruling, derived; not confirmed by the maintainer)*: the issue asked for Ctrl+Shift+0 because `+`
  needs Shift on US layouts. Zooming in with Shift held still arrives as `Ctrl++`, and that matching
  is kept, but resetting with Shift held is not added, because it would put a Shift chord in a Ctrl
  group. FR-026's physical digit rule stays: it is general, and it still gives any user-bound
  Ctrl+Shift+digit chord a layout-independent match. FR-080's app-wide / per-panel separation and its
  tests are unchanged.
  *Groups superseded by FR-102 (iterate round 1 checkpoint, 2026-09-24): the window zoom is
  Ctrl+Shift+Alt++ / - / 0 with no gesture, and the panel zoom is Ctrl+Alt++ / - / 0 with the Ctrl
  wheel and middle-click. The group rule itself stands in FR-101. #390 is re-read again in FR-107.*
- **FR-100** *(supersedes FR-079's row set)*: The version-13 upgrade MUST rewrite, under FR-079's
  guard, exactly these actions from their previous shipped values to FR-095's:
  - from the version-11 value: `focus.cycle`, `focus.cycleBack`, `view.toggleProjects`,
    `view.toggleExplorer`, `focus.notice`, `tabs.openPicker`, `editor.toggleWordWrap`;
  - from the version-12 value (046, unreleased): `zoom.reset`, back to `[Ctrl+0, Ctrl+MiddleClick]`,
    and `project.next`, `project.previous`, `focus.explorer`, `focus.projects`.

  Every other action is untouched, including every FR-096 exception.

  *Row set superseded by FR-108 (iterate round 1 checkpoint, 2026-09-24). The mechanism stands.*

#### The agreed keybinding convention (iterate round 1 checkpoint, 2026-09-24)

- **FR-101** *(supersedes FR-094)*: Every shipped default MUST follow constitution v5.6.0
  Principle IV's three tiers, as agreed at the checkpoint:
  - **tier 1, navigation and the application**: `Ctrl+Shift+Alt+<key>`, for moving between or
    activating panes, panels, tabs, projects and notices, revealing or hiding a side pane, and
    acting on the whole window or application (its zoom);
  - **tier 2, the active panel or pane**: `Ctrl+Alt+<key>` or `Ctrl+Shift+<key>`, for acting on the
    panel or pane holding focus rather than on what it shows;
  - **tier 3, content**: one modifier (`Ctrl+`, `Alt+`, `Shift+`) or none.

  A group of related commands MUST share modifiers. Function keys, mouse gestures and multi-stroke
  chords are outside the tiers. A unit test MUST give every `ActionId` a tier (the group it is
  listed under in FR-102). It MUST fail on a shipped default in the wrong tier unless that default
  is on FR-103's list, and it MUST fail on an `ActionId` with no tier. It extends the FR-094 guard
  in place rather than adding a file.
- **FR-102** *(supersedes FR-095's table and FR-099's groups; restates FR-020's, FR-025's and
  FR-080's chords)*: The Windows shipped defaults MUST be exactly as below. **Only the rows marked
  *changes* move**; every other default keeps its value at `3b04ec33`. Tokens are written in the
  canonical order `eventToToken` builds (`Ctrl+Shift+Alt+<key>`), which is also the form the Key
  Bindings editor and menu shortcuts display. Each new chord MUST be outside the reserved tier, MUST
  collide with nothing in an intersecting scope, and MUST pass FR-021's line-editor check
  (research.md R22).

  **Global and navigation — tier 1, `Ctrl+Shift+Alt`, matched on the physical key (FR-104)**

  | Command | Before | Default | |
  |---|---|---|---|
  | `zoom.in` (window) | Ctrl+=, Ctrl++, Ctrl+WheelUp | **Ctrl+Shift+Alt++** | *changes*. Also the cog menu's Zoom row (FR-107) |
  | `zoom.out` (window) | Ctrl+-, Ctrl+WheelDown | **Ctrl+Shift+Alt+-** | *changes*. Also the Zoom row |
  | `zoom.reset` (window) | Ctrl+0, Ctrl+Shift+0, Ctrl+MiddleClick | **Ctrl+Shift+Alt+0** | *changes*. Also the Zoom row. #390's Ctrl+Shift+0 is retired. *Superseded by FR-113 / FR-114 (Session 2026-09-25): no cog row; the key is Numpad0 (**Ctrl+Shift+Alt+Numpad0**), not the main-row 0* |
  | `focus.left` / `right` / `up` / `down` | Ctrl+Alt+ArrowLeft / Right / Up / Down | **Ctrl+Shift+Alt+ArrowLeft / Right / Up / Down** | *changes* |
  | `focus.notice` | Ctrl+Alt+M | **Ctrl+Shift+Alt+M** | *changes*. *Superseded by FR-117 (iterate round 3, 2026-09-25): **Ctrl+Shift+Alt+V*** |
  | `view.toggleProjects` | Ctrl+Alt+B | **Ctrl+Shift+Alt+B** | *changes*. *Superseded by FR-117: **Ctrl+Shift+Alt+J*** |
  | `view.toggleExplorer` | Ctrl+Alt+N | **Ctrl+Shift+Alt+N** | *changes*. *Superseded by FR-117: **Ctrl+Shift+Alt+K*** |
  | `project.next` / `project.previous` | Ctrl+Alt+PageDown / PageUp | **Ctrl+Shift+Alt+PageDown / PageUp** | *changes* |
  | `focus.explorer` | Ctrl+Alt+F | **Ctrl+Shift+Alt+F** | *changes*. *Superseded by FR-117: **Ctrl+Shift+Alt+M*** |
  | `focus.projects` | Ctrl+Alt+P | **Ctrl+Shift+Alt+P** | *changes*. *Superseded by FR-117: **Ctrl+Shift+Alt+B*** |
  | `tabs.openPicker` | Ctrl+Alt+T | **Ctrl+Shift+Alt+T** | *changes* |
  | `focus.cycle` / `focus.cycleBack` | Ctrl+` / Ctrl+Shift+` | unchanged | Exception: Shift reverses direction |
  | `navigate.quickOpen` | Ctrl+Shift+T | unchanged | Exception |
  | `search.findInFiles` / `search.replaceInFiles` | Ctrl+Shift+F / Ctrl+Shift+H | unchanged | Exceptions |
  | `editor.saveAll` | Ctrl+Shift+S | unchanged | Exception |
  | `view.fullscreen` | F11 | unchanged | Exception (function key) |

  **Panel and pane — tier 2, `Ctrl+Alt` or `Ctrl+Shift`**

  | Command | Before | Default | |
  |---|---|---|---|
  | `panel.zoomIn` | Ctrl+Alt+=, Ctrl+Alt++ | **Ctrl+Alt++, Ctrl+WheelUp** | *changes*. One chord (FR-105) and the gesture (FR-106) |
  | `panel.zoomOut` | Ctrl+Alt+- | **Ctrl+Alt+-, Ctrl+WheelDown** | *changes* |
  | `panel.zoomReset` | Ctrl+Alt+0 | **Ctrl+Alt+0, Ctrl+MiddleClick** | *changes*. *Superseded by FR-114 (Session 2026-09-25): **Ctrl+Alt+Numpad0**, Ctrl+MiddleClick — not the main-row 0* |
  | `editor.toggleWordWrap` | Ctrl+Alt+W | **Ctrl+E W** | *changes*. Exception: multi-stroke, EDITOR_ONLY (FR-091, FR-092) |
  | `terminal.scrollLineUp` / `Down` | Ctrl+Shift+ArrowUp / Down | unchanged | Conforms: acts on the pane's viewport *(derived)* |
  | `editor.saveAs` | Ctrl+Alt+S | unchanged | Exception, the Save pair |
  | `search.replaceAll` | Ctrl+Alt+Enter | unchanged | Exception; live only while an editor's find bar is open (FR-093) |
  | `panel.rename` | F2 | unchanged | Exception (function key); shares F2 with `file.rename` by design |
  | `menu.open` | Shift+F10, ContextMenu | unchanged | Exception: the Menu key is not a second chord |

  **Content — tier 3, one modifier or none: no changes**

  - one modifier: `editor.save` Ctrl+S, `editor.cutLine` Ctrl+X, `editor.indentLines` /
    `outdentLines` Tab / Shift+Tab, `search.find` Ctrl+F, `search.replace` Ctrl+H,
    `search.replaceCurrent` Alt+Enter, `navigate.gotoLine` Ctrl+G, `navigate.back` / `forward`
    Alt+ArrowLeft / ArrowRight, `preview.followLink` Ctrl+Enter, `file.cut` / `copy` / `paste` /
    `undo` / `redo` Ctrl+X / C / V / Z / Y, `terminal.scrollPageUp` / `Down` Shift+PageUp /
    PageDown, `terminal.scrollToTop` / `Bottom` Ctrl+Home / End, `terminal.redraw` Ctrl+F5;
  - no modifier: `file.delete` Delete, `search.close` Escape;
  - function keys: `file.rename` F2, `search.findNext` / `findPrevious` F3 / Shift+F3;
  - two modifiers, recorded exception: `editor.columnSelectUp` / `Down` / `Left` / `Right`
    Shift+Alt+Arrow *(derived: not on the maintainer's list; no tier admits Shift+Alt)*;
  - unbound: `preview.open`, `preview.toggleSyncScroll`.

  Plain **Ctrl++, Ctrl+-, Ctrl+= and Ctrl+0 become unbound**, and so does Ctrl+Shift+0. Freeing
  Ctrl+Alt+Arrow, PageUp / PageDown and B / N / M / F / P / T returns those keys to the editor, the
  shell and AltGr typing (research.md R22).

  *Tier-1 letters re-assigned by FR-117 (iterate round 3, 2026-09-25): B, N and M focus the three
  surfaces left to right, J and K collapse or expand the two side panes, and V focuses a notice.
  Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P become unbound. The "Before" column of the rows marked
  superseded above still records what each command shipped before this round. The rows' new values
  are FR-117's.*
- **FR-103** *(supersedes FR-096; the maintainer's list)*: The recorded exceptions are exactly these,
  and the FR-101 guard MUST hold them as an exhaustive list mirroring constitution IV: the
  terminal-tier exceptions `Ctrl+F`, `Ctrl+H`, `Ctrl+S`, `Ctrl+F5`; `navigate.quickOpen`
  Ctrl+Shift+T; `search.findInFiles` Ctrl+Shift+F; `search.replaceInFiles` Ctrl+Shift+H;
  `editor.saveAll` Ctrl+Shift+S; `editor.saveAs` Ctrl+Alt+S; `search.replaceAll` Ctrl+Alt+Enter;
  the function keys F2, F3 / Shift+F3, F11 and Shift+F10; `focus.cycle` Ctrl+` and
  `focus.cycleBack` Ctrl+Shift+`; `menu.open` Shift+F10 and ContextMenu; `editor.toggleWordWrap`
  Ctrl+E W; and `editor.columnSelect*` Shift+Alt+Arrow *(derived; the one entry the maintainer did
  not name)*. An unlisted violation fails the guard.
- **FR-104** *(supersedes FR-097; extends FR-026)*: A keydown with **Ctrl, Shift and Alt all held**
  MUST be matched on its **physical key** (`KeyboardEvent.code`), never on the produced character,
  by every renderer site that turns a keypress into a command — the window listener,
  `editor-chrome.tsx`, `search-keybindings.tsx`, the preview dispatcher — and by the Key Bindings
  capture modal, which MUST record the physical token. The physical key maps to the token's key
  segment as follows *(the mapping is derived; not confirmed by the maintainer)*:
  - `KeyA`–`KeyZ` → the letter; `Digit0`–`Digit9` → the digit;
  - `Equal` and `NumpadAdd` → `+`; `Minus` and `NumpadSubtract` → `-`; `Digit0` and `Numpad0` →
    `0` (the keypad keys are the same binding, FR-105);
  - a named key (`ArrowLeft`, `PageDown`, `Home`, …) → its name, as today.

  The Ctrl-without-Alt digit rule (FR-026) and the backtick rule stay as they are, and a chord with
  Ctrl and Alt but no Shift stays on the produced character, so no AltGr character is taken by a
  tier-2 chord (FR-021's reason for R2's Alt exclusion). A tier-1 match MUST decline an event with
  the Windows key (`metaKey`) held, so the Office key's Ctrl+Shift+Alt+Win never resolves as a
  throng chord *(derived)*. What tier 1 costs:
  - on a non-QWERTY layout a tier-1 letter is the key in that letter's US position (AZERTY `M` is
    the `,` key), and the dedicated `+` / `-` keys of German-style layouts do not fire a tier-1 `+`
    or `-` chord — the keypad does;
  - where AltGr+Shift types a character on a bound key (Polish programmer's `Ń` on N), the chord can
    take it. If Chromium reports `AltGraph` for the right-hand AltGr key and not for left
    Ctrl+Alt — a **hypothesis** (research.md R22) — a tier-1 match MUST decline an event with
    `AltGraph` set, and the character types. A test at the lowest layer that can observe the real
    modifier state MUST settle the hypothesis before either behaviour ships.
- **FR-105** *(supersedes FR-098 in part and FR-090)*: Every command MUST ship **at most one
  keyboard chord and at most one mouse gesture**. The one exception is `menu.open` (Shift+F10 and
  ContextMenu, FR-103). The keypad `+`, `-` and `0` MUST be the **same binding** as the main-row key,
  never a second token: any binding on `+`, `-` or `0` fires from the keypad key with the same
  modifiers, in every resolver, and the capture modal records the main-row press and the keypad
  press identically. FR-098's single Shift rule for these keys stands. Everywhere a chord is written
  — the Key Bindings editor, menu shortcuts, hover titles, the docs — it is `Ctrl++`, `Ctrl+Alt++`,
  `Ctrl+Shift+Alt++` ("Ctrl plus the + key"), never `Ctrl+Num+` or `Ctrl+Plus`.
  - *Superseded in part by FR-114 (Session 2026-09-25), for `zoom.reset` and `panel.zoomReset` only:*
    the keypad `0` (`Numpad0`) is a **separate, physical-only** match for these two commands, not the
    same binding as the main-row `0` — the main-row key no longer resets either zoom at all. Every
    other command's `+` / `-` / `0` same-binding rule, and this rule's "no `Ctrl+Num+`" written form,
    stand unchanged; the two reset commands are the one named exception.
  - *Further amended (derived, 2026-09-25, convergence T168): the previous bullet's "for these two
    commands only" scoping described which commands SHIP a `Numpad0` default, not what the keypad `0`
    resolves to. The keypad `0` (`Numpad0`) is a separate, physical-only match, distinct from the
    main-row `0`, for **every** command, not only `zoom.reset` and `panel.zoomReset` —
    `packages/core/src/config/chord-capture.ts`'s `sameBindingSymbolOfCode` returns `Numpad0`
    unconditionally and `packages/ui/src/renderer/config/chord-key.ts`'s `chordCandidates` never
    folds a `Numpad0` press into the `0` / `Digit0` candidate for any command (commit `b67029fa`).
    A user who binds any OTHER command to `Ctrl+Alt+0` or `Ctrl+Shift+Alt+0` in Key Bindings fires it
    only from the main-row `0`; the keypad press does not fire it and records its own
    `Ctrl+Alt+Numpad0` / `Ctrl+Shift+Alt+Numpad0` capture instead. The keypad `+` and `-` same-binding
    rule is unaffected and stands for every command, `zoom.reset` / `panel.zoomReset`'s own `+` / `-`
    siblings included. This is what the code already does; it is not a behaviour change.
  - **The `+` key on a layout where `+` needs Shift** *(derived; not confirmed by the maintainer)*.
    On US, UK and French the `+` key is the `=` key, and pressing it with Shift and Ctrl+Alt is
    tier 1. So `Ctrl+Alt++` MUST also match Ctrl+Alt with that key pressed **without** Shift (the
    produced `=`), as the same binding. Without this, `panel.zoomIn` has no keyboard route on a US
    or UK keyboard without a keypad. `Ctrl+Alt+=` is not shipped as a second token.
  - A unit test MUST fail on a shipped default with two keyboard chords (other than `menu.open`) or
    two gestures, and on a shipped keypad token (`Numpad…`).
- **FR-106** *(moves 003 FR-033's gestures; derived where marked)*: Ctrl+WheelUp, Ctrl+WheelDown
  and Ctrl+MiddleClick MUST drive `panel.zoomIn`, `panel.zoomOut` and `panel.zoomReset`, and MUST NOT
  change the window zoom. Over a panel they act on **the panel under the pointer** (its panel type's
  zoom, 012 FR-008) rather than the active panel, because a pointer gesture aims at what it is over
  *(derived; not confirmed by the maintainer)*. Over a surface with no panel zoom (the title bar, a
  side pane) they do nothing. A gesture MUST be consumed, so it neither scrolls a terminal or an
  editor nor reaches Chromium's own page zoom. The gestures stay editable bindings (003 FR-033).
- **FR-107** *(supersedes FR-074's "single Application section" clause and FR-025's reading of
  #390)*: The title-bar cog menu MUST carry a **View & state** section, above Application, holding
  one **Zoom** row with three controls: **Zoom Out**, **Reset Zoom** and **Zoom In**, acting on the
  window zoom exactly as `zoom.out`, `zoom.reset` and `zoom.in` do. It exists because a user whose
  layout turns Ctrl+Alt into AltGr, or who works with the mouse, needs a route that is not a chord.
  *Derived, not confirmed by the maintainer:* each control is a themeable icon control whose hover
  title names it and its current chord; the menu stays open after a Zoom control so the user can step
  more than once; Left / Right move between the three controls and Enter or Space activates one;
  Zoom In is disabled at the maximum, Zoom Out at the minimum, and Reset Zoom at 100% (Principle VI);
  the reset control MAY show the current percentage. No other item joins the cog menu (FR-074).
  **#390** closes on this change, and its close text MUST say that the global zoom reset is
  **Ctrl+Shift+Alt+0** plus the cog menu's Zoom row, and that the Ctrl+Shift+0 it asked for is
  retired.

  *Superseded by FR-113 (Session 2026-09-25, maintainer, mid-build): the maintainer's instruction,
  verbatim, "Remove the new "Zoom" options from the menu." The Zoom row and its View & state section
  are withdrawn; the cog menu carries the single Application section only, and no control here reads
  the window zoom level. This FR's retirement of Ctrl+Shift+0 stands. #390's close text is FR-113's,
  not this paragraph's: the reset is Ctrl+Shift+Alt+Numpad0 (FR-114), with no mouse or menu route.*
- **FR-108** *(supersedes FR-100's row set; FR-079's mechanism stands)*: `SHIPPED_DEFAULTS_VERSION`
  **13** MUST rewrite a saved binding to FR-102's default **only** when the saved array is still
  set-identical to an **old shipped default** for that action. Any user-customised binding is left
  exactly as saved. The rows, and the old values each may come from:
  - from the version-11 value: `zoom.in` `[Ctrl+=, Ctrl++, Ctrl+WheelUp]`, `zoom.out` `[Ctrl+-,
    Ctrl+WheelDown]`, `zoom.reset` `[Ctrl+0, Ctrl+MiddleClick]`, `focus.left` / `right` / `up` /
    `down` `[Ctrl+Alt+Arrow…]`, `focus.notice` `[Ctrl+Alt+M]`, `view.toggleProjects`
    `[Ctrl+Alt+B]`, `view.toggleExplorer` `[Ctrl+Alt+N]`, `tabs.openPicker` `[Ctrl+Alt+T]`,
    `panel.zoomIn` `[Ctrl+Alt+=, Ctrl+Alt++]`, `panel.zoomOut` `[Ctrl+Alt+-]`, `panel.zoomReset`
    `[Ctrl+Alt+0]`, `editor.toggleWordWrap` `[Ctrl+Alt+W]`;
  - from the version-12 value (046, unreleased): `zoom.reset` `[Ctrl+0, Ctrl+Shift+0,
    Ctrl+MiddleClick]`, `project.next` `[Ctrl+Alt+PageDown]`, `project.previous`
    `[Ctrl+Alt+PageUp]`, `focus.explorer` `[Ctrl+Alt+F]`, `focus.projects` `[Ctrl+Alt+P]`.

  *Superseded in part by FR-115 (Session 2026-09-25): the `zoom.reset` and `panel.zoomReset` rewrite
  TARGETS are FR-114's Numpad0 values (`Ctrl+Shift+Alt+Numpad0`, `Ctrl+Alt+Numpad0` +
  `Ctrl+MiddleClick`), not this FR's `0` values. The old-value rows above (what a saved binding is
  compared against) are unchanged, as is every other command's rewrite target.*

  A new default MUST NOT be applied when it would collide with one of the user's own bindings — any
  action whose saved array is not being rewritten — in an intersecting scope, the same guard as
  version 12. The comparison uses the token FR-104 or FR-105 would resolve the same key to, as
  FR-025's guard compared `Ctrl+Shift+0` with `Ctrl+Shift+)`. This matters for the gestures: a user
  who customised `zoom.in` and kept Ctrl+WheelUp in it keeps that gesture, and `panel.zoomIn` is not
  given it. Version 12 is not edited. The upgrade MUST be idempotent, and a test asserts the re-run.
  FR-072's theme token rides the same version.

  *Rewrite targets superseded in part by FR-118 (iterate round 3, 2026-09-25):* for `focus.notice`,
  `view.toggleProjects`, `view.toggleExplorer`, `focus.explorer` and `focus.projects`, the target a
  version-11 or version-12 value moves to is now FR-117's chord, not FR-102's. Version 13 is not
  edited. Version 14 adds the version-13 values as a further source. The mechanism, the collision
  guard and every other row stand.
- **FR-109** *(the Ctrl+Shift+Alt audit)*: The existing guards MUST be extended, in place where the
  file already exists, so that the new family cannot regress:
  - `renderer-chord-resolvers.test.ts` and `window-chord-manifest.test.ts`: every Ctrl+Shift+Alt
    default resolves at every renderer site from an event carrying only its physical `code`, with
    the produced `key` varied across US, UK, German, French and Polish values (including an
    AltGr+Shift character and a dead key), and the keypad `+` / `-` / `0` resolve identically to
    the main-row key;
  - `keybindings-collision.test.ts`: no two shipped defaults share a chord in intersecting scopes
    once tokens are compared as FR-104 / FR-105 resolve them, gestures included;
  - `terminal-reserved-keys.test.ts`: no Ctrl+Shift+Alt default is in the reserved or shadowable
    tier, and the recorded-exception list stays at four;
  - `chord-capture.test.ts` / the capture-modal component test: a Ctrl+Shift+Alt press records the
    physical token whatever the layout produced.

  FR-021's line-editor check for every tier-1 chord is recorded in research.md R22.
- **FR-110** *(implemented in commit `3b04ec33`; the requirement it satisfies)*: A **window
  command** — one scoped EVERYWHERE that acts on no panel's content — MUST survive a focused
  transient surface: a terminal, whose focused element is xterm's helper textarea, and an editor's
  find bar. `tabs.openPicker` was missing from `isPanelScoped`'s window-command exemptions
  (`packages/ui/src/renderer/keybindings/scope.ts`), so its chord was dead whenever a terminal or a
  find bar held focus; `3b04ec33` adds it and a unit test from a focused terminal. The audit is a
  unit test in `packages/ui/tests/unit/scope.test.ts`: every `ActionId` whose `COMMAND_SCOPES` entry
  is EVERYWHERE MUST either be exempt in `isPanelScoped` or be named on an explicit
  **deliberately panel-scoped** list with its reason, and a new EVERYWHERE command on neither MUST
  fail it. `menu.open` is EVERYWHERE and not exempt today; the audit MUST classify it one way or the
  other *(whether Shift+F10 is silenced in a focused terminal as a result is a **hypothesis**, to be
  settled by that test, not assumed)*.

#### Project context menu and Unload (#411)

- **FR-030**: Right-clicking a project row MUST open a context menu, and so must Shift+F10 or the
  context-menu key on a focused row. It uses the app's shared context-menu component and conventions:
  keyboard navigation, Escape closes and returns focus to the row, items carry themeable icons, and
  sections follow the constitution's menu vocabulary.
- **FR-031**: The menu MUST offer **Edit**, **Rename** and **Remove**. Each MUST behave exactly as
  its existing route does: the inline Edit control, double-click rename (002 FR-041), and the inline
  Remove control with its confirmation (003 FR-023/024, 011 FR-030–035) and unsaved-editor guard
  (006 FR-006a). The inline controls MUST remain.
- **FR-032**: The menu MUST offer **Unload**. Unload closes every tab and panel of the project in the
  main window, releases its editors, and returns its row to the unloaded style (006 FR-051).
  - *Recorded 2026-09-23 (plan R8, constitution "a preference picks the default; the menu offers
    every variant"):* the menu draws three Unload rows, not one — **Unload** (the configured default
    action, FR-034a), **Unload and Keep Terminals Running** and **Unload and End Terminals** (the two
    named variants, FR-034). FR-030–FR-032 say what the menu MUST offer and do not cap it, so the two
    variant rows are additive to this FR rather than a widening of it.
  - *Superseded by FR-081 (Session 2026-09-23, iterate round 1):* two rows, not three. The plain
    **Unload Project** row, and one row naming the action the preference does NOT pick. The
    constitution rule the note cites is still met: the plain row runs the preference's choice and is
    labelled for the action, and the only variant that differs from it is named.
- **FR-033**: Unload MUST NOT forget anything. The project's saved layout, tabs, panels, colour,
  settings and category MUST be kept, and selecting the project again MUST load it with the layout it
  had when it was unloaded.
- **FR-034**: Unload MUST apply one of two **terminal actions** to the project's terminals:
  - **Keep running** follows Principle III's project-close rule. A terminal whose shell is idle is
    closed and re-created when the project is next loaded. A terminal running a process keeps running
    in the background and reattaches when the project is next loaded.
  - **End terminals** ends every terminal of the project, running processes included.
  *Keep running superseded by FR-086 (Session 2026-09-23, iterate round 1; constitution v5.6.0
  Principle III exception): it keeps every terminal, idle shells included. End terminals is
  unchanged.*
- **FR-034a**: A new preference, **Unload project: default terminal action** (proposed key
  `projects.unloadTerminalAction`, values `keepRunning` | `endTerminals`), MUST choose the action
  that applies when no dialog is shown and that the dialog offers as its default button. It ships as
  **`keepRunning`**. It appears in the preferences editor with a label and a description, like every
  other setting.
  *Superseded in part by FR-081 / FR-085 (Session 2026-09-23, iterate round 1): with the choice
  dialog removed, the preference decides the plain **Unload Project** row's action, and which action
  the second row names. Key, values, default and editor entry are unchanged.*
- **FR-034b**: A new confirmation level, **Unload project with running terminals** (proposed key
  `confirmations.unloadProject`, values `none` | `single` | `double`), MUST sit beside the existing
  `confirmations.destroyProject`, `destroyTab`, `destroyPanel` and `destroySubWorkspace`, with the
  same values, the same control, the same group, and the same **`double`** default. The dialog
  wording and labels follow the other confirmations (003 FR-023/024).
  *Narrowed by FR-085 (Session 2026-09-23, iterate round 1): the level now governs only the
  confirmation before terminals are **ended**. Keeping them running never prompts. Key, values and
  default are unchanged. The label should name ending terminals (derived; not confirmed by the
  maintainer).*
  *Superseded by FR-111 (iterate round 1 checkpoint, 2026-09-24): no Unload prompts, so this level
  has nothing to govern and is withdrawn.*
- **FR-034c**: The dialog MUST appear only when at least one terminal of the project is running a
  process. An idle shell is closed under either action, so without a running process the two actions
  are the same and nothing needs asking. When it appears:
  - `none`: no dialog. The default terminal action (FR-034a) applies.
  - `single`: one dialog names the running processes and offers **Keep running**, **End terminals**
    and **Cancel**. The button for the default terminal action has initial focus.
  - `double`: as `single`, and choosing **End terminals** asks a second confirmation before anything
    ends. Choosing **Keep running** asks nothing more, because nothing is lost.
  *Superseded by FR-085 (Session 2026-09-23, iterate round 1): no dialog offers Keep running / End
  terminals / Cancel.*
- **FR-034d**: Cancel at any step MUST leave the project loaded and unchanged.
  *Still binding under FR-085: cancelling the End Terminals confirmation, at either step, leaves the
  project loaded and unchanged.*
  *Under FR-111 the only step left is the unsaved-editor prompt (FR-035), whose Cancel already
  leaves the project loaded and unchanged.*
- **FR-035**: If any editor of the project holds unsaved changes, Unload MUST first raise the same
  unsaved-editor prompt Remove raises. Cancelling it MUST leave the project loaded and unchanged.
  Unload asks for no other confirmation beyond FR-034c.
  *Read with FR-085 in place of FR-034c (Session 2026-09-23, iterate round 1): the unsaved-editor
  prompt is unchanged, and it precedes End Terminals' confirmation.*
  *Read with FR-111 (iterate round 1 checkpoint): the unsaved-editor prompt is unchanged, and it is
  the only prompt Unload raises.*
- **FR-036**: Unloading the **active** project MUST leave no project active. The workspace shows the
  state it shows at startup before any project is chosen. The next project the user selects loads as
  usual.
- **FR-037**: Unload MUST NOT affect panels of the project that are open in a sub-workspace window.
  Those stay open, and Principle XI's retention rule applies to them.
- **FR-038**: Unload MUST be present and disabled on a project that is already unloaded.
  *Read with FR-081: both Unload rows are present and disabled on an unloaded project.*
- **FR-081** *(Session 2026-09-23, iterate round 1; supersedes FR-032's three-row Recorded note)*:
  The project menu MUST offer exactly **two** Unload rows, in the section the Unload rows use today
  (View & state, `project-menu.ts`):
  - **Unload Project**, which applies `projects.unloadTerminalAction` (FR-034a) whatever its value;
  - one row for the **other** action: **Unload Project and End Terminals** when the preference is
    `keepRunning`, and **Unload Project and Keep Terminals Running** when it is `endTerminals`.

  The second row's label and action follow the preference live: a change in Preferences shows on the
  next menu open, with no restart. The row named for the default action is never drawn, because it
  would be a second row for the plain row's command (006 FR-030).
- **FR-085** *(Session 2026-09-23, iterate round 1; supersedes FR-034c and US4 scenarios 7–9)*:
  **No Unload row may ask which terminal action to take.** Both rows state their action before the
  click. So:
  - an Unload whose action is **keep running** MUST NOT show any terminal dialog;
  - an Unload whose action is **end terminals** MUST show the destructive confirmation set by
    `confirmations.unloadProject` **only when at least one terminal of the project is running a
    process**: `none` shows none, `single` shows one confirmation naming the running processes,
    and `double` shows it and then a second. With only idle shells it MUST show nothing;
  - the unsaved-editor prompt (FR-035) still comes first, whatever the action.

  *Derived, and the first answer to challenge:* the maintainer said "I would not expect a prompt to
  appear for any options". The End Terminals confirmation is kept anyway, because it confirms a
  destruction the user already chose rather than asking which action to take, and because the
  maintainer's first session asked for exactly this confirmation, at `double` by default. If the
  maintainer means *no* prompt at all, the fix is to drop this bullet and FR-034b. SC-005a then no
  longer holds.
  *The End Terminals bullet superseded by FR-111 (iterate round 1 checkpoint, 2026-09-24): the
  maintainer means no prompt at all. The first bullet and the unsaved-editor bullet stand.*
- **FR-086** *(Session 2026-09-23, iterate round 1; supersedes FR-034's Keep running bullet;
  constitution v5.6.0 Principle III stated exception)*: An Unload that keeps terminals running MUST
  keep **every** terminal of the project alive, idle shells included, and MUST reattach each one
  (live session and restored scrollback) when the project is next loaded, never re-creating it.
  Nothing about the terminal may be lost: its process, working directory, environment and history
  stay as they were. The kept terminals MUST still end when the project is deleted, and under "terminate
  all" on app close. At app close, a kept idle shell follows the ordinary idle-shell rule and is
  closed *(derived: the exception covers the Unload only; not confirmed by the maintainer)*.
  *(Analyze, 2026-09-24: that app close closes an idle shell is a **hypothesis**. No production
  path calls `closeIdle` at app close. T124 settles it, and T153 records a gap if there is one.)*
  *(T153, 2026-09-25: settled — **not met**, and never has been. No production path closes an idle
  shell at app close: the app-close prompt in `main.ts` is raised for any live session, idle ones
  included; *Leave running* sends nothing, so every session survives; *Terminate all* sends
  `killAll {}`; the daemon runs no idle sweep at shutdown. `closeIdle`'s only production caller was
  Unload, removed by T128, so the RPC now has no caller. This was found only by reading the code and
  was never reproduced by hand, so per the repo's rule it is not filed as an issue. The app-close
  sentence above stays as the
  end-state requirement (constitution III, 005 FR-015b). 046 does not deliver it; it is recorded as a
  pre-existing known violation in plan.md's Complexity Tracking; not filed — unreproduced; recorded
  in PR #440's description for the maintainer to reproduce and file.)* The
  process-level E2E for Unload (T065) MUST assert that an idle shell survives Keep Terminals Running
  and is the same process after reload, instead of asserting that it is reaped.
- **FR-111** *(iterate round 1 checkpoint, 2026-09-24; supersedes FR-085's End Terminals bullet,
  FR-034b, US4 scenario 13 and SC-005a, and with them the first maintainer session's request for an
  unload confirmation level)*: **No project-menu Unload row may show a confirmation prompt of any
  kind** — not **Unload Project**, and not its opposite-action row (FR-081), whatever
  `projects.unloadTerminalAction` is and whether or not a terminal is running a process. Each row
  states its outcome in its label before the click, and the click carries it out:
  - an Unload that keeps terminals running keeps them (FR-086), with no dialog;
  - an Unload that ends terminals ends every terminal of the project, running processes included,
    with no dialog.

  The **unsaved-editor prompt** (FR-035) is not an unload confirmation: it guards unsaved documents,
  Remove raises the same one, and it stays, ahead of the action *(derived; not confirmed by the
  maintainer)*. The `confirmations.unloadProject` setting (FR-034b) is **withdrawn**: its descriptor
  and its control leave the Preferences editor, and its parse and planner inputs are removed, because
  a preference that changes nothing misleads the user who sets it (and is dead code, Principle
  VIII) *(derived)*. A value already
  saved in a development `settings.json` is left in the file as an unmodelled key, which the write
  path preserves; 046 never shipped in a release, so no user migration is owed. The unload planner
  (data-model §8) keeps no confirm step. `projects.unloadTerminalAction` and both rows are unchanged.

  *Superseded in part (implementation, 2026-09-25): "which the write path preserves" is wrong. The
  settings write path (`writeConfigPatch`, `packages/ui/src/main/config-write-ipc.ts`) normalises
  every write through `parseSettingsGuarded`, which **drops** every key the schema does not model.
  So a saved `confirmations.unloadProject` is dropped by the next settings write, not preserved. That
  is the precedent 019 FR-023 set for a retired key (`explorer.openMode`): a key that no longer
  governs anything is dropped rather than migrated, which changes nothing the user sees, here because
  the dialog it configured no longer exists. The contract test
  `packages/ui/tests/contract/config-write-patch.contract.test.ts` asserts the drop, and a patch to
  the withdrawn key is not persisted while its neighbour `destroyProject` is untouched. No migration
  is owed either way, because 046 never shipped in a release.*

#### Project categories (#292)

- **FR-050**: Every project MUST belong to exactly one category. A **default category**, named "In
  Progress" as a shipped default rather than a literal in the UI code (Principle X), MUST always
  exist. It MUST be listed first, and it cannot be deleted or minimised by any route. It can be
  renamed.
- **FR-051**: A category other than the default MUST be minimisable and expandable from its header
  row, by clicking it or with the keyboard (FR-018). A minimised category MUST show its name and the
  number of projects it holds, and its projects, except the active one (FR-052), MUST NOT be listed,
  clickable or reachable by any switch route.
- **FR-052**: The active project MUST never be hidden by a minimise. If its category is minimised,
  the active project's row stays visible under the collapsed header. Once another project becomes
  active, that row is hidden with the rest of the category.
- **FR-053**: Users MUST be able to create, rename and delete categories. Creating and moving happen
  from a project's context menu: **Move to Category**, listing the existing categories and **New
  Category…**. Renaming, deleting and minimising happen from a category header's context menu and
  keyboard route. Category names MUST be non-empty, unique regardless of case, and trimmed.
  **Recorded** (controller ruling, US4-B fix round): "creating and moving happen from a project's
  context menu" names ONE control, not two — choosing **New Category…** from a project's own Move to
  Category submenu creates the category AND moves that project into it, at the end.
- **FR-054**: Deleting a category MUST move its projects into the default category, keeping their
  relative order and appending them after its existing projects. No project is deleted or altered.
- **FR-055**: Drag-to-reorder (002 FR-046) MUST keep working within a category. Dropping a project in
  another category's section MUST move it into that category at the drop position. Dropping onto a
  minimised category's header MUST move it into that category at the end. Category headers are not
  draggable in this spec.
  *"Category headers are not draggable" superseded by FR-083 (Session 2026-09-23, iterate round 1).
  Where a project drag may start is widened by FR-075.*
- **FR-056**: Categories are listed with the default first and the rest in creation order. An empty
  category MUST still be listed, with a count of 0, so it can be a drop and move target.
  *"The rest in creation order" superseded by FR-083 / FR-084 (Session 2026-09-23, iterate round 1):
  the rest follow a user-set order. The default is still first, and the empty-category clause is
  unchanged.*
- **FR-057**: Category membership, category names and order, and each category's minimised state
  MUST persist across restarts.
- **FR-058**: Existing projects MUST be migrated into the default category in their current order,
  with no user action. A database written before this feature MUST read correctly, and the migration
  MUST be covered by the schema-drift guard.
- **FR-059**: A newly created project MUST land in the default category.
- **FR-060**: Categories are presentation only. They MUST NOT change what switching into a project
  does, project isolation (Principle I), or a minimised project's configuration, layout, panels,
  colour or terminals. Minimising a category does not unload its projects.
- **FR-061**: Every new control (the category header's minimise toggle and any action control) MUST
  be a themeable icon control with a hover title, drawn from theme tokens.
- **FR-072** *(Session 2026-09-23, iterate round 1)*: Every category header row, the default
  category's included, MUST draw a highlighted background and its name in **bold uppercase**. The
  background colour MUST come from a theme token, new or existing, that is listed in the theme editor
  with a description (Principle X, configuration-editor completeness). The uppercase is a display
  style: the stored name and the rename field keep the user's casing, and the count is unaffected.
  A new token ships through the additive shipped-defaults upgrade, so existing theme files receive it
  (FR-079's version 13).
- **FR-075** *(Session 2026-09-23, iterate round 1; extends FR-055 and 002 FR-046)*: A project drag
  MUST be able to start from anywhere on the row that is not itself an interactive control. That
  covers the grip, the name, the colour swatch and the row's empty space. It excludes the inline
  **Edit** and **Remove** buttons and any open rename or edit input. The grip stays. A press that
  does not move past the drag threshold MUST stay a click: it switches project as it does today
  (FR-082), and a double-click on the name still renames (002 FR-041). Drop targets and outcomes are
  FR-055's, unchanged, and keyboard reordering is still out of scope.
- **FR-083** *(Session 2026-09-23, iterate round 1; supersedes FR-055's "headers are not draggable",
  FR-056's creation order and the Out-of-scope line "Reordering categories by drag")*: Users MUST be
  able to reorder every category **except the default**, which is always listed first:
  - by **dragging a non-default category's header** to a new position among the non-default
    categories. The default category's header is not draggable, and no drop may place a category
    above it;
  - by **Move Category Up** and **Move Category Down** in a non-default category header's context
    menu. Move Category Up is disabled on the first non-default category, and Move Category Down on
    the last (Principle VI, disabled when unavailable). Neither item is drawn on the default
    category's menu (absent when meaningless). They sit in the Navigate section, beside the other
    ordering items *(derived; not confirmed by the maintainer)*.

  A category moves with its projects and its minimised state. A drag on a header never moves a
  project, and a project drag never moves a category.
- **FR-084** *(Session 2026-09-23, iterate round 1)*: The category order MUST persist per owner
  across restarts (FR-057). A new category, created by any route, MUST be appended after every
  existing category. The order MUST be stored by a **new migration, v10**, which adds an explicit
  position to categories and seeds it from today's order (creation order), so an upgraded list looks
  exactly as it did. v9 MUST NOT be edited, because it has already run on the maintainer's
  development database. v10 MUST be idempotent: a second run changes nothing, and a test asserts the
  re-run. It MUST be covered by the schema-drift guard (FR-058).

#### Cross-cutting

- **FR-070**: Every new command (`project.next`, `project.previous`, `focus.explorer`,
  `focus.projects`) MUST be reachable from a menu
  (Principle VI) and listed in the keybindings editor (configuration-editor completeness).
  *"Reachable from a menu" superseded by FR-074 (Session 2026-09-23, iterate round 1; constitution
  v5.6.0 Principle VI). The keybindings-editor clause stands.*
- **FR-071**: The user docs MUST describe the new commands, their defaults, Unload, and categories,
  in the same change (documentation currency).
- **FR-088** *(Session 2026-09-23, iterate round 1)*: The same change MUST update the user docs
  (`README.md`, `docs/`, `CONTRIBUTING.md`) for every behaviour this round alters. That covers the
  remapped chords and the convention behind them, the two Unload rows and the prompts that remain,
  Keep Terminals Running keeping idle shells, the cog menu without Navigate, category reordering,
  and whole-row project drag. It also covers `docs/testing.md`'s description of the Unload E2E
  (FR-086) and of the chord E2E, whose presses change (FR-077). `CHANGELOG.md` records the chord
  changes as a user-visible change to shipped defaults.
  *Read with FR-111 (implementation, 2026-09-25): "the prompts that remain" is now one prompt — the
  unsaved-editor prompt (FR-035), which Remove raises too. Neither Unload row asks anything about
  terminals, so the docs describe no unload confirmation and no `confirmations.unloadProject`.*
- **FR-112** *(iterate round 1 checkpoint, 2026-09-24; extends FR-088)*: The same change MUST bring
  `README.md`, `docs/` (the keyboard reference in `docs/quick-start.md` first) and `CONTRIBUTING.md`
  to the agreed convention: the three tiers and their exceptions; every FR-102 default, written in
  the FR-105 form (`Ctrl+Shift+Alt++`, never `Num+` or `Plus`); the keypad `+` / `-` / `0` being
  the same binding; the Ctrl wheel and middle-click zooming the panel under the pointer; the cog
  menu's Zoom row; `Ctrl+E W` as a two-stroke chord; and Unload never prompting. `docs/testing.md`
  follows the E2E presses that change. `CHANGELOG.md` records the moved defaults, the unbound plain
  Ctrl++ / Ctrl+- / Ctrl+0, and the withdrawn unload confirmation setting as user-visible changes.
  *Extended by FR-119 (iterate round 3, 2026-09-25) for FR-116 and FR-117's chords.*

#### Maintainer mid-build decisions (2026-09-25)

- **FR-113** *(Session 2026-09-25, maintainer, mid-build; supersedes FR-107's Zoom row and the "plus
  the cog menu's Zoom row" clause of its #390 close text)*: The title-bar cog menu MUST NOT carry a
  Zoom row, or a **View & state** section for one. "Remove the new "Zoom" options from the menu"
  (the maintainer, verbatim). The cog menu returns to the single Application section (FR-074's rule,
  the 2026-09-09 audit shape). The window zoom's only routes are its keyboard chords: `zoom.in`
  **Ctrl+Shift+Alt++**, `zoom.out` **Ctrl+Shift+Alt+-**, `zoom.reset` **Ctrl+Shift+Alt+Numpad0**
  (FR-114). There is no mouse route to the window zoom.
  - Consequence, stated plainly: a user whose layout turns `Ctrl+Alt` into AltGr, or who works only
    with the mouse, has no way to change the window zoom other than these chords. FR-107's reason for
    the row (a non-chord route for those users) is not met; the maintainer's instruction is taken as
    accepting that trade.
  - On the German, Nordic, Spanish and Italian layouts FR-104's own cost list already names, the
    dedicated `+` / `-` keys do not carry the tier-1 chord (they are AltGr-shifted there, excluded by
    FR-104's own AltGr decline); only the keypad `+` / `-` reach `zoom.in` / `zoom.out` on those
    layouts. A keyboard with no keypad has no route to `zoom.in` / `zoom.out` on those layouts either,
    and no route at all to `zoom.reset`, on any layout (FR-114).
  - FR-107's retirement of `Ctrl+Shift+0` stands. #390 still closes on this change; its close text
    MUST say the global zoom reset is **Ctrl+Shift+Alt+Numpad0**, that there is no mouse or menu
    route to it, and that the `Ctrl+Shift+0` it asked for is retired. FR-107's "no other item joins
    the cog menu" clause (from FR-074) stands unchanged — it now has nothing left to except.
- **FR-114** *(Session 2026-09-25, maintainer, mid-build; supersedes the `zoom.reset` and
  `panel.zoomReset` rows of FR-102's table, and the "keypad `+`, `-` and `0` are the same binding"
  reading of FR-105, for these two commands only)*: `zoom.reset` and `panel.zoomReset` MUST bind to
  the **physical Numpad0 key**, not the main-row `0`:
  - `zoom.reset` **Ctrl+Shift+Alt+Numpad0** (was Ctrl+Shift+Alt+0, FR-102);
  - `panel.zoomReset` **Ctrl+Alt+Numpad0**, plus **Ctrl+MiddleClick** unchanged (was Ctrl+Alt+0 /
    Ctrl+MiddleClick, FR-102).

  The main-row `0` key MUST NOT fire either reset, in any tier, in any scope. The match is on the
  physical code `Numpad0` (`KeyboardEvent.code`), the same physical-match style FR-104 already uses
  for tier 1, so a keyboard with NumLock off — which still reports `code: 'Numpad0'` while the
  produced `key` changes — still fires the binding, because the match reads `code`, never the
  produced character. A keyboard with no numeric keypad has **no keyboard route** to either reset:
  `zoom.reset` has none at all (also no mouse or menu route, FR-113); `panel.zoomReset` keeps
  `Ctrl+MiddleClick`.

  This is an explicit, named exception to FR-105's "no `Numpad…` token is ever emitted" rule, for
  these two commands only. Every other keypad key keeps FR-105's same-binding rule unchanged: `+` and
  `-` still fire `zoom.in` / `zoom.out` / `panel.zoomIn` / `panel.zoomOut` from the keypad exactly as
  the main-row key does, with no separate token.

  Token display form: `Ctrl+Alt+Numpad0` and `Ctrl+Shift+Alt+Numpad0`, written out WITH the
  `Numpad0` name — unlike FR-105's `+` / `-` rule, which is written as the bare symbol with no `Num`
  prefix, because those keys still have a main-row form to write instead and these two no longer do.
  *Checked against the code (2026-09-25): `packages/core/src/config/keybindings.ts` ships
  `zoom.reset: ['Ctrl+Shift+Alt+0']` and `panel.zoomReset: ['Ctrl+Alt+0', 'Ctrl+MiddleClick']` today.
  `packages/ui/src/renderer/config/chord-key.ts`'s `digitCandidate` and
  `packages/core/src/config/chord-capture.ts`'s `sameBindingSymbolOfCode` currently alias `Numpad0`
  to the bare `'0'` / `Digit0` token for every command and never emit a `Numpad…` string — that
  blanket alias is the general FR-105 rule this FR carves its one exception into; it becomes a
  two-command exception, not a removed rule. Neither `eventToToken` (the Key Bindings editor / menu
  shortcut renderer) nor the capture modal has an existing `Numpad0` display form and both need one.*
  A unit test guard MUST fail on a shipped `zoom.reset` or `panel.zoomReset` default written as
  `Digit0` / the produced `0` rather than `Numpad0`, and MUST fail on any OTHER command shipping a
  `Numpad…` token (FR-105's rule stays general everywhere else).

  *Amended (derived, 2026-09-25, convergence T168): the "explicit, named exception... for these two
  commands only" language above describes which commands SHIP a `Numpad0` default — it is not a
  claim that the keypad `0` resolves as the same binding as the main-row `0` for every other command.
  It does not: the resolver treats `Numpad0` as its own physical token for every command, shipped or
  user-bound, and FR-105's same-binding rule for `0` never applied there in the code this FR was
  checked against. A user who binds another command to `Ctrl+Alt+0` in Key Bindings fires it only
  from the main-row `0`; the keypad zero fires nothing for that command and records its own
  `Ctrl+Alt+Numpad0` capture. `zoom.reset` and `panel.zoomReset` remain the only commands that SHIP a
  `Numpad0` default, so the shipped-default guard above (MUST fail on any OTHER command shipping a
  `Numpad…` token) is unchanged. FR-105's keypad `+` / `-` same-binding rule is unaffected and stands
  for every command. Rationale: the maintainer's instruction ("The 'Zoom Reset' key bindings need to
  use the numpad zero, NOT the 0 key") named these two commands because they were the only ones with
  a shipped `0`-family default; the earlier reading that kept keypad `0` equivalent to main-row `0`
  for every other command was a derived extension of the maintainer's separate `+` / `-` request, and
  no other shipped default ever used `0`, so the narrower reading was never exercised.*

  *Observed against this FR (maintainer, 2026-09-25, physical keyboard; recorded in FR-120):* with
  NumLock ON, Ctrl+Shift+Alt+Numpad0 resets the panel rather than the window. With NumLock OFF it
  does nothing, contrary to the "NumLock off still fires" claim above. The requirement stands, and
  FR-120 tracks the defect.
- **FR-115** *(Session 2026-09-25, maintainer, mid-build; supersedes the `zoom.reset` and
  `panel.zoomReset` rewrite TARGETS of FR-108's version-13 upgrade)*: `SHIPPED_DEFAULTS_VERSION`
  **13**'s rewrite of `zoom.reset` and `panel.zoomReset` targets FR-114's values, not FR-102's:
  - `zoom.reset`, still compared against the old shipped defaults FR-108 names (version-11
    `[Ctrl+0, Ctrl+MiddleClick]`, version-12 `[Ctrl+0, Ctrl+Shift+0, Ctrl+MiddleClick]`) → rewrites
    to **Ctrl+Shift+Alt+Numpad0**;
  - `panel.zoomReset`, still compared against the version-11 old value `[Ctrl+Alt+0]` → rewrites to
    **Ctrl+Alt+Numpad0, Ctrl+MiddleClick**.

  Every other row of FR-108 is unaffected: this FR changes only these two rewrite TARGETS, not the
  old values compared against, not the whole-row collision refusal, and not any other command's
  target. The collision comparison still uses the token FR-104 / FR-105 / FR-114 would resolve the
  same key to. The upgrade MUST remain idempotent under this change, and FR-108's existing re-run
  test is extended in place rather than duplicated.

#### Maintainer iterate round 3 decisions (2026-09-25)

Searched before writing, as the repo rule requires: `grep -rn` over `specs/*/spec.md` for the five
moved chords, `focus.workspace` and "back to the workspace", and `git grep` over `packages/*/tests`
for every `Shift+Alt+<B|N|M|F|P>` press (tasks.md T180 and T181 name the hits). The only requirements that
govern these chords are 046's own: FR-020, FR-102, FR-104's AltGr cost list, FR-108 and S18 – S21.
No other spec names a Ctrl+Shift+Alt letter. No requirement anywhere describes a keyboard route
from a side pane back to the workspace. FR-024 governs the five commands that might have been
widened instead, and it requires that they are not. 041 FR-020b's `focus.notice` chord was already
superseded by S19, and it moves again below.

- **FR-116** *(iterate round 3, 2026-09-25; extends FR-010, FR-015, FR-074, FR-087)*: A new
  command, **`focus.workspace`**, MUST move keyboard focus to the **active tab's active panel** in
  the centre workspace. Its effect MUST be exactly the one a directional move ending on that panel
  has (`goToPanel(activeTabId, activePanelId)` in `app.tsx`):
  - the workspace becomes the active pane, with its outline on that panel, and the keyboard scope
    becomes that panel's;
  - DOM focus goes to the panel's input surface: the editor's caret, the terminal's input, or the
    preview's scroll surface. The next keystroke acts there.

  It MUST NOT switch tab, panel or project, and MUST NOT change either side pane's visibility. With
  no active project, no active tab, or a tab with no panel, it MUST do nothing and raise no notice
  *(derived; FR-011's rule for an end of the list)*. When the workspace already holds the active
  pane, it MUST still move DOM focus into the active panel *(derived)*. It is scoped
  **EVERYWHERE**, like every other `focus.*` command. As a window command it MUST survive a focused
  terminal or find bar (FR-110). The `focus.` prefix already exempts it in `isPanelScoped`, and
  FR-110's audit MUST classify it. A chord bound to it MUST NOT reach the shell or the editor (FR-010).
  It is **keyboard-only**. No menu carries it, and the Key Bindings editor lists it in **Focus &
  Zoom** with a label and a description *(label "Focus Workspace", derived)*. Constitution v5.6.0
  Principle VI ("A chord MAY stand without a menu item") allows that for a command that moves the
  user between surfaces and acts on no panel. `focus.workspace` is such a command, and this spec
  says it stands on its chord alone. FR-024 is unchanged: `focus.left/right/up/down/cycle` still
  never reach a side pane, and none of them is widened to leave one.
  Test layer *(Principle V)*: the lowest layer that renders the side panes and the workspace through
  the real `KeybindingsHandler` is the component layer (`side-pane-focus-commands.test.ts`), which
  `window-chords.ts`'s `COVERED_IN_COMPONENT` claims. No E2E is added.
- **FR-117** *(iterate round 3, 2026-09-25; supersedes FR-102's `focus.notice`,
  `view.toggleProjects`, `view.toggleExplorer`, `focus.explorer` and `focus.projects` rows, and
  FR-020's chords for the last two)*: The Windows shipped defaults for these commands MUST be as
  below. All are tier 1, `Ctrl+Shift+Alt`, matched on the physical key (FR-104). "Before" is the
  version-13 default.

  | Command | Surface | Before (v13) | Default |
  |---|---|---|---|
  | `focus.projects` | left pane | Ctrl+Shift+Alt+P | **Ctrl+Shift+Alt+B** |
  | `focus.workspace` (new, FR-116) | centre | — | **Ctrl+Shift+Alt+N** |
  | `focus.explorer` | right pane | Ctrl+Shift+Alt+F | **Ctrl+Shift+Alt+M** |
  | `view.toggleProjects` | left pane | Ctrl+Shift+Alt+B | **Ctrl+Shift+Alt+J** |
  | `view.toggleExplorer` | right pane | Ctrl+Shift+Alt+N | **Ctrl+Shift+Alt+K** |
  | `focus.notice` | notices | Ctrl+Shift+Alt+M | **Ctrl+Shift+Alt+V** |

  **Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P become unbound**. No shipped default takes either.
  Every other FR-102 / FR-114 row is unchanged, including `project.next` / `previous`,
  `tabs.openPicker`, the directional `focus.*` and the zoom commands. The three focus commands and
  the two toggles are each a group sharing one set of modifiers (constitution IV, FR-101). FR-102's
  three checks apply to each new chord, and research R22's iterate-round-3 check records them:
  - **Not reserved.** No token here is in constitution IV's reserved or shadowable tier. Those tiers
    are `Ctrl+<letter>` without Alt, and the enforcing test matches exact tokens.
  - **No collision.** No shipped default binds J, K or V with any modifier. `focus.notice` on V is
    therefore free, as the maintainer's condition "if it is not already reserved" asks. B, N and M
    change owner in the same change, so no two defaults share a chord.
  - **FR-021's line-editor check.** On Windows xterm treats `Ctrl+Alt` with a letter as a
    third-level shift and sends no bytes on keydown, and the window listener captures a bound chord
    first. No hosted shell loses anything.
  - **Layout cost.** On the seven common layouts (FR-104), J, K and V lose no AltGr+Shift
    character. N keeps its one known loss, Polish `Ń`, now to `focus.workspace`. Unbinding P gives
    US-International `Ö` back. AZERTY moves only M, to the key labelled `,`.

  *Reading of "all shortcuts use Ctrl+Shift+Alt" (derived; not confirmed by the maintainer):* the
  sentence is taken to govern the shortcuts it goes on to name, all of which are tier-1 navigation.
  It is not taken as a remap of tier 2 or tier 3, which the checkpoint convention (FR-101) keeps.
- **FR-118** *(iterate round 3, 2026-09-25; extends FR-108, supersedes its rewrite targets for the
  five FR-117 rows)*: `SHIPPED_DEFAULTS_VERSION` MUST become **14**. Version 13 MUST NOT be edited.
  The maintainer's development config and every hand-testing build of this branch already hold a
  version-13 marker. `main.ts` runs the upgrade only when the saved marker differs from the shipped
  version, so a change to version 13 would never reach them. This is the precedent the file's own
  history records at 043 (6 → 7) and 044 (8 → 9): the bump serves exactly the unreleased builds
  that no fresh-install test represents. Version 14:
  - MUST rewrite a saved binding to its FR-117 default **only** when the saved array is still
    set-identical to a named earlier shipped value for that action. The sources are FR-108's
    version-11 and version-12 values, plus the new **version-13 values**:
    - `focus.notice` `[Ctrl+Shift+Alt+M]`;
    - `view.toggleProjects` `[Ctrl+Shift+Alt+B]` and `view.toggleExplorer` `[Ctrl+Shift+Alt+N]`;
    - `focus.explorer` `[Ctrl+Shift+Alt+F]` and `focus.projects` `[Ctrl+Shift+Alt+P]`.

    The target is always the current shipped value, so an install at version 11 or 12 moves
    straight to FR-117's chord in one pass. No intermediate version-13 chord is ever written;
  - MUST use FR-108's collision guard unchanged: scope-aware, compared as FR-104 / FR-105 / FR-114
    resolve the key, and computed as a fixed point over the rows that actually move. The five rows
    move together, so `focus.projects` taking B while `view.toggleProjects` gives up B is not
    refused. It is refused when `view.toggleProjects` is customised and still holds B, and then
    `focus.projects` keeps its saved chord;
  - MUST handle **`focus.workspace`**, which no saved file contains. `parseKeybindings` fills an
    absent action on every read with no collision check. Where Ctrl+Shift+Alt+N would collide, by
    FR-108's comparison and in an intersecting scope, with a binding that stays after this pass's
    rewrites, version 14 MUST write `focus.workspace: []` into the saved file. That makes it
    visibly unbound in the Key Bindings editor instead of silently sharing the user's chord.
    Otherwise it MUST leave the action absent, and the per-read fill supplies N *(derived; the
    controller's ruling)*;
  - MUST be idempotent. A second run plans nothing, and a test asserts the re-run, including a file
    where `focus.workspace: []` was written.

  No theme payload rides version 14.
- **FR-119** *(iterate round 3, 2026-09-25; extends FR-088 and FR-112)*: The same change MUST bring
  the docs to FR-116 and FR-117:
  - `README.md`'s keyboard lines;
  - `docs/quick-start.md`, first its keyboard reference table and pane chord line, then its AZERTY
    and AltGr disclosure, which gains J, K and V and moves N, M and B to their new owners;
  - `docs/testing.md`, where it quotes an E2E title or press that names a moved chord;
  - `CHANGELOG.md`'s `## Unreleased`. 046 is unreleased, so the new chords are recorded as the
    shipped defaults, not as a change from version-13 chords no release carried. The AltGr
    `### Known issues` line is updated to match.

  `CONTRIBUTING.md` changes only if it states a chord (T145 found none). No keybinding or setting
  description in `packages/*/src` hard-codes a moved chord (checked 2026-09-25). If one appears, it
  is updated in the same change.

#### Open defect under reproduction (2026-09-25) — kept separate from FR-116 – FR-119

- **FR-120** *(placeholder, resolved and specified below; maintainer, 2026-09-25, physical keyboard)*: Observed: "Ctrl+Shift+Alt+Numpad0
  does not reset the window zoom — with NumLock ON it resets the active panel's zoom instead; with
  NumLock OFF nothing happens." This answers T149's NumLock probes (a) and (b) (research R22). Both
  halves contradict requirements already stated:
  - FR-113 / FR-114 / SC-017 require Ctrl+Shift+Alt+Numpad0 to reset the **window**. With NumLock
    ON it resets the panel;
  - FR-114 claims that a keyboard with NumLock off "still reports `code: 'Numpad0'`" and therefore
    still fires. With NumLock OFF nothing fires.

  The requirements stand. This FR records the defect and does not specify a fix. The NumLock-ON half
  fits research R22's recorded **hypothesis**: Windows synthesises a Shift key-up when Shift is held
  on the keypad with NumLock on, so the press arrives as Ctrl+Alt+Numpad0, which is `panel.zoomReset`.
  That is a hypothesis, not a root cause. The NumLock-OFF half has no hypothesis yet. A reproducing
  test is being written in parallel. What resolves this FR, and whether FR-114's NumLock claim or the
  Numpad0 choice itself needs revisiting, is for the maintainer once the repro is confirmed (tasks.md
  T189 / T190).

  *Resolved and specified (maintainer, 2026-09-25, confirmed on a fresh build):* "It should work in
  both instances." The maintainer confirmed the NumLock-ON half on a fresh build. The NumLock-OFF
  "nothing happens" was a **stale build**; on a fresh build NumLock OFF resets the window as FR-114
  says. That half is **not a defect** and is dropped, and FR-114's NumLock-off claim stands.

  The NumLock-ON half is now a measured root cause, no longer a hypothesis. Hardware scan codes
  injected with `SendInput` into a bare Electron 44.4.3 window on Windows 11 read these keydowns
  (research R22):

  | NumLock | Pressed | `code` | `key` | `shiftKey` | `getModifierState('NumLock')` |
  |---|---|---|---|---|---|
  | ON | Ctrl+Shift+Alt+Numpad0 | `Numpad0` | `Insert` | **false** (a synthesised Shift key-up precedes it) | true |
  | ON | Ctrl+Alt+Numpad0 | `Numpad0` | `0` | false | true |
  | OFF | Ctrl+Shift+Alt+Numpad0 | `Numpad0` | `Insert` | true | false |
  | OFF | Ctrl+Alt+Numpad0 | `Numpad0` | `Insert` | false | false |

  So with NumLock ON the tier-1 press arrives shaped like Ctrl+Alt, and FR-105's same-binding rule
  resolves it as `panel.zoomReset`. The one thing that tells it apart from a genuine NumLock-OFF
  Ctrl+Alt+Numpad0 is the NumLock state itself.

  Every keydown resolver and the Key Bindings capture MUST therefore treat a keypad digit key
  (`Numpad0` – `Numpad9`, `NumpadDecimal`) that reports its **navigation** `key` (`Insert`, `End`,
  `ArrowDown`, `PageDown`, `ArrowLeft`, `Clear`, `ArrowRight`, `Home`, `ArrowUp`, `PageUp`, `Delete`)
  with `shiftKey` false while NumLock is **ON** as a press with **Shift held**. With NumLock on and
  no Shift, the same key reports its digit, so this reading cannot mistake an unshifted press. The
  consequences:
  - the window listener resolves NumLock-ON Ctrl+Shift+Alt+Numpad0 to `zoom.reset`, and a genuine
    Ctrl+Alt+Numpad0 still resolves to `panel.zoomReset` with NumLock ON (`key` `0`) and OFF (`key`
    `Insert`, NumLock off);
  - the capture modal records the NumLock-ON press as `Ctrl+Shift+Alt+Numpad0`, the chord the user
    pressed, never `Ctrl+Alt+Numpad0`;
  - where the NumLock state cannot be read (an event without `getModifierState`), behaviour is
    exactly what it was before this FR.

  The rule is written in `@throng/core` beside `sameBindingSymbolOfCode` and `tier1PhysicalKey`, and
  the renderer reuses it, so the two cannot drift *(derived; the file's own rule)*. Test layer
  *(Principle V)*: a synthetic event carrying the measured fields, at the unit layer
  (`zoom-reset-numlock-shift.test.ts`, the resolver composition the window listener uses; core's
  `captureToken`), and the component layer for the real `KeybindingsHandler` and the capture modal.
  No E2E: a real keyboard's NumLock state cannot be set from Playwright, and the measured shapes are
  the thing a real keyboard sends.
- **FR-121** *(iterate round 4, 2026-09-26; qualifies 012 FR-002 / SC-001a, extends FR-073,
  FR-082, FR-116)*: The workspace's active-panel treatment (012 FR-002's outline and raised header,
  in both its foreground and its dimmed state) MUST show **only while the workspace holds the active
  pane**. While the Projects pane or the File Explorer holds it, no workspace panel carries the
  treatment, so the side pane's own outline (FR-073) is the only active indication in the window.
  The tab's active panel id MUST NOT change when the treatment is hidden: any route that makes the
  workspace the active pane again (FR-116's Ctrl+Shift+Alt+N, a click or pointer-down in the
  workspace, FR-082's routes) shows it on that same panel *(derived)*. 012 FR-002's two window states
  stand while the workspace holds the active pane: foreground → active, background → dimmed. A panel
  in a torn-off window, whose window has no side panes, is unaffected *(derived)*. Test layer
  *(Principle V)*: component, rendering the side panes and the workspace together and switching the
  active pane; the outline is a class on the panel frame, visible without an app launch.
- **FR-122** *(iterate round 4, 2026-09-26; extends FR-024)*: `focus.left`, `focus.right`,
  `focus.up` and `focus.down` MUST act **only while the workspace holds the active pane**. They move
  from the active panel. While the Projects pane or the File Explorer holds the active pane, the
  chord MUST do nothing: no panel is selected, focus stays where it is, the chord is consumed (it
  never reaches the project list or the tree) and no notice is raised *(derived; FR-011's rule for
  an end of the list)*. `focus.cycle` and `focus.cycleBack` are unchanged *(derived; the maintainer
  named only the arrows)*. FR-024 otherwise stands: none of the four reaches a side pane. Test layer
  *(Principle V)*: component, through the real window listener, with the active pane set to each side
  pane and to the workspace.
- **FR-123** *(iterate round 4, 2026-09-26; extends FR-091 / FR-092's "Second stroke")*: While a
  two-stroke prefix is pending, a modifier **held continuously since the first stroke** MUST NOT count
  as part of the second stroke. So holding Ctrl, pressing E, releasing E and pressing W completes
  **Ctrl+E W** and toggles word wrap. Releasing Ctrl before the W, FR-091's wording, still completes
  it too. A modifier released and pressed again for the second stroke does count, so a saved
  `Ctrl+E Ctrl+W` stays expressible and parses as it does today *(derived)*. The capture modal MUST
  apply the same rule, so the Ctrl-held sequence records `Ctrl+E W`. No shipped default changes, and
  no shipped-defaults version is added. A second stroke that is consumed while pending (FR-092)
  never runs a single-stroke command, so the W pressed with Ctrl held never runs whatever Ctrl+W is
  bound to, and never reaches the document. Test layer *(Principle V)*: unit for the stroke-matching rule, component for the editor's
  pending prefix and the capture modal, with a keyup of E and no keyup of Ctrl between the strokes.
  *Superseded by FR-124 (iterate round 5, 2026-09-26):* a modifier is matched exactly as held.
- **FR-124** *(iterate round 5, 2026-09-26; supersedes FR-123, FR-091's "Ctrl+E, released, then W",
  FR-092's space notation, its capture control and its "Second stroke MAY be a bare key" as pressed
  after a release, and 007 FR-033's single press-and-release capture for a two-stroke chord)*: A
  two-stroke chord is **one continuous press**: hold its modifiers, press the first key, then the
  second, the modifiers still held. It is written **`Mods+K1,K2`** (`Ctrl+E,W`;
  `Ctrl+Shift+Alt+J,K`), the maintainer's notation.
  - **Matching is exact.** The second key completes the chord only while every modifier of the
    first stroke is still held. A modifier added for the second key is part of it
    (`Ctrl+E,Shift+W`) *(derived)*. Releasing any modifier of the first stroke before the second key
    ends the pending prefix at once, silently, and the next key is handled as it would be with no
    prefix *(derived)*. FR-092's scope, first-stroke modifier, pending indication, Escape, focus-loss
    and 4-second endings, collisions and "not bound" notice otherwise stand.
  - **Word wrap** ships **`Ctrl+E,W`**. A saved `keybindings.json` whose `editor.toggleWordWrap` is
    still the version-13/14 default `Ctrl+E W` moves to it through shipped-defaults **version 15**,
    by FR-108's guarded rewrite; a customised row is byte-identical *(derived; FR-118's mechanism)*.
  - **Parsing.** A comma separates the strokes except where it is itself a stroke's key, as `+` is in
    `Ctrl++` (`Ctrl+,,W` is Ctrl+comma then W) *(derived)*. A saved space-separated two-stroke token
    (written only by unreleased 046 builds) is read as its comma form *(derived)*.
  - **Capture.** The Key Bindings capture box records nothing until **every key, modifiers
    included, is released**. One key pressed under the held modifiers records `Mods+K`; a second key
    pressed while they are still held records `Mods+K1,K2`. A third key is refused inline: "Only two
    keys can follow the modifiers." *(derived; longer sequences stay out of scope)*. The
    "record a two-stroke chord" control is **removed**. Bare Escape still closes the box.
  - **Display.** The Key Bindings row, the menu item, the pending indication and the "not bound"
    notice show the comma form.
  Test layer *(Principle V)*: unit for parsing, formatting and the version-15 planner; component for
  the editor's pending prefix and the capture box, with explicit keyups of every key.
- **FR-125** *(iterate round 5, 2026-09-26; applies constitution v5.6.0 Principle XI "Focus follows
  the active Panel"; extends 012's move-focus hardening and FR-116)*: When a keyboard route (a
  `focus.*` chord, `focus.workspace`, a tab switch) makes a panel the active panel, DOM focus MUST move
  into it: to the control inside it that last held focus, else its first focusable control. For an
  **untyped panel** that is its panel-type picker; for **Find in Files** its search box. Every panel
  type MUST register a focus target, so no route leaves the caret in the panel it left. The
  Projects-list switch stays the exception (FR-082). Test layer *(Principle V)*: component, a real
  editor beside each target type under the real window listener, asserting where
  `document.activeElement` lands.
- **FR-126** *(iterate round 6, 2026-09-26; extends FR-124, supersedes its two-key limit and
  FR-092's "Longer sequences are out of scope")*: A chord MAY carry up to **three keys** under its
  held modifiers: `Mods+K1,K2,K3` (`Ctrl+E,W,Q`), one continuous press, matched exactly as FR-124
  matches two. Everything FR-124 says of the second key holds for the third: every first-stroke
  modifier still held, an added modifier part of that key, a release ending the prefix silently.
  The pending indication names the keys pressed so far. A shorter chord that is a prefix of a longer
  one in an intersecting scope is a collision, as FR-092's first-stroke rule already is *(derived)*.
  In the capture box a **fourth** key is refused inline, "Only three keys can follow the modifiers.",
  and the refused key is dropped. The box is not stuck: releasing every key then records the chord
  as it stood before the refused key, and the notice clears *(derived; the maintainer's "the user
  should still be able to release the modifier keys and apply their latest chord")*. The same holds
  for any other inline capture refusal that leaves a valid chord behind *(derived)*. Parsing,
  formatting, display, collisions and the shipped-defaults upgrade treat a three-key chord as one
  binding. Test layer *(Principle V)*: unit for parse and format; component for the engine and the
  capture box.
- **FR-127** *(iterate round 7, 2026-09-26; narrows FR-114 for `panel.zoomReset`; constitution
  v5.6.0 Principle IV's new named exception)*: `panel.zoomReset` MUST ship **`Ctrl+Alt+0`** (the
  main-row 0) as a second keyboard chord, after `Ctrl+Alt+Numpad0` and before `Ctrl+MiddleClick`.
  It is matched on the produced `0`, so an AltGr+0 that types another character (`}` on German,
  `@` on AZERTY) never fires it *(derived; R2's AltGr reason for excluding `Digit0` from
  same-binding matching)*. A saved `keybindings.json` whose `panel.zoomReset` is still the
  version-15 default gains it through shipped-defaults **version 16**, by FR-108's guarded
  rewrite; a customised row is byte-identical, and a collision with a binding the user kept
  refuses the row *(derived; FR-118's mechanism)*. `zoom.reset` is unchanged: the main-row 0
  still resets no window zoom. Test layer *(Principle V)*: unit for the default, the tier and
  one-chord guards and the version-16 planner; component for the resolver on US and German
  layouts.

### Supersessions

| # | Superseded | What changes | What stays | Why |
|---|---|---|---|---|
| S1 | 003 FR-007 (rail text "Files & Folders"), and the wording "Files & Folders" in 006 FR-015/016/070, 023 FR-022 and 044's *Reveal File in Files & Folders* | The pane, its rail and that menu item are called **File Explorer** | Every behaviour those FRs require. Only the name changes | #331: one name, the one both configuration editors and Principle XI already use |
| S2 | 003 FR-035, "MUST then remain in memory for the session" | A loaded project can be unloaded by the user (US4) | Lazy load, and nothing selected at startup. A project stays loaded until the user unloads it or the app closes | #411: the only way to release a project today is to quit or remove it |
| S3 | 002 FR-046 (drag reorder over one flat list) | Reordering happens within a category, and a drop across a boundary moves the project into that category (FR-055) | Reordering by drag, persisted | #292 introduces categories |
| S4 *(iterate round 1)* | 012's per-panel zoom defaults on the Ctrl+Alt family (`contracts/commands-and-tokens.md`), and `zoom.reset`'s Ctrl+Shift+0 from FR-025 | Panel zoom moves to Ctrl+Shift+= / - / 0. The app-wide zoom gains Ctrl+Alt+= / - / 0 (FR-077) | Both commands, their scopes and bounds, 012 FR-008's composition, and the bare Ctrl+= / Ctrl+- / Ctrl+0 app-wide routes | Constitution v5.6.0 modifier convention |
| S5 *(iterate round 1)* | 006 FR-023 (Save All on Ctrl+Shift+S) and the Save As default Ctrl+Alt+S | Save All on Ctrl+Alt+S, Save As on Ctrl+Shift+S (FR-077) | Save All's scope setting and both commands' behaviour | As S4 |
| S6 *(iterate round 1)* | 024 FR-003b (word wrap on Ctrl+Alt+W) | Ctrl+Shift+W (FR-077) | FR-003c's don't-shadow rule (EDITOR_ONLY, no shell sees it) and FR-001c | As S4 |
| S6a *(iterate round 1, after review; supersedes S6's chord)* | 024 FR-003b and 024's Assumptions note rejecting "`Ctrl+E` then `W`" | Word wrap ships the two-stroke **Ctrl+E W** (FR-091), on a new two-stroke capability (FR-092) | FR-003c, met by keeping the chord EDITOR_ONLY, and FR-001c / FR-003d | The maintainer's decision. 024's two grounds, no engine and a terminal shadow, are answered by FR-092 and by scope |
| S13 *(second review, 2026-09-24)* | S4 (panel zoom to Ctrl+Shift), S9 (Replace All to Ctrl+Shift+Enter), and 012 FR-015's `focus.cycle` / `cycleBack` chords | Withdrawn: panel zoom and Replace All keep their chords. Focus cycling moves to Ctrl+Shift+PageDown / PageUp (FR-095) | 012 FR-015's behaviour, and the directional chords | The maintainer's three tiers |
| S14 *(second review, 2026-09-24)* | 026's pane toggles on Ctrl+Alt+B / N, 041 FR-020b's Ctrl+Alt+M and 031 FR-032a's Ctrl+Alt+T | Ctrl+Shift+B / N / M and Ctrl+Shift+Tab (FR-095) | Every behaviour, and 026's refusal of bare Ctrl+B / N | Navigation is tier 1 |
| S12 *(iterate round 1, after review)* | S5, S7 and S8 above | Withdrawn: Save All, Save As, Quick Open and Find / Replace in Files keep their chords (FR-089) | 006 FR-023, 033 FR-002 and 043 FR-029 stand as written | The maintainer's recorded exceptions to the convention |
| S7 *(iterate round 1)* | 033 FR-002 (Quick Open on Ctrl+Shift+T) | Ctrl+Alt+G (FR-077) | Everything else about Quick Open | As S4 |
| S8 *(iterate round 1)* | 043 FR-029 (Find / Replace in Files on Ctrl+Shift+F / Ctrl+Shift+H) | Ctrl+Alt+F / Ctrl+Alt+H (FR-077) | FR-028's EVERYWHERE scope and FR-029d's on-direction replace behaviour | As S4 |
| S9 *(iterate round 1)* | 013's `search.replaceAll` default Ctrl+Alt+Enter | Ctrl+Shift+Enter (FR-077) | Live only with the find bar open in an editor | As S4 |
| S10 *(iterate round 1)* | 005 FR-015b (an idle shell is closed when its project is closed) | Not applied to an Unload that keeps terminals running: idle shells are kept and reattached (FR-086) | FR-015b for app close and every other project close (app close: a hypothesis at analyze, 2026-09-24; see FR-086, T124, T153). *T153, 2026-09-25: FR-015b is kept as the requirement but is not met at app close, and never was — a pre-existing known violation in plan.md's Complexity Tracking; not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file* | Constitution v5.6.0 Principle III stated exception |
| S11 *(iterate round 1)* | 026 FR-030 (saved bindings left untouched) | A saved binding still equal to an old shipped default is rewritten to the new one, with a collision guard (FR-079) | Every user rebind stays byte-identical | The FR-025 Recorded-note precedent (043 FR-074/FR-075): an untouched default is not a user choice |
| S15 *(iterate round 1 checkpoint, 2026-09-24)* | 012 FR-015's directional chords `Ctrl+Alt+Left/Right/Up/Down`, and S13's move of `focus.cycle` / `cycleBack` | Directional focus moves to **Ctrl+Shift+Alt+Arrow** (FR-102). S13's move to Ctrl+Shift+PageDown / PageUp is withdrawn: cycling keeps Ctrl+` / Ctrl+Shift+` | 012 FR-015's behaviour (layout order, no wrap on a directional move) and its cycle chords | The agreed tiers: navigation is Ctrl+Shift+Alt |
| S16 *(iterate round 1 checkpoint)* | 003 FR-033's zoom shortcuts (Ctrl+= / Ctrl++, Ctrl+-, Ctrl+0) and gestures (Ctrl+wheel, Ctrl+middle-click) on the window zoom, 012's Assumptions line on global zoom (Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel), and 046's own FR-025 / FR-099 / S4 window-zoom chords | The window zoom is **Ctrl+Shift+Alt++ / - / 0** plus the cog Zoom row (FR-102, FR-107). Plain Ctrl++ / Ctrl+- / Ctrl+0 are unbound. The gestures move to the panel zoom (FR-106) | 003 FR-033's "mapped into `keybindings.json` as editable bindings"; the window zoom's behaviour, step and bounds; 012 FR-014's separation of window and panel zoom | One chord per command; application actions are tier 1 |
| S17 *(iterate round 1 checkpoint)* | 012's per-panel zoom defaults (`panel.zoomIn` Ctrl+Alt+= and Ctrl+Alt++) | `panel.zoomIn` keeps **Ctrl+Alt++** only, with Ctrl+Alt and the unshifted `=`/`+` key matching it as the same binding (FR-105). The panel zoom gains the Ctrl wheel and middle-click (FR-106) | 012 FR-007 – FR-013: per-type zoom, its composition with the window zoom, persistence and bounds | One keyboard chord per command, plus one gesture |
| S18 *(iterate round 1 checkpoint)* | 026's pane-toggle chords `Ctrl+Alt+B` / `Ctrl+Alt+N` (chosen under 026 FR-028), and S14's move to Ctrl+Shift+B / N | **Ctrl+Shift+Alt+B / N** (FR-102) | 026 FR-028's refusal of bare Ctrl+B / Ctrl+N, FR-029's no-collision rule, and both toggles' behaviour | Navigation is tier 1 |
| S19 *(iterate round 1 checkpoint)* | 041 FR-020b (`focus.notice` on `Ctrl+Alt+M`), and S14's move to Ctrl+Shift+M | **Ctrl+Shift+Alt+M** (FR-102) | 041 FR-020 / FR-020a / FR-020c: what the command does and where it is live | As S18. It also retires research O1's `M-C-m` overlap |
| S20 *(iterate round 1 checkpoint)* | 031 FR-032a (`tabs.openPicker` on `Ctrl+Alt+T`) and FR-032c's compliance statement for that chord, and S14's move to Ctrl+Shift+Tab | **Ctrl+Shift+Alt+T** (FR-102); FR-021's check for it is research.md R22 | 031 FR-032a's behaviour at any tab count, FR-032b's rebindability | As S18. Its EVERYWHERE scope now actually holds from a terminal (FR-110) |
| S21 *(iterate round 1 checkpoint)* | 046's own FR-020 chords for `project.next` / `previous`, `focus.explorer`, `focus.projects`, and the second-review FR-094 – FR-100 | FR-101 – FR-108 | FR-010 – FR-018's behaviour; the FR-079 upgrade mechanism | The maintainer's agreed convention |
| S22 *(iterate round 1 checkpoint)* | #390's acceptance chord (Ctrl+Shift+0 resets the app-wide zoom) | Retired. The app-wide reset is **Ctrl+Shift+Alt+0** and the cog Zoom row; #390's close text says so (FR-107) | #390's intent: a reset reachable with the modifiers a user is already holding to zoom | Tier 1 holds Shift for every window zoom chord, so the reset is reached without letting go *(derived reading)* |
| S23 *(iterate round 1 checkpoint)* | The 2026-09-23 maintainer session's unload confirmation level (FR-034b, `confirmations.unloadProject`, shipped `double`), FR-085's End Terminals confirmation and SC-005a | No Unload row prompts; the setting is withdrawn (FR-111) | The unsaved-editor prompt (FR-035); `projects.unloadTerminalAction` and the two rows (FR-081) | The maintainer: no prompt for any option, "as they are all pre-determined before click" |
| S24 *(Session 2026-09-25, maintainer, mid-build)* | FR-107's Zoom row and the "plus the cog menu's Zoom row" clause of its #390 close text; S16 and S22's mention of the cog Zoom row | The cog menu's Zoom row is withdrawn; window zoom is keyboard-only, no mouse or menu route (FR-113) | FR-107's other content: the retirement of Ctrl+Shift+0, FR-074's single Application section, and #390 closing on this change | The maintainer, verbatim: "Remove the new "Zoom" options from the menu." |
| S25 *(Session 2026-09-25, maintainer, mid-build)* | FR-102's `zoom.reset` / `panel.zoomReset` rows, FR-105's keypad-0-same-binding reading for those two commands, and FR-108's rewrite targets for them | `zoom.reset` **Ctrl+Shift+Alt+Numpad0**, `panel.zoomReset` **Ctrl+Alt+Numpad0** (+ Ctrl+MiddleClick), matched on the physical `Numpad0` code (FR-114, FR-115) | Every other FR-102 / FR-105 / FR-108 row; `zoom.in` / `zoom.out` / `panel.zoomIn` / `panel.zoomOut`'s keypad same-binding rule | The maintainer, verbatim: "The "Zoom Reset" key bindings need to use the numpad zero, NOT the 0 key." |
| S26 *(Session 2026-09-25, controller ruling)* | 023 FR-030 (#144: "switching tabs/projects/panels still restores each open editor's scroll, caret, and active state"), **for a list-initiated project switch only** | A project switch made from the Projects pane list (click or Enter on a row, FR-018) leaves focus on the **Projects list**; the editor does not take focus (FR-082) | FR-030/#144's restore for a tab switch, a panel switch, and a project switch made by `project.next` / `project.previous` from the workspace (a panel already holds focus there, and the chord still delivers focus to the editor that mounts, per `editor-caret-persist.e2e.ts:173`); the editor's scroll/caret/selection view-state restore itself, on every route | The maintainer's round-1 instruction was explicit about dropping the old behaviour for this route: "keep the selected project activated instead of activating the middle panel like we used to" |
| S27 *(Session 2026-09-25, maintainer, iterate round 3)* | FR-102's rows for `focus.notice` (Ctrl+Shift+Alt+M, itself S19's replacement for 041 FR-020b), `view.toggleProjects` / `view.toggleExplorer` (Ctrl+Shift+Alt+B / N, S18's replacement for 026's chords), `focus.explorer` / `focus.projects` (Ctrl+Shift+Alt+F / P, S21's replacement for FR-020's); FR-108's rewrite targets for those five rows; and constitution v5.6.0 IV's record that 046 moves the pane toggles to Ctrl+Shift+Alt+B / N | `focus.projects` **B**, new `focus.workspace` **N**, `focus.explorer` **M**, `view.toggleProjects` **J**, `view.toggleExplorer` **K**, `focus.notice` **V**, all Ctrl+Shift+Alt. F and P are unbound (FR-116, FR-117). Saved bindings reach them through shipped-defaults version **14**, with version 13's values as a further guarded source (FR-118) | Every behaviour of the five commands; 026 FR-028's refusal of bare Ctrl+B / Ctrl+N; 041 FR-020 / FR-020a / FR-020c; FR-010 – FR-018; FR-024 (the directional and cycle commands are not widened); FR-101's tiers and FR-104's physical match; FR-108's mechanism and collision guard; version 13 unedited | The maintainer, verbatim: "There does not seem to be a way to get back to the center pane from the keyboard." and "Focus should be B, N and M (from left to right). Collapse / expand side panes should be J and K, from left to right. V for notices if it is not already reserved." |
| S28 *(Session 2026-09-26, maintainer, iterate round 4)* | 012 FR-002 / SC-001a's "the indicator persists", for a main window whose Projects pane or File Explorer holds the active pane | The workspace's active-panel outline and raised header show only while the workspace holds the active pane (FR-121) | 012 FR-002's active and dimmed states and their tokens, while the workspace holds the active pane; the active panel id; SC-012, which FR-121 generalises from a list switch to every side-pane focus | The maintainer, verbatim: "You should not show the focussed panel highlight box if the center pane is not focussed." |
| S29 *(Session 2026-09-26, maintainer, iterate round 5)* | FR-123; FR-091's "Ctrl+E, released, then W"; FR-092's space notation and its two-stroke capture control; 007 FR-033's capture on the first key-up for a two-stroke chord; shipped `editor.toggleWordWrap` `Ctrl+E W` | Two-stroke chords are one continuous press, written `Mods+K1,K2` and matched exactly as pressed; word wrap `Ctrl+E,W` through shipped-defaults version 15; the capture box records on the release of every key and has no two-stroke control (FR-124) | FR-092's scope, pending indication, endings, collisions and notice; 007 FR-033 for a single-stroke chord's value | The maintainer, verbatim: "the user is in control of the buttons; they express how they press the keys, and that exact expression should be repeatable in both the app, and the preferences window." and "surely `CTRL+E,W` would be a better way to express it?" |
| S30 *(Session 2026-09-26, maintainer, iterate round 6)* | FR-124's two-key limit and its "Only two keys can follow the modifiers." refusal; FR-092's "Longer sequences are out of scope" | Up to three keys under the held modifiers (`Mods+K1,K2,K3`); a fourth is refused and dropped, and releasing every key records the chord as it stood (FR-126) | Everything else in FR-124 and FR-092 | The maintainer, verbatim: "Can we expand this to three keys?" and "the user should still be able to release the modifier keys and apply their latest chord." |
| S31 *(Session 2026-09-26, maintainer, iterate round 7)* | FR-114's "the main-row key no longer resets either zoom", for `panel.zoomReset` | `panel.zoomReset` ships `Ctrl+Alt+0` as a second keyboard chord, through shipped-defaults version 16 (FR-127) | FR-114 for `zoom.reset`; the `Numpad0` physical match; the AltGr guard | The maintainer, verbatim: "Add Ctrl+Alt+0 as a secondary default keybinding for "reset panel zoom"" |

### Key Entities

- **Project**: an existing entity. It gains a **category** (exactly one) and a **position within that
  category**. Nothing else about it changes.
- **Category**: a name, an order among categories, a **minimised** flag, and whether it is the
  default. There is exactly one default category, and it is never minimised.
  *(iterate round 1, FR-083/FR-084):* the order is an explicit, user-set position, stored from v10.
  The default is always first.
- **Unload preferences**: the default terminal action (`keepRunning` | `endTerminals`, default
  `keepRunning`) and the unload confirmation level (`none` | `single` | `double`, default `double`).
  Both are user settings in the preferences editor.
  *(iterate round 1 checkpoint, FR-111):* the confirmation level is withdrawn. Only the default
  terminal action remains.
- **Loaded state**: per project, per session. The user can now clear it (Unload). It is not
  persisted: every project starts unloaded after a restart, as today.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A search of the shipped sources and user docs for "Files & Folders", "Files &amp;
  Folders" and "Files and Folders" returns zero matches.
- **SC-002**: With focus anywhere in the app, a user moves to the next project with one chord and no
  pointer movement, and the shell receives nothing in 100% of attempts.
- **SC-003**: From any focused surface, one chord puts focus on the File Explorer or the Projects pane,
  hidden or not, and the next keystroke acts there.
- **SC-004**: Ctrl+Shift+0 resets zoom to 100% from every focused surface. Ctrl+0, Ctrl++ and Ctrl+-
  behave as before.
  *Superseded by SC-009 (Session 2026-09-23, iterate round 1).*
- **SC-005**: A project that is unloaded and selected again opens with the same tabs, panels and
  layout it had before the unload in 100% of cases.
- **SC-005a**: With shipped defaults, Unload never ends a running process unless the user has
  explicitly confirmed it twice.
  *Still holds under FR-085 (iterate round 1), whose End Terminals confirmation is two steps at the
  shipped `double`. It falls away only if the maintainer rejects FR-085's derived confirmation.*
  *Superseded by SC-015 (iterate round 1 checkpoint, 2026-09-24): the maintainer rejected it.*
- **SC-006**: After an upgrade, 100% of existing projects appear in "In Progress" in their previous
  order with no user action. Category membership and minimised state survive a restart.
- **SC-007**: A minimised category's projects cannot be switched into by click, keyboard cycle or list
  navigation. The one exception is the active project, which is never hidden.
- **SC-008**: `npm run gate` passes all eight stages.
- **SC-009** *(iterate round 1)*: From every focused surface, Ctrl+Alt+0, Ctrl+0 and
  Ctrl+MiddleClick return the app-wide zoom to 100% and leave every panel's own zoom as it was.
  Ctrl+Shift+0 returns only the active panel to its default size. The shell receives nothing in 100%
  of attempts.
  *Superseded by SC-013 (second review, 2026-09-24).*
- **SC-010** *(iterate round 1)*: A unit test over every shipped default finds zero chords that break
  the modifier convention (FR-076). After an upgrade, 100% of saved bindings that still equal an old
  shipped default carry the new one, and 100% of user-rebound bindings are byte-identical to what was
  saved (FR-079).
  *The convention clause is superseded by SC-013. The upgrade clause stands, over FR-100's rows.*
  *Now over FR-108's rows (iterate round 1 checkpoint).*
- **SC-011** *(iterate round 1)*: Choosing the Keep Terminals Running action never shows a dialog.
  After the next load, every terminal the project had, idle or running, is the same process with its
  scrollback.
- **SC-013** *(second review, 2026-09-24; supersedes SC-009's chords and SC-010's convention)*:
  - Ctrl+0 and Ctrl+MiddleClick reset the app-wide zoom, and Ctrl+Alt+0 resets only the active panel,
    from every surface, with the shell receiving nothing.
  - The FR-094 guard finds zero chords in the wrong tier outside FR-096's list.
  - A main-row press and a keypad press of `+` or `-` resolve and record identically in 100% of
    tiers.

  *Superseded by SC-014 (iterate round 1 checkpoint, 2026-09-24).*
- **SC-014** *(iterate round 1 checkpoint, 2026-09-24; supersedes SC-013)*:
  - Ctrl+Shift+Alt+0 and the cog menu's Zoom row reset the app-wide zoom, and Ctrl+Alt+0 and
    Ctrl+MiddleClick reset only a panel, from every surface, with the shell receiving nothing.
  - Every Ctrl+Shift+Alt default fires on the US, UK, German, French and Polish layouts in 100% of
    the FR-109 cases, whatever character the layout produces.
  - The FR-101 guard finds zero chords in the wrong tier outside FR-103's list, and the FR-105 guard
    finds no command with a second keyboard chord except `menu.open`.
  - A main-row press and a keypad press of `+`, `-` or `0` resolve and record identically in 100%
    of tiers.

  *Superseded in part by SC-017 (Session 2026-09-25): the cog-row bullet and the "or 0" clause of the
  keypad bullet no longer hold.*
- **SC-017** *(Session 2026-09-25, maintainer, mid-build; supersedes SC-014's cog-row bullet, and its
  keypad bullet for `0` on the two reset commands only)*:
  - Ctrl+Shift+Alt+Numpad0 resets the app-wide zoom, and Ctrl+Alt+Numpad0 or Ctrl+MiddleClick reset
    only a panel, from every surface, with the shell receiving nothing. Neither the cog menu nor the
    main-row `0` resets either zoom.
  - The cog menu carries no Zoom row and no View & state section; `menu-sections.test.ts` finds the
    single Application section only.
  - A main-row press and a keypad press of `+` or `-` still resolve and record identically in 100% of
    tiers (SC-014's bullet, unaffected for these two keys). A main-row `0` press and a `Numpad0` press
    do NOT resolve identically for `zoom.reset` / `panel.zoomReset`: only `Numpad0` fires them.
- **SC-015** *(iterate round 1 checkpoint; supersedes SC-005a)*: Choosing any project-menu Unload
  row never shows a dialog other than the unsaved-editor prompt, in 100% of attempts, whatever the
  terminals are doing.
- **SC-016** *(iterate round 1 checkpoint)*: With focus in a terminal or an editor's find bar, every
  EVERYWHERE window command's chord acts in 100% of attempts; the tab picker opens from a focused
  terminal. A command on FR-110's deliberately panel-scoped list is not a window command here.
- **SC-018** *(iterate round 3, 2026-09-25)*:
  - From the Projects pane, the File Explorer, a focused notice or a focused terminal,
    Ctrl+Shift+Alt+N puts keyboard focus in the active tab's active panel in 100% of attempts. The
    next keystroke acts there, and the shell receives nothing from the chord (FR-116).
  - Ctrl+Shift+Alt+B / N / M focus the left pane, the workspace and the right pane.
    Ctrl+Shift+Alt+J / K toggle the left and right panes, and Ctrl+Shift+Alt+V focuses the newest
    notice. Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P do nothing (FR-117).
  - After an upgrade from a version-11, 12 or 13 `keybindings.json`, 100% of untouched rows carry
    FR-117's chord. 100% of customised rows are byte-identical. `focus.workspace` never shares a
    chord with a binding the user kept (FR-118).
- **SC-019** *(iterate round 4, 2026-09-26)*:
  - While the Projects pane or the File Explorer holds the active pane, no workspace panel carries
    the active outline in 100% of checks. Returning to the workspace outlines the same panel as
    before (FR-121).
  - From either side pane, Ctrl+Shift+Alt+Arrows change neither the active panel nor focus in 100%
    of attempts; from a workspace panel they move as FR-024 describes (FR-122).
  - Ctrl+E W toggles word wrap in 100% of attempts whether Ctrl is held through the W or released
    before it (FR-123). *Superseded by SC-020's second bullet (round 5).*
- **SC-020** *(iterate round 5, 2026-09-26)*:
  - After any keyboard route into a panel, `document.activeElement` is inside that panel in 100% of
    checks, for every panel type, the untyped panel and Find in Files included (FR-125).
  - `Ctrl+E,W` with Ctrl held throughout toggles word wrap in 100% of attempts; with Ctrl released
    before W it never does. The capture box records what was pressed, and the recorded chord fires
    when pressed the same way, in 100% of attempts (FR-124).
  - Enter on a project row, visited earlier this session or not, leaves focus on the row in 100% of
    attempts (FR-082).
- **SC-021** *(iterate round 6, 2026-09-26)*: A three-key chord recorded in the capture box fires
  when pressed the same way in 100% of attempts; after a refused fourth key, releasing every key
  records the chord as it stood and closes the box in 100% of attempts (FR-126).
- **SC-012** *(iterate round 1)*: After a list click or Enter switches project, the Projects pane
  holds the active pane, and the outline never appears on the workspace until the user moves there.

## Assumptions

- The rail for the left pane already reads "Projects & Sub-workspaces" in the app, although 003
  FR-007 says "Projects & Terminals". That discrepancy is not in #331's scope and is left alone.
- The pane show/hide state lives where it lives today. The reveal in FR-016 uses the same mechanism,
  so it persists the same way.
- The Projects pane's keyboard scope reuses the scope already used for non-workspace panes, unless
  the plan finds a command that needs a scope of its own.
- The Edit and Remove inline controls are not altered by this spec, so replacing their glyphs with
  theme icons is not in scope. Any control that is added or altered comes under the themeable-icon
  rule (FR-061).
- The Sub-workspaces panel gets no context menu and no categories here.
- Unload does not persist across restarts: after a restart every project is unloaded anyway (003
  FR-035).

## Dependencies

- The shared context-menu component, the menu-section vocabulary and the cog menu (Principle VI).
- The keybinding tier guard (`terminal-reserved-keys.test.ts`) and the recorded-exception list
  (Principle IV).
- The persistence migration chain and the schema-drift guard, for categories (FR-058).

## Out of scope

- A project picker overlay in the style of Quick Open (#332).
- Creating, reordering, renaming or removing projects from the keyboard (#332). Rename through the
  context menu is in scope, but that is a menu route, not a new keyboard command.
- Changing `focus.left/right/up/down/cycle` (#332).
  *Behaviour still out of scope. The directional chords move to Ctrl+Shift+Alt+Arrow under FR-102
  (iterate round 1 checkpoint); `focus.cycle` keeps its chord.*
  *Still out of scope under FR-116 (iterate round 3): the route back to the workspace is the new
  command `focus.workspace`. None of these five changes.*
- Nested categories, a project in more than one category, and filtering or searching the list (#292).
- Reordering categories by drag. *Superseded by FR-083 (Session 2026-09-23, iterate round 1):
  non-default categories are reordered by drag and by Move Category Up / Down. Reordering from the
  keyboard alone, beyond those menu items, stays out of scope.*
- Renaming persisted identifiers (`explorer.*`, `file.*`, `view.toggleExplorer`) (#331).
- Per-project side-pane expanded state (#330).
- A context menu or categories for sub-workspaces.
