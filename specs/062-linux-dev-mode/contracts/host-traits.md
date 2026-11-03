# Contract: Host Traits and IPC Addressing

## API (`@throng/core`)

```ts
configureHostTraits(traits: HostTraits): void   // once per process, at the composition root
hostTraits(): HostTraits                        // Windows values until configured
resolveIpcAddress(name: string): string
trashTerm(os?: OsName): string
```

## Who configures

| Process | Where |
|---|---|
| UI main | First statements of `main.ts`, before settings resolve |
| Renderer | Preload exposes `osName`, renderer entry configures before the first render |
| Daemon, PTY agent, collector | Their entry files, before composition |
| Tests | Default Windows values, unless a test configures and restores through `withHostTraits` in `@throng/core/testing` |

`packages/platform/tests/unit/host-traits-entries.test.ts` reads every process entry and fails if one does not configure traits from `selectPlatform`, so a forgotten entry cannot silently run Windows rules on Linux (FR-050).

## `resolveIpcAddress`

| Host | Input | Output |
|---|---|---|
| Windows | any | unchanged |
| Linux | `/abs/path.sock` | unchanged |
| Linux | `\\.\pipe\throng.user.ab12.daemon.dev` | `<dir>/throng.user.ab12.daemon.dev.sock` |
| Linux | name whose result exceeds 100 bytes | `<dir>/<16 hex FNV-1a of the name>.sock`, since core imports no Node builtin |

Characters outside `[A-Za-z0-9._-]` become `_`. Sites that must pass through it: `ipc-server.ts`, `pty-agent-entry.ts`, `pty-agent-host.ts`, `daemon-client.ts`, `instance-guard.ts`, `daemon-events`, and scripts that talk to the daemon.

## Listen rules (Linux)

`ipc.dir` is created `0700`; an existing one not owned by this uid or not `0700` is a startup failure with a plain reason (FR-011). A failed listen with `EADDRINUSE` probes the address: a live answer is the existing "already running" path; refused removes the file and listens again.

## Failure text

`isDaemonUnreachable` in `failure/cause.ts` also recognises a `.sock` address, so a dead daemon presents the same notice on Linux.
