# Contract: language detection (`@throng/core`, `editor/language-detect.ts`)

Pure functions; no OS, no DOM, no I/O. Content never reaches them (016 FR-002 stands).

## `matchFilename(path: string): string | undefined` — new

The language id a built-in **filename descriptor** claims for `path`, or `undefined`.

- `path` may be a bare filename or a full path, with `/`, `\` or a mix of both.
- Case-insensitive.
- Tier order: folder-qualified and exact entries first, then patterns (FR-008).
- A pattern ending in `*` never matches a basename ending in a registry-claimed extension (FR-003a).

| Input | Result |
|---|---|
| `Dockerfile` | `dockerfile` |
| `D:\repo\api\Dockerfile.dev` | `dockerfile` |
| `Dockerfile.md` | `undefined` (FR-003a → extension rung) |
| `.env` / `.env.local` / `.env.production.local` | `dotenv` |
| `.env.json` | `undefined` |
| `.envrc` | `undefined` |
| `C:/p/tsconfig.build.json` | `jsonc` |
| `C:\p\.vscode\launch.json` | `jsonc` |
| `C:\p\launch.json` | `undefined` |
| `GEMFILE` | `ruby` |
| `LICENSE` | `undefined` |

## `detectLanguage(path: string): string` — behaviour widened

Built-in detection: `matchFilename(path)`, else the extension match (016 FR-002b longest suffix), else
`PLAIN_TEXT_ID`. A filename with no extension is no longer automatically plain text; it is plain text only
when no filename descriptor claims it.

## `resolveLanguage(args): LanguageResolution` — rung added

Order (FR-007): override → **filename match** → user extension mapping → extension match → plain text.

| `override` | user mapping | file | Result (`languageId`, `source`) |
|---|---|---|---|
| — | — | `tsconfig.json` | `jsonc`, `registry` |
| — | `.json → json` | `tsconfig.json` | `jsonc`, `registry` (filename outranks the mapping) |
| — | `.json → json` | `package.json` | `json`, `user-mapping` |
| `json` | — | `tsconfig.json` | `json`, `override` |
| `plaintext` | — | `Dockerfile` | `plaintext`, `override` (terminates) |
| `gone-lang` | — | `Dockerfile` | `dockerfile`, `registry` (unresolvable falls through, 016 FR-005b) |
| — | `.json → plaintext` | `tsconfig.json` | `jsonc`, `registry` (the mapping is rung 3; the filename rung decides first) |
| — | — | `.env.config` | `xml`, `registry` (FR-003a: `.config` is claimed, so `.env.*` yields) |

`LanguageSource` is unchanged: both built-in rungs report `'registry'`.

## Registry (`editor/languages.ts`)

`LANGUAGES` grows from 31 to 55 descriptors (see data-model.md). `filenames` entries are lower-case
strings in one of three forms; the registry test enforces their syntax and FR-006's no-overlap rule.

## Grammar loaders (`@throng/ui`, `renderer/editor/language-loaders.ts`)

`LANGUAGE_LOADERS` keys equal the registry ids — 55. Each loader dynamically imports its grammar; the
three hand-written grammars live in `renderer/editor/grammars/` and are imported the same way.
