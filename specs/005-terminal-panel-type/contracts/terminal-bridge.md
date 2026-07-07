# Contract: Preload `terminal.*` Bridge (renderer ↔ UI main — Phases B/C)

Sandboxed renderer reaches flavour detection + terminals only through `window.throng.terminal`
(`ui/src/preload/preload.cts`), mirroring the `files.*` / `config.*` invoke+push pattern. UI main routes
commands to the daemon (terminal-rpc.md) and forwards daemon notifications to renderers via
`webContents.send`.

## Surface

```ts
window.throng.terminal = {
  // Phase B — detection (request/response; UI main owns IShellDetection, no daemon)
  listFlavours(): Promise<TerminalFlavour[]>,   // built-ins∩installed (minus disabled) ∪ user-defined

  // Phase C — session commands (request/response → daemon RPC)
  attach(req: { panelId: string; projectId: string; flavourId: string; params: string; cols: number; rows: number })
      : Promise<{ ok: true; status: 'running'|'exited'; scrollback: string; exit?: { code: number|null } } | { ok: false; error: { code: number|null; message: string } }>,
  write(panelId: string, data: string): Promise<void>,
  resize(panelId: string, cols: number, rows: number): Promise<void>,
  kill(panelId: string): Promise<void>,
  list(projectId?: string): Promise<{ panelId: string; status: string; busy: boolean }[]>,

  // Phase C — push (main → renderer; unsubscribe returned)
  onOutput(cb: (e: { panelId: string; data: string }) => void): () => void,
  onExit(cb: (e: { panelId: string; code: number|null; unexpected: boolean }) => void): () => void,
}
```

## Obligations
- `listFlavours` returns the merged catalogue (research D4/D5); empty array surfaces the no-shells edge
  (FR-011). UI main resolves `LaunchSpec` (flavour `file`/`args` + `params` + project root) before calling
  the daemon — the **renderer never sees raw executables/paths beyond the flavour label**.
- `attach` is the renderer's single entry to (re)connect a Terminal Panel by `panelId`; on success it
  replays `scrollback` into xterm then live output flows via `onOutput`.
- Errors return the tagged `{ ok:false, error }` envelope (existing `throng:rpc` pattern) — launch
  failure / flavour-missing surface in the Panel (FR-017/FR-019).
- `onOutput`/`onExit` deliver to **every** window hosting that `panelId`'s view (FR-021 mirror — a panel
  synced into a sub-workspace shows the same session in all its views); unsubscribe removes the listener (no
  leaks across panel unmount), matching `files.onChange`/`config.onChange`.
- On `onExit`, the renderer **reverts the Panel to the type-selection form** (FR-020), keeping the exit
  code/output visible; the user may relaunch Terminal or pick another type.

## Tests
- Integration (UI main): `listFlavours` merges detection + settings; `attach`/`write` round-trip to a
  fake/real daemon; an emitted daemon `terminal.output` notification reaches an `onOutput` subscriber.
- E2E: covered by `terminal-flavours.e2e.ts` (B) and `terminal.e2e.ts` (C).
