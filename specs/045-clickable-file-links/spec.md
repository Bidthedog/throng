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

**Amended 2026-09-19 — round four, the maintainer's feedback on PR #408.** Recorded as the Clarifications
session *Session 2026-09-19 (round four)*. It makes a link's validity **syntactic** — throng no longer
checks that a location exists before drawing it as a link — and names five resource classes and what a
Ctrl+click does for each. It adds **US13 – US16**, **FR-155 – FR-172**, **SC-021 – SC-027** and defect
**D5** (links in Claude Code's full-screen interface carry no mark at rest or on hover). It supersedes,
in place and with the text kept, every rule that made rendering depend on an existence check (FR-006,
FR-070, FR-071, FR-120 – FR-123 as rendering rules, FR-137, FR-150's longest-existing reading,
FR-154's resolved-only marking), FR-135's hand-only-with-the-modifier row, FR-031's menu (by the Link
menu, FR-169 – FR-171), FR-013's refusal of every non-web scheme (by the protocol allowlist, FR-159),
and two statements in older specs (**S5**, **S6**). Nothing is deleted.
The maintainer's checkpoint answers the same day add **FR-173 – FR-177** (no spaces in a bare link
except five overrides; any rooted path is a link; the copy item becomes **Copy Link to Clipboard**, with
constitution v5.5.2 and **S7**; the drive-form order; drive forms in every flavour) and approve the
build, including the baseline converge's T227 and T229 – T232. Their review of the case table adds
**FR-178 – FR-179** (a user-editable known-extension list; `{}`; the first qualifying word; relative
scans; the cap). Planning and analysis added derived, lettered decisions — **FR-060a, FR-158a/b,
FR-122a, FR-156b, FR-158c/d, FR-159a/b, FR-160a, FR-167a, FR-168a/b, FR-170a – c, FR-178a/b, FR-179e/f**, the MUST NOT reading of
FR-155, FR-156 and FR-160 (FR-155a / FR-156a) — and supersessions **S8 – S11**,
each marked *derived* where it stands.

**Amended 2026-09-20 — round five, the maintainer's fifth hands-on round on PR #408.** Recorded as the
Clarifications session *Session 2026-09-20 (round five)*, which carries their six items verbatim. Every
change is additive: a link's hover becomes a native HTML `title` carrying its full target and nothing
else, and every other hover surface is removed (**FR-169a**), with `terminals.linkHoverDelayMs` retired
alongside the tooltip it delayed (**FR-169b**); the two detection switches govern **every** kind of link
rather than guessed paths alone (**FR-180**); the resolution timeout is kept, re-scoped and relabelled
rather than removed (**FR-181**); the known-extension setting becomes **one** editable list holding the
real extensions (**FR-182**); a scan may cross a space onto text that names the terminal's **known
working directory**, which is defect **D6**'s fix (**FR-183**); and a link's resting underline becomes
translucent (**FR-184**). It adds **SC-028 – SC-032**, supersedes **FR-060**, **FR-060a**, **FR-168**'s
tooltip half and **FR-178a** in place (text kept, each marked where it stands), and supersedes two
statements in older specs (**S12**, **S13**). Nothing is deleted, no requirement is renumbered, and
`SHIPPED_DEFAULTS_VERSION` stays at **11** (FR-184's note).
*Round five gained one more entry after that amendment was written: a bare email address was read as a
file path in editors and terminals, which the maintainer reported and ruled on the same day. It is
defect **D7**, requirements **FR-185** (an address is a `mailto:` link) and **FR-186** (claiming a range
and publishing a link are separate questions), and **SC-033**.*
*And one more after that: the hover title and the status-bar readout named the project root for a rooted
path that a click sent somewhere else entirely. It is defect **D8**, requirement **FR-187** (a readout
names a location only where the text settles it, else the text as written), and **SC-034**. FR-187
supersedes FR-167a's project-root clause; **FR-024 is unchanged** — it governs resolution, not what a
hover may claim.*

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
| **valid link** | *(added 2026-09-19)* Text, or an OSC 8 target, that the link grammar accepts as well formed and that names a resource of one of the five **resource classes** — decided without touching the filesystem (FR-155). It is what is drawn as a link. *This supersedes, for rendering, the* **file link** *row's "resolved to an existing location": a valid link is drawn whether or not it exists; resolution happens when it is followed (FR-160)* |
| **resource class** | *(added 2026-09-19)* One of five kinds of link target, each with its own Ctrl+click outcome: **web**, **UNC path**, **on-device file** (a `file:` URI or any other local path spelling), **action protocol** (an allowlisted scheme such as `mailto:`), and **loopback** web (FR-157) |
| **Link menu** | *(added 2026-09-19)* The one menu component, separate from any panel's context menu, that holds only link actions and is identical in every surface that has links (FR-169) |
| **link hint** | *(added 2026-09-19)* The small, brief, click-through popover a plain click on a valid link shows, saying that Ctrl+click follows it and what that will do (FR-165) |
| **protocol allowlist** | *(added 2026-09-19)* The editable setting naming the action-protocol schemes a Ctrl+click may hand to the OS's handler (FR-159) |

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
  *Superseded 2026-09-20 (round five, maintainer M13) by FR-180: the answer is now **yes**. "If
  disabled, all types of links are not shown" — the maintainer's words, which reverse this 2026-09-17
  reading of their own switch. The reasoning above was sound and is simply not what they want.*

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
  *Superseded 2026-09-20 (round five, maintainer M12) by FR-169a and FR-169b: there is no tooltip of
  throng's left to word, and no delay — the hover is a native `title` carrying the target, timed by the
  OS. The wording this answer defends is the link hint's now (FR-165).*
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

### Session 2026-09-19 (round four)

The maintainer's feedback on PR #408, 2026-09-19. Answers marked **(maintainer)** are their decisions
(M1 – M11). Every other answer was derived by the coordinator or while amending, and is marked
*(derived — not confirmed by the maintainer)*.

- Q: Must throng check that a link's location exists before drawing it as a link? → A (maintainer,
  M1): **No. Validity is syntactic.** A link is valid when it is well formed and names a *potentially*
  reachable resource; whether it is broken is not throng's responsibility, for performance and for
  scope. No existence check runs before a link is drawn, hovered or given a tooltip (FR-155). This
  supersedes FR-006 and every rule that existed to keep existence checks cheap while rendering
  (FR-070, FR-071, FR-120 – FR-123 as rendering rules, FR-137, FR-150's longest-existing reading,
  FR-154's resolved-only marking).
- Q: What does a Ctrl+click do for each kind of link? → A (maintainer, M2): **five resource classes.**
  A web link (`http`/`https`) opens in the OS default browser. A UNC path to a folder opens that folder
  in OS Explorer; to a file, opens its **parent** folder in OS Explorer and never invokes the file. A
  `file:` URI behaves exactly as a UNC path. An action or system protocol (`mailto:`, `tel:`,
  `slack://`, …) goes to the OS default handler for that scheme, through a shipped, editable
  **allowlist**; dangerous handlers (`ms-msdt`, `search-ms`, `ms-officecmd`, `javascript`, `data`,
  `vbscript`, and any scheme that executes a file) are always refused. A loopback web address
  (`http://localhost:8080`, `http://127.0.0.1:3000`) behaves as a web link (FR-157 – FR-159).
- Q: The five classes do not name a plain local path (`D:\x\notes.txt`, `/c/x/notes.txt`, `..\x`). Which
  class is it? → A: **an on-device file, class 3 — exactly as a `file:` URI and as a UNC path**
  *(derived — not confirmed by the maintainer)*. The maintainer's "`file:` URIs (on-device
  files/folders)" names the resource, not the spelling, and FR-106 already requires that the spelling
  never changes the outcome.
- Q: When OS Explorer opens a file's parent folder, is the file selected in it? → A: **Yes — the
  parent folder opens with the file selected, as FR-110 already does** *(derived — not confirmed by the
  maintainer)*. Selecting the file is what "open its parent folder" looks like on Windows' reveal, and
  it still never invokes the file.
- Q: Does an in-project file still open in throng? → A (maintainer, M3): **Yes, in any spelling,
  including `file:///…`.** The Link menu offers Open in OS Explorer and the other targets for it exactly
  as for an out-of-project file (FR-160).
- Q: With no existence check before rendering, what happens when a Ctrl+click follows an in-project path
  that does not exist? → A: **the link is resolved at the moment it is followed; if no reading exists,
  one notice says so and no editor opens** *(derived — not confirmed by the maintainer)*. An in-project
  file has to be resolved to be opened in throng, and opening an empty editor for a file that is not
  there would be a second, silent failure. One condition, one notice (CLAUDE.md) (FR-160).
- Q: Is an out-of-project path, a UNC path or a `file:` target checked before it is handed to OS
  Explorer? → A: **No — it is handed to OS Explorer on its parent folder without a check; if that folder
  cannot be reached, OS Explorer reports it** *(derived — not confirmed by the maintainer)*. M1 makes
  "is it broken?" not throng's question (FR-158).
- Q: Is the existence-check timeout (`editor.links.existenceCheckTimeoutMs`) retired, as the default
  link action was? → A: **No — it is kept and re-scoped** to the checks that still happen, at Ctrl+click,
  Open Link and Link-menu opening *(derived — not confirmed by the maintainer; this departs from the
  coordinator's triage, which proposed retiring it)*. A click-time check against an offline share still
  needs a bound, and constitution Principle X forbids hardcoding a timeout whose right value depends on
  the machine's network — the reason FR-120 made it a setting in the first place. Its descriptor text
  changes to say what it now governs (FR-161).
- Q: How does a path containing spaces become one link without a filesystem check? → A (maintainer, M4):
  **a greedy, purely syntactic check for path-like suffixes** — an anchored path extends across a space
  while the following text looks like a path (separators, extensions). The positive and negative unit
  cases for this grammar MUST be written **first** and shown to the maintainer for joint verification
  before it is implemented (FR-162).
- Q: What does "looks path-like" mean, word by word? → A: **a word that contains a path separator, or
  that ends in a dotted extension**; the reading stops before the first word that is neither, and FR-150's
  other stopping rules (a word that begins an anchored form, a web span, an unbalanced bracket, a quote,
  a printed line break, the word cap) are kept *(derived — not confirmed by the maintainer; it is the
  first draft of the case list M4 asks the maintainer to verify, not a substitute for it)*.
- Q: What must input validation guarantee? → A (maintainer, M5): **trim whitespace and validate a
  link's prefix before it is rendered clickable, and sanitise it so that no crafted string can execute
  an arbitrary command when clicked** (FR-156).
- Q: What pointer does a valid link show? → A (maintainer, M6): **always the hand**, on hover, with or
  without Ctrl held — never the text I-beam. This supersedes FR-135's "hand only while the modifier is
  held" row (FR-164).
- Q: What does a plain click on a link do? → A (maintainer, M7): **it shows the link hint** — a small,
  brief, non-focus-taking, click-through popover saying Ctrl+click is needed and what that will do; only
  where links are enabled for that panel type; anchored at the link's bottom-right so no link text is
  hidden, correct for a link spanning several rows, and kept on screen by the same viewport clamping the
  context menu uses; never on hover and never on Ctrl+click; hidden by any Ctrl press or Ctrl+click; at
  most one in the whole app; one shared component with identical style, behaviour and messages in
  editors, terminals and the Markdown preview, which adopts it (FR-165, FR-166).
- Q: Does the plain click still do its ordinary thing as well? → A: **Yes — the hint is click-through,
  so the click still places the caret, starts a selection or reaches a mouse-reporting program exactly
  as before** *(derived — not confirmed by the maintainer)*. That is what "click-through" and
  "non-focus-taking" mean together, and constitution Principle VI requires that a plain click keep its
  ordinary meaning.
- Q: Does the hover tooltip stay now that a hint exists? → A: **Yes** *(derived — not confirmed by the
  maintainer)*. M7 puts the hint on the plain click and forbids it on hover; it does not remove the
  tooltip, and constitution Principle VI requires that a link show on hover how it is followed.
- Q: How long is the hint shown? → A: **a fixed, named interval beside the other link limits, not a
  setting** *(derived — not confirmed by the maintainer)*. Unlike the existence-check timeout it does
  not depend on the machine, which is the line Principle X draws.
- Q: Where is a hovered link's target shown? → A (maintainer, M8): **at the bottom-left of that panel's
  status bar**, to the right of any persistent content, as the Markdown preview's hover already does
  (044 FR-118) (FR-167).
- Q: Is the readout shown while the panel's status bar is hidden? → A: **No — as 044 FR-118, only while
  the status bar is shown** *(derived — not confirmed by the maintainer)*.
- Q: What does the tooltip say for a file that opens in throng? → A (maintainer, M9): **"Click to open in
  throng [active/new] editor"**, following the open-target preference (FR-168).
- Q: Does that wording keep the modifier? → A: **Yes — "Ctrl+Click to open in throng active editor" or
  "…new editor"**; the other destinations keep FR-105's shape (*"…to open in system browser"*, *"…to
  show in OS Explorer"*), a preview says *"…to open in throng preview"*, and an action protocol says
  *"…to open with the <scheme> handler"* *(derived — not confirmed by the maintainer)*. Principle VI
  requires the hover to name the gesture.
- Q: Where do link actions live in a menu? → A (maintainer, M10): **one Link menu component**, separate
  from the panels' context menus, handling only link actions and identical across surfaces: Open Link,
  Open In ▸ New Editor, Open In ▸ Active Editor, Open In ▸ *<editor name>*, Copy Link to Clipboard, Open
  in OS Explorer, Open in OS Default Programme, Open Preview, Open Programme (for executables — never the
  default action), with the established absent-when-meaningless rules (FR-169 – FR-171).
- Q: Which surfaces does "identical across surfaces" cover? → A: **editors, terminals and the Markdown
  preview** *(derived — not confirmed by the maintainer)*, the same three M7 names for the hint.
- Q: M10 labels an item "Copy Link to Clipboard", but constitution Principle VI names **Copy Link
  Address** as the item every link menu carries. Which label ships? → A: **Copy Link Address, until the
  maintainer decides** *(derived — not confirmed by the maintainer; reported as a constitution conflict)*.
  Changing it is a constitution amendment, which this round does not make.
- Q: M10 writes "Programme". Does the spelling change? → A: **No — "Program", the codebase's spelling,
  recorded by the 2026-09-17 session** *(derived — not confirmed by the maintainer)*; M10's items are
  read as naming actions, not respelling labels.
- Q: What are "Open Programme" and "Open in OS Default Programme" for an executable? → A: **Open Program
  is offered only for an executable file and runs it; Open in OS Default Program is offered for every
  other file** *(derived — not confirmed by the maintainer)*. For an executable the two would be the
  same action, and absent-when-meaningless forbids a second row for it. Neither is ever the default
  action (FR-111 stands).
- Q: The Link menu has to know whether a target is a file or a folder, in the project, and has a preview
  provider. Is that an existence check? → A: **Yes, and it is allowed — once, when the menu opens**,
  because opening a menu is a deliberate act like a click *(derived — not confirmed by the maintainer)*.
  A link that does not resolve then offers only what needs no target: Open Link, Open in OS Explorer
  and Copy Link Address (FR-170).
- Q: Which schemes does the allowlist ship with? → A: **`mailto`, `tel` and `slack`** — the maintainer's
  own examples *(derived — not confirmed by the maintainer)*. The allowlist is a setting with a
  descriptor (Principle X, configuration-editor completeness), and a scheme outside it is not a link
  (FR-159).
- Q: May a user add a dangerous scheme to the allowlist? → A: **No — the refused set wins over the
  allowlist, and lives behind the platform abstraction where it names OS-specific handlers** *(derived —
  not confirmed by the maintainer)*. "Always refused" is the maintainer's word; Principle II keeps
  `ms-msdt` and `search-ms` out of `@throng/core` (FR-159).
- Q: Does launching an allowlisted protocol handler de-elevate, as FR-038 does for Open in OS Default
  Program? → A: **Not in this round — it takes the route web links take today, and the gap is reported**
  *(derived — not confirmed by the maintainer)*. FR-038 names two targets; widening it to the
  open-external seam is a decision for the maintainer.
- Q: An OSC 8 hyperlink to a `file:` location that does not exist — link or text? → A: **a link: a
  well-formed `file:` target is valid whatever it points at**; an OSC 8 target of a scheme that is not
  web, not `file:` and not allowlisted, or an empty target, is still not a link and still looks like
  text *(derived — not confirmed by the maintainer)*. This supersedes FR-154 for `file:` targets only
  (FR-163).
- Q: Is a bare relative path (`src/foo.ts`, `foo.ts:42`) still a link with no existence check? → A:
  **Yes, by grammar alone** — it needs a separator or an extension, as today's grammar requires — so it
  is drawn even when no such file exists; that is M1's explicit trade *(derived — not confirmed by the
  maintainer)*. SC-003's prose fixture is protected by the grammar alone, and M4's cases must cover prose.
- Q: Links in Claude Code's full-screen interface show no mark at rest and no hover style, though
  Ctrl+hover and Ctrl+click work. A new requirement? → A (maintainer, M11): **a defect**, recorded as
  **D5** against FR-135 – FR-139. Its located cause is the coordinator's reading, not a run *(derived —
  not confirmed by the maintainer)*: see D5 under *Functional Requirements* (FR-172).
- Q: Does T233 (`terminal-link-view-marks.test.ts`, f1bc6c81) reproduce D5? → A (maintainer,
  2026-09-19): **"Yes, fix it."** All four cases — (a) no mark within 100 ms under never-quiet output,
  (b) no hover mark or pointer on a Ctrl+hover, (c) marks surviving a buffer switch, both directions —
  reproduce D5 (and T228). This is T234; the fix is T237 – T239.
- Q: How do the baseline converge's findings T226, T227 and T228 (tasks.md Phase 16) relate to round
  four? → A *(derived — not confirmed by the maintainer)*: **T228 is D5** — the hover underline missing
  while output streams is the same `viewLinks` gap, and FR-172's hover mark drawn from the hovered link
  closes both. **T226** has two halves: its renderer half (a late existence answer after
  `file-link-provider.ts`'s held reply) is **moot** under M1, because rendering no longer waits for any
  answer; its main-process half (one deadline per request in `FileLinkResolver.locate`, not one per
  attempt) **still applies** to the click-time and menu-open resolution FR-160 and FR-170 keep. **T227**
  (FR-124's total bound when following a link) **still applies unchanged**: it is a click-time rule.
  T225 (the watcher invalidating the link cache) is moot for rendering and applies only if a click-time
  cache is kept.

The maintainer answered the checkpoint the same day. These entries are **confirmed**; where one differs
from a derived answer above, it supersedes that answer, which is kept as written.

- Q: How do spaces in a path work? → A (maintainer, verbatim): *"Let's make it simple. Spaces in paths
  are not supported for bare links i.e. /file 1 would only catch the /file part. This rule is explicitly
  overridden if a path is surrounded with backticks `/file with spaces.md`, paired quotes ("C:\my
  folder\my file.txt", "\\network.local\folder one\ folder", brackets ((), <>, [] i.e. [/d/folder/a link
  to file.png]), ends with a supported slash (//path to/file/, Z:\folder with spaces\folder\), OR if a
  known-extension is greedily discovered (\\share\path to file.xlsx)."* This **supersedes the derived
  "path-like word" answer above** (a word with a separator or a dotted extension) and FR-162's rule; the
  rule is FR-173, with a named known-extension constant, and its cases live in
  `packages/core/tests/unit/link-detect-spaces.test.ts`.
- Q: Does a rooted path need more than one segment to be a link — is `/help` in prose a link? → A
  (maintainer): **any rooted path is a link, with no minimum segment count** — `/help` in prose is one
  (FR-174).
- Q: Which label does the link menu's copy item carry? → A (maintainer): **"Copy Link to Clipboard",
  everywhere.** This **supersedes the derived "Copy Link Address, until the maintainer decides" answer
  above**. The constitution is amended to match (v5.5.2, PATCH, `c855eadd`), and FR-175 relabels the
  item across this spec.
- Q: Is the build approved, and which of the baseline converge's findings go into it? → A (maintainer):
  **go ahead, including T227 (the click-time overall bound), T229 (the OS's reason in the refused
  notice), T230 (the `/d/` drive-form order), T231 (the WSL `/c/` contradiction) and T232 (the setting's
  description)**; T225, T226 and T228 as mapped above.
- Q: How is T231 settled — does `/c/…` map to a drive in a WSL flavour? → A (maintainer): **per FR-025:
  drive forms map in every flavour**, WSL included. FR-151's WSL clause, "the project root and FR-025's
  `/mnt/<drive>` form only", is read as "FR-025's drive forms"; the code, which maps both, is right
  (FR-177).
- Q: How is T230 settled — does `/d/git/x.ts` try the project root before the drive? → A: **no — a
  drive form maps to its drive and is nothing else, as FR-024 and FR-025 say; the project-root reading
  is not tried for it** *(derived — not confirmed by the maintainer: the go-ahead approves building T230
  but does not name a direction; a converge task brings the code to the spec, so the spec's text is
  taken as the answer)* (FR-176).

The maintainer then reviewed the space-rule case table (`packages/core/tests/unit/link-detect-spaces.test.ts`,
`6d272de9`) the same day: *"Mostly good, but the extension list should be user-editable. We provide a
default, common list of extensions, they can add to it or remove from it in their throng instance. Also
include curly braces in the brace rule."* They also accepted the coordinator's recommendations for the
table. These entries are **confirmed**, and supersede FR-173's text where they differ.

- Q: Is the known-extension list fixed? → A (maintainer): **No — it is a user setting.** throng ships a
  default, common list; the user adds to it or removes from it in their own instance, live, with no
  restart (FR-178). This supersedes FR-173e's "one named constant in `@throng/core`": the constant
  remains, as the setting's shipped default.
- Q: Do curly braces enclose a path as the other brackets do? → A (maintainer): **Yes — `{}` joins `()`,
  `<>` and `[]`** (FR-179).
- Q: Does a trailing-separator or known-extension extension run to the farthest matching word, or the
  first? → A (maintainer, accepting the recommendation): **the first** — scanning forward, the extension
  ends at the first word that ends in a separator (FR-173d) or a known extension (FR-173e). This
  supersedes "farthest" in both (FR-179).
- Q: Must such an extension start from an anchored form? → A (maintainer, accepting the
  recommendation): **No — any candidate that contains a path separator may cross spaces under FR-173d
  and FR-173e, relative ones included** (`src/my file.ts`). A bare word with no separator still cannot
  (FR-179).
- Q: What bounds the scan? → A (maintainer, accepting the recommendation): **the word cap
  (`MAX_PATH_SPACE_WORDS`, 6) is kept, and two consecutive spaces or a tab end the scan** (FR-179).
- Q: What does unquoted `\\network.local\folder one\ folder` yield? → A (maintainer, accepting the
  recommendation): **it ends at `folder one\`** — the first word ending in a separator; the quoted form
  `"\\network.local\folder one\ folder"` is taken verbatim (FR-179, FR-173b).

Decisions taken while planning round four (plan *Amendment 2026-09-19, round four*; research R25 – R35).
Each is *(derived — not confirmed by the maintainer)*.

- Q: How is the known-extension setting stored — the resulting list, or the user's edits? → A: **the
  edits** *(reversed 2026-09-20, round five, maintainer M15 — FR-182: one list, and the cost this answer
  names is accepted rather than avoided, FR-182c)*: `editor.links.knownFileExtensions.added` and `.removed`, both string lists defaulting to empty,
  applied to the shipped constant; `*` in `removed` removes every shipped entry (FR-178a). A list stored
  whole freezes when first edited, and this codebase's upgrade path for a changed list default skips
  every customised install, so later-shipped extensions would never reach the users who edit the list.
- Q: Is the protocol allowlist stored the same way? → A: **No — as the whole list.** A later release must
  never silently widen which schemes a user's throng hands to the OS (research R28).
- Q: Is a click-time existence cache kept, so T225 still applies? → A: **No.** Every follow and Link-menu
  opening resolves fresh under one per-request deadline; the renderer cache is deleted with its
  invalidation, and **T225 is withdrawn** (research R32).
- Q: At hover, how does the tooltip know whether a path opens in throng without an existence check? →
  A: **by name** — FR-106's membership test on the grammar's reading; the click's real resolution decides,
  and FR-160's notice covers a name that does not exist (research R30).
- Q: What does a preview's in-document anchor link offer in the Link menu? → A: **Open Link and Copy Link
  to Clipboard only** (research R31).
- Q: How long is the link hint shown, and how often are terminal marks recomputed? → A: **`LINK_HINT_MS`
  = 2,500 ms and `LINK_MARK_THROTTLE_MS` = 100 ms**, named constants in `core/src/links/limits.ts`.
- Q: The OS-specific refused schemes live behind a port in UI main. How does the renderer know an
  allowlisted `ms-msdt` is still not a link? → A: **the renderer fetches the platform's refused set once
  at startup** over IPC (`throng:linkUri:refusedSchemes`) and unites it with core's half before any scan;
  until the answer arrives only core's half applies to drawing, and main refuses every click regardless
  (research R34).
- Q: Is `file` in the refused set? → A: **Not the set classification reads.** A `file:` URI is class 3
  (FR-157); refusing it is the external opener's rule (FR-037) and lives only in main's
  `throng:linkUri:openExternal` predicate.
- Q: Does main re-sanitise what reaches `FileLinkResolver`, not only the external opener? → A: **Yes** —
  every request, on every route (FR-156).
- Q: FR-169 says "identical … chords", but the Open Link chord is bound in editors only. → A: **the
  chord is the one permitted difference**: FR-170 row 1 shows it only where bound (FR-046), so items,
  order, labels and enablement are identical and the chord column is not (FR-169's note; SC-025).
- Q: Does a Markdown preview's hover tooltip adopt FR-168's wording? → A: **Yes** — one function words
  the tooltip and the hint on every surface, so a preview link cannot read two ways. This supersedes S6's
  "hover tooltip … unchanged" for the tooltip's **wording** only; its presence and 044 FR-118's readout
  are unchanged (FR-168's note).
- Q: "Hide on scroll" — does output scrolling a terminal hide the hint? → A: **No — only a scroll the
  user makes** (wheel, scrollbar, a scrolling key); output that scrolls the view does not (FR-165d's
  note).
- Q: Does `*` in `removed` also remove extensions throng ships later? → A: **Yes** — `*` means "none of
  throng's list", now and later; the user's `added` entries still apply (FR-178a's note).
- Q: Is the space-rule table at `80e13719` the confirmed one? → A: **Yes** — it encodes exactly the
  answers the maintainer confirmed on reviewing `6d272de9` (user-editable extensions, `{}`, first
  qualifying word, relative scans, the cap and the double-space stop, and the recommendations marked
  `unsure`, which they accepted). Its "PROPOSED" header and `unsure` markers are cleared when the grammar
  lands (T242).
- Q: Does a Ctrl+click on `\\server\share\dir` (no trailing separator) reveal `dir` inside its parent, or
  open it? → A: **open it** — one bounded file-or-folder check at the follow (FR-158a), because M2 says a
  folder opens in OS Explorer, and file-or-folder is not the "is it broken?" question M1 ruled out.
- Q: When some readings lie in the project and some outside, which decides? → A: **the first reading that
  exists**, wherever it lies; the first reading decides only when none exists (FR-160's note).
- Q: Does `MAX_PATH_SPACE_WORDS` count the words added or the whole span? → A: **the whole span**, as the
  confirmed table does (FR-179f).
- Q: What does the Link menu offer for a link that does not resolve? → A: **its applicable target items,
  drawn disabled** — superseding the earlier derived answer "only Open Link, Open in OS Explorer and Copy
  Link Address", which removed items a later state could enable, against Principle VI (FR-170a).
- Q: An in-project **folder** — throng or OS Explorer? → A: **OS Explorer, as itself**, as FR-110 always
  said (FR-160a).
- Further derived decisions from the same analysis: the protocol span's grammar (FR-159a), protocol links
  surviving the detection switches (FR-060a), what the readout shows (FR-167a), the known-extension list
  as a carve-out from FR-039a (FR-178b), the relative-path wording trade (FR-168a) and the preview's
  allowlist difference (S6 addendum) — all under *Decisions taken while analysing round four*. Later
  passes added the reveal's check (FR-158b, S10), a relative folder's reading (FR-158c), folders by
  grammar in the wording (FR-168b), the menu opening at once and before main answers (FR-170b, FR-170c),
  the MUST NOT reading (FR-155a / FR-156a), metacharacters kept in a path (FR-156b), allowlist
  normalisation (FR-159b), every folder by grammar unchecked (FR-158d) and the back-off in main
  (FR-122a), in the same section. The two new IPC channels are named `throng:linkUri:openExternal` and
  `throng:linkUri:refusedSchemes` (renamed out of the `throng:links:` namespace, whose contract keeps
  invoke-only channels; twelfth analysis pass).

### Session 2026-09-20 (round-four adversarial review — clarifications, additive, nothing retired)

Seven defects found by reading the round-four diff against this spec. Every one was a surface
disagreeing with a requirement already written here, so the requirements below are **clarified, not
changed**: no FR is superseded and no behaviour the spec states is withdrawn. Marked *(derived — not
confirmed by the maintainer)*.

- **FR-167a's "first reading" includes the drive forms and the project-root reading.** The readout
  treated every spelling that is not `X:\…` or `\\…` as relative and joined it onto the terminal's
  working directory, so `/d/git/x.ts` read out as `<cwd>\d\git\x.ts` while the Ctrl+click opened
  `D:\git\x.ts`. The readout's reading is now the same ordering `resolveCandidate` uses, minus the
  steps that need `IPathForms`: a drive form is its drive (FR-176), any other rooted path reads
  against the **project root** (FR-024), a relative path against the base directory (R5). Two
  spellings have **no by-name reading** and are shown **as written** rather than joined onto
  something they do not mean: `~` (FR-025 is the platform's) and a rooted path only the POSIX mount
  table explains (FR-151). SC-027's "the full target" is therefore met for every reading that is
  decidable without asking main, and the text as written stands for the two that are not.
  *Superseded in part 2026-09-20 (round five) by FR-187: this bullet's carve-out — "a rooted path only
  the POSIX mount table explains" is shown as written — was the right rule aimed at a class the
  renderer **cannot identify**, since `/tmp` and `/help` are one shape by name. The carve-out therefore
  widens to **every** rooted non-drive path, and the "reads against the project root (FR-024)" clause is
  withdrawn. The drive-form and relative clauses stand (D8).*
- **FR-168's wording asks the same question.** A drive form is decidable by name — FR-176 says so in
  as many words — so it is **not** covered by the by-name trade R35 / FR-168a / FR-168b accept, and a
  drive form outside the project is worded *show in OS Explorer*, as its click does.
- **FR-168's protocol row applies in editors and terminals, not only in the preview.** Both folded an
  allowlisted protocol span into a web hit and dropped its scheme, so `mailto:`/`tel:`/`slack:` read
  *open in system browser* on two of the three surfaces. An address is now worded from its scheme on
  all three (`uriHoverDestination`), which is what FR-166 and SC-025 already required.
- **The Markdown preview words a `file` link by whether the preview would actually show it.** 044
  FR-090d opens an in-project file with no enabled provider in an **editor**, so *open in throng
  preview* was a promise that surface does not keep. It now asks the same by-extension question the
  editor and the terminal ask, and names the editor 023 FR-025 would send it to.
- **FR-165c's clamp is re-applied on a window resize**, and **FR-165d's "scroll" includes a scrollbar
  drag.** A drag is told from output scrolling a terminal by the pointer: a `scroll` hides the hint
  only while a pointer button is held, so FR-165d's note ("output that scrolls a terminal is not a
  user scroll") still holds unchanged.
- **FR-165d also ends at the raising panel's destruction.** A hint describes a link in a panel; a
  panel destroyed inside `LINK_HINT_MS` takes its own hint with it. Still at most one hint in the app
  (FR-166) — the hint knows which panel raised it, so a destroy can hide its own and no other's.
- **FR-178's "next detection pass" needs a trigger when no row changes.** A terminal at an idle prompt
  renders nothing, so a settings edit repainted no at-rest mark until output arrived. A change to the
  settings the scan reads now asks the view pass for one (throttled exactly like a render), which is
  what `LinkViewMarks.refresh()` was declared for.

### Session 2026-09-20 (round five — the maintainer's fifth hands-on round)

The maintainer's feedback on PR #408 after round four shipped and its gate went green. Their words are
recorded verbatim below, because two of the six items read as questions rather than instructions and the
answer to one of them is "no change, and here is why". Answers marked **(maintainer)** are their own
decisions (M12 – M17); every other answer was derived while building, and is marked *(derived — not
confirmed by the maintainer)*.

Verbatim, their six bullets:

> * Hovering over a link in a terminal, claude or an editor should simply show the link text, in full,
> in the HTML title popup. Any other popup / hover / title text should be removed. The new bottom right
> popover on click needs to stay - that works nicely.
> * The "Detect File Links in &lt;panel type&gt;" preference options should cover ALL types of links. If
> enabled, all types of links are shown. If disabled, all types of links are not shown.
> * Is the "Existence-check timeout" in use any more? If not, remove it.
> * The description for "Ignored built-in file extensions" is too long. I think this option should be
> inverted, actually - we should show a list of the supported file extensions as default options, and
> allow users to add and remove from them as they want.
> * In PowerShell, cmd and bash prompts, The "location" prompt does not capture spaces in the folder e.g
>   - PS `D:\git\throng_tests\test 1>`
>   - CMD `D:\git\throng_tests\test 1>`
>   - Bash `Spikeh@MUHAMMAD MINGW64 /d/git/throng_tests/test 1 (master)`
> The links detect, but the 1 is missed off the end. Is there any way can include the 1 in the link
> detection? The same happens when this same link is displayed in the claude code CLI header.
> * I don't like the link style. Can we make the underline more subtle? Maybe slightly transparrent
> until hovered over?

- Q: What does hovering a link show? → A (maintainer, M12): **the link text, in full, in the HTML title
  popup, and nothing else.** Every other popup, hover surface and title text is removed. The plain-click
  popover stays as it is (FR-169a). This supersedes FR-168's "&lt;destination wording&gt;" as the *tooltip's*
  text and FR-135's hovered-row clause that a tooltip appears after the hover delay.
- Q: "The link text, in full" — the visible text of the span, or the address it names? → A: **the
  address**, which is what FR-167 already calls "its full target" and FR-167a defines *(derived — not
  confirmed by the maintainer)*. The maintainer's complaint is that a hover did not say where a link
  goes; a span's own visible text is already on screen, and an OSC 8 hyperlink's visible text is
  frequently not its target at all. The status-bar readout and the title therefore say the same thing,
  computed by the same function (FR-169a).
- Q: Do FR-168's words disappear with the tooltip? → A: **No — they word the link hint**, which M7 asked
  for and M12 explicitly keeps *(derived)*. `linkHoverText`, `previewLinkHoverText` and
  `uriHoverDestination` survive unchanged and have one caller each: the hint (FR-169a).
- Q: Does `terminals.linkHoverDelayMs` survive? → A: **No — it is retired** *(derived — not confirmed by
  the maintainer)*. It existed to delay throng's own tooltip; a native `title` is placed, timed and
  dismissed by the OS, so the setting had nothing left to govern, and a descriptor for a knob that
  changes nothing fails configuration-editor completeness in the other direction (FR-169b).
- Q: What do the two detection switches govern? → A (maintainer, M13): **all types of links.** *"If
  enabled, all types of links are shown. If disabled, all types of links are not shown."* This supersedes
  FR-060's "Web links and explicit file hyperlinks MUST NOT be affected", FR-060a and FR-165f's
  parenthetical (FR-180).
- Q: Is the existence-check timeout still in use? → A (maintainer, M14, a question): *"Is the
  'Existence-check timeout' in use any more? If not, remove it."* → **It is in use, so it is kept** — and
  the question is recorded because the answer reads as a contradiction otherwise. Nothing has checked
  existence *before drawing a link* since round four (FR-155), but `file-link-resolver.ts` still reads
  the value to bound the resolution a **follow** or a **Link-menu opening** makes, which is what stops a
  dead network share hanging the menu (FR-161, FR-122a). What was wrong was its name: its label becomes
  **Link resolution timeout** and its description stops saying "existence". Its **key**
  (`editor.links.existenceCheckTimeoutMs`) is unchanged, because renaming a key drops every persisted
  value (FR-181) *(derived — the keep is derived from the maintainer's own condition, "if not")*.
- Q: How is the known-extension list presented? → A (maintainer, M15): **inverted — show the supported
  extensions as the default options and let the user add to and remove from them**, and shorten the
  description. One setting, `editor.links.knownFileExtensions`, shipping the real list (FR-182). This
  supersedes FR-178a's `{ added, removed }` pair.
- Q: What does the reversal cost? → A: **an extension throng ships later no longer reaches a user who has
  edited their list** *(derived — the trade is real and the maintainer chose the presentation knowing the
  list is what is stored)*. That is exactly the cost R28 refused in round four; M15 overrides it, because
  a delta the user cannot see is not the control they asked for. Recorded as a trade, not a defect
  (FR-182).
- Q: Does the empty value still mean "the shipped list"? → A: **No — it inverted.** `{ added: [], removed:
  [] }` meant "throng's list"; `[]` now means "no extension ever ends a spaced path" *(derived)*. This is
  a trap for any fixture or test that passed an empty value meaning "default", and it has already cost
  one silently-wrong fixture (FR-182's note).
- Q: Can a prompt's folder keep its space? → A (maintainer, M16, a question): *"Is there any way can
  include the 1 in the link detection?"* → **Yes, and it is a defect (D6), fixed without weakening the
  space rule.** A bare path still stops at the first space, and the 92-case table the maintainer verified
  personally (`packages/core/tests/unit/link-detect-spaces.test.ts`) is unchanged byte for byte. A scan
  may extend across a space when what it lands on **names the terminal's known working directory** — a
  string comparison against a value throng already holds, with no disk access, so FR-155 still holds
  (FR-183).
- Q: Why is the comparison the caller's and not the grammar's? → A: **because `@throng/core` may not map
  drive letters or mount forms** (Principle II) *(derived)*. Core takes an optional predicate; the
  renderer supplies it (FR-183).
- Q: Does it fix the Claude Code CLI header too? → A: **Yes** *(derived)*. The rule works on any detected
  span, not on a prompt line, so anything printing the working directory benefits — which is what the
  maintainer observed ("the same happens when this same link is displayed in the claude code CLI
  header").
- Q: How subtle is the resting underline? → A (maintainer, M17): **translucent until hovered.** At rest
  the underline is the link colour at 45% against the background; on hover it is solid (FR-184).
- Q: Does that need a new theme token? → A: **No** *(derived)*. Terminals and editors mix the existing
  `linkUnderline` token; the Markdown preview can use neither that token nor `color-mix`, because
  `preview-css-tokens.test.ts` bans both for its SC-005 contrast gate, so it uses a border at rest and
  `syntaxFunction` on hover (FR-184).
- Q: Does `SHIPPED_DEFAULTS_VERSION` move? → A: **No — it stays at 11** *(derived)*. Round five changes
  two settings and no theme token; a settings change reaches an existing install through the tolerant
  per-field parse on every read, with no version gate, and a bump with no payload would make every
  install run an upgrade pass for nothing. A bump to 12 was written and reverted; the reason is recorded
  in `shipped-defaults.ts` beside the version (FR-184's note).

A **seventh item** was reported after the amendment above was written, and answered the same day. The
maintainer's report, verbatim:

> Raw email links in editors are opening as links, rather than mailto links: `someone@example.com`
> tries to open as D:\throng\tests\test 1\someone@example.com. The preview renders the mailto:
> properly, but the editor does not.

- Q: What should a bare email address be? → A (maintainer, M18, choosing between the two candidate
  behaviours put to them): **a `mailto:` link, matching what the Markdown preview already draws.** With
  `mailto` **off** `editor.links.protocolAllowlist` it is plain text — not a mail link, and **still not
  a path** (FR-185).
- Q: Was this editors only, as the report says? → A: **No — terminals too** *(derived — not confirmed by
  the maintainer)*. Both panel types take their spans from the one `scanLinkLine` (FR-104), so both read
  the address as a path; the report names editors because that is where the maintainer met it. The
  preview was right **by accident**: markdown-it autolinks a bare address into a real `mailto:` href
  before throng sees the text. One surface mailed, two offered a file that cannot exist — which is
  exactly the parity FR-104 and FR-166 exist to prevent. Recorded as **D7**.
- Q: Should the address detector be gated on the allowlist, like `detectProtocolSpans`? → A: **No, and
  the distinction is a requirement of its own (FR-186)** *(derived — forced by a failing case)*. The
  allowlist decides whether an address is a **link**; it has no opinion on whether it is a **file**. A
  gated detector passed the first four cases and then handed the address straight back to the path
  grammar the moment `mailto` was removed — the same defect by a second route, caught by the sixth
  case. So the scan **claims** every address and **publishes** only the allowed ones, which is what it
  already did for a refused scheme.
- Q: Is a span's `uri` still its own text? → A: **Not for this one, deliberately** *(derived)*. The span
  covers the address as written and its `uri` is `mailto:` plus that address — the first span in this
  spec where the two differ, and the same shape as an OSC 8 hyperlink, where what a reader sees and
  where it goes are two strings (FR-185, data-model §17.7).
- Q: How does the grammar keep paths out? → A: **from both ends** *(derived)*: the local part excludes
  `/` and `\`, a match must begin at a word boundary, and the domain needs a dot and a letters-only last
  label. So `D:\p\a.b@c.com\x.ts`, a scoped npm package and a bare `user@host` are all left to the path
  grammar, and the first two have cases (FR-185).

An **eighth item** was reported after that, in two messages, and answered the same day:

> The displayed title hover text - and the status bar text - for `/tmp` in all three surfaces points to
> the relative path opf the current project, but clicking the link goes to
> `C:\Users\Spikeh\AppData\Local\Temp`. Title links and status bar text should always represent where
> the link will take the user to.

> same applies to /etc/hosts - it goes to the windows dir, but shows as relative.

- Q: What must a hover title and a status-bar readout show? → A (maintainer, M19): **where the link will
  take the user to — always.** A readout that names a location the click will not open is worse than one
  that names none (FR-187).
- Q: Which rule was wrong? → A: **None of them** *(derived — not confirmed by the maintainer)*, and that
  is what made this hard to see. FR-024 / research R6 say a rooted non-drive path is tried against the
  **project root first**, and that is true — `resolveCandidate` really does try it first. But **"tried
  first" is not "where it goes"**: when that reading does not exist, resolution falls through to
  `IPathForms.fromMountTable`, and which reading wins is a fact about the **disk**. A hover resolves
  nothing, by round four's explicit design (FR-155; `HoveredLink` — "nothing is resolved until it is
  followed"), so the readout was publishing the first **candidate** as though it were the destination.
  Recorded as **D8**.
- Q: Could the readout just recognise the mount points and exclude them? → A: **No — it is undecidable
  by name, and the fix would breach Principle II** *(derived)*. By name `/tmp`, `/etc/hosts` and `/help`
  are one shape, and `/help` really does read against the project root (FR-174). Telling them apart
  means giving the renderer a mount table it deliberately has no port to —
  `links-no-os-names.test.ts` forbids the spellings outright — and it would still be a guess about a
  disk the hover must not touch.
- Q: So what does a rooted non-drive path read out as? → A (maintainer, M19, choosing between the two
  options put to them): **as written** — its own text. The alternative, **resolving on hover**, was
  rejected: it tells the whole truth at the cost of a `stat` per hovered link and a readout that arrives
  late on a slow share, which is the trade round four settled the other way (FR-155, SC-021). Recorded
  as a considered alternative in research **R42**.
- Q: Does a rooted path that *does* live in the project still read out as written? → A: **Yes** *(derived
  — and it is the case that proves the rule rather than the symptom)*. `/src` may well resolve to the
  project root on a given disk, and it still reads as written: naming the root for that one would mean
  naming it for `/tmp` too, since the renderer cannot tell them apart (FR-187b).
- Q: Was this a new mistake? → A: **No — it was drift** *(derived)*. `path-by-name.ts`'s own module
  header already stated this rule for its undecidable cases — *"shown AS WRITTEN rather than joined onto
  a base they do not mean — the failure this module exists to stop is a readout naming a file the click
  will never open"* — and step 3 did not implement it. The documented rule and the code disagreed, and
  the documentation was right (FR-187's note).
- Q: Does the plain-click **hint** have the same defect? → A: **Yes, and it is NOT fixed** *(derived —
  reported to the maintainer, not worked around)*. `clickTargetByName` sends `/tmp` down its relative
  branch and answers `editor`, so the hint says "Ctrl+Click to open in throng active editor" while the
  click reveals the temp folder in OS Explorer. M19's rule arguably reaches it, but they named the title
  and the status bar, and **wording a hint for an undecidable path is a design decision they have not
  made** — "Ctrl+Click to follow" and "…to open or show it" are different promises. Recorded as a known
  gap under FR-187, not silently fixed.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow a path printed in a terminal (Priority: P1)

> **Superseded in part 2026-09-19 (round four) by US13 and FR-155 / FR-160.** Scenario **7** no longer
> describes the product: text the grammar accepts is drawn as a link whether or not it names anything,
> and following one that names nothing in the project raises one notice (FR-160). Scenario **9**
> stands, and a plain click now also shows the link hint (US14). The text below is kept as it was.

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

> **Superseded in part 2026-09-19 (round four) by FR-157 – FR-159 and FR-163.** Scenario **5**: a
> `mailto:` target, or any scheme on the protocol allowlist, now goes to the OS handler for that scheme;
> `javascript:`, `data:` and unknown or refused schemes still do nothing. Scenario **6**: a well-formed
> `file:` target is a link whatever it points at, and a Ctrl+click on one outside the project opens OS
> Explorer on its parent folder without a check (FR-158). Scenario **2**'s "default link action" was
> already the click rule (FR-110). The text below is kept as it was.
> *Amended by FR-158a: one bounded file-or-folder check is made at the follow, so a `file:` target that is
> a folder opens as itself (this story's own project-folder case), and a file opens its parent.*

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

> **Superseded in part 2026-09-20 (round five) by FR-180.** Scenario **1**'s "Web links and explicit
> file hyperlinks still work" and scenario **2**'s implied carve-out no longer describe the product: a
> switch that is off hides **every** kind of link in that panel type. Everything else in both scenarios
> — the underline, the gestures, the menu, no restart — stands, and scenario 3 is untouched. The text
> below is kept as it was.

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

> **Superseded in part 2026-09-19 (round four) by FR-155 and FR-161.** Scenarios **6**, **7** and **8**
> described existence checks made while hovering, which no longer happen: a well-formed network path is
> drawn as a link at once, whether or not its server answers. Scenario **9** still holds for a
> Ctrl+click on an **in-project** network file, which is resolved when it is followed (FR-160, FR-161);
> an out-of-project network file is handed to OS Explorer without a check (FR-158). Scenarios **1 – 5**
> stand. The text below is kept as it was.
> *Amended by FR-158a and FR-122a: one bounded file-or-folder check is made at the follow, and a root
> that timed out is left alone for its back-off.*

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

> **Superseded in part 2026-09-19 (round four) by FR-164 and FR-172.** Scenario **4**'s "when the
> output stops, the resolved paths become marked" is replaced: marks are computed from the rows in view
> as they are drawn, throttled, whether or not output stops, and no existence check runs at all
> (FR-172). Scenario **3**'s "the same pointer" is now always the hand on hover (FR-164). The text
> below is kept as it was.

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

> **Superseded in part 2026-09-19 (round four) by FR-155, FR-162 and FR-163.** "Existing" in the title
> no longer governs rendering: any well-formed spelling is a link. Scenario **2**'s "a word after a path
> that exists is never swallowed into it" becomes a grammar rule (FR-162). Scenario **6**: the missing
> `file:` target and the unknown-host `file:` target are now links (FR-163); `notascheme:foo` is still
> not one. Scenario **3**'s "shown in OS Explorer" and scenario **5** stand. The text below is kept as
> it was.

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

### User Story 13 - Every well-formed link is a link, and a Ctrl+click goes where its kind says (Priority: P1) *(added 2026-09-19, round four)*

A user sees a URL, a network path, a local path, a `file:` URI, a `mailto:` address or a
`http://localhost:3000` address in a terminal or an editor. Each is marked as a link the moment it is
drawn — throng does not stop to ask whether it exists — and a Ctrl+click does what that kind of link
does: a browser for web and loopback addresses, OS Explorer for network and on-device locations
outside the project, throng for a file in the project, and the OS handler for an allowlisted protocol.
Nothing a link says can make a click run a command.

**Why this priority**: The maintainer ruled that whether a link is broken is not throng's question.
Existence checks made rendering slow, made network links flicker in and out, and are the root of D5.

**Independent Test**: Print, and type into an editor, one line of each resource class plus a path to a
file that does not exist, an in-project path that does not exist, a refused scheme and a scheme not on
the allowlist. Check what is marked without hovering, then Ctrl+click each.

**Acceptance Scenarios**:

1. **Given** `https://example.com`, `http://localhost:8080` and `http://127.0.0.1:3000`, **When** each
   is Ctrl+clicked, **Then** each opens in the OS default browser (FR-157).
2. **Given** `\\server\share\dir` and `\\server\share\dir\notes.txt`, **When** each is Ctrl+clicked,
   **Then** OS Explorer opens the folder, and for the file opens its parent folder with the file
   selected; the file is never opened or run (FR-157, FR-158).
3. **Given** `file:///D:/elsewhere/x.txt` and `D:\elsewhere\x.txt`, outside the project, **When** each
   is Ctrl+clicked, **Then** each behaves exactly as scenario 2 (FR-157, FR-158).
4. **Given** `file:///D:/proj/src/foo.ts` where `D:\proj` is the project, **When** Ctrl+clicked,
   **Then** `foo.ts` opens in throng (FR-160).
5. **Given** `D:\nowhere\missing.txt` outside the project, **Then** it is marked as a link at rest, and
   **When** Ctrl+clicked, **Then** OS Explorer is asked for `D:\nowhere` with no check first (FR-155,
   FR-158).
   *Amended 2026-09-19 (planning) by FR-158a: one bounded file-or-folder check is made at the follow;
   the file is not found, so OS Explorer is asked for `D:\nowhere` and throng raises no notice.*
6. **Given** `src/missing.ts` in a project that has no such file, **Then** it is marked as a link, and
   **When** Ctrl+clicked, **Then** exactly one notice names the path and says it was not found, and no
   editor opens (FR-160).
7. **Given** `mailto:someone@example.com` with shipped settings, **When** Ctrl+clicked, **Then** the OS
   mail handler opens it (FR-159).
8. **Given** `ms-msdt:/id PCWDiagnostic`, `search-ms:query=x`, `javascript:alert(1)` and
   `vbscript:msgbox`, **Then** none is a link, and **Given** the user adds `ms-msdt` to the allowlist,
   **Then** it is still not a link (FR-159).
9. **Given** `zoommtg://x` not on the allowlist, **Then** it is not a link; **When** the user adds
   `zoommtg` to the allowlist, **Then** it becomes one with no restart (FR-159).
10. **Given** a link whose text carries leading or trailing whitespace, control characters, or shell
    metacharacters (`D:\x.txt & calc`, `"C:\a.txt" --flag`), **When** it is Ctrl+clicked, **Then**
    only the validated location or URI reaches the OS, and no command runs (FR-156).
11. **Given** a terminal streaming output continuously and an editor on a large file, **Then** no
    existence check runs before any Ctrl+click or Link-menu opening (FR-155, SC-021).

---

### User Story 14 - A plain click on a link says how to follow it (Priority: P1) *(added 2026-09-19, round four)*

A user plain-clicks a link out of habit. Instead of nothing happening, a small hint appears just below
and to the right of the link for a moment: *Ctrl+Click to open in throng active editor*. It does not
take focus, the click still does what a click does there, and it is gone as soon as they press Ctrl.

**Why this priority**: Principle VI makes a plain click on a link do nothing, which is a dead end
unless something says why. The maintainer asked for one hint that behaves the same everywhere.

**Independent Test**: In an editor, a terminal and a Markdown preview, plain-click a link near each
edge of the window, a link that wraps over two rows, and a link while a hint is already showing
elsewhere. Then hover without clicking, Ctrl+click, and press Ctrl while a hint shows.

**Acceptance Scenarios**:

1. **Given** a valid link in an editor, **When** it is plain-clicked, **Then** the link hint appears at
   the link's bottom-right, names Ctrl+Click and what it will do, covers none of the link's text, and
   the caret is placed where the click landed (FR-165).
2. **Given** a link in the bottom-right corner of the window, **When** it is plain-clicked, **Then** the
   hint is moved to stay fully on screen, by the rule the context menu uses (FR-165).
3. **Given** a link wrapped over two terminal rows, **When** either row is plain-clicked, **Then** the
   hint is anchored at the bottom-right of the link's last row (FR-165).
4. **Given** a hint showing in one panel, **When** a link in another panel or window is plain-clicked,
   **Then** the first hint is gone and only the new one shows (FR-166).
5. **Given** a hint showing, **When** the user presses Ctrl or Ctrl+clicks a link, **Then** the hint
   hides at once (FR-165).
6. **Given** a link, **When** it is hovered, or Ctrl+clicked, **Then** no hint appears (FR-165).
7. **Given** a hint showing, **When** the user clicks or types where it sits, **Then** the input reaches
   the panel beneath, and the hint never had keyboard focus (FR-165).
8. **Given** file-link detection off for editors, **When** a detected path's text is plain-clicked,
   **Then** no hint appears; **Given** a web link in that editor, **Then** it still shows one (FR-165,
   FR-060).
   *Superseded in part 2026-09-20 (round five) by FR-180: the second clause is withdrawn — with the
   editor switch off a web link is not a link there either, so it shows no hint. The first clause
   stands.*
9. **Given** the same link kind in an editor, a terminal and a Markdown preview, **When** each is
   plain-clicked, **Then** the three hints look, behave and read the same (FR-166).

---

### User Story 15 - One Link menu, the same everywhere (Priority: P2) *(added 2026-09-19, round four)*

A user right-clicks a link in a terminal, an editor or a Markdown preview and gets the same Link menu:
Open Link, the editor targets under Open In, the OS targets and Copy Link Address, with only the items
that make sense for that link.

**Why this priority**: The link items were three different menus' leading sections. One component
makes them identical by construction, as FR-104 did for detection.

**Independent Test**: Right-click an in-project `.ts` file, an in-project `.md` file, an in-project
executable, an out-of-project file, a folder, a web link and a `mailto:` link in each of the three
surfaces, and compare the menus.

**Acceptance Scenarios**:

1. **Given** an in-project `.ts` file link, **When** it is right-clicked with no selection, **Then** the
   Link menu offers Open Link, Open In ▸ New Editor / Active Editor / each open editor by name, Open in
   OS Explorer, Open in OS Default Program and Copy Link Address, and no Open Preview (FR-170).
2. **Given** an in-project `.md` file with the Markdown provider enabled, **Then** Open Preview is also
   offered; **Given** the provider disabled, **Then** it is drawn disabled (FR-170, FR-030).
3. **Given** an in-project `deploy.ps1`, **Then** Open Program is offered and Open in OS Default Program
   is not; **When** Open Link is chosen, **Then** it opens in throng as text and does not run (FR-170,
   FR-111).
4. **Given** an out-of-project file, **Then** no Open In ▸ or Open Preview item is drawn (FR-170,
   FR-055).
5. **Given** a web link or a `mailto:` link, **Then** the Link menu offers Open Link and Copy Link
   Address only (FR-170).
6. **Given** text selected, **When** the user right-clicks over a link, **Then** the panel's ordinary
   context menu appears instead (FR-171).
7. **Given** the same link in a terminal, an editor and a Markdown preview, **Then** the three Link
   menus are identical (FR-169).
8. **Given** the Link menu opened from the keyboard (`menu.open`) over a terminal link, **Then** it
   offers the same items as a right-click (FR-171).

*Relabelled 2026-09-19 by FR-175: "Copy Link Address" in this story's introduction and in scenarios 1
and 5 reads **Copy Link to Clipboard**. Scenario 7's "identical" excludes the Open Link chord, which is
shown only where bound (FR-169's note).*

---

### User Story 16 - See where a link goes before clicking (Priority: P3) *(added 2026-09-19, round four)*

A user hovers a link in a terminal or an editor and reads its full target at the bottom-left of that
panel's status bar, as they already can in a Markdown preview.

**Why this priority**: A long or truncated link's real target is otherwise visible only in a tooltip
after a delay.

**Independent Test**: Hover a long web link, a network path and an OSC 8 hyperlink whose text differs
from its target, in a terminal and an editor with the status bar shown and then hidden.

**Acceptance Scenarios**:

1. **Given** the status bar shown, **When** a link is hovered, **Then** its full target appears at the
   bottom-left of that panel's status bar, to the right of any persistent content, and clears when the
   pointer leaves (FR-167).
2. **Given** an OSC 8 hyperlink whose text is `README`, **When** hovered, **Then** the readout shows its
   target, not its text (FR-167).
3. **Given** the status bar hidden, **When** a link is hovered, **Then** nothing is shown and nothing
   else changes (FR-167).

---

### Edge Cases

- **A web link inside a path-like run** (`https://host/src/foo.ts:42`) is a web link only. A span is
  never both a web link and a file link.
- **A path and its position are ambiguous** (`C:\x\foo.ts:42:7` against a Windows drive colon). The
  drive colon is part of the path, and the trailing `:line[:col]` is a position only when the path
  without it resolves.
  *Superseded in part 2026-09-19 by FR-155: with no existence check, a trailing `:line[:col]` or
  `(line,col)` of digits is read as the position by grammar alone (derived — not confirmed by the
  maintainer); the drive colon is still part of the path.*
- **A position beyond the file's end.** The file opens with the cursor at the nearest valid position.
  This is not an error.
- **A file that exists when underlined and is gone when followed.** Following it does nothing to the
  file, raises one notice naming the path (the *one condition, one notice* rule), and the underline
  disappears. Following a link never creates a file.
  *Superseded in part 2026-09-19 by FR-155, FR-158 and FR-160: the notice stands for an in-project
  file; the underline stays, because it never depended on existence; an out-of-project file is handed
  to OS Explorer on its parent folder without a check.* *Amended by FR-158a: one bounded
  file-or-folder check is made at the follow; a file that is gone is revealed on its parent.*
- **A file created after the text was printed** becomes a link on the next hover, rather than staying
  dead until a restart (FR-070).
  *Superseded 2026-09-19 by FR-155: it was a link all along, because validity is syntactic.*
- **An unreachable network location** (an offline `\\server\share`). It is never underlined while its
  existence is unknown, and the check never blocks output, typing or the pointer (FR-071).
  *Superseded 2026-09-19 by FR-155 and FR-161: it is underlined as soon as it is drawn; a check
  happens only when an in-project one is followed, bounded by the timeout.* *Amended by FR-158a and
  FR-170: one bounded check is made at every follow of a network or on-device location and once at each
  Link-menu opening — never before.* *Amended by FR-158d and FR-122a: a folder by grammar and a root in
  its back-off make no check at all.*
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
  *Superseded 2026-09-19 by FR-155 and FR-161: it is underlined when drawn; the timeout, the per-root
  gate and the back-off now bound only the checks made when an in-project link is followed or the Link
  menu opens.* *Amended by FR-158a: every follow of a network or on-device location makes one bounded
  check, in the project or not, and so does each Link-menu opening.* *Amended by FR-158d and FR-122a:
  except a folder by grammar, and a root still in its back-off, which answer without touching the disk.*
- *(added 2026-09-18)* **A mapped drive letter for a share** (`Z:\proj\x.ts` where `Z:` is
  `\\server\share`) is judged by the name it was written with. If the project was opened as
  `\\server\share\proj`, a `Z:` link to a file in it is outside the project by name and is shown in
  OS Explorer — never opened in throng on a guess (FR-106, Principle I). Its existence check is
  bounded like any other volume root's (FR-121).
- *(added 2026-09-18)* **A `mailto:` or other non-web scheme written in an editor** is not a link,
  exactly as in a terminal (FR-013, FR-100).
  *Superseded in part 2026-09-19 by FR-159: a scheme on the protocol allowlist (`mailto:` ships on it)
  is a link in both panel types; every other non-web scheme still is not.*
- *(added 2026-09-18, second round)* **A program that breaks a long path with its own newline** (a
  TUI that wraps text itself) has printed two lines, not one wrapped line. Joining them would be a
  guess, so each half is judged on its own (FR-132). An **OSC 8** link a program re-emits on each
  line with the same target is the exception: the target was declared, so every piece is the same
  link.
- *(added 2026-09-18, second round)* **Output that never stops** (a `tail -f`, a spinner). The idle
  scan never starts, so detected paths are marked only when hovered — the same state as before this
  amendment, never worse (FR-137).
  *Superseded 2026-09-19 by FR-172: marks are computed from the rows in view as they are drawn,
  throttled, so output that never stops is marked like any other — the case D5 is.*
- *(added 2026-09-18, second round)* **A detected path whose file is deleted while it is marked.**
  The watcher invalidation (FR-070) removes the mark on the next idle scan or hover.
  *Superseded 2026-09-19 by FR-155: the mark stays, because it never depended on existence.*
- *(added 2026-09-18, third round)* **A path with a space followed by more prose** (`see C:\Program
  Files\x.txt for details`). The longest reading that exists wins, so the link ends at `x.txt` and
  `for details` stays text. If no longer reading exists, the unextended token is judged alone, exactly
  as before (FR-150).
  *Superseded 2026-09-19 by FR-162: the grammar decides — `for` is neither separated nor dotted, so
  the link ends at `x.txt` without asking the filesystem.* *FR-162 is itself superseded by FR-173 /
  FR-179: the outcome is the same — the scan ends at the first known extension, `x.txt`.*
- *(added 2026-09-18, third round)* **Two absolute paths separated by one space** (`C:\a.txt
  C:\b.txt`). A reading never extends into a word that itself begins an anchored path, so each is its
  own link (FR-150).
- *(added 2026-09-18, third round)* **Git for Windows not installed.** No mount table exists, so
  FR-151's step is skipped and a rooted path falls through to the project root and the drive forms
  alone, as before.
- *(added 2026-09-18, third round)* **A program's OSC 8 link whose target stops existing while it is
  on screen.** Its mark is removed by the same watcher invalidation as a detected path's (FR-070,
  FR-154).
  *Superseded 2026-09-19 by FR-163: its mark stays; a well-formed `file:` target is a link whatever it
  points at.*
- *(added 2026-09-19, round four)* **A path with a space followed by a dotted word that is prose**
  (`see C:\a b.txt then e.g. more`). The grammar extends while words look path-like, so `then` stops
  it; a dotted prose word directly after a path (`C:\a.txt e.g.`) may be swallowed. M4's verified case
  list decides what the grammar does here (FR-162).
  *Superseded by FR-173 / FR-179: a bare path stops at its first space, and a scan ends at the first
  word with a separator or a known extension, so `C:\a.txt e.g.` is `C:\a.txt` and nothing is swallowed.*
- *(added 2026-09-19, round four)* **A link wider than the window, or at the window's edge.** The link
  hint is repositioned to stay on screen by the context menu's clamping rule, and may then cover part
  of the link; staying visible wins over not obscuring (FR-165, derived — not confirmed by the
  maintainer).
- *(added 2026-09-19, round four)* **A plain click on a link inside a selection, or a click that
  drags.** A drag is a selection and shows no hint; a plain click with no drag shows it (FR-165).
- *(added 2026-09-19, round four)* **A full-screen program that switches to the alternate screen and
  back** (Claude Code, vim). The marks are rebuilt for whichever buffer is shown; none is left from the
  other (FR-172, D5).
- *(added 2026-09-19, round four)* **A crafted link** (`file:///C:/x.txt%00.exe`, `https://x"
  --new-window`, a path ending in `& calc`). Nothing after validation reaches the OS but the validated
  location or URI, and no link can run a command (FR-156).
- *(added 2026-09-19, maintainer)* **A bare path followed by a space** (`/file 1`). Only `/file` is the
  link; wrap it in backticks, quotes or brackets, or let it end in a separator or a known extension, to
  carry the space (FR-173).
- *(added 2026-09-19, maintainer)* **A one-segment rooted word in prose** (`see /help`). It is a link
  (FR-174). Following it resolves it like any leading-`/` path.
- *(added 2026-09-19)* **A drive form that also exists under the project** (`/d/git/x.ts` with a
  `<root>\d\git\x.ts`). It is the drive's file, not the project's (FR-176).

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
  *Superseded 2026-09-19 (round four) by FR-155: validity is syntactic, and a well-formed candidate is
  drawn and offered as a link whether or not it exists. What happens when one that does not exist is
  followed is FR-158 and FR-160.*
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
  *Superseded in part 2026-09-19 (round four) by FR-159 and FR-163: a scheme on the protocol allowlist
  (`mailto:` ships on it) is now followable through the OS handler; `javascript:`, `data:`, every
  refused scheme and every scheme not on the allowlist stay unopenable. The last sentence is withdrawn:
  a well-formed `file:` target is a link whether or not it resolves.*

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
  *Reach marked 2026-09-20 (round five, D8): **this requirement is unchanged**, and it governs
  **resolution** — which reading is tried first, and "the first location that exists wins", which is a
  fact about the disk. It does NOT license a hover to name the project root, because a hover resolves
  nothing (FR-155) and so never learns which reading won. What a readout or a title may claim is
  FR-187's, not FR-024's; reading FR-024 as an answer to that question is exactly what produced D8.*
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

  *Superseded 2026-09-19 (round four) by FR-169 – FR-171: the link items no longer lead each panel's
  context menu; a right-click or `menu.open` over a link with no selection opens the one Link menu,
  whose items FR-170 lists. The selection rule stands (FR-171), and the chord rule of the amendment
  above carries into the Link menu's Open Link item unchanged.*
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
  *Superseded in part 2026-09-19 by FR-158b (**S10**): the table's "re-checks that it exists before
  acting" becomes FR-158a's file-or-folder check; the re-resolution confinement is unchanged.*

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
  *Superseded in part 2026-09-19 by FR-158b (**S10**): for a reveal, the existence re-check is FR-158a's
  file-or-folder check and a missing location is revealed on its parent; the re-check stands for every
  action that needs the file itself. The open-external clause is amended by S5 (allowlisted schemes on
  their own channel).*
- **FR-038**: When throng itself runs elevated, Open in OS Default Program and Open in OS Explorer
  MUST NOT start the launched application with administrator rights. This extends Principle III's
  de-elevation rule, so that a link printed by a non-elevated terminal cannot start an elevated
  program.
  *Unchanged 2026-09-18 (third round); not yet met by the shipped app — defect **D4**: the only
  production construction of `ElectronShellIntegration` supplies no de-elevating launcher.*
  *Note 2026-09-19: the note above is out of date. D4 is fixed (T217/T218): `main.ts` builds the shell
  integration through `createAppShellIntegration`, which supplies `WindowsDeElevatedLauncher`
  (`packages/ui/src/main/electron-shell-integration.ts`), and `d9332b3c` withholds it only under the
  E2E harness's marker. FR-038 is met. Found by the baseline converge of 2026-09-19 (`dbbd4d89`).*
  *Amended 2026-09-19 (review round four, M3): a de-elevated launch that FAILS is now a refusal, not a
  silent success. `deElevate` called `launcher.launch(file, args)` without `launch`'s third argument —
  the `report` callback 019 FR-015 added so a failed launch is distinguishable from a slow one — and
  returned `true`, so all three call sites answered `{ ok: true }` / a bare `return`. On an elevated
  host where the launch failed the user got no window, no notice and nothing in the UI, every time,
  which FR-036 and *one condition, one notice* both forbid. The callback now decides the answer and its
  words travel as `osReason`. Because the launcher is fire-and-forget and reports only on failure,
  silence for `DE_ELEVATED_LAUNCH_REPORT_MS` (2 s) is what success looks like; the wait is invisible,
  since the Explorer window is already on screen and a success draws nothing. The E2E harness cannot
  see any of this — its launcher's `isAvailable()` is `false` — so the proof is
  `packages/ui/tests/unit/de-elevated-launch-failure.test.ts`.*
  *Extended 2026-09-19 (fifth analysis pass, derived): **Open Program** (FR-170) is the same launch as
  Open in OS Default Program for an executable, so it goes through the same seam
  (`IShellIntegration.openWithDefaultProgram`, through the de-elevating launcher) and MUST NOT start the
  program elevated either.*
- **FR-039**: When the resolved target is an **executable file** (FR-039a), Ctrl+click, the Open Link
  chord and the plain **Open Link** menu item MUST NOT run it, whatever the default link action is set
  to. All three MUST perform **Open in OS Explorer** for it instead, with the file selected in its
  folder. Running it MUST remain possible only through the explicit **Open in OS Default Program**
  menu item, which MUST still be offered for it (FR-030) and MUST still run it when chosen.
  *Superseded in part 2026-09-19 by FR-170 (**S8**): for an executable that item is labelled **Open
  Program**; the guarantee — one explicit, named route runs it — is unchanged.*
  *Superseded in part 2026-09-18 by FR-111 and FR-114. The guarantee — no gesture and no plain Open
  Link item runs it — now holds for **every** file, not only executables (FR-111). The instead-clause
  — "perform Open in OS Explorer" — now applies only outside the project; an in-project executable
  opens in throng as its text, like any in-project file (FR-114). The last sentence is unchanged.*
- **FR-039a** *(carve-out 2026-09-19: FR-178b — the known-extension list is not an executable
  classification)*: Whether a file is executable MUST be decided by a single rule, stated once and behind
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
  *Superseded in part 2026-09-20 (round five, maintainer M12) by FR-169a and FR-169b: the hover shows a
  native `title` carrying the link's full target, which names no gesture; the gesture is named by the
  link hint a plain click raises (FR-165), so "a plain click that does nothing is never a dead end"
  still holds. The **Link hover tooltip delay** setting is retired with the tooltip it delayed, and the
  second sentence is withdrawn. The underline stands, at the prominence FR-184 sets.*
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
  *Extended 2026-09-19 by FR-060a: allowlisted protocol links are not affected either.*
  *Superseded 2026-09-20 (round five, maintainer M13) by FR-180: the last sentence is withdrawn and
  FR-060a with it. The switch governs **every** kind of link — detected paths, web links, allowlisted
  protocol links and OSC 8 hyperlinks alike: on, all are shown; off, none is. The first two sentences
  stand, and the labels lose the word "file" (FR-180b).*
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
  *Extended 2026-09-19 (round four) by FR-159 and FR-161: the protocol allowlist gains a descriptor
  under Editor · Links, and the timeout's descriptor text says it bounds following a link, not drawing
  one.* *Extended again the same day by FR-178: the known-file-extensions list gains a descriptor there
  too.*
  *Amended 2026-09-20 (round five): the Editor · Links block is **five** consecutive descriptors — the
  two switches (relabelled by FR-180b), the timeout (relabelled by FR-181), the protocol allowlist and
  the one known-extension list (FR-182, replacing FR-178a's pair). `terminals.linkHoverDelayMs`'s
  descriptor is removed with the setting (FR-169b), which leaves the Terminal group carrying the
  hyperlink-advertising switch alone from this feature. The adjacency rule is unchanged and still
  load-bearing.*
- **FR-062**: The Open Link command's key-binding descriptor MUST describe its wider scope (FR-045), so
  the Key Bindings editor lists it for editors as well as previews.

#### Performance

- **FR-070**: Existence checks MUST run lazily — on hover, or for the visible range — and their results
  MUST be cached. A cached answer MUST NOT outlive a change to that location, so a file created later
  becomes a link and a deleted one stops being one.
  *Superseded 2026-09-19 (round four) by FR-155: no existence check runs for rendering, so there is
  nothing to run lazily or cache for it. A cache kept for click-time resolution (FR-160) is bound by
  this requirement's second sentence.*
- **FR-071**: An existence check MUST NEVER run on the terminal's output path or on the editor's typing
  path, and MUST NEVER block output, typing, scrolling or the pointer. A location whose existence is not
  yet known, or that takes too long to answer, MUST be treated as not a link until it answers.
  *Superseded in part 2026-09-19 (round four) by FR-155: the first sentence stands and now binds the
  click-time checks too; the second is withdrawn — a well-formed link is a link without an answer.*
  *Clarified 2026-09-19 (review round four, L2): `MAX_LINK_CANDIDATES_PER_LINE` bounds DECLARED
  addresses — web and allowlisted protocol spans — as well as guessed paths. It bounded
  `scanned.paths` alone, so the protocol spans round four added were built unbounded at all three call
  sites (`file-link-provider.ts`, `link-view-marks.ts`, `link-decorations.ts`), and
  `detectProtocolSpans` has no cap of its own. A terminal line is bounded by the column count; an
  EDITOR line is not, so a one-line minified or generated file dense in `mailto:` tokens is the
  reachable case.*
- **FR-072**: A test MUST assert that no existence check runs while terminal output is being delivered.
  *Strengthened 2026-09-19 (round four) by FR-155 / SC-021: the test asserts no existence check runs for
  rendering at all, in either panel type, before a Ctrl+click or a Link-menu opening.*
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
  *Amended 2026-09-19 (round four): the docs also describe syntactic validity and the five resource
  classes (FR-155, FR-157), the protocol allowlist and refused set (FR-159), what the timeout now bounds
  (FR-161), the link hint (FR-165), the Link menu (FR-169 – FR-171) and the status-bar readout
  (FR-167), in the same change that ships each.*
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
  *Amended 2026-09-20 (round five): the hover-delay difference is gone with the setting (FR-169b), so
  Ctrl+Enter is the only permitted difference left; and "underlined on hover with a tooltip naming the
  gesture" reads, for the tooltip, as FR-169a's native `title` carrying the target — the gesture is
  named by the link hint (FR-165).*
- **FR-101**: An editor MUST detect plain-text web links within its visible range (FR-073), as a
  terminal does. Web-link detection in an editor MUST NOT be governed by the editor file-link
  detection switch, exactly as a terminal's is not governed by the terminal one (FR-060).
  *Superseded in part 2026-09-20 (round five, maintainer M13) by FR-180: the second sentence is
  withdrawn in both panel types — a web link is governed by its panel type's switch like every other
  kind. The first sentence, and the parity it states, stand.*
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
  *Refined 2026-09-19 (round four) by FR-168: a file that opens in an editor says which one — "…to open
  in throng active editor" or "…new editor" — following the open-target preference.*
  *Superseded 2026-09-20 (round five, maintainer M12) by FR-169a as the **hover's** text: the hover
  shows the target and nothing else. Every word of this requirement stands as the **link hint's** text
  (FR-165), which is where "the gesture and where it goes" is said now.*
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
  *Superseded in part 2026-09-19 (round four) by FR-155, FR-157 and FR-160: the last row is withdrawn —
  a well-formed link is a link whether or not it exists; the other rows are restated by resource class
  in FR-157, and the in-project row resolves at the moment of the follow (FR-160).*
- **FR-111**: **A Ctrl+click never executes a file and never opens it in its default program.** No
  gesture and no plain Open Link item MAY hand any file to the OS to open or run, whatever its type,
  in the project or not. **Open in OS Default Program**, chosen by name from the link menu, MUST
  remain offered for every file (FR-030) and MUST remain the only route that does (FR-036, FR-038
  unchanged). The shared decision MUST make this a property of its type — the click rule's result type
  cannot express the default program — rather than a clause a later change could skip.
  *Superseded in part 2026-09-19 by FR-170 (**S8**): "Open in OS Default Program … offered for every
  file … the only route" reads "Open in OS Default Program for a non-executable file, **Open Program**
  for an executable — each the only route for its file". The first sentence is unchanged.*
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
  *Superseded in part 2026-09-19 (round four) by FR-161: the setting, its default and its bounds stand,
  but it no longer governs rendering — only the checks made when a link is followed or the Link menu
  opens. "Unreachable … is not a link" is withdrawn for rendering (FR-155).*
- **FR-121**: An unreachable location MUST NOT be able to multiply its cost. While one check under a
  **volume root** is still outstanding past the timeout, every further check under that root MUST
  answer unreachable **at once, without touching the filesystem**; and the number of checks
  outstanding past the timeout across the whole process MUST be capped, so that filesystem work that
  has nothing to do with links — saving, reading, watching — is never starved by an offline share.
  A check under any other volume root MUST be unaffected.
  *Clarified 2026-09-18 (`c2d5c858`): when the cap is reached, only a check under another **network**
  root answers unreachable at once; a local drive root is never gated by the cap.*
  *Re-scoped 2026-09-19 (round four) by FR-161: the gate stands for the click-time and menu-open checks,
  which are the only checks left.*
- **FR-122**: A volume root that timed out MUST be left alone for a back-off period (the link cache's
  TTL, FR-070), after which the next hover MUST try again, so a share that comes back online becomes
  linkable without a restart.
  *Superseded in part 2026-09-19 (round four) by FR-155 and FR-161: the back-off stands for click-time
  and menu-open checks, and "the next hover" reads "the next follow or menu opening"; a share's links are
  drawn whether it is online or not.*
- **FR-123**: An answer that arrives after a surface has stopped waiting for it MUST take effect
  **without the user having to move the pointer off the line and back** — a slow share's path
  becomes a link on the hover that asked. FR-071's "treated as not a link **until it answers**" is
  read as binding in both directions. In a terminal this is the case xterm's per-line reply cache
  defeats today: `file-link-provider.ts` holds its reply for `LINK_ANSWER_DEADLINE_MS` and a later
  answer is filed nowhere.
  *Superseded 2026-09-19 (round four) by FR-155: no surface waits for an existence answer before drawing
  a link, so there is no late answer to honour. The baseline converge's T226 is moot in its renderer
  half for this reason; its main-process half (one deadline per request) serves FR-124 and FR-161.*
- **FR-124**: Following a link whose location stops answering (FR-037's re-check) MUST end within
  the timeout and raise **one** notice naming the path and saying the location **did not answer** —
  a reason distinct from "no longer exists", because the remedy differs (reconnect, not re-create).
  One condition, one notice (CLAUDE.md), through the shared failure presentation (030).
  *Kept 2026-09-19 (round four) for an in-project link, the only follow that still checks (FR-160);
  "within the timeout" is a total across every reading tried (the baseline converge's T227). An
  out-of-project location is handed to OS Explorer unchecked (FR-158), which reports it itself.*

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
  *Superseded in part 2026-09-19 (round four) by FR-172: the first half stands. For marks, a logical
  line is joined when the rows in view are drawn (throttled), not only when a row is asked about; it is
  still never done per output chunk, and no existence check is made.*

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
  *Superseded in part 2026-09-19 (round four) by FR-164: the third row is withdrawn — a valid link
  shows the hand on hover whether or not the modifier is held. The at-rest and hovered rows stand, and
  D5 is a defect against them.*
  *Superseded in part 2026-09-20 (round five) by FR-169a and FR-184: the hovered row's tooltip clause is
  withdrawn — there is no tooltip of throng's and no hover delay, and the hover shows a native `title`
  carrying the target (FR-169a). The underline rows stand with their prominence changed: translucent at
  rest, solid on hover (FR-184). "The text's own colour is unchanged" is unchanged.*
- **FR-136**: A link MUST be marked **at rest**, not only on hover. A hover-only mark means a user has
  to sweep the pointer over the screen to discover what is clickable, which is what the maintainer
  reported as "not clear". The editor already marks resolved links in its visible range at rest
  (FR-073); web links and OSC 8 links need no existence check and are marked as they are drawn.
  *Superseded in part 2026-09-18 (third round) by FR-154: "OSC 8 links need no existence check" holds
  for an `http`/`https` target only. An OSC 8 `file:` target is marked only once it has resolved, as
  a detected path is (FR-137), and an OSC 8 target of any other scheme is never marked.*
  *Superseded in part 2026-09-19 (round four) by FR-155 and FR-163: every valid link — a detected path
  and an OSC 8 `file:` target included — is marked as it is drawn, with no existence check; an
  allowlisted scheme is marked too, and any other scheme is still never marked.*
- **FR-137**: **A detected path is marked at rest only once it has resolved** (FR-006), and the rules
  that forbid an existence check on the output path stand unchanged (FR-071, FR-072). They are squared
  this way: in a terminal, the rows **in view** are resolved by an **idle scan** that starts only
  after the terminal's output has been quiet for a short interval, is cancelled by the next output,
  is bounded by the per-line candidate cap (FR-071) and by the visible rows, and reads and fills the
  same cache hover does (FR-070). While output streams, nothing is checked and unresolved paths are
  simply unmarked — the pre-amendment state — and a hover still resolves one on demand. FR-072's test
  keeps asserting zero checks during delivery, and gains the assertion that the idle scan waits for
  quiet and yields to output. FR-070's "on hover, or for the visible range" already permits this.
  *Superseded 2026-09-19 (round four) by FR-155 and FR-172: a detected path is marked at rest as soon
  as the grammar accepts it. The idle scan existed only to make existence checks safe; with none, marks
  are computed from the rows in view as they are drawn, throttled — and waiting for quiet output is the
  cause of D5.*
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
  *Superseded in part 2026-09-19 (round four) by FR-162: which reading is the link is decided by a
  greedy, syntactic path-likeness rule, not by "longest first … the first that resolves". The anchored
  start, the stopping rules, the word cap and the bare-word rule stand.*
  *Superseded 2026-09-19 (maintainer) by FR-173: an undelimited link does not span a space unless
  FR-173d (a trailing separator) or FR-173e (a known extension) applies; the stopping rules and the word
  cap carry into those two.*
- **FR-151**: **A rooted POSIX path means what Git Bash means by it.** Where Git for Windows is
  installed, a leading-`/` path that is not a drive form and does not exist under the project root
  MUST next be mapped through **Git Bash's own mount table** — its install root for `/`, and the mount
  points Git declares (for example `/usr/bin` and `/bin`, `/etc`, and `/tmp` as the user's temp folder)
  — and that location tried before the platform's own meaning (FR-024). This holds in every built-in
  flavour and in an editor, because the text is the same whichever shell printed it and FR-104
  requires one answer. It MUST NOT apply in a **WSL** flavour, where a Linux path names the distro's
  filesystem: there a leading-`/` path tries the project root and FR-025's `/mnt/<drive>` form only.
  *(Clarified 2026-09-19 by FR-177, maintainer: "FR-025's `/mnt/<drive>` form" reads "FR-025's drive
  forms" — `/c/…` maps in WSL too.)*
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
  *Superseded in part 2026-09-19 (round four) by FR-163: a well-formed `file:` target is a link whether
  or not it resolves, and an allowlisted scheme is a link. The rule stands for a target of any other
  scheme and for an empty target: no affordance, a Ctrl+click reaches the program, and no notice.*

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

*Note 2026-09-19: D4 is closed. T217 reproduced it and T218 fixed it — `main.ts` now builds the shell
integration through `createAppShellIntegration`, which supplies `WindowsDeElevatedLauncher`; `d9332b3c`
withholds the launcher only under the E2E harness's marker. The paragraph above records the defect as
found and is kept as written.*

#### Syntactic links and five resource classes *(added 2026-09-19 — round four)*

- **FR-155**: **Validity is syntactic.** A link MUST be drawn, marked at rest, given its hover state,
  pointer, tooltip and status-bar readout, and offered the Link menu when the link grammar accepts it as
  well formed and it names a resource of one of FR-157's classes — **without any existence check**. No
  surface MUST check whether a location exists in order to draw, mark or describe a link. The only
  existence checks left are those FR-160 and FR-170 make when a user follows a link or opens its Link
  menu. This supersedes FR-006, FR-070 and FR-071's second sentence, FR-120 – FR-123 as rendering
  rules, FR-137, FR-150's longest-existing reading and FR-154's resolved-only marking (each marked where
  it stands). SC-003's prose fixture MUST still yield zero spans, now by grammar alone.
- **FR-156**: **Input is validated and sanitised before it is clickable.** A candidate MUST be trimmed of
  surrounding whitespace and have its prefix validated against FR-157's classes before it is rendered
  clickable. Following a link MUST hand the OS only a validated location (for OS Explorer, or for a file
  opened in throng) or a validated URI of an allowed scheme, as a single value — never as a command
  line, never with arguments, and never with control characters, embedded NULs or quote-delimited
  trailing text that could be read as a second argument. No crafted link text or OSC 8 target MUST be
  able to execute a command when clicked. FR-037 stands: a `file:` URI never reaches the OS URL opener.
  *Clarified 2026-09-19 (review round four, M1): "control characters" means raw OR percent-encoded —
  `%0D`, `%09`, `%1B`, `%7F`, `%85` as well as the already-refused `%00`. Until this round only `%00`
  was percent-aware, and `hasControl` reads raw code units, so an encoded control character passed. An
  OPAQUE URI makes that reachable: `URI_SCHEME` requires `://`, so `mailto:a@b.c%0D%0ABcc:…` never
  reached the `URL` parser, left `sanitiseLinkTarget` as written, and was handed verbatim to
  `shell.openExternal` — a mail client opening with a header the user never typed. The refusal applies
  to every target, path and URI alike, and to the cut-away quoted tail, exactly as `%00` already did.*
  *Extended 2026-09-19 (review round four, M2 — derived, not confirmed by the maintainer): a Win32
  DEVICE-namespace spelling — `\\?\…`, `\\.\pipe\…`, `\\?\GLOBALROOT\Device\…`, in either separator —
  is refused, so it is neither drawn nor followed, and FR-157 classifies it `null` rather than a UNC
  path. `?` and `.` are both `[^\\/]`, so every layer's UNC shape matched them: they drew as links,
  resolved verbatim, were stat-ed, and were handed to the file manager. Refusing rather than supporting
  them, for two reasons. There is nothing to open — `\\.\pipe\…` names a device object and the file
  manager declines a `\\?\` spelling — so the best case was one refusal notice for a gesture that could
  never work. And `\\?\` is precisely the prefix that disables path normalisation, while FR-021's
  confinement (`isUnderPath`, and `comparable()` in `file-link-resolver.ts`) is a string comparison
  that assumes normalised input: a `\\?\` spelling is a second spelling of a path that check has never
  been shown to agree about. A server named anything but exactly `?` or `.`, and a file named `?` or
  `.hidden` inside an ordinary share, are untouched — the test is on the first component only.*
- **FR-157**: A Ctrl+click, the Open Link chord (editors) and the plain **Open Link** item MUST do this
  for each **resource class**:

  | Class | Recognised as | What a Ctrl+click does |
  |---|---|---|
  | 1. **Web** | `http` / `https` | Opens in the OS default browser (024 FR-019, unchanged) |
  | 2. **UNC path** | `\\server\share\…`, `//server/share/…`, `FileSystem::\\…` | A folder opens in OS Explorer; a file opens its **parent** folder in OS Explorer with the file selected. The file is never invoked (FR-158) |
  | 3. **On-device file** | a `file:` URI, and every other local path spelling (FR-003) *(derived — not confirmed by the maintainer)* | Exactly as a UNC path, unless it is in the project (FR-160) |
  | 4. **Action protocol** | a scheme on the protocol allowlist (FR-159) | Handed to the OS default handler for that scheme |
  | 5. **Loopback** | `http(s)://localhost…`, `http(s)://127.0.0.1…`, `http(s)://[::1]…` | As web |

  FR-110's rows for web links, out-of-project files and folders are restated by this table and
  unchanged in effect; its row for an in-project file is FR-160; its row "nothing that exists — not a
  link" is withdrawn (FR-155). FR-111 stands unchanged: no gesture and no plain Open Link item hands a
  file to its default program or runs it.
  *Clarified 2026-09-19 (sixth analysis pass): row 2 carries row 3's exception too — a UNC file **in the
  project** (a project opened at `\\server\share\proj`) opens in throng (FR-160).*
- **FR-158**: A UNC path or on-device location **outside the project** MUST be handed to OS Explorer on
  its parent folder (or, for a location written with a trailing separator or an OSC 8 target the program
  declared a folder, on itself) **without an existence check** *(derived — not confirmed by the
  maintainer)*. If that folder cannot be reached, OS Explorer reports it and throng raises no notice of
  its own. The reveal policy is FR-035a's `throng:links:reveal`, re-resolving from the request, less its
  existence re-check for this case.
  *Superseded in part 2026-09-19 (planning, derived) by FR-158a.*
- **FR-158a** *(2026-09-19, planning — derived, not confirmed by the maintainer)*: to honour FR-157's
  "a folder opens in OS Explorer", a follow of a UNC or on-device location MAY make **one** file-or-folder
  check, bounded by FR-161 and made only at that moment (FR-155 permits checks at a follow). A folder
  opens **as itself**; a file opens its parent with the file selected; a location the check cannot find
  or reach is handed to OS Explorer on its parent, and OS Explorer reports it — throng raises no notice
  of its own. Asking file-or-folder is not asking "is it broken?", which M1 ruled out; a trailing
  separator or an OSC 8 target ending in one still skips the check and opens as a folder.
- **FR-159**: **The protocol allowlist** MUST be a setting (`editor.links.protocolAllowlist`, a list of
  scheme names, compared without case) with a descriptor under Editor · Links, rendered by the
  preferences editor and covered by the configuration-editor completeness test (Principle X). It ships
  `mailto`, `tel` and `slack` *(derived — not confirmed by the maintainer)*. A scheme on it is a link in
  both panel types and in OSC 8 targets, and a Ctrl+click hands the URI to the OS default handler for
  that scheme. A scheme not on it is not a link. A **refused set** — at least `ms-msdt`, `search-ms`,
  `ms-officecmd`, `javascript`, `data`, `vbscript`, and every scheme whose handler executes a file —
  MUST be refused whatever the allowlist says, and adding one to the allowlist MUST have no effect.
  The OS-specific members of the refused set MUST sit behind the platform abstraction (Principle II;
  *derived — not confirmed by the maintainer*), covered by a contract test. A change to the allowlist
  MUST take effect on the next gesture without a restart. This supersedes 024 FR-019's and this spec's
  FR-013's refusal of `mailto:` and unknown schemes, for allowlisted schemes only (**S5**).
  *Clarified 2026-09-19 (planning, derived): the renderer applies the platform's refused set to drawing,
  fetched once at startup; `file` is not in the set classification reads — its refusal is FR-037's, at
  the external opener only.*
- **FR-160**: **An in-project file opens in throng, in any spelling** (FR-106), `file:///…` included, as
  FR-110's in-project row says. To do so, the link MUST be resolved when it is followed: its readings are
  tried in FR-022 – FR-025's order, with existence checked **at that moment only**, and the first
  reading that exists decides. If none exists and the link's first reading lies in the project, exactly
  **one notice** MUST name the path and say it was not found, and no editor or preview MUST open
  *(derived — not confirmed by the maintainer)*; if its first reading lies outside the project, FR-158
  applies. The Link menu offers Open in OS Explorer and the other targets for an in-project file exactly
  as for an out-of-project one (FR-170).
  *Clarified 2026-09-19 (planning, derived) — the mixed case*: the readings are tried in order under
  one FR-161 deadline and **the first reading that exists decides**, wherever it lies: in the project →
  opens in throng; outside → FR-158a (folder as itself, file's parent with it selected). Only when no
  reading exists does the first reading decide: in the project → the one notice; outside → its parent to
  OS Explorer. So `/etc/hosts` with no `<root>\etc\hosts` but Git's `etc\hosts` present reveals Git's
  file, and `/help` with nothing behind it in or out of the project raises the notice.
- **FR-161**: The **existence-check timeout** (`editor.links.existenceCheckTimeoutMs`, FR-120's default
  and bounds unchanged) MUST bound every check FR-160 and FR-170 make, **in total per follow or menu
  opening** across every reading tried, not per reading *(derived — not confirmed by the maintainer: the
  coordinator's triage proposed retiring the setting; it is kept because a click-time check still needs
  a bound and Principle X forbids hardcoding a machine-dependent timeout)*. FR-121's per-root gate and
  FR-122's back-off apply to these checks. FR-124's notice stands for an in-project link.
  *Confirmed and relabelled 2026-09-20 (round five) by FR-181: the maintainer asked whether the setting
  is still in use and said to remove it if not — it is, so it is kept, and what was wrong was its name.
  Its label becomes **Link resolution timeout** and its description drops "existence"; its key, default,
  bounds, control and home are unchanged. The word "existence-check" survives in this spec's prose and in
  the key alone.*

#### Paths with spaces, by grammar *(added 2026-09-19 — round four)*

- **FR-162**: **A path may contain spaces, decided without the filesystem.** A candidate that begins with
  an anchored form (FR-150's list) MUST extend across a single space, one word at a time, **while the
  next word looks path-like** — it contains a path separator, or it ends in a dotted extension
  *(derived — not confirmed by the maintainer)* — and MUST stop before the first word that does not. The
  extension MUST also stop at every rule FR-150 already states: a word that begins an anchored form, a
  web link's span, an unbalanced bracket, a quote, a line break a program printed, and the word cap
  (`MAX_PATH_SPACE_WORDS`). FR-004's position readings and FR-005's trailing punctuation apply to the
  extended reading's own end. A bare word MUST NOT start an extension. **The positive and negative unit
  cases for this grammar MUST be written first and shown to the maintainer for joint verification
  before it is implemented** (M4), and MUST include SC-003's prose fixture and FR-150's third-round
  corpus rows. This supersedes FR-150's "tried longest first … the first that resolves" and SC-020's
  existence clause.
  *Superseded 2026-09-19 (maintainer, the same day) by FR-173: the "looks path-like" rule — a word with a
  separator or a dotted extension — is withdrawn. The test-first gate and the rules that stop an
  extension carry into FR-173.*

#### Hyperlinks and the pointer *(added 2026-09-19 — round four)*

- **FR-163**: An **OSC 8** hyperlink MUST be a link when its target is well formed and of a followable
  class — `http`/`https`, `file:`, or an allowlisted scheme — **whatever it points at**. An empty
  target, a refused scheme or a scheme not on the allowlist MUST still present no affordance and behave
  as FR-154 says. This supersedes FR-154 for `file:` and allowlisted targets.
- **FR-164**: **A valid link MUST show the hand pointer whenever it is hovered**, with or without the
  modifier held — never the text I-beam. This supersedes FR-135's third row. A Ctrl+click remains the
  only click that follows (FR-040). How marks are computed is FR-172, below the Link menu.

#### The link hint, the status bar and the tooltip *(added 2026-09-19 — round four)*

- **FR-165**: A **plain click** (no modifier) on a valid link MUST show the **link hint**: a small popover
  saying that Ctrl+Click follows the link and what it will do, in FR-168's words.
  - **FR-165a**: It MUST NOT take focus and MUST be **click-through**: the click that raised it keeps its
    ordinary meaning (Principle VI — placing the caret, starting a selection, or reaching a
    mouse-reporting program, FR-043), and input over it reaches the panel beneath.
  - **FR-165b**: It MUST be anchored at the **bottom-right** of the link so no link text is hidden; for a
    link spanning several rows, at the bottom-right of its last row.
  - **FR-165c**: It MUST be kept fully on screen by the same viewport-clamping rule the context menu uses,
    generalised and shared rather than copied; when clamping would cover the link, staying on screen
    wins *(derived — not confirmed by the maintainer)*.
  - **FR-165d**: It MUST be brief — hidden after a fixed, named interval *(derived — not confirmed by the
    maintainer)* — and MUST hide at once when Ctrl is pressed, when any link is Ctrl+clicked, or when
    another hint is shown.
    *Clarified 2026-09-19 (planning, derived): it also hides on window blur and on a scroll the **user**
    makes (wheel, scrollbar, a scrolling key); output that scrolls a terminal does not hide it.*
  - **FR-165e**: It MUST NEVER appear on hover, on a Ctrl+click, or on a click that drags.
  - **FR-165f**: It MUST appear only where links of that kind are enabled for that panel type (FR-060:
    a detected path in a panel type whose detection is off shows none; a web link always can).
    *Superseded in part 2026-09-20 (round five) by FR-180: the parenthetical's second clause is
    withdrawn — with a panel type's switch off there is no link of any kind to raise a hint over. The
    rule itself stands.*
  - **FR-165g**: Its colours and type MUST come from theme tokens with descriptors, editable in the theme
    editor (configuration-editor completeness; themeable controls).
- **FR-166**: **At most one link hint MUST exist in the whole app at a time**, across every panel and
  window. It MUST be **one shared component** with identical style, behaviour and messages in editors,
  terminals and the Markdown preview, and the Markdown preview MUST use it. This supersedes 044 FR-094's
  remedy for a plain click in a preview as far as the plain click goes (**S6**); FR-094's hover tooltip
  stands.
- **FR-167**: Hovering a valid link in a **terminal** or an **editor** MUST show its full target — the
  resolved-by-grammar address, or an OSC 8 link's declared target, never its visible text — at the
  **bottom-left of that panel's status bar**, to the right of any persistent content there, and clear it
  when the pointer leaves. It MUST appear only while that status bar is shown *(derived — not confirmed
  by the maintainer)*, as 044 FR-118 does for previews, whose readout is unchanged.
  *"The resolved-by-grammar address" is defined by FR-167a (2026-09-19, derived).*
- **FR-168**: The tooltip for a file that a Ctrl+click opens in an editor MUST say which editor, from the
  open-target preference (**023 FR-025/FR-026**): **"Ctrl+Click to open in throng active editor"** or
  **"Ctrl+Click to open in throng new editor"** (M9; the modifier is kept *(derived — not confirmed by the
  maintainer)*). A file that opens as a preview says "…to open in throng preview"; a reveal says "…to
  show in OS Explorer"; a web or loopback link keeps "…to open in system browser"; an action protocol
  says "…to open with the *<scheme>* handler" *(derived — not confirmed by the maintainer)*. One
  function, shared by every surface, words the tooltip and the link hint (FR-105 refined, not replaced).
  *Clarified 2026-09-19 (planning, derived): "every surface" includes the Markdown preview's tooltip,
  whose wording — not its presence — S6 therefore no longer keeps unchanged.*
  *Clarified further 2026-09-19 (planning, derived): the wording names what **that surface's** Ctrl+click
  does. A preview keeps 044's follow (S6), so the preview passes 044's destination, not FR-157's class:
  an in-project file or an in-document heading → "Ctrl+Click to open in throng preview" / "Ctrl+Click to
  go to the heading"; a link 044 FR-090e stops at the current file with a notice → "Ctrl+Click to
  follow"; web → "…to open in system browser"; `mailto:` → "…to open with the mailto handler". At hover
  in editors and terminals the destination is judged by name (research R30): a rooted non-drive path
  whose project-root reading is absent but whose Git mount-table reading exists is worded "open in throng
  …" and revealed at the click — an accepted trade of FR-155, recorded in research R35.*
  *Superseded 2026-09-20 (round five, maintainer M12) by FR-169a as the **tooltip's** text, with
  FR-168a, FR-168b and the two clarifications above: a hover shows the link's full target and nothing
  else, in a native HTML `title`. Every word of FR-168 stands as the **link hint's** text (FR-165), which
  is what the by-name trades, the preview's destinations and the `<scheme>` handler row now govern. The
  by-name trade therefore no longer shows at hover at all — the title states an address, which cannot be
  wrong about where the click goes.*

#### The Link menu *(added 2026-09-19 — round four)*

- **FR-169**: **One Link menu component** MUST hold every link action, separate from the panels' own
  context menus, and MUST be identical — items, order, labels, chords, enablement — in editors,
  terminals and the Markdown preview *(the three surfaces: derived — not confirmed by the maintainer)*,
  so that no surface can offer a link action another does not. Its items MUST declare sections from
  Principle VI's vocabulary.
  *Clarified 2026-09-19 (planning, derived): the Open Link chord is the one permitted difference — shown
  only where bound (FR-170 row 1, FR-046); items, order, labels and enablement are identical. Open Link
  runs exactly what **that surface's** Ctrl+click runs (Principle VI): FR-157 / FR-160 in editors and
  terminals, 044 FR-090 – FR-096 in a Markdown preview (S6). An in-document heading link in a preview
  offers Open Link and Copy Link to Clipboard only.*
- **FR-170**: The Link menu MUST offer, in this order, each only where offered:

  | Item | Offered when |
  |---|---|
  | **Open Link** | Always. Runs FR-157 / FR-160; shows the Open Link chord where one is bound in that panel type (FR-031's amendment) |
  | **Open In ▸ New Editor**, **Open In ▸ Active Editor**, **Open In ▸ *<editor name>*** | The target is a file in the project. One row per open editor, by name |
  | **Open Preview** | The target is a file in the project and a preview provider accepts it; drawn **disabled** when that provider is disabled (FR-030) |
  | **Open in OS Explorer** | The target is a UNC or on-device location, file or folder |
  | **Open in OS Default Program** | The target is a file that is **not** executable (FR-039a) |
  | **Open Program** | The target is an executable file (FR-039a) *(derived — not confirmed by the maintainer)*. Runs it. Never the default action (FR-111) |
  | **Copy Link Address** | Always. Copies what FR-032 says for a file link and the address as written for any other |

  Whether a target is a file or a folder, in the project, and accepted by a provider MUST be decided by
  **one** resolution when the menu opens, bounded by FR-161 *(derived — not confirmed by the
  maintainer)*. A link that does not resolve MUST offer only Open Link, Open in OS Explorer (for a UNC or
  on-device location) and Copy Link Address. A web, loopback or action-protocol link MUST offer Open Link
  and Copy Link Address only. The label **Copy Link Address** is kept although M10 writes "Copy Link to
  Clipboard", and "Program" although M10 writes "Programme" *(derived — not confirmed by the
  maintainer; the first is fixed by constitution Principle VI and is reported as a conflict)*. This
  supersedes FR-030's four-target table as the menu's content; FR-030's offered rules carry into it.
  *Superseded in part 2026-09-19 (maintainer) by FR-175: the item is **Copy Link to Clipboard**; the
  constitution conflict is resolved by v5.5.2. "Program" stands.*
  *Superseded in part 2026-09-19 (analysis, derived) by FR-170a: an unresolved link draws its applicable
  target items **disabled** rather than removing them (Principle VI).*
- **FR-171**: The Link menu MUST open on a right-click, or on `menu.open` (Shift+F10), over a link with
  **no text selected**; with text selected the panel's own context menu MUST open instead (024 FR-019d,
  FR-031). Away from a link, the panel's context menu is unchanged.

#### Marks drawn from what is in view *(added 2026-09-19 — round four)*

- **FR-172**: **Marks are a function of the rows in view.** In a terminal, the at-rest marks MUST be
  computed from the grammar over the logical lines in view (FR-130), recomputed when the view is drawn,
  **throttled** to a fixed interval rather than waiting for output to be quiet, and **rebuilt when the
  terminal switches between its normal and alternate screen buffers**, so no mark from the other buffer
  survives. The hovered link's hover state MUST be drawn from the hovered link itself, not only from a
  link the at-rest pass has collected. FR-071's first sentence and FR-072 stand: no existence check, and
  no per-output-chunk scan. This supersedes FR-137's idle scan and FR-133's "when a row is asked about"
  for marks.

#### The maintainer's checkpoint answers *(added 2026-09-19 — round four, confirmed)*

- **FR-173**: **Spaces in a bare link are not supported.** An undelimited candidate MUST end at the
  first space — `/file 1` yields `/file` only — **unless** one of these overrides applies, in which case
  the link MUST run across spaces as the override says:
  - **FR-173a — backticks**: text enclosed in a pair of backticks (`` `/file with spaces.md` ``) is one
    candidate, the backticks excluded.
  - **FR-173b — paired quotes**: text enclosed in matching quotes (`"C:\my folder\my file.txt"`) is one
    candidate, the quotes excluded. This is FR-005's quoted-path rule, kept.
  - **FR-173c — brackets**: text enclosed in a matching pair of `()`, `<>` or `[]`
    (`[/d/folder/a link to file.png]`) is one candidate, the brackets excluded.
  - **FR-173d — a trailing separator**: an anchored candidate MUST extend across spaces to the farthest
    word that **ends with a path separator** (`//path to/file/`, `Z:\folder with spaces\folder\`).
  - **FR-173e — a known extension**: an anchored candidate MUST extend across spaces, **greedily**, to
    the farthest word that ends in a **known extension** (`\\share\path to file.xlsx`). The known
    extensions MUST be one named constant in `@throng/core` beside the other link limits, naming no
    operating system (Principle II).

  FR-173d and FR-173e MUST start only from an anchored form (FR-150's list) and MUST keep FR-150's
  stopping rules — a word that begins an anchored form, a web link's span, an unbalanced bracket, a
  quote, a line break a program printed, and the word cap. The enclosed forms FR-173a – FR-173c admit a
  relative path inside them, as FR-005's quoted form does *(derived — not confirmed by the maintainer)*.
  FR-004's position readings and FR-005's trailing punctuation apply to the candidate's own end. No
  override consults the filesystem (FR-155). The cases are
  `packages/core/tests/unit/link-detect-spaces.test.ts`, written before the grammar and verified with
  the maintainer (M4's gate, SC-022); where this text and that verified table disagree on an edge, the
  table is the maintainer's answer. This supersedes FR-162's path-likeness rule, and FR-150's extension
  rule as a whole.
  *Superseded in part 2026-09-19 (maintainer, after reviewing the case table at `6d272de9`) by FR-178
  and FR-179: FR-173c's brackets include `{}`; FR-173d and FR-173e end at the **first** qualifying word,
  not the farthest, and may start from any candidate containing a separator, not only an anchored form;
  FR-173e's known extensions are a user setting whose default is the named constant.*
- **FR-174**: **Any rooted path MUST be a link**, whatever its number of segments: `/help` in prose is a
  link, exactly as `/usr/bin/bash.exe` is. A `/` with no path character after it is not *(derived — not
  confirmed by the maintainer)*. SC-003's prose fixture MUST therefore contain no rooted token, or
  expect it as a link.
  *Clarified 2026-09-19 (planning, derived): a "path character" is a letter, a digit, or one of
  `. _ ~ -`, so `/?` is not a link and `/s` is (the maintainer's "any rooted path"). A bare `/<letter>`
  with no following separator is a rooted path, **not** a drive form (FR-025 / FR-176 need
  `/<letter>/`), so `dir /c` never opens `C:\`. Cases go in `link-detect.test.ts` and
  `link-resolve.test.ts` (T242, T253).*
- **FR-175**: The link menu's copy item MUST be labelled **Copy Link to Clipboard** in every surface —
  the Link menu (FR-170), and every place this spec, 024 FR-019d and 044 FR-095 say **Copy Link
  Address**. What it copies is unchanged (FR-032, FR-103, 044 FR-116). Constitution Principle VI names
  it so from v5.5.2 (`c855eadd`) (**S7**).
- **FR-176**: A drive form — `/<letter>/…` or `/mnt/<letter>/…` — MUST resolve to that drive **only**:
  the project-root reading MUST NOT be tried for it, so `/d/git/x.ts` is `D:\git\x.ts` even when the
  project holds a `d\git\x.ts` *(2026-09-20: the maintainer settled this direction — see the
  Clarifications entry; the earlier "derived" note is withdrawn)*. This is FR-024's "a leading-`/`
  path that is not a drive form" and FR-025's "MUST map to that drive", which the code did not do
  when this was written (the baseline converge's T230) and does now (`resolve.ts`, T254).
- **FR-177**: FR-025's drive forms MUST map to their drive in **every** flavour, a WSL flavour
  included; in a WSL flavour it is only Git Bash's mount table and the platform's own meaning that are
  withheld (FR-151). FR-151's "FR-025's `/mnt/<drive>` form only" is read as "FR-025's drive forms"
  (the baseline converge's T231, settled by the maintainer).
- **FR-178**: The **known file extensions** FR-173e reads MUST be a setting — `editor.links.knownFileExtensions`,
  a list of extensions — with a descriptor under Editor · Links, rendered by the preferences editor and
  covered by the configuration-editor completeness test (Principle X). It ships the common list held as
  a named constant in `@throng/core`, which becomes the setting's default rather than the rule's only
  source. The user MUST be able to add and remove entries, and a change MUST take effect on the next
  detection pass, in terminals **and** editors, with no restart; its descriptor MUST say it applies to
  both despite its Editor · Links home. Entries MUST be compared without case, and an entry MUST be
  accepted with or without its leading dot *(derived — not confirmed by the maintainer)*. An empty list
  MUST be honoured — FR-173e then never applies — and Reset to Defaults restores the shipped list
  *(derived — not confirmed by the maintainer)*. The preferences control is the existing string-list
  editor — `control: 'array'` with `itemControl: 'text'`, as `explorer.excludeGlobs` uses
  (`packages/core/src/config/settings-metadata.ts:385`, rendered by
  `packages/ui/src/renderer/preferences/form-controls.tsx`), with `clearable: true`; no new control is
  needed. FR-159's protocol allowlist takes the same control *(derived — not confirmed by the
  maintainer)*.
  *Amended in part 2026-09-19 (planning, derived) by FR-178a: the setting stores the user's edits, not
  the resulting list.*
  *Restored and amended 2026-09-20 (round five, maintainer M15) by FR-182: the setting is again the one
  key this requirement names, `editor.links.knownFileExtensions`, storing the **resulting list** and
  shipping the constant itself so the control shows the real extensions. FR-178's own "An empty list MUST
  be honoured — FR-173e then never applies" is now reached directly by clearing the list, not through
  `*`. Its description is shortened (M15), and the trade the whole list costs is FR-182c.*
- **FR-178a** *(2026-09-19, planning — derived, not confirmed by the maintainer)*: FR-178's setting MUST
  be stored as two string lists, `editor.links.knownFileExtensions.added` and
  `editor.links.knownFileExtensions.removed`, both defaulting to empty, each with a descriptor under
  Editor · Links and the `array`/`text`/clearable control. The set FR-173e reads MUST be the shipped
  constant, plus `added`, less `removed`; `*` in `removed` MUST remove every shipped entry, which is how
  FR-178's empty list is reached. Reset to Defaults empties both, restoring the shipped list. An
  extension throng ships later MUST reach every install that has not removed it. The `removed`
  descriptor MUST list the shipped extensions, generated from the constant. `*` in `removed` means none
  of throng's list, including extensions shipped later; entries in `added` still apply *(derived)*.
  *Clarified 2026-09-19 (review round four, H1): "the set FR-173e reads" is EVERY scan of that grammar,
  main's included. `FileLinkResolver` re-detects a followed span to find its readings, and until this
  round it did so with the shipped constant — so a user-added extension widened the span a surface drew
  and never the span main would match, and a Ctrl+click on a file that exists answered `notFound` while
  the Link menu drew every row disabled. The resolver now reads the same resolved set, per request, as
  it already reads `existenceCheckTimeoutMs`.*
  *Superseded 2026-09-20 (round five, maintainer M15) by FR-182: withdrawn in whole — there is one list
  setting, not an `added` / `removed` pair, and no `*` convention. The H1 clarification above **stands**
  and is widened by FR-182b: every scan, main's included, reads the list through
  `knownFileExtensionsSet`. The old shape is migrated on read (FR-182a), and the cost of the reversal is
  recorded in FR-182c.*
- **FR-179**: FR-173's scan MUST follow these rules, confirmed by the maintainer on the case table
  (`packages/core/tests/unit/link-detect-spaces.test.ts`, `6d272de9`):
  - **FR-179a**: FR-173c's enclosures are `()`, `<>`, `[]` **and `{}`**.
  - **FR-179b**: FR-173d and FR-173e end at the **first** word, scanning forward, that ends in a path
    separator (FR-173d) or in a known extension (FR-173e, FR-178) — never the farthest. Unquoted
    `\\network.local\folder one\ folder` is `\\network.local\folder one\`; quoted, it is taken verbatim
    (FR-173b).
  - **FR-179c**: A candidate that **contains a path separator** may cross spaces under FR-173d and
    FR-173e, relative ones included (`src/my file.ts`); a candidate with no separator MUST NOT.
  - **FR-179d**: The scan crosses single spaces only: **two consecutive spaces or a tab end it**, and it
    never adds more than `MAX_PATH_SPACE_WORDS` (6) words. If it ends without reaching a qualifying word,
    the candidate is the undelimited token alone (`/file 1` → `/file`).

  - **FR-179e** *(2026-09-19, planning — derived from the confirmed table)*: an enclosure (FR-173a –
    FR-173c) counts only when its contents start like a path — anchored, or relative with a separator or
    a plausible extension; otherwise it is ignored and its contents obey the default (`(x86)`, `<DIR>`,
    `[WARN]`, `${HOME}`). "A plausible extension" is today's rule C in `core/src/links/detect.ts`.
  - **FR-179f** *(2026-09-19, planning — derived from the confirmed table)*: `MAX_PATH_SPACE_WORDS` (6)
    caps the **whole span**, the starting token included — `D:\temp is full of foo/bar.md` (5 words) is
    one link, `D:\a one two three four five six.md` (7) is not. The scan also never takes a word that
    begins an anchored path, a URL, a quote or backtick, or a path-holding enclosure; an unbalanced
    bracket is trimmed rather than ending the scan (`[D:\a b\c.md` → `D:\a b\c.md`). The table's header
    rule 3 is the full statement. This supersedes FR-179d's "never adds more than six words" and aligns
    FR-173's stopping rules with the table.

  This supersedes FR-173's "farthest" (FR-173d, FR-173e), its "MUST start only from an anchored form",
  and FR-173c's three-pair list. **The effective space rule** is FR-173 as amended by FR-178, FR-178a
  and FR-179; `packages/core/tests/unit/link-detect-spaces.test.ts` is its case table.
  *Amended 2026-09-20 (round five): read "FR-178a" as **FR-182** — one list setting — and add **FR-183**,
  the one fact the scan may be told. The case table is unchanged byte for byte, and remains the
  maintainer's answer on every edge it covers: FR-183 only ever applies where a caller supplies a known
  working directory, which the table's cases do not.*

#### Decisions taken while analysing round four *(2026-09-19 — derived, not confirmed by the maintainer)*

Each supersedes the named text only where it differs; that text is kept where it stands.

- **FR-170a** — *supersedes FR-170's "A link that does not resolve MUST offer only …" and the matching
  Clarifications answer*: an unresolved link (not found, or unreachable) is a state a later moment can
  change — the share comes back, the file is created — so constitution Principle VI (*disabled when
  unavailable, absent when meaningless*) requires its target items **drawn disabled**, not removed.
  Which items apply is decided without the disk where the grammar can: Open In ▸ and Open Preview when
  the link is in the project by name (FR-106) — Open Preview only if a provider accepts the extension;
  Open in OS Default Program or Open Program by the extension, through `IExecutableExtensions` (FR-039a);
  Open in OS Explorer stays enabled (it needs no target). Items stay **absent** only where meaningless:
  every target item for a web, loopback, protocol or preview-anchor link.
- **FR-160a** — *refines FR-160's mixed-case note*: when the first existing reading is a **folder**, it
  opens as itself in OS Explorer **wherever it lies**, in the project or not (FR-110's folder row, which
  FR-157 keeps "unchanged in effect"; SC-005). Only an existing **file** in the project opens in throng.
  An in-project first reading that times out raises FR-124's "did not answer" notice, distinct from
  FR-160's "not found".
- **FR-159a** — *the protocol span's grammar*: a protocol link is `<scheme>:` followed by a run of
  non-whitespace characters; FR-005's trailing punctuation is trimmed from its end (`mailto:a@b.c.` →
  `mailto:a@b.c`); `//` after the colon is optional (`slack:open` and `slack://open` both qualify); a
  space ends it (`tel:+44 20` → `tel:+44`, which a user can quote to keep whole under FR-173b); an empty
  run is not a link. The grammar lives in its own module, not in the web grammar, so 024's web cases
  stay untouched.
  *Amended (fifth analysis pass): the quoting remedy is withdrawn — FR-179e counts an enclosure only when
  it holds a path, and the protocol grammar has no enclosure rule of its own; a spaced `tel:` number is a
  link up to its first space.*
  *Extended 2026-09-20 (round five, maintainer M18) by FR-185: a **bare email address** is a protocol
  span too, with its scheme supplied rather than written — the one span whose target is not its own
  text. Every rule above governs a **written** `<scheme>:` span and is unchanged.*
- **FR-170b** — *the Link menu does not wait*: it opens **at once** in FR-170a's state (target items that
  apply drawn disabled, Open Link, Open in OS Explorer and Copy Link to Clipboard enabled) and enables the
  items the menu-open resolution confirms when its answer arrives, within FR-161's bound; an answer that
  arrives after the menu closed is dropped. So a right-click on an offline share never shows nothing for
  the length of the timeout.
- **FR-170c** — *the Link menu before main answers (sixth analysis pass; supersedes FR-170b's "enables
  the items … confirms" where it differs)*: the menu opens with only what the renderer knows — Open Link
  and Copy Link to Clipboard; Open in OS Explorer for a UNC or on-device link (never for web, loopback,
  protocol or anchor); Open In ▸ and Open Preview **disabled** when the link is in the project by name and
  is not a folder by grammar — it does not end in a separator and is not the project root itself
  (FR-168b) — Open Preview only when the renderer's provider registry accepts the extension (ninth
  analysis pass: a row that could never apply is not drawn even for a moment). Rows 5 and 6 (Open in OS Default Program / Open Program) are **not drawn**
  until main answers, because executability is main's answer. The answer may add, enable **or remove**
  rows: a folder removes rows 2, 3, 5 and 6; a resolved file enables what applies; an unresolved one adds
  row 5 or 6 disabled by extension (FR-170a).
- **FR-158b** — *what the reveal checks (sixth analysis pass; **S10**)*: a follow's reveal and the explicit
  **Open in OS Explorer** item make FR-158a's single bounded file-or-folder check instead of FR-035a's and
  FR-037's "check again that the path exists" — a location that is not there is revealed on its parent
  with no notice, never refused as `gone`. FR-037's re-check stands for every action that needs the file
  itself: open in throng, Open in OS Default Program, Open Program. FR-035a's policy — re-resolution from
  the request, never a path from the renderer — is unchanged.
- **FR-060a** — *extends FR-060 and FR-165f*: like web links, allowlisted protocol links are not
  governed by the file-link detection switches; they stay marked, followable and hinted when detection
  is off.
  *Superseded 2026-09-20 (round five, maintainer M13) by FR-180: withdrawn in whole. Every link kind is
  governed by the switch for its panel type, protocol links included.*
- **FR-167a** — *what the readout shows*: the link's first reading as the grammar resolves it — an
  absolute address where the panel has a base (a terminal's working directory, an editor's file folder,
  else the project root), the text as written where it has none, and an OSC 8 link's declared target;
  never its visible text.
  *Superseded in part 2026-09-20 (round five, maintainer M19) by FR-187: a rooted path that is not a
  drive form reads out **as written**, never joined onto the project root — the readout must name where
  a click goes, and for that shape nothing but the disk can say. Every other row here stands, and
  FR-169a makes the hover title the same string.*
- **FR-178b** — *carve-out from FR-039a*: `KNOWN_FILE_EXTENSIONS` may name `exe`, `msi`, `ps1`, `bat` and
  the like. It is a syntactic hint for **where a path ends**, not a classification of what the OS would
  execute, so FR-039a's "`@throng/core` MUST NOT name any of these extensions" does not apply to it. The
  guard `links-no-os-names.test.ts` carries a named exemption for `known-extensions.ts` saying so;
  executability is still decided only behind `IExecutableExtensions`.
- **FR-159b** — *allowlist entries (ninth analysis pass)*: each entry is trimmed, lower-cased, and has one
  trailing `:` or `://` removed before it is compared, so `slack:`, ` Slack ` and `zoommtg://` all work as
  typed; an entry that is empty after that is ignored.
- **FR-156b** — *metacharacters in a path (ninth analysis pass)*: `& | ; ^ ( ) < >` and the like are
  **kept** in a path — `D:\R&D\notes.txt` is a link — because the value is handed to the OS as one
  argument and never through a shell. FR-156's refusals are control characters, NULs (raw or `%00`) and
  quote-delimited trailing text only.
- **FR-158c** — *a folder by grammar with several readings (eighth analysis pass)*: a relative path that
  ends in a separator skips FR-158a's check at a follow **and** at a Link-menu opening, and its **first**
  reading (FR-022 – FR-025's order) is revealed as a folder, unchecked — FR-168a's trade again, since
  choosing among its readings would need the disk.
- **FR-158d** — *widens FR-158c (eleventh analysis pass)*: **every** folder by grammar — an absolute or
  relative path ending in a separator, an OSC 8 target ending in one, or the project root itself — skips
  the check both at a follow and at a Link-menu opening, and opens as a folder (its first reading, for a
  relative one). FR-170's "one resolution when the menu opens" does not apply to it.
- **FR-122a** — *the back-off moves to main (eleventh analysis pass)*: FR-122's back-off was the
  renderer cache's lifetime (`LINK_CACHE_TTL_MS`), which FR-155 deletes. It is kept, in main: a volume root
  whose check timed out is **left alone** for `LINK_ROOT_BACKOFF_MS` (30,000 ms — the value the cache
  lifetime had) after its stuck `stat` settles, and a follow or Link-menu opening under it during that time
  answers `unreachable` at once, without touching the disk. So FR-161's and SC-014's back-off clauses stand
  as written. A folder by grammar never consults the back-off: FR-158d wins, and it opens as a folder with
  no check even under a root in back-off *(thirteenth analysis pass)*.
- **FR-168b** — *folders by name (seventh analysis pass)*: a target that is a folder **by grammar** — the
  project root itself, or a path ending in a separator — is worded "Ctrl+Click to show in OS Explorer"
  (FR-160a), with no disk access. Any other in-project folder is worded as an in-project file would be and
  opens in OS Explorer at the click — the third accepted by-name trade (research R35), limited to folder
  links written without a trailing separator.
- **FR-155a / FR-156a / FR-160 reading** — *wording (seventh analysis pass)*: FR-155's "No surface MUST
  check", FR-156's "No crafted link text … MUST be able to" and FR-160's "no editor or preview MUST open"
  are read as **MUST NOT** (no surface checks; no crafted text can; no editor or preview opens).
- **FR-168a** — *widens FR-168's by-name note*: the hover wording can also differ from the click for a
  terminal relative path whose working directory lies outside the project — worded by its first
  (working-directory) reading, followed by the first reading that exists, which may be the project-root
  one. Accepted for the same reason (research R35).
- **S6 addendum** — the protocol allowlist governs editors and terminals only; a Markdown preview keeps
  044 FR-091, which opens `mailto:` whatever the allowlist says. Recorded, not reconciled: widening the
  allowlist to previews would change 044's follow, which S6 keeps. *(Twelfth analysis pass:) other
  allowlisted schemes — `tel:`, `slack:` — are `inert` in a preview (044) and open no Link menu there.*

**D5 — defect, not a new requirement: links in Claude Code's full-screen interface carry no mark.**
Required by **FR-135 – FR-139** (a link is marked at rest, solid on hover, the same in every surface)
and **FR-130**. The maintainer reports (M11) that in Claude Code's full-screen UI, links show no at-rest
mark and no hover style, though a Ctrl+hover shows a pointer and a Ctrl+click follows — so the user has
no visible sign of what is clickable. **Located by reading, not by a run — a hypothesis until a
reproducing unit test is red** *(derived — not confirmed by the maintainer)*:

- the at-rest marks come only from the idle scan, which starts after 300 ms of quiet output
  (`packages/ui/src/renderer/terminal/use-terminal.ts:1118-1126`,
  `packages/ui/src/renderer/terminal/link-idle-scan.ts:79-86`, `LINK_IDLE_SCAN_MS`); Claude Code's
  spinner and status line never go quiet, so its `viewLinks` stays empty;
  *(citation corrected 2026-09-19: the idle-scan wiring spans `use-terminal.ts:1117-1149`, and the
  `subscribeLinkCache` re-arm of `pendingOscHover` follows at `:1150-1160`)*
- the hover mark is drawn only for a link already in `viewLinks`
  (`packages/ui/src/renderer/terminal/link-marks.ts:157`, `:197`), so hovering draws nothing either, and
  the hand pointer depends on that hover mark (`link-marks.ts:170`);
  *(noted 2026-09-19 while planning: M11 says a Ctrl+hover **does** show the pointer in Claude Code, so
  this bullet cannot be the whole cause — the pointer then likely comes from xterm's own link hover, not
  the mark. T233 holds Ctrl for the pointer assertion and leaves the no-modifier pointer to FR-164's
  T238, so the reproduction isolates D5.)*
- an alternate-screen repaint leaves stale marks, and nothing rebuilds them on a buffer switch.

The baseline converge of 2026-09-19 found the second point independently as T228 (tasks.md Phase 16),
for any output that does not pause; T228 is D5. FR-172 is the requirement the fix satisfies, and a
reproducing unit test comes first (the replicating-bugs gate).

#### Round five — one hover, switches that mean every link, one extension list, a prompt's spaced folder, a subtler underline *(added 2026-09-20)*

Each requirement below supersedes the older text it names, for the cases named and nothing wider; the
older text is kept where it stands and marked there.

- **FR-169a** *(maintainer, M12)*: **A link's hover MUST show one thing and one thing only: its full
  target, in a native HTML `title`.** In a terminal, an editor and a Markdown preview alike, hovering a
  valid link MUST set a native `title` whose text is exactly the address FR-167 and FR-167a already
  define — the first reading by name for a detected path, the declared target for an OSC 8 hyperlink or a
  web link, never the span's visible text — and MUST clear it when the pointer leaves or the surface is
  disposed. **No other popup, tooltip, hover surface or title text MUST exist**: throng draws no floating
  tip of its own, and the wording *"&lt;target&gt; — &lt;gesture&gt;"* is withdrawn.
  This supersedes **FR-168** as the *tooltip's* text (and FR-168a's, FR-168b's and the S6-addendum notes
  that word it), **FR-135**'s hovered row where it says a tooltip appears after the hover delay,
  **FR-105** and **FR-042** as the tooltip's wording, and **044 FR-094**'s "target **and the gesture**"
  for the preview (**S12**, **S13**).
  - **FR-169a(i)**: FR-168's wording survives in full and is **not** superseded as the **link hint**'s
    text (FR-165): the hint is what M7 asked for and M12 keeps in as many words ("The new bottom right
    popover on click needs to stay"). `linkHoverText`, `previewLinkHoverText` and `uriHoverDestination`
    stand unchanged with one caller each — the hint.
  - **FR-169a(ii)**: The **status-bar readout** (FR-167) is unchanged, and the title and the readout MUST
    be the same string, produced by the same function, so a link cannot read two ways on one hover.
  - **FR-169a(iii)** *(derived — not confirmed by the maintainer)*: because the OS draws, places, times
    and dismisses a native `title`, nothing here is clamped to the viewport, delayed, re-armed or
    registered as a floating surface. The floating-surfaces registry loses `.terminal-link-tip` with the
    element.
  - *Numbering note: the letter attaches this to FR-169 only because the round-five code comments cite
    **FR-169a** and the code is not this spec's to renumber. What it actually extends and supersedes is
    **FR-168**; a reader arriving from `link-marks.ts`, `link-decorations.ts` or `sanitise.ts` lands
    here.*
- **FR-169b** *(derived — not confirmed by the maintainer)*: **`terminals.linkHoverDelayMs` is retired.**
  It existed to delay throng's own tooltip (024 US7, bounded by 031); with no tooltip of throng's it
  governs nothing, and a descriptor for a knob that changes nothing fails configuration-editor
  completeness from the other side. There is no leaf, no descriptor and no value array; a persisted value
  is dropped by the tolerant parse and the next ordinary write leaves it out — **019 FR-023's mechanism**,
  exactly as FR-112 / FR-113 retired `editor.links.defaultAction`. Its clamp in `parseAppSettings` goes
  with it (**S12**).
- **FR-180** *(maintainer, M13)*: **The two detection switches govern every kind of link.** With a panel
  type's switch **on**, every link kind is shown in that panel type — a detected path, a web link, an
  allowlisted protocol link and a hyperlink a program declared (OSC 8). With it **off**, **none** of them
  is shown, marked, hovered, hinted, followed by Ctrl+click or the Open Link chord, or given a Link menu;
  in a terminal a Ctrl+click where a link used to be reaches the program and does nothing else (FR-043),
  and in an editor Ctrl+click and Ctrl+Enter keep their ordinary editor meanings. A change MUST take
  effect with no restart, at an idle prompt as well as under output (the round-four review's
  `LinkViewMarks.refresh()` trigger).
  This supersedes **FR-060**'s last sentence ("Web links and explicit file hyperlinks MUST NOT be
  affected"), **FR-060a** in whole, **FR-165f**'s parenthetical ("a web link always can"), **FR-101**'s
  reading that an editor's web links survive the editor switch, **US6** scenarios 1 and 2 where they say
  web links and explicit hyperlinks still work, and the *One link model* clause that a web link in an
  editor is not governed by the editor switch.
  - **FR-180a** *(derived — not confirmed by the maintainer)*: the switch is read at **four** seams, and
    a fifth kind added later MUST pass one of them or it escapes the switch: the editor's
    `linkHitsBetween`, the terminal provider's `linksOnLine`, the terminal view pass's
    `terminalViewScan`, and the three OSC 8 closures in `use-terminal.ts` (`setHoveredUri`,
    `openTerminalLink`, `oscLinksInView`), which share one reader.
  - **FR-180b**: the two descriptors MUST say so. They ship as **"Detect links in editors"** and
    **"Detect links in terminals"** — the word *file* is dropped from both labels, because the switch is
    no longer about file links (FR-061's descriptor obligation, unchanged).
- **FR-181** *(maintainer, M14, answering their question)*: **The resolution timeout is kept, re-scoped
  and relabelled — not removed.** `editor.links.existenceCheckTimeoutMs` is still read, by
  `FileLinkResolver`, to bound the resolution a **follow** or a **Link-menu opening** makes, in total,
  across every reading tried (FR-161, FR-122a) — which is what stops an offline share hanging the Link
  menu. Its **key MUST NOT change**, because renaming a key drops every persisted value (019 FR-023's
  mechanism cuts both ways). Its **label** becomes **"Link resolution timeout"** and its description MUST
  NOT mention existence, because nothing has checked existence before drawing a link since FR-155. Its
  control, bounds (250 – 25,000 ms) and home under Editor · Links are unchanged.
  This refines **FR-120**'s and **FR-161**'s descriptor text and supersedes the round-four descriptor
  wording recorded in contracts *settings-and-environment* §6.1.
- **FR-182** *(maintainer, M15)*: **The known file extensions are one editable list of the real
  extensions.** The setting is **`editor.links.knownFileExtensions`, a single `string[]`**, shipping the
  `KNOWN_FILE_EXTENSIONS` constant itself, rendered by the existing `array` / `text` clearable control so
  the preferences editor **shows the extensions** and adding or removing one is ordinary editing. Its
  description MUST be short: the control already shows the list, so restating it in prose is the
  duplication the maintainer asked to remove. Entries are still compared without case and accepted with
  or without a leading dot (FR-178, unchanged), a change still takes effect on the next detection pass in
  terminals **and** editors with no restart, and Reset to Defaults still restores the shipped list.
  This supersedes **FR-178a** in whole — `editor.links.knownFileExtensions.added` and `.removed`, the
  `*`-removes-everything convention, and the generated list in the `removed` descriptor — and FR-178's
  "an empty list MUST be honoured … is reached" by `*`.
  - **FR-182a — migration**: a settings document holding the round-four `{ added, removed }` shape MUST
    be migrated **on read** to the list those edits resolve to, and the old keys MUST be absent after the
    next ordinary write (**019 FR-023's mechanism**, as FR-113 and FR-169b). `resolveKnownExtensions`
    survives for the migration alone; the normalising accessor every reader uses is
    `knownFileExtensionsSet`, the deliberate twin of `protocolAllowlistSet` (FR-159b).
  - **FR-182b — every reader reads the setting through the accessor.** FR-178a's H1 clarification stands
    and is widened: the set is read by every scan of the grammar, **main's included**
    (`FileLinkResolver` re-detects a followed span), and each reader MUST reach it through
    `knownFileExtensionsSet` so a user's list cannot widen one scan and not another.
  - **FR-182c — the trade, recorded because it reverses a round-four decision** *(derived — the maintainer
    chose the presentation knowing the list is what is stored)*: with the whole list stored rather than a
    delta, **an extension throng ships in a later release no longer reaches a user who has edited
    theirs**. That is exactly the cost research **R28** refused in round four, and M15 overrides it: a
    delta a user cannot see is not the control they asked for. The remedy, if a later list matters, is a
    seeded upgrade under `SHIPPED_DEFAULTS_VERSION` for that release, not a return to the delta.
  - **FR-182d — the empty value inverted, and it is a trap.** `{ added: [], removed: [] }` meant "throng's
    shipped list"; **`[]` now means "no extension ever ends a spaced path"** and is honoured as typed,
    never treated as "unset". Any fixture, test or caller that passed an empty value meaning *default*
    now asserts the opposite of what it reads, which has already cost one silently-wrong fixture.
- **FR-183** *(maintainer, M16 — the fix for defect **D6**)*: **A scan may cross a space onto text that
  names the surface's known working directory.** A bare candidate still ends at the first space
  (FR-173) and the maintainer-verified 92-case table
  (`packages/core/tests/unit/link-detect-spaces.test.ts`) is unchanged; FR-183 adds one thing the grammar
  may be **told**, never a weakening of what it may guess:
  - **FR-183a**: detection MUST accept an optional predicate — "does this text name the directory this
    surface already knows it is in?" — called only with a reading a scan has already crossed a space to
    reach, trimmed by FR-005, and only while the scan is within `MAX_PATH_SPACE_WORDS`. It MUST be pure
    and MUST NOT touch the disk, so **FR-155 is untouched**: the comparison is against a value throng
    already holds (025's live working directory, FR-023), not a question asked of the filesystem. A link
    is still judged by its text alone — the text is simply compared with something known.
  - **FR-183b**: a word that **terminates** a scan under FR-173d or FR-173e still wins outright. Failing
    that, the **longest** landing that satisfies the predicate wins, so `D:\git\throng_tests\test 1` is
    taken whole rather than cut at `test`. A word that would end the scan for any other reason (a quote,
    a word beginning another link, a blocked range) ends it without discarding a landing already found.
  - **FR-183c**: the predicate matches on **equality or an ancestor at a separator boundary**, so a
    prompt printing a parent of the working directory extends too, and a sibling that merely shares a
    string prefix (`…\test` against `…\tester`) does not.
  - **FR-183d**: the predicate MUST be the **caller's**, not `@throng/core`'s, because core may not map
    drive letters or mount forms (**Principle II**). Both sides are normalised through the renderer's
    by-name path reading: Git Bash *prints* `/d/git/throng_tests/test 1` and *reports*
    `D:\git\throng_tests\test 1`, so the two spellings must meet somewhere, and that somewhere is the
    renderer.
  - **FR-183e**: with **no** known working directory — every editor, a flavour that cannot report its
    directory, shell integration off, WSL — behaviour MUST be **exactly** what the case table says it is.
    The predicate is absent, not false.
  - **FR-183f**: because it works on any detected span rather than on a prompt line, it fixes the
    PowerShell, cmd and Git Bash prompts **and** the Claude Code CLI header, which is what the maintainer
    observed.
  This extends FR-173 / FR-179 and supersedes nothing: the table's answers are unchanged wherever no
  predicate is supplied, and no answer in it changes when one is.
- **FR-184** *(maintainer, M17)*: **A link's resting underline MUST be subtler than its hovered one.** At
  rest the underline is the link colour made translucent — 45% against the background — and on hover it
  is solid. This holds in terminals, editors and the Markdown preview, and FR-135's rule that the text's
  own colour is never changed, and FR-139's rule that the mechanism drawing it is invisible to the user,
  both stand.
  - **FR-184a** *(derived — not confirmed by the maintainer)*: **no new theme token.** Terminals and
    editors mix the existing `linkUnderline` token (FR-138) and keep `linkUnderlineHover` for the solid
    state. The **Markdown preview** may use neither that token nor a colour function — its CSS may name
    only `editorFg`, `editorBg`, `syntax*`, `border` and `accent`, and `preview-css-tokens.test.ts`
    enforces that for the SC-005 contrast gate — so it uses `border` at rest and `syntaxFunction` on
    hover. The preview's own gate wins over token uniformity, and the difference is recorded rather than
    argued away.
  - **FR-184b — `SHIPPED_DEFAULTS_VERSION` stays at 11** *(derived — not confirmed by the maintainer)*.
    Round five changes two settings (FR-182, FR-169b) and **no** theme token. A settings change reaches
    an existing install through the tolerant per-field parse on every read, with no version gate — which
    is this repository's own round-four ruling for `defaultAction` and `existenceCheckTimeoutMs`. A bump
    to 12 was written and reverted: it would have carried no payload, so every install would have paid an
    upgrade pass to learn nothing, and the version stops meaning "there is something here you have not
    got" the first time it is moved when there is not. The reasoning is recorded beside the constant in
    `shipped-defaults.ts`.
- **FR-185** *(maintainer, M18 — the fix for defect **D7**)*: **A bare email address is a `mailto:`
  link, never a path.** Text that the address grammar accepts — `someone@example.com` written with no
  scheme — MUST be detected as an **action-protocol span** (FR-157 class 4) whose scheme is `mailto`,
  in editors and terminals alike, matching what a Markdown preview already draws. It MUST obey the
  protocol allowlist exactly as a written `mailto:` does (FR-159): with `mailto` on it, a Ctrl+click
  goes to the OS mail handler; with `mailto` off it, the address is **plain text** — not a mail link,
  and **still not a path** (FR-186). In a **Markdown preview** the allowlist half is already different
  and stays so: markdown-it autolinks the address into a real `mailto:` href and 044 FR-091 opens it
  whatever the allowlist says (the **S6 addendum**, recorded there and not widened here).
  - **FR-185a — the span's text and its target differ.** The span covers the address **as written**;
    its target is `mailto:` plus that address. This is the first span in this spec where the two are
    not the same string, and it is deliberate: it is the shape an OSC 8 hyperlink has already
    (FR-011), where what a reader sees and where a click goes are two different things. FR-032's copy
    rule and FR-167's readout follow the span's own kind, as they do for any other protocol link.
  - **FR-185b — the grammar keeps paths out from both ends** *(derived — not confirmed by the
    maintainer)*: the local part MUST exclude `/` and `\`, a match MUST begin at a word boundary, and
    the domain MUST carry at least one dot and a last label of letters only. So `D:\p\a.b@c.com\x.ts`
    (a path carrying an `@`), a scoped npm package (`@scope/pkg`) and a bare `user@host` are **not**
    addresses and are left to the path grammar. FR-005's trailing punctuation applies to the address's
    own end, so an address ending a sentence does not swallow the full stop.
  - **FR-185c — an address inside a link belongs to that link** *(derived)*: a written
    `mailto:someone@example.com` is **one** span, not a link containing another, and an address inside
    a web address (`https://user@host.example/x`) belongs to the web span that found it. FR-009's
    "never both" governs here unchanged.
- **FR-186** *(derived — not confirmed by the maintainer; forced by a failing case)*: **Claiming a
  range and publishing a link are separate decisions, and a rule that answers one MUST NOT be assumed
  to answer the other.** The line scan MUST **claim** every span its grammars recognise — so no other
  grammar can re-read that range — and **publish** only the spans that are links under the settings in
  force. For a bare email address the two answers differ: the allowlist decides whether it is a
  **link**; it has no opinion on whether it is a **file**. A detector gated on the allowlist therefore
  hands the address back to the path grammar the moment `mailto` is removed, which is D7 reached by a
  second route — it passed four of the six cases and failed the sixth. This states, as a rule, what the
  scan already did for a **refused** scheme, so that the next grammar added inherits it rather than
  rediscovering it.
- **FR-187** *(maintainer, M19 — the fix for defect **D8**)*: **A hover title and a status-bar readout
  MUST name a location only where the link's own text settles it; otherwise they MUST show the text as
  written.** The maintainer's rule, verbatim: *"Title links and status bar text should always represent
  where the link will take the user to."* Since a hover resolves nothing (FR-155), "settled by the text"
  means settled **without the disk**:
  - **FR-187a — what still names a location**: an absolute spelling, drive forms included, is itself
    (FR-176); a relative path is joined onto its base — a terminal's working directory, an editor's
    file folder, else the project root (R5, R10); an OSC 8 link shows its declared target; a web or
    protocol link shows its address (FR-185a).
  - **FR-187b — what does not**: **any other rooted path** — `/tmp`, `/etc/hosts`, `/help`,
    `/usr/bin/bash.exe` — MUST read out and be titled **as its own text**, never joined onto the project
    root. This holds **even when that path does resolve to the project root** on the disk in front of
    the user: the three spellings are one shape by name, so naming the root for one means naming it for
    all of them. A home form (`~/…`) already reads as written (FR-025 is the platform's).
  - **FR-187c — the rule it replaces**: this supersedes **FR-167a**'s "any other rooted path reads
    against the **project root** (FR-024)" and the round-four review bullet that stated the same
    ordering. **FR-024 is unchanged**: it governs *resolution* — which reading is tried first — and a
    reading tried first is not a destination. The two are only in tension if a readout is allowed to
    publish a candidate, which FR-187 forbids.
  - **FR-187d — a readout that names nothing is not a failure.** The text as written is always true: it
    is what the link says, and the click is still what says where it goes. A wrong location is a worse
    answer than no location, because a user acts on it.
  - *Note — this was **drift**, not a new mistake.* `path-by-name.ts`'s module header already stated
    this rule for its undecidable cases — *"shown AS WRITTEN rather than joined onto a base they do not
    mean — the failure this module exists to stop is a readout naming a file the click will never
    open"* — while step 3 did the opposite. Where a module's documented rule and its code disagree, the
    rule is evidence and the code is a bug; here the documentation was right for a year.
  - **Known gap, reported and NOT fixed** *(2026-09-20, derived)*: **the plain-click hint has the same
    defect.** `clickTargetByName` reads `/tmp` down its relative branch and answers `editor`, so the
    hint promises "Ctrl+Click to open in throng active editor" while the click reveals the temp folder
    in OS Explorer. M19's rule arguably reaches it, but the maintainer named the **title** and the
    **status bar**, and what a hint should say for a path whose destination is undecidable is a wording
    decision they have not made. Recorded here and in the plan's *Reported to the maintainer* rather
    than answered on their behalf.

**D6 — defect, not a new requirement: a prompt's folder loses everything after its first space.**
Required by **FR-001**, **FR-003b/d**, **FR-010** and **US1**. The maintainer reports (M16) that in
PowerShell, cmd and Git Bash prompts whose working directory ends in a folder with a space —
`D:\git\throng_tests\test 1>`, `D:\git\throng_tests\test 1>`, and
`Spikeh@MUHAMMAD MINGW64 /d/git/throng_tests/test 1 (master)` — the path **is** detected but the link
stops before the `1`, and the same happens in the Claude Code CLI header that prints the same folder.

**Its cause is the rule working correctly, which is why the fix is additive**: FR-173 ends a bare
candidate at the first space, and FR-179b's terminators do not fire here — `test 1` ends in neither a
path separator nor a known extension. Read as text alone, stopping at `test` is the **right** answer,
and the 92-case table the maintainer verified personally exists to keep it that way. So the remedy is
not to relax the grammar but to give it one fact it can be told: the terminal's own working directory
(FR-183). Nothing else about the scan changes, the table is unchanged byte for byte, and a surface with
no working directory behaves exactly as before. A reproducing unit test comes first (the replicating-bugs
gate), at the lowest layer that shows it — the detection unit, plus the terminal provider driven with a
working directory.

**D7 — defect, not a new requirement: a bare email address is offered as a file.** Required by
**FR-104** (parity by construction), **FR-166** (one behaviour in all three surfaces) and **FR-009**
(a span is one kind of link, never two). The maintainer reports, verbatim: *"Raw email links in editors
are opening as links, rather than mailto links: `someone@example.com` tries to open as
D:\throng\tests\test 1\someone@example.com. The preview renders the mailto: properly, but the editor
does not."*

**Its cause is an absence, which is why no rule had to be wrong for it to happen.** Nothing in the link
grammars knew what an email address *was* — the word appears in no scanner. `detectWebLinks` wants a
scheme or a `www` host; `detectProtocolSpans` wanted a literal `mailto:`. So a bare address fell
through to the path grammar, which read it as `name.ext`, claimed it, and offered the panel's base
directory with the address appended — a file that cannot exist. Two things follow that the report does
not say, and both matter:

- **It affected terminals as well as editors.** Both take their spans from the one `scanLinkLine`
  (FR-104), so both read the address as a path; the report names editors because that is where the
  maintainer met it.
- **The Markdown preview was right by accident.** markdown-it autolinks a bare address into a real
  `mailto:` href before throng sees the text, so the preview never asked throng's grammars at all. One
  surface mailed and two offered a file — the precise failure FR-104 and FR-166 exist to prevent, and a
  reminder that a surface agreeing with the spec for a reason outside the shared scan is not evidence
  the shared scan is right.

FR-185 is the requirement the fix satisfies and FR-186 is the rule its second attempt produced. Six
cases in `packages/core/tests/unit/link-bare-email.test.ts` were written **failing first** and shown to
the maintainer before any production code was touched — four red, two green as controls (a path
carrying an `@`, and an explicit `mailto:` staying one span), which is the replicating-bugs gate and
the proof the fix did not widen the grammar.

**D8 — defect, not a new requirement: the readout names a place the click does not go.** Required by
**FR-167** (the readout shows the link's full target) and **FR-169a** (the hover title is that same
string). The maintainer reports, in two messages: *"The displayed title hover text - and the status bar
text - for `/tmp` in all three surfaces points to the relative path opf the current project, but
clicking the link goes to `C:\Users\Spikeh\AppData\Local\Temp`. Title links and status bar text should
always represent where the link will take the user to."* and *"same applies to /etc/hosts - it goes to
the windows dir, but shows as relative."*

**No rule was being broken, which is the whole interest of this defect.** `linkFirstReadingByName` sent
any rooted non-drive-form path to the project root on **FR-024 / research R6**'s authority, and R6 is
**correct**: the project root really is the first reading `resolveCandidate` tries. But *tried first*
is not *where it goes*. When that reading does not exist, resolution falls through to
`IPathForms.fromMountTable`, and which reading wins is a fact about the **disk**. A hover resolves
nothing, by round four's explicit design (FR-155), so the readout was publishing the first **candidate**
as though it were the **destination** — `/tmp` said `<project>\tmp` and opened the user's temp folder;
`/etc/hosts` said `<project>\etc\hosts` and opened the Git installation's own `etc\hosts`.

Three things make it a rule change rather than a narrowing:

- **It is undecidable, not merely wrong.** By name, `/tmp`, `/etc/hosts` and `/help` are one shape, and
  `/help` really does read against the project root (FR-174).
- **The obvious fix breaches Principle II.** Recognising mount points in the renderer means giving it a
  mount table it deliberately has no port to — `links-no-os-names.test.ts` forbids the spellings
  outright — and it would still be a guess about a disk the hover must not touch.
- **The module already said so.** `path-by-name.ts`'s header stated the as-written rule for its
  undecidable cases while step 3 did the opposite: documented rule and code had drifted apart, and the
  documentation was the correct one (FR-187's note).

FR-187 is the requirement the fix satisfies. Six cases in
`packages/ui/tests/unit/link-readout-truth.test.ts` were written **failing first** and shown to the
maintainer before any production change; the third of them proves the rule rather than the symptom — a
rooted path that **does** resolve to the project root still reads out as written. Two existing cases
that pinned the superseded rule are **rewritten, not deleted**, each carrying a note naming what
replaced it. **The hint is a known gap under FR-187**, reported rather than fixed.

### Supersessions

Each of these replaces an older statement for the cases named, and nothing wider. The older text stays
where it is.

| # | Superseded | What changes | What stays | Why |
|---|---|---|---|---|
| S1 | **024 FR-019**, "other or unknown schemes (`file:`, …) MUST NOT be opened at all"; **024 FR-019d**, Open Link "`http`/`https` only"; and 024's US7 edge case, "a non-`http(s)` scheme (`file:`, …) must not be handed to the OS opener" | A `file:` hyperlink target that resolves to an existing file or folder is a file link (FR-011), and the terminal link menu offers the file-link items for it (FR-031) | `http`/`https` open in the default browser. `javascript:`, `data:`, `mailto:` and unknown schemes stay unopenable (FR-013). No in-app browser. 024 FR-019b is unchanged. A `file:` URI still never reaches the OS URL opener (FR-037) | 024 refused `file:` because the only route out was the OS URL opener, which would launch whatever the URI named. File links now take a path-based route that checks existence and project membership and never uses that opener, which removes the risk 024 guarded against |
| S2 | 024's US7 edge case, "The link-aware items must not appear in an editor's or the file tree's menu — this is terminal-only" | An editor's content menu carries the link items over a file link (FR-031). The file tree is unchanged | Terminals keep their items. 044 FR-095 already extended them to previews | Principle VI (v5.5.0) requires Open Link and Copy Link Address on every surface that has links, and editors now have links |
| S3 | **044 FR-096c**, the Open Link command "scoped to the preview panel" | The same command, with the same default chord, is also live in editor panels (FR-045) | It is still not live in terminals (FR-046). Its chord and its preview behaviour are unchanged | Principle IV requires one command to use one chord across panel types, and two commands sharing Ctrl+Enter could be rebound apart |
| S4 *(2026-09-18)* | **024 US7 edge case (menu)**, "The link-aware items must not appear in an editor's or the file tree's menu — this is terminal-only" — the part S2 left standing, for **web** links | An editor's content menu carries Open Link and Copy Link Address over a **web** link too, and an editor recognises and follows web links exactly as a terminal does (FR-101 – FR-103) | The file tree is still unchanged. Terminals keep 024 FR-019 – FR-019d exactly: the same schemes, the same seam, the same menu pair, the same Ctrl+click — and now share their grammar with editors rather than owning it (FR-102). 024 FR-019b is unchanged | The maintainer asked for every link kind in every editor and terminal, identically. S2 already moved the file-link half; this moves the web-link half for the same Principle VI reason |
| S5 *(2026-09-19, round four)* | **024 FR-019**, "other or unknown schemes (…, `mailto:`, …) MUST NOT be opened at all", and 024's US7 edge case refusing non-`http(s)` schemes; this spec's **FR-013** | A scheme on the protocol allowlist (FR-159) is a link in terminals and editors, and a Ctrl+click hands it to the OS default handler for that scheme | `http`/`https` unchanged. `javascript:`, `data:`, `vbscript:`, every refused scheme and every scheme not on the allowlist stay unopenable, whatever the allowlist says for the refused set. A `file:` URI still never reaches the OS URL opener (FR-037). 024 FR-019b unchanged | The maintainer chose an editable allowlist over a denylist (M2), so action protocols work the way they do in other terminals while the dangerous handlers stay refused |
| S6 *(2026-09-19, round four)* | **044 FR-094**, "Hovering a link MUST show its target and the gesture that follows it, so a plain click that does nothing is never a dead end" — as the preview's only answer to a plain click; and 045 *Out of scope*'s "Links inside a Markdown preview", for the link hint and the Link menu | A plain click on a preview link shows the shared link hint (FR-165, FR-166), and a right-click opens the shared Link menu (FR-169) | The preview's hover tooltip, its Ctrl+click, its status-bar readout (044 FR-118) and what each preview link does when followed (044 FR-090 – FR-096, including FR-090e) are unchanged | The maintainer asked for one hint and one Link menu, identical in editors, terminals and the Markdown preview (M7, M10) |
| S7 *(2026-09-19, maintainer)* | The label **Copy Link Address** — 024 FR-019d, 044 FR-095 and this spec's FR-031, FR-032, FR-100, FR-103 and FR-170 | The item is labelled **Copy Link to Clipboard** in every surface (FR-175) | What it copies (FR-032, FR-103, 044 FR-116) and where it sits | The maintainer's choice; constitution Principle VI names it so from v5.5.2 |
| S8 *(2026-09-19, round four — M10's "Open Programme (for executables)"; the split derived)* | Open in OS Default Program "offered for every file" and "the only route" that runs an executable — FR-039's last sentence, FR-111's third sentence, US4 scenario 6, US8 scenario 10, the elevated-throng edge case, SC-010, SC-013 | For an **executable** the running item is **Open Program**; Open in OS Default Program is offered for every **other** file (FR-170) | One explicit, named menu item remains the only route that runs an executable; no gesture and no plain Open Link runs one (FR-111's first sentence); FR-038's de-elevation covers Open Program too | M10 names a separate item for executables; offering both for one file would be the same action twice, which *absent when meaningless* forbids |
| S9 *(2026-09-19, round four)* | SC-009, FR-030/FR-031's menu content, and *Terminology*'s "link target" (the four explicit ways) | SC-025 and FR-169 – FR-171 (with FR-170a) | FR-030's offered rules, carried into FR-170 | One Link menu (M10) |
| S10 *(2026-09-19, round four — derived)* | FR-035a's "re-checks that it exists before acting" and FR-037's "MUST check again that the path exists", **for a reveal** | FR-158a's one bounded file-or-folder check; a missing location is revealed on its parent, never answered `gone` (FR-158b) | Re-resolution from the request (FR-035a's confinement); the re-check for open in throng, Open in OS Default Program and Open Program; FR-037's `file:` rule | M1: whether a location is broken is not throng's question; M2: a folder opens as itself |
| S11 *(2026-09-19, round four)* | *Terminology*'s "click rule" — "everything else is shown in OS Explorer" | Allowlisted protocol links go to the OS handler for their scheme (FR-157 class 4, S5) | Web, in-project file and reveal rows | M2 |
| S12 *(2026-09-20, round five, maintainer M12)* | **024 US7**'s hover tooltip for a terminal link — throng's own floating tip, its wording (*"Ctrl+Click to open in system browser"*) and the delay it waited out, **`terminals.linkHoverDelayMs`**; and **031**'s bounds entry for that setting | A hover sets a native HTML `title` carrying the link's full target and nothing else (FR-169a); the setting is retired on 019 FR-023's mechanism (FR-169b) | The gesture wording, which now reaches the user through the plain-click link hint (FR-165, M7); 024 FR-019 – FR-019d's grammar, menu, Ctrl+click and open-external seam; the status-bar readout (FR-167) | M12: *"Hovering over a link … should simply show the link text, in full, in the HTML title popup. Any other popup / hover / title text should be removed."* A native title is placed, timed and dismissed by the OS, so a configurable delay has nothing left to govern |
| S13 *(2026-09-20, round five, maintainer M12)* | **044 FR-094**, "Hovering a link MUST show its target **and the gesture that follows it**" — the half **S6** kept unchanged for the Markdown preview, and FR-168's note that refined its wording | The preview's `title` is the **target alone**, by the same function the terminal and the editor use (FR-169a) | The preview's hover itself, its status-bar readout (044 FR-118), its Ctrl+click and what a preview link does when followed (044 FR-090 – FR-096, S6); the gesture wording, which the preview shows in the shared hint S6 already gave it | The same answer as S12, applied to the third surface: a preview whose title reads differently from a terminal's is precisely the second wording M12 removed |

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

**Superseded within this spec on 2026-09-19 (round four)** (each marked where it stands; text kept):

| Superseded | By | What changes |
|---|---|---|
| FR-006 ("only real locations become links") | FR-155 | Validity is syntactic; a well-formed link is drawn whether or not it exists |
| FR-013's refusal of every non-web scheme, and its last sentence (an unresolved `file:` target) | FR-159, FR-163 | Allowlisted schemes are links; a well-formed `file:` target is a link |
| FR-030's four-target table as the menu's content, and FR-031's menu | FR-169 – FR-171 | One Link menu; FR-030's offered rules and FR-031's selection and chord rules carry into it |
| FR-070 (lazy, cached existence checks for rendering) | FR-155 | No existence check for rendering; a click-time cache, if kept, is bound by its second sentence |
| FR-071's second sentence ("treated as not a link until it answers") | FR-155 | Withdrawn; the first sentence stands and binds click-time checks |
| FR-110's row "nothing that exists — not a link" | FR-155, FR-157 | Withdrawn; FR-157 restates the other rows by resource class |
| FR-120 – FR-123 as rendering rules | FR-155, FR-161 | The timeout, gate and back-off bound only follow-time and menu-open checks; FR-123 has nothing left to govern. (There is no FR-125.) |
| FR-133's "joining happens when a row is asked about" | FR-172 | Marks join logical lines when the view is drawn, throttled |
| FR-135's third row (hand only with the modifier held) | FR-164 | The hand shows on every hover of a valid link |
| FR-136's third-round note (a `file:` target marked only once resolved) | FR-155, FR-163 | Marked as drawn |
| FR-137 (the idle scan; marked only once resolved) | FR-155, FR-172 | Marked by grammar as drawn, throttled — D5's cause removed |
| FR-150's "longest first … the first that resolves" | FR-162 | A greedy syntactic path-likeness rule |
| FR-162's path-likeness rule, and FR-150's extension rule *(maintainer, same day)* | FR-173 | No spaces in a bare link, except the five overrides |
| Every "Copy Link Address" label in this spec *(maintainer, same day)* | FR-175 | "Copy Link to Clipboard" (S7) |
| FR-151's WSL clause wording *(maintainer, same day)* | FR-177 | Clarified: every drive form maps in WSL |
| FR-173's "farthest", its anchored-start rule, FR-173c's pair list and FR-173e's fixed constant *(maintainer, case-table review)* | FR-178, FR-179 | First qualifying word; any candidate with a separator; `{}` added; the extensions are a user setting |
| FR-154 for `file:` and allowlisted targets | FR-163 | They are links; the rule stands for other schemes and empty targets |
| US1 scenario 7, US2 scenarios 5 – 6, US9 scenarios 6 – 8, US10 scenario 4, US12 scenarios 2 and 6 | US13 – US16 | See the note under each story |
| Edge cases resting on existence (position ambiguity, file created later, file gone when followed, offline share ×2, `mailto:` in an editor, output that never stops, file deleted while marked, space followed by prose, OSC 8 target that stops existing) | FR-155 – FR-172 | See the note under each |
| SC-003's mechanism, SC-014's hover clauses, SC-017's "0 existence checks" framing, SC-019's "nothing that does not exist is a link", SC-020's longest-existing clause | SC-021 – SC-027 | See the note under each |
| *Terminology*: "file link" ("resolved to an existing location") | "valid link" | For rendering |
| FR-158's "without an existence check" *(derived, planning / analysis)* | FR-158a, FR-158b, FR-158d | One bounded file-or-folder check at a follow; none for a folder by grammar |
| FR-170's unresolved-link rule, and FR-170b's "enables only" *(derived, analysis)* | FR-170a, FR-170c | Applicable items drawn disabled; the menu opens at once with renderer-known rows and the answer may add, enable or remove |
| FR-179d's "never adds more than six words" *(derived, analysis)* | FR-179f | The cap counts the whole span |
| FR-159a's quoting remedy *(derived, analysis)* | FR-159a's own note | Withdrawn; a spaced `tel:` ends at its first space |
| FR-122's back-off as the renderer cache's lifetime *(derived, analysis)* | FR-122a | Kept, in main, as `LINK_ROOT_BACKOFF_MS` |
| US13 scenario 5's "with no check first" *(derived, planning)* | FR-158a | One bounded check, then the parent |

**Superseded within this spec on 2026-09-20 (round five)** (each marked where it stands; text kept):

| Superseded | By | What changes |
|---|---|---|
| FR-168 as the **tooltip's** text, with FR-168a, FR-168b and the S6 addendum's wording notes | FR-169a | A hover shows the target alone, in a native `title`. FR-168's wording is untouched as the **hint's** text (FR-169a(i)) |
| FR-135's hovered row, "the tooltip (FR-105) appears after the hover delay" | FR-169a, FR-169b | There is no tooltip of throng's and no delay; the at-rest and hovered underline rows stand, amended by FR-184 |
| FR-105 and FR-042 as the tooltip's wording, and *Assumptions*' "the **delay** is genuinely shared and unchanged" | FR-169a, FR-169b | Both describe the hint now; `terminals.linkHoverDelayMs` is retired |
| FR-060's "Web links and explicit file hyperlinks MUST NOT be affected" | FR-180 | The switch governs every link kind |
| FR-060a *(derived, analysis)* | FR-180 | Allowlisted protocol links are governed too |
| FR-165f's parenthetical, "a web link always can" | FR-180 | With the switch off no kind is hinted |
| FR-101's reading that an editor's web links survive the editor switch, and the *One link model* clause that an editor's web link is not governed by it | FR-180 | Both kinds are governed, in both panel types |
| US6 scenarios 1 and 2, "Web links and explicit file hyperlinks still work" | FR-180 | Nothing is shown while the switch is off |
| FR-120's / FR-161's descriptor text, and the label **Existence-check timeout** | FR-181 | **Link resolution timeout**; the key is unchanged |
| FR-178a (`added` / `removed`, `*`, the generated descriptor) and FR-178's empty list reached by `*` | FR-182 | One list of the real extensions; `[]` means none |
| Research **R28**'s decision for the extension list *(derived, planning)* | FR-182c | The whole list is stored, and the cost is recorded |
| Key Entities, "*Stored as the user's edits — `added` and `removed` against the shipped list*" | FR-182 | One list |
| SC-008's and SC-017's tooltip and switch clauses, SC-023's "where that kind is disabled" | SC-028 – SC-032 | See the note under each |
| FR-159a's protocol-span grammar, for **one** case: a span whose target is its own text | FR-185, FR-185a | A bare address's span is the address; its target is `mailto:` plus the address. Every written protocol span is unchanged |
| FR-003's path grammar, where a candidate is also a bare email address | FR-185b, FR-186 | The address's range is claimed before the path grammar sees it, whatever the allowlist says |
| **FR-167a**'s "any other rooted path reads against the **project root** (FR-024)", and the round-four review bullet that set that ordering out | FR-187, FR-187b | A rooted non-drive path reads out and titles **as written**. FR-167a's other rows — absolute, drive form, relative, OSC 8, "never its visible text" — stand. **FR-024 is NOT superseded**: it governs resolution, and a reading tried first is not a destination (FR-187c) |

**Tests the 2026-09-20 supersessions permit to change**, and no others *(derived — not confirmed by the
maintainer)*:

- `packages/ui/tests/unit/floating-surfaces.test.ts` — the `.terminal-link-tip` entry, deleted with the
  element it registered (FR-169a(iii)). Every other entry stays.
- `packages/ui/tests/unit/terminal-link-affordance.test.ts`, `link-parity.test.ts`,
  `link-wording-parity.test.ts` — the hovered link's title (FR-169a); the hint's wording assertions stay.
- `packages/ui/tests/component/preview-links.test.ts`, `preview-sanitise.test.ts`,
  `preview-link-readout.test.ts`, `preview-images.test.ts` — the preview's `title` becomes the target
  alone (FR-169a, S13); 044 FR-118's readout assertions stay.
- `packages/ui/tests/component/link-decorations.test.ts` — the editor's title and the resting underline
  (FR-169a, FR-184).
- `packages/ui/tests/component/link-detection-switches.test.ts`, `link-setting-live.test.ts`,
  `editor-web-links.test.ts` — a switch that is off now hides every kind (FR-180); the live-reload
  assertions stay.
- `packages/core/tests/unit/app-settings.links.test.ts`, `settings-metadata-links.test.ts`,
  `app-settings.terminals.test.ts`, `bounds-guard.test.ts`, `editor-settings.test.ts` — the single
  extension leaf and its migration (FR-182, FR-182a), the re-worded timeout and switch descriptors
  (FR-180b, FR-181) and `linkHoverDelayMs`'s retirement with its clamp (FR-169b).
- `packages/core/tests/unit/link-detect-spaces.test.ts` **MUST NOT change**: it is the maintainer-verified
  table, and FR-183 is additive precisely so that it does not (SC-031).
- Additions only: `packages/core/tests/unit/link-detect-known-directory.test.ts` and
  `packages/ui/tests/unit/terminal-link-prompt-cwd.test.ts` (FR-183, D6), and
  `packages/core/tests/unit/link-bare-email.test.ts` (FR-185, FR-186, D7). **No existing case changed
  for D7**: the address grammar takes a range the path grammar used to claim, and every path case that
  still holds a path still passes — which is what its two green control cases exist to show.
- `packages/ui/tests/unit/link-readout-truth.test.ts` — **new**, six cases (FR-187, D8). Two existing
  cases pinned the superseded project-root rule and are **rewritten, never deleted**, each carrying a
  note naming what replaced it and why:
  `packages/ui/tests/unit/link-by-name-readings.test.ts` — *"a rooted path that is NOT a drive form
  reads against the project root first (FR-024)"* — and
  `packages/ui/tests/component/link-target-readout.test.ts` — *"shows a rooted non-drive path against
  the project root (FR-024)"*. Both now assert **as written** (FR-187b). Every other case in both files
  stays, including the drive-form, relative and OSC 8 rows, which FR-187a leaves untouched.
- `packages/ui/tests/e2e/terminal-link-once.e2e.ts` and `terminal-links.e2e.ts` — the deleted tip was
  their "a link resolved" signal; the status-bar readout and the panel's `title` are the signal now
  (FR-169a(ii)). No declaration is added or removed by that change, and
  `packages/ui/tests/e2e/e2e-budget.json` does not move for it.

**Tests the 2026-09-19 supersessions permit to change**, and no others *(derived — not confirmed by the
maintainer; `/speckit-tasks` confirms each against the file before it is edited)*:

- `packages/ui/tests/unit/terminal-link-idle-scan.test.ts` — its wait-for-quiet assertions (FR-172);
  every zero-existence-check assertion stays and is widened (FR-072, SC-021).
- `packages/ui/tests/unit/terminal-link-affordance.test.ts` — the FR-154 cases for a missing or
  unreachable `file:` target, which now expect a link (FR-163), and the hand-only-with-modifier cases
  (FR-164). The `notascheme:foo` and empty-target cases stay.
- `packages/ui/tests/unit/terminal-file-link-provider.test.ts`, `link-cache.test.ts` and
  `file-link-resolver-network.test.ts` — assertions that a link waits for or depends on an existence
  answer before it is drawn (FR-155). Their per-root gate and back-off cases stay, re-read as follow-time.
- `packages/core/tests/unit/link-detect-spaces.test.ts` and the FR-150 cases in `link-detect.test.ts` —
  replaced by M4's maintainer-verified case list (FR-162; since superseded by FR-173 / FR-179, whose
  table `link-detect-spaces.test.ts` now is).
- `packages/core/tests/unit/terminal-link-menu.test.ts`, `link-menu.test.ts`,
  `packages/ui/tests/component/terminal-file-link-menu.test.ts`, `editor-web-link-menu.test.ts` and
  `preview-link-menu.test.ts` — the menu's content and shape (FR-169 – FR-171).
- `packages/core/tests/unit/link-hover-text.test.ts` — the in-editor wording (FR-168); the web wording
  must not change.
- `packages/ui/tests/unit/external-url.test.ts` MUST NOT change except to add the allowlisted-scheme
  channel's cases; its `file:` refusal stays (FR-037).
  *Planning chose to leave it wholly unchanged: the new channel's cases live in
  `packages/ui/tests/unit/external-link-uri.test.ts` (tasks T257).*

*Added 2026-09-19 while planning (derived — each tied to the requirement that moves it; tasks.md's
round-four list is the same set)*:

- `packages/core/tests/unit/link-resolve.test.ts:170-173` and `:367` — the drive-form order (FR-176).
- `packages/core/tests/unit/link-guards.test.ts` — the `LINK_CACHE_TTL_MS` and `LINK_IDLE_SCAN_MS` edges
  (FR-155, FR-172); the per-line and space-word edges stay.
- `packages/ui/tests/component/link-decorations.test.ts`, `editor-link-gestures.test.ts`,
  `editor-web-links.test.ts`, `link-position-open.test.ts` — cases expecting an unresolved path unmarked
  (FR-155), and the modifier-only pointer (FR-164).
- `packages/ui/tests/component/editor-content-menu.test.ts`, `link-out-of-project.test.ts`,
  `link-target-actions.test.ts`, `link-copy-address.test.ts`, `packages/core/tests/unit/menu-sections.test.ts`
  and `packages/ui/tests/unit/menu-sections.test.ts` — the link run's place and shape, and the label
  (FR-169 – FR-171, FR-175).
- `packages/ui/tests/component/preview-links.test.ts` — the preview tooltip's wording (FR-168's note) and
  the plain-click hint (FR-165, S6).
- `packages/ui/tests/unit/terminal-link-activation.test.ts` and `link-parity.test.ts` — the plain click
  gains the hint; the zero-check counter is widened (FR-165, SC-021).
- `packages/ui/tests/component/link-setting-live.test.ts` and `link-failure-notice.test.ts` — the new
  settings go live (FR-159, FR-178), and the notice gains the OS's reason (FR-036).
- `packages/core/tests/unit/app-settings.links.test.ts`, `settings-metadata-links.test.ts`,
  `theme-link-tokens.test.ts`, `shipped-defaults-upgrade.test.ts` — additions only, plus the re-worded
  descriptors (FR-161, T232).
- `packages/core/tests/unit/link-classify.test.ts:26-30` — `mailto:` is no longer inert when allowlisted;
  the gate is retired into `resourceClass` (FR-159, FR-163; T289).
- `packages/ui/tests/unit/terminal-hovered-link.test.ts:145`, `:172` — the "Ctrl+Click to open" wording
  (FR-168).
- `packages/ui/tests/component/editor-web-links.test.ts:116` and its channel assertion — `mailto:` in an
  editor becomes a link when allowlisted, followed on `throng:linkUri:openExternal` (FR-159, S5).
- `packages/ui/tests/component/link-detection-switches.test.ts` — the external channel it asserts moves
  to `throng:linkUri:openExternal` (FR-159, FR-156); its switch semantics stay, plus FR-060a.
- `packages/core/tests/unit/links-no-os-names.test.ts` — a named exemption for `known-extensions.ts`
  (FR-178b); every other rule stays.
- `packages/core/tests/unit/link-web-url.test.ts` MUST NOT change: the protocol grammar lives in its own
  module (FR-159a).
- `packages/ui/tests/unit/terminal-link-base-directory.test.ts:108-127` — its hover-time ask becomes an
  assertion on the follow request's working-directory base (FR-155, FR-023, FR-144); its component twin loses
  only its `link-cache` import. `packages/ui/tests/component/link-out-of-project.test.ts` (`:155`, `:174`,
  `:275`), `link-setting-live.test.ts` (`:111`, `:142`, `:207`, `:209`) and
  `packages/ui/tests/unit/link-parity.test.ts:210` — `followLink`'s signature (T294).
- `packages/ui/tests/contract/link-ipc.contract.test.ts` — the `throng:links:` channel set grows by
  `follow` (four `handle` channels, `LinkIpcService` and `window.throng.links` gain `follow`, with the
  I1/I2 whitelist and root derivation asserted on it; tenth analysis pass). Its invoke-only and
  no-`send` invariants stand: the allowlisted-scheme channels live outside that namespace.
- Additions only: `packages/ui/tests/e2e/terminal-link-once.e2e.ts` (T280, inside existing declarations),
  `packages/ui/tests/integration/electron-shell-integration.test.ts` and
  `packages/core/src/testing/shell-integration-contract.ts` (T259).
- `packages/ui/tests/component/link-actions-router.test.ts` and `link-position-open.test.ts` — the follow
  becomes an awaited, bounded resolution instead of a synchronous cached answer (FR-155, FR-160; T293).
- `packages/ui/tests/component/link-default-action-wiring.test.ts` (`:161`, `:184`, `:236`, `:319`,
  `:348`, `:357`) and `link-executable-refusal.test.ts` (`:124`, `:145`, `:162`) — their calls to
  `followLink` lose the synchronous `resolve` argument (FR-155, FR-160; T294); their "a gesture never runs
  an executable" assertions stay.
- `packages/ui/tests/component/link-executable-refusal.test.ts:243-257` — an executable runs from Open
  Program, not Open in OS Default Program (S8); `packages/ui/tests/integration/link-de-elevated-open.integration.test.ts`
  — additions for Open Program (FR-038's extension).
- `packages/ui/tests/unit/terminal-hovered-link.test.ts:189-224`, `:240-246` and
  `packages/ui/tests/component/link-detection-switches.test.ts:182` — the hover-time ask for OSC 8
  targets (FR-163, FR-159).
- `packages/ui/tests/integration/link-ipc-confinement.integration.test.ts:197-207` and
  `packages/ui/tests/integration/file-link-resolver.integration.test.ts:310-327` — a reveal of a missing
  out-of-project location reveals its parent instead of answering `gone` (FR-158b, S10); their
  confinement cases stay.
- `packages/ui/tests/component/link-default-action-wiring.test.ts:231`,
  `packages/ui/tests/unit/menu-icon-tokens.test.ts:97-98`, `:297`, `:598-599` and
  `packages/ui/tests/unit/redraw-menu-parity.test.ts:81-82` — callers of the per-surface link runs that
  FR-169 folds into the Link menu.
- `packages/ui/tests/e2e/terminal-links.e2e.ts` (`:12-40`, `:66`, `:84-92`, `:153-156`, `:213-307`, `:313`, `:370-452`) — the
  look-alike `./nothere.ts` and the two dead `file:` OSC 8 targets become marked links (FR-155, FR-163);
  `notascheme:foo` and the empty target stay dead; the header's idle-scan wording goes (FR-172). No
  declaration is added or removed.
- `packages/core/tests/unit/links-no-os-names.test.ts:151-165` — its expected module list follows the
  modules round four adds and retires (`classify.ts`, `targets.ts` out; `resource-class.ts`, `sanitise.ts`,
  `protocol-uri.ts`, `refused-schemes.ts`, `known-extensions.ts` in).
- `packages/core/tests/unit/link-targets.test.ts` — deleted with `core/src/links/targets.ts`, which
  `buildLinkMenu` absorbs; its still-true cases move to `link-menu.test.ts` and its executable row follows
  S8.

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
- *(2026-09-19, round four — not reconciled, reported)* **Constitution Principle VI** names **Copy Link
  Address** as the item every link menu carries and requires link actions in "a panel's context menu";
  M10 asks for "Copy Link to Clipboard" in a Link menu separate from the panels' context menus. FR-170
  keeps the constitutional label and FR-171 opens the Link menu as the context menu over a link, which
  is read as satisfying the principle; the label question is left to the maintainer, and no
  constitution amendment is made here.
  *Resolved 2026-09-19: the maintainer chose "Copy Link to Clipboard"; the constitution is amended to
  v5.5.2 (`c855eadd`) and FR-175 applies it.*
- *(2026-09-20, round five — **not reconciled, reported**)* **Constitution Principle VI** says *"A link
  MUST show **on hover** that it is actionable, **and by which gesture**, so a plain click that does
  nothing is never a dead end"* (`.specify/memory/constitution.md:1758`). FR-169a's hover shows that a
  link is actionable — the underline (FR-184), the hand pointer (FR-164) and a native `title` carrying
  its target — but it **does not name the gesture on hover**; the gesture is named the instant a plain
  click lands, by the link hint (FR-165), which is the clause's own stated purpose. Round four's derived
  answer cited this very sentence to keep the tooltip; M12 removes it. Two readings are open and only
  the maintainer can close them: **(a)** the clause is satisfied, because the dead end it forbids is
  exactly what the hint prevents, and "by which gesture" is met at the moment the user asks; or **(b)**
  the clause means literally on hover, and it needs an amendment saying the gesture may be named by the
  affordance a plain click raises. This spec ships **(a)** and makes no constitution amendment, exactly
  as round four shipped the constitutional label and left the question open. Nothing else in Principle
  VI changes: the menu route, Open Link and Copy Link to Clipboard are untouched.

### Key Entities

- **File link**: a span of terminal output or editor text; its kind (detected path or explicit file
  hyperlink); the text as written; its position, if any; the panel and owning project it was seen in.
- **Resolved target**: an absolute location; whether it is a file or a folder; whether it is in the
  project; when its existence was last confirmed.
  *Superseded in part 2026-09-19 (FR-155): nothing records when existence was confirmed; a target is
  resolved fresh at each follow or Link-menu opening.*
- **Link target**: one of Open in Editor, Open in Preview, Open in OS Explorer, Open in OS Default
  Program; whether it is offered, disabled or absent for a given resolved target.
  *Superseded 2026-09-19 by FR-170: the Link menu's items (Open Link, Open In ▸, Open Preview, Open in
  OS Explorer, Open in OS Default Program, Open Program, Copy Link to Clipboard) are the targets.*
- **Executable classification**: whether the OS would execute a file, answered from its extension by
  the platform abstraction (FR-039a).
- **Default link action** (setting): one of the five values in FR-050. *Retired 2026-09-18
  (FR-112); a persisted value is dropped (FR-113).*
- **Click rule** *(2026-09-18)*: the fixed decision FR-110 states, from a resolved link, whether it
  carries a position, and whether its preview is the file's default open action — never from a
  setting.
- **Web link** *(2026-09-18, editors)*: a span of editor text the shared web grammar matched
  (FR-102), with its address.
- **Existence-check timeout** (setting, 2026-09-18; **relabelled "Link resolution timeout" 2026-09-20,
  round five, FR-181 — the key is unchanged**): how long one existence check may run before it
  answers unreachable (FR-120).
  *Amended 2026-09-19 (FR-161): it bounds every check of one follow or Link-menu opening in total.*
- **Link affordance** *(2026-09-18, second round)*: the at-rest, hovered and modifier-held states of
  FR-135, drawn from the `linkUnderline` and `linkUnderlineHover` theme tokens (FR-138).
- **Logical line** *(2026-09-18, second round)*: a terminal row plus the wrapped continuation rows
  xterm marks as belonging to it; the unit a link is detected on (FR-130).
- **Volume root state** *(2026-09-18)*: per volume root, whether a check is outstanding past the
  timeout and until when the root is being left alone (FR-121, FR-122). Main-process memory only;
  never persisted.
- **Extended reading** *(2026-09-18, third round)*: an anchored candidate lengthened across spaces,
  one word at a time; tried longest first, and existence decides which one is the link (FR-150).
  *Superseded 2026-09-19 by FR-155, FR-173 and FR-179: one span per candidate, chosen by grammar.*
- **Git Bash mount table** *(2026-09-18, third round)*: the mapping from Git Bash's rooted paths to
  Windows folders, read from the installed Git for Windows behind the platform abstraction (FR-151).
- **File-link detection switches** (settings): one for terminals and one for editors.
- **Hyperlink-advertising switch** (setting): whether a new terminal is started with
  `FORCE_HYPERLINK=1` (FR-080b).
- **Open Link command**: the one keyboard command that follows a link, shared by previews and editors.
- **Valid link** *(2026-09-19, round four)*: a span or OSC 8 target the grammar accepts, with its
  resource class (FR-157) — decided with no filesystem access (FR-155).
- **Protocol allowlist** (setting, 2026-09-19): the scheme names a Ctrl+click may hand to the OS
  handler; and the **refused set** that overrides it, behind the platform abstraction (FR-159).
- **Known file extensions** (setting, 2026-09-19, maintainer): the extensions that let a path with a
  separator cross spaces (FR-173e); shipped as a common list, editable by the user (FR-178).
  *Stored as the user's edits — `added` and `removed` against the shipped list (FR-178a).*
  *Superseded 2026-09-20 (round five, FR-182): **one** list, `editor.links.knownFileExtensions`,
  holding the extensions themselves; the old `{ added, removed }` shape is migrated on read (FR-182a),
  an empty list means no extension at all (FR-182d), and the cost is FR-182c.*
- **Known working directory predicate** *(2026-09-20, round five)*: the caller-supplied, pure test "does
  this text name the directory this surface is in?", which lets a scan cross a space (FR-183). Renderer
  state only, derived from 025's live working directory (FR-023); absent for every surface that has
  none, and never persisted.
- **Bare email address span** *(2026-09-20, round five, D7)*: a protocol span whose scheme is
  **supplied** rather than written — its range is the address as written, its target is `mailto:` plus
  that address (FR-185a). Claimed whenever the grammar accepts it; published only while `mailto` is
  allowlisted (FR-186).
- **Hover title** *(2026-09-20, round five)*: the native HTML `title` carrying a hovered link's full
  target — the only hover surface throng draws, and the same string the status-bar readout shows
  (FR-169a). The retired `terminals.linkHoverDelayMs` was its predecessor's delay (FR-169b).
- **Link hint** *(2026-09-19)*: the one app-wide popover a plain click shows — its anchor link, its
  message, and when it hides (FR-165, FR-166). View state only; never persisted.
- **Link menu** *(2026-09-19)*: the one menu component holding link actions, and the single resolution
  it makes when it opens (FR-169 – FR-171).
- **Status-bar link readout** *(2026-09-19)*: the hovered link's full target in a terminal's or an
  editor's status bar (FR-167).
  *Amended 2026-09-20 (round five, FR-169a, FR-187): the same string is the hover title on all three
  surfaces, and it names a location only where the link's text settles it — a rooted non-drive path
  shows as written, because nothing but the disk can say where it goes (D8).*

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
  *Amended 2026-09-19 (round four): the fixture's result is unchanged, but it now holds by grammar
  alone (FR-155, FR-162) — no span is withheld because a check failed.* *FR-162 is superseded by
  FR-173 / FR-179; read "by FR-173 / FR-179's grammar".*
  *Amended 2026-09-19 (maintainer) by FR-174: any rooted token (`/help`) is a link, so the fixture
  holds no rooted token, or counts it as a link.*
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
  *Amended 2026-09-20 (round five): a switch now applies to every link kind (FR-180) and to the next
  **detection pass**, which an idle prompt must be asked for; the timeout is the **link resolution
  timeout** (FR-181), and the known-extension list joins them (FR-182). SC-029 and SC-030 state the
  detail.*
- **SC-009**: Every file-link menu, in both panel types, shows exactly the items FR-030 and FR-031
  prescribe for its link, with no extra, missing or wrongly enabled items, across in-project file,
  in-project file with a provider, in-project file with a disabled provider, out-of-project file and
  folder links.
  *Superseded 2026-09-19 by SC-025: the Link menu's items are FR-169 – FR-171's (with FR-170a).*
- **SC-010**: Across every extension the classification calls executable (FR-039a), 0 files are run by
  Ctrl+click, the Open Link chord or the plain Open Link item, at any setting — and each one still
  runs when Open in OS Default Program is chosen.
  *Amended 2026-09-19 (**S8**): "…each one still runs when **Open Program** is chosen".*
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
  *Amended 2026-09-19 (**S8**): an executable opens when **Open Program** is chosen; every other file
  when Open in OS Default Program is.*
- **SC-014** *(2026-09-18)*: Every existing location on a reachable share — spelled `\\s\h\…`,
  `//s/h/…`, `file://s/h/…` and `FileSystem::\\s\h\…`, and reached as a relative path from a network
  working directory, a network document folder and a network project root — resolves and is followed
  in 100% of the fixture cases. With the server offline, a hover answers within the existence-check
  timeout, at most one check per volume root is outstanding, and no check at all is started under
  that root during its back-off.
  *Superseded in part 2026-09-19 (round four) by FR-155 and FR-161: "a hover answers" reads "a follow or
  a Link-menu opening answers"; a hover makes no check. The first sentence stands.*
- **SC-015** *(2026-09-18, second round)*: For every link kind soft-wrapped across two and three rows,
  every row is marked at rest and a Ctrl+click on each row follows the whole target exactly once —
  100% of cases, in every flavour run.
- **SC-016** *(second round)*: Every corpus line carrying a position opens an editor at that line and
  column, including a Markdown file whose default open action is Preview (D2).
- **SC-017** *(second round)*: Web, detected-path and OSC 8 links are indistinguishable in their
  at-rest and hover styling across both panel types; 0 link texts are recoloured; and 0 existence
  checks run while terminal output is being delivered (FR-072, unchanged).
  *Amended 2026-09-19 (round four): the zero-check clause is widened by SC-021 to every moment before a
  follow or a Link-menu opening; the styling clauses stand, with the hand pointer on every hover
  (FR-164).*
  *Amended 2026-09-20 (round five): "indistinguishable in their at-rest and hover styling" is unchanged
  and now measured at FR-184's prominences — translucent at rest, solid on hover. SC-032 states it.*
- **SC-018** *(second round)*: Every cell of FR-145's matrix passes for every installed built-in
  flavour, and for WSL where configured; a flavour not installed is reported as not run.
- **SC-019** *(third round)*: Re-running the maintainer's corpus through the probe in every installed
  built-in flavour and in an editor yields **0 FAIL** rows against the maintainer's expected column,
  with the OSC 8 rows reported not applicable in the editor and a WSL flavour reported not run unless
  one is configured.
  *Superseded in part 2026-09-19 (round four) by FR-155: the maintainer's expected column changes for
  every row whose expectation was "not a link because it does not exist"; those rows are now links, and
  following them obeys FR-158 or FR-160. The corpus's expected column is re-read with the maintainer
  before it is re-run.*
- **SC-020** *(third round)*: In the SC-003 prose fixture extended with spaced prose after existing
  paths, 0 spans are marked that are not an existing location, and no marked span extends past the
  longest existing reading; each path in the fixture that contains a space (drive, UNC, Git Bash,
  WSL `/mnt`, `file:` with `%20`) resolves in both panel types.
  *Superseded in part 2026-09-19 (round four) by FR-162: "the longest existing reading" reads "the
  reading the path-likeness rule selects"; the rest stands.* *FR-162's path-likeness rule is itself
  superseded by FR-173 / FR-179: read "the span FR-173 / FR-179 select".*
- **SC-021** *(2026-09-19, round four)*: Across every link kind and resource class, in both panel types
  and in a terminal whose output never pauses, 0 existence checks run before a Ctrl+click, an Open Link
  or a Link-menu opening, and every well-formed fixture link is marked at rest within one throttle
  interval of being drawn.
  *Clarified 2026-09-19: the throttle interval is the terminal's (FR-172); an editor marks a link as it
  draws it. A follow checks the disk only for a UNC or on-device link — web, loopback and protocol
  follows make no check.*
- **SC-022** *(round four)*: The M4 case list — positive and negative, including SC-003's prose fixture
  and every spaced path in FR-150's corpus rows — is verified by the maintainer before implementation,
  and the implemented grammar agrees with it in 100% of cases.
  *Clarified 2026-09-19: the verified table is `link-detect-spaces.test.ts`; SC-003's prose fixture is
  not in it and is held separately (T243), through the same function `scanLinkLine` uses.*
- **SC-023** *(round four)*: A plain click on a valid link shows the link hint in 100% of fixture cases
  in editors, terminals and the Markdown preview; a hover, a Ctrl+click and a drag show it in 0; at
  most one hint exists app-wide in every case; it covers no link text except where on-screen clamping
  forces it; and it stays fully on screen at every window edge.
  *Amended 2026-09-20 (round five): "where that kind is disabled" reads "where that panel type's switch
  is off", which now hides every kind (FR-180); and the hint is the **only** popover throng draws, since
  the hover tooltip it sat beside is gone (SC-028).*
- **SC-024** *(round four)*: Across every refused scheme, with and without it added to the allowlist,
  and across a fixture of crafted link texts (metacharacters, quotes, control characters, `%00`), 0
  commands run and 0 refused handlers are invoked; every allowlisted scheme reaches its handler.
- **SC-025** *(round four)*: For each link fixture (in-project file, with a provider, with a disabled
  provider, executable, out-of-project file, folder, web, action protocol, unresolved), the Link menus
  of a terminal, an editor and a Markdown preview are identical, and each shows exactly FR-170's items.
  *Clarified 2026-09-19: the action-protocol fixture is **`mailto:`** at shipped settings — the one
  allowlisted scheme a preview also treats as a link (S6 addendum). "Identical" is items, order, labels and enablement; the Open Link chord is
  shown only where bound (FR-169's note). "Exactly FR-170's items" reads with FR-170a: the unresolved
  fixture draws its applicable target items disabled.*
- **SC-026** *(round four)*: With Claude Code's full-screen interface running and its status line
  updating, every link on screen is marked at rest and shows its hover state and hand pointer on hover,
  and none survives a switch between the alternate and normal screen buffers (D5).
- **SC-027** *(round four)*: Hovering any fixture link in a terminal or an editor with the status bar
  shown puts its full target at the bottom-left of that status bar in 100% of cases, and nothing with
  the status bar hidden.
  *Amended 2026-09-20 (round five): the readout is unchanged, and SC-028 adds that the hover **title**
  carries the same string — one function, two places, so they cannot disagree (FR-169a(ii)).*
- **SC-028** *(2026-09-20, round five)*: Hovering any fixture link in a terminal, an editor or a
  Markdown preview shows **exactly one** hover surface — a native HTML `title` whose text is the link's
  full target and nothing else — in 100% of cases; **0** tooltips, tips or popovers drawn by throng
  appear on hover, in any surface, at any delay; the title is cleared when the pointer leaves and on
  dispose; and the plain-click hint and the status-bar readout still appear exactly as SC-023 and SC-027
  require. A hovered OSC 8 hyperlink's title is its declared target, never its visible text.
- **SC-029** *(round five)*: With a panel type's detection switch **off**, **0** links of any kind —
  detected path, web, allowlisted protocol, OSC 8 hyperlink — are marked, hovered, hinted, followed or
  given a Link menu in that panel type, across the full link fixture; with it **on**, 100% of the same
  fixture is. The other panel type is unaffected in both directions, a change takes effect with no
  restart, and it repaints a terminal sitting at an idle prompt as well as one under output.
- **SC-030** *(round five)*: A settings document holding round four's `{ added, removed }` known-extension
  shape yields, on read, exactly the set those edits resolved to, in 100% of the migration fixtures; the
  old keys are absent after the next ordinary write, and parse → serialise → parse → serialise is a fixed
  point. An empty list ends **0** spaced paths, Reset to Defaults restores the shipped list, and the same
  resolved set is read by every scan including the main process's. A persisted `terminals.linkHoverDelayMs`
  is dropped the same way and changes nothing.
- **SC-031** *(round five)*: In PowerShell, cmd and Git Bash, with a working directory whose last segment
  contains a space, the prompt's path is one link covering the whole folder name in 100% of cases, in
  every built-in flavour that reports its directory — and the same holds for the Claude Code CLI header
  printing that folder (D6). With no reported working directory the answers are exactly the case table's,
  and `packages/core/tests/unit/link-detect-spaces.test.ts` passes **unchanged, byte for byte**. **0**
  filesystem calls are made by detection in any of these cases (SC-021, unchanged).
- **SC-032** *(round five)*: Across the link fixture in a terminal, an editor and a Markdown preview, a
  link's resting underline is visibly less prominent than its hovered one and its hovered one is solid,
  in 100% of cases; **0** new theme tokens are introduced; and the preview's stylesheet still passes its
  token and contrast gate (`preview-css-tokens.test.ts`, SC-005) with no colour function and no
  `linkUnderline` reference.
- **SC-033** *(round five, D7)*: Across a fixture of bare email addresses — alone, mid-sentence, at the
  end of a sentence, inside a written `mailto:`, and inside a web address — a terminal, an editor and a
  Markdown preview agree in 100% of cases: every address is a `mailto:` link, and **0** are offered as
  files. With `mailto` removed from the allowlist, **0** addresses are links in a terminal or an editor
  and, still, **0** are offered as files there — the preview keeps its own `mailto:` under 044 FR-091,
  which is the existing S6-addendum difference and not a failure of this criterion. A path carrying an
  `@`, a scoped npm package and a bare `user@host` are read as addresses in **0** cases, and SC-001's
  and SC-012's path fixtures are unchanged.
- **SC-034** *(round five, D8)*: For every link in the fixture, in all three surfaces, the hover title
  and the status-bar readout either name the location the Ctrl+click actually opens or show the link's
  **own text** — 100% of cases, with **0** naming a third thing. The fixture includes `/tmp` and
  `/etc/hosts` (which resolve outside the project), `/help`, and a rooted path that **does** resolve
  inside it — all four read as written — beside a drive form, an absolute path, a relative path, an
  OSC 8 hyperlink and a web address, which each name their location. **0** filesystem calls are made to
  produce any readout or title (FR-155, SC-021 unchanged). The known gap under FR-187 — the plain-click
  hint — is **excluded by name**: this criterion covers the title and the readout, and the hint is
  measured only when the maintainer rules on its wording.

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

  *Superseded 2026-09-20 (round five, maintainer M12) by FR-169a and FR-169b. This whole assumption was
  about a tooltip throng drew; it draws none. The hover is a native `title` carrying the target, timed
  by the OS, so **the delay is not shared — it no longer exists**, and `terminals.linkHoverDelayMs` is
  retired. The wording this assumption argues about lives on in the link hint (FR-165), where its
  reasoning still applies word for word.*
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
- *(2026-09-19, round four)* **Test layers for round four** *(derived — not confirmed by the
  maintainer)*. The grammar (FR-155, FR-162), the resource classes, the allowlist and refused set, and
  the input validation (FR-156 – FR-159) are pure decisions — unit, with the refused set's OS members a
  contract test; M4's case list is written and shown to the maintainer before any grammar change. The
  link hint's placement, clamping and single-instance rule, the Link menu's items, the tooltip wording
  and the status-bar readout are component tests. D5 starts with a reproducing unit test over a fake
  terminal whose output never pauses and which switches buffers. Only a real renderer shows xterm's
  pointer and a hint over real cell geometry, so any E2E is a case inside an existing declaration; the
  budget does not move.
- *(2026-09-20, round five)* **Test layers for round five** *(derived — not confirmed by the
  maintainer)*. The space rule's new input (FR-183) is a pure decision — unit, in `@throng/core`, beside
  the untouched case table; the predicate that supplies it, and the prompt forms it exists for, are a
  renderer decision over a fake terminal — unit (ui), which is where D6's reproduction lives. The
  settings shape, its migration and the descriptors (FR-169b, FR-180b, FR-181, FR-182) are unit tests
  over `parseAppSettings` and the metadata. The hover title, the switches' reach and the underline
  (FR-169a, FR-180, FR-184) are component tests, because they are rendered output and in-component
  behaviour — a `title` attribute, a mark's presence, a computed style. **One E2E case** is added, in
  `packages/ui/tests/e2e/terminal-links.e2e.ts`: the deleted tip was two existing specs' "a link
  resolved" signal, and only a real window shows that the native `title` reaches the DOM on a real hover
  over real cell geometry. Replacing that signal inside the existing declarations moves **no**
  declaration and **no** budget entry; the one added declaration raises
  `packages/ui/tests/e2e/e2e-budget.json` by one, in the same commit that adds it (the ratchet fails
  both ways).
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
  *Superseded in part 2026-09-19 (round four) by FR-166 and FR-169 (S6): the preview adopts the shared
  link hint and the shared Link menu. What a preview link does when followed stays 044's.*
- Opening a file outside the project in a throng editor or preview.
- Hover previews or peeks of a linked file's contents.
- Links to symbols (`FooService.bar`) rather than paths.
- Remote paths over SSH, and WSL filesystems beyond mapping `/mnt/<drive>/` onto that drive.
  *Amended 2026-09-19 by FR-177: in a WSL flavour both drive forms, `/mnt/<drive>/…` and `/<drive>/…`, map
  to that drive; the distro's own filesystem stays out of scope.*
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
  *Superseded 2026-09-19 by FR-179c: any candidate with a separator may scan, but `test` has none, so
  `test 1/x.md` still yields only `1/x.md`; `src/my file.ts` is now one link.*
- Revealing a linked file in throng's own Files & Folders view. #394 does not list it, and the four
  targets are what it asked for.
- *(2026-09-18)* Applying the click rule (FR-110) to links inside a **preview**. 044 FR-090 – FR-096
  still govern them; the one difference is recorded under *Reconciled* (044 FR-090e).
- *(2026-09-18)* Recognising that two **names** denote one location — a mapped drive letter and its
  UNC, an admin share and its drive, an 8.3 short name (FR-106).
