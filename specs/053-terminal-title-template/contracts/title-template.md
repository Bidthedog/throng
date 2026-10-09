# Contract: the terminal title template

Owned by `packages/core/src/terminal/title-template.ts`. Pure; no I/O.

```ts
parseTitleTemplate(text: string): TitleTemplateParse        // { ok: true, root } | { ok: false, error, at }
renderTitleTemplate(root, values: Record<TitlePlaceholder, string>): string
validateTitleTemplate(value: unknown): string | null         // the descriptor's `validate`; null = valid
DEFAULT_TERMINAL_TITLE_TEMPLATE =
  '({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")'
```

## Text (outside an expression)

| Input | Renders |
|---|---|
| any character | itself — `"`, `?`, `:` and `\|` included |
| `{name}` | the placeholder's value |
| `((` `))` `{{` `}}` | a literal `(` `)` `{` `}` |
| `(` | opens an expression, closed by its `)` |
| `{name}` followed, after spaces, by `?` `??` `\|\|` `&&` | starts an expression with that placeholder, which runs while operators join operands; spaces after its last operand stay text |

## Expressions

Spaces are insignificant. Operands: `{name}`, `"string"`, `( expression )`.

| Precedence (lowest first) | Operator | Result |
|---|---|---|
| 1 | `c ? a : b` (right-associative) | `a` when `c` is true, else `b`; `a` and `b` are text |
| 2 | `a ?? b` | `a` unless empty, else `b`; both text |
| 3 | `a \|\| b` | true or false |
| 4 | `a && b` | true or false |
| 5 | `!a` | true or false |

A text value is true when it is not empty. True or false may only be a `?` condition, or an operand of `||`,
`&&`, `!`. A string literal: `{name}` renders its value, `{{` `}}` braces, `""` a quote, everything else itself.

## Rendering

The caller trims the result; an empty result names the panel by `{shell}`.

## Errors (message, then 0-based offset of the character at fault)

| Input | Message |
|---|---|
| `(a` | `Expected a placeholder, a "string" or "(" at 1` |
| `({shell}` | `Unclosed bracket at 0` |
| `a)` | `Unmatched ")" at 1` |
| `{a` | `Unclosed "{" at 0` |
| `a}` | `Unmatched "}" at 1` |
| `{}` | `Empty placeholder at 0` |
| `{nope}` | `Unknown placeholder {nope} at 0 — use {command}, {app}, {arch}, {title}, {shell}, {path}, {folder}, {project} or {admin}` |
| `("a` | `Unclosed quote at 1` |
| `({title} ? "a")` | `Expected ":" at 14` |
| `({app} \|\| {title})` | `"\|\|" gives true or false — use it before "?" at 7` |

## Worked examples (command `ping localhost -t`, shell `Git Bash`, path `D:\git\throng`)

| Template | Values | Renders |
|---|---|---|
| default | title empty | `ping localhost -t \| Git Bash (D:\git\throng)` |
| default | command and title empty | `Git Bash (D:\git\throng)` |
| default | app `claude`, title `work on links` | `claude: work on links \| Git Bash (D:\git\throng)` |
| `({title} ?? {app}) \| {shell}` | title empty | `ping \| Git Bash` |
| `{title} ? "WOOP" : "WAAP"` | title set | `WOOP` |
| `"WOOP" {shell}` | — | `"WOOP" Git Bash` |
| `{shell} (({folder}))` | — | `Git Bash (throng)` |
