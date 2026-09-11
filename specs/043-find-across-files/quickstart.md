# Quickstart: validating Find / Replace in Files

**Feature**: 043 | **Plan**: [plan.md](./plan.md)

How to prove this feature works, cheapest layer first. Types and channel shapes are in
[data-model.md](./data-model.md) and [contracts/](./contracts/) — not repeated here.

## Prerequisites

```bash
npm ci                 # once
npm run build          # tsc -b + generators + renderer bundle
```

**One trap worth knowing before you debug anything.** Vitest resolves `@throng/core` to **source**;
the Electron app loads `packages/core/dist`. So a unit test and an E2E can disagree about a constant
while both are "right". If they do, suspect a stale build before suspecting the code:

```bash
rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist && npm run build
```

## The layers, in the order to run them

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:component
npm run test:integration
npm run test:contract
npm run test:e2e          # ~18 min, saturates the machine - earn it first
```

`npm run gate` runs all eight in CI's order, fail-fast, **on a GitHub-hosted runner**:

```bash
gh workflow run gate.yml --ref feature/S043-I220-I153-find-across-files
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

Take the verdict from `run view` — `gh run watch` detaches early and its exit code lies both ways.

---

## Scenario 1 — a find session belongs to its panel (US1)

**Layer**: component. No app needed.

Drive the find store directly: open a session on panel A with a term, modes and a current match; open
another on panel B with a different term; switch `showingFor` back and forth.

**Expected**: A's four fields survive unchanged; stepping matches in A leaves B's current match and
highlights untouched; `Escape` on A closes only A; destroying A discards only A's session.

**What makes this the right layer**: it is pure store behaviour. The defect being fixed is a
module-level singleton, and a store test observes it directly — an E2E would prove the same thing for
two seconds of Electron launch.

## Scenario 2 — the find bar reads as a toolbar (US2)

**Layer**: component (jsdom).

Render the bar, click the disclosure arrow, press `Ctrl+H`, and inspect computed style.

**Expected**: the arrow expands and collapses the replace row and renders which state it is in; the
chord and the click never disagree; every action button has visible space between glyph and border;
match-mode, navigation and replace read as three groups; a terminal find bar has **no** replace row and
**no** arrow.

`getComputedStyle` fidelity is why this layer is jsdom rather than happy-dom.

## Scenario 3 — searching files (US3)

**Layers**: unit for the model, integration for the scan.

**Unit** — over fixture strings, no filesystem: ordering (files before sub-directories, alphanumeric,
digits before letters); snippet extraction with an ellipsis only on a truncated side; regrouping between
the **two** groupings — per file, and per folder and file — without re-running (FR-073 withdrew grouping
per folder alone); per-file staleness marking that reorders and disables nothing.

**Integration** — over a real temp tree: results stream in batches before the walk completes; a second
`start` for the same panel supersedes the first rather than compounding it; a cancelled walk yields
nothing rather than a truncated set; excluded, binary, over-size and unreadable files produce no rows
and **one** skipped count; a sub-directory scope reads nothing above it; and with a second project
active, only that project's files are read.

**By hand, once, at scale (SC-004).** The automated halves bound batch production and batch handling
separately; neither tells you whether the thing feels alive. Open a project of **at least 5,000 files**
— this repository with `node_modules` un-excluded will do — and search for a term that matches in
hundreds of them.

**Expected**: rows begin appearing while the scan is still running, the scrollbar keeps growing, and
**you can scroll and keep typing throughout** without the window stuttering or greying out. If it
stalls, that is SC-004 failing in the way the automated tests are least able to see.

## Scenario 4 — preview and commit (US4)

**Layer**: integration. This is where the feature can lose data, so it gets the most direct test.

Build a temp tree with the term in **four** files: one with an editor open in the **active** tab, one
with an editor open in a **background** tab, one open with **unrelated unsaved edits**, one with no
editor at all.

**Expected**:

1. Toggling replace and typing a replacement changes **no file**.
2. Committing leaves the unopened file changed **on disk**, and all three open files changed **in their
   buffers**, each a single undo step. **Two of those three end clean, not dirty (FR-086)**: the
   active-tab and background-tab documents were clean before the commit, so they are saved
   immediately after it and their replacement reaches disk — still a single undo step, because
   writing a buffer out discards nothing from its history.
3. **The background-tab file is changed.** This is the assertion that matters most — an implementation
   that dispatches through mounted views would silently skip it *and* decline its disk write, leaving
   it untouched with no error. See R7.
4. The file with unrelated unsaved edits keeps them; the commit **does not save that one** (FR-086a)
   and writes none of them to disk. It is the only one of the three left dirty afterwards, holding
   its replacement pending beside the user's own work — FR-053b stands word for word.
5. Line endings and any BOM are preserved byte-for-byte in the unopened file.
6. A match edited away between scan and commit is refused for that match only, and the rest of the
   commit is unaffected.
7. With any unopened file in the set, the commit returns `needsConfirmation` with a file count and
   writes nothing until confirmed; with every file open, no confirmation appears.
8. An empty replacement deletes each match and attracts no extra confirmation.

## Scenario 5 — panels behave like panels (US5)

**Layers**: component for the tab rules, E2E for the two things no lower layer can see.

**Component**: a second search in a tab reuses or opens per the preference; a search from a tab with no
Find in Files panel opens one **there** whatever the preference says; the New Panel dialog does not
offer the type.

**E2E** (and only these): a panel synced into a sub-workspace shows the parent's results, closes with
the parent, and leaves the parent alone when the sub-workspace view closes; the panel and its query
survive a real application restart with **no** results and no pending preview.

---

## Manual smoke test

Worth doing once by hand before calling it done. Everything here is something a person can actually
perform.

1. Open a project. **The explorer toolbar shows a Find in Files control beside Quick Open.** With no
   project open it is visible and greyed, never hidden. Its glyph is **📚** in the shipped icon pack
   (FR-065 replaced the hairline `⌕`), so it reads at the same weight as 🔎 Quick Open beside it rather
   than looking dwarfed by it.
2. Press `Ctrl+Shift+F`. A Find in Files panel opens **in the current tab**. Type a term that occurs in
   several files and then **stop typing** — there is nothing to press. As-you-type is what ships
   (FR-074), and the scan starts about **half a second** after the last keystroke (FR-075). If you have
   set `search.inFiles.trigger` back to **When you press Run**, the run control is the button to the
   **right of the scope box** (FR-069), not inside the search field.
3. Results appear grouped **per file**, **expanded**, one row per occurrence, each row showing the match
   highlighted inside a snippet with an ellipsis where the line was cut.
4. Double-click a row. The file opens per your "Open files in" preference with the matched text
   **selected**, not merely scrolled to.
5. Switch grouping to **Folder, then file** and back to **File**. The same matches regroup **without**
   the search re-running. Those are the **only two** groupings offered — in the toolbar, in the panel's
   menu, and in the `Find in Files groups results by` preference. Grouping per folder alone was
   withdrawn (FR-073), so if you still have `search.inFiles.defaultGrouping: "folder"` in a settings
   file by hand, a fresh panel opens grouped **per file** rather than refusing to open.
6. Right-click a folder in the tree → **Find in Files**. A search opens scoped to that folder.
7. Press `Ctrl+Shift+H`. Replace turns on with the replacement input focused. Type a replacement:
   every row shows its match struck through with the replacement beside it, and **no file has changed**.
   Now press `Ctrl+Shift+F` again: the replace row turns **off** and focus lands in the search input
   (FR-077). Press `Ctrl+Shift+H` once more to bring it back — your replacement text is still there.
8. Commit one file's matches. Only that file changes; every other row stays a pending preview. **That
   file's own rows stop being previews** — they drop the strike-through and read as the file now does
   (FR-083a, round three; step 19 walks through it).
9. Now commit the rest **with a file that has no editor open**, using the **Replace All** button on the
   toolbar — it sits to the right of the run control (FR-068) and is an accelerator over the results
   menu's own item rather than a second code path. You are warned how many files change on disk with
   no in-app undo, with the count digit-grouped. Confirm, then undo in one of the open editors — only
   that document reverts.
10. Edit one of the searched files in another program, then look at the results. **That file's group is
    marked stale and the others are not**, and every row in it still opens and still acts.
11. Close and reopen the project. The panel is back with its term and scope, **showing no results**.

### Added by round two

These are the things this round makes checkable by hand, and each is a claim no automated layer proves
end-to-end in a real window.

12. **Results follow a panel into a sub-workspace (FR-078).** Run a search that matches in several
    files, then right-click the panel's header → **Sync to** → **New Sub-workspace**. The new window
    shows **the same results**, not an empty panel — including when the scan had already finished
    before the window opened. Now change the term in the parent and let it settle: the sub-workspace's
    copy follows. Close the sub-workspace window; the parent keeps its results.

    **And watch the sub-workspace's SEARCH BOX while you do it (FR-078b).** It must change to the
    parent's new term, not keep the one it opened with. A box that disagrees with the list beneath it
    is the defect this clause exists for, and it is not cosmetic: the panel's Replace All sends the
    term the box holds, so a stale one is refused file by file — every file reported as *"the match
    had gone"* while the matches sit on screen. Nothing is mis-written when that happens, but nothing
    is written at all, and the report is false.

    Then reverse it: type a **new** term in the sub-workspace. Ownership follows whoever is typing, so
    now the **parent** is the one that must follow — its box takes your new term and its list changes
    with it. Neither window's box should ever fight you while you are typing in it.
13. **A folder outside the project is refused (FR-070).** Press the folder button beside the scope box
    (*"Browse for a folder in this project"*) and pick a directory **inside** the project — the scope
    box fills in with a path **relative to the project root**, not an absolute one. Now type a scope by
    hand, browse again, and pick a directory **outside** the project (your Desktop will do). It is
    **refused** with *"Folder is outside the project"* shown **on the scope control**, and the scope you
    had typed is **still there** — a mis-click in the dialog costs you a message, not your scope.
    Nothing about the platform dialog stops you navigating out of the project; the check happens after
    you choose, which is exactly why this step is worth performing by hand.
14. **The panel zooms (FR-062).** With the panel active, press `Ctrl+Alt+=` a few times, then
    `Ctrl+Alt+-`, then `Ctrl+Alt+0`. The text grows and shrinks **and the rows keep pace with it** —
    scroll while zoomed in and look for rows that overlap each other or leave a gap. The results list
    is windowed on a row height, so text that scales while that height does not is the failure to look
    for, and it shows up as mis-drawn rows rather than as wrong-sized text. Then add a panel and leave
    it **untyped**, and open its header menu: the zoom commands are **absent**, not greyed — they were
    three permanently inert rows before FR-062a, on the placeholder as well as here.
15. **The header names the panel and its term (FR-060).** A freshly opened panel — which is one with
    its replace row hidden — reads **Find in Files** before you have typed anything, and **Find in
    Files: `<term>`** once you have. It never reads `Panel 3`, at any moment of its life.
    Open two of them in one tab with different terms and
    confirm you can tell which is which from the headers alone — the term is the only thing that
    distinguishes them.
    *(Round three adds the other half: with replace disclosed the same panel reads **Find & Replace
    in Files**, still followed by the term. FR-081 refines this step rather than replacing it — see
    step 18.)*
16. **The panel cannot be renamed (FR-061).** Three routes, one answer. With it active, press `F2` —
    nothing happens. Open its header menu — **Rename** and **Reset Name** are **absent**, not present
    and inert; Rename was this panel's only content-section item, so that section is empty and draws
    **no divider** above what follows. Double-click its header — it does not enter rename mode, the
    gesture most people reach for first. This is a deliberate exception to the
    app-wide rule that every panel is renamable: a chosen name would hide the term, which is the one
    thing the header exists to give.

### Added by round three

Same rule as above: each of these is a claim a person can settle by looking, and none of them asks you
to react inside a debounce or to catch a state as it passes. Where a step waits, it waits for
something that then **stays** put.

17. **Each text input clears itself (FR-080, FR-080b, FR-080e).** Run a search that lists rows.
    - **The term.** A small ✕ sits **inside** the search box, at its right-hand end, and only while
      there is something to clear — empty the box with the keyboard and it is **gone**, not greyed.
      Hover it: the tooltip names the **field** (*"Clear search term"*), which is what stops three
      identical controls on one panel being indistinguishable. Press it: the term
      disappears, the caret stays in the box, and **every row you had is still listed and still
      opens on a double-click**. Nothing re-runs, under either trigger, because an empty term matches
      nothing and refuses to search.
    - **The replacement.** Press `Ctrl+Shift+H`, type a replacement, then press that field's ✕. The
      rows stay exactly where they are and each preview goes back to the match struck through with
      nothing after it — which is what an empty replacement means, a deletion.
    - **The scope.** Type or browse to a folder, let the results settle to that folder's matches, then
      press the scope box's ✕. The box empties, the caret stays in it, and the scope is the project
      root again. **Under the shipped as-you-type trigger the search then re-runs about half a second
      later and the list widens to the whole project** — because that is precisely what deleting the
      text by hand does, and a Clear is not allowed to be a quieter second way to search (FR-080e).
      Set `search.inFiles.trigger` to **When you press Run** and repeat: the same clear now starts
      nothing at all, and the folder-scoped rows stand until you press Run.
    - **Where the two controls sit (FR-080c).** The ✕ is inside the scope box; the folder button is a
      **separate control beside** it, not a second icon in the same box. A scope that is refused still
      says so in the same place it always did.

18. **The header says whether replace is showing (FR-081).** Open a panel with `Ctrl+Shift+F` and type
    a term: the header and its tab read **Find in Files: `<term>`**. Press `Ctrl+Shift+H`: the same
    panel — no new panel, no re-scan — now reads **Find & Replace in Files: `<term>`**. Press
    `Ctrl+Shift+F` again to hide the replace row and the title goes back. Clear the term while replace
    is showing and it reads **Find & Replace in Files** with no suffix.
    Then open **two** Find in Files panels in one tab and disclose replace in only one of them: the
    titles must differ. A panel is named for **its own** disclosure state, so both reading the longer
    title is the failure to look for. The **New Panel** dialog and the icon-pack list are unaffected —
    the panel *type* is still called "Find in Files" wherever the type is named.

19. **A committed row reads as the file now does (FR-083, FR-083a, FR-083b).** With replace on and
    every row previewing, commit **one file's** matches from that group's own menu.
    - That file's rows **drop the strike-through** and show plain text — the line as it now is. Every
      other file's rows are still struck-through previews. You can tell committed from pending at a
      glance, without reading the file.
    - **Skip a match** (FR-050) in a second file and commit that file. The skipped row **stays a
      preview**, because it is still pending; the rest of that file's rows go plain.
    - **Put two matches on one line** before you search — `foo bar foo` will do. Commit them, then read
      the two rows: neither shows the other's *old* text in the snippet around it. Before FR-083b each
      row re-derived its snippet from text the same commit had already invalidated, so the second row
      quoted a line that no longer existed anywhere.

20. **Replace All goes dark when there is nothing to replace (FR-084, FR-084c).** Commit everything,
    then look at the **Replace All** button on the toolbar: it is **drawn and greyed**, not live and
    silently doing nothing when pressed — which is what it did before this round. Open the results
    menu and check its **Replace All** item as well: greyed there too, not absent. The accelerator and
    the canonical route must agree about whether the command is available.
    Now set `search.inFiles.trigger` to **When you press Run**, so nothing runs behind your back, and
    type a **different** term without running it. Replace All **stays dark**: the rows on screen are
    still the old term's and all of them are committed, so there is nothing to send. Press **Run** and
    it lights up with the new results. (Under the shipped as-you-type default you reach the same place
    without pressing anything — the re-run half a second after you stop typing is a new scan, and it
    is the scan that re-enables the button, not the typing.)

21. **A commit saves a clean editor and leaves a dirty one exactly as it was (FR-086, FR-086a).** This
    is the round's most consequential change and the one worth doing slowly. Open **two** files that
    both contain the term:
    - Leave the first exactly as it opened — **no pulsing dot**.
    - In the second, type something unrelated somewhere the search will not touch, and **do not save**
      — the pulsing dot is now on.

    Search, turn replace on, type a replacement, and press **Replace All**. Then check all of it:
    - The **first** file's editor is **clean** — the dot is gone, or never appeared — and its
      replacement is **on disk**. Read the file in another program, or close and reopen it, and the
      new text is there.
    - The **second** file is **still dirty**. Your unrelated edit is untouched and its replacement is
      pending in the buffer beside it. **Nothing you had not saved has been written anywhere.**
    - Press `Ctrl+Z` in the **first** file. The replacement reverses, and that editor goes dirty —
      which is the ordinary consequence of undoing past a save, not a bug. Saving it again puts the
      replacement back.
    - Read the notice the commit raised. It reads *"N of M files changed — X on disk, Y in open
      editors with unsaved changes"*, and **Y counts only the file you had already edited**. The old
      wording counted every open file as unsaved, which this change made false.
    - The confirmation about writing files with no in-app undo is **unchanged** (FR-086b): a saved
      document is still undoable from its own history, so saving it does not earn a new warning, and a
      commit where every file has an editor open still asks nothing.

22. **The list says the double-click is there (FR-085).** Move the pointer slowly over a **folder**
    heading, a **file** heading and a **result row**: each shows a **pointer** cursor and takes a hover
    fill — the same pair the file tree uses, so the two surfaces should feel identical. Nothing else in
    the panel should light up on the way past. Now click another application so throng's window loses
    focus, and hover the same rows without clicking: **no fill appears** on the blurred window. Finally
    check the toolbar's toggle buttons — the selected one keeps its own engaged colour and must not be
    wearing the hover fill.

23. **The replace summary notice has its own two settings (FR-082, FR-082b).** Open the cog →
    **Settings** → **Search · Find in Files**. It now lists **eight** settings, not six; the last two
    are **Replace summary notices** and **Replace summary notice duration**.
    - As shipped the mode is **Dismiss only**, and the duration below it is **greyed out** — present,
      because the value is kept, and inert, because nothing reads it while the mode is not *Display
      for*. Run a replace: the notice stays until you dismiss it.
    - Switch the mode to **Display for**. The duration comes alive at **5000 ms**. Drag it to its
      maximum, run a replace, and the notice sits there for a good half minute; drag it to its
      minimum, run another, and it is gone almost at once. You are comparing two obviously different
      durations, not timing one.
    - Switch the mode to **Never display**. You are **asked to confirm first**, and told what it
      costs — this notice is also how a failed write reports itself. Accept, run a replace, and no
      notice appears; the outcome is still in the log under the user-data `logs` folder.
    - **These two override the global settings for this one notice.** Set **Notifications → Error** to
      *Dismiss only*, leave *Replace summary notices* on *Display for*, then cause a replace to fail
      (make one of the target files read-only before committing). The failure notice follows the
      **Find in Files** setting and times out — the global preference is not consulted here at all.
      That is deliberate, and it is the cost FR-082 records rather than an oversight.


### Added by round four

One request: *a context menu option that lets us open the file that the results are found in, in
either the last active editor, or a new editor, or in another tab — the same options that are
available in the file explorer.* Two steps, both of which end on a state that stays put.

24. **A result opens where you send it (FR-087, FR-087a, FR-087c).** Run a search that lists matches
    in at least two files, and make sure the tab has an editor panel in it with some other file open.
    - **Right-click a match row.** The menu now has an **Open In** item in the same group as *Change
      scope*. Hover it: three targets, and they are the file tree's three, word for word — **Last
      Active Editor (<name of the editor panel>)**, **New Editor**, and **Other Tab** if a second tab
      exists. Compare it against a file's own menu in the Files & Folders pane; the wording, the
      order and the greying should match.
    - **Choose Last Active Editor.** The file opens in the panel the row named — not the first panel,
      not whichever one looks active — and **the match is selected**, not merely scrolled to. That
      selection is the part worth looking at: opening the file at the top would be a different and
      much less useful feature.
    - **Right-click a match in the SAME file again.** *Last Active Editor* is now **greyed**, because
      that editor already holds this file and opening it there would do nothing. *New Editor* is
      greyed too, for a different reason — the file is open, and throng keeps one buffer per file.
    - **Right-click a match in the OTHER file.** Both targets come back to life. The two greyings are
      independent, and this is the step that shows it.
    - **Choose New Editor** on that second file. A new editor panel appears with the file in it and
      the match selected. Right-click the same row once more: *New Editor* is greyed, *Last Active
      Editor* is greyed as well, since that new panel is now the last active one and holds the file.
    - **With two tabs open, choose Other Tab → the other tab's name.** The tab activates and the file
      opens there, at the match. The list names the OTHER tabs only — the one you are standing in is
      never offered, because that is where an ordinary double-click already puts things.

25. **Open In is drawn, and greyed, when the menu is not about a row (FR-087d).** Right-click a match
    row first so the menu has something to be about, press `Escape`, then right-click each of these in
    turn: **a group heading**, **the search box**, and **the status line at the bottom of the panel**.
    - Each time, **Open In is still there and greyed** — it does not disappear and reappear as the
      pointer moves. That is the same rule *Replace in File* and *Replace Match* follow two rows
      above it, and for the same reason: a menu that changes shape depending on where in the panel you
      opened it teaches you nothing about what the panel can do.
    - A **group heading names a file on screen**, so this is the one that looks wrong at first
      glance. It is deliberate: the heading never becomes the row the menu is about, exactly as it
      never becomes the target of *Replace in File*. Only a match row does.


### Added by round five

One request: *Open In → Search → Find* and *Find & Replace* on the tree's files and folders, opening
or refreshing the current tab's panel into a cleared state with the scope filled, and a scope box
that accepts a file's full path. Four steps, and each one ends on a state that stays put.

26. **Search from the tree (FR-090, FR-090b).** Right-click a **folder** in Files & Folders, then open
    **Open In**. The last entry is **Search**, below Terminal. Hover over it and there are two items,
    **Find** and **Find & Replace**.
    - Choose **Find**. The Find in Files panel opens in this tab, or is reused if one is already
      here. The scope box shows the folder, the search box is empty and has the caret, and the
      replace row is hidden. Nothing has been searched: the status line does not say *No matches*.
    - Right-click a **file** and choose **Open In → Search → Find & Replace**. The same panel is
      reused. Its scope now shows the file, and the replace row is showing. The caret is in the
      **search** box, not the replacement box, because there is nothing to replace yet.
    - Right-click the empty space below the tree, which is the project root. **Open In → Search** is
      there too, and scopes to the whole project.
    - The old top-level **Find in Files** row near *Collapse All Children* is **gone**. It moved; it
      was not duplicated.

27. **A busy panel is emptied, not re-run (FR-091).** In the panel, search for a term that matches in
    several files. With replace on, type a replacement. Then right-click any folder and choose
    **Open In → Search → Find**.
    - The term and the replacement are both empty, and every row is gone.
    - No search runs, even after you wait. Before this round, this route kept your term and
      searched again in the new place.
    - Type the term again. The panel searches the **folder** the tree just set; its rows are all
      inside it. Now press the explorer **toolbar's** Find in Files button. That route keeps your
      term and searches again, as it always has, but now across the **whole project**. Rows appear
      from outside the folder, and the scope box empties to *Whole project*. Before this round, the
      toolbar kept searching the folder the tree had last set.

28. **A single file as the scope (FR-092, FR-092b).** Find a file you know contains a word several
    times, next to other files that contain it too.
    - Right-click the file, choose **Open In → Search → Find**, and type the word. Only that file is
      listed, with every occurrence in it. Before this round, a file typed into the scope box always
      reported **No matches**, whatever it held.
    - Right-click the file, choose **Copy Path → Absolute (Windows)**, and paste that full path into
      the scope box in place of what is there. Run the search. You get the same result: a full path
      inside the project is the same scope as its relative form.
    - Type `src/` with a trailing slash, or use backslashes, and run. The rows read `src/…`, not
      `src//…`.

29. **A path outside the project is refused (FR-092b, FR-070).** Type a full path to a folder
    elsewhere on the machine, such as `C:\Windows`, into the scope box and run.
    - The scope control says the folder is **outside the project**, and nothing is searched. The
      rows you already had stay listed.
    - Before this round, the same path was reported as *Scope missing*, which named the wrong
      problem.

## When something is wrong

Report it as ordinary feedback against the step number above. `speckit-iterate` maps a complaint back
to the step, the requirement behind it and the test that should have caught it, amends the spec
additively, and hands the build back — which is the other reason these steps are numbered.
