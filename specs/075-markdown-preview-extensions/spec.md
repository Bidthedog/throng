# Feature Specification: Markdown preview extensions — callouts, math and printing

**Feature Branch**: `feature/S075-I672-markdown-preview-extensions`

**Created**: 2026-11-18

**Status**: Draft

**Input**: Maintainer direction, 2026-11-18: one specification for the Markdown preview extension group in
v1.0.0 — [#672](https://github.com/Bidthedog/throng/issues/672) (callout blocks in Markdown previews),
[#393](https://github.com/Bidthedog/throng/issues/393) (typeset math in Markdown previews) and
[#484](https://github.com/Bidthedog/throng/issues/484) (print preview and print from previews, `.md` and
`.mmd`, extensible to future preview types). All three are maintainer-agreed; #672's body already records
the maintainer's decisions on parser, registry, styling and icons, and this spec carries them as written.

## Background

throng's Markdown preview (044, 047, 054, 068) renders most of what a notes vault or a project's design
documents hold, but three gaps make some documents unreadable or unusable outside throng:

- A typed blockquote — Obsidian's callouts, GitHub's alerts (`> [!NOTE]`) — previews as a plain quote with
  a literal `[!info]` on its first line, so a document that uses them to say *what kind* of note each block
  is reads as a wall of quotes.
- Maths written as TeX (`$…$`, `$$…$$`, ` ```math `) previews as its source: 044 FR-086 deliberately left it
  literal.
- Nothing a preview shows can be printed, or saved as a PDF through the OS's print-to-PDF, without opening
  the file in another application.

| Story | Issue | Delivers |
|---|---|---|
| US1 | #672 | Callouts render as typed, coloured, iconed blocks with titles |
| US2 | #672 | Callouts fold, nest and carry ordinary Markdown |
| US3 | #672 | Each theme colours callouts by role; users can retheme and re-icon them |
| US4 | #393 | Inline and display maths typeset in a `.md` preview |
| US5 | #484 | Print a Markdown or Mermaid preview, with a print preview |
| US6 | #484 | Print is a capability of the preview contract that later providers opt into |

**Adjacent, not here.** Spec **074** (parallel) adds SVG embeds to the same Markdown pipeline. Nothing in this
spec specifies SVG behaviour; where this spec says "an image" it means whatever the pipeline draws as an
image when it ships.

### Requirements this feature changes

| Requirement | Change | Why |
|---|---|---|
| 044 FR-086 | **Superseded for math by FR-040.** `$…$`, `$$…$$` and ` ```math ` blocks typeset. Its Mermaid half was already superseded by 054 FR-040. | #393. |
| 054 FR-040 | **Its parenthetical "math stays literal text" is superseded by FR-040.** Mermaid rendering is unchanged. | #393. |
| 044 FR-081 | **Extended by FR-014 and FR-047.** The sanitiser admits the callout markup and the typesetter's output, and nothing more. The test that asserts the sanitiser is in the path stands, and gains a case for each. | #672, #393. |
| 044 FR-083, 054 FR-046 | **Unchanged; met for callouts (FR-020) and equations (FR-043).** | |
| 044 FR-093 | **Unchanged.** The typesetter's fonts ship with the application and are never fetched (FR-046); printing fetches nothing (FR-079). | |
| 044 FR-020, 047 FR-035 | **Unchanged.** Folding a callout is view state only: it writes nothing and marks nothing dirty (FR-008). | |
| 044 FR-096b | **Extended by FR-007.** Tab and Shift+Tab also stop on each foldable callout's title row, in document order with the links. | #672 asks for keyboard-operable folding. |
| 047 FR-002, FR-057 | **Extended by FR-011 and FR-049.** Find matches a callout's title and body, never its `[!type]` marker, and does not match inside a typeset equation. | |
| 047 FR-040 | **Extended by FR-010.** Reaching a find match or link target inside a collapsed callout expands it, as reaching one inside a collapsed section does. | |
| 047 FR-038 | **Unchanged.** Collapse All / Expand All acts on sections only; callouts keep their own fold state (FR-009). | |
| 054 FR-049a | **Extended by FR-050.** Copying a selection that holds an equation follows the copy format, as a diagram does. | |
| 044 FR-121, 047 FR-041a | **Unchanged; must hold across callouts and display maths (FR-012, FR-045).** | #672 found the parser package's own renderer drops the source-line attribute scroll sync needs. |
| 047 FR-056, 068 FR-014 | **Unchanged.** Inside a callout as outside one, a note embed (`![[note.md]]`) still renders literally. | |
| 021 FR-003 | **Extended by FR-021.** The closed set of Themes-editor areas gains **Markdown preview**, with a **Markdown preview · Callouts** sub-group. | #672 names the area. |
| 069 FR-004, FR-009, FR-011, FR-012, FR-035 | **Unchanged; the new callout icon keys must meet them (FR-024).** | |
| 044 FR-015c | **Superseded for Last Active Editor by FR-093b.** Open in Editor from a standalone preview follows **Open files in**: the tab's last active editor takes the file; a new editor beside the preview only under New Editor or when the tab has no editor. | The maintainer, 2026-11-20 17:00: "the 'Open files in' preference should control where the editor opens." |
| 047 FR-012 | **Superseded for Last Active by FR-093a.** Opening a preview of a file open in an editor reuses the last active preview of its type, as every other route does; a new one opens beside the editor only when none exists in the tab, or under **New**. | The maintainer, 2026-11-20: "Only one markdown preview should exist unless the user explicitly opens a second one." |
| 073 FR-060 (T078) | **Generalised by FR-093a.** 073 made the editor-opened preview reuse the Last Preview Panel for a Preview Editor (an editable provider) alone; FR-093a applies the same rule to every provider, so `preview-service.ts` holds one Last Active check before placement. 073 T035's unsaved-grid question still guards the move. | The 073/074/075 merge, 2026-11-20: two exceptions to 047 FR-012 for the same reason became one rule. |
| 054 FR-046a – FR-046h | **Unchanged on screen.** Printing ignores a diagram's zoom, pan and Full Pane state (FR-075). | #484. |
| 054 FR-050, FR-052 | **Unchanged; FR-042 places the new setting under them** (Editor → Previews → Markdown, labelled with the provider name). | |
| 044 provider contract (044 User Story 5) | **Extended by FR-060 – FR-062.** A provider declares whether it can print and supplies its printable output. | #484. |

## Clarifications

### Session 2026-11-18

- Q: Which colours does printed output use (FR-072)? → A: throng's own **internal print stylesheet**, separate
  from every theme, because users can modify the Light theme. It is private and not user-customisable in this
  iteration. It starts as a copy of the shipped default Light theme's values but is a separate, fixed palette:
  editing any theme, Light included, never changes what prints.
- Q: Do collapsed sections and callouts print expanded or as shown (FR-074)? → A: **Expanded.** Printing prints
  the full document whatever its fold state on screen.
- Q: Where does print preview open (FR-071)? → A: **Its own new throng window.** Only one Print Preview window is
  open at a time; a second request focuses the open one. It takes focus and is modal to the window that opened
  it while open: printing is an explicit, dominating action.
- Q: What does Print… (Ctrl+P) do (FR-064)? → A: It **opens Print Preview**. Nothing is sent to a printer before
  Print Preview has been shown. The **Print** button in the Print Preview window prints with the printer and
  settings chosen there, with no second OS dialog, so the Print Preview window carries the printer choice and
  every print setting.
- Q: Keep or disable the parser's ` ```ad-<type> ` admonition fences (FR-016)? → A: **Disabled.** They are the
  code-block syntax of a third-party Obsidian add-on ("Admonition"), not callout syntax; they stay ordinary
  fenced code, and rendering them as callouts is out of scope.
- Maintainer direction, same session: print settings are **saved with throng and persist across sessions**,
  superseding the draft's session-only default (FR-070). They are application state, not a preference, so they
  live in a state file beside `window-state.json` and `terminal-form-history.json` in throng's data directory,
  not in `settings.json` (no descriptor, no Preferences row) and not in the database (they belong to no project).
- Defaults taken while encoding the answers (no question asked):
  - Because Print… now opens Print Preview, a separate **Print Preview…** command would do the same thing. There
    is **one** command, **Print…**, in every menu and bound to Ctrl+P; the draft's unbound Print Preview…
    command is dropped (one action, one command).
  - A second Print… while the Print Preview window is open (possible only from a window it is not modal to)
    focuses the open window and leaves its content as it is; the user closes it to print something else.

### Session 2026-11-19

- Maintainer direction: Print Preview MUST let the user look at **each page on its own**, stepping between them
  with **Back** and **Forward** buttons, rather than scrolling one long strip of pages (FR-068a).
- Defaults taken while encoding it (no question asked):
  - The pages stepped through are the pages that will print: with a page range chosen, Forward from the range's
    first page goes to its second, not to the next page of the document.
  - The page shown is fitted whole to the page area. A settings change keeps the reader on the same page number,
    or the last page when there are no longer that many.
  - The buttons are themeable icon controls with their own icon keys.

### Session 2026-11-20

- Maintainer feedback on MT-04 and MT-06, encoded as requirements:
  - A 500-expression document lagged as it typeset and as it scrolled, and Print Preview was slow to show its
    pages and to move between them (SC-006, FR-068a).
  - The page view jittered on load and on every page change: drawn at one size, then fitted to its area. A page
    MUST appear only once it is drawn at its final size, with a spinner while there is none yet (FR-068a).
  - The **mouse wheel** over the page, **Up / Down** and **Left / Right** arrows MUST step between pages; **Home**
    goes to the first page and **End** to the last (FR-068a).
- Defaults taken while encoding it (no question asked):
  - **Page Up / Page Down** step too, as they do in every page viewer. None of these keys turns a page while a
    field that takes them has focus (a number box, the page range).
  - One wheel notch is one page; a trackpad's small movements gather until they amount to one.
  - The window draws the pages itself, from the PDF main lays out once per settings change, rather than
    showing it in Chromium's PDF viewer: that viewer cannot be told when a page is ready to show, nor give its
    wheel and keys to the window. Stepping between pages lays nothing out again.
  - An equation's MathML stays in the document for a rich copy (FR-050) but is not laid out; the placeholder
    names the equation by its source for assistive technology.
- Maintainer direction, same session: an equation still loading MUST show a placeholder with a loading spinner,
  as a diagram does while it draws, and every inline thing in a preview that loads MUST show the same one
  (FR-043a). Resizing a preview holding many equations lagged (SC-006).
- Defaults taken while encoding it (no question asked):
  - The placeholder is the app's own spinner (the theme's `busy` glyph, turning), inline beside text for an
    inline equation or an image, and a block naming what it waits for ("Typesetting equation…", "Drawing
    diagram…") for a displayed equation or a diagram. It adds no text to a selection, a copy or a print: an
    equation still loading copies and prints as written.
  - Markdown images get it too: until an image arrives it is hidden and the placeholder stands in; a failed one
    gives way to its alternative text (FR-084).
  - While a preview's panel is being resized, the document keeps the width it had and the panel clips it
    sideways; it reflows to the new width once the width has been still for 150 ms, so a long document is laid
    out once per resize rather than once per frame.
- Maintainer report, same session: resizing panels beside a Markdown preview holding maths stayed markedly
  slower than beside any other preview — "the content of a markdown preview should not slow down the throng
  interaction" (SC-006). Measured over one splitter drag beside 500 equations: the preview's themed scrollbar,
  moved, counted as changed and laid out everything it scrolls on every frame. The preview hides its scrollbar
  while a drag lasts (its gutter stays), is its own compositor layer, and is contained; the same drag now
  costs what it costs beside plain text.
- Maintainer report, same session: after a Markdown preview with maths, the next preview opened in a new panel
  rather than the one already open. Not maths: the editor's Preview button always opened a preview beside its
  editor (047 FR-012), whatever preview was already showing; File Explorer, Quick Open and the drop already
  reused it. "Only one markdown preview should exist unless the user explicitly opens a second one" (FR-093a).
- Maintainer report, same session: printing `MT-01-callouts.md` with Pages = 1 printed three pages, losing content
  between them, and the paper differed from the preview. The preview was laid out by `printToPDF` and the printer
  laid the document out again itself (its margins in other units, its own scale, and a page range Chromium's
  silent print does not honour). Print now sends the pages the preview shows (FR-068d). The preview's page
  margins were also dark under a dark theme — its `color-scheme: dark` painted them — and would have printed so;
  paper is white in every theme now (FR-068c, FR-072).
- Maintainer direction, same session: custom margins drawn as a page, scale as common choices, numbers checked
  after typing, red outline and Print disabled while any is wrong, a printer list that follows the OS, Close only
  (FR-068b); editor panels, and every future panel that holds text except terminals, print too (FR-064a).
- Maintainer direction, same session: the Print Preview window, where possible, stays on top of other windows
  (FR-071); its settings pane needs and offers no scrollbars (FR-069). Measured at the window's former minimum
  (640 × 480) with every control shown, the pane overflowed by 15 px across (a fieldset is as wide as its
  content by default) and 192 px down. The controls now shrink to the pane, custom margins sit two to a row, and
  the window's minimum height is 600 px. *(Superseded 2026-11-21, converge T075: the minimum height is **680 px**.
  T066 raised it when FR-068b's margins page, scale choices and printer list joined the pane, so every control fits
  without a scrollbar.)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Callouts read as what they are (Priority: P1)

A user previews a meeting log that marks each block as an observation, a clarification or a question with
`> [!check] Observation`, `> [!info] Clarification` and `> [!question] Question`. Each block now renders as a
callout: a coloured box with an icon and a title row, styled by its kind, with no literal `[!info]` showing.
GitHub-style alerts in the same project's README (`> [!NOTE]`, `> [!WARNING]`) render sensibly too.

**Why this priority**: It is the issue with the most documents waiting on it, and every other callout story
builds on it.

**Independent Test**: Preview a fixture holding one callout of every registry type and alias, with and without
titles, and compare each rendered callout's type, title, icon and colour role to the registry.

**Acceptance Scenarios**:

1. **Given** `> [!info] Clarification` followed by a body line, **When** the file is previewed, **Then** an info
   callout titled "Clarification" shows the body, and no `[!info]` text is visible.
2. **Given** `[!NOTE]`, `[!Note]` and `[!note]`, **When** previewed, **Then** all three render as the same note
   callout.
3. **Given** `> [!check]`, **When** previewed, **Then** it renders as a **success** callout, carrying the
   success icon and colour role, titled "Check".
4. **Given** `> [!banana] Ripe`, an unknown type, **When** previewed, **Then** it renders as a note callout
   titled "Ripe".
5. **Given** `> [!warning]` with no title text and no body, **When** previewed, **Then** a warning callout
   titled "Warning" renders with no empty body area below its title row.
6. **Given** a plain blockquote with no marker, **When** previewed, **Then** it renders as a blockquote exactly
   as before this feature.

---

### User Story 2 - Callouts fold, nest and hold ordinary Markdown (Priority: P1)

A user's notes fold long callouts shut (`> [!example]-`), nest a warning inside an example, and put lists,
code, links, wikilinks, task lists, Mermaid diagrams and equations inside callouts. All of it renders as it
does outside a callout; folding works by mouse and keyboard; scroll sync and the fold gutter stay right.

**Why this priority**: Callouts that break their bodies, or that cannot be opened from the keyboard, are worse
than the plain quotes they replace.

**Independent Test**: Preview a fixture with collapsed, expanded and fixed callouts nested three deep, each
body holding one of every block type the preview renders; toggle each foldable callout by click and by
keyboard; scroll the parent editor and check the preview lands on the same line.

**Acceptance Scenarios**:

1. **Given** `> [!tip]-`, **When** previewed, **Then** the callout shows collapsed — title row only — with a
   control that expands it; **Given** `> [!tip]+`, **Then** it shows expanded with a control that collapses it.
2. **Given** a focused preview, **When** the user tabs to a foldable callout's title row and presses Enter or
   Space, **Then** the callout toggles.
3. **Given** `> > [!warning]` inside `> [!example]`, **When** previewed, **Then** the warning renders nested
   inside the example, and so on to any depth.
4. **Given** a callout body holding a list, a fenced code block, a table, a link, a wikilink, an image embed, a
   task list, a Mermaid block and an equation, **When** previewed, **Then** each renders exactly as it would
   outside a callout, and ticking the task list's checkbox writes the right source line (054 FR-020).
5. **Given** a parented preview of a document full of callouts with scroll sync on, **When** the user scrolls
   the editor to a line inside a callout, **Then** the preview shows that line, and the reverse.
6. **Given** a collapsed callout holding the word "upkeep", **When** the user finds "upkeep" in the preview,
   **Then** the callout expands to show the match.

---

### User Story 3 - Callouts follow the theme and the icon set (Priority: P2)

A user who designs their own theme opens Preferences → Themes and finds a **Markdown preview · Callouts** area
with seven colours, one per role. Changing the **warning** colour recolours every warning, caution and
attention callout in an open preview at once. With a user icon set selected, they override the **bug**
callout's icon, and the preview shows the new art.

**Why this priority**: Callouts must be legible in all fourteen shipped themes from day one; editing them is
the smaller, follow-on value.

**Independent Test**: For every shipped theme, render one callout per role and measure title and body text
against the tinted background; then edit a role colour and an icon override and watch an open preview follow.

**Acceptance Scenarios**:

1. **Given** any shipped theme, **When** a callout of each role renders, **Then** its title and body text pass
   the theme contrast guards against that role's tinted background.
2. **Given** Preferences → Themes, **When** the user opens the **Markdown preview · Callouts** area, **Then**
   seven role colours are listed and editable, each with a description naming the callout types it colours.
3. **Given** an open preview, **When** the user changes a role colour, **Then** every callout of that role
   recolours without reopening the preview.
4. **Given** a user icon set with an override for a callout type's icon key, **When** a callout of that type
   renders, **Then** it draws the override.

---

### User Story 4 - Maths typesets (Priority: P2)

A user previews an algorithm write-up with inline `$O(n \log n)$`, display `$$\sum_{i=1}^n i = \frac{n(n+1)}{2}$$`
blocks and a ` ```math ` fence. Each typesets in place, in the theme's text colour. A sentence that says
"costs $5 and $10" stays a sentence. A typo in one equation shows that equation's source, marked as an
error, while the rest of the document renders.

**Why this priority**: Research notes and design documents carry equations; the preview is unreadable for them
today. It is independent of callouts and printing.

**Independent Test**: Preview a fixture of GitHub's math cases — inline, display, fenced, dollar-sign prose,
escaped dollars, code spans holding dollars, malformed expressions and HTML-emitting commands — and compare to
the expected rendering for each.

**Acceptance Scenarios**:

1. **Given** `$…$`, `$$…$$` and ` ```math ` blocks, **When** previewed, **Then** each typesets: inline in the
   line, display centred on its own line.
2. **Given** `costs $5 and $10`, **When** previewed, **Then** it renders as text, by GitHub's rules for what
   opens a math span.
3. **Given** a malformed expression, **When** previewed, **Then** its source shows in place, styled as an error,
   its hover names the error, and the rest of the preview renders; no notice is raised.
4. **Given** the **Markdown: Typeset math** setting is turned off, **When** the preview next renders, **Then**
   every expression shows as its literal source again, with no restart.
5. **Given** `$\href{javascript:alert(1)}{x}$` or any command that would emit a link or raw HTML, **When**
   previewed, **Then** nothing executes, no request is made, and the command renders as an error or as text.
6. **Given** a preview of a document with no math, **When** it renders, **Then** the typesetter and its fonts
   are not loaded.

---

### User Story 5 - Print what a preview shows (Priority: P2)

A user wants a design note and its architecture diagram on paper. From the Markdown preview's menu they choose
**Print…**; a Print Preview window opens over the main window and shows the pages as they will print — light
background, dark text, readable code, callouts in colour, equations typeset, diagrams sharp, every collapsed
section and callout opened. They choose a printer, A4 landscape and narrow margins, and press **Print**.
Another time they press **Ctrl+P** in a focused `.mmd` preview, pick the OS's print-to-PDF in the same window
and print the diagram scaled to the page whatever its zoom on screen. Next week the Print Preview window opens
with the printer and settings they used last.

**Why this priority**: It completes the preview as a reading surface, but nothing else waits on it.

**Independent Test**: Through the platform seam's test double, open print preview for a fixture `.md` and a
fixture `.mmd`, change each page setting, and check the paginated output and the job handed to the seam;
with a real OS print-to-PDF, check headings are not stranded and diagrams are vector.

**Acceptance Scenarios**:

1. **Given** a focused `.md` preview, **When** the user opens its header or body menu, **Then** **Print…** is
   offered; **When** the user chooses it or presses Ctrl+P, **Then** the Print Preview window opens, takes focus
   and blocks the window it opened over until it closes, and nothing has been sent to a printer.
2. **Given** print preview is open, **When** the user changes page size, orientation, margins or scale,
   **Then** the paginated preview updates to match what will print; **When** they press **Print**, **Then**
   the job goes to the printer chosen in the window with those settings, with no further dialog.
2a. **Given** print preview is open on a document of several pages, **When** it has laid them out, **Then** it
   shows page 1 alone, fitted whole, with "Page 1 of N" beside a disabled **Back** and an enabled **Forward**;
   **When** the user presses **Forward**, **Then** page 2 is shown alone; **When** they press **Back**, **Then**
   page 1 is shown again. With a page range chosen, Back and Forward step through the pages of that range only.
3. **Given** the active theme is dark, or the user has edited the Light theme, **When** the document prints,
   **Then** it prints in throng's fixed print palette: a light page with dark text and readable code blocks.
3a. **Given** a document with a collapsed section and a collapsed callout, **When** it prints, **Then** both
   print expanded, and their on-screen fold state is unchanged afterwards.
3b. **Given** the user printed with a chosen printer and settings and then restarted throng, **When** they open
   Print Preview again, **Then** it starts from that printer and those settings.
3c. **Given** the Print Preview window is open, **When** Print… is requested again, **Then** no second window
   opens and the open one takes focus.
4. **Given** a document whose heading would fall at the foot of a page, **When** it paginates, **Then** the
   heading moves to the next page with its content; a code block, table row, diagram or equation that fits on
   one page is not split.
5. **Given** a `.mmd` preview zoomed to 300% and panned off-centre, **When** it prints, **Then** the whole
   diagram prints as vector output scaled to the page.
6. **Given** a `.md` with an embedded Mermaid diagram, **When** it prints, **Then** the diagram prints in place
   at the document's width.

---

### User Story 6 - Print is part of the preview contract (Priority: P3)

A developer adding the PDF preview (#388) or the image preview (#441) declares that their provider can print
and supplies its printable output — the PDF's own pages, or an image fitted to the page — and gets Print…,
the key binding and the Print Preview window without touching the print UI.

**Why this priority**: No provider beyond Markdown and Mermaid exists yet; the contract only has to admit them.

**Independent Test**: A contract test registers a fake provider that does not print and one that supplies
ready-made pages; the first shows the print actions disabled, the second prints through the same UI.

**Acceptance Scenarios**:

1. **Given** a preview whose provider does not declare printing, **When** the user opens its menu, **Then**
   Print… is shown disabled, with a hover saying the preview type cannot be printed, and Ctrl+P does nothing.
2. **Given** a test provider that supplies ready-made pages, **When** the user prints from it, **Then** the
   same print preview and print flow run with no change to the print UI.

---

### Edge Cases

**Callouts**

- **Marker not on the first line**: `[!info]` on a blockquote's second line is text; the blockquote stays plain.
- **Marker with no space before the title** (`> [!info]Title`): follows the parser's reading of Obsidian
  syntax; the parser pin test (FR-015) records which.
- **Inline Markdown in a title** (`> [!tip] Use **this**`): the title renders its inline Markdown.
- **Hostile type or title** (`> [!<img src=x onerror=…>] <script>…`): renders as an unknown-type note or as
  text; nothing executes (FR-014).
- **Callout inside a list item**, or a list item inside a callout: renders as the parser reads it, with both
  structures intact.
- **Heading inside a callout**: behaves exactly as a heading inside a plain blockquote does today for the
  outline, section folding and fold gutter; this feature does not change it.
- **Editing the fold sign**: changing `-` to `+` in a parented preview's source resets that callout to the new
  sign's state at the next render; other callouts keep their state.
- **Live re-render**: typing elsewhere in the document does not re-collapse a callout the user opened.
- **Collapse All / Expand All** (047 FR-038): leaves callouts as they are.
- **Copy**: copying a selection that holds a callout copies its title and body text, not the `[!type]`
  marker, in plain text; in rich text it keeps the callout's markup. *(Made precise 2026-11-21, converge T076: the
  rich copy is a quotation headed by the callout's title in bold, then its body, nested as the callouts nest — the
  form other applications paste. The `[!type]` marker, icon and fold control are not copied.)*
- **User theme created before this feature**: lacks the seven role tokens and takes them by the same rule that
  fills any other token a saved theme lacks; nothing is lost and the theme still loads.
- **User icon set**: a set with no override for a callout key shows the default art (069 FR-015).

**Maths**

- **Escaped dollar** (`\$5`): a literal dollar sign, never a math delimiter.
- **Dollars inside code** (`` `$x$` ``, fenced code): never math.
- **GitHub's code-span form** (`` $`x^2`$ ``): typesets, as GitHub does.
- **Display maths across lines**: `$$` on its own line, expression lines, closing `$$`: one display equation.
- **Unclosed `$$`**: the text stays text; the rest of the document renders.
- **Pathological input** (a macro that expands without end, a rule thousands of ems wide): stopped by the
  typesetter's limits and shown as an error; the preview stays responsive (FR-048).
- **Maths in a heading**: the heading typesets; the outline (047 FR-042) shows the heading's text with the
  expression as its source.
- **Maths inside a callout, a table cell or a list**: typesets in place.
- **Maths in a Mermaid label or a `.mmd` file**: out of scope; unchanged.
- **Find** with typesetting on: does not match inside an equation; with it off, matches the source as today.

**Printing**

- **Parented preview with unsaved changes**: prints what the preview shows — the editor's current content —
  not the file on disk.
- **The document changes while print preview is open**: print preview keeps the content it opened with until
  the user refreshes it or reopens it.
- **No printer installed**: print preview still opens; the printer list offers the OS's print-to-PDF where the
  OS has one, or says that no printer is available, and Print is disabled.
- **The saved printer is gone** (uninstalled, or the settings came from another machine): print preview starts
  from the OS's default printer and keeps every other saved setting that printer supports.
- **User closes Print Preview without printing**: nothing is printed and no notice is raised; the settings
  changed in the window are still saved.
- **Collapsed sections and callouts**: print expanded (FR-074); the preview's own fold state is not touched.
- **Unreadable or corrupt saved print settings**: print preview starts from the defaults, the problem is logged,
  and no notice is raised.
- **The window Print Preview is modal to closes** (its project closes, a sub-workspace window is closed from
  elsewhere): the Print Preview window closes with it.
- **Printing fails** (the OS refuses the job, the printer errors): one notice naming the cause, in the window
  that started it; the failure is logged (Principle XIII).
- **Very long document** (hundreds of pages): print preview shows progress while it paginates and the window
  stays responsive (Principle XII).
- **Remote images**: print only if they loaded under the **Load remote images** setting (044 FR-092); printing
  fetches nothing.
- **A table wider than the page**: fits the page width by the table sizing rules (047 FR-060 – FR-062), never
  clipped.
- **A code line longer than the page**: wraps, never clipped.
- **A diagram taller than a page**: scales to fit one page where it can still be read; otherwise it splits
  across pages rather than being clipped.
- **Preview in a sub-workspace window**: printing works the same; the Print Preview window opens modal to that
  window.
- **Links**: print as their text; nothing about following them prints.

## Requirements *(mandatory)*

### Functional Requirements

#### Callout syntax and rendering (#672)

- **FR-001**: A blockquote whose first line begins with `[!type]` MUST render in a Markdown preview as a
  **callout**: a block with an icon and a title row, styled by its type, with the marker itself hidden. The
  type MUST match case-insensitively. Any other blockquote MUST render exactly as it does today.
- **FR-002**: The text after the marker on the first line MUST be the callout's **title**, rendering its
  inline Markdown. With no title text, the title MUST be the type as written, in title case (`[!tldr]` →
  "Tldr"; `[!NOTE]` → "Note"), except that a marker naming a registry type by its canonical id takes that
  entry's default title.
- **FR-003**: A callout MAY be title-only. A title-only callout MUST render no empty body area: no blank
  paragraph, no gap below the title row.
- **FR-004**: The callout's **body** — the blockquote's remaining lines — MUST render as ordinary Markdown,
  exactly as it would outside a callout: lists, task lists (054 FR-020 – FR-025 included), code blocks, tables,
  links, wikilinks, image and Mermaid embeds, Mermaid blocks and equations (FR-040).
- **FR-005**: A callout inside a callout (`> > [!type]`) MUST render nested inside it, to any depth.
- **FR-006**: **Folding.** `[!type]+` MUST render the callout expanded and collapsible; `[!type]-` MUST render
  it collapsed — title row only — and expandable; with neither sign the callout MUST NOT be collapsible. The
  fold control MUST use the same expand and collapse icon keys as a heading's fold arrow (047 FR-032) and
  carry a hover naming the action.
- **FR-007**: A foldable callout MUST toggle by a click on its title row or fold control, and by Enter or
  Space while its title row has keyboard focus. Tab and Shift+Tab MUST stop on each foldable callout's title
  row, in document order with the preview's links (extends 044 FR-096b), with the theme's visible focus
  indicator.
- **FR-008**: A callout's fold state MUST be view state only (044 FR-020, 047 FR-035): it MUST NOT change the
  document, mark it dirty or add an undo step. It MUST survive a live re-render of the same preview, and MUST
  start from the marker's sign when the document is reopened or the marker's sign changes.
- **FR-009**: Collapse All / Expand All (047 FR-038) and the section fold commands (047 FR-037) MUST NOT change
  any callout's fold state.
- **FR-010**: Reaching a find match, a link target or a heading inside a collapsed callout MUST expand that
  callout and every collapsed callout around it, as 047 FR-040 does for a collapsed section.
- **FR-011**: Find in a preview (047 FR-002) MUST match a callout's displayed title and body text, and MUST NOT
  match its `[!type]` marker.
- **FR-012**: Scroll synchronisation (044 FR-121, 047 FR-041a) and the preview's fold gutter MUST stay correct
  across callouts: every line inside a callout, and the callout's own first line, MUST map to the same source
  line it would map to in a plain blockquote.

#### Parser and markup (#672)

- **FR-013**: The callout syntax MUST be parsed by `markdown-it-obsidian-callouts` (Apache-2.0, compatible with
  throng's AGPL-3.0-only), used **as a parser only**. throng MUST emit the callout's markup itself: the
  package's renderer, built-in icons, built-in type list and `data-callout` value (which keeps an alias as
  written) MUST NOT reach the display.
- **FR-014**: The sanitiser (044 FR-081) MUST admit exactly the elements, classes and attributes throng's
  callout markup uses, and nothing more. A callout's type and title MUST NOT be able to inject markup or run
  code: a test MUST render hostile types and titles and assert that the sanitiser is in the path for callouts.
- **FR-015**: A test MUST pin the parser's behaviour for every form in FR-001 – FR-006 against the
  Markdown engine throng ships, so a parser or engine upgrade that changes it fails the build.
- **FR-016**: The parser's admonition fences (` ```ad-<type> `, the syntax of the third-party Obsidian
  "Admonition" add-on) MUST be disabled: they render as ordinary fenced code, exactly as before this feature. A
  test MUST pin it. Rendering them as callouts is out of scope.
- **FR-017**: No stylesheet from the parser package or its repository, and no colour value from it or from
  Obsidian, MUST ship in throng. The parser's Apache-2.0 notice MUST appear in the About window's third-party
  licences.

#### The callout type registry (#672)

- **FR-018**: throng MUST define its own **callout type registry**, once, in the core package. Each entry MUST
  declare a canonical id, its aliases, its default title, its icon key and its colour role. The registry, not
  the parser, MUST resolve an alias to its type, and a rendered callout MUST carry its canonical type.
- **FR-019**: The registry MUST ship with these entries; an unknown type MUST render as **note**, keeping its
  own title (FR-002):

  | Type | Aliases | Colour role |
  |---|---|---|
  | note | — | neutral |
  | abstract | summary, tldr | info |
  | info | — | info |
  | todo | — | info |
  | tip | hint, important | accent |
  | success | check, done | success |
  | question | help, faq | question |
  | warning | caution, attention, warn | warning |
  | failure | fail, missing | danger |
  | danger | error | danger |
  | bug | — | danger |
  | example | — | accent |
  | quote | cite | neutral |

- **FR-019a**: A unit test MUST fail when a registry entry lacks an icon key or a colour role, names an icon
  key that does not exist, names a role outside the seven, or shares an id or alias with another entry.
  Adding a type MUST need one registry entry and its icon art, and no change to the renderer, sanitiser or
  styles.

#### Callout colours and icons (#672)

- **FR-020**: Callouts MUST be styled only by throng's own preview styles and theme tokens. Each of the seven
  **colour roles** — neutral, info, accent, success, question, warning, danger — MUST be one theme colour token,
  colouring the callout's border, icon and title; the callout's background MUST be a tint of that colour over
  the preview background, using the theme's existing tinting mechanism. A role colour change MUST show in an
  open preview without reopening it (044 FR-083).
- **FR-021**: The seven role tokens MUST be listed and editable in a **Markdown preview · Callouts** area of
  the Themes editor, each with a description naming the types it colours. **Markdown preview** joins the closed
  set of Themes-editor areas (extends 021 FR-003), ordered after **Editor**.
- **FR-022**: Every shipped theme MUST define all seven role tokens with values chosen for that theme.
- **FR-023**: The theme contrast guards MUST check, in every shipped theme and for every role: the title
  text against the role's tinted background, and the body text against it, at the body-text threshold the
  guards already use; and the icon against it at the guards' non-text threshold.
- **FR-024**: Each canonical type MUST have its own icon key in throng's icon set, with art drawn from the
  default Lucide set, a description (069 FR-012), and a line in the icon sets `README.txt` (069 FR-035). The
  thirteen icons appear together and MUST be visibly distinct from each other (069 FR-009). A user icon set MAY
  override each one like any other icon (069 FR-032).

#### Typeset maths (#393)

- **FR-040**: *(Supersedes 044 FR-086 for math, and 054 FR-040's "math stays literal text".)* A Markdown
  preview MUST typeset inline `$…$`, display `$$…$$`, GitHub's code-span form `` $`…`$ ``, and fenced blocks
  tagged `math`, in the same places GitHub's renderer recognises them.
- **FR-041**: What opens a math span MUST follow GitHub's rules, so prose dollars stay text: an opening `$`
  not followed by whitespace, a closing `$` not preceded by whitespace and not followed by a digit; `\$` is a
  literal dollar; nothing inside a code span or code block is math.
- **FR-042**: A setting **Markdown: Typeset math** MUST exist under **Editor → Previews → Markdown** (054 FR-050,
  FR-052), on by default, with a descriptor like any other setting (Principle X). Turned off, every expression
  MUST render as its literal source, exactly as 044 FR-086 rendered it; changing it MUST re-render open
  previews without a restart.
- **FR-043**: Equations MUST take their colour from the preview's text colour and follow a theme change
  without reopening, legible in every shipped theme (044 FR-083).
- **FR-043a**: *(2026-11-20.)* Anything in a preview still loading — an expression the typesetter has not yet
  drawn, an image still arriving, a diagram still drawing — MUST hold its place with ONE shared placeholder: the
  app's loading spinner, inline for inline content, a block naming what it waits for otherwise, named for
  assistive technology. It MUST NOT add text to a selection, copy or print; content still loading copies and
  prints as itself.
- **FR-044**: A malformed expression MUST show its source in place, styled as an error from theme tokens, with
  a hover naming the error. The rest of the document MUST render, and no notice MUST be raised for it.
- **FR-045**: A display equation MUST carry its source line, so scroll sync (044 FR-121) and the fold gutter
  land on it.
- **FR-046**: The typesetter's fonts MUST ship with the application and MUST never be fetched (044 FR-093).
  The typesetter and its fonts MUST NOT load for a preview with no math in it, or while the setting is off.
- **FR-047**: Typeset output MUST pass through the sanitiser (044 FR-081), which MUST admit what the
  typesetter emits for maths and nothing that can run code or load a resource. Every command that emits a link,
  raw HTML, a class, an id, a style or an external resource (`\href`, `\url`, `\includegraphics`, `\htmlClass`,
  `\htmlId`, `\htmlStyle`, `\htmlData` and their like) MUST be disabled: it renders as an error or as text,
  executes nothing and requests nothing. A test MUST assert the sanitiser is in the path for maths.
- **FR-048**: The typesetter MUST run with limits on macro expansion and on rendered size, so no expression can
  hang the preview or the window (Principle XII); an expression that hits a limit renders as an error (FR-044).
- **FR-049**: Find in a preview (047 FR-002) MUST NOT match inside a typeset equation. With the setting off it
  matches the source as it does today.
- **FR-050**: Copying a selection that holds an equation MUST put, in its place, the typeset equation when the
  copy format is **Rich text**, and its source with its delimiters when it is **Plain text** (as 054 FR-049a
  does for a diagram).
- **FR-051**: The typesetter and any Markdown-engine plugin it needs MUST be distributable under terms
  compatible with AGPL-3.0-only, and their notices — and those of the shipped fonts — MUST appear in the About
  window's third-party licences.

#### Print capability in the preview contract (#484)

- **FR-060**: The preview provider contract (044 User Story 5) MUST let a provider declare whether it can
  print, and, when it can, supply its **printable output** for the preview's current content. The output MAY
  be a flowing document that throng paginates, or ready-made pages that throng prints as they are (a future
  PDF provider's own pages).
- **FR-061**: The Markdown and Mermaid providers MUST declare printing. *(Amended 2026-11-20 18:02, the maintainer:
  "Add support for printing to PDFs, image previews, CSVs and editors.")* So MUST the Image, SVG, PDF, CSV and
  Spreadsheet providers (FR-075a – FR-075c); every one prints a flowing document throng paginates, the PDF's own
  pages drawn as such a document. The HTML provider does not print. A new provider MUST be able to add
  printing through its own registration alone, with no change to the print commands, menus, key binding or
  print preview (the 044 User Story 5 test, applied to printing). A contract test MUST prove it with a fake
  provider that supplies ready-made pages.
- **FR-062**: A preview whose provider does not print MUST show **Print…** disabled, never absent, with a hover
  saying that this preview type cannot be printed; the key binding MUST do nothing there.

#### Print commands (#484)

- **FR-063**: Every preview panel MUST offer **Print…** in its header and body right-click menus, and in every
  other menu that lists the panel's actions (every panel action has a menu item).
- **FR-064**: **Print…** MUST be a bindable command scoped to the preview panel, shipping bound to **Ctrl+P**,
  which no shipped binding holds in that scope. Print… MUST open the Print Preview window (FR-071) for the
  preview's printable output and MUST NOT itself send anything to a printer: no print job is ever started
  before Print Preview has been shown. There is no separate Print Preview… command (Clarifications, 2026-11-18).
- **FR-064a**: *(2026-11-20.)* Every panel that holds text, except a terminal, MUST print the same way: **Print…**
  in its header menu and on a bindable command shipping as **Ctrl+P** in its scope opens Print Preview for its
  content. For an editor (`editor.print`, editor scope) that is the whole document as it stands, unsaved edits
  included, in its font, wrapped at the page width, syntax-highlighted in the print palette where the document's
  language is known. A terminal is never offered it, and **Ctrl+P** there still reaches the shell.
  *(Amended 2026-11-20.)* An editor's right-click body menu MUST offer **Print…** too, in its Navigate section
  beside Go To Line… and Open Preview, as a preview's body menu does (FR-063): every panel action is reachable from
  the panel's own menus.
- **FR-065**: Printing MUST go through the platform seam (Principle II), so every print path is testable with
  no printer, and MUST work on Windows and Linux, and on macOS as far as CI proves it.
- **FR-066**: Printing, and opening or closing print preview, MUST NOT change the preview's scroll position,
  zoom, fold state, selection, find state or diagram views.
- **FR-067**: Printing MUST work from a preview in any window, sub-workspaces included.

#### Print preview (#484)

- **FR-068**: The Print Preview window MUST show the printable output paginated exactly as it will print, with
  these controls: **printer** (the printers the OS reports, its default selected, and its print-to-PDF where it
  has one), **page size** (the sizes throng offers for the selected printer), **orientation** (portrait,
  landscape), **margins** (default, none, minimum, custom), **scale** (a percentage, plus **Fit to page
  width**), **pages** (all or a range) and **copies**, and a **Print** decision button that sends the job to the
  chosen printer with those settings and no further OS dialog, then closes the window.
- **FR-068a**: *(2026-11-19.)* The Print Preview window MUST show **one page at a time**, fitted whole to the
  page area, laid out exactly as it will print, with **Back** and **Forward** buttons that show the page before
  and after, and the page's position among the pages that will print ("Page 2 of 5", digit-grouped). The pages
  stepped through MUST be the pages that will print, honouring a chosen page range. Back MUST be disabled on the
  first page and Forward on the last, and both while the pages are being laid out. A settings change MUST keep
  the same page number, or the last page when there are fewer. Back and Forward are themeable icon controls
  with a hover title naming the action. *(2026-11-20.)* The **mouse wheel** over the page (a page per notch), the
  **arrow keys** and **Page Up / Page Down** MUST step a page, and **Home** and **End** MUST go to the first and
  last page, except while a field that takes those keys has focus. A page MUST be shown only once it is drawn at
  its final size: the page before stays until then, and a spinner stands in while there is no page yet. Stepping
  between pages MUST NOT lay the document out again.
- **FR-069**: Changing any control MUST update the paginated preview to match, without blocking the window
  (Principle XII); a long pagination MUST show progress. *(2026-11-20.)* The settings pane MUST NOT scroll in
  either direction: every control, with custom margins and a page range shown, MUST fit it at the window's
  minimum size, and no control may widen it.
- **FR-070**: *(Supersedes this spec's draft session-only default.)* The print settings — printer, page size,
  orientation, margins, scale and copies — MUST be saved by throng and persist across previews and across
  sessions, so the next Print Preview starts from the last ones used. They MUST be saved when the window
  prints or closes. The page range MUST NOT persist: each Print Preview starts at **All**. They are
  application state, not a preference: they live in their own state file in throng's data directory (beside
  `window-state.json`), have no settings descriptor and appear in no Preferences tab. A saved printer that no
  longer exists MUST fall back to the OS's default printer, and a saved value the chosen printer cannot take
  MUST fall back to that control's default; an unreadable file MUST fall back to the defaults, logged and with
  no notice (Principle XIII).
- **FR-071**: Print preview MUST open in **its own throng window**, modal to the window the Print… request came
  from: it takes focus, that window takes no input while it is open, and it closes when that window closes.
  *(2026-11-20.)* Where the platform allows, it MUST stay above other windows — throng's and other
  applications' — while it is open. At
  most one Print Preview window MUST exist at a time; a Print… request while one is open MUST focus it and
  MUST NOT open a second window or change the open one's content. The window MUST follow the active theme for
  its own chrome (the pages it shows use the print palette, FR-072). Its controls MUST follow the
  themeable-icon rule; **Print** and **Cancel** are dialog decision buttons and keep text labels; Escape
  cancels.

- **FR-068b**: *(2026-11-20.)* The controls MUST read as follows:
  - **Custom margins** are drawn as a page: a white sheet with a millimetre box at each edge (top, right, bottom,
    left), unlabelled beyond "mm". *(Amended 2026-11-20 17:21, the maintainer: "the 'mm' for the left and right
    margins should be underneath the box so they do not push the page sideways. The page can be a little larger
    so the spacing around it is uniform.")* The left and right boxes carry their "mm" below them, and the sheet
    fills the space between the four boxes, the same gap on every side; FR-069's no-scroll rule still holds.
    *(18:00, the maintainer: "center align the top and bottom boxes, and have the 'mm' offset so the boxes are
    aligned center, but the 'mm' follows them.")* The top and bottom boxes are centred on the page by the box
    alone, each "mm" following just after its box without moving it.
  - **Scale** is a choice of 25, 50, 75, 100, 125, 150, 175 and 200 %, or **Custom**, which shows a box for any
    whole percentage in range. A stored scale that is not a choice shows as Custom.
  - Every number is typed as free text and checked once typing stops (half a second) or the field is left. A
    value outside its range, or not a number, is outlined red with the allowed range as its hover title, and
    **Print** stays disabled until every field checks out; nothing is laid out from an unchecked value.
  - The **printer** list follows the OS's: a printer added or removed while the window is open appears or goes
    within a few seconds, the chosen one kept while it is there.
  - The title bar offers **Close** only.
  - *(18:10, the maintainer: "For 'Paper size', show the size in mm next to each option, depending on the
    orientation selected.")* Each **Paper size** option reads its name and its size in millimetres, width first,
    turned for the chosen orientation — "A4 (297 × 210 mm)" in landscape — read from the paper table, never
    written out by hand.
  - *(18:10, the maintainer: "When 'landscape' is selected, the example page for margins should switch to
    landscape.")* The custom-margins page is drawn in the chosen paper's proportions, turned for the orientation,
    with the even gap and FR-069's no-scroll rule kept.
- **FR-068c**: *(2026-11-20.)* The page MUST be shown white in every theme, with the margins outlined in dashes
  where the printed content stops; the outline is the window's and is never printed.
- **FR-068d**: *(2026-11-20; the maintainer: the print differed from the preview and ignored the page range.)*
  **Print** MUST send the printer exactly the pages the preview shows — each drawn whole, margins included — so
  the chosen range, margins, scale and page breaks on paper are the preview's. The printer lays nothing out
  again and adds no margin, scale or range of its own.
- **FR-068e**: *(2026-11-20; known gap 1.)* A page range naming pages past the document's last page MUST be clipped
  to the pages there are — `2, 5-9` of a 3-page document shows and prints page 2 — never refused with a layout
  error. When **every** page it names lies past the last, the range box MUST carry the same red outline a
  malformed range does, with a message giving the document's page count ("This document has 3 pages."); no page
  is shown and Print stays disabled.
- **FR-068f**: *(2026-11-20 18:10, the maintainer: "Add an option to 'center' print previews. This should center the
  preview's canvas on the print canvas — especially important for images and SVGs.")* Print Preview MUST offer
  **Centre on page**, one checkbox for both directions (a picture has one middle; a pair would offer half-centred
  layouts nobody asked for). It is kept for each kind of print and persists with the other settings (FR-070): on
  by default for a picture, a diagram fitted to the page and a PDF's pages, which then sit in the middle of each
  sheet both ways; off by default for a flowing document, where on centres only what is narrower than the text
  column — an image, a diagram, a table — and never text.
- **FR-068g**: *(2026-11-21 11:24, the maintainer: "A PDF's own page size should choose the print paper size.")*
  When Print… starts from a document with its own page size (a PDF, and any provider's ready-made pages), Print
  Preview's paper MUST start at that size: the first page's, in millimetres, turned the way that page is. A listed size
  within a millimetre of it is that size (a PDF's points round A4 to 209.9 × 297 mm); a size none of them is, is offered
  as **Custom (W × H mm)**, after the listed sizes and only for that job. The user can still choose any other paper.
  The page's own paper does not persist (FR-070): closing on it leaves the stored paper size and orientation as they
  were, so the next Markdown print starts where it did; a listed size the user chose instead persists as before.

#### What prints (#484)

- **FR-072**: Printed output MUST use throng's own **print stylesheet**, independent of every theme — a light
  page, dark text, readable syntax-highlighted code. Its palette is defined once, privately, by throng; it
  starts as a copy of the shipped default Light theme's values but is a separate, fixed palette that no theme
  edit, Light included, can change, and it is not user-customisable in this iteration. Callouts MUST print with
  the print palette's role colours and their icons, and equations typeset, in that palette. A test MUST fail
  when the print palette lacks a value for a token the printed output uses, and its text colours MUST pass the
  theme contrast guards against its own page and callout backgrounds.
- **FR-073**: Pagination MUST keep a heading with the content that follows it, and MUST NOT split a code
  block, a table row, a callout's title from its body, a diagram, an image or a display equation across pages
  where it fits on one page. A code line longer than the page MUST wrap, and a table wider than the page MUST
  fit the page width (047 FR-060 – FR-062); nothing is clipped.
- **FR-074**: Collapsed sections (047 FR-032) and collapsed callouts (FR-006) MUST print expanded, whatever
  their state on screen: printing prints the full document. Printing MUST NOT change their on-screen state
  (FR-066).
- **FR-075a**: *(2026-11-20 18:02.)* An Image or SVG preview MUST print its picture fitted to the page in both
  dimensions, its shape kept, and never larger than its own size (an image's pixels, an SVG's width and height);
  Print Preview's Scale still enlarges it. *(18:10, the maintainer: "SVG Print preview does not show anything.")* A
  picture MUST print as itself in every route — an Image or SVG preview, an `svg` fence, an embedded `.svg`, a
  picture in a Mermaid or Markdown preview — never as a blank page: a picture drawn from a `blob:` URL is inlined
  from its own bytes, which the frame showing it carries as the picture it copies does.
- **FR-075b**: *(2026-11-20 18:02.)* A CSV Preview Editor, and a workbook's sheet on screen, MUST print as a table
  holding every row, not the rows in view: the header row, where the grid treats the first row as headers (a CSV's
  **Lock first row**, a workbook's **First row is header**), repeated at the top of every page; the columns in the
  grid's width proportions across the page width; a cell's text wrapping within its column; a page break only
  between rows. A workbook prints the sheet on screen, not every sheet. The grids' own menus offer **Print…** as
  every other preview's do (FR-063).
- **FR-075c**: *(2026-11-20 18:02.)* A PDF preview MUST print the PDF's own pages, one per sheet of paper, each fitted
  whole within the margins with its shape kept, read from the file (not from what the preview has drawn). The
  paper is Print Preview's choice; a page of another size is fitted to it.
- **FR-075**: Diagrams — standalone and embedded — MUST print as vector output at the page's resolution,
  regardless of the diagram's zoom, pan or Full Pane state (054 FR-046a – FR-046h). An embedded diagram MUST
  print in place, scaled down to the text width when wider; a standalone `.mmd`/`.mermaid` diagram MUST print
  fitted to the page in both dimensions by default.
- **FR-076**: The preview's on-screen furniture MUST NOT print: fold arrows and controls, diagram view
  controls, find highlights and match outlines, the selection, link hints and hover tooltips, the status bar
  and any inline preview notice other than one that replaces content (a failed diagram's notice prints in its
  place).
- **FR-077**: Links MUST print as their text.
- **FR-078**: A parented preview MUST print the content the preview shows — the editor's current content,
  saved or not. Print preview MUST keep the content it opened with until it is refreshed or reopened.
- **FR-079**: Printing MUST NOT fetch anything: a remote image prints only if the preview already loaded it
  under 044 FR-092; every other resource stays blocked (044 FR-093).
- **FR-080**: A print that fails MUST raise one notice naming the cause, in the Print Preview window when it is
  still open and otherwise in the window that started it, and
  MUST be written to the diagnostic log (Principle XIII; 030). A print cancelled by the user MUST raise nothing.
- **FR-081**: A print preview with no printer to print to MUST say so in place of the printer list, and its
  Print button MUST be disabled.

#### Configuration, documentation and licences

- **FR-090**: Every setting, theme token, icon key and key binding this feature adds MUST have a descriptor
  the preferences editor renders, and MUST pass the configuration-editor completeness test.
- **FR-091**: `docs/key-bindings.md` MUST list Print…; `docs/preferences.md` MUST describe
  **Markdown: Typeset math** and the **Markdown preview · Callouts** colours; the docs page for previews MUST
  describe callouts, maths and printing, in the same change (documentation currency).
- **FR-092**: Every new third-party dependency MUST be recorded with its licence in the plan's research, MUST
  be compatible with AGPL-3.0-only, and MUST appear in the About window's third-party licences
  (FR-017, FR-051).

#### Where a preview opens

- **FR-093a**: *(2026-11-20; supersedes 047 FR-012 for Last Active.)* Under **Open previews in: Last Active**,
  opening a preview of a file that is open in an editor — the editor's Preview button included — MUST reuse the
  most recently active preview of the file's type in the requesting window's visible tab (047 FR-011, FR-015,
  054 FR-007), which then pairs with that editor (044 FR-013). A new preview opens beside the editor only when
  no preview of that type exists there, under **New**, or from **Open In → New Preview Panel**. 047 FR-013 (a
  file already previewed is focused) and FR-016 (a reused preview leaves its earlier editor) stand.
- **FR-093b**: *(2026-11-20; the maintainer: "When clicking 'open in editor' in any preview, the 'Open files in'
  preference should control where the editor opens … This applies to all previews, and vice-versa for opening
  previews from editors." Supersedes 044 FR-015c's placement for **Last Active Editor**.)* A standalone preview's
  **Open in Editor** — every text provider's: its header menu, body menu and status-bar button, and the CSV
  preview's grid menu and parse-error notice — MUST honour **Open files in** (`editor.openTarget`, 023
  FR-025/FR-026) as the file tree does. Under **Last Active Editor** the file opens in the tab's most recently
  active editor, by the same open the file tree and Quick Open use (one-buffer focus, refusal and the
  unsaved-changes prompt included); only when the tab holds no editor does the preview place a new one beside it,
  as FR-015c describes. Under **New Editor** it opens in a new editor beside the preview (FR-015c, unchanged). A
  file already open in an editor is focused either way (006 FR-011a), and **Go to Editor** on a parented preview
  (044 FR-015d) is unchanged. The other direction is FR-093a: an editor's Preview button, its menus' Open Preview
  and `preview.open` follow the file's provider's **Open previews in** (047 FR-010). Following a link from a
  preview already honoured **Open files in** (044 FR-090d) and is unchanged.

### Key Entities

- **Callout**: a blockquote marked `[!type]` on its first line. Has a written type, a canonical type resolved
  by the registry, a title, an optional body, a fold sign (none, `+`, `-`) and, while shown, a fold state
  (view state only).
- **Callout type registry entry**: canonical id, aliases, default title, icon key, colour role. Lives once in
  the core package; the only source of callout types.
- **Colour role**: one of neutral, info, accent, success, question, warning, danger. One theme colour token
  each; the callout's background is a tint of it.
- **Math expression**: an inline, display or fenced TeX expression with its source line, its typeset output
  or an error, and its source for copying.
- **Print capability**: a provider's declaration that it prints, and how it supplies its printable output.
- **Printable output**: either a flowing document throng paginates, or ready-made pages.
- **Print settings**: printer, page size, orientation, margins, scale, pages, copies. All but the page range
  persist across sessions in a state file in throng's data directory (FR-070); not a preference.
- **Print palette**: throng's private, fixed print colours — page, text, code, syntax and the seven callout
  roles — seeded from the shipped Light theme and changed by no theme edit (FR-072).
- **Print Preview window**: a throng window of its own, at most one, modal to the window that requested it
  (FR-071).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every type and alias in the registry, in upper, lower and mixed case, renders as its canonical
  type with its icon and colour role, and none shows a literal `[!…]` marker, measured on a fixture of all
  thirteen types and fifteen aliases.
- **SC-002**: In all fourteen shipped themes, every callout role's title and body text pass the contrast
  guards against its tinted background, with no exemption.
- **SC-003**: A user can open and close every foldable callout in a three-deep nested fixture using only the
  keyboard.
- **SC-004**: In a document of at least 200 lines that is mostly callouts, editor-to-preview scroll sync lands
  on the target line, measured at ten points spread through the document.
- **SC-005**: Every typesetting case in GitHub's documented math examples renders as GitHub renders it, and
  every prose dollar case stays text.
- **SC-006**: A document with 500 expressions previews with the window still answering input throughout, and
  a document with none loads no typesetter code or fonts. *(2026-11-20.)* Typesetting it lays the document out
  once, not once per batch, and redrawing it (a keystroke in its editor) typesets no expression again.
  Resizing its panel lays it out once the resize settles, not on every frame of the drag, and dragging a panel
  edge beside it costs what it costs beside the same text untypeset. *(Amended 2026-11-20 17:24, the maintainer:
  "The resize render debounce that has been added for previews — I don't like it. Can we make previews resize
  dynamically / on the fly again, but just reduce the amount of redraws … Alternatively, apply the resize debounce
  on previews over a certain size instead, and keep the dynamic resize for smaller previews?")* A preview's body
  MUST follow its panel live while a drag lasts, taking the panel's latest width at most once per animation frame.
  The settle above applies only where the layout is dear, by measured cost rather than by file size: a drag is held
  once two width changes in a row each add more than **16 ms** (one 60 Hz frame) to the frame that draws them, and
  the next drag starts held while the last release measured dear; a release that measures cheap makes the next drag
  live again. The 500-expression document stays within the bound above: its drag costs what plain text's does.
- **SC-007**: No hostile callout or math input in the sanitiser fixture executes code or makes a network
  request.
- **SC-008**: A 20-page Markdown document's print preview updates within two seconds of any settings change.
- **SC-009**: In printed output of a fixture document, no heading is the last line of a page, and no code
  block, diagram or equation that fits on one page is split.
- **SC-010**: A `.mmd` diagram prints identically whatever its on-screen zoom and pan.
- **SC-011**: A test provider adds printing with no change to the print UI's code.
- **SC-012**: Through the platform seam's test double, no print job is ever recorded without a Print Preview
  window having been shown for it first, measured across Print… from the menu, from Ctrl+P and from every
  window type.
- **SC-013**: Print settings chosen in one session are the ones the next session's Print Preview starts from,
  and editing the Light theme changes no colour of a printed page.

## Assumptions

- **Parser**: `markdown-it-obsidian-callouts` (Apache-2.0, no runtime dependencies) was checked by the
  maintainer at 0.3.5 against throng's markdown-it 15.0.3: types, titles, folding, nesting and plain
  blockquotes render correctly. It declares a markdown-it ^14 peer range, so the plan adds a dependency override
  and FR-015's pin test guards it.
- **Typesetter**: KaTeX (MIT) is the expected typesetter — HTML/CSS output, no runtime fetch, a `trust`
  switch that disables HTML-emitting commands, and expansion and size limits. Its fonts ship in its package;
  the plan's research confirms each font's licence (SIL OFL 1.1 where it applies) and picks a Markdown-engine
  plugin under an AGPL-compatible licence (MIT candidates exist) that follows GitHub's delimiter rules, or
  writes the delimiter rule itself if none does.
- **Printing** uses the application's own printing and print-to-PDF facilities behind the platform seam; print
  preview is built from throng's own pagination of the printable output, since the platform does not supply a
  print preview. Because Print sends the job with no OS dialog, the page sizes offered are a fixed list throng
  knows the print path accepts (ISO A3–A5, Letter, Legal, Tabloid), not a per-driver query.
- **Admonition fences** (` ```ad-<type> `) stay fenced code (FR-016); rendering them is out of scope.
- **Ctrl+P** is not bound in the preview scope today (checked in the shipped key bindings, 2026-11-18). Being
  scoped to the preview, it does not take Ctrl+P from a terminal or an editor.
- User-defined callout types from Preferences, styling callouts with user CSS, an editor command that inserts
  a callout, changing a callout's type from the preview, and rendering callouts outside the Markdown preview are
  out of scope (#672). The registry's shape lets user-defined types follow without rework.
- Math outside Markdown, editor-side TeX support, copying an equation as MathML or an image, and
  MathJax-only extensions are out of scope (#393).
- Printing from editors and terminals, and an export-to-PDF feature separate from the OS's print-to-PDF, are
  out of scope (#484).
- SVG embeds (#631) belong to spec 074; this spec neither adds nor changes them.
