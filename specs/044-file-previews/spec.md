# Feature Specification: File Previews

**Feature Branch**: `feature/S044-I10-I136-file-previews`

**Created**: 2026-09-11

**Status**: Draft

**Issues**: closes [#10](https://github.com/Bidthedog/throng/issues/10) (file preview abstraction,
with Markdown as the first renderer) and [#136](https://github.com/Bidthedog/throng/issues/136)
(per-editor back/forward file navigation with configurable history — folded in during clarification
on 2026-09-14, so editors and previews share one navigation-history model; see *User Story 7*).
Related, and deliberately out of scope:
[#388](https://github.com/Bidthedog/throng/issues/388) (PDF preview provider — **blocked by this
feature**, and the second provider this design is drawn to admit), and
[#323](https://github.com/Bidthedog/throng/issues/323) (CSV panel — edits, so it is not a preview;
see *Relationship to #323*), [#392](https://github.com/Bidthedog/throng/issues/392) (Mermaid
previews) and [#393](https://github.com/Bidthedog/throng/issues/393) (math in Markdown previews) —
both blocked by this feature — and [#394](https://github.com/Bidthedog/throng/issues/394)
(clickable file links in editors and terminals, which defers to this feature's default open action
and whose default-plus-explicit-alternatives menu pattern FR-035c follows).

**Input**: The maintainer's direction of 2026-09-11, which supersedes the *Proposed outcome* of #10
where the two differ: build the preview as an **abstract base** that every future preview type uses,
with one **provider** per file type handling the display; Markdown ships as the first provider, PDF
(#388) is the next. The maintainer's requirements, verbatim in substance:

- Preview panels are activated from a button in the editor's status bar; from a supported editor
  panel's right-click menu ("Open Preview", greyed out while the preview is open); and from a
  supported file's Files & Folders menu, **Open In → Preview** (greyed out while the preview is
  open). If the file is open in an editor, the preview opens next to it; if not, the preview opens
  alone, with no parent editor.
- They carry their own title context menu: Close Panel, Reveal, Open in OS Explorer, Refresh, Zoom.
  Zoom is independent of the parent.
- They are named `<parent panel's name> - Preview` and cannot be renamed.
- They are read-only.
- They follow the parent editor's buffer live, debounced by 300 ms — not the file on disk, unless no
  parent editor is open, in which case they follow the disk.
- They share the dirty flag with their parent; only an action on the parent clears it.
- Preferences for all of it live under **Editor - Previews**. Each provider can be enabled and
  disabled individually; disabling one removes every preview affordance for its type and closes its
  open previews. A provider can be made the **default open action** for its file type, so a single
  or double click opens the preview.
- The term is **provider**, and adding a new provider must be very easy.

---

## Terminology

These names are used consistently throughout this spec, and nowhere is a second name used for the
same thing.

| Term | Meaning |
|---|---|
| **preview** | A read-only, rendered presentation of one file — what the file *looks like*, as opposed to its source |
| **preview panel** | The panel type this feature introduces. One preview panel shows one file's preview. There is exactly one preview panel type, whatever the file type |
| **preview provider** | The unit that knows how to display one family of file types — which files it accepts, and how it turns their content into what the preview panel shows. Markdown is the first. "Renderer", "adapter", "previewer" and "viewer" are deliberately **not** used for it |
| **source document** | The open editor document for the same file, when one exists — the single document the app holds for that file (Principle XI, *One document, one state*) |
| **parent editor** | The editor panel that holds the source document for the file a preview is currently showing. A preview that has one is **parented**; a preview that has none is **standalone**. Being parented is derived from the file, not a stored link: a preview is bound to a file, never to a panel (FR-013) |
| **text provider** | A provider whose files are text a user can edit in an editor panel (Markdown). Only a text provider's preview can be parented |
| **binary provider** | A provider whose files are not text (PDF, #388). Its previews are always standalone |
| **navigation history** | Per panel, for editor and preview panels only: the ordered list of files that panel has shown, with a **current position**. Back and Forward move the position without changing the list; opening a file into the panel changes the list (#136) |
| **default open action** | Per provider, what opening one of its files by click, Enter or Quick Open does: open an **editor** (the shipped behaviour) or open the **preview** |

## Why this spec exists

**The constitution already requires it.** Principle I says the workspace *"MUST be able to render
previews of supported document files — Markdown (`.md`) preview at minimum — alongside the raw file
view"*. Features 004 and 006 each deferred it. This feature discharges it.

**It is built as a seam, not as a Markdown feature, on purpose.** The maintainer has already filed
the second provider (#388, PDF) and named more (Word, spreadsheets). A Markdown-only preview would
mean re-deciding the panel, its menus, its settings and its persistence for every one of them.
Principle VIII's YAGNI clause asks that an abstraction with one implementation justify itself; this
one is justified by a concrete, filed second consumer with **different** needs — a binary file that
has no editor at all — which is exactly the shape that proves whether the seam is drawn in the right
place (see *Complexity justification*).

## Findings that shaped this spec

All of them came from the repository's rule that a requirement changing existing behaviour must
first find the requirement that already governs it.

### Finding 1 — "cannot be renamed" contradicts the app-wide rename rule, and 043 already set the precedent for the exception

**002 FR-037** requires every panel to be renamable from its header's context menu, and **002
FR-041** by double-clicking its header. A preview panel that cannot be renamed contradicts both.

**043 FR-061** made the same exception for the Find in Files panel, in the same terms: *"A Find in
Files panel MUST NOT be renamable. Rename and Reset Name MUST be absent from its menu"*, justified by
its title being derived from what it is (043 FR-060). This spec extends that exception to the preview
panel on the same ground (FR-030) — it is a stated exception to 002 FR-037/FR-041, not a silent
contradiction.

### Finding 2 — "Close Panel" is the correct verb here, not a new one

**011 FR-030** fixes four removal verbs. **Close** is *"dismiss a view of something; the thing itself
survives"*; **Destroy** is *"irreversibly remove a thing together with everything it owns"*. An
editor panel is **destroyed** because it owns the buffer, including any unsaved edits. A preview
panel owns nothing: the file survives, and so does the source document and every unsaved edit in it.
Removing a preview is dismissing a view, which is exactly 011's definition of **Close**. So "Close
Panel" on a preview conforms to 011 FR-030/FR-031 rather than superseding them (FR-033).

### Finding 3 — the maintainer's title-menu list is a floor, not the whole menu

Three shipped rules require items on **every** panel's header menu, and the maintainer's list names
none of them: **006 FR-031** (Send to Tab ▸ New Tab), **006 FR-033** (the Sync to ▸ sub-workspace
cascade), and **030 FR-042c** (Try again / Copy details / Clear panel type while the failure banner
is up). Omitting them would contradict three requirements to satisfy a list that was never written
as exhaustive. The preview panel's menu carries them as well (FR-033). A fourth, Open in Editor /
Go to Editor, was added by the maintainer during clarification (FR-015).

### Finding 4 — a per-type default open action changes where six requirements route an open

**006 FR-011, FR-012 and FR-013** route a file opened from Files & Folders — by click, by Enter, or
from Open In — to an editor; **023 FR-025/FR-026** add the "Open files in" target; **033 FR-009**
has Quick Open honour it; **043 FR-037** has a Find in Files result honour it, and **043 FR-087c**
requires that result to reveal the match.

A default open action of **Preview** is a **refinement** of 006 FR-011/FR-012/FR-013 and 033 FR-009:
for a file whose provider is set to Preview, a click, Enter or a Quick Open pick opens the preview
instead (FR-052). It is stated as a refinement here and marked on none of those requirements,
because with every provider at its shipped default (Editor) nothing they describe changes.

**043 FR-037 and FR-087c are untouched**: a Find in Files result always opens an editor, whatever
the default open action, because a preview cannot reveal a match at a line and column (FR-054).
**Open In's editor targets are untouched too**: choosing "New Editor" is an explicit request for an
editor and gets one.

The click gesture itself stays governed by `editor.openOnClick` ("Open files with", **019 FR-024**,
File Explorer group). This feature adds no second click setting, and the retired
`explorer.openMode` (**019 FR-023**) stays retired.

### Finding 5 — reading a file today opens it as an editor document

The only way the app reads a file's text today registers that file as an open editor document —
which is what makes a second open of the same file focus the first editor. A standalone preview that
read through that path would *become* a hidden editor document: it would make the file look open in
Files & Folders, and would change what a later "open in editor" does. A standalone preview therefore
needs a read that is **not** an editor open (FR-025). This is recorded because it is the easiest
mistake in the feature to make and the hardest to see: every test that opens a preview would pass.

### Finding 6 — the 300 ms debounce is a configuration value

Principle X lists timeouts among the values that are configuration, and **043 FR-059** made its own
500 ms settle time a preference on that ground. The preview update delay is a setting, shipping at
300 ms (FR-060).

### Finding 7 — "Editor - Previews" follows the grouping the editor already uses

Two grouping conventions ship side by side (**040 FR-037a**; #319 asks for one). The editor's own
settings use a group with sub-groups — **040 FR-035–FR-037** put the status-bar settings under
**Editor → Status Bar**. The preview settings go under the same group as the sub-group **Previews**
(FR-061), which is what the maintainer's "Editor - Previews" names.

### Finding 8 — closing previews in bulk must not empty a tab

Disabling a provider closes every open preview of its type (FR-063). **002 FR-016** requires the
active project's workspace to always keep at least one tab containing at least one panel. Closing
previews in bulk goes through the same rule that closing any last panel does, so it cannot leave a
tab empty (FR-064).

## Relationship to #323 (CSV panel)

#323 asks whether the preview seam should admit an **editable** renderer. **It does not.** A preview
is read-only by definition (FR-020) and its dirty state is borrowed, never its own (FR-040–FR-043).
A CSV grid that edits owns a buffer, which is an editor's job. Nothing here prevents a later CSV
*preview* provider (a read-only grid), and nothing here decides #323's editable grid — that remains
#323's research question, now with one answer ruled out.

## Clarifications

**Each session below is a dated historical record of what was asked and answered on that day, and is
deliberately NOT amended in place.** A later session, and the requirements themselves, supersede an
earlier session's answer; where that has happened the requirement carries the supersession marker and
is authoritative. **Read the requirements for what is true, and read these for how it was arrived
at.**

### Session 2026-09-11

- Q: The maintainer's requirement breaks off at "If the file is …". Is a preview's link to its
  parent editor fixed at opening, or live? → A: **Live.** A standalone preview becomes parented when
  its file is opened in an editor, and a parented preview becomes standalone, following the disk,
  when its parent editor is destroyed. (FR-013, FR-013a, FR-013b)
- Q: What does the editor status-bar preview button do while that file's preview is already open? →
  A: **Shows pressed, and focuses the open preview.** It never closes it; closing stays on the
  preview's own menu. (FR-014)
- Q: Should a Markdown preview load remote `https:` images, such as README badges? → A: **Yes, behind
  a preferences setting that ships ON.** Every other remote resource stays blocked. (FR-092, FR-093,
  FR-061)

### Session 2026-09-14

- Q: A preview opens "next to the parent editor, in the window where the request was made" — but
  the editor may sit in a different tab, or in a sub-workspace window. Where does it go? → A:
  **Beside the editor, always.** The parent editor's slot is split wherever it lives; its tab is
  brought to the front, and its window focused if it is a different one. (FR-010)
- Q: A standalone preview has no editor, so with Preview as the default open action the only route to
  editing is Files & Folders → Open In. Should the preview panel offer a way to its source? → A:
  **Yes — an Open in Editor item on every preview, placed exactly where Open Preview sits on an
  editor.** On a standalone preview it opens the file in an editor beside the preview, which adopts
  it as parent; on a parented preview it reads Go to Editor and focuses the parent. (FR-015, FR-033,
  FR-035)
- Q: How are links inside a preview followed? Terminal links need Ctrl+click (024 US7). → A:
  **Ctrl+click, for every link** — web, project file and heading alike. A plain click follows
  nothing. (FR-090, FR-091, FR-094)
- Q: What does the Markdown provider do with YAML front matter, Mermaid diagrams and math? → A:
  **Front matter only** — shown as a key/value table. Mermaid and math are not rendered in this
  feature, and each gets its own vNext issue — Mermaid is #392 (already filed), math is #393.
  (FR-085, FR-086, Out of Scope)
- Q: Links follow only on Ctrl+click. How does the keyboard reach and follow them? → A: **Tab and
  Shift+Tab move focus between links; Ctrl+Enter follows the focused link; the menu key opens Open
  Link / Copy Link Address for it.** (FR-096)
- Q: A pure debounce means someone typing steadily sees no preview update until they pause. Should
  there be a ceiling? → A: **Yes — a maximum wait, as its own setting, shipping at 1 second.** The
  300 ms debounce stays. (FR-022, FR-060a)
- Q: Following a link to another file — what about a `#heading` on the link, and a target that does
  not exist? → A: **The heading is honoured, and a missing file or heading shows one inline notice —
  but the linked file opens in place, in the same preview, never in a new one.** So the preview stops
  following the editor it was beside. And if nothing else needs a preview tied to an editor panel,
  it should not be tied from the start. Checked: nothing does. Following the buffer, the unsaved
  marker, the title and Go to Editor all resolve through the file's single document, and a panel
  matters only for placement when the preview opens — so a preview is bound to its file, never to a
  panel. (FR-013, FR-066, FR-090a–f)
- Q: In-place navigation strands the reader. Should a preview keep Back/Forward history? → A: **Yes,
  in this feature — and #136 (per-editor back/forward) is folded in, so editors and previews share
  one approach.** Back and Forward buttons sit at the **top left of the panel title bar**, active only
  when that panel has history in that direction. History **persists across restarts**, superseding
  #136's working assumption of in-session history, and is **purged when the panel no longer
  exists**. "Active" is read as enabled rather than shown: both buttons are always drawn on editor and
  preview panels, and disabled at the ends of the history. (User Story 7, FR-100–FR-112)
- Q: What does Copy in a preview put on the clipboard? → A: **Rich text (plain text plus sanitised
  HTML) by default, with a preferences setting to make Plain text the default instead, and
  right-click items to pick either format there and then — the #394 pattern.** (FR-035a–c, FR-061)

### Session 2026-09-15

Change requests from the maintainer's hands-on testing of the delivered build (`speckit-iterate`).

- Q: Should a parented preview's scroll follow its editor's? → A: **Yes — a preferences setting,
  *Synchronise preview and editor scrolling*, shipping ON: scrolling the editor scrolls the preview to
  the same place in the document.** It is one-way, editor → preview; scrolling the preview does not
  move the editor *(direction derived from the request's wording, "when the editor is scrolled, the
  preview scrolls with it"; not confirmed)*. It supersedes this spec's Out of Scope line
  "scroll-sync between source and preview". A standalone preview has no editor and is unaffected; a
  binary provider has no source lines and is unaffected *(derived; not confirmed)*. (FR-113, FR-114)
- Q: The reader follows a same-document heading link (a table of contents) and wants to return. With
  file-level history (FR-101) Back stays disabled. Should a preview offer a way back? → A: **Yes — a
  followed same-document heading link records a history entry in a preview**, so Back returns to where
  the reader was and Forward to the heading, as a browser treats a `#fragment` link — **and once Back
  has stepped back through the in-document jumps, the next Back goes to the previous document, if
  there is one.** The jumps and the documents are one Back/Forward sequence, not two. Editors are
  unchanged: history there stays file-level. (FR-115, refines FR-101)
- Q: What does **Copy Link Address** copy for a link to a heading or a project file? → A: **The file
  too, never a bare `#fragment`: the linked file's absolute path, followed by `#heading` when the link
  names one** — for a same-document heading link, the preview's own file *(absolute path, matching what
  a file link already copies, derived; not confirmed)*. (FR-116, refines FR-095)
- Q: Should front matter display be optional? → A: **Yes — a Markdown provider setting, *Show front
  matter*, shipping ON.** Off hides the block entirely; it is never rendered as Markdown *(hiding, not
  rendering as Markdown, derived from FR-085's reason for the table: front matter read as Markdown
  becomes a rule and stray text; not confirmed)*. (FR-117, refines FR-085)
- Q: How does the reader see a link's full target before following it? → A: **Hovering a link — or
  focusing it with the keyboard — shows its full target at the left of the preview's status bar**,
  cleared when the pointer or focus leaves *(keyboard focus derived from FR-096 parity; not
  confirmed)*. The tooltip stays. This supersedes FR-015a's "it carries no readouts" for this one
  readout. (FR-118)
- Q: Ctrl+click on a web link opens the browser, which then disappears behind throng. What should
  happen? → A: **The browser ends in front.** After following a web or `mailto:` link, throng MUST NOT
  take the foreground back. (FR-119, refines FR-091)
- Q: Should hovering an image show where it comes from? → A: **Yes — an image's tooltip shows its
  source as written in the Markdown**, with the document's own image title after it when there is one;
  an image whose source was blocked or failed to load shows the same tooltip on its alternative text.
  An image **inside a followable link** keeps no tooltip of its own, so the link's target is what the
  pointer shows there (security review I3); the status bar readout (FR-118) names the link *(the link
  case, and showing the source as written rather than the internal `throng-preview:` address, derived
  from the I3 security ruling and FR-094; not confirmed)*. (FR-120)

### Session 2026-09-16

Second round of change requests from the maintainer's hands-on testing (`speckit-iterate`).

- Q: Is scroll synchronisation one-way, editor → preview, as the 2026-09-15 session derived? → A:
  **No — two-way.** *"Did I not say I wanted the editor and preview to be synchronised when scrolling -
  two way?"* Scrolling the preview scrolls the editor, as scrolling the editor scrolls the preview. This
  reverses that session's derived one-way reading. (FR-121, partly supersedes FR-113)
- Q: Which editor does a scrolled preview move? → A: **Its parent editor (FR-013), and only its view in
  the same window as the preview's view** — the reading already recorded under FR-113, applied to the
  other direction *(derived from FR-013 and the 2026-09-15 planning note under FR-113; not confirmed)*.
  (FR-121a)
- Q: Does a standalone preview, or a preview that followed a link to another file, drive any editor? →
  A: **A standalone preview drives nothing. A preview that followed a link is bound to the new file
  (FR-090a): it never drives the editor it was beside, and drives the new file's editor only if that
  file is open in one** — the same rule FR-113 already applies in the editor → preview direction
  *(derived from FR-013 and FR-090a; not confirmed)*. (FR-121a)
- Q: What does "the same place" mean going from the preview to the editor? → A: **The editor scrolls
  so the source line of the block at the top of the preview's viewport is the editor's top visible
  line** — the mirror of FR-113's mapping, at the same block granularity. The editor's caret, selection
  and focus do not change *(mapping derived from FR-113's; caret and focus derived from a scroll being
  view state only, since moving either would change where the user's next keystroke lands; not
  confirmed)*. (FR-121b)
- Q: How is an endless back-and-forth avoided? → A: **A scroll the synchronisation itself caused never
  drives the other side.** *(derived; not confirmed)* (FR-121c)
- Q: What happens when one side cannot reach the place the other asks for (the end of the document)?
  → A: **It goes as far as it can, and the side that asked is not pulled back to match** *(derived from
  FR-121c; not confirmed)*. (FR-121b)
- Q: Which preview scrolls drive the editor? → A: **Only scrolls the reader caused** — wheel,
  scrollbar, keyboard (FR-096a), a followed same-document heading link (FR-090f) and a Back or Forward
  that stays in the same file (FR-107, FR-115). **Not** a scroll the app made on its own: a live update
  keeping the reader's place (FR-024), the position restored when a preview opens, restores after a
  restart, or steps to a different file, and a sync from the editor *(derived from FR-024, FR-107 and
  FR-115; not confirmed)*. (FR-121d)
- Q: Can the synchronisation be switched from somewhere other than Preferences? → A: **Yes.** *"We
  should also be able to turn the global synchronisation setting on and off with the right click menu
  on both the editor and the preview, and also via a button on the statusbar - to the left of the
  preview / editor buttons. This button will also change the global setting, and will affect all
  editors and markdown previews."* Every surface flips the one setting (FR-114); none holds a per-panel
  or per-document state of its own. (FR-122, refines FR-114)
- Q: Which editors and previews show the toggle? → A: **Exactly those that show the preview button or
  the editor route**: an editor whose file has a text provider (FR-001) and every text-provider preview,
  parented or standalone. A binary preview and an editor whose file has no provider show none *(derived
  from Principle VI, "absent when meaningless", and FR-001/FR-015e; not confirmed)*. It is **enabled
  even while that file's provider is disabled**, because the setting governs every text provider and no
  one provider's switch draws it disabled *(derived from the shipped setting, which Preferences
  deliberately never draws disabled for a switched-off provider; not confirmed)*. (FR-122a)
- Q: Where do the menu items go, and what are they called? → A: **Synchronise Scrolling**, a checkable
  item in the **View & state** section of the editor's **body** menu and the preview's **body** menu,
  checked while the setting is on — the Word Wrap item's pattern (024 US1). Not in the header menus: the
  toggle acts on content scrolling, so Principle VI places it in the content menu *(label, section and
  body-only placement derived; not confirmed)*. (FR-122b)
- Q: What does the status-bar button look like? → A: **A themeable icon toggle, token `syncScroll`,
  immediately left of the preview button (editor) and of the Open in Editor / Go to Editor button
  (preview), shown pressed while the setting is on, never hidden by width** *(token name, and the
  never-hidden rule carried over from 040 FR-024 for the controls beside it, derived; not confirmed)*.
  (FR-122c)
- Q: Does toggling get a command and a default chord? → A: **A rebindable command,
  `preview.toggleSyncScroll`, live in editor and preview panels, shipping with no chord** — the
  `preview.open` precedent (FR-005): every entry point is a button or a menu item and no chord was asked
  for *(derived; not confirmed)*. (FR-122d)
- Q: Does the toggle persist, unlike the Word Wrap toggle? → A: **Yes — it writes the setting.** The
  maintainer asked for the global setting, so it is persisted and survives a restart, unlike 024's
  per-document, in-memory wrap override. It writes that one key only (032 FR-001), and a failed write
  leaves every surface showing the stored value and is reported as any other settings write failure is
  (032) *(the write and failure rules derived; not confirmed)*. (FR-122e)
- Q: Does anything else change with the toggle? → A: **An open Preferences window shows the new value
  at once, and the setting's description says the synchronisation is two-way and names the menu item
  and button that also switch it** *(derived from Principle X and the configuration-editor completeness
  gate; not confirmed)*. (FR-122e, FR-122f)
- Q: Is the browser still hidden behind throng after following a web link (FR-119)? → A: **No.** *"The
  browser is being activated properly now."* The maintainer's hands-on check on 2026-09-16 confirms
  FR-119 and research R27's H-b remedy. (FR-119)
- Q: With scroll sync on, Back or Forward lands a parented preview on an entry the reader left at the
  **very top** of its document. Which wins — the saved top, or the editor's position (T222)? → A: **The
  editor's position.** The preview lands on the parent editor's current top line, not at the top. This
  refines FR-107 for that one case only: every other saved place still wins. (FR-121e, refines FR-107)
- Q: Should Synchronise Scrolling also be in the panel header menus? → A: **Yes — header menus too.**
  It appears in each editor and preview panel's header menu as well as in both body menus and on the
  status bar. This reverses the earlier derived answer in this session that placed it in the body menus
  only. (FR-122b)
- Q: Do only the scrolls a reader causes synchronise, as derived earlier in this session? → A: **No —
  every scroll, whatever caused it.** *"When sync is enabled, the preview and editor panels should be
  synchronised in every situation. If the editor is scrolled by any means, the preview follows. If the
  preview is scrolled for any reason, the editor follows."* This reverses this session's derived answer
  "Which preview scrolls drive the editor? → Only scrolls the reader caused": a live update keeping the
  reader's place, placing a preview as it opens or restores, and restoring a saved place on a Back or
  Forward to another file all drive the editor too; and caret moves, find, go-to-line and any reveal the
  application makes drive the preview. The earlier no-echo answer stands only as a loop guard. (FR-121f,
  FR-121g; supersedes FR-121d)
- Q: When a preview first opens, or restores after a restart, beside its editor, which side decides
  where the pair starts? → A: **The editor's line.** The preview starts there, so opening or restoring a
  preview never scrolls the editor; from then on both directions apply *(resolution set at the
  2026-09-16 checkpoint; not confirmed by the user in these words)*. (FR-121h)
- Q: And when the pair forms the other way round — a standalone preview adopts an editor that opens
  beside or after it (Open in Editor, FR-013a)? → A: **The side already on screen decides: the new editor
  scrolls to the preview's place**, so adopting an editor never moves the preview the reader was
  already reading *(derived from FR-121h's principle that forming a pair never moves the side the user
  is looking at; not confirmed)*. (FR-121h)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preview the Markdown file I am writing, beside its source (Priority: P1)

A user is writing a README in an editor panel. They open its preview from the editor and it appears
next to the editor, rendered. As they type, the preview catches up a moment later without them
saving. When they have unsaved edits, the preview shows the unsaved marker too; when they save, it
clears on both.

**Why this priority**: This is the loop #10 exists to close — "edit here, look at it somewhere
else". Every other story builds on a preview panel that exists and follows its source.

**Independent Test**: Open a `.md` file in an editor, open its preview from the editor's status bar,
type a heading, and see it rendered in the preview without saving.

**Acceptance Scenarios**:

1. **Given** a `.md` file open in an editor panel, **When** the user clicks the status bar's preview
   button, **Then** a preview panel titled `<editor's name> - Preview` opens next to the editor
   showing the rendered document. *(FR-001, FR-010, FR-031)*
2. **Given** the same, **When** the user chooses **Open Preview** from the editor's right-click menu,
   **Then** the same happens. *(FR-002)*
3. **Given** an open preview, **When** the user types into the parent editor and pauses, **Then**
   the preview reflects the change within the update delay, without a save; **When** the user types
   continuously without pausing, **Then** the preview still updates at least once a second.
   *(FR-022, FR-060, FR-060a)*
4. **Given** an open preview, **When** the parent editor becomes dirty, **Then** the preview shows
   the unsaved marker; **When** the user saves in the parent editor, **Then** the marker clears on
   both. *(FR-040, FR-041)*
5. **Given** a preview open for a file, **When** the user opens the editor's right-click menu,
   **Then** Open Preview is shown disabled. *(FR-012)*
6. **Given** a long preview scrolled halfway down, **When** the source changes, **Then** the preview
   stays at the same place in the document rather than jumping to the top. *(FR-024)*
7. **Given** a preview open for a file, **When** the user clicks that file's editor status-bar
   preview button, **Then** the button shows pressed and the open preview is focused; no second
   preview opens and the preview does not close. *(FR-014)*
8. **Given** a long `.md` file open in an editor beside its preview, with synchronised scrolling at its
   default, **When** the user scrolls the editor to a heading halfway down, **Then** the preview shows
   that heading at its top; **When** they scroll the preview, **Then** the editor does not move; **When**
   they turn the setting off and scroll the editor, **Then** the preview stays put. *(FR-113, FR-114)*
   *Partly superseded by scenario 9 (Session 2026-09-16) — scrolling the preview now moves the editor
   (FR-121); the rest of this scenario stands.*
9. **Given** the same editor and preview, with synchronised scrolling on, **When** the user scrolls the
   preview until a heading two-thirds down is at its top, **Then** the editor scrolls so that heading's
   source line is its top visible line, and its caret, selection and focus are unchanged; **When** they
   then scroll the editor, **Then** the preview follows again. **When** they turn the setting off and
   scroll the preview, **Then** the editor stays put. *(FR-121, FR-121b)*
10. **Given** the same pair, synchronised, with the preview scrolled by hand, **When** the user types in
   the editor without the editor scrolling, **Then** the preview updates in place and the editor does
   not move; **When** the user Ctrl+clicks a contents link in the preview, **Then** the preview jumps to
   the heading and the editor follows; **When** they click Back, **Then** the preview returns and the
   editor follows it. No scroll is ever bounced back to the side that started it. *(FR-121c, FR-121d)*
   *Superseded by scenario 15 (Session 2026-09-16) — its first clause relied on a hand-scrolled preview
   staying apart from the editor, which FR-121f no longer allows; the heading-link and Back clauses
   still hold.*
11. **Given** a synchronised preview beside `README.md`'s editor, **When** the user Ctrl+clicks a link
   to `setup.md`, which is not open in any editor, and scrolls the preview, **Then** README's editor does
   not move; **Given** a standalone preview, **When** it is scrolled, **Then** no editor moves.
   *(FR-121a)*
12. **Given** two editors on `.md` files, each with its preview beside it, and synchronised scrolling
   on, **When** the user unchecks **Synchronise Scrolling** in the first editor's body menu, **Then**
   neither pair synchronises any more, the setting reads off in Preferences, every editor's and
   preview's scroll-sync status-bar button shows unpressed, and the item is unchecked in every editor's
   and preview's body menu; **When** the user then clicks the scroll-sync button in the second
   preview's status bar, **Then** all of that is reversed; the same holds for the item in a preview's
   body menu and the button in an editor's status bar. After a restart the setting keeps its last
   value. *(FR-122, FR-122b, FR-122c, FR-122e)*
   *Extended 2026-09-16 (header menus too): the same holds for **Synchronise Scrolling** in each editor's
   and preview's **header** menu — choosing it there flips the setting, and it is checked or unchecked
   there in step with every other surface.*
13. **Given** a key binding assigned to **Synchronise Scrolling** in the key binder, **When** the user
   presses it in an editor or a preview, **Then** the setting flips exactly as the menu item does, and
   the chord is shown beside the menu item and in the button's tooltip; with no binding (the shipped
   state), neither shows a chord. *(FR-122d)*
   *Extended 2026-09-16 (header menus too): the chord is shown beside the header menu item as well.*
14. **Given** a synchronised preview beside `README.md`'s editor, with the editor scrolled to line 200,
   the preview scrolled back by hand to the very top, and then a link followed to a file with no editor
   open, **When** the user presses Back, **Then** the preview shows `README.md` at line 200 — the
   editor's top line — not at the top, and the editor does not move; **Given** the same with the preview
   left halfway down instead, **Then** Back restores that place. With the setting off, Back returns to
   the top. *(FR-121e, FR-107)*
   *Extended 2026-09-16 (every scroll synchronises): in the halfway case, the preview restores its place
   and then README's editor follows it to that place. (FR-121f)*
15. **Given** a long `.md` file in an editor beside its preview, synchronised, **When** the user scrolls
   the preview by hand, **Then** the editor follows; **When** they type in the editor and the live update
   keeps the preview's place, **Then** neither side jumps and the two stay aligned; **When** they press
   Go to Line, run find to a match further down, or move the caret past the bottom of the viewport,
   **Then** the preview follows each time; **When** they Ctrl+click a contents link or press Back or
   Forward in the preview, **Then** the editor follows each time. Neither side ever oscillates, and a
   side already at the target does not move. *(FR-121f, FR-121g)*
16. **Given** `README.md` in an editor scrolled to line 300, **When** the user opens its preview,
   **Then** the preview opens at line 300 and the editor does not move; **Given** that pair restored
   after a restart, **Then** the preview again starts at the editor's line. **Given** a standalone
   preview of `guide.md` scrolled halfway, **When** the user chooses **Open in Editor**, **Then** the new
   editor opens at the preview's place and the preview does not move. **Given** a synchronised preview
   that followed a link to `setup.md`, which is open in an editor in the same window, and scrolled
   halfway, **When** the user steps Back to README and Forward again, **Then** the preview restores
   `setup.md` halfway and `setup.md`'s editor follows it there. *(FR-121h, FR-121f, FR-107)*

---

### User Story 2 - Preview a file without opening it for editing (Priority: P1)

A user wants to read a project's documentation, not edit it. From Files & Folders they choose
**Open In → Preview** on a `.md` file that is not open anywhere, and a preview opens on its own. If
the file changes on disk — a `git pull`, an agent rewriting it — the preview updates.

**Why this priority**: Reading is at least as common as writing, and it is the only way a binary
provider (#388) will ever be used. It is also where Finding 5's trap sits.

**Independent Test**: With no editor open, choose Open In → Preview on a `.md` file; see it rendered;
change the file on disk; see the preview update; confirm Files & Folders does not show the file as
open in an editor.

**Acceptance Scenarios**:

1. **Given** a `.md` file not open in any editor, **When** the user chooses **Open In → Preview** in
   Files & Folders, **Then** a standalone preview panel opens showing the rendered file, and no
   editor panel is created. *(FR-003, FR-011)*
2. **Given** a standalone preview, **When** the file changes on disk, **Then** the preview updates.
   *(FR-023)*
3. **Given** a standalone preview, **When** the user then opens the same file in an editor from
   Files & Folders, **Then** a single editor opens — the preview did not make the file count as
   already open — and the preview, where it stands, becomes parented to that editor and takes its
   name. *(FR-025, FR-013a)*
4. **Given** a `.md` file already open in an editor, **When** the user chooses **Open In → Preview**,
   **Then** the preview opens next to that editor, parented to it. *(FR-003, FR-010)*
5. **Given** a preview already open for a file, **When** the user opens that file's Files & Folders
   menu, **Then** Open In → Preview is shown disabled. *(FR-012)*
6. **Given** a standalone preview, **When** the file is deleted on disk, **Then** the preview shows
   a single inline notice saying the file no longer exists, and nothing else. *(FR-026)*

---

### User Story 3 - A preview panel behaves like a panel, but reads like a view (Priority: P2)

A user right-clicks a preview's title and gets the actions that make sense for a view of a file:
close it, find the file in the tree, show it in the OS file manager, refresh it, zoom it. They cannot
rename it or type into it. Zooming the preview does not zoom its editor.

**Why this priority**: These make the panel usable and consistent, but a preview that only opens and
follows its source already delivers the core value.

**Independent Test**: Right-click a preview's title; confirm the menu; zoom in; confirm the parent
editor's zoom did not change; try to rename and type — both inert.

**Acceptance Scenarios**:

1. **Given** a preview panel, **When** the user right-clicks its title, **Then** the menu offers
   Close Panel, Reveal File in Files & Folders, Open in OS Explorer, Open in Editor or Go to Editor,
   Back and Forward, Refresh and Zoom ▸, alongside
   the items every panel carries — and offers no Rename, Reset Name, Save, Revert or Find.
   *(FR-030, FR-033, FR-111)*
   > **Amended 2026-09-14 (analysis)**: Back and Forward added to the list. FR-033 and FR-111 already
   > required them on this menu (User Story 7 folded them in); the scenario predated that and read as
   > the complete list.
2. **Given** a parented preview, **When** the user zooms it in, **Then** the preview's content
   scales and the parent editor's does not. *(FR-034)*
3. **Given** a preview, **When** the user double-clicks its title or presses the rename chord,
   **Then** nothing happens. *(FR-030)*
4. **Given** a preview with focus, **When** the user types, pastes or presses the save chord,
   **Then** nothing in the file or the source document changes. *(FR-020, FR-021)*
5. **Given** a parented preview, **When** the user renames the parent editor, **Then** the preview's
   title follows it. *(FR-031)*
6. **Given** a dirty parented preview, **When** the user closes the preview, **Then** it closes with
   no prompt, and the parent editor keeps its unsaved edits. *(FR-042)*
7. **Given** a dirty parented preview, **When** the user destroys the parent editor and discards its
   edits, **Then** the preview stays open, shows the file as it is on disk, loses the unsaved marker,
   and is retitled in the standalone form. *(FR-013b)*
8. **Given** a standalone Markdown preview, **When** the user clicks its status bar's **Open in
   Editor** button, or chooses Open in Editor from its body or header menu, **Then** an editor for
   the file opens to the left of the preview and the preview becomes parented to it; **When** the
   user then clicks the same button, now **Go to Editor** and shown pressed, **Then** the editor is
   focused. *(FR-015)*
9. **Given** a selection spanning a heading and a list in a preview, with the copy format at its
   default, **When** the user presses the copy chord and pastes into a rich-text target and into an
   editor, **Then** the first keeps the heading and list and the second receives plain text; **When**
   they choose **Copy as Plain Text** from the body menu, **Then** only plain text is on the
   clipboard. *(FR-035a–c)*
10. **Given** a preview with its status bar shown, **When** the user hovers a link to
   `https://example.com/docs`, **Then** the left of the status bar reads that address; **When** the
   pointer leaves the link, **Then** it clears; **When** they Tab to a link, **Then** its target shows
   there too. *(FR-118)*
11. **Given** a standalone Markdown preview with its status bar shown, **When** the user looks at its
   controls, **Then** the scroll-sync button sits immediately left of Open in Editor and shows the
   setting's state, and its body menu offers a checkable **Synchronise Scrolling** in View & state.
   **Given** the Markdown provider switched off, **Then** an editor on a `.md` file still shows its
   scroll-sync button and item, both enabled, the button left of the disabled preview button; **Given**
   an editor on a `.ts` file, **Then** it shows neither. **Given** the status bar hidden, **Then** the
   menu item remains. *(FR-015a, FR-122a–c)*

---

### User Story 4 - Choose which file types preview, and how they open (Priority: P2)

Under **Editor → Previews** a user turns the Markdown provider off: every Markdown preview
affordance disappears and any open Markdown previews close. Another user sets Markdown's default
open action to **Preview**, and from then on clicking a `.md` file in Files & Folders opens its
preview.

**Why this priority**: Users who never want previews must be able to remove them entirely, and
users who mostly read documentation want one click to read it. Both depend on Stories 1 and 2.

**Independent Test**: Toggle the Markdown provider off and on, and switch its default open action,
checking the affordances and the click behaviour after each change.

**Acceptance Scenarios**:

1. **Given** open Markdown previews, **When** the user disables the Markdown provider, **Then**
   every open Markdown preview closes, and every Markdown preview affordance on the status bar, the
   editor menus and Files & Folders is shown disabled. *(FR-062, FR-063)*
2. **Given** Markdown's default open action is **Preview** and `editor.openOnClick` is `single`,
   **When** the user clicks a `.md` file that is not open anywhere, **Then** a standalone preview
   opens and no editor opens. *(FR-052)*
3. **Given** the same, **When** the user clicks a `.md` file that is already open in an editor,
   **Then** its preview opens next to that editor, or is focused if it is already open. *(FR-053)*
4. **Given** the same, **When** the user opens a `.md` result from Find in Files, **Then** an editor
   opens and reveals the match. *(FR-054)*
5. **Given** the same, **When** the user chooses Open In → New Editor, **Then** an editor opens.
   *(FR-055)*

---

### User Story 5 - A new preview type is one provider, not a feature (Priority: P3)

A contributor adding the PDF provider (#388) writes one provider and registers it. The preview
panel, its title menu, the status-bar button, the editor menus, Files & Folders, the preferences
page and layout persistence all pick it up without being edited.

**Why this priority**: It is the maintainer's stated design goal and the thing that makes #388 cheap,
but it is invisible to a user of this release.

**Independent Test**: Register a test-only provider for an unused extension in a test; confirm every
surface offers it and its settings appear, with no change outside the provider and its registration.

**Acceptance Scenarios**:

1. **Given** a test provider registered for a file type, **When** the app runs, **Then** its files
   offer Open In → Preview, its settings appear under Editor → Previews, and its previews persist
   with the layout. *(FR-070, FR-071)*
2. **Given** a binary test provider, **When** its file is previewed, **Then** the preview is
   standalone, and no status-bar or editor-menu affordance is offered for it (its files never open
   in an editor). *(FR-073)*

---

### User Story 6 - Markdown looks right, and is safe (Priority: P1)

A user previews a README containing headings, a table, a task list, fenced code, links, images and
a little inline HTML. It renders legibly in their theme, light or dark. A malicious `.md` with a
script tag or a `javascript:` link does nothing.

**Why this priority**: A preview that renders untrusted content inside the app's own window is a
security surface first and a convenience second.

**Independent Test**: Preview a fixture exercising every construct in FR-080 in two contrasting
themes; preview a hostile fixture and confirm nothing executes.

**Acceptance Scenarios**:

1. **Given** a `.md` using every construct in FR-080 and starting with a YAML front matter block,
   **When** previewed, **Then** each construct renders and the front matter shows as a key/value
   table; a `mermaid` fence shows as code. *(FR-080, FR-085, FR-086)*
2. **Given** any shipped theme, **When** a preview is shown, **Then** its text, links, code and
   tables use the theme's colours and are legible. *(FR-083)*
3. **Given** a `.md` containing a script element, event-handler attributes, an iframe, a remote
   stylesheet or a `javascript:` link, **When** previewed, **Then** nothing executes and none of
   them makes a network request. *(FR-081, FR-082, FR-093)*
4. **Given** a README with an `https:` badge image, **When** previewed with Load remote images on,
   **Then** the badge shows; **When** the setting is off, **Then** its alternative text shows and no
   request is made for it. *(FR-092)*
5. **Given** a preview of `README.md` beside its editor, and a link to `docs/setup.md#install`,
   **When** the link is Ctrl+clicked, **Then** the same preview panel now shows `setup.md` scrolled
   to its Install heading, its title is `setup - Preview`, and it no longer shows README's unsaved
   marker. *(FR-090a, FR-090b, FR-094)*
6. **Given** a link to a file that does not exist, **When** Ctrl+clicked, **Then** the preview stays
   on its current file, shows one inline notice naming the target, and no file is created.
   *(FR-090e)*
7. **Given** a link to a `.ts` file in the project, **When** Ctrl+clicked, **Then** the file opens in
   an editor as if opened from Files & Folders. *(FR-090d)*
8. **Given** an `https:` link, **When** Ctrl+clicked, **Then** it opens in the OS default browser;
   **When** plain-clicked, **Then** nothing opens, and hovering it shows its target and that
   Ctrl+click follows it. *(FR-091, FR-094)*
9. **Given** an `https:` link, **When** the user right-clicks it with no text selected, **Then** the
   menu offers Open Link and Copy Link Address. *(FR-095)*
10. **Given** a focused preview with three links, **When** the user presses Tab twice, **Then** the
   second link shows a focus indicator; **When** they press Enter, **Then** nothing opens; **When**
   they press Ctrl+Enter, **Then** that link is followed. *(FR-096)*
11. **Given** an `https:` link, **When** the user Ctrl+clicks it, **Then** the browser opens and stays
   in front of throng. *(FR-119)*
   *Confirmed by the maintainer's hands-on check, 2026-09-16 (Session 2026-09-16).*
12. **Given** a heading link `[Install](#install)` and a file link `[Setup](docs/setup.md#install)`,
   **When** the user chooses Copy Link Address on each, **Then** the clipboard holds the preview's own
   file path followed by `#install`, and `…/docs/setup.md#install`, respectively. *(FR-116)*
13. **Given** a document with front matter, **When** the user turns **Show front matter** off, **Then**
   the preview shows no front matter table and no stray rule or YAML text, and starts at the document's
   first heading; **When** they turn it on, **Then** the table returns. *(FR-117)*
14. **Given** `![logo](assets/logo.png "Project logo")`, **When** the user hovers the image, **Then**
   its tooltip reads `assets/logo.png` and `Project logo`; **Given** the same image inside a link,
   **When** hovered, **Then** the tooltip and status bar name the link's target, not the image.
   *(FR-120, FR-118)*

---

### User Story 7 - Step back and forward through the files a panel has shown (Priority: P2)

A user reading README in a preview Ctrl+clicks through to `setup.md`, then `install.md`, and clicks
**Back** in the top left of the preview's title bar to return to `setup.md` where they left it, then
**Forward** again. In an editor, they open three files one after another into the same panel and
step back through them the same way. After restarting throng, both panels still have their history.

**Why this priority**: In-place link navigation (FR-090) without a way back strands the reader, and
#136 asks for the same thing in editors. One model for both keeps the two panel kinds consistent.

**Independent Test**: Open three files in turn into one editor panel; Back twice, Forward once;
restart; Back again. Repeat in a preview by following links.

**Acceptance Scenarios**:

1. **Given** an editor panel that has shown `a.ts`, then `b.ts`, then `c.ts`, **When** the user
   clicks Back, **Then** the panel shows `b.ts`; **When** they click Back again, **Then** `a.ts`, and
   Back is disabled; **When** they click Forward, **Then** `b.ts`. *(FR-100, FR-102, FR-104)*
2. **Given** that panel showing `a.ts` with `b.ts` and `c.ts` ahead of it, **When** the user opens
   `d.ts` into it from Files & Folders, **Then** `b.ts` and `c.ts` are discarded, `d.ts` is the newest
   entry, and Forward is disabled. *(FR-103)*
3. **Given** a preview that followed links README → setup → install, scrolled halfway down setup,
   **When** the user presses Alt+Left twice, **Then** it shows README; **When** they press Alt+Right,
   **Then** it shows setup at the scroll position they left it. *(FR-101, FR-105, FR-107)*
4. **Given** a panel with history, **When** throng restarts, **Then** the panel has the same history
   and position; **When** the user destroys or closes the panel, **Then** its history is gone, and a
   new panel starts with none. *(FR-109, FR-110)*
5. **Given** history set to a maximum of 3, **When** a fourth file is opened into a panel, **Then**
   the oldest entry is dropped. *(FR-108)*
6. **Given** a dirty editor, **When** the user clicks Back, **Then** the usual unsaved-open prompt
   appears, and choosing Cancel leaves the panel and its history position unchanged. *(FR-106)*
7. **Given** a preview at the top of a document with a table of contents, **When** the user
   Ctrl+clicks a contents link to a heading further down, **Then** the preview scrolls there and Back
   is enabled; **When** they click Back, **Then** the preview returns to the top; **When** they click
   Forward, **Then** it returns to the heading. **Given** a preview that followed a link from README to
   `guide.md` and then two contents links within `guide.md`, **When** the user clicks Back three times,
   **Then** it steps back through both headings to the top of `guide.md`, and then shows README.
   *(FR-115)*

### Edge Cases

- **The parent editor is destroyed while its preview is open**, with unsaved edits discarded: the
  preview stays, becomes standalone and shows what is on disk. (FR-013b)
- **The file is opened in an editor while a standalone preview of it is open**: the preview adopts
  the editor as its parent, in place. (FR-013a)
- **Load remote images is off**: an `https:` image shows its alternative text. (FR-092)
- **The parent editor saves as a different file type** (`README.md` → `README.txt`): the preview
  shows a single inline notice that the file type has no preview, with Close as its action.
  (FR-027)
- **The parent editor's file is renamed or moved**: the preview follows it, and its title updates.
  (FR-031)
- **The file becomes unreadable, too large or binary** for a text provider: one inline notice in the
  preview, following the same limits the editor applies. (FR-026)
- **The preview's file is outside the project**: no preview is offered. (FR-004)
- **An editor with no file on disk yet**: no preview is offered — there is no file type to match.
  (FR-004)
- **Previewing a file whose editor is in another tab or another window**: the preview opens beside
  that editor; its tab comes to the front and its window is focused. (FR-010)
- **A layout restores a preview whose provider is now disabled or absent**: the preview is not
  restored. (FR-067)
- **A layout restores a preview whose file's editor does not restore**: it restores standalone —
  parented is derived, never persisted. (FR-066)
- **Following a link from a parented preview to another Markdown file**: the same preview now shows
  that file, and is parented only if that file has an editor open. (FR-090a)
- **Following a link to a file that already has a preview elsewhere**: that preview is focused and
  this one is unchanged. (FR-090c)
- **Following a link to a missing file or heading**: one inline notice naming the target; no file is
  created. (FR-090e)
- **Back to a file that has since been deleted**: the position moves and the panel shows that the
  file could not be read, so the user can keep stepping back. (FR-106d)
- **Back, in an editor, to a file open in another editor**: that editor is focused; this panel does
  not move. In a preview, Back to a file that has another preview focuses that preview; a file open in
  an editor is simply shown, parented. (FR-106b)
- **The history size is lowered below a panel's current history**: oldest entries go at once, never
  the current one. (FR-108)
- **Disabling a provider closes the workspace's last panel**: an empty panel takes its place, per
  002 FR-016; any other tab it empties closes as usual. (FR-064)
- **The preview's own name would be too long**: the parent's part is shortened; " - Preview" is
  never cut. (FR-032)
- **A synchronised pair where the editor view is in another window, or in a tab not in front**:
  scrolling the preview moves no editor, as scrolling that editor moves no preview. (FR-121a)
- **The preview is scrolled past the point the editor can reach** (the editor's last line is already
  at its bottom): the editor scrolls as far as it can and no further; the preview is not pulled back.
  (FR-121b, FR-121c)
- **Scroll sync is toggled from one window while another window shows editors and previews**: every
  window's buttons and menu items follow the one setting. (FR-122)
- **The editor's top line falls inside a multi-line preview block** (a code block or table): the
  preview shows that block at its top, and the editor is not pulled back to the block's first line.
  (FR-121g)
- **A live update reflows the preview while synchronised**: the preview keeps its place (FR-024) and
  the editor follows only if that place now maps to a different line from the one it shows. (FR-121f,
  FR-121g)
- **A preview opens, or restores after a restart, beside its editor**: it starts at the editor's line;
  opening or restoring a preview never scrolls the editor. (FR-121h)
- **The settings file cannot be written when the toggle is used**: every surface keeps showing the
  stored value, and the failure is reported as any settings write failure is. (FR-122e)

## Requirements *(mandatory)*

### Functional Requirements

#### Opening a preview

- **FR-001**: An editor panel whose file has a **text provider** MUST show a preview button in its
  status bar's controls group. Choosing it MUST open that file's preview. While that provider is
  disabled the button MUST be drawn **disabled**, its tooltip naming the setting that turns it back
  on; it MUST be absent for an editor whose file has no provider at all. It MUST use a themeable icon
  token and carry an accessible name (**040 FR-018**), and like the language indicator and wrap
  toggle it MUST never be hidden by the status bar's width-driven hide order (**040 FR-023/FR-024**);
  it is hidden only with the whole bar (**040 FR-033**).
  *Extended by FR-122c (Session 2026-09-16) — a scroll-sync toggle sits immediately to its left.*

  > **Amended 2026-09-14 (planning)**: was "enabled text provider … absent for any other editor".
  > Principle VI's *disabled when unavailable, absent when meaningless* decides it: a disabled
  > provider is one setting away from working, so its affordances are unavailable, not meaningless —
  > which is also what the maintainer's "disabling disables all preview options" says. Same for FR-003,
  > FR-061 and FR-062.
  >
  > **Amended 2026-09-14 (analysis)**: no change of meaning. The note above had been placed inside the
  > requirement, so the icon-token, accessible-name and never-hidden-by-width sentences rendered as
  > part of the historical note; they are moved above it, verbatim.
- **FR-002**: The same editor panel MUST offer **Open Preview** in its body's right-click menu and in
  its header's right-click menu, in the Navigate section, showing the command's chord when one is
  bound (Principle VI, *Every panel action has a menu item*).
- **FR-003**: Files & Folders MUST offer **Preview** inside the **Open In** submenu for a file that
  has a provider, drawn **disabled** while that provider is disabled (Principle VI, *disabled when
  unavailable*). It MUST be absent on folders and on files with no provider (*absent when
  meaningless*). *(Amended 2026-09-14 (planning) — see FR-001.)*
- **FR-004**: No preview affordance MUST be offered for a file outside the project (Principle I), or
  for an editor whose document has no file on disk.
- **FR-005**: Opening a preview MUST be one bindable command, so every entry point in FR-001–FR-003
  and FR-052 performs the same action. It ships with no default chord.

#### Where a preview opens

- **FR-010**: When the file is open in an editor, the preview MUST open **next to the parent editor**
  — splitting the parent editor's slot, with the preview on the right — **wherever that editor
  lives**, whichever tab or window the request came from, and it MUST be parented to that editor.
  If the parent editor's tab is not the front tab, it MUST be brought to the front; if the parent
  editor is in a different window from the request, that window MUST be focused. When the parent
  editor is shown in more than one window (Sync to), the preview opens beside the view in the
  requesting window if there is one there, otherwise beside the view in the main window.
- **FR-011**: When the file is not open in any editor, the preview MUST open **standalone**, as a new
  panel placed where opening a file into a new editor would place one. No editor panel is created.
  *(The maintainer's requirement breaks off at "If the file is …". It is read as the case FR-013
  asks about — the file being opened in an editor afterwards.)*
- **FR-012**: A file has **at most one preview**. While it has one, Open Preview (FR-002) and Open In
  → Preview (FR-003) MUST be shown **disabled** (Principle VI, *disabled when unavailable*; the
  **006 FR-011a** precedent for Open In targets whose file is already open).
- **FR-013**: A preview MUST be bound to **the file it is currently showing, never to an editor
  panel** — from the moment it opens, however it was opened. It holds no reference to an editor.
  Whether it is **parented** is derived, never stored: a preview is parented exactly while a source
  document exists for its current file, and its parent editor is whichever editor panel holds that
  document. Everything that looks like a link to an editor — following its buffer (FR-022), its
  unsaved marker (FR-040), its name (FR-031), Go to Editor (FR-015d) — is looked up through the file.
  The only moment an editor panel matters is placement when the preview first opens (FR-010).
  - **FR-013c**: The file a preview is bound to MUST follow that file's identity: when a parented
    preview's source document changes path — renamed or moved, or saved under a new name with Save
    As — the preview MUST move with it, and its title and provider match follow (FR-027, FR-031).
    *(Added 2026-09-14 (planning): without it a preview bound strictly to the old path could never
    reach FR-027's notice, and would silently fall back to a file the user just renamed away.)*
    A **standalone** preview MUST likewise follow its file when the file is renamed or moved **inside
    the app** (Files & Folders), exactly as an editor does today (`moved-path-sync.tsx`); a rename or
    move made **outside the app** reads as the file being deleted (FR-026), as it does for an editor.
    > **Amended 2026-09-14 (analysis)**: the standalone sentence is added. The design already followed
    > an in-app move for a standalone preview (`FilesService.setOnMoved`, contracts/preview-ipc.md §3)
    > and T058 tested it, but no requirement asked for it; without it a standalone preview's title,
    > history and Open in Editor would keep pointing at a path the user had just renamed away. It
    > extends, and does not change, the editor behaviour it copies.
  - **FR-013a**: When a standalone preview's file is opened in an editor, the preview MUST become
    parented to that editor, in place — it does not move. From then on it follows the source
    document (FR-022), shows its unsaved marker (FR-040) and takes the parent's name (FR-031).
  - **FR-013b**: When a parented preview's source document closes — its parent editor is destroyed,
    whichever dirty-close choice the user made — the preview MUST stay open and become standalone:
    it re-reads the file from disk (FR-023), so any unsaved content it was showing is replaced by
    what is on disk, its unsaved marker clears (FR-043) and its title becomes the standalone form
    (FR-031).
- **FR-014**: While a file's preview is open, that file's editor status-bar preview button MUST show
  a **pressed** state, and choosing it MUST **focus the open preview**, bringing its tab to the front
  if needed. It MUST NOT close the preview; closing belongs to the preview's own menu (FR-033). The
  menu items stay disabled meanwhile (FR-012). *(Focusing a panel is not a command a hidden status
  bar could strand — the panel itself can be clicked — so Principle VI's menu-item rule adds no item
  for it.)*
- **FR-015**: Every preview of a **text provider** MUST offer a route back to its source, placed
  exactly where an editor places Open Preview (FR-001, FR-002) — the mirror image of it:
  - **FR-015a**: A button in the preview panel's **status bar**, in the controls group, at the
    position the preview button occupies in the editor's status bar. The preview panel's status bar
    MUST look like the editor's and follow the same `editor.showStatusBar` setting; it carries no
    readouts. The button MUST use a themeable icon token, carry an accessible name, and never be
    hidden by width.
    *Partly superseded by FR-118 (Session 2026-09-15) — the status bar shows a hovered or focused
    link's target.*
    *Partly superseded by FR-122c (Session 2026-09-16) — "a button" becomes two: the scroll-sync toggle
    sits immediately left of this one, in the same controls group, on every text-provider preview.*
  - **FR-015b**: An item in the preview panel's **body** right-click menu and **header** right-click
    menu, in the Navigate section — the same sections Open Preview occupies on an editor.
  - **FR-015c**: On a **standalone** preview the item and button are **Open in Editor**: they open
    the file in an editor panel placed beside the preview — splitting the preview's slot, with the
    editor on the left — and the preview becomes parented to it in place (FR-013a).
  - **FR-015d**: On a **parented** preview the item and button are **Go to Editor**: the button shows
    pressed, and both focus the parent editor, bringing its tab to the front and focusing its window
    if needed (the mirror of FR-014).
  - **FR-015e**: A binary provider's previews MUST offer neither (FR-073). Where a preview's status
    bar would carry nothing, it MUST NOT be shown.

#### Reading-only, and following the source

- **FR-020**: A preview panel MUST be read-only: no keystroke, paste, drop or command issued in it
  changes the file or the source document.
- **FR-021**: Commands that act on a document or a file selection — save, revert, find and replace,
  rename or delete a file — MUST be inert while a preview panel has focus. A preview MUST NOT fall
  back to another surface's keyboard scope (such as Files & Folders'), where those commands would act
  on something the user cannot see.
- **FR-022**: A **parented** preview MUST follow the source document's **current content**, including
  unsaved edits — never the file on disk — updating once the update delay (FR-060) has passed since
  the last change, and in any case no later than the maximum wait (FR-060a) after the first change
  it has not yet shown, so continuous typing still updates the preview. It MUST follow the app's single document for that file, not relay from one view
  of it (Principle XI, *One authority, not two peers*; **016 FR-028f**), so every view of the same
  preview shows the same thing.
- **FR-023**: A **standalone** preview MUST follow the file on disk, updating when it changes.
- **FR-024**: Updating a preview MUST keep the reader's position in the document; it MUST NOT scroll
  to the top. Following a link to another file is not an update: it shows that file from its top or
  its named heading (FR-090b).
- **FR-025**: A standalone preview MUST read its file **without opening it as an editor document**:
  it MUST NOT make the file count as open in an editor, appear dirty, or change what a later "open
  in editor" does (Finding 5).
- **FR-026**: When a preview cannot show its file — unreadable, deleted, larger than the size limit
  the editor applies, or not text for a text provider — it MUST show **one inline notice** in the
  panel saying what is wrong, never a raw error string (**030 FR-039**; **041 FR-006/FR-009**, *one
  condition, one notice*). A repeat of the same condition flashes the existing notice. Because no
  notification is raised for these conditions, the banner's pointer line MUST NOT mention one — it
  offers only "Copy the details here." (**refines 030 FR-041** for banners with no notification
  behind them). *(Amended 2026-09-15 (US2 review).)*
- **FR-027**: When a parented preview's file stops matching its provider (the parent saves it as a
  different type), the preview MUST show one inline notice saying the file type has no preview, with
  Close as its action. This **supersedes 030 FR-042** (Try again and Clear panel type on every banner)
  for this notice only: there is nothing to retry and nothing but Close resolves it; with no Copy
  details action, it carries no pointer line either. *(Amended
  2026-09-15 (US2 review).)*
- **FR-028**: **Refresh** MUST re-read the preview's source — the source document for a parented
  preview, the file on disk for a standalone one — and re-display it immediately, ignoring the
  update delay.

#### Name and title menu

- **FR-030**: A preview panel MUST NOT be renamable — a stated exception to **002 FR-037** and **002
  FR-041**, on the ground **043 FR-061** set for the Find in Files panel. Rename and Reset Name MUST
  be absent from its menu, and the rename chord and header double-click MUST be inert on it.
- **FR-031**: A parented preview MUST be titled **`<parent editor's name> - Preview`**, where the
  parent editor's name is whatever that editor currently displays, custom or derived (**024
  FR-015/FR-016**). The title MUST update when the parent's name changes. A standalone preview MUST
  be titled `<name an editor would derive for the file> - Preview`.
- **FR-032**: When the title would exceed the maximum name length setting, the name part MUST be
  shortened; " - Preview" MUST never be cut. The name part MUST keep at least one character, so at a
  maximum name length of 10 or less (the suffix's own length) a preview title exceeds the setting by
  the characters that remain; this **supersedes 031 FR-037's hard bound for preview titles only**,
  because a title reading " - Preview" alone names nothing. Where the header shows a truncation
  marker, it MUST mark the shortened name part (`name… - Preview`), never follow the suffix.
  *(Amended 2026-09-14 (implementation): u1 review found the ≤ 10 case and the marker placement
  unstated.)*
- **FR-033**: A preview panel's header menu MUST offer, in its sections: **Close Panel** (Destroy
  section — "Close", per Finding 2 and **011 FR-030**); **Reveal File in Files & Folders** and
  **Open in OS Explorer** (Navigate — the exact labels **033 FR-053** keeps, through the platform
  seam, **023 FR-024**); **Open in Editor** or **Go to Editor** for a text provider (Navigate —
  FR-015); **Back** and **Forward** (Navigate — FR-111); **Send to Tab ▸** and **Sync to ▸**
  (Navigate — **006 FR-031**, **006 FR-033**); **Refresh** and **Zoom ▸** with Zoom In, Zoom Out and Reset Zoom (View & state); and,
  while the failure banner is up, Try again, Copy details and Clear panel type (**030 FR-042c**).
- **FR-034**: A preview panel's zoom MUST be its own, per panel instance (**012**, revision
  2026-07-11), independent of its parent editor's, and MUST respond to the existing panel zoom
  commands and chords. Zoom MUST be offered on it (**043 FR-062a**).
- **FR-035**: A preview panel's body MUST allow selecting and copying text, and its right-click menu
  MUST offer **Copy** and **Select All** (Content), and Open in Editor or Go to Editor (Navigate,
  FR-015b).
  - **FR-035a**: Copying MUST put the selection on the clipboard in one of two formats: **Rich text**
    — the selection's plain text *and* its sanitised HTML (FR-081), so a rich target such as a mail
    client keeps headings, lists and links while a plain target such as an editor or terminal
    receives plain text — or **Plain text** — the plain text alone.
  - **FR-035b**: A **preview copy format** setting under Editor → Previews (FR-061) MUST choose the
    format that **Copy** and its chord use, with the values Rich text and Plain text, shipping as
    **Rich text**.
  - **FR-035c**: Beside Copy, the body's right-click menu MUST offer **Copy as Rich Text** and **Copy
    as Plain Text**, each copying in its named format whatever the setting — the same pattern #394
    uses for a default action with explicit alternatives in the menu. All three MUST be disabled
    while nothing is selected.

#### Dirty state

- **FR-040**: A parented preview MUST show the unsaved marker exactly while its source document is
  dirty. It reads the source document's state; it MUST NOT hold a dirty state of its own
  (Principle XI).
- **FR-041**: Only an action on the source document — save, revert, reload, or the parent editor's
  own dirty-close choices — MUST change that state. No action in a preview panel does.
- **FR-042**: Closing a preview MUST NOT prompt, whatever the source document's state, and MUST NOT
  change the source document.
- **FR-043**: A standalone preview MUST never show the unsaved marker.
- **FR-044**: A dirty preview MUST NOT be counted a second time anywhere the app counts unsaved
  documents (tab, project list, Files & Folders, the close prompts): one document, one count.

#### Default open action

- **FR-050**: Each provider MUST have a **default open action** setting whose values are **Editor**
  and **Preview**, shipping as **Editor**.
- **FR-051**: A binary provider has no Editor choice: its default open action MUST be Preview, and no
  setting MUST be shown for it.
- **FR-052**: For a file whose provider's default open action is **Preview**, opening it from Files &
  Folders by the click gesture `editor.openOnClick` names or by Enter, and from Quick Open, MUST open
  its preview instead of an editor — a refinement of **006 FR-011/FR-012/FR-013** and **033 FR-009**
  (Finding 4).
- **FR-053**: If that file is already open in an editor, FR-052 MUST open its preview next to that
  editor (FR-010), or focus the preview if one is open.
- **FR-054**: A Find in Files result MUST always open an editor, whatever the default open action
  (**043 FR-037**, **043 FR-087c**).
- **FR-055**: Open In's editor targets MUST always open an editor, whatever the default open action.

#### Preferences

- **FR-060**: A **preview update delay** setting MUST govern how long after the last change a
  parented preview updates, shipping at **300 ms** (Principle X; **043 FR-059**; Finding 6).
- **FR-060a**: A **preview maximum wait** setting MUST cap how long a parented preview may go without
  showing a change while changes keep arriving, shipping at **1000 ms**. It MUST never be shorter than
  the update delay; a stored value below it MUST behave as equal to the update delay.
- **FR-061**: Every preview setting MUST appear under the **Editor** group's **Previews** sub-group
  (Finding 7): the update delay and maximum wait; the copy format (FR-035b); for each provider an **enabled** toggle and its default open
  action (FR-050); and any settings a provider declares of its own (FR-071) — for Markdown, **Load
  remote images**, shipping on (FR-092). While a provider is disabled, its default open action and
  its own settings MUST be shown **disabled**, not hidden. Every setting MUST have a descriptor the
  preferences editor renders (configuration-editor completeness gate). *(Amended 2026-09-14
  (planning) — see FR-001.)*
  *Extended by FR-114 and FR-117 (Session 2026-09-15) — Synchronise preview and editor scrolling, and
  Markdown's Show front matter, join this sub-group on the same terms.*
- **FR-062**: Disabling a provider MUST **disable** every preview affordance for its file types — the
  status-bar button, Open Preview, Open In → Preview — and suspend any default open action of
  Preview, so its files open in an editor until it is re-enabled. *(Amended 2026-09-14 (planning):
  was "remove"; see FR-001.)*
- **FR-063**: Disabling a provider MUST close every open preview of its file types, in every project
  and window, including previews in layouts that are persisted but not currently loaded (the **005
  FR-026** precedent).
- **FR-064**: Closing previews under FR-063 MUST behave exactly as closing those panels by hand
  would: a tab left with no panels closes as any emptied tab does, and if a preview is the last panel
  of the workspace's last tab, an empty panel takes its place so the workspace keeps the tab and panel
  **002 FR-016** requires. *(Amended 2026-09-14 (planning): was "never leaves a tab with no panel",
  which over-read 002 FR-016 — it protects the workspace's last tab, not every tab.)*
- **FR-065**: The Markdown provider MUST ship **enabled**.

#### Persistence

- **FR-066**: A preview panel MUST persist with the layout like any other panel, including the file
  it is currently showing, its zoom and its navigation history (FR-109). Whether it was parented MUST
  NOT be persisted; on restore it
  is derived afresh (FR-013), so a preview whose file has no restored editor restores standalone.
- **FR-067**: A persisted preview whose provider is disabled or no longer exists MUST NOT be
  restored.
- **FR-068**: A preview's file path MUST be persisted in the same stored form as an editor's.

#### Providers

- **FR-070**: Adding a provider MUST require only writing the provider and registering it. The
  preview panel, its header and body menus, the editor status bar, the editor menus, the Files &
  Folders menu, the preferences editor and layout persistence MUST NOT need editing to admit it.
- **FR-071**: A provider MUST declare: its identity and display name; the file types it accepts,
  matched by file extension; whether it is a **text** or a **binary** provider; and how it displays a
  file's content inside the preview panel. Its enabled and default-open-action settings (FR-061)
  MUST follow from its registration. A provider MAY also declare settings of its own; they MUST
  appear beside its other settings (FR-061) without the preferences editor being edited.
- **FR-072**: No two providers MUST accept the same file extension; registering a second provider for
  an extension already claimed MUST fail at startup with a message naming both.
- **FR-073**: A binary provider's previews MUST always be standalone (FR-023). No status-bar or
  editor-menu affordance MUST be offered for its files.
- **FR-074**: A provider MUST display content only inside its own preview panel, and MUST NOT be
  able to read outside the preview's project (Principle I).

#### The Markdown provider

- **FR-080**: The Markdown provider MUST accept `.md` and `.markdown`, and MUST render at least
  CommonMark with the GitHub extensions: headings, emphasis, lists, block quotes, horizontal rules,
  links, images, tables, task lists (shown as read-only checkboxes), strikethrough, autolinks, and
  fenced code blocks with syntax highlighting.
- **FR-081**: Rendered output MUST be sanitised. Scripts, event-handler attributes, frames, forms,
  embedded objects and `javascript:` or other script-bearing URLs MUST never reach the display. A
  limited set of inline HTML — at least `<details>`/`<summary>`, `<kbd>`, `<sub>`, `<sup>`, `<br>`
  and `<img>` — MUST render after sanitisation. A test MUST assert the sanitiser is in the path.
- **FR-082**: Nothing in a previewed file MUST be able to run code in the application.
- **FR-083**: The rendered document MUST take its colours and fonts from the active theme's tokens,
  with no hard-coded colours, so it is legible in every shipped theme and follows a theme change
  without reopening.
- **FR-084**: Relative image paths MUST resolve against the document's own folder, and MUST NOT
  load an image outside the project (Principle I). An image that cannot load MUST show its
  alternative text.
- **FR-085**: A YAML front matter block — a `---` fence on the document's first line, closed by a
  second `---` — MUST render as a key/value table at the top of the preview, not as Markdown. Values
  MUST be shown as text (nested structures as their YAML source), and MUST pass through the same
  sanitisation as everything else (FR-081). Front matter that is not valid YAML MUST render as a
  code block of its source, never as a notice.
  *Refined by FR-117 (Session 2026-09-15) — a Show front matter setting can hide the block.*
- **FR-086**: Mermaid diagrams (a fenced block tagged `mermaid`) MUST render as ordinary fenced code,
  and math (`$…$`, `$$…$$`) MUST render as the literal text; neither is typeset in this feature.

#### Links inside a preview

- **FR-090**: A link to another file in the project, when followed (FR-094), MUST open that file
  **in place, in the same preview panel** — never in a new preview — when the file has an enabled
  provider:
  - **FR-090a**: The preview then shows the target file. It is bound to that file from then on
    (FR-013): its parented state, source, unsaved marker and title are the target file's, so a
    preview that was parented to one editor stops being parented to it.
  - **FR-090b**: A `#heading` fragment on the link MUST scroll the preview to that heading;
    without one, the target shows from its top.
  - **FR-090c**: If the target file already has a preview open elsewhere (FR-012), following the
    link MUST focus that preview, scrolled to the heading when one is named, and leave this preview
    unchanged.
  - **FR-090d**: A target file with no enabled provider MUST open as if opened from Files & Folders
    (an editor). A `#heading` fragment MUST then place the caret on that heading's line when the
    editor's language can identify headings, and otherwise open at the top.
  - **FR-090e**: When the target file does not exist, or is outside the project (Principle I), the
    preview MUST stay on its current file and show one inline notice naming the target. When the
    file exists but the named heading does not, the file MUST open and the notice MUST say the
    heading was not found. Following a link MUST never create a file.
  - **FR-090f**: A link to a heading in the same document, when followed, MUST scroll the preview to
    it; a missing heading shows the same notice.
- **FR-091**: An `http:`, `https:` or `mailto:` link, when followed (FR-094), MUST open in the OS
  default handler, through the platform seam (Principle II). Any other link MUST do nothing.
  *Refined by FR-119 (Session 2026-09-15) — the handler's window ends in front.*
- **FR-092**: Remote images with an `https:` source MUST load while the Markdown provider's **Load
  remote images** setting is on, which it ships as. While it is off, such an image MUST show its
  alternative text instead, and no request MUST be made for it.
- **FR-093**: Every remote resource other than an `https:` image — scripts, stylesheets, fonts,
  frames, `http:` images, media — MUST never load, whatever the setting.
- **FR-094**: Every link in a preview — web, project file and same-document heading — MUST be
  followed by **Ctrl+click**, the gesture terminal links use (**024 US7**). A plain click on a link
  MUST follow nothing, and a Ctrl+click that drags MUST select text rather than follow the link.
  Hovering a link MUST show its target and the gesture that follows it, so a plain click that does
  nothing is never a dead end.
- **FR-095**: Right-clicking a link in a preview's body, with no text selected, MUST offer **Open
  Link** and **Copy Link Address** — 024 US7's labels — above the body menu's other items; with text
  selected, the ordinary menu wins. Over a link that nothing follows (FR-091's "any other link"),
  both MUST be absent. This extends 024 US7's link-aware menu, which it scoped to terminals, to the
  preview panel, which has links for the same reason.
  *Refined by FR-116 (Session 2026-09-15) — what Copy Link Address copies.*
- **FR-096**: A focused preview MUST be navigable from the keyboard:
  - **FR-096a**: Arrow keys, Page Up, Page Down, Home and End MUST scroll the preview.
  - **FR-096b**: Tab and Shift+Tab MUST move focus forwards and backwards through the preview's
    links, in document order, with a visible focus indicator drawn from the theme's tokens; past the
    last link, focus leaves the preview as it would leave any other panel.
  - **FR-096c**: **Ctrl+Enter** MUST follow the focused link exactly as Ctrl+click does (FR-094),
    and plain Enter MUST follow nothing. Following a link MUST be a bindable command, scoped to the
    preview panel, shipping bound to Ctrl+Enter (Principle X) — its chord shown beside Open Link
    (FR-095).
  - **FR-096d**: The menu key or Shift+F10 on a focused link MUST open the menu FR-095 describes for
    that link.
  - Tab and Shift+Tab bound to indent and outdent in an editor MUST NOT act in a preview (FR-021).

#### Navigation history (editor and preview panels — #136)

- **FR-100**: Every **editor panel** and every **preview panel** MUST keep a **navigation history**:
  an ordered list of the files it has shown, with a current position. No other panel type has one.
- **FR-101**: A preview's history entry MUST record its file and its scroll position; an editor's
  entry records its file only. History is file-level: moving the caret or scrolling within a file
  MUST NOT add an entry (#136).
  *Refined by FR-115 (Session 2026-09-15) — in a preview, a followed same-document heading link adds
  an entry.*
- **FR-102**: **Back** MUST move the current position one entry older and show that entry's file;
  **Forward** MUST move it one entry newer. Neither MUST change the list itself, so Back then Forward
  returns exactly to where the user was (#136).
- **FR-103**: **Opening a file into the panel** by any route other than Back or Forward MUST change
  the list: every entry newer than the current position is discarded, and the opened file is
  appended as the new current entry — even when that file is already somewhere in the history
  (#136). Opening the file that is already the current entry MUST NOT add an entry.
  - **FR-103a**: For an editor, opening a file into the panel means any open that loads a file into
    that panel in place: from Files & Folders (click, Enter, Open In → Last Active Editor), Quick
    Open, a Find in Files result, a preview link that lands in an editor (FR-090d), or the unsaved-open
    prompt's Discard & open / Save & open. A newly created editor's first file is its first entry.
  - **FR-103b**: For a preview, the file it opens with is its first entry, and following a link in
    place (FR-090a) opens a file into it. A change in whether it is parented (FR-013a/b) MUST NOT
    touch its history.
- **FR-104**: Back and Forward MUST be shown as buttons at the **top left of the panel's title bar**,
  before the panel's type icon, on editor and preview panels. Back MUST be enabled only while an
  older entry exists and Forward only while a newer one exists; otherwise each is drawn disabled. Both
  MUST use themeable icon tokens, carry accessible names, and show their chord in their tooltip.
- **FR-105**: Back and Forward MUST be bindable commands acting on the focused editor or preview
  panel, shipping bound to **Alt+Left** and **Alt+Right** (Principle X), and the mouse's back and
  forward buttons pressed over such a panel MUST perform them. In an editor, Alt+Left and Alt+Right
  take precedence over the editor's built-in move-by-syntax chords on those keys.
- **FR-106**: Back and Forward MUST go through the same path that opening a file into that panel
  does, with the same outcomes, except that they never change the list:
  - **FR-106a**: A dirty editor raises the unsaved-open prompt. **Cancel** leaves the panel and its
    position unchanged; **Discard & open** and **Save & open** move the position (a failed save moves
    nothing); **Open in new editor** shows the file in a new editor panel, whose history starts with
    that file, and leaves this panel's position unchanged.
  - **FR-106b**: In an **editor** panel, when the entry's file is already open in another editor,
    that editor MUST be focused and this panel's position MUST NOT move. In a **preview** panel, when
    the entry's file already has a preview open elsewhere (FR-012), that preview MUST be focused and
    this panel's position MUST NOT move; a file merely open in an editor is no obstacle to a preview —
    the preview shows it, parented (FR-013, FR-090a).
    > **Amended 2026-09-14 (analysis)**: was one sentence covering both panel kinds, which read
    > literally made Back in a preview focus an editor instead of showing a file the preview could
    > show parented — contradicting FR-090a. Split by panel kind; no behaviour either kind had is
    > removed.
  - **FR-106c**: When the entry's file is refused (binary, too large, outside the project) or has no
    enabled provider for a preview, one notice MUST name the file, and the position MUST NOT move.
  - **FR-106d**: When the entry's file no longer exists **or cannot be read** (an I/O error, not a
    refusal), the position MUST move and the panel MUST show its existing could-not-read state for
    that file — the editor's failure banner, or the preview's inline notice (FR-026) — so the user can
    step past it; editors and previews MUST treat both cases alike. *(Amended 2026-09-15 (US7a review):
    the first cut left an unreadable target moving in an editor but refused in a preview.)*
- **FR-107**: Returning to a preview entry MUST restore that entry's scroll position.
  *Refined by FR-121e (Session 2026-09-16) — with scroll sync on, a parented preview's entry left at
  the very top of its document lands on the editor's top line instead.*
- **FR-108**: A **navigation history size** setting MUST cap each panel's history, shipping at
  **10** entries (#136), under the existing **Editor · Navigation** group, and applying to editor and
  preview panels alike. Beyond the cap the oldest entries MUST be dropped. Lowering the setting MUST
  take effect at once on every open panel, dropping oldest entries first and never the current one.
- **FR-109**: A panel's history and position MUST persist with the layout and be restored with the
  panel across restarts — a stated supersession of #136's working assumption that history is
  in-session only. History entries MUST store file paths in the same stored form as an editor's
  (FR-068), and MUST follow a file that is renamed or moved.
- **FR-110**: A panel's history MUST be purged when the panel no longer exists — destroyed or closed —
  and when its panel type is cleared. Moving the panel (Send to Tab) or showing it in another window
  (Sync to) MUST keep it; a panel shown in two windows has one history.
- **FR-111**: The header menu of an editor or preview panel MUST offer **Back** and **Forward** in its
  Navigate section, with the same enabled state and chords as the buttons (Principle VI, *Every
  panel action has a menu item*).
- **FR-112**: A history is per panel: Back and Forward in one panel MUST NOT affect any other panel's
  history, and there is no history across panels (#136).
- **FR-113**: While **Synchronise preview and editor scrolling** is on, scrolling a parented preview's
  editor MUST scroll the preview so the block at the top of the editor's viewport is at the top of the
  preview's, mapped through the source lines the preview already records (FR-024). Scrolling the
  preview MUST NOT scroll the editor. A live update MUST keep the synchronised position rather than
  fight it. A standalone preview, and a provider with no source lines (binary), are unaffected.
  *Partly superseded by FR-121 (Session 2026-09-16) — "Scrolling the preview MUST NOT scroll the
  editor" is withdrawn: synchronisation is two-way. The editor → preview rule, the live-update rule and
  the standalone/binary exclusions stand, and the same-window reading below applies to both
  directions.*
  > **Planning note 2026-09-15 (iteration)**: no change of meaning intended; the design's reading is
  > recorded so it can be challenged. *The preview's editor* is read as the parent editor's view **in the
  > same window** as the preview's view: a preview view whose window shows no mounted view of that editor
  > (the editor only in another window, or in a tab not in front) does not follow it. Reason: FR-010 opens
  > a preview beside its editor, and a cross-window relay would need a rule for which of several views
  > drives (plan.md, Iteration 2026-09-15; research R23). *(Derived; not confirmed.)*
- **FR-114**: A **Synchronise preview and editor scrolling** setting MUST exist under Editor ·
  Previews, shipping **on**, applying to every text provider, and taking effect without a restart
  (Principle X).
  *Refined by FR-121 and FR-122 (Session 2026-09-16) — the setting governs both directions, and can
  also be flipped from editor and preview menus, status bars and a command.*
- **FR-115**: In a **preview**, following a same-document heading link (FR-090f) MUST record a history
  entry for the same file — the entry left keeps the reader's scroll position — so Back returns to where
  the reader was and Forward to the heading. Jump entries and file entries MUST form one sequence: when
  Back has stepped back past the first jump within a document, the next Back MUST show the previous
  document, if one exists. This refines FR-101 for previews only; editor history stays file-level.
  Two consecutive entries for the same file and the same position MUST NOT be recorded.
- **FR-116**: **Copy Link Address** (FR-095) MUST copy, for a web or `mailto:` link, its URL; for a
  project file link, the file's absolute path; for a link resolving outside the project (FR-090e),
  the target as written; and for any link that names a heading, that path
  followed by `#heading` — a same-document heading link copies the preview's own file's path. It MUST
  never copy a bare `#fragment`.
  *Adopted 2026-09-16 (converge): the outside-the-project clause states what shipped and what
  `contracts/menus-and-controls.md` §4 already specified; the requirement was silent on that link
  shape, which is offered because FR-090e makes such a link followable.*
- **FR-117**: A **Show front matter** setting MUST exist on the Markdown provider, shipping **on**.
  While off, a document's front matter block (FR-085) MUST NOT be shown at all — neither as a table nor
  as Markdown — and the rest of the document renders as if it began after the block.
- **FR-118**: Hovering a followable link in a preview, or focusing it with the keyboard (FR-096b),
  MUST show the link's full target — as FR-094's tooltip names it — at the **left of the preview's
  status bar**, and clear it when the pointer or focus leaves. It MUST appear only while the status bar
  is shown (`editor.showStatusBar`). This supersedes FR-015a's "it carries no readouts" for this
  readout only.
- **FR-119**: After a web or `mailto:` link is followed (FR-091), throng MUST NOT take the foreground
  back: the handler's window MUST be left in front of throng's.
  > **Implementation note 2026-09-16 (converge, adopting what shipped)**: the foreground handoff is made
  > on **both** open-external channels, not the preview's alone — the same lock applies to a link
  > followed from a terminal (024 US7) or the About window, so a requirement written for previews is
  > delivered app-wide. One policy per caller (`contracts/security-policy.md`, *Links out*) governs only
  > WHICH schemes each channel accepts; neither scheme check changed, and a refused URL grants nothing.
  *Confirmed by the maintainer's hands-on check, 2026-09-16 (Session 2026-09-16): the browser ends in
  front.*
- **FR-120**: An image in a preview MUST have a tooltip naming its source as written in the Markdown,
  followed by the document's own image title when one is given. An image shown as its alternative
  text — blocked (FR-093) or failed to load — MUST carry the same tooltip. An image inside a followable
  link MUST carry none, so the link's target is not masked (FR-094; the whole-branch security ruling
  I3); the status bar readout (FR-118) names that link.
- **FR-121**: While **Synchronise preview and editor scrolling** (FR-114) is on, synchronisation MUST
  be **two-way**: scrolling a parented preview MUST scroll its parent editor, as scrolling the editor
  scrolls the preview (FR-113). This partly supersedes FR-113's "Scrolling the preview MUST NOT scroll
  the editor".
  - **FR-121a**: The editor a preview drives MUST be the one FR-113 reads as driving it — the parent
    editor (FR-013), in its view in the same window as the preview's view. A standalone preview, a
    binary provider's preview, and a preview view whose window shows no mounted view of the parent
    editor MUST drive no editor. A preview that followed a link to another file is bound to that file
    (FR-090a): it MUST NOT drive the editor it was beside, and drives the new file's parent editor only
    if the new file has one.
  - **FR-121b**: The editor MUST scroll so that the source line recorded on the block at the top of the
    preview's viewport is the editor's top visible line — the mirror of FR-113's mapping, at the same
    block granularity. Where the editor cannot scroll that far, it MUST scroll as far as it can. Being
    scrolled MUST NOT move the editor's caret or selection, focus it, mark its document dirty, or add a
    history entry (FR-101).
  - **FR-121c**: A scroll that the synchronisation itself caused MUST NOT drive the other side, so a
    scroll never bounces back to the side that started it, and a side that could not reach the requested
    place (FR-121b) never pulls the other back to match.
    *Restated by FR-121g (Session 2026-09-16) — a loop guard only, not an exception to FR-121f.*
  - **FR-121d**: Only a preview scroll the **reader** caused MUST drive the editor: the wheel, the
    scrollbar, the keyboard (FR-096a), a followed same-document heading link (FR-090f) and a Back or
    Forward that stays within the same file (FR-107, FR-115). A scroll the application made on its own
    MUST NOT: keeping the reader's place across a live update (FR-024), placing a preview as it opens or
    restores, restoring an entry's position after a step to a different file (FR-107), and a
    synchronisation from the editor (FR-121c). FR-024, FR-107 and FR-115 are otherwise unchanged.
    *Superseded by FR-121f (Session 2026-09-16) — the user's answer: every scroll synchronises, whatever
    caused it.*
  - **FR-121e**: When Back or Forward (FR-102) brings a **parented** preview, with synchronisation on,
    to an entry the reader left at the **very top** of its document, the preview MUST land on the
    parent editor's current top line (FR-113), not at the top. This refines **FR-107** for this case
    only: a saved top-of-document place yields to synchronisation, and every other saved place is still
    restored and still wins over the editor's line. It holds whether the step stays in the same file
    (FR-115) or crosses files. Because the preview lands where the editor already is, the step drives
    no editor scroll (FR-121c, FR-121d). With synchronisation off, or on a standalone preview, FR-107
    applies unchanged. *(User's ruling, Session 2026-09-16; resolves T222.)*
    *Consistent with FR-121f–h (Session 2026-09-16): a top-of-document entry has no saved place, so the
    editor's line places the preview (as FR-121h places a preview that opens), the editor is already at
    that line, and FR-121g makes the step a no-op on the editor side — not an exception to FR-121f.*
    > **Planning note 2026-09-16 (iteration round 2)**: no change of meaning intended. "The very top" is
    > read as an entry with **no** saved place **or** a place of line 0 at offset 0 — the form a jump chain
    > stores for the top (FR-115). To make the rule explicit rather than an accident of a missing place,
    > a history step sends a placeless entry's place as an explicit "none", so a step onto the top can be
    > told from a followed link, which FR-121f treats the other way (plan.md decision 4; research R32).
    > When no view of the parent editor is mounted in the preview's window, the editor's line is unknown
    > and FR-107 applies (the top), as FR-121a already implies. *(Derived; not confirmed.)*
    > **Open question for the maintainer (analysis 2026-09-16, C1) — a proposed narrowing, not yet
    > ruled.** Under FR-121f the editor follows every heading jump, so at a **same-file** Back the
    > editor's top line is the jump's place. Applying this requirement there means: preview at the top,
    > Ctrl+click a contents link (the editor follows), press Back — and nothing visibly changes, which
    > contradicts FR-115 ("Back returns to where the reader was") and User Story 7 scenario 7. The ruling
    > recorded in Session 2026-09-16 was asked about the cross-file case (T222's steps). **The plan
    > proceeds on this reading until ruled otherwise: this requirement's editor-line rule applies to a step
    > that crosses files; a same-file step restores its place, the top included, and the editor follows
    > it (FR-115, FR-121f).** If the maintainer confirms the same-file clause as written, FR-115 and US7
    > scenario 7 need an explicit refinement and tasks T232(b) and T242 flip.
    > **Ruled 2026-09-16 (controller): the narrowing stands.** The question put to the maintainer
    > described Back "to a document you'd left scrolled to the very top" — a step onto another document —
    > and the answer ("the editor's position") was given to that. Applied to a same-file step it would make
    > Back after a contents link do nothing, which the maintainer's other answer ("synchronised in every
    > situation") does not ask for either. So this requirement's editor-line rule applies to a step that
    > **crosses files**; a same-file step restores its place, the top included, and the editor follows it.
    > The sentence above that says "whether the step stays in the same file (FR-115) or crosses files" is
    > read with that limit. *(Controller ruling; not confirmed by the maintainer — reported to them.)*
  - **FR-121f**: While synchronisation is on, **any scroll of either side, whatever caused it, MUST
    move the other side** (by FR-113's mapping one way and FR-121b's the other). This supersedes
    FR-121d. It includes:
    - on the **preview**: the wheel, the scrollbar and the keyboard (FR-096a); a followed heading link
      (FR-090b, FR-090f); a link followed to another file that has a parent editor (FR-090a) — the
      preview's start position drives that editor; keeping the reader's place across a live update
      (FR-024); a Back or Forward in the same file or to another file (FR-107, FR-115); and placing on
      open or restore, subject to FR-121h;
    - on the **editor**: the wheel, the scrollbar and the keyboard; the caret moving, including typing
      that scrolls the editor; find and replace moving to a match; Go to Line; a Back or Forward in the
      editor; and any reveal the application performs (such as a Find in Files result placing the caret
      on a line of a file already open, 043).
    **A cross-file Back or Forward to an entry with a saved place** restores that place in the preview
    (FR-107), and then the parent editor, if the file has one, follows the preview. FR-121a still decides
    **which** editor is paired, and FR-121e decides the top-of-document case.
  - **FR-121g**: **Loop guard** (restates FR-121c). A scroll the synchronisation itself applies MUST NOT
    be relayed back to the side it came from, so the two sides never oscillate. A side already showing
    the target line MUST do nothing, and the difference in granularity between the two mappings (a
    preview block covers several editor lines) MUST NOT by itself move either side. A side that cannot
    reach the target goes as far as it can (FR-121b). This is a guard against a loop, not an exception
    to FR-121f: every scroll that did not come from the synchronisation still moves the other side.
  - **FR-121h**: **Where a pair starts.** When a preview first **opens** beside its parent editor, or
    **restores** with the layout after a restart while its parent editor is shown (FR-066), the
    **editor's top line decides**: the preview is placed there, so opening or restoring a preview never
    scrolls the editor. Where a standalone preview **adopts** a newly opened editor (FR-013a, FR-015c),
    the preview is the side already on screen: the new editor is placed at the preview's position, so
    adopting an editor never moves the preview. From then on both directions apply (FR-121f).
    Back, Forward and following links are not openings: they are scrolls under FR-121f, with FR-121e
    for the top-of-document case.
- **FR-122**: **Synchronise preview and editor scrolling** (FR-114) MUST be switchable from the editor
  and the preview themselves, and every such surface MUST flip the **one global setting** — never a
  per-panel or per-document state — so the change applies at once to every editor and preview in every
  window and project, and every surface MUST show the setting's current state. This refines FR-114.
  - **FR-122a**: The surfaces in FR-122b and FR-122c — body menu item, header menu item and status-bar
    button — MUST be present on exactly the editors that show the
    preview button (FR-001: a file with a text provider, in the project, on disk) and on every
    text-provider preview, parented or standalone; absent on a binary provider's preview and on an
    editor with no provider (Principle VI, *absent when meaningless*). They MUST be **enabled** while
    that file's provider is disabled: the setting governs every text provider, and no one provider's
    switch governs it (FR-114).
  - **FR-122b**: The editor's **body** right-click menu and the preview's **body** right-click menu MUST
    offer **Synchronise Scrolling** in the **View & state** section, rendered **checked** while the
    setting is on and showing the command's chord when one is bound (Principle VI, *Every panel action
    has a menu item*; the Word Wrap item, 024 US1). Hiding a status bar MUST NOT remove it.
    *Extended 2026-09-16 (user's answer, Session 2026-09-16) — "body menus only" is superseded:* the
    editor panel's and the preview panel's **header** right-click menus MUST offer the same checkable
    **Synchronise Scrolling** item, with the same presence, enabled state, check and chord, in their
    **View & state** section (constitution Principle VI, *One section vocabulary for every menu* —
    "Toggles and per-surface state"; 033's section vocabulary as `contracts/menus-and-controls.md` adopts
    it). On the preview header menu (`contracts/menus-and-controls.md` §1) and on the editor header menu
    it MUST follow **Zoom ▸** and precede the failure-banner items (030 FR-042c) where those are shown
    *(position within the section derived; not confirmed)*.
  - **FR-122c**: The editor's status bar and the preview's status bar MUST carry a scroll-sync toggle
    button in their controls group, placed **immediately left of** the preview button (FR-001) and of
    the Open in Editor / Go to Editor button (FR-015a) respectively. It MUST use the themeable icon token
    **`syncScroll`**, carry an accessible name and a hover title naming the action — **Synchronise
    Scrolling**, with its chord when one is bound — and show a **pressed** state while the setting is on
    (constitution, *Action controls MUST be themeable icons with hover titles*). Like the controls beside
    it, it MUST never be hidden by width (**040 FR-024**) and is hidden only with the whole bar (**040
    FR-033**). This partly supersedes FR-015a's single button.
  - **FR-122d**: Toggling MUST be one bindable command, **`preview.toggleSyncScroll`**, labelled
    **Synchronise Scrolling** in the key binder, live while an editor or preview panel has focus, and
    shipping with **no chord** (Principle X; the FR-005 precedent). Every surface in FR-122b and FR-122c
    MUST perform that command.
  - **FR-122e**: The toggle MUST **persist** the setting, exactly as changing it in Preferences does,
    writing that key alone without reverting any other (**032 FR-001**); an open Preferences window MUST
    show the new value. If the write fails, the setting MUST keep its stored value, every surface MUST
    keep showing it, and the failure MUST be reported as any settings write failure is (032). This is
    deliberately unlike 024's Word Wrap toggle, which overrides one document in memory only.
    > **Planning note 2026-09-16 (iteration round 2)**: no change of meaning intended; two readings are
    > recorded so they can be challenged (plan.md, Iteration 2026-09-16, decisions 2 and 3; research R33).
    > **(a) A sub-workspace window becomes a settings writer.** 032's User Story 3, scenario 2, records
    > *"Exactly **two** windows write settings"* and so mounts no write-failure subscriber in a
    > sub-workspace window. FR-122e makes that premise false: the toggle can be used from an editor or
    > preview in any window. The sub-workspace window therefore mounts the same subscriber, and a failed
    > toggle is reported **once, in the window that made the write** (the failure listener is per
    > window) — this supersedes that 032 parenthetical for sub-workspace windows only; 032's requirement
    > that a write failure reaches the user is kept and widened. **(b) Revert All Preferences (032
    > FR-001a) reverts the toggle** when it was used after the Preferences window opened: the key is a
    > preference with a descriptor, the open Preferences window shows the change (above), and excluding it
    > would need a key list beside the settings metadata. *(Derived; not confirmed.)*
  - **FR-122f**: The setting's description in Preferences MUST say that synchronisation works in both
    directions, and name the menu item and status-bar button that also switch it (configuration-editor
    completeness).

### Key Entities

- **Preview provider**: identity, display name, accepted file extensions, kind (text or binary), how
  it displays content, and the settings its registration yields. Registered once at startup; no two
  claim the same extension.
- **Preview panel**: one file's preview. Knows the file it is currently showing, its provider and its
  zoom — nothing about any editor panel. Whether it is parented, its content and its dirty state are
  all derived from that file's source document when one exists. Following a link can change the file
  it shows (FR-090).
- **Navigation history**: per editor or preview panel — an ordered list of entries (file; for a
  preview, also scroll position) and a current position. Capped by the navigation history size
  setting; persisted with the panel; purged with it. *Session 2026-09-15: in a preview, consecutive
  entries may name the same file at different positions, recorded by followed heading links (FR-115).*
- **Source document**: the app's single open editor document for the preview's file, when one
  exists. The only owner of content and dirty state.
- **Preview settings**: the update delay, maximum wait and copy format; per provider, enabled, default open action and any
  settings the provider declares of its own (Markdown: Load remote images). *Session 2026-09-15 adds
  Synchronise preview and editor scrolling (FR-114) and Markdown: Show front matter (FR-117).*
  *Session 2026-09-16: Synchronise preview and editor scrolling is two-way (FR-121), and is also
  written by the editor and preview toggles (FR-122) — still one global value, never per panel.*
## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from an open `.md` editor to its rendered preview in one action from each
  of the three entry points.
- **SC-002**: With the update delay at its default, a change in a parented preview's source is
  visible within 1 second of the user pausing, in a 1,000-line document.
- **SC-003**: A test-only provider can be added and appears on every surface in FR-070 with changes
  confined to the provider and its registration — verified by a test that registers one.
- **SC-004**: A hostile Markdown fixture covering every vector named in FR-081 and FR-093 executes
  nothing and makes no network request, in 100% of runs; with Load remote images off, a fixture of
  `https:` images makes no request either.
- **SC-005**: Every shipped theme renders the Markdown fixture with its body text meeting the same
  contrast bar the app's editor text is held to.
- **SC-006**: Opening, following and closing previews never changes the number of documents the app
  counts as open or unsaved.
- **SC-007**: After any sequence of opens, Backs and Forwards in one panel, Back followed by Forward
  (or Forward by Back) returns to the same file every time, and a restart changes neither the list
  nor the position.

## Complexity justification (Principle VIII)

A provider abstraction with one shipped provider is speculative generality unless a second consumer
is concrete. It is: #388 (PDF) is filed and blocked on this feature, and it differs from Markdown on
the axis that tests the seam hardest — it is binary, has no editor, and is always standalone. A
second, filed, consumer that disagrees with the first is the strongest justification Principle VIII
admits.

## Assumptions

- "Next to it" means a split of the parent editor's slot in the same tab, preview on the right, as
  the common editor convention ("open preview to the side").
- A standalone preview is placed where opening the file into a new editor would place it.
- Provider matching is by file extension. An editor whose language is overridden to Markdown does
  not make a non-Markdown file previewable.
- A provider that is disabled keeps its affordances drawn but disabled (FR-001, FR-003, FR-062); only
  a file type with no provider at all has none.
- "Reveal" is the existing **Reveal File in Files & Folders** item and "Refresh" is new, distinct
  from the editor's "Reload from disk" because a parented preview refreshes from the source
  document, not from disk.
- The Open Preview command ships unbound; users can bind it in the key binder.
- The size limit and binary detection the editor applies are the limits a text provider applies.
- The library choice for Markdown rendering and sanitisation belongs to the plan's research phase,
  under #10's constraints: actively maintained, permissively licensed and AGPL-3.0 compatible.

## Out of Scope

- Any provider other than Markdown (#388 PDF, and Word, spreadsheets, images, notebooks).
- Editing through a preview; scroll-sync between source and preview; printing or exporting.
  *Scroll-sync superseded by FR-113/FR-114 (Session 2026-09-15) — editor → preview scroll sync is in
  scope; preview → editor remains out of scope.*
  *Preview → editor scroll sync superseded by FR-121 (Session 2026-09-16) — it is in scope too;
  synchronisation is two-way.*
- Rendering Mermaid diagrams ([#392](https://github.com/Bidthedog/throng/issues/392)) and typesetting
  math ([#393](https://github.com/Bidthedog/throng/issues/393)) in Markdown (FR-086).
- Find inside a preview.
- Previewing a file outside a project.
- A navigation history shared across panels, and caret-position history within a file (#136's own
  exclusions; FR-101, FR-112).
- An editable CSV grid (#323 — see *Relationship to #323*).
