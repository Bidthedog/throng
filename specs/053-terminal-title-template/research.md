# Research: Terminal panel titles from a template

## R1 — The template language

> Superseded by clarification session 2: the language is now text plus C# expressions with quoted
> literals. contracts/title-template.md is the current definition; the reasoning below is kept as history.

**Decision.** A small hand-written scanner and recursive-descent parser in `packages/core`, producing a tree the
renderer evaluates. No dependency.

Tokens, scanned left to right, two characters before one:

| Text | Token |
|---|---|
| `((` `))` `{{` `}}` | a literal `(` `)` `{` `}` |
| `{name}` | a placeholder; `name` is one of FR-003's nine |
| `(` | open a group |
| `)` | close a group |
| `??` | the fallback separator, at the top level of a group |
| anything else | literal text |

So `)))` is a literal `)` then a close, and `( (({path})))` is a group holding a space, a literal `(`, `{path}`
and a literal `)`.

Tree: a **group** is a list of **alternatives** (split on its top-level `??`); an alternative is a sequence of
text, placeholders and groups. The whole template is parsed as the inside of a group.

Evaluation:

- An alternative is **empty** when it contains at least one placeholder, at any depth, and every one of them
  renders empty. An alternative with no placeholder is never empty.
- A group renders its first non-empty alternative, rendered; all empty → nothing (FR-005, FR-006).
- A placeholder renders its source value after FR-012's shortening, and empty when the source is absent.

Errors (FR-008), each with its character offset: an unclosed group, a `)` that closes nothing, an unclosed `{`, a
lone `}`, `{}`, an unknown name. The parser returns `{ ok: false, error, at }` rather than throwing.

**Alternatives considered.**
- *A general expression language (Handlebars, a format-string library).* Rejected: brings syntax the user did not
  ask for (helpers, conditionals by keyword) and a dependency, for nine placeholders and three rules.
- *Treating an empty placeholder as dropping only itself, with separator heuristics.* Rejected: guessing which
  neighbouring characters are "separators" is exactly what groups make explicit (Clarifications 2026-10-08).
- *`\(` escapes.* Rejected by the maintainer: brackets are escaped by doubling.

## R2 — Where each placeholder's value comes from

| Placeholder | Source today | Change |
|---|---|---|
| `{command}`, `{app}` | the daemon's `terminal.command` notification → renderer `command-store.ts`. The string is `normaliseCommand(Win32_Process.CommandLine)`, usually the resolved path: `"C:\WINDOWS\system32\PING.EXE" -t host` | a new exported core function, `commandDisplay(line) → { command, app }`, built on the private `splitCommand` / `bareName`: the executable by bare name, then the arguments unchanged |
| `{arch}` | nothing — no process architecture is read anywhere | the snapshot query (`node-pty-host.ts` `readProcessTable`) also selects `ExecutablePath`; `ChildProcess` gains optional `executablePath`; the daemon reads the chosen process's PE machine field through a new optional `IPtyHost.executableArch(path)` (platform-windows, cached by path) and adds `arch` to `terminal.command` |
| `{title}` | `title-store.ts` (xterm `onTitleChange`) | none |
| `{shell}` | `config.flavourLabel`, else `flavourId` (`panel-title.ts` `resolveTitle`) | none |
| `{path}`, `{folder}` | `cwd-store.ts` (daemon poll + OSC 9;9) | a version hook, like the title store's |
| `{project}` | `panel-body.tsx` `meta.projectName`; the header looks projects up itself | a renderer lookup by `originProjectId`, falling back to the sub-workspace's name as `meta` does |
| `{admin}` | `panel.config.runAsAdmin === true && elevated` (`panel-placeholder.tsx:904`, `useCapabilities`) | the same condition, read once into the title context |

**Decision.** One renderer function, `terminalTitleValues(panel)`, gathers every value from the stores above, and
`panelTitleSources(panel)` (`use-panel-display-names.ts`) passes them to core with the compiled template and the
two limits. Every caller of `panelDisplayTitle` — header, tab strip, dormant placeholder, notices, menus — is then
right without change, which is what FR-001 and 048 FR-032 ask.

**Every window gets the same values (FR-013, Principle XI).** The stores are per renderer, but each is fed in every
window: `terminal.command` and `terminal.cwd` are broadcast by UI main to all windows (`daemon-events.ts`); the
window title comes from each view's own xterm, which receives the same session output; the settings reach every
window through the config broadcast. A sub-workspace window showing the terminal therefore renders the same name.

**Working directories as reported.** `{path}` shows the directory as the daemon or the shell's OSC 9;9 reported
it. `shortenPath` and `{folder}` treat `\` and `/` alike and know a drive root (`D:\`), a UNC root
(`\\server\share\`) and a POSIX root (`/`).

**Why `{arch}` goes through the daemon.** The executable's path is only known where the process table is read,
and reading a PE header is OS work (Principle II): it belongs behind the platform host, and only for the one
process a terminal is running, not every row of every snapshot.

**Alternatives considered.** Parsing `{app}` from the command in the daemon and sending it: rejected, the command
string already carries it and core can derive it purely. Reading architecture for every snapshot row: rejected,
one file read per process per second for a value used once.

## R4 — The setting, its validation and its control

**Decision.**
- Three leaves under `terminals`: `titleTemplate` (string, `control: 'text'`), `titleCommandMaxLength` and
  `titlePathMaxLength` (sliders, 10–200, step 5, default 40).
- `FieldDescriptor` gains an optional `validate(value) → string | null`. `checkSettingsText` calls it for any
  descriptor that has one, so a hand-edited invalid template is reported like any other bad value, and
  `TextControl` calls it before committing, showing the message the way `NumberControl` does
  (`ctl__error`, `control-<key>-invalid`) and refusing the commit (FR-008).
- A persisted invalid template renders as the default (the read side never throws); settings validity reports it.

**Alternatives considered.** A bespoke check beside `checkActiveTheme`: rejected, the control needs the same rule
and a second copy would drift.

## R5 — The working directory beside the title

**Decision.** The header's `panel-cwd-<id>` span goes (FR-010). Five E2E files read the cwd through it; they move to
reading the rendered title, which carries the directory under the default template, and assert the full value
through the span's replacement: the header title's `title` attribute (the unshortened name), which already exists
for truncated names.

## R3 — Shortening

**Decision.** `{command}` keeps its start and ends with the ellipsis already used for long panel names;
`{path}` keeps its root and last folder and drops whole middle folders, replacing them with the ellipsis, and
falls back to an end cut when root plus last folder alone exceed the limit. Lengths count graphemes
(`truncateGraphemes`). The whole rendered title is then bounded by `tabs.maxNameLength` exactly as every panel
name already is (031 FR-037).

**Alternatives considered.** Character-level middle cut of the path: rejected, it splits folder names into
fragments nobody recognises.
