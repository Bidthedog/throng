# Data Model: Editor Language Coverage (055)

No persisted data changes. Document state, overrides and the `editor.languageByExtension` setting keep
their shape; new language ids become valid values in both.

## LanguageDescriptor (016, extended)

| Field | Type | Rule |
|---|---|---|
| `id` | string | unique; never renamed once shipped (016 FR-005b) |
| `name` | string | non-empty |
| `extensions` | readonly string[] | dot-prefixed, lower-case; **may now be empty** for a language matched only by name (Dotenv, Ignore file, nginx) |
| `filenames` | readonly string[] \| undefined | **now populated** — see FilenameDescriptor |
| `indent` | IndentProfile \| undefined | only where the convention differs from the global default |

**Validation (registry test)**:

- Every descriptor claims at least one extension **or** one filename.
- No extension claimed twice (016 FR-004a), across all 55 descriptors.
- No two languages' filename descriptors can match one name (spec FR-006; algorithm in research R3).
- Every filename entry is lower-case, has at most one `*`, and a folder-qualified entry has exactly one
  `/` and no `*`.
- The set of ids equals the set of `LANGUAGE_LOADERS` keys (existing guard, new count 55).

## FilenameDescriptor (new; a string)

| Form | Recognised by | Matches against |
|---|---|---|
| exact | no `*`, no `/` | the basename |
| pattern | one `*`, no `/` | the basename; `*` matches any run of characters, including none |
| folder-qualified | one `/`, no `*` | `<parent folder name>/<basename>` |

All comparisons lower-case. Path separators `\` and `/` are equivalent before the parent folder is read.

**Trailing-wildcard rule (FR-003a)**: a pattern ending in `*` does not match a basename that ends in a
suffix any descriptor's `extensions` claims.

**Specificity (FR-008)**: folder-qualified and exact entries are tried before patterns. FR-006 guarantees
at most one language survives each tier.

## Effective language — the precedence chain (FR-007)

```
1 document manual override        → explicit Plain Text terminates; unresolvable id falls through
2 built-in filename match          (new)
3 user extension mapping          → explicit Plain Text terminates; unresolvable id falls through
4 built-in extension match
5 plain text
```

## New descriptors (24)

| id | name | extensions | filenames | indent |
|---|---|---|---|---|
| `diff` | Diff | `.diff` `.patch` | | default |
| `protobuf` | Protocol Buffers | `.proto` | | default |
| `cmake` | CMake | `.cmake` | `cmakelists.txt` | default |
| `groovy` | Groovy | `.groovy` `.gradle` | `jenkinsfile` | 4 spaces |
| `fsharp` | F# | `.fs` `.fsx` `.fsi` | | 4 spaces |
| `vb` | Visual Basic | `.vb` | | 4 spaces |
| `vbscript` | VBScript | `.vbs` | | 4 spaces |
| `scala` | Scala | `.scala` `.sc` | | 4 spaces |
| `perl` | Perl | `.pl` `.pm` | | 4 spaces |
| `r` | R | `.r` | | default |
| `haskell` | Haskell | `.hs` | | 4 spaces |
| `elm` | Elm | `.elm` | | 4 spaces |
| `erlang` | Erlang | `.erl` `.hrl` | | 4 spaces |
| `clojure` | Clojure | `.clj` `.cljs` `.cljc` `.edn` | | default |
| `julia` | Julia | `.jl` | | 4 spaces |
| `http` | HTTP requests | `.http` `.rest` | | default |
| `gherkin` | Gherkin | `.feature` | | default |
| `jinja` | Jinja | `.j2` `.jinja` `.jinja2` | | default |
| `nsis` | NSIS | `.nsi` `.nsh` | | default |
| `nginx` | nginx | | `nginx.conf` | default |
| `dockerfile` | Dockerfile | `.dockerfile` | `dockerfile` `containerfile` `dockerfile.*` | default |
| `dotenv` | Dotenv | | `.env` `.env.*` | default |
| `ignore` | Ignore file | | `.gitignore` `.dockerignore` `.gitattributes` `.npmignore` `.prettierignore` `.eslintignore` `.stylelintignore` `.vscodeignore` | default |
| `batch` | Batch | `.bat` `.cmd` | | 4 spaces |

## Existing descriptors gaining entries

| id | + extensions | + filenames |
|---|---|---|
| `xml` | `.csproj` `.fsproj` `.vbproj` `.props` `.targets` `.nuspec` `.resx` `.config` `.xaml` `.slnx` `.ps1xml` | |
| `jsonc` | `.json5` `.code-workspace` | `tsconfig.json` `tsconfig.*.json` `jsconfig.json` `.eslintrc.json` `.babelrc` `.swcrc` `devcontainer.json` `.devcontainer.json` `.vscode/settings.json` `.vscode/launch.json` `.vscode/tasks.json` `.vscode/extensions.json` |
| `json` | `.webmanifest` | |
| `markdown` | `.mdx` | |
| `html` | `.cshtml` `.razor` `.svelte` `.astro` | |
| `ini` | `.properties` | `.editorconfig` `.npmrc` `.gitconfig` |
| `ruby` | | `gemfile` `rakefile` `vagrantfile` |

`tsconfig.json` and `tsconfig.*.json` both belong to `jsonc` — same-language overlap is not a conflict
(FR-006).
