# Contract: IShellDetection (core abstraction — Phase B)

OS seam for detecting installed terminal shells. Interface in `core/abstractions/shell-detection.ts`;
Windows impl `WindowsShellDetection` in `@throng/platform-windows`. Reusable contract suite in
`core/testing/shell-detection-contract.ts` (framework-agnostic, throws on first violation — same shape as
`runFileSystemContract`/`runPlatformInfoContract`).

## Interface

```ts
interface DetectedShell { id: string; label: string; file: string; defaultArgs: string[]; }

interface IShellDetection {
  detectInstalledShells(): Promise<DetectedShell[]>;
}
```

## Obligations (contract suite asserts)
- Returns an **array** (possibly empty — the **"No shells detected" edge case** / SC-003); never throws on a
  normal machine.
- Every entry has **non-empty** `id`, `label`, `file`; `file` is an **existing executable** path/command.
- `id`s are **unique** within the result.
- **Stable**: two calls return the same set (modulo install changes); side-effect-free.
- Only shells actually **present** are returned (a built-in not installed is omitted) — SC-003.
- Does **not** spawn shells as a side effect of detection (presence check only; any `--version` probe is
  lazy/optional and must not be required to list).
- **(Batch 2, FR-024) Ordered resolution + no false positives:** each built-in is resolved by trying, in
  order, **well-known install path → executable on PATH → platform registry**, stopping at the **first**
  that resolves to an existing executable. A shell resolvable by **none** of these is **absent** from the
  result (no false positive). The suite asserts, via injected fake probes, that (a) a shell present only on
  PATH is found, (b) a shell present only in the registry (e.g. Git-for-Windows `InstallPath`) is found at
  its registered location, (c) resolution order is honoured (earlier probe wins), and (d) a shell resolvable
  by no probe is omitted.

## Windows impl notes (not part of the contract)
Resolve each built-in via the ordered resolver (`resolveShellFile`, data-model §7.5). Candidates:
Windows PowerShell 5.1 (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), PowerShell 7
(`pwsh` on PATH / `%ProgramFiles%\PowerShell\7\pwsh.exe`), CMD (`%ComSpec%`), **Git Bash**
(`%ProgramFiles%\Git\bin\bash.exe` **→ `bash.exe` on PATH → registry** `HKLM\SOFTWARE\GitForWindows`
`InstallPath`, plus the `HKCU` and `WOW6432Node` variants). Real probes: fs existence, a PATH lookup, and a
registry read helper. Cache the result after first run.

## Ownership / DI
**Instantiated in UI main** (Phase B), inline like 004's `NodeFileSystem` (`ui/src/main/main.ts:275`).
Merged with `settings.terminals` by `shell-detection-service.ts`, exposed via `terminal.listFlavours`
(see terminal-bridge.md). The daemon does **not** perform detection.

## Contract tests
- Unit: a compliant fake passes; fakes violating each obligation fail (tests the suite).
- Integration/contract: `runShellDetectionContract(() => new WindowsShellDetection())` on the real machine.
