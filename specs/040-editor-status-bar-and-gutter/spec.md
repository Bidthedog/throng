# Feature Specification: Editor Status Bar Readouts and Gutter Visibility

**Feature Branch**: `feature/S040-I256-editor-status-bar-and-gutter`

**Created**: 2026-08-25

**Status**: Implemented — all 56 tasks complete (2026-08-26). `npm run gate` green across all eight
stages; CI green on all four jobs including the elevated `@admin` lane. FR-003a was **reversed after
implementation** on the maintainer's instruction: character counts now INCLUDE line breaks, one each
however spelled, so converting a document between LF and CRLF does not change the figure.

**Issues**: closes #256 (editor status bar: line, column, and character and word counts), #257
(`editor.showStatusBar` description does not cover what the bar shows), #258 (group the editor
status-bar settings under Editor → Status Bar), #254 (editor preference to show or hide the gutter).
Related but explicitly out of scope: **#234 (Go To Line — already SHIPPED in spec 033**, as
`packages/ui/src/renderer/navigate/goto-line.tsx`; this feature adds the readout it pairs with and
changes nothing in it), #169 (terminal horizontal scrolling / wrap spike, which owns the terminal
bar's future readouts), #108 (the fleet-wide "no inert settings" guard, which this spec must not
give new work), #79 (the control vocabulary 007 FR-028 governs — since resolved: FR-028 names
`ControlKind` as the authority rather than enumerating its members).

**Input**: Four v1.0.0 backlog issues grouped as one branch's work by a backlog planning pass on
2026-08-25, on the grounds that all four edit the same descriptor registry
(`packages/core/src/config/settings-metadata.ts`) and three of them render through the same surface
(the editor panel's status bar). The grouping is the input; the four issue bodies are the
requirements. Four open questions in those bodies were settled by the maintainer before this spec was
written and are recorded under *Decisions taken before drafting*.

---

## Why this spec exists

The editor panel's status bar has been a **language label with a wrap toggle bolted on** since 016
introduced it and 024 added the toggle. It is the only piece of chrome that belongs to the document
rather than the window, and it is the natural home for everything a reader wants to know about the
document without leaving it — where the caret is, how much is selected, how big the file is. Today it
answers none of those, so "go to the line the error names", "how long is this paragraph" and "is this
under the character limit" all mean counting by eye or leaving throng.

Adding those readouts forces three consequences that the other three issues are:

- **The bar's own description goes stale** (#257). `editor.showStatusBar` currently describes itself
  by listing the bar's contents — *"(language, word-wrap toggle)"* — which is an inventory, and an
  inventory is wrong the moment the bar gains anything.
- **The Editor settings section becomes a status-bar section** (#258). Adding two readout toggles to a
  flat `Editor` group means a third of that group is about one bar along the bottom of the panel.
- **The gutter question is asked at the same moment** (#254). The bar is the bottom edge of the
  text area; the gutter is its left edge. Both are permanent taxes on a narrow panel, and throng's
  whole layout model encourages narrow panels.

Grouping them is not a filing convenience. #256, #257 and #258 all edit the descriptors for the same
five settings, and #258's grouping is only worth doing *because* #256 populates it. #254 is
independent in behaviour but lands in the same descriptor file and the same preferences section.

## Four findings that changed this spec's shape

All four came from the repository's rule that a requirement changing existing behaviour must first
find the requirement that already governs it. The first two were established by reading the shipped
specs before any requirement was written; the third surfaced during clarification, when a question
about number formatting turned out to have a constitutional rule sitting just beside it; **the fourth
surfaced during cross-artifact analysis, and is the one this spec came closest to getting wrong** — a
convention that already ships, in the very file this feature edits, presented as a hypothetical.

### Finding 1 — the language indicator is already required to be persistent, and #256's hide order would have broken it

#256 proposes a fixed order in which segments disappear as a panel narrows, and describes its tail as
*"leaving language and the wrap toggle, which are controls rather than readouts and are the last to
go."* **"Last to go" still means they go.**

**016 FR-010c** says otherwise, in these words:

> **FR-010c**: The Editor Panel MUST show a **persistent language indicator** displaying the
> document's **effective language** (detected, overridden, or "Plain Text"), presented as a
> **right-aligned label in a status strip along the bottom of the Editor Panel**. The indicator MUST
> be **clickable** and MUST open the language picker.

**024** then established the one and only way that indicator may disappear, when it made both panel
status bars preference-controlled:

> Hiding a status bar removes only that surface: the word-wrap **command and its `Ctrl+Alt+W` chord
> keep working**, and an editor's language indicator/picker (016, FR-010) is hidden with the strip
> rather than deleted.

*(024 says "strip"; this spec's own prose says "bar" from here on, per FR-034a. The quotation is
left exactly as 024 wrote it — substituting the word inside a blockquote would be a silent edit to
somebody else's requirement, and doing it in a feature whose whole point is that one word is worse
than merely careless.)*

So the language indicator has exactly two permitted states — **visible**, or **hidden because the
whole bar is off**. A third state, *hidden because the panel is narrow*, is new, contradicts
FR-010c's "persistent", and would make the sole correction path for a wrong language guess (016
FR-010, US5) vanish at a width the user did not choose and cannot see the cause of.

**Resolution, and it is the spec's shape, not a footnote:** the width-driven hide order **terminates
after `line`**. Language and the wrap toggle are never hidden by width. This is a narrowing of #256's
proposal, not a supersession of anything — #256 never argued for hiding them, it only failed to say
where the order stops.

### Finding 2 — a readout is not an action, so the panel-menu rule does not reach it

024 generalised a rule into the constitution the day it added the wrap toggle:

> a panel-level action MUST appear in that panel's menu even when it is also on a status bar

That rule is why the wrap toggle has a checkable **Word Wrap** content-menu item and why the language
indicator has **"Set Language…"** beside it. A reviewer will reasonably ask whether the new readouts
need menu items too.

They do not, and the distinction is the rule's own: the rule exists so that **hiding a status bar
never strands a command**. Line, column and the three counts are **readouts** — they perform nothing,
so there is no command to strand. Hiding the bar removes information the user chose to remove, which
is the entire purpose of `editor.showStatusBar`. This spec states that explicitly (FR-009) rather than
leaving the next reader to re-derive it.

### Finding 3 — the digit-grouping rule did not reach this surface, and was amended so that it does

Constitution **4.5.0** added a NON-NEGOTIABLE gate, and scoped it to one kind of surface:

> **Displayed numbers MUST be digit-grouped, and grouping MUST NEVER be stored (NON-NEGOTIABLE).**
> Every number a **preference editor** *displays* — settings, key bindings, theme tokens, and any
> editor added later — MUST be rendered with the **active locale's** digit grouping […]

The status bar is **not a preference editor**, so on a literal reading the rule did not reach it,
and this spec would have been free to render `1048576` on a surface whose entire purpose is being read
at a glance. The rule's own rationale — *"eight digits nobody can scan"* — described this surface
better than its scope line did.

Two things established that the scope line, not the spec, was the thing that was wrong:

- **The practice was already wider than the text.** `navigate/quick-open.tsx` groups *"Showing N of M
  matches"* and has since 033, unasked. `search/find-bar.tsx` renders `N of M` **ungrouped**, and a
  find in a large file passes a thousand matches routinely. One rule, two surfaces of the same kind,
  opposite answers.
- **The rule's history forbade the tempting middle answer.** 018 FR-037 set a **five-digit floor** on
  grouping, and 4.5.0 **removed it deliberately** — a rule that changes shape halfway up a column is
  harder to read than either rule applied consistently. "Group only above a threshold" would have
  re-introduced exactly what the constitution had deleted.

**Resolution: the constitution was amended, not worked around.** Version **5.4.0** (2026-08-25) widens
the gate from preference editors to every surface, and — because "any surface displaying a number"
would have mandated `Panel 1,024` and `report copy 1,024.txt` — restates it as a rule about
**quantities**, with identifiers, editable seeds and machine-read fields excluded by name. Four
pre-existing gaps are enumerated in the rule itself rather than fixed by this feature.

**What this spec owes (FR-027):** the readouts use the one existing core formatter, which is now
plain compliance with 5.4.0 rather than a local decision this spec had to justify.

### Finding 4 — the sibling-string sub-group is not hypothetical; it already ships, three times, in the file this feature edits

The #258 decision above was framed as a choice between "a sibling group string" and "real one-level
nesting", with the sibling string described as the cheap option that only *looks* like a hierarchy.
That framing was incomplete in a way that matters: **the sibling string is the shipped convention.**

`packages/core/src/config/settings-metadata.ts` already declares `Editor · Navigation` (three
descriptors), `Editor · Indentation` (four) and `Editor · Languages`. And
`packages/core/src/config/theme-metadata.ts:203` documents the form explicitly, as a *sub-group*:

> A dense area may nest a `"<Area> · <Sub>"` **sub-group** (e.g. `Editor · Syntax`); only the PARENT
> area is a member here.

So this feature does not introduce sub-grouping to a registry that had none. It introduces a **second
mechanism** for something the registry already expresses, and the result is that the Editor section
carries both at once:

```
Editor
  ├─ (ungrouped editor settings)
  └─ Status Bar              ← new: a real subsection
Editor · Indentation         ← shipped: a sibling group that sorts adjacently
Editor · Languages
Editor · Navigation
```

**The decision stands, and the coexistence is accepted rather than resolved, for one reason:
migrating the three shipped groups is not in #258.** #258 asks for the status-bar settings to be
grouped. Rewriting `Editor · Navigation`, `Editor · Indentation` and `Editor · Languages` onto the new
mechanism would be a materially larger change to a registry three tabs read, and it would land inside
a feature nobody scoped it into. Scope grows by consent, not by tidiness.

What this spec owes instead is honesty about the state it leaves behind (FR-037a) and a tracked
follow-up, so the double convention is a recorded decision rather than a thing the next reader
discovers and assumes was an oversight.

## Decisions taken before drafting

Four open questions were carried in the issue bodies and answered by the maintainer on 2026-08-25.
They are recorded here because each one changes what gets built, not merely how it is worded.

| # | Question | Decision |
|---|---|---|
| #258 | Sibling group string, or real one-level nesting? | **Real nesting.** `FieldDescriptor` gains an optional `subgroup`, and every tab that groups by `group` learns to draw a subsection. A sibling string only *looks* like a hierarchy and lets the two sections drift apart in the list. **This decision was taken before Finding 4 was known** — the sibling-string form is not hypothetical, it already ships. See Finding 4 for what that costs and why the decision still stands. |
| #258 | Does `terminals.showStatusBar` move under Terminal → Status Bar too? | **No.** It stays under Terminal. Mirror the pattern only if and when the terminal bar gains readouts of its own — which #169 owns, and which may never land. |
| #254 | `editor.showGutter` or `editor.showLineNumbers`? | **`editor.showGutter`** — the gutter as a container for whatever it may later hold, rather than a name that needs a second setting the moment fold markers or diagnostics appear. |
| #256 | With no selection, does the selected-character readout show `0` or disappear? | **Disappear.** The bar is already tight on a narrow panel, and a permanent `0 selected` spends width to say nothing. |

## Clarifications

### Session 2026-08-25

- Q: How should the column readout count, when the line contains tabs? → A: **Character offset** — a
  tab advances the column by exactly 1, like every other character. This is what compilers, linters
  and VS Code report, so a column in an error message maps to the column throng shows; a display
  column would additionally depend on the document's indent width (016 FR-018).
- Q: What does the total character count include, with respect to line endings? → A: ~~**Exclude line
  endings**~~ — **REVERSED by the maintainer on 2026-08-25, after implementation.** The answer is now
  **include line breaks**, each counting as exactly one character however the file spells it (FR-003a).
  The original reasoning — that excluding them is "the figure a character limit means" — lost to the
  simpler fact that **a line break is a character the user typed and can delete**, so a document of ten
  empty lines is not empty. The EOL-conversion stability that motivated the original answer is
  preserved anyway, by counting a break rather than its bytes.

  Both answers are kept here rather than the old one being overwritten, because the *reasoning* for
  the original is what a future reader needs in order to know this was reversed deliberately and not
  drifted into. One consequence worth naming: the awkward case the wave-1 review found — a selection
  covering only a line ending reporting `0 selected` — **disappears**, because that selection now
  reports 1.
- Q: What counts as a word for the word count? → A: **A run of non-whitespace** — the same rule as
  `wc -w`. Punctuation, hyphens, dots and underscores never split a word, so `foo_bar()` and
  `https://x.com/y` are one word each. Unicode word-boundary segmentation would report them as 3 and
  6, which makes the figure useless in a code editor.
- Q: FR-008 says the counts must not be recomputed per keystroke. What is the measurable rule? → A: A
  **split budget**. Caret line and column are computed **synchronously in the update listener that
  reports the caret move**; the document counts are **debounced and MUST settle within 200 ms of the
  last edit**, and may lag visibly during a fast typing burst. Typing latency in a large (5 MB)
  document must show no regression against the same build with the readouts turned off.
  *(Both halves were later sharpened by FR-008a and FR-008c: "same frame" has no observable form a
  test can assert, and the latency comparison is **verified by hand** at quickstart §6.1a rather than
  automated — a relative wall-clock comparison between two app configurations is what this repo's own
  latency precedent calls a flake generator. What is automated is an absolute 2-second ceiling on
  counting a 5 MB document.)*
- Q: How are the bar's numbers formatted? → A: **Locale-grouped, through the existing core
  formatter** (`formatGrouped`). The bar and the preference editors format numbers identically and
  the separator follows the active locale. Constitution **5.4.0** was raised on the back of this
  question, widening the digit-grouping gate from preference editors to every surface — see Finding 3.
- Q: How is each readout presented — what exactly does a segment render? → A: **Abbreviated labels**
  (`Ln 412`, `Col 7`, `63 selected`, `1,204 chars`, `208 words`), and the bar is **split by
  alignment**: the **readouts sit LEFT**, the **language label and wrap toggle sit RIGHT**. The
  right-hand grouping is what 016 FR-010c already requires of the language indicator ("a right-aligned
  label"), so the split preserves it rather than moving it.
- Q: How do the readouts behave for a screen reader? → A: **Not announced; readable on demand.** No
  live region. Each readout carries an **accessible name** ("line 412", not "412") so it reads
  correctly when navigated to, but nothing is announced automatically. The caret moves on every
  keypress, and a live region would interrupt the line content the editor is already announcing —
  every arrow key.
- Q: Which term is canonical in user-facing copy? → A: **"Status bar"**, everywhere the user reads it
  — #257's description, #258's group name, every label and accessible name. FR-039 forbids renaming
  `editor.showStatusBar`, so the prose must match the key and the group the user already sees.
  **"Status strip" is retained only where this spec quotes 016 FR-010c verbatim.** The internal
  shorthand across **every** artifact of this feature — spec, plan, data model, contracts, tasks — is
  bare **"the bar"**, matching the setting key and the group name rather than the older filename.
- Q: How does a subgroup render, and what happens under an active search? → A: **A static subsection
  that mirrors how a group already behaves** — a subsection heading inside the group's section, in
  declaration order, **not collapsible**. Fields in the group with no subgroup render **first**, then
  the subsections. A subgroup whose fields are all filtered out by a search **disappears along with
  its heading**, exactly as an empty group does today. Collapsibility is not added: the sections
  containing these subsections are not collapsible either. *(An earlier draft cited #292 here as "the
  issue that owns minimisable grouping". It does not — #292 is minimisable groups in the **project
  list**, scoped in its own body to `projects-panel.tsx`. Nothing tracks collapsible preferences
  sections, and the decision needs no such citation: the sentence before it carries the whole
  argument.)*

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know where the caret is and how big the document is (Priority: P1) — #256

A user editing a file wants to answer three questions without leaving the editor: **where am I**
(the error message names line 412), **how much have I got selected** (is this excerpt under the
character limit), and **how big is this** (word count for a paragraph of prose). The status bar
answers all three, continuously, for the focused editor — caret line and column, selected character
count, total character count, total word count — alongside the language and wrap controls it already
carries.

**Why this priority**: It is the feature. The other three stories exist because this one lands: #257
describes what this adds, #258 files the settings this adds, and #254 is the same question asked of
the panel's other edge.

**Independent Test**: Open a file, move the caret with a click and with arrow keys, select a range,
select several ranges, and type — and confirm every figure follows without the editor feeling
heavier. Fully testable with no reference to the settings, which default to showing everything.

**Acceptance Scenarios**:

1. **Given** an editor panel with both readout settings at their defaults, **When** it renders,
   **Then** the bar shows caret line, caret column, total character count and total word count
   alongside the existing language label and wrap toggle.
2. **Given** an editor panel, **When** the caret moves by click, by arrow key, or by undo, **Then**
   the line and column readouts follow it.
2a. **Given** an editor panel, **When** the document's language changes, **Then** the readouts are
   **unchanged** — a language change does not move the caret, and the figures must survive the
   re-highlight rather than resetting. *(Split out of scenario 2, which listed a language change as a
   caret-move trigger. It is not one; what matters is that the readouts survive it.)*
3. **Given** an editor panel with no selection, **When** the bar renders, **Then** no
   selected-character readout is shown at all.
4. **Given** an editor panel, **When** a single range is selected, **Then** a selected-character
   readout appears and matches the range's length.
5. **Given** an editor panel with a multi-cursor / multi-range selection, **When** the bar renders,
   **Then** the selected-character readout is the **sum of every range's length**.
6. **Given** an editor panel, **When** the document is edited, **Then** the total character and word
   counts update to match.
7. **Given** an editor panel whose file changes on disk and is reloaded into the panel, **When** the
   reload completes, **Then** the total counts match the reloaded content.
8. **Given** two panels showing the same document, **When** the caret moves in one, **Then** only that
   panel's line and column change — the caret is view state, and Principle XI permits it to differ
   per panel — while both panels' total counts agree, because the document is one.
9. **Given** a line beginning with two tab characters, **When** the caret is placed immediately before
   the first non-tab character, **Then** the column reads **3** — a tab advances the column by one,
   whatever the document's indent width is set to.
10. **Given** a document of ten empty lines, **When** the bar renders, **Then** the total character
    count reads **9** — a line break is a character, and nine of them is what ten empty lines are
    made of. *(Read **0** until FR-003a was reversed on 2026-08-25.)*
11. **Given** a document, **When** its line endings are converted between LF and CRLF, **Then** the
    total character count is **unchanged**.
12. **Given** the text `const foo_bar = "hello-world";`, **When** the word count is read, **Then** it
    is **4** — punctuation, underscores and hyphens do not split a word.
13. **Given** a sustained typing burst in a large document, **When** typing stops, **Then** the
    character and word counts are correct **within 200 ms**, and the caret line and column were never
    seen to lag during the burst.
14. **Given** a screen reader, **When** the caret is moved through the document, **Then** the bar
    announces **nothing** — only the editor's own line-content announcement is heard.
15. **Given** a screen reader, **When** the user navigates onto a readout, **Then** it reads as
    **"line 412"** rather than **"Ln 412"** or **"412"**.
16. **Given** a readout hidden by width or switched off by preference, **When** the accessibility tree
    is inspected, **Then** that readout is **absent from it**, not merely visually hidden.

---

### User Story 2 - Reclaim the width the bar is spending (Priority: P1) — #256

throng's layout model encourages narrow panels, and the bar now carries five more figures than it
did. A user narrowing an editor panel must never see the bar wrap onto a second line — that would
change the editor's height, and the height of a text area is not something a horizontal drag should
alter. Nor may a number be cut into a **different, smaller-looking number**.

**Why this priority**: Equal to US1 because it is not a refinement of US1 — it is the condition under
which US1 is allowed to ship. A bar that reflows or lies about a figure is worse than one with no
readouts.

**Independent Test**: Drag an editor panel's edge from wide to very narrow and back, watching the
bar's height and each segment. Fully testable without touching any setting.

**Acceptance Scenarios**:

1. **Given** an editor panel at any width, **When** the bar renders, **Then** it is exactly one line
   high, and the editor's text area height is unchanged from any other width.
2. **Given** a panel being narrowed, **When** a segment no longer fits, **Then** its **label** is
   **shortened to its declared short form** (FR-022a) before any segment is hidden. *(Shortened, not
   truncated: the readout labels substitute a discrete form — `selected`→`sel` — rather than
   ellipsising. Only the language label truncates, FR-022b.)*
3. **Given** a panel narrowed past the point truncation can absorb, **When** segments are dropped,
   **Then** they are dropped in this fixed order: **total word count → total character count →
   selected character count → column → line**.
4. **Given** a panel narrowed to its minimum, **When** the bar renders, **Then** the **language
   label and the wrap toggle are still present** — the hide order terminates after `line` and never
   reaches them (Finding 1; 016 FR-010c).
5. **Given** any panel width, **When** a numeric readout would not fit, **Then** it is **hidden, never
   truncated** — `1,234` may never render as `1,23`.
6. **Given** a narrowed panel with segments hidden, **When** it is widened again, **Then** every
   hidden segment returns, and the caret position and selection are unchanged.
7. **Given** two editor panels of the same width, **When** both render, **Then** they show the same
   set of segments — the order is fixed, so width alone determines what is visible.
8. **Given** a document of 1,048,576 characters, **When** the bar renders, **Then** the figure is
   **digit-grouped in the active locale**, and a locale that groups with `.` shows `1.048.576`.
9. **Given** any figure at any magnitude, **When** it renders, **Then** it is grouped — there is no
   size below which grouping is skipped.
10. **Given** an editor panel at any width, **When** the bar renders, **Then** the readouts are
    flush **left** and the language label and wrap toggle are flush **right**, with the slack between
    them.
11. **Given** a panel narrowed until readouts begin to disappear, **When** the bar renders, **Then**
    the right-hand group has not moved off the bar and the two groups have not overlapped — the
    readouts gave way instead.

---

### User Story 3 - Decide what the bar shows, and find those settings in one place (Priority: P2) — #256, #257, #258

A user who wants the caret position but not the counts (or the reverse) sets one of two toggles. A
user who wants none of it hides the whole bar. Either way, everything governing the bar is in one
place — **Editor → Status Bar** — rather than diluted through a flat Editor list, and the bar's own
visibility setting describes what it actually hides.

**Why this priority**: The readouts are useful at their defaults, so this is not required for US1 to
deliver value. It is required for the settings not to become the mess #258 predicts.

**Independent Test**: Open the Settings editor, find Editor → Status Bar, toggle each of the three
settings, and read the bar's description. Testable independently of how the readouts compute.

**Acceptance Scenarios**:

1. **Given** the Settings editor, **When** the Editor section is shown, **Then** `editor.showStatusBar`
   and both readout toggles appear together under a **Status Bar** subsection of **Editor**.
2. **Given** the Settings editor, **When** the Editor section is shown, **Then** no other Editor
   setting has moved.
3. **Given** `editor.statusBar.showCursorPosition = false`, **When** an editor renders, **Then** line
   and column are absent and the counts remain.
4. **Given** `editor.statusBar.showCounts = false`, **When** an editor renders, **Then** all three
   counts are absent and line and column remain.
5. **Given** both readout toggles false, **When** an editor renders, **Then** the bar still shows
   the language label and the wrap toggle.
6. **Given** `editor.showStatusBar = false`, **When** an editor renders, **Then** the whole bar is
   absent regardless of the two readout toggles, and the wrap command and its `Ctrl+Alt+W` chord still
   work (024).
7. **Given** the `editor.showStatusBar` descriptor, **When** its description is read, **Then** it names
   the language control, the wrap toggle, the caret position and the character/word counts, and states
   that hiding the bar hides all of them whatever the individual settings say.
8. **Given** the Settings editor, **When** the Terminal section is shown, **Then**
   `terminals.showStatusBar` is still directly under **Terminal**, in no subsection.
9. **Given** the Keybindings and Themes tabs, **When** they render, **Then** their grouping is visually
   unchanged from before this feature — they gain subsection support but declare no subgroups.
10. **Given** the Editor section, **When** it renders, **Then** the settings with no subgroup appear
    **above** the Status Bar subsection, never below its heading.
11. **Given** the Settings editor, **When** a search matches no setting in the Status Bar subgroup,
    **Then** the subsection **and its heading** are both absent — never a heading with nothing under
    it.
12. **Given** the Status Bar subsection, **When** it renders, **Then** it is a plain subsection with
    no collapse control, matching the sections around it.
13. **Given** every label, description and group name this feature adds or rewrites, **When** they are
    read, **Then** they say **"status bar"** and never "status strip".

---

### User Story 4 - Reclaim the width the gutter is spending (Priority: P2) — #254

A reader who is not navigating by line number gets nothing back for the gutter's width, and on a
narrow panel that is a permanent tax on the text. One global preference turns it off, and the change
reaches every open editor immediately — including the standalone editor the preferences and theme
editors use, so the two surfaces cannot disagree.

**Why this priority**: Genuinely independent of the other three — it changes the panel's other edge
and shares only the descriptor file. It ranks below US3 because it is one boolean against three.

**Independent Test**: Toggle `editor.showGutter` with editors open and confirm the gutter appears and
disappears in both editor panels and the preferences JSON editor without a reopen or a restart.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** `editor.showGutter` is read, **Then** it is `true` and the
   gutter is drawn — nothing changes for a user who never goes looking.
2. **Given** `editor.showGutter = false`, **When** an editor panel renders, **Then** no line-number
   gutter is drawn and the text begins at the panel's left padding.
3. **Given** open editor panels, **When** `editor.showGutter` is toggled, **Then** they update without
   being reopened and without restarting the app.
4. **Given** the standalone editor used by the preferences and theme editors, **When**
   `editor.showGutter` is toggled, **Then** it honours the same value as the editor panels.
5. **Given** a scrolled editor with a selection and `editor.showGutter = false`, **When** it is turned
   back on, **Then** the gutter returns with **the same line still at the top of the viewport** and
   the selection unchanged. *(The line, not the pixel offset — FR-044. Hiding the gutter widens the
   text column, which re-wraps a wrapped document, so the pixel offset provably moves.)*
6. **Given** `editor.showGutter = false`, **When** the Themes editor is opened, **Then** the gutter
   theme tokens (009 FR-010) are still present and editable — hiding the gutter does not make its
   tokens inert.

---

### Edge Cases

- **An empty document.** Line 1, column 1, 0 characters, 0 words — and no selected-character segment.
  A zero total is a fact about the document; a zero selection is the absence of one (Decision #256).
- **A selection of zero length in a multi-cursor state.** Several carets with no ranges is not a
  selection; the segment stays hidden. A mixture of empty and non-empty ranges sums only the non-empty
  ones, which falls out of "sum of every range's length" naturally.
- **A very large file.** The total counts must not be recomputed per keystroke (FR-008). They are
  debounced and settle within 200 ms of the last edit (FR-008b), so during a fast burst the bar may
  show a figure one moment behind — but never one that stays behind after typing stops.
- **A file reloaded from disk while the caret is beyond the new end.** The counts follow the reloaded
  content; the caret's line and column report wherever the editor actually put the caret, not a
  remembered position.
- **A panel too narrow even for the language label alone.** The language label truncates (it is a
  label, and labels truncate) but is never removed. There is no width at which the bar is empty.
- **A settings file written before this feature.** It has none of the three new keys, and loads with
  every value it does have intact, the new keys taking their defaults.
- **A settings file with `editor.showLineNumbers` hand-written into it.** No such key exists; the
  write path preserves unmodelled keys, so it survives untouched and does nothing.
- **Two panels showing one document, one narrow and one wide.** Each shows the segments its own width
  allows. Nothing about the document changes because a view is narrow.

---

## Requirements *(mandatory)*

### Functional Requirements

#### The readouts (#256)

- **FR-001**: The editor status bar MUST show the **caret's line and column** for its own editor,
  and MUST update them whenever the caret moves — including after a pointer click, an arrow-key move,
  and an undo or redo. A **language change** does not move the caret; the readouts MUST simply survive
  it unchanged (AS2a).
- **FR-002**: Line and column MUST be reported in the register a user expects of a text editor: the
  **first line is line 1** and the **first column is column 1**.
- **FR-002a**: The column MUST be a **character offset within the line** — a **tab advances the column
  by exactly 1**, like any other character. It MUST NOT be a display column, and MUST NOT depend on
  the document's indent width (016 FR-018). This is what makes a column reported by a compiler or
  linter land on the same column throng shows.
- **FR-003**: The bar MUST show the **total character count** and the **total word count** of the
  document, and MUST update both as the document is edited, including when the panel reloads the file
  after an external change.
- **FR-003a**: Character counts MUST **include line breaks**. A line break is a character the user
  typed and can delete, so a document of ten empty lines reports **9** characters, not 0.
  **(SUPERSEDES the 2026-08-25 clarification that excluded them — see the Clarifications entry, which
  records both the original answer and this reversal.)**
  - **A line break counts as exactly ONE character, whether the file stores it as LF or as CRLF.**
    This keeps the property FR-003a had before the reversal: the figure is **unchanged by an LF ↔
    CRLF conversion** (#71), because converting line endings does not add or remove any line *break*
    — it only changes how each one is spelled on disk. Counting a CRLF pair as two would make the
    same text report two different sizes depending on a setting the reader cannot see.
  - Throng's buffer is LF-normalised on decode (`text-fidelity.ts`), so in the running app this rule
    is simply "every character in the document". The CRLF clause matters for the pure function, which
    must not be fooled by text that reaches it from anywhere else.
- **FR-003b**: A **word** MUST be an unbroken **run of non-whitespace characters**, where whitespace
  is what **JavaScript's `\s` matches**. Punctuation, hyphens, dots and underscores MUST NOT split a
  word, so `foo_bar()` and `https://x.com/y` each count as one.

  `wc -w` is the *familiar* statement of this rule and is named here for recognition only — it is
  **not the authority**, and the two differ. JavaScript's `\s` includes **U+00A0 NO-BREAK SPACE**
  (and a few other Unicode separators) that glibc's `iswspace` excludes, so `a`, U+00A0, `b` is
  **two words to throng and one to `wc -w`**. Splitting is the right answer for an editor: the user
  sees two words on screen, and a figure that disagreed with their eyes in order to match a POSIX
  utility would be the wrong trade. *(Recorded rather than left implicit because the earlier wording
  cited `wc -w` as the definition, which the implementation never matched.)*
- **FR-003c**: A "character" here is a **UTF-16 code unit**, and this is deliberately **not** the
  definition core already ships. `packages/core/src/text/grapheme.ts` exports `countGraphemes`,
  commented *"what a user would point at and call characters"* (031 FR-033a) — so throng will carry
  two character-counting semantics, and the reason is that they answer different questions:

  | | 031's `countGraphemes` | This feature |
  |---|---|---|
  | Counts | grapheme clusters | UTF-16 code units |
  | For | truncating a **filename** for display | a **document** measurement and a caret column |
  | Input size | tens of characters | up to 5 MB |

  Code units win here on two grounds that graphemes cannot meet. **FR-002a requires the column to
  match what a compiler or linter reports**, and those count code units — a grapheme column would
  send the user to the wrong place, which defeats the reason #256 asks for the readout. And
  **FR-008c budgets 2 seconds for counting 5 MB**; grapheme segmentation over a document that size is
  a different order of cost from segmenting a filename.

  *An emoji therefore counts as 2 here and 1 in a filename. That is a real inconsistency, accepted
  knowingly rather than overlooked, and it is the sort of thing a later reader should find recorded
  rather than rediscover.*
- **FR-004**: The bar MUST show a **selected character count** whenever a selection exists. Under a
  multi-cursor or multi-range selection it MUST be the **sum of every range's length**.
- **FR-004a**: The selected character count MUST use the **same rule as the total** (FR-003a) —
  **including line breaks, at one character each** — so that a selection spanning the whole document
  reports the same figure as the total character count. *(This clause read "and exclude line
  endings" until FR-003a was reversed on 2026-08-25; it always deferred to FR-003a and now says what
  FR-003a says. One consequence: a selection covering only a line ending reports **1**, not 0.)*

  **One exception, and it is the empty document.** There, select-all yields a single **zero-length**
  range, which is indistinguishable from a bare caret — so FR-005 applies and the readout is
  **absent**, while the total reports `0`. The equality above therefore holds for every document
  with any content in it, and not for the empty one. FR-005 wins deliberately: rendering
  `0 selected` permanently in an empty file's status bar is exactly what FR-005 forbids, and it is
  the worse of the two outcomes.
- **FR-005**: When **no selection exists**, the selected-character readout MUST be **absent** — not
  rendered as `0`.
- **FR-006**: The caret readouts are **view state** and MUST be reported per panel: two panels showing
  the same document report their own caret positions independently (Principle XI).
- **FR-007**: The document readouts are **document state** and MUST agree across every panel showing
  that document.
- **FR-008**: The readouts MUST ride the editor's **existing update path**. No figure may add a
  listener of its own, and the document-wide counts MUST NOT be recomputed on every keystroke of a
  large file.
- **FR-008a**: The **caret** readouts MUST be computed **synchronously, inside the same
  `updateListener` invocation** that reports the caret move — they are cheap, and a lagging caret
  position reads as a broken editor. *(Stated as a synchronous-computation rule rather than as "the
  same frame", because "same frame" has no observable form a test can assert, whereas "computed in
  that invocation, not deferred" is exactly what a test can check.)*
- **FR-008b**: The **document counts** MUST be **debounced** and MUST **settle within 200 ms of the
  last edit**. They MAY lag visibly during a sustained typing burst; they MUST NOT remain stale once
  typing stops.
- **FR-008c**: Counting a **5 MB document** MUST complete within **2 seconds**, and the count MUST NOT
  run on the keystroke path (FR-008, FR-008b). Together those are what make typing latency safe, and
  both are automatable.
  - **Two seconds is a regression alarm, not a target.** The real figure should be orders of magnitude
    below it; the number exists to catch an accidental O(n²) scan, not to certify performance. It is
    stated here rather than left to the implementer precisely because "a stated ceiling" with no
    number is a requirement whose whole content is a promise to decide later.
  - The ceiling is **absolute and generous**, never a comparison against a measured median. The
    repository's only latency precedent, `config-broadcast-latency.test.ts`, says in as many words
    that *"a latency assertion tuned to the median is a flake generator"*, and uses a wide absolute
    bound instead.
  - **The end-to-end claim — "typing feels no heavier with the counts on than off" — is verified by
    hand**, via the quickstart's typing step, and is deliberately NOT automated. A relative
    wall-clock comparison between two app configurations is the exact assertion that precedent warns
    against, and jsdom cannot host a representative measurement anyway. Saying so is better than an
    automated test that measures the test harness.
- **FR-009**: The readouts are **readouts, not actions**. The constitution's rule that a panel-level
  action must also appear in the panel's content menu (024) does **not** apply to them, and this
  feature MUST NOT add content-menu items for them.

*(FR-010 and FR-011 are deliberately unused. This spec cites **016 FR-010c** throughout Finding 1, and
a local `FR-010` sitting beside it would be read as the same requirement by anyone skimming.)*

- **FR-012**: Each readout MUST render as an **abbreviated label with its figure** — `Ln 412`,
  `Col 7`, `63 selected`, `1,204 chars`, `208 words`. The **word is the label** (and so may truncate,
  FR-021); the **figure is the number** (and so hides rather than truncates, FR-022).
- **FR-013**: The bar MUST be **split by alignment**: the **readouts are left-aligned**, and the
  **language label and the wrap toggle are right-aligned**. This preserves 016 FR-010c, which already
  requires the language indicator to be *"a right-aligned label in a status strip along the bottom of
  the Editor Panel"* — the split keeps it exactly where that requirement puts it.
- **FR-014**: Width pressure MUST be absorbed **between** the two alignment groups. Neither group may
  overlap the other, and the right-hand group MUST NOT be displaced off the bar by a long readout —
  FR-024 already forbids hiding it, so the readouts are what give way (FR-023).
- **FR-015**: Each readout MUST carry an **accessible name that says what the figure is** — "line
  412", not "412". The abbreviated visible label (FR-012) is for sighted density and MUST NOT be the
  accessible name: "Ln" is not a word.
- **FR-016**: The readouts MUST NOT be an **assertive or polite live region**, and MUST NOT be
  announced automatically. The caret moves on every keypress, and the editor already announces the
  line the user navigated to; a second announcement would interrupt the first on every arrow key.
- **FR-017**: A readout **hidden by width** (FR-023) or **switched off by preference** (FR-030/FR-031)
  MUST be absent from the accessibility tree, not merely invisible — a figure a sighted user cannot
  see must not be read out to a user who cannot see the bar either.
- **FR-018**: This feature MUST NOT add to the known status-bar accessibility gaps tracked by **#282**
  (controls announced by their glyph rather than their action). It is not required to fix them — #282
  is a separate v1.0.0 issue on a different surface — but every control and readout it adds here MUST
  arrive with a correct accessible name.

#### Width, truncation and the hide order (#256)

- **FR-020**: The status bar MUST remain **exactly one line high at every panel width**. It MUST
  NOT wrap, and the editor's usable text height MUST NOT change as segments truncate or disappear.
- **FR-021**: When the bar's content exceeds the available width, segments MUST be **truncated
  before any segment is hidden**.
- **FR-022**: Only **labels** may truncate. A **numeric readout MUST be hidden rather than truncated**,
  so that no figure is ever rendered as a different, smaller-looking number.
- **FR-022a**: A readout label MUST shorten through a **fixed, declared sequence of forms**, so that
  "truncate before hiding" (FR-021) names a specific function and FR-025's determinism is testable.
  The forms are:

  | Segment | Full | Short |
  |---|---|---|
  | line | `Ln` | `Ln` *(does not shorten)* |
  | column | `Col` | `Col` *(does not shorten)* |
  | selected characters | `selected` | `sel` |
  | total characters | `chars` | `ch` |
  | total words | `words` | `w` |

  **There are exactly two forms, and no third.** `Ln` and `Col` are already at their shortest and MUST
  NOT shorten further — two characters carry the whole meaning, and reducing them to `L` and `C` saves
  two pixels for real ambiguity. A segment whose label has reached its short form and still does not
  fit is **dropped whole** (FR-023). **A figure is never rendered without its label**: a bare `1,204`
  on the bar cannot be told from a line number, a character count or a word count, which makes it
  precisely the "smaller-looking wrong number" FR-022 exists to forbid, arriving by a different route.
- **FR-022b**: The **language label** may truncate at any width and MUST NOT be dropped (FR-024). It
  is the one label with no shortest form, because a language name is not an abbreviation this spec
  gets to choose — so it ellipsises, and at the narrowest panel it is the last thing standing
  alongside the wrap toggle.
- **FR-023**: When truncation is no longer sufficient, segments MUST be hidden in this **fixed order**:
  **total word count → total character count → selected character count → column → line**.
- **FR-024**: The hide order **terminates after `line`**. The **language indicator and the wrap toggle
  MUST NOT be hidden by width at any panel size** — 016 FR-010c requires the language indicator to be
  persistent, and 024 permits it to disappear only with the whole bar. See Finding 1.
- **FR-025**: The order MUST be deterministic: two panels of the same width MUST show the same set of
  segments.
- **FR-026**: Widening a panel MUST **restore every hidden segment**, and MUST NOT change the caret
  position, the selection, or the scroll position.
- **FR-027**: Every **quantity** the bar displays MUST be **digit-grouped in the active locale**,
  rendered through the **one existing core formatter** rather than a formatter of its own — the line,
  the column, and all three counts. Grouping applies at **every magnitude**; there is no threshold
  below which a quantity is left ungrouped. This is compliance with constitution **5.4.0**, which
  widened the gate to cover this surface. See Finding 3.
- **FR-028**: Grouping is strictly a **view concern**. A grouping separator MUST NOT reach any stored
  value, and the readouts are display-only, so nothing the bar renders is ever parsed back.
- **FR-028a**: The grouped line number and **Go To Line (#234, shipped in 033)** do not connect, and
  this is stated because they look as though they should. The bar may display `Ln 1,204`, while
  `resolveGotoLine`'s `WHOLE_NUMBER` accepts bare digits and nothing else — which is constitution
  5.4.0's second exclusion, and why `goto-line.tsx` seeds its field ungrouped. **This feature MUST NOT
  seed, paste or otherwise feed a readout into that field**, and it makes no change to
  `resolveGotoLine`. Whether that parser should tolerate a separator a user retypes by hand is a
  separate question and is **out of scope** here; if it matters, it is an issue against #234, not a
  requirement of this one.

#### The settings, their descriptions and their grouping (#256, #257, #258)

- **FR-030**: A setting `editor.statusBar.showCursorPosition` MUST exist, be a boolean, and default to
  **`true`**. It governs the **line and column** readouts and nothing else.
- **FR-031**: A setting `editor.statusBar.showCounts` MUST exist, be a boolean, and default to
  **`true`**. It governs **all three counts** — selected characters, total characters, total words —
  as one, and nothing else.
- **FR-032**: There MUST be exactly **two** readout toggles, not one per figure. A bar that can be
  assembled into a dozen near-identical arrangements is a cost with no reader.
- **FR-033**: `editor.showStatusBar` MUST continue to hide the **entire bar**, overriding both
  readout toggles, and hiding it MUST NOT disable the wrap command or its `Ctrl+Alt+W` chord (024).
- **FR-034**: The `editor.showStatusBar` **description** MUST name the language control, the wrap
  toggle, the caret position, and the character and word counts, and MUST state that hiding the bar
  hides all of them regardless of the individual settings.
- **FR-034a**: All user-facing copy this feature adds or rewrites MUST call the surface a **"status
  bar"** — setting labels and descriptions, the **Editor → Status Bar** group name, and every
  accessible name. It MUST NOT introduce "status strip" into anything the user reads, so that the
  prose agrees with the `editor.showStatusBar` key and the group name the user already sees.
- **FR-035**: `FieldDescriptor` MUST gain an **optional `subgroup`**, giving one level of nesting under
  `group`. A descriptor with no `subgroup` MUST render exactly as it does today.
- **FR-036**: **Every** editor tab that groups fields by `group` — settings, keybindings and themes —
  MUST render subgroups, so that one registry cannot render differently in two tabs.
- **FR-036a**: A subgroup MUST render as a **static subsection inside its group's section**, in
  **declaration order**, and MUST NOT be collapsible — the sections containing it are not collapsible
  either, and a subsection that folds inside a section that cannot would be the odd one out.
- **FR-036b**: Within a group, fields carrying **no subgroup MUST render first**, before any
  subsection. A field must never appear below a subsection heading it does not belong to.
- **FR-036c**: Under an active search, a subgroup whose fields are **all filtered out MUST disappear
  together with its heading**, exactly as an empty group does today. A heading with nothing under it
  is never rendered.
- **FR-037**: `editor.showStatusBar`, `editor.statusBar.showCursorPosition` and
  `editor.statusBar.showCounts` MUST appear together under **Editor → Status Bar**. **No other Editor
  setting may move.**
- **FR-037a**: Every shipped **sibling-string sub-group** MUST be left exactly as it is — in **both**
  registries:

  | Registry | Group strings | Shape |
  |---|---|---|
  | settings | `Editor · Navigation`, `Editor · Indentation`, `Editor · Languages` | 3, declared per descriptor, one level |
  | theme | `Editor · Syntax`, `General · Buttons`, `General · Buttons · Cancel`, `General · Buttons · Confirm`, `General · Buttons · Destroy` | **5**, **derived** by `areaForToken` rather than declared, and **three of them are TWO levels deep** |

  Since FR-036 teaches the Themes tab to render `subgroup` too, the second mechanism lands in **both**
  registries, not one. This feature therefore leaves **two sub-grouping conventions coexisting in two
  registries**, and that is a recorded decision rather than an oversight (Finding 4): migrating them
  is not what #258 asks for, and a registry three tabs read is not something to rewrite inside a
  feature nobody scoped it into.

- **FR-037b**: The follow-up issue FR-037a requires MUST record that **the theme registry's button
  family cannot be migrated by the mechanism this feature builds.** `General · Buttons · Confirm`,
  `· Cancel` and `· Destroy` are **two levels** below their area, and FR-035 gives `subgroup` exactly
  **one**. So the follow-up is not a mechanical sweep: it must first decide whether a second nesting
  level is wanted at all, or whether the button family stays on the sibling-string form permanently.
  `BUTTON_GROUP_ORDER` also depends on those three-segment strings. Filing an issue that asks for
  "migrate them onto `subgroup`" without saying this would be asking for something the codebase
  cannot do.

  **Discharged: filed as #319** (`[Tweak] One sub-grouping convention per registry, not two`, vNext),
  stating the two-level problem and asking for the decision rather than the migration.

  *It very nearly was not.* T048 was the one task in Phase 7 that produced no artifact **inside** the
  repository, and the commit closing that phase itemised every other task while silently omitting it.
  Nothing could have failed: a MUST discharged only by something outside the repo is invisible to
  every gate this project has — no test, no ratchet, no lint rule, no review of the diff. It was
  caught by the convergence pass asking the one question the other passes do not: *which requirement
  has no implementation at all?*

  The vocabulary split this feature also leaves behind — Settings says "status bar", the Themes
  editor still says "Editor Status Strip" — is filed as **#320**.
- **FR-038**: `terminals.showStatusBar` MUST remain directly under **Terminal**, in no subsection.
- **FR-039**: This feature MUST NOT rename a setting, change a key, change a default, or change a
  control type. Grouping decides **where a control appears** and nothing else — a key rename would
  silently reset every existing `settings.json`.

#### The gutter (#254)

- **FR-040**: A setting `editor.showGutter` MUST exist, be a boolean, default to **`true`**, and appear
  under **Editor** with a hand-written label and description.
- **FR-041**: With `editor.showGutter = false`, **no line-number gutter** may be drawn in an editor
  panel, and the document text MUST begin at the panel's left padding.
- **FR-042**: **Both** editors MUST read the one setting — the editor panel and the **standalone editor**
  used by the preferences and theme editors — so the two surfaces can never disagree.
- **FR-043**: Toggling `editor.showGutter` MUST take effect on **already-open editors** without
  reopening them and without restarting the app, as the other editor settings do.
- **FR-044**: Turning the gutter back on MUST restore it with **no change to the document position
  the user is looking at, and no change to the selection**.
  - **Stated as a document anchor, not a pixel offset, because a pixel offset provably cannot be
    preserved.** `.cm-content` is `flexGrow: 2` inside a flex `.cm-scroller`, so removing the gutter
    widens the text column by the gutter's width — which **re-wraps every long line** in a wrapped
    document and changes its rendered height. The scroll *position in pixels* must therefore move;
    what must not move is the line the reader was on. The standalone editor declares
    `EditorView.lineWrapping` unconditionally, so it is always in this case.
  - The repository's own remedy for exactly this is document-anchor based —
    `EditorView.scrollIntoView(anchor, { y: 'start' })`, described in `use-editor.ts` as *"Doc-position
    based, so re-applying is idempotent"*. Assert on the **top visible line number**, never on
    `scrollDOM.scrollTop`.
  - **The selection half is safe by construction**: a reconfigure is dispatched in a transaction with
    no `changes` and no `selection`, so `EditorState.selection` carries through.
  - **This is an assumption this feature is making, not an established property.** No test in the
    repository asserts that a compartment reconfigure preserves scroll, and two comments in
    `use-editor.ts` record issue #144 — a reconfigure landing a frame late and dropping the viewport
    back to the top. T037's declaration is the only thing that will ever check it.
- **FR-045**: Hiding the gutter MUST NOT remove, disable or hide the **gutter theme tokens** (009
  FR-010 – FR-014). They remain declared, editable in the Themes editor, and covered by the
  theme-metadata completeness test.
- **FR-046**: This feature MUST NOT add per-document or per-language gutter overrides, and MUST NOT
  introduce any other gutter content — throng registers no fold markers or diagnostics today.

#### Compatibility and governance

- **FR-050**: Every new setting MUST have a descriptor in the settings metadata registry, per
  Principle X and the completeness test 007 FR-047 requires. A setting with no descriptor fails the
  build, and correctly.
- **FR-051**: A `settings.json` written **before** this feature MUST load with **every value intact**,
  the three new keys taking their defaults.
- **FR-052**: This feature MUST NOT make any existing setting inert. Every setting it adds MUST have an
  observable effect, so that #108's forthcoming "no inert settings" guard has nothing new to find.
- **FR-053**: The three new settings MUST be reachable and editable from the **visual** Settings editor,
  not only by hand-editing `settings.json` (Principle X; the constitution's configuration-editor
  completeness rule).

### Key Entities

- **Status bar segment**: one item on the bar — a label, a control, or a readout. Has a fixed
  position in the hide order, a rule for whether it truncates or hides, and a setting that may remove
  it independently of width.
- **Readout**: a segment that reports and performs nothing. Caret line, caret column, selected
  characters, total characters, total words. Distinguished from a **control** (the language label, the
  wrap toggle), which performs an action and is therefore bound by the panel-menu rule and by 016
  FR-010c.
- **Field subgroup**: an optional second level of grouping on a field descriptor, rendered as a
  subsection within its group by every tab that groups fields.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can read the caret's line and column, the size of their selection, and the size of
  the document without leaving the editor or using any other tool.
- **SC-002**: The editor's text area is the same height at every panel width — narrowing a panel until
  segments disappear never moves the document's bottom edge.
- **SC-003**: No figure the bar displays is ever wrong. A number is either shown in full or not shown
  at all.
- **SC-004**: The language of the open document can be seen and corrected at **every** panel width, as
  it could before this feature.
- **SC-005**: Counting a **5 MB** document completes within **2 seconds**, the counts never run on the
  keystroke path, and they are correct within **200 ms** of the moment typing stops.
  *(The subjective half — that typing "feels" no heavier — is a manual quickstart check by design,
  FR-008c.)*
- **SC-006**: Everything that governs what the editor status bar shows is found in one place in the
  Settings editor, and nothing else in the Editor section has moved.
- **SC-007**: A user upgrading to this version loses nothing and has nothing to reconfigure: **no
  existing behaviour changes**, the gutter looks exactly as it did, every existing preference keeps
  its value, and the only difference is that the bar now carries readouts it did not before.
- **SC-008**: A user who turns the gutter off gets that width back in every editor surface in the app,
  immediately, without restarting.
- **SC-009**: Every **quantity this feature displays** is grouped identically to the preference
  editors, in the same locale, through the one formatter. *(Deliberately narrowed: constitution 5.4.0
  enumerates four pre-existing gaps on other surfaces which this feature does not fix, and its
  identifier exclusion means `Panel 1024` is correctly ungrouped — so "every number the app displays"
  would be a criterion this feature cannot meet and should not claim.)*
- **SC-010**: A screen-reader user moving the caret hears exactly what they heard before this feature
  — the readouts add no announcements — and can still read every figure by navigating to it.

---

## Assumptions

- **The bar's existing behaviour is unchanged except by addition.** It still dims with its panel
  (016 FR-010g), still reuses 012's active/inactive border treatment, still never overlays the
  document text, and still appears in every mirrored view of a synced panel.
- **The readouts follow the panel's own editor, not "the focused editor" globally.** #256's wording
  says "the focused editor", but each panel has its own bar, so each bar reports its own panel.
  A panel that is not focused still shows its own caret position.
- **No new theme tokens are needed.** The readouts are text on the bar and use the bar's existing
  foreground token (016 FR-010f). If the implementation finds it needs a distinct muted token, that is
  a token addition governed by 009 and 014 and must be raised, not slipped in.
- **The Keybindings and Themes tabs declare no subgroups in this feature.** They gain the *ability* to
  render one (FR-036) so the registry renders consistently, but nothing moves in them.
- **`terminals.showStatusBar`'s description is not touched.** #257 is scoped to `editor.showStatusBar`,
  and the terminal bar's contents have not changed.
