# Data Model: macOS Support

No database schema changes. The entities are in-memory values, configuration and release metadata.

## HostTraits (macOS) — `core/src/platform/host-traits.ts`

| Field | macOS value | Windows / Linux |
|---|---|---|
| `os` | `'macos'` | `'windows'` / `'linux'` |
| `paths.caseSensitive` | `false` | `false` / `true` |
| `paths.backslashIsSeparator` | `false` | `true` / `false` |
| `paths.caseSensitiveRoots` *(new, optional)* | absolute mount roots answering `_PC_CASE_SENSITIVE = 1` | absent |
| `paths.unicodeForm` *(new, optional)* | `'NFC'` | absent |
| `ipc` | `{ kind: 'socket', dir: '$TMPDIR/throng' }` | pipe / socket |

Rules: a path is compared case-sensitively when `caseSensitive` is true **or** it lies under a `caseSensitiveRoots` entry
(longest root wins). `unicodeForm` normalises before comparison only; stored and displayed paths keep their spelling.
Absent optional fields reproduce today's results exactly (FR-039).

## ProcRow (macOS) — `platform-macos/src/macos-proc-table.ts`

Same shape as Linux's `proc-table.ts` row: `pid`, `ppid`, `uid`, `comm`, `startedAt` (ms since epoch from
`pbi_start_tvsec/usec`), plus lazily read `argv`, `exe`, `cwd`. Metrics add `cpuMs` (user+system), `privateBytes`
(`ri_phys_footprint`), `residentBytes`, `readBytes`, `writeBytes`. A row is the same process only when `pid` **and**
`startedAt` match (pid-reuse rule, as Linux).

## PlatformServices additions — `packages/platform/src/index.ts`

| Entry | Type | Windows | Linux | macOS |
|---|---|---|---|---|
| `windowChrome` *(new)* | `() => BrowserWindowChromeOptions` | `{ frame: false }` | `{ frame: false }` | `{ titleBarStyle: 'hidden', trafficLightPosition }` |
| `privacyProtectedRoots` *(new)* | `(home) => string[]` | `[]` | `[]` | Desktop, Documents, Downloads, iCloud Drive, `/Volumes` |
| `commandLineInstall` *(new)* | `(opts) => ICommandLineInstall` | unavailable | unavailable | `MacosCommandLineInstall` |
| `userDirectories().logDir` *(new, optional)* | `(dev) => string` | `<data>/logs` | `<data>/logs` | `~/Library/Logs/throng[-dev]` |

## ICommandLineInstall — `core/src/abstractions/command-line-install.ts` (new)

```ts
type CommandLineStatus =
  | { kind: 'absent' }
  | { kind: 'ours'; linkPath: string }
  | { kind: 'ours-broken'; linkPath: string; target: string }   // bundle moved or removed
  | { kind: 'other'; linkPath: string; target: string };

interface ICommandLineInstall {
  readonly available: boolean;
  readonly unavailableReason?: string;
  status(): Promise<CommandLineStatus>;
  install(opts: { replaceOther: boolean }): Promise<CommandLineStatus>;   // rejects with a reason on decline or failure
  uninstall(): Promise<CommandLineStatus>;
}
```

State transitions: `absent → ours` (install); `other → ours` (install with `replaceOther`, after the user confirms);
`ours → absent` (uninstall); `ours → ours-broken` (bundle moved, observed at start); `ours-broken → ours` (install).

## Settings — `core/src/config/app-settings.ts`

| Key | Type | Default | Platforms | Reader |
|---|---|---|---|---|
| `terminals.macOptionIsMeta` | boolean | `false` | `onlyOn: 'macos'` | `use-terminal.ts` → xterm `macOptionIsMeta` |

The shipped-defaults version does not change (a new setting needs no bump since 045); the reset, completeness and
inertness tests cover it.

## Key bindings — `core/src/config/keybindings.ts`

- `KeyEvent.meta?: boolean`; token modifier `Meta` (shown as `Cmd` on macOS).
- `MACOS_RESERVED_CHORDS: readonly string[]`.
- `MACOS_BINDING_OVERRIDES: Record<ActionId, string>`, each value checked against both terminal tiers, the reserved list
  and every other default.
- `MACOS_BINDINGS = applyOverrides(ctrlToMeta(WINDOWS_BINDINGS), MACOS_BINDING_OVERRIDES)`, same action ids.
- `SHIPPED_KEYBINDINGS_BY_PLATFORM.macos`; `columnSelectModifier: 'alt'` (Option).

## Release artifacts — `core/src/config/release-artifacts.ts`

| Role | Platform | Filename | Steps |
|---|---|---|---|
| `dmg` | `darwin` | `throng-V-mac-arm64.dmg` | `MACOS_PACKAGE_STEPS` |
| `macarchive` | `darwin` | `throng-V-mac-arm64.zip` | `MACOS_PACKAGE_STEPS` minus `in-use-upgrade` |

`MACOS_PACKAGE_STEPS`: install, launch, version-match, self-contained, core-journey, reattach, in-use-upgrade,
checksum-match, no-write, cli-command, uninstall, residue-scan, gatekeeper-first-launch. `RUNNER_LIMITED_STEPS` gains
`gatekeeper-first-launch`.

## Runner list — `.github/macos-runners.json` (new)

```json
{ "current": "xcode-27", "previous": "macos-26" }
```

The only place a macOS runner label or version is named in CI and release (FR-037).
