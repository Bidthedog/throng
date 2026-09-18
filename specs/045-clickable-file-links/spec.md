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
*Amended 2026-09-18 (second hands-on round): this spec now also **closes #326** — FR-130 requires
exactly #326's intended outcome, for every link kind, and adds clickability from every row.*

**Input**: The body of #394 — its *Intent*, *Proposed outcome*, *Scope and constraints*, *Existing
requirements to reconcile* and *Acceptance criteria* are binding — plus the maintainer's trigger for
it: their Claude Code status line prints OSC 8 hyperlinks whose target is a `file:///D:/...` **folder**
(the project folder). Those links work in Windows Terminal and are inert in throng, because 024 FR-019
routes only `http`/`https` targets out of a terminal and refuses `file:` by name.

**Amended 2026-09-18 — maintainer change request after hands-on testing of PR #408.** Verbatim:
*"Add to this PR and amend the 045 issue to incorporate all kinds of links across editors, and 024 to
incorporate all kinds of links across terminals. The behaviour should be identical (CTRL+Click
everywhere, files do not execute / open in their default programs - they simply show in the OS
explorer [or in throng if its a local file, regardless of how the path is formatted]). Also, UNC paths
do not seem to be working at all - I cannot click any network paths."* It is recorded as the third
Clarifications session below, adds **US8**, **US9**, **FR-100 – FR-124**, **SC-012 – SC-014** and
defect **D1**, and supersedes parts of this spec's own FR-039, FR-050 – FR-054, FR-061 and US5 in
place (each marked where it stands, text kept) and one more clause of 024 (**S4**). Nothing is deleted.
A **second hands-on round** the same day added **US10**, **US11**, **FR-130 – FR-133** (wrapped
links; closes #326), **FR-135 – FR-139** (one affordance, marked at rest), **FR-140 – FR-145** (every
terminal flavour), **SC-015 – SC-018** and defect **D2** (a position suffix not honoured).
A **third round** the same day ran the maintainer's own corpus through a Playwright probe in all four
built-in flavours and an editor. Every failing row was first matched to the requirement and task that
already govern it; what nothing covered added **US12**, **FR-150 – FR-154** (paths containing spaces,
Git Bash's own mount table, drive-qualified rooted paths, POSIX spellings inside `file:` URIs, and a
dead OSC 8 hyperlink drawn as no link at all), **SC-019 – SC-020** and defects **D3** (an editor
Ctrl+click on a link's first character sometimes missed it) and **D4** (FR-038's de-elevated launcher
not wired into the shipped app).

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
| **web link** | A link whose target is `http` or `https`, as 024 US7 already defines it. Nothing about web links changes here. *Superseded in part 2026-09-18 by FR-100 – FR-104: web links now exist in editors too, with the terminal's grammar and behaviour — what a web link* does *is still unchanged* |
| **resolved target** | The single absolute location a file link names, and whether it is a **file** or a **folder** |
| **position** | The line, and optionally the column, a link carries (`:42`, `:42:7`, `(42,7)`) |
| **owning project** | The project the panel showing the link belongs to. A panel in a sub-workspace keeps its original project (Principle XI). A panel with no owning project has none |
| **in the project** | A resolved target inside the owning project's root folder. This is decided on the resolved location, not on how the link was written |
| **link target** | One of the four explicit ways to follow a file link: **Open in Editor**, **Open in Preview**, **Open in OS Explorer**, **Open in OS Default Program** (FR-030) |
| **default link action** | The preference that decides which link target Ctrl+click, Ctrl+Enter and the plain **Open Link** menu item use (FR-050). *Superseded 2026-09-18 by FR-110/FR-112: there is no such preference any more. The term now names the fixed* **click rule** *(FR-110) those three routes run* |
| **click rule** | *(added 2026-09-18)* What Ctrl+click, the Open Link chord and the plain **Open Link** item do for a link: a web link opens in the default browser, an in-project file opens in throng, and everything else is shown in OS Explorer (FR-110). It consults no link-specific preference |
| **volume root** | *(added 2026-09-18)* The part of a resolved location that names the device it lives on — `\\server\share` for a network location, the drive for a drive path. Existence checks are bounded per volume root (FR-121) |
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

### Session 2026-09-18 (decisions taken during planning — recorded as amendments in place)

Each of these was raised by [plan.md](./plan.md) *Reported to the maintainer* as a problem an
implementer would otherwise resolve the wrong way. Each is written into the requirement it affects as
a dated amendment naming what it changes, rather than as a silent correction.

- Q: FR-031 requires Open Link to show the Open Link chord; FR-046 requires that chord not to be live
  in a terminal. Which wins over a terminal file link? → A: **Both, read together.** Open Link shows
  the chord *where one is bound*, and in a terminal none is — so the terminal's Open Link item shows
  **no** chord, while the editor's and the preview's show `Ctrl+Enter`. The authority is constitution
  Principle VI's own wording (*"where one is bound"*); the derivation is R10(b). A clarification of
  FR-031, **not** a supersession: neither requirement changes meaning. Amendment in **FR-031**.
- Q: The Assumptions say the file-link hover tooltip matches the wording web links use. The shipped
  wording is `Ctrl+Click to open in system browser`, which is false for `src/foo.ts`. What did the
  assumption mean? → A: **The same shape and the same delay, not the same words.** The tooltip names
  the gesture — FR-042's actual requirement — and its destination wording differs by link kind; the
  delay (`terminals.linkHoverDelayMs`) is genuinely shared and unchanged. Derivation R10(a).
  Amendment in **Assumptions**.
- Q: Which reveal policy carries Open in OS Explorer for a file link? `throng:files:reveal` is
  confined by a path prefix and `throng:files:revealDocument` refuses any path no panel has open —
  neither admits a link to a file outside the project that nothing has open, which FR-030 requires.
  → A: **A third policy, `throng:links:reveal`**, confined by FR-037's re-resolution rather than by a
  prefix or the open-document registry. Neither existing confinement is loosened, and the repository
  deliberately ends up with three reveal policies. Derivation R8. Added as **FR-035a**.
- Q: FR-091 says constitution Principle VI's *Known gaps* sentence needs bringing current on
  delivery. Is its premise sound? → A: **No — the sentence is already stale.** 044 shipped
  `preview.followLink` on Ctrl+Enter (`keybindings.ts:408`, dispatched at
  `preview-commands.tsx:162-167`), so *"no surface yet implements Ctrl+Enter"* is wrong today, before
  this feature changes anything. FR-091 is restated to correct **two** statements and to require its
  SYNC IMPACT REPORT to record what it found in the code rather than restating the premise.
  Derivation R16. Amendment in **FR-091**.

### Session 2026-09-18 (maintainer change request after hands-on testing — answered by the maintainer's own words, decisions derived from them)

The request is quoted in full under the title. Each answer below is either the maintainer's words or a
decision derived from them while amending; the derived ones say so and are listed in the report back
to the maintainer for confirmation.

- Q: Which link kinds, in which panel types? → A (maintainer): **all kinds, in editors and in
  terminals, behaving identically.** Web URLs are the gap: an editor recognises none today (024 US7
  was terminal-only, and this spec added only file links to editors). Every kind a panel's medium
  can carry is recognised, underlined, followed on Ctrl+click and offered in the menu in both panel
  types, and one shared scan decides what is a link in both, so neither side can drift (FR-100 –
  FR-104).
- Q: What does a Ctrl+click on a file do? → A (maintainer): **it never executes the file and never
  opens it in its default program.** A file in the current project opens in throng; anything else is
  shown in OS Explorer. Derived: "in throng" means what it meant under FR-051/FR-052 — a preview when
  044's per-provider default open action is Preview and the link carries no position, an editor
  otherwise, at the line and column — and "local file" is read as **a file in the current
  project**, because opening an out-of-project file in throng is forbidden by FR-055 and Principle I
  and the maintainer did not ask for that to change (FR-110, FR-111). **Open in OS Default Program**
  stays in the menu as the only way to hand a file to its program.
- Q: What happens to the **default link action** setting? → A (derived): **it is retired.** The click
  rule now decides every destination; the only choice left to a preference — editor or preview for
  an in-project file — is already made by 044's per-provider default open action, which every other
  open path in throng follows. A second preference choosing the same thing for links alone would make
  a link open differently from the same file in Files & Folders, which is the drift the maintainer's
  "identical" rules out. A persisted value is **dropped, not migrated**, on 019 FR-023's precedent
  (FR-112, FR-113).
- Q: What does "regardless of how the path is formatted" require that FR-020 – FR-026 do not already?
  → A (derived): **FR-021 already requires it**, and it stays. It is strengthened in two ways: one
  fixture spells one in-project file every supported way and must open it in throng from both panel
  types (FR-106), and PowerShell's provider-qualified spelling (`FileSystem::\\server\share\x`),
  which is how PowerShell prints every network location, becomes a recognised form (FR-003g,
  FR-107). A different **name** for the same place — a mapped drive letter for a share, an admin
  share for a local drive, an 8.3 short name — is not a format, and is judged as named, like the
  symlink edge case (FR-106).
- Q: UNC paths "do not seem to be working at all". A new requirement? → A (derived): **No — a defect
  against requirements that already exist** (FR-003c, FR-012, FR-022 – FR-024, US1 scenario 4, US2
  scenario 4, SC-001), recorded as **D1** with its reproduction. What the spec did **not** say is how
  an existence check behaves against a network location that is slow or offline, and "only real
  locations become links" makes that a real question: FR-120 – FR-124 answer it.

### Session 2026-09-18 (maintainer, second hands-on round — five further reports)

The maintainer ran their own corpus of link variants (see *Assumptions*) and reported, in their words
or close paraphrase through the coordinator:

- Q: "When a link [any link, valid or invalid] spans multiple lines" it cannot be clicked in a
  terminal. In scope? → A (maintainer): **yes.** A link the terminal soft-wrapped across rows is one
  link: underlined on every row and followable from a click on **any** of its rows, for web links,
  detected paths and OSC 8 hyperlinks alike (FR-130 – FR-133). This brings #326 in scope and **closes
  it** — #326's expected outcome ("underlined along its whole length, on every row it occupies") is
  FR-130's, word for word in substance. "Valid or invalid" is read as "whatever kind of link": a
  candidate that names nothing is still not a link (FR-006), wrapped or not.
- Q: Ctrl+clicking `test.md:3:5` opened `test.md` but not at line 3, column 5. → A (derived): **a
  defect against existing requirements** (FR-004, FR-033, FR-052, FR-110), recorded as **D2** with a
  reproduce-first task. `.md` is a preview-provider format, so the meeting point of "a position always
  opens an editor" and 044's default open action is the first place to look — a hypothesis, not a
  finding.
- Q: "The underlining / hover styling is not consistent across links — it should be clear to users
  that links can be clicked." → A (derived): **one affordance for every link, in both panel types,
  marked at rest** — a dashed underline in a themeable link colour while at rest, solid on hover,
  a tooltip naming gesture and destination, and a hand pointer while the modifier is held
  (FR-135 – FR-139). At rest, because a hover-only mark means a user has to sweep the pointer across
  the screen to discover what is clickable, which is precisely "not clear". The performance rules are
  kept by marking a **detected path** at rest only once it has resolved, and resolving the visible
  rows of a terminal only while its output is idle (FR-137).
- Q: PowerShell's `FileSystem::` form. → A: **already FR-003g**; unchanged.
- Q: "We need to get this working in every terminal type, too." → A (maintainer): **every link
  behaviour here holds identically in every built-in flavour** — Command Prompt, Windows PowerShell,
  PowerShell 7, Git Bash — and in WSL where it is installed and configured as a flavour
  (FR-140 – FR-145). Derived: no built-in flavour needs **new** shell integration — cmd's directory is
  observed, and the other three already report theirs through 025's OSC 9;9 integration. WSL is not a
  built-in flavour and reports no directory; its relative paths resolve against the project root
  alone, and giving WSL a reported directory is new shell-integration work outside this spec
  (FR-144).

### Session 2026-09-18 (third round — the maintainer's corpus run by a probe; decisions derived)

A Playwright probe ran `D:\git\throng_tests\test 1\links-test.sh` (81 rows) in a Command Prompt,
Windows PowerShell, PowerShell 7 and Git Bash terminal, and against the same text in an editor, with
every OS seam replaced by a recorder so nothing was launched. The maintainer's rule it checked against
is FR-110's, restated by the maintainer: *a web URL opens in the browser; an existing in-project file
opens in throng, at its line and column when it has one; anything else that exists is shown in OS
Explorer; nothing that does not exist is a link; and Ctrl+click never opens a default program.* The
four flavours produced identical results on all 81 rows — 51 pass, 30 fail each; the editor passed
27, failed 34 and had 20 not applicable (OSC 8 rows, which a document cannot carry). Every failing row
is mapped to its requirement and task in [tasks.md](./tasks.md) Phase 15. The questions the rows
raised that no requirement answered:

- Q: `D:\git\throng_tests\test 1\test.md` and `/d/git/throng_tests/test 1/test.md` are never
  recognised — the space ends the token. The maintainer requires "regardless of how the path is
  formatted". What is the grammar? → A (derived): **an anchored path may run across spaces, and
  existence decides how far** (FR-150). A candidate that begins with an absolute or explicitly
  relative form also yields longer readings that extend it word by word across single spaces, tried
  longest first, and the first that exists is the link — FR-004's position readings, applied to
  spaces. A bare word never starts one, so ordinary prose gains no candidates and SC-003's fixture
  stays at zero spans; a reading that names nothing is still not a link (FR-006).
- Q: `/usr/bin/bash.exe` and `/etc/hosts` are not links, and `/tmp` is followed to a folder on the
  current drive rather than Git Bash's `/tmp`. → A (derived): **a rooted POSIX path means what Git
  Bash means by it** (FR-151). FR-025's last sentence ("not otherwise mapped") was written against WSL
  filesystem access, and Git Bash's mount table is not that: it is a set of Windows folders. It is
  tried after the project root and the drive forms and before the platform's own meaning, in every
  surface and flavour except a WSL flavour, where a Linux path names the distro's filesystem and is
  left to #13. The platform's own meaning, when it is reached, is drive-qualified rather than handed
  to the OS as written (FR-152).
- Q: `file:///c/Windows/win.ini` is not a link, an OSC 8 `file:///mnt/c/…` target does nothing, and
  an OSC 8 `file://localhost/C$/Windows/win.ini` is underlined and inert. → A (derived): **the path
  inside a `file:` URI is spelled however the program that wrote it spells paths** (FR-153). A
  hostless or `localhost` URI whose path is not drive-qualified goes through the same leading-`/`
  rules as the same path written bare; a `localhost` URI whose first segment is not a drive also tries
  the loopback share, `\\localhost\<segment>\…`, which is what Windows' own shell makes of it.
- Q: An OSC 8 hyperlink whose target is missing, on an unknown host, or of an unknown scheme is drawn
  with an underline and a hand pointer, and a Ctrl+click does nothing. What should it look like, and
  what should a click do? → A (derived): **it is not a link, so it looks like text** (FR-154). FR-006
  and FR-013 already say such a target is not a link and offers nothing; the affordance promising
  otherwise is the defect. No underline at rest or on hover, no pointer, no tooltip, no link menu
  items; a Ctrl+click on it reaches the program as FR-043 requires for anything throng did not
  resolve. **No notice is raised**: no action was attempted, so there is no condition to report, and a
  notice on every hover of a program's dead link would be one condition raising many notices. An OSC 8
  `file:` target is therefore marked only once it has resolved, exactly as a detected path is
  (FR-137); an `http`/`https` target is marked as it is drawn, as before.
- Q: WSL is installed but is not offered in the terminal picker, so no WSL cell was run. A gap in
  this spec? → A: **No — WSL is not a built-in flavour** (005 FR-024 excludes WSL's
  `System32\bash.exe`; 025 FR-011 lets a user define it as a flavour; WSL as a first-class flavour is
  the open epic [#13](https://github.com/Bidthedog/throng/issues/13), milestone vNext). FR-140 and
  FR-145 already say "where one is configured", and a flavour not run is reported as **not run**. The
  gap is in the evidence, not the requirement: a task configures a user-defined WSL flavour and runs
  the corpus in it (T220).
- Q: Two further failures sat outside any row's "expected" column. → A: **defects against existing
  requirements**, recorded as **D3** (an editor Ctrl+click on a decorated link's first character
  placed a caret in 2 of 27 attempts) and **D4** (FR-038 is not wired: `main.ts:934` constructs
  `ElectronShellIntegration` with no de-elevating launcher), each with a reproduce-first task.

### Session 2026-09-18 (maintainer confirmation, and three decisions taken while building)

- Q: Do the reproductions show what the maintainer saw? → A (maintainer): **yes** — D1 (the UNC
  join, T135; research O8), D2 (T174), D3 (T215) and D4 (T217). D1's fix is contract R12: a base
  beginning with two separators keeps both, and `..` stops at the server and share.
- Q: Are the derived decisions accepted? → A (maintainer): **yes**, as written — the third session's
  (R17's retirement of the default link action, FR-106's alias rule, FR-114's in-project executable,
  `IExecutableExtensions` kept as SC-010/SC-013's oracle per plan item 6, 044 FR-090e left alone;
  T171) and the fifth session's (FR-150's grammar — anchored forms only, longest existing reading, the
  word cap; FR-151 in editors and every flavour but WSL; FR-153's loopback reading; FR-154's "no
  notice"; T223).
- Q: With no base directory and no project root, does `/test.txt` resolve to nothing (T205 as
  first written)? → A (maintainer, accepted with FR-151): **no — Git's mount-table reading is still
  tried.** FR-152 withholds only the **platform** step from a panel with neither anchor; the
  mount-table step names an absolute place and needs no base (`e197681f`).
- Q: Where was D3? → A: **the link cache's expiry**, a cause none of D3's three hypotheses named. A
  decoration drawn from a cached answer outlived that answer's TTL; the Ctrl+click then asked the
  cache again, got "not known", and fell through to CodeMirror's add-a-cursor. The fix (T216,
  `63ac8912`): the scan keeps the answer it last drew when the cache says "not known" after its TTL,
  and a follow uses the hit's resolved link rather than asking again, so an underlined link is always
  followable; an `{ ok: false }` answer still clears it. Accepted by the maintainer.
- Q: Why does FR-120's maximum read 25,000 ms, not the 30,000 first written? → A (taken while
  building, `207a98b4`): **018 FR-035** requires a slider's step to be at least 1% of its range. At
  a 250 ms step, 250 – 30,000 is 0.84%; 250 – 25,000 is 1.01%, keeps the shipped 2,000 on the grid
  and the maximum reachable by drag. Twenty-five seconds is still far past any share that answers at
  all. FR-120 was edited in place; this line is its reason.
- Q: FR-121 caps the stuck checks process-wide *and* says a check under any other volume root is
  unaffected. Which wins when the cap is reached? → A (taken while building, `c2d5c858`): **both,
  split by kind of root.** A full stuck-root map answers `unreachable` at once only for a **network
  (UNC)** root not already in it; a local drive root is never gated by a full map and is checked as
  usual. As first built, two offline shares made every local link dead — the opposite of FR-121's
  last sentence. data-model §13.5 records the rule.
- Q: FR-144's note and T189 put "is this flavour WSL?" behind the platform abstraction. Is that where
  it went? → A (taken while building, `29b06f66`): **no — a recorded deviation.** It is
  `isWslExecutable` in `packages/core/src/terminal/wsl-flavour.ts`, a pure reading of an executable
  path, because the renderer asks it at hover time and has no route to `platform-windows`. One answer
  still serves FR-144 and FR-151. The reasoning is plan *Complexity Tracking — third round* and
  [contracts/platform-ports.md](./contracts/platform-ports.md) §6.2; FR-144's text is left as it
  stands, with a pointer.

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

> **Superseded in part 2026-09-18 by US8 and FR-110 – FR-113.** The default link action preference
> this story sets is retired, so scenarios **4**, **6** and **8** no longer describe the product, and
> scenario **5**'s "fallback order (FR-053)" is replaced by the click rule: a file outside the
> project is shown in OS Explorer. Scenarios **1**, **2**, **3** and **7** still hold exactly as
> written — they describe the click rule's in-project half and the explicit menu item. The text below
> is kept as it was.

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

### User Story 8 - Every link behaves the same in editors and terminals (Priority: P1) *(added 2026-09-18)*

The user learns one gesture and one outcome. A web address in a Markdown file opens in the browser
exactly as the same address printed in a terminal does. A path Ctrl+clicked anywhere either opens the
file in throng, because it is in the project, or shows it in OS Explorer — it never runs a script and
never launches another program.

**Why this priority**: The maintainer found, testing the shipped slices by hand, that the two panel
types disagree (editors have no web links at all) and that a click could hand a file to its default
program. Both are the kind of surprise that teaches a user to stop clicking.

**Independent Test**: Put the same line — a web address, an in-project path with a position, an
out-of-project path, a folder, and an in-project `deploy.ps1` — in an editor and print it in a
terminal. Hover, Ctrl+click and right-click each in both. The outcomes must match pairwise.

**Acceptance Scenarios**:

1. **Given** `https://example.com/docs` in an editor, **When** the user hovers it, **Then** it is
   underlined and the tooltip names the gesture; **When** the user Ctrl+clicks it, **Then** it opens
   once in the default system browser; **When** the user plain-clicks it, **Then** the caret moves
   and nothing opens (FR-101, FR-103).
2. **Given** the caret inside that address with no selection, **When** the user presses Ctrl+Enter,
   **Then** it opens as Ctrl+click would; **Given** a selection or a second caret, **Then** Ctrl+Enter
   keeps its editor meaning (FR-103, FR-044).
3. **Given** a right-click over that address with no selection, **Then** the editor menu leads with
   **Open Link** (showing `Ctrl+Enter`) and **Copy Link Address**, which copies the address; with text
   selected, **Then** the ordinary menu appears (FR-103).
4. **Given** `https://host/src/foo.ts:42` in an editor, **Then** it is one web link and no part of it
   is a file link, exactly as in a terminal (FR-009, FR-104).
5. **Given** an in-project `src/foo.ts:42:7`, **When** Ctrl+clicked in either panel type, **Then**
   `foo.ts` opens in a throng editor at line 42, column 7 (FR-110).
6. **Given** an in-project `README.md` with no position and the Markdown provider's default open action
   set to Preview, **When** Ctrl+clicked, **Then** its preview opens (FR-110, 044 FR-050).
7. **Given** a path to a file outside the project — any type, `.txt` or `setup.exe` alike — **When**
   Ctrl+clicked, or followed with Open Link from the menu, **Then** OS Explorer opens with the file
   selected, and the file is not opened or run (FR-110, FR-111).
8. **Given** an in-project `deploy.ps1`, **When** Ctrl+clicked, **Then** it opens in a throng editor
   as its text, and does not run (FR-110, FR-114).
9. **Given** a folder link, in or out of the project, **When** Ctrl+clicked, **Then** OS Explorer opens
   on that folder (FR-110).
10. **Given** any file link, **When** the user chooses **Open in OS Default Program** from its menu,
    **Then** the OS default application opens it — the one route that does (FR-111).
11. **Given** a settings file written by an earlier build of this branch carrying
    `editor.links.defaultAction`, **When** throng loads it, **Then** the value is ignored, nothing
    warns, the key is gone after the next settings write, and no link opens in a default program
    (FR-113).
12. **Given** one in-project file spelled every supported way (FR-106), **When** each spelling is
    Ctrl+clicked in either panel type, **Then** every one opens that file in throng.

---

### User Story 9 - Follow a network path (Priority: P1) *(added 2026-09-18)*

A user working with files on a network share — a terminal whose working directory is
`\\server\share\dir`, a listing of that folder, an editor on a file that lives there, or a project
rooted on the share — Ctrl+clicks a path and it behaves exactly as a local one does. An offline share
never makes throng slow.

**Why this priority**: The maintainer reports that no network path can be followed at all, although
FR-003c and FR-012 require it. It is a defect in a P1 story's own scenario (US1 scenario 4).

**Independent Test**: With a reachable share, open a terminal, `cd` into the share, list it, and
Ctrl+click a relative name, an absolute `\\server\share\…` path, the `//server/share/…` spelling and
PowerShell's `FileSystem::\\server\share\…` prompt. Open a file on the share in an editor and
Ctrl+click a relative path in it. Then take the share offline and hover the same text.

**Acceptance Scenarios**:

1. **Given** a terminal whose working directory is `\\server\share\dir`, **When** `notes.txt` printed
   there is Ctrl+clicked, **Then** `\\server\share\dir\notes.txt` is followed (D1, FR-023).
2. **Given** the same terminal, **When** `..\other\notes.txt` is Ctrl+clicked, **Then**
   `\\server\share\other\notes.txt` is followed, and `..` never climbs above the share (D1).
3. **Given** an editor on `\\server\share\proj\docs\a.md` naming `./b.md`, **When** it is
   Ctrl+clicked, **Then** `\\server\share\proj\docs\b.md` is followed (D1, FR-022).
4. **Given** a project rooted at `\\server\share\proj`, **When** `src/foo.ts` or `/test.txt` is
   Ctrl+clicked, **Then** it resolves under that root and is **in the project** (D1, FR-021, FR-024).
5. **Given** PowerShell's prompt `PS Microsoft.PowerShell.Core\FileSystem::\\server\share\dir>`,
   **Then** `\\server\share\dir` in it is a folder link (FR-003g).
6. **Given** a path on a server that does not answer, **When** it is hovered, **Then** it is not
   underlined, the hover answers within the existence-check timeout, and output, typing, scrolling
   and saving files elsewhere are not delayed (FR-120, FR-121).
7. **Given** several paths on that same offline server on screen, **When** the user hovers each in
   turn, **Then** at most one check against that server is outstanding, and hovers after the first
   timeout answer at once without starting another (FR-121, FR-122).
8. **Given** a network path whose server answers slowly but within the timeout, **When** it is hovered,
   **Then** it becomes a link on that same hover, without moving the pointer off the line and back
   (FR-123).
9. **Given** a network link that was underlined, and its server has since gone offline, **When** it is
   Ctrl+clicked, **Then** within the timeout exactly one notice names the path and says the location
   did not answer — not that it no longer exists (FR-124).

---

### User Story 10 - See what is clickable, wherever it wraps (Priority: P1) *(added 2026-09-18, second round)*

A user glances at a terminal or an editor and can tell which text is a link without moving the
pointer. A long URL or path that the terminal wrapped onto two or three rows looks like one link and
opens from whichever row they click.

**Why this priority**: The maintainer could not click a wrapped link at all, and found the link
styling inconsistent enough that it was not clear what could be clicked. A link nobody recognises is
a link nobody follows.

**Independent Test**: Narrow a terminal until a URL, a detected path and an OSC 8 hyperlink each
wrap. Without hovering, check each is marked on every row; hover and Ctrl+click each row of each.
Repeat the at-rest check in an editor.

**Acceptance Scenarios**:

1. **Given** a web URL, a detected path and an OSC 8 hyperlink each soft-wrapped across two rows,
   **Then** each is marked on both rows at rest, and **When** either row is hovered, **Then** the
   whole link — both rows — shows its hover state (FR-130, FR-136).
2. **Given** the same links, **When** the user Ctrl+clicks the **second** row of any of them, **Then**
   the whole target is followed, exactly once (FR-131, FR-043).
3. **Given** a web link, a resolved detected path and an OSC 8 link on screen, **Then** all three
   look the same at rest and on hover, in a terminal and in an editor: the same underline, the same
   colour, the same tooltip shape, the same pointer (FR-135).
4. **Given** a terminal streaming output, **Then** no existence check runs while the output arrives;
   **When** the output stops, **Then** the resolved paths on screen become marked without the user
   hovering them (FR-137, FR-072).
5. **Given** a theme that changes the link colour, **Then** every link in both panel types repaints
   in it with no restart (FR-138).

---

### User Story 11 - Links work the same in every terminal flavour (Priority: P1) *(added 2026-09-18, second round)*

Whatever shell a terminal runs — Command Prompt, Windows PowerShell, PowerShell 7, Git Bash, or a WSL
flavour where one is configured — a link printed there is detected, marked, followed and offered in
the menu exactly as in any other.

**Why this priority**: 028 FR-007 already makes terminal behaviour a promise for every flavour, and
025 found twice that single-flavour coverage ships defects. The maintainer asked for it by name.

**Independent Test**: Run the maintainer's corpus (see *Assumptions*) in a terminal of each flavour,
`cd` into a subfolder first, and compare the outcome matrix cell by cell (FR-145).

**Acceptance Scenarios**:

1. **Given** each built-in flavour, **When** a program prints an OSC 8 hyperlink, **Then** it reaches
   throng as a hyperlink through ConPTY and behaves as US2 describes; where the evidence shows a
   flavour's path strips it, **Then** its visible text is still caught by detection (FR-141).
2. **Given** each built-in flavour, after `cd sub`, **When** a relative path printed there is
   Ctrl+clicked, **Then** it resolves against `sub` — observed for Command Prompt, reported through
   025's shell integration for the other three (FR-142).
3. **Given** shell integration switched off, **When** a relative path printed in Windows PowerShell,
   PowerShell 7 or Git Bash is Ctrl+clicked, **Then** it resolves against the project root and never
   against the directory the shell was launched in (FR-143).
4. **Given** a WSL flavour, **When** `/mnt/c/…` is printed, **Then** it maps to `C:\…` (FR-025);
   **When** a relative path is printed, **Then** it resolves against the project root, because WSL
   reports no directory (FR-144).
5. **Given** any flavour, **Then** wrapped links, the affordance and the click rule behave exactly as
   in every other (FR-140).

---

### User Story 12 - Any spelling of an existing path is a link, and nothing else looks like one (Priority: P1) *(added 2026-09-18, third round)*

A user sees a path a program printed — with a space in a folder name, in Git Bash's own spelling, or
inside a `file:` URI however the program chose to write it — and Ctrl+clicks it. It goes where the
click rule says. Text that is not a link, including a hyperlink a program emitted to a target that
does not exist, does not pretend to be one.

**Why this priority**: The maintainer's corpus — the acceptance instrument for this feature — fails
on exactly these rows in every flavour, and "regardless of how the path is formatted" is their
requirement. A link that looks followable and does nothing teaches a user to stop trying links.

**Independent Test**: Run the corpus (see *Assumptions*) in each flavour and in an editor and compare
with the maintainer's expected column; the probe's matrix is the checklist (SC-019).

**Acceptance Scenarios**:

1. **Given** `D:\git\throng_tests\test 1\test.md` and `/d/git/throng_tests/test 1/test.md` printed
   in a terminal whose project is `D:\git\throng_tests\test 1`, **When** either is Ctrl+clicked,
   **Then** `test.md` opens in throng; **and given** `/mnt/d/git/throng_tests/test 1/test.md:3`,
   **Then** it opens at line 3 (FR-150, FR-025, D2).
2. **Given** ordinary prose containing spaces, slashes and dotted words, **Then** no span is marked,
   and a word after a path that exists is never swallowed into it (FR-150, SC-003).
3. **Given** Git for Windows installed, **When** `/usr/bin/bash.exe`, `/etc/hosts` or `/tmp` is
   Ctrl+clicked in any built-in flavour or an editor, **Then** Git Bash's meaning of it is shown in OS
   Explorer; **Given** a WSL flavour, **Then** the same text is not mapped through Git's mount table
   (FR-151).
4. **Given** a rooted path with no drive that reaches the platform's own meaning, **Then** the
   location acted on is drive-qualified, never the text as written (FR-152).
5. **Given** `file:///c/Windows/win.ini` as text, an OSC 8 target `file:///mnt/c/Windows/win.ini`, or
   an OSC 8 target `file://localhost/C$/Windows/win.ini`, **When** Ctrl+clicked, **Then** `win.ini`
   is shown in OS Explorer (FR-153).
6. **Given** OSC 8 hyperlinks to `file:///C:/does/not/exist.txt`, `file://nonexistent-host/share/x`
   and `notascheme:foo`, **Then** none is underlined at rest or on hover, none shows a hand pointer or
   a tooltip, none offers link menu items, a Ctrl+click on one reaches the program, and no notice is
   raised (FR-154, FR-006, FR-013, FR-043).
7. **Given** an out-of-project `win.ini`, a `.dll` or a `.md`, **When** Ctrl+clicked in either panel
   type, **Then** it is shown in OS Explorer and never handed to its default program (FR-110, FR-111 —
   already required; the corpus shows the shipped code still falls back to the default program).

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
  *Superseded 2026-09-18 by FR-130: it is this feature's now — every row is underlined and
  followable, and #326 closes here.*
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
- *(added 2026-09-18)* **An executable inside the project** (`deploy.ps1`, `build.bat`) opens in a
  throng editor on Ctrl+click, as its text, like any other in-project file — which is what someone
  following `deploy.ps1:12` out of an error wants. It is still never run (FR-111, FR-114).
- *(added 2026-09-18)* **An in-project file with no provider and binary content** (an `.exe` under
  the project root) opens exactly as Files & Folders opens it. "Identical" is the rule; a click never
  chooses a different destination than the tree would.
- *(added 2026-09-18)* **A network path whose server is offline.** Not underlined; the check ends at
  the timeout; the server is left alone for a back-off period, then tried again on a later hover, so
  a share that comes back becomes linkable without a restart (FR-120 – FR-122).
- *(added 2026-09-18)* **A mapped drive letter for a share** (`Z:\proj\x.ts` where `Z:` is
  `\\server\share`) is judged by the name it was written with. If the project was opened as
  `\\server\share\proj`, a `Z:` link to a file in it is outside the project by name and is shown in
  OS Explorer — never opened in throng on a guess (FR-106, Principle I). Its existence check is
  bounded like any other volume root's (FR-121).
- *(added 2026-09-18)* **A `mailto:` or other non-web scheme written in an editor** is not a link,
  exactly as in a terminal (FR-013, FR-100).
- *(added 2026-09-18, second round)* **A program that breaks a long path with its own newline** (a
  TUI that wraps text itself) has printed two lines, not one wrapped line. Joining them would be a
  guess, so each half is judged on its own (FR-132). An **OSC 8** link a program re-emits on each
  line with the same target is the exception: the target was declared, so every piece is the same
  link.
- *(added 2026-09-18, second round)* **Output that never stops** (a `tail -f`, a spinner). The idle
  scan never starts, so detected paths are marked only when hovered — the same state as before this
  amendment, never worse (FR-137).
- *(added 2026-09-18, second round)* **A detected path whose file is deleted while it is marked.**
  The watcher invalidation (FR-070) removes the mark on the next idle scan or hover.
- *(added 2026-09-18, third round)* **A path with a space followed by more prose** (`see C:\Program
  Files\x.txt for details`). The longest reading that exists wins, so the link ends at `x.txt` and
  `for details` stays text. If no longer reading exists, the unextended token is judged alone, exactly
  as before (FR-150).
- *(added 2026-09-18, third round)* **Two absolute paths separated by one space** (`C:\a.txt
  C:\b.txt`). A reading never extends into a word that itself begins an anchored path, so each is its
  own link (FR-150).
- *(added 2026-09-18, third round)* **Git for Windows not installed.** No mount table exists, so
  FR-151's step is skipped and a rooted path falls through to the project root and the drive forms
  alone, as before.
- *(added 2026-09-18, third round)* **A program's OSC 8 link whose target stops existing while it is
  on screen.** Its mark is removed by the same watcher invalidation as a detected path's (FR-070,
  FR-154).

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
  - **FR-003f**: `file://` URIs written as text;
  - **FR-003g** *(added 2026-09-18, FR-107)*: PowerShell's provider-qualified form —
    `FileSystem::<path>`, optionally preceded by `Microsoft.PowerShell.Core\` — where `<path>` is any
    form above. The candidate is `<path>` alone.
- **FR-004**: Detection MUST recognise the position suffixes `path:line`, `path:line:col` and
  `path(line,col)`, and MUST carry that position to the link. The position is not part of the path.
- **FR-005**: Detection MUST exclude trailing sentence punctuation — `)`, `]`, `,`, `.`, `:`, `;` — that
  is not part of an existing path, MUST exclude unbalanced enclosing brackets, and MUST treat a path in
  matching quotes as one path even when it contains spaces.
- **FR-006**: **Only real locations become links.** A candidate that does not resolve (FR-020–FR-026)
  to an existing file or folder MUST NOT be underlined, followed or offered in a menu.
- **FR-007**: A path that wraps across terminal rows MUST resolve as the whole path. Underlining every
  row it spans is governed by #326 and is not required here.
  *Superseded in part 2026-09-18 by FR-130 – FR-133: the first sentence stands; the second is
  withdrawn — every row is underlined and followable, for every link kind, and #326 closes with this
  spec.*
- **FR-008**: Detection MUST NOT change the terminal's or editor's rendered text, selection behaviour,
  copy, reflow or word wrap. This is 024 FR-019a's guarantee, extended to file links.
- **FR-009**: Web links MUST keep their existing detection and behaviour (024 FR-019 – FR-019d). A span
  that is a web link MUST NOT also be a file link.
  *Extended 2026-09-18 by FR-101 – FR-104 — the same detection and behaviour now apply in editors,
  and the "never both" rule applies there too. Nothing about what a web link does changes.*
- **FR-010**: Terminals and editors MUST apply **one** set of rules for detecting, resolving and
  judging a file link. Given the same text and the same base locations, both panel types MUST
  produce the same link and the same resolved target.

#### Explicit file hyperlinks (terminals)

- **FR-011**: A terminal hyperlink whose target is a `file:` URI MUST be a file link when its target
  resolves to an existing **file or folder**, and MUST be judged on its target alone. This
  **supersedes 024 FR-019 for `file:` targets** (see *Supersessions*).
- **FR-012**: A `file:` target MUST be percent-decoded. A target with a host (`file://server/share/…`)
  MUST resolve to the UNC location. A target with no host or `localhost` MUST resolve to a local path.
  *Extended 2026-09-18 (third round) by FR-153: "a local path" is read through the leading-`/` rules
  when the URI's path is not drive-qualified (`file:///c/x`, `file:///mnt/c/x`), and a `localhost`
  URI whose first segment is not a drive also tries `\\localhost\<segment>\…`. The first two
  sentences are unchanged.*
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
  *Extended 2026-09-18 (third round) by FR-151 and FR-152: Git Bash's mount table is tried between
  the project root and the platform's own meaning, and the platform's own meaning is drive-qualified
  before it is checked or acted on.*
- **FR-025**: The drive forms `/<letter>/…` and `/mnt/<letter>/…` MUST map to that drive
  (`/d/x` → `D:\x`). `~` MUST map to the user's home folder. On Windows, POSIX paths with no
  project-root match and no drive form are not otherwise mapped (no WSL filesystem access, see
  *Out of scope*).
  *Superseded in part 2026-09-18 (third round) by FR-151: the last sentence no longer holds for Git
  Bash's own mount points (`/usr`, `/etc`, `/tmp`, …), which name Windows folders. It still holds for
  a **WSL** flavour and for any Linux filesystem path — no WSL filesystem access, deferred to #13.*
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
  - **Open Link**, which runs the default link action (FR-050) and shows the Open Link chord
    (FR-045) **where one is bound in that panel type's scope**;
  - each offered link target, by name, in FR-030's order, each performing its target whatever the
    preference says;
  - **Copy Link Address**.

  With text selected, the ordinary menu MUST appear instead (024 FR-019d). Away from a link, the menu
  MUST be unchanged. In a terminal, these items take the place of 024 FR-019d's web-link items only
  over a file link. Over a web link, the menu is unchanged.

  **Amendment 2026-09-18 (clarification of FR-031 — no requirement changes meaning).** As first
  written, FR-031 said Open Link "shows the Open Link chord (FR-045)" without qualification, while
  FR-046 requires that chord **not** to be live in a terminal. Read literally the two contradicted
  each other, and an implementer resolving it the wrong way would draw `Ctrl+Enter` on a terminal's
  Open Link item — advertising a key that in fact reaches the shell. The words *where one is bound
  in that panel type's scope* are added above, and the authority is constitution **Principle VI**,
  which states the rule in as many words: *"A menu item MUST show its command's current chord where
  one is bound."* The derivation is [research.md](./research.md) **R10(b)**. The consequence: the
  chord is drawn on the **editor's** and the **preview's** Open Link items and is **not** drawn on
  the **terminal's**, because `COMMAND_SCOPES['preview.followLink'].has('terminal')` is false
  (FR-046, [contracts/menus-and-gestures.md](./contracts/menus-and-gestures.md) §4). This is a
  clarification, not a supersession: neither FR-031 nor FR-046 changes meaning, and no older
  requirement is replaced.
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
- **FR-035a** *(added 2026-09-18; extends FR-035, supersedes nothing)*: **Open in OS Explorer** for a
  file link MUST be carried by a **third** reveal policy of its own — the channel
  `throng:links:reveal` — and MUST NOT reuse either of the two that exist.

  This is an amendment because FR-030 and FR-035 together already require something neither shipped
  policy can deliver, and the spec did not say which one was meant to stretch. It settles that
  **neither is loosened**:

  | Policy | What confines it | Why it cannot serve FR-030 |
  |---|---|---|
  | `throng:files:reveal` | a **path prefix** — the request is root-relative and the path must lie under the project root (`packages/ui/src/main/files-service.ts`, `reveal`) | FR-030 offers Open in OS Explorer for **every** link, including one outside every project root |
  | `throng:files:revealDocument` | the **open-document registry** — it refuses any path no Panel is showing (`packages/ui/src/main/files-service.ts:518-528`, `if (!this.isDocumentOpen?.(absPath)) return { error: OUTSIDE }`) | a link names a file nothing has open; every such reveal would be refused |
  | `throng:links:reveal` *(new)* | **FR-037's re-resolution**: the renderer sends a `LinkResolutionRequest` and never a path, main re-derives the absolute location from `text`, `kind`, `baseDirectory` and `panelId`, and re-checks that it exists before acting | — |

  The confinement is therefore *the link resolved from text the user can actually see in a panel*,
  which is a bound of a different shape from a prefix or a registry rather than a weaker version of
  either. Both existing channels keep their own rules, their own tests and their own callers,
  unchanged. **After this feature the repository has three reveal policies, deliberately**, and any
  fourth surface must justify itself the same way. Derivation: [research.md](./research.md) **R8**;
  payloads: [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3.
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
  *Unchanged 2026-09-18 (third round); not yet met by the shipped app — defect **D4**: the only
  production construction of `ElectronShellIntegration` supplies no de-elevating launcher.*
- **FR-039**: When the resolved target is an **executable file** (FR-039a), Ctrl+click, the Open Link
  chord and the plain **Open Link** menu item MUST NOT run it, whatever the default link action is set
  to. All three MUST perform **Open in OS Explorer** for it instead, with the file selected in its
  folder. Running it MUST remain possible only through the explicit **Open in OS Default Program**
  menu item, which MUST still be offered for it (FR-030) and MUST still run it when chosen.
  *Superseded in part 2026-09-18 by FR-111 and FR-114. The guarantee — no gesture and no plain Open
  Link item runs it — now holds for **every** file, not only executables (FR-111). The instead-clause
  — "perform Open in OS Explorer" — now applies only outside the project; an in-project executable
  opens in throng as its text, like any in-project file (FR-114). The last sentence is unchanged.*
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
  *Extended 2026-09-18 by FR-135 – FR-139: a link is marked at rest as well as on hover, with one
  affordance for every link kind in both panel types. The tooltip delay rule is unchanged.*
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

  *Superseded 2026-09-18 by FR-110 and FR-112 — the setting is retired. The behaviour its shipped
  value **Open in throng** described survives as the in-project half of the click rule (FR-110);
  **Open in OS Default Program** is withdrawn (FR-111); **Open in Editor**, **Open in Preview** and
  **Open in OS Explorer** as whole-link preferences are withdrawn because the click rule decides every
  destination. Each target stays in the menu by name (FR-030, FR-054).*
- **FR-051**: **Open in throng** MUST open an in-project file:
  - as **Open in Preview** when that file's default open action is Preview, as **044 FR-050/FR-052**
    decide it (an enabled provider set to Preview, or an enabled binary provider under 044 FR-051);
  - as **Open in Editor** otherwise.

  For a folder or an out-of-project file, it MUST follow FR-053. This adds following a file link to
  the list of opens that **044 FR-052** routes through the default open action, and to 023 FR-026's
  "standard open paths".
  *Kept 2026-09-18 as the in-project half of the click rule (FR-110), with no setting in front of
  it. Its "For a folder or an out-of-project file, it MUST follow FR-053" is superseded by FR-110:
  both are shown in OS Explorer.*
- **FR-052**: Under Open in throng, a link that carries a position MUST open as **Open in Editor**
  whatever the file's default open action, for the reason **044 FR-054** gives: a preview cannot reveal
  a line and column.
- **FR-053**: When the chosen value is not offered for a link (FR-030), the action MUST fall back to
  the first offered target in this order: **Open in Preview → Open in Editor → Open in OS Default
  Program → Open in OS Explorer**. A disabled Open in Preview counts as not offered for this purpose.
  **FR-039 overrides this order for an executable file**: the fallback never reaches Open in OS
  Default Program for one, and lands on Open in OS Explorer.
  *Superseded 2026-09-18 by FR-110. With no setting there is no "chosen value" to fall back from, and
  the order's third step — Open in OS Default Program — is exactly what the maintainer withdrew. A
  link the click rule cannot open in throng is shown in OS Explorer.*
- **FR-054**: Open Link, Ctrl+click and the Open Link chord MUST all run the same default link action
  for the same link. The named link targets in the menu MUST ignore the setting (Principle VI, *A
  preference picks the default; the menu offers every variant*).
  *Kept 2026-09-18, reading "default link action" as the click rule (FR-110). Its second sentence
  now concerns the one preference left in the rule — 044's per-provider default open action — which
  the named targets ignore exactly as before.*
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
  *Superseded in part 2026-09-18 by FR-112 and FR-120: the default link action's descriptor is
  removed with the setting, and the existence-check timeout's descriptor is added. The two detection
  switches and the timeout sit together under Editor · Links; the hyperlink-advertising switch is
  unchanged.*
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
  *Amended 2026-09-18: "the default link action" becomes **the click rule** (FR-110) and the
  retirement of that setting; the docs also describe web links in editors (FR-101 – FR-103), network
  paths and the existence-check timeout (FR-120).*
- **FR-091** *(amended 2026-09-18 — the premise as first written is already stale)*: On delivery, the
  *Known gaps* paragraph in constitution Principle VI (*One gesture follows a link*) MUST be brought
  current through a PATCH amendment that corrects **two** statements, not one:

  1. **"no surface yet implements Ctrl+Enter"** — wrong **today**, before this feature changes
     anything. Spec **044** shipped `preview.followLink` bound to `['Ctrl+Enter']`
     (`packages/core/src/config/keybindings.ts:408`) and dispatched it in previews
     (`packages/ui/src/renderer/preview/preview-commands.tsx:162-167`). The paragraph records that
     it was "verified against the code on 2026-09-14"; it went stale when 044 landed on this branch.
  2. **"spec 044 … and #394 add the first Ctrl+Enter"** — 044 did not *add the first* alongside
     #394; it added it, and 045 adds the **second** surface, editors (FR-045).

  The SYNC IMPACT REPORT of that amendment MUST record **what it found in the code** — the two file
  references above, and the date on which the paragraph's own verification note went stale — rather
  than restating this requirement's premise. That instruction is the point of the amendment: the
  paragraph went stale precisely because a prior amendment copied a claim forward instead of
  re-checking it.

  **What this amendment to FR-091 changes**: FR-091's scope (one statement → two) and the evidence
  its SYNC IMPACT REPORT must carry. It does **not** change when the constitution amendment happens
  (still on delivery, still PATCH) and supersedes no other requirement. Derivation:
  [research.md](./research.md) **R16**.

#### One link model in both panel types *(added 2026-09-18 — change request)*

- **FR-100**: Every link kind a panel's medium can carry MUST be recognised, underlined on hover with
  a tooltip naming the gesture, followed on Ctrl+click (Cmd+click on macOS), and offered **Open Link**
  and **Copy Link Address** in the context menu — in editors and in terminals alike:

  | Link kind | Terminal | Editor |
  |---|---|---|
  | **Web link** — plain-text `http`/`https` | yes (024 FR-019a) | **yes — new** (FR-101) |
  | **Web link** — OSC 8 hyperlink, `http`/`https` target | yes (024 FR-019) | not applicable — a document has no OSC 8 |
  | **Detected path** — every FR-003 form, with FR-004 positions | yes (FR-001) | yes (FR-002) |
  | **`file://` URI written as text** (FR-003f) | yes | yes |
  | **Explicit file hyperlink** — OSC 8, `file:` target | yes (FR-011) | not applicable — a document has no OSC 8 |

  "Not applicable" is the medium, not a gap: OSC 8 is a terminal escape sequence and an editor's text
  has no way to carry one. The only differences between the two panel types that this feature
  permits are that one, **Ctrl+Enter** (live in editors, never in terminals — FR-044, FR-046,
  unchanged), and the hover delay setting, which is a terminal setting (FR-042).
- **FR-101**: An editor MUST detect plain-text web links within its visible range (FR-073), as a
  terminal does. Web-link detection in an editor MUST NOT be governed by the editor file-link
  detection switch, exactly as a terminal's is not governed by the terminal one (FR-060).
- **FR-102**: Terminals and editors MUST recognise web links with **one** grammar, held in
  `@throng/core` and used by the terminal's plain-text URL detector, by FR-009's "never both" claim in
  both panel types, and by the editor. The grammar is the terminal's current one, including the
  balanced-parenthesis widening this branch made for #198, unchanged — this requirement relocates it,
  it does not alter it.
- **FR-103**: In an editor, a web link MUST behave exactly as it does in a terminal: Ctrl+click opens
  it in the default system browser through the OS open-external seam, `http`/`https` only (024 FR-019,
  FR-019b unchanged); a plain click keeps its editor meaning; a Ctrl+click that drags selects; a
  Ctrl+click not on a link keeps adding a cursor (FR-041). With a single caret inside it and no
  selection, the Open Link chord opens it (FR-044, FR-045). Over it, with no text selected, the editor
  context menu MUST lead with a Contextual section holding **Open Link** (with its chord, FR-031) and
  **Copy Link Address**, which copies the address exactly as written; with text selected the ordinary
  menu appears. This supersedes 024 US7's "terminal-only" edge case for web links (**S4**).
- **FR-104**: **Parity MUST be structural, not promised.** Both panel types MUST derive a line's link
  spans from **one** per-line scan in `@throng/core` that returns its web links and its path
  candidates together, and MUST resolve, act, compose menus and word tooltips through the same shared
  functions. A single fixture of lines — every link kind, every path form, every position form —
  MUST be run through both panel types' span producers and MUST yield identical spans, kinds,
  resolved targets and click outcomes. This extends FR-010 from file links to every link kind, and it
  binds terminals as much as editors: a later change to either side that makes it disagree turns the
  fixture red.
- **FR-105**: The hover tooltip MUST name the gesture **and** where it goes, from one function shared
  by both panel types: a web link says it opens in the system browser (024's wording, unchanged); a
  file link whose click opens it in throng says it opens; a link whose click shows it in OS Explorer
  says so. This refines the 2026-09-18 *Assumptions* amendment, whose file wording stopped at
  "to open" because the setting made the destination unknowable — with the setting retired
  (FR-112) the click rule makes it knowable, and a tooltip that says where a click goes is a
  tooltip a user can trust.
- **FR-106**: **"Regardless of how the path is formatted."** FR-021 already requires that the verdict
  "in the project" never depends on how the link was written, and it stands. It is strengthened:
  every spelling of one in-project location this feature recognises — relative, leading-`/`,
  Windows drive with either separator, Git Bash `/c/…`, WSL `/mnt/c/…`, `~/…` when the project is
  under the home folder, UNC with either separator when the project is on a share, `file:` URI text,
  and PowerShell's provider-qualified form (FR-003g) — MUST open that file in throng from both panel
  types, and one fixture MUST prove it. A **different name** for the same place — a mapped drive
  letter for a share, `\\localhost\C$\…` for `C:\…`, an 8.3 short name — is not a format: it is
  judged as named, as the symlink edge case already requires, so such a spelling of an in-project
  file is outside the project by name and is shown in OS Explorer rather than opened in throng on a
  guess (Principle I).
- **FR-107**: Detection MUST recognise PowerShell's provider-qualified spelling (FR-003g) wherever it
  appears, including inside a prompt (`PS Microsoft.PowerShell.Core\FileSystem::\\server\share\dir>`).
  Only the qualifier `FileSystem::`, with or without `Microsoft.PowerShell.Core\` before it, is
  recognised; any other `Name::` token (`std::vector`, `Foo::Bar`) MUST stay a non-candidate, and
  SC-003's prose fixture MUST still yield zero spans.

#### The click rule *(added 2026-09-18 — change request; supersedes FR-050, FR-053, parts of FR-039, FR-051, FR-061)*

- **FR-110**: Ctrl+click, the Open Link chord (editors) and the plain **Open Link** menu item MUST do
  exactly this, in every panel type, consulting no link-specific preference:

  | The link resolves to | What happens |
  |---|---|
  | a **web link** | the default system browser, through the open-external seam (024 FR-019, unchanged) |
  | a **file in the project** | it opens **in throng**: as **Open in Preview** when that file's default open action is Preview (044 FR-050 – FR-052) and the link carries no position; as **Open in Editor** otherwise, at the position when there is one (FR-051, FR-052, FR-033) |
  | a **file outside the project** | **Open in OS Explorer**, with the file selected in its folder |
  | a **folder**, in the project or not | **Open in OS Explorer**, with the folder open |
  | nothing that exists | nothing — it is not a link (FR-006) |

  This is FR-054's "same action for the same link", with the action now fixed.
- **FR-111**: **A Ctrl+click never executes a file and never opens it in its default program.** No
  gesture and no plain Open Link item MAY hand any file to the OS to open or run, whatever its type,
  in the project or not. **Open in OS Default Program**, chosen by name from the link menu, MUST
  remain offered for every file (FR-030) and MUST remain the only route that does (FR-036, FR-038
  unchanged). The shared decision MUST make this a property of its type — the click rule's result type
  cannot express the default program — rather than a clause a later change could skip.
- **FR-112**: The **default link action** setting (`editor.links.defaultAction`, FR-050) MUST be
  **retired**: its settings leaf, its five values, its shipped value `throng` and its descriptor are
  removed, and nothing reads it. The Preferences editor MUST no longer show it. The behaviour its
  shipped value described is not lost — it is the in-project half of FR-110.
- **FR-113**: A persisted `editor.links.defaultAction` MUST be **dropped, not migrated** — ignored on
  load and stripped on the next settings write, with no warning — following **019 FR-023**'s
  precedent for a retired key. On 019 C1's own test: the setting never reached a release (it exists
  only on this unmerged branch, PR #408), so the only files carrying it were written by pre-release
  builds; `throng`, the shipped value, becomes exactly the click rule; every other value named a
  behaviour the maintainer has withdrawn, so migrating it to a "nearest" value would invent an
  intent the user never expressed. Loading and re-writing a file that has already been stripped MUST
  change nothing (an idempotent re-run).
- **FR-114**: An **executable file in the project** MUST follow FR-110 like any other in-project file:
  it opens in throng as its text. FR-039's "perform Open in OS Explorer instead" applies only outside
  the project, where FR-110 already sends every file. FR-039a's classification stays in force — its
  contract suite, and SC-010, which is driven from its reported set — but the click rule does not
  branch on it.

#### Network locations *(added 2026-09-18 — change request)*

**D1 — defect, not a new requirement: network paths cannot be followed.** The maintainer reports that
no network path is clickable. Network paths are already required by **FR-003c** (UNC forms),
**FR-012** (`file://server/share/…` → UNC), **FR-022** / **FR-023** / **FR-024** (relative and
leading-`/` paths against the editor's folder, the terminal's working directory and the project
root, whichever of them is on a share), **US1 scenario 4**, **US2 scenario 4** and **SC-001**. A
reproduction exists as an untracked unit test in this worktree,
`packages/core/tests/unit/link-resolve-unc.test.ts`, written by another session; its header records
a stage-by-stage trace against real shares. From it, and from reading the code, **not yet from a
run**:

- **An absolute UNC path survives every stage** — detection, `resolveCandidate`, `stat`, membership
  and `FileLinkResolver` — per the trace.
- **A UNC base loses its root.** `join` in `packages/core/src/links/resolve.ts` splits the base on
  separators and keeps only the **first** empty leading segment, so `\\fileserver\home\dir` joined with
  `notes.txt` becomes `\fileserver\home\dir\notes.txt` — one leading separator, a folder named `fileserver` at
  the root of the current drive, which never exists. Every relative path printed in a terminal whose
  working directory is a share, every relative path in an editor on a file on a share, and every
  path in a project rooted on a share is therefore dead. In PowerShell sitting in a network folder,
  `dir` prints relative names, so nearly every path on screen is one of these.
- **PowerShell prints a network location provider-qualified** (`FileSystem::\\fileserver\home`), a form the
  grammar refuses because of its `::`. FR-003g/FR-107 add it.

This is recorded as a hypothesis until T135 runs the reproduction and the maintainer confirms it
matches what they saw (the replicating-bugs gate). The fix changes no requirement.

- **FR-120**: Every existence check MUST end within a bounded time — the **existence-check timeout**,
  a setting (`editor.links.existenceCheckTimeoutMs`, shipped **2,000 ms**, bounded 250 – 25,000 ms
  under 031's bounds guard, with a descriptor under Editor · Links, FR-061). A check that has not
  answered by then MUST answer **unreachable**, which is not a link (FR-071 unchanged) and is
  distinct from "does not exist". The timeout is a setting because network latency is a property of
  the machine and its network, which Principle X requires to be overridable without code changes.
  *Clarified 2026-09-18: the maximum was 30,000 ms as first written and is 25,000 so the 250 ms step
  meets 018 FR-035's 1%-of-range rule (`207a98b4`).*
- **FR-121**: An unreachable location MUST NOT be able to multiply its cost. While one check under a
  **volume root** is still outstanding past the timeout, every further check under that root MUST
  answer unreachable **at once, without touching the filesystem**; and the number of checks
  outstanding past the timeout across the whole process MUST be capped, so that filesystem work that
  has nothing to do with links — saving, reading, watching — is never starved by an offline share.
  A check under any other volume root MUST be unaffected.
  *Clarified 2026-09-18 (`c2d5c858`): when the cap is reached, only a check under another **network**
  root answers unreachable at once; a local drive root is never gated by the cap.*
- **FR-122**: A volume root that timed out MUST be left alone for a back-off period (the link cache's
  TTL, FR-070), after which the next hover MUST try again, so a share that comes back online becomes
  linkable without a restart.
- **FR-123**: An answer that arrives after a surface has stopped waiting for it MUST take effect
  **without the user having to move the pointer off the line and back** — a slow share's path
  becomes a link on the hover that asked. FR-071's "treated as not a link **until it answers**" is
  read as binding in both directions. In a terminal this is the case xterm's per-line reply cache
  defeats today: `file-link-provider.ts` holds its reply for `LINK_ANSWER_DEADLINE_MS` and a later
  answer is filed nowhere.
- **FR-124**: Following a link whose location stops answering (FR-037's re-check) MUST end within
  the timeout and raise **one** notice naming the path and saying the location **did not answer** —
  a reason distinct from "no longer exists", because the remedy differs (reconnect, not re-create).
  One condition, one notice (CLAUDE.md), through the shared failure presentation (030).

#### A link's position *(added 2026-09-18, second round)*

**D2 — defect, not a new requirement: a position suffix is not honoured.** Ctrl+clicking `test.md:3:5`
opened `test.md` but not at line 3, column 5. Already required by **FR-004** (the position is carried
to the link), **FR-033** (Open in Editor places the cursor at the link's position), **FR-052** (under
the in-throng action, a link with a position opens an **editor**, whatever the default open action),
**FR-110** (the click rule, which restates FR-052), **US1 scenario 1**, **US5 scenario 3**
(`README.md:12` → an editor at line 12) and **SC-001**. **Hypotheses, none confirmed:** `.md` is a
preview-provider format, so the likeliest fault is where FR-052 meets 044's default open action —
the position being dropped on the way to the editor route, or the editor route being taken without
its reveal target; next, a reveal that is ignored when the file is **already open** in a tab; next,
the position lost between the surface's candidate and the follow (terminal `hoveredLink`, editor
decoration). T174 reproduces it first, with the maintainer's own corpus line.

*Located by reading, 2026-09-18 (third round) — still a hypothesis until T174 is red.* The probe shows
D2 in **terminals only**: in an editor, `test.md:3` and `test.md:3:5` open at 3:1 and 3:5, and a
Markdown file at that. The terminal's `openInEditor` performer drops the position outright —
`packages/ui/src/renderer/terminal/terminal-panel.tsx:271-274` calls
`openFileInTab(ws, tabId, link.path, openTarget)` with no position, under a comment saying the
position "is carried this far and placed by US3's `positionRevealTarget`; until then a positioned
link opens its file at the top". US3 landed; this site was never updated. The probe also shows the
second hypothesis in play: with `test.md` already open in a tab, the follow produced no observable
change at all, so the already-open route must place the caret too.

#### Wrapped links *(added 2026-09-18, second round — supersedes FR-007's second sentence)*

- **FR-130**: A link that the **terminal** wrapped across rows — the rows xterm marks as wrapped
  continuations of one logical line — MUST be one link, for **every** link kind: plain-text web
  link, detected path, and OSC 8 hyperlink with any target. It MUST be detected on the whole logical
  line, and marked (FR-136) on **every** row it occupies, at rest and on hover.
- **FR-131**: A hover or a Ctrl+click on **any** row of a wrapped link MUST act on the whole link:
  the hover state covers all its rows, the tooltip names its whole target, one Ctrl+click follows it
  once (FR-043), and the context menu opened on any of its rows offers its items.
- **FR-132**: Two **separate** lines are never joined into one link on a guess. A program that
  breaks text with its own line break has printed two lines. The one exception is an OSC 8
  hyperlink: rows carrying the same declared target are the same link, because the program declared
  it.
- **FR-133**: FR-130 – FR-132 MUST NOT change what a wrapped row renders, how it selects or copies,
  or how it reflows (FR-008), and MUST keep FR-071/FR-072: joining a logical line happens when a row
  is asked about, never on the output path.

This brings **#326** in scope and **closes it**: #326's intended outcome — "a wrapped link is
underlined along its whole length, on every row it occupies" — is FR-130, and FR-131 adds the
clickability the maintainer found missing. #326 was filed against terminal hyperlinks; FR-130 covers
those and every other link kind.

#### One affordance for every link *(added 2026-09-18, second round)*

- **FR-135**: Every link — web, detected path, `file:` text, OSC 8 of either kind — in terminals and
  in editors MUST present **one** affordance, the same in every panel type and every terminal
  flavour, so a user can tell at a glance what is clickable:

  | State | Affordance |
  |---|---|
  | **At rest** | a **dashed** underline in the link colour; the text's own colour is **unchanged** |
  | **Hovered** | the underline turns **solid** along the whole link (every row, FR-131); the tooltip (FR-105) appears after the hover delay |
  | **Hovered with the modifier held** | the pointer becomes a hand, because that is when a click follows (FR-040) |

  The text colour is left alone so a link never alters rendered output (FR-008) and never fights an
  editor's syntax colours. This supersedes the editor's shipped styling, which recolours link text
  with the accent colour, and xterm's own OSC 8 underline, where it differs.
- **FR-136**: A link MUST be marked **at rest**, not only on hover. A hover-only mark means a user has
  to sweep the pointer over the screen to discover what is clickable, which is what the maintainer
  reported as "not clear". The editor already marks resolved links in its visible range at rest
  (FR-073); web links and OSC 8 links need no existence check and are marked as they are drawn.
  *Superseded in part 2026-09-18 (third round) by FR-154: "OSC 8 links need no existence check" holds
  for an `http`/`https` target only. An OSC 8 `file:` target is marked only once it has resolved, as
  a detected path is (FR-137), and an OSC 8 target of any other scheme is never marked.*
- **FR-137**: **A detected path is marked at rest only once it has resolved** (FR-006), and the rules
  that forbid an existence check on the output path stand unchanged (FR-071, FR-072). They are squared
  this way: in a terminal, the rows **in view** are resolved by an **idle scan** that starts only
  after the terminal's output has been quiet for a short interval, is cancelled by the next output,
  is bounded by the per-line candidate cap (FR-071) and by the visible rows, and reads and fills the
  same cache hover does (FR-070). While output streams, nothing is checked and unresolved paths are
  simply unmarked — the pre-amendment state — and a hover still resolves one on demand. FR-072's test
  keeps asserting zero checks during delivery, and gains the assertion that the idle scan waits for
  quiet and yields to output. FR-070's "on hover, or for the visible range" already permits this.
- **FR-138**: The link colour MUST come from theme tokens, never a literal: `linkUnderline` (at rest
  and on hover) and `linkUnderlineHover` (the solid hover underline), each inheriting from its
  parent when unset (`linkUnderline` → `accent`; `linkUnderlineHover` → `linkUnderline`), each with a
  descriptor in the **General** area — shared by both panel types, which is what "General" is for —
  and editable in the theme editor (configuration-editor completeness; 021 FR-009/FR-010). A theme
  change repaints every link without a restart.
- **FR-139**: The affordance MUST NOT depend on the link kind's mechanism: whether xterm's linkifier,
  xterm's OSC 8 renderer, a decoration or a CodeMirror mark draws it, what the user sees is FR-135's.
  Where a mechanism cannot be styled to match, it is replaced rather than left different.

#### Every terminal flavour *(added 2026-09-18, second round)*

Already governing flavours: **028 FR-007** ("terminal behaviour required here MUST hold for every
shell flavour the application supports"), **025 FR-013/FR-014b** (every built-in flavour, proven by
launching real shells), **025 FR-032a – FR-032f** (shell integration reports a directory for shells
whose directory cannot be observed; one setting, on by default; the reported value comparable with
the project root), and **005 FR-024** (detection of the built-in shells). The built-in flavours are
`cmd`, `windows-powershell`, `pwsh` and `git-bash` (`windows-shell-detection.ts`); **WSL is not a
built-in flavour** — it runs as a user-defined flavour (025 FR-011).

- **FR-140**: Every behaviour in this spec — detection, resolution, the click rule, the menu, the
  affordance, wrapped links, the network rules, FR-043's one-click-one-open — MUST hold identically
  in every built-in flavour, and in a WSL flavour where one is configured, extending 028 FR-007 to
  links.
- **FR-141**: An OSC 8 hyperlink a program prints MUST reach throng as a hyperlink in every built-in
  flavour, through ConPTY. Where evidence shows a flavour's path strips the sequence, that is recorded
  per flavour, and its visible text MUST still become a link through detection (US7 scenario 6's
  fallback) — never silently nothing.
- **FR-142**: A relative path in a terminal MUST resolve against **the directory that flavour is
  actually in** (FR-023): for `cmd`, the observed process directory (025's live poll — `cmd`'s `cd`
  moves it); for `windows-powershell`, `pwsh` and `git-bash`, the directory reported through 025's
  shell integration (OSC 9;9, `cwd-store.ts`). No built-in flavour needs **new** shell integration.
- **FR-143**: For a flavour that **cannot report** its directory as configured — any of the three
  above with `terminals.shellIntegration` off (025's `flavourReportsDirectory`) — a relative path MUST
  resolve against the **project root alone**. The observed process directory of such a shell is its
  **launch** directory, which does not follow `cd`, and using it would resolve paths against a
  folder the user left; it MUST NOT be offered as the base directory.
- **FR-144**: A **WSL** flavour reports no directory (no integration exists for it, and its Linux
  `cd` is invisible to Windows), so FR-143 applies: relative paths resolve against the project root.
  Its `/mnt/<drive>/…` paths map as FR-025 says; other Linux paths are not mapped (FR-025, R9).
  Giving WSL a reported directory would be new shell integration and is **out of scope** — recorded
  for a tracked follow-up, not delivered here.
  **This is not what the code does today.** 025's `flavourReportsDirectory`
  (`core/src/terminal/command-recipe.ts`) treats any flavour absent from the integration maps as
  *observable*, so a user-defined WSL flavour is assumed to report — and the value observed is
  `wsl.exe`'s Windows-side launch directory, which never follows a Linux `cd`. For **link
  resolution**, a WSL flavour MUST be treated as reporting nothing; recognising a flavour as WSL is an
  OS fact and belongs behind the platform abstraction (the shell detection that already tells WSL's
  `System32\bash.exe` from Git Bash). Whether 025's *Reopen in the last directory* control should
  change for WSL too is **not** decided here — 045 changes only the link base, and the question is
  reported to the maintainer.
  *Deviation 2026-09-18 (`29b06f66`): recognising WSL is `isWslExecutable` in `@throng/core`, not a
  platform port — see Clarifications, Session 2026-09-18 (maintainer confirmation), and plan
  Complexity Tracking, third round.*
- **FR-145**: Evidence for FR-140 – FR-144 MUST be a **matrix** — every built-in flavour installed,
  plus WSL where configured, against these cells — so a run can be checked cell by cell:

  | Cell | Pass when |
  |---|---|
  | OSC 8 `http` / `file:` | arrives as a hyperlink; Ctrl+click follows once |
  | plain-text URL | detected; Ctrl+click opens once |
  | absolute path, each FR-003 form | resolves; the click rule applies |
  | relative path after `cd sub` | resolves against `sub` (FR-142) or the project root (FR-143, FR-144), as that flavour's row says |
  | position suffix | opens an editor at the position (D2) |
  | wrapped link of each kind | marked on every row; followable from any row (FR-130, FR-131) |
  | affordance | identical at rest and on hover to every other flavour (FR-135) |

  A flavour not installed on the machine is reported as **not run**, never as passed.
  *Note 2026-09-18 (third round): a WSL distro that is installed but not configured as a flavour is
  likewise **not run** — WSL is not a built-in flavour (005 FR-024; epic #13), and configuring one as
  a user-defined flavour (025 FR-011) is how its row is run (T220).*

#### The maintainer's corpus, run by a probe *(added 2026-09-18, third round)*

The probe's matrix, row by row against the requirement and task that govern it, is in
[tasks.md](./tasks.md) Phase 15 and [research.md](./research.md) O11. Most failures are already
required and already tasked — the click rule (FR-110/FR-111, T155 – T158), D2 (T174/T175), wrapped
links (FR-130 – FR-133, T176 – T187), web links in editors (FR-101 – FR-103, T161 – T168). What
follows is what nothing covered.

- **FR-150**: **A path may contain spaces without quotes.** A candidate that begins with an
  **anchored** form — a drive path with either separator, a UNC path with either separator, a leading
  `/` (every FR-003d form), `~/`, `./` or `../`, a `file:` URI, or FR-003g's provider-qualified form —
  MUST also yield longer readings that extend it across single spaces, one whitespace-separated word at
  a time, up to a fixed cap on the number of words added (an integrity guard beside the per-line
  candidate cap, FR-071). The readings MUST be tried **longest first**, each with FR-004's position
  readings and FR-005's trailing-punctuation rule applied to its own end, and the first that resolves
  to an existing location (FR-006) is the link; if none does, the unextended token is judged exactly as
  before. A reading MUST NOT extend into a word that itself begins an anchored form, into a web link's
  span (FR-009), past an unbalanced bracket or a quote, or across a line break a program printed
  (FR-132); across a soft wrap it extends like any other text on the logical line (FR-130). A bare
  word MUST NOT start an extended reading, so FR-005's quoted form remains the only way a relative
  path without `./` carries a space, and SC-003's prose fixture MUST still yield zero spans. The
  readings are candidates like any other: they cost existence checks only on hover or in the idle scan
  (FR-070, FR-071, FR-137), never on the output or typing path.
- **FR-151**: **A rooted POSIX path means what Git Bash means by it.** Where Git for Windows is
  installed, a leading-`/` path that is not a drive form and does not exist under the project root
  MUST next be mapped through **Git Bash's own mount table** — its install root for `/`, and the mount
  points Git declares (for example `/usr/bin` and `/bin`, `/etc`, and `/tmp` as the user's temp folder)
  — and that location tried before the platform's own meaning (FR-024). This holds in every built-in
  flavour and in an editor, because the text is the same whichever shell printed it and FR-104
  requires one answer. It MUST NOT apply in a **WSL** flavour, where a Linux path names the distro's
  filesystem: there a leading-`/` path tries the project root and FR-025's `/mnt/<drive>` form only.
  Locating Git's install and reading its mount table MUST sit behind the platform abstraction
  (FR-026, Principle II), on the shell detection that already finds Git Bash (005 FR-024), and MUST be
  covered by a contract test. Mapping a WSL distro's Linux paths (`\\wsl.localhost\<distro>\…`) stays
  out of scope and is deferred to #13 (plan *Complexity Tracking*, third round).
- **FR-152**: **A resolved location is drive-qualified.** When a rooted path with no drive reaches the
  platform's own meaning (FR-024's second step), the location checked and acted on MUST be qualified
  with the drive of the panel's base directory (FR-022, FR-023), or failing that the project root's,
  and MUST NOT depend on the directory throng's own process happens to be in. No action is ever handed
  the text as written (FR-020 — every file link resolves to one **absolute** location). A panel with
  neither a base directory nor a project root does not reach this step.
- **FR-153**: **The path inside a `file:` URI is read however it is spelled.** After FR-012's
  percent-decoding, a URI with no host or with host `localhost` whose path is **not** drive-qualified
  (`file:///c/Windows/win.ini`, `file:///mnt/c/Windows/win.ini`, `file:///usr/bin/bash.exe`) MUST be
  resolved as the same path written bare would be (FR-024, FR-025, FR-151, FR-152). A `localhost` URI
  whose first path segment is not a drive (`file://localhost/C$/Windows/win.ini`) MUST additionally try
  the loopback network location `\\localhost\<segment>\…`, after the local readings. This applies to a
  `file:` URI written as text (FR-003f) and to an OSC 8 target (FR-011) alike, and a `file:` URI MUST
  still never reach the OS URL opener (FR-037).
- **FR-154**: **A hyperlink that goes nowhere looks like text.** An OSC 8 hyperlink whose target is
  not followable — a scheme other than `http`, `https` or `file:`, a `file:` target that does not
  resolve or that answers unreachable (FR-120), or an empty target — MUST present **no** link
  affordance: no underline at rest or on hover (including xterm's own OSC 8 underline, FR-139), no
  hand pointer, no tooltip, and no link menu items (FR-013). A Ctrl+click on it MUST reach a program
  that reports mouse events, as FR-043 requires for anything throng has not resolved, and throng MUST
  NOT raise a notice for it: nothing was attempted, so there is no condition to report, and a notice
  per hover or click of a program's dead link would be one condition raising many notices. An OSC 8
  `file:` target MUST be marked only once it has resolved, through the same hover and idle-scan route
  and the same cache as a detected path (FR-070, FR-137); an `http`/`https` target is marked as it is
  drawn, as before. A `file:` target that later resolves (created, or its share back online) becomes
  marked without the user moving the pointer (FR-123).

**D3 — defect, not a new requirement: an editor Ctrl+click on a link's first character sometimes
misses it.** Required by **FR-040**, **FR-100** and **FR-110**. In the probe's editor pass, 2 of 27
Ctrl+clicks on the **first character** of a decorated link placed a caret instead of following it —
`/c/Windows/win.ini` and the long `…\en\Microsoft.PowerShell.DSC.FileDownloadManager.Resources.dll`
path, both at column 1 — while hover reported a link under the pointer with a hand cursor, and a
Ctrl+click in the middle of the same link followed it. **Hypotheses, none confirmed:** the gesture
handler and the decoration disagreeing about a span's start boundary; a Ctrl+click racing a
redecoration that the previous row's action triggered; the `mousedown` handler reading a span set
older than the one the decoration drew. 25 other first-character clicks at column 1 followed, which
weakens the first. T215 reproduces it before anything is changed.

**D4 — defect, not a new requirement: FR-038's de-elevation is not wired.** `ElectronShellIntegration`
de-elevates only when a launcher is supplied (`deElevate` returns `false` when
`this.deElevation.launcher === undefined`, `packages/ui/src/main/electron-shell-integration.ts:128-137`),
and the only production construction, `packages/ui/src/main/main.ts:934`,
`new ElectronShellIntegration(shell)`, supplies none; nothing under `packages/ui/src` constructs a
`WindowsDeElevatedLauncher`. `link-de-elevated-open.integration.test.ts` passes because it injects its
own launcher, so every test is green while the shipped app never de-elevates. **What a human meets:**
throng started with *Run as administrator*; a link's **Open in OS Default Program** starts that
program with administrator rights — exactly what FR-038 forbids. T217 reproduces it first.

### Supersessions

Each of these replaces an older statement for the cases named, and nothing wider. The older text stays
where it is.

| # | Superseded | What changes | What stays | Why |
|---|---|---|---|---|
| S1 | **024 FR-019**, "other or unknown schemes (`file:`, …) MUST NOT be opened at all"; **024 FR-019d**, Open Link "`http`/`https` only"; and 024's US7 edge case, "a non-`http(s)` scheme (`file:`, …) must not be handed to the OS opener" | A `file:` hyperlink target that resolves to an existing file or folder is a file link (FR-011), and the terminal link menu offers the file-link items for it (FR-031) | `http`/`https` open in the default browser. `javascript:`, `data:`, `mailto:` and unknown schemes stay unopenable (FR-013). No in-app browser. 024 FR-019b is unchanged. A `file:` URI still never reaches the OS URL opener (FR-037) | 024 refused `file:` because the only route out was the OS URL opener, which would launch whatever the URI named. File links now take a path-based route that checks existence and project membership and never uses that opener, which removes the risk 024 guarded against |
| S2 | 024's US7 edge case, "The link-aware items must not appear in an editor's or the file tree's menu — this is terminal-only" | An editor's content menu carries the link items over a file link (FR-031). The file tree is unchanged | Terminals keep their items. 044 FR-095 already extended them to previews | Principle VI (v5.5.0) requires Open Link and Copy Link Address on every surface that has links, and editors now have links |
| S3 | **044 FR-096c**, the Open Link command "scoped to the preview panel" | The same command, with the same default chord, is also live in editor panels (FR-045) | It is still not live in terminals (FR-046). Its chord and its preview behaviour are unchanged | Principle IV requires one command to use one chord across panel types, and two commands sharing Ctrl+Enter could be rebound apart |
| S4 *(2026-09-18)* | **024 US7 edge case (menu)**, "The link-aware items must not appear in an editor's or the file tree's menu — this is terminal-only" — the part S2 left standing, for **web** links | An editor's content menu carries Open Link and Copy Link Address over a **web** link too, and an editor recognises and follows web links exactly as a terminal does (FR-101 – FR-103) | The file tree is still unchanged. Terminals keep 024 FR-019 – FR-019d exactly: the same schemes, the same seam, the same menu pair, the same Ctrl+click — and now share their grammar with editors rather than owning it (FR-102). 024 FR-019b is unchanged | The maintainer asked for every link kind in every editor and terminal, identically. S2 already moved the file-link half; this moves the web-link half for the same Principle VI reason |

**024 is not edited in place.** The repository has two conventions for a superseded requirement — a
pointer written into the older spec (004 FR-028 → 019 FR-032) and a record kept only in the newer
spec (021 FR-042 over 007 FR-013/FR-014, the worked example CLAUDE.md names). This spec chose the
second for S1 – S3, so S4 follows it: 024's text stands as it was, and this table is where a reader
of 024 US7 finds what changed. The terminal half of the maintainer's "amend 024" is therefore FR-100,
FR-102 and FR-104 here — parity rules that bind terminals as much as editors — and nothing in 024's
own requirements changes for terminals.

**Superseded within this spec on 2026-09-18** (each marked where it stands; text kept):

| Superseded | By | What changes |
|---|---|---|
| FR-050 (the default link action setting and its five values) | FR-110, FR-112 | Retired; the click rule is fixed |
| FR-051's "for a folder or an out-of-project file, follow FR-053" | FR-110 | Shown in OS Explorer. FR-051's in-project half stands |
| FR-053 (the fallback order) | FR-110 | No order: the click rule decides every destination and never reaches the default program |
| FR-039's "perform Open in OS Explorer instead", for an in-project executable | FR-114 | It opens in throng as its text. The never-run guarantee now covers every file (FR-111) |
| FR-061's default-link-action descriptor | FR-112, FR-120 | Removed; the existence-check timeout's descriptor is added |
| FR-090's "the default link action" | FR-110 | The docs describe the click rule and the setting's retirement |
| US5 scenarios 4, 5 (its fallback clause), 6 and 8 | US8, FR-110 – FR-113 | See the note under US5 |
| *Terminology*: "default link action", "web link" | FR-110, FR-100 | See those rows |
| *Assumptions*, the tooltip's file wording stopping at "to open" | FR-105 | The tooltip now says where a click goes |
| SC-008's "the default link action" half | FR-112 | SC-008 now covers the detection switches and the timeout |
| FR-007's second sentence, the wrap edge case, and *Out of scope*'s "Underlining every row of a wrapped link (#326)" *(second round)* | FR-130 – FR-133 | Every row is marked and followable, for every link kind; #326 closes with this spec |
| FR-042's hover-only underline *(second round)* | FR-135 – FR-137 | Links are marked at rest too, with one affordance for every kind |
| *Contract* P2, "the **only** caller of the existence check is `provideLinks` or the visible-range `ViewPlugin`" *(second round)* | FR-137 | A third caller: the terminal's idle scan of the rows in view, which runs only when output is quiet |
| FR-025's last sentence, "POSIX paths with no project-root match and no drive form are not otherwise mapped" *(third round)* | FR-151 | Git Bash's mount points map to Windows folders; WSL and Linux filesystem paths are still not mapped (#13) |
| FR-024's "then as the platform's own meaning of that path" *(third round)* | FR-151, FR-152 | Git's mount table comes first; the platform's meaning is drive-qualified before it is checked or acted on |
| FR-012's "A target with no host or `localhost` MUST resolve to a local path" *(third round)* | FR-153 | A non-drive-qualified local path goes through the leading-`/` rules; `localhost` also tries the loopback share |
| FR-136's "OSC 8 links need no existence check and are marked as they are drawn" *(third round)* | FR-154 | True for `http`/`https` targets only; a `file:` target is marked once resolved; any other target is never marked |

**Tests the 2026-09-18 supersessions permit to change**, and no others:

- `packages/core/tests/unit/link-default-action.test.ts` — rewritten for FR-110 (no `setting`
  argument; no case can yield the default program).
- `packages/core/tests/unit/app-settings.links.test.ts` and
  `packages/core/tests/unit/settings-metadata-links.test.ts` — the `defaultAction` leaf and
  descriptor go; the timeout leaf and descriptor arrive.
- `packages/ui/tests/component/link-default-action-wiring.test.ts`,
  `packages/ui/tests/component/link-setting-live.test.ts`,
  `packages/ui/tests/component/link-executable-refusal.test.ts` and
  `packages/ui/tests/component/link-out-of-project.test.ts` — their assertions about the setting's
  values and the FR-053 fallback. Every assertion that a gesture never **runs** an executable stays,
  and is widened to every file (SC-013).
- `packages/ui/tests/unit/terminal-hovered-link.test.ts` — the file-link tooltip wording (FR-105);
  the web wording must not change.
- *(second round)* `packages/ui/tests/component/link-decorations.test.ts` — assertions about the
  editor mark's **colour** (FR-135 leaves text colour alone); `packages/ui/tests/unit/terminal-file-link-provider.test.ts`
  — single-row range assertions, which FR-130 widens to multi-row ranges. Its FR-072 zero-check
  assertions MUST stay and are extended (FR-137).
- `packages/ui/tests/unit/terminal-url.test.ts` MUST NOT change: it is the proof that relocating the
  grammar (FR-102) altered nothing. `packages/ui/tests/unit/external-url.test.ts` MUST NOT change
  (FR-037).
- *(third round)* `packages/core/tests/unit/link-resolve.test.ts` — the **R9** case asserting
  `/etc/hosts` resolves to `['C:\\throng\\etc\\hosts', '/etc/hosts']` (FR-151 inserts the mount-table
  reading and FR-152 drive-qualifies the last one; its "no WSL mapping" assertion MUST stay); the
  **R6** case's `toHaveLength(2)` (the list may now hold the mount-table reading); and the **R11** case
  asserting `/test.txt` with no project root resolves to `['/test.txt']` (FR-152: with no base
  directory and no project root the platform step is not reached). Every other case in the file MUST
  stay.
- *(third round, recorded after the fact 2026-09-18)* `packages/core/tests/unit/link-detect.test.ts`
  — two pre-existing cases whose lines put prose after an anchored path (FR-003f's `file:` case and the
  `C:\x\foo.ts:42:7` ambiguity case): FR-150 extends into the prose and offers the longer reading
  first, so the first now expects that reading ahead of the old one and the second compares the last
  two readings, in their old order (`e197681f`). This list did not name them; FR-150 is what changed
  their answer.
- *(third round)* `packages/ui/tests/unit/terminal-link-affordance.test.ts` (T185, not yet written)
  MUST be written to FR-154 from the start — "every … OSC 8 link in view" reads as every **followable**
  OSC 8 link.

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
- *(2026-09-18)* **Constitution Principle VI, "A preference picks the default; the menu offers every
  variant"** still holds after FR-112: the preference that picks where a file link opens is now 044's
  per-provider default open action alone — the rule's own example, "where a file or a link opens" —
  and the plain **Open Link** item runs it beside the four named targets. No constitution amendment
  is needed; its sentence naming "#394's link targets" as the first plain item beside named variants
  stays true.
- *(2026-09-18)* **024 FR-019 – FR-019d** for terminals: unchanged in behaviour. Their plain-text URL
  grammar moves to `@throng/core` so editors share it (FR-102).
- *(2026-09-18)* **019 FR-023** is followed, not superseded, by FR-113.
- *(2026-09-18, not reconciled — reported)* **044 FR-090e**: a link inside a **preview** to a file
  outside the project stays on the current file with an inline notice, where FR-110 shows such a file
  in OS Explorer from an editor or a terminal. The maintainer's request names editors and terminals,
  and previews remain out of scope (*Out of scope*), so this spec leaves 044 alone and records the
  difference rather than silently widening its reach.

### Key Entities

- **File link**: a span of terminal output or editor text; its kind (detected path or explicit file
  hyperlink); the text as written; its position, if any; the panel and owning project it was seen in.
- **Resolved target**: an absolute location; whether it is a file or a folder; whether it is in the
  project; when its existence was last confirmed.
- **Link target**: one of Open in Editor, Open in Preview, Open in OS Explorer, Open in OS Default
  Program; whether it is offered, disabled or absent for a given resolved target.
- **Executable classification**: whether the OS would execute a file, answered from its extension by
  the platform abstraction (FR-039a).
- **Default link action** (setting): one of the five values in FR-050. *Retired 2026-09-18
  (FR-112); a persisted value is dropped (FR-113).*
- **Click rule** *(2026-09-18)*: the fixed decision FR-110 states, from a resolved link, whether it
  carries a position, and whether its preview is the file's default open action — never from a
  setting.
- **Web link** *(2026-09-18, editors)*: a span of editor text the shared web grammar matched
  (FR-102), with its address.
- **Existence-check timeout** (setting, 2026-09-18): how long one existence check may run before it
  answers unreachable (FR-120).
- **Link affordance** *(2026-09-18, second round)*: the at-rest, hovered and modifier-held states of
  FR-135, drawn from the `linkUnderline` and `linkUnderlineHover` theme tokens (FR-138).
- **Logical line** *(2026-09-18, second round)*: a terminal row plus the wrapped continuation rows
  xterm marks as belonging to it; the unit a link is detected on (FR-130).
- **Volume root state** *(2026-09-18)*: per volume root, whether a check is outstanding past the
  timeout and until when the root is being left alone (FR-121, FR-122). Main-process memory only;
  never persisted.
- **Extended reading** *(2026-09-18, third round)*: an anchored candidate lengthened across spaces,
  one word at a time; tried longest first, and existence decides which one is the link (FR-150).
- **Git Bash mount table** *(2026-09-18, third round)*: the mapping from Git Bash's rooted paths to
  Windows folders, read from the installed Git for Windows behind the platform abstraction (FR-151).
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
  *Amended 2026-09-18: the default link action is retired (FR-112); this now reads "either detection
  switch or the existence-check timeout".*
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
- **SC-012** *(2026-09-18)*: Across one fixture of lines covering every link kind in FR-100, every
  path form in FR-003 (including FR-003g) and every position form in FR-004, a terminal and an
  editor produce identical link spans, kinds, resolved targets, tooltip wording and Ctrl+click
  outcomes in 100% of cases.
- **SC-013** *(2026-09-18)*: Across every file type in the fixture — text, source, Markdown, binary,
  and every extension the executable classification reports (FR-039a) — in the project and outside
  it, 0 files are handed to the OS default program or run by Ctrl+click, the Open Link chord or the
  plain Open Link item, in either panel type. Each one still opens when **Open in OS Default
  Program** is chosen by name.
- **SC-014** *(2026-09-18)*: Every existing location on a reachable share — spelled `\\s\h\…`,
  `//s/h/…`, `file://s/h/…` and `FileSystem::\\s\h\…`, and reached as a relative path from a network
  working directory, a network document folder and a network project root — resolves and is followed
  in 100% of the fixture cases. With the server offline, a hover answers within the existence-check
  timeout, at most one check per volume root is outstanding, and no check at all is started under
  that root during its back-off.
- **SC-015** *(2026-09-18, second round)*: For every link kind soft-wrapped across two and three rows,
  every row is marked at rest and a Ctrl+click on each row follows the whole target exactly once —
  100% of cases, in every flavour run.
- **SC-016** *(second round)*: Every corpus line carrying a position opens an editor at that line and
  column, including a Markdown file whose default open action is Preview (D2).
- **SC-017** *(second round)*: Web, detected-path and OSC 8 links are indistinguishable in their
  at-rest and hover styling across both panel types; 0 link texts are recoloured; and 0 existence
  checks run while terminal output is being delivered (FR-072, unchanged).
- **SC-018** *(second round)*: Every cell of FR-145's matrix passes for every installed built-in
  flavour, and for WSL where configured; a flavour not installed is reported as not run.
- **SC-019** *(third round)*: Re-running the maintainer's corpus through the probe in every installed
  built-in flavour and in an editor yields **0 FAIL** rows against the maintainer's expected column,
  with the OSC 8 rows reported not applicable in the editor and a WSL flavour reported not run unless
  one is configured.
- **SC-020** *(third round)*: In the SC-003 prose fixture extended with spaced prose after existing
  paths, 0 spans are marked that are not an existing location, and no marked span extends past the
  longest existing reading; each path in the fixture that contains a space (drive, UNC, Git Bash,
  WSL `/mnt`, `file:` with `%20`) resolves in both panel types.

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
- **The hover tooltip** for a file link matches the **shape** and the **delay** of the web-link
  tooltip, and names the gesture.

  **Amendment 2026-09-18 (restates this assumption; FR-042 is unchanged).** As first written this
  bullet read *"The hover tooltip's wording for file links matches the wording web links use."* That
  is false as stated. The shipped wording is `Ctrl+Click to open in system browser`
  (`packages/ui/src/renderer/terminal/use-terminal.ts:311`), so matching it verbatim would promise
  that a Ctrl+click on `src/foo.ts` opens a **browser**. FR-042's actual requirement is narrower —
  the tooltip must "name the gesture" — and that is what the same *shape* delivers: the modifier,
  `+Click`, and what it does, with the destination wording differing by link kind (a web link keeps
  `…to open in system browser`; a file link says `…to open`). The **delay** is genuinely shared and
  unchanged: both follow `terminals.linkHoverDelayMs` (024 US7, bounded by 031). Derivation:
  [research.md](./research.md) **R10(a)**.

  *Refined 2026-09-18 by FR-105: with the default link action retired, the click rule makes a file
  link's destination knowable, so the file wording names it — "…to open" for a file that opens in
  throng, "…to show in OS Explorer" for one that is revealed. The shape and the delay are unchanged.*
- *(2026-09-18)* **Test layers for the change request.** The click rule, the parity scan, the web
  grammar, the PowerShell form and the UNC join are pure decisions — unit. The per-volume-root gate
  is a `FileLinkResolver` behaviour over an injected `IFileSystem`, so a fake that never answers
  proves it without a network — unit (ui, node). Editor web-link gestures, menus and tooltips are
  component tests, on 045's existing pattern. Resolution against a **real** share is integration,
  over the loopback administrative share, which needs an elevated token and therefore runs as
  `@admin` (it is skipped, with the reason printed, on a workstation that is not elevated). Whether
  OS Explorer actually shows a file on a share is observable by no test in this repository and is a
  hands-on check. **No E2E is added**: nothing here needs a real window that a lower layer cannot
  stand in for.
- *(2026-09-18, second round)* **The acceptance corpus for the hands-on pass** is the maintainer's
  own script, `D:\git\throng_tests\test 1\links-test.sh` — 106 lines of link variants in *working*
  and *broken* sections. It lives outside the repository and is **not copied into it**: it is the
  maintainer's instrument, and a copy would drift from the original. The hands-on tasks run it in
  every flavour (FR-145) and record the outcome against its sections; automated tests build their
  own fixtures (T134).
- *(2026-09-18, second round)* **Test layers for the second round.** A wrapped row's detection and
  range, and the idle scan's timing against output, are provider behaviours over a fake terminal —
  unit (ui). The editor affordance is a component test. The flavour cells whose truth is the shell's
  (cwd reporting, OSC 8 surviving ConPTY) are integration tests against real shells, on 025's
  precedent. **Where xterm itself draws** — its OSC 8 underline, and its linkifier's hover across a
  soft wrap — only a real renderer with real cell geometry shows it, so those are **cases added
  inside existing E2E declarations**, and the declaration count and budget (570) do not move.
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
- Underlining every row of a wrapped link (#326). *Superseded 2026-09-18 (second round) by FR-130 –
  FR-133: in scope, and #326 closes with this spec.*
- *(2026-09-18, second round)* Joining two lines a program printed separately into one link
  (FR-132), except for OSC 8 rows declaring the same target.
- *(2026-09-18, second round)* Shell integration that reports a WSL flavour's directory (FR-144).
- *(2026-09-18, third round)* Mapping a WSL distro's Linux paths (`/etc/hosts` printed in WSL →
  `\\wsl.localhost\<distro>\etc\hosts`), and offering WSL as a built-in flavour. Both belong to the WSL
  epic [#13](https://github.com/Bidthedog/throng/issues/13); recorded in plan *Complexity Tracking*
  (third round). Git Bash's mount table is **in** scope (FR-151).
- *(2026-09-18, third round)* A bare relative path containing a space without quotes (`test 1/x.md`)
  — FR-150 extends anchored forms only; `./test 1/x.md` and a quoted path work.
- Revealing a linked file in throng's own Files & Folders view. #394 does not list it, and the four
  targets are what it asked for.
- *(2026-09-18)* Applying the click rule (FR-110) to links inside a **preview**. 044 FR-090 – FR-096
  still govern them; the one difference is recorded under *Reconciled* (044 FR-090e).
- *(2026-09-18)* Recognising that two **names** denote one location — a mapped drive letter and its
  UNC, an admin share and its drive, an 8.3 short name (FR-106).
