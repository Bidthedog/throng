# Data model: Terminal panel titles from a template

## Settings (`terminals.*`)

| Key | Type | Default | Rule |
|---|---|---|---|
| `terminals.titleTemplate` | string | `({title} ? "{app}: {title} \| " : {command} ? "{command} \| " : ""){shell}({path} ? " ({path})" : "")` | must parse (FR-008); an unparsable persisted value renders as the default |
| `terminals.titleCommandMaxLength` | integer | 40 | 10–200, step 5 (FR-012) |
| `terminals.titlePathMaxLength` | integer | 40 | 10–200, step 5 (FR-012) |

## Compiled template (core, in memory)

```ts
type TemplateNode =
  | { kind: 'text'; text: string }
  | { kind: 'placeholder'; name: PlaceholderName }
  | { kind: 'group'; alternatives: TemplateNode[][] };

type PlaceholderName = 'command' | 'app' | 'arch' | 'title' | 'shell' | 'path' | 'folder' | 'project' | 'admin';

type ParseResult =
  | { ok: true; root: TemplateNode & { kind: 'group' } }
  | { ok: false; error: string; at: number };   // `at` is a 0-based character offset
```

## Title values (renderer → core)

```ts
interface TerminalTitleValues {
  command?: string | null;   // observed command line, raw; core derives {command} and {app}
  arch?: string | null;      // 'x64' | 'x86' | 'arm64'
  title?: string | null;     // the window title the running program set, never the shell's own
  shell: string;             // flavour label, else id
  cwd?: string | null;
  project?: string | null;
  admin: boolean;
}
```

`PanelTitleSources` gains `terminal?: { values: TerminalTitleValues; template: string; limits: { command: number; path: number } }` — the template as text; core memoises its parse.
Absent → the terminal is named as today (window title, else flavour) — every caller that does not yet pass it is
unchanged.

## State transitions

`{command}`, `{app}` and `{arch}` are empty from a terminal's start until its first observation (FR-016): the
renderer's command store forgets the panel's previous value when its terminal mounts (it already does,
`forgetTerminalCommand`), and an `undefined` observation renders empty.

## `ChildProcess` (core abstraction)

Gains `executablePath?: string` — the OS's `ExecutablePath`, empty or absent when it cannot be read.
