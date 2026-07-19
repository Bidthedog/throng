# Contract: Installer Verification & Verdict

**Traces**: FR-023, FR-024, FR-024a, FR-025, FR-026, FR-027; SC-007.

## Harness (`scripts/verify-installer.mjs`) + logic (`packages/core` or `scripts` unit-tested helpers)

Runs on a clean environment, automatically (no human chooses to run it). Steps, in order (each names
itself when it is the first to fail, FR-025):

1. **Interrupted-install** — an aborted install leaves no launchable partial product (FR-022).
2. **Install** the built package silently, per-user (`installer.exe /S`).
3. **Launch** the app (a real window must appear — a startup crash fails here).
4. **Version match** — installer filename == package == reported version (SC-002).
5. **Self-contained** — the daemon runs under the bundled runtime, no PATH node (FR-009/041).
6. **Shortcut** — the Start-menu launch shortcut exists (FR-014).
7. **No-service** — no Windows service was registered (FR-011).
8. **Core journey** — the packaged app + its bundled-runtime daemon boot together.
9. **Reattach** — the detached daemon survives app close and is reattached, not respawned, on reopen (SC-009/FR-019).
10. **Checksum match** — the published checksum equals the SHA-256 of the artifact bytes (FR-024a).
11. **No-write** — nothing was written under the install root at runtime (FR-008).
12. **Uninstall** silently.
13. **Residue scan** — no `throng` process running and no component left under the install root (FR-024).

## Verdict

```ts
interface VerificationVerdict {
  version: string;          // the package tested
  installerSha256: string;  // binds the verdict to exact bytes
  passed: boolean;
  failedStep: string | null;// names the first failed step (FR-025)
}
```

## Behavioural requirements

- **B1** A known-good package → `passed: true`, `failedStep: null` (SC-007).
- **B2** A package broken in any step → `passed: false`, `failedStep` names that step (FR-025).
- **B3** The verdict is recorded against `{version, installerSha256}` and inspectable without re-running
  (FR-026) — emitted as a CI artifact/check.
- **B4** **Absent verdict = failure**: the publish gate treats a missing verdict as a red result, never as
  a pass (FR-027).
- **B5** A missing or mismatched checksum fails verification (FR-024a).

## Tests (test-first)

- **unit** — the residue scanner reports "clean" for an empty tree and "dirty" (naming the offender) when a
  component/process remains; the version-match and checksum-match comparators; the verdict serialiser.
- **CI (D6)** — the full harness runs on a fresh `windows-latest` runner (authored here, executed in CI).
