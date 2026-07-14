# Specification Quality Checklist: Advanced Editor — Rich Code Editing (Part 1)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-08 · **Re-validated**: 2026-07-13 (against FR-028f, SC-013b and the FR-026c / FR-028 /
FR-028d corrections — the previous "16/16" predated them and was therefore not evidence about the current spec)
**Feature**: [spec.md](../spec.md)
**Result**: **16/16 passing**, no state changes, no regressions.

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Re-validation 2026-07-13 — the one item worth arguing about.** *"No implementation details (languages,
  frameworks, APIs)"* stays **[x]**, but not unthinkingly: FR-028f names `ChangeSet.map()`, and FR-026c names
  `history()` and `EditorView`. The reading applied — consistently, since the 2026-07-12 (b) session — is that
  the **normative** text is technology-agnostic (*"one authority; a monotonic version; an in-flight change on a
  superseded version MUST be rebased"*), and the CodeMirror names appear only in **rationale and correction
  notes**, where they are load-bearing: this spec's most valuable findings come from reconciling it against the
  **shipped code**, and that cannot be done without naming it. Stripping those names would make the corrections
  unverifiable, which is a worse failure than the one this item guards against.
- **Scope** was settled by explicit user decision on 2026-07-08 (recorded in spec Clarifications): Part 1 =
  syntax highlighting + language detection + the three low-cost editing essentials (content right-click menu,
  Ctrl+X cut-line, per-file-type indentation); the language-server suite (IntelliSense, Go to Definition,
  Find References, Symbol Rename) is deferred and documented under *Out of Scope*.
- **Editor-component references**: The spec names the editor abstractly ("the existing Editor Panel", "the
  editor component's own language/highlighting packages"). Concrete package/detection choices are left to the
  plan, consistent with how feature 006 kept the editor-component choice a planning decision. The language
  list (C#, Rust, …) enumerates *user-facing language targets*, not implementation, so it is retained in the
  requirements.
- **Clarification session 2026-07-09** resolved five decision points and narrowed scope: indentation is keyed
  by the **effective language** (global default 2 spaces, per-language overrides only where convention
  differs); a manual language override is **per panel and persisted**; **content-based detection was removed**
  in favour of **extension-only** detection (performance/correctness); the override is surfaced by **both** a
  persistent language indicator and a "Set Language…" content-menu item; and a Ctrl+X line-cut uses
  **line-aware paste**. Obsolete text from the 2026-07-08 detection answer was replaced, not duplicated.
- **Accepted scope cost**: the language indicator is new UI chrome, so the feature now owns a small set of new
  **theme tokens** plus the theme-metadata descriptors and completeness test the constitution requires
  (FR-010f).
- **Second clarification pass (same session, 2026-07-09)** resolved five further decision points: `cut-line`
  is the **only** new registered/rebindable command (Tab-indent and clipboard actions stay intrinsic);
  indentation settings are **user-scoped only**, with `.editorconfig` deferred and now tracked on `ROADMAP.md`;
  the editor **infers a document's existing indentation from its first 10% of lines**, falling back to the
  configured profile; the language indicator lives in a **bottom status strip**; and the extension→language map
  is **one-to-one** (`.h` → C++) but **user-remappable in settings**, giving the explicit precedence chain
  panel override → user mapping → registry → plain text (FR-005a).
- **Clarification session 2026-07-10** resolved five further decision points, all interaction/quality gaps
  rather than scope changes: **Tab/Shift+Tab block indent/outdent** with a selection (intrinsic, not commands
  — FR-019a); a **tab display width** separate from indent width (global default 4 columns, per-language
  overrides — FR-018e); **right-click caret/selection semantics** (preserve inside a selection, else move the
  caret) with **content-menu Cut/Copy acting on the caret's line when nothing is selected**, both marking a
  full-line clipboard entry (FR-012a/FR-012b); the indentation **inference sample bounded** to 100 lines ×
  first 20 characters, making the open path O(1) in file size (FR-018c); and **accessibility explicitly
  deferred** — the new controls are pointer-driven, with app-wide keyboard-only support tracked on
  `ROADMAP.md` and GitHub issue #26 (recorded under *Out of Scope*).
- **Fourth clarification pass (2026-07-10)** resolved five more points, one of which **grew the feature**:
  extension matching is **many-to-one with longest-suffix-wins**, dotfiles/dotless names have no extension
  (filename descriptors deferred, FR-002b); cut/indent/paste have **per-cursor semantics** with FR-016 intact
  (FR-016a); **column (rectangular block) selection is now in scope** — new **US6**, FR-025…FR-025f, a third
  clipboard mode and **SC-011**; `cut-line` is **one command covering both cut behaviours**, and the feature
  now registers **seven** commands (`cut-line`, `indent-lines`, `outdent-lines`, four `column-select-*`) while
  clipboard actions stay on native OS bindings and **terminals keep PTY passthrough** (FR-017a–FR-017d); and
  **one command = one atomic undo step** (FR-026…FR-026b, **SC-012**). Two earlier bullets (Tab-as-intrinsic,
  "one-to-one" mapping) were marked **superseded** in place rather than left contradicting the requirements.
- **Fifth clarification pass (2026-07-10)** closed five consistency gaps, two of which were latent defects in
  the spec's own wording: a **synced editor's mirrored views now share one undo stack** over the shared buffer
  (FR-026c — FR-026b's original "per-view editing history" would have let one view revert a range another had
  moved); **default keybindings must be app-wide unique** at build time while **user** conflicts defer to
  **007 FR-034**'s Reassign/Cancel modal (FR-017b1/FR-017b2 — an earlier draft's "later binding wins" would
  have contradicted 007); rectangular-paste padding uses the document's **effective indentation character**,
  tabs-then-spaces for column exactness (FR-025c1, replacing "always spaces"); an **unresolvable persisted
  language id** degrades to plain text with the id **preserved** (FR-005b); and the **clipboard mode is
  decided by the selection, not the command**, reconciling FR-016a with FR-025e (FR-016b).
- **Scope note**: Part 1 is now **four** editing essentials, not three. Column selection was accepted with
  eyes open ("rip the plaster off") and carries new gestures, four registered commands, a rectangular
  clipboard mode and column-wise paste — a genuine increase in implementation and test surface.
- **Completeness surfaces**: FR-022 now enumerates all three — Settings (indentation + extension mappings),
  Key Bindings (`cut-line`), Themes (status-strip tokens).
- **007 dependency**: the feature will be **rebased onto feature 007**, so the preferences window and
  editor-metadata registry are assumed present; new settings are exposed in the visual settings editor
  (FR-022), never JSON-only.
- **Sixth clarification pass (2026-07-11)** resolved five points, of which **three were defects** in the spec
  rather than open questions, and **two grew the work**:
  - **The language list omitted every data/markup/config language** while FR-009 required `.ipynb` to be
    highlighted **as JSON** — mandating a highlighter FR-001 never declared, and leaving `package.json`,
    `.yml`, `.md` and throng's **own** JSON settings/theme files as plain text. FR-001 now names **31**
    targets (adding JSON, JSONC, YAML, XML, TOML, INI, Markdown, SQL — FR-001a); SC-001 follows.
  - **The clipboard mode marker was specified as "view-local"**, which silently broke the feature's primary
    use case: a block cut in one panel would paste **verbatim** into another. It is now
    **application-global** (FR-015c) — one in-memory record of throng's last clipboard write, validated
    against the live OS clipboard on each paste — while the OS clipboard still carries **plain text only** in
    both directions. New SC-011a. *Accepted cost*: one **main-process** in-memory record + IPC (still no
    daemon RPC, no schema change, not persisted), so "renderer-only" is no longer strictly true.
  - **FR-022 was unsatisfiable as written.** Both the extension→language map and the per-language indentation
    overrides are **keyed maps** (the latter of *objects*), and **007 FR-028** defines the Settings editor's
    control types exhaustively — none can render a map — so the completeness test would have failed the
    build. Part 1 now adds **one generic keyed-table (map) control** to 007's Settings editor and metadata
    registry (**FR-022a**). *Accepted cost*: the **only cross-feature/shared-component engineering in Part 1**.
  - **Rectangular-selection semantics were defined only for typing.** Delete/Backspace, Enter and Paste over a
    block are now specified **per row** (FR-025g/FR-025h), including **line-count matching** — N lines pasted
    over an N-row block distribute one per row, which is the **only** route for column data copied in another
    application to enter the editor (the OS clipboard carries no rectangular signal). New SC-011b, US6 AS9–11.
  - **Feature 012 (merged after this spec was written) now owns the active-panel focus context** that routes
    keyboard input — FR-024 still cited **006**. 012 is now an explicit **Dependency**: commands are
    panel-scoped to the active Editor Panel (FR-024a), 012's window-level chords **take precedence** over
    editor-scoped ones (FR-024b), the build-time chord test covers 012's bindings, and the status strip adopts
    **012's dimmed-inactive treatment and reuses its focus-state tokens** (FR-010g). New SC-007a.
- **Scope note (revised)**: beyond the four editing essentials, Part 1 now also carries **8 more language
  targets**, a **new shared Settings control type**, and a **main-process clipboard-mode record**. The first is
  cheap (registry descriptors + fixtures); the second and third are real, and neither was visible in the
  original scoping.
- **Seventh clarification pass (2026-07-11)** closed the last five gaps, mostly **lifecycle and measurability**
  rather than behaviour:
  - **Reset was never mentioned**, despite feature **010** shipping a defaults record + restore API and **007**
    exposing reset-to-default/reset-all. A keyed map **is one setting**, so reset restores the **whole map**
    from 010's record (**FR-022b**) — which correctly **clears** the extension→language overrides (they ship
    empty) and correctly **repopulates** the per-language indentation overrides (they ship non-empty: Go →
    tabs, Python → 4 spaces). Per-entry granularity needs no new control: an override entry's default is its
    **absence**, so remove-row already is a per-entry reset. **Feature 010 added to Dependencies.**
  - **FR-008/SC-003 were unmeasurable** ("responsively", "perceptible", "effectively instantly", "typical
    source files") and carried a **MAY degrade** with no trigger. Highlighting cost is now bounded by the
    **visible region, not document size**, so **every** permitted file is fully highlighted — the degradation
    branch is **deleted** — under hard budgets: **200 ms** to first highlight, UI **never unresponsive > 50 ms**,
    typing **≤ 16 ms** (no dropped frame), asserted against the **largest** permitted file.
  - **The undo history had no lifetime or bound.** It now lives exactly as long as the buffer (**FR-026d**):
    **survives a save** (undo past it re-dirties the file), survives views opening/closing/moving; **cleared**
    by revert/external reload and by the last view closing; **never persisted**; retains **≥ 500 entries**,
    oldest discarded. The bound is **fixed, not a setting** — deliberately, to avoid dragging a rarely-touched
    knob through the completeness rule.
  - **"Plain Text" is now a valid extension-map value** (**FR-004c**), so highlighting can be switched off
    **globally** for an extension rather than per-panel on every open. Critically it is an **authoritative
    choice that terminates precedence** (FR-005a) — explicitly *unlike* an **unresolvable** id (FR-005b), which
    falls through; conflating them would let the built-in registry silently re-apply the highlighting the user
    just disabled.
  - **Line endings assumed a single value per document.** A document now has **one effective ending** (the
    **dominant** one in a mixed file) used for everything the feature inserts, with **pasted content normalised
    to the destination file's ending** — so **throng can never cause a mixed-line-ending file** (**FR-023a**).
    It equally **MUST NOT repair** an already-mixed file (**FR-023b**): normalising would rewrite every line,
    dirty the whole document and produce a whole-file diff on a file merely opened, contradicting 006's "never
    rewrite untouched lines" — and would corrupt the **very fixtures** 006's line-ending-fidelity tests need.
    Explicit line-ending **conversion** is recorded under *Out of Scope*.
- **Measurability note**: SC-003 is now the only performance criterion in the spec and is expressed purely as
  observable budgets (ms to first highlight, ms of unresponsiveness, ms of added typing latency) with **no
  implementation vocabulary**, so "Success criteria are measurable" and "no implementation details" both hold.
- **Eighth clarification pass (2026-07-12)** was a **constitution-compliance** sweep — the previous two passes
  found gaps by checking the spec against the constitution, so this one did that deliberately. Three of the
  five findings were **defects the spec asserted about itself**:
  - **The clipboard is an unabstracted OS seam.** The spec claimed it introduced **no OS-abstraction seam** —
    true when written, false once **FR-015c** required **reading the live OS clipboard on every paste** from
    **core decision logic**. Constitution **Principle II** puts *all* OS-specific behaviour behind
    abstractions and **Principle V** demands contract tests for each (precedent: 007's `IFontEnumeration`, for
    something as modest as font enumeration). Now **FR-013a**: a contract-tested clipboard abstraction; the
    "renderer-side only" claim corrected in **Overview** and **Assumptions**. New **SC-011c**.
  - **FR-008 over-promised.** Yesterday's "**every** permitted file is fully highlighted within hard budgets,
    because cost tracks the **visible region**" **collapses on a single enormous line** — a 1 MB
    `bundle.min.js` on one line, where the visible region *is* the line. **FR-008a** adds a **long-line guard**:
    any line over **10,000 characters** renders unhighlighted while the rest of the document highlights
    normally and the budgets hold. Scoped to a **line**, never a file; threshold **fixed, not configurable**.
  - **The seven default chords foreclose macOS/Linux.** Ctrl+X / Tab / Shift+Tab / Alt+Shift+Arrow and the
    Alt+click+drag gesture are **Windows** conventions (macOS uses ⌘ and Option), and Principle II states *no
    design decision may foreclose* a future port. **FR-017e**: defaults are **platform-keyed** in 010's record,
    with **only Windows values shipped** — so a port adds **values, not schema**. New **SC-010b**.
  - **Crash recovery was unspecified** — a restore is neither an "open" (FR-018c) nor a "reload from disk"
    (FR-018d). **FR-027**: treat it as opening with the **recovered** content; indentation inference samples
    **that**, not the stale disk copy (else a file converted to spaces before a crash keeps inserting tabs).
    **FR-027a** (user decision, **superseding FR-026d's "never persisted"**): the **undo history survives a
    crash**, persisted with the recovery snapshot on the same cadence, **bounded by serialised size**. New
    **SC-012a**.
  - **Persisting undo writes *removed* text to disk** — cut an API key, save, and the clean file coexists with
    the key still in the persisted history. **FR-027b** binds the history to the snapshot's **protected
    location and lifecycle** (never logs/telemetry; deleted when the snapshot is) and **states the retention
    explicitly rather than hiding it**; **FR-027c** adds a **user setting to disable persistence** (default
    **on**; disabling **purges** what was already written; content recovery is never weakened). New
    **SC-012b**. Clearing on every save was rejected — it would break undo **past a save** after a crash.
- **Scope note (revised again)**: Part 1 is **no longer renderer-only**, and none of the four exceptions was
  visible at scoping — a main-process **clipboard-mode record**, a contract-tested **clipboard OS seam**, a new
  **keyed-table control** in 007's shared Settings editor, and a **persisted undo history** that is the
  feature's **one data-schema change**. The Overview's original "no new daemon RPC and no data-schema change"
  claim has been corrected; **no new daemon RPC** still holds.
- **New settings artefact**: the **persist-undo-history toggle** (FR-027c) joins the indentation configuration
  and extension→language overrides in FR-022's completeness enumeration, with a default in 010's record and a
  reset path (FR-022b).
- **Ninth clarification pass (2026-07-12)** — a **multi-view / shared-buffer** sweep. Only **two** questions
  were asked: the critical ambiguities were resolved early and the remaining queue (read-only-file behaviour,
  observability) was **low-impact**, so the session was stopped rather than padded to five.
  - **A content-corruption path the spec permitted.** 006 gives one file **one shared buffer**, yet FR-010a had
    *"a **different** panel opening the same file run detection independently"*, and the effective language
    selects the **indentation written into that buffer** (FR-010b). A **new/empty** file (nothing to infer) open
    in a panel overridden to **Go** (tabs) and another to **Python** (4 spaces) would take **both** — the very
    mixed-indentation file FR-023a says throng must **never** create.
    Resolved by **FR-028**: *a file open in more than one Editor Panel is **ONE document in every respect***.
    Shared: **buffer, dirty state, undo/redo, effective language (incl. override), effective indentation**.
    Per panel: **cursor/selection, scroll, rectangular selection, 012's per-panel zoom** (FR-028c) — sharing
    those would make a second panel show an identical view and defeat the point of opening one. The **manual
    override becomes a document property, persisted keyed by the file** (**FR-028b**), **superseding FR-010a and
    the 2026-07-09 "per panel" answer** and adding the feature's **second data-schema change**. New **SC-013**.
  - **Undo scope & cursor restoration** (**FR-026e**, **FR-026f**). The user initially asked for **per-panel**
    undo stacks; on examination their motivating example (cut in one file, paste into another) was about
    **different documents**, which **already** have separate stacks — so no change was needed. Per-panel stacks
    over a **shared** buffer were re-confirmed as **unsound** (panel A's entry can describe content panel B has
    deleted; making it safe needs **operational transforms**), re-affirming the 2026-07-10 decision. The open
    question — *whose* cursor set an undo restores, given a shared stack (FR-026c) but per-panel cursors
    (FR-028c) — is settled by **FR-026f**: the entry's cursor set is applied to **the panel where Undo was
    invoked**, so the user sees what was reverted, and no other panel's viewport is yanked.
- **Constitutional follow-up (open)**: **FR-028d** records that "one document, one state" is intended as a
  **constitutional constraint** governing any future panel type that can present one artefact twice. Amending
  the constitution is a **separate governance change** (version bump + review) that this spec does **not**
  perform; it MUST be raised before the feature is considered complete.
- **Scope note (final)**: the feature now carries **two data-schema changes** — the persisted undo history in
  006's recovery snapshot (FR-027a) and the document-keyed language override (FR-028b) — alongside the
  main-process clipboard-mode record, the contract-tested clipboard OS seam, and the new keyed-table control in
  007's Settings editor. **No new daemon RPC** still holds.
- **Tenth clarification pass (2026-07-12)** — triggered by the rebase, which brought **013 (in-panel search)**
  and **014 (theme editor)** into master. The spec named neither: the same blind spot that produced the 012 gap.
  **Four** questions asked; the remaining queue (read-only files, observability) was low-impact, so the session
  was stopped rather than padded.
  - **A real chord collision, found by reading the shipped code rather than the spec.** `Ctrl+X` is **already**
    the default of **`file.cut`** (the File Explorer's cut-file command, which also owns Ctrl+C/Ctrl+V), while
    FR-017a needs it for `cut-line`. FR-017b1's *"no two registered commands share a default chord, app-wide"*
    would have **failed the build** — and the only way to pass would have been to move `cut-line` off Ctrl+X,
    abandoning US3 and the user's most explicit requirement. **The rule was wrong, not the design**: the two can
    never fire together (Explorer focus vs active Editor Panel), but the keybinding model is a **flat map with
    no scope concept** and cannot express that. **FR-017b0** adds a **dispatch scope**
    (`editor`/`terminal`/`explorer`/`global`); **FR-017b1** becomes **scope-aware** (uniqueness *within* a
    scope; a `global` chord clashes with nothing anywhere) **and** enumerated from the **command registry**
    rather than a hand-listed set of features — a list-based test silently omits every feature merged after it
    was written. *(`Tab`, `Shift+Tab`, `Alt+Shift+Arrow` verified **free** against shipped defaults; 014
    registers no bindings.)*
  - **Search highlights over syntax colours** (**FR-007a**, **SC-007b**). 013 FR-019 guarantees match
    highlights are legible — but 013 shipped against a **plain-text** editor, so that was only ever validated
    against unstyled text. This feature puts ~10 syntax colours underneath them, and nothing guaranteed a dark
    keyword stays readable inside a dark current-match highlight. Syntax colour now stays the **foreground**,
    and an automated **contrast guard** (extending feature 009's theme-contrast tests) asserts every token
    colour against both match backgrounds on every bundled theme, failing the build on an illegible pairing.
  - **Focus-scoped dispatch** (**FR-017f**): with 013's find bar focused, **Tab** moves within the bar and must
    **not** indent the file — an editing command must never mutate the document while the user types a search
    term.
  - **014's "Restore All Themes to Default"** resets every built-in to its **shipped** values, so this feature's
    new status-strip tokens MUST carry **shipped values in every bundled theme** in 010's record (**FR-010f**),
    or a restore leaves the strip unstyled/illegible.
  - **Seed-from-selection extended** (**FR-025i**): a **one-row** rectangular block seeds 013's find input; a
    multi-row block or a multi-cursor set with several selections seeds **nothing**. An arbitrary "primary"
    selection was rejected as a silent mis-search.
- **Dependencies now**: 006, 007, **010**, **012**, **013**, **014**. **015 is not yet merged**; FR-022b is
  written against 010's restore API directly and so does not depend on it landing.
- **Shared-component touches (three)**: the keyed-table control (FR-022a), the contract-tested clipboard OS seam
  (FR-013a), and the command **dispatch scope** (FR-017b0). None was visible at original scoping.
- **Eleventh clarification pass (2026-07-12)** — a **shipped-code** sweep, continuing the method that has paid
  off for four passes now: check the spec against **external sources of truth**, not against itself. **Three**
  questions asked; all three found the spec asserting something the code contradicts. The session was stopped at
  three rather than padded to five.
  - **The contrast guard FR-007a promised does not exist.** FR-007a demanded that every syntax colour clear the
    minimum against both match backgrounds **on every bundled theme, or fail the build**. But feature 009's
    shipped guard (`packages/core/src/config/theme-quality.ts`) is build-blocking for **three** themes only —
    `IN_SCOPE_THEMES = ['Bash', 'SUBNET', 'Cyberpunk']` — while `knownContrastIssues()` **reports and never
    throws** for the other twelve, *because several of them already fail WCAG AA and that was knowingly
    accepted*. As written, the requirement would have gone **red on day one** and dragged a **multi-theme
    redesign** into Part 1. FR-007a now **inherits 009's policy unchanged** (build-blocking in-scope, reported
    elsewhere), and the gated set is **read from 009's list, never copied**. The only obligation Part 1 keeps is
    to **measure the colours it itself invents** — the syntax palette is new colour **no other feature can
    check**. **SC-007b** rewritten to match.
    **Theme work was then stripped back out, on user challenge** (*"this is about the advanced editor, NOT about
    styles, themes or accessibility"*). An **FR-007b** requiring the theme picker to **mark** WCAG-conformant
    themes, and a proposal to gate **throng / Light / Snake / Claude**, were both **removed**: neither is
    fundamental to this feature's success, and both are a **theme redesign**. Now tracked as
    **[#61](https://github.com/Bidthedog/throng/issues/61)** on the **vNext** milestone, and recorded under *Out
    of Scope*. **Kept** (and defended): FR-007 (theme-aware legible highlighting — the feature's own output),
    FR-007a's **composition rule** (match highlight is a background layer; syntax colour stays the foreground —
    an editor rendering decision), the self-check on Part 1's own syntax palette, and FR-010f/FR-010g (the status
    strip's theme tokens — **constitutionally compelled** by the Configuration-editor completeness rule, and
    required for 014's *Restore All* not to leave the strip unstyled).
  - **The dispatch scope I added last pass could not describe the bindings that already ship.** Two defects:
    (1) `resolveAction` returns the **first** action in map order whose chord matches, so on a flat map `Ctrl+X`
    resolves to `file.cut` **everywhere — including inside an editor — and `cut-line` would never fire at all**;
    the resolver must become **scope-aware**, or the `scope` field is decorative. (2) A **single-valued** scope
    cannot express `search.*` or `editor.save*`, which the shipped comments show are live in an **editor *and* a
    terminal but not the Explorer**. **FR-017b0**: the scope is a **SET** of contexts; two commands clash **iff
    their sets intersect**; **"global" ceases to be a special value** (it is simply the full set), which also
    dissolves a genuine ambiguity in FR-017b1's old wording (*"a global chord collides with nothing in any
    scope"* — exempt, or must-be-unique? The latter). **No default scope**: an unscoped command **fails the
    completeness test**, and the **~40 already-shipped commands** must each be assigned their real set.
  - **The document-keyed override had no home — and my first answer was a cop-out, caught by the user.** FR-028b
    requires it "persisted keyed by the file" but never said where, while the spec still claimed **no SQLite
    migration** and **no new daemon RPC**. I first proposed riding the **project's workspace state**, which — on
    checking — **is** SQLite (`workspace_layout`), so the option was the SQLite option in disguise. The real
    choice was **the schemaless `layout_json` blob** (no migration, no RPC — 006's own pattern) versus a **proper
    table**. **FR-028e** chooses the table: the override is **document** state, not **layout**, and a blob gives
    it no key, no foreign key, no pruning and no protection from a layout rebuild — while inviting every future
    per-file value (the **encoding** and **line-ending** status the strip already anticipates) into the same
    blob. **This deliberately reverses feature 006's "no editor migration" decision (research D2/D14) and
    retires the guard test that enforces it** (`no-editor-migration.integration.test.ts` —
    `LATEST_VERSION === 6`, no editor table). That guard was right while editor state was per-**panel**; FR-028b
    made the override a property of the **document**, so it is right no longer. Retiring it is an **explicit,
    reviewed change**, never a quiet deletion to make a migration pass. New **SC-013a**.
- **Stale text swept.** Three superseded statements were still contradicting live requirements and were fixed in
  place, not duplicated: **SC-012** still said the undo history is *"never persisted across a restart"* (FR-027a
  reversed that a pass ago); **FR-027** still justified the override surviving recovery on the grounds that it
  *"lives in the panel's layout"* (FR-028b moved it to the document); and **six** live requirements plus three
  Key Entities still described the override as **per-panel**.
- **Content-quality caveat (judged, not ignored).** FR-028e names concrete artefacts — SQLite, a versioned
  migration, `layout_json`, and the 006 guard test by filename. That is in tension with *"No implementation
  details"*. The items are kept **checked** on the judgement that the persistence store is **not a free design
  choice**: the constitution **fixes** the daemon/SQLite architecture and mandates **idempotent migrations**, so
  naming it states an **existing architectural constraint** rather than pre-empting a planning decision. The
  guard test is named because an obligation to **explicitly retire a test that exists to prevent this change**
  cannot be stated without naming it — and burying it would be exactly the silent deletion the requirement
  forbids. Flagged here so `/speckit-plan` can revisit the framing if it disagrees.
- **Fourth question of the eleventh pass — what theme *keys* does this feature add?** Setting the WCAG argument
  aside (which was scope creep, and was cut), the spec was **contradicting itself** on the question that *is*
  016's business: the 2026-07-08 clarification **deferred** per-syntax-category colour tokens ("one built-in,
  theme-aware highlight style"), yet FR-007a's guard requires measuring *"every syntax token colour on every
  bundled theme"* — a per-theme value that, under the deferral, **does not exist**.
  **Resolved: syntax colours become first-class theme tokens (FR-007b), superseding the 2026-07-08 deferral.**
  That deferral was not merely awkward, it was **unachievable**: no single palette is legible on both **Matrix**
  (green-on-black) and **Light** (dark-on-white), so the colours resolve **per theme** whatever they are called —
  and a derived-but-unnamed palette is one **no theme author owns, no user can tune, and no test can hold anyone
  to**. ~**8–10** named tokens join the theme record, each with a descriptor, Themes-editor exposure,
  completeness coverage and a **shipped value in every bundled theme** (010's record — required so 014's
  *Restore All* cannot leave **code itself** unstyled).
  **This is the largest single addition any clarification has made to this feature: ~8–10 tokens × 15 themes ≈
  150 shipped colour values.** Accepted because the alternative does not work, not because it is cheap.
  **FR-007c** guards a build-breaking side effect I nearly missed: 009's distinctness gate is the **mean** ΔE00
  across shared tokens, and it sits only **0.17** below the closest legitimate pair (`4.3` vs `4.469`). Adding
  ~10 tokens moves that mean for **every** pair — **copy-pasted syntax palettes would pull the themes together
  and fail the build**. Per-theme palettes push them apart; the gate is re-measured, and recalibrated **only** if
  the closest *legitimate* pair genuinely moved. **Feature 009 is now an explicit Dependency** (this feature
  extends both its contrast pairings and its distinctness gate).
- **Scope note (superseding the earlier "final")**: Part 1's out-of-editor surface is **three shared-component
  touches** — the keyed-table control (FR-022a), the clipboard OS seam (FR-013a) and the command **dispatch
  scope** (FR-017b0) — plus **two data-schema changes**: the persisted undo history (FR-027a) and the
  **per-document-state SQLite table** (FR-028e). The long-standing **"no new daemon RPC"** claim is now **false**
  and has been corrected: FR-028e needs one. Every one of these was surfaced by a **later clarification**, never
  by the original scoping. A **fourth** touch (a theme accessibility marker) was briefly added this pass and
  **removed again** — it was theming, not editing (#61).
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. All items pass.
