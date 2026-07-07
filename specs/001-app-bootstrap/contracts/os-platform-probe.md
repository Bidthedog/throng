# Contract: `IPlatformInfo` (OS Abstraction)

The single OS-abstraction contract exercised in the bootstrap iteration. It exists to **establish
and prove the platform boundary** (Principle II) and to install the **contract-test pattern**
(Principle V, **[Gap A]**) so that future OS-specific behaviour (process spawning, shell detection,
filesystem paths, file watching, reattachment) is added behind verified contracts rather than ad hoc.

## Interface (defined in `core/abstractions`)

```ts
export interface IPlatformInfo {
  /** Stable identifier of the host operating system. */
  osName(): "windows" | "macos" | "linux";
  /** The OS path separator ("\\" on Windows, "/" elsewhere). */
  pathSeparator(): string;
}
```

`core` defines **only** the interface — it contains no OS calls. The Windows implementation
`WindowsPlatformInfo` lives in `packages/platform-windows` and is the only place that may read
OS-specific facts (e.g. `os.platform()`, `path.sep`).

## Contract obligations

Any implementation MUST satisfy:

1. `osName()` returns exactly one of `"windows" | "macos" | "linux"`, stable across calls.
2. `pathSeparator()` returns a non-empty single-character string consistent with `osName()`
   (`"\\"` when `osName() === "windows"`).
3. Methods are pure/side-effect-free and safe to call repeatedly.

## Shared contract-test suite ([Gap A])

`core` (test helpers) exports a reusable suite:

```ts
// pseudocode — full body lives in tasks/implementation, not here
export function runPlatformInfoContract(makeSubject: () => IPlatformInfo): void {
  // asserts obligations 1–3 above against the supplied implementation
}
```

- `platform-windows/tests/contract/` calls `runPlatformInfoContract(() => new WindowsPlatformInfo())`
  and additionally asserts the Windows specifics (`osName() === "windows"`, `pathSeparator() === "\\"`).
- When macOS/Linux implementations are added later, each runs the **same** suite — that is the
  mechanism keeping the OS seam honest (Principle II + V).

Tests MUST be written first and observed failing before the implementation exists (**[Gap D]**).
