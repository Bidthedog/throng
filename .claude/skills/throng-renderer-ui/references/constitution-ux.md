# Discoverable UX and action controls — constitution detail

Binding: constitution Principle VI and Development Workflow & Quality Gates (`.specify/memory/constitution.md`, *VI. Simple, Modern, Discoverable UX; Development Workflow & Quality Gates › Action controls*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1 and amended since (v7.5.0: disclosure headings). This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Every panel action is reachable

**Every panel action is reachable.** A command the user cannot reach is a
command they do not have. What matters is that every action has a route, not that every
route is a menu: a menu item, a control, a status bar and a chord are each the right
answer for some commands, and most commands want more than one.

- Every **discrete command** or **state toggle** that acts on a Panel or its content
  MUST be accessible via a **mouse-click** or a **keyboard command**. A mouse-click
  route is a menu item, a toolbar or in-panel control, a header control, or a
  status-bar control. A keyboard command is a command listed in the Key Bindings
  editor, with or without a default chord.
- Which routes a command gets — menu item, status bar, chord, or any combination — is
  decided per command by the feature that adds it. Most commands SHOULD be reachable by
  a keyboard shortcut; not every command needs one.
- A route the user can hide — a status bar, a collapsible section, a hover-only
  control — MUST NOT be a command's only route: hiding it would remove the user's last
  way to reach the command.
- Where a menu item exists, it MUST show its command's current chord where one is
  bound, and a toggle MUST render its state (checked when on).
- A command reachable by keyboard alone MUST be listed in the Key Bindings editor with
  a label and a description, and documented, so it stays rebindable and discoverable
  there (configuration-editor completeness).
- A feature MAY add a menu item for any command where one helps the user browse what a
  panel can do; this rule removes the obligation, not the option. A requirement in a
  shipped spec that names a menu item stays binding until a later spec supersedes it.

## One section vocabulary for every menu

**One section vocabulary for every menu.** A menu is only browsable if its items are
grouped, and grouping is only learnable if every menu groups the same way. Each menu
inventing its own order teaches the user nothing transferable, so the vocabulary is the
application's, not the menu's.

- Every context menu MUST place its items in these sections, in this order, with a
  divider between adjacent sections and nowhere else:

  | # | Section | What belongs in it |
  |---|---|---|
  | 0 | **Contextual** | Items present only because of what the pointer is over. Lead the menu when present. The test is **"would this item be absent if the pointer were elsewhere?"** — nothing else qualifies |
  | 1 | **Content** | Acts on the item's content or its name: Rename, Cut, Copy, Paste, Select All, Undo, Redo |
  | 2 | **Create** | Makes something new: New File, New Folder |
  | 3 | **Navigate** | Takes you somewhere, or names where something is: Open In, Copy Path, Reveal, Go To Line, Sync to |
  | 4 | **View & state** | Toggles and per-surface state: Zoom, Word Wrap, Set Language, Hide |
  | 5 | **Application** | Whole-application destinations: Settings, Key Bindings, Themes, Open Logs Folder, About |
  | 6 | **Destroy** | Removes something: Delete, Close Panel, Destroy Tab, Destroy Panel. Ends the menu when present |

- Destroy sits last so that closing or removing is the final row of every menu. It was
  third, after Create, until v8.0.0 (the maintainer's v1 review, 2026-11-27).
- A divider MUST be drawn only at a real section boundary. A menu whose items fall in one
  section carries none, and no menu may begin or end with one — a divider is the rendering
  of a boundary, never a decoration placed by hand.
- Dividers MUST be skipped by keyboard navigation and MUST NOT take focus.
- Every menu item MUST declare the section it belongs to. An item with no section is a
  defect, not a default: the vocabulary only holds if it cannot be opted out of silently.
- Every shipped menu conforms, and a feature that adds a menu item places it in its section
  in the same increment. `section` is required on `MenuAction`; `menu-sections.test.ts` pins
  each shape.

## Disabled when unavailable, absent when meaningless

**Disabled when unavailable, absent when meaningless.** "Grey it out or hide it?" is
answered by which of two different situations the control is in, and answering it
per-control is how one surface teaches two contradictory lessons about what a greyed
row means.

- A control whose action is **temporarily unavailable** — the target exists but cannot
  be acted on right now, as with an empty undo stack or no open project — MUST be
  **drawn and disabled**. An action that exists and is unavailable teaches what the
  surface can do; one that vanishes teaches nothing, and leaves the user unsure the
  capability exists at all.
- A control whose action is **structurally meaningless** for the thing under the
  pointer — "Expand All Children" on a file, which can never have children — MUST NOT
  be drawn. A permanently dead row is not an affordance; it is noise that can never
  become useful however the user changes the application's state.
- The test is whether **any** future state of the application would enable it. If yes,
  disable it now. If no, do not draw it.

## One gesture follows a link, everywhere (known gap included)

**One gesture follows a link, everywhere.** A link that navigates on a plain click on one
surface and needs a modifier on another teaches the user to click warily on all of them, and
a plain click that navigates takes the gesture every content surface already uses to place
a caret or start a selection.

- A **link**, for this rule, is a reference rendered *inside content*: terminal output,
  document text, a rendered preview, and the body of a dialog or notice. Tree rows, list and
  result rows, tabs, buttons and menu items are not links; their click behaviour is their
  own (a Files & Folders row, for example, follows `editor.openOnClick`).
- A link MUST be followed by **Ctrl+click** (**Cmd+click** on macOS). A **plain click MUST
  NOT navigate**: it keeps its ordinary meaning on that surface — placing the caret, starting
  a selection, or nothing — and a modified click that drags is a selection, not an
  activation.
- Where a surface gives a link a **keyboard position** — a focused link, a caret inside a
  detected reference — **Ctrl+Enter** MUST follow it exactly as Ctrl+click does, through a
  rebindable command. It MUST NOT take Ctrl+Enter where no link holds that position: a shell
  keeps the chord (Principle IV, *Terminal keys belong to the terminal*).
- A link MUST show on hover that it is actionable, and by which gesture, so a plain click
  that does nothing is never a dead end. A panel's context menu opened over a link MUST
  offer **Open Link** and **Copy Link to Clipboard**, which is the menu route this principle
  requires for every action.
- This is an **end-state requirement** delivered incrementally under the Incremental
  Delivery rule, binding on new work immediately. **Known gap:** the **About window** follows
  its licence, repository and third-party links on a plain click (`about/about-app.tsx`).

## A preference picks the default; the menu offers every variant

**A preference picks the default; the menu offers every variant.** When a preference
decides which variant an action performs — a copy format, where a file or a link opens —
the preference sets what the plain gesture does, and the menu is where the user overrides
it once without changing the preference. A default the user cannot step around without a
trip to Settings is a default they cannot trust.

- The menu that offers such an action MUST list **each variant by name** ("Copy as Plain
  Text", "New Editor"), each performing that variant whatever the preference says.
- Where that menu also carries the **plain item** — the row the chord or click performs —
  it MUST run the preference's current choice and MUST be labelled for the **action**, never
  for a variant: "Copy", not "Copy as Rich Text". Labelled that way it is a different command
  from every variant row, so this rule does not put two rows naming one command on a menu,
  which 006 FR-030 and 043's clarification on the *Open In → Search* row forbid.
- Where no preference chooses between variants — a submenu of explicit targets with no
  default, such as **Copy Path ▸** or **Send to Tab ▸** — this rule adds nothing.

## Name the OS generically

**Name the OS generically.** throng runs on more than one operating system, and
copy that names one of them reads as wrong, or as a missing feature, on the others.

- User-visible text — preference descriptions, notices and toasts, menus, dialogs, tooltips
  and status text — SHOULD refer to the operating system as **the OS** ("an OS
  notification", "the OS blocks files dragged in…"), never as "Windows", "Linux" or "macOS".
- Product and format names that contain the word are names, not references to the OS, and
  stay as they are: **Windows PowerShell**, **Windows-1252** and the other code-page names,
  **Git for Windows**, and the **Absolute (Windows)** / **Relative (Windows)** path-form labels.
- Code comments, logs, specs and developer documentation are not user-visible text and may
  name the OS they describe.

## Name a setting for its behaviour (known gap included)

**Name a setting for its behaviour.** A setting MUST be named for the behaviour it turns on, so
that on, ticked or enabled always means the behaviour happens: **Terminal notifications**, never
*Ignore terminal notifications*. A name that negates a behaviour (*Ignore*, *Disable*,
*Suppress*, *Hide*, *Don't*) makes on mean off, and the user must invert every state they read,
in the preference editor, on a checkbox, on a toggle and in its title alike.

- This holds for preferences, per-panel settings and the controls and commands that flip them;
  its stored key follows the name, so a stored `true` means the behaviour happens.
- Known gap: *Quick Open hides excluded files* (`editor.navigation.quickOpenExcludeHidden`),
  which predates this rule and is renamed before its next change.

## One popup style

**One popup style.** A tooltip that looks one way over a tab, another over a button and
a third over a status figure tells the user these are three kinds of thing when they are one.

- A **popup** is any surface throng shows on hover or focus, or briefly after an action, and
  takes away by itself: tooltips (every `title` included), hover popovers and cards, hints,
  indicators, and confirmations. Menus, dialogs, pickers and notices are not popups; each keeps
  its own shared style.
- Every popup MUST be drawn in the **one popup style**: one background, text colour, border,
  radius, padding, type size, shadow and fade, defined once (`.throng-popup` and its
  `--throng-popup-*` values) from the theme's popup tokens. A popup's own rule says only where it
  sits, how wide it may grow, how its text wraps and whether it takes the pointer.
- The OS's own tooltip MUST NOT be shown: a `title` is drawn by throng's tooltip, in the popup
  style, in every window.
- `packages/ui/tests/unit/popup-style.test.ts` fails the build for a popup that restyles itself,
  one whose root does not wear the shared class, or a window that stops mounting the tooltip. A
  new popup is added to its list in the change that adds it.

## A menu row shows its key

**A menu row shows its key.** A key the user can press instead of opening the menu is only
learnable if the menu says so, and a row that hides its key on one menu while the same command shows
it on another teaches nothing about either.

- Every menu row whose command a key performs **in that context** MUST show that key beside its
  label. Submenu rows count; a submenu's parent row has no key of its own.
- A **rebindable** command shows the user's current binding, read live from Key Bindings
  (`firstBinding`), so a rebinding is reflected the next time the menu opens. An **unbound** command
  shows nothing; a menu never shows a key that does not work.
- A key the **surface handles itself**, outside Key Bindings — the editor's Ctrl+Z and Ctrl+Y, the
  grid's Delete, a preview's Ctrl+A — is shown as the fixed key, in the OS's own form.
- The key shown MUST be the one that performs that command where the menu was opened. A command
  whose key the surface takes for something else shows nothing there.
- The fixed keys have one home, `packages/ui/src/renderer/common/fixed-shortcut.ts`, which shows each in
  the OS's form (Cmd on macOS). A menu row names a fixed key through it, never as a literal string.
- `packages/ui/tests/unit/menu-shortcuts.test.ts` builds every swept menu with every command bound and
  fails a row that shows no key unless its `NO_KEY` entry says why, an entry whose reason no longer
  holds, and a key that is neither a live binding nor a fixed key. A new menu builder is added to its
  sweep in the change that adds it.
- **Known gaps:** the Key Bindings tab's chord menu, the Sub-workspaces panel's Minimise/Restore row and
  the Resource Monitor's node-action menus are built inline and are not yet in the sweep.

## A row goes on the menu of what it acts on

**A row goes on the menu of what it acts on.** A panel has two menus, and each row belongs on exactly one
of them. A row in the wrong menu is a row the user looks for in the other, and a row in both makes one
menu longer without making either easier to find.

- The **body menu** is the menu a right-click inside the panel's body opens, including the menu of an
  element inside it (a grid cell, row or column header, a preview image, a diagram, a link). It holds
  only what acts on the content under the pointer, and how the body shows that content:
  - the clipboard, Select All, Undo and Redo, and edits to the content (Insert ▸, Clear, Delete, Edit in
    Dialog…, Column Width);
  - finding and moving through the content: Find, Replace, Replace All, Go To Line…, Go to Heading…,
    Go to Row…, Go to Page…;
  - how the body draws it: Word Wrap, View Whitespace, Outlining, a grid's Wrap and Lock First Row or
    Column, a PDF's page layouts;
  - an element's own actions: Copy Image, Copy Diagram as Image, Open Link, and a diagram's Enter and
    Exit Focus Mode, which maximise that diagram and not the panel.
- The **title menu** (the panel header's menu, `workspace/panel-header-menu.ts`) holds what acts on the
  panel itself, its file, and its link to other panels:
  - the file: Save, Save As…, Revert, Reload from disk, Copy Path ▸, Print…, Find in File Explorer, the
    Open in OS rows, Open Preview and Open in Editor, an editor's language, encoding and line endings;
  - the panel: Split ▸, Send to Tab, Sync to, Refresh, Back and Forward, Zoom, Enter and Exit Focus
    Mode, a panel's own toggles (a terminal's Remember Command, Remember Directory and Notifications,
    Edit Long Cells in Dialog), Synchronise Scrolling, Flag, the failure rows, Destroy or Close Panel.
- **The test**, for a row not listed: would it still mean the same thing if the user had right-clicked
  somewhere else in the body? If yes, it acts on the panel or its file, so it is a title row. If what
  it does depends on what is under the pointer, or on the body's view of the content, it is a body row.
- A panel whose body menu would be left with no rows opens no body menu; it never opens an empty one.
- Nothing moves to a status bar under this rule. A status bar control may repeat a title row; the menu
  row stays.
- **How to apply it to a menu:** list the menu's rows with their sections (the fixtures in
  `menu-shortcuts.test.ts` build every swept menu), sort each row by the two lists and the test above,
  then move each misplaced row to the other menu, keeping its label, icon, section, shortcut and
  enablement. A row moved off a menu where it was the only route must arrive on the other menu in the
  same change (*Every panel action is reachable*). Amend the FR that placed it, in its owning spec.
- `packages/ui/tests/unit/menu-placement.test.ts` builds every body and title menu the key sweep builds
  and fails a title row on a body menu, or a body row on a title menu. A new row is added to its lists
  in the change that adds it.

## Quality gate — action controls are themeable icons with hover titles (known gaps included)

- **Action controls MUST be themeable icons with hover titles (NON-NEGOTIABLE).**
  Every interactive control that performs an action — toolbar buttons, row affordances, dismiss and
  clear controls, panel and tab chrome — MUST be presented as an **icon drawn from the active theme's
  icon set**, carrying a **hover title that names the action**, rather than a text label. The icon's
  glyph or image MUST be resolved through the theme's icon tokens, and its colours MUST derive from
  theme tokens; hardcoded CSS colours and inline SVG assets are prohibited, because a control the user
  cannot theme is a control outside the theming system (Principle X, Externalised Configuration).
  - **Exception — dialog decision buttons.** The buttons by which a user consents to or declines an
    action inside a dialog (for example Confirm / Cancel / Delete / Save) MUST retain text labels.
    Their label *is* the statement of the consequence being consented to; replacing it with an icon
    would remove the very information the dialog exists to convey. Their colours MUST still derive
    from theme tokens.
  - **Exception — disclosure headings.** A disclosure heading — a fold/expand control whose own
    visible text names what it opens, such as a Preferences section heading — need not carry a hover
    title. A title there would only repeat what the heading already shows, and gets in the way of the
    pointer moving down a list of them. Its accessible name is that visible text, and its open state is
    shown by its chevron and `aria-expanded`. The exception is that narrow: a chevron that is a button
    of its own, with no text inside it (a tree twisty, a results-group chevron), keeps its hover title,
    and every other part of the rule still binds the heading, its chevron included (v7.5.0, #717).
  - **Default dialog actions.** A dialog or modal that offers decision buttons MUST mark exactly one
    as its **default action** — the button Enter performs (or the chord the dialog states for it, such
    as Ctrl+Enter where the dialog holds an editor), which takes the consequence the dialog exists
    for — by drawing it in the theme's **Confirm** button type (the `confirmButton*` tokens), or the
    **Destroy** type when that default is destructive, so it stands apart from the other buttons'
    **Cancel** type at a glance. Colours MUST come from theme tokens only. A dialog whose only button
    dismisses it has no default and marks none.
  - **Toast controls.** Every button a notice offers — a toast, or its entry in the Notifications
    panel — MUST sit in the card's single control group at its **top-right**, to the **left** of Copy
    and Dismiss, read right to left as Dismiss, Copy, then the notice's own controls. A button MUST NOT
    be placed in the notice's content (its message or body), where it would land wherever the text
    happens to end and in a different place on every card. A link in the content is not a button and
    follows the link rule (Principle VI).
  - **Setting toggles.** An icon control whose pressed state *is* an on/off setting — a panel's own
    value or a preference, such as a terminal's Remember the last running command — MUST read its state
    at a glance and never invert it. **On**: the glyph in the theme's full-contrast text colour, on the
    surface's pressed background. **Off**: the glyph in the theme's muted text colour with a diagonal
    line struck through it, top left to bottom right. The glyph ships plain and the line is the off
    state's, drawn by the control, so a user's own icon set gets the same treatment and an icon never
    carries a slash of its own that the off state would double. Its hover title and accessible name
    are **"<setting>: enabled"** or **"<setting>: disabled"**, followed by the bound chord in
    parentheses when there is one. The rule does not cover a mode of the current search (Match Case),
    a view filter, a choice among several, or a disclosure: those keep their pressed state alone.
    Known gaps, setting toggles that predate this rule and use the accent colour with no line, titled
    with the action rather than the state: the editor status bar's View Whitespace and Word Wrap
    (`packages/ui/src/renderer/editor/status-strip.tsx`). Each is brought into line before that
    control's next change.
  A change that adds or alters an action control MUST NOT be considered complete, and a PR MUST NOT be
  merged, while that control uses a text label outside the stated exception, or takes its icon or
  colours from anywhere but the theme.
