# Contract: Key Bindings on macOS

## Derivation (FR-029)

```text
MACOS_BINDINGS = applyOverrides(ctrlToMeta(WINDOWS_BINDINGS), MACOS_BINDING_OVERRIDES)
```

- `ctrlToMeta` replaces the `Ctrl` modifier with `Meta` (Cmd) in every chord; other modifiers stay (`Alt` = Option).
- `MACOS_BINDING_OVERRIDES` gives a different chord to each action whose derived chord is in `MACOS_RESERVED_CHORDS`.
- Same action ids as Windows and Linux; `columnSelectModifier: 'alt'`.

## Invariants (unit-tested)

1. Every action in `KEYBINDINGS_METADATA` has a macOS default.
2. No macOS default is in `MACOS_RESERVED_CHORDS`.
3. No macOS default collides with another macOS default.
4. No macOS default is a terminal-reserved chord (`RESERVED_TERMINAL_CHORDS` stay Ctrl, so the shell keeps them).
5. Every macOS default other than the plain Ctrl→Cmd form appears in `docs/key-bindings.md`'s macOS table.
6. Windows and Linux tables are unchanged.

## Resolution

- Renderer resolvers accept `metaKey` when `hostTraits().os === 'macos'` and decline it elsewhere (supersedes 046 FR-104's
  Meta clause on macOS only).
- Capture records `Meta` and the UI shows it as `Cmd`.
- Terminals: xterm receives Ctrl chords; Cmd chords never reach the shell. `terminals.macOptionIsMeta` (default false)
  decides whether Option sends Meta.
- Editor link modifier and column-select modifier read the host platform's table.
