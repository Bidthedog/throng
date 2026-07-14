# Feature Specification: Advanced Editor — Rich Code Editing (Part 1): Syntax Highlighting, Language Detection & Editing Essentials

**Feature Branch**: `016-advanced-editor`

**Created**: 2026-07-08

**Status**: Ready for implementation *(spec, plan, tasks and a 16/16 quality checklist are complete)*

**Input**: User description: "Enhancements to the code editor: right-click context menu (copy/cut/paste),
Ctrl+X = cut line, syntax highlighting for all common languages (detect the language first, then apply the
appropriate highlighter, abstracted so highlighters are pluggable), tab-or-space indentation per file type,
and (later) IntelliSense, go-to-definition, find-references and symbol rename. If complex, do one at a
time — syntax highlighting first." *(Detection was subsequently narrowed to **file extension only** — see
Clarifications, Session 2026-07-09.)*

## Overview

This feature begins **"Rich code editors"** (ROADMAP → *Files & editors*) — layering real code-editing
capability onto the plain-text **Editor Panel** delivered in feature 006. Feature 006 deliberately shipped
the cross-platform editing fundamentals (encoding/line-ending fidelity, confined save, one-buffer-per-file,
recovery, cross-window sync) with **syntax highlighting and language features explicitly deferred**
(006 FR-004). This feature delivers the **first** of those deferred capabilities.

Scope is set by the 2026-07-08 clarification: **Part 1 = syntax highlighting + language detection, plus the
low-cost editing essentials that make the editor feel finished — a content-area right-click menu
(cut/copy/paste), Ctrl+X "cut line", per-language tab/space indentation, and (added 2026-07-10) **column
(rectangular block) selection**.** The heavier
language-intelligence features the user also listed — **IntelliSense, Go to Definition, Find References, and
Symbol Rename** — require language-server integration and are a **separate, larger undertaking**; they are
**out of scope here** and tracked as a following increment (see [Out of Scope](#out-of-scope) and
Dependencies).

The headline of Part 1 is **language-aware syntax highlighting** for the common languages the user works in.
Critically, highlighting is driven by a **language-detection step that runs first**: the editor decides
*what language a document is* — from the file's **extension** — and only then selects the matching
**highlighter**. Detection and highlighter selection are structured as an **extensible language registry**
(one descriptor per language) so new languages can be added without reworking the editor. This is the
"detect first, then render" pattern the user asked for. Detection **does not inspect document content**
(2026-07-09 clarification); where an extension is absent or wrong, the user applies a **manual language
override**.

The editor being enhanced is the existing Editor Panel component; this feature adds capability to it and does
**not** introduce a second editor. Part 1 is **mostly** renderer-side editor behaviour plus a small amount of
per-language configuration — but it is **not** renderer-only, and the original scoping's "no new daemon RPC, no
schema change" claim did not survive clarification. It adds a **document authority in UI main** — the single
owner of a document's canonical text and version, which **replaces** 006's peer-to-peer whole-document
relay and is what constitution **Principle XI** (v3.15.0) requires (FR-028f) — an app-global
**clipboard-mode record** (main-process, in-memory — FR-015c), a **contract-tested clipboard platform
abstraction** (its one OS seam — FR-013a), a new **keyed-table control** in feature 007's shared Settings
editor (FR-022a), a **dispatch scope** on the shared keybinding model (FR-017b0), and
**two data-schema changes**: a **persisted undo history** in 006's recovery snapshot (FR-027a) and a
**per-document-state table** in the SQLite store, reached by new **daemon RPC** and delivered as a versioned
migration (FR-028e). Every one of these was surfaced by a **later clarification** rather than the original
scoping — see [Assumptions](#assumptions).

## Clarifications

### Session 2026-07-08

- Q: The user listed seven editor enhancements and said "if complex, do one at a time — syntax highlighting
  first." What is the scope of this feature? → A: **Part 1** = **syntax highlighting + language detection**
  **plus** the low-cost editing essentials *(three at the time; **column selection** was added 2026-07-10)*
  (**content right-click menu with cut/copy/paste**,
  **Ctrl+X = cut current line**, **per-language tab/space indentation**). The language-server-dependent
  features (**IntelliSense, Go to Definition, Find References, Symbol Rename**) are **deferred** to a later
  feature — they are a much larger undertaking (running/bundling language servers, a language-client
  protocol per language) and are recorded on the roadmap, not built here.
- Q: How is a document's language chosen? → A: *(Superseded by the 2026-07-09 clarification below —
  detection is now **file extension only**.)*
- Q: Should users be able to correct a wrong guess? → A: **Yes** — the user can **manually set/override the
  language** for the active editor; the override applies immediately and persists for that editor.
- Q: Do syntax colours become per-theme, per-token editable in this feature? → A: *(**Superseded 2026-07-12** —
  they **are** theme tokens after all; see FR-007b. The original answer was **No**: Part 1 would ship a
  "built-in, theme-aware highlight style" legible on every bundled theme, with per-token colours deferred as a
  later enhancement. That was **rejected on re-examination**: a single palette **cannot** be legible on both
  Matrix (green-on-black) and Light (dark-on-white), so it must resolve to per-theme values regardless — at
  which point they are tokens in all but name, and unowned, un-tunable ones at that.)*
- Q: How is a Jupyter Notebook (`.ipynb`) handled by a *code* editor? → A: **Highlighted as its raw JSON
  document.** A rich per-cell notebook view (rendering/execution) is **out of scope**; the file opens as the
  JSON it is on disk, with JSON highlighting.
- Q: The context menu the user wants — is it the same as 006's panel menu? → A: **No, it is separate.**
  006 already provides a **panel-header** right-click menu (Save / Revert / etc.). This feature adds a menu
  on the **editor content area** offering **text-editing** actions (Cut / Copy / Paste / Select All /
  Undo / Redo). The two menus MUST NOT be merged or collide.

### Session 2026-07-09

- Q: Is the indentation configuration keyed by file extension or by the detected language? → A: **By
  **detected language id**.** File extensions map to a language through the language registry (the single
  source of truth), so the *effective* language — including one set by a manual override — selects the
  indentation profile. A **single global default applies to every language unless that
  language overrides it: 2 spaces per indent.** Per-language overrides ship only where the language's
  community convention differs (e.g. tabs for Go, 4 spaces for Python). Files with no detected language
  (plain text) use the global default.
- Q: How long, and how widely, does a manual language override apply? → A: *(**Superseded by the 2026-07-12
  clarification below** — the override is a property of the **document**, persisted **keyed by the file**, and
  applies to **every** panel showing that file. The original answer scoped it **per panel** with a *different*
  panel detecting independently, which would have let two panels insert **two indentation styles into one
  shared buffer**. See FR-028/FR-028b.)*
- Q: When is language detection re-evaluated, and does it inspect document content? → A: **Detection is
  **file-extension only** and runs **once per document identity**.** Content sniffing (shebangs, `<?php`,
  doctypes, keyword heuristics) is **removed from scope** — it is a performance and correctness risk for
  large documents and adds no value given the manual override exists. Detection therefore runs when a
  document is opened and again only when its **identity or on-disk content is replaced** (rename, Save-As,
  revert, external reload) — **never while typing**. A file whose extension is unknown, absent, or wrong
  opens as **plain text**; the **manual override (FR-010) is the sole correction path**.
- Q: Where is the manual language override surfaced? → A: **Both** a **persistent language indicator** on
  the Editor Panel (always showing the document's effective language, clickable to open a searchable language
  picker) **and** a **"Set Language…" item in the editor content context menu** that opens the same picker.
  Accepted cost: the indicator is new UI chrome, so this feature also introduces its **theme tokens** (with
  the theme-metadata descriptors + completeness test the constitution requires).
- Q: What happens when a line cut with Ctrl+X (no selection) is pasted? → A: **Line-aware paste.** A
  no-selection cut marks the clipboard as holding a **full line**; pasting it inserts that line **above the
  caret's line** as a whole line, without splitting the caret's own text. Content copied from any other
  source (or from a selection-cut) pastes normally at the caret. The full-line marker is invalidated whenever
  the clipboard changes from another source, so pasting into or out of another
  application degrades cleanly to plain text plus a trailing newline. *(The marker's **scope** was originally
  drafted as "view-local"; **superseded 2026-07-11** — it is **application-global**, see FR-015c.)*
- Q: Are the new editor commands user-rebindable? → A: *(Superseded by the 2026-07-10 clarifications below —
  **seven** commands are registered and rebindable: `cut-line`, `indent-lines`, `outdent-lines` and the four
  `column-select-*`. The clipboard actions remain on their **native OS bindings** and are not registered, as
  this answer originally held.)*
- Q: What is the scope of the indentation configuration? → A: **User-scoped only.** It extends the existing
  user `editor` settings (global default + per-language overrides); there is **no project-scoped override**
  and **no new storage**. **`.editorconfig` support is explicitly planned as a future feature** — when it
  lands it will cascade over these user settings — but it is **not** part of Part 1.
- Q: Does the editor adapt to a file's existing indentation? → A: **Yes — infer on open.** The editor samples
  the **first 10% of the document's lines** *(bounded on 2026-07-10 to at most 100 lines, inspecting each
  line's first 20 characters — see FR-018c)* and, if a clear indentation style emerges, adopts it for that
  document **in preference to the configured profile**. If no clear style emerges (no indented lines in the
  sample, or an ambiguous result), it falls back to the effective language's configured profile. Inference
  governs only **newly typed and auto-inserted** indentation — it never rewrites existing lines.
- Q: Where does the language indicator sit? → A: In a **status strip along the bottom of the Editor Panel**,
  with the language label **right-aligned**. It is deliberately **not** in the panel header (which already
  owns 006's Save/Revert context menu, FR-014) and **not** a floating overlay. The strip is the intended home
  for further per-document status (encoding, line endings, cursor position) in later features.
- Q: Can two languages claim the same file extension? → A: **No** — no extension may be claimed by two
  languages, enforced by a registry test, so extension-only detection is deterministic. *(Refined 2026-07-10:
  the map is **many-to-one** — one language may claim many extensions; only the reverse is forbidden.)*
  Genuinely ambiguous extensions
  are resolved by fiat in the built-in registry (**`.h` → C++**, the safer superset). **The user MUST be able
  to override the extension→language mapping in settings** (e.g. remap `.h` to C), applying to every project
  and every panel. Precedence, highest first: **manual override (FR-010) → user extension mapping
  (settings) → built-in registry mapping → plain text.** *(The override was described here as **per panel**;
  **superseded 2026-07-12** — it is a property of the **document**, persisted keyed by the file, see FR-028b.
  The precedence order itself is unchanged.)*

### Session 2026-07-10

- Q: What do Tab and Shift+Tab do when a selection is active? → A: **Block indent/outdent.** With
  a selection, **Tab indents every selected line** by one unit of the effective indentation and **Shift+Tab
  outdents** them; with no selection, **Shift+Tab outdents the caret's line**. *(The "intrinsic, not a
  registered command" half of this answer was **superseded later the same day** — see the command-registration
  clarification below: indent/outdent are **registered, rebindable commands**.)*
- Q: How wide does a literal tab character render? → A: **A separate tab display width**, distinct from the
  indent width. The indentation profile carries **style**, **indent width** (for spaces), and **tab display
  width** (columns a `\t` occupies on screen). Global default **4 columns**, with per-language overrides,
  user-scoped and exposed in the Settings editor per FR-022. It governs **rendering only** — it applies to
  every `\t` in the document regardless of the document's inferred or configured indent style, and never
  rewrites the file.
- Q: What does right-clicking do to the caret and selection before the content menu opens? → A:
  **Preserve-if-inside, else move caret — and Cut/Copy with no selection act on the current line.**
  Right-clicking **inside an existing selection** leaves it intact; right-clicking **outside** it collapses
  the selection and moves the caret to the click point. With **no selection**, the menu's **Cut** cuts the
  caret's whole line (identical to `cut-line`, FR-015) and **Copy** copies the caret's whole line — **both
  set the full-line clipboard marker** (FR-015a), so a subsequent paste inserts a whole line above the
  caret's line. Neither is ever disabled for want of a selection.
- Q: Is the 10% indentation-inference sample bounded on large files? → A: **Yes — capped.** The sample is
  `min(ceil(10% of lines), 100)` lines, never fewer than one, and only the **first 20 characters** of each
  sampled line are inspected. A line whose leading whitespace extends **beyond** those 20 characters yields
  **no usable width** and is **excluded** from the width tally (it must not be counted as width 20); a **tab**
  within the inspected prefix still forces the **tabs** style. Inference cost is therefore **bounded and
  independent of document size**, protecting the open path (FR-008, SC-003).
- Q: Must this feature's new controls (language indicator, language picker, content menu) be keyboard-operable?
  → A: **No — deferred.** Part 1 imposes **no accessibility requirement**; the new controls are
  pointer-driven. **Full keyboard-only support** is a **cross-cutting concern** to be addressed app-wide in a
  later feature rather than piecemeal per feature — tracked on `ROADMAP.md` and as GitHub issue
  [#26](https://github.com/Bidthedog/throng/issues/26). This is a deliberate, recorded trade-off, not an
  oversight.
- Q: What exactly counts as "the extension", and how are compound extensions resolved? → A: **Many-to-one
  mapping, longest declared suffix wins.** A language descriptor MAY claim **many extensions** (`.ts` and
  `.d.ts` both → TypeScript); the uniqueness rule of FR-004a is that **no single extension may be claimed by
  two languages** — it constrains the extension, not the language. Matching is against **dot-prefixed
  suffixes**, case-insensitively, and the **longest declared suffix wins** (`types.d.ts` resolves `.d.ts`
  ahead of `.ts` when both are declared, which matters once a user mapping points them at different
  languages). A filename whose **only dot is its first character** (`.gitignore`, `.env`) or that **contains
  no dot** (`Dockerfile`) has **no extension** and opens as **plain text** in Part 1. **Exact-filename
  descriptors** — highlighting `.gitignore`, `.env` and `Dockerfile` by name — are a **planned future
  extension of the registry**: the descriptor shape MUST accommodate them without a breaking change, but they
  are **out of scope** here.
- Q: How do cut-line, full-line paste and block indent/outdent behave with **multiple cursors**? → A:
  **Per-cursor semantics; FR-016 is unchanged.** Ctrl+X remains a standard cut: **each cursor that has a
  selection cuts exactly that selection**; **each bare caret cuts its whole line**. Where every cursor is a
  bare caret, their lines are cut in **document order, joined by a single newline**, and the entry is marked
  **full-line**; a full-line paste inserts a whole line above **each** caret's line. Block indent/outdent
  applies to **every line any cursor or selection touches**, each line indented once regardless of how many
  cursors sit on it. Partial selections are **never** expanded to whole lines.
- Q: Is **column (rectangular block) selection** part of Part 1? → A: **Yes — in scope.** The editor MUST
  support rectangular selection by **Alt+click+drag** and by **Shift+Alt+Arrow** keys, cut/copy of the block
  to the OS clipboard with its rows **joined by the document's line ending**, and **column-wise paste** back.
  This introduces a **third clipboard mode** (rectangular) alongside verbatim and full-line, and **four new
  registered, rebindable commands** (`column-select-up` / `-down` / `-left` / `-right`), widening
  FR-017a/FR-017b — `cut-line` is no longer the only registered command. The mouse gesture is not a command.
- Q: If `cut-line` is rebound, what does Ctrl+X then do — and which editor actions are registered commands
  versus native behaviour? → A: **One command, both behaviours; register the non-OS actions only.**
  `cut-line` **is** "cut the selection, or the whole line(s) where a cursor has no selection" (FR-015 +
  FR-016 + FR-016a) — a single command whose **default binding** is Ctrl+X. Rebinding it moves that entire
  behaviour to the new chord, and **Ctrl+X reverts to the editor's native cut** (selection only). The
  commands this feature **registers** are the ones with **no OS equivalent**: `cut-line`, `indent-lines`
  (default **Tab**), `outdent-lines` (default **Shift+Tab**), and the four `column-select-*` — **seven** in
  total. The **clipboard actions** (Cut/Copy/Paste/Select All/Undo/Redo) keep their **native OS bindings**
  and are **not** registered, so they interoperate with the rest of the system. *(This supersedes the earlier
  "Tab-to-indent is intrinsic" ruling above.)* **Terminal Panels are unaffected** — their key handling stays
  PTY passthrough per feature 005, since Ctrl+C/Ctrl+D/Ctrl+X must reach the shell.
- Q: How do the new editing behaviours participate in undo/redo? → A: **One command, one undo step.** Each
  invocation of `cut-line`, `indent-lines`, `outdent-lines`, a **paste** of any clipboard mode (verbatim,
  full-line, rectangular), or a **type-replace** over a rectangular selection MUST be a **single atomic undo
  entry**, however many lines or cursors it touched — a ten-row column paste is undone by **one** Undo, not
  ten. Undo MUST restore the document **and** the prior selection/cursor set, and redo MUST reapply the whole
  command.
- Q: In a cross-window **synced** editor, is the undo history per view or per buffer? → A: **One buffer, one
  shared undo history.** Since synced views mirror a **single shared buffer** (006 FR-034), they share **one
  undo stack** — Undo in any view reverts the most recent change made in **any** view. Per-view stacks are
  ⚠ **The premise of this answer was false, and the answer is right anyway — see FR-026c and FR-028f.** Synced
  views do **NOT** mirror a single shared buffer: 006 relays `{text, dirty}` between **two independent
  `EditorView`s, each with its own `history()`**, so they have **separate** undo stacks *today*. There was no
  shared buffer to inherit a shared stack from. The conclusion below stands — one document, one stack — but it
  is something this feature must **build** (a single authority in UI main, **FR-028f**), not something it can
  assume. *(Corrected 2026-07-12 against the shipped code, and given its mechanism 2026-07-13.)*
  **rejected**: they would let one view revert a range another view had already moved, corrupting the shared
  buffer, and making them safe would require operational transforms far beyond Part 1's scope. Only one view
  is typed into at a time in practice, so a shared stack is both safe and sufficient. *(This replaces the
  "per-view editing history" wording originally drafted into FR-026b.)*
- Q: What happens when a keybinding collides — either between shipped defaults, or when the user rebinds? → A:
  **Enforce defaults at build time; user conflicts follow 007's existing rule.** An automated test MUST assert
  that **no two registered commands ship the same default chord**, app-wide (extending the keybinding
  completeness test), so this feature's seven defaults — Ctrl+X, Tab, Shift+Tab, Shift+Alt+Arrow ×4 — MUST be
  verified against every binding shipped by features 003–007. *(**Superseded 2026-07-12 (twice).** The test is
  now **enumerated from the command registry**, never from a list of features — a list silently omits whatever
  merges next, as 012/013/014 did — and it is **scope-aware**: two commands clash only where their dispatch
  scope **sets intersect**, so `cut-line` and the Explorer's `file.cut` may both keep Ctrl+X. See
  FR-017b0/FR-017b1.)* **User-created** conflicts are already governed
  by **007 FR-034**: the Key Bindings editor warns and requires an explicit **Reassign** or **Cancel**, never
  silently stealing a chord — this feature adds nothing there and MUST NOT introduce a last-writer-wins path.
- Q: When a rectangular paste lands past a short line's end, what character pads the gap? → A: **The
  document's effective indentation character**, not always spaces. Where the effective style is **spaces**,
  pad with spaces. Where it is **tabs**, pad with **tabs up to the last whole tab stop at or before the target
  column, then spaces for the remainder** — which is both column-exact and consistent with the document's
  existing whitespace, so a tab-indented file never silently gains space runs. Padding is inserted **only**
  where a line is shorter than the paste column, and **never rewrites existing content**.
- Q: What happens when a **persisted language id no longer resolves** (upgrade, hand-edited file)? → A:
  **Degrade to plain text, preserve the id.** An unresolvable id — in a document's manual override (FR-028b), or in a user
  extension mapping — is treated as **no language**: that rung of the precedence chain (FR-005a) contributes
  nothing and resolution continues down it, which in practice yields **plain text** (a removed language is
  usually unresolvable at every rung). The indicator reads whatever the effective language is, no error is
  raised, and the **stored id is left untouched**, so a later version that
  reintroduces that language resolves it again automatically. The settings editor MAY flag such a mapping as
  unresolved. Deleting the stored value is **rejected** (it would silently discard the user's intent), as is
  refusing to open the panel (it would block a workspace from restoring).
- Q: Which clipboard mode results when `cut-line` runs over a **rectangular** selection? → A: **The selection
  decides the mode, not the command.** Cutting or copying a **rectangular selection** yields a **rectangular**
  entry whichever action performed it (`cut-line`, the content menu's Cut/Copy, or native Ctrl+X/Ctrl+C).
  Ordinary selections yield **verbatim**; **bare carets only** yield **full-line**. A mixed set (some
  rectangular rows, some ordinary selections), if constructible, yields **verbatim**. This keeps FR-016a and
  FR-025e consistent — paste behaviour follows what the user selected, not which key they pressed.

### Session 2026-07-11

- Q: The 23 language targets of FR-001 omit every **data, markup and config** language (JSON, YAML, XML,
  Markdown, TOML, INI, SQL), yet FR-009 requires `.ipynb` to be highlighted **as JSON** — a highlighter the
  registry never declares. Should they be added? → A: **Yes — add them.** FR-001 now names **31** targets:
  the original 17 programming languages, 6 markup/styling (adding **XML**), and 8 data/config/documentation
  (**JSON**, **JSONC**, **YAML**, **TOML**, **INI**, **Markdown**, **SQL**, and Jupyter Notebook as JSON).
  The omission was an oversight, not a decision: it left `package.json`, `tsconfig.json`, `.yml`, `.md` and
  throng's **own** settings/keybinding/theme files (all JSON, per feature 007) rendering as **plain text** in
  a feature whose entire purpose is rich code editing, and it left FR-009 mandating a JSON highlighter that
  FR-001 did not declare (**FR-001a**). The marginal cost is low — these are stock language packages from the
  editor's existing ecosystem (Assumptions), so the work is **registry descriptors and test fixtures**, not
  new engineering.
- Q: The full-line and rectangular clipboard markers were specified as **view-local**. Cutting a block in one
  panel and pasting it into another would therefore lose the mode and paste verbatim. Is that intended? → A:
  **No — the marker is application-global (FR-015c).** Copying text in throng MUST let you paste it **anywhere
  else in throng** *or* **any other OS-level application**. The mode belongs to the **content throng last
  copied**, not to the widget that copied it: one in-memory record (last-written text + mode) shared by every
  panel in every window, **validated against the live OS clipboard on each paste** so any change by another
  source falls back to verbatim automatically. The OS clipboard itself still carries **plain text only** in
  both directions, so interoperability is unchanged. View-local markers are **rejected**: they would have
  silently broken the feature's primary use case — moving a column block from one file to another. Accepted
  cost: a small **main-process** in-memory record plus IPC (still **no daemon RPC, no schema change, not
  persisted**).
- Q: The extension→language overrides and the per-language indentation overrides are **keyed maps** (the
  latter, a map of *objects*), but the Settings editor's control vocabulary — **thirteen** kinds as shipped
  *(corrected 2026-07-12: 007 FR-028 listed six; `ControlKind` has since grown `colour`, `font-family`,
  `font-size`, `enum`, `chord`, `icon` and `folder`)* — contains **none that can render a keyed map**. How
  is FR-022 satisfied? → A: **Add one new generic control type — a keyed-table (map) editor** (**FR-022a**).
  It is declared in the **shared editor-metadata registry** (007 FR-025a) as a new control type and
  rendered from a descriptor like every other control: add/remove rows, a key column, and one or more typed
  value columns that reuse the existing controls. One control serves **both** settings (extension → language
  dropdown; language → style dropdown + two number inputs) and is **reusable** by later features needing a
  keyed map (the `.editorconfig` cascade, FR-018b). Two bespoke hand-rolled panels were **rejected** (more
  code, and they would bypass the metadata registry the completeness test depends on), as was flattening the
  indentation overrides into ~93 per-language descriptors. **Accepted cost:** this is **shared-component work
  in feature 007's Settings editor**, the only cross-feature engineering cost in Part 1 — the direct
  consequence of the constitution's ban on JSON-only configuration.
- Q: FR-025e defined only **typing** over a rectangular selection. What do **Delete/Backspace**, **Enter**, and
  **Paste** do with a block active? → A: **Per-row semantics throughout, with line-count matching on paste**
  (**FR-025g**, **FR-025h**). A block *is* one selection per row, so every operation applies per row:
  Delete/Backspace remove the block's characters on every row (a cut without the clipboard; on a **zero-width**
  block they delete one character left/right of each caret), and Enter, like any typed character, replaces
  every row — all as **one atomic undo entry**. **Paste** replaces the block **by clipboard mode**: a
  *rectangular* entry row-for-row; a *verbatim* entry **distributed one line per row when its line count equals
  the block's row count**, else the whole content into every row; a *full-line* entry collapses the block and
  inserts above. The line-count rule is the decisive one: content copied in **another application** necessarily
  arrives **verbatim** (the OS clipboard carries no rectangular signal — FR-015c), so without it, column data
  could only ever travel **out** of throng and never **in**. It also matches Notepad++ and VS Code, so it
  reads as native rather than clever.
- Q: **Feature 012 (Focus contexts & per-panel zoom)** merged after this spec was written, and now owns the
  per-window **active panel** context that routes keyboard input. FR-024 still cites **006**'s active-pane
  model. How do the two relate? → A: **012 is a hard dependency; depend on it explicitly.** FR-024 is restated
  against 012's **active-panel** focus context (it, not 006, decides whether a keystroke reaches an editor);
  the seven registered commands are **panel-scoped to the active Editor Panel** (**FR-024a**); 012's
  window-level chords (move-focus, zoom) **take precedence** over this feature's editor-scoped commands
  (**FR-024b**) — an editor MUST NOT swallow a move-focus chord — and FR-017b1's build-time chord test MUST
  now also cover 012's bindings (the shipped defaults do not collide: 012 uses **Ctrl+Alt+Arrow**, this feature
  **Shift+Alt+Arrow**). The status strip **adopts 012's dimmed-inactive treatment and reuses its focus-state
  tokens** (**FR-010g**) rather than inventing a parallel set — a strip left brightly lit while every other
  panel in a background window dimmed would contradict 012's two-state indicator. 012 is added to
  **Dependencies**.
- Q: The spec never mentions **reset**, yet feature **010** ships a defaults record + restore API and **007**
  exposes reset-to-default / reset-all. What does resetting the two **keyed-map** settings do — especially as
  their shipped defaults differ (the extension map ships **empty**; the per-language indentation overrides ship
  **non-empty**)? → A: **A map is one setting; reset restores the whole map from 010's shipped-defaults
  record** (**FR-022b**). That correctly **clears** the extension→language overrides (falling back to the
  built-in registry, which is not a setting) and correctly **repopulates** the per-language indentation
  overrides (Go → tabs, Python → 4 spaces). **Per-entry granularity needs no new affordance**: an override
  entry's default is its **absence**, so the keyed-table control's **remove-row** already is a per-entry reset —
  a separate "reset this row" control was **rejected** as duplicative. Defaults MUST be **sourced from 010's
  record**, never hard-coded a second time. **Feature 010** is added to **Dependencies**.
- Q: FR-008 and SC-003 rest on unmeasurable adjectives — "responsively", "perceptible", "effectively
  instantly", "typical source files" — and a **MAY degrade gracefully** with no trigger condition. What is the
  testable rule? → A: **Viewport-scoped cost plus hard budgets** (**FR-008**, **SC-003**). Highlighting cost
  MUST be a function of the **visible region, not document size**, so **every** file the editor opens is
  **fully highlighted**: there is **no** second highlighting threshold, **no** "too big to highlight" mode, and
  the "MAY degrade" branch is **removed** (with cost bounded by the viewport there is nothing to degrade to).
  The budgets — asserted against the **largest** permitted file, not a "typical" one — are: **first highlight
  within 200 ms** of render; **no main-thread highlighting task over 50 ms**; **typing adds ≤ 16 ms** (one
  frame at 60 Hz, i.e. no dropped frame). Stated as an **outcome**, not an implementation: the requirement is
  the cost curve and the budgets, not how the editor achieves them.
- Q: FR-026c gives a buffer **one** undo history, but never says how long it lives or how deep it grows. Does
  undo survive a **save**? A **revert/external reload**? Closing the **last panel**? Is the depth bounded? → A:
  **The history's lifetime is the buffer's lifetime, and its depth is bounded** (**FR-026d**). It **survives a
  save** — undo past a save is permitted and simply marks the document dirty again (saving is **not** an undo
  barrier) — and survives views opening, closing or moving between windows while **any** view remains. It is
  **cleared** when content is **replaced from disk** (revert / external reload — the history describes a
  document that no longer exists, and undoing into it would resurrect stale content) and when the **last view
  closes** and the buffer dies; it is **never persisted** across a restart. Depth retains **at least 500
  entries**, discarding the oldest, so memory cannot grow without limit. The bound is deliberately **fixed
  rather than user-configurable**: making it a setting would drag in a descriptor, Settings-editor exposure and
  completeness-test coverage (FR-022) for a knob almost nobody turns.
- Q: FR-004b says the extension map accepts "any **supported language**" — does **Plain Text** count, letting a
  user globally switch highlighting **off** for an extension? → A: **Yes — "Plain Text" is a first-class value
  in the map** (**FR-004c**), as it already is in the per-panel picker (FR-011). Without it a user could
  globally *change* an extension's language but never globally *remove* its highlighting, forcing a per-panel
  override on **every** open of a `.md` or `.log` file. Critically, an explicit Plain Text mapping is an
  **authoritative decision that terminates precedence** (FR-005a) — it MUST NOT be treated like an
  **unresolvable** id (FR-005b), which falls through to the next rung; if it fell through, the built-in
  registry would silently re-apply the highlighting the user had just switched off.
- Q: FR-023/FR-025b assume **one** "document line ending". What happens with a **mixed** file, and with pasted
  text carrying **foreign** line endings? → A: **One effective line ending; always the destination file's**
  (**FR-023a**). The effective ending is 006's per-document ending — for a mixed file, the **dominant** one
  (ties → first encountered). **Every** line ending this feature writes uses it (full-line cut/paste,
  rectangular row-join and column paste), and **incoming pasted text is normalised to it**, so pasting LF text
  into a CRLF file cannot silently make the file mixed and churn the user's next diff. **throng must never be
  the cause of a mixed-line-ending file.**
  **But throng MUST NOT normalise a file that is *already* mixed** (**FR-023b**). The user's position — "a
  document should never have mixed line endings" — is right about what throng should *create*, but
  auto-repairing existing files was **rejected**: it would rewrite **every** line, dirty the whole document and
  produce a whole-file diff on a file the user merely opened, contradicting 006's "never rewrite untouched
  lines". Mixed files do occur legitimately (Git `core.autocrlf` mishaps; and **test fixtures that deliberately
  assert line-ending handling** — which 006's own fidelity guarantee requires, and which silent normalisation
  would corrupt). Converting a document's line endings is therefore an **explicit user action**, deferred to a
  later feature (*Out of Scope*).

### Session 2026-07-12

- Q: The spec claims it introduces **no OS-abstraction seam**, but FR-015c requires reading the **live OS
  clipboard's text on every paste**, and FR-013/FR-025b write to it. Constitution **Principle II** puts *all*
  OS-specific behaviour behind abstractions and **Principle V** requires contract tests for each. Is the
  clipboard a seam? → A: **Yes — introduce a contract-tested clipboard abstraction** (**FR-013a**). The claim
  was true when the spec was written and stopped being true when FR-015c was added: deciding the paste mode is
  **core logic making a direct OS query**, precisely what Principle II forbids. The seam exposes **write text**
  and **read current text**, is consumed by every cut/copy/paste path, and carries **contract tests** so a
  future macOS/Linux implementation is a new implementation of an existing contract rather than a rewrite —
  Principle II explicitly forbids foreclosing that. throng's clipboard-**mode** record stays on throng's side
  of the seam (application state, not an OS capability) and never leaks a custom format onto the OS clipboard.
  Precedent: feature 007 introduced `IFontEnumeration` as a platform abstraction for something as modest as
  font enumeration. The **Assumptions** section's "renderer-side only" claim is corrected accordingly.
- Q: FR-008 guarantees **every** permitted file is fully highlighted within hard budgets, on the grounds that
  cost tracks the **visible region**. That reasoning collapses on a **single enormous line** — a 1 MB
  `bundle.min.js` on one line, where the visible region *is* the line. Is the guarantee achievable? → A: **No —
  add a long-line guard** (**FR-008a**). FR-008 as written **over-promised**: minified bundles and `.min.css`
  are ordinary files, 006's threshold is a **size** limit that lets them through, and tokenising a
  one-megabyte line cannot meet a 50 ms budget by any means. Any **single line over 10,000 characters** is
  therefore rendered as **unhighlighted plain text**, while the **rest of the document highlights normally**
  and the budgets still hold — the exception is scoped to a **line**, never a file. The line stays fully
  editable; only its highlighting is withheld. Disabling highlighting for the **whole file** whenever one long
  line appears was **rejected** (it would punish an otherwise normal file for a single generated line). The
  threshold is **fixed, not configurable**, for the same reason as the undo bound (FR-026d).
- Q: The seven default chords (Ctrl+X, Tab, Shift+Tab, Shift+Alt+Arrow ×4) and the Alt+click+drag gesture are
  **Windows conventions**, but constitution **Principle II** says *no design decision may foreclose* a future
  macOS or Linux implementation. How are they declared? → A: **Platform-keyed defaults; ship Windows values
  only** (**FR-017e**). The chords are **not** portable — on macOS the clipboard modifier is **⌘** and the
  column-select modifier is **Option** — so declaring them flat in 010's shipped-defaults record would make the
  macOS port a **schema change** to shipped defaults rather than an addition of **values**, which is exactly
  the foreclosure Principle II prohibits. The record is therefore **keyed by platform**, with only the
  **Windows** values populated in Part 1 and the shape able to take macOS/Linux later without a breaking
  change. No macOS/Linux chords are guessed today. *(The same "reserve the shape, ship only what is needed"
  move the spec already makes for exact-filename descriptors in FR-002b.)*
- Q: A **crash-recovery restore** (006) reinstates content that **differs from disk** — which is neither an
  "open" (FR-018c) nor a "reload from disk" (FR-018d). What happens to indentation inference, and to the undo
  history? → A: **Treat it as opening the document with the recovered content, and keep the undo history**
  (**FR-027**, **FR-027a**). Detection still runs on the **extension** and the document's manual override still
  applies (it lives in the layout, not the buffer). Indentation inference MUST sample the **recovered content,
  not the disk copy** — the disk copy is stale *by definition*, which is why recovery exists; sampling it would
  keep inserting **tabs** into a file the user had spent an hour converting to spaces before the crash.
  The **undo history now survives a crash** (user decision, **superseding FR-026d's original "never
  persisted"**): a crash is not a normal close, and the edits recovery preserves are exactly the ones a user
  needs to undo. It is therefore **persisted alongside the recovery snapshot, on the same cadence** (a crash
  affords no chance to flush), with redo and the cursor/selection sets, and **bounded by serialised size**
  (oldest dropped first) so large edits cannot bloat the snapshot or slow the writes recovery depends on. A
  recovered history may thus be shorter than the live one. **Accepted cost:** this is a **change to the
  recovery artefact's schema** — the feature's only persistence — so the spec's "no data-schema change" claim
  is corrected in **Assumptions**.
- Q: Persisting the undo history (FR-027a) writes **content that is no longer in the document** to disk — text
  the user **cut or deleted**. Cut an API key from a config file, save, and the file is clean while the key
  remains in the persisted history. Where does that data live, for how long, and can a user opt out? → A:
  **Bind it to the recovery snapshot's lifecycle, and add a setting to disable it** (**FR-027b**, **FR-027c**).
  The persisted history lives in the **same protected per-user location** as the snapshot, is **deleted
  whenever the snapshot is** (normal close; discard after a successful recovery), and MUST **never** reach
  logs, telemetry or any other location. The retention of removed text is **inherent to crash-surviving undo**
  and is **stated explicitly rather than hidden**. A user who would rather not have it MAY **turn persistence
  off**: a crash then still restores the document's **content** (006's guarantee is untouched) but with a
  **fresh, empty** history, and turning it off **purges anything already persisted**. It **defaults to
  enabled**, governs **persistence only** (the in-memory history of FR-026d is unaffected), and — being a
  configurable artefact — is a toggle in the Settings editor with a descriptor, completeness-test coverage, a
  default in 010's record and a reset path (FR-022/FR-022b). Clearing the persisted history on **every save**
  was **rejected**: it would leave a user unable to undo **past a save** after a crash, gutting the guarantee
  FR-026d/FR-027a exist to provide.
- Q: 006 gives one file **one shared buffer**, but FR-010a let a **different panel** on the same file detect
  its language **independently** — and the effective language selects the **indentation** written into that
  buffer (FR-010b). Two panels could therefore insert **two indentation styles into one file**, which FR-023a
  forbids. How is this resolved? → A: **A file open in more than one Editor Panel is ONE document in every
  respect — the panels are clones** (**FR-028**). Shared as a single value: the **buffer** and dirty state, the
  **undo/redo history**, the **effective language** (including the manual override), and the **effective
  indentation**. Changing any of them in one panel changes it in **every** panel, immediately. Indentation
  **must** be a document property because it decides which characters land in the shared buffer (**FR-028a**);
  the hazard was concrete — a **new/empty** file (nothing to infer) open in a panel overridden to **Go** (tabs)
  and another to **Python** (4 spaces) would take **both**. The **manual override therefore becomes a property
  of the document**, persisted **keyed by the file** (**FR-028b**) — **superseding FR-010a and the 2026-07-09
  "per panel, different panel detects independently" answer**, and adding a **second data-schema change**
  (Assumptions).
  **View state stays per panel** (**FR-028c**): cursor/selection, scroll position, rectangular selection and
  012's per-panel zoom. Sharing those would make a second panel show an identical view and defeat the point of
  opening one (comparing two regions of a file); true mirroring already exists as 006's **synced views of one
  panel**. The rule is intended as a **constitutional constraint** (**FR-028d**) governing any future panel
  type that can present one artefact twice — recorded here as a **required follow-up**, since amending the
  constitution is a separate governance change this specification does not perform.
- Q: The undo stack is shared per document (FR-026c) but the cursor is per panel (FR-028c) — so when Undo is
  pressed in panel **B** for an edit made in panel **A**, **whose** cursor set does FR-026a restore? And is the
  undo scope the document or the panel? → A: **Scope is the DOCUMENT; the invoking panel gets the cursor set**
  (**FR-026e**, **FR-026f**). Undo is **per document, never per panel**: two panels on **different files** have
  **entirely separate** stacks — cutting in `a.ts` and pasting into `b.ts` leaves the cut on `a.ts`'s stack and
  the paste on `b.ts`'s, undone independently, which is already the behaviour the user wanted — while two panels
  on the **same** file share that file's one stack. **Per-panel stacks over a shared buffer were rejected as
  unsound**: if panel A typed on line 1 and panel B then deleted lines 1–5, A's undo entry describes content
  that no longer exists, and applying it would corrupt the buffer; making it safe needs **operational
  transforms** — a collaborative-editing engine, far beyond Part 1. *(This re-confirms the 2026-07-10 decision.)*
  On the cursor question, the entry's recorded cursor set is applied to **the panel where Undo was invoked**, so
  the user **sees what was reverted**, while other panels keep their own cursors. Undo never yanks the viewport
  of a panel the user did not act in.
- Q: **Features 013 (in-panel search) and 014 (theme editor)** merged after this spec was written, and it names
  neither. FR-017b1's build-time chord test enumerates only "features 003–007" (plus 012) — yet 013 alone adds
  ~13 default chords. → A: **Declare 013 and 014 as dependencies, and make the chord test exhaustive over the
  command registry** (**FR-017b1**), never over a hand-listed set of features — a list-based test **silently
  omits** any feature merged after it was written and then **passes while a real collision reaches a user**.
  Enumerating the registry makes the hole unreopenable by the next feature.
  Also: chord dispatch is scoped by **input focus**, not just the active panel (**FR-017f**) — with 013's find
  bar focused, **Tab** moves within the bar and MUST NOT `indent-lines` the document; an editing command must
  never mutate the file while the user types in a search box. 013's **replace-all** ("a single undoable step")
  joins this feature's **per-document** undo stack under the same atomicity and cursor rules
  (FR-026/FR-026e/FR-026f).
  **014** registers **no key bindings** (no collision risk) but **owns the Themes editor** our new status-strip
  tokens must appear in, and ships **"Restore All Themes to Default"**, which resets **every built-in theme to
  its shipped values** — so those tokens MUST have **shipped values in every bundled theme** in 010's record
  (**FR-010f**), or a Restore All would leave the status strip unstyled or illegible.
  **015** (granular reset) — *updated 2026-07-12* — is **implemented and in PR #44**, and this feature should
  now be planned against it rather than around it. FR-022b was originally written against **010**'s restore
  API directly precisely because 015 might not land first; that remains correct and is not a dependency. But
  015 delivers three things this feature will build on rather than reinvent: the **per-row affordance gutter**
  (reset / revert / clear, left of the control), the **`FieldDescriptor.clearable`** declaration every new
  setting must now make (**FR-022c**), and the retirement of the app's **second notion of "shipped default"**
  — so there is now exactly one, which is what FR-022b's "sourced from 010's record, not hard-coded a second
  time" was asking for. 015 adds **no new control type**, so FR-022a's keyed-table editor remains this
  feature's to build.
- Q: 013's **match highlights** are guaranteed legible "on every bundled theme" — but 013 shipped against a
  **plain-text** editor. This feature puts **~10 syntax token colours** underneath them. Who guarantees a dark
  keyword is readable inside a dark current-match highlight? → A: **Compose, and prove it** (**FR-007a**). The
  match highlight is a **background** layer and the syntax colour remains the **foreground** — matched code
  keeps its highlighting rather than flattening into a solid block (which is what "match wins" would do, and
  what no serious editor does). The combination is then **verified by an automated contrast guard**, extending
  the theme-contrast tests feature **009** already ships: **every** syntax token colour must meet minimum
  contrast against **both** the ordinary-match and current-match backgrounds, on **every** bundled theme, or
  the **build fails**. This closes a gap neither feature covered alone — **013 FR-019** only ever validated
  match highlights against **plain text**, and **SC-007** only validates syntax colours against the **editor
  background**. Searching a code file must never make the current match the one thing the user cannot read.
- Q: Checked against the **shipped** bindings, **`Ctrl+X` is already the default of `file.cut`** (the File
  Explorer's cut-file command). FR-017b1's "no two registered commands share a default chord, app-wide" would
  therefore **fail the build** and force `cut-line` off Ctrl+X — contradicting FR-017a and US3. Is the rule or
  the design wrong? → A: **The rule was wrong — chords need a dispatch scope** (**FR-017b0**, **FR-017b1**).
  The collision is not real: `file.cut` fires when the **File Explorer** has focus and `cut-line` only when an
  **Editor Panel** is active, so they can never fire together — but the keybinding model is a **flat map with
  no scope concept** and cannot express that. This feature therefore **adds a dispatch scope** (`editor` /
  `terminal` / `explorer` / `global`) to the command descriptor; the chord test asserts uniqueness **within a
  scope** (a `global` chord colliding with nothing anywhere), and the Key Bindings editor **shows the scope** so
  a user seeing Ctrl+X twice understands why. A flat app-wide rule forbids **context-scoped chords the
  application already relies on** — Ctrl+C copies a file in the Explorer and reaches the shell as SIGINT in a
  terminal. Moving `cut-line` to a free chord was **rejected**: it would sacrifice the feature's headline
  binding to a test's convenience. **Accepted cost:** a **third** shared-component touch (a `scope` field on the
  command descriptor and its editor metadata). *(`Tab`, `Shift+Tab` and `Shift+Alt+Arrow` were verified **free**
  against the shipped defaults.)*
- Q: 013 seeds the find input from a "non-empty, **single-line** selection" — a rule written before this feature
  added **rectangular** and **multi-cursor** selections. What seeds the find bar now? → A: **Seed only from an
  unambiguous single line of text** (**FR-025i**), extending 013's rule by its own logic rather than inventing
  new behaviour. A **one-row** rectangular block **seeds** (it *is* single-line); a **multi-row** block, or a
  multi-cursor set with **more than one** non-empty selection, **seeds nothing** — find opens with the last
  term, exactly as 013 already prescribes for any non-single-line selection. Choosing an arbitrary "primary"
  selection was **rejected**: a scattered cursor set has no single sensible search term, and silently picking
  one produces a mis-search the user never asked for.
- Q: FR-007a promised a contrast guard over **every bundled theme**, but feature **009**'s shipped guard
  (`packages/core/src/config/theme-quality.ts`) is build-blocking for only **three** —
  `IN_SCOPE_THEMES = ['Bash', 'SUBNET', 'Cyberpunk']` — while `knownContrastIssues()` **reports, never throws**
  for the other twelve, precisely because some of them **already fail WCAG AA** and that was knowingly accepted.
  Which policy applies? → A: **Reuse 009's policy exactly, and keep theming out of this feature** (**FR-007a**).
  The new syntax-on-match-background pairings join 009's enumerated `CONTRAST_PAIRINGS` and inherit its
  **existing** in-scope/out-of-scope machinery unchanged: they **fail the build** on the themes 009 already
  gates and are **reported as known issues** on the rest. Ratcheting all fifteen into a hard gate was
  **rejected** — it would fail on day one (Matrix is monochrome green; VI-VIM and Gothic are low-contrast by
  design) and would drag a **multi-theme redesign** into Part 1, contradicting a decision 009 took deliberately.
  The obligation this feature **does** accept is narrow and unavoidable: the syntax palette is **new colour only
  this feature creates**, so **only this feature can check it** — hence the pairings. The gated set MUST be
  **read from 009's list, never copied**, so it follows that list as it grows.
  *(An earlier draft of this answer also added an **FR-007b** requiring the theme picker to **mark**
  WCAG-conformant themes, and proposed gating **throng, Light, Snake and Claude**. Both were **stripped**: this
  is an **editor** feature, not a theming or accessibility one, and neither is fundamental to its success.
  They are now tracked as **[#61](https://github.com/Bidthedog/throng/issues/61)** on the **vNext** milestone —
  see *Out of Scope*.)*
- Q: Setting WCAG aside — **what theme keys does this feature actually add?** The spec said **both**: the
  2026-07-08 clarification deferred per-syntax-category colour tokens ("one built-in, theme-aware highlight
  style"), yet FR-007a's guard requires measuring *"every syntax token colour on every bundled theme"* — a
  per-theme value that, under the deferral, **does not exist**. → A: **Syntax colours become first-class theme
  tokens** (**FR-007b**), **superseding the 2026-07-08 deferral**. The deferral was not merely inconvenient, it
  was **unachievable**: a single palette **cannot** be legible on both **Matrix** (green-on-black) and **Light**
  (dark-on-white), so the colours must resolve **per theme** whatever we call them — and a derived-but-unnamed
  palette is one **no theme author owns, no user can tune, and no test can hold anyone to**. A fixed set of
  **10** named tokens (keyword, string, comment, number, type, function, operator, punctuation, …) joins the
  theme record, with a **shipped value in every bundled theme** (010's record — required so 014's *Restore All*
  cannot leave code unstyled), a descriptor, Themes-editor exposure and completeness-test coverage.
  **Accepted cost: ~150 shipped colour values — the largest single addition any clarification has made to this
  feature**, accepted because the alternative does not work.
  Also (**FR-007c**): adding ~10 tokens **perturbs feature 009's theme-distinctness gate**, which is the **mean**
  ΔE00 across shared tokens and sits only **0.17** below the closest legitimate pair (threshold `4.3`, closest
  pair `4.469`). **Copy-pasted syntax palettes would pull every theme pair closer together and fail the build**;
  palettes drawn from each theme's own character push them apart. The gate must be **re-measured**, and
  recalibrated **only** if the closest *legitimate* pair genuinely moved — never loosened to let a lazy palette
  through.
- Q: FR-017b0's **dispatch scope** was drafted as a single value (`editor` / `terminal` / `explorer` /
  `global`), but the shipped bindings cannot be described by one: `search.*` (013) is *"routed to the ACTIVE
  panel — a terminal searches its scrollback, an editor searches its file"* and `editor.save*` resolves *"while
  the active pane is a workspace Panel, not Files & Folders"* — both live in an **editor and a terminal but not
  the Explorer**, which no single value expresses. → A: **The scope is a SET of contexts** (**FR-017b0**,
  **FR-017b1**). A command declares every context it is live in; two commands conflict **iff their scope sets
  intersect** on a shared chord. **"Global" ceases to be a special value** — it is simply the full set — which
  also **removes a real ambiguity** in FR-017b1's earlier wording ("a `global` command's chord collides with
  nothing in any scope"), readable either as *exempt from collisions* or *must be unique across them*; set
  intersection states the intended meaning without needing a rule. There is **no default scope**: an unscoped
  command **fails the completeness test** rather than being silently treated as global (which would put
  `file.cut` in every context and fail the build on `cut-line`). Two further consequences: the **36 
  already-shipped commands must each be assigned their real set** as part of this work, and — critically — the
  **resolver must become scope-aware**. `resolveAction` today returns the **first** action in map order whose
  chord matches, so with a flat map `Ctrl+X` resolves to `file.cut` **everywhere, including inside an editor**,
  and `cut-line` would **never fire at all**. Without that change the `scope` field is decorative.
- Q: FR-028b requires the manual language override to be **persisted keyed by the file**, but never says
  **where**. The spec still claimed "no SQLite migration" and "no new daemon RPC", and nothing bounded the
  store's growth or defined its key. → A: **A first-class per-document-state table in SQLite, via a versioned
  migration** (**FR-028e**) — keyed by **owner + project + project-relative path**, reached by **new daemon
  RPC**, pruned of rows whose file no longer exists, cascading on project delete, and carrying the file through
  an in-throng rename. Riding the existing **`workspace_layout.layout_json` blob** was the tempting answer — it
  needs **no migration and no new RPC**, because the layout already round-trips through one workspace RPC — and
  it was **rejected as a cop-out**: the override is **document** state, not **layout**, and a schemaless blob
  gives it no key, no foreign key, no pruning and no protection from a layout rebuild, while inviting every
  future per-file value (the **encoding** and **line-ending** status the strip already anticipates, FR-010c) into
  the same blob. **This deliberately reverses feature 006's "no editor migration" decision (research D2/D14) and
  retires the guard test that enforces it** (`no-editor-migration.integration.test.ts` — `LATEST_VERSION === 6`,
  no editor table). That guard was correct while editor state was per-**panel**; FR-028b made the override a
  property of the **document**, so it is correct no longer. Retiring it is an explicit, reviewed change, not a
  quiet deletion to make a migration pass. Three of the spec's original claims — **renderer-only**, **no SQLite
  migration**, **no new daemon RPC** — are corrected in **Assumptions**.

### Session 2026-07-12 (b) — corrections raised by `/speckit-plan` against the **shipped code**

Phase 0 of planning audited the source rather than the spec's description of it. Six statements in this
specification did not survive that audit. Each is corrected here, with the reasoning, rather than being
quietly rewritten — three of them would have **failed the build** or **shipped dead code**.

- Q: The column-select defaults are written **`Alt+Shift+Arrow`** throughout. Does that match a real key
  event? → A: **No — the canonical token order is `Ctrl+Shift+Alt+<key>`, so it MUST be written
  `Shift+Alt+Arrow…`.** `eventToToken` (`packages/core/src/config/keybindings.ts:156-161`) emits modifiers
  in a fixed order, and `resolveAction` compares normalised tokens. A default declared as
  `Alt+Shift+ArrowUp` therefore **never matches any key event** — the four commands would be **silently
  dead**, with no test failing. Every occurrence is normalised to **`Shift+Alt+…`**. (The *gesture* the
  user performs is unchanged — they hold Alt and Shift together; only the token string is ordered.) A unit
  test now asserts every shipped default round-trips through `normalizeToken(eventToToken(...))`, so no
  future feature can reintroduce a mis-ordered chord.
- Q: **FR-017b/FR-019** make **`Tab`** the default binding of `indent-lines`, and **FR-022** requires all
  seven commands to be rebindable in the Key Bindings editor. Are both achievable? → A: **Not as shipped —
  `Tab` is not a bindable chord.** `EXCLUDED_KEYS` (`chord-capture.ts:75-84`) contains `Tab`, so
  `isBindableChord('Tab') === false` and the capture modal **rejects** it: a user who cleared `Tab` could
  never re-enter it. **Resolution: `Tab` and `Shift+Tab` are removed from `EXCLUDED_KEYS`**, guarded by the
  focus rule **FR-017f** already requires — the editor claims `Tab` **only** while an Editor Panel's content
  has input focus, so `Tab` keeps its DOM focus-traversal meaning everywhere else (which is why it was
  excluded in the first place). Giving `indent-lines` a different default was **rejected**: every code editor
  uses Tab, and the exclusion exists for a reason FR-017f already honours.
- Q: **FR-028a** justifies document-scoped state with a hazard — *"a new/empty file open in a panel overridden
  to Go (tabs) and another to Python (4 spaces) would take both."* Is it constructible? → A: **No.**
  `open-registry.ts` enforces one buffer per file app-wide: `openOrFocus()` **focuses the existing editor**
  for an already-open path (006 FR-011a), and Save-As refuses a path open elsewhere. **A file is open in at
  most one Editor Panel**, so two panels can never disagree about its language. **The requirement stands, but
  its hazard is restated**: the real, verified violation is that a panel **mirrored across windows** keeps one
  `panelId` and mounts a **separate `EditorView` per window, each with its own `history()`**, synchronised by
  **whole-document replace** — so mirrored views have **separate undo stacks today**, breaking **FR-026c**
  outright. That is what "one document, one state" must actually fix.
- Q: **FR-028e** names one version guard to retire. Is it the only one? → A: **No — there are two.**
  `user-version-pin.integration.test.ts` (feature 007) pins `LATEST_VERSION === 6` identically and fails the
  same way. **Both** are retired as an explicit, reviewed change.
- Q: **FR-022a** calls 007's control vocabulary **"exhaustive"** at six types. Is it? → A: **No — it is
  already thirteen** (`ControlKind` adds `colour`, `font-family`, `font-size`, `enum`, `chord`, `icon`,
  `folder`). The claim went stale exactly as FR-022a's own 2026-07-12 note predicted. Corrected to
  **thirteen**; the load-bearing claim is unchanged and still true — **no existing control renders a keyed
  map**, so the keyed-table control is still this feature's to build.
- Q: The **Dependencies** section says feature **015 is "not yet merged (open PR)"**. → A: **015 is merged**
  (`bcebc2b`, `1df35f2`, `d925ae4`). FR-022c is already written against it as landed. The dependency bullet is
  corrected: this feature **builds on** 015's per-row affordance gutter and `FieldDescriptor.clearable`
  rather than around them.

### Session 2026-07-13 — the document authority, raised by the constitution v3.15.0 amendment

- Q: The constitution now carries **"one document, one state"** as **Principle XI** (v3.15.0, issue #68 —
  FR-028d's required follow-up, now **done**). Its anti-loophole clause says state MUST be **shared**, not
  **synchronised**. But this feature's design replaces whole-document-replace sync with a **`ChangeSet`
  relay** between mirrored views (research D7 / T086), and it never says how a change based on document
  version *N* is applied once the document has already advanced to *N+1*. Under whole-document replace a race
  was crude but **safe** (last write wins, and the whole document stays internally consistent); under a
  `ChangeSet` relay, applying a **stale** change to a **newer** document **misplaces or corrupts text**,
  because the positions it refers to have shifted. Views **must** apply edits locally the moment the user
  types — waiting for a round trip would make typing laggy — so a view **always** has unconfirmed local
  changes in flight. How are concurrent/in-flight changes reconciled? → A: **A single authoritative document
  in UI main, with rebasing.** UI main owns the canonical document and a monotonic **version**. A view echoes
  the user's edit **locally and immediately**, then sends `{changes, baseVersion}`. Main **rebases** a stale
  change over the changes that landed in between (CodeMirror's `ChangeSet.map`) and broadcasts **one ordered,
  canonical change stream**; every view applies it with `addToHistory: false`. See **FR-028f**.
  - **Rejected — reject-stale-and-resync**: safe against corruption, but because a view has *already* shown
    the user their keystroke, a rejection means **visibly reverting input the user watched themselves type**.
    It trades corruption for lost work, which is not a trade this rule is willing to make.
  - **Rejected — an edit lock (only the focused view may dispatch)**: cheapest, but it does **not** close the
    race (focus can change while a change is in flight) and it **forbids programmatic edits** originating in a
    non-focused view — which would break 013's replace-all and any future agent-driven edit.
  - **Rejected — accept the race**: it knowingly ships the exact content-corruption hazard Principle XI was
    amended to forbid.
- Q: Does the constitution's *"mirroring is NOT compliance"* clause therefore forbid the design just chosen —
  which **does** keep a per-view replica fed by a relay? → A: **No, and the constitution's wording was
  corrected (v3.15.0) so that it says so.** Mirrored views live in **different renderer processes** and
  **cannot** share a JavaScript object; an absolute reading of "shared, not synchronised" would forbid **every
  implementable design**, which cannot be what a rule is for. The property that actually separates sound from
  unsound is **authority**, not mechanism: exactly **one** component owns the document state, and every other
  copy is a **derived replica** driven by that authority's **ordered change stream**. What is forbidden is
  **peer-to-peer reconciliation between co-equal copies** — which is precisely what the shipped editor does
  today (two `EditorView`s, each its own source of truth, reconciling by whole-document replace), and precisely
  what **FR-028f** replaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Language-aware syntax highlighting with automatic detection (Priority: P1)

A user opens a source file in an Editor Panel and its code is **syntax-highlighted** according to the file's
language — keywords, strings, comments, numbers, and other tokens are visually distinguished. The language
is **detected automatically from the file extension** (`.rs` → Rust, `.py` → Python, `.tsx` → TypeScript,
and so on across all supported languages). Highlighting updates **live** as the user types. If the extension
is unknown or absent, the file simply shows as **plain text** — never an error — and the user can set the
language manually (US5).

**Why this priority**: Syntax highlighting is the feature the user explicitly prioritised ("syntax highlight
first") and the headline of "Rich code editors". Every other Part-1 story is a small editing-nicety that the
editor is usable without; highlighting is the reason for the feature.

**Independent Test**: Open one file per supported language (correct extension) and confirm each is highlighted
in a way distinct from plain text and appropriate to that language. Type new code into a highlighted file and
confirm the new text is highlighted live. Open a file with an unrecognised or absent extension and confirm it
renders as readable plain text with no error. Type a `#!` shebang into it and confirm nothing re-highlights
(detection does not read content). Open a `.h` file and confirm C++; remap `.h` to C in settings and confirm
open `.h` editors switch to C. Open `types.d.ts` and confirm the longest declared suffix (`.d.ts`) decides the
language. Open `.gitignore` and `Dockerfile` and confirm both render as plain text with no error.

**Acceptance Scenarios**:

1. **Given** a file with a recognised extension for any supported language, **When** it is opened in an
   Editor Panel, **Then** its content is highlighted using the highlighter for that language.
2. **Given** a file whose extension is **unrecognised or absent**, **When** it is opened, **Then** it renders
   as readable plain text with no error and no broken highlighting.
3. **Given** an open document, **When** its **content** changes (including gaining a shebang, `<?php`, or a
   doctype), **Then** the detected language does **not** change — detection never inspects content.
4. **Given** a highlighted document, **When** the user types additional code, **Then** the new text is
   highlighted live without reopening the file.
5. **Given** an open document, **When** its **identity or on-disk content is replaced** (rename, Save-As,
   revert, external reload), **Then** detection re-runs against the (possibly new) extension.
6. **Given** any bundled theme (light or dark), **When** a highlighted file is shown, **Then** the
   highlighting is legible against that theme's editor colours.
7. **Given** a `.h` file and the shipped registry, **When** it is opened, **Then** it is highlighted as
   **C++**.
8. **Given** the user remaps `.h` to **C** in settings, **When** the setting is applied, **Then** open and
   subsequently opened `.h` editors highlight as C without being reopened — unless a panel carries its own
   manual override, which still wins.
9. **Given** a filename matching **two declared suffixes** (e.g. `types.d.ts` against `.ts` and `.d.ts`),
   **When** it is opened, **Then** the **longest** declared suffix decides the language.
10. **Given** a filename with **no dot** (`Dockerfile`) or whose **only dot is its first character**
    (`.gitignore`, `.env`), **When** it is opened, **Then** it has no extension and renders as plain text
    with no error; a manual override is the correction path.

---

### User Story 2 - Right-click editing menu in the editor (Priority: P2)

A user right-clicks inside the editor's text area and gets a **context menu** of the standard text-editing
actions — **Cut**, **Copy**, **Paste**, **Select All**, **Undo**, **Redo** — plus **Set Language…**, and can
perform copy/cut/paste entirely with the mouse, without touching the keyboard. Right-clicking **inside a
selection** keeps that selection; right-clicking **elsewhere** moves the caret to the click point. With
nothing selected, **Cut** and **Copy** act on the caret's **whole line** — matching Ctrl+X's cut-line
(US3) — so they are never dead options. This menu is on the **editor
content** and is distinct from the existing 006 **panel-header** menu (Save / Revert), which is unchanged.

**Why this priority**: A missing right-click menu on the text area is an obvious usability gap the user
called out, and it is cheap to provide. It is not required for the highlighting MVP, so it is P2.

**Independent Test**: Select some text, right-click, and confirm Cut/Copy/Paste/Select All/Undo/Redo are
offered. Using only the mouse: copy a selection and paste it elsewhere; cut a selection and paste it; Select
All then Copy. Confirm the actions honour the OS clipboard and interoperate with other applications. Make a
selection, right-click **inside** it and confirm it survives; right-click **outside** it and confirm the
selection collapses and the caret lands at the click point. With nothing selected, right-click and choose
Copy, then paste mid-line elsewhere; confirm a whole line is inserted above the caret's line. Confirm
right-clicking the panel **header** still shows the 006 Save/Revert menu (not the editing menu) and vice
versa.

**Acceptance Scenarios**:

1. **Given** the editor content area, **When** the user right-clicks, **Then** a context menu appears
   offering at least Cut, Copy, Paste, Select All, Undo, Redo, and **Set Language…**.
2. **Given** a text selection, **When** the user chooses Copy then Paste at another location (mouse only),
   **Then** the text is duplicated at the new location via the OS clipboard.
3. **Given** a text selection, **When** the user chooses Cut then Paste elsewhere, **Then** the selection is
   removed from its origin and inserted at the paste point.
4. **Given** clipboard content copied from another application, **When** the user chooses Paste, **Then**
   that content is inserted at the cursor / over the current selection.
5. **Given** the editor content menu and the 006 panel-header menu, **When** each is opened, **Then** they
   show their own distinct action sets and do not collide or duplicate each other.
6. **Given** an active selection, **When** the user right-clicks **inside** it, **Then** the selection is
   preserved and the menu's Cut/Copy act on it; **When** the user right-clicks **outside** it, **Then** the
   selection collapses and the caret moves to the click point.
7. **Given** **no selection**, **When** the user chooses **Cut** (or **Copy**) from the content menu,
   **Then** the caret's whole line is cut (or copied) as a **full-line clipboard entry**, and a subsequent
   paste inserts it as a complete line above the caret's line (FR-015a).

---

### User Story 3 - Ctrl+X cuts the current line (Priority: P2)

Following the familiar behaviour of well-known code editors, when the user presses **Ctrl+X** with **no text
selected**, the editor **cuts the entire current line**. Pasting it back inserts it as a **whole line above
the caret's line** — the caret's own line is never split — matching the muscle memory of moving a line
around with cut/paste. With a selection active, Ctrl+X cuts the selection as usual and paste behaves
normally.

**Why this priority**: A specific, small productivity behaviour the user asked for; valuable muscle-memory
parity with other editors, but independent of and secondary to highlighting.

**Independent Test**: Place the cursor on a line without selecting anything and press Ctrl+X; confirm the
whole line (including its line break) is removed and the surrounding lines close up. Put the caret in the
**middle** of another line and paste; confirm the cut line reappears as a whole line **above** that line and
that line is not split. Copy some text from another application, then paste; confirm it inserts at the caret
(the full-line behaviour did not persist). Make a selection and press Ctrl+X; confirm only the selection is
cut and pasting inserts at the caret. Test on the last line of a file with no trailing newline. Paste a cut
line into another application and confirm it arrives as text with a trailing newline.

**Acceptance Scenarios**:

1. **Given** the cursor is on a line with **no selection**, **When** the user presses Ctrl+X, **Then** the
   entire current line is removed and copied to the clipboard, and the lines below shift up.
2. **Given** a line was cut with Ctrl+X, **When** the user places the caret **mid-line** elsewhere and
   pastes, **Then** the cut line is inserted as a **complete line above the caret's line** and the caret's
   line is left unsplit.
3. **Given** an **active selection**, **When** the user presses Ctrl+X, **Then** only the selection is cut
   (the cut-line behaviour applies only when nothing is selected), and a subsequent paste inserts at the
   caret rather than as a whole line.
4. **Given** a line was cut with Ctrl+X, **When** the clipboard is then replaced from **another source**
   (another application, or a selection-copy), **When** the user pastes, **Then** the content is inserted
   verbatim at the caret (the full-line marker was invalidated).
5. **Given** a line was cut with Ctrl+X, **When** the user pastes into **another application**, **Then** it
   receives the line's text with a trailing line break.
6. **Given** the cursor is on the **last line** with no trailing newline, **When** the user presses Ctrl+X,
   **Then** the line is cut cleanly without leaving a stray blank line or error.
7. **Given** the Key Bindings editor, **When** the user rebinds the **`cut-line`** command to another chord,
   **Then** that chord carries the whole behaviour (selection-cut and line-cut) without restarting the
   application, and **Ctrl+X reverts to the editor's native cut** — cutting a selection, and doing nothing
   when there is none.
8. **Given** **bare carets on lines 1 and 6**, **When** the user presses Ctrl+X, **Then** both whole lines are
   cut and placed on the clipboard in document order joined by a **single newline**, marked full-line; pasting
   inserts a whole line above **each** caret's line.
9. **Given** **two cursors, each with a partial selection** (part of line 2, part of line 3), **When** the
   user presses Ctrl+X, **Then** **only the two selected fragments** are cut — neither line is cut whole, and
   the clipboard entry is **not** marked full-line.
10. **Given** a **rectangular selection**, **When** the user presses **Ctrl+X** (`cut-line`), **Then** the
    block is cut and the clipboard entry is marked **rectangular** — pasting it inserts column-wise, exactly
    as if it had been cut from the content menu (FR-016b).

---

### User Story 4 - Per-language tab/space indentation (Priority: P2)

Indentation **matches the file the user is actually editing**. On open, the editor samples the document's
**first 10% of lines (at most 100)** and adopts whatever indentation style it already uses. Where a file offers no clue,
indentation falls back to a **per-language** convention resolved from the detected language: every language
uses the **global default of 2 spaces** unless it ships an override for its established convention (e.g.
tabs for Go, 4 spaces for Python), and the user can change both the global default and any per-language
override. Pressing **Tab** inserts the document's effective indentation, **Tab with a selection indents every
selected line and Shift+Tab outdents**, and automatic indentation (e.g. on
a new line) follows the same style — so a user never silently introduces mixed indentation into an existing
file.

**Why this priority**: Correct indentation is expected of a real code editor and is low-cost given the editor
already exists; but the editor is usable without it, so P2.

**Independent Test**: Open a tab-indented file and press Tab; confirm a tab is inserted regardless of the
configured profile. Open a 4-space-indented file whose language is configured for 2 spaces and confirm 4
spaces are inserted. Open an **unindented** Go file and press Tab; confirm a tab (Go's override) is inserted.
Open an unindented file of a language with no override and confirm 2 spaces. Change the setting for a
language and confirm open editors **without an inferred style** reflect the change. Add a new line inside an
indented block and confirm the auto-indent matches. Select three lines, press Tab and confirm all three
indent by one unit; press Shift+Tab and confirm all three outdent. With no selection, press Shift+Tab and
confirm the caret's line outdents. Open a tab-indented file and confirm tabs render 4 columns wide; change the
tab display width and confirm the rendering changes while the file's bytes do not. Confirm no existing line is
ever re-indented and the document is not marked dirty by opening it.

**Acceptance Scenarios**:

1. **Given** a document whose sampled lines are **tab-indented**, **When** the user presses Tab, **Then** a
   tab character is inserted — even if the language's configured profile is spaces.
2. **Given** a document whose sampled lines are consistently **4-space** indented and whose language is
   configured for 2 spaces, **When** the user presses Tab, **Then** **4 spaces** are inserted.
3. **Given** a document with **no indented lines** in its sample and a language whose override is tabs (e.g.
   Go), **When** the user presses Tab, **Then** a tab character is inserted.
4. **Given** a document with no inferred style and a language with **no** override, **When** the user presses
   Tab, **Then** the global default of **2 spaces** is inserted.
5. **Given** the user changes a language's indentation style/width (or the global default), **When** the
   change is applied, **Then** open editors of that language **with no inferred style** use the new setting
   without reopening, while editors **with** an inferred style keep it.
6. **Given** the user starts a new line inside an indented block, **When** the editor auto-indents, **Then**
   it uses the document's effective indentation style consistently.
7. **Given** a document with no inferred style whose language came from a **manual override** rather than its
   extension, **When** the user presses Tab, **Then** the **overridden language's** profile is used.
8. **Given** any document, **When** it is opened and its indentation inferred, **Then** **no existing line is
   modified** and the document is **not marked dirty**.
9. **Given** a selection spanning several lines, **When** the user presses **Tab**, **Then** every selected
   line is indented by one unit of the effective indentation (the selection is not replaced); **When** the
   user presses **Shift+Tab**, **Then** every selected line is outdented by one unit.
10. **Given** an indented line and **no selection**, **When** the user presses **Shift+Tab**, **Then** the
    caret's line is outdented by one unit.
11. **Given** a document containing tab characters, **When** it is displayed, **Then** each tab occupies the
    configured **tab display width** (default 4 columns); **When** the user changes that setting, **Then**
    open editors re-render at the new width and **no document content or dirty state changes**.
12. **Given** the Key Bindings editor, **When** the user rebinds **`indent-lines`** or **`outdent-lines`**,
    **Then** the new chord indents/outdents without restarting the application.

---

### User Story 5 - Correct a wrong language guess (Priority: P3)

The Editor Panel always shows the document's **effective language** in a **status strip along its bottom
edge**. When
detection picks the wrong language — or the file has no usable extension, or the user simply wants a
different highlighter — the user **clicks the indicator** (or chooses **"Set Language…"** from the editor's
right-click menu) and picks a language from a **searchable list**. The chosen language applies
**immediately** (re-highlighting the document, and switching its indentation profile) and stays in effect
**for that document** — remembered across restarts, applied in **every** panel and mirrored view showing
that file, and **adopted** by a panel that opens the file later (FR-028b). *(This prose said "for that
panel" until 2026-07-13; the override was narrowed from panel-scoped to **document**-scoped by FR-028b, and
the Acceptance Scenarios below were already written to it.)*

**Why this priority**: With detection reduced to file extensions (2026-07-09), the override is the **only**
correction path for extension-less or misnamed files — but it is only reachable once detection +
highlighting (US1) exist, so P3.

**Independent Test**: Open a file and confirm the status strip at the bottom of the panel shows its language.
Open an extension-less file, confirm the indicator reads "Plain Text", click it, filter the list, choose a
language, and confirm the
document is re-highlighted immediately, the indicator updates, and Tab now indents in that language's style.
Repeat via the right-click menu's "Set Language…" and confirm it opens the same picker. Restart the app and
confirm the panel reopens in the overridden language. Tear the panel into a sub-workspace window and confirm
the mirrored view shows the same indicator and language. Close the panel, then **re-open the same file** and
confirm it **adopts the stored override rather than re-detecting** (FR-028b).

*(**Corrected 2026-07-12.** This step previously read: "Open the same file in a second, independent panel and
confirm it **detects normally**" — the **superseded per-panel** model. It is wrong twice over: FR-028b now
requires a later panel to **adopt** the override, and in any case a file cannot be open in two panels —
`openOrFocus()` focuses the existing editor. An implementer following the old step would have built the
behaviour FR-028 forbids.)*

**Acceptance Scenarios**:

1. **Given** an open editor, **When** the user manually selects a language (from the indicator or from the
   content menu's "Set Language…"), **Then** the document is re-highlighted using that language's
   highlighter immediately and the indicator updates to match.
2. **Given** a manual language override is in effect, **When** the user continues editing, **Then** the
   override persists (automatic detection does not silently revert it).
3. **Given** a manual override, **When** the user selects "plain text" / "no language", **Then**
   highlighting is removed and the document shows as plain text, and that choice is itself remembered.
4. **Given** a panel with a manual override, **When** the application is restarted, **Then** the panel
   reopens with the overridden language still applied.
5. **Given** a panel with a manual override that is mirrored in a sub-workspace window, **When** either view
   is shown, **Then** both use the overridden language and both indicators show it.
6. **Given** a manual override, **When** the user presses Tab, **Then** the **overridden** language's
   indentation profile is used.
7. **Given** any open editor, **When** the user looks at the panel, **Then** a status strip along its bottom
   edge shows the document's effective language ("Plain Text" when none is detected), and clicking it opens
   the searchable picker with the current language marked.
8. **Given** the language picker is open, **When** the user types a filter, **Then** the list narrows to
   matching languages.
9. **Given** any bundled theme (light or dark), **When** the indicator is shown, **Then** it is legible
   against that theme.
10. **Given** a persisted override naming a language the registry no longer contains, **When** the panel is
    restored, **Then** it opens without error (falling through to plain text), and **When** a later version
    reintroduces that language, **Then** the panel resolves to it again — the stored id was never discarded.

---

### User Story 6 - Column (rectangular block) selection (Priority: P3)

A user selects a **rectangular block** of text — the same column range across a run of consecutive lines —
either by holding **Alt** and dragging with the mouse, or by holding **Shift+Alt** and pressing the **arrow
keys**. Copying or cutting the block puts its rows on the OS clipboard **joined by line breaks**, so the user
can paste the columns into another application (Notepad++, a spreadsheet) or back into the editor, where they
are re-inserted **column-wise** — each row on a successive line at the paste column. Typing with a block
selected replaces every row at once. This is the familiar Notepad++ / VS Code column-edit behaviour.

**Why this priority**: A genuine productivity capability the user asked for, but it depends on the per-cursor
editing semantics (FR-016a) that the earlier stories establish, and the editor is fully usable without it.

**Independent Test**: Alt+drag across the first 3 columns of 10 consecutive lines; confirm a rectangular
selection is shown. Copy it and paste into an external text editor; confirm 10 rows of 3 characters separated
by line breaks. Shift+Alt+Arrow from a caret and confirm the block grows by column/row. With a block selected,
type a character and confirm every row is replaced. Copy a block, place the caret elsewhere and paste; confirm
each row lands on a successive line at the caret's column, not as one run of text. Cut a block and confirm only
the block's characters are removed, the lines closing up horizontally. Rebind `column-select-right` in the Key
Bindings editor and confirm the new chord extends the block. Confirm a block whose rows are ragged (short
lines) behaves without error.

**Acceptance Scenarios**:

1. **Given** the editor content area, **When** the user holds **Alt** and drags, **Then** a **rectangular
   selection** spanning the dragged column range across the dragged lines is created.
2. **Given** a caret, **When** the user presses **Shift+Alt+Arrow**, **Then** a rectangular selection is
   created or extended by one column (left/right) or one row (up/down).
3. **Given** a rectangular selection, **When** the user copies or cuts it, **Then** the OS clipboard receives
   its rows **joined by the document's line ending**, and the entry is marked a **rectangular clipboard
   entry**.
4. **Given** a rectangular clipboard entry, **When** the user pastes at a caret, **Then** each row is inserted
   **column-wise** — row *n* at the caret's column on the *n*-th successive line — rather than as one
   contiguous run of text.
5. **Given** a rectangular clipboard entry, **When** the user pastes into **another application**, **Then** it
   receives the rows as plain text separated by line breaks.
6. **Given** a rectangular selection, **When** the user types a character, **Then** every row of the block is
   replaced by it.
7. **Given** a rectangular selection, **When** the user presses **Ctrl+X**, **Then** only the block's
   characters are cut (each row's fragment), the lines closing up horizontally, and the entry is **not**
   marked full-line.
8. **Given** a block whose rows fall on **short lines** that do not reach the block's column range, **When**
   it is copied or cut, **Then** those rows contribute **empty** content and no error is raised.
9. **Given** a block copied in **one** Editor Panel, **When** the user pastes it into a **different** Editor
   Panel — including one in a **sub-workspace window** — **Then** it still pastes **column-wise**, because the
   clipboard mode is **application-global** (FR-015c), not per-view.
10. **Given** a rectangular selection, **When** the user presses **Delete** or **Backspace**, **Then** the
    block's characters are removed on **every row** (the lines closing up horizontally) **without** writing to
    the clipboard, as **one** Undo (FR-025g).
11. **Given** **N lines copied in another application** (which arrive **verbatim** — no rectangular signal
    crosses the OS clipboard), **When** they are pasted over an **N-row** block, **Then** they are distributed
    **one line per row** (FR-025h) — the route by which external column data enters the editor. **When** the
    line count **differs** from the row count, **Then** every row receives the entry's full content.
12. **Given** the Key Bindings editor, **When** the user rebinds a `column-select-*` command, **Then** the new
    chord extends the block without restarting the application.
13. **Given** a rectangular block pasted across ten lines, **When** the user presses **Undo once**, **Then**
    the entire paste is reverted and the prior selection is restored — not one row per Undo.
14. **Given** the shipped default bindings, **When** the keybinding completeness test runs, **Then** it fails
    if any two registered commands declare the **same default chord** *in a context they share* (two commands
    clash **iff their scope sets intersect** — FR-017b1).
15. **Given** the user rebinds a `column-select-*` command onto a chord already held by another action,
    **When** the chord is captured, **Then** the Key Bindings editor warns and requires **Reassign** or
    **Cancel** (007 FR-034) — the chord is never silently stolen.
16. **Given** a **tab-indented** document, **When** a rectangular block is pasted at a column beyond a short
    line's end, **Then** the gap is padded with **tabs to the last whole tab stop, then spaces** — landing on
    the exact column without introducing a run of spaces; **Given** a space-indented document, **Then** the
    gap is padded with spaces.

---

### Edge Cases

- **Unsupported / undetectable language**: A file whose extension matches no supported highlighter MUST show
  as readable plain text (US1 AS2) — never an error, blank view, or broken partial highlighting.
- **Misleading or absent extension**: The extension is authoritative; a shell script named `deploy.txt` opens
  as plain text. The user corrects it with a **manual override**, which is then remembered for that
  **document** — persisted keyed by the file, so every panel showing it agrees, and a panel opening it later
  **adopts** it rather than re-detecting (FR-028b).
- **Compound extension (`types.d.ts`, `archive.tar.gz`)**: The **longest declared** suffix wins; a compound
  no language declares falls back to the longest suffix that *is* declared (`.gz` if present, else plain text).
- **Dotfile or dotless filename (`.gitignore`, `.env`, `Dockerfile`, `Makefile`)**: Treated as having **no
  extension** → plain text (FR-002b). Highlighting these by name is a planned later registry extension.
- **Ambiguous extension (`.h`, `.m`, and similar)**: Assigned to exactly one language by the built-in
  registry (`.h` → C++); the user may remap it globally in settings, or override a **single document**
  (FR-028b — the override belongs to the file, not to the panel that set it).
- **User remaps an extension while editors are open**: Affected editors re-highlight without reopening,
  except those carrying a manual override (FR-005a precedence).
- **User remaps an extension to an unsupported/unknown language**: Rejected by the settings editor; the
  previous mapping stands.
- **User maps an extension to Plain Text**: Highlighting is **globally disabled** for that extension (FR-004c).
  Precedence **stops** at that rung — the built-in registry does **not** re-apply its mapping — and the
  indicator reads "Plain Text". A **manual override** can still put an individual **document** back into a
  language — and, being document-scoped (FR-028b), it does so in **every** panel showing that file, not one.
- **Explicit Plain Text vs an unresolvable id**: These MUST NOT be conflated. An explicit **Plain Text** choice
  **terminates** the precedence chain (FR-005a/FR-004c); an **unresolvable** id contributes nothing and **falls
  through** to the next rung (FR-005b). Both may end at plain text, but only the first is a user decision.
- **User resets the extension→language overrides**: The map is **cleared** (it ships empty) and detection falls
  back to the **built-in registry** — the registry itself is not a setting and is unaffected (FR-022b).
- **User resets the per-language indentation overrides**: The **shipped set is restored** (Go → tabs, Python →
  4 spaces), *not* emptied — the map ships non-empty, so "reset" repopulates it from 010's defaults record
  (FR-022b). Removing a single row remains the way to drop one entry.
- **A persisted language id no longer resolves** (upgrade removed or renamed the language, or the layout /
  settings file was hand-edited): That rung contributes nothing, resolution continues down the precedence
  chain — usually ending at plain text — **no error is raised, and the stored id is preserved** so a later
  version that reintroduces the language picks it up again (FR-005b). A workspace never fails to restore
  because of a stale language id.
- **Document identity changes (rename / Save-As)**: Detection re-runs against the new extension (US1 AS5) —
  **unless a manual override is in effect**, which continues to win (FR-010a).
- **New / untitled document (no path, no extension)**: Shows as plain text until it is saved with a
  recognised extension or a manual override is set.
- **Very large file (at the 006 open threshold)**: It is **fully highlighted** like any other file, within the
  same budgets (200 ms to first highlight, no 50 ms main-thread task, no dropped frame while typing) — because
  highlighting cost tracks the **visible region**, not document size (FR-008). There is **no** file the editor
  opens but leaves unhighlighted, and **no** degraded mode. (Files *above* the threshold are already refused by
  006.)
- **Minified bundle (`bundle.min.js`, `.min.css`) — one very long line**: The line exceeds the **10,000-character**
  guard, so it renders as **unhighlighted plain text** while the rest of the document highlights normally
  (FR-008a). It remains fully editable, and FR-008's budgets still hold. Highlighting is **not** disabled for
  the whole file.
- **A normal source file containing one generated long line** (an embedded data URI, a long minified string):
  Only **that line** goes unhighlighted; every other line highlights as usual (FR-008a).
- **Binary / non-text file**: Already blocked by 006 ("cannot open as text"); highlighting does not apply.
- **Mixed-language files (e.g. Vue single-file components, HTML with embedded script/style)**: Embedded
  regions SHOULD be highlighted where the language definition supports it; where it does not, the outer
  language's highlighting is acceptable (best-effort, no error).
- **Jupyter Notebook (`.ipynb`)**: Highlighted as raw JSON (its on-disk form); a rich cell view is out of
  scope.
- **Ctrl+X on the last line without a trailing newline**: The line MUST be cut cleanly (US3 AS6) without a
  stray blank line or error.
- **Full-line clipboard marker vs external clipboard changes**: The marker is **application-global**
  (FR-015c) but is checked against the live OS clipboard on every paste; if the clipboard has been replaced by
  another application (or by a selection copy/cut), the next paste MUST be a verbatim caret paste, not a
  whole-line paste (US3 AS4).
- **Cut or copy in one panel, paste in another (or in a sub-workspace window)**: The mode **travels** — a
  rectangular block pastes **column-wise** and a full-line cut pastes as a whole line, in **any** Editor Panel
  in **any** window (FR-015c). This is the primary way a column block is moved between files, so a per-view
  marker (which would degrade it to a verbatim paste) is **rejected**.
- **Paste into throng from another application**: Content throng did not write carries **no** mode, so it
  pastes **verbatim** at the caret. throng cannot know an external copy was rectangular (the OS clipboard
  carries no such signal) — round-tripping a block *out of* throng and back in is therefore verbatim, by
  design.
- **Same text copied elsewhere, then pasted**: If another application places the **identical** text on the
  clipboard, the marker's text comparison (FR-015c) still matches and the paste keeps its mode. This is
  accepted as harmless — the content is byte-identical to what throng copied.
- **Ctrl+X on a document's only line**: The line is cut cleanly, leaving an empty document, without error.
- **Multiple cursors, mixed states**: Cursors holding selections cut their selections; bare carets cut their
  whole lines; the clipboard entry is marked full-line **only** when every cursor was a bare caret (FR-016a).
- **Multiple cursors on the same line**: Indent/outdent adjusts that line **once**, not once per cursor.
- **Two bare carets on adjacent lines**: Both lines are cut; the remaining document closes up without a stray
  blank line.
- **Rectangular block over short/ragged lines**: Rows that do not reach the block's column range contribute
  **empty** content; no error, no padding written to the file (FR-025f).
- **Rectangular paste running past the last line**: New lines are appended to accommodate the remaining rows
  (FR-025c).
- **Delete or Backspace with a block active**: Removes the block's characters on every row, closing each line
  up — a cut without the clipboard write (FR-025g). The clipboard is left untouched, so a previously copied
  entry and its mode survive.
- **Backspace on a zero-width block** (a column of carets with no width): Deletes one character to the **left**
  of each caret; Delete removes one to the **right** (FR-025g). It is not a no-op.
- **Pasting external column data into a block**: Ten lines copied from another application arrive **verbatim**
  (no rectangular signal crosses the OS clipboard). Pasted over a **ten-row** block they are distributed **one
  line per row** (FR-025h) — the only route for column data to enter throng from outside.
- **Pasting a verbatim entry whose line count differs from the block's row count**: Every row is replaced with
  the entry's **full content** (FR-025h) — no partial or truncated distribution.
- **Pasting a full-line entry over a block**: The block collapses to its top-left caret and the line is
  inserted **above** that caret's line (FR-025h) — the full-line rule wins; the block is not replaced row-wise.
- **Rectangular paste at a column beyond a line's length**: The line is padded to the paste column using the
  document's **effective indentation character** — spaces, or tabs to the last whole tab stop then spaces
  (FR-025c1). This is a *new* edit, not a re-indent, so FR-018d's "never rewrite existing lines" rule (which
  governs indentation inference) is not violated.
- **Rectangular paste into a tab-indented document**: Padding uses tabs (plus trailing spaces to hit the exact
  column), never a run of spaces — the file never gains a whitespace style it did not already have.
- **`cut-line` rebound away from Ctrl+X**: The new chord carries both behaviours; **Ctrl+X falls back to the
  editor's native cut** — it cuts a selection and does nothing when there is none (FR-017a).
- **A shipped default chord already used by an earlier feature *in the same scope***: Fails the keybinding
  completeness test at build time (FR-017b1); the default must be changed before release, not discovered by a
  user.
- **`Ctrl+X` used by both `file.cut` (Explorer) and `cut-line` (editor)**: **Not** a conflict — the scopes are
  disjoint, so both keep Ctrl+X and the active-panel context decides which fires (FR-017b0). A **flat**,
  scope-blind uniqueness rule would have failed the build here and forced `cut-line` off its headline chord.
- **The same chord registered twice within one scope**: A genuine conflict — the build fails (FR-017b1).
- **The user rebinds onto an occupied chord**: 007 FR-034's warn-and-choose modal applies (Reassign / Cancel);
  this feature adds no silent override (FR-017b2).
- **A registered command rebound to a chord the OS or shell claims**: Only Editor Panels consult the
  keybinding registry; **Terminal Panels pass control chords through to the PTY** unchanged (FR-017d), so
  rebinding in the editor never alters shell behaviour.
- **Document with mixed line endings**: The **dominant** ending (ties → first encountered) is the document's
  **effective** ending and is used for everything this feature inserts (FR-023a). The file is **not** repaired
  or normalised — it stays exactly as mixed as it was, is not marked dirty by being opened, and produces no
  whole-file diff (FR-023b).
- **Pasting LF text into a CRLF document (or vice versa)**: The pasted content's line endings are
  **normalised to the destination document's** effective ending as it is inserted (FR-023a) — a paste can never
  silently make a file mixed.
- **A test fixture that deliberately contains mixed line endings**: Opened and edited **without** being
  rewritten (FR-023b). Auto-normalisation would corrupt exactly the fixtures 006's line-ending-fidelity
  guarantee depends on.
- **Clipboard mode collisions**: *Verbatim*, *full-line* and *rectangular* are mutually exclusive; the most
  recent copy/cut determines the mode, and any clipboard change from another source drops back to verbatim.
- **`cut-line` over a rectangular selection**: The **selection** decides the mode, so the entry is
  **rectangular**, not full-line or verbatim (FR-016b) — Ctrl+X, the content menu and the native binding all
  agree.
- **Mixed rectangular and ordinary selections** (if constructible): The entry is **verbatim** — neither
  rectangular nor full-line.
- **Undo after a multi-line or multi-cursor command**: One Undo reverts the whole command — a ten-row column
  paste, a three-caret `cut-line`, a block indent across 50 lines (FR-026) — and restores the prior cursor set.
- **Cut in one file, paste into another**: The two files are **different documents**, so their undo stacks are
  **entirely separate** (FR-026e). Undo in the source restores the cut text; undo in the destination removes the
  paste. Neither affects the other.
- **Undo pressed in a panel that did not make the edit** (same file, two panels): The content reverts, and the
  entry's recorded cursor set is applied to **the panel where Undo was pressed**, scrolling it to show what
  changed (FR-026f). The other panel keeps its own cursors and viewport.
- **Undo after a save**: Permitted — the document returns to its pre-save content and is marked **dirty**
  again (FR-026d). A save does not truncate or barrier the history.
- **Undo after a revert or external reload**: The history is **cleared** (FR-026d) — it described content that
  no longer exists, so Undo cannot resurrect it. Undo is simply unavailable until the user edits again.
- **Reopening a file after closing its last panel**: The buffer was destroyed, so the file reopens with a
  **fresh, empty** undo history (FR-026d) — a **normal close** discards it.
- **Reopening a document after a crash**: The undo history **is restored** with the recovered content
  (FR-027a) — a crash is not a normal close. Undo, redo and the prior cursor sets work exactly as before the
  crash, though the restored history may be **shorter** (the persisted copy is size-bounded).
- **Crash recovery of a document whose unsaved edits changed its indentation style**: Inference samples the
  **recovered content**, not the stale disk copy (FR-027) — a file converted from tabs to spaces before the
  crash keeps inserting **spaces** after recovery, not tabs.
- **A crash after a session of very large edits**: The persisted undo history is **capped by serialised size**,
  oldest entries dropped first (FR-027a), so the recovery snapshot cannot be bloated and its write cadence is
  unaffected.
- **Secret cut from a file, then saved**: The file on disk is clean, but the removed text **remains in the
  persisted undo history** until the recovery snapshot is discarded (FR-027b) — an accepted, **stated**
  consequence of crash-surviving undo. It never reaches logs or telemetry, and a user who does not want it can
  **disable persistence** (FR-027c).
- **User turns persistent undo off**: Any **already-persisted** history is **purged immediately** (FR-027c) —
  turning the setting off does not leave previously written content on disk. Crashes thereafter still restore
  the document's **content**, with an **empty** undo history.
- **Crash with persistent undo disabled**: The document's content is recovered exactly as 006 guarantees; only
  the **undo history** is absent (FR-027c). Recovery itself is never weakened by the setting.
- **A very long editing session**: The history retains **at least 500 entries** and discards the **oldest**
  beyond that (FR-026d), so memory does not grow without bound. The depth is fixed, not a user setting.
- **Undo in a cross-window synced editor**: All mirrored views share **one** undo stack over the shared buffer
  (FR-026c), so Undo in view B reverts an edit made in view A, and the dirty state updates in both. There is no
  per-view history that could revert a stale range.
- **Rectangular selection in a cross-window synced editor**: Block selection is per-view editing state and
  MUST NOT disturb the shared buffer or its dirty state (FR-023).
- **Right-click outside an active selection**: The selection collapses and the caret moves to the click point
  before the menu opens, so Paste lands where the user pointed (FR-012a).
- **Content-menu Cut/Copy with nothing selected**: Acts on the caret's whole line and marks a full-line
  clipboard entry (FR-012b) — never a silent no-op or a disabled item.
- **Right-click menus not colliding**: The editor **content** menu (editing actions) and the 006 **panel
  header** menu (Save/Revert) MUST remain separate (US2 AS5).
- **Indentation setting changed while editors are open**: Editors of the affected language that have **no
  inferred style** MUST pick up the new setting without being reopened; editors with an inferred style keep
  it (US4 AS5).
- **Tab characters in a space-indented document**: Stray tabs still render at the configured **tab display
  width** (FR-018e); the editor MUST NOT normalise them to spaces.
- **Outdent (Shift+Tab) on a line with no leading whitespace**: A no-op — the line is unchanged and no error
  is raised (FR-019a).
- **Indentation for an undetected / plain-text document**: Falls back to the inferred style, else the global
  default (2 spaces) — no language profile is required for a document to be indentable.
- **Empty, single-line, or wholly unindented document**: The sample yields no indented lines, so there is
  **no inferred style** and the configured profile applies (US4 AS3/AS4).
- **Very short document**: 10% of a small line count MUST still sample **at least one line**, so a one-line
  file is not skipped by rounding.
- **Very long document**: The sample is capped at **100 lines**, so inference cost does not grow with file
  size and the open path stays within FR-008 / SC-003.
- **Deeply indented sampled line**: Leading whitespace running past the inspected **first 20 characters** has
  an indeterminate width and is **excluded from the width tally** rather than counted as 20 (FR-018c). A tab
  within the prefix still forces the tabs style.
- **Mixed indentation already in the file**: The sample's **most frequent** leading-space count wins, with a
  tab anywhere in the sample forcing **tabs** (FR-018c). The editor MUST NOT attempt to repair the file.
- **Inferred style vs manual language override**: The inferred style wins for indentation; a language
  override changes the *fallback* profile, not an already-inferred style.
- **Same file open in two separate panels**: They are **clones of one document** (FR-028) — one buffer, one
  dirty state, **one undo history**, **one effective language**, **one effective indentation**. Setting the
  language in either changes both. Only **cursor, selection, scroll and zoom** differ (FR-028c), so the user
  can read two regions of the file at once.
- **New/empty file open in two panels with different language overrides**: Impossible to produce mixed
  indentation — the override is a **document** property (FR-028b), so both panels always agree. This was the
  concrete hazard the per-panel model allowed (Go → tabs in one, Python → 4 spaces in the other, into one
  buffer).
- **A panel opened later on an already-overridden file**: It **adopts** the document's override rather than
  re-detecting (FR-028b), so it never disagrees with the panel already showing the file.
- **One panel's edit invalidates another panel's cursor or block selection** (its lines were deleted): That
  panel's **view state** is adjusted or collapsed gracefully (FR-028c) — never left pointing at content that no
  longer exists — without disturbing the shared buffer.
- **Cross-window synced editor (006 mirror)**: Highlighting, the content menu, the language indicator,
  cut-line, and indentation MUST work in every mirrored view; they are per-view editing behaviours and MUST
  NOT disturb the single shared buffer or its dirty state (006 FR-034).
- **Opening find with a rectangular block or multiple cursors selected**: A **one-row** block seeds the find
  input; a **multi-row** block or a multi-cursor set with several non-empty selections seeds **nothing** and
  find opens with the last term (FR-025i). No content is altered, and no arbitrary "primary" selection is
  silently chosen.
- **Search match landing on a syntax-coloured token**: The match highlight is drawn **behind** the token; the
  token keeps its syntax colour (FR-007a). The pairing is contrast-checked at build time on every bundled theme,
  so a dark keyword can never disappear inside a dark current-match highlight.
- **Search match inside a line beyond the long-line guard**: The line is unhighlighted plain text (FR-008a), so
  the match highlight has only the default foreground beneath it — legible by construction.
- **Tab pressed while 013's find bar has focus**: It moves within the **find bar** — it does **not** indent the
  document (FR-017f). Chords are scoped by **input focus**, so an editing command never mutates the file while
  the user is typing a search term.
- **A new feature adds a colliding default chord later**: Caught at build time, because the collision test
  enumerates the **command registry** rather than a hand-listed set of features (FR-017b1). A list-based test
  would have passed while the collision shipped.
- **"Restore All Themes to Default" (014) after this feature ships**: Every built-in theme returns to its
  **shipped** values — including shipped values for the **status-strip tokens** (FR-010f), so the strip is never
  left unstyled or illegible by a restore.
- **A chord pressed while the active panel is not an editor**: The seven registered commands do not fire —
  they are scoped to the window's **active Editor Panel** (012, FR-024a). Tab in the file tree, or Ctrl+X in a
  Terminal Panel, is unaffected by this feature (FR-017d).
- **A chord claimed by both 012 and this feature**: 012's window-level command (move-focus, zoom) **wins** — an
  editor MUST NOT swallow a move-focus chord (FR-024b). The shipped defaults do not collide, and FR-017b1's
  build-time test now covers 012's bindings as well.
- **Editor Panel not active, or its window in the background**: The status strip adopts 012's **dimmed
  inactive** treatment along with the rest of the panel (FR-010g); it never stays brightly lit while its panel
  is dimmed.
- **Language indicator in a narrow or short panel**: The status strip MUST remain visible and the indicator
  usable (truncating its label) rather than overflowing or disappearing when the Editor Panel is very narrow;
  a very short panel MUST still render the strip without collapsing the text area to zero height.

## Requirements *(mandatory)*

### Functional Requirements

#### Language detection & the language registry

- **FR-001**: The editor MUST provide **syntax highlighting** for each of these languages — **31 language
  targets** in total:
  - **Programming languages (17)**: **C#, C, C++, Rust, Go, Python, JavaScript, TypeScript, Java, Kotlin,
    Swift, Dart, PHP, Ruby, Lua, PowerShell, Shell (POSIX/Bash)**.
  - **Markup & styling (6)**: **HTML, CSS, SASS/SCSS, LESS, Vue (single-file components), XML**.
  - **Data, config & documentation (8)**: **JSON, JSONC (JSON with comments), YAML, TOML, INI, Markdown,
    SQL**, and **Jupyter Notebook** (highlighted as JSON, FR-009).
- **FR-001a**: The **data, config and documentation** languages of FR-001 are **first-class targets**, not
  incidental: **JSON** in particular MUST be a declared, user-selectable language, both because FR-009
  requires `.ipynb` to be highlighted **as JSON** (a highlighter the registry must therefore declare) and
  because throng's **own** configuration surface — settings, key bindings and theme files (feature 007) — is
  JSON, and those are among the files a user is most likely to open in the editor.
- **FR-002**: The system MUST determine a document's **language before selecting a highlighter** (detect
  first, then render). Detection MUST be based **solely on the file's extension**, matched **case-insensitively**
  against the **dot-prefixed suffixes** declared by the registry, including **compound suffixes** such as
  `.d.ts`. Detection MUST **NOT inspect document content** — no shebang, tag, doctype, or keyword heuristics.
- **FR-002b**: Where a filename matches **more than one declared suffix**, the **longest declared suffix MUST
  win** (`types.d.ts` resolves `.d.ts` ahead of `.ts`). A filename whose **only dot is its first character**
  (`.gitignore`, `.env`), or that **contains no dot at all** (`Dockerfile`), MUST be treated as having **no
  extension** and MUST open as **plain text**. This feature MUST NOT match on **whole filenames**; the
  registry's descriptor shape MUST, however, leave room for **exact-filename descriptors** to be added later
  without a breaking change (see [Out of Scope](#out-of-scope)).
- **FR-002a**: Detection MUST run **once per document identity**: when a document is opened, and again only
  when its identity or on-disk content is replaced (**rename, Save-As, revert, external reload**). Detection
  MUST **NOT** run while the user types, and MUST NOT change a document's language in response to content
  edits.
- **FR-003**: A file whose extension is **unrecognised or absent** MUST open as **plain text**. The **manual
  language override (FR-010) is the sole correction path** for a missing or misleading extension.
- **FR-004**: Detection and highlighter selection MUST be structured as an **extensible language registry** —
  a single authoritative source with **one descriptor per supported language** (its identity/display name,
  its associated file extensions, its indentation profile, and the highlighter to apply) — so **new
  languages can be added by adding a descriptor**, without modifying the editor's core logic (open/closed;
  reuse of the existing editor component's language ecosystem is expected — see Assumptions).
- **FR-004a**: The extension→language mapping MUST be **many-to-one**: a language descriptor MAY claim **any
  number of extensions** (e.g. `.ts` and `.d.ts` both → TypeScript), but **no file extension may be claimed by
  more than one language descriptor**. This uniqueness — over **extensions**, not languages — MUST be enforced
  by an automated registry test so detection is deterministic. Genuinely ambiguous extensions are assigned by
  fiat in the built-in registry; **`.h` MUST map to C++** (the safer superset — a C++ highlighter renders C
  headers correctly).
- **FR-004b**: The user MUST be able to **override the extension→language mapping in settings** (e.g. remap
  `.h` to C). A user mapping MUST be **user-scoped** (applying to every project, sub-workspace and panel),
  MUST accept any supported language for any extension, MUST take effect for open editors **without
  reopening** them, and MUST be **exposed in the visual settings editor** per FR-022.
- **FR-004c**: **"Plain Text" MUST be a valid value** in the extension mapping — a first-class choice in the
  keyed-table control's value list, exactly as it is in the per-panel picker (FR-011) — so a user can
  **globally disable highlighting for an extension** (e.g. `.md`, `.log`, `.h`) rather than re-applying a
  per-document override on every open. An explicit Plain Text mapping is an **authoritative decision that
  terminates precedence** (FR-005a): resolution **stops** there and the document opens as plain text. It MUST
  **NOT** be confused with an **unresolvable** id (FR-005b), which contributes nothing and **falls through** to
  the next rung — were an explicit Plain Text choice to fall through, the built-in registry would silently
  re-apply the very highlighting the user just switched off.
- **FR-005**: The editor MUST apply the highlighter matched to the detected language, and MUST **fall back to
  plain, unhighlighted text** — never an error or corrupted rendering — when no language is detected or no
  highlighter exists for the detected language.
- **FR-005a**: Where more than one source names a document's language, precedence MUST be, **highest first**:
  **(1)** the **document's** **manual language override** (FR-010/FR-028b — document-scoped, not per panel),
  **(2)** the user's **extension mapping** from
  settings (FR-004b), **(3)** the **built-in registry** mapping (FR-004a), **(4)** **plain text**. The
  resulting language is the document's **effective language**, and it selects both the highlighter and the
  fallback indentation profile. A rung that names **Plain Text explicitly** — whether the **document** override
  (FR-011/FR-028b) or the extension mapping (FR-004c) — is a **decision, not an absence**: it **terminates** the chain
  at that rung and yields plain text. Only a rung that is **empty or unresolvable** (FR-005b) contributes
  nothing and falls through to the next.
- **FR-005b**: A **persisted language id that no longer resolves** against the registry — whether held in a
  the **document's** manual override (FR-010a/FR-028b) or a user extension mapping (FR-004b), and however it
  became stale (upgrade, hand-edited file, state carried between versions) — MUST be treated as **no language**
  at that
  rung of the precedence chain: resolution falls through to the next rung, the document may open as **plain
  text**, and **no error is raised**. The **stored id MUST be preserved**, not deleted or rewritten, so that a
  version reintroducing the language resolves it again automatically. The settings editor MAY surface such a
  mapping as **unresolved**.
- **FR-006**: Syntax highlighting MUST update **live** as the user edits (newly entered code is highlighted
  without reopening the document).
- **FR-007**: Highlighting MUST be **legible against every bundled theme** in both light and dark
  presentations. Its colours are **theme tokens** (FR-007b), so each theme owns — and can be authored to
  guarantee — the legibility of code shown against its own editor background.
- **FR-007b**: **Syntax colours MUST be first-class theme tokens.** The highlight palette MUST be expressed as a
  small, **closed** set of **exactly TEN named syntax colour tokens** added to the theme record
  *(enumerated 2026-07-12: the spec previously said "at minimum … 8" in one place and "~8–10" in another. A
  range is not a set: **every** token costs ~15 shipped values, a descriptor, hand-written copy and
  completeness coverage, so the set must be **closed in the spec**, not chosen at implementation time)*:

  | Token | Colours |
  |---|---|
  | `syntaxKeyword` | `if`, `return`, `class`, `func` … |
  | `syntaxString` | string and character literals |
  | `syntaxComment` | line and block comments |
  | `syntaxNumber` | numeric literals |
  | `syntaxType` | type names, classes, interfaces |
  | `syntaxFunction` | function and method names at their call/definition site |
  | `syntaxVariable` | identifiers, parameters, properties |
  | `syntaxOperator` | `+`, `=>`, `&&` … |
  | `syntaxPunctuation` | brackets, braces, commas, semicolons |
  | `syntaxInvalid` | text the grammar could not parse |

  Consequently:
  - Every **bundled theme MUST ship a value for every syntax token**, held in feature **010**'s shipped-defaults
    record. This is required for the same reason as FR-010f: feature **014**'s **"Restore All Themes to
    Default"** resets every built-in theme to its **shipped** values, so a token without one would leave code
    unstyled or illegible after a restore.
  - Each token MUST carry an **editor-metadata descriptor** with a plain-language label and description, MUST be
    **exposed in the Themes editor** (014), and MUST be covered by the **theme-token completeness test** — as the
    constitution's Configuration-editor completeness rule requires of *every* theme token (FR-022).
  - A **user or custom theme MUST be able to override** any syntax token, like any other theme colour.
  - **This reverses the 2026-07-08 deferral** ("a built-in, theme-aware highlight style; per-token colours are a
    later enhancement"). That deferral was **not achievable**: no single palette is legible on both **Matrix**
    (green-on-black) and **Light** (dark-on-white), so the colours must resolve **per theme** in any case — and
    a derived-but-unnamed palette would be one nobody owns, nobody can tune, and no theme author can be held to.
    Making them tokens is what makes FR-007's "legible on every bundled theme" a promise the project can
    actually keep — and what gives FR-007a's contrast guard a real per-theme value to measure.
  - **Accepted cost — this is the largest single addition of the pass.** Roughly **10 tokens × 15 bundled
    themes ≈ 150 shipped colour values**, each needing a descriptor and completeness coverage. It is accepted
    because the alternative does not work, not because it is cheap.
- **FR-007c**: **Adding the syntax tokens MUST NOT break feature 009's theme-distinctness gate.** 009 measures
  the distance between two themes as the **mean CIEDE2000 across every shared colour token**
  (`themePairDistance`), and hard-fails below `DISTINCTNESS_THRESHOLD = 4.3` — with the closest legitimate
  bundled pair sitting at **4.469**, a margin of only **0.17**. Adding ~10 new tokens **changes that mean for
  every pair**, and if the bundled themes were given **similar** syntax palettes (keywords are blue-ish almost
  everywhere), the pairs would move **closer together** and the gate would **fail the build**. Therefore:
  - Each bundled theme's syntax palette MUST be **drawn from that theme's own character**, not copied between
    themes — a genuinely per-theme palette **increases** distinctness rather than eroding it.
  - The distinctness gate MUST be **re-measured** once the tokens land, and `CLOSEST_LEGITIMATE_PAIR_DELTA` /
    `DISTINCTNESS_THRESHOLD` **recalibrated if and only if** the closest *legitimate* pair has genuinely moved —
    never loosened merely to make a copy-pasted palette pass. (Precedent: 009's own comment records that 013's
    match-highlight tokens shifted this pair.)
- **FR-007a**: Syntax highlighting MUST **compose** with feature **013**'s search **match highlights**, and the
  combination MUST be **proven legible, not assumed**:
  - The match highlight (ordinary match and **current** match) is a **background** layer; the syntax token
    colour remains the **foreground** and MUST NOT be suppressed inside a match. Matched code keeps its
    highlighting rather than flattening into a solid block.
  - **This feature MUST validate the colours it itself introduces.** The syntax palette is **new colour that
    only this feature creates**, so no other feature can check it. An automated guard MUST therefore measure
    **every syntax token colour** against **both** the ordinary-match and current-match highlight backgrounds, by
    **adding those pairings to feature 009's existing enumerated list** (`CONTRAST_PAIRINGS`).
  - **It MUST NOT change theme policy.** The new pairings inherit **009's existing in-scope/out-of-scope
    behaviour exactly** — build-blocking on the themes 009 already gates, reported (not thrown) on the rest —
    and this feature MUST NOT gate any **additional** theme, alter any theme's colours, or add any theme-related
    UI. The set of gated themes MUST be **read from 009's single list, never copied**, so that when that list
    grows these pairings follow it **automatically, with no change here**.
    *(Bringing further themes up to WCAG AA — and surfacing conformance in the theme picker — is a **theme
    redesign**, deliberately **out of scope**, tracked as
    **[#61](https://github.com/Bidthedog/throng/issues/61)** on the **vNext** milestone. Requiring all fifteen
    bundled themes to clear WCAG AA here was **rejected**: several **already fail** 009's existing pairings —
    which is precisely why `knownContrastIssues()` reports rather than throws — and some cannot pass without
    being recoloured. A guard that fails on the day it is written is not a guard.)*
  - This closes a gap neither feature covers alone: **013 FR-019** guarantees match highlights are legible over
    **plain text** (all the editor rendered when 013 shipped), and **SC-007** guarantees syntax colours are
    legible against the **editor background** — but nothing guaranteed a dark keyword stays readable inside a
    dark current-match highlight. Searching a code file must never make the current match the one thing the user
    cannot read.
- **FR-008**: The **cost of highlighting MUST be a function of the visible region, not of document size**.
  Consequently **every** file the editor permits to open (006 FR-062) MUST be **fully highlighted** — there is
  **no** second, highlighting-specific size threshold, no "too big to highlight" mode, and no degraded
  presentation. Highlighting MUST meet these budgets, which MUST hold for **any** permitted file, at its
  largest as at its smallest:
  - **First highlight** MUST be visible within **200 ms** of the document being rendered.
  - Highlighting MUST never make the **UI unresponsive for more than 50 ms** at a stretch — i.e. it MUST NOT
    cause any **main-thread task** to exceed 50 ms — so the window never freezes and scrolling never stalls.
    *(Wording aligned with SC-003 on 2026-07-12: this budget was phrased as "no main-thread **highlighting**
    task over 50 ms" here and as "the **UI** never unresponsive for more than 50 ms" in SC-003 — a strictly
    broader claim. They are **one** budget, and the broader phrasing is the one that matters to a user, so it
    is the one stated: what a user feels is a frozen window, not which subsystem froze it.)*
  - **Typing** MUST add no more than **16 ms** (one frame at 60 Hz) of latency — i.e. highlighting MUST NOT
    cause a dropped frame while editing.
  - Highlighting MUST NOT block editing, scrolling, or saving at any point.
  The **sole exception** is the long-line guard of FR-008a — an exception about individual **lines**, never
  about files.
  *(This replaces the earlier "MAY degrade gracefully for very large but permitted files" allowance: with cost
  bounded by the viewport, there is nothing to degrade to and no condition under which degradation triggers.)*
- **FR-008a**: **Long-line guard.** Viewport-scoped cost (FR-008) collapses when a **single line** is enormous:
  the visible region *is* that line, so tokenising a 1 MB minified bundle on one line is unavoidably
  proportional to the whole line and cannot meet FR-008's budgets. Therefore:
  - Any **single line longer than 10,000 characters** MUST be rendered as **unhighlighted plain text**.
  - The **rest of the document MUST continue to highlight normally** — one long line MUST NOT disable
    highlighting for the whole file — and FR-008's budgets MUST still hold for the document as a whole.
  - Such a line MUST remain **fully editable**: it scrolls, selects, edits and saves like any other line, and
    its content is never modified. Only its *highlighting* is withheld.
  - The threshold MUST be **fixed, not user-configurable** — for the same reason as the undo bound (FR-026d):
    exposing it would make it a setting, requiring a descriptor, Settings-editor exposure and completeness-test
    coverage (FR-022) for a knob with no real user value.
  - This is the **only** circumstance in which any part of a permitted file goes unhighlighted.
- **FR-009**: A **Jupyter Notebook (`.ipynb`)** MUST be highlighted as its raw **JSON** document; a rich
  per-cell notebook view is out of scope.

#### Manual language override

- **FR-010**: The user MUST be able to **manually set/override the language** of the active editor. The
  chosen language MUST apply **immediately** (the document is re-highlighted) and automatic detection MUST
  NOT silently revert it.
- **FR-010a**: A manual override MUST be scoped to the **DOCUMENT** and **persisted keyed by the file**. It
  MUST therefore **survive an application restart**, MUST apply to **every mirrored view** of a synced panel
  (006 FR-034), and MUST apply to **every other panel showing the same file** — including one opened later,
  which adopts the override rather than re-detecting (**FR-028**/**FR-028b**).
  *(**Superseded 2026-07-12.** This requirement originally scoped the override to the **panel**, persisted it
  with the panel's layout entry — "no data-schema change" — and had *"a **different** panel opening the same
  file run detection independently and NOT inherit the override"*. That was **rejected**: since 006 gives one
  file **one shared buffer**, and the effective language selects the **indentation** written into that buffer
  (FR-010b), two panels with different languages could insert **two indentation styles into one file**. A file
  open in several panels is **one document in every respect**.)*
- **FR-010b**: A manual override MUST also govern the document's **indentation profile** (FR-018) — the
  overridden language, not the extension, selects the indentation to apply.
- **FR-010c**: The Editor Panel MUST show a **persistent language indicator** displaying the document's
  **effective language** (detected, overridden, or "Plain Text"), presented as a **right-aligned label in a
  status strip along the bottom of the Editor Panel**. The indicator MUST be **clickable** and MUST open the
  language picker. It MUST appear in **every mirrored view** of a synced panel and MUST update immediately
  when the effective language changes. The strip MUST NOT be placed in the panel header (FR-014) and MUST NOT
  overlay the document text; it MUST remain visible while the document is scrolled, and MUST NOT reduce the
  usable text area enough to break scrolling or the large-file behaviour of FR-008.
- **FR-010d**: The **editor content context menu** MUST additionally offer a **"Set Language…"** item that
  opens the **same** language picker as the indicator (one picker, two entry points).
- **FR-010e**: The language **picker** MUST be **searchable/filterable** across all supported languages,
  MUST indicate the **currently effective language**, and MUST apply the chosen language immediately on
  selection.
- **FR-010f**: The language indicator introduces new UI chrome; its **theme tokens MUST be added to the
  theme-token set**, exposed in the visual **Themes editor** (now owned by feature **014**), and covered by the
  **theme-metadata registry + completeness test** required by the constitution (Configuration-editor
  completeness rule). The indicator MUST be legible on every bundled theme. Because 014 ships **"Restore All
  Themes to Default"** — which resets **every built-in theme** to its **shipped** values — these tokens MUST
  carry **shipped values in every bundled theme** within feature 010's defaults record. Otherwise a Restore All
  would yield built-in themes whose status strip is unstyled or illegible.
- **FR-010g**: The status strip MUST participate in **feature 012's active/inactive panel treatment**: it MUST
  adopt 012's **dimmed inactive** presentation when its Editor Panel is not the window's active panel, or when
  the window is in the background, and its **foreground** presentation when it is active. It MUST **reuse
  012's existing focus-state theme tokens** rather than introducing a parallel set — this feature's own new
  tokens (FR-010f) cover the strip's **own** surfaces (e.g. background / foreground / hover), not the
  focus-state treatment. A strip that stayed brightly lit while every other panel in a background window
  dimmed would contradict 012's two-state indicator.
- **FR-011**: The manual selector MUST offer **plain text / no language** as a choice, which removes
  highlighting for that editor; this choice is itself a persisted override (it MUST NOT be re-detected away)
  and MUST be reflected by the indicator as "Plain Text".

#### Editor content context menu

- **FR-012**: Right-clicking within the **editor content area** MUST present a context menu offering the
  standard text-editing actions: **Cut, Copy, Paste, Select All, Undo, Redo** (at minimum), plus **"Set
  Language…"** (FR-010d). The user MUST be able to complete **cut, copy, and paste entirely via this menu**
  (no keyboard required).
- **FR-012a**: Right-clicking the content area MUST **preserve an existing selection when the click falls
  inside it**, and MUST **collapse the selection and move the caret to the click point when the click falls
  outside it**. The menu's actions then operate on the resulting selection/caret.
- **FR-012b**: With **no selection**, the content menu's **Cut** MUST cut the caret's **entire line** —
  behaving identically to `cut-line` (FR-015/FR-015a) — and its **Copy** MUST copy the caret's entire line.
  **Both MUST set the full-line clipboard marker** (FR-015a), so pasting either inserts a whole line above
  the caret's line. Cut and Copy MUST NOT be disabled merely because nothing is selected.
- **FR-013**: The content menu's actions MUST use the **OS clipboard** (so cut/copy/paste interoperate with
  other applications) and MUST act on the current selection/cursor as expected (Paste inserts at the
  cursor/over the selection, except where a full-line entry applies per FR-015a).
- **FR-013a**: All access to the **OS clipboard** MUST sit behind a **platform abstraction with contract
  tests**, as the constitution's **Principle II** (Platform-Abstracted Core) requires of *all*
  OS-specific behaviour and **Principle V** requires of every abstraction contract. This feature is the first
  to need one, because it does not merely let the editor component handle copy/paste natively — it **reads the
  live clipboard's current text on every paste** to decide the paste mode (FR-015c), which is a direct OS
  query made from **core decision logic**. The seam MUST:
  - Expose, at minimum: **write text** to the clipboard, and **read the clipboard's current text**.
  - Be consumed by the paste-mode decision (FR-015c) and by every cut/copy/paste path
    (FR-013/FR-015a/FR-025b/FR-025d) — core logic MUST NOT make direct OS clipboard calls (Principle II).
  - Have **contract tests** that any OS-specific implementation is verified against (Principle V), so a future
    macOS or Linux implementation is a new implementation of an existing contract, not a rewrite.
  - Keep throng's **clipboard-mode record** (FR-015c) on the **throng side of the seam** — it is application
    state, not an OS capability, and MUST NOT leak a custom format onto the OS clipboard.
  *(This corrects the earlier claim that Part 1 introduces no OS-abstraction seam: once FR-015c required
  reading the clipboard's live contents, it did.)*
- **FR-014**: The editor **content** context menu MUST be **distinct from** the existing 006 **panel-header**
  right-click menu (Save / Revert / panel actions). The two menus MUST NOT be merged, and neither MUST
  suppress or duplicate the other; right-clicking the content shows editing actions, right-clicking the
  header shows panel actions.

#### Cut line (Ctrl+X)

- **FR-015**: Pressing **Ctrl+X with no active selection** MUST **cut the entire current line** — removing it
  (including its line break) and placing it on the **OS clipboard** as the line's text with a trailing line
  break — with the lines below shifting up.
- **FR-015a**: A line cut per FR-015 — **and a line cut or copied from the content menu with no selection
  (FR-012b)** — MUST be marked as a **full-line clipboard entry**. **Pasting** a full-line entry MUST insert
  it as a **whole line immediately above the caret's line**, leaving the text of the caret's line unsplit and
  intact.
- **FR-015b**: The full-line marker MUST be **invalidated whenever the clipboard content changes from any
  other source** (another application, a selection-copy, a selection-cut, or a rectangular copy/cut). Content
  that is marked **neither full-line nor rectangular** MUST paste **verbatim at the caret** (over any
  selection). Pasting a cut line **into another application** MUST yield the line's text with a trailing line
  break.
- **FR-015c**: The clipboard **mode marker** (*full-line*, *rectangular*, or *verbatim* — FR-016b) MUST be
  **application-global**, not per-view: a single in-memory record of **throng's most recent clipboard write**
  (the exact text written, plus its mode), shared by **every Editor Panel in every window**, including
  sub-workspace windows. Consequently:
  - Text cut or copied in **one** panel MUST paste with its original mode in **any other** panel — a
    rectangular block cut from one file pastes **column-wise** into another, and a full-line cut pastes as a
    whole line — which is the primary way the user moves a column block between files.
  - The **OS clipboard always carries plain text** (FR-013/FR-025b/FR-025d): rows joined by the document's
    line ending, a cut line with its trailing line break. The mode marker is **additional** throng-side
    state and MUST NOT alter, wrap, or add a custom format to what other applications receive — content
    copied in throng MUST paste into **any** OS application, and content copied in any OS application MUST
    paste into throng.
  - The marker MUST be **validated against the live OS clipboard on every paste**: it applies **only** while
    the OS clipboard's text still equals the text throng last wrote. If the clipboard has since been changed
    by **any** other source — another application, or another copy/cut within throng — the marker MUST be
    treated as absent and the paste MUST be **verbatim** (FR-015b/FR-025d). This makes invalidation
    self-correcting and removes any need to observe clipboard changes.
  - This record is **in-memory and process-lifetime only**: it MUST NOT be persisted, MUST NOT survive an
    application restart, and introduces **no daemon RPC and no data-schema change** (it is main-process state
    plus IPC, not daemon state).
- **FR-016**: Pressing **Ctrl+X with an active selection** MUST cut **the selection** (the cut-line behaviour
  applies **only** when nothing is selected), and MUST NOT mark the clipboard as a full-line entry.
- **FR-016a**: With **multiple cursors**, cut MUST apply **per cursor**: every cursor **holding a selection**
  cuts exactly that selection (FR-016); every **bare caret** cuts its whole line (FR-015). A **partial
  selection MUST NOT be expanded** to the full lines it touches. When **every** cursor is a bare caret, the
  cut lines MUST be placed on the clipboard in **document order, joined by a single newline**, and the entry
  MUST be marked **full-line** (FR-015a) — pasting it MUST insert a whole line above **each** caret's line.
  A **mixed** set of cursors (some with selections, some bare) MUST NOT be marked full-line.
- **FR-016b**: The **clipboard mode is determined by the selection, not by the command that copied or cut it.**
  Whichever action performs the cut or copy — `cut-line`, the content menu's Cut/Copy, or the native OS
  binding — the resulting entry MUST be marked: **rectangular** when the selection is a rectangular block
  (FR-025b); **full-line** when every cursor is a **bare caret** (FR-015a/FR-012b); and **verbatim**
  otherwise, including a **mixed** set of rectangular rows and ordinary selections. The three modes are
  mutually exclusive (FR-025b), so `cut-line` over a block produces a **rectangular** entry that pastes
  column-wise.
- **FR-017**: Cut-line MUST behave correctly on the **last line of a file with no trailing newline** — the
  line is cut cleanly without leaving a stray blank line or raising an error.
- **FR-017a**: `cut-line` MUST be a **single registered, user-rebindable command** encompassing **both**
  behaviours — it cuts each cursor's **selection**, or that cursor's **whole line** where it has none
  (FR-015/FR-016/FR-016a) — with a **default binding of Ctrl+X**. It MUST appear in the visual **Key Bindings
  editor** and be covered by the **keybinding completeness test** required by the constitution. Rebinding it
  MUST move the **entire** behaviour to the new chord and take effect **without an application restart**;
  **Ctrl+X MUST then revert to the editor's native cut** (selection only, no line-cut).
- **FR-017b**: This feature registers exactly **seven** commands — the editing actions with **no OS
  equivalent**: `cut-line` (FR-017a), **`indent-lines`** (default **Tab**) and **`outdent-lines`** (default
  **Shift+Tab**) per FR-019/FR-019a, and the four **`column-select-*`** commands (FR-025a). All seven MUST
  appear in the visual **Key Bindings editor**, be covered by the **keybinding completeness test**, and honour
  rebinding without an application restart.
- **FR-017b0**: Every registered command MUST declare a **dispatch scope: the SET of contexts in which its chord
  is live**, drawn from at least **`editor`**, **`terminal`** and **`explorer`**. The keybinding model is today
  a **flat map of action id → chords with no scope concept**, and this feature MUST add one, because a chord's
  meaning is already context-dependent throughout the application:
  - **`Ctrl+X` is already the shipped default of `file.cut`** (the File Explorer's cut-file command, which also
    owns `Ctrl+C` and `Ctrl+V`), and FR-017a requires it for **`cut-line`** in the editor. These are **not** in
    conflict — `file.cut` fires when the **File Explorer** has focus, `cut-line` only when an **Editor Panel**
    is the active panel (FR-024a/FR-017f) — but a model with no scopes cannot express that.
  - **The scope MUST be a SET, not a single value**, because the shipped commands already need one. `search.*`
    (013) is *"routed to the ACTIVE panel: a terminal searches its scrollback, an editor searches its file"*, and
    `editor.save*` resolves *"while the active pane is a workspace Panel, not Files & Folders"* — both are live
    in **`editor` and `terminal` but not `explorer`**, which **no single-valued enum can express**. Declaring
    them "global" would be wrong: `Ctrl+F` would then fire with the File Explorer focused.
  - **"Global" is not a distinct scope value — it is simply the full set.** A command live everywhere declares
    every context. This removes the special case entirely (and with it the ambiguity of whether a "global" chord
    is *exempt from* collisions or *must be unique across* them — it is the latter, and set semantics say so
    without a rule).
  - **Every registered command MUST carry a non-empty scope set.** There is **no default**: a command with no
    declared scope MUST **fail the completeness test** rather than being silently treated as global. The 36
    already-shipped commands MUST each be assigned their real set as part of this work (e.g. `file.*` →
    `{explorer}`; `terminal.scroll*` → `{terminal}`; `search.*` and `editor.save*` → `{editor, terminal}`;
    `zoom.*`, `panel.zoom*`, `focus.*`, `view.*` → all contexts).
  - **Dispatch MUST become scope-aware.** The shipped resolver returns the **first** action in map order whose
    chord matches (`resolveAction`, `packages/core/src/config/keybindings.ts`), so with a flat map `Ctrl+X` would
    resolve to `file.cut` **everywhere — including inside an editor — and `cut-line` would never fire at all**.
    Resolution MUST therefore take the **active context** (from 012's active-panel context and input focus,
    FR-017f) and consider only commands whose scope set contains it. Without this the `scope` field is
    decorative.
  - The **Key Bindings editor** (007) MUST **show each command's scope**, so a user seeing `Ctrl+X` listed
    twice understands why, and so the warn-and-choose conflict flow (007 FR-034) can tell a **real** conflict
    from a scoped coexistence.
  - **Accepted cost:** a `scope` field on the command descriptor and its editor metadata, plus a scope-aware
    resolver and a scope assignment for every existing command — a **third** touch of a shared component (with
    FR-022a's keyed-table control and FR-013a's clipboard seam).
- **FR-017b1**: An automated test — extending the constitution's **keybinding completeness test** — MUST assert
  that **no two registered commands ship the same default chord in any context they share**: two commands
  conflict **if and only if their scope SETS intersect** on a common chord. A command live everywhere therefore
  collides with **every** command sharing its chord (it intersects every set), and two commands in **disjoint**
  contexts may share a chord freely. A colliding default MUST fail the build rather than reach a user. Two
  further rules govern the test itself:
  - It MUST be **exhaustive over every registered command, enumerated from the command registry itself** —
    **never** from a hand-maintained list of features. A list-based test silently omits any feature added after
    it was written and then **passes while a real collision ships**: this requirement originally listed only
    "features 003–007", and **012**, **013** and **014** were all merged afterwards, **013** alone adding
    roughly **thirteen** default chords. *(014 registers **no** bindings — but the test MUST NOT depend on
    anyone having checked that.)*
  - It MUST be **scope-aware, not flat**. A flat "no two commands share a chord, app-wide" rule is **wrong**: it
    forbids legitimate **context-scoped** chords the application already depends on (Ctrl+C copies a file in the
    Explorer and reaches the shell as SIGINT in a terminal), and it would **fail the build on `cut-line`** —
    forcing this feature's headline binding off Ctrl+X to satisfy a test, in direct contradiction of FR-017a
    and US3.
- **FR-017f**: Chord dispatch MUST be scoped by **input focus**, not merely by the active panel (FR-024a).
  While a **transient input surface inside the active Editor Panel holds focus** — feature **013**'s
  find/replace bar above all — that surface's own keys MUST win, and this feature's seven commands MUST **NOT**
  fire. Concretely: with the find bar focused, **Tab** MUST move within the find bar and MUST **NOT** run
  `indent-lines` on the document. An editing command MUST never mutate the file while the user is typing into a
  search box.
- **FR-017b2**: **User-created** binding conflicts remain governed by **007 FR-034**: the Key Bindings editor
  MUST warn and require an explicit **Reassign** or **Cancel**. This feature MUST NOT introduce a
  silent last-writer-wins path for chords.
- **FR-017c**: The **clipboard and standard-editing actions** — Cut, Copy, Paste, Select All, Undo, Redo —
  MUST retain their **native OS bindings**, MUST NOT be registered as commands, and MUST NOT appear in the Key
  Bindings editor, so that they interoperate with the rest of the system. The **Alt+click+drag** column-select
  gesture is likewise not a command. No keybindings beyond the seven of FR-017b are introduced.
- **FR-017d**: These rules apply to **Editor Panels only**. **Terminal Panels are unaffected**: their key
  handling remains **PTY passthrough** as established by feature 005 (Ctrl+C, Ctrl+D, Ctrl+X and similar
  control chords MUST continue to reach the shell), and this feature MUST NOT route terminal input through the
  keybinding registry.
- **FR-017e**: The seven commands' **default chords** — and the **modifier for the column-select mouse
  gesture** (FR-025) — MUST be declared **per platform** in feature 010's shipped-defaults record, **not** as
  flat, platform-less values. Only the **Windows** values ship in Part 1 (Ctrl+X, Tab, Shift+Tab,
  Shift+Alt+Arrow ×4; Alt+click+drag); the record's **shape** MUST accommodate macOS and Linux values later
  **without a breaking change**. This is required by constitution **Principle II** — *"Windows is the first
  supported target, but no design decision MAY foreclose future macOS or Linux implementations"* — and the
  Windows chords are **not** portable: on macOS the clipboard modifier is **⌘**, not Ctrl, and the
  column-select modifier is **Option**. Shipping them flat would make the macOS port a **schema** change to
  shipped defaults rather than an addition of **values**. *(Same principle as FR-002b's requirement that the
  language-descriptor shape accommodate exact-filename matching later: reserve the shape, ship only what is
  needed now.)* No macOS/Linux values are guessed or shipped here.

#### Column (rectangular block) selection

- **FR-025**: The editor MUST support **rectangular (column-block) selection** — the same column range across
  a run of consecutive lines — created and extended by **Alt+click+drag** with the mouse.
- **FR-025a**: Rectangular selection MUST also be creatable and extendable from the **keyboard**, via four
  **registered, user-rebindable commands** — `column-select-up`, `column-select-down`, `column-select-left`,
  `column-select-right` — whose **default bindings are Shift+Alt+Up / Down / Left / Right**. Each MUST appear
  in the visual **Key Bindings editor**, be covered by the **keybinding completeness test** (constitution),
  and take effect on rebinding **without an application restart**. The **mouse gesture is not a command** and
  MUST NOT appear in the Key Bindings editor.
- **FR-025b**: **Cutting or copying** a rectangular selection MUST place its rows on the **OS clipboard**
  joined by the **document's existing line ending** (preserving FR-023), and MUST mark the content as a
  **rectangular clipboard entry** — a **third clipboard mode** alongside *verbatim* and *full-line*
  (FR-015a). The three modes are **mutually exclusive**, and which one applies is decided by the **selection**
  rather than by the command that copied or cut it (FR-016b).
- **FR-025c**: **Pasting** a rectangular clipboard entry MUST insert it **column-wise**: row *n* at the
  caret's column on the *n*-th successive line, extending the document with new lines where it runs past the
  last line, and **padding lines shorter than the paste column** to reach it. It MUST NOT be inserted as one
  contiguous run of text.
- **FR-025c1**: Padding MUST use the **document's effective indentation character** (FR-018c/FR-018a), not
  unconditionally spaces: **spaces** where the effective style is spaces; where it is **tabs**, **tabs up to
  the last whole tab stop at or before the target column, followed by spaces for the remainder** — so the
  paste is **column-exact** without introducing a whitespace style the document does not already use. Padding
  MUST be inserted **only** on lines shorter than the paste column, and MUST NOT rewrite existing content.
- **FR-025d**: The rectangular marker MUST be **invalidated whenever the clipboard changes from another
  source** (another application, a normal copy/cut, or a line-cut) — identical to the full-line marker's rule
  (FR-015b). Pasting a rectangular entry **into another application** MUST yield its rows as plain text
  separated by line breaks.
- **FR-025e**: **Cutting** a rectangular selection MUST remove **only the block's characters** (each row's
  fragment), closing each line up horizontally, and MUST be marked **rectangular** — never full-line —
  regardless of whether the cut was performed by `cut-line`, the content menu, or the native binding
  (FR-016b). **Typing** with a rectangular selection active MUST replace **every row** of the block.
- **FR-025f**: Rows of a block that fall on **lines shorter than the block's column range** MUST contribute
  **empty content** and MUST NOT raise an error, on copy, cut or type-replace.
- **FR-025g**: A rectangular selection is semantically **one selection per row**, and **every** editing
  operation MUST apply **per row**, not just typing (FR-025e). Specifically, with a block active:
  - **Delete** and **Backspace** MUST remove the block's characters on **every row**, closing each line up
    horizontally — identical to a cut (FR-025e) but **without** writing to the clipboard. Where the block is
    **zero-width** (a pure column of carets), **Backspace** MUST delete one character to the **left** of each
    caret and **Delete** one character to the **right**, each row independently.
  - **Enter**, and any other **typed** character, MUST replace **every row** of the block (FR-025e).
  - The operation MUST be a **single atomic undo entry** across all rows (FR-026).
- **FR-025h**: **Pasting** with a rectangular selection active MUST replace the block **per row**, by clipboard
  mode (FR-016b):
  - A **rectangular** entry MUST replace the block **row-for-row** (its row *n* into the block's row *n*),
    extending and padding per FR-025c/FR-025c1 where it has more rows than the block.
  - A **verbatim** entry whose **line count equals the block's row count** MUST be **distributed one line per
    row** — so a column of text copied from **another application** (which necessarily arrives verbatim, since
    the OS clipboard carries no rectangular signal — FR-015c) pastes **column-wise**. This is the **only** way
    external column data can enter a block, and it matches the behaviour of the editors the user works in.
  - A **verbatim** entry whose line count **differs** from the row count MUST replace **every row** with the
    entry's full content.
  - A **full-line** entry MUST collapse the block to its **first (top-left) caret** and insert the line
    **above** that caret's line, per FR-015a — the full-line rule wins over the block.

- **FR-025i**: Feature **013**'s *seed-from-selection* rule (013 FR-002b) pre-fills the find input from a
  **non-empty, single-line** selection. That rule predates this feature's new selection kinds, so it MUST be
  extended by the **same** logic — seed only from an **unambiguous single line of text**:
  - A **one-row** rectangular block **seeds** with its fragment: it *is* a single-line selection.
  - A **multi-row** rectangular block seeds **nothing** — find opens with the last term, exactly as 013 already
    specifies for any selection that is not single-line.
  - A **multi-cursor** set with **more than one** non-empty selection seeds **nothing**; a set with exactly
    **one** non-empty, single-line selection seeds from it.
  - Seeding MUST NOT alter panel content (013 FR-003).
  Picking an arbitrary "primary" selection was **rejected**: a scattered multi-cursor set and a multi-row block
  have no single sensible search term, and silently choosing one would produce a mis-search the user did not ask
  for. Seeding nothing is the honest outcome.

#### Per-language indentation

- **FR-018**: Indentation MUST be configurable **per language**, keyed by the document's **effective
  language** (file extensions resolve to a language through the language registry of FR-004 — the single
  source of truth — and a manual override replaces that result, per FR-010b). Each profile carries an
  **indentation style** (**tabs** or **spaces**), an **indent width** (used when the style is spaces), and a
  **tab display width** (FR-018e).
- **FR-018a**: A **single global indentation default MUST apply to every language unless that language
  overrides it: spaces, indent width 2, tab display width 4.** Documents with **no detected language** (plain text) MUST use the global
  default. **Per-language overrides MUST ship only where the language's established convention differs** from
  the global default (e.g. tabs for Go, 4 spaces for Python).
- **FR-018b**: The indentation configuration MUST be **user-scoped**, extending the existing user `editor`
  settings. It MUST apply to every project and sub-workspace identically. This feature MUST NOT introduce
  **project-scoped** indentation settings, and MUST NOT read `.editorconfig` (both are out of scope — see
  [Out of Scope](#out-of-scope)). The shape of the setting MUST leave room for a future `.editorconfig`
  layer to cascade over it without a breaking change.

  *(2026-07-12: that "future layer" now has a home — **issue #58**, which proposes surfacing the app's first
  **project-scoped** row in the Settings editor. The app already stores project-scoped state (a project's
  hidden-paths list, in SQLite), but nothing has ever presented it as a **setting**, so #58 is where the
  questions of presentation, cascade, and what "reset to default" even means for a project-scoped value get
  answered. This feature stays user-scoped regardless and is **not blocked** by it — but whichever of the two
  lands second MUST reconcile with the first rather than inventing a second cascade.)*
- **FR-018c**: On open, the editor MUST **infer the document's existing indentation style** by sampling the
  document's **first `min(ceil(10% of its lines), 100)` lines** (**never fewer than one line**), and MUST use
  the inferred style **in preference to the configured profile** for that document. Inference MUST be
  evaluated as follows:
  - Only the **first 20 characters** of each sampled line are inspected; the sample is therefore **bounded**
    and its cost **independent of document size**.
  - Only sampled lines that begin with whitespace are considered.
  - If **any** considered line's leading whitespace starts with a **tab**, the inferred style is **tabs**.
  - Otherwise, if considered lines exist, the inferred style is **spaces**, with the **width** taken from the
    **most frequent** leading-space count (ties broken toward the **smaller** width). A line whose leading
    whitespace extends **beyond the inspected 20 characters** has an **indeterminate width** and MUST be
    **excluded from the width tally** (it MUST NOT be counted as width 20).
  - If **no considered lines exist**, or the sample yields no usable result, there is **no inferred style**
    and the effective language's **configured profile applies** (FR-018/FR-018a).
- **FR-018d**: Inference MUST govern only **newly typed and auto-inserted** indentation. It MUST NOT rewrite,
  re-indent, or normalise any existing line, and MUST NOT mark the document dirty (preserving FR-023).
  Inference MUST be re-evaluated whenever the document is **reloaded from disk** (revert, external reload).
- **FR-018e**: The **tab display width** — the number of columns a literal tab character occupies on screen —
  MUST be **configurable separately from the indent width**, with a **global default of 4 columns** and
  optional **per-language overrides**, keyed and user-scoped exactly as FR-018/FR-018b require. It MUST apply
  to **every tab character rendered** in a document, irrespective of that document's inferred (FR-018c) or
  configured indentation style. It MUST **never rewrite, re-indent or normalise existing content**, and
  changing it MUST **never** mark a document dirty: changing it re-renders, it does not re-write. Changing it
  MUST take effect for open editors without reopening them (as FR-021 requires of the other indentation
  settings), and it MUST be exposed in the visual Settings editor per FR-022.
  - **It is also the tab stop for FR-025c1's rectangular-paste padding** *(clarified 2026-07-12 — this
    resolves a contradiction, and it decides bytes on disk)*. FR-025c1 pads a short line with *"tabs up to the
    last whole tab stop"*, and **a tab stop can only be defined by the tab display width** — it is, by
    definition, how many columns a `\t` occupies **in this document**. Any other width would make the padding
    land on the wrong column, defeating the column-exactness FR-025c1 exists to guarantee. The **indent width**
    is *not* a candidate: it governs how many **spaces** one indent level inserts, and says nothing about what
    a tab is worth.
    This narrows FR-018e's original **"rendering only"** wording, which was **too absolute**: the setting still
    never touches a character the user did not just cause to be written, but it **does** decide the width of a
    tab this feature **newly inserts as padding**. That is a *new edit* (FR-025c1), not a re-indent, so
    FR-018d's "never rewrite existing lines" rule is untouched. Both Notepad++ and VS Code behave this way, so
    it reads as native rather than clever.
- **FR-019**: The **`indent-lines`** command (default binding **Tab**) with **no selection** MUST insert the
  document's **effective indentation** — the inferred style where one was found (FR-018c), otherwise the
  profile configured for the effective language — as a tab character or the appropriate number of spaces.
- **FR-019a**: **`indent-lines`** with an **active selection** MUST **indent every line the selection touches**
  by one unit of the effective indentation (it MUST NOT replace the selection with an indent). The
  **`outdent-lines`** command (default binding **Shift+Tab**) MUST **outdent** by one unit — every line the
  selection touches when a selection is active, otherwise the caret's line. Outdenting a line with no leading
  whitespace MUST be a no-op, not an error.
  With **multiple cursors**, indent/outdent MUST apply to **every line any cursor or selection touches**, and
  each such line MUST be indented or outdented **exactly once** however many cursors sit on it. Both commands
  are **registered and rebindable** (FR-017b); rebinding either MUST take effect without a restart.
- **FR-020**: **Automatic indentation** (e.g. the indentation applied when starting a new line inside an
  indented block) MUST follow the **same** effective indentation style, consistently with FR-019.
- **FR-021**: Changing a language's indentation setting (or the global default) MUST take effect for open
  editors of that language **without reopening** them — for documents that have **no inferred style**;
  a document with an inferred style MUST keep using it (the setting is its fallback, not its override).
- **FR-022**: Every configurable artefact this feature introduces MUST satisfy the constitution's
  **Configuration-editor completeness rule** — exposed in the relevant **visual preference editor**, backed by
  an **editor-metadata descriptor**, and covered by the **completeness test**; none may ship as JSON-only.
  Specifically: the **indentation configuration** (global default + per-language overrides, including the
  **tab display width** of FR-018e), the
  **extension→language mapping overrides** (FR-004b), and the **persist-undo-history toggle** (FR-027c) in the
  **Settings** editor; the **seven registered
  commands** — `cut-line`, `indent-lines`, `outdent-lines` and the four `column-select-*` (FR-017b) — in the
  **Key Bindings** editor; and the
  **status-strip / language-indicator theme tokens** (FR-010f) **and the 10 syntax colour tokens** (FR-007b)
  in the **Themes** editor — every one with a descriptor, a shipped value in **every** bundled theme (010's
  record), and completeness-test coverage.
  *(See Dependencies.)*
- **FR-022a**: Two of this feature's settings are **keyed maps**, a shape **no existing control type can
  render**: the **extension→language overrides** (FR-004b — text key → language value) and the **per-language
  indentation overrides** (FR-018/FR-018e — language key → an *object* of style, indent width and tab display
  width). The Settings editor's control vocabulary is **thirteen** kinds as shipped — *number, text, toggle,
  select, multiselect, array, colour, font-family, font-size, enum, chord, icon, folder* *(corrected
  2026-07-12: **007 FR-028** listed **six**; `ControlKind` has since grown seven more, exactly the staleness
  FR-022a's own note predicted)* — and a keyed map of objects fits **none** of them, so FR-022 cannot be
  satisfied without extending that vocabulary. This feature
  MUST therefore add **one new, generic control type — a keyed-table (map) editor** — to the shared
  configuration surface:
  - It MUST be declared in the **single declarative editor-metadata registry** (007 FR-025a) as a new control
    type, so the Settings editor renders it **from a descriptor** like every other control, not from a
    hand-maintained bespoke form.
  - It MUST support **adding and removing rows**, a **key column**, and **one or more typed value columns**,
    each value column reusing an existing control (dropdown, number input, text field, toggle).
  - It MUST be **generic**, not bespoke to this feature: the same control MUST serve both of the settings
    above (extension text → language **dropdown**; language **dropdown** → style dropdown + two number
    inputs), and MUST be reusable by later features that need a keyed map (e.g. the `.editorconfig` cascade of
    FR-018b).
  - **Key validation** MUST be enforced by the control from its descriptor: keys MUST be **unique** within the
    map, an extension key MUST be a valid dot-prefixed suffix, and a value MUST be constrained to the allowed
    set (007 FR-029 — never a free-text field where an enumeration exists). An invalid or duplicate key MUST
    be **rejected in the editor**, leaving the previous mapping standing (Edge Cases).
  - It MUST be covered by the **completeness test** (007 FR-047) exactly as the other control types are.
  - **Accepted cost:** this is **shared-component work in feature 007's Settings editor and metadata
    registry**, not merely a registry entry in this feature — the only such cross-feature cost in Part 1, and
    it is the direct consequence of the constitution's prohibition on JSON-only configuration.
  - *(2026-07-12: the "exhaustively" above is a claim about a list that **other features can extend**, so it
    goes stale silently. Feature **015** did not extend it — it added row **affordances**, not control types.
    But **issue #53** proposes a **slider** control for numeric settings, which would. Whichever of the two
    lands second MUST correct this sentence rather than leave it asserting an exhaustiveness that has since
    lapsed. Treat the vocabulary as **007's list plus whatever has shipped since**, and check before relying
    on it.)*
- **FR-022b**: Every setting this feature introduces MUST be **resettable to its default** through the existing
  restore mechanism — feature **010**'s immutable **shipped-defaults record** and its restore API (*reset one
  setting*, *reset everything*), surfaced by **007**'s reset-to-default / reset-all controls. This applies to
  the **keyed-map** settings as much as to the scalar ones: a map **is one setting**, so resetting it MUST
  restore **the whole map** to its value in the shipped-defaults record. The two maps' defaults differ, and
  both MUST behave correctly:
  - The **extension→language overrides** (FR-004b) ship as an **empty** map — the built-in registry (FR-004a)
    is *not* a setting — so resetting them **clears every user mapping** and detection falls back to the
    built-in registry (FR-005a).
  - The **per-language indentation overrides** (FR-018a) ship **non-empty** (e.g. Go → tabs, Python → 4
    spaces), so resetting them **restores that shipped set**, rather than emptying the map. Resetting the
    **global** indentation default likewise restores **spaces / indent width 2 / tab display width 4**.
  - **Per-entry granularity requires no new affordance**: for an override map, an entry's default is its
    **absence**, so the keyed-table control's **remove-row** (FR-022a) already *is* a per-entry reset.
  - The shipped defaults for all of this feature's settings MUST be **sourced from 010's record**, not
    hard-coded a second time in the editor, and MUST be covered by the completeness/restore tests.
- **FR-022c** *(added 2026-07-12, after feature 015 landed)*: **015 widened the per-row affordance set from
  one action to three**, and every setting this feature adds inherits all three. A row now offers **reset**
  (to the shipped default), **revert** (to the value the preferences window was opened with) and, where the
  field declares it, **clear** (to empty) — rendered in a fixed-width gutter to the **left** of the control.
  Two consequences bind this feature:
  - **Every new setting MUST declare its clearability** on its field descriptor (`FieldDescriptor.clearable`,
    015 FR-016a). Clearability is **declared, never inferred**, and the bar is that **empty is a valid value
    for the field** — the tolerant parser accepts it and a runtime fallback supplies behaviour in its absence
    — *not* that the shipped default happens to be empty. 015's completeness test enforces the declaration by
    round-tripping an empty value through the parser, so a dishonest declaration fails the build.
  - Applying that bar to this feature's two maps gives **opposite answers**, which is the point of declaring
    it rather than guessing: the **extension→language overrides** ship empty and fall back to the built-in
    registry, so they **ARE clearable**; the **per-language indentation overrides** ship non-empty and have no
    "no answer" state, so they are **NOT** — emptying them would be a reset dressed up as a clear, and the two
    must stay tellable apart (015 FR-013).

#### Undo & redo

- **FR-026**: Every editing behaviour this feature introduces MUST form a **single atomic undo entry per
  command invocation**, however many lines or cursors it affected. Specifically: one invocation of `cut-line`
  (across any number of cursors), `indent-lines`, `outdent-lines`, a **paste** of any clipboard mode
  (verbatim, full-line, or rectangular), or a **type-replace** over a rectangular selection MUST be undone by
  **one** Undo and reapplied by **one** Redo.
- **FR-026a**: Undo MUST restore the **document content and the prior selection/cursor set** (including a
  rectangular selection or a multi-cursor set), so that undoing a column edit returns the user to the
  selection they had before it. Redo MUST reapply the command in full.
- **FR-026b**: Undo and Redo MUST be reachable from the **editor content context menu** (FR-012) as well as
  their native OS bindings (FR-017c).
- **FR-026c**: A document has **one undo history per buffer**, not per view. All views of a document MUST share
  **one undo stack**: Undo in **any** view reverts the most recent change made in **any** view, and Redo
  likewise. Undo MUST NOT be able to revert a change that another view has since superseded, because no such
  divergent history exists. Undo/Redo MUST update the shared buffer's **dirty state** consistently across every
  view (FR-023).
  - **The stack lives with the document's authority (FR-028f), in UI main** — not in any view. This is not an
    implementation detail smuggled into a requirement: a per-view stack **cannot** be made correct (FR-026e),
    and CodeMirror's `history()` is **per `EditorView`** by construction, so the requirement is unsatisfiable
    until the history moves out of the view. *(This requirement previously justified itself by saying the
    synced views "mirror a single shared buffer (006 FR-034)". That was **wrong about the shipped code** —
    006's sync relays `{text, dirty}` between **two independent `EditorView`s, each with its own `history()`**,
    so today they have **separate** undo stacks and there is no single shared buffer to inherit. The conclusion
    stands; the premise is now **FR-028f**, which creates the single authority this requirement always assumed.)*
- **FR-026e**: The undo **scope is the DOCUMENT** — never the panel. Two panels showing **different files** have
  **entirely separate** undo stacks (cutting in `a.ts` and pasting into `b.ts` leaves the cut on `a.ts`'s stack
  and the paste on `b.ts`'s, each undone independently); two panels showing the **same** file share that file's
  **one** stack (FR-026c/FR-028). **Per-panel stacks over a shared buffer are rejected as unsound**: if panel A
  typed on line 1 and panel B then deleted lines 1–5, A's undo entry ("remove that text from line 1") no longer
  describes any existing content, and applying it would corrupt the buffer or misapply to unrelated text. Making
  it safe would require **rebasing every undo entry against other panels' edits** (operational transforms) — a
  collaborative-editing engine, far beyond Part 1.
- **FR-026f**: Because the stack is shared but the cursor is **per panel** (FR-028c), an undo entry's recorded
  cursor/selection set (FR-026a) MUST be applied to **the panel in which Undo (or Redo) was invoked**, scrolling
  that panel so the user **sees what was reverted** — even where the edit was originally made in a *different*
  panel. Other panels MUST keep **their own** cursors, adjusted only where the reverted edit invalidated them
  (FR-028c). Undo MUST NOT yank the viewport of a panel the user did not act in.

- **FR-026d**: The undo history's **lifetime is the buffer's lifetime**, and its depth MUST be **bounded**:
  - It MUST **survive a save**. Undo past a save MUST be permitted, returning the document to its pre-save
    content and marking it **dirty** again (FR-023) — saving is not an undo barrier.
  - It MUST **survive views opening, closing and moving** — including a panel dragged to another window — for
    as long as **any** view of the buffer remains, since the history belongs to the buffer, not the view
    (FR-026c).
  - It MUST be **cleared** when the document's content is **replaced from disk** (**revert**, **external
    reload**) — the history describes a document that no longer exists, and undoing into it would resurrect
    stale content — and when the **last view closes** and the buffer is destroyed. Reopening a file that was
    **closed normally** therefore starts a **fresh** history.
  - It MUST, however, **survive a crash and be restored with the document** (**FR-027**) — a crash is not a
    normal close, and the edits recovery preserves are exactly the ones a user most needs to undo.
  - It MUST retain **at least 500 undo entries** per buffer, discarding the **oldest** first beyond that, so
    memory does not grow without limit over a long editing session.
  - This bound MUST be **fixed, not user-configurable**: exposing it would make it a setting, and the
    constitution's Configuration-editor completeness rule would then require a descriptor, Settings-editor
    exposure and completeness-test coverage (FR-022) — cost that a rarely-touched knob does not justify.

#### Crash recovery

- **FR-027**: A **crash-recovery restore** (006) reinstates a document whose content **differs from the copy on
  disk**. It is neither an "open" (FR-018c) nor a "reload from disk" (FR-018d), so this feature MUST state its
  behaviour explicitly. A recovery restore MUST be treated as **opening the document with the recovered
  content**:
  - **Language detection** runs on the file's **extension** as usual (FR-002) — recovery does not change the
    document's identity — and the document's **manual language override** still applies, since it is persisted
    **keyed by the file** (FR-028b) and is therefore independent of the buffer's contents and of any panel's
    lifetime. *(This bullet originally reasoned that the override "lives in the panel's layout, not the buffer";
    that was **superseded later the same day** by FR-028b, which makes the override a property of the
    **document**. The conclusion is unchanged — recovery does not disturb it — but the reason is now that it is
    keyed by the file, not that it rides in the layout.)*
  - **Indentation inference (FR-018c) MUST sample the recovered content, not the on-disk copy.** The recovered
    content *is* the document the user is looking at; the disk copy is stale **by definition** — that is why
    recovery exists. Sampling the disk copy would, for example, keep inserting **tabs** into a file the user
    had spent an hour converting to spaces before the crash.
- **FR-027a**: The **undo history MUST survive a crash** and be restored with the recovered document, so the
  user can undo the very edits recovery preserved. Accordingly:
  - The history — including the **redo** stack and the **cursor/selection set** each entry restores
    (FR-026a) — MUST be **persisted alongside 006's recovery snapshot**, written on the **same cadence** (a
    crash affords no opportunity to flush).
  - It MUST be **bounded by total serialised size** — **1 MiB (1,048,576 bytes) per document**
    *(value stated 2026-07-12; FR-027a previously left it unnamed, and an unnamed bound governing **user data
    written to disk** is a magic number, not a contract)* — discarding the **oldest** entries first once the
    cap is exceeded, so a session of large edits (column pastes, block indents over many lines) can never bloat
    the recovery snapshot or slow the writes the recovery mechanism depends on. **Rationale for 1 MiB**: the
    snapshot is rewritten on a **400 ms debounce** as the user types, so serialising it must stay cheap; 1 MiB
    is far larger than any realistic session's history yet small enough that writing it cannot stall that
    debounce. Like the ≥500-entry and 10,000-character bounds, it is **fixed, not user-configurable**
    (FR-026d's reasoning applies unchanged).
    The **fidelity bound (≥ 500 entries, FR-026d) governs the in-memory history; this size cap governs the
    persisted one** — a recovered history MAY therefore be shorter than the live one it replaces.
  - This is a **change to the recovery artefact's schema** (see Assumptions), and it is the **only**
    persistence this feature adds.
  - After recovery, undo MUST behave exactly as FR-026/FR-026a require — one command, one undo step, restoring
    the prior cursor set.
- **FR-027b**: Persisting the undo history writes **content that is no longer in the document** to disk — the
  text a user **cut, deleted or overwrote** lives on in the stack. Cutting an API key out of a config file and
  saving leaves the file clean while the key remains in the persisted history. Before FR-027a, that text never
  reached disk. This is inherent to crash-surviving undo, and is **accepted and stated**, not hidden — but it
  MUST be contained:
  - The persisted history MUST live in the **same protected per-user location** as 006's recovery snapshot,
    under the same permissions. It MUST **never** be written to logs, telemetry, diagnostics, or any other
    location, and MUST never leave the machine.
  - It MUST be **deleted whenever the recovery snapshot is** — on a **normal close**, and on **discard after a
    successful recovery** — so its lifetime never exceeds the snapshot's.
- **FR-027c**: Persisting the undo history MUST be **user-controllable**: a setting that **disables** it for
  users who would rather not have removed text retained on disk (FR-027b).
  - It **defaults to enabled** — crash-surviving undo is the behaviour most users want, and the retention is
    already bounded by FR-027b.
  - When **disabled**, the undo history MUST **not be persisted at all**: a crash still restores the
    document's **content** (006's guarantee is untouched), but with a **fresh, empty** undo history. The
    **in-memory** history is unaffected (FR-026d still applies in full) — the setting governs **persistence
    only**.
  - Turning it **off** MUST **purge any already-persisted history** immediately, rather than leaving previously
    written content on disk.
  - Being a configurable artefact, it MUST satisfy FR-022 (a boolean toggle in the visual Settings editor,
    backed by an editor-metadata descriptor, covered by the completeness test), its default MUST come from
    feature 010's shipped-defaults record, and it MUST be resettable per FR-022b.

#### One document, one state (panels are clones)

- **FR-028**: **A file open in more than one Editor Panel is ONE document in every respect.** Feature 006
  already guarantees **one buffer per file, app-wide**; this feature extends that from *content* to **all
  document state**. Every panel showing a given file MUST share, as a single value:
  - the **buffer** and its **dirty state** — via the single document authority of **FR-028f**. *(006 FR-034 is
    the **problem**, not the solution: it relays `{text, dirty}` between two co-equal `EditorView`s. That is
    two originals reconciling, which constitution Principle XI now forbids outright.)*
  - the **undo/redo history** (FR-026c/FR-026d) — one stack, however many panels;
  - the **effective language** (FR-005a) — detection, the user extension mapping, and the **manual override**;
  - the **effective indentation** (FR-018/FR-018c) — style, indent width and tab display width.
  Changing any of these in **one** panel MUST change it in **every** panel showing that file, immediately and
  without reopening. Two panels on one file are **clones**, not independent editors.
- **FR-028a**: **Indentation MUST be a property of the document, not of a view** — it decides which
  **characters are written into the shared buffer**, so a per-view value would let one file gain two
  indentation styles, which FR-023a forbids outright. The **effective indentation** is therefore resolved
  **once per document**: the **inferred** style where one exists (FR-018c), otherwise the profile of the
  document's **effective language** (FR-018/FR-018a) — which, by FR-028, is itself a single shared value.

  *(**Hazard restated 2026-07-12**, after `/speckit-plan` audited the shipped code. This requirement
  originally justified itself with a **two-panel** hazard — a new/empty file open in one panel overridden to
  **Go** (tabs) and another to **Python** (4 spaces), inserting both styles into one buffer. **That situation
  is not constructible.** `open-registry.ts` enforces one buffer per file app-wide: `openOrFocus()` **focuses
  the existing editor** for an already-open path (006 FR-011a), and Save-As refuses a path already open
  elsewhere — so a file is open in **at most one Editor Panel**, and two panels can never disagree about it.
  The requirement **stands**, because the state it protects is genuinely shared; but the **real, verified
  violation** it must fix is the **mirrored view**: a panel mirrored across windows keeps one `panelId` and
  mounts a **separate `EditorView` per window, each with its own `history()`**, synchronised by
  **whole-document replace**. Mirrored views therefore have **separate undo stacks today**, breaking
  **FR-026c** outright. Fixing that — a document-level undo history — is what "one document, one state"
  actually costs.)*
- **FR-028b**: The **manual language override is a property of the DOCUMENT**, not of the panel. It MUST apply
  to **every** panel showing that file — mirrored views *and* separate panels alike — and MUST be persisted
  **keyed by the file**, so it survives an application restart and is picked up by any panel that later opens
  the same file. **This supersedes FR-010a's "a different panel opening the same file runs detection
  independently and MUST NOT inherit the override"** (2026-07-09 clarification), and supersedes that
  requirement's "persisted with the panel's editor configuration, **no data-schema change**" — a
  document-keyed override is **a second data-schema change** (see Assumptions), specified by **FR-028e**.
- **FR-028e**: The document-keyed override (FR-028b) MUST be persisted in a **first-class, durable
  per-document-state table in the application's SQLite store**, delivered as a **versioned migration** — **not**
  smuggled into the `workspace_layout.layout_json` blob:
  - **Identity.** A row is keyed by **owner/user + project + the file's project-relative path** (a file belongs
    to exactly one project — constitution Principle I), and holds the document's **manual language override**.
    The table MUST be shaped for **per-document state in general**, not this one column: the status strip is
    already declared "the intended home for further per-document status (**encoding, line endings**, cursor
    position)" (FR-010c) and **converting a document's line endings** is already a planned feature (*Out of
    Scope*) — each is another per-file value, and each MUST be able to join this table **without** a further
    redesign.
  - **Why not the layout blob.** Riding `layout_json` would need **no migration and no new RPC** (the layout
    already round-trips through one workspace RPC), and that cheapness is its only argument. It is **rejected**:
    the override is **document** state, not **layout**, and a schemaless blob gives it no key, no foreign key, no
    prunability, and no protection against being lost when a layout is rebuilt or reset — while inviting every
    future per-file value into the same blob.
  - **This deliberately reverses a feature 006 decision, and MUST say so.** 006 chose to add **no** SQLite
    migration (its research D2/D14) — an Editor Panel's kind and config ride the layout blob — and it shipped a
    **guard test** to hold that line:
    `packages/persistence/tests/integration/no-editor-migration.integration.test.ts`, asserting
    `LATEST_VERSION === 6` and that **no editor table exists**. That guard was correct for 006, whose editor
    state was per-**panel**; it is **no longer correct** now that FR-028b has made the override a property of
    the **document**. This feature MUST therefore **retire or rewrite that guard as an explicit, reviewed
    change** — never delete it quietly to make a migration pass.
    **There are TWO such guards, not one** *(corrected 2026-07-12)*: feature **007** shipped
    `packages/persistence/tests/integration/user-version-pin.integration.test.ts`, which pins
    `LATEST_VERSION === 6` identically and **fails the same way**. **Both** MUST be retired/rewritten. (Every
    other version-touching test compares against `LATEST_VERSION` *relatively* and is unaffected.)
  - **Migration discipline.** The migration MUST be **idempotent** and additive (constitution, *Idempotent data
    migrations*), advancing `LATEST_VERSION` and honouring the `schema-guard.ts` invariant that any column added
    after a table's creation carries a `NOT NULL DEFAULT`.
  - **Lifecycle.** A **rename or move within throng** MUST carry the row with the file. **Deleting** the file
    removes it; deleting the **project** MUST cascade. Rows whose file no longer exists MUST be **pruned**, so
    the table cannot grow without bound across the life of a project. An override for a file that is **not
    currently open** MUST still persist — that is the entire point: a panel opening the file **later** adopts it
    rather than re-detecting (FR-028b).
  - **It is document state, not configuration.** It MUST **NOT** appear in the Settings editor, and the
    Configuration-editor completeness rule (FR-022) does **not** apply to it — a grid of file paths is not a
    user preference.
  - **Accepted cost:** this is the feature's **SQLite migration** and it requires **daemon RPC** to read and
    write (the store lives behind the daemon). Both correct claims the spec previously made — see
    **Assumptions**.
- **FR-028c**: What is **NOT** shared is **view state**, which remains **per VIEW**: the **cursor and
  selection** (including a rectangular selection), the **scroll position**, and the **per-panel zoom** that
  feature 012 deliberately ships. Where a shared-buffer edit
  invalidates another view's cursor or selection (its lines were deleted, or a rectangular block's rows
  removed), that view's view state MUST be **adjusted or collapsed gracefully** — never left pointing at
  content that no longer exists, and never disturbing the shared buffer (FR-023).

  *(**"View", not "panel" — corrected 2026-07-12.** This requirement was written believing a file could be
  open in **two Editor Panels**, and justified per-panel view state by *"comparing two regions of a
  document"*. **A file cannot be open in two panels**: `openOrFocus()` focuses the existing editor (006
  FR-011a). **The capability is not lost, and the requirement is not weakened** — it is delivered by 006's
  **synced views** (FR-034), which relay only `{text, dirty}` and therefore already carry **independent
  cursors and scroll positions**. So a user reads two regions of one file side by side by **mirroring the
  panel into a sub-workspace window** and scrolling the two views differently. The unit of view state is the
  **view**; the unit of document state is the **document**. That is the distinction FR-028 is really drawing,
  and it is true as shipped.)*
- **FR-028f** *(added 2026-07-13)*: **One document, one AUTHORITY.** FR-028 says the document state is shared;
  this requirement says **how**, because the mechanism is where the corruption lives.
  - **The canonical document lives in exactly one place — UI main** — which owns the document's content and a
    **monotonic version number**. Every `EditorView` is a **derived replica**, never a source of truth.
  - A view MUST echo the user's edit **locally and immediately** (typing MUST NOT wait for a round trip), then
    send its change to the authority tagged with the **document version it was based on**.
  - The authority MUST **serialise** incoming changes and **rebase** any change whose base version is stale
    over the changes that landed in between, then broadcast **one ordered, canonical change stream**. Views
    MUST apply that stream **without** adding it to any local undo history (it is not the local user's action).
  - **Peer-to-peer reconciliation between co-equal replicas is FORBIDDEN** — which is exactly what ships today
    (two `EditorView`s, each its own source of truth, reconciled by **whole-document replace**). Replacing that
    is the substance of this requirement, and of constitution Principle XI.
  - **Why a stale change cannot simply be rejected**: the view has *already shown the user their keystroke*, so
    rejection means **visibly reverting input the user watched themselves type**. The rule protects the
    document's integrity; it MUST NOT do so by discarding the user's work.
  - **Why this is not a collaborative-editing engine.** FR-026e rejects operational transforms for *undo* —
    rebasing every entry of a **divergent history** against other panels' edits. This is a strictly smaller
    problem: there is **one** history and **one** authority, and the only thing rebased is a change that was
    **in flight**, against changes that have **already been ordered**. That is a single well-defined
    `ChangeSet.map`, not a consensus protocol.
  - **Scope, honestly stated**: with a single user, only one window holds keyboard focus, so the rebase path
    will almost never execute. It is specified anyway because the alternative is a race that silently
    **corrupts the user's file**, and because it is what makes "one document" *true* rather than merely
    *usually true*.
- **FR-028d** *(satisfied 2026-07-13)*: This "one document, one state" rule is intended as a **constitutional
  constraint**, not merely a rule of this feature — it governs any future panel type that can present the same
  underlying artefact twice. Amending the constitution is a **separate governance change**, with its own version
  bump and review.
  **This has now been done**: constitution **v3.15.0** (2026-07-13) adds *"One document, one state"* to
  **Principle XI**, closing [#68](https://github.com/Bidthedog/throng/issues/68). The rule therefore now binds
  **every** panel type — a diff view, a document preview, a notebook view, a plugin-supplied Panel — and not
  merely this feature. The constitution's own anti-loophole clause (**mirroring is not compliance**; one
  **authority**, not two reconciling peers) is what **FR-028f** implements.
  *(This requirement previously read "is **not** performed by this specification; recorded as a **required
  follow-up** … MUST be raised before this feature is considered complete." It was raised, and then done. The
  amendment is no longer outstanding, and this feature is no longer blocked on it.)*

#### Fidelity & isolation (inherited constraints)

- **FR-023**: None of these behaviours (highlighting, content menu, language indicator/picker, cut-line,
  indentation) may compromise the 006 guarantees: text **encoding and line-ending fidelity on save** MUST be
  preserved (highlighting/indentation MUST NOT rewrite untouched lines or change encodings; a line-cut and
  its paste MUST use the document's existing line ending), and per-view editing MUST NOT disturb the
  **canonical document held by its authority** (**FR-028f**) or its **derived** dirty state.
  *(This previously said "the **single shared buffer** of a cross-window **synced** editor (006 FR-034)" —
  the same false premise FR-026c disowns. 006 FR-034 provides **no** single shared buffer: it relays
  `{text, dirty}` between two independent `EditorView`s. The buffer this requirement protects is the one
  **FR-028f creates**. Corrected 2026-07-13.)*
- **FR-023a**: A document has **one effective line ending**, and this feature MUST use it for **every** line
  ending it inserts:
  - It is the document's line ending as determined by 006 on open. Where a file's line endings are **mixed**,
    the effective one is the **dominant** ending (the one used by the majority of lines), ties broken by the
    **first** encountered.
  - **Every line ending this feature writes** MUST use it: the trailing break of a full-line cut and its paste
    (FR-015/FR-015a), the row-join of a rectangular cut/copy and its column-wise paste (FR-025b/FR-025c), and
    any line ending inserted while editing.
  - **Incoming pasted text MUST be normalised to it.** Content arriving from the OS clipboard with **foreign**
    line endings (e.g. LF text pasted into a CRLF document) MUST be converted to the document's effective
    ending as it is inserted. Otherwise a single paste would silently make the file mixed and produce
    whitespace churn in the user's next diff — a breach of 006's fidelity guarantee by the back door.
  - **throng MUST therefore never be the cause of a mixed-line-ending file.**
- **FR-023b**: This feature MUST **NOT normalise, convert, or repair** the line endings of **existing**
  content. A file that is **already mixed** MUST be left **exactly as mixed as it was**: untouched lines are
  never rewritten (FR-023), the document is not marked dirty by being opened, and no whole-file diff is
  produced. Mixed files occur legitimately — `core.autocrlf` mishaps in Git checkouts, and **test fixtures that
  deliberately assert line-ending handling** (feature 006's own fidelity guarantee requires such fixtures) —
  and silently rewriting one would corrupt it. **Converting a document's line endings is an explicit user
  action**, and is **out of scope** for Part 1 (see [Out of Scope](#out-of-scope)); Part 1's obligation is only
  to never *introduce* a foreign ending (FR-023a).
- **FR-024**: All Part-1 behaviour MUST work identically for **project-owned** and **sub-workspace-owned**
  editors and in **sub-workspace windows**, honouring the **active-panel focus context established by feature
  012** — e.g. Ctrl+X and Tab-indent act on an editor only when that Editor Panel is the window's **active
  panel**, not the file tree or a Terminal Panel. *(This supersedes the original reference to 006's active-pane
  model: since **feature 012** shipped, the per-window **active panel** — not 006 — is what routes keyboard
  input and panel-scoped commands.)*
- **FR-024a**: This feature's **seven registered commands** (FR-017b) are **panel-scoped**: they MUST be
  dispatched **only** to the window's **active Editor Panel** (012), and MUST NOT fire when the active panel is
  a Terminal Panel (FR-017d), the file tree, or any non-editor surface, nor in a background window.
- **FR-024b**: Where a chord could be claimed by both, **012's window-level commands take precedence over this
  feature's editor-scoped commands**: 012 already intercepts its move-focus and zoom chords **ahead of a
  focused editor or terminal**, and this feature MUST NOT subvert that — an editor MUST NOT be able to swallow
  a move-focus chord. The shipped defaults do not in fact collide (012 uses **Ctrl+Alt+Arrow**; this feature
  uses **Shift+Alt+Arrow**), and FR-017b1's build-time test MUST verify this **from the command registry** —
  covering 012's bindings, and every other feature's, **automatically** rather than from any hand-listed set of
  features. A **user-created** collision is resolved by 007 FR-034's explicit Reassign/Cancel (FR-017b2), never
  silently — but where one nonetheless exists at dispatch time, the window-level command wins.

### Key Entities

- **Language descriptor**: One entry in the extensible language registry — a language's identity/display
  name, its associated file extensions (**a descriptor may claim many extensions; each extension is claimed by
  exactly one descriptor**), its indentation profile (where it overrides the global default), and the
  highlighter to apply. Adding a language = adding a descriptor. The shape must accommodate **exact-filename**
  matching as a later addition.
- **Extension mapping override**: A user-scoped setting remapping a file extension to a different supported
  language (e.g. `.h` → C), outranking the built-in registry but outranked by the **document's** manual override.
- **Language-detection result**: The language chosen for a document, together with **which rung of the
  precedence chain decided it** (document override / user extension mapping / built-in registry / plain text —
  FR-005a), used to select the highlighter **and the indentation profile** and to reflect the active language
  to the user. *(Content is never a source: content-based detection was removed in the 2026-07-09
  clarification.)*
- **Manual language override**: A user-chosen language (or "plain text") attached to the **document**,
  persisted **keyed by the file**, outranking detection for every panel that shows that file — including one
  opened later, which adopts it rather than re-detecting (FR-028b). A stored id that no longer resolves is
  skipped, not deleted (FR-005b).
- **Document state vs view state**: **Document state** — buffer, dirty state, undo/redo history, effective
  language (incl. override) and effective indentation — is **one value shared by every panel** showing the file
  (FR-028). **View state** — cursor/selection, rectangular selection, scroll position, per-panel zoom (012) —
  is **per panel** (FR-028c). Indentation is *document* state precisely because it decides which characters are
  written into the shared buffer.
- **Document authority** *(FR-028f)*: the **single owner** of a document's state, living in **UI main**. It holds
  the **canonical text**, a **monotonic version**, and the **saved version** (from which *dirty* is **derived**,
  never relayed). Every `EditorView` is a **derived replica** of it, never a source of truth. This is the entity
  constitution Principle XI's *"one authority, not two peers"* demands, and the undo history belongs to **it**,
  not to any view.
- **Document version**: a **monotonic counter** on the authority, incremented once per applied change. It is what
  makes staleness *detectable*: a change carries the version it was computed against.
- **In-flight change**: a change a view has **already applied locally** (typing cannot wait for a round trip) and
  sent to the authority, tagged with its **base version**. If the document has moved on, the authority **rebases**
  it (`ChangeSet.map`) so it lands where it *now* means — never at the position it originally named, and **never
  rejected**, because the user has already watched themselves type it.
- **Indentation profile**: An indentation configuration — style (tabs/spaces), indent width (for spaces), and
  **tab display width** (the columns a rendered tab occupies, default 4). One **global default** (spaces,
  indent width 2, tab display width 4) applies to every language and to undetected/plain-text documents; a
  profile keyed by **language id** overrides it where a language's convention differs. Both the default and
  the overrides are **user-scoped** and user-editable.
- **Inferred indentation style**: The style deduced on open from a bounded sample of the document's opening
  lines — the first 10% of lines, capped at 100, inspecting each line's first 20 characters — yielding tabs,
  or spaces of width N, or nothing. It takes precedence over the indentation profile for that document, governs
  only newly typed/auto-inserted indentation, and is re-evaluated on reload from disk.
- **Effective indentation**: The inferred style where one exists, otherwise the effective language's
  indentation profile, otherwise the global default.
- **Editor content action set**: The standard text-editing actions surfaced in the content context menu
  (Cut, Copy, Paste, Select All, Undo, Redo) plus **Set Language…**, distinct from the 006 panel-header
  action set.
- **Editor status strip**: A persistent strip along the bottom of the Editor Panel, below the text area,
  hosting the language indicator (right-aligned) and reserved for further per-document status later.
  Introduces this feature's new theme tokens.
- **Language indicator**: The clickable label in the status strip showing the document's effective language
  and opening the language picker.
- **Dispatch scope**: The **set** of contexts in which a registered command's chord is live — drawn from
  `editor`, `terminal` and `explorer` (FR-017b0). New to the keybinding model, which is today a **flat map with
  no scope** and a resolver that returns the first matching action in map order. A command live everywhere simply
  declares **every** context; there is no separate "global" value, and no default — an unscoped command fails the
  completeness test. It is a **set** rather than a single value because shipped commands already need one
  (`search.*` and `editor.save*` are live in an editor **and** a terminal, but not the File Explorer). It is what
  lets `Ctrl+X` mean **cut-line** in an editor and **`file.cut`** in the File Explorer without either being a
  conflict, and it is the axis the collision test checks: two commands clash **iff their scope sets intersect**
  on a shared chord.
- **Cut-line command**: A **registered, rebindable** command (default binding Ctrl+X, scope `editor`) meaning
  "cut each cursor's selection, or its whole line where it has none". Rebinding moves the whole behaviour;
  Ctrl+X then reverts to the editor's native cut. It **coexists** with the Explorer's `file.cut`, which keeps
  Ctrl+X in the `explorer` scope.
- **Indent/outdent commands**: `indent-lines` (default Tab) and `outdent-lines` (default Shift+Tab) —
  **registered, rebindable**.
- **Column-select commands**: Four **registered, rebindable** commands — `column-select-up` / `-down` /
  `-left` / `-right` (defaults Shift+Alt+Arrow) — that create and extend a rectangular selection from the
  keyboard. With `cut-line`, `indent-lines` and `outdent-lines` these make **seven** registered commands. The
  Alt+click+drag mouse gesture and the clipboard actions (native OS bindings) are *not* commands.
- **Rectangular selection**: A selection covering the same column range across consecutive lines, created by
  Alt+click+drag or the `column-select-*` commands. Typing replaces every row; cutting removes each row's
  fragment, closing the lines up horizontally.
- **Rectangular clipboard entry**: Clipboard content produced by copying or cutting a rectangular selection —
  its rows joined by the document's line ending and marked (**application-globally**, FR-015c) as rectangular, so pasting it
  re-inserts the rows **column-wise**. The **third clipboard mode**, mutually exclusive with *verbatim* and
  *full-line*, and invalidated by any clipboard change from another source. **Which mode an entry carries is
  decided by the selection, not by the command** that produced it (FR-016b).
- **Full-line clipboard entry**: Clipboard content produced by a no-selection Ctrl+X, or by the content
  menu's Cut/Copy with no selection, marked (**application-globally**, FR-015c) as a whole line so that pasting it inserts a line
  above the caret's line. With several bare carets it holds their lines in document order, newline-joined, and
  pastes one above each caret's line. The marker is invalidated by any clipboard change from another source,
  and is never set when any cursor held a selection.
- **Language picker**: The searchable list of all supported languages (plus "Plain Text"), marking the
  current language, opened from either the indicator or "Set Language…", and applying the selection
  immediately as a **persisted, document-scoped** override (FR-028b) — so it takes effect in **every** panel
  showing that file, not only the one it was invoked from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **100% of the 31 named language targets** are recognised and highlighted — verified by opening
  a representative fixture file per language and confirming language-appropriate, non-plain-text
  highlighting. **No file extension is claimed by two languages** (enforced by an automated registry test),
  though one language may claim many extensions; a filename matching several declared suffixes resolves to the
  **longest**, and dotfiles/dotless filenames resolve to plain text.
- **SC-001a**: A user can **remap any extension to any supported language in the settings editor** — including
  **Plain Text**, which globally switches highlighting **off** for that extension and is never silently undone
  by the built-in registry (FR-004c) — and open editors of that extension re-highlight without being reopened;
  a **document's** manual override still wins.
- **SC-002**: A file whose **extension is missing, unrecognised, or misleading** opens as plain text with no
  error, and **one** manual-override action puts it into the correct language — measured as: no document's
  content is ever read to guess its language, and typing content signatures never changes the language.
- **SC-003**: Highlighting meets fixed budgets on **every** file the editor permits to open — measured on the
  **largest** such file, not a "typical" one, since cost is bounded by the **visible region** rather than
  document size (FR-008): **first highlight within 200 ms** of the document rendering; **the UI never
  unresponsive for more than 50 ms** at a stretch; and **no dropped frame while typing** (≤ 16 ms added
  latency). There is **no** file the editor opens but does not highlight, and **no** degraded highlighting mode
  — with exactly **one** exception, at the level of a **line**, not a file: a **single line over 10,000
  characters** (a minified bundle) renders as unhighlighted plain text while the **rest of that document
  highlights normally** and the budgets still hold (FR-008a). The line remains fully editable.
- **SC-004**: A user can **cut, copy, and paste using only the right-click menu** (no keyboard), and pasted
  content interoperates with other applications via the OS clipboard. Right-clicking inside a selection never
  loses it; right-clicking elsewhere places the caret at the click point; and with nothing selected, Cut and
  Copy act on the caret's whole line rather than being unavailable.
- **SC-004a**: The document's **effective language is visible at all times** on the Editor Panel without
  opening any menu, and the language can be changed from **two** entry points (the indicator and the content
  menu's "Set Language…"), both opening the same searchable picker — reachable in **at most two clicks**.
- **SC-005**: **Ctrl+X with no selection removes the whole current line** in 100% of cases (including the
  last line without a trailing newline); pasting it — **from any caret position, including mid-line** —
  reinserts a complete line above the caret's line without splitting it. **Ctrl+X with a selection cuts only
  the selection**, and clipboard content from any other source pastes verbatim at the caret. With **multiple
  cursors**, each cursor cuts its own selection or, if bare, its own whole line — partial selections are never
  expanded to whole lines.
- **SC-006**: Indentation inserted by **Tab matches the document's existing indentation** in 100% of files
  where a style is inferable from the bounded sample (first 10% of lines, capped at 100 lines, first 20
  characters each — a cost that does not grow with file size); where none is inferable it matches the **effective
  language's configured style** (the global default of **2 spaces** where a language declares no override).
  Auto-indentation uses the same style, **Tab and Shift+Tab with a selection indent and outdent every line the
  selection touches** (rather than replacing it), and **opening a file never modifies an existing line or
  marks it dirty**.
- **SC-007**: Syntax highlighting **and the language indicator** are **readable on every bundled theme** (light
  and dark). This is achievable — rather than merely asserted — because the syntax colours are **theme tokens**
  (FR-007b): every bundled theme **ships a value for every syntax token**, so each theme's code colours are
  authored against **its own** editor background. **Every** theme key this feature adds — the 10 syntax
  tokens **and** the status-strip / language-indicator tokens (FR-010f) — has a descriptor, is exposed in the
  **Themes editor**, passes the **theme-token completeness test**, and has a **shipped value in every bundled
  theme**, so 014's *Restore All Themes to Default* can never leave code or the strip unstyled. Adding the
  tokens **does not breach 009's theme-distinctness gate** (FR-007c). The status strip **dims with its panel**
  under feature 012's inactive treatment, reusing 012's focus-state tokens rather than a parallel set (FR-010g).
- **SC-007b**: **Searching highlighted code never makes the match the one thing you cannot read.** Syntax
  colours remain the **foreground** inside a match — matched code keeps its highlighting rather than flattening
  into a solid block — and the syntax-token-on-match-background pairings are added to feature **009**'s
  enumerated pairing list so this feature's **own new colours are measured**, not assumed. They inherit **009's
  existing policy unchanged**: build-blocking on the themes 009 already gates, reported (not thrown) elsewhere,
  with the gated set **read from 009's list, never copied**. **This feature gates no additional theme, recolours
  no theme, and adds no theme UI** — that is a theme redesign, tracked as
  [#61](https://github.com/Bidthedog/throng/issues/61) (FR-007a).
- **SC-007a**: The seven registered commands fire **only** in the window's **active Editor Panel** (012) **and
  only while the panel's content has input focus**: none fires when the active panel is a Terminal Panel or the
  file tree, in a background window, or while **013's find bar is focused** (Tab there moves within the bar and
  never indents the file), and **none can swallow one of 012's window-level chords** (move-focus, zoom). The
  build-time default-chord test is **exhaustive over the command registry** — not a hand-listed set of features
  — and **scope-aware**, so it covers 012's and 013's ~13 bindings and any future feature's automatically,
  while correctly permitting `cut-line` (`{editor}`) and `file.cut` (`{explorer}`) to **share Ctrl+X**: two
  commands clash **iff their scope sets intersect**. **Every** registered command — including the 36 already
  shipped — carries a **non-empty scope set**, an unscoped one **fails the completeness test**, and chord
  resolution consults the **active context** rather than returning the first match in map order (which today
  would resolve Ctrl+X to `file.cut` even inside an editor, leaving `cut-line` unreachable)
  (FR-017b0/FR-017b1/FR-017f/FR-024a/FR-024b).
- **SC-008**: A file whose language cannot be detected, or that has no supported highlighter, opens as
  **readable plain text with no error** in 100% of cases.
- **SC-009**: A **manual language override** re-highlights the active document immediately, and persists
  across further edits, **across an application restart**, and **across every panel showing that file** —
  mirrored views and separate panels alike, including a panel opened later, which **adopts** the override
  rather than re-detecting (FR-028/FR-028b) — until the user changes it. A file open in several panels is
  **one document**: language, indentation, undo history and buffer are shared; only cursor, selection, scroll
  and zoom are per panel (FR-028c).
- **SC-010**: **100% of the configurable artefacts this feature introduces** — the indentation settings
  (style, indent width, **tab display width**; global default + per-language overrides), the
  extension→language mapping overrides, the **seven** keybindings (`cut-line`, `indent-lines`,
  `outdent-lines` and the four `column-select-*` commands), and the status-strip theme tokens — are
  reachable and editable in their respective visual preference editors, and the **completeness tests pass**
  with none of them JSON-only — including the two **keyed-map** settings, which are edited through the **new
  keyed-table control** (FR-022a) rendered from a metadata descriptor, with duplicate or invalid keys rejected
  in the editor. Rebinding any of them takes effect without an application restart. **No two registered commands
  ship the same default chord in any context they share** — enforced by a **scope-aware** test enumerated from
  the command registry, where two commands clash **iff their scope sets intersect**, so `cut-line` (`{editor}`)
  and the Explorer's `file.cut` (`{explorer}`) may both keep Ctrl+X while a genuine overlapping clash fails the
  build. Every registered command carries a **non-empty scope set** (an unscoped one fails the completeness
  test), and a user-created conflict is always resolved by an explicit Reassign/Cancel choice, never silently.
- **SC-011**: A user can select a **rectangular block** by Alt+click+drag **and** by Shift+Alt+Arrow, and
  **cut, copy, type-replace and paste** it. A copied block pastes into **another application** as rows
  separated by line breaks, and **column-wise** (row *n* on the *n*-th successive line at the paste column) into
  **any Editor Panel in any window** — the panel it was copied from, a **different panel**, or a panel in a
  **sub-workspace window** — in 100% of cases, including blocks spanning **short lines**, which contribute empty
  rows without error. Padding needed to reach the paste column uses the document's **effective indentation
  character**, so a tab-indented file never gains space runs.
- **SC-013**: **A file open in several panels behaves as one document.** Its **buffer, dirty state, undo/redo
  history, effective language and effective indentation** are a **single shared value** in 100% of cases:
  setting the language in one panel changes it in every panel immediately, a panel opened later **adopts** the
  document's override instead of re-detecting, and **no combination of views and overrides can put two
  indentation styles into one file**. Only
  **cursor, selection, scroll and per-panel zoom** differ **between views**, so two regions of one file can be
  read side by side — by **mirroring the panel into a sub-workspace window** (006 FR-034) and scrolling the two
  views independently (FR-028…FR-028c).
- **SC-013b**: **Concurrent edits across mirrored views never corrupt the document.** With one file mirrored
  into two windows, a change dispatched from view A against document version *N* — while a change from view B
  has already advanced the document to *N+1* — is **rebased and applied at the right position**, never at the
  position it originally named. Verified by an integration test that dispatches two changes **against the same
  base version** and asserts the resulting document contains **both** edits, each **intact and correctly
  placed** (FR-028f). The test MUST construct the race explicitly rather than hoping to observe it: a race that
  only fires under real timing is a race that passes in CI and corrupts a user's file in the field.
- **SC-013a**: **The language override is durable, bounded and correctly scoped.** It survives an application
  restart and is found by **any** panel that later opens the file — in any window, including a sub-workspace —
  because it lives in a **per-document-state table** in the SQLite store keyed by owner + project +
  project-relative path (FR-028e), not in a layout blob. Its migration is **idempotent** (re-running it, or
  running it against an already-migrated store, converges on the same state). The table **cannot grow without
  bound**: rows whose file no longer exists are pruned, deleting a file removes its row, and deleting a project
  cascades. A rename or move within throng **carries the override with the file**. It is **document state, not
  configuration** — it does not appear in the Settings editor and the completeness rule does not apply to it.
- **SC-012b**: **Removed text never outlives the recovery snapshot, and the user can opt out.** The persisted
  undo history is stored **only** in the recovery snapshot's protected per-user location — never in logs,
  telemetry or anywhere else — and is deleted whenever that snapshot is. Disabling the persist-undo setting
  **purges** anything already written and stops further persistence, while a crash still recovers the
  document's **content** in full (FR-027b/FR-027c).
- **SC-012a**: **A crash does not cost the user their undo history.** After a crash-recovery restore, the
  document's undo/redo history is available and behaves exactly as before the crash — one command, one Undo,
  restoring the prior cursor set — and indentation inference reflects the **recovered** content rather than the
  stale on-disk copy (so a file converted to spaces before the crash keeps inserting spaces). The persisted
  history is **size-bounded**, so no editing session can bloat the recovery snapshot or slow its writes
  (FR-027/FR-027a).
- **SC-009a**: **throng never causes a mixed-line-ending file, and never repairs one.** Every line ending the
  feature inserts — full-line paste, rectangular row-join and column paste — uses the **destination document's**
  effective ending, and pasted content carrying foreign endings is **normalised to it**, so no paste can make a
  file mixed. Conversely, a file that is **already** mixed is opened, edited and saved with its existing lines
  **byte-identical** — no normalisation, no whole-file diff, no dirty-on-open (FR-023a/FR-023b).
- **SC-010b**: **Nothing this feature ships forecloses macOS or Linux** (constitution Principle II): the seven
  default chords and the column-select mouse modifier are declared **per platform** in the shipped-defaults
  record with only the **Windows** values populated, so adding a platform is a change of **values, not of
  shape** (FR-017e); and every OS clipboard access sits behind the **contract-tested** abstraction of FR-013a,
  so a new platform implements an existing contract rather than forcing a rewrite.
- **SC-010a**: **Every setting this feature introduces resets to its shipped default**, including the two
  keyed maps: resetting the extension→language overrides **clears** them (detection falls back to the built-in
  registry), and resetting the per-language indentation overrides **restores the shipped set** (Go → tabs,
  Python → 4 spaces) rather than emptying it. Every default is read from feature 010's shipped-defaults record,
  with none hard-coded a second time — verified by the restore/completeness tests (FR-022b).
- **SC-011b**: With a rectangular block active, **every** editing operation acts **per row** — Delete and
  Backspace clear the block (deleting one character each side on a zero-width block), and Enter and typing
  replace every row — each as **one** Undo. **Column data copied in another application pastes column-wise**:
  N lines pasted over an N-row block distribute **one line per row** in 100% of cases, which is the only route
  for external column data to enter the editor (FR-025h).
- **SC-011c**: **Every OS clipboard access made by core or main-process logic** goes through the
  **contract-tested platform abstraction** (FR-013a) — no such logic makes a direct OS clipboard call, enforced
  by a lint guard confining Electron's `clipboard` module to the seam's implementation — and the abstraction's
  **contract tests pass**, so a future macOS or Linux implementation satisfies the same contract without
  changing the paste-mode logic (constitution Principles II and V).
  *(Scope clarified 2026-07-12: the original wording said "**every** OS clipboard access", which is broader than
  it can enforce. The **editor component itself** reaches the clipboard through the browser's own DOM clipboard
  events — that is how the native Cut/Copy/Paste of FR-017c keep working, and routing them through an IPC seam
  would break the OS interoperability those bindings exist to preserve. The seam's purpose is **Principle II**:
  keeping **decision logic** — above all the paste-mode check of FR-015c — free of direct OS calls. That is
  what is claimed, and what is guarded.)*
- **SC-011a**: The clipboard **mode survives crossing panels and windows** but **never** survives another
  source touching the clipboard: copying in throng and pasting in a **different** throng panel preserves the
  rectangular/full-line mode, while copying anything in **another application** in between makes the next
  throng paste **verbatim** — measured with no observable clipboard polling, purely by comparing the live
  clipboard text with throng's last write (FR-015c).
- **SC-012**: **One command = one Undo.** Every command this feature introduces — `cut-line` across any number
  of cursors, `indent-lines`, `outdent-lines`, a paste in any clipboard mode, a type-replace over a block — is
  reverted by a **single** Undo and reapplied by a **single** Redo, restoring the prior cursor set, in 100% of
  cases. A **synced** editor's mirrored views share **one** undo stack, so an edit made in one view is undone
  from any view and never leaves the shared buffer inconsistent. The history **survives a save** (undo past it
  re-dirties the file), is **cleared** by a revert/external reload or by the last view closing, retains **at
  least 500 entries** before discarding the oldest (FR-026d), and — unlike a **normal** close, which discards it
  — **survives a crash**, restored with the recovered document from the size-bounded copy persisted alongside
  006's recovery snapshot, unless the user has turned that persistence off (FR-027a/FR-027c). *(This corrects
  SC-012's original "never persisted across a restart", written before FR-027a made crash-surviving undo a
  requirement.)*

## Assumptions

- **Reuse the existing editor and its language ecosystem.** This feature enhances the **existing Editor
  Panel** (feature 006) rather than introducing a new editor, and is expected to **reuse the editor
  component's own language/highlighting packages and standard editing commands** wherever they exist for the
  listed languages, rather than hand-writing highlighters. The specific packages and the detection
  mechanism are a **planning decision** (the user asked for a suggested approach — see the note to the plan
  phase); the spec requires only the capabilities and the "detect-first, pluggable-highlighter" structure.
- **Extension-only detection**, with a **user-editable extension→language mapping** and a **document-scoped
  manual override** (FR-028b) as the correction paths, is the chosen detection model (2026-07-09 clarification;
  the override was narrowed from per-panel to per-document on 2026-07-12). Content
  sniffing was considered and **rejected**: reading and pattern-matching document content to guess a language
  is a performance and correctness risk (especially near the 006 large-file threshold) and buys little once
  these two override tiers exist. Content signatures may be revisited later if this proves insufficient.
- **Many-to-one extension mapping.** Determinism is preferred to cleverness: a language may claim many
  extensions, but each extension resolves to exactly one language, and a filename matching several declared
  suffixes takes the **longest**. `.h` → C++ is a judgement call (a C++ highlighter renders C headers
  correctly, but not vice versa) and is user-remappable.
- **Syntax colours are theme tokens.** The original scoping deferred them ("one built-in, theme-aware highlight
  style"), and that was **overturned on 2026-07-12** because it does not work: no single palette is legible on
  both **Matrix** (green-on-black) and **Light** (dark-on-white), so the colours must resolve **per theme**
  regardless — and a derived-but-unnamed palette is one **no theme author owns and no user can tune**. Making
  them named tokens (FR-007b) is what turns FR-007's "legible on every bundled theme" from an aspiration into
  something a theme can be **authored and tested** against, and it is what gives FR-007a's contrast guard a real
  value to measure. **Accepted cost:** ~**10 tokens × 15 bundled themes ≈ 150 shipped colour values**, each
  with a descriptor and completeness coverage — the **largest single addition** made by clarification, accepted
  because the alternative is unachievable, not because it is cheap.
- **This feature's theme keys, in full.** Two sets, and only two: the **syntax colour tokens** (FR-007b) and the
  **status-strip / language-indicator tokens** (FR-010f — the strip is new chrome). Both are compelled by the
  constitution's Configuration-editor completeness rule (descriptors, Themes-editor exposure, completeness test)
  and both need **shipped values in every bundled theme** so 014's *Restore All* cannot leave code or the strip
  unstyled. **No theme is recoloured beyond adding these keys**, and no theme-selection UI changes
  ([#61](https://github.com/Bidthedog/throng/issues/61)).
- **Adding tokens perturbs 009's distinctness gate.** `themePairDistance` is the **mean** ΔE00 across shared
  tokens, and the gate (`4.3`) sits only **0.17** below the closest legitimate pair (`4.469`). Ten new tokens
  move that mean for **every** pair — copy-pasted syntax palettes would pull themes **together** and fail the
  build. Per-theme palettes drawn from each theme's own character push them **apart**; the gate is re-measured
  and recalibrated only if the closest *legitimate* pair genuinely moved (FR-007c).
- **Column selection builds on the editor's own rectangular-selection support** rather than a hand-rolled
  implementation, and on the per-cursor editing semantics of FR-016a. The **rectangular clipboard mode** is
  **application-global** throng-side state, exactly like the full-line marker (FR-015c), so a block moves
  **between panels and windows** while still degrading cleanly to plain line-broken text when the clipboard
  crosses an application boundary. Accepted cost: Part 1 now registers **seven** commands rather
  than one, all of which must satisfy the keybinding completeness test.
- **The clipboard mode belongs to the copied content, not to the widget that copied it.** The OS clipboard
  carries **plain text only**, in both directions — anything copied in throng pastes into any OS application,
  and anything copied in any OS application pastes into throng — with the mode held as a **separate,
  in-memory, app-global record** validated against the live clipboard text on each paste (FR-015c). A custom
  clipboard **format** was considered and **rejected**: it would let a block round-trip out of throng and back,
  but at the cost of writing a non-standard flavour alongside every copy, and it still could not survive the
  text being touched by another application. Per-view markers were **rejected** outright — they would have
  silently broken the feature's main use case (moving a column block from one file to another).
- **Register what has no OS equivalent; leave the rest native.** `cut-line`, `indent-lines`, `outdent-lines`
  and the four `column-select-*` are editor-specific and therefore rebindable; Cut/Copy/Paste/Select All/Undo/
  Redo keep their native OS bindings so they behave as the platform expects and interoperate with other
  applications. Suppressing the editor component's keymap wholesale was considered and **rejected** — it would
  have made the clipboard actions rebindable at the cost of divergence from OS conventions. Terminal key
  handling stays PTY passthrough (005); routing it through the registry would break shells (Ctrl+C = SIGINT).
- **Jupyter `.ipynb` = JSON highlighting**; a rich notebook cell view is out of scope.
- **Mixed-language files** (Vue SFC, HTML with embedded script/style) are **best-effort** — embedded-region
  highlighting where the language definition supports it, otherwise the outer language's highlighting, never
  an error.
- **Tab display width is a rendering concern, not an indentation one.** It is carried on the same profile for
  convenience (and so it can be keyed per language), but it never influences what characters Tab inserts and
  never rewrites the document — a tab-indented Go file and a space-indented Python file both honour it.
- **Indentation defaults**: the **global default is 2 spaces** for every language and for plain text, with a
  **tab display width of 4 columns**.
  Per-language overrides ship **only** where the language's established community convention differs
  (e.g. tabs for Go, 4 spaces for Python); the concrete override list is a planning decision. Everything is
  user-overridable and **user-scoped**.
- **Indentation is inferred from the document first.** Sampling at most 100 lines, inspecting only each
  line's first 20 characters, is cheap and **O(1) in document size** (leading-whitespace inspection only, no
  parsing) and keeps a user from introducing mixed indentation into a
  file that disagrees with their settings. 100 lines is ample: a file's indentation style is evident within
  its first handful of indented lines, and 20 characters covers five levels of four-space indent. It is a *document* concern, distinct from language detection —
  which remains extension-only — and it is superseded in future by `.editorconfig`. Where the sample is
  inconclusive the configured profile applies, so behaviour is always defined.
- **Two schema changes, one of them a SQLite migration, and a new daemon RPC.** The original scoping claimed
  Part 1 was renderer-only, with **no data-schema change, no SQLite migration and no new daemon RPC**. **All
  three claims are now false**, and every one was falsified by a later clarification rather than by the original
  design. Part 1 is *mostly* renderer-side editor behaviour plus per-language configuration, but the following
  sit outside the editor:
  - the **persisted undo history** in 006's recovery snapshot (FR-027a) — size-bounded so it cannot bloat the
    snapshot. This changes the **recovery artefact's** schema;
  - the **document-keyed manual language override** (FR-028b/**FR-028e**) — a **first-class per-document-state
    table** in the SQLite store, reached by **new daemon RPC**, and delivered as an **idempotent versioned
    migration**. These are the feature's **two data-schema changes**, and the second is a **real SQLite
    migration**. It is deliberately **not** hidden in the `workspace_layout.layout_json` blob, which would have
    cost no migration and no RPC — the override is **document** state, not layout, and the blob offers it no key,
    no foreign key, no pruning, and no protection from a layout rebuild. **This reverses feature 006's decision
    to add no editor migration (its research D2/D14) and retires the guard test that enforced it**
    (`no-editor-migration.integration.test.ts`, asserting `LATEST_VERSION === 6` and that no editor table
    exists). That guard was right for 006, whose editor state was per-**panel**; it is wrong now that the
    override belongs to the **document**. Retiring it is an explicit, reviewed change — never a quiet deletion to
    make a migration pass;
  - the **document authority** (**FR-028f**) — the single owner of a document's **canonical text** and
    **monotonic version**, living in **UI main**, with a new **view↔main IPC protocol** (the ordered
    canonical change stream — `contracts/document-authority.md`). This is the **largest** out-of-editor
    item, and the **last** to be found: it exists because constitution **v3.15.0** made *"one document, one
    state"* Principle XI, whose test is **authority, not mechanism** — and 006's cross-window sync **fails**
    it, being two `EditorView`s each its own source of truth, reconciling by whole-document replace. It is
    the one item here that **replaces** shipped behaviour rather than adding to it;
  - the **app-global clipboard-mode record** (FR-015c) — in-memory **main-process** state plus IPC, never
    persisted, never reaching the daemon;
  - a **contract-tested clipboard platform abstraction** (FR-013a) — the feature's **one new OS seam**,
    required by constitution Principle II once FR-015c needed to read the live clipboard, and contract-tested
    per Principle V;
  - a **new keyed-table control type** in feature 007's shared Settings editor and metadata registry
    (FR-022a);
  - a **dispatch `scope` field** on the shared command/keybinding descriptor and its editor metadata
    (FR-017b0) — required because the keybinding model is a **flat map with no scope concept**, yet `Ctrl+X` is
    already the Explorer's `file.cut` and FR-017a needs it for `cut-line` in the editor.
- **This feature adds theme *keys*; it does not do theme *work*.** The distinction matters, and the spec briefly
  lost it. It **adds two token sets** — the **syntax colours** (FR-007b) and the **status-strip /
  language-indicator** tokens (FR-010f) — because it introduces both the colour and the chrome, and the
  constitution **compels** every new token to have a descriptor, Themes-editor exposure, completeness coverage
  and a shipped value in every bundled theme. What it **does not** do is **alter any existing theme colour**,
  **contrast-gate any additional theme**, or **touch theme-selection UI**. Its one contrast obligation is to
  **measure the colours it itself invents** (FR-007a), under 009's **existing** policy, because no other feature
  can check colour this feature creates. Making further themes WCAG-conformant and surfacing conformance in the
  picker is a **theme redesign**, tracked as **[#61](https://github.com/Bidthedog/throng/issues/61)** (*vNext*).

## Dependencies

- **Feature 006 — Editor Panel** (the editor this feature enhances). Its save/confinement, encoding and
  line-ending fidelity, one-buffer-per-file rule, crash recovery, and large-file open guard are the substrate,
  and Part 1 **preserves** them (FR-023/FR-024).
  **Its cross-window sync mechanism is the exception: that is REPLACED, not preserved.** 006 FR-034 relays
  `{text, dirty}` by **whole-document replace** between two `EditorView`s that are each **their own source of
  truth** — peer-to-peer reconciliation between co-equal copies, which constitution **Principle XI (v3.15.0)**
  forbids by name. **FR-028f** replaces it with a **single document authority** in UI main. The *capability*
  006 delivered (one file, two views, independent cursors and scroll) is fully retained; the *mechanism* is
  not. *(Stated explicitly 2026-07-13: this entry previously said Part 1 must "preserve" 006's cross-window
  sync, while FR-028 said it "is the **problem**, not the solution" — the spec both preserved and replaced the
  same mechanism.)*
- **Feature 007 — Preferences Editor** (the preferences window, the editor-metadata registry and its
  completeness test). The Configuration-editor completeness rule (introduced in constitution v3.11.0;
  current at **v3.15.0**, the version this feature is built against) requires this
  feature's new configurable options (the global indentation default, per-language indentation overrides,
  and any detection overrides) to be **exposed through the visual settings editor** and covered by the
  **editor-metadata registry + completeness test**. New settings MUST NOT be shipped as JSON-only. **007
  FR-034** additionally governs **user-created keybinding conflicts** (warn, then Reassign or Cancel), which
  this feature relies on rather than re-specifying (FR-017b2).
  **This feature also *extends* 007**: its two keyed-map settings cannot be rendered by any control type in
  **007 FR-028**, so Part 1 adds a **new generic keyed-table (map) control** to 007's Settings editor and its
  metadata registry (**FR-022a**). This is the only place Part 1 modifies a shared component rather than the
  editor, and it must be planned as such — 007's completeness test (FR-047) must cover the new control type.
- **Feature 009 — Theme content & quality guards.** 009 owns the bundled themes and the automated guards over
  them: the **contrast** pairings (`CONTRAST_PAIRINGS`, build-blocking on its in-scope themes and reporting
  elsewhere) and the **distinctness** gate (mean ΔE00 across shared tokens, hard-failing below
  `DISTINCTNESS_THRESHOLD`). This feature touches **both**: it **adds pairings** for its syntax colours over
  013's match backgrounds (**FR-007a**, inheriting 009's policy unchanged and **reading** its in-scope list
  rather than copying it), and its 10 new **syntax tokens change the distinctness mean for every theme pair**
  (**FR-007c**) — which must be re-measured, with only a **0.17** margin between the gate and the closest
  legitimate pair.
- **Feature 010 — Shipped defaults & restore foundation.** The immutable, versioned record of the
  application's defaults and its restore API (*reset one setting*, *reset everything*) is the single source
  every reset reads from. This feature's settings — the global indentation default, the **per-language
  indentation overrides** (which ship **non-empty**), the **extension→language overrides** (which ship
  **empty**), and the seven default chords — MUST have their defaults **declared in that record** and be
  resettable through it (**FR-022b**), never hard-coded a second time in an editor.
- **Feature 013 — In-panel search** (merged after this spec was first written). 013 adds a find/replace bar to
  the **same Editor Panel** this feature enhances, routed by 012's active-panel context. Consequences here:
  it registers roughly **thirteen** default chords, which this feature's build-time collision test MUST cover
  (**FR-017b1**, now exhaustive over the command registry); its find bar is a **focused input surface inside
  the editor**, so chord dispatch is scoped by **input focus** (**FR-017f**) — Tab in the find bar must not
  indent the file; its **replace-all** is "a single undoable step" and therefore joins this feature's
  **per-document** undo stack under the same atomicity and cursor-restoration rules (FR-026/FR-026e/FR-026f);
  and its **match-highlight theme tokens** (013 FR-019) now sit **on top of syntax-highlighted text**, which
  did not exist when 013 shipped.
- **Feature 014 — Theme editor** (merged after this spec was first written). 014 registers **no key bindings**,
  so it poses no chord-collision risk — but it **owns the Themes editor** in which this feature's new
  **status-strip / language-indicator tokens** (FR-010f) must appear, and it ships **"Restore All Themes to
  Default"**, which resets **every built-in theme** to its **shipped** values. Those new tokens MUST therefore
  carry shipped values for **every bundled theme** in feature 010's defaults record — otherwise Restore All
  would produce built-in themes in which the status strip is unstyled or illegible. **The same applies, at much
  greater scale, to the 10 syntax colour tokens** (FR-007b): every bundled theme must ship a value for every
  one of them, or a Restore All leaves **code itself** unstyled. Both token sets must appear in 014's Themes
  editor with descriptors and completeness coverage. **Beyond registering these tokens, this feature changes
  nothing in 014**: no existing theme colour is altered, no additional theme is contrast-gated, and no
  theme-selection UI is touched — that is a **theme redesign**, tracked separately as
  **[#61](https://github.com/Bidthedog/throng/issues/61)** (*vNext*) and listed under *Out of Scope*.
- **Feature 015 — Preferences & settings (granular reset)** — **MERGED** *(corrected 2026-07-12: it is in this
  branch's history — `bcebc2b`, `1df35f2`, `d925ae4`)*. This feature therefore **builds on** it rather than
  around it: the **per-row affordance gutter** (reset / revert / clear) and **`FieldDescriptor.clearable`**,
  which every setting added here must declare (**FR-022c**). It owns the
  cross-cutting **"reset everything"**. This feature's reset requirements (**FR-022b**) are written against
  feature **010**'s restore API directly and therefore do **not** depend on 015 landing; where 015 does land
  first, this feature's settings MUST be reachable from its granular reset controls like any other.
- **Feature 012 — Focus contexts & per-panel zoom** (merged after this spec was first written). 012 owns the
  per-window **active panel** focus context that **routes keyboard input and panel-scoped commands**, the
  **two-state (foreground / dimmed-inactive) panel treatment** and its theme tokens, and window-level chords
  (**move-focus**, **zoom**) that **intercept ahead of a focused editor or terminal**. This feature therefore
  depends on 012, not 006, for: which panel receives a chord (**FR-024**), the panel-scoping of its seven
  commands (**FR-024a**), the precedence of window-level over editor-scoped commands (**FR-024b**), and the
  status strip's active/inactive presentation (**FR-010g**). The build-time default-chord test (FR-017b1) MUST
  therefore also cover **012's** bindings.

## Out of Scope

The following editor capabilities the user mentioned are **explicitly deferred** to a later feature — they
depend on **language-server integration** (bundling/running language servers per language and a
language-client protocol) and are a substantially larger undertaking than Part 1:

- **IntelliSense** (code completion / suggestions).
- **Go to Definition.**
- **Find References.**
- **Symbol Rename across the solution.**

Also out of scope for Part 1:

- **Content-based language detection** (shebang / `<?php` / doctype / keyword heuristics). Detection is
  **extension-only**; the manual override covers the gap. Deliberately rejected on performance and
  correctness grounds (2026-07-09 clarification) — revisitable later.
- **`.editorconfig` support.** Indentation is **user-scoped only** in Part 1. Honouring a project's
  `.editorconfig` (reading, watching, and cascading it over the user settings) is a **planned future
  feature**, tracked on `ROADMAP.md`; FR-018b requires the setting shape to accommodate it later.
- **Exact-filename language descriptors.** Highlighting files matched by **whole filename** rather than
  extension — `.gitignore`, `.env`, `Dockerfile`, `Makefile` and similar — is a **planned future extension of
  the language registry**. Part 1 treats them as extension-less (plain text, FR-002b); FR-004 requires only
  that the descriptor shape accommodate filename matching later without a breaking change. Tracked on
  `ROADMAP.md`.
- **Converting a document's line endings** (an explicit "convert to LF / CRLF" action, and any normalisation
  of an already-mixed file). Part 1 **never introduces** a foreign line ending and **never rewrites** existing
  ones (FR-023a/FR-023b); deliberately *changing* a file's endings is a separate, explicit user action for a
  later feature. The status strip (FR-010c) is the intended home for surfacing a document's line ending.
- **Project-scoped indentation overrides** (project-level settings storage).
- **Theme accessibility work of any kind.** This feature **recolours no theme**, **gates no additional theme**,
  and **adds no theme-selection UI**. Bringing **throng**, **Light**, **Snake** and **Claude** up to WCAG AA
  (joining the themes feature 009 already gates), and **marking conformant themes in the theme picker**, is a
  **theme redesign** — not an editor capability — and is tracked as
  **[#61](https://github.com/Bidthedog/throng/issues/61)** on the **vNext** milestone. The only contrast
  obligation Part 1 keeps is to **measure the syntax colours it itself introduces**, using 009's existing
  machinery under 009's existing policy (FR-007a) — because no other feature can check colour this feature
  invents. Part 1 reads 009's gated-theme list rather than copying it, so #61 can extend that list without
  touching the editor.
- A **rich Jupyter notebook cell view**.
- **Keyboard-only operation / accessibility of this feature's new controls** (the language indicator, the
  language picker, and the content context menu are **pointer-driven** in Part 1). **Full keyboard-only
  support** is a **cross-cutting, app-wide concern** — focusability, keyboard operation, accessible
  names/roles and visible focus for *every* interactive control — and is deliberately deferred to a dedicated
  later feature rather than solved per-feature. Tracked on `ROADMAP.md` (*Configuration & theming → Full
  keyboard-only support*) and as **GitHub issue
  [#26](https://github.com/Bidthedog/throng/issues/26)**.

These are tracked on `ROADMAP.md` under "Rich code editors — language features" so their delivery is
sequenced, not dropped.
