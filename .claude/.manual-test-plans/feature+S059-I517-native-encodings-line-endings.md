# Manual test plan: 059 native encodings and line endings

Spec: `specs/059-native-encodings-line-endings/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Edit and save a Windows-1252 file | signed off | 98664a0f7190 | 2026-10-29 | |
| MT-02 | Open and save UTF-16 files; refuse UTF-32 and binary | signed off | 98664a0f7190 | 2026-10-29 | |
| MT-03 | Encoding indicator: Change Encoding and Reopen with Encoding | signed off | 98664a0f7190 | 2026-10-29 | |
| MT-04 | Line endings: switch between LF, CR, CRLF, Mixed, and insert each | signed off | 98664a0f7190 | 2026-10-29 | |
| MT-05 | Find in Files, replace, preview and task toggle on these files | needs retest | 98664a0f7190 | 2026-10-29 | ae325530 touched packages/ui/src/main/file-search-service.ts |
| MT-06 | Open failures share a notice only when the error is the same | signed off | 98664a0f7190 | 2026-10-29 | |
| MT-07 | View Whitespace | needs retest | 98664a0f7190 | 2026-10-29 | ae325530 touched packages/core/src/config/settings-metadata.ts |
| MT-08 | Windows code pages, the fallback encoding and the misread warning | needs retest | 98664a0f7190 | 2026-10-29 | ae325530 touched packages/core/src/config/app-settings.ts |

Setup for every group: a project on `D:/git/throng_tests/encodings/`, which holds the 059 fixture files (restore them after a run with `bash "D:/git/throng_tests/encodings/.claude/skills/reset-encodings/reset.sh"`) — `codepage-western-1252.txt`
(Windows-1252, `café costs £5 or 5€`, CRLF), `utf16le-bom-powershell.txt` (UTF-16 LE with BOM, CRLF),
`utf16be-bom.txt`, `utf16le-nobom.txt`, `utf16be-nobom.txt`, `utf32le-bom.txt`, `binary-picture.png`,
`eol-mixed.txt` (CRLF and LF lines), `eol-lf-only.txt`, `eol-crlf-5000-lines.txt` (5,000 CRLF lines),
`utf8-mojibake.txt` (UTF-8 reading `cafÃ©`), `codepage-western-1252-misread.txt` (Windows-1252 whose bytes are also valid UTF-8, so it opens wrong), `utf16le-bom-tasks.md` (UTF-16 LE task list) and `codepage-western-1252-notes.md`
(Windows-1252, holds `café`). Compare files on disk in any hex viewer you trust.

## MT-01: Edit and save a Windows-1252 file

Covers: FR-002, FR-010, FR-011, FR-012, FR-013, FR-020, FR-021, FR-022, FR-023, SC-001, SC-004
Paths: `packages/core/src/editor/text-fidelity.ts`, `packages/ui/src/main/editor-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/renderer/editor/encoding-save-banner.tsx`, `packages/ui/src/renderer/editor/encoding-refusal-store.ts`, `packages/ui/src/renderer/editor/editor-failure-banner.tsx`

### Steps
1. Open `codepage-western-1252.txt` from the file tree. It reads `café costs £5 or 5€` and `über`, with no `?` or boxes; the status bar says `Windows-1252 (Western European)` and `CRLF`.
2. Change `third` to `3rd` and press Ctrl+S. The tab's dirty dot clears. In a hex viewer, `é` is still the single byte `E9`, `€` is `80`, and only the edited word's bytes differ.
3. Type `😀` at the end of a line and press Ctrl+S. One banner appears above the editor naming Windows-1252, the character and its line and column, with a **Save with Encoding…** button. The tab stays dirty and the file on disk is unchanged.
4. Press Ctrl+S again. The same banner flashes; no second banner appears.
5. Split the panel so the document shows twice. The banner shows in both views.
6. Delete the `😀`. The banner disappears; Ctrl+S now saves.

### Negative cases
- No path writes `EF BF BD` into the file: after any save the hex viewer shows no `EF BF BD`.
- With the `😀` back in and a second, plain file edited, **Save All** saves the plain file and leaves `codepage-western-1252.txt` dirty with its banner.

## MT-02: Open and save UTF-16 files; refuse UTF-32 and binary

Covers: FR-002, FR-003, FR-006, FR-007, FR-011, FR-053, SC-002
Paths: `packages/core/src/editor/text-fidelity.ts`, `packages/ui/src/main/editor-service.ts`, `packages/ui/src/renderer/editor/editor-missing-notice.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`

### Steps
1. Open `utf16le-bom-powershell.txt`. It reads `héllo from PowerShell`; the status bar says `UTF-16 LE` and `CRLF`.
2. Edit a word and press Ctrl+S. In a hex viewer the file still starts `FF FE`, every character is two bytes, and lines end `0D 00 0A 00`.
3. Open `utf16be-bom.txt`, `utf16le-nobom.txt` and `utf16be-nobom.txt` in turn. Each reads correctly; the status bar says `UTF-16 BE`, `UTF-16 LE`, `UTF-16 BE`.
4. Edit and save `utf16le-nobom.txt`. In a hex viewer it still has no BOM.

### Negative cases
- Opening `utf32le-bom.txt` shows the notice "This file is UTF-32, which throng does not open." No editor content appears.
- Opening `binary-picture.png` shows "That file is not text, so it cannot be opened in an editor."

## MT-03: Encoding indicator: Change Encoding and Reopen with Encoding

Covers: FR-014, FR-015, FR-024, FR-025, FR-026, FR-028, FR-030, FR-031, FR-033, FR-034, FR-055, FR-056, FR-058, FR-041, FR-068, FR-071
Paths: `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/encoding-picker.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/document-authority.ts`, `packages/ui/src/renderer/editor/picker-request.ts`, `packages/ui/src/renderer/editor/encoding-save-banner.tsx`, `packages/ui/src/renderer/editor/document-replica.ts`, `packages/ui/src/main/editor-ipc.ts`, `packages/ui/src/main/undo-service.ts`, `packages/ui/src/renderer/editor/read-notice-banner.tsx`, `packages/ui/src/renderer/editor/read-notice-store.ts`, `packages/core/src/editor/misread-hint.ts`

### Steps
1. Open any UTF-8 file. The status bar shows `UTF-8`. Click it: the menu lists UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16 BE and Windows-1252 with UTF-8 marked, then **Reopen with Encoding…** last.
2. Choose **UTF-16 LE**. The indicator reads `UTF-16 LE` and the tab is dirty; the file on disk is unchanged.
3. Press Ctrl+Z. The indicator reads `UTF-8` and the tab is clean. Press Ctrl+Y, then Ctrl+S: in a hex viewer the file starts `FF FE` and every character is two bytes.
4. Split the panel. Change the encoding in one view; the other view's indicator follows at once.
5. Open `utf8-mojibake.txt`, choose **Reopen with Encoding… → Windows-1252**. The text is reinterpreted, the tab is clean and Ctrl+Z has nothing to undo. A notice above the editor reads "This file has been read as Windows-1252 (Western European) for this editor session only; the file is unchanged. To open it this way every time, convert it to UTF-8 and save.", with **Convert to UTF-8** and **Dismiss** — no fallback action, since the file is valid UTF-8 and would open as UTF-8 whatever the fallback.
6. Type a character, then choose **Reopen with Encoding…** again. A dialog asks to discard your changes; Cancel leaves the edit, Discard reloads.
7. Right-click inside the editor. The content menu has an **Encoding** item with the same list.
8. Open Preferences → Key Bindings. The Editor group lists Change Encoding and Reopen with Encoding, unbound, each with a description.
9. Open `codepage-western-1252-misread.txt`. Its words read wrongly (e.g. `CAFə`), and a notice says the file may be Windows-1252 text read as UTF-8, with **Reopen as Windows-1252 (Western European)** and **Dismiss**.
10. Click **Reopen as Windows-1252 (Western European)**. The text reads correctly (`CAFÉ™`), the tab is clean, and the notice now says the file has been read as Windows-1252 (Western European) for this editor session only, with **Convert to UTF-8** and **Dismiss**.
11. Click **Convert to UTF-8**. The status bar says `UTF-8`, the tab is dirty and the notice stays. Check the text, press Ctrl+S: the notice goes. Close and reopen the file: it opens correctly as UTF-8, with no notice.
12. Split a panel showing a file with the notice: both views show it, and **Dismiss** in one clears both.

### Negative cases
- Open `utf8-emoji.txt`, change to **Windows-1252**, press Ctrl+S. The save-refusal banner names the emoji; nothing is written.
- On `codepage-western-1252.txt`, **Reopen with Encoding… → UTF-16 LE** refuses with a notice that the file is not valid UTF-16 LE text; the document is unchanged.
- On a never-saved document, **Reopen with Encoding…** is unavailable.
- Open `utf8-plain.txt`, `utf8-mojibake.txt` and a Greek or Cyrillic UTF-8 file: none shows the may-be-misread notice.
- Reopen a file as Windows-1252 and save it without changing the encoding: the notice stays.
## MT-04: Line endings: switch between LF, CR, CRLF, Mixed, and insert each

Covers: FR-030, FR-032, FR-035, FR-036, FR-037, FR-038, FR-039, FR-057, FR-058, FR-061, SC-005
Paths: `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/status-strip-fit.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/editor/document-replica.ts`, `packages/ui/src/main/document-authority.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/core/src/editor/text-fidelity.ts`, `packages/core/src/editor/line-ending-map.ts`, `packages/ui/src/main/editor-ipc.ts`, `packages/ui/src/renderer/editor/use-editor.ts`

### Steps
1. Open `eol-mixed.txt`. The line-ending indicator reads `Mixed (CRLF)`. Click it: LF, CR, CRLF and Mixed are listed, Mixed marked current and not clickable.
2. Choose **CR**. The indicator reads `CR`, the tab is dirty. Ctrl+Z: `Mixed (CRLF)`, clean. Ctrl+Y and save: in a hex viewer every line ends `0D` only.
3. From `CR`, choose **LF**, then **CRLF**. Each switch changes the indicator and is one Ctrl+Z step.
4. Open `eol-lf-only.txt`, open the list. LF is marked current; choosing it changes nothing and the tab stays clean; Mixed is listed and cannot be chosen.
5. Right-click inside the editor. A **Line Endings** item holds the same list, plus **Insert Line Break → LF / CR / CRLF**.
6. In `eol-lf-only.txt`, put the caret after `already` and run **Insert Line Break → CRLF**. The indicator reads `Mixed (LF)`.
7. Type a few lines with Enter elsewhere, delete one, then save. In a hex viewer the inserted break is `0D 0A` and every other line ends `0A`.
8. Open `eol-crlf-5000-lines.txt` and choose LF. The indicator changes at once and typing stays responsive.
9. Narrow the window until the bar crowds. The line-ending indicator hides first after the line number, then the encoding indicator; the language label, wrap and View Whitespace toggles stay.

### Negative cases
- Editing and saving `eol-mixed.txt` without switching keeps every line's own ending, including after adding and removing lines.
## MT-05: Find in Files, replace, preview and task toggle on these files

Covers: FR-050, FR-051, FR-052, FR-053
Paths: `packages/ui/src/main/file-search-service.ts`, `packages/ui/src/main/replace-commit-service.ts`, `packages/ui/src/main/text-file-rewrite.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/find-in-files/commit-replace.ts`, `packages/ui/src/renderer/preview/task-toggle.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`

### Steps
1. With every fixture closed, run Find in Files for `café`. `codepage-western-1252.txt` and `codepage-western-1252-notes.md` are listed with correct snippets.
2. Replace `café` with `tea` and confirm. Both files now read `tea`; in a hex viewer they are still single-byte Windows-1252 with CRLF.
3. Open the preview of `utf16le-bom-tasks.md` and tick **first task**. The box stays ticked; the file on disk is still UTF-16 LE with BOM and reads `- [x] first task`.

### Negative cases
- Replacing `café` with `☕` refuses `codepage-western-1252.txt` in the report, saying the replacement adds a character Windows-1252 cannot represent; that file is unchanged.
- Find in Files lists nothing from `binary-picture.png` or `utf32le-bom.txt`.

## MT-06: Open failures share a notice only when the error is the same

Covers: FR-054, FR-053, FR-006, FR-007, FR-014
Paths: `packages/ui/src/renderer/workspace/panel-failure-notice.ts`, `packages/ui/src/renderer/workspace/operation.ts`, `packages/core/src/notice/grouping.ts`, `packages/ui/src/renderer/common/notification.tsx`

### Steps
1. Setup: in the file tree, copy `binary-picture.png` and paste it into the same folder, so there are two binary files.
2. Open `utf8-bom-invalid.txt`. One notice appears: "That file is not valid UTF-8 text." listing that file.
3. Open `binary-picture.png`. A second, separate notice appears: "That file is not text, so it cannot be opened in an editor." listing only `binary-picture.png`.
4. Open `utf32le-bom.txt`. A third notice appears: "This file is UTF-32, which throng does not open." listing only that file.
5. Open the copied PNG. It joins the not-text notice from step 3, which now lists both PNGs; no fourth notice appears.

### Negative cases
- No notice lists files whose errors differ, and no notice's sentence describes a file it lists wrongly.
- Renaming the project's root folder on disk with several editors open still raises one notice for the project, listing them all.

## MT-07: View Whitespace

Covers: FR-059, FR-060, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067
Paths: `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/editor/view-whitespace.ts`, `packages/ui/src/renderer/editor/editor.css`, `packages/ui/src/renderer/editor/document-format-store.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/editor/document-sync.ts`

### Steps
1. Open `eol-mixed.txt`. No whitespace symbols show; the status bar has a View Whitespace toggle beside the wrap toggle, off.
2. Turn it on. Spaces show a dot, and each line break shows a symbol, with the CRLF lines' symbol different from the LF line's.
3. Open `utf16le-bom-powershell.txt` in another panel and turn it on there. A BOM mark shows before the first character.
4. Type a tab, and paste text holding a vertical tab or an ESC character (copy one from a terminal). Each shows its own visible mark.
5. Split the first panel. The new view follows its own toggle; turning it off in one view leaves the other on.
6. Restart throng. Each panel's toggle is as you left it.
7. Open Preferences → Editor and turn on the View Whitespace default. A new editor opens with whitespace shown.
8. Toggle it from the content menu's **View Whitespace** item too; the item shows a check while on.
9. Open `D:\git\throng_tests\UPPER TEST\encodings\whitespace-all.txt` with View Whitespace on. Every row's `[ ]` holds a marker: a dot for SPACE, a boxed arrow across the TAB, and a boxed glyph for every other character (`°` NBSP, `␣` the other spaces, `ø` the zero-width ones, `LF`, `CR`).
10. Every marker but the space's sits in a box of a colour that contrasts with the editor, and its glyph is easy to read. Switch to a light theme: still so.
11. On a line of plain text with spaces, toggle View Whitespace off and on: no character moves. Each marker is one character wide, except a line break's.
12. Open `eol-mixed.txt`. Line breaks read `LF`, `CR` or `CR LF` on one line in their box, with room around the letters. Switch through throng, bash, ubuntu and vi-vim: each reads the same, without zooming.
13. Rest the pointer on each kind of marker in turn — a space's dot, a tab, a line break, the BOM mark, an NBSP. After about half a second a small popover naming the character appears just above the pointer, e.g. "SP — U+0020 SPACE", "LF — U+000A LINE FEED".
14. Over a line break, the BOM mark or an NBSP box the pointer is an arrow with a question mark; over a space or a tab it stays the text cursor.
15. With a popover showing, move the pointer along the marker: the popover follows it, staying above it. Move off the marker: it closes. Sweep the pointer quickly across a line of markers: nothing pops up.
16. Open Preferences → Editor and turn off the whitespace hover names. Over any marker the pointer stays the text cursor and no popover appears, however long it rests. Turn it back on: both return.

### Negative cases
- With it on, copy a line and paste it into another app: no symbols come with it. Save: the file holds no symbol bytes.

## MT-08: Windows code pages, the fallback encoding and the misread warning

Covers: FR-069, FR-068, FR-070, FR-071, FR-072, FR-073, FR-074
Paths: `packages/core/src/editor/text-fidelity.ts`, `packages/core/src/editor/misread-hint.ts`, `packages/ui/src/main/code-page-guess.ts`, `packages/ui/src/main/replace-commit-service.ts`, `packages/ui/src/main/task-toggle-service.ts`, `packages/core/src/workspace/model.ts`, `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/main/editor-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/file-search-service.ts`, `packages/ui/src/main/text-file-rewrite.ts`, `packages/ui/src/renderer/editor/encoding-picker.tsx`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/editor/read-notice-banner.tsx`

Fixtures (in the 059 fixture folder): `codepage-greek-1253.txt` (Greek, Windows-1253), `codepage-russian-1251.txt` (Russian, Windows-1251), `codepage-polish-1250.txt` (Polish, Windows-1250), `codepage-hebrew-1255.txt` (Hebrew, Windows-1255), `codepage-greek-1253-undefined.txt` (Windows-1253 with an `AA` byte), each at least 5 lines.

### Steps
1. Click the encoding indicator on `codepage-western-1252.txt`. The menu lists UTF-8, UTF-8 with BOM, UTF-16 LE, UTF-16 BE, then **Windows Code Pages ✓**, then **Reopen with Encoding…**. Hover Windows Code Pages: its flyout lists the nine code pages in number order, each with its script (`Windows-1250 (Central European)` … `Windows-1258 (Vietnamese)`), with `Windows-1252 (Western European) ✓`. Right-click in the editor → **Encoding**: the same rows. Run Change Encoding from its key binding: one list, under the headings **Unicode** and **Windows Code Pages**.
2. Open `codepage-greek-1253.txt`. It reads as accented Latin gibberish, the status bar says `Windows-1252 (Western European)`, and a notice says it was read as Windows-1252 but its text looks like Windows-1253 (Greek), with **Reopen as Windows-1253 (Greek)**, **Reopen with Encoding…** and **Dismiss**.
3. Click **Reopen as Windows-1253 (Greek)**. The Greek text reads correctly, the status bar says `Windows-1253 (Greek)`, and the notice now says the file has been read as Windows-1253 (Greek) for this editor session only, with the sentence "…or make Windows-1253 (Greek) your fallback encoding in preferences." and only **Convert to UTF-8** and **Dismiss**.
3a. Click **Convert to UTF-8**. The status bar says `UTF-8`, the tab is dirty, and Ctrl+Z puts it back to `Windows-1253 (Greek)`. Redo it and save: the notice goes, and reopening the file shows Greek with no notice.
3b. Restore the fixtures. In Preferences → Editor set Fallback encoding to `Windows-1253 (Greek)`, then open `codepage-greek-1253.txt`: Greek, no notice. Set the fallback back to Windows-1252.
3c. Open `codepage-greek-1253-undefined.txt`. The notice suggests **Windows-1253 (Greek)**, not Turkish. Reopen as it: Greek text, with one placeholder character where the undefined byte is. Edit another word and save: in a hex viewer the `AA` byte is still there and only the edited bytes changed.
4. Edit a word and press Ctrl+S. In a hex viewer only the edited bytes changed.
5. Open `codepage-russian-1251.txt` and `codepage-hebrew-1255.txt`: each gets the notice naming its own code page. Open `codepage-polish-1250.txt`: a notice appears (it may suggest Windows-1250, or offer only Reopen with Encoding…).
6. Open Preferences → Editor and set the fallback encoding to `Windows-1251 (Cyrillic)`. Close and reopen `codepage-russian-1251.txt`: it reads correctly, with no notice, and the status bar says `Windows-1251 (Cyrillic)`.
7. With that fallback, run Find in Files for a Russian word from the file. It is found, with a correct snippet. Set the fallback back to Windows-1252.

### Negative cases
- `codepage-western-1252.txt`, `codepage-western-1252-notes.md` and any French, German, Spanish or Danish Windows-1252 file open with no notice.
- (Superseded by FR-072: `codepage-greek-1253-undefined.txt` now opens as Windows-1253 — step 3c.)
- In `codepage-western-1252.txt`, choose **Change Encoding → Windows-1251 (Cyrillic)** and save: refused, naming `é`; nothing is written.
