# Contract — Renderer ↔ Main: the reset operations

The renderer is sandboxed (`contextIsolation`, no `fs`), so every reset crosses IPC. This contract **extends the seam feature 014 already established** (`ConfigManagementDeps.shippedDefaults` in `packages/ui/src/main/config-write-ipc.ts`); it does not create a second one.

Feature 010's operations already exist on `ShippedDefaultsService`. Two of them (`restoreAllThemes`, `restoreTheme`) are already exposed. This contract adds the remaining **three**.

---

## Main-process dependency (widened)

```ts
export interface ConfigManagementDeps {
  store: { /* unchanged */ };
  /** Feature 010 reset/restore API — 014 exposed the theme half; 015 adds the rest. */
  shippedDefaults: {
    restoreAllThemes(): Promise<RestoreResult>;   // existing (014)
    restoreTheme(name: string): Promise<RestoreResult>; // existing (014)
    resetBinding(action: string): Promise<ResetOne>;    // NEW (015)
    resetSetting(path: string): Promise<ResetOne>;      // NEW (015)
    resetEverything(): Promise<RestoreResult>;          // NEW (015)
    resetSettings(): Promise<RestoreResult>;            // NEW (015) — whole Settings editor
    resetKeybindings(): Promise<RestoreResult>;         // NEW (015) — whole Key Bindings editor
  };
  listFonts(): Promise<string[]>;
  listIconPacks(): Promise<{ name: string; assetBase: string }[]>;
}
```

`resetBinding`, `resetSetting` and `resetEverything` **already exist** on `ShippedDefaultsService` — for those, no service change is required, only the interface and the wiring already present in `main.ts` (`shippedDefaults: shippedService`).

`resetSettings()` and `resetKeybindings()` are **new, thin single-file operations** backing the per-tab reset (FR-011/FR-011b). They mirror exactly what feature 014 did when it needed a per-theme restore — write one document from the shipped record through `writeFilesAtomic`:

```ts
async resetSettings(): Promise<RestoreResult> {
  return this.store.writeFilesAtomic([
    { path: this.store.pathOf({ kind: 'settings' }),
      content: FileConfigStore.serialize(this.shipped.settings) },
  ]);
}
```

This is **not** re-implementing reset logic (FR-010): the values come from feature 010's record and the write goes through feature 010's atomic path. The alternative — having the renderer compute a defaults document and write it back — is the drift FR-011a exists to end, and is explicitly rejected.

---

## Channels (new)

| Channel | Args | Returns |
|---|---|---|
| `throng:config:resetBinding` | `action: string` | `ResetOne` — `{ ok: boolean; reason?: 'no-default' }` |
| `throng:config:resetSetting` | `path: string` | `ResetOne` — `{ ok: boolean; reason?: 'no-default' }` |
| `throng:config:resetPreferences` | — | `RestoreResult` — `{ ok: true }` \| `{ ok: false; failedPath: string; error: string }` |
| `throng:config:resetSettings` | — | `RestoreResult` — restores the whole Settings document |
| `throng:config:resetKeybindings` | — | `RestoreResult` — restores the whole Key Bindings document |

The global channel is named `resetPreferences`, not `resetEverything`, so the wire name states the true blast radius (FR-005b, FR-012a): projects, window layout and workspace state are never touched.

**Confinement**: these channels take an action id or a dotted path — never a filesystem path — and the service resolves the target file itself via `store.pathOf(...)`. There is no path-escape surface to guard, unlike the theme-name channels.

---

## Preload bridge (new entries under `config`)

```ts
resetBinding: (action: string): Promise<{ ok: boolean; reason?: string }> =>
  ipcRenderer.invoke('throng:config:resetBinding', action),
resetSetting: (path: string): Promise<{ ok: boolean; reason?: string }> =>
  ipcRenderer.invoke('throng:config:resetSetting', path),
resetPreferences: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
  ipcRenderer.invoke('throng:config:resetPreferences'),
resetSettings: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
  ipcRenderer.invoke('throng:config:resetSettings'),
resetKeybindings: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
  ipcRenderer.invoke('throng:config:resetKeybindings'),
```

Mirrored in `renderer/global.d.ts` as optional members of the existing `config` block, matching how 014's restore entries are typed.

---

## Behavioural guarantees (inherited from feature 010 — asserted, not re-implemented)

1. **Single-item resets touch exactly one item.** `resetBinding` rewrites one action's chord set; every other binding is byte-identical. `resetSetting` rewrites one leaf addressed by its dotted path; no parent or sibling structure is rewritten.
2. **`resetPreferences` is atomic and all-or-nothing.** Settings, key bindings and every built-in theme are staged and committed in one `writeFilesAtomic` call. If any file cannot be written the whole operation rolls back and reports `failedPath` — **nothing is partially reset**.
3. **Custom themes are never touched** by any of these operations (`resetEverything` writes only `reservedThemeNames(...)`).
4. **Idempotence.** Resetting an item already at its shipped value is a successful no-op.
5. **No shipped default → refused.** An action or leaf absent from the record returns `{ ok: false, reason: 'no-default' }` and writes nothing. (The UI never offers the affordance in that case, so this is a defence-in-depth path.)
6. **Hot-apply is automatic.** Every write lands through `FileConfigStore`, and the existing config watcher rebroadcasts `throng:config` — the same mechanism that makes feature 007's immediate-apply work. No reset needs its own refresh path.

---

## Failure contract (FR-006a)

A failed reset MUST NOT fail silently. The renderer surfaces `{ ok: false }` as a dismissable notice in the preferences window's inline strip, naming the operation and stating that **nothing was changed** — which, for `resetPreferences`, is the user-visible proof of guarantee (2) above.

---

## Contract tests

| Assertion | Layer |
|---|---|
| Each new channel is registered and reaches the corresponding service method | integration |
| `resetBinding` restores the **full** shipped chord set, leaving other actions untouched | integration |
| `resetSetting` restores exactly one leaf, siblings byte-identical | integration |
| `resetPreferences` restores settings + bindings + built-in themes in one operation | integration |
| `resetPreferences` against an unwritable config root leaves **every** file unchanged and reports `failedPath` | integration |
| A custom theme survives `resetPreferences` untouched | integration |
| `resetSettings` / `resetKeybindings` restore one whole document from the record, leaving the other kinds untouched | integration |
| An unknown action / path returns `{ ok: false, reason: 'no-default' }` and writes nothing | integration |
