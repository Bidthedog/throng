# Feature Specification: Native Encodings and Line-Ending Conversion

**Feature Branch**: `feature/S059-I517-native-encodings-line-endings`

**Created**: 2026-10-24

**Status**: Draft

**Issues**: closes #517 (open and save UTF-16 and Windows-1252 files in their own encoding), #71
(convert a document's line endings, LF / CRLF). #71 was swept into v1.0.0 from vNext by the backlog
planning pass of 2026-10-24 (group G4), on the grounds that both issues put "the file's own format,
preserved and changeable" on the same status-bar surface and go through the same decode/encode path.

**Input**: User description: "Spec 059 for GitHub issues #517 (Open and save UTF-16 and Windows-1252
files in their own encoding) and #71 (Convert a document's line endings LF/CRLF)." The two issue bodies
are the requirements; this spec settles what they left open and records it under *Decisions*.

---

## Why this spec exists

throng's editor reads and writes UTF-8 only. On Windows that fails two kinds of file a developer
meets every day, and it fails them in opposite directions:

- **UTF-16 files are refused as binary.** Windows PowerShell 5.1 writes UTF-16 for `>` and
  `Out-File`; so do `reg export`, many `.reg`, `.inf` and `.rc` files and older Visual Studio files.
  Every ordinary character in UTF-16 carries a zero byte, so the binary check calls the file binary
  and the editor says "That file is not text". The file is text; the message is wrong.
- **Windows-1252 files open and are silently destroyed.** They contain no zero bytes, so they open,
  but every accented or symbol byte is decoded to the replacement character `�`, and **saving writes
  that replacement back for every non-ASCII character in the file**, not only the ones near the edit.
  Find in Files replace and the preview's task toggle already refuse such files (043 FR-056 and the
  `isDecodableUtf8` guard); the editor's own load path does not.

Separately, 016 deliberately made line-ending conversion an **explicit user action** and deferred it
(016 FR-023a / FR-023b): throng must never *create* a mixed file and must never *silently repair*
one. That left a user with no way to convert a file at all, and no way to see what its endings are.

## Requirements this spec builds on, and the ones it supersedes

Searched before any requirement below was written (`specs/*/spec.md`, `packages/*/tests`):

| Requirement | What it says | Relationship |
|---|---|---|
| 006 FR-025 / FR-026 / FR-027 / SC-005 | Detect and preserve a file's encoding and line endings; new documents UTF-8, no BOM, `editor.defaultLineEnding`; detection in the OS-agnostic core | **Extended** to more encodings. New documents unchanged |
| 013 FR-008, 043 FR-056, 054 FR-029 | Replace, Find in Files commit and the task toggle preserve encoding, endings and BOM | **Extended**: they now preserve UTF-16 and Windows-1252 too, and stop refusing those files |
| 016 FR-023a | One effective line ending per document, the dominant one; everything throng inserts uses it | **Unchanged**, and the conversion action relies on it |
| 016 FR-023b | throng MUST NOT normalise an already-mixed file on its own | **Unchanged.** Conversion here is the explicit user action FR-023b deferred to. Nothing converts without being asked |
| 016 FR-010c | The status strip is "the intended home for further per-document status (encoding, line endings…)" | **Fulfilled** |
| 040 FR-003a | Character counts include each line break once, however spelled | **Unchanged.** A conversion does not change the character count. No work needed |
| 040 FR-013 | Right-aligned group = language label + wrap toggle | **Superseded by FR-030** below: the group gains the encoding and line-ending indicators |
| 040 FR-024 | The hide order terminates after `line`; language and wrap toggle are never hidden by width | **Superseded by FR-032** below: the hide order now continues through the line-ending and then the encoding indicator before it terminates. Language and wrap toggle keep their guarantee |
| 059 D2, FR-027 | Save with Encoding writes at once; an encoding change has no undo | **Superseded by FR-055** (2026-10-25): choosing an encoding changes the document, dirty and undoable, and the ordinary save writes it |
| 059 D5, FR-035, FR-038, FR-040 | Conversion targets are LF and CRLF; two Convert menu items | **Superseded by FR-057, FR-058** (2026-10-25): LF, CR and CRLF are all targets, offered with Mixed in one Line Endings list |
| 030 FR-029a | Panel casualties group by the originating operation, always — not by cause | **Partially superseded by FR-054** below (2026-10-25): still grouped by operation, and now also by the error, so two different failures never share one notice. FR-029's one notice per cause per project is kept: casualties of one cause share its cause key |

---

## Decisions

Settled while drafting, from the issue bodies and the rules above. Each is a reasonable default that
`/speckit-clarify` may revisit.

- **D1 — Windows-1252 opens without asking, and says so.** A file that is not valid UTF-8 and shows
  no UTF-16 pattern opens as Windows-1252, and the encoding indicator names it. A prompt on every
  open would be noise for a format that is entirely recoverable: nothing is written until the user
  saves, and saving keeps Windows-1252.
- **D2 — "Save with Encoding" saves immediately.** Changing a document's encoding is not a text edit
  and has no meaningful undo, so it happens at the one moment the bytes change: the save. After that
  the document *is* in the new encoding. *(Superseded by FR-055, 2026-10-25: the user asked for an
  encoding change that marks the document dirty and joins the undo history.)*
- **D3 — A character the encoding cannot hold blocks the save, never a substitution.** Windows-1252
  holds 251 characters; it cannot hold CJK, emoji or most of Unicode. Writing `?` in their place is silent data
  loss, which is the defect this spec exists to remove.
- **D4 — Reopening discards the buffer, so a dirty document asks first.** "Reopen with Encoding" re-reads
  the file from disk. With unsaved changes, the user is asked to discard them or cancel.
- **D5 — Conversion targets are LF and CRLF.** CR (classic Mac) stays a style throng can open and
  preserve (006 FR-026) and a value of `editor.defaultLineEnding`, but it is not a conversion target. A
  CR document can be converted to LF or CRLF. *(Superseded by FR-057, 2026-10-25: CR is a target too.)*
- **D6 — Encoding and line ending are document state.** Under Principle XI they are shared by every
  panel showing the document. A conversion or a re-encoding in one panel is seen in all of them.

---

## Clarifications

### Session 2026-10-24

- Q: Should the encoding and line-ending indicators always show on the status bar, or only when a file differs from the defaults? → A: **Always shown on every editor panel** (FR-030). Only width (FR-032) or hiding the whole bar removes them.
- Q: When is the user told that a document holds a character its encoding cannot represent? → A: **Only at save** (FR-021, FR-022). Insertion is never warned about or marked. The blocked save raises the one inline notice, which offers Save as UTF-8.
- Q: Does throng remember an encoding the user chose with Reopen with Encoding after every panel for the file has closed? → A: **No.** The choice lasts while the document is open, including through crash recovery. Opening the file again later re-runs detection (FR-028).

### Session 2026-10-25

- Q: Are Reload from Disk and Reopen with Encoding the same action? → A: **No** *(derived from the code)*. Reload re-reads the file in the document's own encoding; Reopen re-reads the bytes as a different encoding, which is the fix for a misdetected file. Reopen with Encoding stays (FR-056).
- Q: What does choosing an encoding from the status bar do? → A: **It changes the document's encoding, marks it dirty and is one undo step; nothing is written until a save** (FR-055). "If the user switches the encoding, then this should mark the file as dirty, and gets added to the undo / redo buffer." — the user. Save with Encoding is withdrawn in its favour *(derived)*.
- Q: Which line endings can the user switch to? → A: **LF, CR and CRLF, freely; Mixed is listed but only as a state to switch from** (FR-057). "Users cannot switch to 'Mixed', they can only switch FROM mixed." — the user. The content menu's item is a "Line Endings" list with the same options (FR-058).
- Q: How does a user create a mixed line-ending file on purpose? → A: **With explicit insert commands, and every line keeps its own ending through every edit** (FR-061). "Mixed is a valid format, but users who specifically created mixed line-ending files must be explicit." — the user, who then chose Insert Line Break → LF / CR / CRLF with per-line tracking over the alternatives.
- Q: How wide is a marker, and what does it look like? → A: **One character cell, in a box of a contrasting colour (a space excepted), with a legible glyph** (FR-064). "All whitespace markers should take up a single space i.e. they should not move the text in the editor when whitespace is enabled. All whitespace markers (except space) should be contained in a box with a contrasting colour, and the text should be legible." — the user (2026-10-25). A box one cell wide cannot hold a legible multi-letter label, so each character is drawn as one glyph and named on hover *(derived)*.
- Q: How is a marker's name shown, and can the user turn it off? → A: **In a lightweight popover above the pointer that follows it, shown after 500 ms of hovering a marker; a preference turns the popover and the help cursor off together** (FR-067). "The new mouse pointer now covers the title hover. Can we make this into a lightweight popover that follows the mouse-cursor (above it), and pops up after 500ms of hovering. We also need an option in preferences to turn this feature off - when off, the mouse-cursor does not change, and the popover does not show." — the user (2026-10-25). The preference ships on, so today's behaviour is the default; the native `title` tooltip goes, since it is the thing the cursor covered and would otherwise show beside the popover *(derived)*.
- Q: Why do line breaks look different from theme to theme, and what should they look like? → A: **The same everywhere: `LF`, `CR` or `CR LF` written on one line in the box, with room around it** (FR-066). "Themes like 'throng' display CRLF / LF glyphs on a single line, and add some space around them. It looks good. Themes like bash, ubuntu, vi-vim etc display them in a smaller format, with no space around them … I have to zoom in very close to see them clearly." — the user (2026-10-25). Measured: a control picture's look belongs to whichever font draws it — Cascadia Mono (second in the bundled themes' stack) and Segoe UI Symbol stack its letters diagonally in one cell, and the one-line form came from an unnamed system fallback — so no font can be named that guarantees it, and the label is drawn as text *(derived)*.
- Q: What does the mouse pointer show over a marker? → A: **The help cursor (an arrow with a question mark) over every boxed marker; a space and a tab keep the text cursor** (FR-066). The user asked which pointers could be used; `help` is the platform's "hover for a description" cue, where a hand would promise a click action that does not exist. Spaces and tabs are characters the user selects, so they keep the I-beam *(derived)*.
- Q: Which glyphs do the markers use, and how does the user find out what one is? → A: **Unicode's Control Pictures wherever one fits without moving text, and every marker names its character on hover** (FR-065). "Use unicode's control characters where possible and they do not affect the editor layout. Can we add hover titles for all whitespace glyphs shown in editors so the user knows what each one is by hovering the mouse over it?" — the user (2026-10-25). Measured in the app, every Control Picture draws 12–14 px against an 8 px cell, so mid-line none fits one cell legibly; a line-break marker has no text after it on its line, so there the pictures `␊` `␍` `␍␊` move nothing *(derived)*.
- Q: Which characters does View Whitespace mark, and how? → A: **Every Unicode White_Space character and every invisible look-alike, each in a labelled mark on its own background** (FR-062, FR-063). "Make the whitespace characters clearer … use an alt colour for the whitespace character's background, and make the text stand out. The line endings are not clear enough … I do not see whitespace indicators for all variations." — the user (2026-10-25, MT-07), with `whitespace-all.txt` as the reference set. The labels (Unicode's abbreviations) and the colours are *derived*.
- Q: How does View Whitespace behave? → A: **A per-panel toggle, off by default, whose default comes from a preference** (FR-059, FR-060). "This is a toggle and is off by default. The toggle is per-panel / editor. A global preference controls the default setting." — the user. It shows spaces, tabs, line breaks, vertical tabs, ESC, BOMs. Which other characters, and their symbols, are *derived*.
- Q: When several files in one project fail to open, do they share one notice? → A: **Only when the error is the same** (FR-054). "If the error is different, a new toast shows. If the error is the same, then the file can be added to the same toast (for any error type)." — the user, from hand-testing MT-02, where a binary file and a UTF-32 file joined a notice headed "That file is not valid UTF-8 text." *(Grouping key derived: the operation, then the cause key where the failure has one, else its message — so one missing project root still raises one notice.)*

### Session 2026-10-29

- Q: How does a user learn that a Reopen with Encoding is not kept, and that a file may have been misread? → A: **One inline notice on the document, never a toast, that says so and carries the actions that resolve it** (FR-068). After a reopen it reads: "This file has been read as Windows-1252 for this editor session only; the file is unchanged. To fix the file, change its encoding, verify, and save." — the user's wording (2026-10-29, MT-03). On open, a UTF-8 file whose words mix Latin letters with letters of other scripts gets the same notice, suggesting Reopen as Windows-1252. "I do not want throng to remember a file's settings (that's asking for trouble)" — so nothing about it is kept per file. The detection rule, the open-time wording and the actions are *derived*; double-encoded UTF-8 (`cafÃ©`) is deliberately not flagged, because reopening it as Windows-1252 makes it worse, not better *(derived)*.
- Q: Which other legacy encodings does throng support, and how does it treat a file in one it did not detect? → A: **The single-byte Windows code pages 1250, 1251 and 1253–1258 as Reopen and Change targets, a preference for the fallback encoding, and the read notice when a fallback read looks wrong** (FR-069). "The single-byte code pages are worth implementing now (as part of this spec), but we should file an issue for the multi-byte code-pages … (vNext)" — the user (2026-10-29); the multi-byte code pages are #535, and international text handling #536. On a misread: "that feels dangerous. Can we warn the user?" — the user, who chose the jschardet library for the suggestion, and confirmed a fallback-encoding preference. Bytes cannot tell these code pages apart, so detection still ends at the fallback; measured on sample files, jschardet names Greek, Cyrillic, Hebrew and Arabic correctly but misnames Latin-script text (Danish as ISO-8859-16, Czech as CP1006), so the warning is raised by the decoded text's own shape and jschardet only proposes which code page *(derived)*.
- Q: The encoding menu is getting large — how should it be grouped, and in what words? → A: **The Unicode encodings stay at the top level; the nine code pages go in one submenu, "Windows Code Pages"** (FR-070). "The encoding menu is starting to get a little large. What is the best way to group these encodings together? What terms should we use?" — the user (2026-10-29), who left the choice to us. "Windows Code Pages", not "ANSI" (a Windows misnomer: none is an ANSI standard) and not "Legacy" (dismissive to someone whose files are in one); it also holds the multi-byte code pages of #535, which Windows ships as code pages 932, 936, 949 and 950 *(derived)*.
- Q: After Reopen as Windows-1253 (Greek), the notice says to change the encoding — but Greek is already selected. What should it offer? → A: **The two remedies that actually make the file open this way next time: Convert to UTF-8, and Use Windows-1253 as Fallback Encoding** (FR-071). "when I 'Reopen with Greek', it then prompts me to change the encoding... which I cannot do, because greek is already selected. This does not sit well with me." — the user (2026-10-29). The reading is right; what is wrong is that it is not remembered (by design: nothing per file). Converting to UTF-8 makes the file open correctly everywhere; the fallback preference makes every such file open in that code page. Both are one click from the notice *(derived)*.
- Q: A Greek file with one byte Windows-1253 leaves undefined is suggested as Turkish and cannot be reopened as Greek. Should it open as Greek? → A: **Yes: a byte the code page leaves undefined is kept, not refused, and the guess no longer trips on it** (FR-072). "`codepage-greek-1253-undefined.txt` identifies as 'Turkish 1254', which I can open it with, but I cannot open it as greek 1253, which I would expect to be able to" — the user (2026-10-29). An undefined byte decodes to a private-use placeholder that encodes back to the same byte, which keeps FR-013's exact round trip without FR-014's replacement character; jschardet discards a code page outright on one undefined byte, so those bytes are blanked before it guesses, and a guess whose own reading looks misread is dropped *(derived)*.
- Q: What should the status bar's encoding indicator show for a code page? → A: **Its number and, in brackets, its script — `Windows-1253 (Greek)`** (FR-073). "Show the encoding short name in brackets in the encoding selection in the status bar." — the user (2026-10-29). The short name is read as the script name the menus already use; the Unicode encodings have none and are unchanged *(derived)*.
- Q: Should the read notice keep its "Use … as Fallback Encoding" button? → A: **No: remove it, keep the sentence, and say the fallback is set in preferences** (FR-074). "I don't like the 'Use <Encoding> as Fall back encoding' option on the file banner. Remove it. Keep the text though, but add 'in preferences'" — the user (2026-10-29).

### Session 2026-10-30

- Q: A 5 MB Windows-1252 open measures 1.55–1.72× UTF-8 on GitHub's hosted runners, over SC-005's 1.5×, while UTF-16 stays within it. Which gives? → A: **SC-005 allows 2× for the single-byte code pages and keeps 1.5× for UTF-16** — the user (2026-10-30), choosing from: amend the bound, or move the measurement out of the gating unit stage. The code-page read is the platform decoder (a table loop measured slower still), so the gap is the platform's single-byte decoder against its UTF-8 one, not work throng adds; the median of fifteen interleaved per-round ratios is what is held to the bound *(derived)*. The same day UTF-16 measured 1.513× on a hosted runner under that median, so the 2× bound was extended to it, the same remedy for the same cause *(derived, reported to the user)*.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit a Windows-1252 file without destroying it (Priority: P1)

A developer opens a legacy config or source file written by an older Windows tool, which contains
`é`, `£` and `€` in Windows-1252. Today throng shows `�` and, on save, rewrites every one of those
characters into the replacement character. With this feature the file shows its real characters,
the editor names its encoding, and an edit-and-save changes only the bytes the edit touched.

**Why this priority**: This is the one path in throng that destroys user data today, silently and on a
file the user only wanted to touch one line of. Stopping it is worth more than anything else here.

**Independent Test**: Open a Windows-1252 fixture containing `é`, `£` and `€`, confirm they display,
edit one ASCII line, save, and confirm a byte-level diff against the original shows only that line.

**Acceptance Scenarios**:

1. **Given** a Windows-1252 file containing `é`, `£` and `€`, **When** the user opens it, **Then** those
   characters display correctly and the encoding indicator reads "Windows-1252".
2. **Given** that file is open, **When** the user edits one line and saves, **Then** every byte outside
   the edit is identical to the original and the file is still Windows-1252.
3. **Given** that file is open, **When** the user types a character Windows-1252 cannot represent (e.g.
   an emoji) and saves, **Then** nothing is written, and an inline notice names the first such
   character and its line, offering to save as UTF-8 instead (FR-022).
4. **Given** any file in any encoding, **When** throng writes it through any path, **Then** it never
   writes the replacement-character bytes into a file whose original did not contain them.

---

### User Story 2 - Open and save UTF-16 files (Priority: P1)

A developer redirects PowerShell 5.1 output to a file (`"héllo" > f.txt`) or opens a `.reg` export.
Today throng refuses it as "not text". With this feature it opens as readable text, the editor names
it "UTF-16 LE", and saving after an edit leaves it UTF-16 LE with its byte-order mark.

**Why this priority**: The refusal blocks a whole class of everyday Windows files, and the message the
user sees is false.

**Independent Test**: Open UTF-16 LE-with-BOM, UTF-16 BE-with-BOM, and BOM-less LE and BE fixtures; edit
and save each; confirm each comes back in the same encoding with its BOM present or absent as before.

**Acceptance Scenarios**:

1. **Given** a UTF-16 LE file with a BOM written by Windows PowerShell 5.1, **When** the user opens it,
   **Then** it shows as readable text and the encoding indicator reads "UTF-16 LE".
2. **Given** that file is open, **When** the user edits and saves it, **Then** it is still UTF-16 LE with
   its BOM, and every byte outside the edit is unchanged.
3. **Given** a UTF-16 BE file with a BOM, and UTF-16 LE and BE files without one, **When** each is opened,
   edited and saved, **Then** each keeps its byte order, and its BOM is present or absent as it was.
4. **Given** a UTF-32 file, **When** the user tries to open it, **Then** it is refused with a message
   naming UTF-32, not "not text".
5. **Given** a genuinely binary file (an image, an executable), **When** the user tries to open it,
   **Then** it is still refused as not text.
6. **Given** a not-decodable file, a binary file and a UTF-32 file in one project, **When** the user
   opens them one after another, **Then** each raises its own notice with its own wording; and **When**
   the user then opens a second binary file, **Then** it joins the binary file's notice (FR-054).

---

### User Story 3 - See and change a document's encoding (Priority: P2)

Detection can guess wrong: a file that happens to be valid UTF-8 may really be Windows-1252, and a
team may want a UTF-16 file moved to UTF-8. The status bar shows the document's encoding; clicking
it, or the editor menu, offers **Reopen with Encoding…** (read the file again as a chosen encoding) and
**Save with Encoding…** (write it in a chosen encoding).

**Why this priority**: Without it a wrong guess is permanent and a conversion needs another tool. It
depends on Stories 1 and 2 existing first.

**Independent Test**: Open a UTF-16 file, Save with Encoding → UTF-8, confirm the file on disk is UTF-8
and the indicator says so; open a UTF-8 file that is really Windows-1252 text, Reopen with Encoding →
Windows-1252, confirm the characters change to the intended ones.

**Acceptance Scenarios**:

1. **Given** an open document, **When** the user looks at the editor status bar, **Then** an encoding
   indicator shows its encoding, including whether a UTF-8 file has a BOM.
2. **Given** the indicator, **When** the user clicks it, **Then** a menu offers Reopen with Encoding and
   Save with Encoding, each listing the supported encodings with the current one marked.
3. **Given** a clean document, **When** the user chooses Reopen with Encoding → Windows-1252, **Then**
   the file is re-read from disk as Windows-1252, nothing is written, and the indicator updates.
4. **Given** a dirty document, **When** the user chooses Reopen with Encoding, **Then** they are asked to
   discard their unsaved changes or cancel, and cancelling changes nothing.
5. **Given** a document, **When** the user chooses Save with Encoding → UTF-8, **Then** the file is
   written as UTF-8 (without a BOM unless "UTF-8 with BOM" was chosen) and the indicator updates.
6. **Given** a file whose bytes are not valid in the encoding chosen in Reopen with Encoding (e.g.
   Windows-1252 bytes reopened as UTF-8), **When** the reopen is attempted, **Then** it is refused with
   a message naming the encoding, and the document is left exactly as it was.
7. **Given** two panels showing the same document, **When** the encoding changes in one, **Then** both
   panels' indicators show the new encoding.

8. **Given** a UTF-8 document, **When** the user clicks the encoding indicator and chooses UTF-16 LE,
   **Then** the indicator reads `UTF-16 LE`, the document is dirty and nothing is written; Ctrl+Z puts it
   back to UTF-8 and clean; Ctrl+S after the change writes the file as UTF-16 LE with a BOM (FR-055).
9. **Given** the encoding indicator's menu, **When** the user opens it, **Then** it lists every supported
   encoding with the current one marked, and ends with Reopen with Encoding… (FR-055, FR-056).
10. **Given** a clean document, **When** the user reopens it as Windows-1252, **Then** a notice above the
    editor says "This file has been read as Windows-1252 for this editor session only; the file is
    unchanged. To fix the file, change its encoding, verify, and save.", with **Change Encoding…** and
    **Dismiss**; it stays through a Change Encoding and goes when the file is saved in a different encoding
    or dismissed (FR-068).
11. **Given** a Windows-1252 file whose bytes are also valid UTF-8 (so it opens as UTF-8, with words that mix
    Latin letters and letters of other scripts), **When** it opens, **Then** a notice says it may be
    Windows-1252 text read as UTF-8, with **Reopen as Windows-1252** and **Dismiss**; an ordinary UTF-8 file,
    accented Latin, Greek or Cyrillic text, raises no notice (FR-068).
12. **Given** a Greek file saved as Windows-1253, **When** it opens with the fallback encoding Windows-1252,
    **Then** a notice says it was read as Windows-1252 but its text looks like Windows-1253 (Greek), with
    **Reopen as Windows-1253 (Greek)**, **Reopen with Encoding…** and **Dismiss**; reopening shows the Greek
    text (FR-069).
13. **Given** `editor.fallbackEncoding` set to Windows-1251, **When** a Cyrillic Windows-1251 file opens, **Then**
    it reads correctly with no notice, and the status bar says `Windows-1251` (FR-069).
14. **Given** the encoding indicator's menu, **When** the user opens it, **Then** it lists the Unicode encodings,
    then the Windows code pages each named with its script (e.g. `Windows-1251 (Cyrillic)`), then Reopen with
    Encoding… (FR-069).
15. **Given** a document read as Windows-1253, **When** the user opens the encoding indicator's menu, **Then** it
    shows UTF-8, UTF-8 with BOM, UTF-16 LE and UTF-16 BE, then **Windows Code Pages ✓**, whose flyout lists the
    nine code pages with `Windows-1253 (Greek) ✓`, then Reopen with Encoding…; the Change Encoding and Reopen
    pickers list the same rows under the headings "Unicode" and "Windows Code Pages" (FR-070).
16. **Given** a Greek file reopened as Windows-1253, **When** the notice shows, **Then** it says the reading is for
    this editor session only and offers **Convert to UTF-8**, **Use Windows-1253 as Fallback Encoding** and
    **Dismiss**; Convert to UTF-8 makes the document UTF-8 (dirty, one undo step), and the fallback action sets
    `editor.fallbackEncoding` to Windows-1253 and clears the notice (FR-071).
17. **Given** a Greek Windows-1253 file holding one byte 1253 leaves undefined, **When** it opens, **Then** the
    notice suggests Windows-1253 (Greek), reopening shows the Greek text with a placeholder at that byte, and a
    save writes every byte back unchanged (FR-072).
18. **Given** a document read as Windows-1253, **When** the user looks at the status bar, **Then** the encoding
    indicator reads `Windows-1253 (Greek)` and is named "encoding: Windows-1253 (Greek)"; a UTF-8 document's
    reads `UTF-8` (FR-073).
19. **Given** a Greek file reopened as Windows-1253, **When** the notice shows, **Then** it reads "…To open it this
    way every time, convert it to UTF-8 and save, or make Windows-1253 (Greek) your fallback encoding in
    preferences." with **Convert to UTF-8** and **Dismiss** only (FR-074).

---

### User Story 4 - See and convert a document's line endings (Priority: P2)

A developer opens a file with CRLF endings in a repository that wants LF, or a file Git has left with
mixed endings. The status bar shows "CRLF", "LF", "CR", or that the file is mixed. Clicking it, or the
editor menu, offers **Convert to LF** and **Convert to CRLF**. A conversion is one undoable edit that
marks the document dirty like any other.

**Why this priority**: 016 deferred this as a legitimate need with no route today. It depends on
nothing in Stories 1–3 except the shared status-bar surface.

**Independent Test**: Open a CRLF fixture, Convert to LF, save, confirm every line ends LF on disk;
undo before saving and confirm the document returns to CRLF and clean.

**Acceptance Scenarios**:

1. **Given** an open document, **When** the user looks at the editor status bar, **Then** a line-ending
   indicator shows "LF", "CRLF" or "CR".
2. **Given** a document with mixed line endings, **When** the user looks at the indicator, **Then** it
   says the file is mixed and names the dominant ending (the one throng inserts, 016 FR-023a).
3. **Given** a CRLF document, **When** the user chooses Convert to LF, **Then** every line ending in the
   document becomes LF in one step, the document is marked dirty, and saving writes LF throughout.
4. **Given** a conversion has just been made, **When** the user undoes, **Then** the document's line
   endings return exactly to what they were — including a mixed file's per-line endings — and, if nothing
   else had changed, the document is clean again.
5. **Given** a mixed document, **When** the user chooses either conversion, **Then** every line ends in
   the chosen style and the indicator no longer says mixed.
6. **Given** a document already uniformly LF, **When** the user opens the conversion menu, **Then**
   Convert to LF is shown as the current state and choosing it changes nothing.
7. **Given** a 5,000-line CRLF document, **When** it is converted to LF, **Then** the status bar's
   character count is unchanged (040 FR-003a).

8. **Given** a CRLF document, **When** the user chooses CR from the line-ending indicator, **Then** every
   line ends in CR, the document is dirty, and Ctrl+Z restores CRLF (FR-057).
9. **Given** a mixed document, **When** the user opens the line-ending list, **Then** LF, CR, CRLF and
   Mixed are listed with Mixed marked current; LF, CR and CRLF can be chosen and Mixed cannot (FR-057).
10. **Given** a uniform document, **When** the user opens the list, **Then** Mixed is shown and cannot be
    chosen (FR-057).
11. **Given** an editor, **When** the user right-clicks, **Then** the content menu has a **Line Endings**
    item with the same options (FR-058).
12. **Given** an LF document, **When** the user runs Insert Line Break → CRLF, **Then** a line break ending
    in CRLF is inserted at the caret, the indicator reads `Mixed (LF)`, and after typing, adding and
    deleting lines elsewhere and saving, that line still ends in CRLF and every other line in LF (FR-061).

---

### User Story 5 - Search, replace and toggle work on these files too (Priority: P3)

A project contains UTF-16 and Windows-1252 files. Find in Files finds matches inside them, its replace
writes them back in their own encoding, the Markdown preview reads a UTF-16 `.md`, and the preview's
task toggle rewrites such a file without refusing it.

**Why this priority**: Without it the editor and the project-wide tools disagree about which files are
text. It is lower than Stories 1–2 because those tools already refuse rather than corrupt.

**Independent Test**: Put a UTF-16 LE and a Windows-1252 fixture in a project, search for a word in each,
replace it, and confirm both files are rewritten in their own encoding with only the match changed.

**Acceptance Scenarios**:

1. **Given** a UTF-16 or Windows-1252 file in a project, **When** the user runs Find in Files for text it
   contains, **Then** the file is searched and its matches listed.
2. **Given** such matches, **When** the user commits a replace, **Then** each file is written in its own
   encoding and BOM state, with only the matched text changed.
3. **Given** a UTF-16 Markdown file with a task list, **When** the user opens its preview and toggles a
   task, **Then** the preview renders correctly and the file is written back in UTF-16 with only the
   task marker changed.

---

### User Story 6 - See the whitespace in a document (Priority: P3)

A user wants to see what is between the characters: whether an indent is tabs or spaces, which
line ends in CRLF and which in LF, and whether the file carries a BOM, an escape character or a
vertical tab that renders as nothing.

**Why this priority**: it diagnoses what US1–US4 change, but nothing is lost without it.

**Independent Test**: toggle View Whitespace on `eol-mixed.txt` and see a different symbol on its
CRLF lines and its LF line.

**Acceptance Scenarios**:

1. **Given** a new editor, **When** it opens, **Then** whitespace is not shown, unless the View
   Whitespace preference says otherwise (FR-060).
2. **Given** an editor, **When** the user turns View Whitespace on from the status bar or the content
   menu, **Then** spaces, tabs and each line break show a symbol, line breaks naming their own ending;
   vertical tabs, ESC and other control characters, and U+FEFF show as visible marks; and a file with a
   BOM shows a BOM mark at its start (FR-059).
3. **Given** two panels on one document, **When** the user turns it on in one, **Then** the other is
   unchanged (FR-059).
4. **Given** a panel with View Whitespace on, **When** the app restarts, **Then** it is still on (FR-059).
5. **Given** View Whitespace on, **When** the user copies text or saves, **Then** no symbol is in the
   copied text or the file (FR-059).
6. **Given** a file holding every Unicode White_Space character and the invisible look-alikes (zero-width
   spaces and joiners, word joiner, U+FEFF, bidi marks, soft hyphen, Hangul fillers, U+180E, U+2800), **When**
   View Whitespace is on, **Then** every one of them shows a mark naming it (FR-062).
7. **Given** View Whitespace on, **When** the user looks at a line break, **Then** it reads `LF`, `CR` or `CRLF` in
   a mark that stands out from the text around it, in every bundled theme (FR-063).
8. **Given** a file of spaces, NBSPs and line breaks, **When** the user turns View Whitespace on and off,
   **Then** no character moves; each marker is one cell, boxed in a contrasting colour except a space's dot
   (FR-064).
9. **Given** View Whitespace on, **When** the user hovers any marker — a space's dot, a tab, a line break, the
   BOM or a named character — **Then** a tooltip names the character; a line break shows `␊`, `␍` or `␍␊`, and
   no text moves (FR-065).
10. **Given** View Whitespace on in any bundled theme, **When** the user looks at a line break, **Then** it reads
    `LF`, `CR` or `CR LF` on one line in its box, legible without zooming; and the pointer over any boxed marker
    is the help cursor (FR-066).
11. **Given** View Whitespace on, **When** the user rests the pointer on any marker for half a second, **Then** a
    small popover naming the character appears just above the pointer and follows it while it stays on the
    marker, and goes when the pointer leaves; **Given** `editor.whitespaceHoverNames` off, **Then** neither the
    popover nor the help cursor appears (FR-067).

---

### Edge Cases

- **ASCII-only file**: valid UTF-8, so it opens as UTF-8. If the user means Windows-1252 it makes no
  difference to the bytes. Reopen with Encoding is still available.
- **Empty file**: opens as UTF-8 with no BOM and the `editor.defaultLineEnding` ending, the same as a
  new document.
- **A file that is only a UTF-16 BOM**: opens as an empty UTF-16 document of that byte order and keeps
  the BOM on save.
- **Odd number of bytes in a supposed UTF-16 file**: it is not UTF-16. Without a BOM, detection does not
  choose UTF-16. Reopen with Encoding → UTF-16 is refused (FR-014).
- **Unpaired surrogate in UTF-16 bytes**: the file is still opened, but the unpaired unit cannot be
  represented in the buffer losslessly. Treat it as not decodable in that encoding (FR-014) rather than
  substitute and later write the substitute back.
- **Windows-1252's five undefined byte values (0x81, 0x8D, 0x8F, 0x90, 0x9D)**: they MUST round-trip
  byte-identically. A Windows-1252 file is never refused for containing them.
- **A UTF-8 file containing a few invalid bytes**: it is not valid UTF-8, so it opens as Windows-1252.
  The indicator says so, and Reopen with Encoding → UTF-8 is refused (FR-014), because throng cannot
  show it as UTF-8 without inventing replacement characters.
- **Binary file with a UTF-16-like zero pattern**: an image or executable can show zeros at alternate
  positions by chance. The detection threshold MUST be tuned against binary fixtures as well as text
  ones (SC-003).
- **External change while open**: a reload re-reads the file in the document's current encoding.
  Detection runs again only if the file can no longer be read in that encoding. If detection then picks
  something else, the indicator updates and the change notice says why.
- **Crash recovery**: a recovered unsaved buffer comes back with the encoding and line endings it had,
  so saving it after recovery writes the same format the user was editing.
- **Mixed endings, then an edit that adds a line, then a conversion**: the conversion is defined over
  the document's current text. Every line ends in the chosen style.
- **Undo across a save**: undoing a conversion after the document was saved restores the earlier
  endings in the buffer and marks the document dirty, like undoing any saved edit.
- **Very large file**: detection reads only the leading bytes it needs, and decoding a supported
  encoding is no slower than today's UTF-8 decoding by more than SC-005 allows.
- **Read-only file**: Save with Encoding fails like any other save to a read-only file, through the
  existing save-failure path. Nothing new.
- **Files over `editor.maxOpenFileBytes`**: still refused for size, whatever the encoding.

## Requirements *(mandatory)*

### Functional Requirements

#### Detection — one function, in core

- **FR-001**: Exactly **one** encoding-detection function in the OS-agnostic core MUST decide a file's
  encoding for **every** path that reads text: the editor, Find in Files search and replace, the
  preview, the preview's task toggle, and any other reader of project files as text. No path may run a
  detection of its own (006 FR-027, Principle II).
- **FR-002**: Detection MUST recognise these encodings, in this precedence:

  | Order | Encoding | Recognised by |
  |---|---|---|
  | 1 | UTF-32 LE / BE | BOM `FF FE 00 00` / `00 00 FE FF` → **refused** (FR-006) |
  | 2 | UTF-8 with BOM | BOM `EF BB BF` |
  | 3 | UTF-16 LE with BOM | BOM `FF FE` |
  | 4 | UTF-16 BE with BOM | BOM `FE FF` |
  | 5 | UTF-16 LE / BE without BOM | a zero byte at alternate positions across the scanned bytes, on one side only |
  | 6 | Binary | the existing zero-byte heuristic, once UTF-16 is ruled out → **refused as not text** |
  | 7 | UTF-8 without BOM | the bytes are valid UTF-8 |
  | 8 | Windows-1252 | fallback: not valid UTF-8, no UTF-16 pattern, not binary |

- **FR-003**: The UTF-32 BOM check MUST precede the UTF-16 LE BOM check, because `FF FE 00 00` begins
  with `FF FE`.
- **FR-004**: Detection MUST be deterministic: the same bytes MUST yield the same encoding on every path
  and every run.
- **FR-005**: Detection MUST read no more of a file than it needs to decide. Only the leading bytes
  decide the UTF-16 and binary patterns, and the UTF-8 validity check covers the whole file, as it must
  to keep FR-020.
- **FR-006**: A UTF-32 file MUST be refused with a message naming UTF-32 ("This file is UTF-32, which
  throng does not open"), not the not-text message.
- **FR-007**: A file that is genuinely binary MUST keep today's not-text refusal, with today's wording.

#### Decoding and the round-trip guarantee

- **FR-010**: A document MUST record its **encoding** (one of: UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16
  BE, Windows-1252) and, for UTF-16, **whether a BOM was present**.
- **FR-011**: Saving a document MUST write it in its recorded encoding and BOM state. An unedited
  document MUST save **byte-identical** to the file it was read from, in every supported encoding,
  including mixed line endings (043 FR-056).
- **FR-012**: An edit MUST change only the bytes that encode the edited text. Every byte outside the
  edit MUST be identical after save (006 SC-005, extended to every supported encoding).
- **FR-013**: Windows-1252 MUST round-trip **all 256 byte values**, including the five values the code
  page leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D).
- **FR-014**: Decoding in a chosen encoding MUST be **lossless or refused**. If the bytes are not valid
  in that encoding (invalid UTF-8, odd-length or unpaired-surrogate UTF-16), the read MUST be refused
  with a message naming the encoding. It MUST NOT produce replacement characters that a later save
  would write back.
- **FR-015**: Encoding and line ending MUST be **document state** under Principle XI: one value, shared
  by every panel showing the document, persisted with the document's state, and restored by crash
  recovery together with the unsaved buffer.
- **FR-016**: New documents are unchanged: UTF-8 without BOM, with `editor.defaultLineEnding` (006
  FR-025, FR-026a).

#### Never write what was not there

- **FR-020**: No path in throng may write the UTF-8 replacement-character bytes (`EF BF BD`), or a
  replacement character in any other encoding, into a file whose original bytes did not contain it.
- **FR-021**: Saving a document that contains a character its encoding **cannot represent** MUST write
  nothing. No character may be substituted, dropped or escaped.
- **FR-022**: The refusal in FR-021 MUST be **one inline notice** on the editor (*One condition, one
  notice*). It names the encoding, the first unrepresentable character and its line, and carries the
  action that resolves it: **Save as UTF-8**. The notice says what is wrong, not what the user may not
  do. Saving again without changing anything flashes the existing notice and raises no second one.
  The save is the **only** moment this is reported. Typing or pasting such a character raises no
  notice and no in-editor marking.
- **FR-023**: Save All and save-on-close MUST honour FR-021 per document. A document that cannot be
  saved is reported through FR-022 and is not written, and the other documents still save. A close
  that needed that save is not completed.

#### Choosing an encoding

- **FR-024**: **Reopen with Encoding…** MUST re-read the document's file from disk in a chosen supported
  encoding, replacing the buffer and clearing its undo history, and MUST write nothing.
- **FR-025**: Reopen with Encoding on a **dirty** document MUST first ask the user to discard their
  unsaved changes or cancel, through the existing discard-confirmation pattern. Cancel MUST change
  nothing.
- **FR-026**: Reopen with Encoding on a document with no file on disk (an unsaved new document) MUST be
  unavailable.
- **FR-027**: **Save with Encoding…** MUST write the document in a chosen supported encoding, with the
  BOM choice that encoding's entry names, and from then on record that as the document's encoding.
  UTF-8 is offered both with and without a BOM, UTF-16 LE and BE both with a BOM. FR-021 / FR-022 apply
  if the target encoding cannot represent the content. *(Superseded by FR-055, 2026-10-25.)*
- **FR-028**: A **user-chosen** encoding (by Reopen or Save with Encoding) MUST last for the
  **lifetime of the open document**: across every panel showing it, across reloads after an external
  change, and through crash recovery. Detection MUST NOT override it during that time, unless the file
  can no longer be read in that encoding. Once the document closes in every panel, the choice is
  **not** remembered. Opening the file again runs detection afresh. No per-file record outlives the
  document.

#### The status bar indicators

- **FR-030**: The editor status bar MUST show an **encoding indicator** and a **line-ending indicator**
  in its right-aligned group, beside the language label and the wrap toggle, on **every** editor panel
  whatever the file's format — including UTF-8 without BOM and LF. They are never omitted for being
  the default; only width (FR-032) or `editor.showStatusBar` removes them. *(Supersedes 040 FR-013's
  enumeration of that group. The alignment split it defines is unchanged.)*
- **FR-031**: The encoding indicator MUST read `UTF-8`, `UTF-8 with BOM`, `UTF-16 LE`, `UTF-16 BE` or
  `Windows-1252`. The line-ending indicator MUST read `LF`, `CRLF`, `CR`, or `Mixed (<dominant>)` for a
  mixed document. Each MUST carry an accessible name that says what it is ("encoding: UTF-16 LE",
  "line endings: CRLF") and MUST NOT add to the gaps tracked by #282 (040 FR-018).
- **FR-032**: When width forces it, the hide order of 040 FR-023 MUST continue past `line` with
  **line-ending indicator → encoding indicator**, and then terminate. The language label and the wrap
  toggle keep 040 FR-024's guarantee of never being hidden by width. *(Supersedes 040 FR-024's "the
  hide order terminates after `line`".)*
- **FR-033**: Each indicator MUST be **clickable** and open a menu of its actions — Reopen / Save with
  Encoding for the encoding indicator, Convert to LF / CRLF for the line-ending indicator. That menu is
  an **accelerator** for actions the editor's own menu already offers (FR-040). Hiding the status bar
  (`editor.showStatusBar`) or the indicator MUST NOT remove the user's only route to any action.
- **FR-034**: Both indicators MUST update immediately in every panel showing the document when its
  encoding or line ending changes, and MUST follow 016 FR-010g's active/inactive treatment and the
  themed status-bar tokens already used by the language label.

#### Converting line endings

- **FR-035**: **Convert to LF** and **Convert to CRLF** MUST set every line ending in the document to the
  chosen style, as **one undoable step** that marks the document dirty like any other edit. *(Extended by
  FR-057, 2026-10-25: CR is a target too.)*
- **FR-036**: Undoing a conversion MUST restore the document's line endings exactly, including a mixed
  document's per-line endings. If nothing else changed since the last save, the document MUST be clean
  again.
- **FR-037**: After a conversion the document is uniform. Its mixed-ending record is cleared, the
  indicator shows the chosen style, and every later insertion uses it (016 FR-023a).
- **FR-038**: The conversion matching the document's current uniform ending MUST be shown as current and
  MUST be a no-op. On a mixed document both conversions MUST be available. *(Extended by FR-057: all three.)*
- **FR-039**: Nothing in throng may convert line endings without one of these explicit actions (016
  FR-023b stands).

#### Menus, commands and key bindings

- **FR-040**: Reopen with Encoding, Save with Encoding, Convert to LF and Convert to CRLF MUST each be a
  command with a **menu item in the editor panel's menu** (Principle VI: every panel action has a menu
  item), placed in the section the constitution's vocabulary assigns. The current encoding and line
  ending MUST be marked on the items as state. *(Superseded in part by FR-058, 2026-10-25: Save with
  Encoding becomes Change Encoding, and the two Convert items become one Line Endings list.)*
- **FR-041**: Each command MUST be listed in the Key Bindings editor with a label and a description,
  rebindable, **unbound by default**, and its menu item MUST show its chord once one is bound
  (Principles IV, VI, X).
- **FR-042**: Each command MUST be documented in `docs/key-bindings.md`, and the encoding and
  line-ending behaviour in the editor's documentation home, per the `throng-docs` rules the
  docs-currency test enforces.

#### Every path that rewrites text

- **FR-050**: Find in Files MUST search UTF-16 and Windows-1252 files as text, decoded through FR-001,
  instead of skipping them as binary.
- **FR-051**: Find in Files replace MUST write UTF-16 and Windows-1252 files in their own encoding and
  BOM state (043 FR-056), instead of refusing them. Its refusal of a file that cannot be decoded
  losslessly (FR-014) stays, reworded to name the encoding.
- **FR-052**: The preview MUST read UTF-16 and Windows-1252 source files, and the preview's task toggle
  MUST rewrite them in their own encoding (054 FR-029), instead of refusing them.
- **FR-053**: A file that is refused (FR-006, FR-007, FR-014) MUST be refused with the same wording on
  every path.
- **FR-054**: Panel failures in one project MUST share a notice **only when their error is the same**,
  for every kind of failure, not only the refusals above. A failure with a different error raises a new
  notice; one with the same error joins the existing one as another row. "The same error" is the
  failure's cause where it has one (030 FR-029, so the casualties of one missing root still share one
  notice), and its message otherwise. This partially supersedes 030 FR-029a, which grouped by operation
  alone.

#### Changing encoding and line endings, and seeing whitespace (2026-10-25)

- **FR-055**: Choosing an encoding from the encoding indicator's menu (**Change Encoding**) MUST change the
  document's encoding and BOM to that entry's, writing nothing. It MUST mark the document dirty and be
  **one undoable step**, like a line-ending conversion; undoing it restores the previous encoding, and a
  document back at its saved encoding and text is clean. The next save writes the chosen encoding
  (FR-011), refusing per FR-021/FR-022 a character it cannot hold. The choice counts as user-chosen
  (FR-028). Choosing the current encoding is a no-op. Supersedes FR-027 and D2.
- **FR-056**: **Reopen with Encoding…** MUST stay, as the last item of the encoding indicator's menu and in
  the content menu, unchanged from FR-024 to FR-026.
- **FR-057**: The line-ending list MUST offer **LF**, **CR**, **CRLF** and **Mixed**, the current state
  marked. Choosing LF, CR or CRLF MUST convert every line ending to it as one undoable step that marks the
  document dirty (FR-035 to FR-037 apply). **Mixed** MUST be listed always and MUST NOT be selectable: it
  is marked current on a mixed document and can only be switched away from. Choosing the current uniform
  ending is a no-op (FR-038).
- **FR-058**: The content menu MUST carry a **Line Endings** item holding the same list as the indicator,
  and an **Encoding** item holding the encoding indicator's list. Each of Change Encoding, Reopen with
  Encoding, Convert to LF, Convert to CR, Convert to CRLF and Toggle View Whitespace MUST be a command
  under FR-041 and FR-042; Change Encoding opens the encoding list as a picker.
- **FR-059**: **View Whitespace** MUST be a per-panel toggle, from a status-bar button beside the word-wrap
  toggle and from the content menu, persisted with the panel. On, it MUST show a visible symbol for each
  space, tab and line break — the line-break symbol distinct for LF, CR and CRLF — and a visible mark
  for vertical tab, form feed, ESC and every other C0 control character, and for U+FEFF in the text; a
  document with a BOM MUST show a BOM mark before its first character. The symbols are decoration only:
  never in the document, the clipboard or the file. Like the wrap toggle, the button is never hidden for
  width (040 FR-024).
- **FR-060**: A preference, **Editor default view whitespace** (`editor.defaultShowWhitespace`, default
  off), MUST set View Whitespace for a panel that has not chosen its own, as `editor.defaultWordWrap`
  does for wrap.
- **FR-061**: **Insert Line Break → LF**, **→ CR** and **→ CRLF** MUST insert a line break with that ending at
  each caret, as an ordinary undoable edit; Enter keeps inserting the dominant ending (016 FR-023a). Each
  line's ending MUST follow it through every edit: a typed or pasted line takes the dominant ending, a
  deleted line break takes its ending with it, and a save writes every line with its own ending however
  many lines were added or removed. The three are commands under FR-041 and FR-042 and items in the Line
  Endings list (FR-058). This supersedes the fallback in which an edit that changed the number of lines
  made the next save uniform.

#### Seeing every invisible character (2026-10-25, round 3)

- **FR-062**: View Whitespace MUST mark every character in these sets, each with a mark that names it: every
  Unicode **White_Space** character (TAB, LF, VT, FF, CR, SPACE, U+0085 NEL, U+00A0, U+1680, U+2000–U+200A,
  U+2028, U+2029, U+202F, U+205F, U+3000); every other **C0 and C1 control** and DEL; and the **invisible
  look-alikes** — U+00AD, U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180E, U+200B–U+200F, U+202A–U+202E,
  U+2060–U+2064, U+2066–U+206F, U+3164, U+FEFF, U+FFA0 and U+2800. A space is a centred dot and a tab an arrow
  across its own width; every other character is a label — Unicode's abbreviation where it has one (`NBSP`,
  `ZWSP`, `NEL`, `VT`, `ESC`, …), `U+XXXX` otherwise — with the character's name on hover. This extends FR-059.
- **FR-063**: Every View Whitespace mark MUST stand out from the text: drawn on a background tinted from the
  theme's accent, with its symbol or label in the editor's full foreground colour, never the gutter's muted one.
  A line break reads `LF`, `CR` or `CRLF`, and the BOM `BOM`. The colours come from existing theme tokens, so
  every theme, bundled or the user's own, draws them.
- **FR-064**: Every View Whitespace marker MUST occupy exactly **one character cell** — a tab excepted, whose
  marker fills the tab's own width — so turning the view on moves no text that is one cell wide (a space,
  NBSP and the other spaces a monospaced font draws in one cell); a character that draws no width at all (a
  zero-width character, a control, the BOM) gains the one cell its marker needs. Every marker except a
  space's MUST sit in a box filled with a colour that contrasts with the editor background, holding one
  legible glyph in a colour that contrasts with the box: `↓` LF, `←` CR, `↵` CRLF, `°` a no-break space, `␣`
  another space, `ø` a zero-width character, `↔` a bidi mark, `ε` ESC, and so on; the character's name (its
  Unicode abbreviation and full name) is on hover. A space stays a dot with no box. **Supersedes** FR-062's
  multi-letter labels and FR-063's tinted background, and US6 AC7's `LF`/`CR`/`CRLF` text; the set FR-062
  marks is unchanged.
- **FR-065**: A View Whitespace marker MUST use the character's Unicode Control Picture (U+2400–U+2424) wherever
  that picture moves no text: a line break shows `␊` LF, `␍` CR or `␍␊` CRLF, in its box, at the picture's own
  width, because nothing follows it on its line. Mid-line, a picture cannot fit one cell legibly, so the
  FR-064 glyphs stay. **Every** marker — a space's dot and a tab included — MUST name its character on hover
  (its abbreviation and Unicode name, e.g. `SP — U+0020 SPACE`), so the marker must receive the pointer.
  **Supersedes** FR-064's one cell and `↓` `←` `↵` for line-break markers only; everything else in FR-064
  stands.
- **FR-066**: A line-break marker MUST read `LF`, `CR` or `CR LF` as text on one line, in the theme's editor
  font, smaller than the line so the line's height is unchanged, with room inside its box — looking the same in
  every theme. The pointer over a boxed marker (a line break, the BOM, a named character) MUST be the help
  cursor; over a space or a tab it stays the text cursor. **Supersedes** FR-065's control pictures `␊` `␍` `␍␊`
  for line breaks, whose look depends on the font that draws them; FR-065's hover names stand.
- **FR-067**: A marker's name MUST show in a lightweight popover — the theme's raised surface, never taking the
  pointer — placed just above the pointer and kept within the window, appearing after **500 ms** of hovering a
  marker, following the pointer while it stays on that marker, and closing when the pointer leaves it, the
  view scrolls or a key is pressed. The markers carry no native `title`. A preference,
  `editor.whitespaceHoverNames` (Editor group, toggle, default **on**), turns the popover and the help cursor
  off together: off, the pointer over a marker is the editor's own and nothing pops up. **Supersedes**
  FR-065's hover-title mechanism (the names themselves stand) and makes FR-066's help cursor conditional on
  the preference.
- **FR-068**: How a document was READ is told to the user by **one inline notice** on the document — the banner
  every panel type shares, never a toast — owned by the document and shown in every view of it:
  - **After a Reopen with Encoding** in encoding *E*: "This file has been read as *E* for this editor session
    only; the file is unchanged. To fix the file, change its encoding, verify, and save.", with **Change
    Encoding…** (opens the encoding list in Change Encoding mode) and **Dismiss**.
  - **On open**, when a file detected as UTF-8 without a BOM holds only one- and two-byte UTF-8 sequences and
    at least one word in which an ASCII letter sits beside a letter from U+0250–U+07FF (IPA, Greek, Cyrillic,
    Armenian, Hebrew, Arabic, Syriac — the letters Windows-1252 accent-and-symbol pairs decode to): "This file
    may be Windows-1252 text read as UTF-8: some words mix letters from different scripts.", with **Reopen as
    Windows-1252** and **Dismiss**. A word wholly in one script, and accented Latin, raise nothing.
  - The notice stays through edits and a Change Encoding, and goes when the document is **saved in an encoding
    other than the one it was read as**, when it is **dismissed**, or when a later reopen replaces it. Nothing
    is remembered per file: a fresh open decides again (clarification 3, FR-028). A notice that names a
    condition outranking it (moved out, replaced, a refused save, an unreadable path) shows instead.
  This extends FR-024 and FR-056 and changes neither: a reopen still writes nothing and has no undo step.
- **FR-069**: Single-byte Windows code pages, the fallback encoding, and the misread warning:
  - **Supported encodings** gain Windows-1250 (Central European), 1251 (Cyrillic), 1253 (Greek), 1254
    (Turkish), 1255 (Hebrew), 1256 (Arabic), 1257 (Baltic) and 1258 (Vietnamese), read and written exactly as
    Windows-1252 is (FR-012, FR-013): every byte read is written back unchanged, and a character the code page
    cannot hold refuses the save (FR-021). A byte the code page leaves undefined (1253: `AA D2 FF`; 1255:
    `D9–DF FB FC FF`; 1257: `A1 A5`) makes the file not readable in it, refused naming the encoding (FR-014).
    They are Reopen with Encoding and Change Encoding targets, never detected by their bytes.
  - **Lists**: every encoding list (the indicator's menu, the picker, the content menu's Encoding item) shows
    the Unicode encodings, then the Windows code pages, each named with its script (`Windows-1253 (Greek)`,
    and `Windows-1252 (Western European)`), then Reopen with Encoding…; the status bar names a code page
    alone (`Windows-1253`).
  - **`editor.fallbackEncoding`** (Editor group, a list of the nine code pages, default **Windows-1252**) is
    the last step of detection (FR-002 step 8), in every reader — the editor, Find in Files, its replace, the
    preview and the task toggle. When the file has a byte the fallback leaves undefined, Windows-1252, which
    reads every byte, is used instead.
  - **The warning** is FR-068's notice, raised when a file read by detection in a code page looks wrong
    for it: a word mixing scripts, a symbol inside a word (`Za¿ó³æ`), or — for a Latin-script code page — a
    text whose letters are mostly non-ASCII; **or** when jschardet, asked only about the nine code pages,
    names another one with confidence ≥ 0.3 (how Greek read as Cyrillic is caught, which the text alone
    never shows). When its best guess is another code page, the notice says "This file was read as *E*, but
    its text looks like *G*." with **Reopen as *G***; otherwise "This file was read as *E*, but its text may
    be in another encoding."; both with **Reopen with Encoding…** and **Dismiss**. FR-068's UTF-8 case names
    the fallback encoding rather than Windows-1252, and its button, like every Reopen as button, names the
    code page with its script (`Reopen as Windows-1252 (Western European)`). jschardet never decides a
    reading: nothing is switched without the user. It runs in the main process only, on at most the first
    16 KB. Known misses, measured: Turkish and Baltic text read as Windows-1252 decode to plausible Latin
    letters and jschardet is not confident (0.11–0.20), so they raise nothing; the user reopens them from the
    encoding menu.
  Multi-byte code pages (Shift-JIS, GBK/GB18030, Big5, EUC-KR) are out of scope (#535).
- **FR-070**: The encoding lists are grouped. **Supersedes FR-069's *Lists* bullet** for the menus, which
  listed every code page at the top level after a divider. The indicator's menu and the content menu's
  Encoding item show the four Unicode rows (UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16 BE), then one submenu,
  **Windows Code Pages**, holding the nine code pages in number order, each named with its script; the
  submenu row is marked ✓ when the document's encoding is one of them. Reopen with Encoding… stays last, in a
  group of its own. The Change Encoding and Reopen with Encoding pickers stay one flat keyboard list, the
  same rows under two non-focusable headings, "Unicode" and "Windows Code Pages". The status bar still names
  a code page alone (`Windows-1253`).
- **FR-071**: What the read notice offers after a reopen. **Supersedes FR-068's *reopened* wording and its
  Change Encoding… action** wherever the document was reopened in an encoding other than UTF-8: that action
  opened the picker with the current encoding already marked, a dead end. The first clause is kept: "This
  file has been read as *E* for this editor session only; the file is unchanged." It continues "To open it
  this way every time, convert it to UTF-8 and save, or make *E* your fallback encoding." for a code page, and
  "To open it this way every time, convert it to UTF-8 and save." for UTF-16. Actions: **Convert to UTF-8**
  (Change Encoding to UTF-8 without a BOM — dirty, one undo step, nothing written; the notice goes on the save,
  as FR-068 says), then, for a code page, **Use *E* as Fallback Encoding** (writes `editor.fallbackEncoding`
  and dismisses the notice), then **Dismiss**. *E* is named with its script (`Windows-1253 (Greek)`). A reopen
  in UTF-8 keeps FR-068's wording and Change Encoding…. The fallback clause and action appear only when
  making *E* the fallback would read this file in it: a file whose bytes are valid UTF-8 (the
  `codepage-western-1252-misread.txt` case) is read as UTF-8 whatever the fallback, so it is offered Convert to
  UTF-8 alone *(derived)*.
- **FR-072**: Undefined bytes are kept, and the guess sees past them. **Supersedes FR-069's rule that a byte a
  code page leaves undefined makes the file unreadable in it, and its drop to Windows-1252** for such a
  fallback. Each undefined byte *b* reads as the private-use character U+F700 + *b* and writes back as *b*, so
  every byte still round-trips (FR-013) and no replacement character is ever produced (FR-014); typing that
  character writes that byte. jschardet sees the bytes with every byte some code page leaves undefined replaced
  by a space, and a suggestion whose own reading `looksMisreadAs` flags is dropped in favour of the next, or of
  none.
- **FR-073**: The status bar's encoding indicator names a code page with its script in brackets
  (`Windows-1253 (Greek)`), as the menus do. **Supersedes the clauses of FR-069 (*Lists*) and FR-070 that the
  status bar names a code page alone.** The Unicode encodings are unchanged (`UTF-8`, `UTF-8 with BOM`,
  `UTF-16 LE`, `UTF-16 BE`); the indicator's accessible name follows its text.
- **FR-074**: **Supersedes FR-071's *Use E as Fallback Encoding* action, and AC16's part in it.** The notice
  after a code-page reopen offers **Convert to UTF-8** and **Dismiss** only. Where FR-071 offered the fallback
  (making *E* the fallback would read this file in it), the sentence still names it and says where it is set:
  "…or make *E* your fallback encoding in preferences." Nothing on the notice writes a setting.

### Key Entities

- **Document text format**: per document. Holds its encoding (UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16
  BE, Windows-1252), whether a UTF-16 BOM is present, the dominant line ending, the per-line record when
  the endings are mixed, and whether the encoding was chosen by the user rather than detected. Shared by
  every panel showing the document, persisted with document state, and restored by recovery. It lives
  and dies with the document (FR-028).
- **Encoding detection result**: what detection returns for a byte sequence. It is a supported
  encoding (with BOM state) or a refusal reason: UTF-32, binary, or not decodable in the requested
  encoding.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over a fixture set covering every supported encoding × BOM present/absent × LF/CRLF/CR/
  mixed endings, opening and saving unedited files is byte-identical in **100%** of cases. A one-line
  edit changes only that line's bytes in **100%** of cases.
- **SC-002**: Windows-1252 round-trips all **256** byte values byte-identically.
- **SC-003**: Detection picks the right encoding for **100%** of the text fixtures, and classifies
  **100%** of a binary fixture set (images, executables, archives, compiled files) as binary or
  UTF-32, never as UTF-16 text.
- **SC-004**: Across every write path (editor save, Save with Encoding, Save All, Find in Files replace,
  task toggle) and every fixture, the replacement-character byte sequence appears in output **only**
  where it appeared in input: **zero** introduced occurrences.
- **SC-005**: Opening a 5 MB file in any supported encoding takes no more than **1.5×** the time the
  same content takes as UTF-8, and no supported encoding pushes a 5 MB open past the editor's existing
  large-file budget. *(Amended 2026-10-30: **2×** for the single-byte Windows code pages and, after it
  measured 1.51× on a hosted runner the same day, for UTF-16 too. See Clarifications, Session 2026-10-30.)*
- **SC-006**: A user can find a document's encoding and line ending, and change either, in **two
  clicks** from the status bar, or through the editor menu with the status bar hidden.
- **SC-007**: Converting a 5,000-line CRLF document to LF leaves the character count unchanged, and one
  undo restores the original endings and clean state.

## Assumptions

- **Encodings beyond these five are out of scope** (Shift-JIS, GBK, ISO-8859-x, the OEM code page,
  UTF-32 editing). Saving them needs an encoder library choice of its own. #517 names this boundary.
- **No default-encoding setting.** New documents stay UTF-8 without BOM. A preference for creating
  new documents in another encoding is not asked for.
- **CR is preserved, not offered as a conversion target** (D5).
- **BOM-less UTF-16 is detected and preserved, never chosen.** Save with Encoding offers UTF-16 only
  with a BOM (FR-027). A file without one keeps its absent BOM on an ordinary save.
- **No per-project or per-glob encoding rules** (an `.editorconfig` `charset` reader is #69, vNext).
- **The detection threshold for BOM-less UTF-16** is set in planning against fixtures (SC-003), not
  fixed in this spec.
- **Windows-1252 is the single legacy fallback** on every OS. It is the most common Western Windows
  ANSI code page. A fallback that varied by OS locale would break FR-004's determinism, and
  Principle II with it.
- **Maintainer agreement**: #517's agreement checkbox is unticked, and this spec is the scope being
  proposed for agreement.
