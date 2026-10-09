# Contract: `terminal.command` carries the program's architecture

`packages/ipc-contract/src/terminal.ts`:

```ts
interface TerminalCommandNotification {
  panelId: string;
  command: string | null;   // unchanged (025 FR-019)
  arch?: string | null;     // NEW — 'x64' | 'x86' | 'arm64' for the process `command` names; null/absent when idle or unreadable
}
```

- Published when `command` or `arch` changes, as `command` alone was.
- The daemon reads `arch` through `IPtyHost.executableArch?(path)` for the chosen process's `executablePath`; a host
  without the method (the de-elevated agent) yields `null`.
- `executableArch` reads the PE header's machine field: `0x8664` → `x64`, `0x014c` → `x86`, `0xAA64` → `arm64`,
  anything else or any read failure → `null`. Results are cached by path for the daemon's life.
- Preload's `onCommand` and the renderer's command store carry `arch` through unchanged.

## A view re-attaching to a running session

- `terminal.attach` returns `windowTitle?: string` — the window title the program last set (OSC 0/2), followed by the
  daemon through every output chunk; `""` for none. The view sets it in its title store at once: the replayed tail
  is bounded and withheld on the alternate screen, so the sequence may not be in it. The tail itself is unchanged.
- `terminal.attach` to a running session also returns `command` and `arch` as `terminal.command` last published
  them (absent before the first observation). The view records them at once: a mounting view drops the command its
  panel showed, and an unchanged command is never published again.
- A NEW terminal in a panel clears what was last published for that panel, so its first observation is always
  published — though it matches the previous terminal's (a remembered command relaunched). An observation that
  completes after its terminal was replaced is discarded.
