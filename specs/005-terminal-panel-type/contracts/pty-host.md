# Contract: IPtyHost (core abstraction — Phase C)

OS seam for spawning/streaming/killing pseudo-terminals. Interface in `core/abstractions/pty-host.ts`;
impl `NodePtyHost` (node-pty/ConPTY) in `@throng/platform-windows`, consumed by the **daemon**. Reusable
contract suite in `core/testing/pty-host-contract.ts`.

## Interface

```ts
interface PtyStartOptions { file: string; args: string[]; cwd: string; cols: number; rows: number; env?: Record<string,string>; }
interface PtyHandle { readonly pid: number; }

interface IPtyHost {
  start(opts: PtyStartOptions): PtyHandle;
  write(handle: PtyHandle, data: string): void;
  resize(handle: PtyHandle, cols: number, rows: number): void;
  kill(handle: PtyHandle): void;
  onData(handle: PtyHandle, cb: (chunk: string) => void): () => void;  // returns unsubscribe
  onExit(handle: PtyHandle, cb: (e: { code: number | null; signal?: string }) => void): () => void;
  listChildPids(handle: PtyHandle): number[];   // for idle/busy classification (D12)
}
```

## Obligations (contract suite asserts, against a real short-lived shell)
- `start` in a given `cwd` yields a handle with a positive `pid`; the shell's reported cwd **is** `cwd`.
- Writing a command that echoes a unique marker → `onData` delivers a chunk **containing** the marker.
- `resize` does not throw and is reflected (best-effort; assert no error + process alive).
- `kill` ends the process → `onExit` fires; subsequent `write` is a safe no-op/throws deterministically.
- A process that exits on its own delivers `onExit` with its **exit code**.
- `onData`/`onExit` unsubscribe functions stop further callbacks.
- `listChildPids` returns `[]` for an idle shell and a non-empty list while a child command runs.

## Build note
node-pty is built for **plain Node 20** (the daemon process), **no electron-rebuild** (research D8).

## Contract tests
Integration/contract: `runPtyHostContract(() => new NodePtyHost())` — spawn `cmd /c`/`pwsh -c` style
short-lived shells, assert echo + exit + child-pid behaviour; guard timeouts so CI never hangs.
