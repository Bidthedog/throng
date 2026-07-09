# Contract: `config.*` preload bridge additions (renderer ↔ UI main)

**Preload**: `packages/ui/src/preload/preload.cts` (adds to the existing read-only `config` namespace).
**Main handlers**: `packages/ui/src/main/config-write-ipc.ts` → reuse `FileConfigStore`. **No daemon RPC, no
`ipc-contract`.** Immediate-apply rides the existing `config.onChange` broadcast (research D1/D13).

## Existing (unchanged)

```ts
config.get(): Promise<ConfigPayload>;                 // settings + resolved theme + keybindings
config.onChange(cb: (p: ConfigPayload) => void): () => void;  // hot-reload push (carries FR-041 too)
```

## New

```ts
config.write(id: ConfigDocId, json: string):
  Promise<{ ok: true } | { ok: false; error: string }>;   // FR-016/017/042
config.listThemes(): Promise<string[]>;                    // user themes + installed defaults
config.renameTheme(from: string, to: string):
  Promise<{ ok: boolean; error?: 'exists' | 'invalid' }>;  // FR-036a reject-on-collision
config.deleteTheme(name: string): Promise<void>;           // FR-036 (caller shows single confirm)
config.restoreDefaultThemes(): Promise<string[]>;          // FR-037 re-create missing from installed source
config.listFonts(): Promise<string[]>;                     // FR-038a cached installed families (may be empty)
config.listIconPacks(): Promise<IconPackInfo[]>;           // FR-039/040 discovered packs (name + resolved asset base)
```

## Behaviour

- **`write`**: `json` MUST parse and, for `settings`/`theme`, satisfy the tolerant parser; else `{ ok:false }`
  and **nothing is written** (FR-017). Path is resolved via `FileConfigStore.pathOf(id)` and **rejected if it
  escapes the config roots** (FR-042). A successful write is atomic; the watcher then rebroadcasts
  `throng:config` → live apply (FR-018) without restart.
- **`renameTheme`**: `to` already used by another theme → `{ ok:false, error:'exists' }` (FR-036a); invalid
  name → `'invalid'`. Never overwrites, never auto-suffixes.
- **`restoreDefaultThemes`**: re-creates only missing/built-in themes from the installed source; user themes
  untouched (FR-037). Returns the resulting theme list.
- **`listFonts`**: returns the `%APPDATA%\throng\fonts.json` cache; empty array if not yet populated (the
  picker falls back to a curated list — FR-038a). Never blocks on live enumeration.
