# Feature Specification: Terminal panel titles from a template

**Feature Branch**: `feature/S051-S052-I468-I190-I193-I397-I111-nonblocking-calls-follow-moves` (shared with 051 and 052)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "#476 — a terminal panel's title built from a user-customisable template of placeholders: the running command, the shell, the working directory and more, most useful information first, with the panel-type icon always shown."

A terminal panel's name today is whatever its shell announces as its window title (023 FR-033), else the shell's
name, with the working directory shown beside it (012). Only cmd puts the running command in its window title;
PowerShell 7, Windows PowerShell and Git Bash never do, so their panels keep one static name whatever runs. The
title cmd announces at rest is the full path of `cmd.exe` — repeat information that crowds out what matters.

This feature names every terminal panel from one template the user can edit. By default a panel reads
`claude: work on links | Git Bash (D:\git\throng)` while a program that titles itself runs,
`ping localhost -t | Git Bash (D:\git\throng)` while a command runs and `Git Bash (D:\git\throng)` at a bare prompt,
in every shell. The running command comes from what throng already observes for command memory (025 FR-019,
051 FR-040 while it stands), not from the shell's window title.

**Supersession.** For terminal panels only:

- **023 FR-033** (the header reflects the shell's OSC 0/2 window title, falling back to the panel's name) is
  replaced by FR-001: the title is the rendered template. The window title remains available as `{title}`.
- **012's "terminal working directory in the panel title"** is replaced by FR-010: the working directory appears
  only where the template places it, never as a second, separate field.
- **048 FR-032** stands: the rendered template is the terminal's content-derived title, and it is used everywhere
  a panel is named. **048 FR-033**'s "automatic naming rules stay unchanged" no longer covers terminals; editors,
  previews and Find in Files are unchanged.
- **031 FR-037** (`tabs.maxNameLength` bounds every panel name) stands and applies to the rendered template.

## Clarifications

### Session 2026-10-08

- Q: Placeholder names — long (`{term-type}`, `{app-name}`, `{app-command}`) or short? → A: **Short**
  (`{shell}`, `{app}`, `{command}`).
- Q: A program that sets its own title (`claude`) — should the title prefer it over the command? → A: The template
  decides, with a fallback operator: `({title} ?? {app})` renders the title, else the program's name.
- Q: How are literal brackets written, given parentheses group? → A: **Doubled.** `({title})` renders `claude`;
  `(({title}))` renders `(claude)`. The syntax is documented on the preferences page, as concisely as possible.
- Q: Is the icon part of the template? → A: **No.** The panel-type icon is always shown, chosen by the panel's
  type, and is not something the template can move or remove.

### Session 2026-10-08 (2)

Supersedes the first session's groups, `??`-only fallback and doubled-bracket groups (FR-005 – FR-007 as first
written): the maintainer asked for C#'s operators, with quoted literals because they read more easily.

- Q: Which operators? → A: **C#'s**: `c ? a : b`, `a ?? b`, `a || b`, `a && b`, `!a`, with C#'s precedence.
- Q: How is literal text written inside an expression? → A: **As a C# string literal**, `"…"`, with placeholders
  replaced inside it. Outside an expression text is literal as typed — `"WOOP"` shows its quotes there.
  `({title} ?? "WOOP")` and `{title} ? "WOOP" : "WAAP"` both show `WOOP` when the title is set; brackets help
  but are not required.
- Q: Which wins, a program's own title or its command? → A: **A titled program**: `claude: work on links | …`
  while it runs, otherwise the command, otherwise nothing.
- Q: What is `{title}`? → A: **The title the running program set.** Shells set titles too (Git Bash at every
  prompt, cmd as a command starts); those are not a program's title.
- Q: Where is the template edited? → A: On **one line under its description**, the full width of the row, so a long
  template is readable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every terminal says what is running in it (Priority: P1)

A user has a cmd, a PowerShell 7, a Windows PowerShell and a Git Bash terminal open. They run `ping localhost -t`
in each. Every panel's name changes to `ping localhost -t | <shell> (<directory>)`. When they stop it, every panel
returns to `<shell> (<directory>)`.

**Why this priority**: The reported problem. Three of the four built-in shells never name what runs in them, so a
user with several terminals cannot tell them apart without clicking through each.

**Independent Test**: Open one terminal of each built-in shell, run the same long command in each, and read the
four panel names; stop it and read them again.

**Acceptance Scenarios**:

1. **Given** a terminal of any shell at a bare prompt, **When** the user runs `ping localhost -t`, **Then** the
   panel's name becomes `ping localhost -t | <shell> (<directory>)` within two seconds.
2. **Given** that command running, **When** the user stops it, **Then** the name returns to `<shell> (<directory>)`
   within two seconds.
3. **Given** a terminal, **When** the user changes directory, **Then** the directory in its name follows, as the
   working directory display does today.
4. **Given** any terminal name, **Then** it shows no executable's full path, and the directory appears at most once.
5. **Given** a long command or a deep directory, **Then** each is shortened to its limit with a visible marker; a
   directory keeps its start and its last folder.

---

### User Story 2 - The user decides what a terminal's name says (Priority: P2)

A user who wants the program's own title when it sets one — `claude` names itself — and otherwise the program's
name, sets the terminal title template in Preferences to `({title} ?? {app}) | {shell}`. Their panels follow the
new template at once.

**Why this priority**: The default suits most people; the template is what lets everyone else choose order and
content without throng hard-coding a second, third and fourth layout.

**Independent Test**: Change the template in Preferences, then read the names of open terminals at a bare prompt,
running `ping`, and running a program that sets its own title.

**Acceptance Scenarios**:

1. **Given** the template `({title} ?? {app}) | {shell}`, **When** `claude` runs and sets its title, **Then** the
   name is `claude | <shell>`; **when** `ping` runs, **then** it is `ping | <shell>`.
2. **Given** a template with literal brackets, `{shell} (({folder}))`, **Then** the name is `Git Bash (throng)`.
3. **Given** `{shell}({path} ? " ({path})" : "")`, **When** the directory is not known, **Then** the name is
   `Git Bash`, with no empty brackets.
4. **Given** an invalid template (an unclosed bracket, an unknown placeholder), **When** the user enters it,
   **Then** Preferences refuses it with one message naming the problem, and terminals keep their current names.
5. **Given** the command and path length limits, **When** the user changes them, **Then** names re-render at the new
   limits.
6. **Given** `{title} ? "WOOP" : "WAAP"`, **Then** the name is `WOOP` while the running program has set a title
   and `WAAP` otherwise; `"WOOP"` outside an expression shows its quotes.

---

### User Story 3 - The template is documented where it is set (Priority: P3)

A user opens Preferences to change the template and finds, beside the setting, the list of placeholders and the
operators and the quoting rule in a few lines, with the default as the example.

**Why this priority**: A template language nobody can read is a setting nobody changes.

**Independent Test**: Read the setting's description in Preferences and `docs/preferences.md`; write a template
from that alone.

**Acceptance Scenarios**:

1. **Given** the Preferences page, **Then** the template setting lists every placeholder with a one-line meaning and
   states the operators and the quoting rule, using the default template as the worked example.
2. **Given** `docs/preferences.md`, **Then** the same content is there, once.

### Edge Cases

- **A bare prompt**: `{title}`, `{command}`, `{app}` and `{arch}` are empty, so the default names the shell and
  directory alone.
- **A shell that sets a title** (Git Bash at every prompt, `MINGW64:/d/git/throng`; cmd as a command starts,
  `cmd - ping localhost -t`; PowerShell its own path): not `{title}`. A shell's title is known by its form and by
  the title its last prompt showed, never by when it arrived — a program restored with its terminal, or still
  running when its project is switched back to, keeps its title in the name.
- **A terminal not yet observed** (the first second after start): `{command}` is empty until the first observation;
  the name never shows a stale command from the panel's previous terminal.
- **A stopped terminal**: still a terminal panel, named by its template, with `{command}`, `{app}` and `{arch}`
  empty — nothing runs in it. **An empty panel** is named as today ("Blank Panel"); templates apply only to a
  terminal panel.
- **The template renders to nothing** (every placeholder empty, no literal text): the panel is named by its shell, as
  `{shell}` alone would.
- **Literal brackets and braces outside an expression**: `((`, `))`, `{{`, `}}`. Inside a string literal brackets
  are plain text, `{{` and `}}` are braces and `""` is a quote.
- **`?` or `??` after a placeholder in plain text** starts an expression: `{command} ?` alone is an error, not
  text. Write such text inside a string literal.
- **A condition shown as text**: `{a} || {b}` and `{a} && {b}` are true or false, so they may only stand before `?`
  (or be negated with `!`); using one as text is refused like any other invalid template. `??` gives text.
- **`{title}` after a program exits**: empty; the next program starts with none until it sets its own.
- **A terminal no window shows**: names follow what throng observes, and 025 observes only while a window is
  connected; a name never claims more freshness than that.
- **The running command changes faster than the observation interval**: the name follows the observations; nothing
  shorter is promised.
- **A sub-workspace window** showing the same terminal: it shows the same name.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A terminal panel's name MUST be the rendered **terminal title template**, wherever the panel is named
  (048 FR-032), bounded by `tabs.maxNameLength` (031 FR-037). Supersedes 023 FR-033 for terminal panels.
- **FR-002**: The panel-type icon MUST always be shown beside a terminal panel's name, chosen by the panel's type.
  It is not part of the template and the template cannot remove or move it.
- **FR-003**: The template MUST support these placeholders:

  | Placeholder | Renders | Empty when |
  |---|---|---|
  | `{command}` | the running command with its arguments, its program named by bare name (`ping localhost -t`, never `C:\Windows\system32\PING.EXE localhost -t`) | nothing is running |
  | `{app}` | the running program's name, without path or extension | nothing is running |
  | `{arch}` | the running program's architecture (`x64`, `x86`, `arm64`) | nothing is running, or it cannot be read |
  | `{title}` | the window title the running program set — never one the shell set | nothing is running, or it set none |
  | `{shell}` | the shell's label: `Command Prompt`, `PowerShell 7`, `Windows PowerShell`, `Git Bash`, or a user shell's label | never |
  | `{path}` | the working directory | it is not known |
  | `{folder}` | the working directory's last folder | it is not known |
  | `{project}` | the owning project's name; for a panel a sub-workspace owns, the sub-workspace's name | never, for a terminal panel |
  | `{admin}` | `Admin` | the terminal is not elevated |

- **FR-004**: "The running command" MUST be the command throng observes for command memory (025 FR-019, 051
  FR-040), so it is the same in every shell flavour; it MUST NOT depend on the shell's window title.
- **FR-005**: **Text and expressions.** Outside an expression, text MUST render as typed, quotes included, and
  `{name}` as its placeholder's value. An expression is `( … )`, or — without brackets — a placeholder followed by
  an operator, running for as long as operators join operands. Inside an expression, spaces are insignificant and
  an operand is a placeholder, a string literal or a bracketed expression.
- **FR-006**: **Operators**, with C#'s meaning and precedence (lowest first): `c ? a : b` (right-associative),
  `a ?? b` (the first that is not empty), `a || b`, `a && b`, `!a`. A value is true when it is not empty.
  `||`, `&&` and `!` give true or false, which MAY only stand as the condition before `?`.
- **FR-007**: **Literals.** Inside an expression, `"…"` is a string literal: placeholders inside it render their values,
  `{{` `}}` render braces and `""` a quote. Outside an expression, `((` `))` `{{` `}}` render a literal bracket or brace.
  `({title} ?? "WOOP")` and `{title} ? "WOOP" : "WAAP"` render `WOOP` when the title is set.
- **FR-008**: An invalid template — an unbalanced bracket or quote, an unknown placeholder, an empty placeholder name,
  a misplaced operator, bare text inside an expression, a true-or-false value used as text — MUST
  be refused where it is entered, with one message naming the problem and where it is, and MUST NOT change any
  panel's name. A persisted invalid template MUST fall back to the default and say so once.
- **FR-009**: The default template, `({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")`, MUST render
  `claude: work on links | Git Bash (D:\git\throng)` while `claude` runs in Git Bash in `D:\git\throng` and has titled
  itself `work on links`, `ping localhost -t | Git Bash (D:\git\throng)` while that command runs, and
  `Git Bash (D:\git\throng)` at a bare prompt.
- **FR-010**: A terminal panel MUST NOT show the working directory anywhere but where its template places it.
  Supersedes 012's working directory beside the panel title.
- **FR-011**: A placeholder MUST NOT render an executable's full path.
- **FR-012**: `{command}` MUST be shortened to a length limit (a preference, default 40 characters) and `{path}` to
  another (a preference, default 40 characters), each with a visible marker. A shortened path MUST keep its root and
  its last folder and drop from the middle.
- **FR-013**: A name MUST follow a change in any of its sources — the command starting or ending, the directory, the
  window title, the template, the limits — within one observation interval of the change being observed, and in
  every window showing the terminal.
- **FR-014**: The template and both limits MUST be preferences, applied to every terminal panel, with the defaults
  above, and editable in Preferences like any other setting. The template is edited on one line under its
  description, the full width of the row.
- **FR-015**: The template setting's description in Preferences and its entry in `docs/preferences.md` MUST list every
  placeholder with a one-line meaning and state FR-005 – FR-007 using the default as the example, as concisely as
  possible, in terms a programmer recognises.
- **FR-016**: A name MUST NOT show a command from the panel's previous terminal: `{command}`, `{app}` and `{arch}` are
  empty until the current terminal's first observation.

### Key Entities

- **Terminal title template**: a preference; text with placeholders, groups, fallbacks and literal escapes.
- **Title sources**: the live values a terminal's name is rendered from — running command and program, window
  title, shell, working directory, project, elevation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the default template, running the same command in each of the four built-in shells names all
  four panels after it, within two seconds of starting it; today one of four does.
- **SC-002**: No terminal panel name, with the default template, contains an executable's full path or a directory
  twice.
- **SC-003**: Changing the template in Preferences renames every open terminal within one second, in every window.
- **SC-004**: Every acceptance scenario of User Story 2 renders exactly the name given, from the placeholders and
  rules on the Preferences page alone.

## Assumptions

- The three preferences live with the other terminal settings (`terminals.*`); exact keys are the plan's.
- The command observation interval stays 025's `terminals.commandPollMs` (default one second); names update at that
  cadence, not faster.
- A program's architecture is read from its executable; where it cannot be read, `{arch}` is empty.
- Lengths count user-perceived characters, as `tabs.maxNameLength` already does.
- The marker for a shortened value is the ellipsis already used for long panel names.
- Editors, previews, Find in Files and empty panels keep their naming rules unchanged.
