# Manual test plan: Editor language coverage (spec 055)

Spec: `specs/055-editor-language-coverage/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Config files with comments open as JSON with Comments | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-02 | Files known by name open highlighted | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-03 | More extensions open in an existing language | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-04 | New languages from shipped grammars | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-05 | Windows batch files | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-06 | Which language wins, and the picker | signed off | 1bfa169bea63 | 2026-10-15 | |
| MT-07 | Resetting a manual language choice | signed off | 1bfa169bea63 | 2026-10-15 | |

## MT-01: Config files with comments open as JSON with Comments

Covers: FR-007, FR-009, SC-002, #70
Paths: `packages/core/src/editor/language-detect.ts`, `packages/core/src/editor/languages.ts`

### Steps
1. In a project, create `tsconfig.json` containing `{ // a comment` on one line, `"a": 1 /* block */` on the next, then `}`. Open it. Both comments are in the comment colour, nothing is underlined as an error, and the status bar reads *JSON with Comments*.
2. Create a folder `.vscode` and inside it `launch.json` with a `// comment` line. Open it. The status bar reads *JSON with Comments*.
3. Create `tsconfig.build.json` and `devcontainer.json`, each with a comment. Open each. Both read *JSON with Comments*.

### Negative cases
- Open `package.json`. The status bar still reads *JSON*.
- Create `launch.json` at the project root, outside `.vscode`. It opens as *JSON*.

## MT-02: Files known by name open highlighted

Covers: FR-009, FR-012, FR-013, FR-014, US2, #404, #490
Paths: `packages/core/src/editor/language-detect.ts`, `packages/core/src/editor/languages.ts`, `packages/ui/src/renderer/editor/grammars/dotenv.ts`, `packages/ui/src/renderer/editor/grammars/ignore.ts`, `packages/ui/src/renderer/editor/language-loaders.ts`

### Steps
1. Create `.env` containing `# settings`, `export API_KEY="abc # not a comment"` and `PORT=8080 # dev port`. Open it. The status bar reads *Dotenv*; `export`, the keys, the values and the two comments are each visibly coloured, and the `#` inside the quotes is not a comment.
2. Create `.env.local` with a `KEY=value` line. It reads *Dotenv* and is coloured the same way.
3. Create `Dockerfile` containing `FROM node:24`, `RUN echo "hi"` and a `# comment`. It reads *Dockerfile*; `FROM` and `RUN` are coloured as keywords, the string and the comment in their own colours.
4. Create `Dockerfile.dev` with the same text. It reads *Dockerfile*.
5. Create `.gitignore` containing `# build`, `dist/` and `!keep.log`. It reads *Ignore file*; the comment, the `!` and the patterns are distinct.
6. Open or create `.editorconfig`, `Gemfile`, `CMakeLists.txt` and `nginx.conf`. They read *INI*, *Ruby*, *CMake* and *nginx*, each highlighted.
7. Rename a file `notes.txt` to `Dockerfile` in the explorer while it is open. The open editor switches to *Dockerfile* and highlights.

### Negative cases
- Create `.envrc`. It stays *Plain Text*.
- Create `.env.json`. It reads *JSON*, not *Dotenv*.
- Create `.bazelignore`. It stays *Plain Text*.
- Create `Makefile`. It stays *Plain Text*.

## MT-03: More extensions open in an existing language

Covers: FR-010, US3, #491
Paths: `packages/core/src/editor/languages.ts`

### Steps
1. Create `App.csproj` with `<Project><PropertyGroup /></Project>`. It reads *XML* and the tags are coloured.
2. Create `page.mdx` with a `# Heading` and a paragraph. It reads *Markdown*; the heading is styled as a heading.
3. Create `Index.cshtml` with `<div>@Model.Name</div>`. It reads *HTML*; the tags are coloured and `@Model.Name` shows as plain text, not as an error.
4. Create `site.webmanifest` with `{"name": "x"}`. It reads *JSON*.

### Negative cases
- `.mdx` offers no preview button in the status bar (previews remain `.md` and `.markdown` only).

## MT-04: New languages from shipped grammars

Covers: FR-011, FR-019, FR-020, SC-006, US4, #491
Paths: `packages/core/src/editor/languages.ts`, `packages/ui/src/renderer/editor/language-loaders.ts`, `packages/ui/src/renderer/editor/highlight-style.ts`

### Steps
1. Create `change.patch` with `@@ -1 +1 @@`, `-old` and `+new`. It reads *Diff*; the `+` line, the `-` line and the `@@` header are three different colours.
2. Create `api.proto`, `build.gradle`, `Program.fs` and `login.feature` with a line of typical content each. They read *Protocol Buffers*, *Groovy*, *F#* and *Gherkin*, each highlighted.
3. Switch to a light theme, then a dark one. The files from steps 1–2 repaint and every coloured part stays readable against the background.

### Negative cases
- Open a Python file with a `@decorator` line. The decorator is in the keyword colour (an intended change), and nothing else in the file changes colour.

## MT-05: Windows batch files

Covers: FR-015, US5, #492
Paths: `packages/ui/src/renderer/editor/grammars/batch.ts`, `packages/core/src/editor/languages.ts`, `packages/ui/src/renderer/editor/language-loaders.ts`

### Steps
1. Create `build.cmd` containing `@echo off`, `REM comment`, `:: comment`, `:build`, `set NAME=%~dp0`, `for %%i in (*) do echo %%i`, `echo "done" > out.txt 2>&1` and `goto build`. It reads *Batch*.
2. Both comment lines are in the comment colour; `echo`, `set`, `for`, `in`, `do` and `goto` are keywords; `%~dp0` and `%%i` are variables; `:build` and the `build` after `goto` are labels; `"done"` is a string; `>` and `2>&1` are operators.
3. Write `ECHO` in capitals. It is coloured as a keyword too.

### Negative cases
- A line starting `remove.exe` is not shown as a comment.

## MT-06: Which language wins, and the picker

Covers: FR-007, FR-007a, FR-018, SC-003
Paths: `packages/core/src/editor/language-detect.ts`, `packages/core/src/editor/languages.ts`, `packages/ui/src/renderer/editor/language-picker.tsx`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/common/transient-overlay.ts`, `packages/ui/src/renderer/common/transient-scrim.tsx`

### Steps
1. Open the language picker from the status bar on any file. Batch, Dotenv, Dockerfile, Ignore file, F#, Diff and nginx are all listed. Nothing dims — not the editor, not the rest of the window, not the picker.
2. With the picker still open, press **Ctrl+Shift+T** (Quick Open). The picker closes and Quick Open opens with the window dimmed behind it as before.
3. In Preferences, add a *Language by file extension* row `.json` → JSON. Open `tsconfig.json`. It still reads *JSON with Comments*.
4. With the same row in place, open `package.json`. It reads *JSON*.
5. On `tsconfig.json`, choose *JSON* in the picker. It switches to *JSON*; close and reopen the file and it is still *JSON*.
6. In Preferences, open the language column of the *Language by file extension* table. Dotenv and Ignore file are offered as values.

### Negative cases
- Choosing *Plain Text* in the picker on `Dockerfile` turns its highlighting off, and it stays off on reopening.

## MT-07: Resetting a manual language choice

Covers: FR-024, FR-024a, FR-024b, US6
Paths: `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/language-override.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/editor/editor.css`, `packages/ui/src/renderer/editor/document-language-events.ts`, `packages/ui/src/renderer/editor/use-editor.ts`

### Steps
1. Open `tsconfig.json`. The status bar reads *JSON with Comments* with no ✕ beside it.
2. Choose *JSON* in the picker. A ✕ appears beside *JSON*; hovering it shows a title naming the reset.
3. Press the ✕. The status bar reads *JSON with Comments* again and the ✕ is gone.
4. Close and reopen `tsconfig.json`. It still reads *JSON with Comments*, with no ✕.
5. On `Dockerfile`, choose *Plain Text*: highlighting goes off and a ✕ appears. Press it: highlighting returns and the status bar reads *Dockerfile*.
6. Open the same file in two panels and choose *Shell* in one. Both show *Shell* and a ✕. Press the ✕ in the other panel: both return to the detected language and neither shows a ✕.
7. Right-click in an overridden editor. *Reset Language* sits beside *Set Language…* and resets it like the ✕.
8. Hide the status bar, override a file from the content menu's *Set Language…*, then reset it from *Reset Language*. It returns to the detected language.

### Negative cases
- Right-click in an editor with no override: *Reset Language* is shown disabled.
- A file whose language comes from a *Language by file extension* row shows no ✕.
- Overriding `main.rs` to *Rust* shows a ✕; pressing it leaves *Rust* and removes the ✕.
