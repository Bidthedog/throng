# Feature Specification: Editor Language Coverage — Filename Detection and New Languages

**Feature Branch**: `feature/S055-I70-editor-language-coverage`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Create the spec for these issues" — [#70](https://github.com/Bidthedog/throng/issues/70)
(exact-filename language descriptors, including JSON-with-comments configuration files),
[#404](https://github.com/Bidthedog/throng/issues/404) (`.env` highlighting),
[#490](https://github.com/Bidthedog/throng/issues/490) (Dockerfile highlighting),
[#491](https://github.com/Bidthedog/throng/issues/491) (more file types from grammars already shipped) and
[#492](https://github.com/Bidthedog/throng/issues/492) (Windows batch files). All five are v1.0.0, `area:editor`.

This feature extends the language registry and detection chain of **016** (Advanced Editor). Every 016
requirement not named below as superseded or extended stands unchanged — in particular, detection still
**never inspects document content** (016 FR-002), runs **once per document identity** (016 FR-002a), and an
explicit Plain Text choice still **terminates** the precedence chain (016 FR-004c).

**Supersessions.**

- **016 FR-002b** required that a filename with no extension (`Dockerfile`) or whose only dot is its first
  character (`.gitignore`, `.env`) open as plain text, and that detection never match on whole filenames.
  This feature **replaces that rule**: such names are matched by the new filename rung (FR-001–FR-006). The
  part of FR-002b that reserved the descriptor shape for this is what this feature fulfils. The
  longest-suffix rule of FR-002b stands.
- **016 FR-002** said detection is based "solely on the file's extension". It is now based on the file's
  **name and, for a small declared set, the folder it sits in** (FR-004) — still never its content.
- **016 FR-003** called the manual override "the sole correction path" for a missing extension. The manual
  override remains the correction path for anything the registry does not know; it is no longer the only
  way an extension-less file can be highlighted.
- **016 FR-005a** gains a rung (FR-007). Its order for the existing rungs is unchanged.
- **016 Out of Scope**, *Exact-filename language descriptors*, is delivered here.
- **016 FR-010, FR-010c and FR-010d** are **extended**, not superseded: a manual override can now be removed
  as well as set, from the status strip and the content menu (FR-024–FR-024b). *(Added 2026-10-14.)*

## Clarifications

### Session 2026-10-14

- Q: Does the user's extension mapping outrank a built-in filename match? → A: **No — a filename match
  outranks it**, on the assumption that filename descriptors can include an extension. (FR-007, FR-007a)
- Q: When a pattern with a trailing wildcard (`.env.*`, `Dockerfile.*`) matches a name that ends in an
  extension throng already highlights (`.env.json`, `Dockerfile.md`), which wins? → A: **The extension.** A
  trailing-wildcard pattern does not match such a name; exact names and fixed-ending patterns are unaffected.
  (FR-003a)
- Q: Should the Ignore file language cover only `.gitignore`, `.dockerignore` and `.gitattributes`, or every
  common ignore file? → A: **A fixed list**: those three plus `.npmignore`, `.prettierignore`,
  `.eslintignore`, `.stylelintignore` and `.vscodeignore`. No catch-all pattern. (FR-009)

#### Hand-testing feedback, 2026-10-14

The maintainer, testing MT-06: *"We need a 'reset' option on the editor language selector, too. Maybe just add
an 'X' next to the selection in the status bar if it has been overridden."* 016 lets a user set an override
(FR-010, FR-011) and gives no way to clear one. The answers below are **derived** from that request, the code
and repository precedent, not asked.

- Q: When does the reset control appear? → A: **Only while the document has a manual override** — any language
  chosen in the picker, Plain Text included (016 FR-011). A detected or mapped language shows no control.
  *(Derived: "if it has been overridden".)* (FR-024)
- Q: What does resetting do? → A: **It removes the document's override** — the persisted choice is deleted, so
  it does not come back on reopening or restart — and the language is **detected again** through the FR-007
  chain, in every view of the document. *(Derived: 016 FR-010a makes the override a property of the document.)*
  (FR-024a)
- Q: Does the reset need a menu item as well as the status-bar control? → A: **Yes** — *Reset Language* in the
  editor content menu beside *Set Language…*, disabled while there is no override. *(Derived: the constitution's
  "every panel action has a menu item"; Open Preview is the precedent for disabled-while-unavailable.)*
  (FR-024b)

## Definitions

- **Extension match**: 016's existing rule — the longest declared dot-prefixed suffix of the filename,
  case-insensitively.
- **Filename descriptor**: a registry entry that matches a document by its **whole filename** (`Dockerfile`,
  `.gitignore`), by a **filename pattern** (`tsconfig.*.json`, `Dockerfile.*`, `.env.*`), or by a filename
  **inside a named folder** (`.vscode/settings.json`).
- **Filename match**: the language a document's filename descriptors name, if any.
- **Approximate highlighting**: a file highlighted with a related language's grammar that covers most of it
  but not every embedded part (for example, Razor's C# blocks inside HTML). The language picker still names
  the language actually applied.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configuration files that allow comments stop showing errors (Priority: P1)

A user opens `tsconfig.json`, `.vscode/settings.json` or `devcontainer.json`. These files allow comments, and
the user's project has them. Today every comment is marked as an error, because the file is treated as strict
JSON by its `.json` extension. After this feature, the file opens as JSON with Comments and the comments read
as comments.

**Why this priority**: This is a correctness defect, not a missing nicety: the editor reports errors in valid
files that every TypeScript and VS Code project contains.

**Independent Test**: Open a `tsconfig.json` and a `.vscode/settings.json` that each contain a line comment
and a block comment. Neither shows an error marker; the status bar names *JSON with Comments*.

**Acceptance Scenarios**:

1. **Given** a `tsconfig.json` containing `// comment`, **When** the user opens it, **Then** the comment is
   highlighted as a comment, no error is marked, and the status bar reads *JSON with Comments*.
2. **Given** `tsconfig.build.json` or `jsconfig.json`, **When** opened, **Then** each opens as JSON with
   Comments.
3. **Given** `.vscode/launch.json`, **When** opened, **Then** it opens as JSON with Comments; **and given** a
   `launch.json` that is **not** inside a `.vscode` folder, **Then** it opens as plain JSON.
4. **Given** an ordinary `package.json`, **When** opened, **Then** it still opens as JSON — only the declared
   names change language.
5. **Given** a `tsconfig.json` the user has previously set to *JSON* by manual override, **When** reopened,
   **Then** the override still wins.

---

### User Story 2 - Files known by name open highlighted (Priority: P1)

A user opens a file whose name, not its extension, says what it is: `.env`, `.env.local`, `Dockerfile`,
`Dockerfile.dev`, `Containerfile`, `.gitignore`, `.editorconfig`, `CMakeLists.txt`, `Jenkinsfile`, `Gemfile`,
`nginx.conf`. Today these open as plain text, and the only remedy is a manual override on every file, in every
project. After this feature, each opens in its language.

**Why this priority**: These are among the most common files in any project root, and this is the gap 016
deliberately left open for this feature.

**Independent Test**: Open `.env`, `Dockerfile` and `.gitignore` in a fresh project with default settings.
Each is highlighted, and the status bar names its language.

**Acceptance Scenarios**:

1. **Given** a `.env` file with comments, `KEY=value` lines, quoted values and `export KEY=value` lines,
   **When** opened, **Then** keys, values and comments each take a distinct colour.
2. **Given** `.env.local`, `.env.development` or `.env.production.local`, **When** opened, **Then** each is
   highlighted the same way as `.env`.
3. **Given** `Dockerfile`, `Containerfile`, `Dockerfile.dev`, `api.Dockerfile` or `build.dockerfile`,
   **When** opened, **Then** each is highlighted as a Dockerfile: instructions, comments, strings and
   variables distinctly.
4. **Given** `.gitignore`, `.dockerignore`, `.gitattributes`, `.npmignore`, `.prettierignore`,
   `.eslintignore`, `.stylelintignore` or `.vscodeignore`, **When** opened, **Then** comments are highlighted
   distinctly from patterns. Any other `*ignore` file (`.bazelignore`) stays plain text.
5. **Given** `.editorconfig`, `.npmrc` or `.gitconfig`, **When** opened, **Then** each is highlighted as INI.
6. **Given** `CMakeLists.txt`, `Jenkinsfile`, `Gemfile`, `Rakefile`, `Vagrantfile` or `nginx.conf`, **When**
   opened, **Then** each opens as CMake, Groovy, Ruby, Ruby, Ruby and nginx respectively.
7. **Given** a file named `dockerfile` or `GEMFILE`, **When** opened, **Then** it matches as if the case were
   conventional (FR-005).
8. **Given** a document named `notes.txt` is renamed to `Dockerfile`, **When** the rename completes, **Then**
   the document is re-detected and highlighted as a Dockerfile (016 FR-002a).

---

### User Story 3 - More extensions open in a language throng already highlights (Priority: P2)

A .NET developer opens `App.csproj`, `Directory.Build.props` or `Strings.resx`; a web developer opens
`site.webmanifest`, `page.mdx` or `Index.cshtml`. Today these open as plain text even though throng already
highlights XML, JSON, Markdown and HTML. After this feature, each opens in the language its content is
written in.

**Why this priority**: High value per line of change, but less common than Stories 1 and 2, and nothing is
marked wrongly today — it is only unhighlighted.

**Independent Test**: Open one file of each extension in FR-010's table and confirm the status bar names the
listed language.

**Acceptance Scenarios**:

1. **Given** any extension listed in FR-010, **When** a file with it is opened, **Then** it opens in the listed
   language.
2. **Given** a `.mdx`, `.cshtml`, `.razor`, `.svelte` or `.astro` file, **When** opened, **Then** its markup is
   highlighted and its embedded code is shown unhighlighted rather than as errors (approximate highlighting).

---

### User Story 4 - New languages from grammars throng already ships (Priority: P2)

A user opens a `.patch`, a `.proto`, a `build.gradle`, an F# `.fs` file or a Perl script. Today each opens as
plain text although the grammar that highlights it is already part of the app. After this feature, each opens
highlighted, and each new language appears in the language picker.

**Why this priority**: Broad coverage for little cost, but each individual language serves fewer users than
Stories 1–3.

**Independent Test**: Open one file per language in FR-011's table. Each is highlighted, and the picker lists
the language by name.

**Acceptance Scenarios**:

1. **Given** a file with an extension listed in FR-011, **When** opened, **Then** it is highlighted in the
   listed language and the status bar names it.
2. **Given** any open document, **When** the user opens the language picker, **Then** every language added by
   this feature is listed and can be chosen as a manual override.
3. **Given** a session in which no file of a given new language has been opened, **Then** that language's
   grammar has not been loaded.

---

### User Story 5 - Windows batch files are highlighted (Priority: P2)

throng is Windows-first, and batch files (`.bat`, `.cmd`) are everywhere in Windows projects. Today they open
as plain text, and no grammar for them ships at all. After this feature, they open highlighted as *Batch*.

**Why this priority**: Important to the platform throng targets, but needs a grammar written for it, so it
carries more risk than Stories 3–4.

**Independent Test**: Open a `.cmd` file containing `@echo off`, a `REM` comment, a `::` comment, a label, a
`goto`, `%VAR%`, `%~dp0`, `%%i`, `!VAR!`, a quoted string and `2>&1`. Each form is distinct.

**Acceptance Scenarios**:

1. **Given** a `.bat` or `.cmd` file, **When** opened, **Then** it is highlighted as Batch and the status bar
   reads *Batch*.
2. **Given** `REM` and `::` comment lines, **Then** both are highlighted as comments.
3. **Given** keywords in any case (`ECHO`, `echo`, `Echo`), **Then** each is highlighted as a keyword.
4. **Given** `%VAR%`, `%~dp0`, `%%i` and `!VAR!`, **Then** each is highlighted as a variable.
5. **Given** labels (`:build`) and their `goto` / `call` targets, **Then** labels are distinct from commands.

---

### User Story 6 - A manual language choice can be undone (Priority: P2)

*(Added 2026-10-14 from hand-testing feedback; see Clarifications.)* A user who picks a language for a file
can today only pick another one. Even picking the language detection would have chosen leaves the file pinned
to it. After this feature, an overridden document shows a reset control beside its language in the status
bar, and resetting it hands the choice back to detection.

**Why this priority**: Without it, a manual choice is permanent, and FR-007's richer detection can never take
back a file a user once overrode.

**Independent Test**: Override `tsconfig.json` to JSON, then press the reset control. The file reads *JSON with
Comments* again, the control is gone, and it stays that way after closing and reopening the file.

**Acceptance Scenarios**:

1. **Given** a document whose language was chosen in the picker, **Then** the status bar shows a reset control
   beside the language, with a hover title naming the action.
2. **Given** a document whose language was detected or comes from the user's extension mapping, **Then** no
   reset control is shown.
3. **Given** an overridden document, **When** the user presses the reset control, **Then** the language is
   detected again, the status bar shows the detected language, and the control disappears.
4. **Given** a document reset this way, **When** it is closed and reopened, or the app restarts, **Then** it
   still opens in its detected language.
5. **Given** a document overridden to Plain Text, **When** reset, **Then** it is highlighted again in its
   detected language.
6. **Given** an overridden document shown in two panels, **When** reset in one, **Then** both show the
   detected language and neither shows the control.
7. **Given** the editor content menu on an overridden document, **Then** *Reset Language* is enabled and
   does the same as the control; on a document with no override it is disabled.

---

### Edge Cases

- **A filename that both a filename descriptor and an extension claim** (`tsconfig.json`, `CMakeLists.txt`,
  `nginx.conf`): the filename match wins over the built-in extension match (FR-007). `api.Dockerfile` is not
  such a case: no filename descriptor claims it, and it resolves at the extension rung through `.dockerfile`.
- **A trailing-wildcard pattern meeting an extension a later language claims**: the set of claimed extensions
  grows as languages are added, so `.env.config` opens as XML and `.env.rest` as HTTP requests, by FR-003a as
  written. That is intended: the extension names the format.
- **A user extension mapping that also matches** — for example, the user has mapped `.json` to JSON and opens
  `tsconfig.json`: the filename match wins and it opens as JSON with Comments (FR-007). A user mapping still
  decides every `.json` file no descriptor names.
- **A trailing-wildcard pattern meeting a known extension** (`.env.json`, `.env.example.js`,
  `Dockerfile.md`): the extension decides (FR-003a). `.env.example` and `Dockerfile.prod` have no claimed
  extension and still match their patterns.
- **Two filename descriptors that both match one name**: forbidden by the registry (FR-006); the registry
  test rejects it, so detection stays deterministic.
- **A folder-qualified descriptor** (`.vscode/settings.json`) and a file of the same name **elsewhere**:
  only the file inside the named folder matches; the other falls back to its extension (Story 1, scenario 3).
- **A file whose name matches no descriptor and has no extension** (`LICENSE`, `Procfile`): still plain text,
  exactly as today.
- **A `.env`-prefixed name that is not an environment file**, such as `.envrc` (direnv, a shell script): it
  does **not** match `.env` or `.env.*` — the pattern requires either the exact name or a dot after `.env`.
- **A document whose persisted manual override names a language a later build removes**: falls through, as
  016 FR-005b already requires. None of this feature's languages is removable without that rule applying.
- **Untitled documents** have no filename, so no filename rung applies; behaviour is unchanged.
- **A rename between two descriptors** (`Dockerfile` → `Dockerfile.old`): re-detected on the rename, per 016
  FR-002a.
- **Detection still never reads content**: a file named `run` that begins `#!/bin/bash` stays plain text.
- **Resetting a document whose detected language is the language it was overridden to** (`main.rs` overridden
  to Rust): the language does not change, the override is still removed, and the control disappears (FR-024a).
- **Resetting an untitled document's override**: there is nothing to detect from, so it becomes Plain Text by
  detection rather than by choice, and the control disappears.

## Requirements *(mandatory)*

### Functional Requirements

#### Filename descriptors (#70)

- **FR-001**: The language registry MUST support **filename descriptors** alongside extension suffixes. A
  language MAY declare any number of each.
- **FR-002**: A filename descriptor MUST be able to match by **exact filename** (`Dockerfile`, `.gitignore`,
  `CMakeLists.txt`).
- **FR-003**: A filename descriptor MUST be able to match by a **filename pattern** in which a single
  wildcard stands for any run of characters within the name (`tsconfig.*.json`, `Dockerfile.*`, `.env.*`).
  A pattern MUST NOT match across folder separators.
- **FR-003a**: A pattern whose wildcard is at its **end** (`.env.*`, `Dockerfile.*`) MUST NOT match a
  filename that ends in an extension the built-in registry claims: `.env.json` opens as JSON and
  `Dockerfile.md` as Markdown, while `.env.local` and `Dockerfile.dev` still match. A trailing wildcard names
  a variant of the file, not a different format. Exact names and patterns with a fixed ending
  (`tsconfig.*.json`) are unaffected.
- **FR-004**: A filename descriptor MUST be able to require that the file sit **directly inside a named
  folder** (`.vscode/settings.json`). This is the only use the detection chain makes of a document's folder;
  it MUST NOT look at any other part of the path.
- **FR-005**: Filename matching MUST be **case-insensitive**, as extension matching already is (016 FR-002).
- **FR-006**: No two languages may claim filename descriptors that can match the **same filename**. An
  automated registry test MUST enforce this, as 016 FR-004a's test already does for extensions. Where a
  pattern and an exact name of the **same** language overlap, that is not a conflict.
- **FR-007**: The precedence chain of 016 FR-005a MUST become, highest first:
  **(1)** the document's manual override, **(2)** the built-in **filename match** (new), **(3)** the user's
  extension mapping, **(4)** the built-in extension match, **(5)** plain text.
  A whole name is more specific than any extension, so a filename match outranks the user's extension
  mapping: mapping `.json` → JSON leaves `tsconfig.json` as JSON with Comments. Only a document's manual
  override changes the language of a file a filename descriptor claims. An explicit Plain Text at rungs 1 or
  3 still terminates the chain (016 FR-004c); an unresolvable id still falls through (016 FR-005b).
- **FR-007a**: A filename descriptor MAY include an extension — exact (`tsconfig.json`, `CMakeLists.txt`,
  `nginx.conf`) or within a pattern (`tsconfig.*.json`). Such a descriptor is matched as a whole name and
  takes the filename rung, never the extension rung.
- **FR-008**: Among filename descriptors that match one document, a **folder-qualified** or **exact** match
  MUST win over a pattern match. FR-006 guarantees that only one language can remain after that rule.
- **FR-009**: The registry MUST ship at least these filename descriptors:

  | Filenames | Language |
  |---|---|
  | `tsconfig.json`, `tsconfig.*.json`, `jsconfig.json`, `.eslintrc.json`, `.babelrc`, `.swcrc`, `devcontainer.json`, `.devcontainer.json`, `.vscode/settings.json`, `.vscode/launch.json`, `.vscode/tasks.json`, `.vscode/extensions.json` | JSON with Comments |
  | `.env`, `.env.*` | Dotenv (FR-013) |
  | `Dockerfile`, `Containerfile`, `Dockerfile.*` | Dockerfile (FR-012) |
  | `.gitignore`, `.dockerignore`, `.gitattributes`, `.npmignore`, `.prettierignore`, `.eslintignore`, `.stylelintignore`, `.vscodeignore` | Ignore file (FR-014) |
  | `.editorconfig`, `.npmrc`, `.gitconfig` | INI |
  | `CMakeLists.txt` | CMake |
  | `Jenkinsfile` | Groovy |
  | `Gemfile`, `Rakefile`, `Vagrantfile` | Ruby |
  | `nginx.conf` | nginx (FR-011) |

#### More extensions for existing languages (#491, part A)

- **FR-010**: These extensions MUST be added to existing languages:

  | Extensions | Language |
  |---|---|
  | `.csproj` `.fsproj` `.vbproj` `.props` `.targets` `.nuspec` `.resx` `.config` `.xaml` `.slnx` `.ps1xml` | XML |
  | `.json5` `.code-workspace` | JSON with Comments |
  | `.webmanifest` | JSON |
  | `.mdx` | Markdown (approximate) |
  | `.cshtml` `.razor` `.svelte` `.astro` | HTML (approximate) |
  | `.properties` | INI |

  (`.gitconfig` is listed in #491 as an extension, but by 016's rules it is an extension-less name; it is a
  filename descriptor in FR-009.)

#### New languages (#490, #491 part B, #492, #404)

- **FR-011**: These languages MUST be added, each with the grammar already shipped in the app:

  | Language | Extensions |
  |---|---|
  | Diff | `.diff` `.patch` |
  | Protocol Buffers | `.proto` |
  | CMake | `.cmake` |
  | Groovy | `.groovy` `.gradle` |
  | F# | `.fs` `.fsx` `.fsi` |
  | Visual Basic | `.vb` |
  | VBScript | `.vbs` |
  | Scala | `.scala` `.sc` |
  | Perl | `.pl` `.pm` |
  | R | `.r` |
  | Haskell | `.hs` |
  | Elm | `.elm` |
  | Erlang | `.erl` `.hrl` |
  | Clojure | `.clj` `.cljs` `.cljc` `.edn` |
  | Julia | `.jl` |
  | HTTP requests | `.http` `.rest` |
  | Gherkin | `.feature` |
  | Jinja | `.j2` `.jinja` `.jinja2` |
  | NSIS | `.nsi` `.nsh` |
  | nginx | (by filename only, FR-009) |

- **FR-012**: A **Dockerfile** language MUST be added, matched by the extension `.dockerfile` and the
  filename descriptors of FR-009. It MUST highlight instructions, arguments, comments, strings and variables.
- **FR-013**: A **Dotenv** language MUST be added, matched only by the filename descriptors of FR-009. It MUST
  highlight `#` comments, keys, values (quoted and unquoted) and an optional leading `export` distinctly.
  Variable interpolation (`${OTHER}`) MAY be highlighted but MUST NOT be resolved, and values MUST NOT be
  masked.
- **FR-014**: An **Ignore file** language MUST be added, matched only by the filename descriptors of FR-009.
  It MUST highlight `#` comments distinctly from patterns, and MUST distinguish a leading `!` negation.
- **FR-015**: A **Batch** language MUST be added for `.bat` and `.cmd`. It MUST highlight, distinctly:
  `REM` and `::` comments; labels and `goto` / `call` targets; built-in commands and keywords in any case;
  variables in the forms `%VAR%`, `%~dp0`-style modifiers, `%%i` and `!VAR!`; strings; the `@` prefix;
  redirection and pipe operators (`>`, `>>`, `<`, `|`, `&&`, `||`, `2>&1`); and the `^` escape.
- **FR-016**: Batch, Dotenv and Ignore file have no shipped grammar that meets their requirements, so each
  MUST come with a grammar written for this feature, covered by tokenizer unit tests over representative lines
  for every form FR-013, FR-014 and FR-015 name.

#### Registry-wide rules

- **FR-017**: No extension may be claimed by two languages (016 FR-004a), across the old and new entries
  together. The registry test that enforces it MUST cover every entry this feature adds.
- **FR-018**: Every language this feature adds MUST appear in the language picker, MUST be selectable as a
  document's manual override, and MUST be selectable as a value in the user's extension mapping (016 FR-004b),
  exactly as the existing languages are. A language matched only by name (Dotenv, Ignore file, nginx) is
  offered in the extension mapping too, so a user can map an extension of their own to it.
- **FR-019**: Every new grammar MUST load **only when** a document in that language is first shown, as 016's
  grammars already do. Opening a file in one language MUST NOT load any other new grammar.
- **FR-020**: Every new language's highlighting MUST use the existing theme token mapping, introduce **no new
  theme tokens**, and remain legible in every bundled theme.
- **FR-021**: Each new language MUST carry an indentation profile where its established convention differs
  from the global default (016 FR-018a): four spaces for F#, Visual Basic, VBScript, Perl, Haskell, Elm,
  Erlang, Julia, Groovy, Scala and Batch; the global default for the rest.
- **FR-022**: Every place that states the number of supported languages — the registry's own count, the
  tests that assert it, `README.md` and `docs/quick-start.md` — MUST state the new number in the same change.
- **FR-023**: The documentation of language detection MUST describe the filename rung and the new
  precedence order (FR-007), in `docs/quick-start.md`'s editor section — the doc that already carries the
  language count and the picker — with `docs/preferences.md`'s `editor.languageByExtension` row linking to it.
- **FR-024**: While a document has a **manual override** (016 FR-010, FR-011 — Plain Text included), the
  editor status strip MUST show a **reset control** immediately beside the language indicator (016 FR-010c). It
  MUST be a themeable icon control with a hover title naming the action, and MUST NOT be shown for a language
  that was detected or came from the user's extension mapping. *(Added 2026-10-14.)*
- **FR-024a**: Resetting MUST **remove the document's override** — deleting the persisted choice, not storing
  the detected language as a new one — and MUST resolve the language again through the FR-007 chain without
  the override rung. It applies to the **document** (016 FR-010a): every view of it updates, and the change
  survives reopening and restart. Resetting also returns the indentation profile to the detected language's
  (016 FR-010b). *(Added 2026-10-14.)*
- **FR-024b**: The editor content menu MUST offer **Reset Language** beside *Set Language…* (016 FR-010d),
  doing the same as the control. It MUST be **disabled** while the document has no override, so the menu
  carries the action even with the status bar hidden. *(Added 2026-10-14.)*
- **FR-024c**: The reset control and menu item MUST be covered at the lowest layer that can prove them: what
  the strip renders and when, and that a reset deletes the persisted override rather than overwriting it.
  *(Added 2026-10-14.)*

### Key Entities

- **Language descriptor** (016): a language's id, display name, extension suffixes, indentation profile — now
  also its **filename descriptors**.
- **Filename descriptor**: an exact name, a single-wildcard pattern, or a name qualified by its immediate
  folder; always case-insensitive.
- **Effective language** (016): the result of the precedence chain, now five rungs (FR-007).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every filename and extension listed in FR-009, FR-010 and FR-011 opens in its listed language
  with default settings — 100% of the listed names, checked by an automated detection test per entry.
- **SC-002**: A `tsconfig.json`, `.vscode/settings.json` and `devcontainer.json` containing comments open with
  **zero** error markers.
- **SC-003**: The number of supported languages rises from 31 to **55** (twenty from FR-011, plus Dockerfile, Dotenv, Ignore
  file and Batch), and the picker lists all of them.
- **SC-004**: Opening a file in a new language highlights it within the same first-highlight budget 016 set
  for its existing languages. Met by construction: every new grammar is loaded lazily and highlights the
  visible region exactly as 016's legacy-mode grammars do, so no new measurement is taken.
- **SC-005**: No file that opened in a language before this feature opens in a **different** language after
  it, except the JSON files FR-009 moves to JSON with Comments and files whose extension or name FR-009–FR-012
  newly claims — verified by the existing detection tests, unchanged except the 016 FR-002b assertions this
  feature supersedes (`Dockerfile`, `.gitignore`, `.env`, `tsconfig.json`).
- **SC-006**: In every bundled theme, each new language's comments, keywords, strings and variables are
  visually distinguishable from its plain text. Verified by asserting that every tag the new grammars emit maps
  to one of the existing syntax tokens, whose per-theme contrast the existing theme-syntax tests already
  enforce.

## Assumptions

- **Scope of "already ships"**: every grammar FR-011 and FR-012 rely on is present in the editor's existing
  dependencies (verified, 2026-10-14, for all twenty-one: diff, protobuf, cmake, groovy, F#, VB, VBScript, Scala, Perl, R,
  Haskell, Elm, Erlang, Clojure, Julia, HTTP, Gherkin, Jinja, NSIS, nginx, Dockerfile). No new dependency is
  added.
- **Dotenv** is hand-written (FR-016): the shipped `properties` grammar reads `export KEY` as one key and does
  not separate quoted values, so it cannot meet FR-013.
- **Makefile** is out of scope: no grammar ships for it, and 016 already declined to add a Makefile language
  with nothing to highlight it. Terraform/HCL and GraphQL are out of scope for the same reason.
- **No user-defined filename mappings.** Users keep the manual override and their extension mapping; a
  settings table for filename descriptors is not added. Because a filename match outranks the extension
  mapping (FR-007), a file a descriptor claims can be changed only per document, by manual override. If that
  proves too coarse, a user filename mapping ranked above the built-in filename match is the follow-up.
- **File icons** in the explorer are unchanged; they are keyed separately from the language registry.
- **Approximate highlighting** for `.mdx`, `.cshtml`, `.razor`, `.svelte` and `.astro` is acceptable for this
  feature; dedicated grammars are a later concern.
- The language picker, status bar indicator, manual override and user extension mapping need no change of
  behaviour; they gain entries. *(**Superseded 2026-10-14** for the status bar indicator and the manual
  override: an override can now be reset, by FR-024–FR-024b. The picker and the extension mapping still only
  gain entries.)*

## Out of Scope

- Resolving or masking `.env` values.
- Linting, language-server features, or outline/symbols for any new language (#375).
- Docker Compose files (YAML, already highlighted).
- Detecting a language from file content (shebangs, modelines), which 016 FR-002 forbids and this feature does
  not change.
- User-editable filename descriptors.
