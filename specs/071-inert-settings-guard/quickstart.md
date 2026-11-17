# Quickstart: No Inert Settings Guard (071)

## Run the guard

```bash
td run --runner unit --scope file --target packages/core/tests/unit/no-inert-settings.test.ts
```

Expected: green, after roughly 12 s spent building the whole-repo program once.

## See where every setting is read (FR-013)

```bash
SETTINGS_READERS_REPORT=1 npx vitest run --project unit --silent=false packages/core/tests/unit/no-inert-settings.test.ts
```

`--silent=false` is needed because vitest 5 hides a passing test's console output.

Expected: one line per Settings key with the files that read it, for example
`explorer.dragCopyModifier ← packages/ui/src/renderer/explorer/file-tree.tsx`.

## Prove it fails (SC-003)

1. Add a descriptor and a default for a new key that nothing reads, then run the guard. It fails and names
   that key.
2. Revert. Comment out the only read of `explorer.dragCopyModifier` in
   `packages/ui/src/renderer/explorer/file-tree.tsx`, then run the guard. It fails and names
   `explorer.dragCopyModifier`. Revert.

The fixture test (`settings-readers-scan.test.ts`) proves both on every run. These steps are for a reviewer
who wants to see it against the real code.

## Rules, each with its own fixture

```bash
td run --runner unit --scope file --target packages/core/tests/unit/settings-readers-scan.test.ts
```

See [contracts/settings-readers-scan.md](contracts/settings-readers-scan.md) for the fixture table.
