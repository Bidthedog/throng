# Contract: IElevationState (core abstraction — Phase G, FR-025a/c)

OS seam that reports whether the current process is running **elevated** (high integrity / "as
administrator") and, on Windows, backs the **de-elevated spawn** used for non-admin terminals in an
elevated daemon. Interface in `core/abstractions/elevation.ts`; Windows impl `WindowsElevation` in
`@throng/platform-windows`, consumed by the **daemon** (authoritative — it spawns the PTYs) and by **UI
main** (to compare against the daemon and trigger an elevated respawn, FR-025b). Reusable contract suite in
`core/testing/elevation-contract.ts`.

## Interface

```ts
interface IElevationState {
  isElevated(): boolean;   // true iff THIS process runs at high integrity (admin)
}
```

Pure gating helper (core `terminal/`), not part of the seam:

```ts
function canRunAsAdmin(daemonElevated: boolean): boolean; // === daemonElevated
```

De-elevated spawn (Windows-only capability, exercised via `IPtyHost`/`NodePtyHost`, not a core method):
when an **elevated** daemon starts a terminal with `runAsAdmin === false`, the child MUST be launched at
**medium** integrity using a filtered/shell token.

## Obligations (contract suite asserts)
- `isElevated()` returns a stable boolean for the process lifetime and matches the OS's actual integrity
  level (verified against the token integrity in the platform contract test).
- `canRunAsAdmin(false) === false` and `canRunAsAdmin(true) === true` (pure; trivially unit-tested).
- **Windows spawn (platform contract, run in an elevated context):** a child spawned with
  `runAsAdmin: true` runs at **high** integrity; a child spawned with `runAsAdmin: false` from the elevated
  parent runs at **medium** integrity (de-elevation succeeded). In a **non-elevated** context, only the
  normal (medium) spawn path is exercised and `isElevated()` is false.

## Capability wiring (not part of the contract)
- Daemon exposes `terminal.capabilities → { elevated: boolean }` (RPC); UI main forwards it via the preload
  bridge `terminal.capabilities()`. The sandboxed renderer NEVER probes the OS directly (Principle II/IX).
- FR-025a: the form's "run as admin" checkbox is enabled iff `elevated`; else disabled with a hover title
  telling the user to relaunch throng as administrator.
- FR-025b: UI main compares its own `isElevated()` to the daemon's; app-elevated + daemon-not ⇒ retire and
  respawn the daemon elevated (reuses the build-id/instance retirement path).

## Windows impl notes (not part of the contract)
Check the process token: `GetTokenInformation(TokenElevation)`. De-elevated spawn: obtain the shell
(explorer) medium-integrity token or a filtered token from the elevated token and launch via
`CreateProcessWithTokenW` / `CreateProcessAsUser`, so the ConPTY child runs at normal integrity while the
daemon stays elevated.

## Contract tests
- Unit: `canRunAsAdmin` truth table; a compliant `IElevationState` fake passes, a lying fake fails.
- Integration/contract: `runElevationContract(() => new WindowsElevation())` asserts `isElevated()` matches
  the real token; the elevated-only spawn-integrity assertions are gated on an elevated runner and skipped
  (with a logged notice — no silent pass) otherwise.
