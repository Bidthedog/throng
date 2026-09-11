# Feature Specification: Find / Replace in Files

**Feature Branch**: `feature/S043-I220-I153-find-across-files`

**Created**: 2026-09-08

**Status**: Draft

**Input**: Issues [#220](https://github.com/Bidthedog/throng/issues/220) (find bar: one session per panel, roomier controls, find/replace disclosure arrow) and [#153](https://github.com/Bidthedog/throng/issues/153) (find & replace across all files), specced as one cycle on the maintainer's own direction in #153.

## Terminology

These names are used consistently throughout this spec, and nowhere is a second name used for the
same thing.

| Term | Meaning |
|---|---|
| **find bar** | The bar feature 013 built, which searches **one panel's own content** — an editor's file or a terminal's scrollback |
| **find session** | What one panel's find bar is currently searching for. Introduced as a per-panel concept by this feature (#220) |
| **Find in Files panel** | The new panel type this feature introduces. It searches **files on disk** and lists what it found. Replace is a mode of it, not a separate panel |
| **file search** | One query and its results, owned by exactly one Find in Files panel |
| **search scope** | Where a file search looks: a project's root, or any single sub-directory beneath it. *(**Partly superseded 2026-09-11 by FR-092**: or any single **file** beneath it. A scope naming a file searches that file and nothing else.)* |
| **result row** | One occurrence of the term, in one file, at one position |
| **group** | A heading that result rows sit under — a file, a folder, or both, depending on the chosen grouping. *(**Partly superseded 2026-09-09 by FR-073**: grouping **per folder alone** is withdrawn, so a heading is a file, or a folder containing files. A folder heading still exists under per-file-and-folder grouping; what goes is the grouping that produced folder headings with no file heading beneath them.)* |

"Search panel", "results panel", "global find" and "project-wide find" are deliberately **not** used.

## Why these two issues are one feature

Feature 013 gave throng a find bar for searching inside a panel. Two things about it are now
load-bearing in a way 013 did not anticipate:

1. **There is one find session for the whole application.** Search in editor A, click into editor B,
   and A's term, match modes and position in its results are destroyed. With several editors open
   side by side — the normal way throng is used — that happens constantly.
2. **The find bar is the only search-shaped surface, so nothing has had to agree with it.** Find in
   Files introduces a second one.

Building Find in Files first would mean inventing a second control language beside a bar that is
about to be re-spaced. So the session model and the control language are settled first (User Stories
1 and 2), and Find in Files is built alongside them (User Stories 3 to 5).

## Relationship to feature 013 — no contradiction

**013 is about searching inside a PANEL. This feature is about searching and replacing across
FILES.** They are different problems over different corpora, and nothing here reverses anything 013
decided.

013 said so itself, in its own first requirement:

> **013 FR-001**: "Search MUST act on the **active panel** … Terminal search searches **that
> terminal's scrollback**; editor search searches **that editor's file**."

Every 013 requirement is scoped by that sentence. Read with it, the two clauses that look like
conflicts are not about this feature at all:

| 013 says | What it is scoped to | This feature |
|---|---|---|
| "a **single shared find affordance** … one find bar" | The bar that searches *the active panel's own content* | Unchanged. This feature adds no second find bar |
| "there MUST NOT be a **separate results-list panel**" | A results list *for one panel's own content*, where in-content highlights are the better answer | Not that. A corpus of many files has no single content surface to highlight, so a list is the only presentation available |
| "regular-expression matching is deferred" (FR-007) | The per-panel find | Deferral stands, on both surfaces. Tracked as #376 (vNext) |

The rule 013 actually set is: **a search over one panel's own content presents itself in that
content, not in a list.** This feature never searches one panel's content.

**Nothing in 013 is superseded.** The find bar keeps its single shared affordance, its in-content
highlights and its in-bar count, exactly as 013 specified.

**033 FR-026a is likewise untouched.** It says "A find bar MUST close only when the user closes it or
its editor closes"; this feature adds no find bar and closes none.

### What #220 contributes, and why it is here

#220 changes the find bar — its session scoping and its controls — and that IS 013's surface. It sits
in this feature because the Find in Files panel inherits the control language #220 settles, which is
the maintainer's own direction on #153. Its relationship to 013 is a **refinement of FR-002's session
lifetime**, not a reversal of what FR-002 is for.

## Relationship to feature 005 — one refinement, stated

**FR-017 changes a rule 005 already wrote, so it is named here rather than left to be discovered.**

> **005 FR-002**: "The form MUST provide a **Panel Type** dropdown listing **all currently available
> panel types**. … the type catalogue MUST be structured so that additional types can be registered
> later **without redesigning the form or the selection flow**."

FR-017 refines the first clause: the dropdown lists all **offerable** panel types, and a type may be
registered without being offered. Find in Files is the first such type — it exists only as the product
of a command, so a user choosing it from a dropdown would create a panel with no search to show.

**005 SC-010 is untouched and is the reason this is a refinement rather than a reversal.** It protects
the form's "shared selection/confirm/clear/revert **flow**", and that flow does not change: the form
still reads the registry, still renders the selected type's own inputs, still confirms the same way.
Only the predicate deciding which types reach the list gains a clause.

**Why the type is registered at all**, given it is never offered: the registry is also what supplies a
panel's header label and icon. Leaving Find in Files unregistered would satisfy FR-017 by breaking the
panel header, which is not a trade this feature is willing to make.

## Clarifications

**Each session below is a dated historical record of what was asked and answered on that day, and is
deliberately NOT amended in place.** A later session, and the requirements themselves, supersede an
earlier session's answer; where that has happened the requirement carries the supersession marker and
is authoritative. Editing a log entry to match a later decision would falsify the log — the value of
these sessions is that they show what was believed when, which is what makes a reversal reviewable.
So an answer here that contradicts a requirement is not a defect in this section: **read the
requirements for what is true, and read these for how it was arrived at.**

**One distinction, because it is not derivable from the rule above.** What is protected is the
**answer** — the decision, which is worth preserving precisely because it shows what was believed. A
**miscounted or misread fact inside the derivation that supports an answer** is not: it was wrong the
day it was written, it teaches the next reader something false, and leaving it uncorrected propagates
the error into whatever gets built. Such a fact is corrected in a dated block **appended beneath** the
entry, never by rewriting the entry. A wrong decision preserved teaches you what was believed; a wrong
fact preserved just misinforms you.

### Session 2026-09-08

- Q: `Ctrl+Shift+T` was specified for find in files, but it is already bound to `navigate.quickOpen` (shipped, 033 FR-002). Which chords? → A: `Ctrl+Shift+F` for find in files and `Ctrl+Shift+H` for replace in files; Quick Open keeps `Ctrl+Shift+T`. (The original `Ctrl+Shift+T` was a mistype.)
- Q: "Complex regex matches" was specified, but regex is implemented nowhere — `MatchModes` carries only case and whole word, and 013 FR-007 deferred it. Is regex in scope? → A: **No regex in this feature.** It is moved to #376 (vNext), covering BOTH find/replace in files and find/replace in panels, so the two surfaces gain it together rather than diverging.
- Q: Does the replace-mode strikethrough show a change that WOULD happen, or one already applied? → A: **A preview.** Toggling replace renders every match as struck-through original plus proposed replacement; nothing is written until the user commits via Replace All, or replace on a single file or a single match.
- Q: Does a project have one file search that every panel views, or does each panel hold its own? → A: **Each panel holds its own.** A user may create as many Find in Files panels as they want. Each belongs to a project and opens in the **current tab**; a tab may hold several. A new preference decides whether a search reuses the last active Find in Files panel or opens a new one, and that preference is evaluated **within the current tab only** — a panel in another tab never receives a search run from this one. A file search may also be narrowed to any sub-directory of the project.
- Q: How does the user set the search scope to a sub-directory, and what makes a panel type with no New Panel entry discoverable at all? → A: **Both a folder's context menu and a toolbar button.** Right-clicking a folder in the file tree offers Find in Files scoped to that folder; a new button on the explorer toolbar, beside Quick Open, starts a search over the whole project; and the panel itself carries an editable scope control for retargeting afterwards.
- Q: What survives an application restart? Constitution VI and XI require the Panel itself to be persisted and restored, but not how much of its state comes with it. → A: **The panel, its search term and its search scope — not its results.** It reopens ready to re-run. Any pending replace preview is discarded rather than restored, so nothing can be committed against files that changed while throng was closed. (This answer originally added that FR-023's retention was within a session only; the final question below removed that retention altogether, so results now outlive nothing.)
- Q: Do results refresh as files change, or are they a snapshot? → A: **A snapshot, with per-file staleness shown.** When a file that contributed results changes, that file is marked stale — per file, not just a panel-level indicator. The marking is informational only: it must not stop the user browsing the list or acting on any row. Separately and unconditionally, every match is re-checked against the file's current content immediately before its replacement is written.
- Q: Does the FR-021 preference ship defaulting to reuse or to a new panel? → A: **Reuse the last active panel** in the current tab; a new panel appears only when the tab has none.
- Q: Which grouping does a search open in? → A: **Per file by default**, and the choice is configurable. One preference sets the default grouping and offers all three values (per file / per folder / per file and folder), shipping as per file. A second preference remembers the grouping last chosen in a project and reuses it for later searches there, shipping enabled; with it off, every search opens in the default grouping.
- Q: Is a replace committed into a file with no open editor reversible? FR-057 and SC-007 both scoped reversibility to open editors, leaving a mass commit across unopened files irreversible and unannounced. → A: **Not reversible in-app, and warn before it happens.** Version control is the safety net; no second undo system is built. A commit that would write to any file with no open editor warns first, stating how many files change on disk with no in-app undo, and waits for confirmation. The warning is a preference, shipping **on**, and does not appear when every affected file is already open.
- Q: Does a commit save the editors it changes? One Replace All leaves part of the change on disk (unopened files) and part in dirty buffers (open files), and nothing said whether those buffers are saved. → A: **No — a commit saves nothing.** Replacements in open files land as dirty, undoable edits saved when the user chooses; nothing the user had left unsaved is written out by the commit. The mixed on-disk/in-buffer state is accepted deliberately, because saving would both persist unrelated work-in-progress and turn FR-052's undoable edit into one already written to disk.
- Q: `Ctrl+Shift+H` is bound to "replace in files" by FR-029, but nothing defines what it does, how it interacts with the reuse preference, or whether it needs its own discoverable route. → A: **The same command as find in files, with replace pre-enabled.** It honours FR-021 and FR-022 identically, opens or reuses a panel in the current tab, turns replace on and focuses the replacement input — turning it on in a reused panel that had it off. It adds no second toolbar control and no second context-menu item; replace stays discoverable through the panel's own toggle.
- Q: What happens when the search scope directory is renamed or deleted while its results are shown? It is listed as an edge case and no requirement answers it; FR-045a covers a contributing *file* vanishing, but the scope is not a file. → A: **Mark the scope missing, keep the results usable.** The scope control shows the condition, results stay listed and fully actionable under FR-045b, and a run made while the scope is missing finds nothing and is distinguishable from a run that found nothing in a scope that exists. A rename is not followed — that needs rename tracking, and FR-045d discourages adding watches.
- Q: Is an **empty replacement** valid? FR-046 reveals the input and FR-047 renders match-then-replacement, but nothing says what an empty one means — and deleting every occurrence across a project is both a real use and the shape most easily reached by leaving the field blank. → A: **Valid — it deletes each match.** The row previews as struck-through text with nothing following it, and no extra confirmation is attached: FR-057b already warns with a file count before any write to a file with no open editor, and warning when every change is undoable is what FR-057d forbids.
- Q: Are groups expanded or collapsed when results arrive? FR-034 makes them collapsible but never says the state results open in — and under per-file-and-folder grouping, opening fully collapsed costs two expands plus the open, which SC-005's two-action limit forbids. → A: **Expanded, at every grouping.** Every match row is visible without an expand action, and each file lists **all** of its occurrences as separate rows (FR-032) rather than one row standing for the file. Collapsing is the user's choice, per group or through collapse-all.
- Q: What else does a restored panel bring back? FR-027b named only the term and the scope, leaving the **match modes** unstated — a case-sensitive whole-word search restored as case-insensitive substring is a different query wearing the same term — and equally the replace toggle and replacement text. → A: **Everything describing the query.** Term, match modes, scope, replace toggle state and replacement text all return; results and any pending preview do not. Nothing writable survives, since a commit still needs a fresh scan and FR-054's pre-write re-check.
- Q: What actually starts a file scan? FR-043 supersedes a running scan when the term changes (implying a scan starts on change), FR-025a lists **run** as an explicit command, and 013 FR-002a makes the find bar as-you-type — but a filesystem walk per keystroke over SC-004's 5,000-file project is not a buffer re-scan. → A: **Explicit run by default, with as-you-type offered as a preference.** A scan starts on the run command or `Enter`, and invoking find or replace in files is itself an explicit run. A fifth preference turns on **debounced** as-you-type — a scan when typing settles, never one per keystroke — shipping **off**. *(A sixth was added during analysis: the settle interval itself. See the entry below.)*
- Q: (Recorded during analysis, 2026-09-08.) Cross-artifact analysis found three things the spec itself had to answer: FR-017 changes **005 FR-002**'s "listing all currently available panel types" without naming it; the settle interval for as-you-type is user-configurable and so belongs in FR-059's table, making the count **six** rather than five; and FR-043a did not say what happens when an invocation reuses a panel and seeds nothing. → A: **Named as a refinement, counted as six, and re-run the existing term.** The 005 relationship is stated in its own section (SC-010 is untouched — it protects the selection *flow*, which does not change); `settleMs` joins FR-059 because anything reaching the preference editors is a preference; and a reuse with no seed re-runs the term already in the box, because the user asked for a search.
- Q: (Recorded during planning, 2026-09-08.) Three requirements were written against a codebase that turned out to say otherwise, and are corrected here rather than in the plan: FR-045e named **"unreadable"** as a refusal reason when the shipped set is `binary`/`too-large`/`out-of-tree`/`folder` and a permission denial surfaces as a generic I/O fault; FR-044 implied **new theme tokens** when 013 already ships a search-match set deliberately shared across surfaces; FR-033b did not say whether the remembered grouping **survives a restart**. → A: **Skip binary, too-large and any file whose read fails; reuse 013's tokens; remember the grouping in memory only.** Each follows the shipped precedent rather than adding a parallel mechanism.
- Q: How much does FR-023 retain, and for how many closed panels? FR-019 puts no limit on how many panels exist and no match ceiling is specified, so unbounded retention was the one place ordinary use grew memory without limit. → A: **Retain nothing. Closing a panel discards its results**, exactly as closing the application does. There is no reason to keep the results of a panel the user has dismissed, so FR-023's retention is removed rather than bounded — no retention store, no eviction policy, no retrieval surface. Only a panel's term and scope persist, and only for a panel that still exists (FR-027b).
- Q: What happens when find in files is invoked with **no project open**? FR-029a settles only the toolbar control; the chord has no requirement, and FR-018 leaves it nothing to act on. → A: **Unavailable, and drawn disabled.** The chords do nothing, and every surface offering the two commands — the toolbar control and their menu items — is drawn and disabled rather than hidden. No notice is raised: a disabled control has already said why nothing happened.
- Q: What does the scan do with binary, unreadable and over-size files? They are listed as an edge case, but FR-045 defers only to the project's ignore rules, which say nothing about a file's content or size. → A: **Reuse the editor's existing refusal set** — binary, too large, unreadable — and the detection already shipped for it, rather than inventing a second notion of "searchable". Skipped files produce no rows, and the panel reports **one count of skipped files for the whole scan**, never a notice or marker per file.
- Q: Does the Find in Files panel seed its search input from the selection? 013 FR-002b requires it of the find bar, this spec says nothing, and FR-021 ships defaulting to **reuse** — so a seed either overwrites a live search or does not. → A: **013 FR-002b applied unchanged, on the chord routes only.** A non-empty single-line selection in the focused panel pre-fills the input, selected so typing replaces it; with no such selection a reused panel keeps its term and a new panel opens empty. The explorer toolbar button and the folder context menu never seed, since neither is invoked from a text selection.

### Session 2026-09-09

Round two. The feature shipped, the maintainer tested it by hand, and these are the sixteen change
requests that came back, plus three findings from the convergence baseline taken before any of this
was written down. Four questions were put to the maintainer and answered directly; those are marked
**(confirmed)**. Everything else was derived from the request, the code, or precedent already in the
repository, and is marked **(derived)** — challenge any of them.

- Q: Should a Find in Files panel be named, and should it be renamable? The Assumptions said it is "named for what it is showing" and "follows whatever panel-naming and rename behaviour the app already provides", but `resolveTitle` branches only for `terminal` and `editor`, so the header reads "Panel 7". → A: **Named, and NOT renamable.** (confirmed — the request is explicit on both halves.) The title states the type and carries the term once there is one. The second half **supersedes the Assumption's own second sentence**: this feature now does introduce a naming rule of its own, and breaks the app-wide symmetry in which every panel is renamable. Recorded as a deliberate exception rather than an oversight — the panel's identity is what it is searching for, and a user-chosen name would hide the one thing that tells two of them apart.
- Q: Does per-panel zoom apply to a Find in Files panel? → A: **Yes.** (confirmed.) Zoom is already stored for every panel and the chord already routes to any active panel; only the two consumers are missing. Two things follow that the request does not say: the results list is windowed on a row-height constant, so zooming text without zooming that constant breaks the windowing arithmetic; and the header menu today offers Zoom In / Out / Reset on this panel while they do nothing, which is a **Constitution VI defect** (a control whose action is unavailable is drawn disabled, never drawn inert). Implementing zoom dissolves the second. (derived — neither consequence was raised in the request.)
- Q: Is "Group by folder is pointless" an argument against the grouping, or against how its rows are drawn? Under folder grouping a row shows position and snippet, and the file path only in a `title` attribute — so the stated reason ("we cannot tell which files the lines belong to") is a presentation gap that ~15 lines would close without superseding anything. → A: **Remove the grouping.** (confirmed — the alternative was offered explicitly and declined.) This **supersedes FR-033, FR-033a and FR-033c** and the acceptance scenarios that enumerate three values. Note what goes with it: the per-row staleness marking added by T116 exists *only* because folder grouping produces no file heading to carry the flag, so its reason for existing goes too.
- Q: The Find in Files toolbar icon is dwarfed by Quick Open beside it. Is this sizing? → A: **No — it is the glyph.** (derived from the code: both buttons are byte-identical 22×22 boxes with 16px icons; `quickOpen` is `🔎`, a colour emoji filling its em box, and `findInFiles` is `⌕`, a thin monochrome outline. The monochrome choice was deliberate and its reasoning is recorded in `theme.ts`.) The fix is a better glyph, not a per-token size mechanism, and it must keep the three search-related controls visually distinct from one another.
- Q: Should `Ctrl+Shift+F` turn the replace section OFF in a reused panel, mirroring the way `Ctrl+Shift+H` turns it on? FR-029d requires the on-direction; the code declines the off-direction deliberately, commenting that "find in files is not a command to put replace away". → A: **Yes, symmetric.** (derived from the request's worked example — F, then H, then F.) Nothing is lost by hiding: the replacement text survives in the store and FR-027b restores the toggle state across a restart, so only disclosure changes. With replace hidden, focus goes to the search input, which the existing `focusTarget` already does.
- Q: The replace preview's struck original is not faded and its replacement highlight is indistinguishable — and the maintainer adds that hard-select versus soft-select is not distinct enough in **any** theme. One problem or two? → A: **Two, and both are in scope.** (confirmed — the narrower option was offered and declined.) The panel half is a fade on the struck text and a stronger replacement highlight. The general half is the real finding: the theme derivation sets an ordinary match to 45% of the current-match strength, and `theme-quality.ts` has **no rule at all** that the two match surfaces must be distinguishable from each other or from the page — it checks only text-on-a-match. Taking it in scope **supersedes this spec's own Out of Scope line** deferring the match-highlight vocabulary to #325, and changes the rendered output of every bundled theme.
- Q: Why is the panel's font smaller than other panels'? → A: **Because it subscribes to no typography role** — it inherits `body` and then shrinks five classes to `0.85em`. (derived from the code.) This is a **defect, not a gap**: 021 FR-049 already requires that the Pane Text role reach "the body text of every pane and panel", and this panel was built without it. No requirement is added here; it needs a failing test and a fix. Whether the code *snippet* stays on the editor role is a deliberate sub-decision, since it is code and monospace is defensible — but it must be stated rather than left to fall out.
  > **Count corrected (2026-09-09, during planning).** The answer stands unchanged — the panel takes
  > no typography role, which is the defect and is true either way — but the figure in it does not.
  > `find-in-files.css` carries **four** `font-size: 0.85em` rules (`:146`, `:153`, `:166`, `:223`)
  > covering **seven** class selectors, because `:218-221` groups four of them into one rule. Neither
  > "five classes" nor a bare "four" is accurate; the plan, research and tasks all say *four rules,
  > seven classes*. Appended rather than rewritten, per this section's own rule: the answer is a
  > record of what was believed, and a miscount inside a derivation is corrected beside it, not over
  > it. *(`:153` is `.fif-scope__ran`, which FR-072 deletes outright, so three rules survive the
  > round.)*
- Q: How is Replace All meant to be discovered? It exists only in the panel's right-click menu. → A: **A toolbar button, beside the relocated Find button.** (confirmed.) The menu stays canonical and the button is an accelerator over it, per the constitution; it must reuse the existing commit path so FR-057b's confirmation and FR-058's single notice are not bypassed by a second route.
- Q: Which delay is "Find Files Delay"? There are two: the find bar's `asYouTypeDebounceMs` (120 ms) and Find in Files' `settleMs` (250 ms), deliberately separate keys. → A: **`settleMs`, the Find in Files one** — 250 ms → 500 ms. (derived from the wording "find **files** delay", and from the fact that the same round turns as-you-type on by default, which is what makes that interval matter.) Flag if this was meant to be the find bar's.
- Q: Should as-you-type be the default instead of explicit run? → A: **Yes.** (confirmed.) This is a larger supersession than it looks: **FR-043a's sentence, FR-043b's "MUST ship off", the FR-059 table row, and acceptance scenario US3-26 all state the current default explicitly** and must move together, or the spec asserts both defaults at once. The machinery is already built and hardened — a settle interval plus a forced ceiling at four times it, written against #186 where a pure debounce never fires under sustained typing — so the code change is one line. The counter-argument on record is SC-004's 5,000-file corpus: as-you-type walks a tree, where the find bar walks a buffer.
- Q: Remove the "Results from the project root" line entirely, or only where it is noise? That line is the only reason `ranScope` exists, and FR-030's second clause requires the panel to show which scope its results came from, separately from the retargetable scope box. → A: **Remove it entirely.** (confirmed — two narrower options were offered and declined.) This **supersedes FR-030's second clause** and deletes the state introduced solely to satisfy it. The accepted consequence, stated plainly: a panel whose scope box reads `lib/deep` while listing results from `src` can no longer say so, and that is reachable in two clicks. The test that pins the current behaviour is deleted rather than adjusted.
- Q: Can a folder picker actually be restricted to the project? → A: **Not by the OS dialog — only by validation.** (derived from the code: `pickFolder` opens the native directory dialog, whose `defaultPath` is a starting point and not a fence; the user can browse anywhere.) So "restricted" means the chosen path is refused when it fails the existing `isWithinRoot`, and written into the scope box through the existing `relPathUnderRoot`. Both primitives already ship and are exported. The alternative — an in-app chooser over the explorer's own tree — is genuinely confined but is new UI, and is not what the smaller change buys.
- Q: Which search preferences are genuinely shared between the find bar and Find in Files? → A: **None.** (derived by enumerating them: one belongs to the find bar and six to Find in Files, and the settle interval was deliberately *not* made a second use of the find bar's debounce.) The split is therefore clean, and follows the existing `Editor · Indentation / Languages / Navigation` convention.
- Q: Double-click already opens a result row. How can it also collapse a group? → A: **They never target the same element.** (derived — a group heading has no double-click handler at all, and there is no such thing as a file *row*.) The shipped precedent is the explorer tree, where a folder toggles on double-click while a file opens on double-click, and it is cited rather than reinvented. Two traps come with it: a double-click landing on the chevron button fires two clicks plus the heading's `dblclick`, a net-wrong three toggles, which the tree already solves by stopping propagation on the inner control; and modifier keys must be guarded the same way.
- Q: (Convergence baseline, before any amendment.) US5 scenario 6 requires a synced panel to show the parent's results, and it does not: scan updates are delivered to exactly one `webContents` and never broadcast, deliberately, for FR-018. The gap is confessed in an E2E file's header comment and nowhere else — no task, no issue, no Complexity Tracking row. Fix it now, or record it? → A: **Fix it in this round.** (confirmed — leaving it filed was offered and declined.) It needs a way for a window to register interest in another window's scan, **and** an answer for what a window attaching after a scan finished sees. The second question runs straight into the retention store this spec's Assumptions decline, so **that Assumption is superseded** rather than worked around.
- Q: (Convergence baseline.) `data-model.md` §6 documents `FailedCommit['reason']` with four values; the shipped type has seven. Which is authoritative? → A: **The code, and the contract file already agrees with it.** (derived — `contracts/file-search-ipc.md` correctly describes the `encoding` refusal.) `data-model.md` alone is stale; this is a documentation correction, not a requirement change.

### Session 2026-09-10

Round three. The feature shipped again, the maintainer tested it by hand, and these are the six
change requests that came back. Where the maintainer chose between options that were put to them
after the code had been read, the answer is marked **(confirmed)**; everything else was derived from
the request, from the code, or from precedent already in this repository, and is marked
**(derived)** — challenge any of them.

- Q: Should each of the panel's text inputs carry a Clear control, and does one need designing? → A: **All three — the term, the replacement and the scope — and nothing needs designing.** (confirmed on the three inputs; the rest derived from the code.) The pattern ships three times already — `settings-tab.tsx:371-390`, `keybindings-tab.tsx:144-163`, `themes-tab.tsx:618-636` — each an `IconButton token="dismiss"` titled *Clear search*, carrying a `<surface>-search-clear` test id, and rendered **only while its field is non-empty** rather than as a disabled ghost. That vocabulary is reused rather than a second one invented. What must NOT be reused is that pattern's CSS: `.settings-search__clear` hardcodes `width: 20px; height: 20px`, which is precisely the frozen box **FR-079 and FR-079c** were written for — one round after they were written. The token is `dismiss` (`theme.ts`); there is no `clear`, `close` or `x` token, and `destroy` is a deliberately separate token for destructive row actions, not a synonym for it.
- Q: What does clearing an input do to the rows already listed? → A: **Nothing — they stand.** (derived from FR-030a, which already answers the same question for the scope: retargeting starts nothing and the listed rows stay listed.) An empty term matches nothing and is refused before a scan starts — the main-side service answers `emptyTerm` and the renderer store returns early on a zero-length term — so the list simply stands over an empty box until the user searches again. Clearing the **scope** is not a third case: an empty scope box already *means* the whole project, which is what its own placeholder says.
- Q: Where does the scope input's Clear control sit, given the scope already shares its right edge with a browse button (FR-070) and a missing/refused notice (FR-030a)? → A: **Inside a relative wrapper around the input itself, with the browse button left a sibling beside it.** (derived.) A clear acts on the text in the box; a browse acts on the scope. Putting them in one box would claim they are the same kind of thing.
- Q: Should the panel's title say whether replace is showing? → A: **Yes — "Find in Files" with replace hidden, "Find & Replace in Files" with the replace row disclosed.** (confirmed.) Term suffix behaviour is unchanged. Nothing new needs persisting: `replaceShown` is already written into `panel.config` and read back from it, so `panel-title.ts` reads it exactly as it already reads `.term` and `PanelTitleSources` gains no field. `findInFilesPanelType.label` MUST NOT change — it is also the New Panel label and the icon descriptor's label — so the composed string belongs in `panel-title.ts` and nowhere else. Title case throughout, matching the shipped "Find in Files" (derived). FR-061 makes this panel non-renamable, so the automatic title is the only title it will ever have, which is what makes it worth composing carefully.
- Q: Should the replace summary notice have its own display mode and timeout, and which outcomes would they govern? → A: **Its own mode and its own timeout, in the `Search · Find in Files` section, shipping `dismiss` / 5000 ms — and they govern ALL THREE outcomes, success, warning and error alike.** (confirmed; the second half was put as an explicit choice with its cost stated.) The default is not self-contradictory: `error` and `warning` already ship `{ mode: 'dismiss', timeoutMs: 5000 }`, because a timeout is stored and preserved whatever the mode and consulted only under `timed` — `display-mode.ts:85-88` states that coexistence deliberately and `notification.tsx:888-894` arms a timer only for `timed`. The cost of the second half is real and is why it was put as a choice: a user whose global preference is *errors stay until dismissed* does not get it here, because this notice stops consulting the severity table altogether.
- Q: Does the application-wide notice contract already allow a per-call display override? → A: **No.** (derived from the code: `NoticeInput` carries no display fields at all, and the provider resolves the behaviour from `input.severity` alone.) So the answer above widens spec **030's** notice contract rather than configuring something that already exists, and that is recorded as a requirement of its own so the reach of the change is visible rather than discovered in a diff.
- Q: Does the settings editor already grey out an inert timeout for a key outside `notifications.*`? → A: **No — and there are TWO hardcoded patterns, not one.** (derived.) `settings-tab.tsx:77` greys an inert duration whose sibling mode is not `timed`; `:78` demands the user's consent before *Never display* silences a failure (030 FR-008). Both are anchored to `^notifications\.`. The file's own comment already names the fix: *"a second feature adding a third dependency should lift both of these into `FieldDescriptor` rather than add a third regular expression."* This round is that second feature. Generalising only the first leaves the editor inviting the user to tune a number nothing reads — the exact lie that mechanism exists to prevent; leaving the second lets a commit's failure report be silenced with none of the consent 030 FR-008 requires.
- Q: After a commit, should a committed row keep showing the old text struck through? → A: **No — a committed row shows the new text plainly.** (confirmed.) This **narrows the Staleness preamble** rather than reversing it, and the narrowing is exact: a row refreshes for a change **this panel itself made**, and for nothing else. An external change still gets only FR-045a's stale mark. A **skipped** match stays pending under FR-050, so it stays a preview — skipped rows are not swept in.
- Q: Two matches on one line each show the other's old text as their context. Fix, or accept? → A: **Fix it properly.** (confirmed — leaving same-line rows stale was offered and declined.) Main already holds the whole new file text at the moment of the commit, on **both** paths: the disk path has it after applying its replacements (`replace-commit-service.ts:308`), and the buffer path has `doc.authority.text` after the dispatch. So the commit result MUST return a re-derived snippet for every affected line and the panel MUST use it. That is a payload the result does not carry today, so it is a **contract change** — and a **size bound** is owed with it, because a commit spanning many long lines would otherwise return a great deal of text across a process boundary.
- Q: Should Replace All be disabled when there is nothing to commit? → A: **Yes — and this closes a live defect rather than adding polish.** (confirmed.) `pendingRows()` already returns an empty list once everything has been committed, so the control today is drawn live, clicks, and does nothing. That is a control whose action is unavailable drawn inert instead of disabled — the Constitution VI violation FR-062a is about, on the same panel. The menu items FR-025a requires must disable with it, or the accelerator and the canonical route disagree.
- Q: What re-enables it? The request said "a new scan, or the search text changes". → A: **Both — but they are not the same event under both settings.** (derived.) A new scan clears the committed marking by generation and re-enables by construction, so under FR-074's shipped as-you-type default the two coincide. Under the non-default explicit-run setting they do not: a user can type a different term and never run it. So the panel must remember **the term its listed results came from** and re-enable when the box differs from it. Note what this is not: FR-072 deleted `ranScope`, state that existed only to *display* which scope the results came from. This is remembered, never displayed, and read only to decide whether one control is live.
- Q: Does disabling Replace All collide with FR-045b, which forbids disabling a row? → A: **No.** (derived.) FR-045b governs result **rows** under the staleness marking; Replace All is a panel control, and Constitution VI requires exactly that a control whose action is temporarily unavailable be drawn and disabled. Recorded so a reader meeting the two in the wrong order does not read them as a conflict.
- Q: Which elements in the results list should show a hover affordance? → A: **Every group heading — file and folder alike — and every result row.** (confirmed; rows-only was offered.) Headings are one element differing only by `data-group-kind`, so there is nothing to split; rows already open a file on double-click and advertise nothing. The vocabulary is the explorer's, matched exactly: `cursor: pointer` plus a hover fill of `--throng-colour-hoverSurface`, guarded by `:where(body:not([data-window-blurred]))` — a guard `hover-suppression-coverage.test.ts` enforces, so an unguarded rule fails the build rather than shipping. `--throng-colour-surfaceActive` is reserved for selected and engaged states — `.fif-btn--on` is this panel's own instance of it — and must not be borrowed for hover.
- Q: The request was "refresh the editor after a commit, or tell me the file changed on disk". Which? → A: **Neither, because the premise does not hold — and the decision taken instead is that a document which was CLEAN before the commit is saved immediately after it.** (confirmed, after being shown that 043 never writes disk under an open editor.) FR-052 sends the replacement through the document authority as one undoable edit and leaves the buffer dirty, so "refresh the editor" already happens and "changed on disk" can never fire for this case. The literal request was declined for a stated reason: writing disk beneath an open buffer and reloading would clear the undo history of **every** open file (016 FR-026d), contradicting FR-057's per-document undoability, and would write out unrelated unsaved work.
- Q: What does that do to the guarantee that a commit never writes a user's unsaved work? → A: **Nothing — it is untouched, and the narrowing is exactly one case.** (derived.) A document that was **already dirty** keeps FR-053c's pending state and is not saved, so **FR-053b stands unchanged**, word for word. Only a document with nothing of the user's own left unsaved is saved, and saving it writes nothing but the replacement.
- Q: Does a commit that writes disk mark its own file stale? → A: **It does today, and it must stop.** (derived, and flagged as derived because it was not in the request.) FR-045a marks a contributing file stale when it changes after the scan, and it observes the project watch rather than the writer — so a commit to an unopened file, and now a save under FR-086, changes a file and marks it stale in the very panel that just made the list agree with the disk. Before this round that was noise; with FR-083 it is visibly wrong, because the rows now claim to show the file as it is while the heading above them says otherwise. Same reasoning as FR-083 itself: the panel is the authority on its own writes, and on nobody else's.


### Session 2026-09-11

Round five. One request: *add Files & Folders menu items "Open In → Search → Find" and "Open In →
Search → Find & Replace", on files and folders; both open or refresh the current tab's panel; the
scope box must accept full file paths so a search can cover one file; and when the panel is already
open its two text boxes and its results are cleared and its scope filled.* Nothing here was put to
the maintainer as a choice, so every answer beyond the request's own words is **(derived)** —
challenge any of them.

Round four (FR-087 … FR-089) was recorded inline in its requirements and never given a session
entry here. That gap is noted rather than back-filled: its decisions and their reasons are in the
requirements themselves.

- Q: The folder menu already has **Find in Files**. Does the new *Open In → Search → Find* sit beside
  it or replace it? → A: **It replaces it — the row moves.** (derived from 006 FR-030, which moved the
  OS reveal under Open In "removed from its previous top-level position, no duplication", and from the
  later history of that same item, which has moved in both directions since and never been
  duplicated.) Two rows naming one command on one menu is the shape the glossary rule exists to stop.
- Q: FR-029d says replace in files "has no menu item of its own — it is a chord and nothing else".
  Does the request override that? → A: **Yes.** (the request, verbatim — it names the item.) The
  clauses are withdrawn with a supersession marker rather than left to be contradicted by the code.
  Everything else in FR-029d stands, including that there is still no second **toolbar** control.
- Q: The request says what happens "when Find & Replace is already open". Does *Find* clear the boxes
  too? → A: **Yes — both items leave the panel in one state, differing only in whether replace is
  shown.** (derived.) "Find (& Replace) panel" is how the request names the single panel whose title
  FR-081 changes with the replace row, and "the find & replace text boxes are cleared" only reads as a
  statement about the panel, since the Find item's panel has one visible box. The alternative — *Find*
  keeping the term and re-running in the new scope, as the old folder row did — would give the two
  items of one submenu two different ideas of what a fresh search is.
- Q: Does "the current tab's panel" override `search.inFiles.openTarget: new`? → A: **No; the
  preference is honoured.** (derived.) The shipped default already reuses the current tab's last
  active panel, which is what the request describes. Overriding the preference for one route would
  give the feature two reuse rules.
- Q: With the term emptied, does the route start a search? → A: **No.** (derived from FR-080b: an
  empty term starts nothing under either trigger, and main refuses one.) The panel is left ready to
  type into, with the caret in the search input.
- Q: Where does the caret go for *Find & Replace*, given FR-031c puts replace in files' caret in the
  replacement input? → A: **The search input.** (derived.) FR-031c's split assumes a term is already
  in the box; this route has just emptied it, and a replacement typed before there is a term previews
  nothing.
- Q: Clearing the results — is that what FR-080's Clear controls do? → A: **No, and that is
  intended.** (derived.) FR-080b forbids a Clear from discarding rows, and still does: a Clear acts on
  one field. This route acts on the whole panel. The cleared panel reads as FR-042's *not run*, never
  as a search that found nothing.
- Q: Is clearing the rows a renderer matter? → A: **No — main has to drop them too.** (derived from
  FR-078, FR-078a and FR-078b.) Main retains a run so a sub-workspace view that attaches late can be
  shown it. A renderer-only clear would leave that view listing old rows under an empty box.
- Q: What does "full file paths" mean — root-relative paths that happen to name a file, or absolute
  paths? → A: **Both.** (derived.) The tree's own route fills the box root-relative, as it always has;
  a typed absolute path inside the project is read as its root-relative form, because a path copied
  from *Copy Path → Absolute* or an editor tab is absolute. An absolute path outside the project is
  refused on the control, as FR-070 already refuses a chosen folder — where today it reads,
  wrongly, as *Scope missing*.
- Q: Can the browse button pick a file? → A: **No; it stays a folder chooser.** (derived from the
  platform: Windows' native dialog cannot offer files and folders in one dialog.) A file scope is
  reached from the tree or by typing.
- Q: Should a file the scope names explicitly be subject to the exclusion globs? → A: **No.**
  (derived from what a folder scope already does: the walk tests what it reaches, never the scope
  itself.) The size, binary and read rules still apply, so a binary file scoped by name is reported as
  one file skipped rather than silently read.
- Q: The label "Find" is already FR-015's, for the find bar's own item. Keep the requested labels?
  → A: **Yes — built as asked, and the tension recorded in FR-090a.** (derived.) The tree has no find
  bar and the *Search* parent disambiguates. The fallback is two strings: *Find in Files* and *Find &
  Replace in Files*.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A find session belongs to its panel (Priority: P1)

A user searching in one editor moves to another editor, does something there, and comes back. Their
search is exactly as they left it — the same term, the same match modes, the same match highlighted.
They never retype it, and they can have a different search running in each editor at once.

**Why this priority**: It is the defect users meet most often, it stands alone, and it settles the
session model. Shipped by itself it is already a complete improvement.

**Independent Test**: Open two editors, start a different find in each, move focus back and forth, and
confirm each bar returns intact and neither drives the other's highlights. Needs nothing from the
other stories.

**Acceptance Scenarios**:

1. **Given** a find session open in editor A with a term, replace text, match modes and a current
   match, **When** the user focuses editor B and then returns to A, **Then** A's bar is shown again
   with all four intact and the same match still current.
2. **Given** find sessions open in editors A and B with different terms, **When** the user steps
   through matches in A, **Then** B's current match and highlights are unchanged.
3. **Given** find sessions open in editors A and B, **When** the user presses `Escape` with A
   focused, **Then** A's session closes and B's survives.
4. **Given** a find session open in editor A, **When** the user focuses a terminal panel, **Then** A's
   bar is hidden with its panel and no action taken in the terminal reaches A's session.
5. **Given** a find session open in a panel, **When** that panel is destroyed, **Then** its session is
   discarded and no other panel's session is affected.

---

### User Story 2 - The find bar reads as a toolbar, and replace can be put away (Priority: P2)

A user who has never read the documentation can see that the bar can do replace, reveal it by
clicking, and put it away again by clicking the same control. The buttons look like a grouped
toolbar rather than a wall of squares.

**Why this priority**: Discoverability and polish on a surface the Find in Files panel inherits. It is
independent of Story 1 in code but is specced with it so the new panel inherits a settled control
language rather than inventing a second one.

**Independent Test**: Open the find bar and confirm the disclosure arrow expands and collapses the
replace row, that `Ctrl+H` keeps the arrow in sync, and that no glyph touches its own border.

**Acceptance Scenarios**:

1. **Given** a find-only bar, **When** the user clicks the disclosure arrow, **Then** the replace row
   is revealed and the arrow shows the expanded state.
2. **Given** a bar with replace revealed, **When** the user clicks the disclosure arrow, **Then** the
   replace row is hidden and the bar remains open on find only.
3. **Given** a find-only bar, **When** the user presses `Ctrl+H`, **Then** replace is revealed and the
   arrow shows the expanded state.
4. **Given** the find bar in any state, **When** a user looks at it, **Then** every action button has
   visible space between its glyph and its border, and the match-mode, navigation and replace groups
   are visually separated from one another.
5. **Given** a find session on a terminal panel, **When** the user looks at its bar, **Then** there is
   no replace row and no disclosure arrow.

---

### User Story 3 - Find text across a project's files (Priority: P3)

A user wants to know where a string appears across their project, or across one folder of it. They
press the chord, type a term, and a Find in Files panel appears in the tab they are working in,
listing every occurrence with enough surrounding text to recognise it. Double-clicking a row opens
that file at that occurrence.

**Why this priority**: The v1.0.0 headline capability, and the half that is useful without replace.

**Independent Test**: Search a term occurring in several files and folders, confirm the row count and
the surrounding context, switch grouping, and double-click a row to confirm it opens the right file
at the right place.

**Acceptance Scenarios**:

1. **Given** an active project, **When** the user runs find in files, **Then** a Find in Files panel
   opens in the **current tab** and lists matches from every searchable file in the search scope.
2. **Given** a file containing five occurrences of the term, **When** results are shown, **Then**
   five separate rows appear for that file, each independently actionable.
3. **Given** a result row, **When** the user looks at it, **Then** the matched text is highlighted
   within a snippet showing a word or two either side, with an ellipsis on any side that was cut off.
4. **Given** a result row, **When** the user double-clicks it, **Then** the file opens according to
   the user's current "Open files in" preference and the matched text is highlighted in the editor,
   not merely scrolled into view.
5. **Given** results are shown, **When** the user switches grouping, **Then** the same matches are
   regrouped per file, per folder, or per file and folder, without re-running the search.
   > **Amended (2026-09-09) by FR-073**: "per file, per folder, or per file and folder" becomes "per
   > file or per file and folder". Switching without re-running is unchanged.
6. **Given** results across several folders, **When** the user reads the list, **Then** the root's own
   files come first in alphanumeric order, then each folder in alphanumeric order with its own
   contents ordered the same way.
7. **Given** the search scope is set to a sub-directory, **When** the search runs, **Then** only files
   beneath that directory are searched.
8. **Given** a second project is made active, **When** the user runs find in files, **Then** only that
   project's files are searched.
9. **Given** a project large enough that a full scan is not instantaneous, **When** the user runs a
   search, **Then** results appear progressively and the interface stays responsive throughout.
10. **Given** a Find in Files panel that has never been searched, or whose search found nothing,
    **When** the user looks at it, **Then** it displays no results.
11. **Given** a folder in the file tree, **When** the user right-clicks it and chooses Find in Files,
    **Then** a search opens scoped to that folder.
12. **Given** a project is open, **When** the user clicks the Find in Files button on the explorer
    toolbar, **Then** a search opens scoped to the project root.
13. **Given** no project is open, **When** the user looks at the explorer toolbar, **Then** the Find
    in Files button is visible and disabled, not hidden.
14. **Given** results across several files, **When** one of those files is changed, **Then** that
    file's group is marked stale and the other files' groups are not.
15. **Given** a file's group is marked stale, **When** the user browses and opens its rows, **Then**
    every row behaves exactly as an unstale one — nothing is disabled, hidden or reordered.
16. **Given** stale groups are shown, **When** the user re-runs the search, **Then** staleness is
    cleared for every file re-scanned.
17. **Given** a fresh installation, **When** the user's first search returns results, **Then** they
    are grouped per file.
18. **Given** remembering is enabled and the user last chose per-folder grouping in this project,
    **When** they run another search in that project, **Then** the results open grouped per folder.
    > **Superseded (2026-09-09) by FR-073.** Per-folder grouping no longer exists, so this scenario
    > cannot be run as written. It is replaced by the same claim over a surviving grouping — last
    > chose **per file and folder**, opens grouped **per file and folder** — plus the migration case
    > FR-033c's marker names: a **stored** per-folder choice opens in the default rather than being
    > rejected, because users of the shipped build may already have one persisted.
19. **Given** remembering is disabled, **When** the user runs a search after choosing a different
    grouping, **Then** the results open in the configured default grouping.
20. **Given** remembering is enabled and a grouping was chosen in project A, **When** the user
    searches in project B for the first time, **Then** project B opens in the default grouping, not
    project A's choice.
21. **Given** a word is selected in the focused editor, **When** the user runs find in files by its
    chord, **Then** the panel's search input is pre-filled with that word, its text selected so typing
    replaces it, and the search runs on it.
22. **Given** a Find in Files panel holding a term and no selection in the focused panel, **When** the
    user runs find in files by its chord and that panel is reused, **Then** its existing term is
    unchanged.
23. **Given** a word is selected in the focused editor, **When** the user opens Find in Files from the
    explorer toolbar button instead, **Then** the search input is not pre-filled from that selection.
24. **Given** a search scope holding text files, a binary file and a file too large to open as text,
    **When** the search completes, **Then** rows come only from the text files and the panel reports a
    single count of two files skipped.
25. **Given** no project is open, **When** the user presses the find in files chord, **Then** nothing
    happens — no panel opens and no notice is raised.
26. **Given** the shipped default and a panel showing results, **When** the user edits the term without
    running, **Then** no scan starts and the listed results remain those of the last run.
    > **Superseded (2026-09-09) by FR-074.** Reads, at the new default: *Given the **explicit-run
    > preference is on** and a panel showing results, When the user edits the term without running,
    > Then no scan starts and the listed results remain those of the last run.* The behaviour is
    > unchanged; only which setting is shipped moves. Scenario 27 below becomes the default path.
27. **Given** the as-you-type preference is on, **When** the user edits the term and pauses, **Then** a
    scan starts and any scan still running for that panel is superseded rather than run alongside it.
    > **Amended (2026-09-09) by FR-074**: "the as-you-type preference is on" is now *the shipped
    > default*. The scenario is otherwise unchanged.
28. **Given** a search matching five times in one file and three times in another, **When** results
    appear, **Then** both groups are expanded and all eight rows are visible without any expand
    action.
29. **Given** results grouped per file and folder, **When** they appear, **Then** both the folder and
    the file levels are expanded, so any occurrence is reachable in one action.
30. **Given** a panel scoped to a sub-directory with results shown, **When** that directory is deleted,
    **Then** the scope control marks the scope missing, every row stays listed and openable, and a
    re-run finds nothing until the scope is retargeted.
31. **Given** a Find in Files panel with a term typed, **When** the user looks at the search input,
    **Then** a clear control is shown inside it; and **Given** the input is empty, **Then** no clear
    control is drawn at all — not a disabled one. *(FR-080)*
32. **Given** a panel showing results, **When** the user clears the search term, **Then** the input is
    empty, no scan starts under either trigger setting, and every listed row remains listed and
    actionable. *(FR-080b)*
33. **Given** a panel scoped to a sub-directory with results shown, **When** the user clears the scope
    control, **Then** the scope is the whole project again, no scan starts, the listed rows stand, and
    the folder-chooser control is still beside the scope box rather than inside it.
    *(FR-080b, FR-080c)*
34. **Given** results are listed, **When** the user hovers a result row, a file heading or a folder
    heading, **Then** each shows a pointer cursor and a hover fill; and **When** the window is
    blurred, **Then** none of them shows a hover fill. *(FR-085)*

---

### User Story 4 - Preview and commit a replace (Priority: P4)

A user doing a rename across files turns on replace, reads exactly what would change — each match
struck through with its replacement beside it — and then commits, either everything at once, one
file, or one match at a time. Where a file is already open in an editor, the change lands there as an
ordinary edit they can undo.

**Why this priority**: The other half of the headline capability, and the half that writes to disk. It
is last because finding is useful without it and it is the riskiest part.

**Independent Test**: With a term matching in both an open and an unopened file, toggle replace,
confirm nothing changes on disk, then commit and confirm both files change and the open one is
undoable in its editor.

**Acceptance Scenarios**:

1. **Given** results are listed, **When** the user toggles replace on and types a replacement,
   **Then** every row shows its matched text struck through followed by the proposed replacement, and
   **no file has changed**.
2. **Given** a replace preview is showing, **When** the user edits the replacement text, changes the
   term, changes match modes or toggles replace off, **Then** still no file has changed.
3. **Given** a replace preview is showing, **When** the user commits all listed matches, **Then**
   every one is written.
4. **Given** a replace preview is showing, **When** the user commits a single file's matches, **Then**
   only that file changes and every other row remains a pending preview.
5. **Given** a replace preview is showing, **When** the user steps through matches committing some and
   skipping others, **Then** only the committed ones are written and skipped rows remain visible as
   pending.
6. **Given** a match in a file that already has an editor open, **When** it is committed, **Then** the
   change lands in that editor as a single undoable edit and the editor's dirty state reflects it.
   > **Amended (2026-09-10) by FR-086**: "the editor's dirty state reflects it" now depends on what
   > the document was before the commit. A document that was **already dirty** stays dirty, exactly
   > as written. A document that was **clean** is saved immediately after the edit lands, so it reads
   > clean again — the edit is still a single undoable one, which is the half of this scenario that
   > does not move.
7. **Given** a commit that changed files with open editors, **When** the user undoes in one of those
   editors, **Then** only that document's change is reversed.
8. **Given** a commit that could not complete for some files, **When** it finishes, **Then** the user
   is told which files changed and which did not, and why.
9. **Given** a match whose text has been edited away since the scan, **When** the user commits it,
   **Then** the commit is refused for that match, nothing is written at that position, and the rest
   of the commit's outcome is unaffected.
10. **Given** a file changed since the scan but **not** marked stale yet, **When** a commit reaches
    one of its matches, **Then** the match is still re-checked before writing — the re-check does not
    depend on the staleness marking having caught up.
11. **Given** matches in files with no open editor, **When** the user commits, **Then** they are
    warned how many files will change on disk with no in-app undo, and nothing is written until they
    confirm.
12. **Given** every affected file has an open editor, **When** the user commits, **Then** no warning
    appears and the changes land as undoable edits.
13. **Given** the warning preference is turned off, **When** the user commits across unopened files,
    **Then** the commit proceeds without confirmation.
14. **Given** an affected file is open with unrelated unsaved edits, **When** the user commits,
    **Then** the replacement joins those edits in the buffer, the file is not saved, and the user's
    earlier unsaved work has not reached disk.
15. **Given** a commit spanning open and unopened files, **When** it finishes, **Then** the unopened
    files are changed on disk and every affected editor is dirty with its replacement pending.
    > **Amended (2026-09-10) by FR-086**: "every affected editor is dirty" becomes "every affected
    > editor **that was already dirty** is dirty". An affected editor that was **clean** is saved by
    > the commit and is clean again with its replacement on disk. The unopened half of the scenario
    > is unchanged.
16. **Given** a tab holding a Find in Files panel with replace off and the reuse preference at its
    default, **When** the user runs replace in files, **Then** that same panel is reused, its replace
    toggle is on, the replacement input has focus, and no second panel appears.
17. **Given** a tab holding no Find in Files panel, **When** the user runs replace in files, **Then** a
    panel opens in that tab scoped to the project root with replace already on.
18. **Given** replace is on with the replacement field left empty, **When** the user reads the rows,
    **Then** each shows its matched text struck through with nothing following it.
19. **Given** an empty replacement and every affected file open in an editor, **When** the user
    commits, **Then** each match is deleted, no extra confirmation appears, and each editor holds a
    single undoable edit.
20. **Given** replace is on with a replacement typed, **When** the user looks at the replacement
    input, **Then** it carries the same clear control the search input does, drawn only while the
    field is non-empty. *(FR-080)*
21. **Given** a file's matches where some have been committed and some skipped, **When** the user
    reads that file's rows, **Then** the committed rows show the new text plainly and the skipped
    rows still show their struck-through preview. *(FR-083a)*
22. **Given** a line holding two matches and both are committed, **When** the user reads those two
    rows, **Then** each shows that line as it is now, with both replacements in place and neither
    row carrying the other's old text. *(FR-083b)*
23. **Given** a file changed by this panel's own commit and nothing else, **When** the user reads its
    group heading, **Then** it is not marked stale. *(FR-083c)*
24. **Given** every listed match has been committed, **When** the user looks at the toolbar and at
    the panel's menu, **Then** Replace All is disabled in both. *(FR-084)*
25. **Given** every listed match has been committed and the explicit-run preference is on, **When**
    the user types a different term without running it, **Then** Replace All is available again.
    *(FR-084a)*
26. **Given** a file open in an editor with no unsaved changes, **When** a commit replaces a match in
    it, **Then** the change lands as one undoable edit, the document is saved, and undoing it in that
    editor still reverses the change. *(FR-086)*
27. **Given** one commit spanning an open document that was clean and another open document holding
    unrelated unsaved edits, **When** it finishes, **Then** the clean one is saved with its
    replacement on disk and the other is left dirty with the user's earlier work still unwritten.
    *(FR-086, FR-086a)*
28. **Given** a commit that could not complete for some files, **When** its summary notice appears,
    **Then** it is displayed according to the Find in Files replace-summary preference and not
    according to the global setting for its severity. *(FR-082)*

---

### User Story 5 - Find in Files panels behave like panels (Priority: P5)

A user keeps several searches going at once — one per question they are answering — arranges them
where they want, and tears a set of them off into a sub-workspace to read on a second monitor. Each
panel holds its own results for as long as the panel exists; closing one throws its results away, the
same way closing the application does.

**Why this priority**: It turns a single search surface into a working tool. It is last because
Stories 3 and 4 are complete and useful with a single panel.

**Independent Test**: Open two Find in Files panels in one tab with different terms, confirm both
persist independently, sync one into a sub-workspace and confirm the parent/child rules hold.

**Acceptance Scenarios**:

1. **Given** a tab with a Find in Files panel, **When** the user runs another search in that tab with
   the preference set to open a new panel, **Then** a second Find in Files panel appears alongside the
   first and both keep their own results.
2. **Given** a tab with a Find in Files panel, **When** the user runs another search in that tab with
   the preference set to reuse the last active panel, **Then** that panel's results are replaced and
   no new panel appears.
3. **Given** a Find in Files panel exists in Tab 1 and the user is on Tab 2, **When** the user runs a
   search, **Then** a new Find in Files panel opens in **Tab 2**, whatever the preference says, and
   Tab 1's panel is untouched.
4. **Given** the "New Panel" dialog, **When** the user looks at the available panel types, **Then**
   Find in Files is **not** among them.
5. **Given** a Find in Files panel with results, **When** the user closes it, **Then** its results are
   discarded, and a Find in Files panel opened afterwards starts with no results rather than showing
   the closed panel's.
6. **Given** a Find in Files panel synced into a sub-workspace, **When** its results change in the
   parent, **Then** the sub-workspace view shows the same results.
7. **Given** a Find in Files panel synced into a sub-workspace, **When** the **parent** panel is
   destroyed, **Then** the sub-workspace view closes too.
8. **Given** a Find in Files panel synced into a sub-workspace, **When** the **sub-workspace** view is
   closed, **Then** the parent panel persists unaffected.
9. **Given** a project with a Find in Files panel holding a term, case-sensitive and whole-word both
   on, a sub-directory scope, replace on and a replacement typed, **When** the application is closed
   and the project reopened, **Then** the panel is back in its place with all five intact, showing no
   results and ready to re-run.
10. **Given** a Find in Files panel with an uncommitted replace preview, **When** the application is
    closed and the project reopened, **Then** the preview is gone and no file was changed by the
    restart.
11. **Given** a Find in Files panel holding a term with replace hidden, **When** the user looks at its
    header, **Then** it reads "Find in Files" followed by that term. *(FR-081)*
12. **Given** that same panel, **When** the user discloses the replace row, **Then** the header reads
    "Find & Replace in Files" followed by the same term; and **When** they put replace away again,
    **Then** it reads "Find in Files" once more. *(FR-081)*
13. **Given** a Find in Files panel with replace disclosed, **When** anything resolves the panel
    **type's** own label — its header type icon, or any surface reading the type registry — **Then**
    that label is still "Find in Files": the composed title belongs to the panel, never to the type.
    *(FR-081)*

---

### Edge Cases

- **A file changes underneath the results.** A result row names a position that a later edit, an
  external change, a rename or a delete has invalidated. That file is marked stale (FR-045a) but
  stays fully usable (FR-045b); double-clicking such a row must not open the wrong place silently,
  and a commit through it is re-checked first and refused if the match has gone (FR-054, FR-054a).
- **A file contributing results is deleted or renamed** after the scan. Its group is stale, and every
  action on its rows must fail cleanly rather than acting on a path that no longer exists.
- **A file changes between the staleness check and the commit.** The pre-write re-check (FR-054) is
  what covers this, which is why it is unconditional rather than driven by the staleness marking.
- **Two Find in Files panels hold pending replace previews over the same file**, and one is committed.
  The other's preview is now stale — and is resolved by the existing rules rather than a new one: that
  file is marked stale in the second panel (FR-045a), and any commit from it re-checks each match
  first and refuses the ones whose text has gone (FR-054, FR-054a). No panel-to-panel coordination is
  introduced, and none is needed.
- **A term matching an enormous number of times**, or in a very large number of files. The panel must
  stay usable and must not stall while the scan continues.
- **A replacement that itself contains the search term** must not be re-matched and replaced again.
- **Binary and unreadable files**, and files excluded by the project's ignore rules, met during the
  scan. Resolved by FR-045e and FR-045f: the scan skips whatever the editor already refuses to open as
  text, and reports one skipped-file count for the whole scan rather than a notice per file.
- **A file that becomes read-only, or is locked by another process**, when a commit reaches it.
- **The search scope directory is renamed or deleted** while its results are displayed. Resolved by
  FR-030a: the scope control marks the scope missing, the listed results stay usable, and a run made
  while it is missing finds nothing. A rename is not followed.
- **No project is active** when find in files is invoked. Resolved by FR-029e: both commands are
  unavailable, their surfaces drawn and disabled, and the chords do nothing.
- **A Find in Files panel is the last panel in its tab** and the user closes it. Constitution XI
  already answers this and no new rule is needed: a Tab whose last Panel is removed ceases to exist,
  and the active project's workspace always retains at least one Tab with at least one Panel. A Find
  in Files panel is an ordinary Panel in this respect.
- **The tab holding a Find in Files panel is destroyed** while its search is still running.
- **A sub-workspace holds Find in Files panels from more than one project**, which the constitution
  permits for sub-workspaces and forbids in the main workspace.
- **Committing a replace while an affected editor has unsaved changes** the user has not seen. The
  commit adds its edit to that buffer and saves nothing (FR-053a, FR-053b), so the user's own unsaved
  work is neither written out nor lost, and both changes remain undoable.

## Requirements *(mandatory)*

### Functional Requirements

#### Find sessions — the find bar (User Story 1)

- **FR-001**: Each panel that supports find MUST own its own find session, holding at least the search
  term, the replacement text, the match modes and the current match.
- **FR-002**: Changing the focused panel MUST hide the previous panel's find bar without discarding
  its session, and MUST restore that session unchanged when the panel is focused again.
- **FR-003**: Two or more panels MUST be able to hold open find sessions simultaneously, with
  different terms, and no session's actions may alter another session's state, current match or
  highlights.
- **FR-004**: A find bar MUST never act on any panel other than the one that owns it. (This is the
  guarantee the existing focus-change teardown provides today; it survives the change to per-panel
  sessions.)
- **FR-005**: `Escape` MUST close the find session belonging to the focused panel only.
- **FR-006**: Destroying a panel MUST discard its find session and MUST NOT affect any other panel's
  session.
- **FR-007**: The existing find and replace key bindings MUST continue to work unchanged.

#### Find bar presentation (User Story 2)

- **FR-008**: The find bar MUST present a disclosure control that expands it to show replace and
  collapses it back to find-only, in both directions, and MUST render which state it is in.
- **FR-009**: Revealing replace by key binding MUST leave the disclosure control showing the expanded
  state, and the two routes MUST never disagree.
- **FR-010**: Every find-bar action control MUST have visible space between its glyph and its border,
  and the match-mode, navigation and replace groups MUST be visually distinguishable as groups.
- **FR-011**: Every action control introduced or altered by this feature — on the find bar and in the
  Find in Files panel — MUST be a themeable icon carrying a hover title that names its action, with
  its glyph and colours resolved from theme tokens and none hardcoded.
  *(Constitution: Themeable icon controls, NON-NEGOTIABLE.)*
- **FR-012**: The find bar MUST keep its existing anchoring within its panel.
- **FR-013**: Terminal find MUST remain read-only — no replace row and no disclosure control.
- **FR-014**: Every **quantity** this feature displays MUST render with the active locale's digit
  grouping, at every magnitude, and the grouping MUST NEVER reach a stored value, a persisted query or
  anything crossing a process boundary. The full set introduced or touched here is: the find bar's
  `N of M` counter; a Find in Files panel's total match count; a collapsed group's match count
  (FR-034); the skipped-file count (FR-045f); and the file count in the irreversible-commit warning
  (FR-057b). *(Constitution: Displayed quantities MUST be digit-grouped, NON-NEGOTIABLE. The find bar's
  counter is a named, enumerated gap, required to be closed before that surface's next **numeric**
  change; FR-014 makes this feature that change.)*
- **FR-015**: Find, Replace and Replace All MUST each appear as an item in the owning panel's menu,
  showing its bound chord, in the correct menu section. *(Constitution: Every panel action has a menu
  item. `search.find` / `search.replace` / `search.replaceAll` are named as pre-existing gaps to be
  closed by tracked work; this feature closes them.)* Stepping through matches and closing the bar
  remain exempt as navigational input.

#### The Find in Files panel — type and lifecycle (User Story 5)

- **FR-016**: Find in Files MUST be a **distinct panel type**, hosted in a Tab in the workspace like
  any other workspace Panel.
- **FR-017**: The Find in Files panel type MUST NOT be offered in the "New Panel" dialog. It comes
  into existence only by running find in files.
- **FR-018**: A Find in Files panel MUST always be associated with exactly one project, and MUST
  search only that project's files. *(Constitution I: Project-First Context Isolation.)*
- **FR-019**: There MUST be no limit on how many Find in Files panels exist. A single Tab MAY hold
  several at once, each with its own independent file search.
- **FR-020**: Running find in files MUST act on the **current Tab**: the panel it opens or reuses MUST
  be in that Tab.
- **FR-021**: A user-configurable preference MUST decide whether running find in files **reuses the
  last active Find in Files panel** or **opens a new one**. It MUST ship defaulting to **reuse the
  last active panel**.
- **FR-022**: That preference MUST be evaluated **within the current Tab only**. When the current Tab
  holds no Find in Files panel, a new one MUST be opened in it even where the preference says to
  reuse the last active panel — a panel in another Tab MUST NOT receive the search.
- **FR-023**: Closing a Find in Files panel MUST **discard** its results, exactly as closing the
  application does (FR-027b). Results live only as long as the panel that owns them; no retention or
  retrieval mechanism is introduced, and a Find in Files panel opened afterwards starts with no
  results. *(Symmetric with FR-006, where destroying a panel discards its find session. A closed panel
  is gone, so keeping its results would mean building a retrieval surface for something the user has
  already dismissed.)*
- **FR-024**: A Find in Files panel with no search results MUST display no results.
- **FR-025**: A Find in Files panel MUST be syncable into a sub-workspace. The **parent Tab owns the
  panel outright**; the sub-workspace view is a synced view of it, never a second original.
  *(Constitution XI: one authority, not two peers.)*
- **FR-026**: Destroying the parent Find in Files panel MUST close its sub-workspace view.
- **FR-027**: Closing a sub-workspace view of a Find in Files panel MUST leave the parent panel
  unaffected.
- **FR-025a**: Every discrete command and state toggle the Find in Files panel offers — run, cancel,
  toggle replace, switch grouping, change scope, collapse/expand all, and each commit granularity —
  MUST appear in that panel's own menu, in the correct menu section, showing its chord where one is
  bound and its state where it is a toggle. *(Constitution VI: every panel action has a menu item,
  and one section vocabulary for every menu. This binds new work immediately.)* Scrolling and moving
  between rows remain exempt as navigational input.
- **FR-025b**: A find session travels with its panel. Detaching a panel into a sub-workspace, or
  reattaching it, MUST NOT discard its find session — FR-006 discards a session only when the panel
  is **destroyed**, and moving a panel does not destroy it.
- **FR-027a**: A Find in Files panel MUST be persisted with its project's arrangement and restored
  when that project is reopened, like any other Panel. *(Constitution VI and XI: Tab, Panel and Pane
  layout, including detached windows, is persisted per project and restored on reopen.)*
- **FR-027b**: A restored Find in Files panel MUST come back with everything describing its **query** —
  its search term, its **match modes**, its search scope, its **replace toggle state** and its
  **replacement text** — and MUST NOT come back with its results. It reopens ready to re-run rather
  than showing matches found before the application was last closed. *(Restoring a term without its
  match modes would reopen a different query wearing the same word; nothing writable survives, because
  a commit still requires a fresh scan and FR-054 re-checks every match immediately before writing.)*
- **FR-027c**: A pending replace preview MUST NOT survive a restart. Any uncommitted preview is
  discarded when the application closes. *(An uncommitted preview is a set of writes waiting to
  happen; restoring one would offer to commit it against files that may have changed while throng
  was not running — and FR-054 forbids writing at a position a later change has invalidated.)*
- **FR-027d**: A closed panel's results are discarded (FR-023) and a restarted panel's results are not
  restored (FR-027b), so results never outlive the panel that found them and never cross a restart.
  Only a panel's **term and scope** persist, in either direction.

#### Searching files (User Story 3)

- **FR-028**: The user MUST be able to run a find across the files in the search scope, invoked by a
  command that is registered, rebindable, and present in the visual Key Bindings editor.
  *(013 FR-017 requires this of every search command.)*
- **FR-029**: The shipped default chords MUST be **`Ctrl+Shift+F`** for find in files and
  **`Ctrl+Shift+H`** for replace in files. `Ctrl+Shift+T` MUST remain bound to `navigate.quickOpen`
  and MUST NOT be reassigned by this feature.
- **FR-029a**: The explorer toolbar MUST carry a **Find in Files** control, beside Quick Open, that
  starts a search over the whole project. Like Quick Open, it MUST be **drawn and disabled** — never
  hidden — when no project is open, and its hover title MUST name the action and show its live chord.
  *(Constitution VI: disabled when unavailable, absent when meaningless; 033 FR-018c set this pattern
  for the neighbouring control.)*
- **FR-029b**: A folder's context menu in the file tree MUST offer **Find in Files** scoped to that
  folder, placed in the Navigate section of the menu vocabulary. *(Constitution VI: one section
  vocabulary for every menu — an item with no section is a defect, not a default.)*
  > **Superseded (2026-09-11) by FR-090**: the folder-only **Find in Files** row is **moved** into
  > *Open In → Search → Find*, not duplicated beside it — 006 FR-030's precedent for the OS reveal,
  > *"moved under this submenu (removed from its previous top-level position, no duplication)"*. It
  > is offered on **files** as well as folders now. The reason a file never had it — written into the
  > code as *"a file can never become a directory to search inside"* — was only ever the premise that
  > a scope is a directory, and FR-092 withdraws that premise.
- **FR-029c**: Because the Find in Files panel type is absent from the New Panel dialog (FR-017),
  FR-029a and FR-029b are its only discoverable routes and MUST both ship with it. A capability
  reachable only by a chord the user has not memorised is a capability they do not have.
  *(Constitution VI: common actions reachable without instruction.)*
  > **Partly superseded (2026-09-11) by FR-090**: the discoverable routes are now FR-029a's toolbar
  > control and the tree's *Open In → Search* submenu, which replaces FR-029b's row. Replace in files
  > gains a visible route of its own there. The rule this requirement exists for — both must ship,
  > because a chord-only capability is one the user does not have — is unchanged.
- **FR-029d**: Replace in files MUST be the **same command as find in files with replace pre-enabled**,
  not a second panel model. It MUST honour FR-021 and FR-022 identically — opening or reusing a panel
  in the current Tab by the same rules, and defaulting its search scope the same way — and MUST leave
  that panel with replace **on** (FR-046) and the replacement input focused. Where it reuses a panel
  whose replace toggle was off, it MUST turn it on. Like find in files it MUST be registered,
  rebindable and present in the visual Key Bindings editor (FR-028). It MUST NOT add a second explorer
  toolbar control or a second folder context-menu item: replace remains discoverable through FR-046's
  toggle on the panel itself, so FR-029a and FR-029b remain the only two visible entry routes.
  It follows that **replace in files has no menu item of its own** — it is a chord and nothing else.
  The every-panel-action rule is satisfied by FR-025a's **replace toggle**, which is the panel-level
  action and does carry a menu item; a global command that merely opens a panel with that toggle
  already on is not a second panel action.
  > **Partly superseded (2026-09-11) by FR-090**: the clauses *"It MUST NOT add … a second folder
  > context-menu item"* and *"replace in files has no menu item of its own — it is a chord and
  > nothing else"* are withdrawn, because the maintainer asked for exactly that item. Replace in files
  > is now also *Open In → Search → Find & Replace* in the tree. Everything else stands: it is still
  > the same command with replace pre-enabled, it still honours FR-021 and FR-022, and it still adds
  > **no second toolbar control**.
- **FR-029e**: With **no project open**, find in files and replace in files MUST be **unavailable**:
  **both chords MUST do nothing**, and the two visible surfaces — the explorer-toolbar control
  (FR-029a) and the folder context-menu item (FR-029b), both of which offer *find* in files — MUST be
  drawn and **disabled** rather than hidden. Replace in files has no visible surface to disable
  (FR-029d), so its chord being inert is the whole of its obligation here. A notice MUST NOT be
  raised. *(Constitution VI: disabled when unavailable, absent when meaningless. FR-018 leaves the
  command nothing to act on, since every Find in Files panel belongs to exactly one project; a notice
  the user cannot act differently on is the pattern FR-057d already rejects.)*
  > **Note (2026-09-11), not a supersession**: the folder context-menu surface this names has moved
  > into FR-090's submenu, and the obligation carries over unchanged in effect. With no project open
  > there is no tree, so the menu that holds either item cannot be opened at all — which is why no
  > disabled state is drawn for it, and why this requirement's disabled surface is in practice the
  > toolbar control alone.
- **FR-030**: The search scope MUST default to the project's root and MUST be narrowable to any single
  sub-directory beneath it. The panel MUST show which scope its results came from, and MUST carry an
  editable scope control so the scope can be changed without starting again.
  > **Partly superseded (2026-09-09) by FR-072**: the clause *"The panel MUST show which scope its
  > results came from"* is withdrawn. The default and the editable control stand.
  > **Partly superseded (2026-09-11) by FR-092**: *"any single sub-directory"* becomes any single
  > sub-directory **or file**. The default is still the project root.
- **FR-030a**: When a panel's search scope directory is renamed or deleted, the panel MUST mark its
  **scope as missing** on the scope control (FR-030). That marking MUST be informational only: results
  already listed MUST stay listed and fully usable under FR-045b, with no row disabled, hidden or
  reordered. A run made while the scope is missing MUST find nothing and MUST be distinguishable from
  a run that found nothing in a scope that exists (FR-042). The user clears the condition by
  retargeting the scope. *(A rename is NOT followed: doing so needs rename tracking, and FR-045d
  discourages adding a watch for this feature.)*
  > **Partly superseded (2026-09-11) by FR-092a**: *"scope directory"* reads *scope directory or
  > file*. A scoped file that is renamed or deleted is marked missing exactly as a directory is.
- **FR-031**: The Find in Files panel MUST carry its own search input and match-mode controls,
  distinct from any find bar.
- **FR-031a**: When find or replace in files is invoked **by its chord** and the focused panel holds a
  **non-empty, single-line selection**, the panel's search input MUST be pre-filled with that selection
  and its text selected so typing replaces it. Where there is no such selection, a **reused** panel MUST
  keep its existing term and a **new** panel MUST open with an empty input. *(013 FR-002b, applied
  unchanged to this surface rather than restated as a second seeding rule.)*
- **FR-031b**: The explorer-toolbar control (FR-029a) and the folder context menu (FR-029b) MUST NOT
  seed the search input. Neither is invoked from a text selection, and seeding from a stale one would
  overwrite the live term of a panel being reused under FR-021.
- **FR-031c**: However a panel is opened or reused, an input MUST receive focus with its contents
  selected, so a term can be typed without a further click: the **search** input for find in files, and
  the **replacement** input for replace in files (FR-029d).
- **FR-032**: Results MUST list one row per match, not one per file, each independently actionable.
- **FR-033**: The user MUST be able to switch the grouping of results between **per file**, **per
  folder**, and **per file and folder**, without re-running the search.
  > **Partly superseded (2026-09-09) by FR-073**: **per folder** is withdrawn. Switching between the
  > two remaining groupings without re-running stands.
- **FR-033a**: A preference MUST set the **default grouping**, offering all three values. It MUST ship
  defaulting to **per file**.
  > **Partly superseded (2026-09-09) by FR-073**: the preference offers **two** values. Shipping
  > defaulted to per file stands.
- **FR-033b**: A second preference MUST decide whether the grouping a user last chose is **remembered
  per project** and reused by later searches in that project. It MUST ship **enabled**. What is
  remembered lives **in memory for the running application only** and MUST NOT survive a restart; the
  preference itself is the only part of this that reaches disk. *(033 FR-062 settles the same question
  the same way for Quick Open's remembered query, and nothing here asks for durability. A restart
  therefore opens in the FR-033a default.)*
- **FR-033c**: With remembering enabled, a search MUST open in the grouping last chosen in that
  project; where that project has no remembered choice yet, it MUST open in the FR-033a default. With
  remembering disabled, every search MUST open in the FR-033a default, whatever was last chosen.
  > **Partly superseded (2026-09-09) by FR-073**: the behaviour is unchanged, but a remembered value
  > of "per folder" no longer exists. A stored one MUST be read as the FR-033a default rather than
  > rejected.
- **FR-034**: Every group MUST be collapsible and expandable, and a collapsed group MUST remain
  present showing how many matches it holds.
- **FR-034a**: Results MUST open **expanded**, at every grouping. Every match row MUST be visible
  without an expand action, and each file MUST show **all** of its occurrences as separate rows
  (FR-032) rather than one row standing for the whole file. Collapsing is the user's own choice, made
  per group or through collapse-all (FR-025a). *(SC-005 allows at most two actions to reach any
  occurrence; under per-file-and-folder grouping the rows nest two deep, so opening collapsed would
  cost two expands plus the open.)*
- **FR-035**: Results MUST be ordered alphanumerically with a directory's own files before its
  sub-directories: at each level, files in alphanumeric order (digits before letters), then
  sub-directories in alphanumeric order, each expanded the same way.
- **FR-036**: Each result row MUST show the matched text **highlighted**, within a snippet of
  surrounding text extending to a nearby word boundary on each side, with an **ellipsis** marking any
  side that was truncated.
- **FR-037**: Double-clicking a result row MUST open its file through the user's current "Open files
  in" preference, honouring the same one-buffer, dirty-editor and dedicated-editor rules as opening
  from the file tree.

  > **Partly superseded (2026-09-10) by FR-087c**: the clause binding the open to the preference
  > governs the **double-click** and no longer describes every route. FR-087 adds menu targets that
  > NAME a destination, and a named destination deliberately overrides the preference — otherwise
  > choosing "New Editor" would open wherever the preference said. The double-click is untouched:
  > it still consults the preference, and every route still honours the one-buffer, dirty-editor and
  > dedicated-editor rules, which is the half of FR-037 that was never about the preference. *(The
  > explorer has read the same way since 006: its click action follows the preference, its Open In
  > items name a target. Recorded so the two are not read as contradicting.)*
- **FR-038**: After a result row is opened, the matched text MUST be highlighted in the editor, not
  merely scrolled into view.
- **FR-039**: The match modes available to a file search MUST be exactly **case sensitivity and whole
  word**, taking their semantics from the same model the find bar uses rather than reimplementing
  them.
- **FR-040**: Regular-expression matching MUST NOT be introduced by this feature, on either surface.
  013 FR-007's deferral stands. It is tracked as #376, and when it lands it MUST reach **both** the
  file search and the find bar, so the two never offer different match vocabularies.
- **FR-041**: Results MUST appear progressively rather than only on completion of the scan, and the
  interface MUST remain responsive while a scan is running.
- **FR-042**: A search that completes having found nothing MUST be distinguishable from one that has
  not been run and from one still running. *(013 FR-009 requires a clear no-results state for the
  find bar; this is the same guarantee here.)*
- **FR-043**: A running scan MUST be cancellable, and MUST be superseded rather than compounded when a
  new scan starts for the same panel — whatever started it.
- **FR-043a**: By default a scan MUST start only on an **explicit run**: the run command (FR-025a), or
  `Enter` in the search input. Editing the term, the match modes or the search scope MUST NOT start a
  scan on its own; the listed results remain those of the last run until the user runs again. Invoking
  find or replace in files is itself an explicit run, so a panel opened with a seeded term (FR-031a)
  searches immediately. Where the invocation **reuses** a panel and seeds nothing — because there was
  no selection — it MUST re-run that panel's existing term rather than leaving stale results with no
  indication: the user asked for a search, and the term they get is the one already in the box.
  > **Partly superseded (2026-09-09) by FR-074**: explicit run is no longer the default — it is the
  > alternative. Everything this requirement says about what an explicit run *does*, including the
  > re-run-the-existing-term rule, stands and now describes the non-default setting. Note that with
  > FR-074's default in force, that rule stops being the only way stale results refresh.
  > **Partly superseded (2026-09-11) by FR-091**: the re-run-the-existing-term rule does **not**
  > apply to the tree's *Open In → Search* route. That route empties the term, so there is nothing to
  > re-run, and it deliberately starts nothing. The chord and the toolbar control are unchanged: a
  > reused panel re-runs its term on both, under both triggers.
- **FR-043b**: A user-configurable preference MUST offer **as-you-type** scanning as an alternative,
  in which editing the term, the match modes or the search scope starts a scan once typing **settles**
  — never one scan per keystroke. It MUST ship **off**, so the shipped behaviour is FR-043a's explicit
  run. *(013 FR-002a's per-keystroke model is sound over one buffer; SC-004's corpus is 5,000 files on
  disk, so the same model is offered rather than assumed.)*
  > **Partly superseded (2026-09-09) by FR-074**: it now ships **on**. The description of what
  > as-you-type means — a scan when typing settles, never one per keystroke — stands unchanged, and
  > is now the shipped behaviour. The parenthetical's caution about a 5,000-file corpus is retained
  > deliberately: it is the argument against this change, and it lost rather than being wrong.
- **FR-043c**: Under either setting a scan MUST be superseded, never compounded: with as-you-type on,
  each settled change supersedes the scan in flight; with it off, a fresh explicit run supersedes one
  already running.
- **FR-044**: Match highlighting introduced by this feature MUST take its colours from theme tokens,
  and MUST **reuse the existing search-match tokens** rather than introducing parallel ones — 013
  already ships one set deliberately shared between the editor and the terminal, and a results row is
  that same idea on a third surface. Should a new token nevertheless prove necessary, it MUST be
  exposed in the Themes editor and MUST carry the reason it is not the existing one. *(013 FR-019.)*
- **FR-045**: Which files are searchable MUST follow the project's existing exclusion rules.

##### Staleness

Results are a snapshot taken at scan time. They do not refresh themselves, but the user is never left
reading a list that quietly disagrees with the disk.

> **Narrowed (2026-09-10) by FR-083**: "They do not refresh themselves" gains exactly one exception —
> a row refreshes for a change **this panel itself made**, and for nothing else. Every other change,
> from any other writer, still gets FR-045a's stale marking and no refresh. The preamble's second
> clause is the reason the narrowing was taken rather than resisted: after a commit the panel *was*
> the thing that made the list disagree with the disk.

- **FR-045a**: When a file that contributed results changes after the scan, the panel MUST mark
  **that file** as stale. A single panel-level "something changed" indicator is NOT sufficient — the
  user must be able to see which files are affected and which are still trustworthy.
- **FR-045b**: A stale marking MUST be informational only. It MUST NOT disable, hide, grey out or
  reorder any row, and the user MUST remain able to browse the list, open any row and act on any row
  exactly as before. *(Constitution VI: a control whose action is temporarily unavailable is drawn
  and disabled — but these rows' actions are not unavailable, so nothing here is disabled.)*
- **FR-045c**: Re-running the search MUST clear staleness for every file it re-scans.
- **FR-045d**: Detecting per-file staleness requires observing changes within the search scope. This
  feature MUST NOT add its own recursive watcher where an existing project watch can serve it.
  *(Issues #272 and #306 exist to reduce the number of watches, so adding another is a decision for
  planning to justify, not a default.)*

##### Files the scan skips

- **FR-045e**: Beyond FR-045's exclusion rules, the scan MUST skip any file the application already
  refuses to open as text — **binary** and **too large** — using the same detection and the same size
  limit the editor uses, rather than a second notion of what is searchable. It MUST additionally skip
  any file whose **read fails**, for whatever reason. *(041 FR-015's refusal set is
  `binary`/`too-large`/`out-of-tree`/`folder`; the last two cannot arise inside a search scope. A
  read failure is NOT a named member of that set — a permission denial surfaces as a generic I/O
  fault — so it is required separately here rather than implied. Exclusion rules are ignore patterns
  and say nothing about a file's content, size or readability.)*
- **FR-045f**: A skipped file MUST produce no result rows, and the panel MUST report **one count of
  skipped files for the whole scan** — never a notice, a row or a marker per file.
  *(Project convention, CLAUDE.md: one condition, one notice. A per-file report over a large project
  would be hundreds of notices for a condition the user cannot act on individually.)*

#### Replacing in files (User Story 4)

- **FR-046**: Replace MUST be a **toggle** on the Find in Files panel. Turning it on MUST reveal a
  replacement input and MUST NOT change any file.
- **FR-046a**: An **empty replacement is valid** and MUST delete each match it commits. It MUST NOT
  disable the commit actions or attract a confirmation of its own: FR-057b already warns, with a file
  count, before any write to a file with no open editor — the case that is genuinely irreversible —
  and warning where every change is undoable is what FR-057d forbids.
- **FR-047**: While replace is on, every result row MUST render as a **preview**: the matched text
  struck through, followed by the proposed replacement, so before-and-after is readable on one row.
  Where the replacement is empty (FR-046a), the row MUST render as the struck-through match with
  nothing following it, so a deletion reads as a deletion rather than as an unfinished edit.
  > **Partly superseded (2026-09-10) by FR-083a**: the word **every** is withdrawn. A **pending** row
  > renders as the preview described here, unchanged; a **committed** row renders the new text
  > plainly. A **skipped** match (FR-050) stays pending and therefore stays a preview, so nothing
  > about the skip path moves. Written before there was anything for a row to be other than pending.
- **FR-048**: **Nothing is written until the user commits.** Editing the replacement text, toggling
  replace, changing the term, the match modes or the search scope, and re-running the search MUST all
  leave every file untouched.
- **FR-049**: The user MUST be able to commit at three granularities: **all listed matches**, **every
  match in one file**, and **a single match**. Each MUST be a distinct, deliberate action.
- **FR-050**: The user MUST be able to step through matches committing or skipping each individually;
  a skipped match MUST remain listed as a pending preview.
- **FR-051**: A committed match MUST be visibly distinguishable from one still pending.
- **FR-052**: Committing within a file that already has an open editor MUST go through that editor's
  document authority, landing as an ordinary undoable edit, and MUST NOT write to the file behind the
  open buffer. *(Constitution XI: One document, one state.)*
- **FR-053**: Committing within a file with no open editor MAY write to disk directly; this is the
  only case in which a direct write is permitted.
- **FR-053a**: A commit MUST NOT save any editor. Changes to open files land in their buffers as
  dirty, undoable edits and are saved when the user chooses, through the ordinary save commands.
  > **Partly superseded (2026-09-10) by FR-086**: a document that was **clean before the commit** IS
  > saved, immediately after the commit's edit lands in it. A document that was **already dirty**
  > keeps this requirement word for word — it is not saved, and the user's own unsaved work is not
  > written out. The edit still arrives as an undoable one either way (FR-052, FR-057).
- **FR-053b**: A commit MUST NOT write any unsaved change the user made before it. Only the
  replacements themselves reach disk, and only for files with no open editor (FR-053). *(Saving an
  affected editor would also write out unrelated work-in-progress the user had not chosen to save,
  and would convert the undoable edit of FR-052 into one that has already been persisted.)*
- **FR-053c**: A commit therefore leaves the project in a **mixed state** — replacements in unopened
  files are on disk, replacements in open files are pending in their buffers. The dirty state of every
  affected editor MUST reflect this so the outstanding work is visible.
  > **Partly superseded (2026-09-10) by FR-086**: the mixed state **narrows** rather than disappears.
  > It is now three cases, not two: unopened files on disk; documents that were **clean** written to
  > disk by the save FR-086 requires; documents that were **already dirty** still pending in their
  > buffers alongside the user's own work. The requirement that every affected editor's dirty state
  > reflect where its replacement actually is stands over all three.
- **FR-054**: **Every match MUST be re-checked against the file's current content immediately before
  its replacement is written** — not only those in files marked stale, and not only when a panel has
  been open a long time. A match whose position no longer holds MUST be re-resolved or refused, never
  written blind. Staleness marking (FR-045a) informs the user; this re-check is what protects the
  file, and it runs regardless of what the marking says.
- **FR-054a**: A commit refused because its match could no longer be found MUST be reported as such,
  and MUST leave the rest of the commit's outcome unchanged. *(FR-058 governs how that report
  reaches the user.)*
- **FR-055**: Replacement text MUST NOT be re-matched by the same operation.
- **FR-056**: A commit MUST preserve each file's encoding and line endings and MUST NOT rewrite them.
  *(013 FR-008 requires this of the find bar's replace; a replace touching files the user never opens
  makes it more important, not less.)*
- **FR-057**: Committing all listed matches MUST be undoable **per document** as a single step in that
  document's own history, consistent with 013 FR-008's single-undoable-step rule. A single undo
  spanning every file is NOT required and is not introduced here.
- **FR-057a**: A commit written directly to disk under FR-053 — that is, to a file with no open
  editor — is **not reversible from within throng**. There is no document to hold the change and no
  in-app undo is introduced for it; version control is the user's safety net.
- **FR-057b**: Because FR-057a can change many files irreversibly in one action, a commit that would
  write to one or more files with no open editor MUST **warn before writing** and require explicit
  confirmation. The warning MUST state **how many files** will be changed on disk with no in-app undo.
- **FR-057c**: That warning MUST be governed by a user-configurable preference, shipping **on**. With
  it off, the commit proceeds without confirmation.
- **FR-057d**: The warning MUST NOT appear when every affected file has an open editor, since every
  such change is undoable (FR-052, FR-057) and there is nothing to warn about.
  *(Constitution VI: a warning the user cannot act differently on teaches them to dismiss warnings.)*
- **FR-058**: A commit that could not complete for some files MUST report which files were changed and
  which were not, and why, **once**, from whatever owns the operation.
  *(Project convention, CLAUDE.md: one condition, one notice. This rule is NOT in the constitution —
  it is a repo convention with spec 032 as its worked example.)*

#### Configuration

- **FR-059**: Every user-configurable option this feature introduces MUST be exposed through the
  visual preference editors and covered by the editor-metadata completeness test.
  *(Constitution X: Externalised Configuration.)* **Six** are introduced:

  | Preference | Values | Ships as |
  |---|---|---|
  | Where a search opens (FR-021) | Reuse last active panel / New panel | Reuse last active panel |
  | What starts a scan (FR-043b) | Explicit run / As you type | ~~Explicit run~~ → **As you type** (FR-074) |
  | How long typing must settle before an as-you-type scan (FR-043b) | A duration | ~~250 ms~~ → **500 ms** (FR-075) |
  | Default grouping (FR-033a) | Per file / ~~Per folder /~~ Per file and folder (FR-073) | Per file |
  | Remember the last grouping per project (FR-033b) | On / Off | On |
  | Warn before an irreversible commit (FR-057c) | On / Off | On |
  | Replace summary notice display (FR-082) | Never display / Display for / Dismiss only | Dismiss only |
  | How long a timed replace summary notice is shown (FR-082) | A duration, 3000–30000 ms | 5000 ms |

  > **Amended (2026-09-10) by FR-082**: **eight**, not six. The two added are the replace summary
  > notice's own display mode and its own timeout, appended to the table above with the requirement
  > that introduces them named in each row. Everything this requirement asks of a preference — that
  > it reach the visual editors and be covered by the editor-metadata completeness test — stands
  > over all eight, and FR-059a's no-inert-preference rule reaches the new two through FR-082b.

  The settle duration is **user-configurable and therefore enumerated here**, not an internal constant:
  Constitution X names timeouts explicitly, and anything reaching the preference editors is a
  preference whatever its origin. It is listed separately from the trigger it serves because it
  remains meaningful — and adjustable — only while that trigger is set to as-you-type.

- **FR-059a**: None of these preferences may be inert. Each MUST have a reader outside the config
  layer, and changing one MUST change observable behaviour. *(Constitution X, and the class of defect
  #108 exists to catch: a control that renders, persists a value, and governs nothing.)*

#### Round two — post-testing change requests (Session 2026-09-09)

Everything below was added after the feature shipped and was tested by hand. Where one of these
supersedes an earlier requirement, the earlier text stays where it is and carries a marker; nothing
above has been rewritten or renumbered.

##### The panel's identity

- **FR-060**: A Find in Files panel MUST be titled for what it is, not for its position: it MUST show
  that it is a Find in Files panel, and MUST carry its search term once there is one. *(The
  Assumptions already said this; nothing implemented it, and `resolveTitle` fell through to a
  positional "Panel N". The term is not decoration — FR-019 lets a tab hold several of these, and
  the term is the only thing that tells them apart.)*
  > **Refined (2026-09-10) by FR-081**: "it MUST show that it is a Find in Files panel" becomes "it
  > MUST show which of the two things it currently is" — **Find in Files** with replace hidden,
  > **Find & Replace in Files** with the replace row disclosed. The term suffix is unchanged. A
  > refinement rather than a contradiction: FR-060 requires the title to say what the panel is, and
  > this says what it is depends on what it is showing.
- **FR-061**: A Find in Files panel MUST NOT be renamable. Rename and Reset Name MUST be absent from
  its header menu rather than present and inert, and the rename chord MUST do nothing when such a
  panel is active. **This supersedes the Assumption that the panel "follows whatever panel-naming
  and rename behaviour the app already provides"**, and is a deliberate exception to the app-wide
  rule that every panel is renamable: a user-chosen name would hide the term, which is the panel's
  actual identity. *(Absent rather than disabled, per Constitution VI's "absent when meaningless" —
  renaming is not temporarily unavailable here, it is never meaningful.)*

##### Presentation

- **FR-062**: A Find in Files panel MUST honour per-panel zoom, scaling both its text and the metrics
  its results list is measured in. *(Zoom is already stored for every panel and already routed to
  whichever panel is active; only the rendering was missing. The results list is windowed on a
  row-height constant, so a change that scales text without scaling that constant breaks the
  windowing arithmetic rather than merely looking wrong.)*
- **FR-062a**: The header menu's zoom commands MUST NOT be offered on a panel that does not implement
  zoom. With FR-062 satisfied this is automatic for this panel; it is stated because the menu offered
  three permanently inert commands, which is the defect Constitution VI's disabled-versus-absent rule
  exists to prevent.
- **FR-063**: A group heading naming a file MUST be visually distinct from the result rows beneath
  it, and MUST render in a bold weight taken from the theme's own weight tokens rather than a
  hardcoded figure. *(021 made weight themeable; a literal `600` here would be the same class of
  mistake the panel's colour-literal guard already forbids.)*
- **FR-064**: The panel's body text MUST follow the shared **Pane Text** typography role, at the same
  size as other panels' body text. *(This is 021 FR-049 — "Pane Text MUST reach the body text of
  every pane and panel" — which this panel was built without honouring. It is recorded here as a
  correction, not as a new rule: the requirement already existed and this feature did not meet it.
  Whether the code snippet stays on the editor role is a deliberate sub-decision and MUST be stated
  wherever it is made.)*
- **FR-065**: The explorer toolbar's Find in Files control MUST read at the same visual weight as the
  controls beside it. *(It does not: it is drawn in the same box at the same size as Quick Open, but
  with a thin monochrome outline glyph beside a colour emoji that fills its em box. The remedy is the
  glyph. The three search-related controls MUST remain distinguishable from one another — that
  constraint predates this requirement and is not relaxed by it.)*

##### Replace preview, and the highlight vocabulary

- **FR-066**: In the replace preview, the struck-through original MUST be visually receded relative
  to its replacement, and the replacement MUST carry a highlight clearly distinct from both the
  original and the surrounding row, in every bundled theme. *(The panel's CSS may name no colour
  literal, so recession is opacity or a token — not a hex value and not a `var()` fallback.)*
- **FR-067**: A theme MUST NOT be able to render an ordinary search match and the current search
  match indistinguishably from each other, or either indistinguishably from the surface behind it.
  This MUST be enforced by the theme-quality checks that already govern token combinations, and the
  bundled themes' derivation MUST satisfy it. **This supersedes this spec's Out of Scope entry
  deferring the match-highlight vocabulary to #325**, for this one property only: #325's wider
  unification is still out of scope. *(The checks today verify only that text on a match is readable.
  Nothing requires the two match surfaces to differ, and the derivation sets an ordinary match to 45%
  of the current-match strength — so in dark themes they collapse together. This changes the rendered
  output of every bundled theme and every surface using those tokens, not only this panel.)*

##### Controls and their placement

- **FR-068**: The panel MUST offer **Replace All** as a control on its toolbar, positioned to the
  right of the run control (FR-069). It MUST invoke the same commit path as the menu item required by
  FR-025a, so FR-057b's confirmation and FR-058's single notice cannot be bypassed by reaching the
  command a different way. *(The menu remains canonical; this is an accelerator over it.)*
- **FR-069**: The run control MUST sit to the right of the scope control rather than inside the
  search field. Its cancel counterpart MUST continue to replace it in place while a scan runs.
- **FR-070**: The panel MUST offer a control that opens a folder chooser and writes the chosen
  directory into the scope control as a path **relative to the project root**. A directory outside
  the project MUST be refused rather than accepted and silently ignored, and the refusal MUST be
  shown on the scope control. *(The platform's own directory dialog cannot be confined to a subtree —
  its start location is a suggestion, not a fence — so "restricted to the project" is a validation
  after the fact, using the containment and relativisation rules the explorer already ships.)*
  > **Partly superseded (2026-09-11) by FR-092b and FR-092c**: the chooser stays a **folder**
  > chooser (FR-092c), but the refusal no longer applies to the chooser only. A path **typed** into
  > the box that lies outside the project is refused in exactly the same way (FR-092b). Before this, a
  > typed outside path read as *Scope missing*, which names the wrong condition.
- **FR-071**: Double-clicking a group heading MUST toggle that group between collapsed and expanded.
  A double-click on the heading's own collapse control MUST NOT toggle it twice, and a double-click
  carrying a modifier key MUST NOT toggle it at all. *(The explorer tree already resolves exactly this
  pairing — a folder toggles on double-click while a file opens on double-click — and its handling of
  both traps is the precedent, not a new invention. No menu item is owed: per-group toggling and
  collapse-all already exist in the panel's menu, and this is an accelerator over them.)*

##### Requirements this round supersedes

- **FR-072**: The scope control MUST remain editable and MUST continue to default to the project
  root, but the panel MUST NOT display which scope its listed results came from. **This supersedes
  FR-030's clause "The panel MUST show which scope its results came from"** — quoted rather than
  counted, so the withdrawal names the words it withdraws and cannot be mis-resolved by counting
  clauses differently — and removes the state that existed only to satisfy it. *(The accepted
  consequence, recorded so it is a decision and not a discovery: a panel whose scope control reads one
  directory while listing results from another can no longer say so, and that state is reachable by
  retargeting the control without running. FR-030a's missing-scope marking is unaffected — that is a
  property of the control, not a report about the results.)*
- **FR-073**: Results MUST be groupable **per file** and **per file and folder** only. Grouping per
  folder alone MUST NOT be offered, in the panel, in its menu, or as a preference value. **This
  supersedes FR-033, FR-033a and FR-033c** in so far as each enumerates three values; every other
  clause of those requirements — switching without re-running, the default-grouping preference, the
  remembered-grouping behaviour — stands unchanged over the two remaining values. *(The reason given
  was that a folder-grouped row cannot say which file it belongs to. The narrower remedy of naming the
  file on the row was offered and declined. Note that the per-row staleness marking exists only
  because folder grouping produces no file heading to carry the flag, so its reason for existing goes
  with the grouping.)*
- **FR-074**: A scan MUST start as the user types, once typing settles, **by default**. The explicit
  run remains available and remains a preference. **This supersedes FR-043a's "by default … only on
  an explicit run", FR-043b's "It MUST ship off", and the FR-059 table's "What starts a scan"
  default**, which must move together or the specification asserts two shipped defaults at once. The
  acceptance scenario written against the old default is superseded with them. *(FR-043c is
  unaffected: supersede-never-compound already covers both settings.)*
- **FR-075**: The settle interval MUST ship at **500 ms**. **This supersedes the FR-059 table's
  250 ms.** *(This is Find in Files' own interval, not the find bar's separate debounce; the two are
  deliberately distinct keys and only this one moves. It matters more than it did, because FR-074
  makes as-you-type the shipped path rather than an opt-in.)*
- **FR-076**: The preferences this feature introduces MUST be presented in a section of their own,
  separate from the find bar's. A setting MUST appear in both only if it genuinely governs both.
  *(None currently does: one belongs to the find bar and six to Find in Files, and the settle interval
  was deliberately not made a second use of the find bar's debounce. This follows the sectioning
  convention the editor's preferences already use.)*
  > **Amended (2026-09-10) by FR-082**: the parenthetical's count becomes **eight** to Find in Files
  > and one to the find bar. The requirement itself is unchanged and the new pair is a worked example
  > of it: a display mode and a timeout that govern only this feature's own commit summary belong in
  > this feature's section, and appear in no other, because they genuinely govern only this.
- **FR-077**: Invoking **find in files** MUST leave a reused panel with replace **off**, exactly as
  FR-029d requires **replace in files** to leave it on. *(The two chords become symmetric. Nothing is
  lost by hiding: the replacement text stays in the panel's state and FR-027b restores the toggle
  across a restart, so only what is disclosed changes. With replace hidden, FR-031c's focus target is
  the search input.)*

##### Results in a synced panel

- **FR-078**: A Find in Files panel synced into a sub-workspace MUST show the results of the scan its
  parent ran, and MUST follow them as they change — satisfying US5 scenario 6, which is currently
  unmet. Scan updates MUST reach every window displaying that panel, while continuing to reach no
  panel that is not displaying it (FR-018). A window that begins displaying the panel **after** a scan
  has finished MUST show that scan's results rather than an empty panel.
- **FR-078a**: FR-078's last clause requires results to outlive the moment they were streamed.
  **This supersedes the Assumption that "there is no retention store to size, no eviction policy to
  choose and no retrieval surface to design"** — for a *running or completed scan whose panel still
  exists*, and for nothing else. FR-023 is untouched: closing a panel still discards its results, and
  a restored panel still comes back with no results. What is retained is bounded by the same thing
  that bounds the panel's own memory today, so this introduces no growth that closing the panel does
  not reclaim. *(This is the design decision the gap was waiting on, and it is recorded here rather
  than settled inside an implementation.)*
- **FR-078b**: A window shown another window's results MUST also be shown **the query that produced
  them**. Its search box, its match-mode toggles and any action it offers over those rows MUST
  describe the rows it is displaying, never an older query of its own. The window that is **driving**
  the search keeps its own box — it is the one being typed into — so the query travels one way, from
  whichever window last started or retargeted the run to every other window watching it.

  *(FR-078 shares the RUN across windows; nothing shared the QUERY, and until FR-078 the gap was
  invisible because a synced panel had no results to disagree with. With as-you-type shipping by
  default (FR-074), a term changed in the parent re-runs 500 ms later with nobody pressing anything,
  and the child's list, totals and status all follow while its search box does not. The child then
  reads `needle` above a list of `haystack` matches.*

  *The damage is bounded and worth stating exactly, because it decides the severity: **no wrong bytes
  are ever written.** FR-054's re-check reads the file as it is now and verifies the term at each
  offset before replacing anything, so a commit driven from a window holding a stale term is REFUSED
  rather than misapplied — every file comes back `matchGone`, naming matches that are plainly on
  screen. So this is a correctness and confusion defect, not a data-loss one: the user is told their
  matches have vanished when they have not, and the panel is lying about what it is searching for.*

  *The mechanism is one line of ownership. `find-in-files-panel.tsx` reads the query from
  `panel.config` ONCE at mount and deliberately never re-reads it — for a good reason, that a
  debounced layout save must not race the user's next keystroke back out of the box — and
  `ensureFindInFilesPanel` is idempotent, re-stating only `projectId` and `projectRoot`. Both are
  correct for the window doing the typing. Neither is a channel for a query arriving from elsewhere,
  which is what FR-078 created the need for.)*

##### A themeable icon's box

- **FR-079**: A control that hosts a themeable icon MUST NOT hardcode a box computed from that icon
  token's **default** value. The box MUST derive from the token, so that a user who changes
  `sizes.iconPx` gets a control that changes with it. *(The token is `--throng-size-icon`, emitted
  from `sizes.iconPx`; `.icon` already sizes itself from it, so today the glyph grows and its
  container does not. The two symptoms differ by one declaration and a reader should expect either:
  where the container sets `overflow: hidden` the glyph is **clipped**; where it does not, the glyph
  **overflows and collides** with its neighbours. Both are reachable from a shipped control in the
  Themes editor, which is what makes this a defect rather than hardening.)*
- **FR-079a**: This requirement is **scoped to the three controls this feature owns or is changing** —
  the Find in Files panel's action buttons (`.fif-btn`), the panel's field glyphs
  (`.fif-field__icon`), and the explorer toolbar's buttons (`.explorer-toolbar__btn`, which FR-065 is
  about). Every other occurrence found by the audit is **recorded, not fixed**: the pattern is
  repository-wide and a find-and-replace feature is the wrong vehicle for it. The enumeration lives
  in the plan's Complexity Tracking as **F3**, and it MUST be tracked as an open issue rather than
  only as an appendix — an appendix is not a tracker, which is the rule **F1** exists to state.
  *(Named separately from FR-079 so the scope limit is a requirement rather than an implementation
  note: a later reader must be able to see that the narrow fix was chosen, not overlooked.)*

  **Two different reasons put three controls inside the line, and the distinction is the whole basis
  of the limit.** The first two are here because **this round's own requirements reach them**:
  FR-079 is about the panel this feature builds, and FR-065 is about the toolbar control this
  feature is changing. The third is here because **this feature WROTE it** — `.fif-field__icon` is in
  `find-in-files.css`, which 043 authored, so it is not an instance of an inherited pattern but a
  defect this round introduced. Shipping a change that fixes the frozen box in two controls while
  leaving a third inside the very panel being fixed is incoherent in exactly the way FR-062a is
  about. What stays outside the line is what this feature neither wrote nor was already opening.
  *(Widened from two after `.fif-field__icon` was found during implementation. It was not in the
  original audit, which is itself the point below.)*
  > **Amended (2026-09-10) by FR-080a**: the enumeration is **four**, not three — the Clear controls
  > FR-080 adds to the panel's three text inputs join it, by the third of the two reasons stated
  > above: **this feature is writing them**. The scope limit is unchanged in substance and the three
  > existing clear controls elsewhere in the application (`.settings-search__clear` and its two
  > siblings) stay outside the line as inherited pattern, still counted in the repository-wide
  > enumeration this requirement points at. Widened from three for the same reason it was widened
  > from two, one round later, which is worth noticing.
- **FR-079b**: The requirement this replaces is **none**. It is written because no existing
  requirement covered it: FR-065 asks for a better **glyph** and says so in as many words — *"The
  remedy is the glyph"* — so the box was authorised as work with no requirement behind it. Recorded
  plainly rather than folded into FR-065, because a requirement stretched to cover work it does not
  describe is how a spec stops being readable as a contract.
- **FR-079c**: A derived box MUST also **hold** the glyph. Where the control is `box-sizing:
  border-box`, its declared size MUST account for its border and its padding as well as the token,
  so that the **content** box equals `sizes.iconPx` at every value of it — not merely reference the
  token. *(Deriving from the token and leaving the glyph room are two requirements, and FR-079 only
  states the first. `.fif-btn` shipped as `width: 22px; padding: 3px; border: 1px`, and under
  `border-box` that is **14px of content for a 16px glyph** — clipped 1px on every side at the
  DEFAULT icon size, with nothing changed in the Themes editor. So this is not a latent defect
  waiting on a raised token; it is what the control has always looked like, and FR-079's own
  headline tell — `16 + 3 + 3 = 22` — is an incomplete sum that omits the border. The first
  correction of that rule rewrote the same incomplete sum in `calc()` form: it satisfied FR-079
  exactly, passed every test written for it, and still clipped the glyph by 1px at every icon size.
  A requirement about a box's vocabulary cannot catch a box whose arithmetic is short a term, which
  is why this is stated separately. Verified by measurement in a real browser rather than derived
  from the box model, and the resulting default box is **24px**, which is exactly `.find-bar-btn` —
  this control's twin, whose 2px disagreement with it was never a design decision.)*

#### Round three — post-testing change requests (Session 2026-09-10)

A second round of hand-testing, and the same rule as the round above: where one of these supersedes
an earlier requirement, the earlier text stays where it is and carries a marker; nothing above has
been rewritten or renumbered.

##### Clearing an input

- **FR-080**: Each of the Find in Files panel's three text inputs — the **search term**, the
  **replacement** and the **scope** — MUST carry a **Clear** control that empties that field and
  leaves focus in it. Each MUST reuse the clear-inside-an-input vocabulary the application already
  ships in three places (the settings, keybindings and themes search boxes): an icon control on the
  **`dismiss`** token, carrying a hover title that names the action, given a test id of the form
  `<surface>-search-clear`, and **rendered only while its field is non-empty** — never drawn as a
  disabled ghost. A second vocabulary MUST NOT be introduced for the same gesture.
  *(The token is `dismiss`. There is no `clear`, `close` or `x` token, and `destroy` is a
  deliberately separate token for destructive row actions — recorded here so that a later reader
  "tidying" one into the other can see it was a decision. Constitution VI's "absent when
  meaningless" is what makes the empty-field case an absence rather than a disabled control:
  clearing an empty box is not temporarily unavailable, it is never meaningful. FR-011 binds these
  controls like every other this feature introduces.)*
- **FR-080a**: A Clear control's box MUST derive from `--throng-size-icon`, and its **content** box
  MUST hold the glyph once its border and its padding are taken out — that is, **FR-079 and FR-079c
  apply to it in full**. It MUST NOT copy `.settings-search__clear`'s CSS, which hardcodes
  `width: 20px; height: 20px` and is exactly the frozen box those two requirements were written for.
  *(Stated as a requirement rather than left to review because the control being added is a copy of
  a control that carries the defect, one round after the defect was written down — which is the most
  likely way it comes back. This widens FR-079a's enumeration from three controls to four; the three
  existing clear controls elsewhere stay outside the line under FR-079a's own reasoning, as an
  inherited pattern this feature neither wrote nor is opening.)*
> **Partly superseded (2026-09-10) by FR-080e**: the clause "clearing the **scope** … starts
> nothing" holds only under FR-043a's explicit run. Under FR-074's as-you-type default it cannot,
> and FR-080e says what happens instead. Everything FR-080b says about the **term** stands
> unchanged, as does "MUST NOT discard the results already listed" for all three inputs.

- **FR-080b**: Clearing an input MUST NOT discard the results already listed. An empty term matches
  nothing and MUST NOT start a scan under either trigger — FR-043a's explicit run or FR-074's
  as-you-type default — so the list simply stands over an empty box until the user searches again.
  Clearing the **scope** returns the search scope to the **project root**, which is what an empty
  scope control already means (FR-030), and starts nothing.
  *(Consistent with FR-030a, which settles the same question for a retargeted scope: the retarget
  starts nothing and every listed row stays listed and fully actionable. An empty box is not a
  search that found nothing, and FR-042's distinction between the two is untouched.)*
- **FR-080e**: A Clear MUST have **exactly the effect of emptying that field by hand**, and no other.
  It MUST start nothing of its own; whatever follows is whatever the active trigger would do for the
  same edit made with the keyboard. So under FR-043a's explicit run, clearing the scope starts
  nothing — as FR-080b says. Under FR-074's as-you-type default, clearing the scope schedules a scan
  after FR-075's settle, **because deleting that text by hand does**.

  *(Found while implementing FR-080b, which asserted "starts nothing" for the scope unconditionally.
  It cannot hold: FR-080d says a Clear is text editing on that field rather than a discrete command
  the panel offers, so a Clear that suppressed the scan would behave differently from the keystrokes
  it stands for — and a control that is "the same as deleting it yourself, except quieter" is a
  second, undocumented way to search. The term is unaffected either way: an empty term matches
  nothing and the scan refuses to start, so FR-080b remains literally true there under both
  triggers. This is the narrower of the two readings and the only one consistent with FR-080d.)*
- **FR-080c**: The scope input's Clear control MUST sit **inside** the scope input's own box, and the
  folder-chooser control of FR-070 MUST remain a **sibling beside** that box rather than moving
  inside it. FR-030a's missing/refused notice MUST keep its place and MUST NOT be displaced by the
  new control. *(A clear acts on the text in the box; a browse acts on the scope. One box for both
  would claim they are the same kind of thing.)*
- **FR-080d**: **No menu item is owed** for any of the three Clear controls, and FR-025a is not
  widened by them. Emptying a focused text field is text editing on that field, not a discrete
  command the panel offers — the same exemption FR-025a already grants navigational input, and the
  same reasoning FR-071 records for the double-click accelerator. *(Stated because FR-025a is
  deliberately broad and the editor-completeness discipline would otherwise be read as requiring
  three menu items for three keystrokes the user already has.)*

##### The panel's title, and the replace state

- **FR-081**: A Find in Files panel's title MUST say whether replace is disclosed: **"Find in
  Files"** while the replace row is hidden, and **"Find & Replace in Files"** while it is shown. The
  term suffix required by FR-060 is unchanged and MUST follow whichever of the two is in force.
  Title case throughout, matching the shipped "Find in Files". The composed string MUST be built
  where a panel's name is decided, and **`findInFilesPanelType.label` MUST NOT change** — it is also
  the New Panel label and the panel-type icon descriptor's label, and a title composed for one
  panel's disclosure state is not a rename of the panel type. **This refines FR-060** rather than
  contradicting it: FR-060 requires the title to say what the panel is, and this says what it is
  depends on what it is showing.
  *(No new persisted state is needed — `replaceShown` is already written into the panel's config and
  read back from it, so the title rule reads it exactly as it already reads the term and
  `PanelTitleSources` gains no field. FR-061 makes this panel non-renamable, so the automatic title
  is the only title it has: there is no user-chosen name for this to lose a race with, and equally
  no second route by which a panel could end up mislabelled. The Terminology table is untouched:
  **Find in Files panel** remains what this document calls the type.)*

##### The replace summary notice

- **FR-082**: The notice a commit raises to report its outcome (FR-058) MUST have **its own display
  mode and its own timeout**, exposed in the `Search · Find in Files` section alongside this
  feature's other preferences (FR-076) and shipping as **`dismiss` / 5000 ms**. Both MUST use the
  application's existing display vocabulary rather than a parallel one: the modes are
  `never` / `timed` / `dismiss`, labelled *Never display* / *Display for* / *Dismiss only*; the
  duration is bounded by `TIMEOUT_MIN_MS` (3000) and `TIMEOUT_MAX_MS` (30000), its slider steps by
  500, and 5000 is exactly a stop on that grid.

  **These two settings MUST govern all three outcomes — success, warning and error alike — and for
  this one notice the global `notifications.*` settings MUST NOT be consulted at all.** That is a
  deliberate override, chosen with its cost stated: **a user whose global preference is that errors
  stay until dismissed does not get that behaviour here.** It is written down rather than left
  implicit because a later reader must be able to see it was chosen and not overlooked.

  FR-058 is untouched — a commit still reports **once**, from whatever owns the operation. What
  changes is how long that one notice stays, and who decides.

  *(The shipped default is not self-contradictory. `error` and `warning` already ship
  `{ mode: 'dismiss', timeoutMs: 5000 }`, because a timeout is stored and preserved whatever the mode
  is and consulted only under `timed` — the display-mode module states that coexistence deliberately,
  and the provider arms a timer only for `timed`. A stored 5000 under `dismiss` is a value waiting to
  become meaningful, not a setting at odds with itself. Nor is the override as wide against 030's own
  reasoning as it first reads: 030's principle is that the **user**, not the raiser, decides how long
  they need to read something, and the user still decides here — through a control of their own. What
  moves is which control, not whether there is one.)*
- **FR-082a**: FR-082 requires a **per-notice display override in the application-wide notice
  contract**, which does not exist today: a raiser can state a severity and nothing else, and the
  provider resolves the mode and the timeout from that severity alone. That contract MUST be widened
  to carry an **optional** per-notice display mode and timeout which, when absent, resolve exactly as
  they do today — so every existing call site is unaffected and nothing needs changing to keep
  working. **This reaches spec 030's notice contract** and MUST be recorded there as well as here.
  *(Named as its own requirement so the reach of the change is visible in the specification rather
  than discovered in a diff: this is the one part of round three that is not confined to this
  feature's own surfaces.)*
- **FR-082b**: The preference editor MUST NOT present either of the two new controls as live when it
  is not. **Two** gates in the settings form are hardcoded to keys matching `^notifications\.`, and
  both MUST **generalise** rather than gain a third pattern: the one that greys an **inert timeout**
  whose sibling mode is not `timed`, and the one that requires the user's **consent** before
  *Never display* silences a failure (030 FR-008). Ungeneralised, the first invites the user to tune
  a number nothing reads — the exact lie that mechanism exists to prevent — and the second lets a
  commit's failure report be silenced with none of the consent 030 FR-008 requires before a failure
  stops reporting itself. *(The settings form's own comment already names this remedy: "a second
  feature adding a third dependency should lift both of these into `FieldDescriptor` rather than add
  a third regular expression". This is that second feature. **Both** gates, not only the first — the
  consent gate is the one the request did not mention and the one with a safety consequence, since
  its whole purpose is that a user cannot silence failure reporting without being told what it
  costs. FR-059a is what this satisfies for the new pair.)*

##### After a commit

- **FR-083**: A result row this panel has **committed** MUST show the file's text as it is after that
  commit. **This narrows the Staleness preamble** — *"Results are a snapshot taken at scan time. They
  do not refresh themselves"* — and the narrowing is exact: a row refreshes for a change **this panel
  itself made**, and for nothing else. A change made by any other writer — another panel, another
  window, an external editor — still gets FR-045a's stale marking and no refresh.
  *(The panel is the authority on its own writes: it knows which offsets it replaced and with what,
  so refreshing those rows costs no watch, no re-scan and no second notion of freshness. That is why
  this is a narrowing rather than a reversal, and why it cannot be generalised to changes the panel
  did not make.)*
- **FR-083a**: While replace is on, a **pending** row MUST render as the preview FR-047 describes —
  the matched text struck through, followed by the proposed replacement — and a **committed** row
  MUST render the new text **plainly**, no longer struck through. **This supersedes FR-047's
  requirement that "every result row MUST render as a preview"**, which was written before a row
  could be anything other than pending. FR-051 — a committed match MUST be visibly distinguishable
  from one still pending — is **satisfied** by this, not weakened. A match the user **skipped**
  (FR-050) remains pending and MUST therefore remain a preview; skipped rows are explicitly not
  swept into this change.
- **FR-083b**: Two matches on one line each carry the other's old text in their surrounding context,
  and the commit MUST fix that rather than leave it. The commit's result MUST carry a **re-derived
  snippet for every line it changed**, and the panel MUST render committed rows from those snippets
  rather than re-deriving them from text the same commit has invalidated. **This is a change to the
  commit result's contract**, and it applies on both commit paths. A **size bound** is owed with it
  and MUST be stated wherever that payload is designed: a commit spanning many long lines would
  otherwise return a great deal of text across a process boundary.
  *(The new text is already in hand on both paths and needs no second read — the disk path holds the
  whole new file after applying its replacements, and the buffer path has the document authority's
  own text after the dispatch. Deriving each row's snippet independently of the row beside it is what
  produces the defect; deriving them all from one new text is what removes it.)*
- **FR-083c**: A file changed **only** by this panel's own commit — including a save made under
  FR-086 — MUST NOT be marked stale by that commit. FR-045a is untouched for every other writer.
  *(Derived, and flagged as derived: it was not in the request, and it is the interaction FR-083
  creates. FR-045a observes the project watch rather than the writer, so a commit to an unopened
  file changes that file and marks it stale in the very panel that just made the list agree with the
  disk. Before this round that was noise the user could ignore; with FR-083 it is visibly wrong,
  because the rows now claim to show the file as it is while the heading above them says the list
  disagrees with the disk. The reasoning is FR-083's own — the panel is the authority on its own
  writes, and on nobody else's.)*

##### Replace All, when there is nothing to replace

- **FR-084**: Replace All MUST be **disabled whenever there is nothing pending to commit** — on the
  toolbar control FR-068 requires **and** equally on the menu item FR-025a requires, so the
  accelerator and the canonical route never disagree about whether the command is available.
  *(This closes a shipped defect rather than adding polish: `pendingRows()` already returns an empty
  list once every match has been committed, so the control today is drawn live, clicks, and does
  nothing. A control whose action is unavailable drawn inert instead of disabled is the Constitution
  VI violation FR-062a is about, on this same panel.)*
> **Superseded (2026-09-10) by FR-084c**: the second route below — a term typed but not run — was
> found during implementation to enable a control that can do nothing, which is the defect FR-084
> exists to close. FR-084a's first route stands; its second is withdrawn.

- **FR-084a**: Replace All MUST become available again as soon as there is something to commit.
  **Two** routes reach that state, and they are **not the same event under both settings**. A **new
  scan** clears the committed marking by generation and re-enables the control by construction. A
  **term the user has typed but not yet run** must also re-enable it — which under FR-074's shipped
  as-you-type default coincides with a new scan, but under FR-043a's explicit-run setting does not,
  since a user can type a different term and never run it. The panel MUST therefore remember **the
  term its listed results came from**, and treat a search box that differs from it as grounds to
  re-enable.
  *(That remembered term is never displayed. FR-072 withdrew `ranScope` — state that existed only to
  display which scope the listed results came from — and this is deliberately not a re-introduction
  of it under another name: nothing here reaches the screen, and it is read only to decide whether
  one control is live.)*
- **FR-084c**: Replace All is available **exactly when there is a listed match still pending**, and
  on no other condition. A term the user has typed but not run MUST NOT re-enable it.

  *(FR-084a's second route was written from the maintainer's own words — "until they search again, or
  change the text in the search box" — and it does not survive contact with what the panel holds.
  Work the sequence under FR-043a's explicit run, the only setting where the two routes differ:
  search `foo`, Replace All, every row commits, the control correctly goes dark. Type `bar` and do
  not run it. FR-084a re-enables the control — but the listed rows are still the `foo` rows and all
  of them are committed, so there is nothing to send. Pressing it commits nothing; had it sent
  anything, FR-054's re-check would refuse every row against the new term and report matches gone
  that are plainly on screen. That is a control drawn live over an action it cannot perform, which is
  the Constitution VI defect FR-084 was written to remove — re-created by FR-084a's own second
  clause.*

  *The maintainer's INTENT is met in full by this rule, and under the shipped default their literal
  route works too: FR-074's as-you-type re-runs 500 ms after the last keystroke, which is a new
  generation, which clears the committed marking and re-enables the control. It is only under the
  non-default explicit-run setting that typing alone leaves the control dark — and there it is dark
  because there is genuinely nothing to replace until the search is run.)*
- **FR-084b**: FR-045b — which forbids disabling, hiding, greying out or reordering a **row** — does
  not reach this. Replace All is a panel control, not a row, and Constitution VI requires precisely
  that a control whose action is temporarily unavailable be drawn and disabled. *(Stated so the two
  are not read as contradicting each other by someone meeting them in the wrong order; FR-045b's own
  parenthetical already draws the same distinction from the other side.)*

##### A gesture that says it is there

- **FR-085**: Everything in the results list that responds to a **double-click** MUST show, on hover,
  that it does: **every group heading** — naming a file or naming a folder alike — and **every result
  row**. The vocabulary MUST be the explorer tree's, matched rather than re-invented: `cursor:
  pointer`, plus a hover fill of `--throng-colour-hoverSurface` guarded by
  `:where(body:not([data-window-blurred]))` so no hover is left stranded on a blurred window. That
  guard is enforced by an existing coverage test, so an unguarded rule fails the build rather than
  shipping. **`--throng-colour-surfaceActive` is reserved for selected and engaged states** — the
  panel's own toggle buttons are its instance of that role — and MUST NOT be borrowed for hover.
  *(FR-071 shipped the double-click on a group heading with nothing to say the gesture existed, and
  FR-037's double-click on a row has been in the same position since it shipped; this closes both.
  Headings are one element differing only by which kind of group they name, so there is nothing to
  distinguish between — both get the affordance, which is what was chosen when the narrower option
  was offered.)*

##### Saving what the commit finished

- **FR-086**: A document that was **clean before a commit** MUST be **saved immediately after** that
  commit's edit lands in it. **This supersedes FR-053a — "A commit MUST NOT save any editor" — and
  the 2026-09-08 clarification that answered "No — a commit saves nothing"**, for documents that were
  clean before the commit and for nothing else. The edit still arrives through the document authority
  as a single undoable edit (FR-052) and **remains undoable after the save** (FR-057, SC-007): undo
  then save is the ordinary path, and writing a buffer out discards nothing from its history.
  *(This is the decision taken after the request's own premise was shown not to hold — 043 never
  writes disk under an open editor, so "refresh the editor" already happens and "changed on disk"
  can never fire for this case. The literal request was declined for a stated reason: writing disk
  beneath an open buffer and reloading it would clear the undo history of **every** open file
  (016 FR-026d), contradicting FR-057's per-document undoability, and would write out unrelated
  unsaved work. Saving a document that had none is the version of the request that costs neither.)*
- **FR-086a**: A document that was **already dirty** before the commit MUST NOT be saved. It keeps
  FR-053c's pending state exactly as it has it today, so **FR-053b stands unchanged and word for
  word**: a commit still never writes any unsaved change the user made before it. The mixed state
  FR-053c describes therefore **narrows rather than disappears** — it is now three cases: unopened
  files written to disk, documents that were clean written to disk by FR-086's save, and documents
  the user had already modified still pending in their buffers alongside that user's own work.
- **FR-086b**: FR-057b's warning, and FR-057d's rule that it MUST NOT appear when every affected file
  has an open editor, both **stand unchanged**. A clean document saved under FR-086 has reached disk,
  but that change is still undoable from the document's own history — and FR-057d's reasoning turns
  on undoability, not on whether bytes were written. The warning is about changes with **no in-app
  undo** (FR-057a), and this is not one of those. *(Recorded because the obvious reading of FR-086 is
  that it creates a new class of on-disk write that ought to warn, and it does not.)*

##### Opening a result where the user chooses

> **Every citation in this group carries its spec number, and that is not pedantry.** 043 has its own
> FR-030, FR-072 and FR-082 — the scope control, the scope control again, and the notice display
> override — and **006** has an FR-030, FR-072 and FR-082 that mean the Open In submenu, the two
> editor targets, and the no-op disable. A bare number here sends the next reader to a requirement
> that says something else entirely, which is the failure the project's own guidance records as
> having gone unnoticed for a year.

- **FR-087**: The Find in Files panel's own menu MUST offer an **Open In** submenu for the file the
  menu was opened on, naming the **same editor targets the Files & Folders file menu names** —
  006 FR-030's submenu, as it stands today after 006 FR-072, 006 FR-082 and 006 FR-098. The targets
  MUST be **derived from one shared description**, not re-authored: two surfaces offering "the same
  options" while each computing its own labels and its own disabled conditions is two implementations
  that will disagree, and the one that drifts is the copy. *(Constitution VI: opening a result is a
  discrete command, and until now it had exactly one route — a double-click — and no menu item at
  all. FR-025a enumerates the panel-level commands and exempts "moving between rows" as navigational
  input; **opening** a row was never exempt, so this closes a live gap rather than adding a
  convenience.)*
- **FR-087a**: The submenu MUST offer, in this order: **Last Active Editor (\<Panel name\>)** naming
  the panel the file would land in, **New Editor**, and **Other Tab** listing the tabs of the current
  project other than the active one. The labels and the order MUST match the explorer's, because they
  are the same commands — a user who has learned one menu has learned both. *(006 FR-098 owns the
  parenthetical panel name; 006 FR-072 owns the two editor targets; 006 FR-030 owns the Other Tab
  list and the current-project scoping.)*
- **FR-087b**: The disabled conditions MUST be the explorer's, unchanged and for the explorer's
  reasons: **Last Active Editor** disabled when that editor **already holds this file** (opening
  there would be a no-op, 006 FR-082); **New Editor** and every **Other Tab** entry disabled when the
  file is **already open in any editor anywhere** (006 FR-011a's one-buffer rule — a second buffer is
  never created); and all of them disabled when there is no active tab. **Other Tab MUST be absent
  when there is no other tab**, rather than drawn and disabled. *(Constitution VI's split: unavailable
  now but enabled by some future state → drawn and disabled; structurally meaningless → not drawn. A
  flyout naming a set is meaningless over an empty set, which is why it is the one absence here.)*
  > **FR-045b does not reach this**, for the reason FR-084b already gave from the other side: FR-045b
  > forbids disabling, hiding, greying out or reordering a **row**, and a menu target is not a row.
  > Cited rather than re-argued.
- **FR-087c**: Every target MUST **reveal the match**, exactly as FR-038 requires of the double-click
  — the file is opened *at* the match, not merely opened. This MUST hold for the target that creates
  a new panel as well as the two that reuse one, which means the reveal MUST happen in whichever
  panel the open actually chose. *(The caller cannot know which panel that is: it is decided branch
  by branch inside the open — the editor that already held the file, the tab's last active one, or
  one created on the spot — so a caller that revealed afterwards would get it wrong in exactly the
  case a dirty target answered with "New Editor".)*
- **FR-087d**: When the menu is opened somewhere that names **no result row** — the toolbar, a group
  heading, the status line, the empty space below the last row — the Open In submenu MUST be **drawn
  and disabled** rather than absent. *(The same choice the three commit granularities already make in
  this menu, and for the same reason: a menu that changes shape depending on where in the panel it
  was opened teaches nothing about what the panel can do. A future state enables it — right-click a
  row — so Constitution VI says disable.)*
- **FR-088**: **FR-020 does not constrain where a result may be opened, and MUST NOT be read as
  doing so.** FR-020's subject is the **panel**: "the panel it opens or reuses MUST be in that Tab".
  It says nothing about the search's file scope and nothing about the destination of an open.
  Opening a result into **another tab** is therefore permitted, and FR-087a requires it. *(Recorded
  because the opposite claim was written into the code — `result-open.ts` asserted that "FR-020
  already confines a search to the current tab, so there is no second tab this could mean", which
  misstates FR-020 twice and then draws a conclusion that does not follow from either reading. A
  written argument against a feature, sitting in the file the feature edits, is worse than no comment
  at all; it is corrected in the same increment.)*
- **FR-089**: **041 FR-013d's call-site clause is superseded**, by removing its premise rather than
  by disagreeing with it. FR-013d requires the explorer's *Open In → New Editor* item to be gated at
  its call site **because** it is the one caller of `openFileInNewEditor` that does not route through
  `openFileInTab` and therefore never reaches `openInto`. That item MUST now route through
  `openFileInTab` with an explicit new-editor target, which awaits `openInto` on its first line and
  already performs the refusal, the focus fallback and the reveal. The hazard FR-013d guards then has
  **no caller left**: `openFileInNewEditor` is reached only from inside `openFileInTab`, which gates.
  **FR-013d's other half stands unchanged and is not weakened** — `openFileInNewEditor` MUST stay
  synchronous and MUST NOT be given the gate. *(Stated as a supersession, in this spec, naming what
  it replaces and why, rather than left as a requirement quietly contradicted by the code. 043 is
  what makes the change necessary: a second surface offering the same target would otherwise become
  a **second** ungated caller, which is the defect 041 FR-013 was filed for — #327.)*


##### Round five — searching from the tree, and a file as a scope

- **FR-090**: The Files & Folders context menu MUST offer, inside its **Open In** submenu, a
  **Search** submenu holding exactly two items: **Find** and **Find & Replace**. It MUST be offered on
  a **file**, on a **folder**, and on the project **root** — including the root's menu raised from
  the empty space below the tree. Every item MUST declare the Navigate section, so the flyout derives
  no divider. *(Constitution VI's section vocabulary names "Open In" in the Navigate row. 033 FR-029
  and FR-036 are the precedent for a third level nested in Open In — Open In → Terminal → flavour —
  and for that path being traversable by mouse and by keyboard without an intermediate flyout
  collapsing.)* This **supersedes FR-029b**, whose folder-only row is moved here rather than kept
  beside it, and the menu clauses of **FR-029d**.
- **FR-090a**: The labels MUST be exactly **Find** and **Find & Replace**, under a parent labelled
  **Search**. *(The labels the maintainer asked for, verbatim. This sits against the glossary's rule
  that "nowhere is a second name used for the same thing": FR-015 already uses "Find" for the find
  bar's own item. The two do not collide in practice — the tree has no find bar, and the **Search**
  parent says which search is meant — but the tension is recorded rather than left for someone to
  find. Should the maintainer prefer the panel's own names, the change is two strings: **Find in
  Files** and **Find & Replace in Files**, which is what FR-081 titles the panel.)*
- **FR-090b**: Both items MUST open or reuse the Find in Files panel **exactly as FR-020, FR-021 and
  FR-022 already say** — in the current Tab, reusing the last active panel under the shipped
  preference, and creating a new one under `openTarget: new`. **Find** MUST leave replace **hidden**
  (FR-077); **Find & Replace** MUST leave it **shown** (FR-029d). *(Derived. The request says "the
  current tab's panel", which is what the shipped default already does; honouring the preference
  rather than overriding it keeps one reuse rule for every entry route instead of two.)*
- **FR-091**: Whether the panel was opened or reused, the route MUST leave it in **one state**: the
  search term **empty**; the replacement text **empty**; the results **cleared** to FR-042's
  *not run* state — never read as a search that found nothing; every committed marking and every
  stale marking gone with the rows they described; any scan that was running **stopped**; the scope
  set to the right-clicked path, root-relative, with `''` for the root; any scope notice cleared; and
  the caret in the **search** input. **No scan starts**: the term is empty, and FR-080b already says
  an empty term starts nothing under either trigger. This **supersedes FR-043a's
  re-run-the-existing-term rule** for this route and no other. FR-031b — the tree route never seeds
  from a selection — **stands**.
  *(The caret goes to the SEARCH input even for Find & Replace, deliberately and against FR-031c's
  usual split. FR-031c puts replace in files' caret in the replacement because that chord arrives
  with a term already in the box; this route has just emptied it, and a replacement typed before
  there is anything to find previews nothing. Derived.)*
  *(Clearing the RESULTS is what separates this from FR-080's Clear controls, and the difference is
  intended. FR-080b says clearing an input MUST NOT discard the listed rows, and it still says so —
  a Clear acts on one field. This route acts on the whole panel: the user asked for a fresh search
  of a new place.)*
- **FR-091a**: The clear MUST reach **every window displaying the panel**. FR-078 hands a synced
  sub-workspace view the parent's run, and FR-078a keeps that run in main so a late-attaching window
  can be shown it — so a clear made only in the window that asked would leave the other showing the
  old rows under an empty box, which FR-078b forbids. Main MUST drop the run's rows and tell every
  viewer the panel is *not run*. Emptying the query is a change to the query, so the window that
  asked becomes the window whose box is authoritative, exactly as FR-078b already says of a window
  that retypes.
- **FR-092**: A search scope MAY name a single **file** beneath the project root. A file scope MUST
  search **that file and no other**. Its rows MUST carry the file's path **relative to the project
  root**, exactly as every other row does, so opening a row, FR-087's targets and a commit all
  resolve the same file they would from a folder scope. The file MUST pass through the **same
  per-file rules** as any file a folder scope reaches: over the size limit, binary or unreadable, it
  is **skipped** and counted as FR-042 already reports skips. The project's exclusion rules MUST NOT
  be applied to a file the scope names explicitly. *(Derived, and consistent with what a folder scope
  already does: the walk tests every entry it reaches against the exclusions but never tests the
  scope itself. A user who names one file has answered the question the exclusions exist to ask on
  their behalf.)*
  *(This closes a live defect rather than only adding a capability. Before it, typing a file's path
  into the box started a scan, the walk read the file as a directory, the failure was swallowed, and
  the panel reported **No matches** — a false answer about a file that might be full of them.)*
  > **Noted, not decided (2026-09-11)**: the shipped **folder** behaviour here is already
  > inconsistent, and this round does not settle it. A folder scope inside `node_modules` is walked,
  > because the exclusion glob matches the folder's name and not its descendants; a folder scope
  > inside a folder the project **hides** finds nothing, because the hidden set compiles each entry as
  > both `p` and `p/**`. A file scope follows the rule above in both places. The tree cannot offer a
  > hidden file at all — it is not drawn — so the only route to that case is typing its path.
- **FR-092a**: FR-030a's missing-scope marking MUST apply to a file scope **identically**: a scoped
  file that is renamed or deleted is marked missing on the control, the listed rows stay listed and
  usable, and retargeting clears it. No new watch is added for this (FR-045d); the existing prompt at
  or above the scope, and the existence check behind it, already cover a file.
- **FR-092b**: The scope control MUST accept, typed, a path in either of these forms and read both as
  the same scope: **root-relative**, or **absolute** — a "full" path — when it lies **inside** the
  project. Separators MAY be `/` or `\`; a leading `./` and any trailing separator MUST be ignored. An
  absolute path **outside** the project MUST be refused on the control exactly as FR-070 refuses a
  chosen folder, and MUST start nothing. The control keeps the text the user typed; the reading
  happens where the scope is used. *(Derived — "full file paths" is read as absolute paths, because a
  path copied from the tree's **Copy Path → Absolute** or from an editor tab is exactly that. The
  root-relative form still works, and is what the tree's route fills in.)*
  *(Two further defects close with this, both reachable by typing: a trailing slash produced rows
  like `src//a.ts`, and a backslash was carried into every row's path.)*
- **FR-092c**: The scope control's browse button MUST remain a **folder** chooser. *(Derived. The
  platform's native dialog cannot offer files and folders in one dialog on Windows — a request for
  both returns folders only — so a file scope is reached by the tree's menu or by typing its path.
  The button's title, "Browse for a folder in this project", stays true.)*

### Key Entities

- **Find session**: what one panel's find bar is currently searching for — its term, its replacement
  text, its match modes, and which match is current. Owned by exactly one panel; discarded when that
  panel is destroyed.
- **Find in Files panel**: a workspace Panel that owns one file search. Associated with exactly one
  project, created only by running find in files, and never offered in the New Panel dialog. May be
  synced into a sub-workspace, where the parent remains the sole authority.
- **File search**: one query — its term, its match modes, its search scope, its replace state and
  replacement text, and its lifecycle (not run, running, cancelled, complete). Owned by exactly one
  Find in Files panel, and discarded when that panel is closed.
- **Search scope**: a project root, or one sub-directory beneath it. *(Partly superseded
  2026-09-11 by FR-092: or one file beneath it.)*
- **Result row**: one occurrence of the term in one file, at a position, carrying the snippet of
  surrounding text shown in the list, and — while replace is on — whether it is pending or committed.
- **Group**: a heading result rows sit under, with a collapsed/expanded state, a match count, and —
  for a group representing a file — whether that file has changed since the scan. What a group
  represents depends on the chosen grouping: a file, a folder, or a folder containing files.
  > **Partly superseded (2026-09-09) by FR-073**: with per-folder grouping withdrawn, a group
  > represents a **file**, or a **folder containing files** under the remaining nested grouping.
  > The "a folder" case — a folder heading standing over rows with no file heading between — goes
  > with the grouping that produced it, and the per-**row** staleness marking goes with it, since
  > that marking existed only because that shape had no file heading to carry the flag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user searching in one editor, working in another, and returning finds their search
  intact with zero keystrokes of re-entry.
- **SC-002**: Two editors can hold independent find sessions at once, and an action in one changes
  nothing observable in the other.
- **SC-003**: A user who has not been told that replace exists can discover it, reveal it and put it
  away again using only what is visible on the find bar.
- **SC-004**: A file search over a project of at least 5,000 files begins showing results before the
  scan completes, and the interface remains responsive to input throughout. **"Responsive" is two
  measurable bounds, at two layers**: the scan MUST emit its first batch before the walk completes and
  MUST cap every batch at a stated maximum row count; and the renderer MUST handle **at most one such
  batch per synchronous turn**, yielding between them, so typing and scrolling keep up while a scan
  streams. The first is asserted where the scan runs, the second where batches are handled — both
  structurally, against the stated cap. **100 ms is the design budget those caps are chosen to
  respect**, not itself an automated assertion: a wall-clock threshold measured in a test environment
  says more about the machine than the code. Whether it *feels* right at 5,000 files is the hands-on
  step in `quickstart.md`.
- **SC-005**: Every occurrence of a term is reachable in at most two actions from the results — one to
  expand its group if collapsed, one to open it.
- **SC-006**: A user can tell what a replace would do, for every listed match, without any file having
  been changed.
- **SC-007**: A committed replace touching files that are open in editors is fully reversible from
  those editors' own undo.
- **SC-007a**: A user is never surprised by an irreversible change: before any commit writes to a
  file with no open editor, they have been told how many files that is and have confirmed it — unless
  they turned the warning off themselves.
- **SC-008**: A commit that partially fails leaves the user able to say, without inspecting the
  filesystem, exactly which files changed.
- **SC-009**: A user can keep at least three independent file searches open at once and return to any
  of them without re-running it.
- **SC-010**: No count this feature displays is shown ungrouped at any magnitude.
- **SC-011**: A user who has never been told the chord can find and start a Find in Files search, and
  can scope one to a folder, using only what is visible in the explorer pane.
- **SC-012**: A user reading a results list can tell, per file, which results still match what is on
  disk — without re-running the search and without opening any file.
- **SC-013**: No replacement is ever written at a position whose text no longer matches, whatever the
  panel was displaying at the time.

## Assumptions

- **The existing search seam is reused, not duplicated.** This is explicit maintainer direction on
  #153: the engine-agnostic search controller seam and the match-mode model are extended rather than
  paralleled. The genuinely new pieces are the corpus (walking files, streaming matches, honouring
  ignore rules), the Find in Files panel type, and the replace preview.
- **A Find in Files panel is a workspace Panel**, subject to Constitution XI's docking rules —
  splittable, draggable between split positions and Tabs, and syncable into a sub-workspace. This
  follows from the user's direction that it is a panel type in a Tab rather than a fixture of the
  File Explorer Pane.
- **Results belong to their panel and nothing else.** A closed panel's results are discarded (FR-023)
  and a restored panel's are not brought back (FR-027b), so there is no retention store to size, no
  eviction policy to choose and no retrieval surface to design. Only the term and the scope persist.
  > **Partly superseded (2026-09-09) by FR-078a**: a scan's results MUST now outlive the moment they
  > were streamed, so a second window attaching to the panel after the scan finished can show them.
  > Both sentences about *closing* still hold exactly — a closed panel discards, a restored panel
  > comes back empty. What changes is that "nothing is retained" becomes "retained for as long as the
  > panel lives", which is bounded by the same thing that bounds the panel.
- **Grouping "per folder" means rows grouped by their containing folder**, "per file" by their file,
  and "per file and folder" nests files inside folders. Switching is a presentation change over
  results already found (FR-033), not a re-scan. Which one a search opens in is settled by FR-033a–c;
  what each one *looks like* structurally is this assumption.
  > **Partly superseded (2026-09-09) by FR-073**: the "per folder" definition is withdrawn with the
  > grouping itself. The other two definitions, and switching-is-presentation-not-a-re-scan, stand.
- **A result row can be reached and opened from the keyboard**, not only by double-click: arrow keys
  move through the list and Enter opens the focused row, matching how the file tree and Quick Open
  already behave. FR-037 names double-click because that is what the issue specified; it is not meant
  to make the mouse the only route. Full keyboard-only support across the app is #26 (vNext) and is
  not in scope here.
- **A Find in Files panel is named for what it is showing** — "Find in Files", carrying the search
  term once there is one, so several panels in a tab are told apart by their terms rather than by
  position. It follows whatever panel-naming and rename behaviour the app already provides; this
  feature introduces no naming rules of its own.
  > **Partly superseded (2026-09-09) by FR-060 and FR-061**: the first sentence is now a requirement
  > rather than an assumption, because nothing implemented it. The second sentence is withdrawn —
  > this feature *does* introduce a naming rule of its own: the panel is not renamable, which is a
  > deliberate exception to the app-wide rule that every panel is.
  > **Partly superseded again (2026-09-10) by FR-081**: the literal string quoted here — "Find in
  > Files" — is now one of two. A panel showing its replace row is titled **Find & Replace in
  > Files**, carrying the same term suffix. What the panel is *called as a type* does not move: the
  > Terminology table's **Find in Files panel** is unchanged, and the title is a thing a panel wears,
  > not a second type.
- **"Stays usable" under load (SC-004) is about the interface, not a match ceiling.** No maximum
  number of matches is specified. A term matching hundreds of thousands of times is expected to
  stream and remain scrollable rather than to be truncated at some figure; if planning finds a limit
  is needed, it is a decision to record there.
- **The find bar's existing anchoring, key bindings and theme-token sourcing are unchanged.** #220
  states these as must-nots; they are carried as FR-007, FR-011 and FR-012.
- **`Ctrl+Shift+T` Quick Open (#219) has already shipped.** The maintainer's comment on #153 proposed
  specing #153, #219 and #220 as one cycle; #219 is done, so this cycle is the remaining two.
- **Both issues carry maintainer agreement.** #220 and #153 each have their agreement checkbox ticked.
- **The panel has exactly three text inputs**, and FR-080 reaches all of them and nothing else: the
  search term, the replacement, and the scope. The grouping controls, the match-mode toggles and the
  run/cancel control are not text and take no Clear. If a fourth text input is ever added to this
  panel, FR-080 reaches it by its own wording rather than by an amended count. *(2026-09-10.)*
- **"Find & Replace in Files" is a title, not a second panel type and not a second name in the
  Terminology table.** FR-081 composes it where a panel's name is decided; nothing registers it,
  persists it, or matches on it. *(2026-09-10.)*
- **The size bound FR-083b owes is a planning decision, not one this specification fixes.** What is
  required here is that a bound exists and is stated where the payload is designed; what it is —
  a line count, a byte ceiling, a per-file cap, or truncation with a marker — depends on the shape
  the contract takes and is recorded there. *(2026-09-10. Stated as an assumption rather than left
  silent because "a size bound is owed" without an owner is how a bound comes to be nobody's.)*
- **The shape of FR-082a's per-notice display override belongs to spec 030's notice contract**, not
  to this document. What is required here is that the override exists, that it is optional, and that
  its absence resolves exactly as today. Whether it arrives as two fields, one object or a named
  profile is settled where that contract is written. *(2026-09-10.)*
- **Regular-expression matching is not part of this feature**, confirmed in clarification. #153's
  acceptance criteria say "case / whole-word / regex **as available**", and it is not available — 013
  FR-007 deferred it and the match model carries only case sensitivity and whole word. It is tracked
  as #376 (vNext), spanning both surfaces (FR-040).

## Out of Scope

- Regular-expression matching, on either surface — tracked as #376 (vNext).
- Search across terminal scrollback.
- Search history and saved searches.
- Highlighting other occurrences of the current selection (#324) and unifying the match-highlight
  vocabulary (#325).
  > **Partly superseded (2026-09-09) by FR-067**: one property is taken into scope — that an ordinary
  > match, the current match and the surface behind them MUST be mutually distinguishable, enforced in
  > the theme-quality checks and satisfied by every bundled theme's derivation. #325's wider
  > unification of the vocabulary remains out of scope. #324 is untouched.
- Renaming the "Files & Folders" pane (#331).
- Any change to the Quick Open file-name typeahead (#219, shipped).
- A single undo spanning every file a commit touched (FR-057).
