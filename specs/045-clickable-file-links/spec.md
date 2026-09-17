# Feature Specification: Clickable File Links

**Feature Branch**: `feature/S045-I198-I394-terminal-and-file-links`

**Created**: 2026-09-17

**Status**: Draft

**Issues**: closes [#394](https://github.com/Bidthedog/throng/issues/394) (clickable file links in
Claude, editors and terminals). The same branch carries the fix for
[#198](https://github.com/Bidthedog/throng/issues/198) (one Ctrl+click on a terminal link opened it
twice), which is a defect with its own tests and no requirement here; this spec builds on its
guarantee (FR-043). Related, and not in scope: [#10](https://github.com/Bidthedog/throng/issues/10)
(file previews and the per-provider default open action, spec 044 — a **dependency**, see
*Dependencies*), [#104](https://github.com/Bidthedog/throng/issues/104) (Claude Code in a terminal
panel, the main source of file references), and
[#326](https://github.com/Bidthedog/throng/issues/326) (a wrapped terminal hyperlink is underlined only
on its first row — a long path that wraps meets the same defect, FR-007).

**Input**: The body of #394 — its *Intent*, *Proposed outcome*, *Scope and constraints*, *Existing
requirements to reconcile* and *Acceptance criteria* are binding — plus the maintainer's trigger for
it: their Claude Code status line prints OSC 8 hyperlinks whose target is a `file:///D:/...` **folder**
(the project folder). Those links work in Windows Terminal and are inert in throng, because 024 FR-019
routes only `http`/`https` targets out of a terminal and refuses `file:` by name.

---

## Background

What the maintainer sees today, and why:

- **Terminal output.** A compiler error at `src/foo.ts:42:7`, a stack-trace frame or a `git status`
  line is inert text. Only `http(s)` URLs and OSC 8 hyperlinks with an `http(s)` target can be
  followed (024 US7).
- **OSC 8 `file:` links.** A program can emit a hyperlink whose target is a `file:` URI. throng draws
  it and does nothing with it: 024 FR-019 names `file:` among the schemes that "MUST NOT be opened at
  all", 024 FR-019d offers Open Link only for `http`/`https`, and the terminal link-menu test pins the
  refusal (`packages/core/tests/unit/terminal-link-menu.test.ts:20`).
- **Whether a program emits OSC 8 at all is the program's decision.** Claude Code, on Windows, emits
  hyperlinks only when it detects a terminal it believes supports them — the `WT_SESSION` or
  `FORCE_HYPERLINK` environment variables, or a known `TERM_PROGRAM` — and otherwise prints the same
  references as plain text. throng sets none of these today. So the same status line is a hyperlink
  in Windows Terminal and plain text in throng, and this feature has to handle both (FR-011, FR-080).
- **Editors** show paths in comments, documentation, configuration and logs with no way to follow
  them.
- **#198, fixed on this branch.** Claude Code's full-screen interface reports mouse events and opens a
  link it is Ctrl+clicked on. A Ctrl+click on a link that throng had also resolved therefore opened the
  link twice. The fix keeps a Ctrl+click on a link throng resolved from reaching a mouse-reporting
  program. A Ctrl+click anywhere else still reaches the program, so links the program draws itself
  keep working through it. File links inherit that guarantee (FR-043).

## Terminology

| Term | Meaning |
|---|---|
| **file link** | A reference to a file or folder in a terminal's output or an editor's text that throng has resolved to an existing location. It is either a **detected path** or an **explicit file hyperlink** |
| **detected path** | Text that throng recognises as a path without the program or the document marking it up (FR-003) |
| **explicit file hyperlink** | A terminal hyperlink (OSC 8) whose target is a `file:` URI. It is judged on its **target**, never on its visible text (024's rule for hyperlinks) |
| **web link** | A link whose target is `http` or `https`, as 024 US7 already defines it. Nothing about web links changes here |
| **resolved target** | The single absolute location a file link names, and whether it is a **file** or a **folder** |
| **position** | The line, and optionally the column, a link carries (`:42`, `:42:7`, `(42,7)`) |
| **owning project** | The project the panel showing the link belongs to. A panel in a sub-workspace keeps its original project (Principle XI). A panel with no owning project has none |
| **in the project** | A resolved target inside the owning project's root folder. This is decided on the resolved location, not on how the link was written |
| **link target** | One of the four explicit ways to follow a file link: **Open in Editor**, **Open in Preview**, **Open in OS Explorer**, **Open in OS Default Program** (FR-030) |
| **default link action** | The preference that decides which link target Ctrl+click, Ctrl+Enter and the plain **Open Link** menu item use (FR-050) |
| **offered** | A link target that applies to a given link under FR-030. What is not offered is not drawn |

---

## Clarifications

### Session 2026-09-17 (answered by the maintainer)

- Q: The fallback order sends an out-of-project file to its OS default application, so one Ctrl+click
  on an `.exe` path printed by a terminal would run it. What happens when a link names something the
  OS would execute? → A: **Ctrl+click and the Open Link command MUST never run it.** Both routes fall
  through to Open in OS Explorer, with the file selected in its folder. Running it stays possible only
  through the explicit **Open in OS Default Program** menu item, which the user chose deliberately.
  Whether the OS would execute a file is decided by a stated, testable rule behind the platform
  abstraction (FR-039, FR-039a).
- Q: Should throng tell the programs it runs that it supports hyperlinks, so Claude Code emits OSC 8
  rather than plain text? → A: **Yes — `FORCE_HYPERLINK=1`, but only when the user's own environment
  does not already set it**, in either direction, and with a setting (shipped **on**) that turns it
  off. Faking `WT_SESSION` or a `TERM_PROGRAM` that names another terminal stays forbidden
  (FR-080 – FR-080d).

### Session 2026-09-17 (decisions taken while specifying — not yet confirmed by the maintainer)

- Q: #394 names the OS reveal item "Open in Explorer (OS)", while the panel header menus say "Open in
  OS Explorer". Which label wins? → A: **"Open in OS Explorer"**, the existing label, so one action has
  one name. The label comes from **023 FR-022/FR-024** (editor title menu) and **023 FR-019** (Files &
  Folders *Open In* submenu), and 044 FR-033 reuses it on the preview header. **033 FR-053** does not
  define the label. It stops 033's own grouping pass from changing *any* label, so it does not bind
  this feature, and using the existing label means no supersession is needed. The same reasoning
  renames the issue's other items. "Open in Throng Editor" becomes **"Open in Editor"**, the label 044
  FR-015 and FR-033 already use. "Open in Throng Preview" becomes **"Open in Preview"**, matching it.
  "Open in Default Programme (OS)" becomes **"Open in OS Default Program"**, which follows the "OS"
  prefix pattern and the codebase's spelling for software ("program").
- Q: The issue lists four menu items, but Principle VI requires **Open Link** and **Copy Link
  Address** on every link menu, and a **plain item** beside any named variants when a preference
  picks the default. What does the file-link menu hold? → A: Both. Open Link runs the default link
  action, and the four link targets follow it by name, each doing only what it names. Copy Link
  Address comes last (FR-031).
- Q: In a terminal, is a relative path tried against the terminal's current working directory before
  the project root? → A: **Yes, where throng knows the directory.** throng already reads each running
  terminal's live working directory (025, *The existing live working-directory seam*). A relative
  path printed by a command almost always means that command's directory (FR-023).
- Q: A leading-`/` path that is not a drive form exists both under the project root and at the
  filesystem root. Which wins? → A: **The project root.** This is #394's own example (`/test.txt` is
  the project's `test.txt`). The platform's own meaning of the path is tried second (FR-024).
- Q: A link carries a position, and its file's default open action is Preview. What does the default
  link action do? → A: **It opens an editor at that position.** A preview cannot reveal a line and
  column, and this is the reason 044 FR-054 gives for sending Find in Files results to an editor.
  An explicit **Open in Preview** still opens the preview (FR-052).
- Q: Does this feature add a way to move keyboard focus onto a terminal link? → A: **No.** #394 limits
  terminal Ctrl+Enter to "any keyboard navigation the terminal offers", and a terminal offers none
  today. Ctrl+Enter therefore stays with the program in every terminal (FR-046). The keyboard route to
  a terminal link stays the context menu opened with `menu.open` (024 FR-018c, FR-019d), which now
  carries the file-link items. A terminal link-navigation mode would be new scope for its own issue.
- Q: Does turning off file-link detection for terminals also switch off explicit file hyperlinks? →
  A: **No.** A program chose to emit an explicit hyperlink, and throng did not guess it, so explicit
  file hyperlinks follow the same rule as web links and stay active. The switch governs detected
  paths only (FR-060).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow a path printed in a terminal (Priority: P1)

A command in a terminal panel prints a file reference: a compiler error at `src/foo.ts:42:7`, a stack
frame, a `git status` line, or a file Claude Code says it changed. The user Ctrl+clicks it, and the file
opens at that line and column.

**Why this priority**: Following a path is the most repeated navigation in an agent-and-terminal
workflow. Today every one costs a copy into Quick Open or a hunt through Files & Folders.

**Independent Test**: In a terminal panel, print paths in each supported form (FR-003) with and
without positions, Ctrl+click each one, and check which file opens and where the cursor lands. Nothing
else in this spec is needed.

**Acceptance Scenarios**:

1. **Given** a terminal whose command printed `src/foo.ts:42:7`, and the file exists under the project
   root, **When** the user Ctrl+clicks it, **Then** `foo.ts` opens in an editor with the cursor at line
   42, column 7.
2. **Given** Claude Code running in a terminal panel names `packages/core/src/x.ts:118`, **When** the
   user Ctrl+clicks it, **Then** the file opens at line 118, and it opens exactly once.
3. **Given** the project at `C:\throng`, **When** the user Ctrl+clicks `C:\throng\test.txt`,
   `C:/throng/test.txt`, `/c/throng/test.txt`, `test.txt` or `/test.txt`, **Then** each one opens the
   same in-project file.
4. **Given** `D:\x\foo.ts`, `D:/x/foo.ts`, `\\server\share\x\foo.ts`, `//server/share/x/foo.ts`,
   `/d/x/foo.ts`, `/mnt/d/x/foo.ts` and `~/foo.ts` each name an existing file, **When** each is
   Ctrl+clicked, **Then** each resolves to that file.
5. **Given** `foo.ts(42,7)` is printed, **When** it is Ctrl+clicked, **Then** the file opens at line
   42, column 7.
6. **Given** `see src/foo.ts.`, `(src/foo.ts)`, `src/foo.ts,` and `src/foo.ts:` are printed, **When**
   each is hovered, **Then** only `src/foo.ts` is underlined. **Given** `"docs/My File.md"` is
   printed, **Then** the whole quoted path is one link.
7. **Given** text that looks like a path but names nothing that exists, **When** the user hovers it,
   Ctrl+clicks it or right-clicks it, **Then** it is not underlined, nothing opens, and the menu has no
   file-link items.
8. **Given** a terminal whose working directory is `packages/core` and which printed `src/x.ts`, and
   the file exists there, **When** it is Ctrl+clicked, **Then** `packages/core/src/x.ts` opens, not
   `src/x.ts` at the project root.
9. **Given** a plain click on any file link, **Then** nothing opens, and the click keeps its terminal
   meaning.

---

### User Story 2 - Follow a file hyperlink a program emits, including a folder (Priority: P1)

The maintainer's Claude Code status line emits an OSC 8 hyperlink to the project **folder**
(`file:///D:/git/throng`). In Windows Terminal a Ctrl+click opens that folder in the OS file manager. In
throng it does nothing. After this feature it works in throng, and a hyperlink to a file works too.

**Why this priority**: This is the report that started the feature, and 024 FR-019 currently forbids
it by name. It is a separate slice from US1 because it needs no path detection.

**Independent Test**: Print an OSC 8 hyperlink to a folder and one to a file, each with visible text
that differs from its target. Ctrl+click each, and right-click each.

**Acceptance Scenarios**:

1. **Given** an OSC 8 hyperlink whose target is `file:///D:/git/throng` (an existing folder), **When**
   the user Ctrl+clicks it, **Then** the OS file manager opens that folder, exactly once, and the
   program behind the terminal does not also receive the click.
2. **Given** an OSC 8 hyperlink whose target is `file:///D:/git/throng/README.md`, **When** the user
   Ctrl+clicks it, **Then** the default link action applies to that file (US5).
3. **Given** an OSC 8 hyperlink whose visible text is `README` and whose target is a file, **Then** the
   link is judged on the target, and the text is irrelevant.
4. **Given** an OSC 8 hyperlink whose target is `file://server/share/x.txt`, **Then** it resolves to
   `\\server\share\x.txt`. **Given** percent-encoded characters in a `file:` target, **Then** they are
   decoded before resolution.
5. **Given** an OSC 8 hyperlink whose target is `javascript:`, `data:`, `mailto:` or an unknown scheme,
   **Then** it still does nothing, exactly as 024 FR-019 requires today.
6. **Given** an OSC 8 `file:` hyperlink whose target does not exist, **Then** it offers nothing to
   follow and no file-link menu items.

---

### User Story 3 - Follow a path in an editor (Priority: P2)

A comment, a Markdown document, a configuration file or a pasted log in an editor names a file. The user
Ctrl+clicks the path, or places the cursor inside it and presses Ctrl+Enter, and the file opens.

**Why this priority**: The same navigation as US1, on the other surface where paths appear. It is
second because editors already have Quick Open beside them.

**Independent Test**: Open `docs/a.md`, which names `./b.md`, `packages/core/x.ts` and
`src/foo.ts:10`. Ctrl+click each path and press Ctrl+Enter inside each.

**Acceptance Scenarios**:

1. **Given** an editor on `docs/a.md`, **When** the user Ctrl+clicks `./b.md`, **Then** `docs/b.md`
   opens.
2. **Given** the same editor, and no `packages/core/x.ts` beside `docs/a.md`, **When** the user
   Ctrl+clicks `packages/core/x.ts`, **Then** it opens from the project root.
3. **Given** the cursor anywhere inside a detected path, **When** the user presses Ctrl+Enter, **Then**
   the default link action runs, exactly as Ctrl+click would.
4. **Given** the cursor is not inside a detected path, **When** the user presses Ctrl+Enter, **Then**
   the editor does what Ctrl+Enter does today, and nothing opens.
5. **Given** the user Ctrl+clicks text that is not a file link, **Then** Ctrl+click keeps the meaning it
   has in the editor today.
6. **Given** the Key Bindings editor, **Then** the Open Link command lists Ctrl+Enter, and rebinding it
   changes the chord in editors and previews together.

---

### User Story 4 - Choose where a link opens from its menu (Priority: P2)

The user right-clicks a file link and picks where it goes: an editor, a preview, the OS file manager
with the file selected, or the file's default OS application. Only the choices that make sense for
that link are shown.

**Why this priority**: The menu is the one route that shows every choice, and Principle VI requires it
for every panel action. It is also how a user reaches a single file in a way other than the default
without changing the preference.

**Independent Test**: Right-click an in-project `.ts` file link, an in-project `.md` file link, an
out-of-project file link and a folder link, in both a terminal and an editor, and compare the items
shown.

**Acceptance Scenarios**:

1. **Given** an in-project file with no preview provider, **When** its link is right-clicked, **Then**
   the menu leads with Open Link, Open in Editor, Open in OS Explorer, Open in OS Default Program and
   Copy Link Address, and has no Open in Preview. This holds in a terminal and in an editor.
2. **Given** an in-project `.md` file and the Markdown provider enabled, **Then** Open in Preview is
   offered as well. **Given** the Markdown provider is disabled, **Then** Open in Preview is drawn
   **disabled**, following 044 FR-062.
3. **Given** a file outside the project, **Then** the only link targets offered are Open in OS Explorer
   and Open in OS Default Program.
4. **Given** a folder link, **Then** Open in OS Explorer is offered, and Open in Editor, Open in Preview
   and Open in OS Default Program are not.
5. **Given** each item is chosen, **Then** it does exactly what its name says: an editor (at the
   position, if the link has one), a preview, the OS file manager with the file selected (or the
   folder opened), or the OS default application.
6. **Given** a link to an executable file (`setup.exe`, `build.bat`, `deploy.ps1`, a `.lnk` shortcut),
   **When** it is right-clicked, **Then** Open in OS Default Program is offered, and choosing it runs
   the file.
7. **Given** text is selected, **When** the user right-clicks over a link, **Then** the ordinary menu
   appears, as 024 FR-019d requires.
8. **Given** the context menu is opened from the keyboard (`menu.open`, Shift+F10) over a terminal file
   link, **Then** it offers the same items as a right-click.

---

### User Story 5 - Set what Ctrl+click does (Priority: P3)

A user who wants every followed file to open in their OS default application sets the default link
action once. By default, a file link opens in throng, and a file whose provider is set to open as a
preview opens its preview.

**Why this priority**: The shipped default serves most users. This story is about letting the
preference change it.

**Independent Test**: With shipped settings, Ctrl+click an in-project `.ts` file and an `.md` file. Set
the Markdown provider's default open action to Preview and repeat. Set the default link action to
Open in OS Default Program and repeat without restarting.

**Acceptance Scenarios**:

1. **Given** shipped settings, **When** an in-project `.ts` file link is Ctrl+clicked, **Then** it opens
   in an editor, routed by the "Open files in" preference (023 FR-025/FR-026).
2. **Given** the Markdown provider's default open action is Preview (044 FR-050), **When** an
   in-project `.md` file link with no position is Ctrl+clicked, **Then** its preview opens. It opens
   beside the file's editor when one is open (044 FR-053).
3. **Given** the same setting, **When** `README.md:12` is Ctrl+clicked, **Then** an editor opens at
   line 12 (FR-052).
4. **Given** the default link action is set to Open in OS Default Program, **When** an in-project file
   link is Ctrl+clicked, **Then** the file opens in the OS default application, and no restart is
   needed.
5. **Given** any setting, **When** a link to a file outside the project is Ctrl+clicked, **Then** it
   follows the fallback order (FR-053) and never opens a throng editor or preview.
6. **Given** a link to an executable file — `setup.exe`, `build.bat`, `deploy.ps1` or a `.lnk`
   shortcut — and the default link action set to Open in OS Default Program, **When** it is
   Ctrl+clicked, **Then** the OS file manager opens with that file selected, and the file does not
   run. The same holds for the Open Link chord and for the plain Open Link menu item (FR-039).
7. **Given** the same link, **When** the user chooses **Open in OS Default Program** from its menu,
   **Then** the file runs.
8. **Given** the Preferences editor, **Then** the default link action is shown with its descriptor and
   every value.

---

### User Story 6 - Turn detection off, and keep terminals fast (Priority: P3)

A user who finds underlined paths distracting turns detection off for terminals, for editors, or for
both. Heavy terminal output, such as a full test run, is no slower with detection on.

**Why this priority**: This is a safety valve and a performance guarantee rather than a new capability.
The performance half is still binding: a feature that slows the PTY stream is a regression.

**Independent Test**: Toggle each switch and check the underline, the gestures and the menu. Compare
the time to stream a large output with detection on and off.

**Acceptance Scenarios**:

1. **Given** terminal file-link detection is turned off, **Then** detected paths in terminals are not
   underlined, Ctrl+click on them and Ctrl+Enter do nothing, and the menu has no file-link items. Web
   links and explicit file hyperlinks still work, and nothing needs a restart.
2. **Given** editor file-link detection is turned off, **Then** the same holds in editors, and
   Ctrl+click and Ctrl+Enter keep their ordinary editor meanings everywhere.
3. **Given** a terminal streaming a large output with detection on, **Then** it finishes no measurably
   later than with detection off, and a test shows that no existence check runs as output arrives.

---

### User Story 7 - Programs print hyperlinks in throng as they do in Windows Terminal (Priority: P3)

Claude Code, and other programs that print hyperlinks only in terminals they recognise, print them in
throng too, so their references are explicit hyperlinks rather than text throng has to guess at.

**Why this priority**: US1 already makes plain-text references followable. This story makes the
program's own, unambiguous links available as well.

**Independent Test**: Start a terminal and read the environment the shell was given
(`echo $FORCE_HYPERLINK`), with the setting on and off, and with the variable already set outside
throng. Start Claude Code in a throng terminal and check whether its status line emits OSC 8
hyperlinks.

**Acceptance Scenarios**:

1. **Given** shipped settings, and no `FORCE_HYPERLINK` in the environment throng was launched from,
   **When** a terminal starts, **Then** its shell sees `FORCE_HYPERLINK=1` (FR-080).
2. **Given** the user's own environment sets `FORCE_HYPERLINK=0`, **When** a terminal starts, **Then**
   its shell still sees `0`. The same holds for any other value the user set (FR-080a).
3. **Given** the setting is turned off, **When** a terminal starts, **Then** its shell sees no
   `FORCE_HYPERLINK` that throng added, and a value the user set is still there, unchanged (FR-080b).
4. **Given** a terminal is already running, **When** the setting is changed, **Then** that terminal's
   environment does not change, and the next terminal started carries the new behaviour with no
   restart of throng (FR-080c).
5. **Given** any of the above, **Then** no terminal's environment carries `WT_SESSION` or a
   `TERM_PROGRAM` naming another terminal (FR-080d).
6. **Given** shipped settings, **When** Claude Code starts in a new throng terminal, **Then** its
   status-line folder reference is a link that one Ctrl+click opens in the OS file manager — whether
   Claude Code emitted it as a hyperlink or as plain text.

---

### Edge Cases

- **A web link inside a path-like run** (`https://host/src/foo.ts:42`) is a web link only. A span is
  never both a web link and a file link.
- **A path and its position are ambiguous** (`C:\x\foo.ts:42:7` against a Windows drive colon). The
  drive colon is part of the path, and the trailing `:line[:col]` is a position only when the path
  without it resolves.
- **A position beyond the file's end.** The file opens with the cursor at the nearest valid position.
  This is not an error.
- **A file that exists when underlined and is gone when followed.** Following it does nothing to the
  file, raises one notice naming the path (the *one condition, one notice* rule), and the underline
  disappears. Following a link never creates a file.
- **A file created after the text was printed** becomes a link on the next hover, rather than staying
  dead until a restart (FR-070).
- **An unreachable network location** (an offline `\\server\share`). It is never underlined while its
  existence is unknown, and the check never blocks output, typing or the pointer (FR-071).
- **A path inside another throng project.** It is outside this panel's owning project, so only the OS
  link targets are offered (Principle I).
- **A panel in a sub-workspace** judges "in the project" against its original project. A panel with no
  owning project treats every link as outside a project.
- **Case and separator differences** (`c:/THRONG/Test.txt` against `C:\throng\test.txt` on Windows).
  These compare as the platform compares paths.
- **A symlink or junction under the project root that points outside it.** It is judged on the location
  the link names, not the location the symlink points to, just as Files & Folders shows it.
- **A long path that wraps across terminal rows** resolves as the whole path. Whether every row is
  underlined is #326's defect, not this feature's (FR-007).
- **A full-screen program redrawing the screen.** Links are resolved against what is currently drawn,
  never against a stale region.
- **A program that owns the mouse** (Claude Code, vim, tmux). A Ctrl+click on a link throng resolved
  opens it once and does not reach the program. A Ctrl+click anywhere else still reaches the program
  (FR-043).
- **Ctrl+click that drags** is a selection, not an activation (Principle VI).
- **Several cursors in an editor.** Ctrl+Enter follows a link only with a single caret and no
  selection. Otherwise Ctrl+Enter keeps its ordinary meaning.
- **Ctrl+Enter on a line that holds a path.** With the caret inside the path, it follows the link and
  does not insert a line. Anywhere else on the line it inserts a line as it does today. This is the
  cost Principle VI accepts for a keyboard route to editor links.
- **An untitled editor buffer** has no directory of its own, so relative paths resolve against the
  project root only.
- **throng running elevated.** A program launched by Open in OS Default Program does not gain
  administrator rights the user did not ask for (FR-038).
- **An executable or script as the link target** (`.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, `.msi`). No
  gesture runs it: Ctrl+click and the Open Link chord reveal it in the OS file manager instead, and
  only the explicit menu item runs it (FR-039).
- **`PATHEXT` changed by the user.** The classification reads it at the time of the decision, so a
  user who added an extension to `PATHEXT` gets that extension treated as executable without a
  restart (FR-039a).
- **A `FORCE_HYPERLINK` the user set to a value throng disagrees with.** It is left exactly as the
  user set it, whichever way (FR-080a).
- **Very long lines and very large documents.** Detection is limited to what is visible, so its cost
  does not grow with document size (FR-073).

---

## Requirements *(mandatory)*

### Functional Requirements

#### Detection

- **FR-001**: A terminal panel MUST detect file references in its output, including output from
  programs such as Claude Code, and MUST make each resolved one a file link.
- **FR-002**: An editor panel MUST detect file references in its document text and MUST make each
  resolved one a file link. This applies to every language the editor opens.
- **FR-003**: Detection MUST recognise, without any markup:
  - **FR-003a**: relative paths — `src/foo.ts`, `./foo.ts`, `../docs/x.md`;
  - **FR-003b**: Windows absolute paths, with either separator — `D:\git\x.ts`, `D:/git/x.ts`;
  - **FR-003c**: UNC paths — `\\server\share\dir\x.ts` and `//server/share/dir/x.ts`;
  - **FR-003d**: POSIX-style absolute paths — the Git Bash drive form `/d/git/x.ts`, the WSL drive form
    `/mnt/d/git/x.ts`, and any other path with a leading `/`;
  - **FR-003e**: home-relative paths — `~/x.ts`;
  - **FR-003f**: `file://` URIs written as text.
- **FR-004**: Detection MUST recognise the position suffixes `path:line`, `path:line:col` and
  `path(line,col)`, and MUST carry that position to the link. The position is not part of the path.
- **FR-005**: Detection MUST exclude trailing sentence punctuation — `)`, `]`, `,`, `.`, `:`, `;` — that
  is not part of an existing path, MUST exclude unbalanced enclosing brackets, and MUST treat a path in
  matching quotes as one path even when it contains spaces.
- **FR-006**: **Only real locations become links.** A candidate that does not resolve (FR-020–FR-026)
  to an existing file or folder MUST NOT be underlined, followed or offered in a menu.
- **FR-007**: A path that wraps across terminal rows MUST resolve as the whole path. Underlining every
  row it spans is governed by #326 and is not required here.
- **FR-008**: Detection MUST NOT change the terminal's or editor's rendered text, selection behaviour,
  copy, reflow or word wrap. This is 024 FR-019a's guarantee, extended to file links.
- **FR-009**: Web links MUST keep their existing detection and behaviour (024 FR-019 – FR-019d). A span
  that is a web link MUST NOT also be a file link.
- **FR-010**: Terminals and editors MUST apply **one** set of rules for detecting, resolving and
  judging a file link. Given the same text and the same base locations, both panel types MUST
  produce the same link and the same resolved target.

#### Explicit file hyperlinks (terminals)

- **FR-011**: A terminal hyperlink whose target is a `file:` URI MUST be a file link when its target
  resolves to an existing **file or folder**, and MUST be judged on its target alone. This
  **supersedes 024 FR-019 for `file:` targets** (see *Supersessions*).
- **FR-012**: A `file:` target MUST be percent-decoded. A target with a host (`file://server/share/…`)
  MUST resolve to the UNC location. A target with no host or `localhost` MUST resolve to a local path.
- **FR-013**: Every non-`http(s)`, non-`file:` hyperlink target — `javascript:`, `data:`, `mailto:`,
  and any unknown scheme — MUST remain unopenable, exactly as 024 FR-019 requires. A `file:` target
  that does not resolve MUST behave the same way, with no link targets and no link menu items.

#### Resolution and project membership

- **FR-020**: Every file link MUST resolve to exactly one absolute location before any action is
  offered or taken.
- **FR-021**: A resolved target MUST be judged **in the project** when it lies inside the owning
  project's root folder, compared the way the platform compares paths. How the link was written MUST
  NOT affect the verdict. A panel with no owning project MUST judge every target outside a project.
- **FR-022**: **In an editor**, a relative path MUST be tried against the open file's own folder first,
  then against the project root. An untitled buffer MUST use the project root alone.
- **FR-023**: **In a terminal**, a relative path MUST be tried against the terminal's current working
  directory first, where throng knows it (025's live working-directory seam), then against the project
  root.
- **FR-024**: A leading-`/` path that is not a drive form MUST be tried against the **project root**
  first, then as the platform's own meaning of that path. The first location that exists wins.
- **FR-025**: The drive forms `/<letter>/…` and `/mnt/<letter>/…` MUST map to that drive
  (`/d/x` → `D:\x`). `~` MUST map to the user's home folder. On Windows, POSIX paths with no
  project-root match and no drive form are not otherwise mapped (no WSL filesystem access, see
  *Out of scope*).
- **FR-026**: Mapping between path spellings, drive forms, UNC forms and the user's home folder MUST sit
  behind the platform abstraction (Principle II). The shared rules in FR-010 MUST NOT name an operating
  system.

#### Link targets and the link menu

- **FR-030**: The four link targets, and when each is **offered**:

  | Link target | Offered when |
  |---|---|
  | **Open in Editor** | The target is a file in the project |
  | **Open in Preview** | The target is a file in the project and a preview provider accepts its type (044 FR-071). If that provider is disabled, the item is drawn **disabled** rather than hidden (044 FR-062; Principle VI, *disabled when unavailable*) |
  | **Open in OS Explorer** | Always |
  | **Open in OS Default Program** | The target is a file, not a folder |

  A link target that is not offered MUST NOT be drawn (Principle VI, *absent when meaningless*).
- **FR-031**: The context menu of a terminal or editor panel, opened over a file link with no text
  selected (by right-click or `menu.open`), MUST begin with a **Contextual** section (Principle VI
  section 0) containing, in this order:
  - **Open Link**, which runs the default link action (FR-050) and shows the Open Link chord (FR-045);
  - each offered link target, by name, in FR-030's order, each performing its target whatever the
    preference says;
  - **Copy Link Address**.

  With text selected, the ordinary menu MUST appear instead (024 FR-019d). Away from a link, the menu
  MUST be unchanged. In a terminal, these items take the place of 024 FR-019d's web-link items only
  over a file link. Over a web link, the menu is unchanged.
- **FR-032**: **Copy Link Address** on a file link MUST copy the resolved target's absolute path as
  plain text, followed by the link's position in the form it was written, if it has one. It MUST copy
  the resolved path for a target outside the project as well. This differs from 044 FR-116's
  outside-the-project clause, because a preview does not resolve outside the project and this feature
  does.
- **FR-033**: **Open in Editor** MUST open the file through the same routing as a Files & Folders
  open — the "Open files in" preference (**023 FR-025/FR-026**) — with the cursor at the link's
  position when it has one. It MUST always open an editor, whatever the file's default open action,
  as 044 FR-055 requires for Open In's editor targets.
- **FR-034**: **Open in Preview** MUST open the file's preview exactly as every other preview entry
  point does (044 FR-005): beside the file's editor when one is open, and focusing an existing
  preview when there is one (044 FR-053). A position on the link MUST be ignored.
- **FR-035**: **Open in OS Explorer** MUST open the OS file manager with the file selected, or with the
  folder open for a folder link. It MUST go through the same platform seam and behave the same as the
  existing Open in OS Explorer items (**023 FR-024**).
- **FR-036**: **Open in OS Default Program** MUST open the file in the application the OS associates
  with it, through the platform abstraction. A failure MUST raise one notice naming the file and the
  reason, through the shared failure presentation (030).
- **FR-037**: Every file-link action MUST be carried out on the **resolved path**. The process
  performing it MUST check again that the path exists, and for Open in Editor and Open in Preview that
  it lies in the project. A `file:` URI MUST NEVER be handed to the OS URL opener. The existing
  open-external policies (web links: `http`/`https`; previews: also `mailto:`) and **024 FR-019b**'s
  denial of renderer-opened windows MUST remain unchanged.
- **FR-038**: When throng itself runs elevated, Open in OS Default Program and Open in OS Explorer
  MUST NOT start the launched application with administrator rights. This extends Principle III's
  de-elevation rule, so that a link printed by a non-elevated terminal cannot start an elevated
  program.
- **FR-039**: When the resolved target is an **executable file** (FR-039a), Ctrl+click, the Open Link
  chord and the plain **Open Link** menu item MUST NOT run it, whatever the default link action is set
  to. All three MUST perform **Open in OS Explorer** for it instead, with the file selected in its
  folder. Running it MUST remain possible only through the explicit **Open in OS Default Program**
  menu item, which MUST still be offered for it (FR-030) and MUST still run it when chosen.
- **FR-039a**: Whether a file is executable MUST be decided by a single rule, stated once and behind
  the platform abstraction (Principle II), which answers from the file's **extension** alone:
  - the extensions the operating system itself treats as executable — on Windows, the entries of the
    `PATHEXT` environment variable, read at the time of the decision, uppercased and compared without
    case (its shipped value covers `.COM .EXE .BAT .CMD .VBS .VBE .JS .JSE .WSF .WSH .MSC`);
  - plus a declared set the platform implementation adds because the OS launches them through a
    handler rather than through `PATHEXT` — on Windows, at minimum `.lnk`, `.url`, `.msi`, `.msp`,
    `.ps1`, `.scr`, `.cpl`, `.reg`, `.hta` and `.pif`.

  `@throng/core` MUST NOT name any of these extensions; it MUST ask the abstraction. A folder is never
  executable. The rule MUST be covered by a contract test, so any future platform implementation
  answers it.

#### Gestures

- **FR-040**: **Ctrl+click** (**Cmd+click** on macOS) on a file link MUST run the default link action.
  A plain click MUST keep its ordinary meaning on that surface. A Ctrl+click that drags MUST select
  (Principle VI, *One gesture follows a link*; 024 FR-019c).
- **FR-041**: In an editor, Ctrl+click MUST follow a file link only when the pointer is over one.
  Anywhere else, Ctrl+click MUST keep the meaning it has in the editor today (adding a cursor).
- **FR-042**: A file link MUST show on hover that it can be followed: it MUST be underlined, and a
  tooltip MUST name the gesture. In a terminal, the tooltip MUST follow the existing **Link hover
  tooltip delay** setting (024 US7; bounded by 031) exactly as web links do.
- **FR-043**: **One Ctrl+click MUST follow a link once.** A Ctrl+click on a file link throng has
  resolved MUST NOT also reach a program that reports mouse events. A Ctrl+click on text throng has
  not resolved as a link MUST still reach such a program, so links the program draws itself keep
  working through it. This extends #198's fix on this branch to file links.
- **FR-044**: In an editor, with a single caret inside a file link and no selection, the Open Link
  chord (FR-045) MUST run the default link action. Otherwise the chord MUST keep its current editor
  meaning. That meaning today is inserting a blank line, which is the editor's built-in behaviour and
  has no requirement of its own.
- **FR-045**: Following a link from the keyboard MUST be **one** rebindable command: the Open Link
  command introduced by **044 FR-096c**, shipping bound to **Ctrl+Enter**. It MUST be live in preview
  and editor panels, so rebinding it changes both (Principle IV, *One command, one chord across panel
  types*). Its chord MUST appear beside every Open Link menu item. This **supersedes 044 FR-096c's
  "scoped to the preview panel"** (see *Supersessions*).
- **FR-046**: This feature MUST NOT give a terminal link a keyboard position. The Open Link command
  therefore MUST NOT be live in a terminal, and Ctrl+Enter MUST reach the program in a terminal exactly
  as it does today, including its modified-Enter encoding
  (`packages/ui/tests/e2e/terminal-modified-enter.e2e.ts:233`). A terminal link's keyboard route is
  the context menu (024 FR-018c, FR-019d; FR-031).

#### The default link action

- **FR-050**: A **default link action** setting MUST offer these values:
  - **Open in throng** — shipped;
  - **Open in Editor**;
  - **Open in Preview**;
  - **Open in OS Explorer**;
  - **Open in OS Default Program**.

  It MUST take effect on the next gesture without a restart.
- **FR-051**: **Open in throng** MUST open an in-project file:
  - as **Open in Preview** when that file's default open action is Preview, as **044 FR-050/FR-052**
    decide it (an enabled provider set to Preview, or an enabled binary provider under 044 FR-051);
  - as **Open in Editor** otherwise.

  For a folder or an out-of-project file, it MUST follow FR-053. This adds following a file link to
  the list of opens that **044 FR-052** routes through the default open action, and to 023 FR-026's
  "standard open paths".
- **FR-052**: Under Open in throng, a link that carries a position MUST open as **Open in Editor**
  whatever the file's default open action, for the reason **044 FR-054** gives: a preview cannot reveal
  a line and column.
- **FR-053**: When the chosen value is not offered for a link (FR-030), the action MUST fall back to
  the first offered target in this order: **Open in Preview → Open in Editor → Open in OS Default
  Program → Open in OS Explorer**. A disabled Open in Preview counts as not offered for this purpose.
  **FR-039 overrides this order for an executable file**: the fallback never reaches Open in OS
  Default Program for one, and lands on Open in OS Explorer.
- **FR-054**: Open Link, Ctrl+click and the Open Link chord MUST all run the same default link action
  for the same link. The named link targets in the menu MUST ignore the setting (Principle VI, *A
  preference picks the default; the menu offers every variant*).
- **FR-055**: No gesture, menu item or setting MUST ever open a file outside the owning project in a
  throng editor or preview (Principle I).

#### Settings and descriptors

- **FR-060**: Two settings MUST switch file-link detection on and off: one for terminal panels and one
  for editor panels. Both ship **on**. Turning one off MUST remove, in that panel type and without a
  restart, the underline, Ctrl+click following, Open Link chord following and file-link menu items of
  **detected paths**. Web links and explicit file hyperlinks MUST NOT be affected.
- **FR-061**: The default link action (FR-050), both detection switches (FR-060) and the
  hyperlink-advertising switch (FR-080b) MUST each have a descriptor that the preferences editor
  renders, covered by the configuration-editor completeness test. The default link action and the
  detection switches MUST appear together in one place in the preferences editor; the
  hyperlink-advertising switch belongs with the terminal settings, because it changes what a terminal
  is started with.
- **FR-062**: The Open Link command's key-binding descriptor MUST describe its wider scope (FR-045), so
  the Key Bindings editor lists it for editors as well as previews.

#### Performance

- **FR-070**: Existence checks MUST run lazily — on hover, or for the visible range — and their results
  MUST be cached. A cached answer MUST NOT outlive a change to that location, so a file created later
  becomes a link and a deleted one stops being one.
- **FR-071**: An existence check MUST NEVER run on the terminal's output path or on the editor's typing
  path, and MUST NEVER block output, typing, scrolling or the pointer. A location whose existence is not
  yet known, or that takes too long to answer, MUST be treated as not a link until it answers.
- **FR-072**: A test MUST assert that no existence check runs while terminal output is being delivered.
- **FR-073**: In an editor, detection MUST be limited to the visible range, so its cost does not grow
  with document size.

#### Programs that print hyperlinks

- **FR-080**: A terminal throng starts MUST advertise hyperlink support to the programs it runs, by
  setting **`FORCE_HYPERLINK=1`** in that terminal's environment, so a program that prints hyperlinks
  only in terminals it recognises prints them in throng.
- **FR-080a**: throng MUST NOT set it when the environment the terminal is launched from already
  carries `FORCE_HYPERLINK`, whatever its value. A user who set it to `0` keeps `0`, and one who set
  it to `1` keeps their own value. throng never overrides a value the user set, in either direction.
- **FR-080b**: A setting, shipping **on**, MUST turn this off. While it is off, throng MUST leave the
  environment untouched: it MUST NOT set `FORCE_HYPERLINK`, and MUST NOT unset or alter one the user
  set.
- **FR-080c**: Changing the setting MUST apply to **terminals started afterwards**, and MUST NOT
  change a terminal that is already running, because a process's environment is fixed when it starts.
  The setting MUST say so, and no restart of throng MUST be needed for the next terminal to pick the
  new value up.
- **FR-080d**: throng MUST NOT set `WT_SESSION`, and MUST NOT set `TERM_PROGRAM` to a value that names
  another terminal, because programs read those as promises of that terminal's other behaviour.

#### Documentation

- **FR-090**: `README.md` and the affected `docs/` guides (terminals, editors, key bindings,
  preferences) MUST describe file links, their gestures, the menu, the default link action, the
  detection switches, the refusal to run executables (FR-039) and the hyperlink-advertising setting
  and the environment variable it sets (FR-080), in the same change that ships them.
- **FR-091**: On delivery, the *Known gaps* sentence in constitution Principle VI (*One gesture
  follows a link*), which says "no surface yet implements Ctrl+Enter" and that #394 adds the first,
  MUST be brought current through a PATCH amendment. The amendment is recorded here because it
  cannot be made before the behaviour ships.

### Supersessions

Each of these replaces an older statement for the cases named, and nothing wider. The older text stays
where it is.

| # | Superseded | What changes | What stays | Why |
|---|---|---|---|---|
| S1 | **024 FR-019**, "other or unknown schemes (`file:`, …) MUST NOT be opened at all"; **024 FR-019d**, Open Link "`http`/`https` only"; and 024's US7 edge case, "a non-`http(s)` scheme (`file:`, …) must not be handed to the OS opener" | A `file:` hyperlink target that resolves to an existing file or folder is a file link (FR-011), and the terminal link menu offers the file-link items for it (FR-031) | `http`/`https` open in the default browser. `javascript:`, `data:`, `mailto:` and unknown schemes stay unopenable (FR-013). No in-app browser. 024 FR-019b is unchanged. A `file:` URI still never reaches the OS URL opener (FR-037) | 024 refused `file:` because the only route out was the OS URL opener, which would launch whatever the URI named. File links now take a path-based route that checks existence and project membership and never uses that opener, which removes the risk 024 guarded against |
| S2 | 024's US7 edge case, "The link-aware items must not appear in an editor's or the file tree's menu — this is terminal-only" | An editor's content menu carries the link items over a file link (FR-031). The file tree is unchanged | Terminals keep their items. 044 FR-095 already extended them to previews | Principle VI (v5.5.0) requires Open Link and Copy Link Address on every surface that has links, and editors now have links |
| S3 | **044 FR-096c**, the Open Link command "scoped to the preview panel" | The same command, with the same default chord, is also live in editor panels (FR-045) | It is still not live in terminals (FR-046). Its chord and its preview behaviour are unchanged | Principle IV requires one command to use one chord across panel types, and two commands sharing Ctrl+Enter could be rebound apart |

**Tests these supersessions permit to change**, and no others:

- `packages/core/tests/unit/terminal-link-menu.test.ts:20` asserts that a `file:` hyperlink has no
  link target (S1). It changes only for a `file:` target that resolves.
- `packages/core/tests/unit/keybindings-preview.test.ts:42–44` (scope `['preview']`) and `:56–58`
  (Ctrl+Enter resolves to nothing in an editor) (S3). The terminal assertions at `:61–64` MUST stay
  as they are.
- `packages/ui/tests/unit/external-url.test.ts:11` (a `file:` URI refused by the open-external
  channels) MUST NOT change. FR-037 depends on it.

**Reconciled, not superseded:**

- **033 FR-053** freezes menu labels only for 033's own grouping pass. The label "Open in OS Explorer"
  comes from **023 FR-022/FR-024**. This feature uses it verbatim.
- **023 FR-025/FR-026** ("Open files in"): Open in Editor honours it (FR-033), and following a link
  joins the "standard open paths" it covers.
- **044 FR-050–FR-055**: this feature reads the default open action and does not change it (FR-051,
  FR-052). **044 FR-090–FR-096**, links inside a preview, are untouched.

### Key Entities

- **File link**: a span of terminal output or editor text; its kind (detected path or explicit file
  hyperlink); the text as written; its position, if any; the panel and owning project it was seen in.
- **Resolved target**: an absolute location; whether it is a file or a folder; whether it is in the
  project; when its existence was last confirmed.
- **Link target**: one of Open in Editor, Open in Preview, Open in OS Explorer, Open in OS Default
  Program; whether it is offered, disabled or absent for a given resolved target.
- **Executable classification**: whether the OS would execute a file, answered from its extension by
  the platform abstraction (FR-039a).
- **Default link action** (setting): one of the five values in FR-050.
- **File-link detection switches** (settings): one for terminals and one for editors.
- **Hyperlink-advertising switch** (setting): whether a new terminal is started with
  `FORCE_HYPERLINK=1` (FR-080b).
- **Open Link command**: the one keyboard command that follows a link, shared by previews and editors.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every path form and position form in FR-003 and FR-004, written as each acceptance
  scenario in US1 and US3 writes it, resolves to the expected file, and opens at the expected line and
  column. This holds in 100% of the fixture cases, in both panel types.
- **SC-002**: One Ctrl+click on a file link opens it exactly once in 20 of 20 attempts. This includes
  attempts under a program that reports mouse events.
- **SC-003**: In a fixture of ordinary prose and log text that contains slashes, colons and dotted
  words but names no existing location, 0 spans are underlined.
- **SC-004**: Streaming a large output (at least 50,000 lines) takes no more than 5% longer with
  file-link detection on than with it off, and typing latency in a terminal and in an editor shows no
  measurable change.
- **SC-005**: The maintainer's status-line project-folder link opens the OS file manager on that
  folder with one Ctrl+click.
- **SC-006**: A user gets from seeing a path in a terminal or editor to having the file open with one
  gesture, with no typing or searching.
- **SC-007**: Across the fixture set, 0 files outside the owning project open in a throng editor or
  preview, by any gesture, menu item or setting.
- **SC-008**: A change to the default link action or to either detection switch applies to the next
  gesture in 100% of cases, with no restart.
- **SC-009**: Every file-link menu, in both panel types, shows exactly the items FR-030 and FR-031
  prescribe for its link, with no extra, missing or wrongly enabled items, across in-project file,
  in-project file with a provider, in-project file with a disabled provider, out-of-project file and
  folder links.
- **SC-010**: Across every extension the classification calls executable (FR-039a), 0 files are run by
  Ctrl+click, the Open Link chord or the plain Open Link item, at any setting — and each one still
  runs when Open in OS Default Program is chosen.
- **SC-011**: A new terminal's environment carries `FORCE_HYPERLINK=1` with shipped settings, carries
  the user's own value unchanged whenever they set one, and carries nothing throng added while the
  setting is off — in 100% of cases, and with no `WT_SESSION` or borrowed `TERM_PROGRAM` in any of
  them.

---

## Assumptions

- **Test layers** (Principle V): detection, resolution, membership, fallback and menu composition are
  pure decisions, so they are proved by unit tests. Hover, menu rendering and editor gestures are
  proved by component tests. The platform path mapping and the OS open and reveal seams are proved by
  contract and integration tests. E2E is reserved for what only a running app shows: a real Ctrl+click
  reaching or not reaching a real mouse-reporting program (FR-043), and a real terminal's output path
  (FR-072) if no lower layer can observe it. The executable classification is a contract test
  (FR-039a), and the environment a terminal is started with (FR-080 – FR-080d) is an integration
  test that reads the spawned shell's environment rather than an E2E.
- **The live working directory** from 025 can lag behind a `cd` for up to one poll interval. A
  relative path printed immediately after a `cd` may resolve against the project root instead. This is
  acceptable, because the project root is tried second anyway.
- **macOS and Linux** are not shipped targets. The rules are written so a platform implementation can
  be added without changing them (Principle II), and Cmd+click is named for macOS as Principle VI
  requires.
- **Label spelling.** "Program" follows the codebase's spelling for software. The issue wrote
  "Programme", and the choice is recorded under *Clarifications*.
- **The hover tooltip's wording** for file links matches the wording web links use.
- **The settings' home** in the preferences editor is left to planning, provided FR-061 holds.
- **A terminal link-navigation mode** is out of scope (see *Clarifications*). If it is wanted, it is a
  new issue, and FR-046 would then be revisited.

## Dependencies

- **Spec 044 (#10), the default open action (FR-050–FR-053): landed on this branch.** Commit
  `bb2dc5bb` ("feat(044): preview any file beside its editor, with Back and Forward", on `master` and
  in this branch's history) ships:
  - the per-provider setting (`packages/core/src/config/preview-settings.ts`, with
    `defaultOpenActionFor`);
  - the open router that applies it to Files & Folders and Quick Open
    (`packages/ui/src/renderer/editor/open-router.ts`);
  - the `preview.followLink` command bound to Ctrl+Enter (`packages/core/src/config/keybindings.ts`).

  The Open in Preview half of this feature (FR-030, FR-034, FR-051) is therefore unblocked. 044's
  remaining open tasks are hands-on checks and hosted gate runs, and none of them is a
  default-open-action requirement.
- **024 US7** (web links, hover tooltip, link-aware terminal menu, `menu.open`), which this feature
  extends.
- **025**'s live working-directory reading, used by FR-023.
- **#198's fix on this branch**, which FR-043 extends.

## Out of scope

- Links inside a Markdown preview, which **044 FR-090–FR-096** govern.
- Opening a file outside the project in a throng editor or preview.
- Hover previews or peeks of a linked file's contents.
- Links to symbols (`FooService.bar`) rather than paths.
- Remote paths over SSH, and WSL filesystems beyond mapping `/mnt/<drive>/` onto that drive.
- Keyboard navigation onto terminal links (FR-046).
- Underlining every row of a wrapped link (#326).
- Revealing a linked file in throng's own Files & Folders view. #394 does not list it, and the four
  targets are what it asked for.
